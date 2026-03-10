// Prompt builder with Liquid templates (SPEC Section 5.2)

import { Liquid } from "liquidjs";
import type { Issue, WorkflowDefinition } from "./types.js";

const DEFAULT_PROMPT = `You are working on a Linear issue.

Identifier: {{ issue.identifier }}
Title: {{ issue.title }}

Body:
{% if issue.description %}
{{ issue.description }}
{% else %}
No description provided.
{% endif %}`;

const engine = new Liquid({ strictVariables: true, strictFilters: true });

function issueToTemplateVars(issue: Issue): Record<string, unknown> {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description,
    priority: issue.priority != null ? String(issue.priority) : null,
    state: issue.state,
    branchName: issue.branchName,
    url: issue.url,
    labels: issue.labels.join(", "),
    createdAt: issue.createdAt?.toISOString() ?? null,
    updatedAt: issue.updatedAt?.toISOString() ?? null,
  };
}

export function buildPrompt(
  workflow: WorkflowDefinition,
  issue: Issue,
  attempt?: number | null
): string {
  const template = workflow.promptTemplate.trim() || DEFAULT_PROMPT;

  return engine.parseAndRenderSync(template, {
    issue: issueToTemplateVars(issue),
    attempt: attempt ?? null,
  });
}

export function buildContinuationPrompt(
  turnNumber: number,
  maxTurns: number
): string {
  return `Continuation guidance:

- The previous turn completed normally, but the Linear issue is still in an active state.
- This is continuation turn #${turnNumber} of ${maxTurns} for the current agent run.
- Resume from the current workspace state instead of restarting from scratch.
- The original task instructions and prior turn context are already present in this thread, so do not restate them before acting.
- Focus on the remaining ticket work and do not end the turn while the issue stays active unless you are truly blocked.`;
}

export function buildReviewFixPrompt(
  issue: Issue,
  prNumber: number,
  reviewFeedback: string
): string {
  return `You are working on Linear issue ${issue.identifier}: ${issue.title}

A code review was submitted on PR #${prNumber} with feedback that needs to be addressed.

## Review Feedback

${reviewFeedback}

## Instructions

1. Read the review feedback above carefully.
2. Check \`gh pr view ${prNumber}\` and \`gh pr diff ${prNumber}\` for context.
3. Make the requested changes.
4. Commit and push: \`git add <files> && git commit -m "fix(${issue.identifier}): address review feedback" && git push\`
5. Do NOT create a new PR — push to the existing branch.
6. After pushing, move the Linear issue back to "In Review".`;
}
