// Interface each per-server provisioning adapter implements (openfire.ts, ejabberd.ts, prosody.ts).
// Adapters set up the §4 fixture; checks stay server-independent.

export interface ProvisioningAdapter {
  /** Create accounts, rooms, nodes and access rules from fixtures/game.ts. Idempotent. */
  provision(): Promise<void>;
  /** Remove everything provision() created. */
  teardown(): Promise<void>;
}
