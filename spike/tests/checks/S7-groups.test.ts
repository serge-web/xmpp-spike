// S7 Are groups needed? (R6): confirm every §4 rule is expressed with per-user affiliations only,
// by reading the provisioned configuration back. S1/S2/S10 prove the rules are enforced.

import { afterAll, describe, expect, it } from 'vitest';
import { serverConfig } from '../config.js';
import { connect, disconnectAll, observe, uniq } from '../harness.js';
import { rooms } from '../fixtures/game.js';
import { nodePlan } from '../provision/game.js';

afterAll(disconnectAll);

describe('S7 groups', () => {
  it('no node uses roster/presence/authorize access (which would need groups or subscriptions)', async () => {
    const a = await connect('admin', { resource: uniq('s7') });
    const models: Record<string, unknown> = {};
    for (const n of nodePlan()) {
      const conf = await a.getNodeConfig(serverConfig().pubsubDomain, n.node);
      models[n.node] = conf.fields?.find((f) => f.name === 'pubsub#access_model')?.value;
    }
    await observe('S7', 'node access models', models);
    expect(Object.values(models).every((m) => m === 'open' || m === 'whitelist')).toBe(true);
  });

  it('room access is by per-JID affiliation (members-only)', async () => {
    const a = await connect('admin', { resource: uniq('s7') });
    const out: Record<string, string[]> = {};
    for (const r of rooms) {
      const res = await a.getRoomMembers(`${r.id}@${serverConfig().mucDomain}`, { affiliation: 'member' });
      out[r.id] = (res.muc?.users ?? []).map((u) => String(u.jid));
    }
    await observe('S7', 'room member affiliations', out);
    expect(Object.values(out).every((l) => l.length > 0)).toBe(true);
  });
});
