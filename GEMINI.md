# Gemini project entry point

Read [AGENTS.md](AGENTS.md) in full before making changes. It is the canonical project policy. Then read [README](README.md) and the [implementation plan](docs/engineering/IMPLEMENTATION_PLAN.md).

## Session checks

- State the requested milestone and inspect the real repository before selecting commands.
- Keep application data scoped to `workspaceId`; follow the canonical approval, outbox and replay rules.
- MVP actions use the simulator. A generated plan or model response never authorizes a production write.
- Consult the relevant architecture, design and AI documents instead of inventing incompatible local conventions.
- Verify plugin and extension features against the actual host. No extension has been installed by these Markdown files.
- Report what was changed, what was actually verified and what remains incomplete.

Gemini CLI documents `GEMINI.md` as project context. In a general Gemini chat, attach this file and the canonical guide manually. [Gemini context documentation](https://geminicli.com/docs/cli/gemini-md/).
