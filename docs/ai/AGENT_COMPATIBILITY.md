# AI coding-tool compatibility

Status: documentation support baseline checked 2026-10-02. This package contains instructions and specifications only. Installed tools, account entitlements, transport support and host versions must be checked on the machine that implements the project.

Related: [canonical agent rules](../../AGENTS.md), [Claude entry point](../../CLAUDE.md), [Gemini entry point](../../GEMINI.md), [Copilot entry point](../../.github/copilot-instructions.md), [application plugins](PLUGIN_SYSTEM.md).

## 1. Three independent compatibility questions

1. **Can the coding tool read these project instructions?** Markdown can be attached or read manually even when automatic discovery is unavailable.
2. **Can that coding tool load a particular skill, hook, or MCP connection?** This depends on the host, version, transport, account and permissions.
3. **Can the application call a particular model or service?** That requires a tested provider or connector adapter in the application backend.

Choosing Claude Code to write the app does not force the running app to use Claude. Choosing a runtime model does not install a coding-host plugin. This project aims for portable instructions and explicitly tested adapters; it does not claim that every AI product supports every plugin.

## 2. Instruction entry points

| Coding surface | Included entry file | Support statement | Verification before use |
|---|---|---|---|
| Codex | `AGENTS.md` | Project instruction discovery is documented | Ask host to identify loaded project instructions and summarize invariants |
| Claude Code | `CLAUDE.md` importing `AGENTS.md` | Claude documents `@path` imports | Confirm canonical rules were loaded, including simulator-only MVP |
| Gemini CLI | `GEMINI.md` | Gemini documents project context files | Confirm it opened linked canonical rules; a link alone is not proof |
| GitHub Copilot | `.github/copilot-instructions.md` | Repository instruction file is documented; feature support varies | Inspect instruction references on the selected Copilot surface |
| Cursor, Windsurf, Cline, Aider or another coding client | Manual loading of `AGENTS.md` and relevant specs | No native discovery or plugin claim is made here | Open/attach files and request an instruction summary |
| ChatGPT, Claude or Gemini in a general chat UI | Attach or paste relevant Markdown | Manual context transfer | Supply changed code/diffs and validation output when filesystem tools are unavailable |

Codex discovers project `AGENTS.md` guidance. Keep critical rules in that file and verify nested-file behavior in the chosen host. [Codex project instructions](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

Claude Code expands `@path` imports from `CLAUDE.md`; this package imports the canonical rules once. [Claude memory files](https://code.claude.com/docs/en/memory).

Gemini CLI supports project context through `GEMINI.md`; this package asks it to read the canonical document before edits. [Gemini project context](https://geminicli.com/docs/cli/gemini-md/).

GitHub documents `.github/copilot-instructions.md`, with support depending on the Copilot feature being used. Verify that file in the host's response references when available. [Copilot repository instructions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions).

## 3. Portable first-session procedure

1. Open this project directory as the workspace root. Confirm that the task's path is the intended project, not a parent containing unrelated projects.
2. Read `AGENTS.md`, `README.md`, and `docs/engineering/IMPLEMENTATION_PLAN.md`.
3. Summarize the requested milestone, data stores, tenant boundary, action approval rules and available test commands.
4. Inspect actual package manifests and installed tooling before running any proposed command. At this documentation stage there is no runnable application.
5. Load only the design and architecture files needed for the current change; keep a compact list of decisions and unresolved questions.
6. Implement within the authorized scope, validate the relevant risks, update affected documentation and report concrete evidence.

Fallback prompt for a client without automatic instruction discovery:

> Read the project's AGENTS.md as the canonical project guide, then README.md and the implementation plan. Read the architecture and UX files relevant to my requested milestone. Before editing, identify the current implementation stage and actual available commands. Preserve tenant isolation, durable events, independent action approval and simulator-only execution for the MVP. State any missing tool capability and use a manual workflow where possible.

This fallback transfers instructions, not permissions or executable capabilities. A browser chat can review supplied code but cannot truthfully claim it ran repository tests without a connected execution tool.

## 4. Coding-host plugin capability matrix

| Host | Documented package direction | Project policy |
|---|---|---|
| Codex/OpenAI host | Portable root `plugin.json`; compatibility `.codex-plugin/plugin.json` also documented | Use the format supported by the exact host; review hooks and tool grants separately |
| Claude Code | `.claude-plugin/plugin.json` packages skills, agents, hooks and MCP components | Review manifest and executable components before enablement |
| Gemini CLI | Not configured by this deliverable | Consult the installed version's extension documentation before creating a package |
| Copilot or another coding host | Not configured by this deliverable | Verify native extension/MCP support; use Markdown guidance if unsupported |

OpenAI documents a portable package format and a compatibility layout. Host-specific presentation and hook settings still need a host-specific review. [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins).

Claude Code documents plugin components including skills, agents, hooks and MCP servers. Its host configuration must be checked independently. [Claude Code plugins](https://code.claude.com/docs/en/plugins).

No lifecycle hook is assumed to work across hosts. A shared MCP server can reduce adapter duplication, but each host must test transport, authentication, tool discovery, error handling, cancellation and approval behavior.

## 5. Recommended development capability catalog

These are capability recommendations, not installed products or auto-install commands.

| Capability | Useful work | Starting grant | Acceptance check |
|---|---|---|---|
| Official documentation lookup | Verify SDK schemas and integration behavior | Public documentation reads | Returns direct official source URLs and dates |
| Repository inspection | Read source, diffs and issue context | Local workspace or selected repository read | Cannot access unrelated private repositories |
| Browser inspection/testing | Responsive dashboard and accessibility checks | Local preview origin | Cannot submit production actions by default |
| Design reference | Inspect approved component designs | Selected design files read | Keeps tokens and component names aligned with project rules |
| Test execution | Run repository-owned checks | Workspace execution sandbox | Runs actual scripts and records failures accurately |
| Dependency/security review | Inspect dependencies and code | Repository read | Findings include file, trigger, impact and fix |
| Issue/ticket integration | Read scoped requirements; draft updates | Selected project read | Publishing remains an explicit task action |

Begin with documentation, local repository access and test execution. Add an external connector only when a concrete task needs it. Review publisher, version, code-execution behavior, network destinations, granted scopes, maintenance status and uninstall behavior. Prefer scoped credentials and preserve the host's permission prompts.

## 6. Reusable development roles

| Role prompt | Bounded responsibility | Review handoff |
|---|---|---|
| Architecture reviewer | Check a proposal against HLD, LLD and invariants | List conflicts with concrete file references |
| Backend implementer | Implement one module and its contract tests | Changed APIs, persistence semantics and error paths |
| Frontend implementer | Implement one complete user flow | Keyboard, narrow viewport and loading/error evidence |
| AI workflow reviewer | Check evidence, budgets and provider behavior | Evaluation cases and failure outcomes |
| Security reviewer | Exercise authorization, plugin and approval boundaries | Reproducible risks and relevant negative tests |
| Release reviewer | Verify milestone exit criteria | Passed checks, known limits and rollout conditions |

A host may support native subagents, or one agent can perform these roles sequentially. Parallel workers must own separate files or coordinate edits, share the same domain vocabulary and pass their actual findings back to the integrator. Subagent output is reviewed evidence, not an automatic approval.

## 7. Portability acceptance checklist

- All clients can receive canonical Markdown through a documented manual path.
- Claude imports have been checked for cycles and missing files; other adapters explicitly request canonical-file reading.
- A host without plugin support can still implement and review the app using its available file and command tools.
- A selected plugin's read, write and executable-hook permissions are visible before enablement.
- No host's approval mechanism is substituted for the application's independent commander approval.
- A provider or connector is marked supported only after its contract tests pass for the recorded version.
- No credentials, private personal paths, installed-plugin claims or untested model compatibility claims are embedded in reusable prompts.
