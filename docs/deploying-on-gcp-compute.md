# Deploying on Google Cloud Compute Engine

Run the OpenClaw Managed Agents on a Google Cloud Compute Engine instance for **$0-$25/month** — GCE's fixed-price VM family, the closest GCP match to AWS Lightsail and Hetzner Cloud. One command, about 4-5 minutes end-to-end from zero.

It uses the same `DockerContainerRuntime` the Hetzner and Lightsail paths use, so the runtime behavior is identical — you're only switching the underlying VM provider. If you already know `scripts/deploy-aws-lightsail.sh`, this script is a one-for-one mirror with `gcloud compute` replacing the AWS CLI.

## What you'll get

| Property | Default (`e2-medium`) | Cheapest credible (`e2-small`) | Free tier (`e2-micro`) |
|---|---|---|---|
| Product | GCE Compute Engine (general-purpose E2) | Same | Same |
| vCPU / RAM / PD | 1 burstable / 4 GB / 20 GB balanced | 0.5 burstable / 2 GB / 20 GB balanced | 0.25 burstable / 1 GB / 30 GB balanced (free-tier cap) |
| Egress included | 200 GB/month (general; within NA/EU) | Same | 1 GB/month |
| Image | Ubuntu 24.04 LTS (`ubuntu-2404-lts-amd64`) | Same | Same |
| IP addressing | Public IPv4 + internal IPv6 | Same | Same |
| Monthly price (April 2026) | **~$25/month** | **~$13/month** | **$0/month** in us-east1, us-central1, us-west1 (1 instance + 30 GB PD + 1 GB egress) |
| Concurrent agent capacity | ~5-7 sessions | ~2-4 sessions | 1 test session (RAM is tight) |

**Why `e2-medium` as the default.** It matches the Hetzner CAX11 and Lightsail `medium_3_0` specs (approximately 1-2 vCPU / 4 GB / 20 GB) so the capacity math carries across. GCE's E2 machine family uses a burstable CPU model similar to Lightsail's, but runs on faster NVMe-backed PD-balanced disk — first-turn cold spawn lands around the Hetzner bar (~80 s), not the Lightsail bar (~5 min).

**Why consider the free tier (`e2-micro`).** Google Cloud's Always Free tier covers 1× `e2-micro` per month in us-east1, us-central1, or us-west1 — you pay $0 as long as you stay in one of those three regions and don't exceed 30 GB of Persistent Disk or 1 GB egress/month. 1 GB RAM is tight for running an agent container alongside the orchestrator; expect noticeable swapping under load. Good for smoke testing, not production.

**Why GCE and not Cloud Run.** Cloud Run is serverless and scale-to-zero, with a very different pricing shape ($0.024/vCPU-hour + $0.0025/GB-hour active only). We evaluated it as a core backend and rejected it in [docs/cloud-backends.md](./cloud-backends.md) — Cloud Run's 10-second SIGTERM-to-SIGKILL window + no first-class "one container instance per logical entity" primitive force a shared-workspace pattern that diverges from our local/VPS backends. Use GCE Compute Engine if you want the same runtime shape as Hetzner/Lightsail; revisit Cloud Run as a partnership integration if Google DevRel specifically asks for it.

## Prerequisites

1. **Google Cloud account.** Sign up at [console.cloud.google.com](https://console.cloud.google.com). New accounts get $300 in free credits for 90 days + the Always Free tier forever. Billing account is required even for the free tier.

2. **A GCP project.** Projects are the top-level billing + API container in GCP. Create one in the [Cloud Console](https://console.cloud.google.com/projectcreate) or via CLI:
   ```bash
   gcloud projects create openclaw-runtime --name="OpenClaw Runtime"
   gcloud config set project openclaw-runtime
   ```
   Link a billing account in the Cloud Console → Billing tab if the project isn't already linked; otherwise `gcloud compute instances create` fails with a billing-not-enabled error.

3. **gcloud CLI installed locally.**
   ```bash
   brew install --cask google-cloud-sdk    # macOS
   # or: curl https://sdk.cloud.google.com | bash && exec -l $SHELL
   # or: see https://cloud.google.com/sdk/docs/install for other platforms
   gcloud version                            # should print something like "Google Cloud SDK 470.x.x"
   ```

4. **Authenticate + pick a project.**
   ```bash
   gcloud auth login                                    # opens a browser for OAuth
   gcloud config set project <your-project-id>          # e.g. openclaw-runtime
   gcloud config get-value project                      # verify
   ```

5. **Enable the Compute Engine API.** First-time projects have it disabled; the deploy script's preflight catches this and prints the enable command, but you can do it ahead of time:
   ```bash
   gcloud services enable compute.googleapis.com
   # Takes ~30 seconds. Re-running is a no-op if already enabled.
   ```

6. **At least one provider API key** for an LLM OpenClaw supports:
   ```bash
   export MOONSHOT_API_KEY=sk-...   # default, cheapest non-Anthropic path
   # or: export ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, etc.
   ```

7. **SSH key.** The script uses your default SSH public key (`~/.ssh/id_ed25519.pub` or `~/.ssh/id_rsa.pub`, first match wins) and injects it into the instance's `ssh-keys` metadata + writes it directly into the target user's `authorized_keys`. If you don't have one, run `ssh-keygen -t ed25519` first. **You don't need to manage GCP OS Login or upload the key to project-wide metadata** — the key is scoped to this single instance.

## Quick deploy

```bash
cd openclaw-managed-agents

# One-command deploy. Idempotent — re-running reuses the existing instance.
./scripts/deploy-gcp-compute.sh

# Optional flags (environment variables):
#   GCE_INSTANCE_NAME=openclaw-managed-agents   # default; change to run multiple deploys
#   GCE_REGION=us-central1                       # us-central1 | us-east1 | us-west1 | europe-west1 | asia-northeast1 | ...
#   GCE_ZONE=us-central1-a                       # must match region (region + a/b/c)
#   GCE_MACHINE_TYPE=e2-medium                   # e2-micro ($0 free tier) | e2-small ($13/mo) | e2-medium ($25/mo default) | e2-standard-2 ($49/mo)
#   GCE_DISK_SIZE_GB=20                          # boot disk size (min 10; free tier covers up to 30 GB)
#   OPENCLAW_DEPLOY_BRANCH=main                  # git branch to clone on the instance
```

Expected output (timings on a fresh run, `us-central1-a`, `e2-medium`):

```
==> Checking prerequisites
    gcloud CLI:        ok (Google Cloud SDK 470.0.0)
    gcloud account:    you@example.com
    gcloud project:    openclaw-runtime
    Region:            us-central1
    Zone:              us-central1-a
    Compute API:       enabled
    SSH public key:    /Users/stainlu/.ssh/id_ed25519.pub
    Provider key:      MOONSHOT_API_KEY
    Test model:        moonshot/kimi-k2.5
    Machine type:      e2-medium
    Image:             ubuntu-2404-lts-amd64 (ubuntu-os-cloud)
    Boot disk:         20 GB
==> Rendering startup-script (pure shell)
==> Provisioning e2-medium instance in us-central1-a (openclaw-managed-agents)
    IPv4:              34.123.45.67
==> Opening port 8080 (firewall rule: openclaw-managed-agents-allow-orchestrator)
    firewall rule:     created.
==> Waiting for startup-script to install Docker + bring up the stack (~3 min)
    [+ 15 s] waiting for http://34.123.45.67:8080/healthz
    [+ 90 s] waiting for http://34.123.45.67:8080/healthz
    [+150 s] waiting for http://34.123.45.67:8080/healthz
==> Deploy complete
    Orchestrator:      http://34.123.45.67:8080
    Monthly cost:      ~$25 (e2-medium: 1 vCPU burstable / 4 GB / 20 GB PD) — matches Hetzner CAX11 + Lightsail medium_3_0
                       Override GCE_MACHINE_TYPE=e2-small for ~$13/mo (2 GB), or e2-micro for free-tier eligibility
    Destroy with:      ./scripts/deploy-gcp-compute.sh --destroy
    SSH:               gcloud compute ssh ubuntu@openclaw-managed-agents --zone us-central1-a
                       # or directly: ssh ubuntu@34.123.45.67
    Tail bootstrap:    gcloud compute ssh ubuntu@openclaw-managed-agents --zone us-central1-a --command 'sudo tail -f /var/log/openclaw-bootstrap.log'
```

## Validating the deploy

Point the existing e2e suite at the public endpoint:

```bash
export OPENCLAW_ORCHESTRATOR_URL=http://34.123.45.67:8080
./test/e2e.sh
```

Or a minimal smoke test:

```bash
ORCH=http://34.123.45.67:8080

# 1. Health check
curl -s $ORCH/healthz
# {"ok":true,"version":"0.1.0-dev"}

# 2. Create an agent template
AGENT=$(curl -s -X POST $ORCH/v1/agents -H 'Content-Type: application/json' \
  -d '{"model":"moonshot/kimi-k2.5","tools":[],"instructions":"One-sentence answers."}' \
  | jq -r '.agent_id')

# 3. Open a session
SESSION=$(curl -s -X POST $ORCH/v1/sessions -H 'Content-Type: application/json' \
  -d "{\"agentId\":\"$AGENT\"}" | jq -r '.session_id')

# 4. Post a user message
curl -s -X POST "$ORCH/v1/sessions/$SESSION/events" \
  -H 'Content-Type: application/json' \
  -d '{"content":"In one sentence, what is 2+2?"}'

# 5. Wait and read the reply
while [ "$(curl -s $ORCH/v1/sessions/$SESSION | jq -r .status)" = "running" ]; do sleep 2; done
curl -s "$ORCH/v1/sessions/$SESSION/events" \
  | jq -r '[.events[]|select(.type=="agent.message")]|last|.content'
```

## Routine redeploy

For later updates on an existing instance, use:

```bash
ssh ubuntu@<ip> "sudo bash -lc 'cd /opt/openclaw && git pull && docker compose pull && docker pull ghcr.io/stainlu/openclaw-managed-agents-egress-proxy:latest && docker compose up -d'"
```

The explicit `docker pull` is load-bearing because the `egress-proxy` sidecar is not a compose-managed service.

## Cost breakdown

The GCE instance cost is fixed (actually per-second billed but effectively a monthly rate for always-on workloads). What scales is the LLM token cost, which is billed directly by your provider.

| Cost component | Amount (`e2-medium`) | Amount (`e2-micro`, free tier) |
|---|---|---|
| Compute (1 instance share across ~5 concurrent sessions) | ~$5/month allocated | $0 |
| Boot disk (20 GB pd-balanced) | ~$2.00/month | ~$1.20/month (30 GB cap, PD in free tier) |
| Egress (within 200 GB/mo) | $0 | $0 (1 GB cap) |
| Moonshot Kimi K2.5 tokens (~10k in, ~500 out per turn) | ~$0.005/turn | ~$0.005/turn |
| Licensing | $0 (Ubuntu LTS) | $0 |

For an idle-heavy chat session (5 minutes of active turn time per hour, 10 sessions per day), the GCE-attributable compute cost per session on `e2-medium` is well under **$0.01**. Compared to Claude Managed Agents at **$0.08/session-hour**, that's **~8x cheaper** for the compute portion — comparable to the Lightsail savings ratio. On `e2-micro` free tier, the compute cost per session is literally **$0** up to the free-tier limits.

## Tearing down

```bash
./scripts/deploy-gcp-compute.sh --destroy
# Deletes the instance + the openclaw-managed-agents-allow-orchestrator firewall rule.
```

Or manually:

```bash
gcloud compute instances delete openclaw-managed-agents --zone us-central1-a --quiet
gcloud compute firewall-rules delete openclaw-managed-agents-allow-orchestrator --quiet
```

GCE bills per-second after the first minute, so a 1-hour test on `e2-medium` costs about **$0.03**. Destroying the instance stops all charges immediately.

## Manual deploy (if you prefer)

If you want to understand what the script does, the underlying commands are:

```bash
# 1. Make sure the project + API are ready
gcloud config set project <your-project-id>
gcloud services enable compute.googleapis.com

# 2. Write the startup-script to a file (pure shell; see scripts/deploy-gcp-compute.sh)
cat > /tmp/startup.sh <<'SCRIPT'
#!/bin/bash
set -eux
useradd -m -s /bin/bash ubuntu || true
usermod -aG sudo ubuntu
install -o ubuntu -g ubuntu -m 0700 -d /home/ubuntu/.ssh
cat ~/.ssh/id_ed25519.pub > /home/ubuntu/.ssh/authorized_keys  # or however you want to inject
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y apt-transport-https ca-certificates curl git gnupg jq lsb-release
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
git clone --depth 1 https://github.com/stainlu/openclaw-managed-agents.git /opt/openclaw
cd /opt/openclaw
mkdir -p data/sessions data/state
echo "MOONSHOT_API_KEY=$MOONSHOT_API_KEY" > .env
docker compose pull
docker pull ghcr.io/stainlu/openclaw-managed-agents-egress-proxy:latest
docker compose up -d
SCRIPT

# 3. Write ssh-keys metadata
printf 'ubuntu:%s\n' "$(cat ~/.ssh/id_ed25519.pub)" > /tmp/ssh-keys.txt

# 4. Create the instance
gcloud compute instances create openclaw-managed-agents \
  --zone us-central1-a \
  --machine-type e2-medium \
  --image-family ubuntu-2404-lts-amd64 \
  --image-project ubuntu-os-cloud \
  --boot-disk-size 20GB \
  --boot-disk-type pd-balanced \
  --tags openclaw-managed-agents \
  --metadata-from-file startup-script=/tmp/startup.sh,ssh-keys=/tmp/ssh-keys.txt \
  --labels managed-by=openclaw-managed-agents

# 5. Open port 8080 scoped to the instance tag
gcloud compute firewall-rules create openclaw-managed-agents-allow-orchestrator \
  --allow tcp:8080 \
  --source-ranges 0.0.0.0/0 \
  --target-tags openclaw-managed-agents

# 6. Get the public IP
IP=$(gcloud compute instances describe openclaw-managed-agents \
  --zone us-central1-a \
  --format='value(networkInterfaces[0].accessConfigs[0].natIP)')

# 7. Wait for the orchestrator healthz
while ! curl -sf "http://${IP}:8080/healthz" >/dev/null; do sleep 5; done

echo "Orchestrator ready on http://${IP}:8080"
```

The `scripts/deploy-gcp-compute.sh` wrapper adds preflight checks, idempotent re-runs, a `--destroy` flag, and friendlier error messages — but the core flow is the seven steps above.

## What's next — more backends

Item 10c (this guide) is the Google Cloud path. Upcoming Item 10 backends extend the story without replacing it:

- **Item 10a — Hetzner Cloud.** ✅ Shipped. €3.99/mo CAX11 ARM, €4.99/mo CX23 x86. See [docs/deploying-on-hetzner.md](./deploying-on-hetzner.md).
- **Item 10b — AWS Lightsail.** ✅ Shipped. $12-$24/mo. See [docs/deploying-on-aws-lightsail.md](./deploying-on-aws-lightsail.md).
- **Item 10d — Azure Virtual Machines.** `B2s` via `az vm create`. Same pattern. Azure partnership hook.
- **Item 10e — DigitalOcean / Linode / Vultr / Oracle Cloud free tier.** One deploy script per provider, all at $0-$13/month. Oracle's Always-Free A1 tier gives 4 vCPU + 24 GB RAM for **$0 forever**.
- **Item 10f+ — Optional serverless integrations** (Cloud Run, Fargate, Cloudflare Containers) — deferred, partnership-driven only. See [`docs/cloud-backends.md`](./cloud-backends.md) for the architectural decision record on why serverless containers are the wrong default for our workload.

Each new backend is a ~300-line sibling of this script. No orchestrator core changes. All of them run the same `DockerContainerRuntime` you're running locally with `docker compose up`.

## Security notes

- **API key in startup-script.** The provider API key (e.g., `MOONSHOT_API_KEY`) is written to `/opt/openclaw/.env` via the startup-script. The script itself is visible via `gcloud compute instances describe --format='value(metadata.items)'` for any project member with Compute Viewer permission, and is logged to the serial console. Acceptable for a proof point; for production, use [Google Secret Manager](https://cloud.google.com/secret-manager) and fetch the key at container start (the orchestrator's `OPENCLAW_PASSTHROUGH_ENV` hook makes this a small wrapper script change, not a core modification).
- **Public API auth.** The orchestrator on port 8080 has NO bearer-token check unless you set `OPENCLAW_API_TOKEN`. One command to generate + apply + verify end-to-end:
  ```bash
  ./scripts/rotate-api-token.sh gcp <instance-name> <zone>
  ```
  The script uses `gcloud compute ssh`, rewrites `/opt/openclaw/.env` with sudo, restarts the orchestrator container, and verifies with a 401-then-200 curl pair against the resolved public IP. Prints the token for you to save. Re-run anytime to rotate. Any deploy exposing port 8080 to the public internet must set this — the orchestrator logs a WARN at startup when it's unset.
- **Public ingress on port 8080.** Even with `OPENCLAW_API_TOKEN` set, the orchestrator is internet-reachable via the firewall rule. For stronger isolation: (a) restrict the `source-ranges` on the firewall rule to specific client CIDRs, (b) front with an HTTPS Load Balancer + Cloud Armor (native GCP path), or (c) put the orchestrator behind a Cloudflare Tunnel (no ports exposed, authenticated access only).
- **No TLS by default.** Port 8080 is HTTP. For external access, terminate TLS at a reverse proxy (Caddy is simplest) or use GCP's HTTPS Load Balancer with a Google-managed certificate. Caddy sidecar with `--tls your-domain.example.com` is the two-line fix.
- **Single instance = no HA.** If the VM dies, all in-flight sessions fail and the orchestrator restarts. GCE's live migration covers hardware failures transparently but NOT kernel panics or OOM kills. For HA, run two instances behind an internal Load Balancer with shared session state on Cloud Storage — tracked as a future `SessionStorage` abstraction upstream, not shipped today.
- **SSH scope.** The script injects your SSH key into the instance's `ssh-keys` metadata, NOT the project-wide metadata. Other instances in the same project do NOT inherit the key. Revoke by destroying the instance.
- **gcloud credentials on your laptop.** `gcloud auth login` stores OAuth refresh tokens in `~/.config/gcloud/`. These have full access to every project you can reach. For multi-project work, use `gcloud auth application-default login` + `gcloud config configurations create` to scope by profile, or use [workload identity federation](https://cloud.google.com/iam/docs/workload-identity-federation) for CI.

## Troubleshooting

- **`gcloud auth login` prints a URL but never completes**: you're probably behind a corporate proxy that blocks the callback. Use `gcloud auth login --no-launch-browser` to get a device code flow instead.
- **`gcloud compute instances create` fails with "Required 'compute.instances.create' permission"**: your account doesn't have the Compute Admin role on this project. Either ask a project owner to grant it, or create the project yourself (you become Owner by default).
- **`gcloud compute instances create` fails with "The billing account for the owning project is disabled"**: the project isn't linked to a funded billing account. Go to [Billing](https://console.cloud.google.com/billing) in the Cloud Console and link one.
- **Instance reaches "running" but `/healthz` never responds**: startup-script is still running or crashed. SSH in with `gcloud compute ssh ubuntu@<instance>` and inspect `sudo tail -f /var/log/openclaw-bootstrap.log`. Also check the serial console: `gcloud compute instances get-serial-port-output openclaw-managed-agents --zone us-central1-a`.
- **SSH fails with "Permission denied (publickey)"**: the guest agent may not have picked up the `ssh-keys` metadata yet — wait 30 seconds after create and retry. If it persists, the instance may have OS Login enforced at the organization level; use `gcloud compute ssh` instead of raw `ssh` to get the project's OS Login keys automatically.
- **`/healthz` never returns OK but docker compose started successfully**: port 8080 is likely firewalled. Check `gcloud compute firewall-rules list --filter="name=openclaw-managed-agents-allow-orchestrator"` and verify the target tag matches the instance tag.
- **Deploy is slow (>10 min to /healthz)**: first-time GCE projects sometimes have a 30-60 s delay before `gcloud compute instances create` is accepted while the API warms up. Also, the initial `docker pull` of the runtime image (~1.7 GB compressed) takes 60-90 s on typical GCE egress bandwidth. Subsequent deploys to the same project are faster because of image layer caching.
