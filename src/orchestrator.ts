// Orchestrator — core scheduling loop (SPEC Section 8)

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type {
  ServiceConfig,
  Issue,
  WorkflowDefinition,
  RunningEntry,
  RetryEntry,
  TokenTotals,
  RateLimitSnapshot,
  AgentUpdateEvent,
  LiveSession,
} from "./types.js";
import {
  fetchCandidateIssues,
  fetchIssueStatesByIds,
  fetchIssuesByStates,
} from "./tracker/linear.js";
import { runAgent, type RunAgentOptions } from "./agent-runner.js";
import {
  removeIssueWorkspaces,
  listWorkspaces,
  removeWorkspace,
} from "./workspace.js";
import {
  checkCompletion,
  buildFixupPrompt,
  isComplete,
} from "./completion-checker.js";
import { ReviewManager } from "./review-manager.js";
import { logger } from "./logger.js";

const CONTINUATION_RETRY_DELAY_MS = 1_000;
const FAILURE_RETRY_BASE_MS = 10_000;

export interface OrchestratorState {
  pollIntervalMs: number;
  maxConcurrentAgents: number;
  running: Map<string, RunningEntry>;
  claimed: Set<string>;
  retryAttempts: Map<string, RetryEntry>;
  completed: Set<string>; // bookkeeping only, NOT dispatch gating (SPEC 4.1.8)
  fixupPrompts: Map<string, string>; // issue_id → fixup prompt for incomplete agents
  claudeTotals: TokenTotals;
  claudeRateLimits: RateLimitSnapshot | null;
}

function createInitialState(config: ServiceConfig): OrchestratorState {
  return {
    pollIntervalMs: config.polling.intervalMs,
    maxConcurrentAgents: config.agent.maxConcurrentAgents,
    running: new Map(),
    claimed: new Set(),
    retryAttempts: new Map(),
    completed: new Set(),
    fixupPrompts: new Map(),
    claudeTotals: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      secondsRunning: 0,
    },
    claudeRateLimits: null,
  };
}

function normalizeState(state: string): string {
  return state.trim().toLowerCase();
}

function isActiveState(state: string | null, config: ServiceConfig): boolean {
  if (!state) return false;
  const normalized = normalizeState(state);
  return config.tracker.activeStates.some(
    (s) => normalizeState(s) === normalized
  );
}

function isTerminalState(state: string | null, config: ServiceConfig): boolean {
  if (!state) return false;
  const normalized = normalizeState(state);
  return config.tracker.terminalStates.some(
    (s) => normalizeState(s) === normalized
  );
}

function sortIssuesForDispatch(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => {
    // priority ascending (lower = higher priority), nulls last
    const pa = a.priority ?? Infinity;
    const pb = b.priority ?? Infinity;
    if (pa !== pb) return pa - pb;

    // created_at ascending (oldest first)
    const ca = a.createdAt?.getTime() ?? 0;
    const cb = b.createdAt?.getTime() ?? 0;
    if (ca !== cb) return ca - cb;

    // identifier ascending
    return a.identifier.localeCompare(b.identifier);
  });
}

function canDispatch(
  issue: Issue,
  state: OrchestratorState,
  config: ServiceConfig
): boolean {
  // Must have required fields
  if (!issue.id || !issue.identifier || !issue.title || !issue.state) {
    return false;
  }

  // Must be in active state
  if (!isActiveState(issue.state, config)) return false;

  // Must not be terminal
  if (isTerminalState(issue.state, config)) return false;

  // Must not already be running or claimed
  if (state.running.has(issue.id) || state.claimed.has(issue.id)) {
    return false;
  }

  // NOTE: completed set is bookkeeping only, NOT checked here (SPEC 4.1.8)

  // Global concurrency check
  if (state.running.size >= state.maxConcurrentAgents) return false;

  // Per-state concurrency check (SPEC 8.3)
  const stateKey = normalizeState(issue.state);
  const stateLimit =
    config.agent.maxConcurrentAgentsByState[stateKey] ??
    state.maxConcurrentAgents;
  const stateCount = [...state.running.values()].filter(
    (r) => normalizeState(r.issue.state) === stateKey
  ).length;
  if (stateCount >= stateLimit) return false;

  // Todo blocker rule: don't dispatch if any blocker is non-terminal (SPEC 8.2)
  if (normalizeState(issue.state) === "todo" && issue.blockedBy.length > 0) {
    const allBlockersTerminal = issue.blockedBy.every((b) => {
      if (!b.state) return true;
      return isTerminalState(b.state, config);
    });
    if (!allBlockersTerminal) return false;
  }

  return true;
}

function createRunningEntry(
  issue: Issue,
  abortController: AbortController
): RunningEntry {
  return {
    issueId: issue.id,
    identifier: issue.identifier,
    issue,
    pid: null,
    abortController,
    startedAt: new Date(),
    attempt: null,
    session: {
      sessionId: "",
      claudePid: null,
      lastEvent: null,
      lastTimestamp: null,
      lastMessage: "",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      turnCount: 0,
    },
    workspacePath: "",
    completion: null,
  };
}

function scheduleRetry(
  state: OrchestratorState,
  issueId: string,
  identifier: string,
  attempt: number,
  delayMs: number,
  error: string | null,
  dispatchFn: () => void
): void {
  // Cancel existing retry if any (SPEC 8.4)
  const existing = state.retryAttempts.get(issueId);
  if (existing) {
    clearTimeout(existing.timerHandle);
  }

  const timerHandle = setTimeout(dispatchFn, delayMs);

  state.retryAttempts.set(issueId, {
    issueId,
    identifier,
    attempt,
    dueAtMs: Date.now() + delayMs,
    timerHandle,
    error,
  });
}

function failureBackoffMs(attempt: number, maxMs: number): number {
  return Math.min(FAILURE_RETRY_BASE_MS * Math.pow(2, attempt - 1), maxMs);
}

export class Orchestrator {
  private state: OrchestratorState;
  private config: ServiceConfig;
  private workflow: WorkflowDefinition;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollInProgress = false;
  private reviewManager: ReviewManager | null = null;

  constructor(config: ServiceConfig, workflow: WorkflowDefinition) {
    this.config = config;
    this.workflow = workflow;
    this.state = createInitialState(config);
  }

  getState(): Readonly<OrchestratorState> {
    return this.state;
  }

  updateConfig(config: ServiceConfig, workflow: WorkflowDefinition): void {
    this.config = config;
    this.workflow = workflow;
    this.state.pollIntervalMs = config.polling.intervalMs;
    this.state.maxConcurrentAgents = config.agent.maxConcurrentAgents;
    logger.info("Config reloaded");
  }

  async start(): Promise<void> {
    logger.info("Autoship orchestrator starting", {
      poll_interval_ms: this.state.pollIntervalMs,
      max_concurrent: this.state.maxConcurrentAgents,
    });

    // Startup cleanup (SPEC 8.6)
    await this.startupCleanup();

    // Start ReviewManager for automated PR review + merge
    try {
      const repoRoot = process.cwd();
      this.reviewManager = new ReviewManager(this.config, repoRoot);
      this.reviewManager.start();
    } catch (err) {
      logger.warn("Failed to start ReviewManager (non-fatal)", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Start poll loop
    this.pollTimer = setInterval(
      () => this.pollTick(),
      this.state.pollIntervalMs
    );

    // Run first poll immediately
    await this.pollTick();
  }

  async stop(): Promise<void> {
    logger.info("Autoship orchestrator stopping");

    // Stop ReviewManager
    this.reviewManager?.stop();
    this.reviewManager = null;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    // Cancel all retries
    for (const entry of this.state.retryAttempts.values()) {
      clearTimeout(entry.timerHandle);
    }
    this.state.retryAttempts.clear();

    // Abort all running agents
    for (const entry of this.state.running.values()) {
      entry.abortController?.abort();
    }

    // Wait a bit for graceful shutdown
    await new Promise((resolve) => setTimeout(resolve, 2000));

    this.state.running.clear();
    this.state.claimed.clear();

    logger.info("Autoship orchestrator stopped");
  }

  async triggerPoll(): Promise<void> {
    await this.pollTick();
  }

  private async startupCleanup(): Promise<void> {
    let terminalRemoved = 0;
    let brokenRemoved = 0;
    let staleRemoved = 0;

    try {
      // 1. Remove workspaces for terminal-state issues
      const terminalIssues = await fetchIssuesByStates(
        this.config,
        this.config.tracker.terminalStates
      );

      for (const issue of terminalIssues) {
        removeIssueWorkspaces(this.config, issue.identifier);
        terminalRemoved++;
      }

      // 2. Remove broken workspaces (no .git directory = failed clone)
      const workspaces = listWorkspaces(this.config);
      const now = Date.now();
      const STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours

      for (const ws of workspaces) {
        const gitDir = join(ws, ".git");
        if (!existsSync(gitDir)) {
          logger.info("Removing broken workspace (no .git)", { workspace: ws });
          removeWorkspace(this.config, ws);
          brokenRemoved++;
          continue;
        }

        // 3. Remove stale workspaces (>48 hours old)
        try {
          const stat = statSync(ws);
          const ageMs = now - stat.mtimeMs;
          if (ageMs > STALE_THRESHOLD_MS) {
            logger.info("Removing stale workspace (>48h)", {
              workspace: ws,
              age_hours: Math.round(ageMs / 3_600_000),
            });
            removeWorkspace(this.config, ws);
            staleRemoved++;
          }
        } catch {
          // stat failed, skip
        }
      }

      logger.info(`Startup cleanup completed`, {
        terminal_removed: terminalRemoved,
        broken_removed: brokenRemoved,
        stale_removed: staleRemoved,
      });
    } catch (err) {
      logger.warn(`Startup cleanup failed (non-fatal)`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async pollTick(): Promise<void> {
    if (this.pollInProgress) return;
    this.pollInProgress = true;

    try {
      // Step 1: Reconcile running issues (SPEC 8.5)
      await this.reconcileRunningIssues();

      // Step 2: Fetch candidates
      let candidates: Issue[];
      try {
        candidates = await fetchCandidateIssues(this.config);
      } catch (err) {
        // Candidate fetch failure: log and skip dispatch (SPEC 11.4)
        logger.error(`Candidate fetch failed, skipping dispatch`, {
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }

      // Step 3: Sort for dispatch (SPEC 8.2)
      const sorted = sortIssuesForDispatch(candidates);

      // Step 4: Dispatch eligible
      for (const issue of sorted) {
        if (!canDispatch(issue, this.state, this.config)) continue;

        this.dispatchIssue(issue);
      }

      logger.info(`Poll tick completed`, {
        candidates: candidates.length,
        running: this.state.running.size,
        retrying: this.state.retryAttempts.size,
      });
    } catch (err) {
      logger.error(`Poll tick failed`, {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.pollInProgress = false;
    }
  }

  private async reconcileRunningIssues(): Promise<void> {
    if (this.state.running.size === 0) return;

    const runningIds = [...this.state.running.keys()];

    // Part A: Stall detection (SPEC 8.5)
    // Use last_codex_timestamp if any event has been seen, else started_at
    const now = Date.now();
    if (this.config.claude.stallTimeoutMs > 0) {
      for (const [id, entry] of this.state.running) {
        const baseline = entry.session.lastTimestamp ?? entry.startedAt;
        const lastActivity = baseline.getTime();
        if (now - lastActivity > this.config.claude.stallTimeoutMs) {
          logger.warn(`Stall detected, killing agent`, {
            issue_identifier: entry.identifier,
            elapsed_ms: now - lastActivity,
          });
          entry.abortController?.abort();
          this.state.running.delete(id);
          this.state.claimed.delete(id);

          // Schedule retry
          const attempt = (entry.attempt ?? 0) + 1;
          const delay = failureBackoffMs(
            attempt,
            this.config.agent.maxRetryBackoffMs
          );
          scheduleRetry(
            this.state,
            id,
            entry.identifier,
            attempt,
            delay,
            "stall_timeout",
            () => this.retryIssue(id, entry.identifier, attempt)
          );
        }
      }
    }

    // Part B: Tracker state refresh (SPEC 8.5)
    try {
      const issues = await fetchIssueStatesByIds(this.config, runningIds);
      const issueMap = new Map(issues.map((i) => [i.id, i]));

      for (const [id, entry] of this.state.running) {
        const refreshed = issueMap.get(id);
        if (!refreshed) continue;

        if (isTerminalState(refreshed.state, this.config)) {
          // Terminal: stop worker + clean workspace (SPEC 8.5)
          logger.info(`Issue moved to terminal state, stopping agent`, {
            issue_identifier: entry.identifier,
            state: refreshed.state,
          });
          entry.abortController?.abort();
          this.state.running.delete(id);
          this.state.claimed.delete(id);
          this.state.completed.add(id);
          removeIssueWorkspaces(this.config, entry.identifier);
        } else if (isActiveState(refreshed.state, this.config)) {
          // Active: update snapshot
          entry.issue = refreshed;
        } else {
          // Neither active nor terminal: stop without workspace cleanup (SPEC 8.5)
          logger.info(`Issue no longer in active state, stopping`, {
            issue_identifier: entry.identifier,
            state: refreshed.state,
          });
          entry.abortController?.abort();
          this.state.running.delete(id);
          this.state.claimed.delete(id);
        }
      }
    } catch (err) {
      // State refresh failure: keep workers running (SPEC 8.5, 11.4)
      logger.warn(`Reconciliation tracker refresh failed`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // SPEC 11.5: Autoship is a scheduler/runner and tracker READER.
  // No tracker writes here — state transitions are handled by the coding agent.
  private dispatchIssue(issue: Issue): void {
    const abortController = new AbortController();
    const entry = createRunningEntry(issue, abortController);

    this.state.running.set(issue.id, entry);
    this.state.claimed.add(issue.id);

    logger.info(`Dispatching agent`, {
      issue_id: issue.id,
      issue_identifier: issue.identifier,
    });

    // Run agent asynchronously
    this.runAgentAsync(issue, entry, abortController);
  }

  private async runAgentAsync(
    issue: Issue,
    entry: RunningEntry,
    abortController: AbortController,
    agentOptions?: RunAgentOptions
  ): Promise<void> {
    try {
      // SPEC 7.1: between turns, worker checks tracker state
      const checkIssueActive = async (): Promise<boolean> => {
        try {
          const issues = await fetchIssueStatesByIds(this.config, [issue.id]);
          if (!issues.length) return false;
          return isActiveState(issues[0].state, this.config);
        } catch {
          // On error, assume still active (avoid premature stop)
          return true;
        }
      };

      const result = await runAgent(
        this.config,
        this.workflow,
        issue,
        checkIssueActive,
        (event: AgentUpdateEvent) => {
          this.handleAgentUpdate(issue.id, event, entry);
        },
        abortController.signal,
        agentOptions
      );

      // Capture workspace path from result
      entry.workspacePath = result.workspacePath;

      // Agent completed — update runtime totals
      const runDuration = (Date.now() - entry.startedAt.getTime()) / 1000;
      this.state.claudeTotals.secondsRunning += runDuration;

      this.state.running.delete(issue.id);

      if (result.exitCode === 0 && !result.error) {
        // Check completion state of the workspace
        const report = entry.workspacePath
          ? checkCompletion(entry.workspacePath)
          : null;
        entry.completion = report;

        if (report && !isComplete(report)) {
          // Agent exited clean but didn't finish critical steps — fixup retry
          logger.warn(`Agent exited 0 but incomplete, scheduling fixup`, {
            issue_identifier: issue.identifier,
            branch: report.branchCreated,
            commits: report.commitsMade,
            pushed: report.pushedToRemote,
            pr: report.prCreated,
          });

          const attempt = (entry.attempt ?? 0) + 1;
          this.state.fixupPrompts.set(issue.id, buildFixupPrompt(report));
          scheduleRetry(
            this.state,
            issue.id,
            issue.identifier,
            attempt,
            CONTINUATION_RETRY_DELAY_MS,
            "incomplete_workflow",
            () => this.retryIssue(issue.id, issue.identifier, attempt)
          );
        } else {
          // SPEC 7.3: Worker Exit (normal)
          logger.info(`Agent run completed normally`, {
            issue_identifier: issue.identifier,
            total_tokens: result.session.totalTokens,
            turns: result.session.turnCount,
          });

          this.state.completed.add(issue.id); // bookkeeping only

          const attempt = (entry.attempt ?? 0) + 1;
          scheduleRetry(
            this.state,
            issue.id,
            issue.identifier,
            attempt,
            CONTINUATION_RETRY_DELAY_MS,
            null,
            () => this.retryIssue(issue.id, issue.identifier, attempt)
          );
        }
      } else {
        // SPEC 7.3: Worker Exit (abnormal)
        // Schedule exponential-backoff retry
        this.state.claimed.delete(issue.id);
        const attempt = (entry.attempt ?? 0) + 1;
        const delay = failureBackoffMs(
          attempt,
          this.config.agent.maxRetryBackoffMs
        );

        logger.warn(`Agent run failed`, {
          issue_identifier: issue.identifier,
          error: result.error,
          exit_code: result.exitCode,
          retry_delay_ms: delay,
        });

        scheduleRetry(
          this.state,
          issue.id,
          issue.identifier,
          attempt,
          delay,
          result.error ?? null,
          () => this.retryIssue(issue.id, issue.identifier, attempt)
        );
      }
    } catch (err) {
      this.state.running.delete(issue.id);
      this.state.claimed.delete(issue.id);

      const attempt = (entry.attempt ?? 0) + 1;
      const delay = failureBackoffMs(
        attempt,
        this.config.agent.maxRetryBackoffMs
      );

      logger.error(`Agent run threw`, {
        issue_identifier: issue.identifier,
        error: err instanceof Error ? err.message : String(err),
        retry_delay_ms: delay,
      });

      scheduleRetry(
        this.state,
        issue.id,
        issue.identifier,
        attempt,
        delay,
        err instanceof Error ? err.message : String(err),
        () => this.retryIssue(issue.id, issue.identifier, attempt)
      );
    }
  }

  /**
   * SPEC 8.4: Retry handling behavior
   * 1. Fetch active candidate issues
   * 2. Find the specific issue by issue_id
   * 3. If not found, release claim
   * 4. If found and still candidate-eligible: dispatch or requeue
   * 5. If found but no longer active, release claim
   */
  private async retryIssue(
    issueId: string,
    identifier: string,
    attempt: number
  ): Promise<void> {
    this.state.retryAttempts.delete(issueId);

    // Already running — shouldn't happen but guard
    if (this.state.running.has(issueId)) return;

    try {
      // Step 1: Fetch active candidates from tracker
      const candidates = await fetchCandidateIssues(this.config);

      // Step 2: Find our issue
      const issue = candidates.find((c) => c.id === issueId);

      if (!issue) {
        // Step 3: Not found in active candidates — release claim
        logger.info(`Issue no longer in active candidates, releasing`, {
          issue_identifier: identifier,
        });
        this.state.claimed.delete(issueId);
        return;
      }

      // Step 4/5: Check if still dispatch-eligible
      if (!isActiveState(issue.state, this.config)) {
        logger.info(`Issue no longer active, releasing claim`, {
          issue_identifier: identifier,
          state: issue.state,
        });
        this.state.claimed.delete(issueId);
        return;
      }

      // Check global concurrency
      if (this.state.running.size >= this.state.maxConcurrentAgents) {
        // Requeue with error (SPEC 8.4)
        const delay = CONTINUATION_RETRY_DELAY_MS;
        logger.info(`No slots available for retry, requeuing`, {
          issue_identifier: identifier,
        });
        scheduleRetry(
          this.state,
          issueId,
          identifier,
          attempt,
          delay,
          "no available orchestrator slots",
          () => this.retryIssue(issueId, identifier, attempt)
        );
        return;
      }

      // Dispatch
      const abortController = new AbortController();
      const entry = createRunningEntry(issue, abortController);
      entry.attempt = attempt;

      this.state.running.set(issueId, entry);
      // claimed is already set from before

      // Check if there's a fixup prompt for this issue
      const fixupPrompt = this.state.fixupPrompts.get(issueId);
      const options: RunAgentOptions | undefined = fixupPrompt
        ? { overridePrompt: fixupPrompt }
        : undefined;
      if (fixupPrompt) {
        this.state.fixupPrompts.delete(issueId);
      }

      logger.info(`Retrying agent`, {
        issue_identifier: identifier,
        attempt,
        has_fixup: !!fixupPrompt,
      });

      this.runAgentAsync(issue, entry, abortController, options);
    } catch (err) {
      // Fetch failed — requeue with backoff
      logger.warn(`Retry fetch failed, requeuing`, {
        issue_identifier: identifier,
        error: err instanceof Error ? err.message : String(err),
      });

      const delay = failureBackoffMs(
        attempt,
        this.config.agent.maxRetryBackoffMs
      );
      scheduleRetry(
        this.state,
        issueId,
        identifier,
        attempt,
        delay,
        err instanceof Error ? err.message : String(err),
        () => this.retryIssue(issueId, identifier, attempt)
      );
    }
  }

  private handleAgentUpdate(
    issueId: string,
    event: AgentUpdateEvent,
    entry: RunningEntry
  ): void {
    if (event.claudePid) {
      entry.pid = event.claudePid;
    }

    // Update last activity timestamp for stall detection (SPEC 8.5)
    entry.session.lastTimestamp = new Date();

    if (event.usage) {
      this.state.claudeTotals.inputTokens += event.usage.inputTokens;
      this.state.claudeTotals.outputTokens += event.usage.outputTokens;
      this.state.claudeTotals.totalTokens +=
        event.usage.inputTokens + event.usage.outputTokens;
    }
  }
}
