// OpenClaw before_tool_call hook — pauses execution for tools that the
// agent template's permission_policy marks as `always_ask`.
//
// Reads the tool list from OPENCLAW_CONFIRM_TOOLS (comma-separated).
// Empty or unset = no tools require confirmation (this module is only
// loaded when the list is non-empty, so this is a defensive fallback).
//
// Returns `requireApproval` for matching tools, causing the gateway to
// broadcast a `plugin.approval.requested` WS event. The orchestrator
// receives that broadcast, surfaces it as an SSE event to the client,
// and resolves via `plugin.approval.resolve` when the client responds.

const raw = (process.env.OPENCLAW_CONFIRM_TOOLS || "").trim();
const confirmAll = raw === "__ALL__";
const confirmTools = confirmAll
  ? []
  : raw.split(",").map((t) => t.trim()).filter(Boolean);

/** @type {import('openclaw/plugin-sdk').PluginHookBeforeToolCallHandler} */
export function beforeToolCall(event) {
  const toolName = event?.toolName ?? event?.name ?? "";
  if (!confirmAll && !confirmTools.includes(toolName)) return {};

  return {
    requireApproval: {
      title: `Tool requires confirmation: ${toolName}`,
      description: `The agent wants to execute "${toolName}". Allow or deny?`,
      severity: "warning",
      timeoutMs: 300_000, // 5 minutes — generous for human-in-the-loop
      timeoutBehavior: "deny",
    },
  };
}
