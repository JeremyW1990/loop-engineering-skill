---
name: loop-engineering
description: Project-agnostic sprint loop-engineering cycle — point it at a sprint folder + a description; it generates (or resumes) implementation_plan.html + implementation_status.html, then autonomously drains the sprint: per task design → technical spec → code → validate (UI via a REAL-BROWSER Playwright-MCP drive that clicks + screenshots the live UI / API / database, loop-until-green) → docs → clean-room review → auto-merge after green, update the status page, next task. Project facts come from .claude/loop-engineering.json (bootstraps on first run). Pauses to ask a human only on genuine ambiguity.
argument-hint: "<sprintFolder> [sprint description…]   e.g. /loop-engineering docs/sprint1 Build the waitlist admin review flow   ·   /loop-engineering docs/sprint1   (resume)   ·   add `dryRun` to stop at the PR"
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, Workflow, AskUserQuestion
---

You are running the **loop-engineering cycle** — a self-driving sprint loop. You are pointed at a **sprint folder**; you
generate (or resume) the sprint's `implementation_plan.html` + `implementation_status.html`, then repeatedly pull the
next ready task, build it (design → technical spec → code → validate → docs), prove it, and — after an independent
clean-room review + green CI — auto-merge it, update the status page, and move to the next task until the sprint is
drained.

**Ask freely — it is never a failure.** Autonomy is the goal, but at ANY step (bootstrap, plan generation, design,
technical spec, coding, test design, validation, review) if something is genuinely ambiguous, or is a product/scope
decision that is the human's to make, STOP and ask via AskUserQuestion rather than guess. The engine itself can pause
*before writing code* and hand its open questions back to you (`report.needsHuman`) — relay them. A good question beats
a confident wrong guess.

The loop is grounded in verified best practice for long-running agent loops: an explicit "done" contract before any
code; an *independent* evaluator that never sees the coder's reasoning; external state (git + the two HTML pages)
carried across context resets (each task is a fresh Workflow run); loop-until-green with iteration caps; and hard
guardrails against false-completion and test-gaming.

## Arguments

`/loop-engineering <sprintFolder> [sprint description…]`

- **`sprintFolder`** (required, first token) — a path (relative to the repo root, or absolute) for this sprint, e.g.
  `docs/sprint1`. It holds exactly two files: `implementation_plan.html` and `implementation_status.html`.
- **sprint description** (the rest of the line) — free text describing what the sprint should deliver. **Required only
  when bootstrapping** a new sprint folder; ignored when resuming an existing one (the files are the source of truth).
- **`dryRun`** (flag, anywhere in the args) — open each PR and **stop** (no merge). Recommended for the first run on a
  new project so a human can watch one full cycle before trusting auto-merge.
- **`taskId=<ID>`** (optional) — force a specific task instead of next-by-dependency.
- **`max=<N>`** (optional) — process at most N tasks this invocation. Default: **drain the whole sprint** (still pauses
  on any blocker/ambiguity).

## Step 0 · Load the project config (once per invocation)

Project-level facts live in **`.claude/loop-engineering.json`** at the repo root (NOT in the sprint folder). The full
schema is in `CONFIG.md` next to this skill (read it whenever you create or edit a config); `examples/example.json` is
a complete worked example.

- **Config exists** → read it. It supplies: base branch, lint/typecheck/test commands, infra to start, the
  UI/API/database test channels, the docs to keep in sync, and the `project` object passed verbatim to the engine.
- **No config (first run on this project)** → bootstrap one:
  1. Inspect the repo: `CLAUDE.md`/`README.md`, `package.json` scripts (or Makefile/justfile), CI workflow files,
     docker-compose, test layout (where API/DB tests + Playwright specs live). Derive base branch, commands, infra, UI
     surfaces, the three test channels, candidate project rules, and the docs set.
  2. Draft the config per `CONFIG.md`.
  3. **Show the draft to the human and confirm via AskUserQuestion before writing.** Bad commands or a wrong base
     branch poison every later cycle. Write the file only after confirmation.

## Step 1 · Resolve the sprint folder + plan/status pages (once per invocation)

Compute `PLAN = <sprintFolder>/implementation_plan.html` and `STATUS = <sprintFolder>/implementation_status.html`.

- **Both files exist → RESUME.** Read them. Parse the embedded JSON manifests (below). The plan's task list + the
  status' per-task state are the source of truth; the sprint description argument (if any) is ignored. Continue from the
  next ready task.
- **Folder or files missing → BOOTSTRAP, then run autonomously (no approval gate):**
  1. Create the folder (`mkdir -p <sprintFolder>`).
  2. **Generate the plan.** Spawn a planning agent (Task tool / `general-purpose`) that reads the project's `readFirst`
     docs + the repo and, from the **sprint description**, produces an ordered task breakdown. Each task:
     `{ id, title, goal, surfaces[], acceptance[], outOfScope[], dependsOn[], detailed:true }`. Keep tasks small and
     independently shippable; set `dependsOn` to encode order; give stable ids (`S1-T1`, `S1-T2`, …).
  3. **Write `implementation_plan.html`** by copying `templates/implementation_plan.template.html` and replacing its
     `<script id="plan-data" type="application/json">…</script>` body with the manifest
     `{ sprint, title, description, generatedFrom, tasks:[…] }` (each task `record:null` for now). The template
     **self-renders** the table + per-task detail from that JSON — do NOT write any HTML by hand.
  4. **Write `implementation_status.html`** by copying `templates/implementation_status.template.html` and replacing its
     `<script id="status-data" type="application/json">…</script>` body with
     `{ updated, currentCycle:null, tasks:{ <id>:{status:"todo"} }, log:[] }`. It self-renders too.
  5. Commit both on the base branch (`chore(loop): bootstrap sprint <folder>`) per the tracking-commit rule, then begin
     the cycle immediately on the first ready task. **Do not pause for plan approval** — this loop runs start-to-finish.

**Manifest contract (how to read/write the two pages).** Each page **renders itself from a single JSON `<script>`
block** — read it by parsing that script's text, and when updating, **edit ONLY that JSON block**; the page repaints
from it, so there is no hand-written HTML to keep in sync.
- `PLAN` → `<script id="plan-data" type="application/json">` = `{ sprint, title, description, generatedFrom, tasks: [ {id,title,goal,surfaces,acceptance[],outOfScope[],dependsOn[],detailed,record} ] }` (`record` stays null until the task merges).
- `STATUS` → `<script id="status-data" type="application/json">` = `{ updated, currentCycle, tasks: { <id>: { status:"todo|in_progress|blocked|done", phase, branch, pr, mergedAt, note } }, log: [ {at,task,event} ] }`.

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
4. Re-read `PLAN` + `STATUS`. Build the task list with live status. **Treat git history + actual test results as ground
   truth** — if the status page disagrees with what's actually merged on the base branch, trust git and correct the page
   (a crashed prior run can leave the page stale).

---

## The cycle (repeat until the sprint is drained / `max` reached)

### Stage 1 · Pick the next task + open the cycle
- Choose the next task where: status `=== "todo"`, **every** `dependsOn` is `done`, and plan `detailed === true`
  (treat a missing `detailed` as `true` only if the task has non-empty `acceptance[]`).
- Honor `taskId=` if given (but still refuse if its deps aren't merged — say so and stop).
- **If the next-by-order ready task is a scaffold (`detailed:false` or no acceptance criteria):** STOP and **ask the
  human** (AskUserQuestion): (a) draft its full spec now together, mark it `detailed`, continue; (b) skip to the next
  *detailed* ready task; (c) end. **Never build a scaffold task unattended.**
- **If no task is ready:** STOP — report the sprint state (done count, what's blocked on what).
- Create the branch: `git switch -c <git.branchPrefix><id-lowercased>`.
- **Baseline smoke test:** if `preflight.smokeTest` is configured, run it now on the fresh branch. If it fails, the base
  branch is already broken — STOP and ask the human; never build a new task on a red base. Also read the recent
  `status-data.ledger` entries to pass the engine as prior-task learnings.
- Update `STATUS` (edit only the `status-data` JSON): set this task `status:"in_progress"`, set `currentCycle`
  `{task,title,branch,phase:"design",startedAt:<today>}`, bump `updated`. Commit on the base branch
  (`chore(loop): start <ID>`) per the tracking-commit rule (only if `git.baseBranch` is unprotected and
  `tracking.commit` is true; otherwise keep tracking edits on the task branch).

### Stages 2–7 · Build via the engine (design → tech spec → code → validate → docs → verify)
Invoke the per-task Workflow — this is where sub-agents are dynamically spawned:
```
Workflow({ scriptPath: "<skill-dir>/task-flow.mjs", args: {
  task: <the full task object from the plan: id, title, goal, surfaces, acceptance[], outOfScope[], dependsOn[]>,
  branch: "<git.branchPrefix><id>",
  repo: "<absolute repo path>",
  serversUp: <bool from preflight>,
  maxFixRounds: <engine.maxFixRounds, default 3>,
  maxTaskTokens: <engine.maxTaskTokens, optional — per-task output-token ceiling; the engine PAUSES to escalate rather than grind past it>,
  failureLedger: <the recent `status-data.ledger` entries — prior tasks' defects+fixes, fed forward so the engine avoids repeats>,
  project: <the config's `project` object, verbatim — incl. testing.{api,database,ui}, docs[], testGuard, …>
}})
```
Resolve `<skill-dir>` to where this skill is installed (typically `~/.claude/skills/loop-engineering/`, `~` expanded).
It runs in the background; wait for the completion notification, then read its returned report. The engine performs:
**Recon** → **Design** (the done-contract) → **Technical Spec** (file-level engineering plan) → **Code** (drift-plan →
clean-cutover implement, each stage build-green) → **Validate** (DESIGNS a test matrix first — several happy, negative,
AND edge cases per channel, weighted toward cases that break the code — then authors + runs them across API/database
and, when a UI surface is touched + servers up, a real-browser Playwright-MCP UI drive (navigate → click/type → screenshot the live UI); loops with Code until green or `maxFixRounds`; then the
read-only static gate, then a **deterministic anti-tamper check** that the coder didn't weaken tests/CI to go green) →
**Docs** (updates the affected project documentation, part of the diff) → clean-room **Verify** (independent agents that
see only the contract + diff + PR body; the completeness critic rejects a happy-path-only suite; a **held-out** agent
authors + runs one independent perturbed-input test the coder never saw). If a per-task token ceiling is hit it PAUSES
to escalate rather than grind. It returns `{verified, blocked, needsHuman, pausedAt, questions, design, techSpec, docs,
testBreadth, tamper, heldOut, ledgerEntries, openQuestions, acceptanceCriteria, verdicts, prBody, …}` and leaves all
changes staged in the working tree.

**Human gate — the engine may pause for you (encouraged).** The engine can stop *before writing code* and return
`report.needsHuman === true` with `report.pausedAt` (`design` or `tech-spec`) and `report.questions`. When it does:
surface those questions via AskUserQuestion, then **re-invoke the engine for the same task** with everything identical
plus `clarifications: [{question, answer}, …]` added to `args`. Repeat until the engine returns a completed report
(verified/blocked). Also, if a *completed* report carries a non-empty `report.openQuestions` (e.g. raised during test
design), surface them before you decide to merge — don't bury them.

### Stage 4b · Decision gate (the review gate)
- **If `report.needsHuman`** (the engine paused before coding): handled by the Human gate above — ask, then re-invoke
  with `clarifications`; do not treat it as blocked. You only reach the rest of this gate with a completed report.
- **If `report.blocked` or `report.verified === false`** (validation red, a criterion unmet, or
  `testGamingSuspected`): do **NOT** merge. Set status `status:"blocked"` + a `currentCycle.note` with the failed
  criteria. **Ask the human** (AskUserQuestion): (a) re-run the engine with extra guidance you provide; (b) hand it to
  them; (c) skip; (d) stop.
- **If `report.openQuestions` is non-empty** (even on an otherwise-green task): surface them to the human before
  merging and let them decide (proceed / adjust / stop) — never silently merge over an open question.
- **Only if `report.verified === true`** (and any open questions resolved) proceed to the risk gate.

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
- **`PLAN`:** in the `plan-data` JSON, set this task's `record` to
  `{ pr:<n>, mergedAt:<today>, design:<report.design>, techSpec:<report.techSpec> }` so the plan becomes the sprint's
  living design+spec record (the page renders it under that task). Leave every task's id/title/goal/acceptance/deps
  unchanged — the task list is stable.
- **`STATUS`:** in the `status-data` JSON, set this task `status:"done"`, `pr:<n>`, `mergedAt:<today>`; append a `log`
  entry (`{at, task:<ID>, event:"merged in #<n> — <one-line>"}`); **append `report.ledgerEntries` to `ledger`** (keep the
  last ~50) so the next task learns from this one's defects; set `currentCycle:null`; bump `updated`.
- Commit (`chore(loop): <ID> merged (#<n>) + sprint docs`) and push, per the tracking-commit rule.
- (On a **blocked** task — Stage 4b — also append `report.ledgerEntries` to `ledger` before pausing; the learnings matter
  whether or not it merged.)

### Stage 6 · Loop
- Decrement the task budget. If more ready tasks remain and `max` allows, go to **Stage 1** for the next one.
  Otherwise STOP with a summary (what merged, what's next, any pauses), and point at `STATUS` for the live picture.

---

## Hard guardrails (always)

- **Auto-merge requires ALL of:** `report.verified === true` (validation green + every criterion met by the clean-room
  verifier + no test-gaming + anti-tamper clean + the held-out test passed), CI green (when required), **and a low-risk
  diff** (Stage 4c). Anything less → pause, never merge.
- **Risk-gate auto-merge:** schema/migration/RLS, auth, money, infra, `.github/workflows/`, the loop's own
  config/tracking, and any file deletion are HIGH-RISK — open the PR but require a human OK before merge (Stage 4c).
  A suspected test-tamper or a failed held-out test is a hard block regardless of CI.
- **Pause-and-ask** on: a scaffold/undetailed task, an unmet criterion, a blocker, CI red after the fix cap, a dirty
  tree, a missing/ambiguous config value, an engine `needsHuman`/`openQuestions`, or anything needing a destructive git
  op. **Asking is always allowed and encouraged at ANY step — prefer a question over a guess on genuine ambiguity; it is
  never counted as a failure.** Use AskUserQuestion; surface the concrete evidence. (Bootstrapping a *new sprint plan*
  does NOT pause — it runs autonomously per the chosen mode.)
- **Never happy-path-only:** validation must design + run several happy, negative, AND edge cases per channel; the
  clean-room critic fails a suite that lacks real negative/edge coverage (`coverageOk=false`).
- **The verifier is clean-room.** Never feed the coder's transcript/reasoning into the review — the engine enforces
  this; don't undermine it by hand-merging an unverified task.
- **Never** touch shared/staging/prod infrastructure or databases, trigger a deploy, force-push, bypass hooks, or
  weaken a test to go green. Honor every entry in the config's `project.forbidden` list.
- **Caps:** `engine.maxFixRounds` (default 3) inside the engine; `ci.maxFixAttempts` (default 2); optional
  `engine.maxTaskTokens` per-task ceiling. On any cap exhaustion **escalate to the human — do NOT auto-raise the cap**
  (more grind raises hack-rate, not correctness). Default = drain the whole sprint unless `max=<N>`.
- One commit per logical change; keep tracking/plan commits separate from task code.

## Stopping conditions

Sprint drained · next ready task is a scaffold · a task is blocked/unverified · CI won't go green · `max` reached · the
human says stop. Always end with a short status and point at `implementation_status.html` for the live picture.
