// S12 Live changes (advisory, D23/ADM-25): move an online player between forces; delete an online user.
// Mutates the fixture, so the fixture is re-provisioned afterwards.

import { afterAll, describe, expect, it } from 'vitest';
import { serverConfig } from '../config.js';
import { captureStanzas, connect, disconnectAll, joinRoom, observe, outcome, saveStanzas, uniq, type Client } from '../harness.js';
import { nodes, PASSWORD } from '../fixtures/game.js';
import { adapterFor } from '../provision/index.js';
import { admin as ops } from '../provision/xmpp-admin.js';

const cfg = () => serverConfig();
const bare = (u: string) => `${u}@${cfg().domain}`;
const room = (id: string) => `${id}@${cfg().mucDomain}`;

afterAll(async () => {
  await disconnectAll();
  await (await adapterFor()).provision();
});

/** Record every stanza the session receives, in order, as a compact summary. */
function timeline(c: Client) {
  const events: string[] = [];
  type S = { from?: string; type?: string; muc?: { affiliation?: string; role?: string; statusCodes?: string[] }; pubsub?: unknown };
  c.on('stanza', (raw) => {
    const s = raw as unknown as S;
    const muc = s.muc ? ` muc=${s.muc.affiliation ?? ''}/${s.muc.role ?? ''} codes=${(s.muc.statusCodes ?? []).join(',')}` : '';
    events.push(`${s.from ?? ''} type=${s.type ?? ''}${muc}${s.pubsub ? ' pubsub-event' : ''}`);
  });
  return events;
}

describe('S12 live changes', () => {
  it('moves online blue-co from blue to red: grant red first, then revoke blue', async () => {
    let lines: string[] = [];
    const co = await connect('blue-co', { resource: uniq('s12'), onCreate: (c) => (lines = captureStanzas(c).lines) });
    await joinRoom(co, room('blue-hq'), 'blue-co');
    const events = timeline(co);
    const a = await connect('admin', { resource: uniq('s12a') });

    // Grant new access.
    await a.setRoomAffiliation(room('red-hq'), bare('blue-co'), 'member');
    await a.updateNodeAffiliations(cfg().pubsubDomain, nodes.objectives('red'), [{ jid: bare('blue-co'), affiliation: 'member' }]);
    const midRed = await outcome(co.getItems(cfg().pubsubDomain, nodes.objectives('red')));
    const midBlue = await outcome(co.getItems(cfg().pubsubDomain, nodes.objectives('blue')));
    const joinRed = await outcome(joinRoom(co, room('red-hq'), 'blue-co'));
    await observe('S12', 'after grant, before revoke: red objectives / blue objectives / join red-hq', {
      red: midRed.ok,
      blue: midBlue.ok,
      joinRed: joinRed.ok,
    });
    expect(midRed.ok && midBlue.ok && joinRed.ok).toBe(true);

    // Revoke old access.
    await a.setRoomAffiliation(room('blue-hq'), bare('blue-co'), 'none');
    await a.updateNodeAffiliations(cfg().pubsubDomain, nodes.objectives('blue'), [{ jid: bare('blue-co'), affiliation: 'none' }]);
    await new Promise((r) => setTimeout(r, 1_000));
    const afterBlue = await outcome(co.getItems(cfg().pubsubDomain, nodes.objectives('blue')));
    await observe('S12', 'after revoke: blue objectives readable', afterBlue.ok);
    await observe('S12', 'stanzas the online session received during the move (in order)', events);
    await saveStanzas('S12-move-force', lines);
    expect(afterBlue.ok).toBe(false);
  });

  it('deletes an online user and records what its session sees', async () => {
    const a = await connect('admin', { resource: uniq('s12a') });
    const temp = uniq('s12user');
    await ops.addUser(a, cfg().domain, bare(temp), PASSWORD);
    await a.setRoomAffiliation(room('blue-hq'), bare(temp), 'member');
    let lines: string[] = [];
    const u = await connect(temp, { resource: uniq('t'), onCreate: (c) => (lines = captureStanzas(c).lines) });
    await joinRoom(u, room('blue-hq'), temp);
    const watcher = await connect('umpire-1', { resource: uniq('w') });
    const wEvents: string[] = [];
    watcher.on('presence', (p) => {
      if (p.from === `${room('blue-hq')}/${temp}`) wEvents.push(p.type ?? 'available');
    });
    await joinRoom(watcher, room('blue-hq'), 'umpire-1');
    const ended = new Promise<string>((res) => {
      u.on('stream:error', (e) => res(`stream:error ${e.condition}`));
      u.on('disconnected', () => res('disconnected'));
    });
    await ops.deleteUser(a, cfg().domain, bare(temp));
    const how = await Promise.race([ended, new Promise<string>((r) => setTimeout(() => r('still connected'), 5_000))]);
    await new Promise((r) => setTimeout(r, 500));
    await observe('S12', 'deleted online user: session outcome', how);
    await observe('S12', 'deleted online user: room presence seen by others', wEvents);
    const affs = await a.getRoomMembers(room('blue-hq'), { affiliation: 'member' });
    await observe('S12', 'deleted user still listed as room member', (affs.muc?.users ?? []).some((x) => String(x.jid) === bare(temp)));
    await saveStanzas('S12-deleted-user', lines);
    expect(how).not.toBe('still connected');
  });
});
