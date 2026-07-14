# loop-engineering

A Git-backed, multi-runtime Loop Engineering skill for Claude Code and Codex. One repository is the canonical source;
each runtime uses a small adapter for its own tools while sharing the same sprint-layout contract.

The loop groups one parent feature or large product ticket in exactly one indexed folder under
`docs/sprints/sprint_N/`. Internal implementation-ticket and subtask plan/status pages are flat files inside that
folder, traced by one `index.html`. Each internal implementation ticket remains one branch, one PR, and one risk-gated
merge; documentation folders do not follow branch or PR boundaries.

## Install Once for Claude and Codex

The shell commands below target macOS and Linux.

Create the discovery parents and clone the repository to a runtime-neutral location:

```sh
mkdir -p ~/.local/share ~/.claude/skills ~/.codex/skills
git clone https://github.com/JeremyW1990/loop-engineering-skill.git \
  ~/.local/share/loop-engineering-skill
```

If either discovery entry already exists, inspect it and move it to a backup first. Do not run `ln -s` against an
existing directory because that would nest the new link inside the stale skill:

```sh
stamp=$(date +%Y%m%d-%H%M%S)
mkdir -p ~/.local/share/loop-engineering-backups
if [ -e ~/.claude/skills/loop-engineering ] || [ -L ~/.claude/skills/loop-engineering ]; then
  mv ~/.claude/skills/loop-engineering \
    ~/.local/share/loop-engineering-backups/claude-$stamp
fi
if [ -e ~/.codex/skills/loop-engineering ] || [ -L ~/.codex/skills/loop-engineering ]; then
  mv ~/.codex/skills/loop-engineering \
    ~/.local/share/loop-engineering-backups/codex-$stamp
fi
```

After preserving any existing install, expose the adapters through local discovery symlinks. The guarded block exits
before either link is created if a destination still exists:

```sh
set -eu
if [ -e ~/.claude/skills/loop-engineering ] || [ -L ~/.claude/skills/loop-engineering ] || \
   [ -e ~/.codex/skills/loop-engineering ] || [ -L ~/.codex/skills/loop-engineering ]; then
  echo "A Loop Engineering discovery entry still exists; inspect or back it up first." >&2
  exit 1
fi
ln -s ~/.local/share/loop-engineering-skill/claude \
  ~/.claude/skills/loop-engineering
ln -s ~/.local/share/loop-engineering-skill/codex \
  ~/.codex/skills/loop-engineering
```

Verify both entries resolve into that one checkout:

```sh
set -eu
test -L ~/.claude/skills/loop-engineering
test -L ~/.codex/skills/loop-engineering
(cd ~/.claude/skills/loop-engineering && pwd -P)
(cd ~/.codex/skills/loop-engineering && pwd -P)
```

Claude Code still needs a local discovery entry and Codex still needs a local discovery entry. The entries are
symlinks, not copied skills, so the Git checkout remains the only maintained source.

## Update Safely

Keep the live checkout clean and on `main`. Confirm that `git status --short` prints nothing before updating:

```sh
set -eu
repo="$HOME/.local/share/loop-engineering-skill"
test -z "$(git -C "$repo" status --porcelain)"
git -C "$repo" switch main
git -C "$repo" pull --ff-only origin main
```

Develop changes on a separate clone or worktree so an uncommitted feature branch does not silently become the live
Claude and Codex skill.

## Canonical Sprint Layout

```text
docs/sprints/sprint_3/
  bunnyos-cpa-chatbox/
    index.html
    s3-t1-tenant-security_plan.html
    s3-t1-tenant-security_status.html
    s3-t1-st1-rls-foundation_plan.html
    s3-t1-st1-rls-foundation_status.html
    s3-t2-agent-runtime_plan.html
    s3-t2-agent-runtime_status.html
```

Rules:

- One related parent feature or large product ticket creates exactly one direct feature/program folder.
- Internal implementation tickets and subtasks create flat page pairs, never nested folders.
- `index.html` traces all pages, dependencies, states, branches, PRs, and merges.
- One internal implementation ticket is one branch, one PR, and one risk-gated merge.
- Legacy ticket-folder and monolithic layouts remain readable but are not used for new work.

## Repository Layout

| Path | Role |
|---|---|
| `claude/` | Claude Code adapter, config reference, Workflow engine, page helper, and templates. |
| `codex/` | Codex adapter, config mapping, page helper, templates, and agent metadata. |
| `tests/` | Cross-runtime contract tests that prevent the adapters from drifting. |

## Runtime Use

Claude Code:

```text
/loop-engineering docs/sprints/sprint_3 Build the BunnyOS CPA chatbox
```

Codex:

```text
Use $loop-engineering for docs/sprints/sprint_3 program=bunnyos-cpa-chatbox dryRun.
```

Project-specific commands, architecture rules, test channels, and risk paths belong in the target repository's
`.claude/loop-engineering.json` or `.codex/loop-engineering.json`. The Codex adapter can translate an existing Claude
config in memory, so a project does not need duplicate config files.

## Validate

```sh
python3 claude/tests/test_loop_pages.py
python3 codex/tests/test_loop_pages.py
python3 tests/test_runtime_contract.py
```

The page tests cover flat-file bootstrapping, index refreshes, natural ID ordering, collision prevention, and path
traversal rejection. The runtime contract test ensures both adapters preserve the same single-program-folder rules.
