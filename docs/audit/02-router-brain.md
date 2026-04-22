# Audit 02 — Router brain (`src/orchestrator/router.ts`)

Auditor: Worker 2/16, parallel strategy audit. Scope locked to the two files listed below.

## Scope

- `src/orchestrator/router.ts` (1105 lines)
- `src/orchestrator/router.test.ts` (440 lines)

Out of scope (handed off to other workers): pool, store, server, gateway-ws, streaming SSE loop detail. E2E skipped.

Sources cited: `docs/strategy.md` (gitignored rewrite 2026-04-18), `docs/architecture.md`, `CLAUDE.md`, https://www.anthropic.com/engineering/managed-agents for the brain/hands/session decoupling thesis.

## Claim-by-claim table

| # | Claim (CLAUDE.md / strategy.md / architecture.md) | Code match? | Right aim? | Evidence | Severity |
|---|---|---|---|---|---|
| 1 | `runEvent` on idle → `beginRun` → fire-and-forget `executeInBackground`; on running → enqueue (CLAUDE.md "Request lifecycle" step 2) | Yes | Yes | `src/orchestrator/router.ts:299-348` branches on `session.status === "running"` via `this.queue.enqueue(...)`, otherwise `beginRun` + `void runInBackground().catch(handleFailure)` | — |
| 2 | `streamEvent` rejects `session_busy` when session running (strategy A1 "real SSE token deltas shipped Apr 18") | Yes | Yes | `router.ts:378-383`; test at `router.test.ts:149-169` | — |
| 3 | Post-turn: `latestAgentMessage` read from JSONL for cost rollup → drain queue or `endRunSuccess` (CLAUDE.md "Request lifecycle" step 6) | Yes | Yes | `router.ts:812-834`: `this.events.latestAgentMessage(...)` → `usage` → `this.queue.shift(...)` → recursive `executeInBackground` or `endRunSuccess` | — |
| 4 | `handleBackgroundFailure` checks `session.status !== "running"` before `endRunFailure` (CLAUDE.md step 7) | Yes | Yes | `router.ts:980-1004` — explicit early return if not running | — |
| 5 | Warm-pool exception for delegating agents `callableAgents.length > 0 \|\| maxSubagentDepth > 0`, WITH a comment that restates the CLAUDE.md narrative ("See the long comment at `AgentRouter.warmForAgent`") | Yes | Yes | `router.ts:244-270`. Comment spans lines 243-258 and explicitly cites the immutable-env / silent-lineage failure mode | — |
| 6 | `cancel` does WS `abort(canonicalKey)` → clear queue + pending approvals → `endRunCancelled` | Yes | Yes | `router.ts:538-569`. Test `router.test.ts:394-431` covers the happy path | — |
| 7 | `confirmTool` resolves via `wsClient.approvalResolve` | Yes | Yes | `router.ts:577-603` | Coverage gap (test) — see §Confirmed gaps. |
| 8 | `RouterError` codes include `session_busy` and `quota_exceeded` | Yes | Yes | `router.ts:1075-1086`. Both present. `quota_exceeded` surfaced at `src/orchestrator/router.ts:157,166,176` | — |
| 9 | `assertQuota` enforces cost/tokens/wall-duration BEFORE busy/run path (strategy §Comparison "per-session cost/tokens/duration — B5 Apr 18") | Yes | Yes | `router.ts:152-182`, called at `:320` before the `session.status === "running"` check at `:322`. Tests cover all three axes (`router.test.ts:191-251`) | — |
| 10 | `observeAdoptedSession` subscribes WS `chat` events for state=final/error AND has JSONL fast-path (strategy B6 "observer-side resume") | Yes, with drift from auditor's expected mechanism | Yes (the actual mechanism is lighter-weight) | `router.ts:856-912`. WS subscribe at `:876-891`; fast-path at `:903-911`. Auditor checklist wanted `statJsonl + follow(afterEventId)`; the code uses `latestAgentMessage(...).createdAt > startedAt` instead. That's a looser invariant (an earlier agent.message without a newer turn wouldn't trigger finalize — exactly correct). The stronger `follow(afterEventId)` path is Worker 5's streaming surface, not this observer's. | Low (doc-only if anywhere) |
| 11 | `warmSession(sessionId)` pre-boots a container for the session | Yes | Yes | `router.ts:221-240` | — |
| 12 | `warmForAgent(agentId)` pre-boots for agent template, fire-and-forget, skipped for delegating agents | Yes | Yes | `router.ts:259-270` | — |
| 13 | `finalizeFromJsonl` — idempotent finalize used by observer, drains queue on success, evicts on error | Yes | Yes | `router.ts:914-964` | — |
| 14 | `resolveNetworking` returns `NetworkingSpec` only for `limited`, undefined for `unrestricted`/no env | Yes | Yes | `router.ts:613-624` | — |
| 15 | CLAUDE.md line 62 claims the queue lives at `src/orchestrator/event-queue.ts`; architecture.md §86-90 says the same and also "Queue is lost on orchestrator restart" | **NO. File does not exist.** Queue is inlined via `QueueStore` (`src/store/types.ts:188-213`), and the SQLite backend makes it DURABLE (`src/store/sqlite.ts:211-227, 690-742`). | The migration is RIGHT (durable queue is better; strategy line 178 literally lists "durable event queue" as a restart-safety invariant we shipped). But the two docs still describe the old in-memory layout. This is false-claim territory. | `Grep "event-queue"` returns no matches in `src/`; 1 hit in CLAUDE.md, 3 hits in architecture.md — all stale. | **HIGH** (documentation asserts a non-existent module AND misrepresents durability guarantee) |
| 16 | Strategy §Deployment model / §Restart safety calls out "durable event queue" | Yes (code-accurate) | Yes | `SqliteQueueStore` persists `queued_events` rows; `listSessionsWithQueued()` is invoked at startup (`src/index.ts:430`). Strategy is internally consistent; it's architecture.md and CLAUDE.md that diverged from strategy. | — |
| 17 | Delegating agents get an appended "## Delegation" instruction block ONLY when `callableAgents.length > 0 && remainingDepth > 0` (architecture.md §122) | Yes | Yes | `router.ts:652-666` | — |
| 18 | Router is stateless across orchestrator processes (no in-memory durable state) | Almost. `pendingApprovals: Map<string, PendingApproval[]>` (`router.ts:124`) IS in-memory process state. | Philosophically ambiguous. | `router.ts:124`, populated on WS `plugin.approval.requested` (`:744-757`). A restart drops every pending approval; the next turn the container is adopted but no WS callback replays in-flight approvals. If a session was paused waiting for human approval at the moment the orchestrator crashed, the approval silently disappears and the container never un-pauses. | **MEDIUM** — aligned-but-untested edge case (`always_ask` + mid-approval restart). Strategy line 178 lists "HMAC persistence / durable queue / adoption / SSE resume / observer-side run completion" as the five restart invariants — **nothing about pending approval rehydration.** This is either a gap in strategy or a deliberate punt. |
| 19 | `streamEvent` finalize has "external-cancel race guard" | Yes | Yes | `router.ts:493-497` — re-reads session, no-ops if not running | — |
| 20 | Client abort mid-stream finalizes as `ok: true` — turn continues server-side (server.ts:1026-1033 comment) | Yes | Design-debatable | The stream reader has no `AbortController` wired to client disconnect (`router.ts:416-432`). When the client drops, the reader keeps draining until upstream `[DONE]` or `runTimeoutMs`. No `wsClient.abort()` is called. Cost is rolled up from whatever the JSONL shows at that moment, which may or may not be the final agent message. | **MEDIUM** — customer-visible: a canceled download still costs the caller tokens for the entire turn; compared against Claude MA's documented SSE semantics, parity isn't guaranteed. Not a broken contract, but the docs silently commit to it. |

## Strategy critique (strategy.md can be wrong)

1. **Strategy line 178** lists five restart-safety invariants as a reusable correctness asset: HMAC secret persistence, durable event queue, labelled-container adoption, SSE `Last-Event-ID` resume, observer-side run completion. **The list is incomplete in a way that matters for this file.** Mid-approval restart (§Confirmed gap below, item 18) is a sixth invariant the orchestrator cares about and silently fails. Either add it to the roadmap or document explicitly that approvals are ephemeral by design. Both are fine; the current "we just forgot about it" is not.

2. **Strategy §"Why we exist" #2** states verbatim: *"We port Anthropic's architectural invariant to the open stack. Without us, deploying openclaw at cloud scale = each crash is a data loss event."* The router side of that port is solid (durable queue, adoption, observer). But the promise depends on Pi's `SessionManager.open()` being able to rebuild `AgentSession` from JSONL after the container dies. The router doesn't enforce or even verify this — it just assumes the adopted container's in-memory state is coherent with the JSONL. If `open()` has an off-by-one or misses a partial append, the orchestrator will cheerfully finalize a session with wrong state. Strategy claims this as a correctness asset; code is "trust Pi to be right." That is — probably — fine, because Pi's JSONL is the source of truth everywhere, but it's worth stating explicitly in strategy that we're leaning on Pi's invariants, not reimplementing them.

3. **Strategy §"Comparison vs Claude Managed Agents — SSE streaming"** says "Real SSE token deltas (A1 shipped Apr 18)" with an `=` parity mark against CMA. The code ships the relay (`router.ts:450-490`). But strategy doesn't note that **client-side abort does not propagate to the container** (§Confirmed gap, item 20). On CMA, cancel on the streaming HTTP connection is the canonical way to stop the turn; on us, you have to call the `/v1/sessions/:id/cancel` endpoint separately. That's a DX and cost delta that belongs in the comparison. Current table is optimistic.

4. **Strategy §"Why the other candidates aren't as well-positioned"** bullet 10 says *"OpenClaw still gives us Pi's primitives."* True for the JSONL log and `AgentSession` shape. But `observeAdoptedSession` (`router.ts:856-912`) is a brand-new primitive built at our layer, not inherited. The strategy framing underweights how much of the "production port of Anthropic's thesis" is actually us — not OpenClaw re-exposing Pi. That's fine for a strategy doc but worth naming: OpenClaw's surface is HTTP + WS; restart-time reattach is us.

## Missing-in-strategy

- **Approval rehydration (above, item 18).** Five invariants listed, six needed. Biggest gap.
- **`streamEvent` has no queue-drain.** Non-streaming `runEvent` queues-on-busy and drains-after-turn; streaming rejects with 409 `session_busy` and never drains anything. Intentional per the comment at `router.ts:360-362`, but the strategy "Per-session FIFO queue drains between turns" positions it as universal. Reality: FIFO-drain only works for the JSON path.
- **Cost rollup is a point-in-time stat-by-filename read, not a turn-synchronized event.** `latestAgentMessage` returns "the last `agent.message` currently on disk." If `executeInBackground` returns from `invokeChatCompletions` before Pi flushed, cost is 0 until the next turn picks up. Strategy §Cost accounting (CLAUDE.md line) says "provider reports real cost via the same path with zero runtime changes" which is true but glosses over the race.
- **Queue/pendingApprovals cross-contamination not covered in tests.** When `handleBackgroundFailure` fires, it clears queue + pending approvals (`router.ts:989-990`). A session that was mid-approval when the run failed would lose both. Fine behavior; not tested.

## Production-readiness risks

1. **One process per tenant implies HMAC secret regenerates on every restart** (strategy line 178 calls "HMAC persistence" a listed invariant but the parent-token minter's secret still regenerates per-process — `src/runtime/parent-token.ts`). In-flight subagent tokens hit 403 after a restart. Router `executeInBackground` re-mints on every spawn so the invariant holds for active containers; it does NOT hold for an `openclaw-call-agent` process already in-flight that reconnects post-restart. This is router-adjacent (the minter is injected via `cfg.tokenMinter`); worth flagging.

2. **`invokeChatCompletions` does not pass a cancel signal tied to the session state.** Only `AbortSignal.timeout(runTimeoutMs)`. If a client cancels via `POST /cancel`, `handleBackgroundFailure` fires on the subsequent HTTP error — but the HTTP request itself is not aborted from our side. On a 10-minute default `runTimeoutMs` this means cancel-then-post-new-event will silently keep the old request alive for ~the rest of the ten minutes if the container is unresponsive to WS abort.

3. **`executeInBackground` uses recursion for queue drain.** At N queued events this is N stack frames. With the default max of whatever-clients-send, this is DoS-sensitive if a buggy client enqueues 10k events on a running session. Should be an explicit loop.

4. **`pendingApprovals` is unbounded per-session.** No cap, no TTL. A misbehaving `always_ask` agent could accumulate pending approvals until OOM. Medium risk because `always_ask` is opt-in and broadcasts arrive one per tool call, but worth tracking.

## Confirmed gaps

### HIGH

**HIGH-1: CLAUDE.md line 62 and architecture.md §86-90, §510, §605 assert a module (`src/orchestrator/event-queue.ts`) that does not exist.**
- Root cause: Queue was migrated from an in-memory orchestrator module to a `QueueStore` abstraction in `src/store/types.ts:188-213`. SQLite backend (`src/store/sqlite.ts:690-742`) makes it durable. Docs were not updated.
- False claims introduced by the drift: (a) file path references point nowhere; (b) architecture.md §90 says *"Queue is lost on orchestrator restart, consistent with Item 3's rehydration semantics"* — this is now WRONG on the default SQLite backend, and it's the wrong direction of wrongness (it understates the correctness guarantee we actually ship); (c) strategy line 178 lists "durable event queue" as a top-five invariant — if someone reads strategy and then opens architecture.md to understand it, they'll conclude strategy is aspirational rather than accurate. Embarrassing to an OEM SRE reading the architecture doc.
- Fix owner: docs (architecture.md + CLAUDE.md). Trivial in LOC but load-bearing for the "restart safety is a reusable correctness asset" pitch.

**HIGH-2: `src/orchestrator/router.test.ts` has zero coverage of the four hardest-to-get-right methods the file owns: `executeInBackground`, `finalizeFromJsonl`, `handleBackgroundFailure`, `observeAdoptedSession`.**
- Root cause: Test file comment `router.test.ts:11-14` explicitly scopes tests to "decision-tree logic that doesn't require a live container". That's fine for the pre-dispatch surface; it means the restart-safety invariants (observer, finalize, handleBackgroundFailure's cancel guard, queue drain across iterations) are validated ONLY by `test/e2e.sh` on a live provider.
- Why this is HIGH not MEDIUM: strategy §"Why we exist" #4 sells the restart invariants as our moat — *"We've done the work once, in the open, with tests."* — and then the unit tests don't cover the restart invariants. A regression here (someone accidentally removes the `session.status !== "running"` guard at `router.ts:982`, or inverts the `outcome.ok` branch at `:925`) passes CI. This is the "aligned-but-untested" promotion to HIGH because it's exactly the claim the strategy doc invokes for commercial credibility.
- Fix owner: tests. Needs a fake `SessionContainerPool` + `PiJsonlEventReader` that record calls, plus maybe a `fetch` stub (or an undici mock) for `invokeChatCompletions`. Non-trivial but fits the existing `makeRouter` helper.

### MEDIUM

**MEDIUM-1: `confirmTool` has no unit test, despite being one of the four methods that round-trip a real WS call.**
- `router.test.ts` tests `getPendingApprovals` (a getter) at line 434-438; that's it. `confirmTool`'s pop-from-pending + WS call is load-bearing for the `always_ask` permission policy which strategy §Comparison lists as an advantage we have over Claude MA.
- Fix owner: tests. Same `poolStub` pattern already used for `cancel`'s happy path test at line 405-411. 20-30 LOC.

**MEDIUM-2: `pendingApprovals` is not durable across restart.**
- `router.ts:124` in-memory `Map`. The observer wires up again on WS reconnect, but any in-flight approval that was requested before the restart and not yet resolved is lost — the container stays paused, the user's client stays waiting. No test, no documentation of the limitation.
- Strategy §Restart safety lists five invariants; approval is not among them. Either it's a deliberate punt (say so in strategy + architecture.md) or it's a gap. Current code silently chooses "deliberate punt."
- Fix owner: strategy doc + either a `pending_approvals` SQLite table OR an explicit docs line "mid-approval restart invalidates the approval; client must resend." The former is strictly better; the latter is ~3 LOC of docs.

**MEDIUM-3: `streamEvent` client-abort does not cancel the upstream turn.**
- `router.ts:416-432` uses only `AbortSignal.timeout(runTimeoutMs)`. Server finalize path at `server.ts:1026-1033` marks the session `ok: true` when the client drops — the container keeps running, the tokens keep metering, the cost rolls up from partial JSONL. Compared against Claude MA's SSE contract, this is a hidden cost delta.
- Fix owner: router. Wire an `AbortController` tied to the caller's signal through `streamEvent`'s options, and call `wsClient.abort` in `finalize` when the client aborted without `[DONE]`. ~20 LOC.

**MEDIUM-4: Queue drain in `executeInBackground` recurses instead of looping.**
- `router.ts:828` — `void this.executeInBackground(...)`. Each queued event adds a stack frame. Unlikely to matter in practice but operators running with malicious/retrying clients can hit a stack limit. An explicit `while(next = queue.shift(...))` loop with `await` is the right shape.
- Fix owner: router. ~10 LOC, trivial.

### LOW

**LOW-1: Architecture.md §86 names the queue module as `SessionEventQueue`. Code uses `QueueStore` / `SqliteQueueStore`.** Symptom of the same drift as HIGH-1.

**LOW-2: Architecture.md §94 says AgentRouter has "six methods."** Actual public surface is ten: `createSession`, `warmSession`, `warmForAgent`, `runEvent`, `streamEvent`, `cancel`, `confirmTool`, `observeAdoptedSession`, `getPendingApprovals`, plus `assertQuota` (documented as private but called by public methods). Six is stale.

**LOW-3: `router.ts` imports `mkdirSync` and `chownSync` from `node:fs` inline during `buildSpawnOptions` (`:637-642`) — filesystem side-effects hidden inside a pure-looking builder.** Not broken; makes the method harder to unit-test. Arguably belongs on the runtime layer.

## Trivial fixes applied (≤30 LOC)

None. Every issue above is either >30 LOC (HIGH-2, MEDIUM-3, MEDIUM-2 durable version) or a docs fix I am not authorized to make autonomously under §"Things to avoid" of CLAUDE.md (no proactive documentation edits). A docs-edit PR is the right follow-up.

## Follow-up recommendations

1. **Ship a docs PR fixing HIGH-1** — delete the `event-queue.ts` file references, relocate the queue narrative to a `QueueStore` section in architecture.md, update CLAUDE.md §"Module map" row to point at `src/store/types.ts` + `src/store/sqlite.ts`. The strategy's "durable event queue" claim becomes truthfully documented. ~40-60 LOC across two files.

2. **Ship a test PR fixing HIGH-2** — add 4 tests (one per uncovered method) using fake pool + fake event reader + fetch stub. This is the unit-test moat strategy invokes on line 179 (*"with tests"*).

3. **Resolve MEDIUM-2** at strategy first, code second. Decide: is "mid-approval restart" an invariant we ship or an operator pain point we document? The answer affects one line of strategy and either zero or ~30 LOC of code + store migration.

4. **Fix MEDIUM-3** in router — wire client-abort into the streaming upstream. Aligns us with Claude MA's documented SSE semantics and removes a hidden cost cliff.

5. **Fix MEDIUM-4 and LOW-3** together — swap the tail recursion for a loop and extract the chown-before-spawn dance into `SessionContainerPool.acquireForSession` where the filesystem concern actually lives. ~30 LOC combined.

6. **Consider naming drift.** `QueueStore` in `store/`, legacy `SessionEventQueue` in docs. Architecture.md §510 table lists "In-memory per-session event queue — Orchestrator" under the "what is in-memory vs durable" section. Flipping that row to "durable" fixes a strategy-to-docs drift that currently makes the restart-safety story look unfinished.

---

**Bar set in the prompt** ("would an OEM SRE ship this without embarrassment?"): the code would ship. The docs would embarrass. HIGH-1 is a real-dot-real-world blocker for a cloud-OEM due-diligence review — the first architecture read flags a non-existent module. HIGH-2 is the kind of thing that fails a security-review engagement when they run the test suite with `--coverage`. Both are cheap to close.
