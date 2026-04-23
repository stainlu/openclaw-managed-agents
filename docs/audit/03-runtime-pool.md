# Audit 03 — Runtime pool (`SessionContainerPool`)

> Historical audit snapshot. Findings in this file were accurate at the time of the audit, but later commits may have fixed some or all of them. Treat this as a point-in-time review, not the current architecture contract.

Worker 3/16. Files in scope (no scope leak):

- `/Users/stainlu/claude-project/openclaw-managed-agents/src/runtime/pool.ts`
- `/Users/stainlu/claude-project/openclaw-managed-agents/src/runtime/pool.test.ts`

Strategy sources: `docs/strategy.md` (the brain/hands/session decoupling invariant, §"Why 'just integrate openclaw directly' isn't an option", §"What we deliberately give up", §"Open questions" on `networking:limited` re-land), `CLAUDE.md` §"Core invariants" and §"Warm-pool exception", `docs/designs/networking-limited.md` (referenced in README). Cross-reference to Anthropic's [Scaling Managed Agents](https://www.anthropic.com/engineering/managed-agents) for the warm-pool p50 TTFT rationale (the -60% / -90% figures strategy cites at `docs/strategy.md:15`).

---

## Scope

The pool is claimed as "the core" of the managed-runtime layer. It owns:

1. Two in-memory maps — `active` keyed by `sessionId`, `warm` keyed by `agentId`.
2. The `acquireForSession` 3-source cascade (active → warm → fresh spawn).
3. `adopt()` for startup reattach (`src/index.ts` calls it when `DockerContainerRuntime.listManaged()` finds pre-existing labelled containers).
4. Idle sweeper — reaps active past `idleTimeoutMs` (skipping `isBusy`), warm past `warmIdleTimeoutMs`.
5. `limitedNetworking` per-session confined topology — per-session `--internal` network + egress-proxy sidecar + per-session egress network. Owned resources tracked on `ActiveContainer.ownedResources` for deterministic teardown on `evictSession`, `reapIdle`, `shutdown`.
6. Metrics: `pool_active_containers`, `pool_warm_containers`, `pool_acquire_total{source}`, `pool_spawn_duration_seconds`.

The pool is the seam between the runtime layer (Docker, future ECS/K8s/Cloud Run via `ContainerRuntime`) and the orchestrator layer. `isBusy` and `cleanupOnReap` are callbacks, not dependencies — `pool.ts` does not import anything from `src/store/` or `src/orchestrator/`. Matches CLAUDE.md §"Things to avoid".

---

## Claim-by-claim table

| # | Claim (from strategy / CLAUDE.md) | Code match? | Right aim? | Evidence | Severity |
|---|---|---|---|---|---|
| 1 | Dual pool: active (per-session) + warm (per-agent) | Yes | Yes | `pool.ts:136-140` — two `Map`s; `warm` keyed by agentId. `WarmContainer` type carries `spawnOptions` so replenish can rebuild. | — |
| 2 | `acquireForSession` checks in order: active → warm → fresh. Metric labelled per source. | Partial | **MEDIUM** | `pool.ts:219-278` — cascade is correct. Metric labels are `active` / `warm` / `spawn` / `adopt` (`pool.ts:222,252,323,542,648`). Strategy brief asks for `fresh` but code emits `spawn`. Name is fine (and `adopt` is a 4th source not listed in brief) — label set is consistent with itself. Nit: limited-spawn is also `source="spawn"` so the counter cannot distinguish unrestricted-cold from limited-cold without adding another label. Untested: no test asserts the metric increments per source. | MEDIUM (aligned-but-untested for metric; LOW for the `fresh`/`spawn` rename) |
| 3 | `adopt({sessionId, container})` repopulates active without spawning | Yes | Yes | `pool.ts:619-653` — runs `waitForReady` + WS handshake only, no `runtime.spawn`. Test `pool.test.ts:155-172` asserts `runtime.calls.map(c.kind) === ["waitForReady"]`, no spawn. Emits `source="adopt"` (`pool.ts:648`). | — |
| 4 | `cleanupOnReap` fires **only** from idle-sweep, not end-of-turn or manual evict | Yes | Yes | Only call site is `pool.ts:746-755` inside `reapIdle`. `evictSession` (`pool.ts:581-609`) and `shutdown` (`pool.ts:668-699`) never invoke it. Test `pool.test.ts:378-395` confirms idle-path invocation; no test confirms manual-path NON-invocation. | LOW (aligned-but-untested — negative assertion missing) |
| 5 | Warm container NEVER reused for delegating agents | Partial | **HIGH** | The gate lives in `router.ts:262-264` on the **creation** side only: `warmForAgent` returns early if `agent.callableAgents.length > 0 || agent.maxSubagentDepth > 0`. There is NO gate on the **claim** side inside `pool.acquireForSession`. If a warm container was ever created for an agent (e.g., template was non-delegating when warmed, then edited to add `callableAgents`), the pool will happily hand it to a delegating session that will then mint subagent tokens referencing the warm placeholder sessionId. See root cause + fix below. | **HIGH** |
| 6 | `limitedNetworking` path spawns via `doLimitedSpawn` with owned resources tracked on ActiveContainer | Yes | Yes | `pool.ts:229-235` forks to `doLimitedSpawn` when `networking.type === "limited"`. Warm path explicitly skipped (`pool.ts:227-228` comment + `pool.test.ts:647-666` asserts warm container for same agentId is NOT claimed). `ownedResources` populated `pool.ts:536-540`; `evictSession` teardown `pool.ts:595-608`; `reapIdle` teardown `pool.ts:729-742`; `shutdown` teardown `pool.ts:684-698`. | — |
| 7 | Fail-open check: "limited configured but doLimitedSpawn skipped" | No fail-open | Yes | If `networking.type === "limited"` but `cfg.limitedNetworking` unset, `doLimitedSpawn` throws with a direct message (`pool.ts:358-363`). No silent fallback to `doSpawn`. Test `pool.test.ts:599-611` pins this behavior. Matches strategy's §"Don't put hot paths behind a fallback" and CLAUDE.md §"Networking policies" ("Accepting `limited` without actually enforcing would be false security"). | — |
| 8 | Unref'd sweeper reaps idle; cadence configurable | Yes | Yes | `pool.ts:146-154` — `setInterval` with `cfg.sweepIntervalMs`, `unref()` so the process can exit. Configurable per-pool. Tests disable the timer by setting `sweepIntervalMs` to 10 min and calling `reapIdle()` directly (`pool.test.ts:144`). | — |
| 9 | `pool_acquire_total{source=...}` metric emitted | Yes | Yes | `src/metrics.ts:57-62` defines the counter. All four emit sites listed above. | — |
| 10 | Replenish warm slot on claim | Yes | Yes | `pool.ts:258-260` — claim kicks off a background `warmForAgent` for the same agentId + spawnOptions. Test `pool.test.ts:254-273` asserts the replenish spawn lands within one event-loop tick. | — |
| 11 | Warm cap + oldest-first eviction | Yes | Yes | `pool.ts:168-171, 776-783` — `evictOldestWarmIfAtCap` runs before every warm-add; picks by smallest `spawnedAt`. Test `pool.test.ts:286-297`. | — |
| 12 | Pending-dedup: two concurrent acquires for same session share one spawn | Yes | Yes | `pool.ts:268-277` — `this.pending` map; second concurrent caller awaits the first's promise. Test `pool.test.ts:242-252`. | — |
| 13 | Limited-spawn rollback: if any step fails, every resource created so far is torn down | Yes | Yes | `pool.ts:395-417` — `rollback` closure tracks created networks/containers/WS. Test `pool.test.ts:576-597` asserts stop(sidecar) + 2× removeNetwork on ready-timeout. | — |
| 14 | Adopt rejects second-adopt on already-active session | Yes | Yes | `pool.ts:620-624` throws. Test `pool.test.ts:174-192`. | — |
| 15 | Adopt propagates readyz failure WITHOUT stopping the container (caller decides) | Yes | Yes | `pool.ts:625` awaits `waitForReady`; no wrapping try/catch that calls stop. Test `pool.test.ts:194-210` confirms `runtime.calls.some(c.kind === "stop") === false`. Matches adopt-on-restart semantics in `src/index.ts` which logs + stops the orphan itself. | — |

---

## Strategy critique (where strategy.md is wrong or silent)

1. **Strategy treats warm pool as a latency win; `CLAUDE.md` "Warm-pool exception" is load-bearing correctness.** `docs/strategy.md:15,327` cites Anthropic's -60% p50 / -90% p95 TTFT. Anthropic's warm pool is purely a latency play. **Ours isn't:** sessionId bakes into Docker env + labels at spawn (`router.ts:648-656, 232-239`), so warm containers carry a *placeholder* until claim. Non-delegating: harmless. Delegating: placeholder leaks into `parentSessionId` of minted subagent tokens — wrong lineage, silent. Strategy never mentions this; only `CLAUDE.md` §"Warm-pool exception" does. Code today enforces at creation only — see HIGH #1. **Recommendation: mention in strategy §"Deployment model" that the gate is correctness, not perf, and must mirror at claim.**

2. **Strategy says `networking:limited` is shipped (`docs/strategy.md:397, 624`).** Topology matches. The pool-side footgun: `sidecarConfinedIp` fallback at `pool.ts:479-487`. If a runtime fails to populate `container.networks[confinedNet]`, the pool falls back to a hostname. Docker's `HostConfig.Dns` accepts only IPs — a hostname silently becomes empty, and the agent falls back to Docker's embedded resolver, resolving public names the sidecar would deny. The comment acknowledges this is a "smoke-test fallback for FakeRuntime." Production DockerContainerRuntime always populates the IP, so the fallback never triggers today. **But the fallback exists** — that's exactly the CLAUDE.md §"Things to avoid — Don't put hot paths behind a fallback" pattern. See HIGH #2.

3. **Strategy says one-orchestrator-per-tenant (`docs/strategy.md:204-214`).** Pool has zero tenant awareness. Correct. Flagged only to preempt any future "add tenancy to pool" suggestion — would violate CLAUDE.md §"What we deliberately give up §1".

4. **Strategy §"Why we exist #4" cites restart safety as load-bearing.** `adopt()` runs `waitForReady` + WS handshake before registering. Good. But: `adopt()` takes no `ownedResources`. For a limited-networking session that was mid-run at restart, the pool registers only the agent container; the sidecar and per-session networks become uncoupled. Next `evictSession` or `reapIdle` stops only the agent; sidecar + networks orphan until next-next restart's cleanup. See Confirmed gap #3.

5. **Strategy §MIT neutrality (`docs/strategy.md:101`).** `ContainerRuntime` seam is clean; pool uses it exclusively. Design holds.

---

## Missing in strategy

- **No warm-pool sizing guidance.** At 2 agent templates and 2 GiB/container, `maxWarmContainers=3` works. At 50 templates (realistic OEM deploy) the cap makes warm pool useless. Warm-pool value is inversely proportional to template diversity — strategy should say so.
- **No "warm pool disabled" deploy knob.** On a Hetzner CAX11 (4 GiB RAM, strategy's flagship at `docs/strategy.md:62`), one warm container eats 50% RAM. `maxWarmContainers=0` is a reasonable choice; code handles it, strategy implies warm is always on.
- **No mention of `evictSession`'s role in the unhealthy-container feedback loop.** CLAUDE.md notes router calls evict after a failed run; strategy doesn't describe this. Without it, broken containers hold their slot until the sweeper catches them.

---

## Production-readiness risks

1. **Sweeper/idle ratio is unenforced.** `pool.ts:43` recommends `sweepIntervalMs < idleTimeoutMs / 2` but constructor doesn't assert. Misconfigure → containers live 2× their declared timeout. One-line assertion. LOW.
2. **`snapshot()` hides warm containers (`pool.ts:656-662`).** Gauges still expose count, but any structured listing of pool state is missing 2 GiB/entry of RAM. LOW observability gap.
3. **`shutdown` swallows failures (`pool.ts:678-698`).** `Promise.allSettled` results discarded. If a network remove fails at shutdown, Docker orphans it silently until the next `cleanupOrphaned`. Should log per-failure. MEDIUM — observability, not correctness.
4. **`doLimitedSpawn` trusts `runtime.spawn` to atomically connect `additionalNetworks`.** `pool.ts:430-461` — if Docker create succeeds but the egress connect fails, sidecar is confined-only and all allowed egress blackholes. Pool has no ordering check. Should be verified in the Unit 4 audit of `src/runtime/docker.ts`.

---

## Confirmed gaps

### HIGH — Warm-pool delegating-agent gate is creation-only; the claim side is unguarded

**Root cause.** The invariant "warm containers never serve delegating sessions" is implemented in `src/orchestrator/router.ts:259-270`:

```ts
async warmForAgent(agentId: string): Promise<void> {
  const agent = this.agents.get(agentId);
  if (!agent) return;
  if (agent.callableAgents.length > 0 || agent.maxSubagentDepth > 0) {
    return;                            // <-- creation-side gate
  }
  const spawnOptions = this.buildSpawnOptions("__warm__", agent, ...);
  await this.pool.warmForAgent(agentId, spawnOptions);
}
```

The pool's `acquireForSession` checks the warm map by `agentId` ONLY — `pool.ts:238-262`:

```ts
if (args.agentId) {
  const warmEntry = this.warm.get(args.agentId);
  if (warmEntry) {
    // ... claim it and register as active ...
  }
}
```

The invariant holds IFF the agent template's `callableAgents` and `maxSubagentDepth` are static from the moment `warmForAgent` was called to the moment the warm container is claimed. But agent templates are mutable via `PATCH /v1/agents/:id` (see `src/orchestrator/server.ts` agent-versioning code — out of scope here, but the update endpoint exists). Sequence:

1. Template `agt_x` created with `callableAgents: []`. `warmForAgent("agt_x")` creates a warm container with sessionId `__warm__`.
2. Operator PATCHes the template, setting `callableAgents: ["agt_y"]`.
3. New session on `agt_x` acquires via the warm path. The warm container's signed `OPENCLAW_ORCHESTRATOR_TOKEN` still references `__warm__` as parentSessionId (env is immutable post-create).
4. Agent calls `openclaw-call-agent` to delegate; the CLI sends `X-OpenClaw-Parent-Token` with `parentSessionId: "__warm__"`. The orchestrator's token verifier accepts it (HMAC valid), the new subagent is created as a child of `__warm__` which doesn't exist as a real session.

Net effect: subagent lineage is wrong silently. CLAUDE.md §"Warm-pool exception" specifically says *"the failure would be silent (wrong lineage, not a crash)"* — that warning is about `warmForAgent` creation, but the same silent failure can happen via template mutation after warming.

**Also:** the pool has no way for an operator to know "does this warmed container predate the template's current revision?" There's no template revision on `WarmContainer`.

**Fix owner:** pool + router. Simplest robust fix is in the pool: accept an opt-in `allowWarmClaim: boolean` per agent (default true) and mirror the router's gate in `acquireForSession`. Slightly less coupled: the router passes `allowWarmClaim` computed from the current agent template on every `acquireForSession` call. Either way, the defensive check belongs on the claim side so template mutation between warm and claim is caught.

**Why HIGH.** Strategy §"Why we exist #4" sells restart-safety and invariant correctness as our structural advantage over raw openclaw (`docs/strategy.md:176-180`). Silently corrupting subagent lineage directly violates that claim and the CLAUDE.md prohibition. "False security" in CLAUDE.md language.

### HIGH — `sidecarConfinedIp` name fallback silently breaks DNS confinement when the runtime's network inspect is incomplete

**Root cause.** `pool.ts:479-487`:

```ts
const sidecarConfinedIp =
  sidecar.networks?.[confinedNet] ??
  // Fallback: use the sidecar name. ...
  sidecarName;
```

Then `pool.ts:502`:

```ts
const agent = await this.runtime.spawn({
  ...
  dns: [sidecarConfinedIp],
});
```

Docker's `HostConfig.Dns` expects IPv4/IPv6 addresses. A hostname is NOT accepted — dockerd will either reject the Create call or silently drop the entry from `/etc/resolv.conf`. In the drop case, the agent uses Docker's embedded resolver, which resolves any public DNS name. Combined with the `--internal` network topology, name lookups succeed but connection attempts fail — UNLESS the agent has another code path that uses HTTP_PROXY, in which case the proxy is asked to CONNECT a newly-resolved public IP that the proxy won't allowlist-match (allowlist is hostname-based).

Concretely: the failure mode is "DNS filter disabled." That's the opposite of the advertised confinement.

Strategy §"Networking policies" in CLAUDE.md says: *"Accepting limited without actually enforcing would be false security."* This fallback is exactly that — it accepts the limited spec and silently drops one layer of enforcement.

In production today, `DockerContainerRuntime.spawn` always inspects and populates `container.networks[confinedNet]`, so the fallback never triggers. **The risk is not current; the risk is that the fallback exists at all.** A future `ContainerRuntime` backend (ECS, Cloud Run, the whole point of the seam per strategy `docs/strategy.md:484-489`) may return a container without an IP map populated yet. The pool should either:

- refuse to proceed (throw with a clear error: "runtime did not populate sidecar IP on confined network; limited-networking requires IP-level DNS"), or
- re-query the runtime for the IP with a bounded retry.

**Not:** fall back to a hostname that the daemon won't honor.

**Fix owner:** pool. Delete the fallback; throw with a pointer to the ContainerRuntime contract requirement.

**Why HIGH.** MIT-neutral + OEM-pluggable is the Android-path thesis (`docs/strategy.md:101-110`). A backend that silently degrades confinement when plugged in is worse than one that fails loud. This is exactly the "production-ready, elegant and scalable, even when prototyping" bar CLAUDE.md pins.

### MEDIUM — `adopt()` cannot re-attach limited-networking owned resources

**Root cause.** `pool.ts:619-653` accepts `{sessionId, container}` only. For unrestricted sessions this is complete. For limited-networking sessions, the ownedResources (sidecar container id, confined+egress network names) are not recoverable from the adopted agent container alone. On restart, `src/index.ts` reconstructs active entries from `DockerContainerRuntime.listManaged()` — it finds the agent container by its labels, but the pool registers it with `ownedResources: undefined`. Next `evictSession` or `reapIdle` stops only the agent; the sidecar + per-session networks are orphaned until `DockerContainerRuntime.cleanupOrphaned()` sweeps them on the *next* restart.

**Fix owner:** pool + `DockerContainerRuntime.listManaged()` + `src/index.ts`. `listManaged` should return the sidecar-container triple (agent + sidecar + networks) as a group keyed by session; `adopt` should accept the owned-resource struct; index.ts wires them up.

**Why MEDIUM.** Self-healing on next restart via cleanup-orphan; no data loss. But it violates the owned-resources invariant and burns RAM + network slots between restarts.

### MEDIUM — Metric label `source` collapses unrestricted-spawn and limited-spawn

**Root cause.** Both `doSpawn` (`pool.ts:323`) and `doLimitedSpawn` (`pool.ts:542`) emit `poolAcquireTotal.labels({source: "spawn"}).inc()`. Operators cannot distinguish unrestricted-cold-spawn rate from limited-cold-spawn rate — which matters because limited spawn is 2× the container count + 2 networks, so it drives disk/net resource utilization differently.

**Fix owner:** pool. Add a second label dimension (e.g., `networking="unrestricted"|"limited"`). Minor, non-breaking for existing alerts.

**Why MEDIUM.** Observability gap. Aligned-but-untested for the metric shape.

### LOW — Sweeper interval/timeout relationship unenforced

**Root cause.** `PoolConfig.sweepIntervalMs` comment at `pool.ts:43` recommends `< idleTimeoutMs / 2`; constructor does not assert. Silent effective-timeout extension on misconfigure.

**Fix owner:** pool. One-line assertion in constructor.

### LOW — `shutdown()` swallows failures without logging

**Root cause.** `pool.ts:678-698` — `Promise.allSettled` results discarded.

**Fix owner:** pool. Iterate and log per-failure.

### LOW — `snapshot()` omits warm entries

**Root cause.** `pool.ts:656-662` — returns only `active`.

**Fix owner:** pool. Add a separate `warmSnapshot()` or include warm entries with a discriminator.

### LOW — No test for negative-assertion of `cleanupOnReap` on manual paths

**Root cause.** Tests cover idle-reap invocation (`pool.test.ts:378-395`). No test covers "manual evictSession does not call cleanupOnReap". Contract is one-way in prose only.

**Fix owner:** pool.test.ts. One test adds a spy and calls `evictSession` + `shutdown`; asserts spy not called.

---

## Trivial fixes applied (<=30 LOC)

None. Every finding above has non-obvious owner-boundary implications (router vs pool for the warm-claim gate; runtime backend contract for the IP fallback; index.ts wiring for limited-adopt). All are "confirmed gap, not trivial" — they deserve discussion before code changes, per CLAUDE.md's "favor discussion over code modification."

---

## Follow-up

1. **Open a design-doc ticket for the warm-claim gate.** Options: (a) pool takes a per-call `allowWarmClaim` bool from the router, (b) pool holds an opaque "template revision" per warm entry and router invalidates via a `purgeWarmForAgent(agentId)` call on PATCH, (c) warm entries encode `callableAgents.length + maxSubagentDepth` at creation time and refuse to serve if the current template diverges. (b) is cleanest but adds orchestrator→pool coupling. (a) is smallest code change.

2. **Decide whether to keep the `sidecarConfinedIp` hostname fallback.** The comment at `pool.ts:483-487` says it's a smoke-test affordance for FakeRuntime. FakeRuntime could instead return a synthesized IP (which it already does — `pool.test.ts:75-81`). Delete the fallback, tighten the contract. Any future ContainerRuntime backend that can't report IPs post-spawn should fail-fast when asked for limited networking.

3. **Propagate limited-networking owned resources through adopt.** Requires changes in `src/runtime/docker.ts::listManaged` (out of scope here), pool.adopt (in scope), src/index.ts (out of scope here). Worth batching with Unit 4 / Unit 2 audits.

4. **Document the per-tenant deployment contract next to `PoolConfig`.** A one-paragraph header saying "one pool per orchestrator; one orchestrator per tenant" would prevent the recurring question of "why isn't there tenantId on acquireForSession". Strategy says it at `docs/strategy.md:204-214`; the pool module should echo it.

5. **Add `maxWarmContainers=0` to test coverage.** Operator option implied by the code but never exercised.

---

## Philosophy-check (strategy `docs/strategy.md:565` — "We keep Pi's primitives + the production wrapper OpenClaw wrote")

The pool adheres to this. It does not reach into Pi's JSONL format (that's `PiJsonlEventReader`'s job), does not re-implement OpenClaw's gateway protocol (`GatewayWebSocketClient` is the only dependency), and its only coupling to the orchestrator layer is via two callbacks. The three-layer decoupling Anthropic documents (`docs/strategy.md:15`) is structurally visible here: Pi = session format + SessionManager (untouched), OpenClaw = gateway + plugin SDK (invoked through `Container`), us = pool + adopt + cleanup. **Conceptual aim is right.** The HIGH findings above are implementation-level failures to hold the line on that aim, not aim-level problems.

Production-readiness today: on the unrestricted path, solid. On the limited path, the DNS fallback is a live correctness hole waiting for its first non-Docker backend. On the warm path, a template-mutation race silently corrupts subagent lineage. Both are patchable in ~50 LOC each with the right decisions. The architecture is not re-thought; the guards are incomplete.
