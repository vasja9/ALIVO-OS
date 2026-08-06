# ALIVO-OS Master Engineering Constitution

## Purpose

This document defines the engineering foundation for ALIVO-OS. It keeps implementation aligned with the frozen specification, prevents uncontrolled scope growth, and preserves CEO-governed decision making.

## Source of Truth

1. CEO-approved task instructions.
2. `MASTER.md` repository constitution.
3. `docs/ALIVO-OS_Specification_v1.0.md` frozen specification.
4. Task history records in `docs/history/`.
5. Backlog notes in `docs/backlog/IDEAS.md`.

## Build-Phase Rules

- Specification v1.0 is frozen for the current build phase.
- New features are not permitted during implementation unless separately approved.
- Improvements, alternatives, and speculative enhancements must be deferred to the backlog.
- Simplicity takes priority over cleverness.
- Business rules require CEO approval.

## Repository Foundation Rules

- Keep the root documentation minimal and authoritative.
- Keep historical records under `docs/history/`.
- Keep deferred ideas under `docs/backlog/`.
- Do not introduce application code before an approved implementation task.
- Do not introduce dependencies before an approved implementation task.
- Do not commit generated or local environment artifacts.

## Change Control

Every meaningful change should be traceable to an approved task and should preserve the current baseline unless the task explicitly changes it. Agents must validate branch, HEAD, baseline files, and working-tree status before implementation and before final reporting.
