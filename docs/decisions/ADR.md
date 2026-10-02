# Architecture decision log

[Home](../../README.md) • All entries: proposed/accepted as this design's baseline, not implemented • 2026-10-02

## ADR-001 — Modular API with separate workers

**Context:** the initial team needs a portfolio-scale product with transactional commands and slow external calls.  
**Decision:** one TypeScript repository, modular Express API, separate investigator/dispatcher/executor processes, Next.js web.  
**Alternatives:** everything in Next.js handlers; microservice per domain.  
**Consequences:** shared contracts and simpler deployment; enforce module boundaries in code review. Extract a network service only for measured scale, security isolation or independent ownership.

## ADR-002 — MongoDB is the source of truth

**Context:** incidents have variable evidence and require consistent approvals, events and queue intent.  
**Decision:** use replica-set transactions, strict validation and explicit indexes. Production retrieval uses Atlas Vector Search; local search can be lexical.  
**Alternatives:** PostgreSQL with pgvector is a valid alternative, but is not mixed into this baseline.  
**Consequences:** local replica-set setup is required. Document and test transaction contention; vector search visibility can lag publication, so retrieval checks published versions.

## ADR-003 — Transactional outbox and idempotent workers

**Context:** a database commit and Redis enqueue cannot be one atomic operation.  
**Decision:** commit outbox intent with domain writes; dispatch at least once; persist job completion independently of Redis.  
**Consequences:** more records and a reconciler; prevents accepted work disappearing when Redis is lost. External writes still need connector-specific reconciliation.

## ADR-004 — Durable workspace stream over SSE

**Context:** incident data moves mostly server to client.  
**Decision:** ordered per-workspace events, SSE, seven-day replay and explicit resynchronization.  
**Alternatives:** WebSockets, change streams directly to browsers, polling only.  
**Consequences:** simple web transport; proxy buffering must be disabled. Per-workspace sequence allocation is a potential hotspot. No promise of a globally ordered stream across tenants.

## ADR-005 — Server authorizes every action

**Context:** model outputs and retrieved documents may be inaccurate or malicious.  
**Decision:** bound analysis to read tools; generate immutable proposals; require independent human approval and fresh policy checks for production writes.  
**Consequences:** more deliberate recovery workflow; execution can proceed without trusting generated prose. A prior approval becomes invalid when its bound target or remediation revision changes.

## ADR-006 — Provider adapters with capability tests

**Context:** the project should support OpenAI, Anthropic and other compatible providers without claiming every model behaves identically.  
**Decision:** normalize structured output, tool messages, usage and errors behind an interface; qualify every provider/model profile.  
**Consequences:** no hard-coded model IDs in architecture. Do not silently move incident data to another provider during failover.

## ADR-007 — Two plugin surfaces

**Context:** coding assistants and the deployed application both use the word plugin.  
**Decision:** application connectors use the project's registry, grants and gateway; coding-host plugins follow their own host packaging and trust rules.  
**Consequences:** an installed editor plugin grants no production authority. Cross-host support uses portable instructions and adapters, with explicit compatibility tests.

## ADR-008 — Responsive operation with accessible review

**Context:** on-call responders often use phones and assistive technology.  
**Decision:** support 320 CSS px upward, responsive component layouts, keyboard operation, readable severity labels, and accessible full-screen review on small screens.  
**Consequences:** dense desktop tables require card alternatives; critical action context must never disappear at a breakpoint.

## ADR-009 — Bounded evidence and data retention

**Context:** full telemetry ingestion would dominate storage and expose unnecessary data.  
**Decision:** store redacted excerpts and durable source references; publish immutable runbook versions; expire replay/job artifacts by policy.  
**Consequences:** upstream telemetry may expire; a citation can become unavailable and must say so. Audit retention and user deletion need coordinated policies, not blanket deletion of everything.

## ADR-010 — Simulator before production remediation

**Context:** a useful end-to-end demonstration can be built without granting infrastructure write access.  
**Decision:** MVP actions operate only on a deterministic simulator with realistic success, failure and uncertain-outcome scenarios.  
**Consequences:** demo performance is not production evidence. Each real write connector needs a reviewed grant model, idempotency/reconciliation contract and release gate.

## Adding a decision

Create the next numbered section with date, status, context, decision, alternatives, consequences, affected documents and evidence. Supersede an old decision explicitly rather than deleting the history. Routine implementation choices that stay within this baseline do not require a new ADR.
