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
