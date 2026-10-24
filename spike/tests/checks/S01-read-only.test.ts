// S1 Read-only members (R1): blue-obs can never post in its rooms, enforced by the server,
// surviving reconnection, with no moderator online.

import { afterAll, describe, expect, it } from 'vitest';
import { serverConfig } from '../config.js';
import { captureStanzas, collect, connect, disconnectAll, joinRoom, observe, saveStanzas, sendRaw, uniq, waitFor } from '../harness.js';

const room = () => `blue-hq@${serverConfig().mucDomain}`;
const isBody = (body: string) => (s: { body?: string }) => s.body === body;

afterAll(disconnectAll);

/** blue-obs attempts a post; returns the error condition and what blue-co saw. */
async function attemptPost(raw: boolean, tag: string) {
  const co = await connect('blue-co', { resource: uniq('co') });
  await joinRoom(co, room(), 'blue-co');
  let lines: string[] = [];
  const obs = await connect('blue-obs', { resource: uniq('obs'), onCreate: (c) => (lines = captureStanzas(c).lines) });
  const occupants = collect(obs, 'presence', (p) => !!p.from?.startsWith(`${room()}/`), 1_000);
  const self = await joinRoom(obs, room(), 'blue-obs');
  // No moderator online: assert from the occupant presences blue-obs receives on join.
  const moderators = (await occupants).filter((p) => p.muc?.role === 'moderator');
  expect(moderators, 'a moderator is in the room').toHaveLength(0);
  const body = uniq('obs-post');
  const seenByCo = collect(co, 'message', (m) => m.body === body, 2_000);
  const errored = waitFor(obs, 'message', (m) => m.type === 'error', 3_000).catch(() => undefined);
  if (raw) {
    sendRaw(obs, `<message xmlns="jabber:client" to="${room()}" type="groupchat" id="${uniq('raw')}"><body>${body}</body></message>`);
  } else {
    obs.sendMessage({ to: room(), type: 'groupchat', body });
  }
  const [err, delivered] = await Promise.all([errored, seenByCo]);
  await saveStanzas(`S1-${tag}`, lines);
  return { role: self.muc?.role, affiliation: self.muc?.affiliation, err, delivered, obs, co };
}

describe('S1 read-only members', () => {
  it('blue-obs post (client API) is rejected by the server and not delivered', async () => {
    const r = await attemptPost(false, 'client-post');
    await observe('S1', 'blue-obs join + post', { role: r.role, affiliation: r.affiliation, error: r.err?.error });
    expect(r.delivered).toHaveLength(0);
    expect(r.err?.error?.condition).toBeTruthy();
    await disconnectAll();
  });

  it('blue-obs post (raw stanza) is rejected by the server and not delivered', async () => {
    const r = await attemptPost(true, 'raw-post');
    expect(r.delivered).toHaveLength(0);
    expect(r.err?.error?.condition).toBeTruthy();
    await disconnectAll();
  });

  it('rejection survives reconnection', async () => {
    await attemptPost(false, 'before-reconnect');
    await disconnectAll();
    const r = await attemptPost(false, 'after-reconnect');
    expect(r.delivered).toHaveLength(0);
    expect(r.err?.error?.condition).toBeTruthy();
    await disconnectAll();
  });

  it('blue-obs still receives history and live messages', async () => {
    const co = await connect('blue-co', { resource: uniq('co') });
    await joinRoom(co, room(), 'blue-co');
    const before = uniq('history');
    co.sendMessage({ to: room(), type: 'groupchat', body: before });
    await waitFor(co, 'message', isBody(before));

    const obs = await connect('blue-obs', { resource: uniq('obs') });
    const history = waitFor(obs, 'message', (m) => m.body === before && !!m.delay, 5_000);
    await joinRoom(obs, room(), 'blue-obs', { maxstanzas: 20 });
    await history;

    const live = uniq('live');
    const gotLive = waitFor(obs, 'message', isBody(live));
    co.sendMessage({ to: room(), type: 'groupchat', body: live });
    await gotLive;
    await disconnectAll();
  });
});
