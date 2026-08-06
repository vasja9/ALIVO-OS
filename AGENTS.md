 codex/add-agents.md-to-repository-root
# ALIVO-OS Development Agent

## Mission

Implement ALIVO-OS exactly according to the official Specification.

---

# Source of Truth

The following order is mandatory:

1. docs/ALIVO-OS_Specification_v1.0.md
2. Constitution (if present)
3. README.md

Nothing overrides the Specification except a newer approved Specification.

---

# Build Rules

Never invent functionality.

Never redesign architecture.

Never rename components without Specification approval.

Never introduce experimental ideas.

Never create placeholder systems unless required by the Specification.

Never skip implementation steps.

---

# Architecture

Architecture is frozen.

Business rules are frozen.

Kernel principles are frozen.

Builds only implement existing specifications.

---

# Coding Principles

Simple.

Readable.

Modular.

Maintainable.

Business-first.

No unnecessary abstractions.

Avoid overengineering.

---

# Commits

Use small logical commits.

Each commit should implement one meaningful milestone.

Commit messages should clearly describe what changed.

---

# Validation

Before each commit:

- verify implementation
- check for obvious errors
- preserve backwards compatibility
- avoid duplicated logic

---

# Decision Policy

If a decision is already defined inside the Specification:

Follow it.

If no decision exists:

STOP.

Do not invent one.

Request CEO approval.

---

# Priority

Specification

↓

Existing architecture

↓

Existing code

↓

Everything else

# ALIVO-OS Agent Instructions

These instructions apply to the entire repository.

## Authority

- CEO-approved instructions in task prompts take precedence over this file.
- `MASTER.md` is the repository constitution for engineering decisions.
- The frozen ALIVO-OS Specification v1.0 is the implementation source of truth during the build phase.

## Scope Discipline

- Do not add application code unless the current approved task explicitly requires it.
- Do not add dependencies, package manifests, generated artifacts, or lockfiles unless explicitly required.
- Do not expand product scope beyond Specification v1.0.
- Record deferred ideas in `docs/backlog/IDEAS.md` rather than implementing them opportunistically.

## Documentation and History

- Keep repository-level decisions traceable through `MASTER.md` and `docs/history/CHANGELOG.md`.
- Add task-specific history records under `docs/history/` when requested.
- Prefer concise, durable documentation over speculative implementation notes.

## Validation Expectations

Before completing changes, verify:

1. Git branch, HEAD, and working-tree status.
2. Required baseline files are present.
3. No unintended application code or dependencies were added.
4. Documentation links and paths remain accurate.
main
