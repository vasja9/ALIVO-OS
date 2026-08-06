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
