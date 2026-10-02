# Claude Code project entry point

@AGENTS.md

Use the imported canonical rules for this project. This file intentionally carries no separate architecture or security policy.

## Session checks

- Read [README](README.md) and [implementation plan](docs/engineering/IMPLEMENTATION_PLAN.md) for the current stage.
- Confirm that `AGENTS.md` was loaded before editing. If imports are unavailable in the chosen Claude surface, open that file explicitly.
- Treat the application plugin specification as a future backend design. It is not a Claude Code plugin manifest or an installation request.
- Use only tools and subagent features exposed by the current host. When a tool is unavailable, report the limitation and use an authorized manual fallback.
- Record validation evidence and unresolved risks in the final task summary.

Claude Code's documented `@path` import mechanism supports the entry above. Other Claude surfaces may require files to be attached manually. [Claude memory documentation](https://code.claude.com/docs/en/memory).
