#!/usr/bin/env node
// Symphony CLI entry point (SPEC Section 12)

import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { loadWorkflow, watchWorkflow } from "./workflow.js";
import { buildConfig, validateConfig } from "./config.js";
import { Orchestrator } from "./orchestrator.js";
import { startHttpServer } from "./http-server.js";
import { logger, setLogLevel } from "./logger.js";

function parseArgs(args: string[]): {
  workflowPath: string;
  logsRoot: string;
  port: number | null;
  verbose: boolean;
} {
  let workflowPath = "./WORKFLOW.md";
  let logsRoot = "./log";
  let port: number | null = null;
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--logs-root" && args[i + 1]) {
      logsRoot = args[++i];
    } else if (arg === "--port" && args[i + 1]) {
      port = parseInt(args[++i], 10);
    } else if (arg === "--verbose" || arg === "-v") {
      verbose = true;
    } else if (!arg.startsWith("--")) {
      workflowPath = arg;
    }
  }

  return { workflowPath, logsRoot, port, verbose };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const expandedPath = resolve(args.workflowPath);

  if (args.verbose) {
    setLogLevel("debug");
  }

  // Load workflow
  if (!existsSync(expandedPath)) {
    logger.error(`Workflow file not found: ${expandedPath}`);
    process.exit(1);
  }

  let workflow = loadWorkflow(expandedPath);
  let config = buildConfig(workflow);

  // Validate config
  const validationError = validateConfig(config);
  if (validationError) {
    logger.warn(`Config validation warning`, {
      code: validationError.code,
      detail: "kind" in validationError ? validationError.kind : "",
    });
    // Don't exit — allow startup even with missing API key for dev
  }

  // Create orchestrator
  const orchestrator = new Orchestrator(config, workflow);

  // Watch workflow for changes
  const stopWatching = watchWorkflow(expandedPath, () => {
    logger.info("WORKFLOW.md changed, reloading...");
    try {
      workflow = loadWorkflow(expandedPath);
      config = buildConfig(workflow);
      orchestrator.updateConfig(config, workflow);
    } catch (err) {
      logger.error("Failed to reload WORKFLOW.md", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // Start HTTP server if port specified
  let httpServer: ReturnType<typeof startHttpServer> | null = null;
  if (args.port != null) {
    httpServer = startHttpServer(orchestrator, args.port);
  }

  // Handle shutdown
  const shutdown = async () => {
    logger.info("Shutting down...");
    stopWatching();
    await orchestrator.stop();
    httpServer?.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Start orchestrator
  logger.info("Symphony started", {
    workflow: expandedPath,
    tracker_kind: config.tracker.kind,
    project_slug: config.tracker.projectSlug ?? "n/a",
    max_concurrent: config.agent.maxConcurrentAgents,
    poll_interval_ms: config.polling.intervalMs,
  });

  await orchestrator.start();
}

main().catch((err) => {
  logger.error("Fatal error", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
