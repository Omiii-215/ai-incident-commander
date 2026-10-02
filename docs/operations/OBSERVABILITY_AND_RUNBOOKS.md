# Observability and operating runbooks

[Home](../../README.md) • [Deployment](DEPLOYMENT.md)

## 1. Telemetry contract

Every request has `requestId`; every job has `outboxId`/`jobRunId`; every investigation has `runId`; every action has `actionId`/`executionKey`. Propagate correlation through trusted boundaries without using raw user text as a tag.

Structured logs: timestamp, level, component, environment, request/run ID, workspace ID where permitted, operation, duration, outcome and safe error code. Redact secrets, cookies, authorization headers, personal data and raw tool/model content before emission. High-cardinality identifiers belong in logs/traces, not unbounded metric labels.

OpenTelemetry measures application operations. Optional LangSmith tracing receives redacted, bounded AI metadata only after workspace policy allows it. Do not assume a tracing provider's default settings meet the project's retention or residency policy.

## 2. Metrics and dashboards

| Signal | Metric examples | Why it matters |
| --- | --- | --- |
| Core API | request count, 5xx ratio, p50/p95/p99 duration | User-facing availability and latency |
| Ingestion | accepted/duplicate/rejected alerts, durable-ack time | Lost or delayed alert risk |
| Work | oldest pending outbox age, queue wait, attempts, lease loss | Backlog and recovery correctness |
| AI | time to first diagnosis, invalid schemas, unsupported citations, token use | Usefulness, cost and quality |
| Actions | awaiting review age, stale approvals, dispatch/receipt latency, unknown outcomes | Human control and execution risk |
| Plugins | health, timeouts, denied grants, schema failures | Source-specific degraded behavior |
| Stream | connections, replay count, resync count, commit-to-browser delay | Freshness of the dashboard |
| Database | transaction conflicts, query latency, replica lag, storage | Capacity and durability |

Operator dashboard panels: active incidents by severity; incident age; oldest pending work; dependency health; action outcomes; SLO budget; model budget; recent deployment. Keep product status separate from the platform's own health.

## 3. SLI definitions

Availability denominator includes valid production requests to core API endpoints. Authentication failures, business conflicts and malformed requests are excluded from platform failures; dependency-generated 5xx and timeouts are included. Publish the exact query so exclusions are reviewable. A 99.9% monthly target permits approximately 43.2 minutes of unavailability in a 30-day month.

Report latency at baseline load and separately under burst. For AI, report success rate as well as latency: excluding failed/queued runs from latency must not hide lost service. Live-update delay requires a browser-observed metric or synthetic probe, not only server enqueue time.

## 4. Proposed alert thresholds

Thresholds are initial tuning values. Evaluate them in staging and revise after load tests.

| Condition | Initial threshold | Response |
| --- | --- | --- |
| Core availability burn | Multi-window SLO burn, fast 14.4x over 1h and 5m | Page on-call |
| Durable ingestion failure | >1% valid events fail for 5m, minimum 100 events | Page; inspect DB/edge |
| Outbox backlog | Oldest ready intent >60s for 5m | Alert worker owner |
| Unknown action outcome | Any production action unresolved >60s | Page commander; block conflicting action |
| Database unavailable | Readiness failures across instances >60s | Page platform owner |
| Provider degradation | >20% investigation failures over 10m, minimum 20 runs | Mark degraded; alert integration owner |
| Stream freshness | p95 >2s for 10m or reconnect surge | Inspect tailer/proxy; preserve manual refresh |
| AI spend | 80% then 100% of workspace budget | Notify admin; pause new AI runs at cap, retain manual workflow |

Notification delivery is a configured integration with explicit channel permissions. A design document does not authorize sending real messages.

## 5. Runbook: Redis unavailable or queue lost

**Symptoms:** jobs delayed, queue connection errors; durable API writes may still succeed.

1. Confirm MongoDB ingestion and outbox commits remain healthy.
2. Show delayed background processing in the dashboard; preserve manual incident actions.
3. Restore Redis connection/configuration; inspect resource pressure and eviction policy.
4. Run the bounded outbox reconciler over incomplete intents, using existing outbox IDs.
5. Confirm durable job completion suppresses duplicates; prioritize aged work by workspace fairness.
6. Check actions that were executing before the outage; reconcile outcomes before new dispatch.
7. Record the backlog drain time and accepted-versus-completed counts.

**Recovery evidence:** no missing accepted intent; no duplicated simulated/provider effect; queue age returns below target.

## 6. Runbook: database outage

1. Stop accepting durable commands with explicit retryable responses; never return a fake successful receipt.
2. Pause worker claims and action dispatch when policy/state cannot be read.
3. Check replica-set health, failover, disk, connections and recent migrations.
4. Recover the managed database or execute the tested restore plan.
5. Verify index/validator versions and two-tenant isolation before reopening traffic.
6. Reconcile unknown action outcomes independently of database recovery.

**Recovery evidence:** authoritative reads/writes healthy, replication stable, acceptance probes pass and no pending unknown actions are silently retried.

## 7. Runbook: uncertain action outcome

1. Confirm the action is `outcome_unknown`; keep the target locked against conflicting changes.
2. Preserve executionKey, provider request/operation IDs, exact spec hash and dispatch timestamp.
3. Use only the connector's read-only reconciliation method to inspect receipt/status/target state.
4. If success is conclusive, store evidence and start verification. If failure is conclusive, store the reason.
5. If still ambiguous, escalate to a commander and keep it unresolved; do not create another write attempt as a probe.
6. A new attempt or rollback requires a current proposal and applicable approval.

**Recovery evidence:** conclusive provider/target evidence or explicit unresolved ownership; never an invented failure based only on timeout.

## 8. Runbook: model or retrieval failure

1. Identify provider errors versus malformed output versus missing evidence.
2. Apply bounded retry only to eligible read/model calls; respect provider rate limits and budget.
3. Continue manual workflow; label diagnosis unavailable/partial and preserve source checks.
4. If vector search fails, use the configured scoped lexical fallback with an explicit mode label.
5. Do not silently change providers or publish uncited diagnoses.
6. Re-run a representative evaluation after prompt/model/retrieval changes.

## 9. Runbook: stale dashboard

1. Compare persisted incident version with API response and browser cache version.
2. Inspect SSE connection, named heartbeat and proxy buffering. Heartbeat every 15s; mark delayed after 45s without traffic.
3. Validate cursor workspace and retention; force a fresh snapshot on resync_required.
4. Confirm event tailing is reading MongoDB even if Redis hints are absent.
5. Check slow-consumer buffer limits and excessive tab connections.
6. Confirm commands always fetch/revalidate authoritative versions before review/dispatch.

## 10. Runbook: compromised or faulty plugin

1. Revoke the workspace installation and disable new dispatch globally if its version is affected across tenants.
2. Revoke/rotate external credentials and review egress logs.
3. Identify in-flight actions; revocation cannot retract a request already sent.
4. Preserve manifest/version/hash, grants, audit events and safe result metadata.
5. Reconcile side effects and remove affected generated content from trusted retrieval where appropriate.
6. Require a reviewed fixed version and connector tests before re-enabling capabilities.

## 11. Incident review template

Record impact window, affected services, user-visible symptoms, detection/acknowledgment/mitigation/resolution timestamps, evidence-backed cause, contributing factors, actions attempted and outcomes, remaining unknowns and follow-up owners/dates. Separate the incident's operational impact from failures of this platform. Export redacted evidence references rather than raw credentials or sensitive logs.
