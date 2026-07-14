---
name: loop-engineering
description: Run a Codex-native sprint loop-engineering cycle from docs/sprints/sprint_x program folders. Use when the user asks to run, resume, map, or maintain a loop-engineering sprint; group related tickets in one indexed feature/program folder with flat ticket and subtask plan/status pages, while preserving one branch, one PR, and one risk-gated merge per ticket. Also use when adapting Claude loop-engineering configuration such as .claude/loop-engineering.json for Codex.
---

# Loop Engineering

Run a self-contained implementation loop that keeps durable sprint state in HTML pages, proves each ticket against an explicit contract, and pauses instead of guessing on real ambiguity or high-risk merge decisions.

This is the Codex mapping of Jeremy's Claude `loop-engineering` workflow. Preserve the safety model, but use Codex tools and repository instructions instead of Claude Workflow scripts.

## Inputs

Expected request shape:

```text
Use $loop-engineering [sprintFolder] [sprint description...] [program=<slug>] [dryRun] [ticket=<slug-or-id>] [subtask=<slug-or-id>] [max=<N>]
```

- `sprintFolder`: repo-relative or absolute sprint folder. New work uses `docs/sprints/sprint_x`.
- If no `sprintFolder` is supplied, use the current sprint: highest-numbered `docs/sprints/sprint_x`; if none exists, use `docs/sprints/sprint_0`.
- Sprint description: required only when bootstrapping missing tracking pages.
- `program=<slug>`: select the indexed feature/program folder that groups the related tickets. Ask only when the sprint contains multiple programs and the request does not identify one.
- `dryRun`: create or prepare the PR and stop before merge.
- `ticket=<slug-or-id>`: process one specific ticket if its dependencies are done.
- `subtask=<slug-or-id>`: focus the implementation inside a ticket, but the ticket still branches, validates, PRs, and merges as a whole.
- `max=<N>`: process at most N tickets this invocation. Default to one ticket unless the user explicitly asks to drain the sprint.

If the user asks for a single non-sprint coding change, do normal Codex work instead. Use this skill only when the loop/tracking workflow is requested or already present.

## Source Layout

New work uses exactly one indexed feature/program folder for each related body of work. When the user calls the whole feature
or large product item a “ticket,” that parent item owns the one folder; internal implementation tickets do not get
folders. Ticket and subtask pages are flat files inside that single folder; never create nested ticket or subtask
folders in the preferred format:

```text
docs/sprints/sprint_x/
  feature_program_slug/
    index.html
    sx-t1-ticket_slug_plan.html
    sx-t1-ticket_slug_status.html
    sx-t1-st1-subtask_slug_plan.html
    sx-t1-st1-subtask_slug_status.html
    sx-t2-another_ticket_plan.html
    sx-t2-another_ticket_status.html
```

Rules:

- A ticket is one git branch, one PR, and one risk-gated merge.
- A program folder groups related tickets for navigation and traceability; it does not collapse their independent statuses, branches, PRs, or merge gates.
- Branch and PR boundaries never create documentation folders.
- `index.html` is required. It traces every ticket, dependency, status, and subtask, and links to every plan/status page. Ticket and subtask pages remain authoritative; run `scripts/loop_pages.py refresh-index` after their status changes.
- Filenames are deterministic and collision-resistant: `{ticket-id-lower}-{ticket-slug}_{plan|status}.html` and `{subtask-id-lower}-{subtask-slug}_{plan|status}.html`.
- `dependsOn` references other ticket IDs. Subtasks do not gate other tickets directly.
- Subtasks are scoped plan/status evidence inside the ticket; they do not create separate branches or PRs.
- New bootstraps always add or reuse one program folder in the current max sprint folder. Do not create `sprint_(max+1)` unless the user explicitly asks to start a new sprint.
- Bootstrap the program index first, then create each ticket and at least one subtask plan/status pair inside it. Do not create new ticket directories or monolithic `implementation_plan.html` / `implementation_status.html` pages.
- Legacy layouts are still readable but must not be used for new work:
  - Ticket folders containing `ticket_plan.html`, `ticket_status.html`, and flat or nested subtask pairs.
  - Flat per-ticket pairs: `{slug}_ticket.html` plus `{slug}_status.html`; treat each as one ticket with one synthetic subtask.
  - Monolithic pairs: `implementation_plan.html` plus `implementation_status.html`; use only as a fallback for old sprints.

## Load Order

1. Read repo instructions first: `AGENTS.md`, `CLAUDE.md` when present, and any files named in the project config's `project.readFirst`.
2. Read project config:
   - Prefer `.codex/loop-engineering.json` when present.
   - Otherwise read `.claude/loop-engineering.json` and translate it in memory.
   - If neither exists, read [references/config.md](references/config.md), inspect the repo, draft `.codex/loop-engineering.json`, and ask the user before writing it.
3. Resolve the sprint folder:
   - Use the requested sprint folder when supplied.
   - Otherwise inspect `docs/sprints/sprint_*`; use the highest numeric suffix.
   - If no `docs/sprints/sprint_*` exists, use `docs/sprints/sprint_0`.
4. Discover pages in this order:
   - Preferred program folders: `index.html` plus direct-child, ID-prefixed ticket/subtask `*_plan.html` / `*_status.html` pairs. Read `program-data` first for order and traceability, then verify every entry against the authoritative plan/status page.
   - Legacy ticket folders: `ticket_plan.html` plus `ticket_status.html`, with recursive subtask `*_plan.html` / `*_status.html` pairs.
   - Legacy flat `{slug}_ticket.html` plus `{slug}_status.html`.
   - Legacy `implementation_plan.html` plus `implementation_status.html`.
5. Extract only the JSON in:
   - `<script id="program-data" type="application/json">` for a preferred program index.
   - `<script id="plan-data" type="application/json">` for new ticket/subtask plans.
   - `<script id="ticket-data" type="application/json">` for legacy flat ticket plans.
   - `<script id="status-data" type="application/json">` for status pages.

Use `scripts/loop_pages.py` for JSON extraction, updates, validation, discovery, and bootstrapping. Read or patch the script only if it does not fit the repository.

## Page Contract

Edit only the embedded JSON script blocks, never hand-edit rendered HTML.

Preferred program index (derived by `refresh-index`; do not hand-maintain ticket snapshots):

```json
{
  "kind": "program",
  "sprint": "docs/sprints/sprint_x",
  "id": "SX-P1",
  "slug": "feature_program_slug",
  "title": "program title",
  "goal": "one-sentence program goal",
  "updated": "YYYY-MM-DD",
  "ticketOrder": ["SX-T1"],
  "tickets": [
    {
      "id": "SX-T1",
      "slug": "ticket_slug",
      "title": "ticket title",
      "dependsOn": [],
      "plan": "sx-t1-ticket_slug_plan.html",
      "statusPage": "sx-t1-ticket_slug_status.html",
      "status": "todo",
      "phase": null,
      "branch": null,
      "pr": null,
      "mergedAt": null,
      "subtasks": []
    }
  ],
  "rollup": {
    "tickets": { "total": 1, "todo": 1, "in_progress": 0, "blocked": 0, "done": 0 },
    "subtasks": { "total": 0, "todo": 0, "in_progress": 0, "blocked": 0, "done": 0 }
  }
}
```

Preferred ticket plan:

```json
{
  "kind": "ticket",
  "sprint": "docs/sprints/sprint_x",
  "id": "SX-T1",
  "slug": "ticket_name_folder",
  "title": "short ticket title",
  "goal": "one-sentence ticket goal",
  "surfaces": ["api", "web"],
  "acceptance": ["ticket-level criterion"],
  "outOfScope": [],
  "dependsOn": [],
  "detailed": true,
  "subtasks": [
    { "id": "SX-T1-ST1", "slug": "subtask_slug", "title": "short subtask title", "required": true }
  ],
  "generatedFrom": "YYYY-MM-DD by $loop-engineering",
  "record": null
}
```

Preferred ticket status:

```json
{
  "kind": "ticket",
  "sprint": "docs/sprints/sprint_x",
  "id": "SX-T1",
  "slug": "ticket_name_folder",
  "title": "short ticket title",
  "updated": "YYYY-MM-DD",
  "status": "todo",
  "phase": null,
  "branch": null,
  "pr": null,
  "mergedAt": null,
  "note": null,
  "log": [],
  "ledger": []
}
```

Preferred subtask plan:

```json
{
  "kind": "subtask",
  "sprint": "docs/sprints/sprint_x",
  "ticketId": "SX-T1",
  "ticketSlug": "ticket_name_folder",
  "id": "SX-T1-ST1",
  "slug": "subtask_slug",
  "title": "short subtask title",
  "goal": "one-sentence subtask goal",
  "surfaces": ["api", "web"],
  "acceptance": ["subtask criterion"],
  "outOfScope": [],
  "detailed": true,
  "generatedFrom": "YYYY-MM-DD by $loop-engineering",
  "record": null
}
```

Preferred subtask status:

```json
{
  "kind": "subtask",
  "sprint": "docs/sprints/sprint_x",
  "ticketId": "SX-T1",
  "ticketSlug": "ticket_name_folder",
  "id": "SX-T1-ST1",
  "slug": "subtask_slug",
  "title": "short subtask title",
  "updated": "YYYY-MM-DD",
  "status": "todo",
  "phase": null,
  "note": null,
  "log": [],
  "ledger": []
}
```

Statuses are `todo`, `in_progress`, `blocked`, and `done`.

## Ticket Selection

Build the ready queue from discovered ticket pages across the selected program folder, optionally filtered by `ticket=`.

Pick the next ticket whose ticket status is `todo`, whose ticket-level `dependsOn` tickets are `done`, and whose ticket plan is detailed.

Pause and ask when:

- The ticket is a scaffold (`detailed:false`) or lacks acceptance criteria.
- `ticket=<slug-or-id>` names a ticket whose dependencies are not done.
- No ticket is ready.
- The config has missing or contradictory commands, branches, or safety rules.

When starting a ticket, honor an explicit `git.branchPrefix` from the selected project config. Use
`codex/<ticket-id-lowercase>` only when no prefix is configured. Update the ticket status page to `in_progress` with
`phase:"recon"` and the branch name. Mark subtasks `in_progress` / `done` / `blocked` as internal checkpoints, but
never put branch, PR, or merge state on a subtask.

## Per-Ticket Workflow

Carry out these phases in order. Keep the work scoped to the ticket and preserve build-green increments where practical. Use the subtask files as the ticket's internal checklist and evidence trail.

### 1. Recon

Read the configured `project.readFirst` docs, then inspect the code touched by the ticket and its subtasks. Use `rg` and parallel file reads. Capture concrete facts with file references:

- Current behavior and target behavior.
- API/router/surface boundaries.
- Data model and persistence paths.
- Existing tests, fixtures, and validation commands.
- Project invariants from the config and docs.

For HeyApril, treat `docs/architecture/architecture.html` and `docs/architecture/data-model.html` as source of truth when present, and honor the AGENTS/CLAUDE rules around RLS, `applyChange()`, soft-delete, and separate staff/client/admin surfaces.

### 2. Design Contract

Write the ticket-level "done" contract before code:

- `summary`
- `core`
- `dataModel`
- `surfaces`
- `subtasks`
- `stages`
- `acceptanceCriteria`, each with a concrete verification method
- `testPlan` for API, database, and UI where relevant
- `risks`
- `outOfScope`
- `openQuestions`

Do not code through a material ambiguity. Ask the user before coding if the contract depends on a product/scope/security decision.

For UI surfaces, include state legibility, empty/loading/error/success/edge states, expected copy, accessibility expectations, and mandatory browser verification with screenshots in the acceptance criteria.

### 3. Technical Spec

Convert the contract into file-level implementation instructions:

- Exact files to add/modify/delete.
- API contracts or public function signatures.
- Schema/persistence changes.
- Ordered sequencing.
- Edge cases and error handling.
- Tests to author and commands to run.
- Docs to update.

If the spec reveals a real ambiguity, ask before coding.

### 4. Clean-Cutover Implementation

Plan drift before editing:

- Identify stale or conflicting code this ticket replaces.
- Remove obsolete code as part of the ticket. Do not leave dual paths, compatibility shims, or dead code unless the ticket explicitly requires them.
- Pair deletion with replacement in the same stage when a pure deletion would break typecheck.

Implement with `apply_patch` for manual edits. Preserve unrelated user changes.

### 5. Validation

Design the test matrix before writing tests. Include happy, negative, and edge cases for each relevant channel:

- API behavior: success, validation errors, auth/surface errors.
- Database/results: resulting rows, audit/change-log entries, soft-delete behavior, deterministic ordering, tenant isolation.
- UI: user-visible behavior plus resulting data. For any user-facing UI change, Playwright/browser verification is mandatory, not optional.

#### UI Verification Gate

For any ticket that changes UI behavior, layout, navigation, visual states, forms, dashboards, modals, tables, or role/permission-dependent rendering:

- Start or reuse dev servers only after confirming they serve the current worktree. Do not trust an occupied localhost port until its process `cwd` and served source match the worktree.
- Use Playwright to drive the real workflow in a browser. Exercise the relevant roles, permissions, states, navigation, and resulting data; do not count API tests, component inspection, or static DOM checks as a substitute.
- Capture screenshots for every meaningful user-visible acceptance state, including at least the main changed UI and any clicked/navigated target state. Inspect screenshots for blank pages, wrong checkout/port, occlusion, missing labels, and broken layout.
- Include screenshot paths or artifacts in the handoff/final evidence. If UI verification cannot run, treat the ticket as incomplete or blocked and explain exactly why.

Then author and run the tests. Loop on implementation defects until green or until the configured fix cap is reached. Never weaken tests, skip tests, loosen CI, or add success-shaped fallbacks just to pass.

Run configured static checks. For HeyApril, use the repo's commands from `AGENTS.md` and `.claude/loop-engineering.json`, such as package-local typecheck, `pnpm lint`, and API Vitest when touched.

### 6. Docs

Update only documentation made stale by the ticket. Keep architecture/data-model docs aligned with code; if code and design docs disagree, treat it as a regression or an explicit design change that must be reconciled.

### 7. Clean-Room Review

Before declaring success, review the staged diff as an independent reviewer:

- Judge each acceptance criterion against the actual diff and test output.
- Check test breadth is not happy-path-only.
- Check invariants and resulting data, not just code shape.
- Search for `.skip`, `.only`, deleted assertions, loosened protected paths, and CI/test weakening.
- Classify high-risk changes.

High-risk changes include schema/migrations/RLS, auth, billing/money, infra/deploy/workflows, loop config/tracking files, and any file deletion unless the user has explicitly approved unattended merge for that ticket.

## PR And Merge Policy

Do not auto-merge unless every condition is true:

- The whole ticket is verified against all ticket and required subtask acceptance criteria.
- Tests and static checks are green.
- No test tampering is present.
- Any UI accessibility gate is acceptable.
- CI is green when required.
- The diff is low-risk.
- There are no unresolved open questions.

Otherwise, stop with evidence and a clear recommendation.

When the user asks to publish:

1. Commit intentionally, respecting hooks.
2. Push the branch.
3. Open a draft PR against the configured base branch by default.
4. Use the GitHub app when available; use `gh` only as a fallback.

After a merge or completed dry run, update the ticket-level pages and any touched subtask pages:

- Ticket plan `record`: PR, date, design, tech spec, and subtask summary.
- Ticket status: `done` or `blocked`, PR/date/note.
- Ticket status `log`: one concise event.
- Ticket status `ledger`: defects and fixes that future tickets should not repeat.
- Subtask statuses: mark completed subtasks `done`; leave deferred subtasks with a clear note.
- Refresh and validate the containing `index.html` so its ticket/subtask links and rollups match the authoritative pages.

## Resources

- [references/config.md](references/config.md): Codex loop-engineering config schema and translation notes from Claude config.
- `scripts/loop_pages.py`: extract, validate, discover, bootstrap, and replace ticket/subtask JSON script blocks.
- `assets/templates/program_index.template.html`: self-rendering program index and rollup page.
- `assets/templates/ticket_plan.template.html`: self-rendering ticket overview page.
- `assets/templates/ticket_status.template.html`: self-rendering ticket status page.
- `assets/templates/subtask_plan.template.html`: self-rendering subtask plan page.
- `assets/templates/subtask_status.template.html`: self-rendering subtask status page.
- Legacy templates remain for old monolithic sprint folders only.
