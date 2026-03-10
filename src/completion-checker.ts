// Completion checker — verifies agent work after exit (Plan Phase 1.3)

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CompletionReport } from "./types.js";
import { logger } from "./logger.js";

function runGit(workspace: string, args: string): string | null {
  try {
    return execSync(`git ${args}`, {
      cwd: workspace,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

function runGh(workspace: string, args: string): string | null {
  try {
    return execSync(`gh ${args}`, {
      cwd: workspace,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

export function checkCompletion(workspace: string): CompletionReport {
  const report: CompletionReport = {
    branchCreated: false,
    commitsMade: 0,
    pushedToRemote: false,
    prCreated: false,
    prNumber: null,
  };

  if (!existsSync(join(workspace, ".git"))) {
    logger.warn("Completion check: no .git directory", { workspace });
    return report;
  }

  // Check branch
  const branch = runGit(workspace, "branch --show-current");
  if (branch && branch !== "main" && branch !== "master") {
    report.branchCreated = true;
  }

  // Check commits ahead of main
  const commitLog = runGit(workspace, "log origin/main..HEAD --oneline");
  if (commitLog) {
    report.commitsMade = commitLog.split("\n").filter(Boolean).length;
  }

  // Check if pushed
  if (report.branchCreated && branch) {
    const remoteRef = runGit(workspace, `ls-remote --heads origin ${branch}`);
    report.pushedToRemote = !!remoteRef && remoteRef.length > 0;
  }

  // Check PR
  if (report.branchCreated && branch) {
    const prJson = runGh(
      workspace,
      `pr list --head ${branch} --json number --jq ".[0].number"`
    );
    if (prJson && /^\d+$/.test(prJson)) {
      report.prCreated = true;
      report.prNumber = parseInt(prJson, 10);
    }
  }

  logger.info("Completion check result", {
    workspace,
    branch_created: report.branchCreated,
    commits: report.commitsMade,
    pushed: report.pushedToRemote,
    pr_created: report.prCreated,
    pr_number: report.prNumber,
  });

  return report;
}

export function buildFixupPrompt(report: CompletionReport): string {
  const missing: string[] = [];

  if (!report.branchCreated) {
    missing.push("- Create a feature branch (you are still on main)");
  }
  if (report.commitsMade === 0) {
    missing.push("- Make at least one commit with your changes");
  }
  if (!report.pushedToRemote) {
    missing.push("- Push your branch to origin: `git push -u origin HEAD`");
  }
  if (!report.prCreated) {
    missing.push(
      "- Create a Pull Request: `gh pr create --title '...' --body '...' --base main`"
    );
  }

  return `## Fix-up Required

Your previous session exited successfully but critical steps were NOT completed.
Do NOT restart the implementation. Your code changes are already in the workspace.

**Missing steps:**
${missing.join("\n")}

Check \`git status\`, \`git log\`, and \`gh pr list\` to understand current state, then complete ONLY the missing steps above.

After completing each step, verify it worked before moving on.`;
}

export function isComplete(report: CompletionReport): boolean {
  return (
    report.branchCreated &&
    report.commitsMade > 0 &&
    report.pushedToRemote &&
    report.prCreated
  );
}
