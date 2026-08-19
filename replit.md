# ALIVO-OS

ALIVO-OS is an AI Business Operating System foundation repository built around governance, architecture, and CEO-governed automation.

## Run & Operate

- `make audit` — run the deterministic offline repository audit.
- `npm run desktop:smoke` — syntax-check the Electron entry points.
- `npm run build` — typecheck the TypeScript project.
- `npm test` — run the unit tests when test files are present.

## Stack

- Electron desktop shell
- TypeScript
- Node.js
- electron-builder packaging
- Governance and architecture documentation in `docs/`

## Where things live

- `MASTER.md` and `CONSTITUTION.md` — governing engineering rules.
- `docs/` — product, architecture, build, audit, and governance records.
- `electron/` — Electron main process and preload code.
- `ui/` — desktop UI assets and scripts.
- `kernel/`, `modules/`, and `services/` — reserved runtime boundaries.
- `tests/` — validation scaffolding.

## Product

ALIVO-OS is currently in its governance and engineering foundation phase. The imported repository intentionally limits product code until an approved implementation task authorizes it.

## User preferences

- Follow the repository's frozen specification and scope-control rules.
- Prefer simple, explicit, traceable changes.

## Gotchas

- Do not add product features or dependencies without an approved implementation task.
- The repository's package manager metadata is npm-based; keep the existing lockfile aligned with package changes.
