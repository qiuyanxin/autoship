// Workspace manager (SPEC Section 9)

import { existsSync, mkdirSync, rmSync, lstatSync, readdirSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { execSync } from "node:child_process";
import type { ServiceConfig, Issue, WorkspaceResult } from "./types.js";
import { logger } from "./logger.js";

const EXCLUDED_ENTRIES = new Set([".elixir_ls", "tmp"]);
const GIT_CLONE_MAX_RETRIES = 3;
const GIT_CLONE_RETRY_DELAY_MS = 2_000;

export function safeIdentifier(identifier: string | null | undefined): string {
  return (identifier || "issue").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function workspacePath(config: ServiceConfig, safeId: string): string {
  return join(config.workspace.root, safeId);
}

export function validateWorkspacePath(workspace: string, root: string): void {
  const expandedWorkspace = resolve(workspace);
  const expandedRoot = resolve(root);

  if (expandedWorkspace === expandedRoot) {
    throw new Error(`workspace_equals_root: ${expandedWorkspace}`);
  }

  if (!expandedWorkspace.startsWith(expandedRoot + "/")) {
    throw new Error(
      `workspace_outside_root: ${expandedWorkspace} not under ${expandedRoot}`
    );
  }

  // Check for symlink escape
  const relative = expandedWorkspace.slice(expandedRoot.length + 1);
  const segments = relative.split("/");
  let current = expandedRoot;
  for (const segment of segments) {
    current = join(current, segment);
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink()) {
        throw new Error(
          `workspace_symlink_escape: ${current} under ${expandedRoot}`
        );
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") break;
      if (err instanceof Error && err.message.startsWith("workspace_"))
        throw err;
    }
  }
}

function cleanTmpArtifacts(workspace: string): void {
  for (const entry of EXCLUDED_ENTRIES) {
    const p = join(workspace, entry);
    if (existsSync(p)) {
      rmSync(p, { recursive: true, force: true });
    }
  }
}

function clearDirectoryContents(dir: string): void {
  for (const entry of readdirSync(dir)) {
    rmSync(join(dir, entry), { recursive: true, force: true });
  }
}

export function ensureGitRepo(workspace: string, repoUrl: string): void {
  const gitDir = join(workspace, ".git");

  if (existsSync(gitDir)) {
    // Verify it's a valid git repo
    try {
      execSync("git rev-parse --is-inside-work-tree", {
        cwd: workspace,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 10_000,
      });
      logger.info("Git repo already exists in workspace", { workspace });
      return;
    } catch {
      logger.warn("Invalid .git directory, will re-clone", { workspace });
    }
  }

  // Clone with retries
  for (let attempt = 1; attempt <= GIT_CLONE_MAX_RETRIES; attempt++) {
    try {
      clearDirectoryContents(workspace);
      execSync(`git clone --depth 1 ${repoUrl} .`, {
        cwd: workspace,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120_000,
      });

      // Verify clone succeeded
      if (existsSync(gitDir)) {
        logger.info("Git repo cloned successfully", {
          workspace,
          repo_url: repoUrl,
          attempt,
        });
        return;
      }

      throw new Error(".git directory not found after clone");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("Git clone attempt failed", {
        workspace,
        attempt,
        max_retries: GIT_CLONE_MAX_RETRIES,
        error: msg.slice(0, 500),
      });

      if (attempt < GIT_CLONE_MAX_RETRIES) {
        // Synchronous sleep via execSync to avoid async in this context
        execSync(`sleep ${GIT_CLONE_RETRY_DELAY_MS / 1000}`, {
          stdio: "ignore",
        });
      }
    }
  }

  throw new Error(
    `workspace_git_clone_failed: ${GIT_CLONE_MAX_RETRIES} attempts exhausted for ${repoUrl}`
  );
}

function runHook(
  command: string,
  workspace: string,
  hookName: string,
  config: ServiceConfig,
  issueIdentifier?: string
): void {
  const timeoutMs = config.hooks.timeoutMs;
  logger.info(`Running workspace hook`, {
    hook: hookName,
    workspace,
    issue_identifier: issueIdentifier ?? "n/a",
  });

  try {
    execSync(`sh -lc ${JSON.stringify(command)}`, {
      cwd: workspace,
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `workspace_hook_failed: hook=${hookName} ${msg.slice(0, 2048)}`
    );
  }
}

export function createForIssue(
  config: ServiceConfig,
  issue: Issue | string
): WorkspaceResult {
  const identifier = typeof issue === "string" ? issue : issue.identifier;
  const safeId = safeIdentifier(identifier);
  const ws = workspacePath(config, safeId);

  validateWorkspacePath(ws, config.workspace.root);

  let createdNow = false;

  if (existsSync(ws)) {
    try {
      const stat = lstatSync(ws);
      if (stat.isDirectory()) {
        cleanTmpArtifacts(ws);
      } else {
        rmSync(ws, { recursive: true, force: true });
        mkdirSync(ws, { recursive: true });
        createdNow = true;
      }
    } catch {
      rmSync(ws, { recursive: true, force: true });
      mkdirSync(ws, { recursive: true });
      createdNow = true;
    }
  } else {
    mkdirSync(ws, { recursive: true });
    createdNow = true;
  }

  // Ensure git repo is present (replaces hook-based cloning)
  if (config.workspace.repoUrl) {
    ensureGitRepo(ws, config.workspace.repoUrl);
  }

  // Run after_create hook for non-git setup (e.g. pnpm install)
  if (createdNow && config.hooks.afterCreate) {
    runHook(config.hooks.afterCreate, ws, "after_create", config, identifier);
  }

  return { path: ws, workspaceKey: safeId, createdNow };
}

export function removeWorkspace(
  config: ServiceConfig,
  workspace: string
): void {
  if (!existsSync(workspace)) return;
  validateWorkspacePath(workspace, config.workspace.root);

  if (config.hooks.beforeRemove) {
    try {
      runHook(
        config.hooks.beforeRemove,
        workspace,
        "before_remove",
        config,
        basename(workspace)
      );
    } catch (err) {
      logger.warn(`before_remove hook failed (ignored)`, {
        workspace,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  rmSync(workspace, { recursive: true, force: true });
}

export function removeIssueWorkspaces(
  config: ServiceConfig,
  identifier: string
): void {
  const safeId = safeIdentifier(identifier);
  const ws = join(config.workspace.root, safeId);
  if (existsSync(ws)) {
    removeWorkspace(config, ws);
  }
}

export function runBeforeRunHook(
  config: ServiceConfig,
  workspace: string,
  identifier?: string
): void {
  if (config.hooks.beforeRun) {
    runHook(
      config.hooks.beforeRun,
      workspace,
      "before_run",
      config,
      identifier
    );
  }
}

export function runAfterRunHook(
  config: ServiceConfig,
  workspace: string,
  identifier?: string
): void {
  if (config.hooks.afterRun) {
    try {
      runHook(
        config.hooks.afterRun,
        workspace,
        "after_run",
        config,
        identifier
      );
    } catch (err) {
      logger.warn(`after_run hook failed (ignored)`, {
        workspace,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export function listWorkspaces(config: ServiceConfig): string[] {
  const root = config.workspace.root;
  if (!existsSync(root)) return [];
  return readdirSync(root).map((name) => join(root, name));
}
