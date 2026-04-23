# Audit 09 — Restart safety (B4 + B6)

> Historical audit snapshot. Findings in this file were accurate at the time of the audit, but later commits may have fixed some or all of them. Treat this as a point-in-time review, not the current architecture contract.

**Scope.** `src/index.ts` (startup + shutdown blocks), `src/runtime/docker.ts::listManaged`, `src/runtime/pool.ts::adopt` and `::shutdown`, `src/store/sqlite.ts` (`queued_events` schema + `SqliteQueueStore`), `src/orchestrator/router.ts::observeAdoptedSession/finalizeFromJsonl/endRunFailure`. E2E skipped per brief.

**The bar.** Strategy §"Why we exist" #4 (`docs/strategy.md:176-180`) calls restart safety a "reusable correctness asset" and a structurally-permanent advantage over Claude MA (strategy line 424: `Restart safety invariants | Not documented | **Ahead (durable queue, HMAC persistence, observer-resume)**`). The category-defining quote from Anthropic's own engineering post (`https://www.anthropic.com/engineering/managed-agents`, cited at strategy:15 and :158) is that the pre-decoupling architecture had the property *"if a container failed, the session was lost."* Our claim — restated at strategy:327 — is: *"any orchestrator picks up any session; adoption on restart reconnects without respawn."* The operator bar is: SIGKILL mid-turn → every running session resumes with zero data loss; and the same must hold for orderly SIGTERM.

Two lenses for every finding:
1. **Did the 5-step restart flow land, or is a step stubbed/broken?**
2. **Is "adopt then re-subscribe" the right design for the one-orchestrator-per-tenant model we sell (strategy:200-225), or should it be leader-election over an HA pair?**

---

## HIGH-severity findings

### H1. `shutdown()` stops every active container on orderly SIGTERM, defeating adoption on planned restarts

**Evidence.** `src/index.ts:598-611`:

```
const shutdown = (signal: string): void => {
  log.info({ signal }, "shutting down");
  (async () => {
    try {
      await pool.shutdown();
    } catch (err) {
      log.warn({ err }, "pool shutdown error");
    }
    store.close();
    process.exit(0);
  })();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
```

`pool.shutdown()` in `src/runtime/pool.ts:668-699` is explicit about the teardown:

```
const containerIds = [
  ...entries.map((e) => e.container.id),
  ...entries.flatMap((e) =>
    e.ownedResources ? [e.ownedResources.sidecar.id] : [],
  ),
  ...warmEntries.map((e) => e.container.id),
];
await Promise.allSettled(containerIds.map((id) => this.runtime.stop(id)));
```

Every active agent container, every egress-proxy sidecar, and every warm container is `runtime.stop()`'d before `process.exit(0)`. `stop()` in `src/runtime/docker.ts` issues Docker stop + remove; labelled containers do not survive the transition.

**Why this matters.** The startup adoption block (`src/index.ts:336-404`) is the most carefully-designed piece of the restart-safety story — it specifically preserves warm containers, re-adopts running sessions via `pool.adopt()` (pool.ts:619-653), and only fails running sessions whose containers it could not reattach. But the entire preservation path is unreachable on an orderly restart, because the outgoing process tears down the very containers the incoming process would adopt. The comment at `pool.ts:34-36` describes the adoption pattern as a restart-time reaper:

```
// On orchestrator restart the pool is empty;
// any containers that outlived the prior process are reaped at startup by
// DockerContainerRuntime.cleanupOrphaned(). See src/index.ts.
```

This comment is stale (the orphan cleanup was replaced by selective adoption in the `fc52e7a`-vintage baseline, see `src/runtime/docker.ts:296-304`'s "NO LONGER CALLED on normal startup" note), but more importantly the comment assumes containers "outlived the prior process" — which is exactly the scenario `shutdown()` prevents on SIGTERM/SIGINT.

**Strategy-level impact.** The line we sell at strategy:327 — *"Same invariant: any orchestrator picks up any session; adoption on restart reconnects without respawn"* — is only true on ungraceful exits (SIGKILL, panic, OOM). On every planned Kubernetes rollout, every `docker compose up --build -d`, every systemd restart, the promise collapses to Anthropic's pre-decoupling property: *"if a container failed, the session was lost."* Planned restarts are the common case in managed-platform operations; SIGKILL is the rare pathological one. This inverts the marketing.

The strategy doc also gates our "same API, different substrate" partner pitch (§"Deployment model", strategy:200-225) on identical restart-safety semantics to Claude MA. A cloud OEM running our orchestrator behind their control plane will expect rolling deploys to be side-effect-free. Today they aren't — every rolling deploy would terminate every in-flight agent turn on that orchestrator, and the selective-failure code at `src/index.ts:394-404` would then mark every still-`running` row as `failed` with `"orchestrator restarted mid-run; post a new message to resume"`, because after `shutdown()` killed the containers there is nothing for the next process's `listManaged()` to return.

**Aligned Kubernetes operator-pattern precedent (citation).** The K8s operator reconciliation convention (`https://kubernetes.io/docs/concepts/extend-kubernetes/operator/`) is explicit that controllers must tolerate arbitrary restart and that terminating-pod teardown must not cascade into the workload they manage. `StatefulSet` pod termination on controller-manager restart is a well-known anti-pattern; the K8s SIG Agent Sandbox primitive the strategy cites at line 17 (`https://github.com/kubernetes-sigs/agent-sandbox`) was built specifically so the *sandbox* workload outlives *controller* restarts — the controller reconciles declaratively to existing sandbox state, it does not terminate and re-create. Our current shutdown path implements the opposite policy.

**What a correct shutdown looks like here.** The one-line fix is to skip `pool.shutdown()`'s container-stop phase on the orderly-exit path while still closing WS clients, letting adoption reattach on the next boot. The sweeper and the WS sockets should close; the containers should not. A flag like `pool.shutdown({ stopContainers: false })` or a separate `pool.detach()` method would make the intent explicit. The SIGTERM handler should invoke the detach path, and container teardown should happen only on operator-initiated `DELETE /v1/sessions/:id` (which already has `pool.evictSession`) or on idle reap.

There is a legitimate counter-argument: when the orchestrator is restarting to pick up code changes that affect the agent image (`OPENCLAW_RUNTIME_IMAGE` was bumped), old containers must be torn down. That is the case for operator-opt-in teardown, not for the default SIGTERM handler — an image bump is a different operation from a service restart, and the orchestrator has no way to detect "the image changed" (the env var alone can't disambiguate). The default should be "leave containers running, adopt on next boot"; the image-swap case becomes an explicit `docker compose down && docker compose up` or a `./scripts/evict-all.sh`.

**Severity.** HIGH. Directly contradicts a load-bearing strategy claim, structurally breaks restart adoption on the common operational path (SIGTERM), and is not a one-line correctness bug — it's a shutdown-policy inversion. The fix is small but the current code is actively misleading operators: the B4+B6 work at strategy:178 was sold as finishing *"durable commitments across restart"*, and on the orderly-restart branch it does not deliver.

### H2. Adoption path fails running containers silently (without observer wiring) when the `orphaned_running_sessions_failed` log field hides planned-restart teardown as data loss

**Evidence.** `src/index.ts:395-404`:

```
for (const session of store.sessions.list()) {
  if (session.status !== "running") continue;
  if (adopted.has(session.sessionId)) continue;
  store.sessions.endRunFailure(
    session.sessionId,
    "orchestrator restarted mid-run; post a new message to resume",
  );
  store.queue.clear(session.sessionId);
  orphanedRunningSessions += 1;
}
```

Combined with H1: on orderly SIGTERM, every active container is stopped → on restart, `listManaged()` (`src/runtime/docker.ts:247-294`) returns the stopped containers, the `if (!info.running) { ...stop orphan... }` branch at `src/index.ts:360-365` runs for each one, the session row is never added to `adopted`, and so every still-`running` session gets its queue cleared and its row set to `failed`. From the client's perspective, a graceful orchestrator restart produces the message `"orchestrator restarted mid-run; post a new message to resume"` on every in-flight run — which the strategy explicitly positions as a recoverable-but-inconvenient state for the crash case only.

**Severity.** HIGH (inherits from H1; H2 is the observable customer-facing symptom of H1). Notably, the log emission at `src/index.ts:472-478` packages this as `adoption.orphaned_running_sessions_failed: N` — on a graceful restart this counter will match the active-session count exactly, meaning an operator's dashboard will show the restart as N simultaneous "orphaned" runs. That's noise, not signal.

---

## MEDIUM-severity findings

### M1. Warm containers are unconditionally reaped at startup even though adoption would work for them too (would-be correct behavior is documented but wrong in execution)

**Evidence.** `src/index.ts:329-352`:

```
// Warm containers are deliberately NOT adopted: the only thing that
// identifies a warm container is its agentId label, but re-populating
// the warm bucket with `spawnOptions` would require a matching agent
// template, and the bound parent token in its env was minted for the
// previous process's secret. Simpler and safer to stop them; the next
// POST /v1/agents won't re-warm, so warmth is only lost until the
// operator recreates the agent or issues the first session.
// ...
if (!sessionId || sessionId === "__warm__") {
  await runtime.stop(info.id).catch(() => { /* best-effort */ });
  adoptionStoppedOrphan += 1;
  startupAdoptionsTotal.labels({ outcome: "stopped_orphan" }).inc();
  continue;
}
```

The comment correctly identifies the two real obstacles (need the agent template + the parent-token HMAC binding), but both are now solvable:
- The agent template is in `store.agents` on restart — that's the whole point of persisting the template.
- The parent-token secret `parent_token_hmac_secret` is now loaded from `store.secrets` and survives restart (`src/index.ts:273-281`), so a warm container's baked-in token is still valid if the secret is the same (which it is, post-this-commit).

The strategy explicitly prices restart-time pool recovery as load-bearing: strategy:162 says *"Brain = openclaw container. Interchangeable (warm pool, reaping, adoption on restart)."* Reaping the warm bucket on every restart means every first-post-restart session pays a full cold-spawn (~78s on a Hetzner CAX11 per strategy:357). For a per-tenant orchestrator that restarts on any config change, this is a user-visible latency regression tied to a maintenance operation.

**Severity.** MEDIUM. Aligned-but-not-implemented. Not a correctness bug (sessions still work), but undermines the warm-pool claim in the same commit that landed warm-pool adoption. Fix is additive: label warm containers with their `agentId` (already done via `openclaw-warm-agent-id` or similar — verify), re-spawn the warm map on startup by walking `listManaged()` for `__warm__` entries and matching against `store.agents.list()`.

### M2. `observeAdoptedSession` has no timeout — an adopted session whose in-flight turn died silently (container alive, Pi gateway wedged) stays `running` forever

**Evidence.** `src/orchestrator/router.ts:856-912`. The observer subscribes to the container's `chat` WS broadcast and runs the JSONL fast-path check, but has no watchdog: if the WS never emits `final` or `error` and no fresh `agent.message` appears in JSONL, `session.status` remains `running` with no bound.

The pool's idle sweeper (`src/runtime/pool.ts:701-712`) skips containers whose session is `isBusy` (status=running), so a wedged observed session is immune to the sweeper too. The only exits are:
- an operator manually `DELETE /v1/sessions/:id`, or
- another orchestrator restart, which would hit H1/H2 and fail the session.

**Comparison to the fresh-run path.** `executeInBackground` has `runTimeoutMs` (`src/index.ts:159`, default 10 minutes) that bounds any in-flight run. `observeAdoptedSession` inherits none of that. The failure mode is rare (requires a Pi-side hang that doesn't emit an error) but it's real, and strategy:178's "observer-side run completion for in-flight turns" claim treats this as a first-class path.

**Severity.** MEDIUM. Aligned-but-untested per the brief's bar. Fix: wire a `setTimeout(handleFinal, runTimeoutMs, { ok: false, error: "observed turn timeout" })` into `observeAdoptedSession`, cleared on the real terminal event.

### M3. `queued_events` drain is not inside a transaction with the `runEvent` dispatch

**Evidence.** `src/index.ts:430-453`:

```
for (const sessionId of store.queue.listSessionsWithQueued()) {
  const session = store.sessions.get(sessionId);
  if (!session) { store.queue.clear(sessionId); continue; }
  if (session.status !== "idle") continue;
  const head = store.queue.shift(sessionId);
  if (!head) continue;
  try {
    await router.runEvent({ sessionId, content: head.content, model: head.model });
    drainedEvents += 1;
    startupQueueDrainedTotal.inc();
  } catch (err) {
    log.warn(
      { err, session_id: sessionId },
      "startup queue drain failed; leaving remaining events for next boot",
    );
  }
}
```

`store.queue.shift` in `src/store/sqlite.ts:732-743` deletes the row before `runEvent` runs. If the orchestrator crashes between `shift` and `runEvent.beginRun`, the event is lost — the commit message explicitly describes the durable queue as honoring *"commitments across restart"*, but this block violates that by removing the row before the commitment transfers to the `sessions.status=running` marker.

`router.runEvent` (not re-read in scope — out of scope) would need to atomically transition (`queue.shift` + `sessions.beginRun`) under one SQLite transaction to make this durable. Today the two writes are separate, so a narrow crash window drops the event.

**Severity.** MEDIUM. Low-probability race but it undermines the very invariant the commit banner (strategy:178 *"durable event queue"*) sells.

---

## LOW-severity findings

### L1. Stale pool comment references `cleanupOrphaned` as the restart-time cleaner

**Evidence.** `src/runtime/pool.ts:34-36`:

```
// The pool is in-memory only. On orchestrator restart the pool is empty;
// any containers that outlived the prior process are reaped at startup by
// DockerContainerRuntime.cleanupOrphaned(). See src/index.ts.
```

`cleanupOrphaned()` in `src/runtime/docker.ts:304-328` is explicitly flagged "NO LONGER CALLED on normal startup". Comment drift; read by the next person trying to understand the restart story will mislead them to believe there's a bulk reaper running.

**Severity.** LOW. Doc-only. Replace with a pointer to the adoption loop at `src/index.ts:336-404`.

### L2. HMAC-secret ordering is correct but not co-located with the post-restart reattach block

**Evidence.** `src/index.ts:273-281` loads the `parent_token_hmac_secret` BEFORE the router is constructed (`:294`) and BEFORE the adoption loop runs (`:341`). This ordering is correct — observer-side calls to `confirmTool` via operator-role WS would need the minter's secret for any subagent that posts back during observed finalization.

However the secret-load block is physically above the router construction and visually far from the adoption block. A reader auditing ordering has to scroll between `:273` and `:414` to verify the invariant. Worker 8's scope covers the secret itself; within this unit's scope, the observation is: the ordering is correct today but fragile. Moving the adoption loop above the router construction is not possible (adoption needs the pool + router), but a single block-comment banner like `// STEP 1: load durable state. STEP 2: construct router. STEP 3: adopt.` would make the invariant explicit.

**Severity.** LOW. Clarity-only.

---

## Design-level assessment — lens (2)

**"Adopt then re-subscribe" vs leader-election + state-machine.**

The one-orchestrator-per-tenant model is explicit at strategy:200-225. The doc §"What we deliberately give up" #2 (strategy:601-605) commits:

> 2. **HA / failover in the orchestrator.** Single-process. Pool, queue, WS clients all in-memory. Operators who need HA run us behind an external load balancer with session-stickiness OR run us on Kubernetes with sticky routing. We do not build a distributed orchestrator.

Given this commitment, "adopt then re-subscribe" is the correct design for the single-process-per-tenant case. Leader election (Zookeeper-style ephemeral node `https://zookeeper.apache.org/doc/current/recipes.html#sc_leaderElection`, etcd-style lease `https://etcd.io/docs/latest/learning/api/#lease-api`) would introduce:

- A dependency on external coordination state (one more box to deploy, one more credential to rotate).
- Split-brain failure modes during network partitions (two orchestrators both think they own the session → two WS clients → two `beginRun` calls → diverging JSONL writes by two containers).
- A container-fencing requirement (when the new leader adopts, the old leader's container must be provably dead; without STONITH-equivalent hardware fencing, this is hard on commodity Docker).

For a per-tenant deployment, the state-machine that matters is the **session state machine**, not the orchestrator replica-set state machine. Kubernetes StatefulSet's approach (`https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/`) — single replica, stable identity, controller reconciles existing pod state rather than racing to create a new one — is philosophically what our adoption loop is (correctly) trying to be. The H1 finding is that our implementation doesn't honor this on SIGTERM; the design itself is right.

**HA counter-argument considered.** If we ever wanted HA per tenant, the right shape is not replicated orchestrators — it's an orchestrator-plus-standby where the standby monitors the active's liveness via the container's gateway WS (the gateway is the source of truth for "is this session live anywhere"). Standby takes over only when the active is provably gone. But this is out of scope per strategy:601; we exit this lens with "the design is correct for the target deployment."

**Observer design adequacy.** `observeAdoptedSession` (router.ts:856-912) does the right thing by subscribing to WS BEFORE the JSONL fast-path check (see comment at `:871`: *"Subscribe BEFORE the fast-path check so an event that fires during the check still lands on us"*), with a `finalized` guard to prevent double-fire. That's solid. The only gap is M2 (missing timeout).

**Pi SessionManager.open() assumption.** The strategy cites Pi's `SessionManager.open()` rebuilding `AgentSession` from JSONL at strategy:158 and CLAUDE.md "Core invariants" #2. The adoption path assumes the container's Pi is still healthy with the session hydrated (since we're not restarting the container, just re-attaching WS). That assumption is correct as long as H1 is fixed — once the container outlives our orderly restart, its Pi session state is continuous. On the current SIGTERM-kills-containers behavior, on the rare SIGKILL path where containers do survive, the claim holds.

---

## Dual-lens summary

| # | Step in the 5-step restart flow | Status |
|---|---|---|
| 1 | `listManaged()` enumerates labelled containers | PASS (`src/runtime/docker.ts:247-294`) |
| 2 | Labelled containers with live sessions → `pool.adopt()` + WS handshake | PASS in isolation (`src/runtime/pool.ts:619-653`), BUT unreachable on SIGTERM (H1) |
| 3 | Orphans (no matching session row / not running) stopped | PASS (`src/index.ts:344-365`) |
| 4 | Running session without live container → `endRunFailure("orchestrator restarted mid-run")` | PASS but fires too often (H2) |
| 5 | `queued_events` drained post-adoption | PASS for idle-with-queue case (`src/index.ts:429-453`), race at shift-then-dispatch (M3) |
| 6 | `observeAdoptedSession` subscribes WS + JSONL fast-path | PASS (router.ts:856-912), missing timeout (M2) |
| 7 | Metrics `startup_adoptions_total`, `startup_queue_drained_total` | PASS (`src/metrics.ts:64-77`), emitted correctly (`src/index.ts:350/357/378/386/446`) |
| 8 | HMAC secret loaded at the right point in startup | PASS ordering (`src/index.ts:273-281` before `:294` router + `:341` adopt); Worker 8 owns secret itself |

**Design (lens 2) — PASS.** "Adopt then re-subscribe" is correct for the single-process-per-tenant shape we sell. The shutdown-policy inversion (H1) is an implementation bug on top of a correct design, not a design bug.

**Honest assessment.** The B4+B6 work landed the hard parts — durable queue, HMAC persistence, observer-side resume — and those pieces are architecturally right. The high-severity finding is that the final load-bearing piece of *"durable commitments across restart"* (the shutdown path) quietly inverts the invariant for the common case. Every other finding is secondary. Fix H1 first; H2 resolves with it. M2/M3 are worth doing before the strategy-doc language goes external. M1/L1/L2 can wait.

**Bar.** Against the brief's bar ("operator SIGKILLs orchestrator mid-turn and restarts — every running session resumes with zero data loss. Even on orderly SIGTERM."), the current code meets the SIGKILL half but not the SIGTERM half. That asymmetry is the whole finding.
