// Symphony Domain Model Types (SPEC.md Section 4)

/** Normalized issue record from tracker (Section 4.1.1) */
export interface Issue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number | null;
  state: string;
  branchName: string | null;
  url: string | null;
  labels: string[];
  blockedBy: BlockerRef[];
  createdAt: Date | null;
  updatedAt: Date | null;
}

/** Blocker reference within an issue */
export interface BlockerRef {
  id: string | null;
  identifier: string | null;
  state: string | null;
}

/** Parsed WORKFLOW.md payload (Section 4.1.2) */
export interface WorkflowDefinition {
  config: Record<string, unknown>;
  promptTemplate: string;
}

/** Claude Code CLI config (replaces codex config from SPEC) */
export interface ClaudeConfig {
  command: string;
  model: string | null;
  permissionMode: string;
  turnTimeoutMs: number;
  stallTimeoutMs: number;
  readTimeoutMs: number;
  allowedTools: string | null;
}

/** Tracker config */
export interface TrackerConfig {
  kind: string;
  endpoint: string;
  apiKey: string | null;
  projectSlug: string | null;
  activeStates: string[];
  terminalStates: string[];
}

/** Agent config */
export interface AgentConfig {
  maxConcurrentAgents: number;
  maxTurns: number;
  maxRetryBackoffMs: number;
  maxConcurrentAgentsByState: Record<string, number>;
}

/** Hooks config */
export interface HooksConfig {
  afterCreate: string | null;
  beforeRun: string | null;
  afterRun: string | null;
  beforeRemove: string | null;
  timeoutMs: number;
}

/** Full typed service config (Section 4.1.3) */
export interface ServiceConfig {
  tracker: TrackerConfig;
  polling: { intervalMs: number };
  workspace: { root: string; repoUrl: string | null };
  hooks: HooksConfig;
  agent: AgentConfig;
  claude: ClaudeConfig;
  server: { port: number | null };
}

/** Workspace creation result (Section 4.1.4) */
export interface WorkspaceResult {
  path: string;
  workspaceKey: string;
  createdNow: boolean;
}

/** One execution attempt for one issue (Section 4.1.5) */
export interface RunAttempt {
  issueId: string;
  issueIdentifier: string;
  attempt: number | null;
  workspacePath: string;
  startedAt: Date;
  status: RunStatus;
  error?: string;
}

export type RunStatus =
  | "preparing_workspace"
  | "building_prompt"
  | "launching_agent"
  | "streaming_turn"
  | "finishing"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "stalled"
  | "canceled_by_reconciliation";

/** Live session metadata (Section 4.1.6) */
export interface LiveSession {
  sessionId: string;
  claudePid: number | null;
  lastEvent: string | null;
  lastTimestamp: Date | null;
  lastMessage: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  turnCount: number;
}

/** Completion report for agent work verification */
export interface CompletionReport {
  branchCreated: boolean;
  commitsMade: number;
  pushedToRemote: boolean;
  prCreated: boolean;
  prNumber: number | null;
}

/** Running entry in orchestrator state */
export interface RunningEntry {
  issueId: string;
  identifier: string;
  issue: Issue;
  pid: number | null;
  abortController: AbortController | null;
  startedAt: Date;
  attempt: number | null;
  session: LiveSession;
  workspacePath: string;
  completion: CompletionReport | null;
}

/** Retry entry (Section 4.1.7) */
export interface RetryEntry {
  issueId: string;
  identifier: string;
  attempt: number;
  dueAtMs: number;
  timerHandle: ReturnType<typeof setTimeout>;
  error: string | null;
}

/** Token totals for aggregation */
export interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  secondsRunning: number;
}

/** Rate limit snapshot */
export interface RateLimitSnapshot {
  [key: string]: unknown;
}

/** Claude Code stream event parsed from NDJSON */
export interface ClaudeStreamEvent {
  type: string;
  subtype?: string;
  text?: string;
  usage?: { inputTokens: number; outputTokens: number };
  sessionId?: string;
  raw: unknown;
}

/** Agent update event sent from runner to orchestrator */
export interface AgentUpdateEvent {
  event: string;
  timestamp: Date;
  claudePid?: number;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  message?: string;
  sessionId?: string;
}

/** Validation error from config */
export type ValidationError =
  | { code: "missing_workflow_file"; path: string }
  | { code: "workflow_parse_error"; detail: string }
  | { code: "workflow_front_matter_not_a_map" }
  | { code: "missing_tracker_kind" }
  | { code: "unsupported_tracker_kind"; kind: string }
  | { code: "missing_tracker_api_key" }
  | { code: "missing_tracker_project_slug" }
  | { code: "missing_claude_command" };
