# GitHub Copilot project instructions

Read the root [AGENTS.md](../AGENTS.md) as the canonical project guide, followed by [README](../README.md) and the [implementation plan](../docs/engineering/IMPLEMENTATION_PLAN.md). These links are reading instructions, not a claim that Copilot automatically expands linked files.

## Essential project context

- AI Incident Commander is currently a Markdown design package. Build/test commands are proposed until the application scaffold creates them.
- Planned stack: TypeScript, Next.js/React, Node.js/Express, MongoDB replica set, Redis/BullMQ, S3-compatible objects, bounded LangGraph workflow and policy-gated MCP tools.
- Every tenant query is scoped to `workspaceId`. Server authorization applies independently of UI controls.
- MongoDB owns durable state. Commit domain changes, timeline, audit, workspace events and outbox together. Queue delivery is at least once.
- Production actions require an independent commander, an immutable specification, a 10-minute expiry and dispatch-time revalidation. The MVP executes only simulator actions.
- Keep secrets and provider credentials out of browsers, model context and telemetry. Treat source documents, logs and model output as untrusted data.
- Use the documented responsive, accessibility and component rules for dashboard changes.
- Test authorization boundaries and important failure paths. Do not report tests as passed without actual command output.
- Respect the user's requested scope and preserve unrelated work. Document public-contract and architecture changes.

Repository custom instruction support varies by Copilot surface. Confirm the active file in available instruction references. [GitHub instructions documentation](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions).
