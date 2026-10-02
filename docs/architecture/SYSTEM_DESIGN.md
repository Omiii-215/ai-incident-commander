# System design

[Home](../../README.md) • Canonical architecture overview

## 1. Design approach

Start with a modular monolith and independently scalable worker processes. Keep incident transitions, authorization, approvals and durable events in one transactional database. Separate external model/tool calls from transactions because remote latency and outcomes cannot be made atomic with database writes.

The browser talks to one same-origin API path. The API owns business decisions; workers perform queued evidence collection and investigation. A restricted action executor invokes permitted connectors only after fresh policy checks. Components can share a repository and internal packages without becoming separate network services at the MVP stage.

## 2. Authority and data flow

| Concern | Authoritative record | Derived or transient state |
| --- | --- | --- |
| Incident lifecycle | MongoDB incidents | Dashboard cache and severity counts |
| Action permission | Membership, policy, immutable action and approval records | Model text, MCP annotations and UI enablement |
| Job intent | MongoDB outbox and job_runs | Redis/BullMQ scheduling |
| Live updates | MongoDB workspace_events | SSE connections and Redis wake-up hints |
| Runbooks | Published runbook version and artifact checksum | Chunks and vector index |
| External side effect | Provider receipt plus verified observation | An HTTP timeout alone is not proof of failure |

Every state-changing transaction updates the domain record and writes its audit/event/outbox records together. A dispatcher retries incomplete work. Duplicates are expected at each delivery boundary; deduplication belongs to the durable consumer, not only the queue.

## 3. Tenant and authorization model

Workspace is the tenant. API middleware derives membership from the authenticated session; it never trusts a workspace claimed in a model response or connector payload. The same scope is carried through repositories, queue jobs, stream cursors, artifacts, retrieval filters and external grants.

The MVP exposes one workspace in its main UX while tests and schemas use at least two. Data access is workspace-wide in v1; do not claim per-service ACL support until every query, event and retrieval path implements it. Future service-level access requires an ADR and new isolation tests.

Use an OIDC identity provider, secure HTTP-only session cookies, CSRF protection on browser commands and workload credentials for service calls. Webhooks use connector-specific authentication and replay protection; they do not share browser sessions.

## 4. Ingestion and correlation

Validate a webhook's signature, bounded body and schema before accepting it. Derive `workspaceId` from the authenticated connector configuration. Normalize source severity and service mapping. Preserve source timestamps separately from receipt time.

The exact duplicate key is `(workspaceId, connectorId, externalEventId)`. The correlation key is `(workspaceId, serviceId, environment, fingerprint)`, where fingerprint is a deterministic normalized failure signature. Only one incident with this key may be active. The partial unique index, transaction retries and duplicate-key recovery enforce this under concurrency.

Resolved incidents retain their history. A new alert opens a new incident unless an explicit authorized reopen command is used. Reopen increments generation and rejects a collision with an existing active incident; the UI offers a link to that active incident. Correlation never relies on an LLM result.

## 5. Durable queue and stream

MongoDB must run as a replica set locally and in production because this design relies on transactions. MongoDB documents transaction support across multiple documents on replica sets and sharded clusters. [MongoDB transactions](https://www.mongodb.com/docs/manual/core/transactions/).

Outbox rows include task type, schema version, workspace, aggregate ID, attempt state and next dispatch time. The dispatcher uses a lease to enqueue jobs. It can crash between enqueue and marking dispatch; workers therefore claim and complete `job_runs` by the outbox ID. A reconciler re-enqueues unfinished intent after Redis loss.

Workspace event sequences are allocated by incrementing a per-workspace counter inside the same transaction as their domain update. This serializes sequence allocation within a workspace and is an accepted tradeoff at the stated load. A future hot tenant may require partitioned streams; do not introduce sequence gaps by reserving ranges before commit.

SSE replay reads durable events by sequence. An API process can share a polling tailer across its connected users in a workspace; Redis is an optional notification to poll sooner. Seven-day stream retention means an older cursor must resynchronize. Reconnection and heartbeat details live in [API contracts](API_CONTRACTS.md).

## 6. AI and action boundary

The investigation workflow collects bounded evidence, retrieves published runbooks, produces a schema-validated diagnosis and optionally proposes an allowlisted action. Store source IDs and version checksums with each claim. Explicitly represent incomplete retrieval and unavailable connectors.

The application supports multiple model providers through a capability adapter. A model must pass the same output schema, tool behavior, data handling and evaluation checks before being enabled. The model provider and coding assistant are separate choices; using Claude Code to build the app does not require using Claude at runtime.

Approval belongs to the domain service. Graph checkpoints help resume analysis but do not authorize external writes. A fresh executor check binds workspace, action hash, target revision, remediation revision, policy, connector version and approver membership. Approved production actions require an independent commander. Demo mode targets only a simulator.

External execution has an unavoidable uncertainty window. If the remote side may have acted but no receipt was saved, mark `outcome_unknown`. Reconcile using a provider operation ID, idempotency key or observable target state. If the connector cannot distinguish the result, require manual investigation and prohibit automatic retries.

## 7. Capacity assumptions and arithmetic

| Item | Planning estimate |
| --- | --- |
| Sustained alerts | 20/s × 86,400 = 1,728,000/day |
| Burst | 200/s × 300 = 60,000 alerts; 54,000 above a 20/s baseline |
| Alert envelope | 2 KiB average → about 3.3 GiB/day, excluding indexes and replication |
| Thirty-day alert retention | About 99 GiB raw; budget separately for indexes, audit, streams and replicas |
| Workspace events | Assume 1.5 events/alert plus manual/workflow events; validate with measurements |
| Seven-day stream envelope storage | At 30/s and 1 KiB average, about 17.3 GiB before indexes/replication |
| API operators | 100 concurrent; one SSE connection per active browser tab, with tab sharing optional |
| AI demand | Trigger on a new incident or material change, not every alert; coalesce while a run is active |

At a hypothetical 1 new investigation per 100 alerts, demand is 0.2 runs/s. A mean 30-second run implies about six concurrent investigations by Little's Law. Provisioning must account for provider quotas and tail latency; this ratio is an assumption to test. A burst must not start one AI run for every incoming alert.

Apply per-workspace queues/quotas and fair scheduling. Reserve capacity for commands and ingestion so long AI jobs cannot block manual operation. Admit a new job only when durable intent storage is healthy. Under overload, return 429/503 with retry guidance before acceptance, or accept durably and report backlog explicitly.

## 8. Reliability and consistency

| Failure | Designed behavior |
| --- | --- |
| Database unavailable | Fail durable writes; never acknowledge an uncommitted alert |
| Redis unavailable | Keep pending outbox entries; show delayed background work; manual DB-backed commands continue |
| Model provider unavailable | Manual workflow and runbook search remain; investigation is failed/degraded with retry budget |
| Vector index unavailable | Workspace-scoped lexical search and an explicit retrieval-mode label |
| Connector degraded | Partial evidence with source-specific failure and age |
| Browser reconnects | Replay retained events; refresh snapshot on cursor gap |
| Executor crashes after remote write | Reconcile outcome before another write |
| Storage upload fails | Runbook remains unpublished; retry upload; no broken citation becomes active |

Core writes use optimistic versions and transactions. Read projections may lag; the UI shows a last-refreshed timestamp and reconciles after every command. Never infer write success from a streamed model sentence.

## 9. Deployment evolution

Local: reverse proxy, web, API, workers, Mongo replica set, Redis and local object storage. Use synthetic connectors and a deterministic model fixture by default.

Pilot: hosted containers, managed database/Redis/object storage, TLS, OIDC, secret manager, backups, staging and one region. Separate action-executor credentials from investigator credentials.

Growth: scale API replicas and worker pools independently; isolate high-risk connectors into restricted workloads. Introduce partitioning or service extraction only after a measured bottleneck. Multi-region active-active writing is outside this design.

## 10. Decisions and known tradeoffs

- MongoDB fits flexible evidence and incident records, but transactional counters can become hot and joins require explicit read models.
- BullMQ simplifies asynchronous processing, but duplicate execution must be handled by application design.
- SSE fits one-way live updates; it still requires compatible proxy timeouts and a durable replay protocol.
- MCP provides a tool interface; it does not establish plugin trust or replace authorization.
- A modular monolith reduces deployment complexity while retaining separable worker and executor boundaries.
- The v1 dashboard and approvals require a live connection for mutations; offline queuing of action approval is intentionally outside scope.

See [ADR](../decisions/ADR.md), [HLD](HLD.md), [LLD](LLD.md) and [security](../ai/SECURITY_AND_PERMISSIONS.md) for detailed consequences.
