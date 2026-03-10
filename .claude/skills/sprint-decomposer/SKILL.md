---
name: sprint-decomposer
description: >
  Decomposes product requirements/PRD/feature descriptions into agent-executable
  development task documents and syncs them to Linear.
  Use when: (1) User provides a PRD or feature description to decompose
  (2) User says "decompose requirements", "break down tasks", "generate work specs", "sync to Linear"
  (3) Need to prepare Linear issues for Autoship orchestrator
  (4) Need to generate agent-readable work item specs
  Not for: single bugfixes, small changes, tasks with clear implementation plans already
---

# Sprint Decomposer

Decomposes requirements into agent-executable development tasks for Autoship, outputs spec documents + Linear issues.

## Workflow

```
Input → Context Collection → Layered Analysis → Work Item Decomposition → Dependency Graph → Doc Generation → Linear Sync
```

### Phase 1: Requirement Understanding

1. Read the user's requirement source (PRD, feature description, meeting notes, etc.)
2. Read project context:
   - Module decomposition docs (e.g., `doc/module-decompose.md`)
   - Competitive analysis (e.g., `doc/competitors/`)
   - Existing execution docs (e.g., `doc/plans/`)
   - Codebase structure (`src/` directory, type definitions, etc.)
3. Confirm with user:
   - MVP scope boundaries (what's in, what's out)
   - Team role assignments
   - Time constraints

### Phase 2: Layered Analysis

Analyze requirement modules using a 6-layer model:

| Layer | Name           | Question                         |
| ----- | -------------- | -------------------------------- |
| L1    | Entry Layer    | How do users arrive?             |
| L2    | Delivery Layer | What do users receive?           |
| L3    | Service Layer  | What ongoing value do users get? |
| L4    | Account Layer  | How is user identity managed?    |
| L5    | Infrastructure | How does the system run?         |
| L6    | Business Layer | How does the company make money? |

For each layer:

- Inventory existing capabilities (✅ Built / ⚠️ Partial / ❌ Not built)
- Identify modules to build/complete in this iteration
- Flag blockers and unknowns

### Phase 3: Work Item Decomposition

For each module to build, decompose using [work-item-spec-template.md](references/work-item-spec-template.md):

**Granularity principles**:

- Each work item should be **completable by 1 agent in 1-2 days**
- If estimated > 2 days, split further
- If < 0.5 days and tightly coupled with another task, consider merging

**Decomposition dimensions**:

- By pipeline (generation / editing / template / publishing)
- By role (AI engineering / full-stack / product)
- By dependency (independent tasks first)

**Each work item must include**:

- Clear inputs/outputs (agent doesn't need to guess)
- Numbered implementation steps (agent follows step by step)
- Verifiable acceptance criteria (agent self-validates)
- Dependency information (agent knows if it can start)
- Key file paths (agent knows where to make changes)

### Phase 4: Dependency Analysis

1. Draw dependency graph (ASCII)
2. Identify critical path
3. Identify parallelizable tasks
4. Flag blockers (⛔)

### Phase 5: Document Generation

Output file structure:

```
doc/{number}-{title}-agent-tasks.md
├── 1. Global Context (project goals, tech stack, team, type references, file map)
├── 2. Pipeline Flow Diagram (ASCII)
├── 3. Dependency Graph (ASCII)
├── 4. Parallelizable Task Matrix
├── 5. Work Item Agent Specs (numbered W{N})
├── 6. Scheduling Recommendations (by role/day)
└── 7. Risk Register
```

### Phase 6: Linear Sync

**Pre-flight checks**:

1. Verify `LINEAR_API_KEY` environment variable exists
2. Test API connectivity (query viewer + teams)
3. Confirm target Team and Project (create if not exists)

**Creation order** (strictly follow):

1. Create Labels (layer labels + role labels + blocker labels)
2. Create Issues (one per work item)
3. Create Blocking Relations (dependency links)

**Issue description requirements**:

- Description must be detailed enough for an Autoship agent to **independently** understand and execute
- Include complete: goal, inputs/outputs, implementation steps, acceptance criteria, dependency info
- Use Markdown format

**State mapping**:

- No dependencies → `Todo` (agent can pick up immediately)
- Has dependencies → `Planning` (waiting for upstream)

Linear API patterns reference: [linear-api-patterns.md](references/linear-api-patterns.md)

## Output Checklist

Verify each item upon completion:

- [ ] Execution document generated to `doc/` directory
- [ ] All work items have assignee role labels
- [ ] All work items have acceptance criteria
- [ ] Dependency graph is complete and acyclic
- [ ] Independent tasks set to Todo, dependent tasks set to Planning
- [ ] All Linear issues created successfully
- [ ] All blocking relations established
- [ ] Report to user: total issues, immediately startable count, critical path, risk items

## Notes

- Prefer splitting too fine over too coarse — agents handle small tasks more reliably
- Each work item description must be **self-contained** — agents won't read other issues
- Blocker labels identify critical path nodes that block downstream tasks
- If requirement has unconfirmed parts, mark as ⛔ blocker — don't make assumptions
- Research tasks (🔬) require document output, not just code
