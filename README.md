# ALIVO-OS

**AI Business Operating System**

ALIVO-OS is an AI Business Operating System built around a stable kernel, business-first architecture, and CEO-governed automation.

## Repository Status

- Development Phase: Genesis-000 — Engineering Foundation
- Specification: v1.0 (Frozen)
- Architecture: Frozen
- Application Code: Not yet introduced
- Dependencies: Not yet introduced

## Authoritative Documents

- `MASTER.md` — engineering constitution and operating rules.
- `docs/ALIVO-OS_Specification_v1.0.md` — frozen product specification.
- `docs/history/GENESIS-000.md` — Genesis-000 foundation record.
- `docs/history/CHANGELOG.md` — chronological project history.
- `docs/backlog/IDEAS.md` — parking lot for deferred ideas.

## Development Rules

- Implement Specification v1.0 only.
- Do not add application code until an approved implementation task requires it.
- Do not add dependencies until an approved implementation task requires them.
- Defer feature ideas to the backlog instead of expanding current scope.
- Favor clarity, simplicity, and traceable decisions.
- CEO has final authority over business rules.
 codex/establish-technical-stewardship-for-alivo-os
## Build 0 Baseline

Build 0 is a governance-only repository foundation; the frozen Specification does not yet define product behavior. The baseline, traceability, review, and certification records are indexed in [`docs/BUILD0_BASELINE.md`](docs/BUILD0_BASELINE.md).

Run the deterministic, offline audit with:

```sh
make audit
```

Build 0 is frozen. Build 1 requires explicit CEO authorization.

## Genesis-000 Scope

Genesis-000 establishes repository governance, documentation structure, history tracking, and hygiene rules only. It intentionally does not introduce runnable application code, package manifests, generated artifacts, or dependency locks.
 main
