"""Cross-runtime regression tests for the canonical Loop Engineering skill."""

from __future__ import annotations

import unittest
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
ADAPTERS = (REPO / "claude", REPO / "codex")


class RuntimeContractTests(unittest.TestCase):
    def test_both_adapters_enforce_one_flat_program_folder(self) -> None:
        for adapter in ADAPTERS:
            skill = (adapter / "SKILL.md").read_text(encoding="utf-8").lower()
            with self.subTest(adapter=adapter.name):
                self.assertIn("exactly one", skill)
                self.assertIn("feature/program folder", skill)
                self.assertIn("never create nested ticket or subtask", skill)
                self.assertIn("branch and pr boundaries never create documentation folders", skill)

    def test_page_helpers_and_templates_cannot_drift_between_runtimes(self) -> None:
        shared_paths = [
            Path("scripts/loop_pages.py"),
            Path("tests/test_loop_pages.py"),
            *(
                Path("assets/templates") / name
                for name in sorted(
                    path.name for path in (REPO / "codex" / "assets" / "templates").glob("*.html")
                )
            ),
        ]

        for relative_path in shared_paths:
            claude_file = REPO / "claude" / relative_path
            codex_file = REPO / "codex" / relative_path
            with self.subTest(path=str(relative_path)):
                self.assertTrue(claude_file.is_file())
                self.assertTrue(codex_file.is_file())
                self.assertEqual(claude_file.read_bytes(), codex_file.read_bytes())

    def test_runtime_entrypoints_and_metadata_exist(self) -> None:
        self.assertTrue((REPO / "claude" / "SKILL.md").is_file())
        self.assertTrue((REPO / "claude" / "task-flow.mjs").is_file())
        self.assertTrue((REPO / "codex" / "SKILL.md").is_file())
        self.assertTrue((REPO / "codex" / "agents" / "openai.yaml").is_file())

    def test_codex_honors_an_explicit_project_branch_prefix(self) -> None:
        skill = (REPO / "codex" / "SKILL.md").read_text(encoding="utf-8")
        config = (REPO / "codex" / "references" / "config.md").read_text(encoding="utf-8")
        self.assertIn("honor an explicit `git.branchPrefix`", skill)
        self.assertIn("honor the configured value", config)

    def test_ticket_crafting_requires_a_fresh_remote_base(self) -> None:
        for adapter in ADAPTERS:
            skill = (adapter / "SKILL.md").read_text(encoding="utf-8")
            with self.subTest(adapter=adapter.name):
                self.assertIn("git fetch --prune origin", skill)
                self.assertIn("git pull --ff-only origin <git.baseBranch>", skill)
                self.assertIn("origin/<git.baseBranch>", skill)
                self.assertIn("Never resolve the current sprint", skill)

    def test_runtime_safety_defaults_do_not_diverge(self) -> None:
        claude = (REPO / "claude" / "SKILL.md").read_text(encoding="utf-8")
        codex = (REPO / "codex" / "SKILL.md").read_text(encoding="utf-8")
        workflow = (REPO / "claude" / "task-flow.mjs").read_text(encoding="utf-8")
        self.assertIn("Default: **one ticket**", claude)
        self.assertIn("Default to one ticket", codex)
        self.assertIn("Stage 5a · `dryRun` open-PR state", claude)
        self.assertIn("Do not enter Stage 5b", claude)
        self.assertIn("uiEvidenceMissing", workflow)
        self.assertIn("const DESIGN_ENABLED = UI_ENABLED && SERVERS_UP", workflow)
        self.assertNotIn("DESIGN_ENABLED = UI_ENABLED && SERVERS_UP && PROJECT.testing.design !== false", workflow)
        self.assertIn("currentUiScreenshots.length === 0", workflow)
        self.assertIn("!uiChannelReported", workflow)
        self.assertIn("!reviewedCurrentScreenshots", workflow)


if __name__ == "__main__":
    unittest.main()
