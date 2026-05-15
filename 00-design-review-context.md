# Design Review Context

## Document Info
- Path: docs/orchestration-workspace-lineage.md
- Type: Technical Spec / Product Design
- Review started: 2026-05-14 15:36:41 PDT

## Design Direction
- Direction confirmed: confirmed
- Chosen approach: first-class persisted workspace lineage with runtime-validated capture source/confidence, followed by opt-in sidebar Parent grouping
- Alternatives considered: session-scoped lineage only; orchestration-only lineage; storing parent fields directly on WorktreeMeta
- Key UX decisions: Parent grouping remains opt-in; pinned workspaces keep precedence with parent badges; inferred relationships are visible in CLI output and JSON; hidden/missing parent states remain recoverable

## Iteration State
Current iteration: 3
Last completed phase: Iteration 3 Verification
Issues addressed this iteration: none; verification found no remaining P0/P1 findings

## Addressed Issues (Do Not Re-report)
<!-- Issues that were fixed in the design doc. Reviewers should not re-report these. -->
<!-- Format: [iteration] | [severity] | [category] | [issue summary] | [how addressed] -->

Phase 0.5 | P1 | UX | Hidden confidence state for inferred parent | Added capture source/confidence to lineage and CLI output
Phase 0.5 | P1 | Architecture | Runtime capture source of truth unclear | Added Capture Source of Truth section and runtime validation rules for caller context
Phase 0.5 | P2 | UX | Parent grouping interactions under-specified | Added interaction state matrix for grouping, reveal, collapse, and repair flows
Phase 0.5 | P2 | Architecture | Row model/reveal risk under-specified | Added flat row model contract and sidebar grouping test requirements
Phase 0.5 | P2 | Architecture | Orchestration enrichment bridge incomplete | Added narrow runtime orchestration bridge and centralized validation guidance
Iteration 1 | P1 | CLI | CLI JSON shape/stdout contract ambiguity | Specified existing RPC envelope, single JSON stdout object, and stderr-only human diagnostics
Iteration 1 | P1 | CLI | Missing JSON warning/error contracts | Added `result.warnings[]`, stable lineage warning codes, and structured `ok: false` error example with `nextSteps`
Iteration 1 | P2 | Data integrity | Path-derived worktree ID reuse can stale-attach lineage | Added immutable workspace instance IDs and stale-instance handling
Iteration 1 | P2 | UX | Hidden-parent rendering was ambiguous | Made Parent grouping use `Hidden parent` deterministically and non-Parent modes use badges
Iteration 1 | P2 | Operational | Lineage failure observability under-specified | Added structured diagnostics with reason code, request ID, runtime ID, and candidate source types
Iteration 1 | P2 | UX | Repair action semantics under-specified | Renamed action to `Group under active workspace` and defined selection, disabled, multi-select, and SSH validation behavior
Iteration 2 | P1 | UX | Hidden parent behavior conflicted with filter contract | Made Parent grouping always render the real parent group when the parent exists and any child matches filters
Iteration 2 | P2 | API contract | Stale-instance warning placement under-specified | Clarified `LINEAGE_PARENT_INSTANCE_STALE` is a hydration/read-path diagnostic, not a create warning

## Skipped Issues (Accepted Risks)
<!-- Issues reviewed but deemed acceptable for this context. Do not re-report. -->
<!-- Format: [iteration] | [severity] | [category] | [reason skipped] | [issue summary] -->
<!-- NOTE: Only P2/P3 issues may be skipped. P0/P1 must always be addressed. -->

Phase 0.5 | P3 | UX | Below fix threshold after adding CLI/JSON confidence signals | Cognitive load from four grouping modes plus pinning exception

## Invalidated Findings (Do Not Re-report)
<!-- Findings that were challenged and determined to be false positives or noise. -->
<!-- Reviewers in future iterations must NOT resurface these. -->
<!-- Format: [iteration] | [original severity] | [finding summary] | [reason invalidated] -->

[Initially empty - populated after each validation phase]

## Findings History
<!-- Running log of findings across iterations for convergence tracking -->

### Phase 0.5
- Direction challenge confirmed the proposed direction with refinement.
- P0: 0 | P1: 2 | P2: 3 | P3: 1
- Addressed: 5 | Skipped: 1
- Key changes: capture confidence/source, runtime validation source-of-truth, interaction states, row model contract, orchestration bridge, capture-quality rollout gate

### Iteration 1
- P0: 0 | P1: 2 | P2: 4 | P3: 0
- Addressed: 6 | Skipped: 0
- Key changes: JSON envelope compatibility, structured warning/error contracts, instance IDs for stale lineage protection, deterministic hidden-parent rendering, diagnostics, repair-action semantics

### Iteration 2
- P0: 0 | P1: 1 | P2: 1 | P3: 0
- Addressed: 2 | Skipped: 0
- Key changes: parent group/filter precedence clarified; stale-instance diagnostics scoped to hydration/read path

### Iteration 3
- P0: 0 | P1: 0 | P2: 0 | P3: 0
- Addressed: 0 | Skipped: 0
- Key changes: final verification only; primary and secondary reviewers both reported no P0/P1 findings
