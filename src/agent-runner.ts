// Agent runner — Claude Code subprocess (SPEC Section 10)

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import type {
  ServiceConfig,
  Issue,
  WorkflowDefinition,
  AgentUpdateEvent,
  ClaudeStreamEvent,
  LiveSession,
} from "./types.js";
import { buildPrompt, buildContinuationPrompt } from "./prompt-builder.js";
import {
  createForIssue,
  runBeforeRunHook,
  runAfterRunHook,
} from "./workspace.js";
import { logger } from "./logger.js";

function parseStreamLine(line: string): ClaudeStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    const obj = JSON.parse(trimmed);
    if (!obj || typeof obj !== "object") return null;

    const event: ClaudeStreamEvent = {
      type: obj.type ?? "unknown",
      raw: obj,
    };

    // Extract text from content_block_delta
    if (obj.type === "content_block_delta" && obj.delta?.text) {
      event.subtype = "text_delta";
      event.text = obj.delta.text;
    }

    // Extract usage from message_delta
    if (obj.type === "message_delta" && obj.usage) {
      event.usage = {
        inputTokens: obj.usage.input_tokens ?? 0,
        outputTokens: obj.usage.output_tokens ?? 0,
      };
    }

    // Extract session info from initial message
    if (obj.type === "message_start" && obj.message?.id) {
      event.sessionId = obj.message.id;
    }

    // Handle result type events from Claude Code stream-json
    if (obj.type === "result") {
      event.subtype = "result";
      if (obj.session_id) event.sessionId = obj.session_id;
      if (obj.usage) {
        event.usage = {
          inputTokens: obj.usage.input_tokens ?? 0,
          outputTokens: obj.usage.output_tokens ?? 0,
        };
      }
    }

    // Handle assistant message type
    if (obj.type === "assistant" && obj.message) {
      event.subtype = "assistant";
      if (typeof obj.message === "string") {
        event.text = obj.message;
      } else if (Array.isArray(obj.message)) {
        event.text = obj.message
          .filter((b: { type?: string; text?: string }) => b.type === "text")
          .map((b: { text: string }) => b.text)
          .join("");
      }
    }

    return event;
  } catch {
    return null;
  }
}

function buildClaudeArgs(
  config: ServiceConfig,
  prompt: string,
  sessionId?: string
): string[] {
  const args: string[] = [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
  ];

  // Permission mode
  if (config.claude.permissionMode === "dangerously-skip-permissions") {
    args.push("--dangerously-skip-permissions");
  }

  // Model
  if (config.claude.model) {
    args.push("--model", config.claude.model);
  }

  // Session resumption for continuation turns
  if (sessionId) {
    args.push("--resume", sessionId);
  }

  return args;
}

function createEmptySession(): LiveSession {
  return {
    sessionId: randomUUID(),
    claudePid: null,
    lastEvent: null,
    lastTimestamp: null,
    lastMessage: "",
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    turnCount: 0,
  };
}

export interface AgentRunResult {
  session: LiveSession;
  exitCode: number | null;
  error?: string;
  workspacePath: string;
}

async function runSingleTurn(
  config: ServiceConfig,
  prompt: string,
  workspacePath: string,
  session: LiveSession,
  onUpdate?: (event: AgentUpdateEvent) => void,
  abortSignal?: AbortSignal
): Promise<{ exitCode: number | null; sessionId?: string }> {
  const args = buildClaudeArgs(
    config,
    prompt,
    session.turnCount > 0 ? session.sessionId : undefined
  );

  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    // Prevent nesting detection
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE;

    let child: ChildProcess;
    try {
      child = spawn(config.claude.command, args, {
        cwd: workspacePath,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      reject(
        new Error(
          `Failed to spawn claude: ${err instanceof Error ? err.message : String(err)}`
        )
      );
      return;
    }

    session.claudePid = child.pid ?? null;

    onUpdate?.({
      event: "session_started",
      timestamp: new Date(),
      claudePid: child.pid,
      sessionId: session.sessionId,
    });

    // Stall detection (process-level safety net)
    let lastActivityMs = Date.now();
    const stallCheck = setInterval(() => {
      if (
        config.claude.stallTimeoutMs > 0 &&
        Date.now() - lastActivityMs > config.claude.stallTimeoutMs
      ) {
        clearInterval(stallCheck);
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5000);
      }
    }, 10_000);

    // Turn timeout
    const turnTimeout = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000);
    }, config.claude.turnTimeoutMs);

    // Abort handling
    if (abortSignal) {
      const onAbort = () => {
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5000);
      };
      abortSignal.addEventListener("abort", onAbort, { once: true });
    }

    let resolvedSessionId: string | undefined;

    // Parse NDJSON stdout
    if (child.stdout) {
      const rl = createInterface({ input: child.stdout });
      rl.on("line", (line) => {
        lastActivityMs = Date.now();
        const event = parseStreamLine(line);
        if (!event) return;

        session.lastEvent = event.type;
        session.lastTimestamp = new Date();

        if (event.sessionId) {
          resolvedSessionId = event.sessionId;
        }

        if (event.text) {
          session.lastMessage = event.text.slice(0, 500);
        }

        if (event.usage) {
          session.inputTokens += event.usage.inputTokens;
          session.outputTokens += event.usage.outputTokens;
          session.totalTokens = session.inputTokens + session.outputTokens;
        }

        onUpdate?.({
          event: event.type,
          timestamp: new Date(),
          usage: event.usage
            ? {
                inputTokens: event.usage.inputTokens,
                outputTokens: event.usage.outputTokens,
                totalTokens: event.usage.inputTokens + event.usage.outputTokens,
              }
            : undefined,
          message: event.text,
          sessionId: event.sessionId,
        });
      });
    }

    // Log stderr
    if (child.stderr) {
      const stderrLines = createInterface({ input: child.stderr });
      stderrLines.on("line", (line) => {
        lastActivityMs = Date.now();
        logger.debug(`claude stderr: ${line}`, {
          session_id: session.sessionId,
        });
      });
    }

    child.on("error", (err) => {
      clearInterval(stallCheck);
      clearTimeout(turnTimeout);
      reject(err);
    });

    child.on("close", (code) => {
      clearInterval(stallCheck);
      clearTimeout(turnTimeout);
      session.turnCount++;
      resolve({ exitCode: code, sessionId: resolvedSessionId });
    });
  });
}

/**
 * Check if an issue is still in an active tracker state.
 * Used by the agent runner between turns (SPEC Section 7.1).
 */
export type IsIssueActiveCheck = () => Promise<boolean>;

export interface RunAgentOptions {
  overridePrompt?: string;
}

export async function runAgent(
  config: ServiceConfig,
  workflow: WorkflowDefinition,
  issue: Issue,
  checkIssueActive: IsIssueActiveCheck,
  onUpdate?: (event: AgentUpdateEvent) => void,
  abortSignal?: AbortSignal,
  options?: RunAgentOptions
): Promise<AgentRunResult> {
  const session = createEmptySession();

  logger.info(`Starting agent run`, {
    issue_id: issue.id,
    issue_identifier: issue.identifier,
  });

  // Create/reuse workspace
  const ws = createForIssue(config, issue);

  try {
    // Run before_run hook (SPEC 9.4: failure aborts current attempt)
    runBeforeRunHook(config, ws.path, issue.identifier);

    // Build initial prompt (or use override for fixup retries)
    const prompt = options?.overridePrompt ?? buildPrompt(workflow, issue);

    // Multi-turn loop (SPEC Section 7.1):
    // After each successful turn, re-check tracker state.
    // If still active, start another turn with --resume on same thread.
    const maxTurns = config.agent.maxTurns;

    for (let turn = 1; turn <= maxTurns; turn++) {
      const turnPrompt =
        turn === 1 ? prompt : buildContinuationPrompt(turn, maxTurns);

      const result = await runSingleTurn(
        config,
        turnPrompt,
        ws.path,
        session,
        onUpdate,
        abortSignal
      );

      if (result.sessionId) {
        session.sessionId = result.sessionId;
      }

      logger.info(`Completed turn`, {
        issue_identifier: issue.identifier,
        turn: `${turn}/${maxTurns}`,
        exit_code: result.exitCode,
        session_id: session.sessionId,
      });

      onUpdate?.({
        event: result.exitCode === 0 ? "turn_completed" : "turn_failed",
        timestamp: new Date(),
        sessionId: session.sessionId,
      });

      // Non-zero exit = failed, don't continue
      if (result.exitCode !== 0) {
        session.claudePid = null;
        return {
          session,
          exitCode: result.exitCode,
          error: `Turn ${turn} exited with code ${result.exitCode}`,
          workspacePath: ws.path,
        };
      }

      // Check abort
      if (abortSignal?.aborted) {
        session.claudePid = null;
        return {
          session,
          exitCode: null,
          error: "aborted",
          workspacePath: ws.path,
        };
      }

      // Last turn reached — exit normally, orchestrator handles continuation
      if (turn >= maxTurns) {
        logger.info(`Max turns reached`, {
          issue_identifier: issue.identifier,
          max_turns: maxTurns,
        });
        break;
      }

      // Between turns: re-check tracker state (SPEC 7.1)
      const stillActive = await checkIssueActive();
      if (!stillActive) {
        logger.info(`Issue no longer active after turn, ending worker`, {
          issue_identifier: issue.identifier,
          turn,
        });
        break;
      }

      logger.info(`Issue still active, starting continuation turn`, {
        issue_identifier: issue.identifier,
        next_turn: turn + 1,
        max_turns: maxTurns,
      });
    }

    return { session, exitCode: 0, workspacePath: ws.path };
  } finally {
    session.claudePid = null;
    // SPEC 9.4: after_run failure is logged and ignored
    runAfterRunHook(config, ws.path, issue.identifier);
  }
}
