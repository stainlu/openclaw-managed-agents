# Architecture Review — 2026-04-20

First-principles review of OpenClaw Managed Agents after ~48 hours of
infrastructure operations against a Hetzner CAX11 + ClashX-proxied
laptop. The review is grounded in concrete pain (SSH workaround
accretion, deploy-script ordering bugs, IPv4/IPv6 dual-stack traps)
and an outside-in comparison against Anthropic's Claude Managed
Agents (CMA, launched 2026-04-08). It is not marketing. Citations
point at file paths and line numbers; where public sources are
relevant they are linked at the bottom.

---

## 1. What OpenClaw Managed Agents is today

A stateless Hono/TypeScript orchestrator that spawns one OpenClaw
container per session via dockerode on the host Docker daemon, then
reads OpenClaw's per-session JSONL event log at query time. The
`openclaw` npm package is pinned in `Dockerfile.runtime` and used
unmodified — no fork. Durable state lives in two places:

- **SQLite (`src/store/sqlite.ts`)** — agents, environments, sessions,
  vaults, audit log.
- **Pi JSONL on the host mount (`src/store/pi-jsonl.ts`)** — every
  event the agent container has ever emitted. Read at query time;
  never copied into SQLite. See the "events live in JSONL, not
  SQLite" invariant in `CLAUDE.md`.

Public API surface is four nouns — Agent, Environment, Session, Event
— exposed as a REST/SSE HTTP API on port 8080 and a React+Babel
portal at `/v2`. No control plane beyond the orchestrator process;
the subagent HMAC minter (`src/runtime/parent-token.ts`) lives in
that same process.

## 2. What Claude Managed Agents is, for comparison

Pure SaaS. All four primitives exposed on `api.anthropic.com` behind
the `anthropic-beta: managed-agents-2026-04-01` header. The engineering
post "Decoupling the Brain from the Hands" describes their internal
split:

- **Stateless harness** that drives the agent loop.
- **Sandbox fleet** provisioned on demand via `provision({resources})`.
- **Append-only event log** held durably outside the model's context.
- **Credential vault + MCP proxy** so secrets never enter the sandbox.
- **Per-org isolation**; no end-user primitive exposed.

Locked to Claude models; no BYO container image; no self-hosting
option; no on-prem. Pricing: Claude token rates + $0.08 per
session-hour of active runtime.

## 3. Where the two are structurally aligned

- **Same four nouns.** Agent / Environment / Session / Event. We and
  Anthropic independently converged. The shape is right.
- **Cattle-not-pets containers.** Both treat the sandbox as
  ephemeral; restart flips running sessions to `failed` on our side
  (`CLAUDE.md` → "Core invariants") and surfaces a tool-call error
  on theirs.
- **Durable event log decoupled from container lifetime.** Our
  JSONL-on-host, their server-side log. Same invariant.
- **Versioned agents, pinnable on the session.** Both support
  `agent.version` so a session stays deterministic against template
  churn.

The API shape, the state-split, and the isolation story are all
copy-able from CMA's public docs without having to rethink first
principles.

## 4. Where OpenClaw differs — and why that's the point

1. **BYO model.** `src/index.ts:collectPassthroughEnv()` forwards
   15+ provider keys. CMA is Claude-locked by design — it's their
   commercial moat. Our whole positioning ("open alternative")
   rests on this.
2. **BYO runtime backend.** `src/runtime/container.ts` is a real
   seam; `DockerContainerRuntime` is one implementation. CMA is
   hardcoded to Anthropic infra.
3. **Self-hostable.** We run on any VPS. CMA runs only on
   `api.anthropic.com`. Air-gap, data-sovereignty, and cost-control
   use cases categorically can't live on CMA.
4. **Network policy at the environment level.** Both support
   `networking: "limited"` with an allowed-host list; ours is
   enforced via Docker `--internal` network + egress-proxy sidecar
   (`docs/designs/networking-limited.md`), theirs via Anthropic's
   fleet. Our enforcement is operator-auditable; theirs is a black
   box.

## 5. Where OpenClaw falls short of "managed"

Honest list, ranked by user-visible impact:

1. **No horizontal scale.** One orchestrator per VM. The pool
   (`src/runtime/pool.ts`) is in-process; SQLite is single-writer;
   JSONL is per-file local. CMA's stateless-harness + shared-fleet
   is the right model to grow toward; we don't need it until a user
   does.
2. **Manual upgrades.** Kill container, `docker compose pull`,
   restart. Running sessions flip to `failed`. No
   image-digest-watcher, no rolling upgrade.
3. **No self-repair.** A crashed orchestrator stays down until a
   human restarts it. No process supervisor beyond what systemd +
   Docker default provide on the VM.
4. **Single-tenant per instance.** One bearer token, no RBAC, no
   per-user scoping. `CLAUDE.md` admits this by design — "stack a
   reverse proxy." Fine for MVP; a cap on scaling.
5. **Credential vault exists but the MCP proxy pattern doesn't.**
   CMA's vault sits between the sandbox and external APIs so the
   container never sees raw tokens. Our vault stores secrets
   correctly (`src/store/sqlite.ts` vault tables, AES-256-GCM), but
   they still flow into the session container as env vars. Real
   security gap we should close.
6. **No session archival.** We have DELETE; CMA has archive. Real
   ops difference — archived sessions are queryable evidence; we
   force the operator to choose between keeping forever and losing.

## 6. What "open, flexible, scalable" actually requires

### Open — mostly there

- ✅ BYO model (done, 15+ providers).
- ✅ BYO container image (Environment's package list + networking
  policy is the customization story).
- ⚠️ BYO backend (interface exists at `src/runtime/container.ts`;
  only Docker is implemented today — unproven until a second
  backend ships).

### Flexible — one concrete gap

- ⚠️ Storage layer is coupled to local filesystem. A deployment on
  Cloud Run / Fly / ECS can't use local SQLite or JSONL; it needs
  Postgres-equivalent + object storage. The code already separates
  stores behind interfaces; the work is writing one non-local
  backend, not re-architecting.
- ⚠️ Orchestrator is coupled to running AS a container with
  `/var/run/docker.sock` mounted. For a serverless backend, the
  "spawn container" action becomes an API call, not a socket write
  — which the `ContainerRuntime` interface already models, but the
  state layer assumes local FS.

### Scalable — the single real blocker

- ❌ One orchestrator per VM is the ceiling. Horizontal scale needs:
  shared state (Postgres + object store), session-to-instance
  routing, and either a distributed pool or stateless sandbox
  provisioning via a cloud backend (ECS / Cloud Run / Kubernetes).
  Four weeks of real work minimum.

**Stance for v0.x: we don't try to scale horizontally.** We say
clearly in docs: "one operator, one VM, scale by provisioning
bigger VMs or running separate instances sharded via reverse proxy."
If a user needs horizontal scale, they either buy CMA or pay us to
build Phase 2. Pretending otherwise is vaporware.

## 7. What we learned from the deploy-script archaeology (2026-04-20)

Concrete pain-driven lessons that shaped this review. Each one
surfaced today during a single deploy cycle:

1. **SSH-as-ops-UX is a trap.** The Hetzner script accreted three
   concentric SSH workarounds — `ssh.socket` override for port 222,
   `fail2ban` IP whitelist, IPv4/IPv6 dual-stack fix. Each
   introduced a new failure mode (systemd forward-ref, macOS `log`
   binary fallback, `IPV6_V6ONLY` socket flag). The right answer
   was never "add another layer"; it was "stop treating SSH as
   managed UX." Commit `5a24110` removed ~86 lines of cloud-init
   gunk. The surface area of what can fail at deploy time is now
   radically smaller.
2. **Don't forward-reference shell functions.** A deploy-script
   regression (`log` called before `log()` was defined)
   silently fell through to macOS `/usr/bin/log`, which printed
   help and exited 0, masking real destroy failures. Lesson inline
   at `scripts/deploy-hetzner.sh`'s old code comment.
3. **Nested heredocs are evil.** Three separate bugs this week:
   (a) leading whitespace preserved by an unquoted outer heredoc,
   (b) `\n` vs `\\n` escape handling, (c) placeholder-substitution
   sed dance. Solution: use `printf`. Matches the pattern in
   `scripts/deploy-aws-lightsail.sh` + `scripts/deploy-gcp-compute.sh`
   (which avoided this by using `printf` from day one).
4. **Client-side proxies can corrupt TCP.** ClashX in global mode
   routed Hetzner's IP through a degraded exit node that mangled
   the SSH banner exchange while HTTP stayed intact. Not a
   server-side issue we could fix. "Managed" means the operator
   interacts via HTTP API, full stop; proxies that rewrite specific
   TCP behaviors are outside our contract.
5. **ClashX / Surge / Tailscale / Cloudflare WARP leave stale
   routes in `netstat -rn` when the network changes.** An
   operator switching between WiFi networks on a proxied laptop
   may have host-specific routes pointing at a now-gone gateway,
   producing "Can't assign requested address" — a debugging
   rathole that has nothing to do with our product. Another vote
   for "SSH is break-glass only."

## 8. Phased plan

| Phase | Scope | Changes |
|---|---|---|
| **Done (2026-04-20)** | Single-VM, single-tenant, break-glass SSH | Cleanup commit `5a24110` |
| **v0.2** | Finish the open promises | Second `ContainerRuntime` backend (Fly Machines or Cloud Run — ~300 lines); Postgres + object-store state layer alongside SQLite+local; credential-vault MCP-proxy pipeline |
| **v0.3** | Self-managing single VM | Self-update via image-digest watcher; `/admin` diagnostics endpoints so SSH is actually unused (cloud-init log tail, container status, storage usage); optional Watchtower integration |
| **v1.0** | Distributed OR multi-tenant — pick one based on user pull | Stateless harness + distributed pool OR workspace primitive with RBAC; don't build both speculatively |

## 9. Core stance — what we are and are not

We are:
- A single-VM open runtime with CMA's API shape.
- Running any provider on any VPS.
- Shippable today on a $4/month Hetzner CAX11 with a single deploy
  command.
- Operator-owned: the operator holds the bearer token, the SQLite
  file, the JSONL logs, and the provider API key.

We are not (yet):
- Distributed.
- Multi-tenant in a managed sense — tenant sharding is delegated to
  a reverse proxy.
- Auto-scaled.
- Self-upgrading.
- A drop-in replacement for CMA at Anthropic's scale.

The product is honest about this. Docs should say it plainly.

## 10. Things that are not wrong — and we won't fix

Enumerating these explicitly so they don't end up in another
accidental-scope-creep cycle:

- **SQLite as the primary store.** Single-writer is fine for v0.x.
  Move to Postgres when v0.2's Fly/Cloud Run backend forces the
  issue, not before.
- **JSONL event log as the source of truth.** The alternative —
  copying events into SQLite — guarantees drift. Keep the
  invariant.
- **`/var/run/docker.sock` mount as the container-spawn
  primitive.** It's a security reality (compromised orchestrator =
  compromised host). The mitigation is "don't expose the
  orchestrator publicly without a bearer token + reverse proxy,"
  not "reinvent container spawn."
- **No TLS in the orchestrator.** Caddy / Traefik / Nginx is a
  better story than rolling TLS into the binary. Document the
  reverse-proxy pattern in the deploy README, don't build TLS.
- **Bearer-token single-tenancy.** Matches CMA's "auth is scoped
  to the API key" model. Fine at our scale. Multi-tenancy is a
  customer-request-driven feature, not a "should we" feature.

---

## Sources

Outside-in research that fed section 2:

- Anthropic engineering: "Scaling Managed Agents: Decoupling the
  Brain from the Hands" — https://www.anthropic.com/engineering/managed-agents
- Claude Platform docs:
  - https://platform.claude.com/docs/en/managed-agents/overview
  - https://platform.claude.com/docs/en/managed-agents/sessions
  - https://platform.claude.com/docs/en/managed-agents/environments
  - https://platform.claude.com/docs/en/managed-agents/tools
- Pricing blog: https://claude.com/blog/claude-managed-agents
