# Development Review Checklist

## Purpose

Use this checklist to verify that an ALIVO-OS change implements an approved requirement, preserves the frozen Specification v1.0, and is ready for review.

The checklist supports development review only. It does not authorize new product scope or replace CEO approval where approval is required.

## 1. Requirement and Scope

- [ ] The change references an approved specification, build plan, or tracked task.
- [ ] The intended business result is stated clearly.
- [ ] The implementation is limited to the requested task.
- [ ] No unapproved product feature, capability, or workflow was added.
- [ ] New ideas discovered during development were recorded in the backlog rather than implemented.

## 2. Specification Alignment

- [ ] The change conforms to `CONSTITUTION.md`.
- [ ] The change conforms to `docs/ALIVO-OS_Specification_v1.0.md`.
- [ ] Product boundaries and authority rules remain intact.
- [ ] Kernel behavior remains minimal, stable, and predictable.
- [ ] Business rules and approval boundaries remain CEO-directed.

## 3. Implementation

- [ ] The requested behavior exists in code; it is not represented only by documentation or configuration.
- [ ] The implementation is the simplest complete solution to the approved requirement.
- [ ] Files are located in the repository area responsible for their concern.
- [ ] Names and interfaces are explicit and consistent with nearby code.
- [ ] No unrelated refactoring or cleanup is included.
- [ ] No dead code, temporary debugging output, or placeholder implementation remains.

## 4. Architecture and Integration

- [ ] Module and service boundaries are preserved.
- [ ] Dependencies point toward the appropriate abstraction or boundary.
- [ ] Existing public interfaces remain compatible unless the approved requirement changes them.
- [ ] Error and failure behavior is explicit and predictable.
- [ ] Configuration changes use the established configuration structure.
- [ ] Any architecture decision introduced by the task is documented in the approved location.

## 5. Security and Data

- [ ] The change does not expose secrets, credentials, personal data, or protected business data.
- [ ] Inputs are validated at the appropriate boundary.
- [ ] Authorization and approval checks cannot be bypassed.
- [ ] Logs and errors avoid sensitive information.
- [ ] Data storage, retention, and transfer remain within approved boundaries.
- [ ] New dependencies, if approved and necessary, have been reviewed for security and maintenance impact.

## 6. Verification

- [ ] Tests cover the requested behavior and important failure paths.
- [ ] Existing tests pass.
- [ ] The project build passes.
- [ ] Repository audit or validation commands pass.
- [ ] Manual verification was completed where automated coverage is not practical.
- [ ] Test limitations and unverified behavior are reported honestly.

## 7. Documentation and Traceability

- [ ] Documentation matches the implemented behavior.
- [ ] Relevant specification, architecture, and build documents remain consistent.
- [ ] The change is traceable from the approved requirement to implementation and tests.
- [ ] Changed files and verification evidence are included in the review summary.
- [ ] User-visible or operational changes include the instructions needed to use or support them.

## 8. Repository Readiness

- [ ] The diff contains only files required for this task.
- [ ] Generated files and local environment artifacts are excluded unless explicitly required.
- [ ] Formatting and static checks pass where configured.
- [ ] The commit message identifies the implemented task or requirement.
- [ ] The branch is ready for review without additional uncommitted work.

## Review Decision

Select one outcome:

- [ ] **Approved** — all applicable checks pass and the requested result is complete.
- [ ] **Changes required** — identified issues must be resolved before approval.
- [ ] **Blocked** — an external decision, approval, or dependency is required.

### Review Record

- **Requirement or task:**
- **Reviewer:**
- **Date:**
- **Verification commands:**
- **Limitations or follow-up:**
- **Decision:**
