# Product requirements

[Home](../../README.md) • Status: proposed v1.0

## 1. Product outcome

Give an on-call responder one workspace to understand an incident, inspect supporting evidence, coordinate ownership and review a proposed recovery action. Every AI conclusion must be traceable to evidence; a responder can complete the manual incident workflow when AI is unavailable.

### Primary users

| Persona | Needs | Success signal |
| --- | --- | --- |
| Responder | Identify affected service, inspect evidence, claim work | Can acknowledge and investigate from a phone or desktop |
| Incident commander | Coordinate recovery and evaluate action risk | Can inspect the exact target, expected effect and verification plan before deciding |
| Administrator | Configure workspace, credentials and integrations | Can grant narrow capabilities and revoke future execution |
| Auditor | Reconstruct decisions and changes | Can follow an immutable, attributable action history |
| Viewer | Follow status without modifying it | Understands impact and the next update time |

Users can hold multiple roles. Administrator privileges alone do not grant remediation approval.

## 2. Release boundaries

| Stage | Included | Exit evidence |
| --- | --- | --- |
| M0 foundation | Auth, workspace scope, service catalog, synthetic alerts, transactions | Cross-workspace denial and durable-ingestion tests |
| M1 usable MVP | Incident list/detail, timeline, runbooks, cited diagnosis, simulator approvals, audit, responsive layouts | Complete demo scenario and browser tests |
| M2 integrations | Read-only observability/git connectors, queue recovery, plugin settings | Connector contract tests and operational drills |
| M3 production action pilot | A small set of reversible, allowlisted actions; independent approval | Security review, reconciliation and rollback rehearsals |
| M4 growth | Multi-workspace administration, larger load, reporting | Load targets, recovery targets and usability results |

Payments, a public plugin marketplace, arbitrary shell execution, autonomous production remediation, full log storage and training a foundation model are outside v1. Log systems remain the source of detailed telemetry; this product stores bounded redacted evidence excerpts and references.

## 3. Functional requirements

| ID | Requirement | Acceptance criterion |
| --- | --- | --- |
| FR-01 | Authenticate users and authorize workspace membership | A user cannot read another workspace by changing any URL, ID, stream cursor or artifact reference |
| FR-02 | Ingest authenticated alert webhooks | Valid events receive 202 only after commit; replaying an external event ID returns the existing receipt |
| FR-03 | Correlate active incidents deterministically | Concurrent alerts with the same workspace/service/environment/fingerprint attach to one active incident |
| FR-04 | Manage incident lifecycle | Only allowed role/state/version combinations can acknowledge, transition or resolve an incident |
| FR-05 | Show incident evidence and timeline | Source, time range, collection time and completeness are visible; records are ordered by committed stream sequence |
| FR-06 | Search versioned runbooks | Results respect workspace and service/environment scope; citations identify version and passage |
| FR-07 | Generate a structured diagnosis | Facts, hypotheses, missing data and proposed next checks are separate fields |
| FR-08 | Review actions | Approval shows exact arguments, target revision, blast radius, expiry and verification criteria |
| FR-09 | Execute permitted simulation actions | Duplicate queue delivery does not duplicate the simulated effect; outcome is recorded |
| FR-10 | Handle uncertain external execution | A timeout after dispatch yields outcome_unknown and a reconciliation task, not an automatic second write |
| FR-11 | Keep operators updated | Authorized committed updates appear through SSE; reconnection gaps cause an explicit snapshot refresh |
| FR-12 | Administer connector plugins | View version, grants, health, data access and revocation; missing credentials produce actionable status |
| FR-13 | Preserve decision history | Timeline and audit identify actor, action, reason, request ID and relevant hashes without exposing secrets |
| FR-14 | Resolve and learn | A human confirms recovery; a postmortem draft links evidence and separates unknowns from confirmed causes |
| FR-15 | Work across device sizes | All primary tasks work at 320 CSS px, keyboard-only and screen-reader navigation |
| FR-16 | Degrade gracefully | Manual workflows work when the model, search index or one connector is unavailable |

## 4. Nonfunctional targets

These are design goals to verify, not claims of achieved performance. The baseline load is **20 alerts/second globally**, ten workspaces, 2,000 total services and 100 concurrent operators. Test an additional burst of 200 alerts/second for five minutes.

| ID | Target | Measurement boundary |
| --- | --- | --- |
| NFR-01 | Core API availability 99.9% per calendar month | Valid read/command requests returning a successful or intended business response; dependency failures count against affected endpoints |
| NFR-02 | Read p95 <400 ms | API ingress to response for bounded list/detail requests at baseline load, excluding internet latency |
| NFR-03 | Durable webhook acknowledgment p95 <500 ms | Accepted request ingress to committed receipt response at baseline load |
| NFR-04 | Live event freshness p95 <2 s | Mongo commit to visible authorized browser update with healthy network |
| NFR-05 | First diagnosis p95 <45 s | Run accepted to useful structured diagnosis at baseline load; provider/rate-limit failures reported separately, never silently excluded |
| NFR-06 | Dashboard usable within 2.5 s | Representative mid-tier phone on a documented 4G profile; measure navigation and usable primary content |
| NFR-07 | Disaster RPO <=5 min and RTO <=60 min | Regional outage restoration rehearsal; excludes acknowledged external effects that need reconciliation |
| NFR-08 | No unauthorized writes or tenant data exposure | Deterministic security tests; any observed violation blocks release |
| NFR-09 | Accessible and adaptive interface | WCAG 2.2 AA target plus project-specific touch and motion requirements |

Load-test results must report dataset size, build, machine sizes, provider behavior and percentiles. During bursts, accepted events remain durable and backlog age is visible even if the diagnosis target is exceeded.

## 5. Canonical user journey

1. A signed synthetic alert reports elevated checkout errors.
2. The server records the alert and creates or updates an incident.
3. The responder opens the incident and acknowledges it.
4. The investigator retrieves a redacted error excerpt, a deployment record and a published runbook.
5. The diagnosis states a likely cause with evidence and an alternative explanation.
6. A proposal identifies a simulator rollback target and verification window.
7. A commander reviews and approves the immutable proposal.
8. The executor changes the simulated service and records its receipt.
9. Recovery observations are displayed; the responder moves the incident to monitoring and then resolves it.
10. The product creates a reviewable postmortem draft with accurate timestamps and evidence links.

## 6. Severity and lifecycle

| Severity | Default meaning | Presentation |
| --- | --- | --- |
| sev1 | Widespread outage of a critical user journey | Critical label and icon; highest queue priority |
| sev2 | Significant degradation or major partial outage | High label and icon |
| sev3 | Limited impact with a workaround | Medium label |
| sev4 | Minor impact or investigation request | Low label |

Workspace policy can refine severity definitions. AI may suggest a severity; a trusted alert mapping or authorized human establishes it. Severity does not grant execution permissions.

Lifecycle: `declared → investigating → mitigating → monitoring → resolved`. Investigation can move directly to monitoring when no change is needed. Failed monitoring returns to investigating or mitigating with a reason. A resolved incident may reopen subject to active-fingerprint conflict handling. Acknowledgment is the `declared → investigating` command and owner assignment, not a separate status.

## 7. Product analytics

Track time to acknowledge, time to first useful diagnosis, time to mitigation, time to resolution, proposal acceptance, citation correctness and operator task completion. Keep distributions by severity; distinguish human response time from system processing. Record why proposals were rejected. Do not describe correlation in an uncontrolled demo as a measured productivity gain.

## 8. MVP acceptance walkthrough

- Seed two workspaces, two commanders, two responders and at least twelve varied incidents.
- Complete the canonical journey at 390 px and 1440 px widths.
- Stop Redis after accepting an alert; recover it and show the pending work resumes.
- Disconnect the browser and reconnect after new events; verify replay and no duplicate rows.
- Revoke a connector after approval but before dispatch; verify execution is denied.
- Attempt to approve another user's stale action and verify precise conflict feedback.
- Disable the model provider and continue manual investigation and resolution.
- Export a postmortem that includes both confirmed findings and remaining uncertainty.

See [test strategy](../engineering/TEST_STRATEGY.md) for verification procedures and [implementation plan](../engineering/IMPLEMENTATION_PLAN.md) for release order.
