import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { InMemoryStore } from "./memory.js";
import { SqliteStore } from "./sqlite.js";
import type { Store } from "./types.js";

export type StoreBackend = "memory" | "sqlite";

export type BuildStoreOptions = {
  backend: StoreBackend;
  /** Required when backend is sqlite. Ignored for memory. */
  path?: string;
  /** OPENCLAW_VAULT_KEY env value (hex/base64/base64url 32 bytes).
   *  Ignored for memory. Undefined for sqlite means "generate on first
   *  boot and persist in kv_secrets" — convenient for dev, operators
   *  running in production should set the env var explicitly so key
   *  management is theirs. */
  vaultKeyEnv?: string;
};

// Factory entry point. Callers pick a backend via OPENCLAW_STORE env var
// (default: sqlite) and pass the resolved options in. Tests can construct an
// in-memory store directly without touching the factory.
export function buildStore(opts: BuildStoreOptions): Store {
  switch (opts.backend) {
    case "memory":
      return new InMemoryStore();
    case "sqlite": {
      if (!opts.path) {
        throw new Error("sqlite store backend requires a path");
      }
      mkdirSync(dirname(opts.path), { recursive: true });
      return new SqliteStore(opts.path, { vaultKeyEnv: opts.vaultKeyEnv });
    }
    default: {
      const exhaustive: never = opts.backend;
      throw new Error(`unknown store backend: ${String(exhaustive)}`);
    }
  }
}

export { InMemoryStore } from "./memory.js";
export { PiJsonlEventReader } from "./pi-jsonl.js";
export { SqliteStore } from "./sqlite.js";
export type {
  AgentStore,
  EnvironmentStore,
  QueuedEvent,
  QueueStore,
  RunUsage,
  SecretStore,
  SessionStore,
  Store,
} from "./types.js";
