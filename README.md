# loop-engineering

A project-agnostic [Claude Code](https://claude.com/claude-code) **skill** that runs an autonomous *sprint
loop-engineering cycle*: point it at (or let it auto-resolve) the current numbered `sprint_N` folder and give a
description, and it plans the sprint, then drains it ticket-by-ticket — each ticket going through **design → technical
spec → code → validate (UI via a real-browser Playwright-MCP drive that clicks + screenshots the live UI / API /
database) → docs → an independent clean-room review**, then a **risk-gated auto-merge** — pausing to ask a human on any
genuine ambiguity. Each ticket lives in its **own folder** with a `<slug>_ticket.html` spec + `<slug>_status.html`
tracker and a `<subtask>_plan.html` + `<subtask>_status.html` pair per subtask; the ticket is the merge unit (one
branch/PR/merge) and its subtasks ship inside that one PR.

It's built on Anthropic's [Harness Design for Long-Running Agent Tasks](https://www.anthropic.com/engineering/harness-design-long-running-apps)
(a generator writes, an independent evaluator verifies, against a contract agreed *before* any code is written) and
hardened with practices from recent Anthropic & OpenAI agent-engineering writing.

## Install

Clone into your Claude Code skills directory:

```sh
git clone https://github.com/JeremyW1990/loop-engineering-skill.git ~/.claude/skills/loop-engineering
```

Then, in Claude Code:

```
/loop-engineering Build the waitlist admin review flow
```

It auto-resolves the current sprint — the highest `sprint_N` under `docs/sprints` (or `sprint_0` if none). Pass a
specific folder (`/loop-engineering docs/sprints/sprint_3 …`) to override, or run bare (`/loop-engineering`) to resume.

- **Sprint empty yet?** From your description it generates one **folder per ticket**, each holding a `<slug>_ticket.html`
  + `<slug>_status.html` pair and a `<subtask>_plan.html` + `<subtask>_status.html` pair per subtask, then runs the
  sprint autonomously.
- **Tickets exist?** It reads the ticket + subtask pages and resumes from the next ready ticket.

## Layout

| File | Role |
|------|------|
| `SKILL.md` | The master loop — resolve `sprint_N` → per-ticket folders → autonomous, risk-gated auto-merge. |
| `task-flow.mjs` | The per-ticket engine (a Claude Code Workflow): recon → design → spec → code → validate → docs → clean-room verify. |
| `CONFIG.md` | The per-repo config schema (`.claude/loop-engineering.json`). |
| `templates/` | Self-rendering HTML templates: `ticket` (ticket spec), `status` (ticket- **and** subtask-level tracker), `plan` (subtask plan). |
| `examples/example.json` | A complete worked config. |

## What makes it safe to run unattended

- **Clean-room verify** — independent agents judge only the contract + diff + PR body, never the coder's reasoning.
- **Test matrix first** — every task designs happy + negative + edge cases before writing tests; happy-path-only suites are rejected.
- **Anti-tamper gate** — the coder can't delete/weaken tests or loosen CI to go green (mechanically checked).
- **Held-out test** — the verifier runs one independent, perturbed-input test the coder never saw.
- **Risk-gated auto-merge** — schema/auth/migrations/CI/deletes pause for a human; only low-risk diffs merge unattended.
- **Cross-task failure ledger** — each task's defects feed forward so the next task doesn't repeat them.
- **Per-task token ceiling** — a stuck task escalates to a human instead of grinding (more fix rounds raise hack-rate, not correctness).
- **Human-in-the-loop** — any stage can pause to ask a question rather than guess.

Project specifics (commands, infra, rules, test channels, risk paths) live in each repo's own
`.claude/loop-engineering.json`, bootstrapped on first run. See [`CONFIG.md`](CONFIG.md).
