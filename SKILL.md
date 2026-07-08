---
name: loop-engineering
description: Project-agnostic sprint loop-engineering cycle — point it at (or let it auto-resolve) the current numbered `sprint_N` folder. Each ticket gets its OWN folder holding a `<slug>_ticket.html` spec + `<slug>_status.html` tracker, PLUS a `<subtask>_plan.html` + `<subtask>_status.html` pair per subtask. It generates (or resumes) the tickets, then autonomously drains the sprint: per ticket design (a UX lens — design-critique + ux-copy — runs on any UI work) → technical spec → code → validate (API / database + a REAL-BROWSER Playwright-MCP drive that clicks + screenshots the live UI, then a design/UX review of those shots — accessibility gates the merge, critique + copy are advisory; loop-until-green) → docs → clean-room review → auto-merge after green, update the ticket + subtask status pages, next ticket. The ticket stays the merge unit (one branch/PR/merge); subtasks are its plan+status decomposition. Sprint folders are numbered `sprint_N` under a configurable sprints root (default `docs/sprints`): with none present it uses `sprint_0`, otherwise the highest N is the current sprint. Project facts come from .claude/loop-engineering.json (bootstraps on first run). Pauses to ask a human only on genuine ambiguity.
argument-hint: "[sprintsRootOrFolder] [sprint description…]   e.g. /loop-engineering Build the waitlist admin review flow  (bootstraps into the current sprint_N under docs/sprints)   ·   /loop-engineering   (resume the current sprint)   ·   /loop-engineering docs/sprints/sprint_3   (target a specific sprint)   ·   add `dryRun` to stop at the PR"
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, Workflow, AskUserQuestion
---

You are running the **loop-engineering cycle** — a self-driving sprint loop. You operate on a **numbered sprint folder**
(`<sprintsRoot>/sprint_N`, auto-resolved to the current sprint). You generate (or resume) the sprint's tickets — **each
ticket in its OWN folder**, holding a `<slug>_ticket.html` spec + `<slug>_status.html` tracker plus a
`<subtask>_plan.html` + `<subtask>_status.html` pair per subtask — then repeatedly pull the next ready ticket, build it
(design → technical spec → code → validate → docs), prove it, and — after an independent clean-room review + green CI —
auto-merge it, update its status pages, and move to the next ticket until the sprint is drained. **The ticket is the
merge unit** (one branch, one PR, one merge); its subtasks are the plan+status decomposition that ships inside that one
PR.

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
- **`max=<N>`** (optional) — process at most N tickets this invocation. Default: **drain the whole sprint** (still
  pauses on any blocker/ambiguity).

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

**1a · Resolve the sprint folder (numbering).** Determine the sprints root: the explicit path arg if it is a sprints
root, else `tracking.sprintsRoot` (default `docs/sprints`). If the arg is instead a *specific* `sprint_*` folder, use it
directly and skip the rest of 1a. Otherwise:
- `ls -d <root>/sprint_*/ 2>/dev/null` and parse the integer suffix of each. **If any exist, the current sprint is the
  one with the highest N** (`<root>/sprint_<max>`). **If none exist, the current sprint is `<root>/sprint_0`.**
- **Bootstrap and resume BOTH target this current (max, or 0) sprint** — never auto-create `sprint_<max+1>`. To start a
  brand-new sprint, the human creates `<root>/sprint_<N+1>` (or passes it explicitly); only then does it become the max.

**1b · The sprint layout.** A sprint folder holds **one folder per ticket**; the ticket is the merge unit. Inside each
`<slug>/` ticket folder:
- `<slug>_ticket.html` — the ticket's spec + accumulated design/spec record. `slug` == the folder name; `id` is the
  stable ticket id that other tickets' `dependsOn` reference.
- `<slug>_status.html` — the **ticket-level** live status + failure ledger (the merge-unit tracker: branch/PR/merge).
- for each subtask, a `<subSlug>_plan.html` + `<subSlug>_status.html` pair — the finer plan + live status. Subtasks are
  the ticket's decomposition; they ship together in the ticket's single PR.

**1c · Resume vs bootstrap.**
- **Sprint folder has ticket folders (any `*/` subdir containing a `*_ticket.html`) → RESUME.** For each ticket folder:
  read its `<slug>_ticket.html` (parse the embedded JSON — the manifest contract below), its `<slug>_status.html`
  (ticket-level: the one whose `slug` == the folder name / `kind:"ticket"`), and every `<subSlug>_plan.html` +
  `<subSlug>_status.html` pair. Build an in-memory ticket list (each ticket carrying its `subtasks[]` with per-subtask
  status). The ticket specs + statuses are the source of truth; the sprint-description argument (if any) is ignored.
  Continue from the next ready ticket.
- **Sprint folder has flat `*_ticket.html` files directly in it (no per-ticket subfolders) → LEGACY FLAT LAYOUT, STOP.**
  This is an older-format sprint (pre–ticket-folders, or one whose folder isn't named `sprint_N`). Do **NOT** bootstrap
  over it and do **NOT** attempt to resume it as-is. STOP and tell the human it must first be migrated to the
  `sprint_N/<slug>/` folder layout — each flat `<slug>_ticket.html` + `<slug>_status.html` pair moved into its own
  `<slug>/` folder (and, going forward, given subtask pairs). Only after migration will the loop pick it up. This guard
  exists so a half-finished flat sprint is never clobbered by a bootstrap.
- **Sprint folder empty / missing → BOOTSTRAP, then run autonomously (no approval gate):**
  1. Create the sprint folder (`mkdir -p <sprintFolder>`).
  2. **Break the sprint into tickets, and each ticket into subtasks.** Spawn a planning agent (Task tool /
     `general-purpose`) that reads the project's `readFirst` docs + the repo and, from the **sprint description**,
     produces an ordered ticket breakdown. Each ticket:
     `{ id, slug, title, goal, surfaces[], acceptance[], outOfScope[], dependsOn[], detailed:true, subtasks:[ {subtaskId, slug, title, goal, acceptance[], dependsOn?[]} ] }`.
     Keep tickets small and independently shippable; set ticket `dependsOn` (by ticket id) to encode order; give stable
     ids (`S1-T1`, `S1-T2`, …) and a unique kebab-case `slug` each (e.g. `split-other-income`). Give each subtask a
     stable `subtaskId` (`S1-T1-a`, `S1-T1-b`, …) and a unique kebab-case `slug` **within its ticket** (distinct from
     the ticket slug); the ticket's `acceptance[]` is the union of its subtasks' acceptance slices. A tiny ticket may
     have a single subtask.
  3. **For EACH ticket, create its folder and write its files** (every page **self-renders** from its JSON — do NOT
     write any HTML by hand):
     - `mkdir -p <sprintFolder>/<slug>`.
     - `<sprintFolder>/<slug>/<slug>_ticket.html` — copy `templates/ticket.template.html`, replacing its
       `<script id="ticket-data" …>` body with
       `{ sprint, id, slug, title, goal, surfaces, acceptance, outOfScope, dependsOn, detailed, subtasks:[{subtaskId, slug, title, status:"todo"}], generatedFrom, record:null }`.
     - `<sprintFolder>/<slug>/<slug>_status.html` — copy `templates/status.template.html`, replacing its
       `<script id="status-data" …>` body with
       `{ sprint, kind:"ticket", parent:null, id, slug, title, updated, status:"todo", phase:null, branch:null, pr:null, mergedAt:null, note:null, log:[], ledger:[] }`.
     - **for each subtask**, `<sprintFolder>/<slug>/<subSlug>_plan.html` — copy `templates/plan.template.html`,
       replacing its `<script id="plan-data" …>` body with
       `{ sprint, ticket:<ticket id>, subtaskId, slug:<subSlug>, title, goal, acceptance, dependsOn:[], notes:"", generatedFrom }`;
       and `<sprintFolder>/<slug>/<subSlug>_status.html` — copy `templates/status.template.html`, replacing its
       `<script id="status-data" …>` body with
       `{ sprint, kind:"subtask", parent:<ticket id>, id:<subtaskId>, slug:<subSlug>, title, updated, status:"todo", phase:null, note:null, log:[] }`.
  4. Commit all ticket folders on the base branch (`chore(loop): bootstrap sprint <folder>`) per the tracking-commit
     rule, then begin the cycle immediately on the first ready ticket. **Do not pause for plan approval** — this loop
     runs start-to-finish.

**Manifest contract (how to read/write each page).** Every page **renders itself from a single JSON `<script>`
block** — read it by parsing that script's text, and when updating, **edit ONLY that JSON block**; the page repaints
from it, so there is no hand-written HTML to keep in sync. Pair files inside a ticket folder by matching `slug`/`id`.
- `<slug>_ticket.html` → `<script id="ticket-data" …>` = `{ sprint, id, slug, title, goal, surfaces, acceptance[], outOfScope[], dependsOn[], detailed, subtasks[], generatedFrom, record }` (`subtasks[]` mirrors each subtask's `{subtaskId, slug, title, status}`; `record` stays null until the ticket merges, then holds `{ pr, mergedAt, design, techSpec }`).
- `<slug>_status.html` (ticket-level, `kind:"ticket"`) → `<script id="status-data" …>` = `{ sprint, kind:"ticket", parent:null, id, slug, title, updated, status:"todo|in_progress|blocked|done", phase, branch, pr, mergedAt, note, log:[ {at,event} ], ledger:[ {at,rootCauseClass,fix} ] }`.
- `<subSlug>_plan.html` → `<script id="plan-data" …>` = `{ sprint, ticket, subtaskId, slug, title, goal, acceptance[], dependsOn[], notes, generatedFrom }`.
- `<subSlug>_status.html` (subtask-level, `kind:"subtask"`) → `<script id="status-data" …>` = `{ sprint, kind:"subtask", parent:<ticket id>, id:<subtaskId>, slug, title, updated, status, phase, note, log:[ {at,event} ] }` (no `ledger` — that is ticket-level).
- **The ledger is per-ticket** and lives on the **ticket-level** `<slug>_status.html`. For the cross-ticket failure memory, the loop **aggregates** `ledger[]` from ALL ticket-level status pages (one per ticket folder): tag each entry with its ticket `id`, sort by `at`, keep the recent ~50, and feed that forward as the next ticket's `failureLedger`. Subtask status pages carry no ledger.

---

## Preflight (once per invocation)

1. `git switch <git.baseBranch> && git pull --ff-only`. Abort if the tree is dirty (ask the user — uncommitted work is
   theirs).
2. Local infra up: run each `preflight.infra` command (idempotent — e.g. `docker compose up -d`), then each
   `preflight.healthChecks` command; all must pass before continuing.
3. Dev servers (only if the config defines `preflight.devServers`): run its `check` command. If down, run `start`
   **in the background** and poll until `ports` bind (~60–90s). Servers must be **UP** for the real-browser
   Playwright-MCP UI channel to *run* (it drives a live browser — clicks + screenshots — against those servers); if they
   won't come up, continue with `serversUp:false` — the engine then *authors* the headless regression spec but defers the
   live real-browser drive, and you note that in the PR. **Never smoke-test against shared/staging/prod environments.**
4. Re-read every ticket folder's `<slug>_ticket.html` + `<slug>_status.html` + subtask pairs. Build the ticket list with
   live status. **Treat git history + actual test results as ground truth** — if a status page disagrees with what's
   actually merged on the base branch, trust git and correct that page (a crashed prior run can leave one stale).

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
- Create the branch: `git switch -c <git.branchPrefix><id-lowercased>`.
- **Baseline smoke test:** if `preflight.smokeTest` is configured, run it now on the fresh branch. If it fails, the base
  branch is already broken — STOP and ask the human; never build a new ticket on a red base. Also **aggregate the recent
  `ledger[]` entries across all ticket-level `<slug>_status.html` pages**: tag each entry with its ticket `id`, sort by
  `at`, keep the recent ~50, and pass them to the engine as prior-ticket learnings.
- Update **this ticket's pages** (edit only the JSON blocks): in `<slug>_status.html` (ticket-level) set
  `status:"in_progress"`, `phase:"design"`, `branch:<branch>`, bump `updated`; set each subtask's `<subSlug>_status.html`
  to `status:"in_progress"` and mirror those statuses into the ticket page's `subtasks[]`. Commit on the base branch
  (`chore(loop): start <ID>`) per the tracking-commit rule (only if `git.baseBranch` is unprotected and
  `tracking.commit` is true; otherwise keep tracking edits on the ticket branch).

### Stages 2–7 · Build via the engine (design → tech spec → code → validate → docs → verify)
Invoke the per-ticket Workflow — this is where sub-agents are dynamically spawned. **The engine runs once per ticket**
(the merge unit); the ticket's `subtasks[]` are passed in so the design/spec honor the decomposition, and the whole
ticket lands in one diff.
```
Workflow({ scriptPath: "<skill-dir>/task-flow.mjs", args: {
  task: <the full ticket object (from its `<slug>_ticket.html`): id, title, goal, surfaces, acceptance[], outOfScope[], dependsOn[], subtasks[]>,
  branch: "<git.branchPrefix><id>",
  repo: "<absolute repo path>",
  serversUp: <bool from preflight>,
  maxFixRounds: <engine.maxFixRounds, default 3>,
  maxTaskTokens: <engine.maxTaskTokens, optional — per-task output-token ceiling; the engine PAUSES to escalate rather than grind past it>,
  failureLedger: <the recent ~50 `ledger[]` entries aggregated across all ticket-level `<slug>_status.html` pages, each tagged with its ticket id and sorted by `at` — prior tickets' defects+fixes, fed forward so the engine avoids repeats>,
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
   - **`dryRun`:** skip steps 3–4 — leave the PR open and report `#n` for the human to merge.

### Stage 5b · Persist the record + update status (close the cycle)
All edits target **this ticket's own folder** (`<slug>_ticket.html`, `<slug>_status.html`, and its subtask pairs); leave every OTHER ticket folder untouched.
- **`<slug>_ticket.html`:** in its `ticket-data` JSON, set `record` to
  `{ pr:<n>, mergedAt:<today>, design:<report.design>, techSpec:<report.techSpec> }` so the ticket page becomes its
  living design+spec record, and set every entry in `subtasks[]` to `status:"done"` (or, if a specific subtask's criteria
  went unmet, `"blocked"`). Leave `id/slug/title/goal/acceptance/dependsOn` unchanged — the spec is stable.
- **`<slug>_status.html`** (ticket-level)**:** in its `status-data` JSON, set `status:"done"`, `pr:<n>`, `mergedAt:<today>`, `phase:null`; append a
  `log` entry (`{at, event:"merged in #<n> — <one-line>"}`); **append `report.ledgerEntries` to this ticket's `ledger`** so
  the next ticket learns from this one's defects; bump `updated`.
- **Each `<subSlug>_status.html`:** set `status:"done"` (or `"blocked"` for any subtask whose criteria failed), `phase:null`, append a `log` entry, bump `updated`. Use `report.acceptanceCriteria` / `report.verdicts` to map results back to the right subtask where possible; otherwise mark them all done on merge.
- Commit (`chore(loop): <ID> merged (#<n>) + sprint docs`) and push, per the tracking-commit rule.
- (On a **blocked** ticket — Stage 4b — also append `report.ledgerEntries` to its ticket-level `ledger` before pausing; the learnings
  matter whether or not it merged.)

### Stage 6 · Loop
- Decrement the ticket budget. If more ready tickets remain and `max` allows, go to **Stage 1** for the next one.
  Otherwise STOP with a summary (what merged, what's next, any pauses), and point at the sprint folder's ticket-level `<slug>_status.html` pages for the live picture.

---

## Hard guardrails (always)

- **Auto-merge requires ALL of:** `report.verified === true` (validation green — incl. the **accessibility design-gate** — + every criterion met by the clean-room
  verifier + no test-gaming + anti-tamper clean + the held-out test passed), CI green (when required), **and a low-risk
  diff** (Stage 4c). Anything less → pause, never merge.
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
  (more grind raises hack-rate, not correctness). Default = drain the whole sprint unless `max=<N>`.
- **The merge unit is the ticket** (one branch/PR/merge). Subtasks are its plan+status decomposition and ship inside
  that one PR — never open a separate PR per subtask.
- One commit per logical change; keep tracking-doc commits separate from ticket code.

## Stopping conditions

Sprint drained · next ready ticket is a scaffold · a ticket is blocked/unverified · CI won't go green · `max` reached · the
human says stop. Always end with a short status and point at the sprint folder's ticket-level `<slug>_status.html` pages for the live picture.
