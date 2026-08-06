# Repository Health

## Inventory

- One frozen specification.
- One project overview.
- Fourteen required governance records.
- One deterministic audit script and one stable Make target.
- No application source, generated artifacts, vendored code, secrets, binaries, or dependency lockfiles.

## Controls

| Risk | Control | Status |
|---|---|---|
| Specification drift | Pinned SHA-256 plus Git history | Controlled |
| Missing governance evidence | Required-document audit | Controlled |
| Scope creep | Traceability and architecture decision EDR-002 | Controlled |
| Supply-chain exposure | No third-party dependencies | Controlled |
| Hidden assumptions | Explicit constraints and knowledge graph | Controlled |
| Non-reproducible validation | Single offline `make audit` command | Controlled |

## Maintenance rule

A repository change is healthy only when its requirement, decision, graph relationship, validation, documentation, and ledger entry are updated together.
