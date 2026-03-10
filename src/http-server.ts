// Optional HTTP observability API (SPEC Section 13.7)

import { createServer, type Server } from "node:http";
import type { Orchestrator } from "./orchestrator.js";
import { logger } from "./logger.js";

export function startHttpServer(
  orchestrator: Orchestrator,
  port: number
): Server {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const pathname = url.pathname;

    res.setHeader("Content-Type", "application/json");

    try {
      if (req.method === "GET" && pathname === "/api/v1/state") {
        const state = orchestrator.getState();
        const body = {
          running: Object.fromEntries(
            [...state.running.entries()].map(([id, entry]) => [
              id,
              {
                identifier: entry.identifier,
                startedAt: entry.startedAt.toISOString(),
                pid: entry.pid,
                attempt: entry.attempt,
                session: {
                  lastEvent: entry.session.lastEvent,
                  lastTimestamp: entry.session.lastTimestamp?.toISOString(),
                  inputTokens: entry.session.inputTokens,
                  outputTokens: entry.session.outputTokens,
                  totalTokens: entry.session.totalTokens,
                  turnCount: entry.session.turnCount,
                },
              },
            ])
          ),
          retrying: Object.fromEntries(
            [...state.retryAttempts.entries()].map(([id, entry]) => [
              id,
              {
                identifier: entry.identifier,
                attempt: entry.attempt,
                dueAtMs: entry.dueAtMs,
                error: entry.error,
              },
            ])
          ),
          totals: state.claudeTotals,
          rateLimits: state.claudeRateLimits,
          runningCount: state.running.size,
          maxConcurrent: state.maxConcurrentAgents,
        };
        res.writeHead(200);
        res.end(JSON.stringify(body, null, 2));
        return;
      }

      // GET /api/v1/:identifier
      const identifierMatch = pathname.match(/^\/api\/v1\/([^/]+)$/);
      if (
        req.method === "GET" &&
        identifierMatch &&
        identifierMatch[1] !== "state"
      ) {
        const identifier = identifierMatch[1];
        const state = orchestrator.getState();

        const running = [...state.running.values()].find(
          (e) => e.identifier === identifier
        );
        const retrying = [...state.retryAttempts.values()].find(
          (e) => e.identifier === identifier
        );

        if (!running && !retrying) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: "not_found" }));
          return;
        }

        res.writeHead(200);
        res.end(
          JSON.stringify(
            {
              running: running
                ? {
                    identifier: running.identifier,
                    startedAt: running.startedAt.toISOString(),
                    pid: running.pid,
                    attempt: running.attempt,
                    session: running.session,
                    workspacePath: running.workspacePath,
                  }
                : null,
              retrying: retrying
                ? {
                    identifier: retrying.identifier,
                    attempt: retrying.attempt,
                    dueAtMs: retrying.dueAtMs,
                    error: retrying.error,
                  }
                : null,
            },
            null,
            2
          )
        );
        return;
      }

      // POST /api/v1/refresh
      if (req.method === "POST" && pathname === "/api/v1/refresh") {
        orchestrator.triggerPoll();
        res.writeHead(200);
        res.end(JSON.stringify({ status: "poll_triggered" }));
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: "not_found" }));
    } catch (err) {
      logger.error("HTTP handler error", {
        error: err instanceof Error ? err.message : String(err),
      });
      res.writeHead(500);
      res.end(JSON.stringify({ error: "internal_error" }));
    }
  });

  server.listen(port, "127.0.0.1", () => {
    logger.info(`HTTP observability server listening`, { port });
  });

  return server;
}
