# Branch Status and Review Feedback Summary

This document provides a comprehensive overview of all open pull requests, their status, review feedback, and recommended actions for consolidation.

## Overview

**Total Open PRs: 14** (excluding this PR)

All open PRs have **merge conflicts** with main (`mergeable_state: "dirty"`) and require review feedback to be addressed before merging.

### Complete PR List

| PR # | Title | Branch | Status |
|------|-------|--------|--------|
| #3 | Add tab-aware session handling for CNS agent | `codex/extend-session-handling-and-audio-control` | Open |
| #4 | Add multi-tab overlay binding support | `codex/update-overlay-tabs-and-websocket-wiring` | Open |
| #9 | Add transcript endpoints and offline Supabase handling | `codex/finish-deepgram-consumer-and-add-rest-route` | Open |
| #11 | Add feed status UI and autopilot readiness events | `codex/add-overlay-ui-for-feed-status-and-events` | Open |
| #13 | Add DOM map WebSocket flow with patient binding UI | `codex/add-dom-mapper-and-patient-hint-flow` | Open |
| #15 | Add overlay state store with recorder and patient UI updates | `codex/create-tab-components-and-integrate-state-management` | Open |
| #19 | Connect overlay to feed A transcript stream | `codex/connect-overlay-ws-client-to-feed-a` | Open |
| #20 | Add transcript batching and retrieval endpoint | `codex/finalize-deepgram-consumer-handlers` | Open |
| #21 | Add DOM mapping snapshot and smart fill executor | `codex/implement-dom-mapper-and-smart-fill-executor` | Open |
| #22 | Add feed status diagnostics and autopilot readiness UI | `codex/emit-feed-status-events-and-render-ui` | Open |
| #23 | Add MCP Smart Fill plan execution and safety interlocks | `codex/implement-mcp-script-hooks-for-tab-flows` | Open |
| #24 | Add tab-aware websocket binding and overlay filtering | `codex/add-tab-registry-and-audio-binding` | Open |

---

## PR #3: Add multi-tab support and patient hint binding
**Branch:** `codex/add-tab-tracking-and-patient-hint-enforcement`  
**State:** Open (Merged: No)  
**Conflicts:** Yes (mergeable_state: dirty)

### Summary
- Adds session tracking by user + tab to support multiple tabs per user
- Implements patient hint binding to ensure transcript continuity across tabs
- Adds hello message flow for tab registration and patient hints

### Review Feedback to Address

| Priority | Issue | Location | Description | Recommended Fix |
|----------|-------|----------|-------------|-----------------|
| Medium | Type Safety | `server.ts:503` | Using `any` type for `message` parameter reduces type safety | Change to `Partial<PatientHints>` type |
| Medium | Patient Matching Logic | `server.ts:522-539` | `patientHintsMatch` only returns false when both sides have non-empty values | Consider stricter matching when one side has identifier and other doesn't |
| Medium | Null Handling | `server.ts:512` | `if (message.patientUuid)` doesn't preserve explicit `null` values | Use `if ('patientUuid' in message)` instead |
| Low | Stale Reference | `server.ts:559-580` | `userMap` accessed after potential deletion | Get next session before deleting from map |
| Low | API Documentation | `server.ts:310-321` | No clear documentation for hello message structure | Add TypeScript interface for HelloMessage |
| Low | Error Differentiation | `server.ts:257-258` | Same error for no deepgram vs no recording | Send different error messages |
| Low | Index Signature | `types/index.ts:193` | `[key: string]: any` allows untyped properties | Remove index signature, define explicit properties |

---

## PR #4: Add six-tab overlay layout with multi-panel UI
**Branch:** `codex/add-multi-panel-overlay-layout`  
**State:** Open (Merged: No)  
**Conflicts:** Yes (mergeable_state: dirty)

### Summary
- Rebuilds overlay with six-tab navigation (Summary, SOAP, Transcript, Tasks, Patient, Debug)
- Adds tab binding indicators and status banners
- Implements SOAP grid, autopilot chips, and debug log panels

### Review Feedback to Address

| Priority | Issue | Location | Description | Recommended Fix |
|----------|-------|----------|-------------|-----------------|
| **P1** | Transcript Routing Bug | `overlay.ts:212-214` | Transcript updates with no `tabId` route to 'summary' instead of 'transcript' due to fallback logic using `boundTab/activeTab` first | In `addTranscriptLine`, change `line.tabId \|\| this.state.boundTab \|\| this.state.activeTab \|\| 'transcript'` to `line.tabId \|\| 'transcript'` to ensure transcript content goes to the transcript tab by default |
| **Critical** | XSS Vulnerability | `overlay.ts:433-440` | `task.label` rendered via innerHTML without sanitization | Use `textContent` for plain text, or use DOMPurify for HTML content |
| **Critical** | XSS Vulnerability | `overlay.ts:523-530` | `note.content` rendered via innerHTML without sanitization | Use `textContent` for plain text, or use DOMPurify for HTML content |
| **Critical** | XSS Vulnerability | `overlay.ts:456-459` | Patient info (name, mrn, dob) rendered via innerHTML | Use `textContent` for plain text, or use DOMPurify for HTML content |
| **Critical** | XSS Vulnerability | `overlay.ts:477-483` | `entry.message` in debug panel rendered via innerHTML | Use `textContent` for plain text, or use DOMPurify for HTML content |
| Medium | Runtime Safety | `overlay.ts:261` | `transcriptByTab[activeTab]` could be undefined | Add `|| []` fallback |
| Medium | Accessibility | `tabs.ts:152` | Binding indicator uses aria-hidden without screen reader support | Add ARIA labels for binding state |
| Low | Event Naming | `bridge.ts:22-27` | Inconsistent event naming (kebab-case vs snake_case) | Standardize on kebab-case |
| Low | Memory | `overlay.ts:568` | Debug log limit applies globally, not per-tab | Consider per-tab limiting |
| Low | Consistency | `overlay.ts:496-498` | Tab name uses `.toUpperCase()` but labels use title case | Use tab label instead of ID |

---

## PR #9: Add transcript endpoints and offline Supabase handling
**Branch:** `codex/finish-deepgram-consumer-and-add-rest-route`  
**State:** Open (Merged: No)  
**Conflicts:** Yes (mergeable_state: dirty)

### Summary
- Adds transcript list endpoint with patient_code filtering
- Implements Supabase mock for offline operation
- Surfaces offline warnings to overlay UI

### Review Feedback to Address

| Priority | Issue | Location | Description | Recommended Fix |
|----------|-------|----------|-------------|-----------------|
| **P1** | Mock Chainability Bug | `supabase.ts:73-78` | Mock `insert` returns Promise, not chainable builder | Return chainable mock object with `.select().single()` methods |
| Medium | Unbounded Recursion | `server.ts:619` | Recursive call in `finally` block could cause stack overflow | Use while loop instead of recursion |
| Medium | Excessive DB Calls | `server.ts:440` | Per-chunk save + timer creates redundant queries | Remove per-chunk call, rely on timer |
| Low | ID Collision | `supabase.ts:74` | `mockData.size + 1` for ID fails after deletions | Use incrementing counter variable |
| Low | Inconsistent Error | `server.ts:261-262` | Error message includes `severity` field not in other errors | Remove severity field or document schema |

---

## PR #11: Add feed status UI and autopilot readiness events
**Branch:** `codex/add-overlay-ui-for-feed-status-and-events`  
**State:** Open (Merged: No)  
**Conflicts:** Yes (mergeable_state: dirty)

### Summary
- Broadcasts feed status and autopilot readiness messages via WebSocket
- Adds feed badges, readiness pills, alert banners, and debug log tab
- Routes backend signals through audio capture bridge

### Review Feedback to Address

| Priority | Issue | Location | Description | Recommended Fix |
|----------|-------|----------|-------------|-----------------|
| **Critical** | XSS Vulnerability | `debug-log.ts:61-68` | `entry.message` and `entry.detail` rendered via innerHTML | Use `textContent` instead |
| **Critical** | XSS Vulnerability | `feed-badges.ts:64-67` | `status.label` rendered via innerHTML | Use `textContent` instead |
| Medium | ID Collision | `overlay.ts:224` | Alert ID generation could create duplicates | Add random suffix for uniqueness |
| Medium | Autopilot Logic | `server.ts:205` | Ready when `surfaceCount > 0 \|\| isRecording` may incorrectly mark autopilot as ready during recording even without patient context | Review business requirements: if autopilot should only be ready when BOTH patient context exists AND recording is active, change to `surfaceCount > 0 && isRecording`; document the intended behavior |
| Low | Tabs Comment | `tabs.ts:7` | Comment lists only 3 tabs but code has 4 | Update comment to include Debug |
| Low | Timestamp Override | `ws-bridge.ts:98` | Hydration overrides stored timestamp | Use original timestamp |

---

## PR #13: Add DOM map WebSocket flow with patient binding UI
**Branch:** `codex/add-dom-mapper-and-patient-hint-flow`  
**State:** Open (Merged: No)  
**Conflicts:** Yes (mergeable_state: dirty)

### Summary
- Adds DOM map client and executor for field detection and form filling
- Updates overlay with Patient tab for name/MRN hints and binding actions
- Extends backend WebSocket broker for DOM map requests

### Review Feedback to Address

| Priority | Issue | Location | Description | Recommended Fix |
|----------|-------|----------|-------------|-----------------|
| **P1** | Connection State Conflict | `domMapClient.ts:90-95` | DOM-map socket emits 'connection' event, conflicts with main connection | Use distinct event like 'dommap-connection' |
| Medium | Memory Leak | `domMapClient.ts:75-84` | `checkInterval` not cleared on timeout rejection | Clear interval before reject |
| Medium | Missing Cleanup | `domMapClient.ts:35-43` | No `destroy()` method for cleanup | Add method to close WS and clear timer |
| Medium | History Loss | `fillExecutor.ts:73-79` | `undoLast()` clears entire history even on partial failure | Only clear successful entries |
| Low | Type Duplication | `broker.ts:49-55` | `FillStep` interface duplicated in 3 files | Create shared types file |
| Low | Event Dispatch | `fillExecutor.ts:132-134` | Blur dispatched even if element isn't focused | Check `activeElement` first |
| Low | Side Effect | `content.ts:90-96` | `map-fields` always sends to backend | Consider separate control |
| Low | Icon Choice | `tabs.ts:20` | Patient tab uses DNA icon '🧬' | Use person icon '👤' |

---

## PR #15: Add overlay state store with recorder and patient UI updates
**Branch:** `codex/create-tab-components-and-integrate-state-management`  
**State:** Open (Merged: No)  
**Conflicts:** Yes (mergeable_state: dirty)

### Summary
- Adds shared overlay types and state store (OverlayStore)
- Rebuilds layout with six-tab navigation, recorder pill, patient cards
- Emits richer recorder status events from audio capture

### Review Feedback to Address

| Priority | Issue | Location | Description | Recommended Fix |
|----------|-------|----------|-------------|-----------------|
| **Critical** | XSS Vulnerability | `patient-card.ts:101-119` | feed.label, feed.note, entry.message via innerHTML | Use `textContent` |
| **Critical** | XSS Vulnerability | `overlay.ts:383-386` | Status log messages via innerHTML | Use `textContent` |
| Medium | Missing Notify | `state.ts:74` | `setActiveTab` doesn't call `notify()` | Add `this.notify()` |
| Medium | Audio State | `audio-capture.ts:120` | Emits 'connecting' after socket is open | Should be 'listening' if recording |
| Medium | Error Coercion | `audio-capture.ts:85` | `String(error)` loses error details | Use `error.message` or `JSON.stringify` |
| Low | ID Collision | `state.ts:165` | `Math.random().toString(16)` could collide | Use `crypto.randomUUID()` |
| Low | WebSocket Close | `audio-capture.ts:133` | State logic for close may be incorrect | Check clean shutdown vs error |
| Low | skipNotify Pattern | `state.ts:152-161` | Inconsistent notify patterns | Document or simplify |
| Low | Title Sanitization | `recorder-pill.ts:58` | Message in title attribute | Consider escaping |
| Low | Patient Edge Case | `overlay.ts:79-87` | Empty name becomes 'Unknown' but check requires fields | Handle consistently |

---

## Recommended Consolidation Strategy

### Critical Security Fixes (Apply First)
All XSS vulnerabilities must be fixed before merging any PR:
1. For plain text content: Replace `innerHTML` with `textContent`
2. For HTML content: Implement DOMPurify or similar sanitization library
3. Create a shared utility function for consistent sanitization across components

### Merge Order Recommendation
Based on dependencies and feature groupings, merge in this order:

**Phase 1: Backend Foundation**
1. **PR #3** - Tab-aware session handling (foundation for multi-tab support)
2. **PR #9** - Transcript endpoints and offline Supabase (backend infrastructure)
3. **PR #20** - Transcript batching and retrieval (builds on #9)

**Phase 2: Feed and Status**  
4. **PR #11** - Feed status UI and autopilot events (backend to frontend)
5. **PR #22** - Feed status diagnostics and autopilot readiness UI (builds on #11)
6. **PR #24** - Tab-aware websocket binding (requires #3)

**Phase 3: Overlay UI**
7. **PR #4** - Multi-tab overlay binding support (UI structure)
8. **PR #15** - Overlay state store with recorder/patient UI (state management)
9. **PR #19** - Connect overlay to feed A transcript stream (requires #4, #15)

**Phase 4: DOM Mapping and Smart Fill**
10. **PR #13** - DOM map WebSocket flow (requires #3, #4)
11. **PR #21** - DOM mapping snapshot and smart fill executor (requires #13)
12. **PR #23** - MCP Smart Fill plan execution and safety (requires #21)

### Conflict Resolution Notes
Each PR will need to be rebased onto main after the previous PR is merged. Consider:
- Creating a feature branch that consolidates all changes
- Cherry-picking commits in dependency order
- Resolving conflicts incrementally

### Testing Requirements
After fixing all issues, run:
```bash
# For cns-agent
cd apps/cns-agent && npm run typecheck

# For overlay
cd apps/overlay && npm run typecheck

# For backend (if applicable)
cd backend && npm run typecheck
```

---

## Additional PRs (Not Previously Documented)

### PR #19: Connect overlay to feed A transcript stream
**Branch:** `codex/connect-overlay-ws-client-to-feed-a`  
**Summary:**
- Adds feed client to listen to feed A websocket messages
- Forwards diarized transcript updates to the overlay
- Includes reconnection/error handling

### PR #20: Add transcript batching and retrieval endpoint
**Branch:** `codex/finalize-deepgram-consumer-handlers`  
**Summary:**
- Batches Deepgram transcripts before persisting
- Flushes on utterance ends and disconnects
- Exposes GET /transcripts/:id for fetching transcript runs

### PR #21: Add DOM mapping snapshot and smart fill executor
**Branch:** `codex/implement-dom-mapper-and-smart-fill-executor`  
**Summary:**
- Adds DOM mapping snapshot support
- Implements Smart Fill executor with undo stubs
- Surfaces patient hints to overlay mapping tab

### PR #22: Add feed status diagnostics and autopilot readiness UI
**Branch:** `codex/emit-feed-status-events-and-render-ui`  
**Summary:**
- Emits backend feed status events
- Surfaces feed/autopilot badges in overlay header
- Calculates DOM coverage for autopilot readiness

### PR #23: Add MCP Smart Fill plan execution and safety interlocks
**Branch:** `codex/implement-mcp-script-hooks-for-tab-flows`  
**Summary:**
- Adds MCP command to execute Smart Fill plans
- Enforces patient-context safety checks
- Implements content-side handlers for plan steps

### PR #24: Add tab-aware websocket binding and overlay filtering
**Branch:** `codex/add-tab-registry-and-audio-binding`  
**Summary:**
- Registers tabs on websocket broker using hello messages
- Handles bind_audio to start tab-scoped Deepgram runs
- Filters overlay transcript display by tab

---

## Summary Statistics

| PR | Files Changed | Additions | Deletions | Status |
|----|---------------|-----------|-----------|--------|
| #3 | 3 | 308 | 24 | Needs Rebase |
| #4 | 8 | 662 | 56 | Needs Rebase |
| #9 | 3 | 211 | 34 | Needs Rebase |
| #11 | 10 | 560 | 9 | Needs Rebase |
| #13 | 8 | 562 | 7 | Needs Rebase |
| #15 | 10 | 947 | 138 | Needs Rebase |
| #19 | - | - | - | Needs Rebase |
| #20 | - | - | - | Needs Rebase |
| #21 | - | - | - | Needs Rebase |
| #22 | - | - | - | Needs Rebase |
| #23 | - | - | - | Needs Rebase |
| #24 | - | - | - | Needs Rebase |

**Total Review Items:** Approximately 55 documented comments across PRs (additional items may exist in PRs #19-#24)

---

## Manual Merge Instructions

Since all PRs have merge conflicts, the repository owner should:

1. **Review each PR** for the documented issues above
2. **Rebase each branch** onto main in the recommended order
3. **Resolve conflicts** as they arise
4. **Run type checking** after each merge:
   ```bash
   cd apps/cns-agent && npm run typecheck
   cd apps/overlay && npm run typecheck
   cd backend && npm run typecheck
   ```
5. **Merge via GitHub UI** using squash or merge commit as preferred

Alternatively, create a consolidated feature branch:
```bash
git checkout main
git pull origin main
git checkout -b feature/consolidate-all-prs

# Merge each branch in order, resolving conflicts
git merge origin/codex/extend-session-handling-and-audio-control
# ... resolve conflicts ...
git commit

# Continue with remaining branches
```
