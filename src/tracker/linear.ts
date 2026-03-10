// Linear GraphQL tracker client (SPEC Section 11.1)

import type { Issue, BlockerRef, ServiceConfig } from "../types.js";
import { logger } from "../logger.js";

const ISSUE_PAGE_SIZE = 50;
const REQUEST_TIMEOUT_MS = 30_000;

const QUERY = `
query AutoshipLinearPoll($projectSlug: String!, $stateNames: [String!]!, $first: Int!, $relationFirst: Int!, $after: String) {
  issues(filter: {project: {slugId: {eq: $projectSlug}}, state: {name: {in: $stateNames}}}, first: $first, after: $after) {
    nodes {
      id
      identifier
      title
      description
      priority
      state { name }
      branchName
      url
      labels { nodes { name } }
      inverseRelations(first: $relationFirst) {
        nodes {
          type
          issue {
            id
            identifier
            state { name }
          }
        }
      }
      createdAt
      updatedAt
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}`;

const QUERY_BY_IDS = `
query AutoshipLinearIssuesById($ids: [ID!]!, $first: Int!, $relationFirst: Int!) {
  issues(filter: {id: {in: $ids}}, first: $first) {
    nodes {
      id
      identifier
      title
      description
      priority
      state { name }
      branchName
      url
      labels { nodes { name } }
      inverseRelations(first: $relationFirst) {
        nodes {
          type
          issue {
            id
            identifier
            state { name }
          }
        }
      }
      createdAt
      updatedAt
    }
  }
}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeIssue(raw: any): Issue | null {
  if (!raw || typeof raw !== "object") return null;

  return {
    id: raw.id,
    identifier: raw.identifier,
    title: raw.title,
    description: raw.description ?? null,
    priority:
      typeof raw.priority === "number" && Number.isInteger(raw.priority)
        ? raw.priority
        : null,
    state: raw.state?.name ?? null,
    branchName: raw.branchName ?? null,
    url: raw.url ?? null,
    labels: extractLabels(raw),
    blockedBy: extractBlockers(raw),
    createdAt: raw.createdAt ? new Date(raw.createdAt) : null,
    updatedAt: raw.updatedAt ? new Date(raw.updatedAt) : null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractLabels(raw: any): string[] {
  const nodes = raw?.labels?.nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes
    .map((n: { name?: string }) => n?.name)
    .filter((n: unknown): n is string => typeof n === "string")
    .map((n: string) => n.toLowerCase());
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractBlockers(raw: any): BlockerRef[] {
  const nodes = raw?.inverseRelations?.nodes;
  if (!Array.isArray(nodes)) return [];

  return nodes.flatMap(
    (rel: {
      type?: string;
      issue?: { id?: string; identifier?: string; state?: { name?: string } };
    }) => {
      if (
        typeof rel.type === "string" &&
        rel.type.trim().toLowerCase() === "blocks" &&
        rel.issue
      ) {
        return [
          {
            id: rel.issue.id ?? null,
            identifier: rel.issue.identifier ?? null,
            state: rel.issue.state?.name ?? null,
          },
        ];
      }
      return [];
    }
  );
}

async function graphql(
  config: ServiceConfig,
  query: string,
  variables: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (!config.tracker.apiKey) {
    throw new Error("missing_linear_api_token");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(config.tracker.endpoint, {
      method: "POST",
      headers: {
        Authorization: config.tracker.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.error(`Linear GraphQL request failed`, {
        status: res.status,
        body: body.slice(0, 1000),
      });
      throw new Error(`linear_api_status_${res.status}`);
    }

    return (await res.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchCandidateIssues(
  config: ServiceConfig
): Promise<Issue[]> {
  if (!config.tracker.projectSlug) {
    throw new Error("missing_linear_project_slug");
  }

  return fetchByStatesPages(
    config,
    config.tracker.projectSlug,
    config.tracker.activeStates,
    null
  );
}

async function fetchByStatesPages(
  config: ServiceConfig,
  projectSlug: string,
  stateNames: string[],
  afterCursor: string | null
): Promise<Issue[]> {
  const allIssues: Issue[] = [];
  let cursor = afterCursor;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const body = await graphql(config, QUERY, {
      projectSlug,
      stateNames,
      first: ISSUE_PAGE_SIZE,
      relationFirst: ISSUE_PAGE_SIZE,
      after: cursor,
    });

    const data = body as {
      data?: {
        issues?: {
          nodes?: unknown[];
          pageInfo?: { hasNextPage?: boolean; endCursor?: string };
        };
      };
    };
    const nodes = data?.data?.issues?.nodes;
    const pageInfo = data?.data?.issues?.pageInfo;

    if (!Array.isArray(nodes)) {
      const errors = (body as { errors?: unknown[] }).errors;
      if (errors)
        throw new Error(`linear_graphql_errors: ${JSON.stringify(errors)}`);
      throw new Error("linear_unknown_payload");
    }

    for (const node of nodes) {
      const issue = normalizeIssue(node);
      if (issue) allIssues.push(issue);
    }

    if (pageInfo?.hasNextPage && pageInfo.endCursor) {
      cursor = pageInfo.endCursor;
    } else {
      break;
    }
  }

  return allIssues;
}

export async function fetchIssuesByStates(
  config: ServiceConfig,
  stateNames: string[]
): Promise<Issue[]> {
  if (!stateNames.length) return [];
  if (!config.tracker.projectSlug)
    throw new Error("missing_linear_project_slug");
  return fetchByStatesPages(
    config,
    config.tracker.projectSlug,
    stateNames,
    null
  );
}

export async function fetchIssueStatesByIds(
  config: ServiceConfig,
  issueIds: string[]
): Promise<Issue[]> {
  const ids = [...new Set(issueIds)];
  if (!ids.length) return [];

  const body = await graphql(config, QUERY_BY_IDS, {
    ids,
    first: Math.min(ids.length, ISSUE_PAGE_SIZE),
    relationFirst: ISSUE_PAGE_SIZE,
  });

  const data = body as { data?: { issues?: { nodes?: unknown[] } } };
  const nodes = data?.data?.issues?.nodes;

  if (!Array.isArray(nodes)) {
    const errors = (body as { errors?: unknown[] }).errors;
    if (errors)
      throw new Error(`linear_graphql_errors: ${JSON.stringify(errors)}`);
    throw new Error("linear_unknown_payload");
  }

  return nodes
    .map((n) => normalizeIssue(n))
    .filter((i): i is Issue => i !== null);
}

const UPDATE_ISSUE_STATE = `
mutation UpdateIssueState($issueId: String!, $stateId: String!) {
  issueUpdate(id: $issueId, input: { stateId: $stateId }) {
    success
    issue { id state { name } }
  }
}`;

const FIND_TEAM_BY_PROJECT = `
query FindTeamByProject($projectSlug: String!) {
  projects(filter: { slugId: { eq: $projectSlug } }, first: 1) {
    nodes { teams(first: 1) { nodes { id } } }
  }
}`;

const FIND_TEAM_STATES = `
query FindTeamStates($teamId: String!) {
  team(id: $teamId) {
    states { nodes { id name type } }
  }
}`;

let teamIdCache: string | null = null;
let stateIdCache: Map<string, string> = new Map();

async function resolveTeamId(config: ServiceConfig): Promise<string | null> {
  if (teamIdCache) return teamIdCache;

  if (!config.tracker.projectSlug) return null;

  const body = await graphql(config, FIND_TEAM_BY_PROJECT, {
    projectSlug: config.tracker.projectSlug,
  });
  const data = body as {
    data?: {
      projects?: {
        nodes?: { teams?: { nodes?: { id: string }[] } }[];
      };
    };
  };
  const teamId = data?.data?.projects?.nodes?.[0]?.teams?.nodes?.[0]?.id;
  if (teamId) {
    teamIdCache = teamId;
    logger.info(`Resolved team ID for project`, {
      project_slug: config.tracker.projectSlug,
      team_id: teamId,
    });
  }
  return teamId ?? null;
}

export async function findStateId(
  config: ServiceConfig,
  stateName: string
): Promise<string | null> {
  const cached = stateIdCache.get(stateName);
  if (cached) return cached;

  const teamId = await resolveTeamId(config);
  if (!teamId) {
    logger.warn(`Cannot resolve team ID, state lookup will fail`, {
      state_name: stateName,
    });
    return null;
  }

  const body = await graphql(config, FIND_TEAM_STATES, { teamId });
  const data = body as {
    data?: {
      team?: { states?: { nodes?: { id: string; name: string }[] } };
    };
  };
  const nodes = data?.data?.team?.states?.nodes;
  if (!nodes?.length) return null;

  // Cache all states from this team at once
  for (const node of nodes) {
    stateIdCache.set(node.name, node.id);
  }

  return stateIdCache.get(stateName) ?? null;
}

export async function updateIssueState(
  config: ServiceConfig,
  issueId: string,
  stateName: string
): Promise<boolean> {
  const stateId = await findStateId(config, stateName);
  if (!stateId) {
    logger.warn(`State not found in Linear`, { state_name: stateName });
    return false;
  }

  const body = await graphql(config, UPDATE_ISSUE_STATE, { issueId, stateId });
  const data = body as {
    data?: { issueUpdate?: { success?: boolean } };
  };

  if (data?.data?.issueUpdate?.success) {
    logger.info(`Updated issue state`, { issue_id: issueId, state: stateName });
    return true;
  }

  logger.warn(`Failed to update issue state`, {
    issue_id: issueId,
    state: stateName,
  });
  return false;
}
