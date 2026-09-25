# ADR-0044 — Separation of Duties and Checker Authority

## Status

Accepted

## Context

Sensitive changes require independent review, but full enterprise IAM/RBAC remains future scope.

## Decision

Prompt 11 uses existing actor identity and a narrow approval-authority resolver. The maker actor ID
cannot equal the checker actor ID for approval-required versions. Checker authority is verified at
decision time and fails closed when unavailable.

## Consequences

- Display-name collisions do not satisfy or defeat separation of duties.
- SYSTEM/AUTOMATION actors do not self-approve by default.
- Prompt 82 can later harden the resolver without changing approval evidence semantics.
