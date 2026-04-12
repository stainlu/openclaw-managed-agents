#!/usr/bin/env bash
#
# End-to-end verification for OpenClaw Managed Runtime.
#
# Prerequisites:
#   - docker compose up -d (orchestrator running on localhost:8080)
#   - AWS credentials with Bedrock access in the environment (forwarded to agent containers)
#
# Exits 0 on success, non-zero on failure.

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"
MODEL="${OPENCLAW_TEST_MODEL:-bedrock/claude-sonnet-4-6}"
POLL_INTERVAL_SEC=2
MAX_POLL_SEC=300

echo "[e2e] checking orchestrator health at ${BASE_URL}/healthz"
curl --silent --fail "${BASE_URL}/healthz" >/dev/null || {
  echo "[e2e] orchestrator is not healthy — is docker compose up?"
  exit 1
}

echo "[e2e] creating research agent with model ${MODEL}"
CREATE_RESPONSE=$(curl --silent --fail \
  -X POST "${BASE_URL}/v1/agents" \
  -H 'Content-Type: application/json' \
  -d "{
    \"model\": \"${MODEL}\",
    \"tools\": [\"web-search\", \"file-management\"],
    \"instructions\": \"You are a research assistant. Answer concisely in one paragraph.\"
  }")
AGENT_ID=$(echo "${CREATE_RESPONSE}" | jq -r '.agent_id')
if [[ -z "${AGENT_ID}" || "${AGENT_ID}" == "null" ]]; then
  echo "[e2e] failed to create agent: ${CREATE_RESPONSE}"
  exit 1
fi
echo "[e2e] created agent: ${AGENT_ID}"

echo "[e2e] running task"
RUN_RESPONSE=$(curl --silent --fail \
  -X POST "${BASE_URL}/v1/agents/${AGENT_ID}/run" \
  -H 'Content-Type: application/json' \
  -d '{"task": "In one paragraph, summarize what Claude Managed Agents is and why it matters."}')
SESSION_ID=$(echo "${RUN_RESPONSE}" | jq -r '.session_id')
if [[ -z "${SESSION_ID}" || "${SESSION_ID}" == "null" ]]; then
  echo "[e2e] failed to start run: ${RUN_RESPONSE}"
  exit 1
fi
echo "[e2e] started session: ${SESSION_ID}"

echo "[e2e] polling session status (timeout ${MAX_POLL_SEC}s)"
elapsed=0
while [[ ${elapsed} -lt ${MAX_POLL_SEC} ]]; do
  sleep "${POLL_INTERVAL_SEC}"
  elapsed=$((elapsed + POLL_INTERVAL_SEC))
  SESSION_JSON=$(curl --silent --fail "${BASE_URL}/v1/sessions/${SESSION_ID}")
  STATUS=$(echo "${SESSION_JSON}" | jq -r '.status')
  echo "[e2e] t=${elapsed}s status=${STATUS}"
  case "${STATUS}" in
    completed)
      echo "[e2e] SUCCESS"
      echo "${SESSION_JSON}" | jq .
      exit 0
      ;;
    failed)
      echo "[e2e] FAILED"
      echo "${SESSION_JSON}" | jq .
      exit 1
      ;;
  esac
done

echo "[e2e] TIMEOUT after ${MAX_POLL_SEC}s — last status=${STATUS}"
exit 1
