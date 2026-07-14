#!/usr/bin/env python3
"""Helpers for loop-engineering HTML tracking pages.

Pages render from embedded JSON script blocks. This utility extracts,
validates, discovers, bootstraps, and replaces those JSON blocks without
touching the surrounding markup.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
from pathlib import Path


SCRIPT_RE = {
    "program": re.compile(
        r'(<script\s+id="program-data"\s+type="application/json">\s*)(.*?)(\s*</script>)',
        re.DOTALL,
    ),
    "plan": re.compile(
        r'(<script\s+id="(?:plan-data|ticket-data)"\s+type="application/json">\s*)(.*?)(\s*</script>)',
        re.DOTALL,
    ),
    "status": re.compile(
        r'(<script\s+id="status-data"\s+type="application/json">\s*)(.*?)(\s*</script>)',
        re.DOTALL,
    ),
}

STATUSES = {"todo", "in_progress", "blocked", "done"}


def natural_id_key(value: str) -> tuple:
    """Sort IDs such as S3-T2 before S3-T10."""
    return tuple(int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", value))


def require_safe_component(value: str, label: str) -> str:
    if not value or value in {".", ".."} or Path(value).name != value or "/" in value or "\\" in value:
        raise SystemExit(f"{label} must be one safe path component: {value!r}")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", value):
        raise SystemExit(f"{label} contains unsupported characters: {value!r}")
    return value


def canonical_id(value: str, label: str) -> str:
    require_safe_component(value, label)
    return value.lower()


def read_json(page: Path, kind: str) -> dict:
    text = page.read_text(encoding="utf-8")
    match = SCRIPT_RE[kind].search(text)
    if not match:
        raise SystemExit(f"{page}: missing {kind}-data script block")
    try:
        return json.loads(match.group(2))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"{page}: invalid {kind}-data JSON: {exc}") from exc


def write_json(page: Path, kind: str, data: dict) -> None:
    text = page.read_text(encoding="utf-8")
    match = SCRIPT_RE[kind].search(text)
    if not match:
        raise SystemExit(f"{page}: missing {kind}-data script block")
    body = json.dumps(data, indent=2, sort_keys=False)
    page.write_text(
        text[: match.start(2)] + "\n" + body + "\n" + text[match.end(2) :],
        encoding="utf-8",
    )


def require_keys(page: Path, data: dict, keys: set[str], label: str) -> None:
    missing = sorted(keys - set(data))
    if missing:
        raise SystemExit(f"{page}: missing {label} keys: {missing}")


def require_list(page: Path, data: dict, keys: tuple[str, ...], label: str) -> None:
    for key in keys:
        if not isinstance(data.get(key), list):
            raise SystemExit(f"{page}: {label} {key} must be a list")


def validate_ticket_plan(page: Path, data: dict) -> str:
    required = {
        "kind",
        "sprint",
        "id",
        "slug",
        "title",
        "goal",
        "surfaces",
        "acceptance",
        "outOfScope",
        "dependsOn",
        "detailed",
        "subtasks",
        "generatedFrom",
        "record",
    }
    require_keys(page, data, required, "ticket plan")
    if data["kind"] != "ticket":
        raise SystemExit(f"{page}: ticket plan kind must be 'ticket'")
    require_list(page, data, ("surfaces", "acceptance", "outOfScope", "dependsOn", "subtasks"), "ticket plan")
    return "ticket-plan"


def validate_subtask_plan(page: Path, data: dict) -> str:
    required = {
        "sprint",
        "ticketId",
        "ticketSlug",
        "id",
        "slug",
        "title",
        "goal",
        "surfaces",
        "acceptance",
        "outOfScope",
        "detailed",
        "generatedFrom",
        "record",
    }
    require_keys(page, data, required, "subtask plan")
    if data.get("kind", "subtask") != "subtask":
        raise SystemExit(f"{page}: subtask plan kind must be 'subtask'")
    require_list(page, data, ("surfaces", "acceptance", "outOfScope"), "subtask plan")
    return "subtask-plan"


def validate_legacy_ticket_plan(page: Path, data: dict) -> str:
    required = {
        "id",
        "slug",
        "title",
        "goal",
        "acceptance",
    }
    require_keys(page, data, required, "legacy ticket plan")
    for key in ("surfaces", "acceptance", "outOfScope", "dependsOn"):
        if key in data and not isinstance(data[key], list):
            raise SystemExit(f"{page}: legacy ticket plan {key} must be a list")
    return "legacy-ticket-plan"


def validate_plan(page: Path, data: dict) -> str:
    if "tasks" in data:
        required = {"sprint", "title", "description", "generatedFrom", "tasks"}
        require_keys(page, data, required, "legacy plan")
        if not isinstance(data["tasks"], list):
            raise SystemExit(f"{page}: legacy plan tasks must be a list")
        return "legacy-plan"
    if data.get("kind") == "ticket" or page.name == "ticket_plan.html" or "subtasks" in data:
        return validate_ticket_plan(page, data)
    if page.name.endswith("_ticket.html"):
        return validate_legacy_ticket_plan(page, data)
    return validate_subtask_plan(page, data)


def validate_ticket_status(page: Path, data: dict) -> str:
    required = {
        "kind",
        "sprint",
        "id",
        "slug",
        "title",
        "updated",
        "status",
        "phase",
        "branch",
        "pr",
        "mergedAt",
        "note",
        "log",
        "ledger",
    }
    require_keys(page, data, required, "ticket status")
    if data["kind"] != "ticket":
        raise SystemExit(f"{page}: ticket status kind must be 'ticket'")
    if data["status"] not in STATUSES:
        raise SystemExit(f"{page}: invalid status {data['status']!r}; expected one of {sorted(STATUSES)}")
    require_list(page, data, ("log", "ledger"), "ticket status")
    return "ticket-status"


def validate_subtask_status(page: Path, data: dict) -> str:
    required = {
        "sprint",
        "ticketId",
        "ticketSlug",
        "id",
        "slug",
        "title",
        "updated",
        "status",
        "phase",
        "note",
        "log",
        "ledger",
    }
    require_keys(page, data, required, "subtask status")
    if data.get("kind", "subtask") != "subtask":
        raise SystemExit(f"{page}: subtask status kind must be 'subtask'")
    if data["status"] not in STATUSES:
        raise SystemExit(f"{page}: invalid status {data['status']!r}; expected one of {sorted(STATUSES)}")
    require_list(page, data, ("log", "ledger"), "subtask status")
    return "subtask-status"


def validate_legacy_ticket_status(page: Path, data: dict) -> str:
    required = {
        "id",
        "slug",
        "updated",
        "status",
    }
    require_keys(page, data, required, "legacy ticket status")
    allowed = STATUSES | {"shipped"}
    if data["status"] not in allowed:
        raise SystemExit(f"{page}: invalid status {data['status']!r}; expected one of {sorted(allowed)}")
    for key in ("log", "ledger", "verification"):
        if key in data and not isinstance(data[key], list):
            raise SystemExit(f"{page}: legacy ticket status {key} must be a list")
    return "legacy-ticket-status"


def validate_status(page: Path, data: dict) -> str:
    if "tasks" in data:
        required = {"updated", "currentCycle", "tasks", "log", "ledger"}
        require_keys(page, data, required, "legacy status")
        if not isinstance(data["tasks"], dict):
            raise SystemExit(f"{page}: legacy status tasks must be an object")
        return "legacy-status"
    if data.get("kind") == "ticket" or page.name == "ticket_status.html":
        return validate_ticket_status(page, data)
    if data.get("kind") == "subtask" or "ticketId" in data or "ticketSlug" in data:
        return validate_subtask_status(page, data)
    return validate_legacy_ticket_status(page, data)


def require_index_page(page: Path, value: str, label: str) -> Path:
    require_safe_component(value, label)
    if not value.endswith(".html"):
        raise SystemExit(f"{page}: {label} must reference an HTML page: {value!r}")
    target = page.parent / value
    if not target.is_file():
        raise SystemExit(f"{page}: missing {label}: {target}")
    return target


def require_identity(page: Path, plan: dict, status: dict, fields: tuple[str, ...]) -> None:
    for field in fields:
        if plan.get(field) != status.get(field):
            raise SystemExit(
                f"{page}: plan/status {field} mismatch: {plan.get(field)!r} != {status.get(field)!r}"
            )


def empty_rollup() -> dict:
    return {"total": 0, "todo": 0, "in_progress": 0, "blocked": 0, "done": 0}


def summarize_states(items: list[dict]) -> dict:
    summary = empty_rollup()
    for item in items:
        state = item["status"]
        if state not in STATUSES:
            raise SystemExit(f"invalid indexed status {state!r}; expected one of {sorted(STATUSES)}")
        summary["total"] += 1
        summary[state] += 1
    return summary


def validate_program_index(page: Path, data: dict) -> str:
    required = {
        "kind",
        "sprint",
        "id",
        "slug",
        "title",
        "goal",
        "updated",
        "ticketOrder",
        "tickets",
        "rollup",
    }
    require_keys(page, data, required, "program index")
    if data["kind"] != "program":
        raise SystemExit(f"{page}: program index kind must be 'program'")
    require_safe_component(data["slug"], "program slug")
    if page.name != "index.html":
        raise SystemExit(f"{page}: program index must be named index.html")
    if page.parent.name != data["slug"]:
        raise SystemExit(f"{page}: program slug must match its folder name")
    if not isinstance(data["tickets"], list) or not isinstance(data["ticketOrder"], list):
        raise SystemExit(f"{page}: program tickets and ticketOrder must be lists")
    if not isinstance(data["rollup"], dict):
        raise SystemExit(f"{page}: program rollup must be an object")

    ticket_ids: set[str] = set()
    ticket_slugs: set[str] = set()
    subtask_ids: set[str] = set()
    indexed_plans: set[Path] = set()
    indexed_statuses: set[Path] = set()
    all_subtasks: list[dict] = []

    for ticket in data["tickets"]:
        if not isinstance(ticket, dict):
            raise SystemExit(f"{page}: every indexed ticket must be an object")
        ticket_required = {
            "id",
            "slug",
            "title",
            "dependsOn",
            "plan",
            "statusPage",
            "status",
            "phase",
            "branch",
            "pr",
            "mergedAt",
            "subtasks",
        }
        require_keys(page, ticket, ticket_required, "indexed ticket")
        if ticket["id"] in ticket_ids:
            raise SystemExit(f"{page}: duplicate ticket id {ticket['id']!r}")
        if ticket["slug"] in ticket_slugs:
            raise SystemExit(f"{page}: duplicate ticket slug {ticket['slug']!r}")
        ticket_ids.add(ticket["id"])
        ticket_slugs.add(ticket["slug"])
        if ticket["status"] not in STATUSES:
            raise SystemExit(f"{page}: invalid ticket status {ticket['status']!r}")
        if not isinstance(ticket["dependsOn"], list) or not isinstance(ticket["subtasks"], list):
            raise SystemExit(f"{page}: indexed ticket dependsOn and subtasks must be lists")

        ticket_plan_path = require_index_page(page, ticket["plan"], "ticket plan")
        ticket_status_path = require_index_page(page, ticket["statusPage"], "ticket status")
        ticket_plan = read_json(ticket_plan_path, "plan")
        ticket_status = read_json(ticket_status_path, "status")
        validate_ticket_plan(ticket_plan_path, ticket_plan)
        validate_ticket_status(ticket_status_path, ticket_status)
        require_identity(ticket_plan_path, ticket_plan, ticket_status, ("kind", "sprint", "id", "slug", "title"))
        if ticket_plan["sprint"] != data["sprint"]:
            raise SystemExit(f"{page}: ticket {ticket['id']} belongs to a different sprint")
        if ticket_plan["id"] != ticket["id"] or ticket_plan["slug"] != ticket["slug"]:
            raise SystemExit(f"{page}: indexed ticket identity does not match {ticket_plan_path.name}")
        for field in ("title", "dependsOn"):
            if ticket_plan[field] != ticket[field]:
                raise SystemExit(f"{page}: indexed ticket {field} is stale for {ticket['id']}")
        for field in ("status", "phase", "branch", "pr", "mergedAt"):
            if ticket_status[field] != ticket[field]:
                raise SystemExit(f"{page}: indexed ticket {field} is stale for {ticket['id']}")
        indexed_plans.add(ticket_plan_path)
        indexed_statuses.add(ticket_status_path)

        declared_subtasks = {
            (item["id"], item["slug"]): item for item in ticket_plan["subtasks"]
        }
        indexed_subtasks: set[tuple[str, str]] = set()
        for subtask in ticket["subtasks"]:
            if not isinstance(subtask, dict):
                raise SystemExit(f"{page}: every indexed subtask must be an object")
            subtask_required = {
                "id",
                "slug",
                "title",
                "required",
                "plan",
                "statusPage",
                "status",
                "phase",
            }
            require_keys(page, subtask, subtask_required, "indexed subtask")
            identity = (subtask["id"], subtask["slug"])
            if subtask["id"] in subtask_ids:
                raise SystemExit(f"{page}: duplicate subtask id {subtask['id']!r}")
            if identity in indexed_subtasks:
                raise SystemExit(f"{page}: duplicate subtask identity {identity!r}")
            subtask_ids.add(subtask["id"])
            indexed_subtasks.add(identity)
            if subtask["status"] not in STATUSES:
                raise SystemExit(f"{page}: invalid subtask status {subtask['status']!r}")
            subtask_plan_path = require_index_page(page, subtask["plan"], "subtask plan")
            subtask_status_path = require_index_page(page, subtask["statusPage"], "subtask status")
            subtask_plan = read_json(subtask_plan_path, "plan")
            subtask_status = read_json(subtask_status_path, "status")
            validate_subtask_plan(subtask_plan_path, subtask_plan)
            validate_subtask_status(subtask_status_path, subtask_status)
            require_identity(
                subtask_plan_path,
                subtask_plan,
                subtask_status,
                ("kind", "sprint", "ticketId", "ticketSlug", "id", "slug", "title"),
            )
            if subtask_plan["sprint"] != data["sprint"]:
                raise SystemExit(f"{page}: subtask {subtask['id']} belongs to a different sprint")
            if subtask_plan["ticketId"] != ticket["id"] or subtask_plan["ticketSlug"] != ticket["slug"]:
                raise SystemExit(f"{page}: orphan subtask {subtask['id']} does not belong to {ticket['id']}")
            if subtask_plan["id"] != subtask["id"] or subtask_plan["slug"] != subtask["slug"]:
                raise SystemExit(f"{page}: indexed subtask identity does not match {subtask_plan_path.name}")
            if identity not in declared_subtasks:
                raise SystemExit(f"{page}: subtask {subtask['id']} is missing from ticket plan {ticket_plan_path.name}")
            for field in ("title",):
                if subtask_plan[field] != subtask[field]:
                    raise SystemExit(f"{page}: indexed subtask {field} is stale for {subtask['id']}")
            if declared_subtasks[identity].get("required", True) != subtask["required"]:
                raise SystemExit(f"{page}: indexed subtask required flag is stale for {subtask['id']}")
            for field in ("status", "phase"):
                if subtask_status[field] != subtask[field]:
                    raise SystemExit(f"{page}: indexed subtask {field} is stale for {subtask['id']}")
            indexed_plans.add(subtask_plan_path)
            indexed_statuses.add(subtask_status_path)
            all_subtasks.append(subtask)
        if indexed_subtasks != set(declared_subtasks):
            missing = sorted(set(declared_subtasks) - indexed_subtasks)
            raise SystemExit(f"{page}: ticket {ticket['id']} has unindexed subtasks: {missing}")

    if data["ticketOrder"] != [ticket["id"] for ticket in data["tickets"]]:
        raise SystemExit(f"{page}: ticketOrder must match the indexed ticket order")

    actual_plans = set(page.parent.glob("*_plan.html"))
    actual_statuses = set(page.parent.glob("*_status.html"))
    if actual_plans != indexed_plans:
        extra = sorted(path.name for path in actual_plans - indexed_plans)
        missing = sorted(path.name for path in indexed_plans - actual_plans)
        raise SystemExit(f"{page}: plan index mismatch; unindexed={extra}, missing={missing}")
    if actual_statuses != indexed_statuses:
        extra = sorted(path.name for path in actual_statuses - indexed_statuses)
        missing = sorted(path.name for path in indexed_statuses - actual_statuses)
        raise SystemExit(f"{page}: status index mismatch; unindexed={extra}, missing={missing}")

    expected_rollup = {
        "tickets": summarize_states(data["tickets"]),
        "subtasks": summarize_states(all_subtasks),
    }
    if data["rollup"] != expected_rollup:
        raise SystemExit(f"{page}: rollup is stale; expected {expected_rollup}")
    return "program-index"


def cmd_extract(args: argparse.Namespace) -> None:
    data = read_json(Path(args.page), args.kind)
    print(json.dumps(data, indent=2, sort_keys=False))


def cmd_replace(args: argparse.Namespace) -> None:
    data = json.loads(Path(args.json_file).read_text(encoding="utf-8"))
    page = Path(args.page)
    if args.kind == "program":
        validate_program_index(page, data)
    elif args.kind == "plan":
        validate_plan(page, data)
    else:
        validate_status(page, data)
    write_json(page, args.kind, data)


def cmd_validate(args: argparse.Namespace) -> None:
    page = Path(args.page)
    data = read_json(page, args.kind)
    if args.kind == "program":
        shape = validate_program_index(page, data)
    elif args.kind == "plan":
        shape = validate_plan(page, data)
    else:
        shape = validate_status(page, data)
    print(f"{page}: {shape} OK")


def load_template(skill_dir: Path, name: str) -> str:
    path = skill_dir / "assets" / "templates" / name
    if not path.exists():
        raise SystemExit(f"missing template: {path}")
    return path.read_text(encoding="utf-8")


def is_sprint_dir(path: Path) -> bool:
    return re.fullmatch(r"sprint_\d+", path.name) is not None


def resolve_sprints_root(base: Path) -> Path:
    if is_sprint_dir(base):
        return base.parent
    if base.name == "sprints":
        return base
    if base.name == "docs":
        return base / "sprints"
    return base / "docs" / "sprints"


def current_sprint(base: Path) -> Path:
    if is_sprint_dir(base):
        return base
    root = resolve_sprints_root(base)
    existing = []
    if root.exists():
        for child in root.iterdir():
            if child.is_dir() and is_sprint_dir(child):
                existing.append((int(child.name.rsplit("_", 1)[1]), child))
    if existing:
        return max(existing, key=lambda item: item[0])[1]
    return root / "sprint_0"


def expected_page_name(item_id: str, slug: str, kind: str) -> str:
    require_safe_component(slug, f"{kind} slug")
    return f"{canonical_id(item_id, f'{kind} id')}-{slug}"


def scan_program_pages(program_dir: Path) -> list[dict]:
    """Build an authoritative ticket snapshot from flat program page pairs."""
    ticket_sources: dict[tuple[str, str], dict] = {}
    subtask_sources: list[dict] = []
    seen_ids: set[str] = set()
    seen_ticket_slugs: set[str] = set()
    matched_statuses: set[Path] = set()

    for plan_path in sorted(program_dir.glob("*_plan.html")):
        plan = read_json(plan_path, "plan")
        shape = validate_plan(plan_path, plan)
        if shape not in {"ticket-plan", "subtask-plan"}:
            raise SystemExit(f"{plan_path}: program folders only accept ticket/subtask plan pages")
        item_kind = plan.get("kind")
        expected_stem = expected_page_name(plan["id"], plan["slug"], item_kind)
        expected_plan_name = f"{expected_stem}_plan.html"
        if plan_path.name != expected_plan_name:
            raise SystemExit(f"{plan_path}: expected deterministic filename {expected_plan_name!r}")
        status_path = program_dir / f"{expected_stem}_status.html"
        if not status_path.is_file():
            raise SystemExit(f"{plan_path}: missing paired status page {status_path.name}")
        status = read_json(status_path, "status")
        status_shape = validate_status(status_path, status)
        expected_status_shape = f"{item_kind}-status"
        if status_shape != expected_status_shape:
            raise SystemExit(f"{status_path}: expected {expected_status_shape}, found {status_shape}")
        identity_fields = ("kind", "sprint", "id", "slug", "title")
        if item_kind == "subtask":
            identity_fields += ("ticketId", "ticketSlug")
        require_identity(plan_path, plan, status, identity_fields)
        if plan["id"] in seen_ids:
            raise SystemExit(f"{plan_path}: duplicate program item id {plan['id']!r}")
        seen_ids.add(plan["id"])
        matched_statuses.add(status_path)
        source = {"planPath": plan_path, "statusPath": status_path, "plan": plan, "statusData": status}
        if item_kind == "ticket":
            if plan["slug"] in seen_ticket_slugs:
                raise SystemExit(f"{plan_path}: duplicate ticket slug {plan['slug']!r}")
            seen_ticket_slugs.add(plan["slug"])
            ticket_sources[(plan["id"], plan["slug"])] = source
        else:
            subtask_sources.append(source)

    unmatched_statuses = set(program_dir.glob("*_status.html")) - matched_statuses
    if unmatched_statuses:
        raise SystemExit(
            f"{program_dir}: orphan status pages: {sorted(path.name for path in unmatched_statuses)}"
        )

    grouped_subtasks: dict[tuple[str, str], list[dict]] = {key: [] for key in ticket_sources}
    for source in subtask_sources:
        plan = source["plan"]
        parent = (plan["ticketId"], plan["ticketSlug"])
        if parent not in ticket_sources:
            raise SystemExit(f"{source['planPath']}: orphan subtask references missing ticket {parent!r}")
        grouped_subtasks[parent].append(source)

    snapshots: list[dict] = []
    for key, source in ticket_sources.items():
        plan = source["plan"]
        status = source["statusData"]
        declared = {(item["id"], item["slug"]): item for item in plan["subtasks"]}
        actual = {(item["plan"]["id"], item["plan"]["slug"]): item for item in grouped_subtasks[key]}
        if set(declared) != set(actual):
            missing = sorted(set(declared) - set(actual))
            orphaned = sorted(set(actual) - set(declared))
            raise SystemExit(
                f"{source['planPath']}: subtask page mismatch; missing={missing}, unlisted={orphaned}"
            )
        subtasks = []
        for identity in sorted(actual, key=lambda item: natural_id_key(item[0])):
            sub_source = actual[identity]
            sub_plan = sub_source["plan"]
            sub_status = sub_source["statusData"]
            subtasks.append(
                {
                    "id": sub_plan["id"],
                    "slug": sub_plan["slug"],
                    "title": sub_plan["title"],
                    "required": declared[identity].get("required", True),
                    "plan": sub_source["planPath"].name,
                    "statusPage": sub_source["statusPath"].name,
                    "status": sub_status["status"],
                    "phase": sub_status["phase"],
                }
            )
        snapshots.append(
            {
                "id": plan["id"],
                "slug": plan["slug"],
                "title": plan["title"],
                "dependsOn": plan["dependsOn"],
                "plan": source["planPath"].name,
                "statusPage": source["statusPath"].name,
                "status": status["status"],
                "phase": status["phase"],
                "branch": status["branch"],
                "pr": status["pr"],
                "mergedAt": status["mergedAt"],
                "subtasks": subtasks,
            }
        )
    return sorted(snapshots, key=lambda item: natural_id_key(item["id"]))


def find_subtask_pairs(ticket_dir: Path) -> list[dict]:
    subtasks: list[dict] = []
    seen: set[tuple[Path, Path]] = set()
    for plan_path in sorted(ticket_dir.rglob("*_plan.html")):
        if plan_path.name in {"ticket_plan.html", "implementation_plan.html"}:
            continue
        status_path = plan_path.with_name(plan_path.name.removesuffix("_plan.html") + "_status.html")
        if not status_path.exists():
            continue
        key = (plan_path, status_path)
        if key in seen:
            continue
        seen.add(key)
        subtasks.append(
            {
                "shape": "subtask",
                "plan": str(plan_path),
                "status": str(status_path),
            }
        )
    return subtasks


def discover_tickets(sprint_dir: Path) -> list[dict]:
    tickets: list[dict] = []

    for program_index in sorted(sprint_dir.glob("*/index.html")):
        program = read_json(program_index, "program")
        validate_program_index(program_index, program)
        for ticket in program["tickets"]:
            tickets.append(
                {
                    "shape": "program-ticket",
                    "programSlug": program["slug"],
                    "programIndex": str(program_index),
                    "ticketSlug": ticket["slug"],
                    "plan": str(program_index.parent / ticket["plan"]),
                    "status": str(program_index.parent / ticket["statusPage"]),
                    "subtasks": [
                        {
                            "shape": "subtask",
                            "plan": str(program_index.parent / subtask["plan"]),
                            "status": str(program_index.parent / subtask["statusPage"]),
                        }
                        for subtask in ticket["subtasks"]
                    ],
                }
            )

    for ticket_plan in sorted(sprint_dir.glob("*/ticket_plan.html")):
        ticket_dir = ticket_plan.parent
        ticket_status = ticket_dir / "ticket_status.html"
        if not ticket_status.exists():
            continue
        tickets.append(
            {
                "shape": "ticket-folder",
                "ticketSlug": ticket_dir.name,
                "plan": str(ticket_plan),
                "status": str(ticket_status),
                "subtasks": find_subtask_pairs(ticket_dir),
            }
        )

    for ticket_path in sorted(sprint_dir.glob("*_ticket.html")):
        status_path = ticket_path.with_name(ticket_path.name.removesuffix("_ticket.html") + "_status.html")
        if status_path.exists():
            tickets.append(
                {
                    "shape": "legacy-ticket",
                    "ticketSlug": ticket_path.stem.removesuffix("_ticket"),
                    "plan": str(ticket_path),
                    "status": str(status_path),
                    "subtasks": [],
                }
            )

    legacy_plan = sprint_dir / "implementation_plan.html"
    legacy_status = sprint_dir / "implementation_status.html"
    if legacy_plan.exists() and legacy_status.exists():
        tickets.append(
            {
                "shape": "legacy-monolith",
                "ticketSlug": None,
                "plan": str(legacy_plan),
                "status": str(legacy_status),
                "subtasks": [],
            }
        )

    return tickets


def cmd_current_sprint(args: argparse.Namespace) -> None:
    print(current_sprint(Path(args.base)).as_posix())


def cmd_discover(args: argparse.Namespace) -> None:
    sprint_dir = current_sprint(Path(args.sprint_folder)) if args.current else Path(args.sprint_folder)
    if not sprint_dir.exists():
        raise SystemExit(f"missing sprint folder: {sprint_dir}")
    print(json.dumps(discover_tickets(sprint_dir), indent=2, sort_keys=False))


def json_arg(value: str, fallback):
    if not value:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError as exc:
        raise argparse.ArgumentTypeError(str(exc)) from exc


def ensure_list(value, label: str) -> list:
    if not isinstance(value, list):
        raise SystemExit(f"{label} must be a JSON list")
    return value


def write_page(page: Path, kind: str, template_name: str, data: dict, skill_dir: Path) -> None:
    page.write_text(load_template(skill_dir, template_name), encoding="utf-8")
    write_json(page, kind, data)


def resolve_program_dir(base_folder: str, program_slug: str) -> tuple[Path, Path, Path]:
    sprint_dir = current_sprint(Path(base_folder))
    require_safe_component(program_slug, "program slug")
    program_dir = sprint_dir / program_slug
    index_path = program_dir / "index.html"
    if not index_path.is_file():
        raise SystemExit(
            f"missing program index: {index_path}; create it with bootstrap-program before adding tickets"
        )
    return sprint_dir, program_dir, index_path


def refresh_program_index(index_path: Path, updated: str) -> dict:
    program = read_json(index_path, "program")
    if program.get("kind") != "program":
        raise SystemExit(f"{index_path}: program index kind must be 'program'")
    tickets = scan_program_pages(index_path.parent)
    program["updated"] = updated
    program["ticketOrder"] = [ticket["id"] for ticket in tickets]
    program["tickets"] = tickets
    program["rollup"] = {
        "tickets": summarize_states(tickets),
        "subtasks": summarize_states(
            [subtask for ticket in tickets for subtask in ticket["subtasks"]]
        ),
    }
    write_json(index_path, "program", program)
    validate_program_index(index_path, program)
    return program


def cmd_bootstrap_program(args: argparse.Namespace) -> None:
    sprint_dir = current_sprint(Path(args.base_folder))
    require_safe_component(args.program_slug, "program slug")
    canonical_id(args.id, "program id")
    program_dir = sprint_dir / args.program_slug
    index_path = program_dir / "index.html"
    if program_dir.exists() and any(program_dir.iterdir()):
        raise SystemExit(f"refusing to overwrite non-empty program folder: {program_dir}")
    skill_dir = Path(args.skill_dir).expanduser().resolve()
    today = args.date or dt.date.today().isoformat()
    program_dir.mkdir(parents=True, exist_ok=True)
    data = {
        "kind": "program",
        "sprint": sprint_dir.as_posix(),
        "id": args.id,
        "slug": args.program_slug,
        "title": args.title,
        "goal": args.goal,
        "updated": today,
        "ticketOrder": [],
        "tickets": [],
        "rollup": {"tickets": empty_rollup(), "subtasks": empty_rollup()},
        "generatedFrom": f"{today} by $loop-engineering",
    }
    write_page(index_path, "program", "program_index.template.html", data, skill_dir)
    validate_program_index(index_path, data)
    print(f"created {index_path}")


def cmd_refresh_index(args: argparse.Namespace) -> None:
    index_path = Path(args.program_folder) / "index.html"
    if not index_path.is_file():
        raise SystemExit(f"missing program index: {index_path}")
    today = args.date or dt.date.today().isoformat()
    program = refresh_program_index(index_path, today)
    print(f"refreshed {index_path} ({len(program['tickets'])} tickets)")


def normalize_subtasks(args: argparse.Namespace) -> list[dict]:
    raw = ensure_list(json_arg(args.subtasks_json, []), "--subtasks-json")
    if not raw:
        raw = [
            {
                "id": f"{args.id}-ST1",
                "slug": "implementation",
                "title": args.title,
                "goal": args.goal,
                "surfaces": json_arg(args.surfaces_json, []),
                "acceptance": json_arg(args.acceptance_json, []),
                "outOfScope": [],
            }
        ]
    normalized = []
    seen_ids: set[str] = set()
    seen_stems: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            raise SystemExit("each subtask must be a JSON object")
        for key in ("id", "slug", "title"):
            if key not in item:
                raise SystemExit(f"subtask is missing {key!r}: {item}")
        stem = expected_page_name(item["id"], item["slug"], "subtask")
        if item["id"] in seen_ids:
            raise SystemExit(f"duplicate subtask id: {item['id']!r}")
        if stem in seen_stems:
            raise SystemExit(f"duplicate subtask filename stem: {stem!r}")
        seen_ids.add(item["id"])
        seen_stems.add(stem)
        normalized.append(
            {
                "id": item["id"],
                "slug": item["slug"],
                "title": item["title"],
                "goal": item.get("goal", item["title"]),
                "surfaces": item.get("surfaces", json_arg(args.surfaces_json, [])),
                "acceptance": item.get("acceptance", []),
                "outOfScope": item.get("outOfScope", []),
                "required": item.get("required", True),
            }
        )
    return normalized


def cmd_bootstrap_ticket(args: argparse.Namespace) -> None:
    sprint_dir, program_dir, index_path = resolve_program_dir(args.base_folder, args.program)
    ticket_stem = expected_page_name(args.id, args.ticket_slug, "ticket")
    skill_dir = Path(args.skill_dir).expanduser().resolve()
    today = args.date or dt.date.today().isoformat()
    subtasks = normalize_subtasks(args)

    ticket_plan = program_dir / f"{ticket_stem}_plan.html"
    ticket_status = program_dir / f"{ticket_stem}_status.html"
    if ticket_plan.exists() or ticket_status.exists():
        raise SystemExit("refusing to overwrite existing ticket pages")
    for subtask in subtasks:
        subtask_stem = expected_page_name(subtask["id"], subtask["slug"], "subtask")
        if (program_dir / f"{subtask_stem}_plan.html").exists() or (
            program_dir / f"{subtask_stem}_status.html"
        ).exists():
            raise SystemExit(f"refusing to overwrite existing subtask pages for {subtask['slug']}")

    plan = {
        "kind": "ticket",
        "sprint": sprint_dir.as_posix(),
        "id": args.id,
        "slug": args.ticket_slug,
        "title": args.title,
        "goal": args.goal,
        "surfaces": json_arg(args.surfaces_json, []),
        "acceptance": json_arg(args.acceptance_json, []),
        "outOfScope": json_arg(args.out_of_scope_json, []),
        "dependsOn": json_arg(args.depends_on_json, []),
        "detailed": True,
        "subtasks": [
            {
                "id": subtask["id"],
                "slug": subtask["slug"],
                "title": subtask["title"],
                "required": subtask["required"],
            }
            for subtask in subtasks
        ],
        "generatedFrom": f"{today} by $loop-engineering",
        "record": None,
    }
    status = {
        "kind": "ticket",
        "sprint": sprint_dir.as_posix(),
        "id": args.id,
        "slug": args.ticket_slug,
        "title": args.title,
        "updated": today,
        "status": "todo",
        "phase": None,
        "branch": None,
        "pr": None,
        "mergedAt": None,
        "note": None,
        "log": [],
        "ledger": [],
    }
    validate_ticket_plan(ticket_plan, plan)
    validate_ticket_status(ticket_status, status)
    write_page(ticket_plan, "plan", "ticket_plan.template.html", plan, skill_dir)
    write_page(ticket_status, "status", "ticket_status.template.html", status, skill_dir)

    for subtask in subtasks:
        subtask_stem = expected_page_name(subtask["id"], subtask["slug"], "subtask")
        plan_path = program_dir / f"{subtask_stem}_plan.html"
        status_path = program_dir / f"{subtask_stem}_status.html"
        subtask_plan = {
            "kind": "subtask",
            "sprint": sprint_dir.as_posix(),
            "ticketId": args.id,
            "ticketSlug": args.ticket_slug,
            "id": subtask["id"],
            "slug": subtask["slug"],
            "title": subtask["title"],
            "goal": subtask["goal"],
            "surfaces": subtask["surfaces"],
            "acceptance": subtask["acceptance"],
            "outOfScope": subtask["outOfScope"],
            "detailed": True,
            "generatedFrom": f"{today} by $loop-engineering",
            "record": None,
        }
        subtask_status = {
            "kind": "subtask",
            "sprint": sprint_dir.as_posix(),
            "ticketId": args.id,
            "ticketSlug": args.ticket_slug,
            "id": subtask["id"],
            "slug": subtask["slug"],
            "title": subtask["title"],
            "updated": today,
            "status": "todo",
            "phase": None,
            "note": None,
            "log": [],
            "ledger": [],
        }
        validate_subtask_plan(plan_path, subtask_plan)
        validate_subtask_status(status_path, subtask_status)
        write_page(plan_path, "plan", "subtask_plan.template.html", subtask_plan, skill_dir)
        write_page(status_path, "status", "subtask_status.template.html", subtask_status, skill_dir)

    refresh_program_index(index_path, today)

    print(f"created {ticket_plan}")
    print(f"created {ticket_status}")
    for subtask in subtasks:
        subtask_stem = expected_page_name(subtask["id"], subtask["slug"], "subtask")
        print(f"created {program_dir / (subtask_stem + '_plan.html')}")
        print(f"created {program_dir / (subtask_stem + '_status.html')}")


def cmd_bootstrap_subtask(args: argparse.Namespace) -> None:
    sprint_dir, program_dir, index_path = resolve_program_dir(args.base_folder, args.program)
    ticket_stem = expected_page_name(args.ticket_id, args.ticket_slug, "ticket")
    subtask_stem = expected_page_name(args.id, args.subtask_slug, "subtask")
    skill_dir = Path(args.skill_dir).expanduser().resolve()
    today = args.date or dt.date.today().isoformat()
    ticket_plan_path = program_dir / f"{ticket_stem}_plan.html"
    if not ticket_plan_path.is_file():
        raise SystemExit(f"missing parent ticket plan: {ticket_plan_path}")
    ticket_plan = read_json(ticket_plan_path, "plan")
    validate_ticket_plan(ticket_plan_path, ticket_plan)
    if ticket_plan["id"] != args.ticket_id or ticket_plan["slug"] != args.ticket_slug:
        raise SystemExit(f"parent ticket identity does not match {args.ticket_id}/{args.ticket_slug}")
    if any(item["id"] == args.id or item["slug"] == args.subtask_slug for item in ticket_plan["subtasks"]):
        raise SystemExit("refusing to add a duplicate subtask id or slug to the parent ticket")

    plan_path = program_dir / f"{subtask_stem}_plan.html"
    status_path = program_dir / f"{subtask_stem}_status.html"
    if plan_path.exists() or status_path.exists():
        raise SystemExit("refusing to overwrite existing subtask pages")

    plan = {
        "kind": "subtask",
        "sprint": sprint_dir.as_posix(),
        "ticketId": args.ticket_id,
        "ticketSlug": args.ticket_slug,
        "id": args.id,
        "slug": args.subtask_slug,
        "title": args.title,
        "goal": args.goal,
        "surfaces": json_arg(args.surfaces_json, []),
        "acceptance": json_arg(args.acceptance_json, []),
        "outOfScope": json_arg(args.out_of_scope_json, []),
        "detailed": True,
        "generatedFrom": f"{today} by $loop-engineering",
        "record": None,
    }
    status = {
        "kind": "subtask",
        "sprint": sprint_dir.as_posix(),
        "ticketId": args.ticket_id,
        "ticketSlug": args.ticket_slug,
        "id": args.id,
        "slug": args.subtask_slug,
        "title": args.title,
        "updated": today,
        "status": "todo",
        "phase": None,
        "note": None,
        "log": [],
        "ledger": [],
    }

    validate_subtask_plan(plan_path, plan)
    validate_subtask_status(status_path, status)
    write_page(plan_path, "plan", "subtask_plan.template.html", plan, skill_dir)
    write_page(status_path, "status", "subtask_status.template.html", status, skill_dir)
    ticket_plan["subtasks"].append(
        {"id": args.id, "slug": args.subtask_slug, "title": args.title, "required": True}
    )
    write_json(ticket_plan_path, "plan", ticket_plan)
    refresh_program_index(index_path, today)
    print(f"created {plan_path}")
    print(f"created {status_path}")


def cmd_bootstrap(args: argparse.Namespace) -> None:
    """Legacy monolithic bootstrap retained only for old sprint folders."""
    sprint_dir = Path(args.sprint_folder)
    sprint_dir.mkdir(parents=True, exist_ok=True)
    skill_dir = Path(args.skill_dir).expanduser().resolve()
    today = args.date or dt.date.today().isoformat()
    tasks = json.loads(Path(args.tasks_json).read_text(encoding="utf-8")) if args.tasks_json else []

    plan = {
        "sprint": args.sprint_folder,
        "title": args.title or "Sprint plan",
        "description": args.description or "",
        "generatedFrom": f"{today} by $loop-engineering",
        "tasks": tasks,
    }
    status = {
        "updated": today,
        "currentCycle": None,
        "tasks": {
            task["id"]: {
                "status": "todo",
                "phase": None,
                "branch": None,
                "pr": None,
                "mergedAt": None,
                "note": None,
            }
            for task in tasks
        },
        "log": [],
        "ledger": [],
    }

    plan_path = sprint_dir / "implementation_plan.html"
    status_path = sprint_dir / "implementation_status.html"
    if plan_path.exists() or status_path.exists():
        raise SystemExit("refusing to overwrite existing plan/status pages")

    write_page(plan_path, "plan", "implementation_plan.template.html", plan, skill_dir)
    write_page(status_path, "status", "implementation_status.template.html", status, skill_dir)
    print(f"created {plan_path}")
    print(f"created {status_path}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    extract = sub.add_parser("extract", help="print embedded JSON")
    extract.add_argument("kind", choices=["program", "plan", "status"])
    extract.add_argument("page")
    extract.set_defaults(func=cmd_extract)

    replace = sub.add_parser("replace", help="replace embedded JSON from a file")
    replace.add_argument("kind", choices=["program", "plan", "status"])
    replace.add_argument("page")
    replace.add_argument("json_file")
    replace.set_defaults(func=cmd_replace)

    validate = sub.add_parser("validate", help="validate page JSON shape")
    validate.add_argument("kind", choices=["program", "plan", "status"])
    validate.add_argument("page")
    validate.set_defaults(func=cmd_validate)

    current = sub.add_parser("current-sprint", help="print the current sprint folder")
    current.add_argument("base", nargs="?", default="docs/sprints")
    current.set_defaults(func=cmd_current_sprint)

    discover = sub.add_parser("discover", help="list tickets in a sprint folder")
    discover.add_argument("sprint_folder")
    discover.add_argument("--current", action="store_true", help="resolve argument to current max sprint first")
    discover.set_defaults(func=cmd_discover)

    bootstrap_program = sub.add_parser(
        "bootstrap-program", help="create one indexed program folder in the current sprint"
    )
    bootstrap_program.add_argument("base_folder", help="repo root, docs/sprints, or a sprint_x folder")
    bootstrap_program.add_argument("program_slug")
    bootstrap_program.add_argument("--id", required=True)
    bootstrap_program.add_argument("--title", required=True)
    bootstrap_program.add_argument("--goal", required=True)
    bootstrap_program.add_argument("--skill-dir", default=str(Path(__file__).resolve().parents[1]))
    bootstrap_program.add_argument("--date", default="")
    bootstrap_program.set_defaults(func=cmd_bootstrap_program)

    refresh_index = sub.add_parser(
        "refresh-index", help="rebuild a program index from authoritative flat plan/status pairs"
    )
    refresh_index.add_argument("program_folder")
    refresh_index.add_argument("--date", default="")
    refresh_index.set_defaults(func=cmd_refresh_index)

    bootstrap_ticket = sub.add_parser(
        "bootstrap-ticket", help="create one flat ticket and its subtasks inside a program folder"
    )
    bootstrap_ticket.add_argument("base_folder", help="repo root, docs/sprints, or a sprint_x folder")
    bootstrap_ticket.add_argument("ticket_slug")
    bootstrap_ticket.add_argument("--program", required=True, help="existing program folder slug")
    bootstrap_ticket.add_argument("--id", required=True)
    bootstrap_ticket.add_argument("--title", required=True)
    bootstrap_ticket.add_argument("--goal", required=True)
    bootstrap_ticket.add_argument("--surfaces-json", default="[]")
    bootstrap_ticket.add_argument("--acceptance-json", default="[]")
    bootstrap_ticket.add_argument("--depends-on-json", default="[]")
    bootstrap_ticket.add_argument("--out-of-scope-json", default="[]")
    bootstrap_ticket.add_argument("--subtasks-json", default="[]")
    bootstrap_ticket.add_argument("--skill-dir", default=str(Path(__file__).resolve().parents[1]))
    bootstrap_ticket.add_argument("--date", default="")
    bootstrap_ticket.set_defaults(func=cmd_bootstrap_ticket)

    bootstrap_subtask = sub.add_parser(
        "bootstrap-subtask", help="create one flat subtask pair inside an existing program folder"
    )
    bootstrap_subtask.add_argument("base_folder", help="repo root, docs/sprints, or a sprint_x folder")
    bootstrap_subtask.add_argument("ticket_slug")
    bootstrap_subtask.add_argument("subtask_slug")
    bootstrap_subtask.add_argument("--program", required=True, help="existing program folder slug")
    bootstrap_subtask.add_argument("--ticket-id", required=True)
    bootstrap_subtask.add_argument("--id", required=True)
    bootstrap_subtask.add_argument("--title", required=True)
    bootstrap_subtask.add_argument("--goal", required=True)
    bootstrap_subtask.add_argument("--surfaces-json", default="[]")
    bootstrap_subtask.add_argument("--acceptance-json", default="[]")
    bootstrap_subtask.add_argument("--out-of-scope-json", default="[]")
    bootstrap_subtask.add_argument("--skill-dir", default=str(Path(__file__).resolve().parents[1]))
    bootstrap_subtask.add_argument("--date", default="")
    bootstrap_subtask.set_defaults(func=cmd_bootstrap_subtask)

    bootstrap = sub.add_parser("bootstrap", help="legacy: create monolithic implementation pages")
    bootstrap.add_argument("sprint_folder")
    bootstrap.add_argument("--skill-dir", default=str(Path(__file__).resolve().parents[1]))
    bootstrap.add_argument("--title", default="")
    bootstrap.add_argument("--description", default="")
    bootstrap.add_argument("--tasks-json", default="")
    bootstrap.add_argument("--date", default="")
    bootstrap.set_defaults(func=cmd_bootstrap)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
