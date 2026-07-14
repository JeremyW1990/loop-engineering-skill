# `.claude/loop-engineering.json` — per-project config reference

One file at the **repo root** specializes the loop-engineering skill for a project. It holds project-level *facts*
(commands, infra, rules, test channels, docs) — **not** the tickets. The tickets + tracking live in a **numbered sprint
folder** (`<sprintsRoot>/sprint_N`, default root `docs/sprints`) that the loop auto-resolves (or you pass explicitly).
New work groups one related parent feature or large product ticket in exactly one indexed feature/program folder. All
internal implementation-ticket and subtask plan/status pages are flat files inside it (see "The sprint folder" below).

The loop master (SKILL.md) consumes the top-level sections; the `project` object is passed **verbatim** to
`task-flow.mjs` as `args.project`.

Every field has a sensible default — start minimal and grow it. `examples/example.json` is a complete worked example
(a Node/TypeScript API + Postgres via Prisma + a web frontend, with Vitest + Playwright test tiers).

```jsonc
{
  // ── consumed by the loop master (SKILL.md) ──────────────────────────────
  "tracking": {
    "commit": true,                             // commit ticket/status page updates directly on the base branch (only if unprotected)
    "sprintsRoot": "docs/sprints",              // dir that holds the numbered sprint_N folders; the loop auto-resolves the highest N (sprint_0 if none)
    "layout": "program-folder",                 // one indexed feature/program folder; flat ticket/subtask pages inside
    "index": "index.html"                       // required program traceability page
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
      "ports": [3000]                           // servers must be UP for a UI ticket; failure blocks that ticket before code
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
    "testing": {                                // the validation channels (empty string ⇒ skip that channel)
      "api":      "How to author + run API/integration tests: location, runner command, what to assert (responses, error cases).",
      "database": "How to assert resulting DB state in the same test: which tables/rows/audit logs, soft-delete semantics, no-drift checks.",
      "ui":       "",                           // real-browser Playwright-MCP UI instructions (which page/flow to drive + screenshot); empty = project has no UI tier
      "design":   ""                            // accessibility + current screenshot evidence always block UI merges; string = advisory brand/voice guidance; false disables advisory critique/copy only
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

## The sprint folder (auto-resolved, NOT in this config)

`/loop-engineering [sprintsRootOrFolder] [description…]` operates on a **numbered sprint folder**. The loop resolves it:
if you pass a specific `sprint_*` folder it uses that; otherwise it lists `<sprintsRoot>/sprint_*` (root =
`tracking.sprintsRoot`, default `docs/sprints`) and takes the **highest N** — `sprint_0` if none exist yet. Bootstrap and
resume both target that current sprint; to start a fresh one, create `<sprintsRoot>/sprint_<N+1>` yourself.

Inside a sprint folder, one related parent feature or large product ticket gets **exactly one direct feature/program
folder**:

```text
docs/sprints/sprint_N/
  feature_program_slug/
    index.html
    sN-t1-ticket_slug_plan.html
    sN-t1-ticket_slug_status.html
    sN-t1-st1-subtask_slug_plan.html
    sN-t1-st1-subtask_slug_status.html
```

- `index.html` renders from `program-data` and traces every internal implementation ticket, dependency, status,
  branch/PR/merge, and subtask.
- Ticket and subtask plans render from `plan-data`; status pages render from `status-data`.
- All plan/status pages are flat direct children of the program folder. Never create nested ticket or subtask folders.
- Deterministic names are `{ticket-id-lower}-{ticket-slug}_{plan|status}.html` and
  `{subtask-id-lower}-{subtask-slug}_{plan|status}.html`.
- An internal implementation ticket remains the merge unit: one branch, one PR, and one risk-gated merge. Subtasks ship
  within that PR. Branch/PR boundaries do not create documentation folders.
- The loop edits only embedded JSON blocks, then refreshes and validates `index.html` with
  `scripts/loop_pages.py`. Templates live in `assets/templates/`.
- Legacy ticket-folder, flat-ticket, and monolithic layouts remain readable, but new work always uses the indexed
  program-folder layout and never silently migrates old pages.

## Field notes

- **Ticket shape** — `id` (stable, unique, e.g. `S1-T1`), `title`, `goal`, `surfaces` (names from `project.uiSurfaces`
  plus backend labels; array or `{name: bool}` map), `acceptance[]` (the seed contract, the union of its subtasks'
  slices — strings or `{id, text, verify}` objects), `outOfScope[]`, `dependsOn[]` (other **ticket** ids), `detailed`
  (false = scaffold; the loop pauses and asks instead of building it unattended), and `subtasks[]` — the plan
  decomposition: each `{ id (e.g. `S1-T1-ST1`), slug (unique kebab-case within the program folder), title, goal,
  acceptance[] }`. The ticket is the merge unit; every subtask ships in the
  ticket's one PR (never a PR per subtask). A tiny ticket may have a single subtask.
- **`project.rules` vs `implementationNotes`** — rules are *what must always hold* (architecture, security, style);
  implementationNotes are *how to operate this repo* (commands to run per stage). Both are injected into coder prompts.
- **`project.testing` (the three channels)** — the engine's Validate phase authors + runs **api**, **database**, and
  **ui** tests. `api`/`database` typically share one backend integration test (assert the response AND the
  persisted state). The **ui** channel is a **real-browser Playwright-MCP drive**: the agent loads the Playwright MCP
  browser tools (via ToolSearch) and clicks through the LIVE UI like a user — navigate → click/type/fill →
  `browser_take_screenshot` at the before/after states — asserting the on-screen result AND the persisted side-effect;
  it also authors a durable headless regression spec for CI, but the real-browser drive + screenshots is the required
  proof (a green CLI assertion alone is NOT enough). When a task's `surfaces` intersects `uiSurfaces`, `testing.ui`
  must be non-empty and the configured dev servers must be up. Otherwise the ticket is blocked before code; a headless
  spec can document future coverage but cannot satisfy verification or permit merge.
  Leave API/database channels `""` to skip them when they are genuinely irrelevant. Do not leave `ui` empty for a task
  that touches a configured UI surface. The engine **designs a test matrix first** — several **happy, negative, AND edge**
  cases per channel, weighted toward cases that break the code — before writing any test; a happy-path-only suite is
  rejected by the clean-room critic. Phrase each channel's instructions to point at the negative/edge cases that matter
  here (auth/permission failures, constraint violations, soft-delete + re-read, cross-tenant isolation, idempotency).
- **`project.testing.design` (the design/UX gate)** — when the **ui** channel runs (UI surface touched + servers up), the
  engine also reviews the real-browser **screenshots** across three general product-design lenses: **accessibility**
  (`design:accessibility-review`, WCAG AA) is a **BLOCKING** gate — a clear AA failure fails validation; **design-critique**
  (hierarchy, state-legibility, empty/error states) + **ux-copy** (status labels, CTAs, empty states, errors) are
  **ADVISORY** — surfaced in the PR body's "Design & UX review" section, never blocking the merge. The Design phase also
  applies this lens up front, folding the UX intent + key strings into the acceptance criteria. Current-ticket
  screenshots and the accessibility review can never be disabled for a UI ticket. Set `testing.design` to a string for
  advisory brand/voice guidance, or `false` to suppress only advisory critique/copy; the evidence and accessibility
  gates still run.
- **`project.docs`** — drives the engine's Docs phase: after validation is green it updates these docs so they match the
  change; the edits are part of the reviewed/merged diff. Omit to just keep the `readFirst` docs accurate.
- **`project.invariants`** — the highest-leverage field. These feed (a) the test-author prompt (tests must assert them)
  and (b) the clean-room completeness critic (flags any mutation that violates them or leaves them untested). Write them
  as checkable statements about data/behavior, not vague principles.
- **`project.staticChecks`** — keep them read-only (`no --fix`); the engine treats any failure as validation-red.
- **`tracking.commit`** — set false when the base branch is protected; the ticket/status page updates then ride on the
  task branch instead of the base branch.
- **`tracking.layout`** — use `program-folder`: exactly one indexed feature/program folder for a related parent
  feature, with all implementation-ticket and subtask pages flat inside it. Legacy layouts are read-only compatibility.
- **`tracking.index`** — the program index filename. Use `index.html`.
- **`tracking.sprintsRoot`** — the directory holding the numbered `sprint_N` folders (default `docs/sprints`). When you
  run `/loop-engineering` without a path, the loop resolves the current sprint as the highest-numbered `sprint_N` here
  (`sprint_0` if none). Pass a specific `sprint_*` folder on the command line to override.
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
