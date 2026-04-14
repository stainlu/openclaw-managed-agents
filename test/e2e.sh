#!/usr/bin/env bash
#
# End-to-end verification for OpenClaw Managed Runtime (session-centric API).
#
# Flow:
#   1. Create an agent template.
#   2. Create a long-lived Session bound to that agent.
#   3. Turn 1: post a user.message event teaching the agent a fact.
#              Poll the session until status flips back to "idle", then read
#              the latest agent.message from the event log.
#   4. Turn 2: post a second user.message event asking the agent to recall
#              the fact. Poll. Read. Verify the recall.
#   5. Smoke the backwards-compat POST /v1/agents/:id/run adapter so we know
#              the thin wrapper on top of the session-centric primitives still
#              returns an OpenAI-style shape for legacy callers.
#
# Prerequisites:
#   - docker compose up -d (orchestrator on localhost:8080)
#   - Provider API key (e.g. MOONSHOT_API_KEY) exported in the host shell so
#     docker-compose forwards it into the orchestrator, which forwards it
#     into each spawned agent container.
#
# Override model:
#   OPENCLAW_TEST_MODEL=openai/gpt-5.4 ./test/e2e.sh
#   OPENCLAW_TEST_MODEL=anthropic/claude-sonnet-4-6 ./test/e2e.sh
#   OPENCLAW_TEST_MODEL=bedrock/anthropic.claude-sonnet-4-6 ./test/e2e.sh
#
# Exits 0 on success, non-zero on failure.

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"
MODEL="${OPENCLAW_TEST_MODEL:-moonshot/kimi-k2.5}"
POLL_INTERVAL_SEC=2
MAX_POLL_SEC=300

echo "[e2e] checking orchestrator health at ${BASE_URL}/healthz"
curl --silent --fail "${BASE_URL}/healthz" >/dev/null || {
  echo "[e2e] orchestrator is not healthy — is docker compose up?"
  exit 1
}

echo "[e2e] creating research agent with model ${MODEL}"
# MVP e2e asks purely-textual questions — no tool allowlist needed.
CREATE_RESPONSE=$(curl --silent --fail \
  -X POST "${BASE_URL}/v1/agents" \
  -H 'Content-Type: application/json' \
  -d "{
    \"model\": \"${MODEL}\",
    \"tools\": [],
    \"instructions\": \"You are a research assistant. Answer concisely in one paragraph.\"
  }")
AGENT_ID=$(echo "${CREATE_RESPONSE}" | jq -r '.agent_id')
if [[ -z "${AGENT_ID}" || "${AGENT_ID}" == "null" ]]; then
  echo "[e2e] failed to create agent: ${CREATE_RESPONSE}"
  exit 1
fi
echo "[e2e] created agent: ${AGENT_ID}"

echo "[e2e] creating session bound to agent ${AGENT_ID}"
SESSION_RESPONSE=$(curl --silent --fail \
  -X POST "${BASE_URL}/v1/sessions" \
  -H 'Content-Type: application/json' \
  -d "{\"agentId\": \"${AGENT_ID}\"}")
SESSION_ID=$(echo "${SESSION_RESPONSE}" | jq -r '.session_id')
if [[ -z "${SESSION_ID}" || "${SESSION_ID}" == "null" ]]; then
  echo "[e2e] failed to create session: ${SESSION_RESPONSE}"
  exit 1
fi
echo "[e2e] created session: ${SESSION_ID}"

# poll_session: loop GET /v1/sessions/:id until status flips away from
# "running". Success = status is "idle" (most recent run finished cleanly).
# Failure = status is "failed". Status lines go to stderr so the final JSON
# blob is the only thing on stdout when the caller captures $(poll_session ...).
poll_session() {
  local session_id="$1"
  local label="$2"
  local elapsed=0
  while [[ ${elapsed} -lt ${MAX_POLL_SEC} ]]; do
    sleep "${POLL_INTERVAL_SEC}"
    elapsed=$((elapsed + POLL_INTERVAL_SEC))
    local session_json status
    session_json=$(curl --silent --fail "${BASE_URL}/v1/sessions/${session_id}")
    status=$(echo "${session_json}" | jq -r '.status')
    echo "[e2e] ${label} t=${elapsed}s status=${status}" >&2
    case "${status}" in
      idle)
        echo "${session_json}"
        return 0
        ;;
      failed)
        echo "[e2e] ${label} FAILED" >&2
        echo "${session_json}" | jq . >&2
        return 1
        ;;
    esac
  done
  echo "[e2e] ${label} TIMEOUT after ${MAX_POLL_SEC}s — last status=${status}" >&2
  return 1
}

post_event() {
  local session_id="$1"
  local content="$2"
  curl --silent --fail \
    -X POST "${BASE_URL}/v1/sessions/${session_id}/events" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n --arg c "${content}" '{type: "user.message", content: $c}')"
}

latest_agent_message() {
  local session_id="$1"
  curl --silent --fail "${BASE_URL}/v1/sessions/${session_id}/events" \
    | jq -r '[.events[] | select(.type=="agent.message")] | last | .content // ""'
}

# ---- Turn 1: teach the agent a fact -----------------------------------------

echo "[e2e] turn 1: posting user.message (remember dragonfruit)"
TURN1_EVENT=$(post_event "${SESSION_ID}" \
  "Remember this for later: my favorite fruit is dragonfruit. Reply with exactly the single word: noted")
TURN1_EVENT_ID=$(echo "${TURN1_EVENT}" | jq -r '.event_id')
echo "[e2e] turn 1 user event: ${TURN1_EVENT_ID}"

poll_session "${SESSION_ID}" "turn1" >/dev/null || exit 1
TURN1_OUTPUT=$(latest_agent_message "${SESSION_ID}")
echo "[e2e] turn 1 output: ${TURN1_OUTPUT}"

# ---- Turn 2: ask the agent to recall the fact on the SAME session -----------

echo "[e2e] turn 2: posting user.message (what is my favorite fruit)"
TURN2_EVENT=$(post_event "${SESSION_ID}" \
  "What is my favorite fruit? Reply with only the single word, no punctuation.")
TURN2_EVENT_ID=$(echo "${TURN2_EVENT}" | jq -r '.event_id')
echo "[e2e] turn 2 user event: ${TURN2_EVENT_ID}"

poll_session "${SESSION_ID}" "turn2" >/dev/null || exit 1
TURN2_OUTPUT=$(latest_agent_message "${SESSION_ID}")
echo "[e2e] turn 2 output: ${TURN2_OUTPUT}"

# ---- Verify resume --------------------------------------------------------

if echo "${TURN2_OUTPUT}" | grep -qi "dragonfruit"; then
  echo "[e2e] SUCCESS: session-centric resume — turn 2 recalled the fact from turn 1"
else
  echo "[e2e] FAIL: session resume broken — turn 2 did not recall 'dragonfruit'"
  echo "  turn 1 output: ${TURN1_OUTPUT}"
  echo "  turn 2 output: ${TURN2_OUTPUT}"
  exit 1
fi

# ---- Backwards-compat: one-shot smoke of the /run adapter -------------------
# Proves that the thin wrapper on top of createSession + runEvent still
# returns an OpenAI-style { session_id, status: "running" } for legacy callers.

echo "[e2e] backwards-compat: POST /v1/agents/${AGENT_ID}/run"
ADAPTER_RUN=$(curl --silent --fail \
  -X POST "${BASE_URL}/v1/agents/${AGENT_ID}/run" \
  -H 'Content-Type: application/json' \
  -d '{"task": "Reply with exactly one word: ready"}')
ADAPTER_SESSION_ID=$(echo "${ADAPTER_RUN}" | jq -r '.session_id')
if [[ -z "${ADAPTER_SESSION_ID}" || "${ADAPTER_SESSION_ID}" == "null" ]]; then
  echo "[e2e] backwards-compat FAIL: /run adapter did not return a session_id"
  echo "${ADAPTER_RUN}" | jq .
  exit 1
fi
echo "[e2e] backwards-compat adapter session: ${ADAPTER_SESSION_ID}"
poll_session "${ADAPTER_SESSION_ID}" "adapter-run" >/dev/null || exit 1
echo "[e2e] backwards-compat /run adapter still works"

echo "[e2e] ALL CHECKS PASSED"
exit 0
