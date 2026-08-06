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
