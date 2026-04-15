#!/usr/bin/env bash
#
# deploy-aws-lightsail.sh — one-command deploy of the OpenClaw Managed Runtime
# to an AWS Lightsail instance. Idempotent: re-running reuses the existing
# instance if present.
#
# Usage:
#     export AWS_ACCESS_KEY_ID=AKIA...
#     export AWS_SECRET_ACCESS_KEY=...
#     export AWS_DEFAULT_REGION=us-east-1      # or whichever region you prefer
#     export MOONSHOT_API_KEY=sk-...           # or ANTHROPIC_API_KEY / OPENAI_API_KEY / etc.
#     ./scripts/deploy-aws-lightsail.sh        # provision + bring up
#     ./scripts/deploy-aws-lightsail.sh --destroy  # tear down
#
# Environment variables (all optional except AWS creds + a provider key):
#     LIGHTSAIL_INSTANCE_NAME=openclaw-managed-runtime    # run multiple deploys by setting different names
#     LIGHTSAIL_REGION=us-east-1                          # us-east-1 | us-east-2 | eu-west-1 | etc.
#     LIGHTSAIL_AVAILABILITY_ZONE=us-east-1a              # must match region
#     LIGHTSAIL_BUNDLE_ID=medium_3_0                      # nano_3_0 ($5) | micro_3_0 ($7) | small_3_0 ($12, 2GB) | medium_3_0 ($24, 4GB) | large_3_0 ($44, 8GB)
#     LIGHTSAIL_BLUEPRINT_ID=ubuntu_24_04
#     OPENCLAW_DEPLOY_BRANCH=main                         # git branch to clone on the instance
#     OPENCLAW_DEPLOY_REPO=https://github.com/stainlu/openclaw-managed-runtime.git
#
# See docs/deploying-on-aws-lightsail.md for the full walkthrough.

set -euo pipefail

# ------------------------------------------------------------------------------
# Configuration (with overridable defaults)
# ------------------------------------------------------------------------------

INSTANCE_NAME="${LIGHTSAIL_INSTANCE_NAME:-openclaw-managed-runtime}"
REGION="${LIGHTSAIL_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
AVAILABILITY_ZONE="${LIGHTSAIL_AVAILABILITY_ZONE:-${REGION}a}"
BUNDLE_ID="${LIGHTSAIL_BUNDLE_ID:-medium_3_0}"
BLUEPRINT_ID="${LIGHTSAIL_BLUEPRINT_ID:-ubuntu_24_04}"
REPO_URL="${OPENCLAW_DEPLOY_REPO:-https://github.com/stainlu/openclaw-managed-runtime.git}"
REPO_BRANCH="${OPENCLAW_DEPLOY_BRANCH:-main}"
ORCH_PORT=8080

# Known provider-key env vars that the runtime forwards to agent containers.
# The first one set in the local environment is written into the instance's .env.
PROVIDER_KEY_NAMES=(
    MOONSHOT_API_KEY
    ANTHROPIC_API_KEY
    OPENAI_API_KEY
    GEMINI_API_KEY
    GOOGLE_API_KEY
    DEEPSEEK_API_KEY
    QWEN_API_KEY
    DASHSCOPE_API_KEY
    MISTRAL_API_KEY
    XAI_API_KEY
    TOGETHER_API_KEY
    OPENROUTER_API_KEY
    FIREWORKS_API_KEY
    GROQ_API_KEY
)

# Default test model matches the local smoke path.
DEFAULT_TEST_MODEL="${OPENCLAW_TEST_MODEL:-moonshot/kimi-k2.5}"

# ------------------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------------------

log() { printf "==> %s\n" "$*"; }
err() { printf "error: %s\n" "$*" >&2; }
die() { err "$*"; exit 1; }

# Shortcut for aws lightsail with region pinned.
ls_cli() { aws lightsail --region "${REGION}" "$@"; }

# ------------------------------------------------------------------------------
# Teardown path
# ------------------------------------------------------------------------------

if [[ "${1:-}" == "--destroy" ]]; then
    log "Destroying ${INSTANCE_NAME} in ${REGION}"
    command -v aws >/dev/null 2>&1 || die "aws CLI not found"
    if ls_cli get-instance --instance-name "${INSTANCE_NAME}" >/dev/null 2>&1; then
        ls_cli delete-instance --instance-name "${INSTANCE_NAME}" >/dev/null
        log "Instance ${INSTANCE_NAME} deleted."
    else
        log "Instance ${INSTANCE_NAME} not found — nothing to destroy."
    fi
    exit 0
fi

# ------------------------------------------------------------------------------
# Preflight checks
# ------------------------------------------------------------------------------

log "Checking prerequisites"

command -v aws >/dev/null 2>&1 || die "aws CLI not found. Install: brew install awscli (macOS), or see https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
printf "    aws CLI:           ok (%s)\n" "$(aws --version 2>&1 | head -n 1)"

# Verify credentials are valid by calling STS. Surfaces a clear error if
# AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_PROFILE isn't set correctly.
if ! CALLER=$(aws sts get-caller-identity --output text --query 'Arn' 2>&1); then
    err "aws sts get-caller-identity failed. Check your credentials."
    err "Either: export AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY, or: aws configure"
    err "Underlying error: ${CALLER}"
    exit 1
fi
printf "    AWS credentials:   ok (%s)\n" "${CALLER}"
printf "    Region:            %s\n" "${REGION}"
printf "    Availability zone: %s\n" "${AVAILABILITY_ZONE}"

# Find the user's default SSH public key. We inject it via cloud-init rather
# than using Lightsail's native key pair model, matching the Hetzner deploy
# script's pattern.
SSH_PUBKEY_PATH=""
for candidate in "${HOME}/.ssh/id_ed25519.pub" "${HOME}/.ssh/id_rsa.pub" "${HOME}/.ssh/id_ecdsa.pub"; do
    if [[ -f "${candidate}" ]]; then
        SSH_PUBKEY_PATH="${candidate}"
        break
    fi
done
[[ -n "${SSH_PUBKEY_PATH}" ]] || die "No SSH public key found in ~/.ssh/. Run: ssh-keygen -t ed25519"
printf "    SSH public key:    %s\n" "${SSH_PUBKEY_PATH}"
SSH_PUBKEY_CONTENT="$(cat "${SSH_PUBKEY_PATH}")"

# Find the first provider key that is set.
PROVIDER_KEY_NAME=""
PROVIDER_KEY_VALUE=""
for name in "${PROVIDER_KEY_NAMES[@]}"; do
    value="${!name:-}"
    if [[ -n "${value}" ]]; then
        PROVIDER_KEY_NAME="${name}"
        PROVIDER_KEY_VALUE="${value}"
        break
    fi
done
if [[ -z "${PROVIDER_KEY_NAME}" ]]; then
    die "No provider API key is exported. Set at least one of: ${PROVIDER_KEY_NAMES[*]}"
fi
printf "    Provider key:      %s\n" "${PROVIDER_KEY_NAME}"
printf "    Test model:        %s\n" "${DEFAULT_TEST_MODEL}"
printf "    Bundle:            %s\n" "${BUNDLE_ID}"
printf "    Blueprint:         %s\n" "${BLUEPRINT_ID}"

# ------------------------------------------------------------------------------
# Render the cloud-init user-data
# ------------------------------------------------------------------------------
#
# Lightsail's create-instances accepts --user-data as a STRING, not a file path,
# so we build the full cloud-init content in a variable and pass it inline.
# The content mirrors the Hetzner deploy script so the in-container behavior is
# identical across clouds.

log "Rendering cloud-init user-data with ${PROVIDER_KEY_NAME}"

USER_DATA="$(cat <<CLOUDINIT
#cloud-config
package_update: true
package_upgrade: false

ssh_authorized_keys:
  - ${SSH_PUBKEY_CONTENT}

packages:
  - apt-transport-https
  - ca-certificates
  - curl
  - git
  - gnupg
  - jq
  - lsb-release

write_files:
  - path: /etc/systemd/system/ssh.socket.d/override.conf
    permissions: '0644'
    content: |
      # Listen on both port 22 (standard) and port 222 (workaround).
      # Ubuntu 24.04 uses systemd socket activation for sshd (ssh.socket),
      # so adding a Port directive to /etc/ssh/sshd_config.d is NOT enough:
      # the socket unit owns the bind. This drop-in resets ListenStream and
      # sets both ports explicitly. The bootstrap script below runs a
      # daemon-reload plus a restart of ssh.socket to apply.
      #
      # Some ISPs and corporate networks block outbound SSH to port 22 on
      # cloud provider IP ranges; opening 222 as an alternate is a reliable
      # safety net. Remove this file on a deployed instance if you do not
      # need the extra port.
      [Socket]
      ListenStream=
      ListenStream=22
      ListenStream=222
  - path: /opt/openclaw-bootstrap.sh
    permissions: '0755'
    content: |
      #!/usr/bin/env bash
      set -euxo pipefail

      # --- Restart ssh.socket so it picks up the Port 222 ListenStream override ---
      systemctl daemon-reload
      systemctl restart ssh.socket || systemctl restart ssh || true

      # --- Install Docker via the official Docker repo ---
      install -m 0755 -d /etc/apt/keyrings
      curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
      chmod a+r /etc/apt/keyrings/docker.asc
      echo "deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \$(. /etc/os-release && echo \$VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
      apt-get update -y
      apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
      systemctl enable --now docker

      # --- Clone the runtime repo ---
      git clone --depth 1 --branch ${REPO_BRANCH} ${REPO_URL} /opt/openclaw
      cd /opt/openclaw
      mkdir -p data/sessions data/state

      # --- Write .env with the provider API key ---
      cat > .env <<ENVFILE
      ${PROVIDER_KEY_NAME}=${PROVIDER_KEY_VALUE}
      OPENCLAW_TEST_MODEL=${DEFAULT_TEST_MODEL}
      ENVFILE

      # --- Bring up the stack ---
      docker compose up -d --build

      # --- Health-check loop (up to 10 min) ---
      for i in \$(seq 1 120); do
          if curl -sf http://127.0.0.1:${ORCH_PORT}/healthz >/dev/null; then
              echo "orchestrator ready after \${i} probes" > /var/log/openclaw-ready.log
              exit 0
          fi
          sleep 5
      done
      echo "orchestrator did not become ready after 10 minutes" > /var/log/openclaw-ready.log
      exit 1

runcmd:
  - bash /opt/openclaw-bootstrap.sh 2>&1 | tee /var/log/openclaw-bootstrap.log
CLOUDINIT
)"

# ------------------------------------------------------------------------------
# Provision (or reuse) the instance
# ------------------------------------------------------------------------------

if ls_cli get-instance --instance-name "${INSTANCE_NAME}" >/dev/null 2>&1; then
    log "Instance ${INSTANCE_NAME} already exists — reusing"
    INSTANCE_INFO="$(ls_cli get-instance --instance-name "${INSTANCE_NAME}")"
    SERVER_IPV4="$(echo "${INSTANCE_INFO}" | jq -r '.instance.publicIpAddress')"
    printf "    IPv4:              %s\n" "${SERVER_IPV4}"
    printf "    Note:              cloud-init already ran on first provision. If the runtime\n"
    printf "                       is not live, SSH in and inspect /var/log/openclaw-bootstrap.log.\n"
else
    log "Provisioning ${BUNDLE_ID} instance in ${AVAILABILITY_ZONE} (${INSTANCE_NAME})"
    ls_cli create-instances \
        --instance-names "${INSTANCE_NAME}" \
        --availability-zone "${AVAILABILITY_ZONE}" \
        --blueprint-id "${BLUEPRINT_ID}" \
        --bundle-id "${BUNDLE_ID}" \
        --user-data "${USER_DATA}" \
        --tags 'key=managed-by,value=openclaw-managed-runtime' >/dev/null

    # Wait for Lightsail to finish provisioning the instance. Poll state until
    # it's "running", which means the VM is up and cloud-init has started.
    log "Waiting for Lightsail to bring the instance to running state"
    for i in $(seq 1 60); do
        STATE="$(ls_cli get-instance --instance-name "${INSTANCE_NAME}" 2>/dev/null | jq -r '.instance.state.name' 2>/dev/null || echo "unknown")"
        if [[ "${STATE}" == "running" ]]; then
            printf "    state:             running (after %d probes)\n" "${i}"
            break
        fi
        sleep 5
        if [[ "${i}" -eq 60 ]]; then
            die "Instance did not reach running state within 5 minutes (last state: ${STATE})"
        fi
    done

    SERVER_IPV4="$(ls_cli get-instance --instance-name "${INSTANCE_NAME}" | jq -r '.instance.publicIpAddress')"
    printf "    IPv4:              %s\n" "${SERVER_IPV4}"
fi

# ------------------------------------------------------------------------------
# Open port 8080 (orchestrator) and port 222 (SSH fallback)
# ------------------------------------------------------------------------------
#
# put-instance-public-ports REPLACES the entire port list, so we must include
# port 22 (default SSH) alongside our additions.

log "Opening ports 22, 222, 8080"
ls_cli put-instance-public-ports \
    --instance-name "${INSTANCE_NAME}" \
    --port-infos \
        'fromPort=22,toPort=22,protocol=tcp' \
        'fromPort=222,toPort=222,protocol=tcp' \
        "fromPort=${ORCH_PORT},toPort=${ORCH_PORT},protocol=tcp" >/dev/null

# ------------------------------------------------------------------------------
# Wait for the orchestrator to be reachable from the public IP
# ------------------------------------------------------------------------------

log "Waiting for cloud-init to install Docker + bring up the stack (~4 min)"
ORCH_URL="http://${SERVER_IPV4}:${ORCH_PORT}"
DEADLINE=$(( $(date +%s) + 600 ))
SUCCESS=0
while [[ "$(date +%s)" -lt "${DEADLINE}" ]]; do
    if curl -sf --max-time 3 "${ORCH_URL}/healthz" >/dev/null 2>&1; then
        SUCCESS=1
        break
    fi
    printf "    [+%3d s] waiting for %s/healthz\n" "$(( $(date +%s) - (DEADLINE - 600) ))" "${ORCH_URL}"
    sleep 15
done

if [[ "${SUCCESS}" -eq 1 ]]; then
    log "Deploy complete"
    printf "    Orchestrator:      %s\n" "${ORCH_URL}"
    printf "    Monthly cost:      ~$24 (medium_3_0 bundle: 2 vCPU / 4 GB / 80 GB / 4 TB egress)\n"
    printf "                       Override LIGHTSAIL_BUNDLE_ID=small_3_0 for \$12/mo (2 GB)\n"
    printf "    Destroy with:      ./scripts/deploy-aws-lightsail.sh --destroy\n"
    printf "    SSH (port 22):     ssh ubuntu@%s\n" "${SERVER_IPV4}"
    printf "    SSH (port 222):    ssh -p 222 ubuntu@%s   # use this if your ISP blocks port 22 to cloud IPs\n" "${SERVER_IPV4}"
    printf "    Tail bootstrap:    ssh ubuntu@%s 'sudo tail -f /var/log/openclaw-bootstrap.log'\n" "${SERVER_IPV4}"
else
    err "Orchestrator did not become reachable at ${ORCH_URL}/healthz after 10 minutes."
    err "Debug: ssh ubuntu@${SERVER_IPV4} 'sudo tail -f /var/log/openclaw-bootstrap.log'"
    exit 1
fi
