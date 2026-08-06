# Engineering Knowledge Graph

## Nodes

- **Authority:** SPEC-001 through SPEC-005 in `TRACEABILITY_MATRIX.md`.
- **Business rules:** frozen scope, no feature additions, simplicity first, CEO authority.
- **Architecture:** Kernel, Core, Business, AI, Integrations, UI, Storage.
- **Implementation:** audit script and Make target; there are no product modules or public product interfaces.
- **Evidence:** audit, metrics, health, ledger, decisions, debt, dashboard, certificates, and baseline records.
- **Change:** the commits listed in `CHANGELOG_BUILD0.md` and `ENGINEERING_LEDGER.md`.

## Edges

| From | Relationship | To |
|---|---|---|
| Specification | constrains | all repository work |
| SPEC-004 | names | seven architecture components |
| SPEC-005 | blocks definition of | component interfaces and dependencies |
| CEO-001 | requires | governance evidence documents |
| CEO-002 | is validated by | `make audit` |
| `scripts/audit_build0.py` | verifies integrity of | frozen specification and evidence set |
| `TRACEABILITY_MATRIX.md` | maps | requirements to evidence and checks |
| `ENGINEERING_DECISIONS.md` | explains | baseline design choices |
| `FINAL_AUDIT.md` | supports | certificates |
| certificates | freeze | Build 0 foundation only |

## Architecture dependency graph

No dependency arrows are asserted between the seven named components because the Specification supplies none. Adding such edges would be an architectural invention. Future authorized work must add every module, interface, dependency, test, document, and implementing commit to this graph in the same change.
