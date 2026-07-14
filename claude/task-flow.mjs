export const meta = {
  name: 'loop-task-flow',
  description:
    'Per-ticket loop-engineering engine: recon → design (the "done" contract) → technical spec (the file-level engineering plan) → code (drift-plan → clean-cutover implement) → validate (DESIGN happy/negative/edge test cases, then author+run them across API + database + a REAL-BROWSER Playwright-MCP UI drive that clicks through the live UI and screenshots it, loop-until-green) → docs (update affected project documentation) → clean-room verify. May PAUSE before coding and return open questions for a human (needsHuman) — asking is encouraged. Project-agnostic: all project specifics arrive via args.project (see CONFIG.md next to this script). Leaves changes in the working tree and returns a verified/blocked/needsHuman report + the design + technical spec + a PR body. Called once per ticket by the /loop-engineering master.',
  whenToUse:
    'One scoped task from a sprint plan. Pass the task spec via args.task (id, title, goal, surfaces, acceptance[], outOfScope[], dependsOn[]) and the project config via args.project. Run standalone for a manual single task.',
  phases: [
    { title: 'Recon', detail: 'parallel read-only readers map the current code vs the target state — batched reads + distilled summaries (context-budgeted)' },
    { title: 'Design', detail: 'one synthesizer writes the contract: core/data-model/surface changes, build-green stages, acceptance criteria' },
    { title: 'Tech Spec', detail: 'one engineer writes the file-level technical spec: exact files/functions, API/endpoint signatures, schema DDL, sequencing, edge cases' },
    { title: 'Code', detail: 'code-plan (analyze drift; clean-cutover plan that removes stale code FIRST) → code-implement (sequential single-writer; each stage build-green)' },
    { title: 'Validate', detail: 'DESIGN the test matrix first (happy + negative + edge per channel — cases that try to BREAK the code), then author + run them across API / database / UI — the UI channel drives a REAL browser via the Playwright MCP (click + screenshot), not just headless CLI specs; loop with Code until green (capped); then the read-only static gate' },
    { title: 'Docs', detail: 'update the project documentation the change affects (architecture/data-model/CLAUDE.md/READMEs), part of the reviewed diff' },
    { title: 'Verify', detail: 'CLEAN-ROOM independent check — sees only {contract, git diff, PR body}, never the coder transcript; adversarial refute per criterion + completeness critic' },
  ],
}

// ───────────────────────── schemas ─────────────────────────
const RECON_SCHEMA = {
  type: 'object',
  properties: {
    area: { type: 'string' },
    findings: { type: 'array', items: { type: 'object', properties: { ref: { type: 'string' }, fact: { type: 'string' } }, required: ['ref', 'fact'] } },
    currentVsTarget: { type: 'string' },
    gaps: { type: 'array', items: { type: 'string' } },
    recommendations: { type: 'array', items: { type: 'string' } },
  },
  required: ['area', 'findings', 'currentVsTarget', 'gaps'],
}

const DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    core: { type: 'string', description: 'what changes in the core implementation (services, engines, business logic, APIs)' },
    dataModel: { type: 'string', description: 'schema / migration / persistence-policy changes, or "none"' },
    surfaces: {
      type: 'array',
      description: 'per UI surface (app/frontend) what changes; omit or use changes:"none" for untouched surfaces',
      items: { type: 'object', properties: { name: { type: 'string' }, changes: { type: 'string' } }, required: ['name', 'changes'] },
    },
    ux: {
      type: 'object',
      description: 'UX/flow design intent — fill ONLY when a UI surface is touched (otherwise omit). The design-critique + ux-copy lens applied up front so UX is part of the contract, not an afterthought.',
      properties: {
        flow: { type: 'string', description: 'the intended user flow + state legibility: at each state can the user tell what just happened / whose turn / what to do next' },
        states: { type: 'array', items: { type: 'string' }, description: 'the UI states this must handle: empty, loading, error, success, and any edge (e.g. dead/expired/zero) states' },
        copy: { type: 'array', description: 'key strings decided up front (empty states, CTA + status labels, error messages)', items: { type: 'object', properties: { element: { type: 'string' }, text: { type: 'string' } }, required: ['element', 'text'] } },
      },
    },
    stages: {
      type: 'array', minItems: 1, maxItems: 8,
      items: {
        type: 'object',
        properties: { key: { type: 'string' }, title: { type: 'string' }, focus: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, commands: { type: 'array', items: { type: 'string' } } },
        required: ['key', 'title', 'focus'],
      },
    },
    acceptanceCriteria: {
      type: 'array', minItems: 1,
      items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' }, verify: { type: 'string' } }, required: ['id', 'text'] },
    },
    testPlan: { type: 'object', properties: { api: { type: 'string' }, database: { type: 'string' }, ui: { type: 'string' } } },
    risks: { type: 'array', items: { type: 'string' } },
    outOfScope: { type: 'array', items: { type: 'string' } },
    needsHuman: { type: 'boolean', description: 'true if a genuine ambiguity / product / scope decision should be resolved by a human BEFORE coding — set this instead of guessing' },
    openQuestions: { type: 'array', description: 'precise questions for the human (only when needsHuman)', items: { type: 'object', properties: { question: { type: 'string' }, why: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } }, required: ['question'] } },
  },
  required: ['summary', 'core', 'stages', 'acceptanceCriteria'],
}

// the file-level engineering spec — the "how" that the coder implements against
const TECH_SPEC_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'one-paragraph technical approach' },
    fileChanges: {
      type: 'array', minItems: 1,
      description: 'every file to add/modify/delete with the concrete change',
      items: { type: 'object', properties: { path: { type: 'string' }, change: { type: 'string', enum: ['add', 'modify', 'delete'] }, detail: { type: 'string' } }, required: ['path', 'change', 'detail'] },
    },
    apiContracts: {
      type: 'array',
      description: 'new/changed API endpoints, tRPC procedures, CLI commands, or public functions — signature + behavior + which surface',
      items: { type: 'object', properties: { surface: { type: 'string' }, name: { type: 'string' }, signature: { type: 'string' }, behavior: { type: 'string' } }, required: ['name', 'behavior'] },
    },
    dataModel: { type: 'string', description: 'concrete schema/migration DDL (table/column/index names, types), persistence policy, or "none"' },
    sequencing: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'ordered implementation steps the coder will follow' },
    edgeCases: { type: 'array', items: { type: 'string' }, description: 'edge cases + error handling the implementation must cover' },
    testStrategy: { type: 'object', properties: { api: { type: 'string' }, database: { type: 'string' }, ui: { type: 'string' } }, description: 'how each channel will prove the criteria' },
    docsToUpdate: { type: 'array', items: { type: 'string' }, description: 'documentation files this change will need to update' },
    risks: { type: 'array', items: { type: 'string' } },
    needsHuman: { type: 'boolean', description: 'true if a genuine ambiguity / product / scope decision should be resolved by a human BEFORE coding — set this instead of guessing' },
    openQuestions: { type: 'array', description: 'precise questions for the human (only when needsHuman)', items: { type: 'object', properties: { question: { type: 'string' }, why: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } }, required: ['question'] } },
  },
  required: ['summary', 'fileChanges', 'sequencing'],
}

const IMPLEMENT_SCHEMA = {
  type: 'object',
  properties: {
    stage: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    commandsRun: { type: 'array', items: { type: 'object', properties: { cmd: { type: 'string' }, ok: { type: 'boolean' }, detail: { type: 'string' } }, required: ['cmd', 'ok'] } },
    buildGreen: { type: 'boolean' },
    followups: { type: 'array', items: { type: 'string' } },
    blocked: { type: 'boolean' },
    blockReason: { type: 'string' },
  },
  required: ['stage', 'filesChanged', 'summary', 'buildGreen'],
}

const CODE_PLAN_SCHEMA = {
  type: 'object',
  properties: {
    driftSummary: { type: 'string', description: 'what currently exists that is stale/obsolete/conflicting vs the target state for this task' },
    cleanup: { type: 'array', items: { type: 'object', properties: { what: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, reason: { type: 'string' } }, required: ['what', 'reason'] } },
    stages: {
      type: 'array', minItems: 1,
      items: { type: 'object', properties: { key: { type: 'string' }, title: { type: 'string' }, kind: { type: 'string', enum: ['cleanup', 'implement'] }, focus: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, commands: { type: 'array', items: { type: 'string' } } }, required: ['key', 'title', 'focus'] },
    },
    notes: { type: 'string', description: 'drift OUTSIDE this task scope to flag as followups (do not clean here)' },
  },
  required: ['driftSummary', 'stages'],
}

// the test MATRIX — designed BEFORE any test is authored; never happy-path-only
const TEST_DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    cases: {
      type: 'array', minItems: 1,
      description: 'concrete test cases across channels and categories — several per category, weighted toward cases that try to BREAK the code',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          channel: { type: 'string', enum: ['api', 'database', 'ui'] },
          category: { type: 'string', enum: ['happy', 'negative', 'edge'] },
          title: { type: 'string' },
          intent: { type: 'string' },
          expected: { type: 'string', description: 'the asserted outcome (for negative cases: the CORRECT failure — right error, no write, no leak)' },
        },
        required: ['channel', 'category', 'title', 'expected'],
      },
    },
    coverageNotes: { type: 'string', description: 'why the matrix is sufficient; explicitly justify any category/channel deliberately skipped' },
    needsHuman: { type: 'boolean' },
    openQuestions: { type: 'array', items: { type: 'object', properties: { question: { type: 'string' }, why: { type: 'string' } }, required: ['question'] } },
  },
  required: ['cases', 'coverageNotes'],
}

const TEST_SCHEMA = {
  type: 'object',
  properties: {
    channels: { type: 'array', items: { type: 'string' }, description: 'which channels this report covers: api, database, ui' },
    files: { type: 'array', items: { type: 'string' } },
    authored: { type: 'boolean' },
    executed: { type: 'boolean' },
    passed: { type: 'boolean' },
    summary: { type: 'string' },
    failures: { type: 'array', items: { type: 'string' } },
    output: { type: 'string' },
  },
  required: ['channels', 'files', 'authored', 'executed', 'passed', 'summary'],
}

const VALIDATION_SCHEMA = {
  type: 'object',
  properties: { command: { type: 'string' }, pass: { type: 'boolean' }, summary: { type: 'string' }, failures: { type: 'array', items: { type: 'string' } } },
  required: ['command', 'pass', 'summary'],
}

// design/UX review of the BUILT UI (run on the real-browser screenshots): accessibility is a BLOCKING gate,
// design-critique + ux-copy are ADVISORY (surfaced in the PR body, never block the merge).
const DESIGN_REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    screenshots: { type: 'array', minItems: 1, items: { type: 'string' }, description: 'current-ticket screenshot files actually reviewed; must come from the test report' },
    a11y: {
      type: 'object',
      description: 'objective accessibility (WCAG AA) — the ONLY blocking lens',
      properties: {
        pass: { type: 'boolean', description: 'false if any clear WCAG AA failure is visible (contrast, touch target, legibility, missing labels/focus)' },
        violations: { type: 'array', items: { type: 'object', properties: { rule: { type: 'string' }, where: { type: 'string' }, detail: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'warning'] } }, required: ['rule', 'detail'] } },
      },
      required: ['pass'],
    },
    critique: { type: 'array', description: 'ADVISORY usability / hierarchy / consistency / state-legibility findings (design-critique lens)', items: { type: 'object', properties: { finding: { type: 'string' }, where: { type: 'string' }, severity: { type: 'string', enum: ['high', 'medium', 'low'] }, recommendation: { type: 'string' } }, required: ['finding'] } },
    copy: { type: 'array', description: 'ADVISORY microcopy findings (ux-copy lens): empty states, status labels, CTAs, error messages', items: { type: 'object', properties: { element: { type: 'string' }, current: { type: 'string' }, recommended: { type: 'string' }, why: { type: 'string' } }, required: ['recommended'] } },
    summary: { type: 'string' },
  },
  required: ['screenshots', 'a11y', 'critique', 'copy', 'summary'],
}

const FIX_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    addressed: { type: 'array', items: { type: 'string' } },
    weakenedTests: { type: 'boolean', description: 'true if any test/assertion was deleted or loosened — this is a red flag' },
    typecheckGreen: { type: 'boolean' },
    blocked: { type: 'boolean' },
    blockReason: { type: 'string' },
  },
  required: ['summary', 'filesChanged', 'typecheckGreen'],
}

const DOCS_SCHEMA = {
  type: 'object',
  properties: {
    updated: { type: 'boolean', description: 'true if any documentation file was edited' },
    files: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    skipped: { type: 'boolean', description: 'true if the change genuinely needs no documentation update' },
    notes: { type: 'string' },
  },
  required: ['updated', 'files', 'summary'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: { criterionId: { type: 'string' }, met: { type: 'boolean' }, reason: { type: 'string' }, evidence: { type: 'string' } },
  required: ['criterionId', 'met', 'reason'],
}

const COMPLETENESS_SCHEMA = {
  type: 'object',
  properties: {
    coverageOk: { type: 'boolean' },
    testGamingSuspected: { type: 'boolean', description: 'true if the diff weakens/skips/games tests instead of fixing code' },
    missing: { type: 'array', items: { type: 'string' } },
    unverifiedClaims: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['coverageOk', 'missing'],
}

// anti-tamper gate (Tier 1) — did the coder weaken the verification surface to go green?
const TAMPER_SCHEMA = {
  type: 'object',
  properties: {
    tampered: { type: 'boolean', description: 'true if existing tests/assertions were deleted/weakened, a skip/only marker was added, or a protected path (CI config) was loosened' },
    testsDeletedOrWeakened: { type: 'boolean' },
    forbiddenMarkerAdded: { type: 'boolean' },
    protectedPathTouched: { type: 'boolean' },
    findings: { type: 'array', items: { type: 'string' }, description: 'concrete evidence lines from the diff' },
    summary: { type: 'string' },
  },
  required: ['tampered', 'summary'],
}

// held-out check (Tier 1) — an independent test the coder never saw, with perturbed inputs
const HELDOUT_SCHEMA = {
  type: 'object',
  properties: {
    authored: { type: 'boolean' },
    executed: { type: 'boolean' },
    passed: { type: 'boolean' },
    file: { type: 'string' },
    summary: { type: 'string' },
    failures: { type: 'array', items: { type: 'string' } },
    skippedReason: { type: 'string', description: 'why no held-out test was authored/run (e.g. docs-only change, UI task with servers down)' },
  },
  required: ['authored', 'passed', 'summary'],
}

// ───────────────────────── args / task spec / project config ─────────────────────────
let rawArgs = args
if (typeof rawArgs === 'string') { try { rawArgs = JSON.parse(rawArgs) } catch { rawArgs = undefined } }
const a = rawArgs && typeof rawArgs === 'object' ? rawArgs : {}

const REPO = a.repo
if (!REPO || typeof REPO !== 'string') throw new Error('args.repo (absolute path to the repository) is required')

const arr = (v, d) => (Array.isArray(v) && v.length ? v : d)
const str = (v, d) => (typeof v === 'string' && v.trim() ? v : d)

const T = a.task && typeof a.task === 'object' ? a.task : {}
const TASK = {
  id: str(T.id, 'ADHOC'),
  title: str(T.title, 'Ad-hoc task (no spec passed)'),
  goal: str(T.goal, str(T.summary, 'Implement the task described in the title; derive details from the project docs.')),
  surfaces: T.surfaces || T.scope || [],
  acceptance: arr(T.acceptance, []),
  outOfScope: arr(T.outOfScope, []),
  dependsOn: arr(T.dependsOn, []),
  subtasks: arr(T.subtasks, []),
}
const BRANCH = str(a.branch, `task/${TASK.id.toLowerCase()}`)
const SERVERS_UP = a.serversUp === true
const MAX_FIX_ROUNDS = Number.isInteger(a.maxFixRounds) ? a.maxFixRounds : 3
// human clarifications carried back from a prior pause (needsHuman) — answers to the engine's open questions
const rawClar = a.clarifications
const CLARIFICATIONS = Array.isArray(rawClar) ? rawClar.filter(Boolean) : (typeof rawClar === 'string' && rawClar.trim() ? [rawClar.trim()] : [])
// cross-task failure ledger (Tier 2) — defects + fixes from earlier tasks in this sprint, fed forward to avoid repeats
const LEDGER = arr(a.failureLedger, []).slice(-12)
// per-task token ceiling (Tier 1) — escalate to a human instead of grinding (more fix rounds raise hack-rate, not correctness)
const MAX_TASK_TOKENS = Number.isInteger(a.maxTaskTokens) && a.maxTaskTokens > 0 ? a.maxTaskTokens : null
const _budget = typeof budget !== 'undefined' && budget && typeof budget.spent === 'function' ? budget : null
const BUDGET0 = _budget ? _budget.spent() : 0
const taskSpend = () => (_budget ? _budget.spent() - BUDGET0 : 0)
const overTaskBudget = () => MAX_TASK_TOKENS !== null && taskSpend() >= MAX_TASK_TOKENS

// project config — everything project-specific lives here (see CONFIG.md)
const P = a.project && typeof a.project === 'object' ? a.project : {}
const Ptesting = P.testing && typeof P.testing === 'object' ? P.testing : {}
const PROJECT = {
  name: str(P.name, 'this project'),
  readFirst: arr(P.readFirst, ['CLAUDE.md (if present)', 'README.md (if present)']),
  rules: arr(P.rules, [
    'Match the surrounding code style; reuse existing helpers and patterns instead of inventing parallel ones.',
    'Replace, don’t accrete: when changing behavior, remove the code it obsoletes rather than leaving two paths.',
    'Keep the build, typecheck, and existing tests green at every stage.',
  ]),
  environment: arr(P.environment, []),
  forbidden: arr(P.forbidden, ['NEVER trigger a deploy or touch shared/staging/production infrastructure or databases.']),
  implementationNotes: arr(P.implementationNotes, [
    'Discover the right generate/typecheck/test commands from package.json / Makefile / CI config and run the ones relevant to your stage.',
  ]),
  reconAreas: arr(P.reconAreas, [
    { key: 'core', prompt: 'Map the core implementation this task touches (services, business logic, entry points). State current behavior with file:line refs and how it differs from the target state for THIS task.' },
    { key: 'data-model', prompt: 'Map the data model and persistence this task touches: schemas, migrations, stores, access patterns. What exists today vs what this task needs.' },
    { key: 'interfaces', prompt: 'Map the interfaces this task touches: APIs, routes, CLI entry points, UI components/pages that show or edit the affected data, and how they call the backend. If a surface is untouched by this task, say so explicitly.' },
    { key: 'tests-fixtures', prompt: 'Map the test patterns of this repo: where API/integration + database tests live and how they are run, the Playwright/UI setup if any, and existing fixtures/seeds useful for THIS task.' },
  ]),
  staticChecks: arr(P.staticChecks, [
    { label: 'checks', command: "Discover and run the project's lint, typecheck, and full test-suite commands (from package.json scripts, Makefile, or CI config)" },
  ]),
  // three validation channels: API, database, and UI (Playwright). Any empty string = that channel is skipped.
  testing: {
    api: str(Ptesting.api, str(Ptesting.unit, 'Author integration tests that exercise the affected API/endpoints with the repo’s test runner; assert success responses and error/edge cases.')),
    database: str(Ptesting.database, 'In the same backend test, assert the resulting database state directly: rows created/updated/soft-deleted, audit/log rows written, and no drift between layers.'),
    ui: str(Ptesting.ui, str(Ptesting.e2e, '')), // empty = no UI tier for this project
    // design/UX review lens — runs on the real-browser screenshots when a UI surface is touched + servers up.
    // accessibility is a BLOCKING gate; design-critique + ux-copy are ADVISORY (ride into the PR body).
    // string = extra project design guidance (brand/voice); false = disable the lens. Default: on when UI runs.
    design: Ptesting.design === false ? false : str(Ptesting.design, ''),
  },
  // documentation the engine should keep in sync (files/globs + how). Empty = just keep readFirst docs accurate.
  docs: arr(P.docs, []),
  // anti-tamper (Tier 1): the coder must NOT weaken the verification surface. These defaults catch the common cases.
  testGuard: {
    testGlobs: arr(P.testGuard && P.testGuard.testGlobs, ['**/*.test.*', '**/*.spec.*', '**/test/**', '**/tests/**', '**/__tests__/**']),
    forbiddenMarkers: arr(P.testGuard && P.testGuard.forbiddenMarkers, ['.skip(', '.only(', 'xit(', 'xdescribe(', 'test.skip', 'it.skip', 'describe.skip', '@pytest.mark.skip']),
    protectedPaths: arr(P.testGuard && P.testGuard.protectedPaths, ['.github/workflows/', 'tests/', 'test/']),
  },
  invariants: arr(P.invariants, []),
  uiSurfaces: arr(P.uiSurfaces, []),
}

// which surfaces does this task touch? (drives whether the UI/Playwright tier runs)
const surfaceNames = Array.isArray(TASK.surfaces)
  ? TASK.surfaces.map((s) => String(s))
  : TASK.surfaces && typeof TASK.surfaces === 'object'
    ? Object.keys(TASK.surfaces).filter((k) => TASK.surfaces[k])
    : []
const touchesUI = a.touchesUI === true ||
  (PROJECT.uiSurfaces.length > 0 && surfaceNames.some((s) => PROJECT.uiSurfaces.includes(s)))
const UI_ENABLED = touchesUI && !!PROJECT.testing.ui
const BACKEND_ENABLED = !!PROJECT.testing.api || !!PROJECT.testing.database

const BASE = `You are working in the ${PROJECT.name} repository at ${REPO}, on branch \`${BRANCH}\` (already checked out by the orchestrator — do NOT switch or create branches, do NOT commit, push, or merge).

READ FIRST (authoritative):
${PROJECT.readFirst.map((s) => '  - ' + s).join('\n')}

This is task ${TASK.id}: ${TASK.title}
GOAL: ${TASK.goal}
SUBTASKS (internal checkpoints that ship in this ticket's one PR):
${(TASK.subtasks.length ? TASK.subtasks : ['(none specified)']).map((s) => '  - ' + (typeof s === 'string' ? s : JSON.stringify(s))).join('\n')}
OUT OF SCOPE (do NOT do these — note as followups if tempted):
${(TASK.outOfScope.length ? TASK.outOfScope : ['(none specified)']).map((s) => '  - ' + s).join('\n')}

NON-NEGOTIABLE PROJECT RULES:
${PROJECT.rules.map((s) => '  - ' + s).join('\n')}
${PROJECT.environment.length ? '\nENVIRONMENT:\n' + PROJECT.environment.map((s) => '  - ' + s).join('\n') : ''}
  - Dev servers are ${SERVERS_UP ? 'UP' : 'DOWN'}.
${PROJECT.forbidden.map((s) => '  - ' + s).join('\n')}${CLARIFICATIONS.length ? '\n\nHUMAN CLARIFICATIONS (answers to earlier open questions — honor these; do NOT re-ask them):\n' + CLARIFICATIONS.map((c) => '  - ' + (typeof c === 'string' ? c : `${c.question} → ${c.answer}`)).join('\n') : ''}${LEDGER.length ? '\n\nLEARNINGS FROM EARLIER TASKS IN THIS SPRINT (do not repeat these defects):\n' + LEDGER.map((e) => '  - ' + (typeof e === 'string' ? e : `[${e.rootCauseClass || e.task || 'past'}] ${e.fix || e.summary || JSON.stringify(e)}`)).join('\n') : ''}`

const IMPL_RULES = `  - Implement ONLY the current stage. Prior stages are already applied in the working tree — build on them, don't redo them.
  - After editing, RUN the generate/typecheck/test relevant to your stage; report each in commandsRun with ok + a short detail.
  - Finish typecheck-green for the packages/modules you touched. If you genuinely cannot, set blocked=true + blockReason and stop.
  - Do NOT mask failures: no broad try/catch or success-shaped fallbacks that swallow errors — surface/propagate them explicitly.
  - Before finishing: reconcile every TODO you opened (resolve it, or record it in followups as blocked/cancelled with a reason), and WIRE the change across ALL relevant surfaces so behavior stays consistent — no half-wired changes.
  - Do NOT expand scope beyond this task; if you spot adjacent work, record it in followups (backlog) instead of doing it.
${PROJECT.implementationNotes.map((s) => '  - ' + s).join('\n')}
  - Do NOT commit/push/switch branches or start dev servers.`

// ───────────────────────── Phase 1 · Recon ─────────────────────────
phase('Recon')
log(`${TASK.id} — recon (touchesUI=${touchesUI}, ui=${UI_ENABLED}, backend=${BACKEND_ENABLED}, serversUp=${SERVERS_UP}, maxFixRounds=${MAX_FIX_ROUNDS})`)
const recon = (
  await parallel(
    PROJECT.reconAreas.map((area) => () =>
      agent(
        `${BASE}\n\nRECON AREA: ${area.key}\n${area.prompt}\n\nTASK ACCEPTANCE CRITERIA (seed):\n${JSON.stringify(TASK.acceptance, null, 2)}\n\nCONTEXT BUDGET: decide ALL the files/symbols you need up front and read them in ONE parallel batch — do NOT read one file at a time. Truncate large files/logs to the relevant section (~10k chars, head+tail). Return a DISTILLED ~1–2k-token map (paths + facts), not raw file dumps.\n\nReturn a precise current-vs-target map: concrete findings (file:line + fact), what differs from the target state, and the gaps this task must close. Read excerpts only; modify nothing.`,
        { label: `recon:${area.key}`, phase: 'Recon', agentType: 'Explore', schema: RECON_SCHEMA },
      ),
    ),
  )
).filter(Boolean)

// ───────────────────────── Phase 2 · Design (the "done" contract) ─────────────────────────
phase('Design')
const design = await agent(
  `${BASE}\n\nRECON FINDINGS:\n${JSON.stringify(recon, null, 2)}\n\nSEED ACCEPTANCE CRITERIA (authoritative — you may REFINE wording + add concrete verify commands, but do NOT weaken or drop any; add more if the task needs them):\n${JSON.stringify(TASK.acceptance, null, 2)}\n\nProduce the DESIGN CONTRACT for this ONE task — the "what + why". Define explicitly:\n  - core: what changes in the core implementation (services, business logic, APIs) with file pointers.\n  - dataModel: schema/migration/persistence changes, or "none".\n  - surfaces: per UI surface what changes, or "none" for untouched surfaces. (Known UI surfaces of this project: ${PROJECT.uiSurfaces.length ? PROJECT.uiSurfaces.join(', ') : '(none declared)'}; scope hint from the plan: ${JSON.stringify(TASK.surfaces)}.)\n  - ux: ${UI_ENABLED ? 'a UI surface is touched — apply the **design:design-critique** + **design:ux-copy** lens to the PLANNED design: define flow (state legibility — at each state can the user tell what just happened / whose turn / what to do next), the states to handle (empty / loading / error / success / edge), and the key strings up front (empty states, CTA + status labels, error messages). Fold the important UX + copy expectations into acceptanceCriteria so they are verified, not optional.' : 'no UI surface touched — set to none / omit.'}\n  - stages: ORDERED, build-green stages (each = a coherent chunk one engineer applies leaving typecheck-green; later depend on earlier), with key/title/focus/files/verify-commands.\n  - acceptanceCriteria: the final contract (refined seeds + any additions), each with a concrete verify command.\n  - testPlan: api (endpoint/integration assertions), database (state/persistence assertions), ui (${UI_ENABLED ? 'a UI surface is touched — include a Playwright plan' : 'only if a UI surface is touched; otherwise "none"'}).\n  - risks + outOfScope.\nThis contract is the pre-agreed definition of done; it will be checked by an INDEPENDENT verifier later. Do NOT write code yet.\n\nHUMAN-IN-THE-LOOP: if anything material is genuinely ambiguous — conflicting/contradictory requirements, an unclear acceptance criterion, or a product/scope decision only a human should make — set needsHuman=true and list precise openQuestions (each with why + concrete options) INSTEAD of guessing. The loop will PAUSE and ask a human before any code is written. Asking is encouraged, never a failure; reserve it for real blockers, not trivia resolvable from the docs.`,
  { label: 'design', phase: 'Design', agentType: 'general-purpose', schema: DESIGN_SCHEMA },
)
log(`design: ${design.stages.length} stages — ${design.stages.map((s) => s.key).join(' → ')} · ${design.acceptanceCriteria.length} criteria`)

// human gate — PAUSE before coding if design surfaced genuine questions
if (design.needsHuman || (design.openQuestions && design.openQuestions.length)) {
  log(`PAUSE — design raised ${(design.openQuestions || []).length} question(s) for a human`)
  return {
    task: { id: TASK.id, title: TASK.title, branch: BRANCH },
    verified: false, blocked: false, needsHuman: true, pausedAt: 'design',
    questions: design.openQuestions || [],
    design: { summary: design.summary, core: design.core, dataModel: design.dataModel, surfaces: design.surfaces, acceptanceCriteria: design.acceptanceCriteria },
  }
}

// ───────────────────────── Phase 3 · Technical Spec (the "how") ─────────────────────────
// Turn the design contract into a concrete, file-level engineering spec the coder implements against.
phase('Tech Spec')
const techSpec = await agent(
  `${BASE}\n\nDESIGN CONTRACT (the what + why — authoritative):\n${JSON.stringify(design, null, 2)}\n\nRECON (current code, with file:line refs):\n${JSON.stringify(recon, null, 2)}\n\nYou are the TECHNICAL SPEC agent. Turn the design contract into a concrete, file-level engineering specification the coder will implement against — the "how". You may read the repo to ground every reference in real files/symbols. Produce:\n  - summary: the technical approach in one paragraph.\n  - fileChanges: EVERY file to add/modify/delete, each with the concrete change (functions/components/exports affected). Be specific — real paths from the repo.\n  - apiContracts: each new/changed endpoint, procedure, CLI command, or public function — name, signature, behavior, and which surface it belongs to. (Known surfaces: ${PROJECT.uiSurfaces.length ? PROJECT.uiSurfaces.join(', ') : '(none declared)'}.)\n  - dataModel: concrete schema/migration DDL (table/column/index names + types) and persistence policy, or "none".\n  - sequencing: the ordered implementation steps (clean up stale code first, then build).\n  - edgeCases: edge cases + error handling the implementation MUST cover.\n  - testStrategy: how each channel will prove the criteria — api, database, ui (Playwright).\n  - docsToUpdate: documentation files this change will need to touch.\n  - risks.\nDo NOT write code — produce only the spec. It is persisted into the sprint plan as the task's technical record.\n\nHUMAN-IN-THE-LOOP: if the implementation hinges on a genuine ambiguity or a decision only a human should make (an unclear integration point, an unspecified behavior with materially different options, a risky/irreversible choice), set needsHuman=true with precise openQuestions instead of guessing — the loop PAUSES and asks before coding.`,
  { label: 'tech-spec', phase: 'Tech Spec', agentType: 'general-purpose', schema: TECH_SPEC_SCHEMA },
)
log(`tech-spec: ${techSpec.fileChanges.length} file change(s), ${(techSpec.apiContracts || []).length} api contract(s), ${techSpec.sequencing.length} step(s)`)

// human gate — PAUSE before coding if the technical spec surfaced genuine questions
if (techSpec.needsHuman || (techSpec.openQuestions && techSpec.openQuestions.length)) {
  log(`PAUSE — tech-spec raised ${(techSpec.openQuestions || []).length} question(s) for a human`)
  return {
    task: { id: TASK.id, title: TASK.title, branch: BRANCH },
    verified: false, blocked: false, needsHuman: true, pausedAt: 'tech-spec',
    questions: techSpec.openQuestions || [],
    design: { summary: design.summary, core: design.core, dataModel: design.dataModel, surfaces: design.surfaces, acceptanceCriteria: design.acceptanceCriteria },
    techSpec: { summary: techSpec.summary, fileChanges: techSpec.fileChanges, sequencing: techSpec.sequencing },
  }
}

// ───────────────────────── Phase 4 · Code (code-plan → code-implement) ─────────────────────────
// For changes to an existing codebase, PLAN the drift + a clean cutover BEFORE writing code.
// code-plan analyzes what has drifted and orders REMOVAL of stale code first; code-implement then executes
// stage-by-stage (sequential single writer, each stage ends build-green).
phase('Code')
const codePlan = await agent(
  `${BASE}\n\nDESIGN CONTRACT:\n${JSON.stringify(design, null, 2)}\n\nTECHNICAL SPEC (file-level plan — authoritative for what to change):\n${JSON.stringify(techSpec, null, 2)}\n\nRECON (current code):\n${JSON.stringify(recon, null, 2)}\n\nYou are the CODE-PLAN agent. The codebase is already implemented and this task changes part of it. Before ANY new code is written, analyze what has DRIFTED from the target state for this task's area, then produce a CLEAN-CUTOVER execution plan:\n  - driftSummary: what currently exists that is stale / obsolete / conflicting vs the target state for THIS task.\n  - cleanup[]: the specific stale code to REMOVE or gut FIRST (file + reason). Replace, don't accrete a second parallel path (no compat shims unless the task explicitly calls for them).\n  - stages[]: an ORDERED list where cleanup/replacement comes before pure additions. Tag each stage kind='cleanup' or 'implement'. CONSTRAINT: each stage must end BUILD-GREEN, so when a pure deletion would break types/build, pair the deletion with its replacement in the SAME stage. Give key/title/focus/files/verify-commands per stage. Cover everything in the technical spec's fileChanges + sequencing.\n  - notes: any drift OUTSIDE this task's scope — flag it as a followup, do NOT clean it here.\nStay within this task's scope. Do NOT write code — produce only the plan.`,
  { label: 'code-plan', phase: 'Code', agentType: 'general-purpose', schema: CODE_PLAN_SCHEMA },
)
const codeStages = codePlan.stages && codePlan.stages.length ? codePlan.stages : design.stages
log(`code-plan: ${(codePlan.cleanup || []).length} cleanup item(s) → ${codeStages.length} stage(s) [${codeStages.map((s) => s.kind || 'implement').join(', ')}]`)

const implementReports = []
let codeBlocked = null
for (let i = 0; i < codeStages.length; i++) {
  const stage = codeStages[i]
  const prior = implementReports.map((r) => ({ stage: r.stage, summary: r.summary, filesChanged: r.filesChanged, buildGreen: r.buildGreen, followups: r.followups }))
  const isCleanup = (stage.kind || 'implement') === 'cleanup'
  const rep = await agent(
    `${BASE}\n\nDESIGN CONTRACT:\n${JSON.stringify(design, null, 2)}\n\nTECHNICAL SPEC:\n${JSON.stringify(techSpec, null, 2)}\n\nCODE PLAN (drift + clean-cutover, from code-plan):\n${JSON.stringify(codePlan, null, 2)}\n\nPRIOR STAGES (already applied — do not redo):\n${JSON.stringify(prior, null, 2)}\n\n>>> CODE-IMPLEMENT THIS STAGE NOW (${i + 1}/${codeStages.length}): ${stage.key} — ${stage.title} [${stage.kind || 'implement'}]\n${isCleanup ? 'This is a CLEANUP stage: REMOVE/gut the obsolete code per the plan, replacing it inline so the build stays green — do not leave both the old and new path in place.\n' : ''}Focus: ${stage.focus}\nLikely files: ${(stage.files || []).join(', ') || '(discover them)'}\nVerify commands: ${(stage.commands || []).join(' ; ') || '(choose the right generate/typecheck/test)'}\n\nHARD RULES:\n${IMPL_RULES}`,
    { label: `code-implement:${stage.key}`, phase: 'Code', agentType: 'general-purpose', schema: IMPLEMENT_SCHEMA },
  )
  implementReports.push(rep)
  log(`stage ${i + 1}/${codeStages.length} ${stage.key}: ${rep.buildGreen ? 'GREEN' : 'not green'}${rep.blocked ? ' — BLOCKED' : ''}`)
  if (rep.blocked) { codeBlocked = `${stage.key}: ${rep.blockReason || '(no reason)'}`; log(`BLOCKED — stopping code phase`); break }
}

// ───────────────────────── Phase 5 · Validate (UI / API / database, loop-until-green) ─────────────────────────
phase('Validate')
const uiClause = UI_ENABLED
  ? (SERVERS_UP
      ? `UI (REAL-BROWSER Playwright MCP — drive a live browser, NOT just headless CLI specs): load the Playwright MCP browser tools via ToolSearch (query "playwright browser"), then drive the ACTUAL running UI like a user — browser_navigate to the affected page, browser_snapshot to locate elements, browser_click / browser_type / browser_fill_form / browser_select_option for the real interactions, and browser_take_screenshot at the key BEFORE and AFTER states as visual evidence (save under .playwright-mcp/). Assert the on-screen result from the post-action snapshot AND the persisted backend/DB side-effect. ALSO author a durable headless Playwright regression spec so CI keeps covering this flow — but the real-browser MCP drive + screenshots is the REQUIRED proof the UI actually works, NOT a green CLI assertion alone. List the screenshot file paths in summary. Project UI instructions: ${PROJECT.testing.ui}`
      : `UI (Playwright): dev servers are DOWN, so the real-browser Playwright MCP drive cannot run now. AUTHOR a durable headless Playwright regression spec for the affected UI, and in summary record BOTH its run command AND the real-browser MCP steps (browser_navigate → click/type → browser_take_screenshot) to replay once servers are up; defer the live run. Project UI instructions: ${PROJECT.testing.ui}`)
  : 'UI (Playwright): no UI surface touched / no UI tier — skip.'
const apiClause = PROJECT.testing.api ? `API: ${PROJECT.testing.api}` : 'API: (no API channel configured — assert API/endpoint behavior in the backend test where relevant).'
const dbClause = PROJECT.testing.database ? `DATABASE: ${PROJECT.testing.database}` : 'DATABASE: (no database channel configured — assert persisted state where relevant).'
const activeChannels = [PROJECT.testing.api && 'API', PROJECT.testing.database && 'database', UI_ENABLED && 'UI (real-browser Playwright MCP)'].filter(Boolean).join(', ') || 'the configured channels'

// test-DESIGN — design the matrix (happy + negative + edge) BEFORE writing any test; never happy-path-only
const testDesign = await agent(
  `${BASE}\n\nDESIGN CONTRACT:\n${JSON.stringify({ summary: design.summary, acceptanceCriteria: design.acceptanceCriteria, dataModel: design.dataModel }, null, 2)}\n\nTECH SPEC (edge cases + test strategy):\n${JSON.stringify({ edgeCases: techSpec.edgeCases || [], testStrategy: techSpec.testStrategy || {} }, null, 2)}\n\nYou are the TEST-DESIGN agent. BEFORE any test is written, design the test MATRIX that proves the acceptance criteria AND tries hard to BREAK the implementation. We NEVER test only the happy path. For each active channel (${activeChannels}) enumerate SEVERAL concrete cases, each tagged by category:\n  - happy: the intended success paths.\n  - negative: invalid input, unauthorized / wrong-surface access, missing / duplicate / constraint-violating data — assert it FAILS correctly (right error, NO write, NO leak).\n  - edge: boundaries + lifecycle — empty/null/zero/max, repeated or concurrent calls, update-then-delete, soft-delete then re-read, cross-tenant isolation, idempotency${PROJECT.invariants.length ? ', and each project invariant under stress' : ''}.\nRequire AT LEAST one negative AND one edge case per active channel (or justify its absence in coverageNotes). Give each case an id, channel, category, title, intent, and expected outcome. If designing the cases surfaces a genuine ambiguity only a human should resolve, set needsHuman=true + openQuestions. Produce ONLY the matrix — do not write test code yet.`,
  { label: 'validate:test-design', phase: 'Validate', agentType: 'general-purpose', schema: TEST_DESIGN_SCHEMA },
)
const byCat = (c) => testDesign.cases.filter((x) => x.category === c).length
log(`test-design: ${testDesign.cases.length} cases [happy:${byCat('happy')} negative:${byCat('negative')} edge:${byCat('edge')}]${testDesign.openQuestions && testDesign.openQuestions.length ? ` · ${testDesign.openQuestions.length} open question(s)` : ''}`)

// round 0: author EVERY designed case (happy + negative + edge) as independent parallel cases, then run them
let testReport = await agent(
  `${BASE}\n\nDESIGN CONTRACT:\n${JSON.stringify(design, null, 2)}\n\nTEST MATRIX (designed up front — implement EVERY case below: happy, negative, AND edge; the negative + edge cases are NOT optional):\n${JSON.stringify(testDesign.cases, null, 2)}\nCoverage rationale: ${testDesign.coverageNotes}\n\nWrite the tests as INDEPENDENT cases (each with one focused assertion) covering the whole matrix, then run them. Per channel:\n  - ${apiClause}\n  - ${dbClause}\n    Cover the FULL lifecycle for any values/records this task makes mutable — create, update, AND delete (not just the happy-path create), and assert the project's invariants${PROJECT.invariants.length ? ':\n' + PROJECT.invariants.map((s) => '      • ' + s).join('\n') : ' (whatever the design contract states must hold).'}\n  - ${uiClause}\nMake tests deterministic + self-cleaning. Report channels covered, authored/executed/passed, the failures (if any), and the output tail. Tests must assert REAL behavior — negative cases MUST assert the correct FAILURE (do not skip or soften them). Do NOT write trivially-passing tests. Do NOT commit.`,
  { label: 'validate:author', phase: 'Validate', agentType: 'general-purpose', schema: TEST_SCHEMA },
)
let round = 0
const fixHistory = []
while (!testReport.passed && round < MAX_FIX_ROUNDS) {
  round++
  if (overTaskBudget()) {
    log(`PAUSE — per-task token ceiling (${MAX_TASK_TOKENS}) reached before fix round ${round}; escalating instead of grinding`)
    return {
      task: { id: TASK.id, title: TASK.title, branch: BRANCH },
      verified: false, blocked: false, needsHuman: true, pausedAt: 'validate-budget',
      questions: [{ question: `Task ${TASK.id} hit its token ceiling (${MAX_TASK_TOKENS}) with tests still RED after ${round - 1} fix round(s). Raise the ceiling, take it over, or skip this task?`, why: 'More fix rounds tend to increase reward-hacking, not correctness — the engine escalates rather than grinds.' }],
      design: { summary: design.summary, acceptanceCriteria: design.acceptanceCriteria },
      partial: { fixRounds: round - 1, lastFailures: testReport.failures || [] },
    }
  }
  log(`validate: tests RED (round ${round}/${MAX_FIX_ROUNDS}) — ${(testReport.failures || []).slice(0, 3).join(' | ') || testReport.summary}`)
  const fix = await agent(
    `${BASE}\n\nDESIGN CONTRACT:\n${JSON.stringify(design, null, 2)}\n\nThe tests are failing. Failures:\n${JSON.stringify(testReport.failures || [testReport.summary], null, 2)}\n\nFix the IMPLEMENTATION so the tests pass. Do NOT weaken, skip, or delete tests/assertions to make them pass — fix the real bug. Do NOT add broad try/catch blocks or success-shaped fallbacks to mask the failure — surface errors explicitly. If a test is genuinely wrong (contradicts the contract), say so explicitly in summary and set weakenedTests=false only if you corrected it to still prove the criterion. Re-run the relevant typecheck. Report typecheckGreen. If you cannot fix it after a real attempt, set blocked=true + blockReason.`,
    { label: `validate:fix#${round}`, phase: 'Validate', agentType: 'general-purpose', schema: FIX_SCHEMA },
  )
  fixHistory.push({ round, summary: fix.summary, addressed: fix.addressed || [], weakenedTests: !!fix.weakenedTests })
  if (fix.blocked) { codeBlocked = codeBlocked || `validate-fix: ${fix.blockReason || '(no reason)'}`; log(`BLOCKED during fix — stopping validate loop`); break }
  testReport = await agent(
    `${BASE}\n\nRe-run the API/database test(s) for this task${UI_ENABLED && SERVERS_UP ? ' AND re-drive the real-browser Playwright MCP UI flow (browser_navigate → click/type → browser_take_screenshot) to confirm the fix on-screen, capturing a fresh AFTER screenshot' : ''} and report passed + failures + output tail. Run only — author nothing new. Do NOT commit.`,
    { label: `validate:rerun#${round}`, phase: 'Validate', agentType: 'general-purpose', schema: TEST_SCHEMA },
  )
}
log(`validate: tests ${testReport.passed ? 'GREEN' : 'RED'} after ${round} fix round(s)`)

// authoritative static gate (parallel, read-only) — commands come from project config
const staticChecks = (
  await parallel(
    PROJECT.staticChecks.map((check) => () =>
      agent(
        `${BASE}\n\nRun this check and report pass + failures verbatim. READ-ONLY: no --fix, no edits to code or tests.\nCHECK (${check.label}): ${check.command}`,
        { label: `validate:${check.label}`, phase: 'Validate', agentType: 'general-purpose', schema: VALIDATION_SCHEMA },
      ),
    ),
  )
).filter(Boolean)
// design/UX review — accessibility + current screenshot evidence are ALWAYS blocking for UI tickets.
// testing.design=false may suppress advisory critique/copy only; it cannot disable the evidence gate.
const DESIGN_ENABLED = UI_ENABLED && SERVERS_UP
const currentUiScreenshots = (testReport.files || []).filter((f) => /\.png$/i.test(String(f)))
const designReview = DESIGN_ENABLED
  ? await agent(
      `${BASE}\n\nDESIGN CONTRACT (the intended UX — judge the built UI against this):\n${JSON.stringify({ ux: design.ux || {}, surfaces: design.surfaces, acceptanceCriteria: design.acceptanceCriteria }, null, 2)}\n\nYou are the DESIGN / UX REVIEW gate. Review ONLY the current-ticket screenshots explicitly returned by the test report: ${JSON.stringify(currentUiScreenshots)}. Do not glob or reuse screenshots from an earlier run. If this list is empty or a listed file cannot be read, return screenshots:[] and a11y.pass=false; missing evidence blocks verification. READ every listed screenshot and judge the built UI across three GENERAL product-design lenses:\n  - **accessibility** (design:accessibility-review lens) — OBJECTIVE WCAG AA and BLOCKING: text/background contrast, touch-target size (~44px), text legibility, visible focus + labelled controls. Set a11y.pass=false for a clear failure or missing evidence; otherwise a11y.pass=true.\n  - **critique** (design:design-critique lens) — ADVISORY: first impression, visual hierarchy, state legibility, consistency, and empty/loading/error/success/edge states. ${PROJECT.testing.design === false ? 'Advisory review is disabled: return an empty critique array.' : 'Give concrete finding + where + recommendation.'}\n  - **copy** (design:ux-copy lens) — ADVISORY: status labels, button/CTA text, empty states, and errors. ${PROJECT.testing.design === false ? 'Advisory review is disabled: return an empty copy array.' : 'Flag unclear copy and give the recommended string.'}\nReturn the exact current-ticket paths you reviewed in screenshots. Advisory findings do not block; accessibility or missing current evidence does.${PROJECT.testing.design && typeof PROJECT.testing.design === 'string' ? '\\n\\nPROJECT DESIGN GUIDANCE (brand/voice): ' + PROJECT.testing.design : ''}`,
      { label: 'validate:design-review', phase: 'Validate', agentType: 'general-purpose', schema: DESIGN_REVIEW_SCHEMA },
    )
  : null
if (designReview) log(`design-review: a11y ${designReview.a11y.pass === false ? 'FAIL (blocks merge)' : 'PASS'} · ${(designReview.critique || []).length} critique + ${(designReview.copy || []).length} copy note(s) [advisory]`)
const reviewedCurrentScreenshots = !!designReview && currentUiScreenshots.length > 0 &&
  (designReview.screenshots || []).length > 0 &&
  (designReview.screenshots || []).every((path) => currentUiScreenshots.includes(path))
const designA11yOk = !touchesUI || (!!designReview && reviewedCurrentScreenshots && designReview.a11y.pass === true)

const validationGreen = !!testReport.passed && staticChecks.every((v) => v && v.pass) && !codeBlocked && designA11yOk

// anti-tamper gate (Tier 1) — deterministically verify the coder did NOT weaken the verification surface to go green
const TG = PROJECT.testGuard
const tamper = await agent(
  `${BASE}\n\nYou are the ANTI-TAMPER gate. The coder must NEVER weaken the checks that verify its own work. Run these READ-ONLY commands in ${REPO} and judge MECHANICALLY (edit nothing):\n  1. \`cd ${REPO} && git add -A\` (stage), then \`git --no-pager diff --cached --stat -- ${TG.testGlobs.map((g) => `'${g}'`).join(' ')}\` to see which test files changed.\n  2. \`git --no-pager diff --cached -- ${TG.testGlobs.map((g) => `'${g}'`).join(' ')}\` — inspect removed ('-') vs added ('+') lines in EXISTING test files.\n  3. In the added (+) lines, search for any forbidden skip/only marker: ${TG.forbiddenMarkers.join(' , ')}.\n  4. Check whether any protected path was modified: ${TG.protectedPaths.join(' , ')} — especially CI config under .github/workflows/.\nBINARY RULES — set tampered=true if ANY hold: (a) an existing test or assertion was DELETED or weakened (net-removed assertions, not merely new ones added), (b) a forbidden skip/only marker was ADDED, (c) a protected path was modified in a way that loosens verification (CI especially). Adding NEW tests is expected and fine. Put the concrete evidence lines in findings.`,
  { label: 'validate:tamper-check', phase: 'Validate', agentType: 'general-purpose', schema: TAMPER_SCHEMA },
)
if (tamper.tampered) log(`TAMPER suspected — ${(tamper.findings || []).slice(0, 3).join(' | ') || tamper.summary}`)

// ───────────────────────── Phase 6 · Docs (update affected project documentation) ─────────────────────────
// Part of the reviewed diff: keep the project's documentation in sync with the change.
phase('Docs')
const docsTargets = PROJECT.docs.length
  ? `Documentation this project keeps in sync (update the ones this change affects):\n${PROJECT.docs.map((s) => '  - ' + s).join('\n')}`
  : `No explicit docs list is configured — check the READ FIRST docs above (and any obvious README/architecture/data-model files) for statements this change makes stale.`
const docsReport = await agent(
  `${BASE}\n\nDESIGN CONTRACT:\n${JSON.stringify({ summary: design.summary, core: design.core, dataModel: design.dataModel, surfaces: design.surfaces }, null, 2)}\n\nTECHNICAL SPEC docsToUpdate hint: ${JSON.stringify(techSpec.docsToUpdate || [])}\n\nFILES CHANGED IN THIS TASK:\n${JSON.stringify(Array.from(new Set(implementReports.flatMap((r) => r.filesChanged || []))), null, 2)}\n\nYou are the DOCUMENTATION agent. Update the project documentation this change affects so the docs match the new reality — new/changed endpoints, schema, behavior, architecture, or developer instructions. ${docsTargets}\n  - Edit ONLY documentation (markdown/HTML/docstrings/READMEs), never code or tests.\n  - Be accurate and surgical: change what this task changed; do not rewrite unrelated sections.\n  - If the change genuinely needs no doc update, set skipped=true and updated=false and explain why.\n  - Do NOT commit/push.\nReport the files you edited + a one-line summary of each.`,
  { label: 'docs:update', phase: 'Docs', agentType: 'general-purpose', schema: DOCS_SCHEMA },
)
log(`docs: ${docsReport.skipped ? 'none needed' : `${(docsReport.files || []).length} file(s) updated`}`)

// ───────────────────────── capture diff + PR body (for the clean-room verifier) ─────────────────────────
const diffText = await agent(
  `${BASE}\n\nStage all changes and capture the diff for review: run \`cd ${REPO} && git add -A && git --no-pager diff --cached --stat\` then \`git --no-pager diff --cached\`. Return the COMPLETE diff as plain text (stat block first, then the diff). If it exceeds ~1500 lines, return the full stat + the diffs for the most important files and clearly note which files were truncated. Do NOT commit, push, or unstage.`,
  { label: 'capture:diff', phase: 'Docs', agentType: 'general-purpose' },
)
const prBody = await agent(
  `${BASE}\n\nDESIGN CONTRACT:\n${JSON.stringify({ summary: design.summary, core: design.core, dataModel: design.dataModel, surfaces: design.surfaces, acceptanceCriteria: design.acceptanceCriteria }, null, 2)}\n\nVALIDATION: tests ${testReport.passed ? 'PASS' : 'FAIL'}; static checks ${staticChecks.map((v) => (v.pass ? 'pass' : 'FAIL')).join('/')}; docs ${docsReport.skipped ? 'n/a' : (docsReport.files || []).join(', ') || 'updated'}.${designReview ? '\n\nDESIGN/UX REVIEW (accessibility is a blocking gate; critique + copy are ADVISORY — surface them for the human):\n' + JSON.stringify({ a11yPass: designReview.a11y.pass !== false, a11yViolations: designReview.a11y.violations || [], critique: designReview.critique || [], copy: designReview.copy || [] }, null, 2) : ''}\n\nWrite the PR body (GitHub markdown) for task ${TASK.id}: a "## Summary" of what changed (core/data model/surfaces), a "## Changes" bullet list, a "## Docs" line (files updated, or "none needed"), a "## Acceptance criteria" checklist (one - [ ] line per criterion, checked only if validation supports it)${designReview ? ', and a "## Design & UX review" section — the accessibility result (list any blocking violations) followed by the advisory critique + copy suggestions as a bullet list' : ''}. Be factual and concise. Return ONLY the markdown body.`,
  { label: 'capture:prbody', phase: 'Docs', agentType: 'general-purpose' },
)

// ───────────────────────── Phase 7 · Verify (CLEAN-ROOM — no coder transcript) ─────────────────────────
// The verifier sees ONLY: the task description, the contract's acceptance criteria, the git diff, and the PR body.
// It is NOT given recon, design rationale, the tech spec, or the implement/fix reports — that would bias the review.
phase('Verify')
const CLEANROOM = `You are an INDEPENDENT verifier for ${PROJECT.name} task ${TASK.id}. You did NOT write this code. You are given only: the task description, the acceptance criteria (the contract), the full code diff, and the PR body. You are deliberately NOT given the author's reasoning — judge the artifact, not the story.

TASK: ${TASK.title}
GOAL: ${TASK.goal}

CODE DIFF (staged working tree):
${typeof diffText === 'string' ? diffText.slice(0, 60000) : '(diff unavailable)'}

PR BODY:
${typeof prBody === 'string' ? prBody : '(none)'}

You MAY read the repo at ${REPO} to confirm what the diff does in context, and re-run the stated verify command for a criterion. You may NOT edit anything.`

const verdicts = (
  await parallel(
    design.acceptanceCriteria.map((c) => () =>
      agent(
        `${CLEANROOM}\n\nADVERSARIAL CHECK — try hard to REFUTE that this criterion is FULLY met by the diff. Default met=false unless you find concrete evidence in the diff/code/test output that it holds. Judge ONLY whether THIS acceptance criterion holds — do not penalize style, hypotheticals, or anything outside the stated criterion.\n\nCriterion ${c.id}: ${c.text}\nHow to verify: ${c.verify || 'inspect the diff + run the stated check'}`,
        { label: `verify:${c.id}`, phase: 'Verify', agentType: 'general-purpose', schema: VERDICT_SCHEMA },
      ),
    ),
  )
).filter(Boolean)

const invariantChecks = PROJECT.invariants.length
  ? `\n(5) PROJECT INVARIANTS — for every value/record this change mutates, check each invariant below holds in the diff AND that the tests actually ASSERT it (flag any invariant that is violated, unexercised, or untested):\n${PROJECT.invariants.map((s, i) => `    ${i + 1}. ${s}`).join('\n')}`
  : ''
const completeness = await agent(
  `${CLEANROOM}\n\nCOMPLETENESS + ANTI-GAMING CRITIC. Looking ONLY at the diff + criteria: (1) what is MISSING or unverified (a criterion with no supporting code/test; a migration generated but not applied; a change wired on one surface but not another; UI claimed but absent; config/docs the task requires but the diff lacks)? (2) CRUD coverage: are create, update, AND delete exercised + tested for the values this change makes mutable — and does delete behave as the contract specifies (no orphaned records, no dangling references)? (3) Does the diff GAME the tests — deleting/skipping/loosening assertions, hardcoding expected values, or making tests trivially pass instead of fixing code? Set testGamingSuspected=true if so. (4) TEST BREADTH: beyond happy paths, does the suite include real NEGATIVE cases (invalid / unauthorized / constraint-violating input asserted to FAIL correctly — right error, no write, no leak) AND EDGE cases (boundaries, lifecycle, concurrency, invariant stress)? A happy-path-only suite is INSUFFICIENT — set coverageOk=false and list the missing negative/edge coverage in missing[].${invariantChecks}\nFlag ONLY gaps that affect correctness or the stated acceptance criteria — do NOT report style preferences, speculative edge cases outside the contract, or out-of-scope "improvements" (over-reporting causes over-engineering). Be specific.`,
  { label: 'verify:completeness', phase: 'Verify', agentType: 'general-purpose', schema: COMPLETENESS_SCHEMA },
)

const allCriteriaMet = verdicts.length > 0 && verdicts.every((v) => v && v.met)
const failedCriteria = verdicts.filter((v) => v && !v.met).map((v) => ({ id: v.criterionId, reason: v.reason }))

// held-out check (Tier 1) — an INDEPENDENT test the coder never saw, with perturbed inputs, proving a core criterion
const heldOutFeasible = BACKEND_ENABLED || (UI_ENABLED && SERVERS_UP)
const heldOut = heldOutFeasible
  ? await agent(
      `${CLEANROOM}\n\nHELD-OUT VERIFICATION (exception: you MAY add ONE new test file here — but do NOT modify existing code or tests). The coder optimized against its OWN tests; author ONE additional, INDEPENDENT test the coder never saw, to catch code that only passes the cases it wrote. Pick the single most important acceptance criterion and prove it with DIFFERENT, perturbed inputs (different values / ids / ordering / boundary than any existing test).${BACKEND_ENABLED ? ` Author it as a backend ${PROJECT.testing.api ? 'API/' : ''}database test in this repo's style and RUN it.` : ''}${UI_ENABLED && SERVERS_UP ? ' A real-browser Playwright MCP check (drive the live browser + screenshot) is acceptable for a UI-facing criterion.' : ''} Report authored/executed/passed + failures. If nothing is meaningfully testable (e.g. docs-only change) set authored=false + skippedReason.`,
      { label: 'verify:held-out', phase: 'Verify', agentType: 'general-purpose', schema: HELDOUT_SCHEMA },
    )
  : { authored: false, executed: false, passed: true, summary: 'held-out test skipped (no runnable channel for this task)', skippedReason: 'no backend channel and UI servers down' }
const heldOutOk = !heldOut.authored || !!heldOut.passed
if (heldOut.authored) log(`held-out test: ${heldOut.passed ? 'PASS' : 'FAIL'}${heldOut.passed ? '' : ' — ' + (heldOut.failures || []).slice(0, 2).join(' | ')}`)

// Defense in depth: the master blocks UI tickets before invoking this Workflow when the live UI cannot be driven.
// If the Workflow is invoked directly or with stale orchestration, missing browser evidence still fails closed.
const reportedChannels = (testReport.channels || []).map((channel) => String(channel).toLowerCase())
const uiChannelReported = reportedChannels.some((channel) => channel === 'ui' || channel.startsWith('ui'))
const uiEvidenceMissing = touchesUI && (
  !PROJECT.testing.ui ||
  !SERVERS_UP ||
  testReport.executed !== true ||
  !uiChannelReported ||
  currentUiScreenshots.length === 0 ||
  !reviewedCurrentScreenshots
)
const verified = !uiEvidenceMissing && validationGreen && !tamper.tampered && allCriteriaMet && completeness.coverageOk && !completeness.testGamingSuspected && heldOutOk
const blocked = !!codeBlocked || uiEvidenceMissing

// distill this task's defects + fixes for the cross-task failure ledger (Tier 2)
const ledgerEntries = [
  ...fixHistory.map((f) => ({ task: TASK.id, rootCauseClass: f.weakenedTests ? 'test-weakened' : 'test-fix', fix: f.summary })),
  ...failedCriteria.map((f) => ({ task: TASK.id, rootCauseClass: 'unmet-criterion', fix: `${f.id}: ${f.reason}` })),
  ...(tamper.tampered ? [{ task: TASK.id, rootCauseClass: 'tamper', fix: tamper.summary }] : []),
  ...(uiEvidenceMissing ? [{ task: TASK.id, rootCauseClass: 'missing-ui-evidence', fix: 'Start the configured local UI servers and complete the live browser drive, screenshots, and accessibility review.' }] : []),
].slice(0, 8)

log(`VERDICT ${TASK.id}: ${verified ? 'VERIFIED ✓' : blocked ? 'BLOCKED' : 'NOT verified'} (validationGreen=${validationGreen}, criteriaMet=${allCriteriaMet}, gaming=${completeness.testGamingSuspected}, tamper=${tamper.tampered}, heldOut=${heldOut.authored ? (heldOut.passed ? 'pass' : 'FAIL') : 'n/a'})`)

return {
  task: { id: TASK.id, title: TASK.title, branch: BRANCH },
  verified,
  blocked,
  blockReason: codeBlocked || (uiEvidenceMissing ? 'UI verification requires live local servers, browser interaction, screenshots, and accessibility review.' : null),
  validationGreen,
  testsPassed: !!testReport.passed,
  testChannels: testReport.channels || [],
  testBreadth: { total: testDesign.cases.length, happy: byCat('happy'), negative: byCat('negative'), edge: byCat('edge') },
  needsHuman: false,
  openQuestions: testDesign.openQuestions || [],
  fixRounds: round,
  staticChecks: staticChecks.map((v) => ({ command: v.command, pass: v.pass, summary: v.summary })),
  designReview: designReview
    ? { a11yPass: designReview.a11y.pass !== false, a11yViolations: designReview.a11y.violations || [], critique: designReview.critique || [], copy: designReview.copy || [], screenshots: designReview.screenshots || [], summary: designReview.summary }
    : null,
  design: { summary: design.summary, core: design.core, dataModel: design.dataModel, surfaces: design.surfaces, stages: design.stages.map((s) => s.key), acceptanceCriteria: design.acceptanceCriteria },
  techSpec: { summary: techSpec.summary, fileChanges: techSpec.fileChanges, apiContracts: techSpec.apiContracts || [], dataModel: techSpec.dataModel || 'none', sequencing: techSpec.sequencing, edgeCases: techSpec.edgeCases || [] },
  docs: { updated: !!docsReport.updated, skipped: !!docsReport.skipped, files: docsReport.files || [], summary: docsReport.summary },
  acceptanceCriteria: design.acceptanceCriteria,
  verdicts,
  failedCriteria,
  completeness,
  tamper: { tampered: !!tamper.tampered, findings: tamper.findings || [], summary: tamper.summary },
  heldOut: { authored: !!heldOut.authored, passed: !!heldOut.passed, summary: heldOut.summary, skippedReason: heldOut.skippedReason || null },
  ledgerEntries,
  prBody: typeof prBody === 'string' ? prBody : null,
  filesChanged: Array.from(new Set(implementReports.flatMap((r) => r.filesChanged || []))),
  // NOTE: implementReports are intentionally NOT returned to the master to keep the merge decision based on the
  // clean-room verdict + validation, not the coder's self-report.
}
