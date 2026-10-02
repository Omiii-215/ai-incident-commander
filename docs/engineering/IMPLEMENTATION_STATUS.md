# Implementation status

[Home](../../README.md) • Recorded 2026-10-02 • Scope: M0 foundation + M1 usable MVP (simulator only)

The referenced `IMPLEMENTATION_PLAN.md`, `TEST_STRATEGY.md`, `DOCUMENTATION_QA.md`, `docs/GLOSSARY.md` and `docs/REFERENCES.md` were not present in the specification package. This build used the release table in [Requirements §2](../product/REQUIREMENTS.md) as the milestone definition. Those documents still need to be written.

## What exists

| Area | Location | Notes |
| --- | --- | --- |
| Shared contracts | `packages/contracts` | Zod request schemas, DTOs, enums, error codes, `ic.plugin/v1` manifest validator, diagnosis output schema |
| Domain rules | `packages/domain` | Incident and action state machines, role matrix, canonical JSON + spec hash, approval and dispatch checks, fingerprinting. No I/O |
| Application + persistence | `packages/core` | Mongo repositories, transactional event writer (timeline, stream event, audit, outbox), idempotency, signed cursors, services, policy gateway, simulator, bounded investigation workflow, job runtime, seed |
| API | `apps/api` | Express 5, `/api/v1` per [API contracts](../architecture/API_CONTRACTS.md), sessions + CSRF, SSE stream, health |
| Worker | `apps/worker` | Outbox dispatcher → BullMQ (job ID = outbox ID), role-filtered consumers (`WORKER_ROLE=investigator|executor|dispatcher|all`), expiry scan |
| Web | `apps/web` | Next.js 16 App Router, Tailwind 4 tokens, TanStack Query, one SSE stream per tab |
| Local infra | `infra/docker-compose.yml`, `scripts/dev-mongo.ts` | Single-node replica set on port 27018, Redis |
| Showcase site | `apps/site` | Static product page deployed to Vercel (https://ai-incident-commander-app.vercel.app) |
| Public demo | `apps/web/lib/demo`, `scripts/demo-capture.ts`, `scripts/demo-e2e.mjs` | The real dashboard built statically (`NEXT_PUBLIC_DEMO=1`) with an in-browser backend over a recorded sample-data snapshot. Reuses `@aic/domain` for permissions, lifecycle, approval and dispatch rules. 19 end-to-end checks pass locally and against the deployment |

## Verification performed

| Check | Result |
| --- | --- |
| `pnpm typecheck` (6 projects, strict) | Pass |
| `pnpm test:unit` | 34 tests pass (includes pure SHA-256 equivalence with Node crypto) |
| `pnpm test:integration` (in-memory replica set) | 44 tests pass: ingestion replay/conflict/signature, concurrent correlation, cross-workspace negatives, idempotency 409/412/428, role denials, approval independence/expiry/stale revision/concurrent approvers, duplicate delivery, revoked grant, revoked approver, stop control, `outcome_unknown` reconciliation (both directions), renewal lineage, citation repair/degrade, provider outage, injection flagging, secret canary redaction, postmortem, SSE replay/resync, CSRF/origin, uniform 404 |
| `next build` | Pass |
| Manual browser run | Canonical journey at desktop (alert → acknowledge → cited diagnosis → request → independent approval → simulated rollback succeeded); no horizontal overflow at 320 px on overview, incidents, incident detail, approval review, services, runbooks, audit |
| Redis outage drill | Alert accepted (202) with Redis stopped; outbox stayed pending; work completed after Redis restart |

Not yet verified: automated browser/e2e tests, axe or screen-reader passes, forced-colors and 200%/400% zoom review, load targets (NFR-01..07), AI evaluation corpus. No performance numbers are claimed.

## Deliberate deviations and gaps

- **Authentication:** a dev-only login adapter (`AUTH_MODE=dev`) stands in for OIDC. Config validation refuses it outside `local`/`ci`, and refuses `oidc` until an adapter exists. No step-up MFA.
- **AI:** the bounded workflow is explicit TypeScript nodes with budgets, checkpoints and fencing, not LangGraph. Only the deterministic fake provider and a `disabled` profile exist; OpenAI/Anthropic adapters are not written. No embeddings: retrieval is Mongo `$text` lexical mode, prefixed by `workspaceId`.
- **Runbooks:** Markdown and plain text only; no PDF extraction or malware scanning. Uploads go to a local filesystem object store through an API upload ticket instead of a presigned S3 URL.
- **Frontend:** pages are client-rendered after an authorized `/me` fetch rather than server-hydrated. Radix is not used; the components use native elements (`<dialog>`, `<details>`, native table semantics). Filters use a disclosure, not a full-screen dialog.
- **Leases** use application time, not database time. The rate limiter and SSE connection quota are in-process (one API replica).
- **Contract additions:** `IncidentDTO.allowedTransitions`, per-workspace `capabilities`/`dispatchStopped` on `/me`, `GET /incidents/{id}/diagnosis`, `GET /incidents/{id}/investigations/latest`, `GET /evidence/{id}`, `GET /runbooks/search`, `PUT /runbooks/{id}/versions/{versionId}/content`, `GET /incidents/{id}/postmortem-drafts/latest`, `POST /dispatch-controls`. These are additive, and the UI uses them so it never re-implements the state machine or permission matrix.
- **Production actions** (M3) are not implemented. `remediations:execute` grants are rejected.
- No linter is configured yet, so `pnpm lint` from AGENTS.md §7 does not exist.
- **Public demo:** the browser-only backend in `apps/web/lib/demo` simulates the API for the showcase. It reuses the domain rules but not the persistence, transaction, outbox or SSE code; it is a demonstration surface, not a second deployment target. `@aic/domain` now uses a dependency-free SHA-256 so the same rules run in browsers.
