---
name: loop-engineering
description: Project-agnostic Claude Code sprint loop-engineering cycle. Group one parent feature or large product ticket in exactly one indexed folder under `docs/sprints/sprint_N`; keep all internal implementation-ticket and subtask plan/status pages flat inside it. Each implementation ticket remains one branch, one PR, and one risk-gated merge. Generate or resume the pages, run design → technical spec → code → validation → docs → independent review, and pause on genuine ambiguity or high-risk merge decisions.
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, Workflow, AskUserQuestion
---

You are running the **loop-engineering cycle** — a self-driving sprint loop. You operate on a **numbered sprint folder**
(`<sprintsRoot>/sprint_N`, auto-resolved to the current sprint). One related parent feature or large product ticket gets
exactly one direct **feature/program folder** under that sprint. All internal implementation-ticket and subtask
plan/status pages are flat files inside it, traced by one `index.html`; never create nested ticket or subtask folders.
Then repeatedly pull the next ready implementation ticket, build it (design → technical spec → code → validate → docs),
prove it, and — after an independent clean-room review + green CI — risk-gate its merge, update the flat pages and
program index, and move to the next ticket. **The internal implementation ticket is the merge unit** (one branch, one
PR, one merge); its subtasks ship inside that PR. Documentation folders never follow branch or PR boundaries.

**Ask freely — it is never a failure.** Autonomy is the goal, but at ANY step (bootstrap, plan generation, design,
technical spec, coding, test design, validation, review) if something is genuinely ambiguous, or is a product/scope
decision that is the human's to make, STOP and ask via AskUserQuestion rather than guess. The engine itself can pause
*before writing code* and hand its open questions back to you (`report.needsHuman`) — relay them. A good question beats
a confident wrong guess.

The loop is grounded in verified best practice for long-running agent loops: an explicit "done" contract before any
code; an *independent* evaluator that never sees the coder's reasoning; external state (git + the per-ticket/subtask HTML
pages) carried across context resets (each ticket is a fresh Workflow run); loop-until-green with iteration caps; and
hard guardrails against false-completion and test-gaming.

## Arguments

`/loop-engineering [sprintsRootOrFolder] [sprint description…]`

- **`sprintsRootOrFolder`** (optional, first token IF it looks like a path) — how to locate the sprint:
  - **omitted** → use the config's `tracking.sprintsRoot` (default `docs/sprints`) as the root and auto-resolve the
    current sprint (see Step 1).
  - **a sprints *root*** (a dir that holds — or will hold — `sprint_*` subfolders, e.g. `docs/sprints`) → auto-resolve
    the current sprint within it.
  - **a specific *sprint* folder** (e.g. `docs/sprints/sprint_3`) → target exactly that sprint (override; no
    resolution).
- **sprint description** (the rest of the line) — free text describing what the sprint should deliver. **Required only
  when bootstrapping** a sprint that has no tickets yet; ignored when resuming (the ticket files are the source of truth).
- **`dryRun`** (flag, anywhere in the args) — open each PR and **stop** (no merge). Recommended for the first run on a
  new project so a human can watch one full cycle before trusting auto-merge.
- **`taskId=<ID>`** (optional) — force a specific ticket instead of next-by-dependency.
- **`max=<N>`** (optional) — process at most N tickets this invocation. Default: **one ticket**. Drain multiple tickets
  only when the human explicitly requests it.

## Step 0 · Load the project config (once per invocation)

Project-level facts live in **`.claude/loop-engineering.json`** at the repo root (NOT in the sprint folder). The full
schema is in `CONFIG.md` next to this skill (read it whenever you create or edit a config); `examples/example.json` is
a complete worked example.

- **Config exists** → read it. It supplies: base branch, lint/typecheck/test commands, infra to start, the
  UI/API/database test channels, the docs to keep in sync, the `tracking.sprintsRoot` (default `docs/sprints`), and the
  `project` object passed verbatim to the engine.
- **No config (first run on this project)** → bootstrap one:
  1. Inspect the repo: `CLAUDE.md`/`README.md`, `package.json` scripts (or Makefile/justfile), CI workflow files,
     docker-compose, test layout (where API/DB tests + Playwright specs live). Derive base branch, commands, infra, UI
     surfaces, the three test channels, candidate project rules, the docs set, and the sprints root.
  2. Draft the config per `CONFIG.md`.
  3. **Show the draft to the human and confirm via AskUserQuestion before writing.** Bad commands or a wrong base
     branch poison every later cycle. Write the file only after confirmation.

## Step 1 · Resolve the sprint + its tickets (once per invocation)

**1a · Fresh-base gate (before sprint discovery or ticket crafting).** Read only the configured `git.baseBranch`
(default `develop`), record `git status --short --branch`, and run `git fetch --prune origin`. If the worktree is clean
and the local base has no local-only commits, switch to it and run `git pull --ff-only origin <git.baseBranch>`. If the
tree is dirty or the local base has diverged, preserve it — never reset, stash, or merge it automatically — and create
or use a clean ticket branch/worktree directly from `origin/<git.baseBranch>`. Tell the human what local state was
preserved. Verify the ticket base is not behind the remote, then reload repo instructions/config/design docs from that
updated tree. **Never resolve the current sprint or craft ticket pages from pre-fetch state.**

**1b · Resolve the sprint folder (numbering).** Determine the sprints root: the explicit path arg if it is a sprints
root, else `tracking.sprintsRoot` (default `docs/sprints`). If the arg is instead a *specific* `sprint_*` folder, use it
directly and skip the rest of 1b. Otherwise:
- `ls -d <root>/sprint_*/ 2>/dev/null` and parse the integer suffix of each. **If any exist, the current sprint is the
  one with the highest N** (`<root>/sprint_<max>`). **If none exist, the current sprint is `<root>/sprint_0`.**
- **Bootstrap and resume BOTH target this current (max, or 0) sprint** — never auto-create `sprint_<max+1>`. To start a
  brand-new sprint, the human creates `<root>/sprint_<N+1>` (or passes it explicitly); only then does it become the max.

**1c · The canonical sprint layout.** In product conversation, “ticket” may mean the whole large feature. Resolve that
ambiguity in favor of the user's folder model:

```text
docs/sprints/sprint_N/
  feature_program_slug/
    index.html
    sN-t1-ticket_slug_plan.html
    sN-t1-ticket_slug_status.html
    sN-t1-st1-subtask_slug_plan.html
    sN-t1-st1-subtask_slug_status.html
    sN-t2-another_ticket_plan.html
    sN-t2-another_ticket_status.html
```

- One parent feature or large product ticket gets **exactly one direct feature/program folder** under the sprint.
- Every internal implementation-ticket and subtask page is a **flat direct child** of that folder. Never create nested
  ticket or subtask directories.
- `index.html` traces every implementation ticket, dependency, status, branch, PR, merge, and subtask. The individual
  plan/status pages remain authoritative; refresh the index after their state changes.
- Filenames are deterministic and collision-resistant:
  `{ticket-id-lower}-{ticket-slug}_{plan|status}.html` and
  `{subtask-id-lower}-{subtask-slug}_{plan|status}.html`.
- One internal implementation ticket is still one branch, one PR, and one risk-gated merge. Subtasks never create
  their own branches or PRs. Branch and PR boundaries never create documentation folders.
- New work must use this layout. Legacy ticket-folder, flat-ticket, and monolithic sprint layouts remain readable but
  must not be copied into new work or reorganized unless the user explicitly asks for a migration.

**1d · Resume vs bootstrap.** Use `scripts/loop_pages.py` for extraction, validation, discovery, bootstrapping, and
index refreshes; do not hand-edit rendered HTML.

- **A direct child has `index.html` with `program-data` → RESUME.** Validate its index, discover its authoritative flat
  ticket/subtask pairs, and continue from the next ready implementation ticket. If multiple program folders exist and
  the request does not identify one, ask which program to use.
- **Only a legacy layout exists → RESUME READABLY.** The helper recognizes legacy ticket-folder, flat-ticket, and
  monolithic pages. Do not create more legacy-shaped pages and do not silently migrate them.
- **The requested feature/program is missing → BOOTSTRAP, then run autonomously:**
  1. Create or resolve the current sprint folder. Do not create `sprint_<max+1>` unless the human explicitly asks to
     start a new sprint.
  2. From the description, produce one program plus an ordered implementation-ticket breakdown. Give every ticket a
     stable ID (`S3-T1`, `S3-T2`, …), dependencies by ticket ID, acceptance criteria, and one or more stable subtasks
     (`S3-T1-ST1`, `S3-T1-ST2`, …).
  3. Run `scripts/loop_pages.py bootstrap-program` once for the parent feature/program folder.
  4. Run `scripts/loop_pages.py bootstrap-ticket --program <program-slug>` for every implementation ticket. This
     creates the flat ticket pair and its subtask pairs from `assets/templates/`.
  5. Run `scripts/loop_pages.py refresh-index <program-folder>` and
     `scripts/loop_pages.py validate program <program-folder>/index.html`.
  6. Commit the single program folder on the base branch per the tracking-commit rule, then begin the first ready
     ticket. Do not pause for plan approval unless a genuine product, scope, or safety ambiguity remains.

**Manifest contract (how to read/write each page).** Every page renders from one embedded JSON script block. Edit only
that JSON block, then refresh and validate the program index.

- `index.html` uses `program-data` and is a derived navigation/rollup view.
- Ticket and subtask plan pages use `plan-data`; status pages use `status-data`.
- Ticket plans carry `kind:"ticket"`, stable identity, acceptance, `dependsOn`, `detailed`, subtask identities, and a
  post-merge `record`.
- Ticket statuses carry branch/PR/merge state plus the per-ticket failure `ledger`.
- Subtask plans/statuses carry their parent `ticketId` and `ticketSlug`, but no branch, PR, or merge authority.
- Aggregate recent ticket ledgers across the selected program and feed them forward as `failureLedger`.

---

## Preflight (once per invocation)

1. Reconfirm the Step 1a fresh-base gate: fetch `origin` and verify the ticket base is still not behind
   `origin/<git.baseBranch>`. Preserve and report any new local divergence; never reset or stash it automatically.
2. Local infra up: run each `preflight.infra` command (idempotent — e.g. `docker compose up -d`), then each
   `preflight.healthChecks` command; all must pass before continuing.
3. Dev servers (only if the config defines `preflight.devServers`): run its `check` command. If down, run `start`
   **in the background** and poll until `ports` bind (~60–90s). Servers must be **UP** for the real-browser
   Playwright-MCP UI channel to run. If they cannot start, record `serversUp:false`; non-UI tickets may continue, but a
   ticket touching a configured UI surface is blocked before code and cannot be verified or merged. A headless spec is
   useful future coverage, but it never substitutes for the live drive, screenshots, and accessibility review. **Never
   smoke-test against shared/staging/prod environments.**
4. Run `scripts/loop_pages.py discover <sprintFolder>` and re-read the selected program's flat ticket/subtask pairs.
   Build the ticket list with live status. **Treat git history + actual test results as ground truth** — if a status
   page disagrees with what is actually merged on the base branch, trust git, correct the page, then refresh and
   validate its `index.html`.

---

## The cycle (repeat until the sprint is drained / `max` reached)

### Stage 1 · Pick the next ticket + open the cycle
- Choose the next ticket where: status `=== "todo"`, **every** ticket `dependsOn` is `done`, and the ticket's
  `detailed === true` (treat a missing `detailed` as `true` only if the ticket has non-empty `acceptance[]`).
- Honor `taskId=` if given (but still refuse if its deps aren't merged — say so and stop).
- **If the next-by-order ready ticket is a scaffold (`detailed:false` or no acceptance criteria):** STOP and **ask the
  human** (AskUserQuestion): (a) draft its full spec now together, mark it `detailed`, continue; (b) skip to the next
  *detailed* ready ticket; (c) end. **Never build a scaffold ticket unattended.**
- **If no ticket is ready:** STOP — report the sprint state (done count, what's blocked on what).
- **UI fail-closed gate:** if the ticket's surfaces intersect `project.uiSurfaces`, require non-empty `project.testing.ui`
  instructions and `serversUp:true`. Otherwise mark the ticket blocked with the missing prerequisite and STOP before
  code. Do not let a human-free run waive browser evidence.
- **Baseline smoke test:** if `preflight.smokeTest` is configured, run it now on the synchronized, clean base branch. If it fails, the base
  branch is already broken — STOP and ask the human; never build a new ticket on a red base. Also **aggregate the recent
  `ledger[]` entries across all ticket-level status pages in the selected program**: tag each entry with its ticket `id`, sort by
  `at`, keep the recent ~50, and pass them to the engine as prior-ticket learnings.
- Determine `<branch>` from `git.branchPrefix` plus the lowercased ticket ID. While still on the base branch, update
  **this ticket's flat pages** (edit only the JSON blocks): in its ticket status page set `status:"in_progress"`,
  `phase:"design"`, `branch:<branch>`, and bump `updated`; set each required subtask status page to
  `status:"in_progress"`. Refresh and validate the containing program's `index.html`. Commit on the base branch
  (`chore(loop): start <ID>`) per the tracking-commit rule (only if `git.baseBranch` is unprotected and
  `tracking.commit` is true; otherwise keep tracking edits on the ticket branch).
- Create the ticket branch from that state: `git switch -c <branch>`. Uncommitted tracking edits carry onto this branch
  when `tracking.commit` is false.

### Stages 2–7 · Build via the engine (design → tech spec → code → validate → docs → verify)
Invoke the per-ticket Workflow — this is where sub-agents are dynamically spawned. **The engine runs once per ticket**
(the merge unit); the ticket's `subtasks[]` are passed in so the design/spec honor the decomposition, and the whole
ticket lands in one diff.
```
Workflow({ scriptPath: "<skill-dir>/task-flow.mjs", args: {
  task: <the full ticket object from its flat ticket plan page: id, title, goal, surfaces, acceptance[], outOfScope[], dependsOn[], subtasks[]>,
  branch: "<git.branchPrefix><id>",
  repo: "<absolute repo path>",
  serversUp: <bool from preflight>,
  maxFixRounds: <engine.maxFixRounds, default 3>,
  maxTaskTokens: <engine.maxTaskTokens, optional — per-task output-token ceiling; the engine PAUSES to escalate rather than grind past it>,
  failureLedger: <the recent ~50 `ledger[]` entries aggregated across all ticket status pages in the selected program, each tagged with its ticket id and sorted by `at` — prior tickets' defects+fixes, fed forward so the engine avoids repeats>,
  project: <the config's `project` object, verbatim — incl. testing.{api,database,ui}, docs[], testGuard, …>
}})
```
Resolve `<skill-dir>` to where this skill is installed (typically `~/.claude/skills/loop-engineering/`, `~` expanded).
It runs in the background; wait for the completion notification, then read its returned report. The engine performs:
**Recon** → **Design** (the done-contract — plus a `design:design-critique` + `design:ux-copy` UX lens on any UI surface: flow + state-legibility + the key strings folded into the acceptance criteria) → **Technical Spec** (file-level engineering plan) → **Code** (drift-plan →
clean-cutover implement, each stage build-green) → **Validate** (DESIGNS a test matrix first — several happy, negative,
AND edge cases per channel, weighted toward cases that break the code — then authors + runs them across API/database
and, when a UI surface is touched + servers up, a real-browser Playwright-MCP UI drive (navigate → click/type → screenshot the live UI), then a **design/UX review** of those screenshots (`design:accessibility-review` BLOCKS on WCAG AA; `design:design-critique` + `design:ux-copy` are ADVISORY, surfaced in the PR body); loops with Code until green or `maxFixRounds`; then the
read-only static gate, then a **deterministic anti-tamper check** that the coder didn't weaken tests/CI to go green) →
**Docs** (updates the affected project documentation, part of the diff) → clean-room **Verify** (independent agents that
see only the contract + diff + PR body; the completeness critic rejects a happy-path-only suite; a **held-out** agent
authors + runs one independent perturbed-input test the coder never saw). If a per-task token ceiling is hit it PAUSES
to escalate rather than grind. It returns `{verified, blocked, needsHuman, pausedAt, questions, design, techSpec, docs,
testBreadth, tamper, heldOut, ledgerEntries, openQuestions, acceptanceCriteria, verdicts, prBody, …}` and leaves all
changes staged in the working tree.

**Human gate — the engine may pause for you (encouraged).** The engine can stop *before writing code* and return
`report.needsHuman === true` with `report.pausedAt` (`design` or `tech-spec`) and `report.questions`. When it does:
surface those questions via AskUserQuestion, then **re-invoke the engine for the same ticket** with everything identical
plus `clarifications: [{question, answer}, …]` added to `args`. Repeat until the engine returns a completed report
(verified/blocked). Also, if a *completed* report carries a non-empty `report.openQuestions` (e.g. raised during test
design), surface them before you decide to merge — don't bury them.

### Stage 4b · Decision gate (the review gate)
- **If `report.needsHuman`** (the engine paused before coding): handled by the Human gate above — ask, then re-invoke
  with `clarifications`; do not treat it as blocked. You only reach the rest of this gate with a completed report.
- **If `report.blocked` or `report.verified === false`** (validation red, a criterion unmet, a failed **accessibility gate** (`report.designReview.a11yViolations`), or
  `testGamingSuspected`): do **NOT** merge. Set this ticket's ticket-level `status:"blocked"` + a `note` with the failed
  criteria; if a failed criterion maps to a specific subtask, set that subtask's status to `blocked` too (else leave the
  subtasks `in_progress`). **Ask the human** (AskUserQuestion): (a) re-run the engine with extra guidance you provide;
  (b) hand it to them; (c) skip; (d) stop.
- **If `report.openQuestions` is non-empty** (even on an otherwise-green ticket): surface them to the human before
  merging and let them decide (proceed / adjust / stop) — never silently merge over an open question.
- **Only if `report.verified === true`** (and any open questions resolved) proceed to the risk gate. (The design review's ADVISORY `report.designReview.critique`/`copy` notes never block — they already ride in the PR body; only a failed accessibility gate blocks, surfacing as `verified===false` above.)

### Stage 4c · Risk gate (high-risk changes pause before auto-merge)
Even when `report.verified === true`, classify the staged diff's **risk tier** before merging. A change is **high-risk**
if it touches any `merge.highRiskPaths` / `merge.highRiskPatterns` from the config — by default: DB schema/migrations
(`schema.prisma`, `**/migrations/**`, `rls.sql`), auth, money/billing, infra/IaC, `.github/workflows/`, the loop's own
config/tracking files, or **any file deletion**. Also treat `report.tamper.tampered === true`, a failed held-out test
(`report.heldOut.authored && !report.heldOut.passed`), or non-empty `report.openQuestions` as high-risk.
- **High-risk → do NOT auto-merge.** Open the PR (Stage 5 steps 1–2), then **STOP and ask the human** (AskUserQuestion)
  with the risk reason + the diff stat; let them approve the merge, request changes, or take it over.
- **Low-risk (additive, boundary-free, all gates green) → auto-merge** per Stage 5.
"CI green" alone is NOT sufficient for unattended merge: a green PR can be green because tests were gamed, or can
semantically break a consumer the tests don't cover. This gate is the most important safety control for daily runs.

### Stage 5 · PR + auto-merge (merge gate = auto-merge after review)
1. Commit the working tree: `git add -A && git commit -m "<type>(<scope>): <id> — <summary>"`, ending with the
   co-author trailer (`git.commitTrailer` if set, else the standard Claude Code trailer). Respect commit hooks — never
   `--no-verify` / `--force`.
2. `git push -u origin <branch>` then
   `gh pr create --base <git.baseBranch> --title "[<ID>] <title>" --body "<report.prBody>"`.
3. **Wait for CI** (skip if `ci.required` is false): poll `gh pr checks <n>` until all checks complete.
   - CI green → continue.
   - CI red → pull the failing logs (`gh run view`), re-invoke the engine once with the CI failures as guidance, re-push,
     re-poll. If still red after `ci.maxFixAttempts` (default **2**) → STOP and ask the human.
4. **Merge:** `gh pr merge <n> --<git.mergeMethod, default squash> --delete-branch`, then
   `git switch <git.baseBranch> && git pull --ff-only`.
   - **`dryRun`:** skip steps 3–4 and jump to Stage 5a. Never fall through to merged-state persistence.

### Stage 5a · `dryRun` open-PR state (terminal for this invocation)
When `dryRun` is set, the PR is open but the ticket is not merged:

- Keep the ticket `status:"in_progress"`, set `phase:"pr_open"`, set `pr:<n>`, keep `mergedAt:null`, and append a log
  entry that the PR awaits human review/merge.
- Keep the ticket plan's `record` null. Do not mark subtasks done merely because validation passed; leave them
  `in_progress` with a review note.
- Refresh and validate the program index, commit/push the tracking update to the ticket branch when appropriate, then
  **STOP** and report the PR. Do not enter Stage 5b, do not satisfy dependency gates, and do not start another ticket.

### Stage 5b · Persist the record + update status (close the cycle)
Enter this stage only after GitHub confirms the ticket PR was merged into the configured base branch.
All edits target **this ticket's flat page pair and its subtask pairs inside the one program folder**; leave every other
ticket's authoritative pages untouched.
- **Ticket plan page:** in its `plan-data` JSON, set `record` to
  `{ pr:<n>, mergedAt:<today>, design:<report.design>, techSpec:<report.techSpec> }` so the ticket page becomes its
  living design+spec record. Leave `id/slug/title/goal/acceptance/dependsOn` unchanged — the spec is stable.
- **Ticket status page:** in its `status-data` JSON, set `status:"done"`, `pr:<n>`, `mergedAt:<today>`, `phase:null`; append a
  `log` entry (`{at, event:"merged in #<n> — <one-line>"}`); **append `report.ledgerEntries` to this ticket's `ledger`** so
  the next ticket learns from this one's defects; bump `updated`.
- **Each subtask status page:** set `status:"done"` (or `"blocked"` for any subtask whose criteria failed), `phase:null`, append a `log` entry, and bump `updated`. Use `report.acceptanceCriteria` / `report.verdicts` to map results back to the right subtask where possible; otherwise mark all required subtasks done on merge.
- Run `scripts/loop_pages.py refresh-index <program-folder>` and validate `index.html` before committing.
- Commit (`chore(loop): <ID> merged (#<n>) + sprint docs`) and push, per the tracking-commit rule.
- (On a **blocked** ticket — Stage 4b — also append `report.ledgerEntries` to its ticket-level `ledger` before pausing; the learnings
  matter whether or not it merged.)

### Stage 6 · Loop
- Decrement the ticket budget. If the human explicitly requested more than one ticket, more ready tickets remain, and
  `max` allows, go to **Stage 1** for the next one.
  Otherwise STOP with a summary (what merged, what's next, any pauses), and point at the selected program folder's
  `index.html` for the live picture.

---

## Hard guardrails (always)

- **Auto-merge requires ALL of:** `report.verified === true` (validation green — incl. the **accessibility design-gate** — + every criterion met by the clean-room
  verifier + no test-gaming + anti-tamper clean + the held-out test passed), CI green (when required), **and a low-risk
  diff** (Stage 4c). Anything less → pause, never merge.
- **UI proof cannot be disabled:** a UI ticket also requires an executed UI channel, non-empty current-ticket screenshot
  paths, and an accessibility review of those exact screenshots. `testing.design:false` may suppress advisory
  critique/copy only; it never bypasses screenshots or accessibility.
- **Risk-gate auto-merge:** schema/migration/RLS, auth, money, infra, `.github/workflows/`, the loop's own
  config/tracking, and any file deletion are HIGH-RISK — open the PR but require a human OK before merge (Stage 4c).
  A suspected test-tamper or a failed held-out test is a hard block regardless of CI.
- **Pause-and-ask** on: a scaffold/undetailed ticket, an unmet criterion, a blocker, CI red after the fix cap, a dirty
  tree, a missing/ambiguous config value, an engine `needsHuman`/`openQuestions`, or anything needing a destructive git
  op. **Asking is always allowed and encouraged at ANY step — prefer a question over a guess on genuine ambiguity; it is
  never counted as a failure.** (Bootstrapping a *new sprint ticket set* does NOT pause — it runs autonomously per the
  chosen mode.)
- **Never happy-path-only:** validation must design + run several happy, negative, AND edge cases per channel; the
  clean-room critic fails a suite that lacks real negative/edge coverage (`coverageOk=false`).
- **The verifier is clean-room.** Never feed the coder's transcript/reasoning into the review — the engine enforces
  this; don't undermine it by hand-merging an unverified ticket.
- **Never** touch shared/staging/prod infrastructure or databases, trigger a deploy, force-push, bypass hooks, or
  weaken a test to go green. Honor every entry in the config's `project.forbidden` list.
- **Caps:** `engine.maxFixRounds` (default 3) inside the engine; `ci.maxFixAttempts` (default 2); optional
  `engine.maxTaskTokens` per-task ceiling. On any cap exhaustion **escalate to the human — do NOT auto-raise the cap**
  (more grind raises hack-rate, not correctness). Default = one ticket; process more only when explicitly requested.
- **The merge unit is the ticket** (one branch/PR/merge). Subtasks are its plan+status decomposition and ship inside
  that one PR — never open a separate PR per subtask.
- One commit per logical change; keep tracking-doc commits separate from ticket code.

## Stopping conditions

Sprint drained · next ready ticket is a scaffold · a ticket is blocked/unverified · CI won't go green · `max` reached · the
human says stop. Always end with a short status and point at the selected program folder's `index.html` for the live picture.
