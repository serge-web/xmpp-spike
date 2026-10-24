// S11 Same role, two sessions (D22): two blue-co resources join blue-hq with the same nickname.

import { afterAll, describe, expect, it } from 'vitest';
import { serverConfig } from '../config.js';
import { captureStanzas, collect, connect, disconnectAll, joinRoom, observe, outcome, saveStanzas, uniq, waitFor } from '../harness.js';

const room = () => `blue-hq@${serverConfig().mucDomain}`;
afterAll(disconnectAll);

describe('S11 same role, two sessions', () => {
  it('both sessions join with the same nick, both receive messages, a post appears once to others', async () => {
    const logs: Record<string, string[]> = {};
    const s1 = await connect('blue-co', { resource: uniq('tab1'), onCreate: (c) => (logs.s1 = captureStanzas(c).lines) });
    const s2 = await connect('blue-co', { resource: uniq('tab2'), onCreate: (c) => (logs.s2 = captureStanzas(c).lines) });
    const other = await connect('umpire-1', { resource: uniq('ump'), onCreate: (c) => (logs.other = captureStanzas(c).lines) });
    await joinRoom(other, room(), 'umpire-1');
    const othersSeeJoins = collect(other, 'presence', (p) => p.from === `${room()}/blue-co`, 2_000);
    await joinRoom(s1, room(), 'blue-co');
    const second = await outcome(joinRoom(s2, room(), 'blue-co'));
    await observe('S11', 'second session same nick join', second.ok ? 'joined' : second);
    expect(second.ok).toBe(true);
    await observe('S11', 'presences umpire saw for blue-co joins', (await othersSeeJoins).length);

    const fromOther = uniq('from-umpire');
    const both = Promise.all([waitFor(s1, 'message', (m) => m.body === fromOther), waitFor(s2, 'message', (m) => m.body === fromOther)]);
    other.sendMessage({ to: room(), type: 'groupchat', body: fromOther });
    await both;

    const fromS1 = uniq('from-s1');
    const seenByOther = collect(other, 'message', (m) => m.body === fromS1, 1_500);
    const seenByS2 = collect(s2, 'message', (m) => m.body === fromS1, 1_500);
    s1.sendMessage({ to: room(), type: 'groupchat', body: fromS1 });
    const [o, t] = await Promise.all([seenByOther, seenByS2]);
    await observe('S11', 'post from session 1: copies seen by umpire / by session 2', { umpire: o.length, session2: t.length });
    expect(o).toHaveLength(1);

    const othersSeeLeave = collect(other, 'presence', (p) => p.from === `${room()}/blue-co`, 1_500);
    await s1.leaveRoom(room(), 'blue-co');
    const leavePresences = (await othersSeeLeave).map((p) => p.type ?? 'available');
    await observe('S11', 'presences umpire saw when session 1 left', leavePresences);
    const stillThere = uniq('still');
    const s2Gets = waitFor(s2, 'message', (m) => m.body === stillThere);
    other.sendMessage({ to: room(), type: 'groupchat', body: stillThere });
    await s2Gets;
    for (const [k, v] of Object.entries(logs)) await saveStanzas(`S11-${k}`, v);
  });
});
