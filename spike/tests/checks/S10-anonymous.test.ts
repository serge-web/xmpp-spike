// S10 Anonymous access limits (D20, NFR-21): SASL ANONYMOUS may read game-setup and theme assets only.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serverConfig } from '../config.js';
import { captureStanzas, connect, disconnectAll, observe, outcome, publishJson, saveStanzas, uniq, type Client } from '../harness.js';
import { nodes, rooms } from '../fixtures/game.js';
import { admin as ops } from '../provision/xmpp-admin.js';

const cfg = () => serverConfig();
let anon: Client;
let lines: string[] = [];

beforeAll(async () => {
  const a = await connect('admin', { resource: uniq('s10') });
  await publishJson(a, nodes.gameSetup, { title: 'Test game' }, 'current');
  await publishJson(a, nodes.assets('theme'), { logo: 'data:image/png;base64,AAAA' }, 'logo');
  await publishJson(a, nodes.objectives('blue'), { text: 'secret' }, 'seed');
  anon = await connect('', { anonymous: true, onCreate: (c) => (lines = captureStanzas(c).lines) });
  await observe('S10', 'anonymous JID', anon.jid);
});
afterAll(async () => {
  await saveStanzas('S10-anonymous', lines);
  await disconnectAll();
});

const itemsOf = (v: unknown) => ((v as { items?: unknown[] } | undefined)?.items ?? []).length;

describe('S10 anonymous can', () => {
  it('read game-setup', async () => {
    const r = await outcome(anon.getItems(cfg().pubsubDomain, nodes.gameSetup));
    expect(r.ok).toBe(true);
    expect(itemsOf(r.value)).toBeGreaterThan(0);
  });
  it('read theme assets', async () => {
    const r = await outcome(anon.getItems(cfg().pubsubDomain, nodes.assets('theme')));
    expect(r.ok).toBe(true);
  });
});

describe('S10 anonymous cannot', () => {
  it.each(['blue', 'red'] as const)('read objectives:%s', async (f) => {
    const r = await outcome(anon.getItems(cfg().pubsubDomain, nodes.objectives(f)));
    await observe('S10', `getItems objectives:${f}`, r.ok ? { items: itemsOf(r.value) } : r);
    expect(r.ok).toBe(false);
  });

  it.each([nodes.announcements, nodes.forces('blue'), nodes.roles('blue-co'), nodes.gameState])('read %s', async (node) => {
    const r = await outcome(anon.getItems(cfg().pubsubDomain, node));
    expect(r.ok, `anonymous read ${node}`).toBe(false);
  });

  it.each(rooms.map((r) => r.id))('join room %s', async (id) => {
    const r = await outcome(anon.joinRoom(`${id}@${cfg().mucDomain}`, uniq('anon')));
    await observe('S10', `join ${id}`, r.ok ? 'JOINED' : r);
    expect(r.ok).toBe(false);
  });

  it.each(rooms.map((r) => r.id))('query MAM of room %s', async (id) => {
    const r = await outcome(anon.searchHistory(`${id}@${cfg().mucDomain}`, { paging: { max: 5 } }));
    await observe('S10', `MAM ${id}`, r.ok ? { count: (r.value as { paging?: { count?: number } }).paging?.count } : r);
    expect(r.ok).toBe(false);
  });

  it('create a room', async () => {
    const r = await outcome(anon.joinRoom(`${uniq('anonroom')}@${cfg().mucDomain}`, 'anon'));
    await observe('S10', 'create room', r.ok ? 'CREATED' : r);
    expect(r.ok).toBe(false);
  });

  it('publish to game-setup', async () => {
    const r = await outcome(publishJson(anon, nodes.gameSetup, { hacked: true }));
    expect(r.ok).toBe(false);
  });

  it('create a node', async () => {
    const r = await outcome(anon.createNode(cfg().pubsubDomain, uniq('anonnode')));
    expect(r.ok).toBe(false);
  });

  it('list registered users via XEP-0133', async () => {
    const r = await outcome(ops.registeredUsers(anon, cfg().domain));
    expect(r.ok).toBe(false);
  });

  it('list nodes beyond the welcome page (disco#items on the PubSub service)', async () => {
    const r = await outcome(anon.getDiscoItems(cfg().pubsubDomain));
    const names = r.ok ? ((r.value as { items?: Array<{ node?: string }> }).items ?? []).map((i) => i.node ?? '') : [];
    await observe('S10', 'disco#items pubsub service', r.ok ? names : r);
    const allowed = new Set([nodes.gameSetup, nodes.assets('theme')]);
    expect(names.filter((n) => !allowed.has(n))).toEqual([]);
  });

  it('list rooms (disco#items on the MUC service)', async () => {
    const r = await outcome(anon.getDiscoItems(cfg().mucDomain));
    const names = r.ok ? ((r.value as { items?: Array<{ jid?: unknown }> }).items ?? []).map((i) => String(i.jid)) : [];
    await observe('S10', 'disco#items muc service', r.ok ? names : r);
    expect(names).toEqual([]);
  });

  it('discover users or a user directory on the server', async () => {
    const r = await outcome(anon.getDiscoItems(cfg().domain));
    const items = r.ok ? ((r.value as { items?: Array<{ jid?: unknown; name?: string }> }).items ?? []).map((i) => `${String(i.jid)} ${i.name ?? ''}`) : [];
    await observe('S10', 'disco#items server', r.ok ? items : r);
    // Services (muc, pubsub) are fine; no user JIDs (user@domain) may be listed.
    expect(items.filter((i) => i.includes('@'))).toEqual([]);
  });
});
