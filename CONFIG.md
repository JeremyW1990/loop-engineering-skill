# `.claude/loop-engineering.json` — per-project config reference

One file at the **repo root** specializes the loop-engineering skill for a project. It holds project-level *facts*
(commands, infra, rules, test channels, docs) — **not** the plan. The plan + tracking live in a **sprint folder** you
pass on the command line (`/loop-engineering docs/sprint1 …`), as `implementation_plan.html` +
`implementation_status.html` (see "The sprint folder" below).

The loop master (SKILL.md) consumes the top-level sections; the `project` object is passed **verbatim** to
`task-flow.mjs` as `args.project`.

Every field has a sensible default — start minimal and grow it. `examples/example.json` is a complete worked example
(a Node/TypeScript API + Postgres via Prisma + a web frontend, with Vitest + Playwright test tiers).

```jsonc
{
  // ── consumed by the loop master (SKILL.md) ──────────────────────────────
  "tracking": {
    "commit": true                              // commit plan/status page updates directly on the base branch (only if unprotected)
  },
  "git": {
    "baseBranch": "main",                      // PRs target this; the loop syncs it between tasks
    "branchPrefix": "task/",                   // task branch = prefix + lowercased task id
    "mergeMethod": "squash",                   // squash | merge | rebase (gh pr merge flag)
    "commitTrailer": ""                         // optional Co-Authored-By override; empty = harness default
  },
  "ci": {
    "required": true,                          // poll `gh pr checks` before merging
    "maxFixAttempts": 2                        // CI-red fix iterations before pausing for a human
  },
  "engine": {
    "maxFixRounds": 3,                         // test-red fix iterations inside the per-task engine
    "maxTaskTokens": null                      // optional per-task output-token ceiling; engine PAUSES to escalate (not grind) when hit
  },
  "merge": {                                    // risk gate before auto-merge (Tier 1): high-risk → open the PR but require a human OK
    "highRiskPaths": ["**/migrations/**", "**/schema.prisma", "**/rls.sql", ".github/workflows/**"],
    "highRiskPatterns": ["auth", "billing", "payment"]   // substrings flagged in changed file paths; any file DELETION is always high-risk
  },
  "preflight": {
    "infra": ["docker compose up -d"],         // idempotent commands to bring local infra up
    "healthChecks": ["pg_isready -h localhost -p 5432"], // all must pass before the cycle starts
    "smokeTest": "",                            // optional: a fast end-to-end check run on the fresh branch BEFORE each task; if red, the base is broken → pause
    "devServers": {                             // omit entirely if the project needs no running servers for UI tests
      "check": "lsof -i :3000",
      "start": "npm run dev",
      "ports": [3000]                           // servers must be UP for the real-browser Playwright-MCP UI channel to RUN (else the headless spec is authored-only)
    }
  },

  // ── passed verbatim to task-flow.mjs as args.project ────────────────────
  "project": {
    "name": "my-project",
    "readFirst": [                              // authoritative docs every sub-agent reads first
      "CLAUDE.md",
      "docs/ARCHITECTURE.md"
    ],
    "rules": [                                  // non-negotiable project rules, injected into every agent prompt
      "Match the surrounding code style; reuse existing helpers.",
      "Replace, don't accrete: remove obsoleted code rather than leaving two paths."
    ],
    "environment": [                            // env facts agents need (URLs, ports, services)
      "Local DB: postgresql://dev:dev@localhost:5432/app"
    ],
    "forbidden": [                              // never-do list (deploys, prod DBs, force-push, ...)
      "NEVER trigger a deploy or touch staging/production infrastructure or databases."
    ],
    "implementationNotes": [                    // per-stage mechanics: generate/typecheck/migrate commands
      "Typecheck with `npx tsc --noEmit` in each touched package.",
      "Migrations: `npx prisma migrate dev --name <snake_case>` then regenerate the client."
    ],
    "reconAreas": [                             // parallel read-only recon scopes; omit for generic defaults
      { "key": "core",      "prompt": "Map the core implementation this task touches ..." },
      { "key": "interfaces","prompt": "Map the APIs/UI this task touches ..." }
    ],
    "staticChecks": [                           // the read-only validation gate, run after tests are green
      { "label": "lint",      "command": "npm run lint  (no --fix)" },
      { "label": "typecheck", "command": "npx tsc --noEmit in every touched package" },
      { "label": "tests",     "command": "npm test — the full suite" }
    ],
    "testing": {                                // the three validation channels (empty string ⇒ skip that channel)
      "api":      "How to author + run API/integration tests: location, runner command, what to assert (responses, error cases).",
      "database": "How to assert resulting DB state in the same test: which tables/rows/audit logs, soft-delete semantics, no-drift checks.",
      "ui":       ""                            // real-browser Playwright-MCP UI instructions (which page/flow to drive + screenshot); empty = project has no UI tier
    },
    "docs": [                                   // documentation the Docs phase keeps in sync (files/globs + how); omit = just keep readFirst accurate
      "docs/ARCHITECTURE.md — update when modules/data-flow change",
      "README.md — update setup/usage when commands or env change"
    ],
    "testGuard": {                              // anti-tamper (Tier 1): the coder may NOT weaken the verification surface
      "testGlobs": ["**/*.test.*", "**/*.spec.*", "**/test/**", "**/tests/**"],
      "forbiddenMarkers": [".skip(", ".only(", "xit(", "test.skip"],  // adding any of these to a test counts as tampering
      "protectedPaths": [".github/workflows/", "tests/"]              // loosening these counts as tampering
    },
    "invariants": [                             // domain invariants the tests must assert and the clean-room critic checks
      "Every mutation is written through the audited write path (no direct table writes)."
    ],
    "uiSurfaces": ["web"]                       // surface names that count as UI; a task touching one triggers the Playwright tier
  }
}
```

## The sprint folder (passed on the command line, NOT in this config)

`/loop-engineering <sprintFolder> [description…]` operates on a folder holding two pages:

- **`implementation_plan.html`** — the sprint's task list + accumulated design/spec. It **renders itself** from the JSON
  in `<script id="plan-data" type="application/json">`:
  `{ sprint, title, description, generatedFrom, tasks: [ {id,title,goal,surfaces[],acceptance[],outOfScope[],dependsOn[],detailed,record} ] }`.
  When a task merges, the loop fills that task's `record` (`{pr,mergedAt,design,techSpec}`) and the page renders its
  design + technical spec underneath.
- **`implementation_status.html`** — live per-task status. It renders itself from the JSON in
  `<script id="status-data" type="application/json">`:
  `{ updated, currentCycle, tasks: { <id>: { status:"todo|in_progress|blocked|done", phase, branch, pr, mergedAt, note } }, log: [ {at,task,event} ], ledger: [ {at, task, entries:[{rootCauseClass, fix}]} ] }`.
  The loop edits ONLY these `<script>` JSON blocks; the markup repaints from them. The **`ledger`** is the cross-task
  failure memory (Tier 2): each task appends its defects+fixes, and the loop feeds the recent entries into the next
  task so the same class of bug isn't repeated.

If the folder/files are missing, the loop **generates** both from the description (templates live in `templates/` next
to this skill) and runs the sprint autonomously. If they exist, it **resumes** from the next ready task. The HTML pages
are committed to the repo as tracking commits (separate from task code), per `tracking.commit`.

## Field notes

- **Task shape** — `id` (stable, unique, e.g. `S1-T1`), `title`, `goal`, `surfaces` (names from `project.uiSurfaces`
  plus backend labels; array or `{name: bool}` map), `acceptance[]` (the seed contract — strings or `{id, text, verify}`
  objects), `outOfScope[]`, `dependsOn[]` (task ids), `detailed` (false = scaffold; the loop pauses and asks instead of
  building it unattended).
- **`project.rules` vs `implementationNotes`** — rules are *what must always hold* (architecture, security, style);
  implementationNotes are *how to operate this repo* (commands to run per stage). Both are injected into coder prompts.
- **`project.testing` (the three channels)** — the engine's Validate phase authors + runs **api**, **database**, and
  **ui** tests. `api`/`database` typically share one backend integration test (assert the response AND the
  persisted state). The **ui** channel is a **real-browser Playwright-MCP drive**: the agent loads the Playwright MCP
  browser tools (via ToolSearch) and clicks through the LIVE UI like a user — navigate → click/type/fill →
  `browser_take_screenshot` at the before/after states — asserting the on-screen result AND the persisted side-effect;
  it also authors a durable headless regression spec for CI, but the real-browser drive + screenshots is the required
  proof (a green CLI assertion alone is NOT enough). The **ui** channel runs only when a task's `surfaces` intersects
  `uiSurfaces` AND `testing.ui` is non-empty AND dev servers are up (else the headless spec is authored but the live
  drive is deferred, noted in the PR).
  Leave any channel `""` to skip it. The engine **designs a test matrix first** — several **happy, negative, AND edge**
  cases per channel, weighted toward cases that break the code — before writing any test; a happy-path-only suite is
  rejected by the clean-room critic. Phrase each channel's instructions to point at the negative/edge cases that matter
  here (auth/permission failures, constraint violations, soft-delete + re-read, cross-tenant isolation, idempotency).
- **`project.docs`** — drives the engine's Docs phase: after validation is green it updates these docs so they match the
  change; the edits are part of the reviewed/merged diff. Omit to just keep the `readFirst` docs accurate.
- **`project.invariants`** — the highest-leverage field. These feed (a) the test-author prompt (tests must assert them)
  and (b) the clean-room completeness critic (flags any mutation that violates them or leaves them untested). Write them
  as checkable statements about data/behavior, not vague principles.
- **`project.staticChecks`** — keep them read-only (`no --fix`); the engine treats any failure as validation-red.
- **`tracking.commit`** — set false when the base branch is protected; the plan/status page updates then ride on the
  task branch instead of the base branch.
- **`merge.highRiskPaths` / `highRiskPatterns` (Tier 1)** — the auto-merge risk gate. A task whose diff touches a
  high-risk path/pattern (schema/migrations/RLS, auth, money, infra, `.github/workflows/`, the loop's own config) — or
  that **deletes any file** — opens its PR but **pauses for a human OK** instead of auto-merging. "CI green" alone never
  auto-merges a high-risk change. Tune these to your repo's danger zones (they pair naturally with `project.forbidden`).
- **`project.testGuard` (Tier 1)** — drives the deterministic anti-tamper gate: after tests go green the engine diffs the
  test files and **fails the task** if an existing test/assertion was deleted/weakened, a `forbiddenMarkers` skip/only
  marker was added, or a `protectedPaths` file (CI especially) was loosened. Adding *new* tests is always fine. This is
  the load-bearing defense for unattended auto-merge — the merge trigger *is* the reward, so the coder is forbidden, and
  mechanically checked, from weakening its own gate.
- **`engine.maxTaskTokens` (Tier 1)** — optional per-task output-token ceiling. When hit mid-fix-loop the engine returns
  `needsHuman` (escalate) rather than grinding more rounds — more rounds raise reward-hacking, not correctness. Leave
  `null` to disable. (The Workflow's shared token budget still applies on top.)
- **`preflight.smokeTest` (Tier 2)** — a fast end-to-end command run on the fresh branch before each task; a red result
  means the base is already broken, so the loop pauses instead of stacking a new task on a broken tree.
