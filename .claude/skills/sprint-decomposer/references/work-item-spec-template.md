# Work Item Spec Template

Agent-executable work item specification template. Each work item must include the following fields.

## Template

```markdown
### W{N} | {Title}

| Field        | Value                             |
| ------------ | --------------------------------- |
| **ID**       | W{N}                              |
| **Assignee** | {role name}                       |
| **Estimate** | {N}d                              |
| **Layer**    | L{N}-{layer name}                 |
| **Priority** | P{1-4} ({Urgent/High/Medium/Low}) |

#### Goal

{One sentence describing what this work item achieves}

#### Inputs

- {Upstream deliverables or external data}

#### Outputs

- {This work item's deliverables, must be verifiable}

#### Implementation Steps

1. {Numbered steps, each should be an executable action}
2. {If research is a prerequisite, mark with 🔬}
3. {If code is involved, provide key file paths}

#### Acceptance Criteria

- [ ] {Objectively verifiable condition, checkbox format}
- [ ] {Each should be verifiable via command/test/manual operation}

#### Dependencies

- **Upstream**: {W{X} (description)} or "None ✅ can start immediately"
- **Downstream**: {W{Y} (description)}
- **Blocker**: ⛔ {if this task blocks others}

#### Key Files

- `path/to/relevant/file.ts`
- `path/to/another/file.ts`

#### Agent Notes

- {Things to watch out for during execution}
- {Common pitfalls or constraints}
```

## Field Rules

### Priority Mapping

| Level | Linear | Meaning                           |
| ----- | ------ | --------------------------------- |
| P1    | Urgent | Critical path, blocks other tasks |
| P2    | High   | Required for core flow            |
| P3    | Medium | Important but non-blocking        |
| P4    | Low    | Can defer to next iteration       |

### State Mapping

| Condition                    | Initial State        |
| ---------------------------- | -------------------- |
| No upstream dependencies     | Todo (can start now) |
| Has unfinished upstream deps | Planning (waiting)   |
| Blocker item                 | Todo + Blocker label |

### Layer Labels

| Layer | Label             | Meaning                      |
| ----- | ----------------- | ---------------------------- |
| L1    | L1-Entry          | User acquisition channels    |
| L2    | L2-Delivery       | User-facing features         |
| L3    | L3-Service        | Ongoing operational services |
| L4    | L4-Account        | User identity management     |
| L5    | L5-Infrastructure | Underlying tech support      |
| L6    | L6-Business       | Business model               |

### Acceptance Criteria Writing Rules

1. Each must be objectively verifiable (not "looks good")
2. Prefer command/API verification (e.g., `pnpm lint passes`)
3. Functional verification describes specific actions and expected results
4. Performance constraints must be quantified (e.g., `< 8s`, `≥ 4.5:1`)
