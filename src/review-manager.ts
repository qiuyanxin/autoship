// ReviewManager — automated PR review + merge lifecycle (Plan Phase 2)

import { execSync, spawn, type ChildProcess } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServiceConfig } from "./types.js";
import { updateIssueState } from "./tracker/linear.js";
import { removeIssueWorkspaces } from "./workspace.js";
import { logger } from "./logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REVIEWER_PROMPT_PATH = join(
  __dirname,
  "..",
  "scripts",
  "reviewer-prompt.md"
);

const REVIEW_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const MAX_CONCURRENT_REVIEWS = 2;
const REVIEW_BUDGET_USD = "0.50";

interface PullRequest {
  number: number;
  title: string;
  headRefName: string;
  url: string;
  body: string;
}

interface ReviewResult {
  prNumber: number;
  verdict: "READY FOR MERGE" | "NEEDS WORK" | "NEEDS DISCUSSION" | "UNKNOWN";
  reviewText: string;
}

export class ReviewManager {
  private config: ServiceConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private reviewInProgress = false;
  private branchPattern: RegExp;
  private repoRoot: string;

  constructor(config: ServiceConfig, repoRoot: string) {
    this.config = config;
    this.repoRoot = repoRoot;
    // Match branches created by symphony agents: mg-*/... or similar issue identifier patterns
    this.branchPattern = /^[a-z]+-\d+\//i;
  }

  start(): void {
    logger.info("ReviewManager starting", {
      interval_ms: REVIEW_INTERVAL_MS,
      max_concurrent: MAX_CONCURRENT_REVIEWS,
    });
    this.timer = setInterval(() => this.reviewTick(), REVIEW_INTERVAL_MS);
    // Run first tick after a short delay to let agents get started
    setTimeout(() => this.reviewTick(), 30_000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info("ReviewManager stopped");
  }

  async triggerReview(): Promise<void> {
    await this.reviewTick();
  }

  private async reviewTick(): Promise<void> {
    if (this.reviewInProgress) return;
    this.reviewInProgress = true;

    try {
      const prs = this.fetchOpenPRs();
      if (prs.length === 0) {
        logger.debug("ReviewManager: no open PRs to review");
        return;
      }

      // Filter to symphony-created PRs that haven't been reviewed yet
      const unreviewedPRs = prs.filter((pr) => {
        if (!this.branchPattern.test(pr.headRefName)) return false;
        return !this.hasReviewComment(pr.number);
      });

      if (unreviewedPRs.length === 0) {
        logger.debug("ReviewManager: no unreviewed symphony PRs");
        return;
      }

      logger.info("ReviewManager: found unreviewed PRs", {
        count: unreviewedPRs.length,
        prs: unreviewedPRs.map((p) => `#${p.number}`).join(", "),
      });

      // Review in batches
      for (let i = 0; i < unreviewedPRs.length; i += MAX_CONCURRENT_REVIEWS) {
        const batch = unreviewedPRs.slice(i, i + MAX_CONCURRENT_REVIEWS);
        const results = await Promise.all(batch.map((pr) => this.reviewPR(pr)));

        for (const result of results) {
          if (!result) continue;
          await this.handleVerdict(result);
        }
      }
    } catch (err) {
      logger.error("ReviewManager tick failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.reviewInProgress = false;
    }
  }

  private fetchOpenPRs(): PullRequest[] {
    try {
      const output = execSync(
        `gh pr list --state open --json number,title,headRefName,url,body`,
        {
          cwd: this.repoRoot,
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 30_000,
        }
      ).toString();
      return JSON.parse(output) as PullRequest[];
    } catch (err) {
      logger.warn("Failed to fetch open PRs", {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  private hasReviewComment(prNumber: number): boolean {
    try {
      const output = execSync(
        `gh pr view ${prNumber} --json comments --jq '.comments | length'`,
        {
          cwd: this.repoRoot,
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 15_000,
        }
      )
        .toString()
        .trim();
      return parseInt(output, 10) > 0;
    } catch {
      return false;
    }
  }

  private async reviewPR(pr: PullRequest): Promise<ReviewResult | null> {
    logger.info("Starting PR review", {
      pr_number: pr.number,
      title: pr.title,
    });

    const reviewerPrompt = this.loadReviewerPrompt();
    if (!reviewerPrompt) {
      logger.error("Reviewer prompt not found", {
        path: REVIEWER_PROMPT_PATH,
      });
      return null;
    }

    const fullPrompt = `${reviewerPrompt}

---

## Your Assignment

Review PR #${pr.number}: "${pr.title}"

Use these commands to inspect the PR:
\`\`\`bash
gh pr view ${pr.number} --json title,body,baseRefName,headRefName,files,additions,deletions
gh pr diff ${pr.number}
\`\`\`

Then read all changed files in full and provide your structured review.`;

    try {
      const reviewText = await this.runClaudeReviewer(fullPrompt);
      const verdict = this.parseVerdict(reviewText);

      logger.info("PR review complete", {
        pr_number: pr.number,
        verdict,
      });

      return { prNumber: pr.number, verdict, reviewText };
    } catch (err) {
      logger.error("PR review failed", {
        pr_number: pr.number,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  private loadReviewerPrompt(): string | null {
    if (!existsSync(REVIEWER_PROMPT_PATH)) return null;
    return readFileSync(REVIEWER_PROMPT_PATH, "utf-8");
  }

  private async runClaudeReviewer(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const env = { ...process.env };
      delete env.CLAUDECODE;
      delete env.CLAUDE_CODE;

      const args = [
        "-p",
        prompt,
        "--dangerously-skip-permissions",
        "--model",
        this.config.claude.model ?? "sonnet",
        "--max-budget-usd",
        REVIEW_BUDGET_USD,
        "--output-format",
        "json",
      ];

      let child: ChildProcess;
      try {
        child = spawn(this.config.claude.command, args, {
          cwd: this.repoRoot,
          env,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (err) {
        reject(err);
        return;
      }

      let stdout = "";
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      const timeout = setTimeout(
        () => {
          child.kill("SIGTERM");
          setTimeout(() => child.kill("SIGKILL"), 5000);
          reject(new Error("Review timed out"));
        },
        5 * 60 * 1000
      ); // 5 min timeout

      child.on("close", (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error(`Claude reviewer exited with code ${code}`));
          return;
        }
        // Parse JSON output
        try {
          const parsed = JSON.parse(stdout);
          resolve(parsed.result ?? parsed.error ?? stdout);
        } catch {
          resolve(stdout);
        }
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  private parseVerdict(
    text: string
  ): "READY FOR MERGE" | "NEEDS WORK" | "NEEDS DISCUSSION" | "UNKNOWN" {
    const upper = text.toUpperCase();
    if (upper.includes("READY FOR MERGE")) return "READY FOR MERGE";
    if (upper.includes("NEEDS WORK")) return "NEEDS WORK";
    if (upper.includes("NEEDS DISCUSSION")) return "NEEDS DISCUSSION";
    return "UNKNOWN";
  }

  private async handleVerdict(result: ReviewResult): Promise<void> {
    switch (result.verdict) {
      case "READY FOR MERGE":
        await this.mergeAndCleanup(result);
        break;

      case "NEEDS WORK":
        await this.requestChanges(result);
        break;

      case "NEEDS DISCUSSION":
      case "UNKNOWN":
        // Post review as comment, don't take action
        this.postComment(result.prNumber, result.reviewText);
        logger.info("PR review posted (no auto-action)", {
          pr_number: result.prNumber,
          verdict: result.verdict,
        });
        break;
    }
  }

  private async mergeAndCleanup(result: ReviewResult): Promise<void> {
    const prNumber = result.prNumber;

    // Post approval comment
    this.postComment(
      prNumber,
      `## Automated Review: READY FOR MERGE\n\n${result.reviewText}\n\n---\n_Auto-merging..._`
    );

    // Merge
    try {
      execSync(`gh pr merge ${prNumber} --squash --delete-branch`, {
        cwd: this.repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30_000,
      });
      logger.info("PR merged successfully", { pr_number: prNumber });
    } catch (err) {
      logger.error("PR merge failed", {
        pr_number: prNumber,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    // Transition Linear issue to Done
    const issueId = this.extractLinearIssueId(result);
    if (issueId) {
      try {
        await updateIssueState(this.config, issueId, "Done");
        logger.info("Linear issue moved to Done", {
          pr_number: prNumber,
          issue_id: issueId,
        });
      } catch (err) {
        logger.warn("Failed to update Linear issue state", {
          issue_id: issueId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Clean up workspaces
    const identifier = this.extractIdentifierFromBranch(prNumber);
    if (identifier) {
      removeIssueWorkspaces(this.config, identifier);
    }

    // Prune local branches
    try {
      execSync("git fetch --prune origin", {
        cwd: this.repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 15_000,
      });
    } catch {
      // non-fatal
    }
  }

  private async requestChanges(result: ReviewResult): Promise<void> {
    const prNumber = result.prNumber;

    // Post review feedback as comment
    this.postComment(
      prNumber,
      `## Automated Review: NEEDS WORK\n\n${result.reviewText}`
    );

    // Move Linear issue back to In Progress
    const issueId = this.extractLinearIssueId(result);
    if (issueId) {
      try {
        await updateIssueState(this.config, issueId, "In Progress");
        logger.info("Linear issue moved back to In Progress", {
          pr_number: prNumber,
          issue_id: issueId,
        });
      } catch (err) {
        logger.warn("Failed to update Linear issue state", {
          issue_id: issueId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private postComment(prNumber: number, body: string): void {
    try {
      // Truncate body to avoid command line limits
      const truncated =
        body.length > 60000
          ? body.slice(0, 60000) + "\n\n...(truncated)"
          : body;
      execSync(
        `gh pr comment ${prNumber} --body ${JSON.stringify(truncated)}`,
        {
          cwd: this.repoRoot,
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 15_000,
        }
      );
    } catch (err) {
      logger.warn("Failed to post PR comment", {
        pr_number: prNumber,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private extractLinearIssueId(result: ReviewResult): string | null {
    // Try to get the PR body and find Linear issue URL/ID
    try {
      const body = execSync(
        `gh pr view ${result.prNumber} --json body --jq '.body'`,
        {
          cwd: this.repoRoot,
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 15_000,
        }
      ).toString();
      // Look for Linear issue URL pattern: https://linear.app/.../issue/MG-123/...
      const match = body.match(/linear\.app\/[^/]+\/issue\/([A-Z]+-\d+)/);
      if (match) {
        // We have the identifier but need the ID. For now return null and
        // rely on workspace cleanup by identifier
        return null;
      }
      // Also try UUID pattern
      const uuidMatch = body.match(
        /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/
      );
      return uuidMatch ? uuidMatch[0] : null;
    } catch {
      return null;
    }
  }

  private extractIdentifierFromBranch(prNumber: number): string | null {
    try {
      const branch = execSync(
        `gh pr view ${prNumber} --json headRefName --jq '.headRefName'`,
        {
          cwd: this.repoRoot,
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 15_000,
        }
      )
        .toString()
        .trim();
      // Branch format: mg-123/some-description → identifier is MG-123
      const match = branch.match(/^([a-z]+-\d+)\//i);
      return match ? match[1].toUpperCase() : null;
    } catch {
      return null;
    }
  }
}
