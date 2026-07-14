# Codex Loop Engineering Config

Use `.codex/loop-engineering.json` for Codex-native projects. When only `.claude/loop-engineering.json` exists, read it and translate the fields directly in memory. Do not rewrite the user's Claude config unless asked.

## Top-Level Shape

```jsonc
{
  "tracking": {
    "commit": true,
    "layout": "program-folder",
    "index": "index.html"
  },
  "git": {
    "baseBranch": "develop",
    "branchPrefix": "codex/",
    "mergeMethod": "squash",
    "commitTrailer": ""
  },
  "ci": {
    "required": false,
    "maxFixAttempts": 2
  },
  "engine": {
    "maxFixRounds": 3,
    "maxTaskTokens": null
  },
  "merge": {
    "highRiskPaths": [
      "**/migrations/**",
      "**/schema.prisma",
      "**/rls.sql",
      ".github/workflows/**",
      "deploy/**",
      ".codex/loop-engineering.json",
      ".claude/loop-engineering.json"
    ],
    "highRiskPatterns": ["auth", "billing", "payment", "stripe", "webhook"]
  },
  "preflight": {
    "infra": [],
    "healthChecks": [],
    "smokeTest": "",
    "devServers": {
      "check": "",
      "start": "",
      "ports": []
    }
  },
  "project": {
    "name": "project-name",
    "readFirst": ["AGENTS.md", "CLAUDE.md", "README.md"],
    "rules": [
      "Match surrounding code style and reuse existing helpers.",
      "Replace obsolete code rather than leaving parallel paths."
    ],
    "environment": [],
    "forbidden": [
      "Never trigger deploys or touch shared/staging/production infrastructure or databases.",
      "Never force-push, bypass hooks, or weaken tests to go green."
    ],
    "implementationNotes": [],
    "reconAreas": [
      {
        "key": "core",
        "prompt": "Map the core implementation this task touches with file references."
      },
      {
        "key": "tests",
        "prompt": "Map relevant test patterns, fixtures, and commands."
      }
    ],
    "staticChecks": [
      {
        "label": "lint",
        "command": "Run the repo's configured lint command without --fix."
      },
      {
        "label": "typecheck",
        "command": "Run typecheck for each touched package."
      }
    ],
    "testing": {
      "api": "How to test API behavior and errors.",
      "database": "How to assert resulting persisted data.",
      "ui": "How to drive UI behavior and verify data side effects.",
      "design": ""
    },
    "docs": [],
    "testGuard": {
      "testGlobs": ["**/*.test.*", "**/*.spec.*", "**/test/**", "tests/**"],
      "forbiddenMarkers": [
        ".skip(",
        ".only(",
        "xit(",
        "xdescribe(",
        "test.skip",
        "test.only",
        "describe.skip",
        "describe.only"
      ],
      "protectedPaths": [".github/workflows/", "tests/"]
    },
    "invariants": [],
    "uiSurfaces": ["web"]
  }
}
```

## Field Notes

- `tracking.commit`: when true, commit plan/status tracking updates separately. If the base branch is protected or the user did not ask for commits, keep updates in the working tree and report them.
- `tracking.layout`: use `program-folder` for new work: one indexed feature/program folder with flat ID-prefixed ticket/subtask page pairs. Legacy ticket-folder and monolithic layouts remain readable only.
- `tracking.index`: the program index filename; use `index.html`.
- `git.baseBranch`: PR target and source for new task branches. For HeyApril this is usually `develop`.
- `git.branchPrefix`: honor the configured value, including a value translated from the Claude config. Default to
  `codex/` only when the selected config omits the field.
- `merge.highRiskPaths` and `merge.highRiskPatterns`: any match pauses before merge. Any file deletion is also high-risk.
- `preflight.infra` and `healthChecks`: local-only commands. Never run smoke tests against staging/beta/prod.
- `project.readFirst`: authoritative docs to read before acting. Include `AGENTS.md` for Codex and `CLAUDE.md` when it has deeper repo guidance.
- `project.rules`: always-on architecture and safety rules.
- `project.implementationNotes`: operational commands and local quirks.
- `project.reconAreas`: read-only investigation scopes for parallel exploration.
- `project.staticChecks`: read-only gates. Do not include `--fix`.
- `project.testing`: channel-specific expectations. Database checks should assert resulting data, not just response shape.
- `project.docs`: docs that must stay in sync.
- `project.testGuard`: mechanical anti-tamper checks.
- `project.invariants`: checkable behavior/data rules that tests and review must enforce.
- `project.uiSurfaces`: surface names that trigger UI validation.

## HeyApril Mapping

When running in HeyApril:

- Treat `.claude/loop-engineering.json` as the configured project facts until a `.codex/loop-engineering.json` exists.
- Work from `develop` and open PRs against `develop`.
- Preserve the three tRPC surfaces: staff, client, and admin.
- Preserve RLS boundaries. Use `withRls` for tenant work; `withSystemRls` only for trusted paths that stamp tenant IDs.
- For v2.1 writes, use `applyChange()` inside the caller's RLS transaction, append `ChangeLog`, soft-delete only, and treat JSON documents as projections.
- Assert resulting `ChangeLog`, `profile.json`, and `enhanced_profile.json` data when relevant.
- Run API Vitest when touching `apps/api` or engines; run SPA typecheck for touched SPAs; run Playwright only when relevant and local dev servers are available.

## Bootstrap Guidance

If no config exists:

1. Inspect repo docs, package scripts, CI workflows, docker-compose, test folders, and app entry points.
2. Draft a minimal `.codex/loop-engineering.json` with discovered commands and rules.
3. Ask the user to confirm before writing. Wrong base branches or test commands poison the loop.

If sprint pages are missing for new work:

1. Resolve the current sprint as `docs/sprints/sprint_0` when no `sprint_x` exists, otherwise the highest-numbered existing `docs/sprints/sprint_x`.
2. Add fresh tickets to that current max sprint folder. Do not create `sprint_(max+1)` unless the user explicitly asks to start a new sprint.
3. Create or reuse one feature/program folder for the related body of work. If the user calls that parent feature a
   large “ticket,” it still owns the single folder; internal implementation tickets remain flat pages. Do not create
   nested ticket or subtask folders, and do not create documentation folders from branch or PR boundaries.
4. Run `scripts/loop_pages.py bootstrap-program` once to create the program's `index.html`.
5. Generate flat ID-prefixed ticket/subtask plan/status pairs inside the program folder. One ticket still equals one branch, one PR, and one risk-gated merge.
6. Put ticket dependencies on the ticket plan as ticket IDs.
7. Split each ticket into one or more subtasks for scoped acceptance and evidence, but do not treat subtasks as branch/PR/merge units.
8. Use `scripts/loop_pages.py bootstrap-ticket --program <program-slug>` and refresh the index after page status changes.
9. Use the legacy `scripts/loop_pages.py bootstrap` command only when intentionally maintaining an old monolithic sprint folder.
