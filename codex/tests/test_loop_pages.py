"""Regression tests for the flat, program-folder Loop Engineering layout."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SKILL_DIR = Path(__file__).resolve().parents[1]
SCRIPT = SKILL_DIR / "scripts" / "loop_pages.py"


class ProgramFolderCliTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temp_dir = tempfile.TemporaryDirectory()
        self.repo = Path(self._temp_dir.name)
        self.sprint = self.repo / "docs" / "sprints" / "sprint_3"
        self.sprint.mkdir(parents=True)
        self.program_slug = "bunnyos-cpa-chatbox"
        self.program_dir = self.sprint / self.program_slug
        self.run_cli(
            "bootstrap-program",
            self.sprint,
            self.program_slug,
            "--id",
            "S3-CHAT",
            "--title",
            "BunnyOS CPA chatbox",
            "--goal",
            "Track every related ticket in one Sprint 3 folder.",
            "--date",
            "2026-07-14",
        )

    def tearDown(self) -> None:
        self._temp_dir.cleanup()

    def run_cli(
        self,
        *args: str | Path,
        expect_success: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            [sys.executable, str(SCRIPT), *(str(arg) for arg in args)],
            cwd=self.repo,
            text=True,
            capture_output=True,
            check=False,
        )
        if expect_success and result.returncode != 0:
            self.fail(
                f"command failed ({result.returncode}): {result.args}\n"
                f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
            )
        if not expect_success and result.returncode == 0:
            self.fail(f"command unexpectedly succeeded: {result.args}\n{result.stdout}")
        return result

    def bootstrap_ticket(
        self,
        ticket_id: str,
        ticket_slug: str,
        *,
        subtask_id: str,
        subtask_slug: str,
    ) -> None:
        subtasks = [
            {
                "id": subtask_id,
                "slug": subtask_slug,
                "title": f"Implement {ticket_slug}",
                "goal": f"Finish {ticket_slug} safely.",
                "acceptance": ["The behavior is covered by tests."],
            }
        ]
        self.run_cli(
            "bootstrap-ticket",
            self.sprint,
            ticket_slug,
            "--program",
            self.program_slug,
            "--id",
            ticket_id,
            "--title",
            ticket_slug.replace("-", " ").title(),
            "--goal",
            f"Deliver {ticket_slug}.",
            "--subtasks-json",
            json.dumps(subtasks),
            "--date",
            "2026-07-14",
        )

    def read_embedded_json(self, kind: str, page: Path) -> dict:
        result = self.run_cli("extract", kind, page)
        return json.loads(result.stdout)

    def read_program_index(self) -> dict:
        result = self.run_cli("extract", "program", self.program_dir / "index.html")
        return json.loads(result.stdout)

    def discover(self) -> list[dict]:
        result = self.run_cli("discover", self.sprint)
        return json.loads(result.stdout)

    def ticket_id(self, discovered_ticket: dict) -> str:
        return self.read_embedded_json("plan", Path(discovered_ticket["plan"]))["id"]

    def subtask_ids(self, discovered_ticket: dict) -> set[str]:
        return {
            self.read_embedded_json("plan", Path(subtask["plan"]))["id"]
            for subtask in discovered_ticket["subtasks"]
        }

    def test_bootstrap_uses_flat_id_prefixed_files_and_valid_program_index(self) -> None:
        self.bootstrap_ticket(
            "S3-T1",
            "profile-writes",
            subtask_id="S3-T1-ST1",
            subtask_slug="intake",
        )
        self.run_cli(
            "bootstrap-subtask",
            self.sprint,
            "profile-writes",
            "review",
            "--program",
            self.program_slug,
            "--ticket-id",
            "S3-T1",
            "--id",
            "S3-T1-ST2",
            "--title",
            "Review writes",
            "--goal",
            "Confirm each proposed write before applying it.",
            "--date",
            "2026-07-14",
        )

        self.assertEqual([], [path for path in self.program_dir.iterdir() if path.is_dir()])
        self.assertEqual(
            {
                "index.html",
                "s3-t1-profile-writes_plan.html",
                "s3-t1-profile-writes_status.html",
                "s3-t1-st1-intake_plan.html",
                "s3-t1-st1-intake_status.html",
                "s3-t1-st2-review_plan.html",
                "s3-t1-st2-review_status.html",
            },
            {path.name for path in self.program_dir.iterdir()},
        )

        validated = self.run_cli("validate", "program", self.program_dir / "index.html")
        self.assertIn("program", validated.stdout)
        self.assertIn("OK", validated.stdout)

    def test_same_subtask_slug_across_tickets_does_not_collide_and_groups_correctly(self) -> None:
        self.bootstrap_ticket(
            "S3-T1",
            "runtime",
            subtask_id="S3-T1-ST1",
            subtask_slug="implementation",
        )
        self.bootstrap_ticket(
            "S3-T2",
            "persistence",
            subtask_id="S3-T2-ST1",
            subtask_slug="implementation",
        )

        self.assertTrue((self.program_dir / "s3-t1-st1-implementation_plan.html").is_file())
        self.assertTrue((self.program_dir / "s3-t2-st1-implementation_plan.html").is_file())

        discovered = self.discover()
        self.assertEqual(["program-ticket", "program-ticket"], [item["shape"] for item in discovered])
        self.assertEqual(
            [self.program_slug, self.program_slug],
            [item["programSlug"] for item in discovered],
        )
        self.assertTrue(
            all(Path(item["programIndex"]).samefile(self.program_dir / "index.html") for item in discovered)
        )
        by_ticket = {self.ticket_id(item): item for item in discovered}
        self.assertEqual({"S3-T1", "S3-T2"}, set(by_ticket))
        self.assertEqual({"S3-T1-ST1"}, self.subtask_ids(by_ticket["S3-T1"]))
        self.assertEqual({"S3-T2-ST1"}, self.subtask_ids(by_ticket["S3-T2"]))

    def test_discovery_and_index_sort_ticket_ids_naturally(self) -> None:
        self.bootstrap_ticket(
            "S3-T10",
            "release-gate",
            subtask_id="S3-T10-ST1",
            subtask_slug="verify",
        )
        self.bootstrap_ticket(
            "S3-T2",
            "persistence",
            subtask_id="S3-T2-ST1",
            subtask_slug="persist",
        )
        self.run_cli("refresh-index", self.program_dir)

        discovered_ids = [self.ticket_id(item) for item in self.discover()]
        self.assertEqual(["S3-T2", "S3-T10"], discovered_ids)
        index_ids = [ticket["id"] for ticket in self.read_program_index()["tickets"]]
        self.assertEqual(["S3-T2", "S3-T10"], index_ids)

    def test_refresh_index_updates_ticket_and_subtask_status_snapshots(self) -> None:
        self.bootstrap_ticket(
            "S3-T1",
            "runtime",
            subtask_id="S3-T1-ST1",
            subtask_slug="isolation",
        )
        ticket_status_page = self.program_dir / "s3-t1-runtime_status.html"
        subtask_status_page = self.program_dir / "s3-t1-st1-isolation_status.html"

        ticket_status = self.read_embedded_json("status", ticket_status_page)
        ticket_status.update({"status": "done", "phase": "review", "updated": "2026-07-15"})
        subtask_status = self.read_embedded_json("status", subtask_status_page)
        subtask_status.update({"status": "in_progress", "phase": "test", "updated": "2026-07-15"})
        ticket_json = self.repo / "ticket-status.json"
        subtask_json = self.repo / "subtask-status.json"
        ticket_json.write_text(json.dumps(ticket_status), encoding="utf-8")
        subtask_json.write_text(json.dumps(subtask_status), encoding="utf-8")
        self.run_cli("replace", "status", ticket_status_page, ticket_json)
        self.run_cli("replace", "status", subtask_status_page, subtask_json)

        self.run_cli("refresh-index", self.program_dir)
        program = self.read_program_index()
        ticket = next(item for item in program["tickets"] if item["id"] == "S3-T1")
        subtask = next(item for item in ticket["subtasks"] if item["id"] == "S3-T1-ST1")
        self.assertEqual("done", ticket["status"])
        self.assertEqual("in_progress", subtask["status"])
        self.assertEqual("s3-t1-runtime_plan.html", ticket["plan"])
        self.assertEqual("s3-t1-runtime_status.html", ticket["statusPage"])
        self.assertEqual("s3-t1-st1-isolation_plan.html", subtask["plan"])
        self.assertEqual("s3-t1-st1-isolation_status.html", subtask["statusPage"])

    def test_path_traversal_program_ticket_and_subtask_slugs_are_rejected(self) -> None:
        program_result = self.run_cli(
            "bootstrap-program",
            self.sprint,
            "../escaped-program",
            "--id",
            "BAD-P",
            "--title",
            "Unsafe program",
            "--goal",
            "This must fail.",
            expect_success=False,
        )
        self.assertIn("slug", program_result.stderr + program_result.stdout)

        ticket_result = self.run_cli(
            "bootstrap-ticket",
            self.sprint,
            "../escaped-ticket",
            "--program",
            self.program_slug,
            "--id",
            "BAD-T",
            "--title",
            "Unsafe ticket",
            "--goal",
            "This must fail.",
            expect_success=False,
        )
        self.assertIn("slug", ticket_result.stderr + ticket_result.stdout)

        subtask_result = self.run_cli(
            "bootstrap-subtask",
            self.sprint,
            "profile-writes",
            "../escaped-subtask",
            "--program",
            self.program_slug,
            "--ticket-id",
            "S3-T1",
            "--id",
            "BAD-ST",
            "--title",
            "Unsafe subtask",
            "--goal",
            "This must fail.",
            expect_success=False,
        )
        self.assertIn("slug", subtask_result.stderr + subtask_result.stdout)
        self.assertFalse((self.sprint.parent / "escaped-program").exists())
        self.assertFalse((self.sprint / "escaped-ticket_plan.html").exists())
        self.assertFalse((self.sprint / "escaped-subtask_plan.html").exists())


if __name__ == "__main__":
    unittest.main()
