# API contracts

[Home](../../README.md) • Normative HTTP and live-update contract • API v1

## 1. Transport conventions

Base path: `/api/v1`. Browser traffic is same-origin through the reverse proxy. JSON requests use `Content-Type: application/json`; browser commands require a valid session and CSRF token. Session cookies are HTTP-only, Secure and SameSite according to the OIDC flow; use a hardened CSRF mechanism rather than relying only on SameSite.

All workspace routes begin `/workspaces/{workspaceId}`. The server validates membership before resolving any child record. Unknown or inaccessible tenant records return a uniform 404 where needed to prevent identifier enumeration; an authenticated member lacking a permitted operation receives 403.

Commands require a UUID `Idempotency-Key`. Mutations to an existing aggregate require `If-Match: "{version}"`; missing precondition returns 428, stale version returns 412. Same command key and same canonical payload returns the original status/body; changed payload returns 409. Idempotency keys are scoped by subject, workspace and operation.

Lists use `limit` (default 25, maximum 100) and an opaque `cursor`. Sort is an allowlisted tuple with stable ID tie-breaker; cursors bind filter and sort hashes, workspace and last tuple. Invalid/reused filter cursors return 400. Mutable lists may shift as incidents change, so the client reconciles by ID and refreshes; pagination is not a historical snapshot.

## 2. Core endpoint inventory

Paths below are relative to `/api/v1/workspaces/{workspaceId}` unless otherwise marked.

| Method and route | Role | Input / behavior | Success |
| --- | --- | --- | --- |
| GET `/dashboard` | viewer+ | Snapshot cards, first incident page, freshness and stream cursor | 200 |
| GET `/incidents` | viewer+ | status[], severity[], serviceId, ownerId, q, cursor, limit | 200 paginated |
| GET `/incidents/{id}` | viewer+ | Incident summary, versions, capabilities | 200; ETag |
| POST `/incidents/{id}/acknowledge` | responder/commander | owner assignment to actor; If-Match | 200 incident |
| POST `/incidents/{id}/transitions` | responder/commander | targetStatus, reason, If-Match | 200 incident |
| PATCH `/incidents/{id}` | responder/commander | title, severity, ownerId; If-Match | 200 incident |
| GET `/incidents/{id}/timeline` | viewer+ | Historical cursor by streamSeq, limit | 200 paginated |
| POST `/incidents/{id}/comments` | responder/commander | text max 4,000 chars; If-Match on incident | 201 comment |
| POST `/incidents/{id}/investigations` | responder/commander | reason, If-Match | 202 run reference; coalesces active run |
| GET `/investigations/{id}` | viewer+ | Run progress, diagnosis, evidence references | 200 |
| GET `/incidents/{id}/evidence` | viewer+ | cursor, limit, sourceType | 200 |
| GET `/evidence/{id}/download` | viewer+ | Reauthorize then issue short-lived scoped URL or stream | 200/302 |
| POST `/incidents/{id}/actions` | responder/commander | toolId, arguments, target, diagnosisId; If-Match | 201 immutable proposal |
| GET `/actions` | commander/auditor | status, incidentId, cursor, limit | 200 review queue |
| GET `/actions/{id}` | viewer+ | Full review context, specHash, capabilities | 200; ETag |
| POST `/actions/{id}/decisions` | commander | decision approve/reject, specHash, reason; If-Match action | 200 decision + updated action |
| POST `/actions/{id}/cancel` | requester/commander | reason; If-Match | 200 pre-dispatch cancellation or 409 if dispatched |
| POST `/actions/{id}/renew` | responder/commander | reason; If-Match old action | 201 new proposal after fresh preflight |
| GET `/services` | viewer+ | environment, health, cursor, limit | 200 |
| GET `/services/{id}` | viewer+ | Dependency summary, incidents, health freshness | 200 |
| POST `/services` | admin | name, slug, environments, ownerTeam | 201 |
| PATCH `/services/{id}` | admin | Allowed catalog fields; If-Match | 200 |
| GET `/runbooks` | viewer+ | q, serviceId, cursor, limit | 200 |
| POST `/runbooks` | responder/commander | Title and scope | 201 draft |
| POST `/runbooks/{id}/versions` | responder/commander | Upload metadata/checksum; If-Match | 201 upload ticket |
| POST `/runbooks/{id}/versions/{versionId}/complete` | responder/commander | Uploaded checksum; If-Match runbook | 202 indexing |
| POST `/runbooks/{id}/publish` | commander | readyVersionId; If-Match | 200 published pointer |
| GET `/plugins/catalog` | admin | Reviewed available plugin versions | 200 |
| GET `/plugins/installations` | admin | Grants, health, pinned version | 200 |
| POST `/plugins/installations` | admin | pluginId, pinnedVersion, requested grants | 201 pending configuration |
| PATCH `/plugins/installations/{id}` | admin | Narrow grants/status/config references; If-Match | 200 |
| POST `/plugins/installations/{id}/test` | admin | Bounded read-only health check; If-Match | 202 |
| POST `/plugins/installations/{id}/revoke` | admin | Reason; If-Match | 200 future dispatch disabled |
| GET `/audit` | auditor/commander | Actor, operation, dates, cursor | 200 |
| POST `/incidents/{id}/postmortem-drafts` | responder/commander | If-Match | 202 generation |
| GET `/events` | viewer+ | `after` cursor; SSE | 200 stream |

`viewer+` means any active member with a read role; admin and auditor retain workspace read access. Admin alone does not gain responder/commander actions. Renewal creates a new action ID, hash and expiry, supersedes the old pre-dispatch proposal and never carries approval forward.

External ingestion uses `POST /api/v1/connectors/{connectorId}/alerts`, authenticated by that connector's configured method. It does not accept a user-selected workspace. OAuth callbacks, OIDC callback/login/logout and health routes are transport adapters with their own credential checks, not public domain mutations.

## 3. Alert example

```http
POST /api/v1/connectors/2f10a7b5-e8b3-4145-bcaf-787792815a89/alerts
Content-Type: application/json
X-Connector-Timestamp: 1790951400
X-Connector-Signature: <signature-over-timestamp-and-raw-body>
```

```json
{
  "externalEventId": "monitor-checkout-20261002-1430",
  "serviceKey": "checkout",
  "environment": "demo",
  "alertType": "http_error_rate",
  "severity": "sev2",
  "occurredAt": "2026-10-02T14:30:00.000Z",
  "summary": "5xx rate exceeded configured threshold",
  "labels": {"route": "/checkout"},
  "measurements": {"errorRate": 0.18}
}
```

Return 202 with `{receiptId, incidentId, duplicate:false}` after durable commit. An exact replay returns 200 and `duplicate:true`. A source ID reused for different normalized content returns 409 `SOURCE_EVENT_CONFLICT`. The synthetic connector accepts timestamps within ±300 seconds and checks raw-body signature using constant-time comparison; real connectors implement their vendor-specific signature scheme. Rate limits are per connector/workspace and enforced before expensive processing.

## 4. Versioned command example

```http
POST /api/v1/workspaces/5989a76e-0b49-4e29-b8eb-71f134c806fc/incidents/96c17136-c223-4ead-abd2-669c872dd382/transitions
Idempotency-Key: b5ee4df7-6b30-4411-938d-bb2a02d7d567
If-Match: "5"
X-CSRF-Token: <session-bound-token>
Content-Type: application/json
```

```json
{"targetStatus":"monitoring","reason":"Simulator rollback verified; observing recovery."}
```

Response 200 includes `data`, `meta.requestId`, and the new version; ETag matches that version. A 412 response includes `currentVersion` but does not automatically replay the user's command. UI fetches fresh context before offering retry.

## 5. Approval request

```json
{
  "decision": "approve",
  "specHash": "sha256:<canonical-specification-hash>",
  "reason": "Target revision and rollback destination match the reviewed deployment."
}
```

The server checks the action ETag, immutable hash, independent commander identity, target revision, incident generation/remediation revision, permissions and expiry. It returns the accepted decision and updated action state. It may queue work; 200 approval does not mean the external action has succeeded. The browser must use action status and receipt evidence for completion.

If the proposal is expired, return 409 `ACTION_EXPIRED`. If the target/revision changed, return 409 `ACTION_STALE`. The renew command performs current preflight and creates a new proposal for a new review.

## 6. Live stream bootstrap and replay

`GET /dashboard` reads initial dashboard data and the workspace stream counter in one snapshot transaction. Response metadata includes `snapshotStreamSeq` as a decimal string and `snapshotCursor` as an opaque, tamper-checked encoding of workspace + sequence + cursor version. Browser opens `GET /events?after={snapshotCursor}` and receives all later retained invalidations. This closes the race between initial fetch and subscription.

Native EventSource supports event IDs for reconnects; the application's cursor and retention protocol are additional design rules. [MDN SSE](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events).

On reconnect, valid `Last-Event-ID` takes precedence over `after`. A cursor from another workspace or malformed cursor is rejected with 400; unauthorized sessions get 401/403. A cursor ahead of the committed counter or older than retention triggers a `resync_required` event and a stream close.

```text
id: <opaque-workspace-sequence-cursor>
event: entity_changed
data: {"entityType":"incident","entityId":"96c17136-c223-4ead-abd2-669c872dd382","entityVersion":6,"reason":"status_changed","streamSeq":"1842"}

```

The stream carries IDs, versions and safe change reasons, not full log excerpts, secrets or generated reasoning. The client deduplicates cursors and invalidates affected queries. Use a per-workspace connection; close it and clear caches on logout or workspace change. Validate current session/membership at least every 30 seconds and close immediately on local revocation notification.

Heartbeat comments every 15 seconds; proxy read timeout >=60 seconds; disable buffering and caching. For slow consumers, bound the connection buffer (proposed 1 MiB), emit resync if possible and disconnect. Reconnect with jitter; show disconnected/stale status and fall back to bounded snapshot polling if streaming repeatedly fails.

On `resync_required`, explicitly close EventSource, fetch a fresh dashboard snapshot, clear obsolete query cursors and reopen using its new snapshotCursor. Page-specific history comes from `/timeline`, not the seven-day replay log. Pagination and additional page fetches reconcile with live invalidations by record version.

## 7. Standard error envelope

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "This incident changed. Refresh it before trying again.",
    "requestId": "request-uuid",
    "retryable": false,
    "details": {"currentVersion": 6}
  }
}
```

| HTTP | Code examples | Client behavior |
| --- | --- | --- |
| 400 | INVALID_INPUT, INVALID_CURSOR | Show field/context error; preserve valid input |
| 401 | SESSION_EXPIRED, INVALID_CONNECTOR_SIGNATURE | Reauthenticate or fix connector credentials |
| 403 | FORBIDDEN, SELF_APPROVAL_DENIED | Explain missing capability; do not retry silently |
| 404 | NOT_FOUND | Show unavailable state without cross-tenant information |
| 409 | IDEMPOTENCY_CONFLICT, INVALID_TRANSITION, ACTION_STALE, ACTION_EXPIRED, ACTIVE_INCIDENT_CONFLICT | Refresh current context and propose an appropriate user action |
| 412 | VERSION_CONFLICT | Refresh aggregate; retain user draft; require fresh decision |
| 413 | PAYLOAD_TOO_LARGE | Show documented limit |
| 422 | UNSUPPORTED_FILE, INVALID_ACTION_ARGUMENTS | Correct data/format |
| 428 | PRECONDITION_REQUIRED | Client bug; supply version |
| 429 | RATE_LIMITED, AI_BUDGET_EXCEEDED | Respect Retry-After; present quota state |
| 503 | DEPENDENCY_UNAVAILABLE, CAPACITY_EXCEEDED | Retry eligible reads/ingestion with backoff; query uncertain command by original key |

## 8. Limits and compatibility

- Request body: 256 KiB ordinary JSON; upload flow uses object storage tickets and 10 MiB document limit.
- Query text: 200 characters; comment: 4,000; reason: 1–1,000; names: 1–120.
- Proposed read quota: 120 requests/minute/user, separate SSE connection quota of three active tabs/user; tune after measurement.
- Ingestion quotas support the specified global burst and per-tenant fairness; do not apply browser quotas to connectors.
- Additive fields are allowed in v1 responses; consumers ignore unknown fields. New required input fields or changed enum semantics require a new contract version/migration.
- Generate an OpenAPI specification from shared runtime schemas when implementation begins. These Markdown contracts are the design source, not an executable API server.
