# Architecture diagram atlas

[Home](../../README.md) • Presentation-ready Mermaid sources

These diagrams describe the intended design. Solid arrows represent primary data/control flow; dotted arrows indicate optional or later capabilities. They do not imply every logical module runs as a separate service. Detailed algorithms live in [LLD](LLD.md) and [event flows](EVENT_FLOWS.md).

## 1. Product workflow

```mermaid
flowchart LR
  Alert[Alert received] --> Incident[Incident created or updated]
  Incident --> Owner[Responder acknowledges]
  Owner --> Evidence[Collect evidence and runbooks]
  Evidence --> Diagnosis[AI diagnosis with citations]
  Diagnosis --> Review[Human reviews proposal]
  Review -->|Approved and current| Execute[Execute permitted action]
  Review -->|Rejected or incomplete| Evidence
  Execute --> Verify[Verify observed recovery]
  Verify --> Monitor[Monitor service]
  Monitor --> Resolve[Human resolves incident]
  Resolve --> Learn[Review postmortem draft]
```

## 2. C4-style context

```mermaid
flowchart TB
  Team[On-call team] --> AIC[AI Incident Commander]
  Admin[Workspace administrator] --> AIC
  Audit[Auditor] --> AIC
  Identity[OIDC identity provider] --> AIC
  Alerts[Monitoring alert sources] --> AIC
  AIC --> Models[Configured AI model provider]
  AIC --> Tools[Approved observability and deployment APIs]
  AIC --> Knowledge[Versioned team runbooks]
  AIC -. Approved integration .-> Comms[Ticketing and notifications]
```

## 3. Container and network boundaries

```mermaid
flowchart TB
  User[Browser] --> Edge[TLS reverse proxy]
  subgraph App[Application network]
    Web[Next.js dashboard]
    API[Express API]
    Outbox[Dispatcher and reconciler]
    Jobs[Investigation and ingestion workers]
    Gateway[Policy gateway]
  end
  subgraph Data[Private data network]
    Mongo[(MongoDB replica set)]
    Redis[(Redis BullMQ)]
    Store[(Object storage)]
  end
  subgraph Restricted[Restricted execution network]
    Executor[Action executor]
    Adapter[Reviewed action adapters]
  end
  Edge --> Web
  Edge --> API
  API --> Mongo
  API --> Store
  Outbox --> Mongo
  Outbox --> Redis
  Jobs --> Redis
  Jobs --> Mongo
  Jobs --> Gateway
  Gateway --> ReadProviders[Read-only provider APIs]
  Jobs --> Models[Model providers]
  Executor --> Redis
  Executor --> Mongo
  Executor --> Gateway
  Executor --> Adapter
  Adapter --> Target[Simulator or permitted production target]
```

## 4. Domain modules

```mermaid
flowchart LR
  Transport[HTTP and webhook transport] --> Auth[Authentication and scope]
  Auth --> Ingest[Ingestion]
  Auth --> Incident[Incident commands]
  Auth --> Action[Action and approval commands]
  Auth --> Query[Dashboard query models]
  Ingest --> Domain[Domain state and invariants]
  Incident --> Domain
  Action --> Domain
  Domain --> UOW[Transactional unit of work]
  UOW --> Repos[Scoped repositories]
  UOW --> History[Timeline and audit]
  UOW --> Events[Stream events and outbox]
  Query --> Repos
```

## 5. Investigation and retrieval pipeline

```mermaid
flowchart TB
  Start[Queued investigation] --> Snapshot[Load incident revision and budgets]
  Snapshot --> Scope[Derive workspace and permitted sources]
  Scope --> Collect[Collect bounded redacted evidence]
  Scope --> Search[Search published runbooks]
  Collect --> Context[Build source-labeled context]
  Search --> Context
  Context --> Generate[Generate structured diagnosis]
  Generate --> Validate[Validate schema and citations]
  Validate -->|Valid| Persist[Persist diagnosis and provenance]
  Validate -->|Repairable once| Generate
  Validate -->|Still invalid| Degraded[Mark degraded and offer manual workflow]
  Persist --> Proposal[Optional allowlisted action proposal]
  Proposal --> Human[Human review boundary]
```

## 6. Durable side-effect boundary

```mermaid
flowchart LR
  Request[Validated command] --> Tx[Mongo transaction]
  Tx --> Domain[(Domain records)]
  Tx --> Timeline[(Timeline and audit)]
  Tx --> Replay[(Workspace replay events)]
  Tx --> Intent[(Outbox intent)]
  Intent --> Dispatcher[Retrying dispatcher]
  Dispatcher --> Queue[BullMQ delivery]
  Queue --> Claim[Durable job claim]
  Claim --> Effect[Bounded external operation]
  Effect --> Receipt[(Receipt or uncertain outcome)]
  Receipt --> Reconcile[Reconcile before retry]
```

## 7. Plugin and permission boundary

```mermaid
flowchart TB
  Catalog[Reviewed versioned catalog] --> Install[Workspace installation]
  Admin[Admin grants scopes] --> Install
  Install --> Registry[Allowed tool registry]
  Model[Model requests a tool] --> Validate[Validate schema and tool identity]
  Registry --> Validate
  Validate --> Policy[Policy gateway]
  Policy -->|Permitted read| Read[Read adapter]
  Policy -->|Proposed write| Spec[Immutable action specification]
  Spec --> Review[Independent human approval]
  Review --> Check[Fresh dispatch checks]
  Check --> Write[Restricted write adapter]
  Read --> Audit[Redacted result and audit]
  Write --> Audit
```

## 8. Dashboard information architecture

```mermaid
flowchart TB
  Shell[Workspace shell] --> Overview[Overview]
  Shell --> Incidents[Incidents]
  Shell --> Services[Services]
  Shell --> Approvals[Approvals]
  Shell --> Runbooks[Runbooks]
  Shell --> Plugins[Integrations]
  Shell --> Audit[Audit]
  Shell --> Settings[Settings]
  Incidents --> Detail[Incident detail]
  Detail --> Summary[Summary and impact]
  Detail --> Timeline[Timeline]
  Detail --> Evidence[Evidence]
  Detail --> Investigation[Diagnosis]
  Detail --> Actions[Actions]
  Actions --> Review[Review exact action]
```

Navigation labels and grouping are specified in [dashboard UX](../design/DASHBOARD_UX.md); adapt the shell without removing critical review context.

## 9. Delivery and release gates

```mermaid
flowchart LR
  Change[Scoped change] --> Static[Types and lint]
  Static --> Unit[Domain tests]
  Unit --> Contract[API and connector contracts]
  Contract --> Integration[Replica-set and queue tests]
  Integration --> Browser[Responsive and accessibility tests]
  Browser --> Eval[AI evaluation where changed]
  Eval --> Stage[Staging rehearsal]
  Stage --> Release[Versioned release]
  Release --> Observe[Observe SLOs and errors]
  Observe -->|Regression| Revert[Rollback compatible application version]
```

Only applicable suites run for a change; required release gates remain mandatory. Production database rollback is not assumed safe after a destructive schema change.

## 10. Diagram maintenance

Keep identifiers simple, quote labels containing parser-sensitive characters and avoid renderer-specific icons or C4 extensions. Every diagram has a text explanation in its owning design document. When a contract changes, update the diagram and its linked document together. Add alternative text or a nearby textual summary when exporting diagrams for a reader who cannot inspect them visually.
