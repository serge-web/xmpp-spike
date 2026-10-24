// C01 Admin-tooling contract (de-risking): the AdminOps rules R-A..R-E (provision/admin-ops.ts) hold
// against the live server. Uses its own temporary users, room and nodes, so the §4 fixture is untouched.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serverConfig } from '../config.js';
import { collect, connect, disconnectAll, joinRoom, observe, outcome, publishJson, uniq, waitFor, type Client } from '../harness.js';
import { AdminOps } from '../provision/admin-ops.js';
import { adapterFor } from '../provision/index.js';
import { admin as adhoc, ensureNode, ensureRoom, errorCondition, nodeSubscribers } from '../provision/xmpp-admin.js';

const PW = 'c01-password';
const tag = uniq('c01');
const player = `${tag}-player`;
const watcher = `${tag}-obs`;
const roomA = `${tag}-a`;
const roomB = `${tag}-b`;
const nodeA = `${tag}:a`;
const nodeB = `${tag}:b`;
const cfg = () => serverConfig();
const bare = (u: string) => `${u}@${cfg().domain}`;
const roomJid = (r: string) => `${r}@${cfg().mucDomain}`;

let a: Client;
let ops: AdminOps;

beforeAll(async () => {
  const { profile } = await adapterFor();
  a = await connect('admin', { resource: uniq('c01') });
  ops = new AdminOps(a, profile);
  for (const u of [player, watcher]) {
    try {
      await adhoc.addUser(a, cfg().domain, bare(u), PW);
    } catch (e) {
      if (errorCondition(e) !== 'conflict') throw e;
    }
  }
  for (const r of [roomA, roomB]) await ensureRoom(a, roomJid(r), profile.roomConfig, {});
  const nodeConfig = { 'pubsub#access_model': 'whitelist', 'pubsub#publish_model': 'publishers', 'pubsub#max_items': '10' };
  for (const n of [nodeA, nodeB]) await ensureNode(a, cfg().pubsubDomain, n, nodeConfig, []);
  await publishJson(a, nodeA, { v: 'a' }, 'seed');
  await publishJson(a, nodeB, { v: 'b' }, 'seed');
});

afterAll(async () => {
  await disconnectAll();
  const c = await connect('admin', { resource: uniq('c01-clean') });
  for (const n of [nodeA, nodeB]) await c.deleteNode(cfg().pubsubDomain, n).catch(() => undefined);
  for (const r of [roomA, roomB]) await c.destroyRoom(roomJid(r)).catch(() => undefined);
  for (const u of [player, watcher]) await adhoc.deleteUser(c, cfg().domain, bare(u)).catch(() => undefined);
  await disconnectAll();
});

describe('C01 admin-tooling contract', () => {
  it('R-A revokeNode cuts a subscribed reader off: no read, no events, no re-subscribe', async () => {
    await ops.grantNode(player, { node: nodeA, level: 'read' });
    const p = await connect(player, { password: PW, resource: uniq('p') });
    await p.subscribeToNode(cfg().pubsubDomain, nodeA);
    expect((await outcome(p.getItems(cfg().pubsubDomain, nodeA))).ok).toBe(true);

    await ops.revokeNode(player, nodeA);
    const events = collect(p, 'message', (m) => !!m.pubsub, 1_500);
    await publishJson(a, nodeA, { v: 'after-revoke' });
    const read = await outcome(p.getItems(cfg().pubsubDomain, nodeA));
    const resub = await outcome(p.subscribeToNode(cfg().pubsubDomain, nodeA));
    const r = { read: read.ok, events: (await events).length, resubscribe: resub.ok ? 'allowed' : resub.condition };
    await observe('C01', 'R-A after revokeNode', r);
    expect(r).toEqual({ read: false, events: 0, resubscribe: expect.not.stringMatching(/^allowed$/) });
    expect(await nodeSubscribers(a, cfg().pubsubDomain, nodeA)).not.toContain(bare(player));
    p.disconnect();
  });

  it('R-B addToRoom keeps an observer voiceless; a raw affiliation round-trip does not (hazard)', async () => {
    const role = async () => {
      const o = await connect(watcher, { password: PW, resource: uniq('o') });
      const r = (await joinRoom(o, roomJid(roomA), watcher)).muc?.role;
      o.disconnect();
      return r;
    };
    await ops.addToRoom(watcher, { room: roomA, observer: true }, PW);
    const viaHelper = await role();
    await a.setRoomAffiliation(roomJid(roomA), bare(watcher), 'none');
    await a.setRoomAffiliation(roomJid(roomA), bare(watcher), 'member');
    const afterRawRoundTrip = await role();
    await ops.addToRoom(watcher, { room: roomA, observer: true }, PW);
    const afterHelperAgain = await role();
    await observe('C01', 'R-B observer role: helper / raw none->member / helper again', { viaHelper, afterRawRoundTrip, afterHelperAgain });
    expect(viaHelper).toBe('visitor');
    expect(afterHelperAgain).toBe('visitor');
  });

  it('R-B addToRoom refuses an observer without the password (cannot re-apply voice)', async () => {
    const { profile } = await adapterFor();
    if (!profile.revokeObserverVoice) return expect(profile.revokeObserverVoice).toBe(false);
    await expect(ops.addToRoom(watcher, { room: roomA, observer: true })).rejects.toThrow(/R-B/);
  });

  it('R-B precondition: an observer cannot change its own password (admin keeps control)', async () => {
    const o = await connect(watcher, { password: PW, resource: uniq('o') });
    const r = await outcome(o.sendIQ({ type: 'set', to: cfg().domain, account: { username: watcher, password: 'self-chosen' } } as never));
    await observe('C01', 'observer XEP-0077 password change', r.ok ? 'ALLOWED' : r);
    expect(r.ok).toBe(false);
    o.disconnect();
    expect((await connect(watcher, { password: PW, resource: uniq('o') })).sessionStarted).toBe(true);
  });

  it('R-F destroying a room also deletes its MAM archive (game retention = room lifetime)', async () => {
    const { profile } = await adapterFor();
    const tmp = roomJid(`${tag}-ret`);
    await ensureRoom(a, tmp, profile.roomConfig, { [bare(player)]: 'member' });
    const p = await connect(player, { password: PW, resource: uniq('p') });
    await joinRoom(p, tmp, player);
    const body = uniq('retained');
    p.sendMessage({ to: tmp, type: 'groupchat', body });
    await waitFor(p, 'message', (m) => m.body === body);
    p.disconnect();
    await a.destroyRoom(tmp);
    await ensureRoom(a, tmp, profile.roomConfig, {});
    const fin = await a.searchHistory(tmp, { paging: { max: 0 } });
    await observe('C01', 'MAM count after destroy + recreate', fin.paging?.count ?? 0);
    expect(fin.paging?.count ?? 0).toBe(0);
    await a.destroyRoom(tmp);
  });

  it('R-C ensureModerated finds and fixes an unmoderated room; observer is a visitor again', async () => {
    await a.joinRoom(roomJid(roomA), 'admin');
    await a.configureRoom(roomJid(roomA), {
      type: 'submit',
      fields: [
        { name: 'FORM_TYPE', type: 'hidden', value: 'http://jabber.org/protocol/muc#roomconfig' },
        { name: 'muc#roomconfig_moderatedroom', value: false },
      ],
    });
    await a.leaveRoom(roomJid(roomA), 'admin');
    expect(await ops.ensureModerated([roomA], false)).toEqual([roomA]);
    expect(await ops.ensureModerated([roomA], true)).toEqual([roomA]);
    expect(await ops.ensureModerated([roomA], false)).toEqual([]);
    const o = await connect(watcher, { password: PW, resource: uniq('o') });
    expect((await joinRoom(o, roomJid(roomA), watcher)).muc?.role).toBe('visitor');
    o.disconnect();
  });

  it('R-D moveRole (online player): new access works, old room ejects (321), old node closed', async () => {
    await ops.addToRoom(player, { room: roomA, observer: false });
    await ops.grantNode(player, { node: nodeA, level: 'read' });
    const p = await connect(player, { password: PW, resource: uniq('p') });
    await joinRoom(p, roomJid(roomA), player);
    await p.subscribeToNode(cfg().pubsubDomain, nodeA);
    const ejected = waitFor(p, 'presence', (s) => s.from === `${roomJid(roomA)}/${player}` && s.type === 'unavailable', 5_000);

    await ops.moveRole(
      player,
      { rooms: [{ room: roomA, observer: false }], nodes: [{ node: nodeA, level: 'read' }] },
      { rooms: [{ room: roomB, observer: false }], nodes: [{ node: nodeB, level: 'read' }] },
    );
    const kick = (await ejected) as { muc?: { statusCodes?: string[] } };
    const r = {
      ejectedCodes: kick.muc?.statusCodes ?? [],
      readOld: (await outcome(p.getItems(cfg().pubsubDomain, nodeA))).ok,
      readNew: (await outcome(p.getItems(cfg().pubsubDomain, nodeB))).ok,
      joinNew: (await outcome(joinRoom(p, roomJid(roomB), player))).ok,
      rejoinOld: (await outcome(joinRoom(p, roomJid(roomA), `${player}-2`))).ok,
    };
    await observe('C01', 'R-D after moveRole', r);
    expect(r).toMatchObject({ readOld: false, readNew: true, joinNew: true, rejoinOld: false });
    p.disconnect();
  });

  it('R-E deleteRole removes the account and every room/node trace', async () => {
    const p = await connect(player, { password: PW, resource: uniq('p') });
    await joinRoom(p, roomJid(roomB), player);
    await p.subscribeToNode(cfg().pubsubDomain, nodeB).catch(() => undefined);
    await ops.deleteRole(player, { rooms: [roomB], nodes: [nodeB] });

    const members = await a.getRoomMembers(roomJid(roomB), { affiliation: 'member' });
    const affs = await a.getNodeAffiliations(cfg().pubsubDomain, nodeB);
    const r = {
      roomMember: (members.muc?.users ?? []).some((u) => String(u.jid) === bare(player)),
      nodeAffiliation: (affs.items ?? []).some((i) => String(i.jid) === bare(player)),
      subscribed: (await nodeSubscribers(a, cfg().pubsubDomain, nodeB)).includes(bare(player)),
      canLogin: await connect(player, { password: PW, resource: uniq('p') }).then(
        () => true,
        () => false,
      ),
    };
    await observe('C01', 'R-E after deleteRole', r);
    expect(r).toEqual({ roomMember: false, nodeAffiliation: false, subscribed: false, canLogin: false });
  });
});
