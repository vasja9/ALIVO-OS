# System Architecture ADR Amendment

## Status

Architecture Amendment

## Version

1.0

## Authority

CEO Approved

## Parent Document

ARCHITECTURE-000 — System Architecture

## Purpose

Record the architectural decisions that govern the layered System Architecture without changing its approved structure or introducing implementation choices.

## Last Approved By

CEO

## Approval Date

2026-08-06

## Document ID

ARCHITECTURE-000A

## Amendment Scope

This amendment adds decision records to ARCHITECTURE-000.

It does not replace the parent document, alter its five layers, add product behaviour, or select implementation technology.

If this amendment conflicts with the parent document, the parent document prevails.

## Architectural Decisions

### ADR-001 — Enforce downward-only layer dependencies

#### Status

Accepted

#### Decision

Dependencies flow downward through the approved architectural layers. Lower layers do not depend on higher layers.

#### Reason

One dependency direction preserves clear responsibilities and prevents infrastructure, integrations, and business services from becoming coupled to presentation concerns.

#### Alternatives Considered

Allowing bidirectional dependencies between layers.

#### Consequences

Higher layers may use lower-layer capabilities, while lower layers remain independently usable and do not call upward.

### ADR-002 — Keep business rules out of integrations and the user interface

#### Status

Accepted

#### Decision

Business rules belong to Business Services. The Executive Experience presents approved information, and the Integration Layer communicates with external systems without owning business rules.

#### Reason

Keeping business behaviour in one architectural layer preserves consistent decisions across user experiences and external-system connections.

#### Alternatives Considered

Duplicating business rules in the user interface or individual integrations.

#### Consequences

Presentation and integration changes do not redefine business behaviour. Business Services remain the authoritative location for business logic.

### ADR-003 — Apply cross-cutting concerns to every layer

#### Status

Accepted

#### Decision

Security, logging, configuration, auditability, traceability, and performance monitoring remain responsibilities of every architectural layer.

#### Reason

Restricting these concerns to a single layer would leave gaps in system-wide governance and operational visibility.

#### Alternatives Considered

Assigning all cross-cutting concerns only to Infrastructure.

#### Consequences

Every layer must support the approved concerns within its own responsibility while Infrastructure supplies the underlying capabilities where appropriate.

## Implementation Rules

Do not define implementation.

Do not define technology.

Do not define programming languages.

Do not define databases.

Apply these decisions only within the structure approved by ARCHITECTURE-000.

## Validation

Verify:

- the amendment has the correct document identifier
- the parent document is ARCHITECTURE-000
- every decision restates an approved System Architecture rule
- no implementation technology or new product behaviour is introduced
- ARCHITECTURE-000 links to this amendment

## Commit Message

ARCHITECTURE-000A: Add System Architecture ADR Amendment

Stop.
