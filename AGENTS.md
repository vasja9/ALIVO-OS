 codex/document-project-directory-structure
# AGENTS.md

## Project Scope

These instructions apply to the entire ALIVO-OS repository.

## Development Rules

- Follow the frozen ALIVO-OS Specification v1.0 during Build Phase.
- Do not add new product features outside the approved specification.
- Prefer simple, explicit repository structure over premature implementation complexity.
- Keep documentation aligned with `CONSTITUTION.md` and the frozen specification.

## Repository Organization

- `docs/` contains project specifications, architecture notes, build plans, and roadmap documents.
- `kernel/` contains foundational operating-system coordination primitives.
- `modules/` contains business capability modules.
- `services/` contains service boundaries and runtime services.
- `ui/` contains user interface code and assets.
- `tests/` contains test scaffolding and validation assets.

codex/create-agents.md-for-engineering-contract
# ALIVO-OS Engineering Contract

## Mission

Implement approved specifications.

Do not redesign them during implementation.

## Engineering Principles

- One task. One result.
- Implement before documenting.
- Never describe code instead of writing code.
- Never report a feature as complete unless it exists.
- Business value before technical elegance.
- Simplicity over complexity.
- Stop after the requested task.

## Scope Control

Do not introduce new functionality.

Do not expand the specification.

Record new ideas separately.

Do not implement them.

## Verification

Before every task:

- inspect repository state
- inspect relevant files
- verify baseline

After every task:

- validate implementation
- report changed files
- report limitations honestly

## Completion Rule

A task is complete only when the requested repository
changes exist.

Documentation alone is not implementation.

Configuration alone is not implementation.

## Backlog

New ideas are recorded.

They are never implemented without CEO approval.
 main
