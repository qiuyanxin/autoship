# Autoship — Development Guide

## What is this project?

Autoship is an autonomous multi-agent orchestrator that turns Linear issues into merged Pull Requests. It dispatches Claude Code agents into isolated workspaces and manages the full lifecycle: branch → implement → PR → review → merge.

## Architecture

```
src/
├── orchestrator.ts       # Core scheduling loop, dispatch, reconciliation
├── agent-runner.ts       # Claude Code CLI subprocess, multi-turn sessions
├── review-manager.ts     # Automated PR review + merge lifecycle
├── completion-checker.ts # Post-exit workspace verification
├── workspace.ts          # Isolated directory management, git clone
├── prompt-builder.ts     # Liquid template rendering
├── config.ts             # YAML config parsing from WORKFLOW.md
├── tracker/linear.ts     # Linear GraphQL client
├── http-server.ts        # Observability API
├── workflow.ts           # Workflow file loader + watcher
├── cli.ts                # Entry point
└── logger.ts             # Structured logging
```

## Development

```bash
pnpm install
pnpm dev          # Start with tsx (hot reload via chokidar)
pnpm build        # TypeScript compilation to dist/
```

## Conventions

- ESM modules (type: "module" in package.json)
- Strict TypeScript (ES2022 target, Node16 module resolution)
- All types in `src/types.ts`
- Structured logging via `src/logger.ts` (key=value format to stderr)
- Config uses snake_case in YAML, camelCase in TypeScript
- Environment variables resolved via `$VAR_NAME` syntax in YAML

## Key Design Decisions

1. **Claude Code CLI over SDK**: Agents are spawned as `claude` subprocesses with `--output-format stream-json`, not via the Agent SDK API. This gives full CLI feature access (tools, permissions, MCP).
2. **WORKFLOW.md = config + prompt**: Single file with YAML front-matter (config) and Liquid template (agent prompt). Hot-reloaded via chokidar.
3. **Workspace isolation**: Each issue gets its own directory with a fresh git clone. No shared state between agents.
4. **Completion verification**: Don't trust exit code 0 — inspect workspace for branch, commits, push, PR after agent exits.
5. **ReviewManager is independent**: Runs on its own 2-minute timer, decoupled from the dispatch loop.

## Testing

No automated tests yet. Manual testing via:

```bash
scripts/status          # Check running agents and workspace health
scripts/review-prs      # Manually trigger PR reviews
```

## Adding a New Tracker

1. Create `src/tracker/your-tracker.ts` implementing `fetchCandidateIssues()`, `fetchIssueStatesByIds()`, `updateIssueState()`
2. Add tracker kind to `config.ts` validation
3. Update `orchestrator.ts` imports to select tracker by `config.tracker.kind`
