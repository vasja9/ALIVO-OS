# Technical Debt and Constraints

## Accepted technical debt

None. Build 0 deliberately contains no product implementation whose shortcuts would create implementation debt.

## Authority constraints (not debt)

| ID | Constraint | Impact | Resolution authority |
|---|---|---|---|
| CON-001 | Detailed architecture sections are absent from Specification v1.0. | Component boundaries, interfaces, and dependency directions cannot be implemented. | Approved future specification |
| CON-002 | No functional or non-functional product acceptance criteria are specified. | Product tests and claims of product readiness would be fictional. | CEO-approved specification process |

These constraints must not be "resolved" by engineering inference. They remain visible so future work does not mistake absence for permission.

## Build-tool limitations

| ID | Limitation | Impact | Mitigation |
|---|---|---|---|
| BTL-001 | `extract-zip@2.0.1` is a transitive Electron build-tool dependency with the known `CVE-2026-56876` finding. | Dependency scanning can continue to report a high-severity build-tool finding for unsigned test packaging. | The portable release workflow never processes untrusted archives, keeps the dependency transitive, runs archive-content checks before release upload, and leaves remediation to a compatible upstream Electron toolchain update. |
