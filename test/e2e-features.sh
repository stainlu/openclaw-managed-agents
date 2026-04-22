#!/usr/bin/env bash
# E2E test for features built 2026-04-22:
#   1. Environment API (description, new package managers, networking flags)
#   2. Vault API (create via API)
#   3. Agent creation with empty tools (all 53 skills)
#   4. Per-session workspace isolation (separate workspaces per session)
#   5. Parent session tracking (parent_session_id in response)
#   6. Metrics endpoint (Prometheus counters)
#
# Usage:
#   OPENCLAW_API_TOKEN=<token> ./test/e2e-features.sh
#   OPENCLAW_HOST=https://openclaw-managed-agents.com OPENCLAW_API_TOKEN=<token> ./test/e2e-features.sh

set -euo pipefail

HOST="${OPENCLAW_HOST:-https://openclaw-managed-agents.com}"
TOKEN="${OPENCLAW_API_TOKEN:?OPENCLAW_API_TOKEN is required}"
PASS=0
FAIL=0

api() {
  local method="$1" path="$2"
  shift 2
  curl -s -X "$method" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    "${HOST}${path}" "$@"
}

check() {
  local name="$1" condition="$2"
  if eval "$condition"; then
    echo "  ✓ $name"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $name"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== E2E Feature Tests ==="
echo "Host: ${HOST}"
echo ""

# ---------- 1. Health check ----------
echo "== 1. Health check =="
HEALTH=$(curl -s "${HOST}/healthz")
check "healthz returns ok" '[ "$(echo "$HEALTH" | jq -r .ok)" = "true" ]'

# ---------- 2. Environment with new fields ----------
echo ""
echo "== 2. Environment API (description, networking flags) =="
ENV_RESP=$(api POST /v1/environments -d '{
  "name": "e2e-test-env",
  "description": "E2E test environment with limited networking",
  "packages": {"pip": ["requests"], "npm": ["express"]},
  "networking": {
    "type": "limited",
    "allowedHosts": ["api.example.com"],
    "allowMcpServers": true,
    "allowPackageManagers": true
  }
}')
ENV_ID=$(echo "$ENV_RESP" | jq -r .environment_id)
check "environment created" '[ -n "$ENV_ID" ] && [ "$ENV_ID" != "null" ]'
check "description field present" '[ "$(echo "$ENV_RESP" | jq -r .description)" = "E2E test environment with limited networking" ]'
check "networking type is limited" '[ "$(echo "$ENV_RESP" | jq -r .networking.type)" = "limited" ]'
check "allowMcpServers is true" '[ "$(echo "$ENV_RESP" | jq -r .networking.allowMcpServers)" = "true" ]'
check "allowPackageManagers is true" '[ "$(echo "$ENV_RESP" | jq -r .networking.allowPackageManagers)" = "true" ]'
check "pip packages present" '[ "$(echo "$ENV_RESP" | jq -r ".packages.pip[0]")" = "requests" ]'

# ---------- 3. Vault API ----------
echo ""
echo "== 3. Vault API =="
VAULT_RESP=$(api POST /v1/vaults -d '{
  "userId": "e2e_test_user",
  "name": "e2e-test-vault"
}')
VAULT_ID=$(echo "$VAULT_RESP" | jq -r .vault_id)
check "vault created" '[ -n "$VAULT_ID" ] && [ "$VAULT_ID" != "null" ]'
check "vault name correct" '[ "$(echo "$VAULT_RESP" | jq -r .name)" = "e2e-test-vault" ]'

# ---------- 4. Agent with empty tools (all 53 skills) ----------
echo ""
echo "== 4. Agent creation with empty tools =="
AGENT_RESP=$(api POST /v1/agents -d '{
  "name": "e2e-test-agent",
  "model": "moonshot/kimi-k2.6",
  "tools": [],
  "instructions": "You are an E2E test agent.",
  "permissionPolicy": {"type": "always_allow"},
  "thinkingLevel": "medium",
  "quota": {
    "maxCostUsdPerSession": 5.0,
    "maxTokensPerSession": 500000,
    "maxWallDurationMs": 3600000
  }
}')
AGENT_ID=$(echo "$AGENT_RESP" | jq -r .agent_id)
check "agent created with empty tools" '[ -n "$AGENT_ID" ] && [ "$AGENT_ID" != "null" ]'
check "tools array is empty (all skills)" '[ "$(echo "$AGENT_RESP" | jq ".tools | length")" = "0" ]'
check "thinkingLevel is medium" '[ "$(echo "$AGENT_RESP" | jq -r .thinking_level)" = "medium" ]'

# ---------- 5. Per-session workspace isolation ----------
echo ""
echo "== 5. Per-session workspace isolation =="
# Create two sessions on the same agent
S1_RESP=$(api POST /v1/sessions -d "{\"agentId\": \"${AGENT_ID}\"}")
S1_ID=$(echo "$S1_RESP" | jq -r .session_id)
check "session 1 created" '[ -n "$S1_ID" ] && [ "$S1_ID" != "null" ]'

S2_RESP=$(api POST /v1/sessions -d "{\"agentId\": \"${AGENT_ID}\"}")
S2_ID=$(echo "$S2_RESP" | jq -r .session_id)
check "session 2 created" '[ -n "$S2_ID" ] && [ "$S2_ID" != "null" ]'
check "sessions are different" '[ "$S1_ID" != "$S2_ID" ]'

# ---------- 6. Parent session tracking ----------
echo ""
echo "== 6. Parent session tracking =="
S1_DETAIL=$(api GET "/v1/sessions/${S1_ID}")
check "parent_session_id field exists" 'echo "$S1_DETAIL" | jq -e "has(\"parent_session_id\")" > /dev/null'
check "parent_session_id is null for top-level" '[ "$(echo "$S1_DETAIL" | jq -r .parent_session_id)" = "null" ]'

# ---------- 7. Metrics endpoint ----------
echo ""
echo "== 7. Metrics endpoint =="
METRICS=$(curl -s -H "Authorization: Bearer ${TOKEN}" "${HOST}/metrics")
check "metrics returns prometheus data" 'echo "$METRICS" | grep -q "pool_active_containers"'
check "http_requests_total present" 'echo "$METRICS" | grep -q "http_requests_total"'
check "pool_spawn_duration_seconds present" 'echo "$METRICS" | grep -q "pool_spawn_duration_seconds"'
check "session_run_duration_seconds present" 'echo "$METRICS" | grep -q "session_run_duration_seconds"'
check "quota_rejections_total present" 'echo "$METRICS" | grep -q "quota_rejections_total"'

# ---------- 8. Session list shows new fields ----------
echo ""
echo "== 8. Session list (new fields) =="
SESSIONS=$(api GET /v1/sessions)
SCOUNT=$(echo "$SESSIONS" | jq -r '.count // 0')
check "sessions list returns" '[ "$SCOUNT" -gt "0" ]'
FIRST=$(echo "$SESSIONS" | jq ".sessions[0]")
check "parent_session_id in list response" 'echo "$FIRST" | jq -e "has(\"parent_session_id\")" > /dev/null'

# ---------- Cleanup ----------
echo ""
echo "== Cleanup =="
api DELETE "/v1/sessions/${S1_ID}" > /dev/null 2>&1 && echo "  ✓ session 1 deleted" || echo "  · session 1 cleanup skipped"
api DELETE "/v1/sessions/${S2_ID}" > /dev/null 2>&1 && echo "  ✓ session 2 deleted" || echo "  · session 2 cleanup skipped"
api DELETE "/v1/environments/${ENV_ID}" > /dev/null 2>&1 && echo "  ✓ environment deleted" || echo "  · environment cleanup skipped"
api DELETE "/v1/vaults/${VAULT_ID}" > /dev/null 2>&1 && echo "  ✓ vault deleted" || echo "  · vault cleanup skipped"

echo ""
echo "=== Results: ${PASS} passed, ${FAIL} failed ==="
[ "$FAIL" -eq 0 ] || exit 1
