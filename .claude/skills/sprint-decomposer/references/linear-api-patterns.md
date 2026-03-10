# Linear API Integration Patterns

Patterns for creating and managing issues via the Linear GraphQL API.

## Authentication

```bash
curl -X POST https://api.linear.app/graphql \
  -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "..."}'
```

API Key is read from the `LINEAR_API_KEY` environment variable.

## Common Queries

### Get Team and Project Info

```graphql
{
  viewer {
    id
    name
    email
  }
  teams {
    nodes {
      id
      name
      key
    }
  }
  projects {
    nodes {
      id
      name
      slugId
    }
  }
}
```

### Get Workflow States

```graphql
{
  workflowStates {
    nodes {
      id
      name
      type
      team {
        key
      }
    }
  }
}
```

### Get Labels

```graphql
{
  team(id: "$TEAM_ID") {
    labels {
      nodes {
        id
        name
      }
    }
  }
}
```

## Create Operations

### Create Project

```graphql
mutation {
  projectCreate(input: { name: "project-name", teamIds: ["$TEAM_ID"] }) {
    success
    project {
      id
      name
      slugId
    }
  }
}
```

### Create Label

```graphql
mutation {
  issueLabelCreate(
    input: { name: "label-name", color: "#4C9AFF", teamId: "$TEAM_ID" }
  ) {
    success
    issueLabel {
      id
      name
    }
  }
}
```

### Create Issue

```graphql
mutation {
  issueCreate(
    input: {
      title: "issue title"
      description: "markdown description"
      teamId: "$TEAM_ID"
      projectId: "$PROJECT_ID"
      labelIds: ["$LABEL_ID_1", "$LABEL_ID_2"]
      stateId: "$STATE_ID"
      priority: 2
    }
  ) {
    success
    issue {
      id
      identifier
      title
      url
    }
  }
}
```

Priority: 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low

### Create Blocking Relation

```graphql
mutation {
  issueRelationCreate(
    input: {
      issueId: "$BLOCKED_ISSUE_ID"
      relatedIssueId: "$BLOCKER_ISSUE_ID"
      type: blocks
    }
  ) {
    success
  }
}
```

Note: `issueId` is the blocked issue, `relatedIssueId` is the blocker.

## Batch Creation Pattern

Since Linear GraphQL doesn't support native batch mutations, create sequentially:

```bash
# 1. Create all labels first, collect IDs
# 2. Create all issues, collect IDs
# 3. Create all blocking relations last
```

Key: Creation order must be labels → issues → relations, since later steps need IDs from earlier ones.

## Autoship Integration

After creating issues, update `WORKFLOW.md`'s `project_slug` field to the new project's `slugId`. Autoship will then poll these issues and dispatch agents.

```yaml
tracker:
  kind: linear
  project_slug: "your-project-slug"
  active_states:
    - "Todo"
    - "In Progress"
```
