// S2 PubSub confidentiality and write control (R3, R10).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serverConfig } from '../config.js';
import { captureStanzas, connect, disconnectAll, observe, outcome, publishJson, saveStanzas, uniq, type Client } from '../harness.js';
import { nodes, roles } from '../fixtures/game.js';

const svc = () => serverConfig().pubsubDomain;
const bare = (u: string) => `${u}@${serverConfig().domain}`;
const clients: Record<string, Client> = {};
const logs: Record<string, string[]> = {};

beforeAll(async () => {
  for (const u of ['admin', 'blue-co', 'red-co', 'umpire-1', 'blue-obs']) {
    clients[u] = await connect(u, { resource: uniq('s2'), onCreate: (c) => (logs[u] = captureStanzas(c).lines) });
  }
  // Seed one item in each objectives node so reads have something to return.
  await publishJson(clients.admin!, nodes.objectives('blue'), { text: 'take the bridge' }, 'seed');
  await publishJson(clients.admin!, nodes.objectives('red'), { text: 'hold the hill' }, 'seed');
  await publishJson(clients.admin!, nodes.announcements, { text: 'welcome' }, 'seed');
});

afterAll(async () => {
  for (const [u, lines] of Object.entries(logs)) await saveStanzas(`S2-${u}`, lines);
  await disconnectAll();
});

describe('S2 objectives confidentiality', () => {
  it('red-co cannot fetch objectives:blue items', async () => {
    const r = await outcome(clients['red-co']!.getItems(svc(), nodes.objectives('blue')));
    await observe('S2', 'red-co getItems objectives:blue', r);
    expect(r.ok).toBe(false);
  });

  it('red-co cannot fetch a single objectives:blue item by id', async () => {
    const r = await outcome(clients['red-co']!.getItem(svc(), nodes.objectives('blue'), 'seed'));
    expect(r.ok).toBe(false);
  });

  it('red-co cannot subscribe to objectives:blue', async () => {
    const r = await outcome(clients['red-co']!.subscribeToNode(svc(), nodes.objectives('blue')));
    await observe('S2', 'red-co subscribe objectives:blue', r);
    expect(r.ok).toBe(false);
  });

  it('red-co cannot discover the items of objectives:blue', async () => {
    const r = await outcome(clients['red-co']!.getDiscoItems(svc(), nodes.objectives('blue')));
    const items = r.ok ? ((r.value as { items?: unknown[] }).items ?? []) : [];
    await observe('S2', 'red-co disco#items objectives:blue', r.ok ? { items: items.length } : r);
    expect(items).toHaveLength(0);
  });

  it('blue-co can read objectives:blue but cannot publish to it', async () => {
    const read = await outcome(clients['blue-co']!.getItems(svc(), nodes.objectives('blue')));
    expect(read.ok).toBe(true);
    const pub = await outcome(publishJson(clients['blue-co']!, nodes.objectives('blue'), { text: 'nope' }));
    await observe('S2', 'blue-co publish objectives:blue', pub);
    expect(pub.ok).toBe(false);
  });

  it('blue-co cannot read objectives:red', async () => {
    const r = await outcome(clients['blue-co']!.getItems(svc(), nodes.objectives('red')));
    expect(r.ok).toBe(false);
  });

  it.each(['blue', 'red'] as const)('umpire-1 can read and publish objectives:%s', async (f) => {
    expect((await outcome(clients['umpire-1']!.getItems(svc(), nodes.objectives(f)))).ok).toBe(true);
    expect((await outcome(publishJson(clients['umpire-1']!, nodes.objectives(f), { text: `umpire ${f}` }))).ok).toBe(true);
  });
});

describe('S2 announcements', () => {
  it.each(roles.map((r) => r.id))('%s can read announcements', async (u) => {
    const c = clients[u] ?? (clients[u] = await connect(u, { resource: uniq('s2') }));
    expect((await outcome(c.getItems(svc(), nodes.announcements))).ok).toBe(true);
  });

  it('only admin can publish announcements', async () => {
    expect((await outcome(publishJson(clients.admin!, nodes.announcements, { text: 'admin says' }))).ok).toBe(true);
    for (const u of ['blue-co', 'umpire-1', 'red-co']) {
      const r = await outcome(publishJson(clients[u]!, nodes.announcements, { text: `${u} says` }));
      expect(r.ok, `${u} published to announcements`).toBe(false);
    }
  });
});

describe('S2 live ACL changes apply to online sessions', () => {
  it('adding red-co to objectives:blue whitelist grants read; removing revokes it', async () => {
    const node = nodes.objectives('blue');
    const red = clients['red-co']!;
    expect((await outcome(red.getItems(svc(), node))).ok).toBe(false);
    await clients.admin!.updateNodeAffiliations(svc(), node, [{ jid: bare('red-co'), affiliation: 'member' }]);
    expect((await outcome(red.getItems(svc(), node))).ok).toBe(true);
    await clients.admin!.updateNodeAffiliations(svc(), node, [{ jid: bare('red-co'), affiliation: 'none' }]);
    expect((await outcome(red.getItems(svc(), node))).ok).toBe(false);
  });

  it('granting and revoking publisher applies to an online session', async () => {
    const node = nodes.objectives('blue');
    const blue = clients['blue-co']!;
    await clients.admin!.updateNodeAffiliations(svc(), node, [{ jid: bare('blue-co'), affiliation: 'publisher' }]);
    expect((await outcome(publishJson(blue, node, { text: 'now allowed' }))).ok).toBe(true);
    await clients.admin!.updateNodeAffiliations(svc(), node, [{ jid: bare('blue-co'), affiliation: 'member' }]);
    expect((await outcome(publishJson(blue, node, { text: 'revoked' }))).ok).toBe(false);
  });
});
