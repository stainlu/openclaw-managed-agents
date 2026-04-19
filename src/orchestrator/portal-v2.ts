// New "paper canvas" portal design — dense developer-focused dashboard
// handed off from Claude Design (claude.ai/design) on 2026-04-19. Live at
// GET /v2 alongside the current dark-theme portal at GET /. Full source +
// handoff README + design chats are preserved under
// `docs/designs/portal-v2/` for reference.
//
// The design is a React/Babel-standalone prototype with mock data. For
// the first pass we serve the HTML verbatim so operators + reviewers
// can see the design live without waiting for a full data-integration
// port. Real /v1 API wiring (sessions list, session detail, event
// stream) will replace the mock arrays in follow-up commits; the
// handoff-README specifically calls out "recreate pixel-perfectly in
// whatever technology makes sense for the target codebase," so the
// intermediate state of "design live with mock data" is acceptable —
// it's how we compare the design against reality before committing
// to a full rewrite of portal.ts.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the HTML bundle relative to this module regardless of
// whether we're running via `tsx` against src/ or against a compiled
// dist/ tree. The build step copies src/orchestrator/portal-v2.html
// to dist/orchestrator/portal-v2.html; both locations contain the
// same file so the same readFileSync call works in dev and prod.
const moduleDir = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(moduleDir, "portal-v2.html");
const html = readFileSync(htmlPath, "utf8");

export function portalV2Html(): string {
  return html;
}
