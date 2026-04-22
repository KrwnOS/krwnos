# Agent Briefs

Operational playbook for handing tasks to fresh AI agents without replaying the
entire project conversation each time.

## Why this exists

KrwnOS development is driven by a merge-train rule (one PR at a time to `main`)
and a living `ROADMAP.md`. When a task is picked up, a fresh agent needs enough
context to execute cleanly — but not the entire history of the project, which
would blow the context window.

Each brief here is deliberately self-contained: the agent reads the project
preamble plus one task brief, and has everything it needs to ship that PR.

## Files

- `_project-context.md` — the always-load preamble. Every agent reads this
  first. Contains stack, architecture rules, key paths, discipline, and the
  merge-train constraint.
- `S{stage}.{n}.md` — one file per backlog task, in strict execution order.
  Each contains goal, starting state, steps, definition of done, and known
  pitfalls.

## How to hand off a task

1. Check `docs/ROADMAP.md` to confirm which task is next unblocked. Do not
   rely on session-scoped TaskList numbering — each fresh agent has its own
   list and ids do not cross sessions.
2. Open a fresh Cowork session (or equivalent) — one that has *not* been
   carrying KrwnOS context already.
3. Hand the agent two files: `_project-context.md` and the specific `S*.md`
   brief.
4. Let the agent execute. It should open a PR targeting the branch named
   in the brief's header, update `ROADMAP.md` in the same PR per §0, and
   stop.
5. Review, merge, delete the task branch. Only then start the next task —
   that's the merge-train rule.

## Branching model

Two patterns are in use. Each brief tells the agent which one applies.

- **Stacked onto an in-flight feature branch.** Used for Stage 1, where
  multiple PRs all target `cursor/mission-whitepaper-obligations` and the
  parent branch merges to `main` in one shot at S1.5. Briefs for this
  pattern specify a non-`main` "Branch base" and "PR target" at the top.
- **Branched off `main`.** Used for Stage 2 onwards, where each PR is an
  independent unit of delivery going straight to `main`. Briefs for this
  pattern do not specify a branch base because `main` is the default.

If a brief is silent on branching, default to `main`.

## When to write a brief

Briefs for the current stage and the next stage are written ahead of time.
Anything further out is deliberately not written because the codebase will
shift under it. When a stage closes, write the next stage's briefs before
handing anything out — don't batch-write the whole roadmap in advance.

## When a brief is wrong

If an agent discovers the brief is incorrect (wrong file path, stale
assumption, changed API), it should stop and report rather than improvise.
Update the brief, then re-hand it to a fresh agent. Briefs are living
documents, same rule as `ROADMAP.md`.
