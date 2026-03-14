# Logic Validation Report

**Scope**: T3-code team — Autonomous Coding Agent Loop project (37 issues across 3 milestones)
**Date**: 2026-03-14

## Executive Summary

The project is **logically well-structured overall** — the milestone layering is sound, the dependency graph has no circular dependencies, and the epic/child hierarchy is clean. However, the analysis uncovered **5 informal cross-references that should be formalized as blocking relations**, **1 critical logical gap** (no issue covers PR creation and human review workflow — the project's only human-in-the-loop step), and **4 missing issues** for retry/recovery, credential gating, and the review-to-merge handoff. The dependency graph resolves cleanly into 10 execution layers with CODE-2 and CODE-8 as the two true starting points.

---

## Individual Issue Coherence

### Logically Broken Issues

**None.** Every issue has a clear Problem → Desired Outcome structure, internally consistent acceptance criteria, and coherent scope.

### Issues with Minor Logic Problems

**CODE-33: Centralized API credential validation and configuration**

- **Problem**: This issue validates credentials needed by the embedding pipeline (CODE-3), planning agents (CODE-18/20), and coding agents (CODE-24) — but it **blocks nothing**. Logically, anything calling an external API should depend on credential validation being in place. Currently it's a dead-end leaf node with no downstream impact.
- **Severity**: High — without formal downstream connections, this issue could be completed last or skipped, leaving the pipeline to fail at runtime with missing credentials.

**CODE-34: Structured logging service with agent output capture**

- **Problem**: The description references CODE-9 (state machine) and CODE-10 (agent lifecycle manager) as systems whose events it needs to capture, but has no formal `blockedBy` relation on either. It only formally depends on CODE-8 (SQLite schema). Logically, the logging service needs to understand agent lifecycle events and state transitions to capture them correctly.
- **Severity**: Warning — the logging service could technically be built against the schema alone, but integration would be smoother if CODE-9 and CODE-10 are formalized as soft dependencies.

**CODE-36: Context engine freshness validation before pipeline use**

- **Problem**: The description mentions CODE-21 (planning loop coordinator) as a consumer of freshness data, but there's no formal relation. Freshness validation gates whether the pipeline can trust context engine results — this should logically block the planning loop coordinator or at minimum the validation orchestrator (which it does block via CODE-16).
- **Severity**: Warning — the critical path through CODE-16 is captured, but the CODE-21 reference is dangling.

**CODE-37: Automated merge conflict resolution via coding agent**

- **Problem**: The description references CODE-26 (verification stage) because after conflict resolution, the merged result needs re-verification. But there's no formal relation between CODE-37 and CODE-26. These two need to interoperate: conflict resolution triggers re-verification.
- **Severity**: Warning — this is an integration concern that should be documented, even if not a hard blocker.

### Coherent Issues

**33 of 37 issues** passed individual validation with no logical concerns. The Problem/Desired Outcome structure is consistently applied, acceptance criteria align with stated problems, and scope is focused to single logical units. Particularly well-structured issues include CODE-9 (state machine with clear state diagram), CODE-11 (file lock with deadlock detection), and CODE-21 (convergence detection with clear termination criteria).

---

## Sequence Analysis

### Current Order vs Logical Order

The dependency graph resolves into **10 clean execution layers** with no conflicts between declared and logical order:

| Layer | Issues                                                             | Description                                           |
| ----- | ------------------------------------------------------------------ | ----------------------------------------------------- |
| 1     | CODE-1, CODE-2, CODE-7, CODE-8, CODE-13, CODE-17, CODE-22, CODE-27 | Epics + two starter leaves (CODE-2, CODE-8)           |
| 2     | CODE-3, CODE-6, CODE-9, CODE-10, CODE-12, CODE-33, CODE-34         | First-wave services                                   |
| 3     | CODE-4, CODE-11, CODE-25, CODE-29, CODE-30                         | Indexer, file locks, git worktree, webhooks           |
| 4     | CODE-5, CODE-24, CODE-28, CODE-32                                  | Semantic search, coding agent, dashboard, contention  |
| 5     | CODE-14, CODE-15, CODE-19, CODE-23, CODE-26, CODE-36, CODE-37      | Validation, context agent, orchestrator, verification |
| 6     | CODE-16, CODE-18                                                   | Validation orchestrator, planning prompt              |
| 7     | CODE-20                                                            | Feedback agent                                        |
| 8     | CODE-21                                                            | Planning loop coordinator                             |
| 9     | CODE-31                                                            | End-to-end wiring                                     |
| 10    | CODE-35                                                            | Cost tracking                                         |

This sequencing is **logically sound** — foundations before services, services before orchestrators, orchestrators before integration.

### Missing Dependencies (informal references not formalized)

| Issue   | References                     | Relation Needed                                                                                |
| ------- | ------------------------------ | ---------------------------------------------------------------------------------------------- |
| CODE-8  | CODE-3 in description          | Informational only — CODE-8 schema anticipates embedding storage. No blocker needed.           |
| CODE-33 | CODE-31 in description         | CODE-33 should **block** CODE-31 — pipeline wiring needs validated credentials                 |
| CODE-34 | CODE-9, CODE-10 in description | CODE-34 should have **blockedBy** on CODE-9 and CODE-10 — needs their event interfaces         |
| CODE-36 | CODE-21 in description         | Informational — CODE-36 already blocks CODE-16 which transitively gates CODE-21                |
| CODE-37 | CODE-26 in description         | CODE-37 should have a **related-to** link with CODE-26 — they share the verification interface |

### Impossible Sequences

**None found.** The declared blocking relations are all logically valid — no issue is sequenced before something it logically requires.

### Missing Foundation Issues

**CODE-33 (credential validation) is unconnected downstream.** This is functionally a foundation service — every API-calling service needs validated credentials. But it blocks nothing, meaning the pipeline could be wired (CODE-31) without credential validation in place. This is the most significant missing foundation link.

---

## Collective Completeness

### Logical Gaps

**Gap 1 (Critical): PR creation and human review workflow**
The project description explicitly states: _"PR for human review (only human-in-the-loop step)"_. But no issue covers:

- Creating the sprint/phase PR on GitHub
- Notifying the human reviewer
- Handling review feedback (approve → merge, request changes → what happens?)
- The merge-to-main flow after approval

This is the project's **only human-in-the-loop step** and it has zero issue coverage. CODE-25 (git worktree) handles branch management and CODE-26 (verification) handles automated checks, but the handoff from "verification passed" to "human reviews and merges" is a gap.

**Gap 2 (High): Retry and recovery orchestration**
What happens when:

- A coding agent fails verification (CODE-26)? Is it retried? How many times? Who decides?
- The planning loop (CODE-21) fails to converge within the max rounds?
- A coding agent crashes mid-edit with a file lock held?
- Merge conflict resolution (CODE-37) fails?

CODE-26 mentions "feeding failures back" and CODE-21 has convergence detection, but there's no dedicated issue for the **retry policy and failure recovery orchestration** that ties these together at the pipeline level.

**Gap 3 (Warning): Pipeline health monitoring and alerting**
CODE-34 covers structured logging and CODE-28 covers the dashboard, but there's no issue for:

- Alerting when the pipeline is stuck (issue in same state for too long)
- Alerting on repeated failures (same issue failing validation 3+ times)
- Health checks for dependent services (embedding API, Linear API)

This may be intentional for v1, but worth noting.

**Gap 4 (Warning): Initial codebase bootstrap / first-run experience**
CODE-4 (incremental indexer) handles ongoing updates, but who triggers the initial full index? CODE-31 (pipeline wiring) might cover startup sequencing, but there's no explicit mention of the cold-start flow where the context engine has zero data.

### Contradictions

**None found.** No two issues describe mutually exclusive outcomes. The architecture is internally consistent.

### Goal Alignment Issues

**All 37 issues contribute to the stated project goal.** No orphan issues were detected — every issue has either parent/child or blocking relationships connecting it to the project's purpose. The three milestones (Foundation → Pipeline → Integration) cleanly map to the project's subsystem architecture.

### Completeness Assessment

If every issue were completed perfectly, the system would be **~90% complete** against the stated goal. The missing ~10% is:

1. **The human review workflow** — the pipeline would produce verified code on a sprint branch but have no mechanism to get it reviewed and merged to main
2. **Recovery from failures** — the pipeline would work on the happy path but have undefined behavior on failures
3. **No testing strategy** — 37 issues and none cover integration testing of the pipeline itself

---

## Recommended Actions (Prioritized)

1. **Create a new issue: "PR creation and human review notification workflow"** under CODE-22 or CODE-27, blocked by CODE-25 and CODE-26. This is the project's stated human-in-the-loop step with zero coverage. _(Critical)_

2. **Create a new issue: "Pipeline retry policy and failure recovery orchestration"** under CODE-27 or as a standalone, blocked by CODE-21, CODE-26, CODE-37. Defines retry limits, failure escalation, and stuck-issue detection. _(High)_

3. **Add blocking relation: CODE-33 → CODE-31.** Credential validation must be complete before end-to-end pipeline wiring. _(High)_

4. **Add blocking relations: CODE-9 and CODE-10 → CODE-34.** Structured logging needs agent lifecycle and state machine event interfaces. _(Warning)_

5. **Add related link: CODE-37 ↔ CODE-26.** Merge conflict resolution and verification share an interface and need coordinated design. _(Warning)_

6. **Create a new issue: "Pipeline integration test suite"** under CODE-27, blocked by CODE-31. Covers end-to-end test scenarios for the assembled pipeline. _(Warning)_

7. **Create a new issue: "Initial codebase bootstrap and cold-start indexing"** under CODE-1, blocked by CODE-4. Handles first-run full indexing and startup readiness checks. _(Warning)_

---

## Suggested New Issues

### 1. PR Creation and Human Review Workflow

**Parent**: CODE-22 (Coding Agent Orchestration) or CODE-27 (UI Tab and Linear Integration)
**Blocked by**: CODE-25 (git worktree), CODE-26 (verification), CODE-31 (pipeline wiring)
**Milestone**: M3: Integration
**Priority**: High
**Description**: After verification passes and the issue branch is merged to the sprint branch, the pipeline needs to create (or update) a GitHub PR targeting main, add a summary of changes, notify the human reviewer, and handle review outcomes (approve → merge, request changes → re-enter pipeline or park).

### 2. Pipeline Retry Policy and Failure Recovery

**Parent**: CODE-27 (UI Tab and Linear Integration)
**Blocked by**: CODE-21, CODE-26, CODE-37, CODE-9
**Milestone**: M3: Integration
**Priority**: High
**Description**: Define and implement the retry/recovery behavior for each pipeline stage — max retries for coding agent verification failures, behavior on planning loop non-convergence, recovery from agent crashes with held file locks, and escalation path when automated recovery fails (park the issue, notify human, update Linear status).

### 3. Pipeline Integration Test Suite

**Parent**: CODE-27 (UI Tab and Linear Integration)
**Blocked by**: CODE-31
**Milestone**: M3: Integration
**Priority**: Medium
**Description**: End-to-end integration tests that exercise the full pipeline with mock Linear issues, verifying state transitions, agent spawning, plan generation, code changes, verification, and branch management work together correctly.

### 4. Initial Codebase Bootstrap and Cold-Start Indexing

**Parent**: CODE-1 (Vector Embedding Context Engine)
**Blocked by**: CODE-4 (incremental indexer)
**Milestone**: M1: Foundation
**Priority**: Medium
**Description**: Handle the first-run scenario where the context engine has no indexed data. Trigger a full codebase index, provide progress reporting, and gate pipeline readiness on index completion. Ensure the pipeline won't attempt to process issues until the context engine is ready.
