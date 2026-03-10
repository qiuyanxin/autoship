// Config layer (SPEC Section 6.4)

import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type {
  WorkflowDefinition,
  ServiceConfig,
  TrackerConfig,
  AgentConfig,
  HooksConfig,
  ClaudeConfig,
  ValidationError,
} from "./types.js";

const DEFAULTS = {
  tracker: {
    kind: "linear",
    endpoint: "https://api.linear.app/graphql",
    apiKey: null,
    projectSlug: null,
    activeStates: ["Todo", "In Progress"],
    terminalStates: ["Closed", "Cancelled", "Canceled", "Duplicate", "Done"],
  },
  polling: { intervalMs: 30_000 },
  workspace: { root: join(tmpdir(), "autoship_workspaces") },
  hooks: {
    afterCreate: null,
    beforeRun: null,
    afterRun: null,
    beforeRemove: null,
    timeoutMs: 60_000,
  },
  agent: {
    maxConcurrentAgents: 10,
    maxTurns: 20,
    maxRetryBackoffMs: 300_000,
    maxConcurrentAgentsByState: {},
  },
  claude: {
    command: "claude",
    model: null,
    permissionMode: "dangerously-skip-permissions",
    turnTimeoutMs: 3_600_000,
    stallTimeoutMs: 300_000,
    readTimeoutMs: 5_000,
    allowedTools: null,
  },
  server: { port: null },
} as const;

function getSection(
  config: Record<string, unknown>,
  key: string
): Record<string, unknown> {
  const section = config[key];
  return section && typeof section === "object" && !Array.isArray(section)
    ? (section as Record<string, unknown>)
    : {};
}

function resolveEnvValue(
  value: unknown,
  envFallbackKey?: string
): string | null {
  if (value === null || value === undefined) {
    return envFallbackKey ? (process.env[envFallbackKey] ?? null) : null;
  }
  const str = String(value).trim();
  if (str.startsWith("$")) {
    const envName = str.slice(1);
    if (/^[A-Za-z_]\w*$/.test(envName)) {
      return process.env[envName] ?? null;
    }
  }
  return str || null;
}

function resolvePath(value: unknown, fallback: string): string {
  if (value === null || value === undefined) return fallback;
  let str = String(value).trim();
  if (!str) return fallback;

  // env var reference
  if (str.startsWith("$")) {
    const envName = str.slice(1);
    if (/^[A-Za-z_]\w*$/.test(envName)) {
      str = process.env[envName] ?? "";
      if (!str) return fallback;
    }
  }

  // expand ~
  if (str.startsWith("~/") || str === "~") {
    str = join(homedir(), str.slice(1));
  }
  return str;
}

function intVal(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isInteger(v)) return v;
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    if (!isNaN(n)) return n;
  }
  return fallback;
}

function strList(v: unknown, fallback: string[]): string[] {
  if (Array.isArray(v)) {
    return v
      .map(String)
      .filter((s) => s.trim())
      .map((s) => s.trim());
  }
  if (typeof v === "string") {
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return fallback;
}

function stateLimits(v: unknown): Record<string, number> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const result: Record<string, number> = {};
  for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
    const n = intVal(val, -1);
    if (n > 0) result[key.trim().toLowerCase()] = n;
  }
  return result;
}

export function buildConfig(workflow: WorkflowDefinition): ServiceConfig {
  const raw = workflow.config;
  const tracker = getSection(raw, "tracker");
  const polling = getSection(raw, "polling");
  const workspace = getSection(raw, "workspace");
  const hooks = getSection(raw, "hooks");
  const agent = getSection(raw, "agent");
  const claude = getSection(raw, "claude");
  const server = getSection(raw, "server");

  return {
    tracker: {
      kind: String(tracker.kind ?? DEFAULTS.tracker.kind)
        .trim()
        .toLowerCase(),
      endpoint: String(tracker.endpoint ?? DEFAULTS.tracker.endpoint).trim(),
      apiKey: resolveEnvValue(tracker.api_key, "LINEAR_API_KEY"),
      projectSlug:
        tracker.project_slug != null
          ? String(tracker.project_slug).trim()
          : null,
      activeStates: strList(tracker.active_states, [
        ...DEFAULTS.tracker.activeStates,
      ]),
      terminalStates: strList(tracker.terminal_states, [
        ...DEFAULTS.tracker.terminalStates,
      ]),
    } satisfies TrackerConfig,
    polling: {
      intervalMs: intVal(polling.interval_ms, DEFAULTS.polling.intervalMs),
    },
    workspace: {
      root: resolvePath(workspace.root, DEFAULTS.workspace.root),
      repoUrl:
        workspace.repo_url != null ? String(workspace.repo_url).trim() : null,
    },
    hooks: {
      afterCreate: (hooks.after_create as string) ?? null,
      beforeRun: (hooks.before_run as string) ?? null,
      afterRun: (hooks.after_run as string) ?? null,
      beforeRemove: (hooks.before_remove as string) ?? null,
      timeoutMs: intVal(hooks.timeout_ms, DEFAULTS.hooks.timeoutMs),
    } satisfies HooksConfig,
    agent: {
      maxConcurrentAgents: intVal(
        agent.max_concurrent_agents,
        DEFAULTS.agent.maxConcurrentAgents
      ),
      maxTurns: intVal(agent.max_turns, DEFAULTS.agent.maxTurns),
      maxRetryBackoffMs: intVal(
        agent.max_retry_backoff_ms,
        DEFAULTS.agent.maxRetryBackoffMs
      ),
      maxConcurrentAgentsByState: stateLimits(
        agent.max_concurrent_agents_by_state
      ),
    } satisfies AgentConfig,
    claude: {
      command: String(claude.command ?? DEFAULTS.claude.command).trim(),
      model: claude.model != null ? String(claude.model).trim() : null,
      permissionMode: String(
        claude.permission_mode ?? DEFAULTS.claude.permissionMode
      ).trim(),
      turnTimeoutMs: intVal(
        claude.turn_timeout_ms,
        DEFAULTS.claude.turnTimeoutMs
      ),
      stallTimeoutMs: intVal(
        claude.stall_timeout_ms,
        DEFAULTS.claude.stallTimeoutMs
      ),
      readTimeoutMs: intVal(
        claude.read_timeout_ms,
        DEFAULTS.claude.readTimeoutMs
      ),
      allowedTools:
        claude.allowed_tools != null
          ? String(claude.allowed_tools).trim()
          : null,
    } satisfies ClaudeConfig,
    server: {
      port: server.port != null ? intVal(server.port, 0) : null,
    },
  };
}

export function validateConfig(config: ServiceConfig): ValidationError | null {
  if (!config.tracker.kind) return { code: "missing_tracker_kind" };
  if (config.tracker.kind !== "linear" && config.tracker.kind !== "memory") {
    return { code: "unsupported_tracker_kind", kind: config.tracker.kind };
  }
  if (config.tracker.kind === "linear") {
    if (!config.tracker.apiKey) return { code: "missing_tracker_api_key" };
    if (!config.tracker.projectSlug)
      return { code: "missing_tracker_project_slug" };
  }
  if (!config.claude.command.trim()) return { code: "missing_claude_command" };
  return null;
}
