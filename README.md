# Autoship

**Autonomous multi-agent orchestrator that turns Linear issues into merged Pull Requests — zero human intervention.**

Autoship polls your Linear project, dispatches [Claude Code](https://docs.anthropic.com/en/docs/claude-code) agents into isolated workspaces, and drives each ticket through the full lifecycle: branch → implement → PR → automated review → merge → Linear Done.

```
Linear Issue (Todo)
  │
  ▼
┌─────────────────────────────────────────────────┐
│  Autoship Orchestrator                          │
│                                                 │
│  Poll ──► Dispatch ──► Agent (Claude Code CLI)  │
│   │         │              │                    │
│   │         │         ┌────┴────┐               │
│   │         │         │ Branch  │               │
│   │         │         │ Code    │               │
│   │         │         │ Lint    │               │
│   │         │         │ Commit  │               │
│   │         │         │ Push    │               │
│   │         │         │ PR      │               │
│   │         │         └────┬────┘               │
│   │         │              │                    │
│   │     Completion ◄───────┘                    │
│   │     Checker                                 │
│   │         │                                   │
│   │    ┌────┴────┐                              │
│   │    │ Review  │ ◄── ReviewManager (2min)     │
│   │    │ Manager │                              │
│   │    └────┬────┘                              │
│   │         │                                   │
│   │    READY ──► Merge + Linear Done            │
│   │    NEEDS WORK ──► Comment + Re-dispatch     │
│   │                                             │
│   ▼                                             │
│  [Next poll cycle...]                           │
└─────────────────────────────────────────────────┘
```

---

## Why Autoship?

Most AI coding agent orchestrators focus on one piece of the puzzle. Autoship handles **the entire pipeline end-to-end**:

| Capability                    | Autoship                            | Typical Agent Frameworks |
| ----------------------------- | ----------------------------------- | ------------------------ |
| Issue tracker integration     | Linear (pluggable)                  | Manual task assignment   |
| Isolated workspaces per issue | Git clone + retry                   | Shared workspace         |
| Multi-turn agent sessions     | Up to 20 turns with --resume        | Single-shot              |
| Completion verification       | Checks branch/commit/push/PR        | Trust exit code          |
| Fixup retry                   | Targeted prompt for missing steps   | Full restart             |
| Automated PR review           | Claude reviewer agent               | Manual review            |
| Auto-merge + cleanup          | Squash merge + branch deletion      | Manual merge             |
| Tracker state sync            | Bidirectional Linear updates        | One-way                  |
| Stall detection               | Dual-layer (process + orchestrator) | Timeout only             |
| Observability                 | HTTP API + dashboard script         | Logs only                |

---

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- [GitHub CLI](https://cli.github.com/) (`gh`) authenticated
- A [Linear](https://linear.app/) project with API key

### Install

```bash
git clone https://github.com/qiuyanxin/autoship.git
cd autoship
pnpm install
```

### Configure

1. Copy the example workflow:

```bash
cp WORKFLOW.example.md WORKFLOW.md
```

2. Edit `WORKFLOW.md`:

```yaml
tracker:
  project_slug: "your-linear-project-slug"
workspace:
  repo_url: git@github.com:your-org/your-repo.git
```

3. Set environment variable:

```bash
export LINEAR_API_KEY="lin_api_xxxxx"
```

### Run

```bash
# Development (with tsx)
pnpm dev

# Production
pnpm build && pnpm start
```

Autoship will start polling Linear for active issues and dispatching agents.

### Monitor

```bash
# Dashboard
scripts/status

# HTTP API
curl http://localhost:4800/api/v1/state
```

---

## Architecture

### Core Modules

| Module                 | File                        | Purpose                                                            |
| ---------------------- | --------------------------- | ------------------------------------------------------------------ |
| **Orchestrator**       | `src/orchestrator.ts`       | Polling loop, dispatch, reconciliation, retry                      |
| **Agent Runner**       | `src/agent-runner.ts`       | Spawns Claude Code CLI, streams NDJSON output, multi-turn sessions |
| **Workspace**          | `src/workspace.ts`          | Isolated directory per issue, git clone with retry, hooks          |
| **Review Manager**     | `src/review-manager.ts`     | Auto-review open PRs, merge/reject, Linear state sync              |
| **Completion Checker** | `src/completion-checker.ts` | Post-exit verification: branch, commits, push, PR                  |
| **Prompt Builder**     | `src/prompt-builder.ts`     | Liquid template rendering with issue context                       |
| **Linear Tracker**     | `src/tracker/linear.ts`     | GraphQL client for issue CRUD + state transitions                  |
| **Config**             | `src/config.ts`             | YAML front-matter parsing, env var resolution, validation          |
| **HTTP Server**        | `src/http-server.ts`        | Observability API (`/api/v1/state`, `/api/v1/{identifier}`)        |
| **Workflow Loader**    | `src/workflow.ts`           | Parses `WORKFLOW.md`, watches for hot-reload                       |

### Agent Lifecycle

```
1. Poll Linear → find eligible issues (active state, not blocked, within concurrency limit)
2. Create workspace → git clone with 3x retry → run after_create hook
3. Build prompt → Liquid template with issue context
4. Spawn Claude Code CLI → stream NDJSON → track tokens/turns
5. Between turns → re-check tracker state → continue or stop
6. On exit → completion check → fixup retry if incomplete
7. ReviewManager scans PRs → Claude reviewer → merge or request changes
8. Merged → Linear Done → workspace cleanup → branch pruning
```

### Prompt Template (WORKFLOW.md)

The `WORKFLOW.md` file serves dual purpose:

- **YAML front-matter**: All configuration (tracker, workspace, agent, Claude settings)
- **Markdown body**: Liquid template that becomes the agent prompt

```markdown
---
tracker:
  kind: linear
  project_slug: "your-slug"
workspace:
  repo_url: git@github.com:org/repo.git
agent:
  max_concurrent_agents: 5
---

# Agent Prompt

{{ issue.identifier }}: {{ issue.title }}
{{ issue.description }}

## Phases

### Phase 0: Verify workspace

### Phase 1: Branch

...
```

Available template variables: `issue.identifier`, `issue.title`, `issue.description`, `issue.state`, `issue.labels`, `issue.url`, `issue.priority`, `attempt`.

---

## Configuration Reference

| Setting                       | Default                        | Description                            |
| ----------------------------- | ------------------------------ | -------------------------------------- |
| `tracker.kind`                | `linear`                       | Issue tracker (`linear` or `memory`)   |
| `tracker.project_slug`        | —                              | Linear project slug (required)         |
| `tracker.active_states`       | `["Todo", "In Progress"]`      | States that trigger dispatch           |
| `tracker.terminal_states`     | `["Done", "Closed", ...]`      | States that stop agents                |
| `polling.interval_ms`         | `30000`                        | Poll interval (ms)                     |
| `workspace.root`              | `/tmp/autoship_workspaces`     | Parent dir for workspaces              |
| `workspace.repo_url`          | —                              | Git repo to clone into each workspace  |
| `hooks.after_create`          | —                              | Shell command after workspace creation |
| `hooks.before_run`            | —                              | Shell command before agent launch      |
| `hooks.after_run`             | —                              | Shell command after agent exit         |
| `agent.max_concurrent_agents` | `10`                           | Max parallel agents                    |
| `agent.max_turns`             | `20`                           | Max turns per agent run                |
| `agent.max_retry_backoff_ms`  | `300000`                       | Max retry delay                        |
| `claude.command`              | `claude`                       | Claude Code CLI binary                 |
| `claude.model`                | —                              | Model override (sonnet, opus, haiku)   |
| `claude.permission_mode`      | `dangerously-skip-permissions` | CLI permission mode                    |
| `claude.turn_timeout_ms`      | `3600000`                      | Per-turn timeout (1h)                  |
| `claude.stall_timeout_ms`     | `300000`                       | Inactivity timeout (5min)              |
| `server.port`                 | —                              | HTTP API port (optional)               |

---

## Scripts

```bash
scripts/status              # Live dashboard: agents, tokens, workspaces
scripts/review-prs          # Manual batch PR review
scripts/review-prs --auto-merge  # Review + auto-merge approved PRs
```

---

## Reliability Features

### Workspace Isolation

Each issue gets its own directory with a fresh git clone. Clone failures retry 3 times with 2-second delays. Workspaces are validated (no symlink escapes, path traversal protection).

### Completion Verification

When an agent exits with code 0, Autoship doesn't just trust it. It inspects the workspace:

- Was a branch created?
- Are there commits ahead of main?
- Was it pushed to remote?
- Does a PR exist?

If any step is missing, a **fixup agent** is dispatched with a targeted prompt listing exactly what's incomplete.

### Stall Detection (Dual-Layer)

1. **Process-level**: Agent runner monitors NDJSON stream activity
2. **Orchestrator-level**: Poll loop checks `lastTimestamp` across all agents

Both layers can kill stalled processes independently.

### Startup Cleanup

On boot, Autoship removes:

- Workspaces for issues in terminal states
- Broken workspaces (no `.git` directory — failed clones)
- Stale workspaces (>48 hours old)

### Exponential Backoff Retry

Failed agents are retried with exponential backoff: `10s × 2^(attempt-1)`, capped at 5 minutes.

---

## Roadmap

### Planned Integrations

**PRD-to-Issues Pipeline** (coming soon)

> Automated Product Requirements Document parsing that generates structured Linear issues from natural language specs. Will integrate as an upstream module that feeds Autoship's dispatch loop.

**Intelligent Task Decomposition** (coming soon)

> AI-powered decomposition of large features into appropriately-scoped subtasks. Handles dependency analysis, effort estimation, and parallel work planning — outputting Linear issues optimized for agent execution.

### Tracker Support

- [x] Linear
- [ ] GitHub Issues
- [ ] Jira
- [ ] Custom webhook adapter

### Agent Runtime

- [x] Claude Code CLI
- [ ] Claude Agent SDK (native API)
- [ ] OpenAI Codex CLI
- [ ] Multi-model routing (different models for different task types)

### Review & Quality

- [x] Automated PR review via Claude
- [ ] Multi-reviewer consensus (require 2/3 approval)
- [ ] Test execution gate (CI must pass before merge)
- [ ] Security scanning integration

### Observability

- [x] HTTP API + dashboard script
- [ ] Prometheus metrics export
- [ ] Webhook notifications (Slack, Discord)
- [ ] Cost tracking per issue/sprint

---

## Comparison with Similar Projects

Autoship occupies a specific niche in the agent orchestration ecosystem:

| Project                                                                           | Focus                         | Autoship Difference                            |
| --------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------- |
| [ComposioHQ/agent-orchestrator](https://github.com/ComposioHQ/agent-orchestrator) | Multi-runtime parallel coding | Autoship adds review + merge + tracker sync    |
| [Overstory](https://github.com/jayminwest/overstory)                              | tmux-based multi-agent        | Autoship uses isolated workspaces, not tmux    |
| [CrewAI](https://github.com/crewAIInc/crewAI)                                     | General multi-agent framework | Autoship is purpose-built for coding workflows |
| [Ruflo](https://github.com/ruvnet/ruflo)                                          | Claude swarm orchestration    | Autoship is leaner, focused on Linear→PR→Merge |
| [MetaGPT](https://github.com/geekan/MetaGPT)                                      | Simulated software team       | Autoship uses real git/GitHub, not simulation  |

**Autoship's key differentiator**: it's not a framework for building agents — it's a **turnkey system** that connects your issue tracker to merged code with zero configuration beyond a single `WORKFLOW.md`.

---

## Contributing

Contributions are welcome! This project is in active development and there are many areas to improve.

### Good First Issues

- Add GitHub Issues as a tracker backend
- Add Slack/Discord notifications on merge
- Create a web-based dashboard (replace shell script)
- Add CI status check before auto-merge
- Support for monorepo multi-workspace patterns

### Development

```bash
pnpm install
pnpm dev           # Start with tsx (hot reload)
pnpm build         # TypeScript compilation
```

The codebase is ~1500 lines of TypeScript with zero heavy dependencies (just `js-yaml`, `liquidjs`, `chokidar`).

### Design Principles

1. **Single file configuration** — everything in `WORKFLOW.md`
2. **Prompt-as-code** — the agent prompt is version-controlled Liquid template
3. **Minimal dependencies** — no LangChain, no framework overhead
4. **Git-native** — real branches, real PRs, real merges
5. **Fail-safe** — retry, fixup, stall detection, cleanup at every layer

---

## License

MIT

---

## Acknowledgments

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) by Anthropic — the AI coding agent runtime
- [Linear](https://linear.app/) — issue tracking API
- Inspired by the shift from "AI coding assistants" to "AI coding agents that ship code autonomously"

### References & Inspirations

| Project                                                                   | Description                                                                                                                                                                                        | What We Learned                                                                                                                      |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| [OpenAI Symphony](https://github.com/openai/symphony)                     | Elixir-based autonomous coding orchestrator with Linear integration. Specification-driven architecture (SPEC.md) allowing pluggable tracker/workspace/prompt implementations.                      | Specification-first design pattern, tracker abstraction boundaries, workspace isolation model, prompt rendering via Liquid templates |
| [La-fe/multi-agent-factory](https://github.com/La-fe/multi-agent-factory) | Node.js/TypeScript multi-agent orchestrator reverse-engineered from OpenClaw patterns (30 AI agents, 627 commits/day). 6-stage pipeline with wave-based parallel execution and worktree isolation. | Wave-based parallel dispatch, git worktree isolation strategy, 6-phase agent lifecycle, Claude Code CLI integration patterns         |

Autoship builds on ideas from both projects while adding the full review-merge-cleanup lifecycle and dual-layer stall detection that neither provides out of the box.
