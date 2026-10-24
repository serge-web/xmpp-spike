// S5 MAM paging at scale: 10,000 messages, page backwards with RSM before=<uid> (50 and 200),
// verify no gaps/duplicates/order, time pages, and record how join history relates to MAM.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serverConfig } from '../config.js';
import { captureStanzas, connect, disconnectAll, joinRoom, observe, saveStanzas, uniq, waitFor, type Client } from '../harness.js';
import { ensureRoom } from '../provision/xmpp-admin.js';

const TOTAL = 10_000;
const room = () => `s5-mam@${serverConfig().mucDomain}`;
const label = (i: number) => `s5-${String(i).padStart(5, '0')}`;

afterAll(disconnectAll);

async function archivedCount(c: Client): Promise<number> {
  const fin = await c.searchHistory(room(), { paging: { max: 0 } });
  return fin.paging?.count ?? 0;
}

beforeAll(async () => {
  const admin = await connect('admin', { resource: uniq('s5') });
  await ensureRoom(admin, room(), { 'muc#roomconfig_persistentroom': true, 'muc#roomconfig_membersonly': true, 'muc#roomconfig_publicroom': false }, {
    [`blue-co@${serverConfig().domain}`]: 'member',
  });
  const seeder = await connect('blue-co', { resource: uniq('s5seed') });
  await joinRoom(seeder, room(), 'seeder');
  const have = await archivedCount(seeder);
  if (have < TOTAL) {
    const t0 = Date.now();
    for (let i = have; i < TOTAL; i++) {
      seeder.sendMessage({ to: room(), type: 'groupchat', body: label(i) });
      if (i % 500 === 499) await waitFor(seeder, 'message', (m) => m.body === label(i), 60_000);
    }
    await waitFor(seeder, 'message', (m) => m.body === label(TOTAL - 1), 60_000).catch(() => undefined);
    await observe('S5', 'seed time (ms)', { seeded: TOTAL - have, ms: Date.now() - t0 });
  }
  await disconnectAll();
}, 600_000);

describe('S5 MAM paging', () => {
  it.each([50, 200])('pages backwards from latest to start with max=%i: complete, ordered, no duplicates', async (max) => {
    const c = await connect('blue-co', { resource: uniq('s5read') });
    const bodies: string[] = [];
    const ids: string[] = [];
    const pageMs: number[] = [];
    let before = '';
    let complete = false;
    let pages = 0;
    const t0 = Date.now();
    while (!complete && pages < TOTAL) {
      const items: Array<{ id: string; body?: string }> = [];
      const onItem = (m: { archive?: { id?: string; item?: { message?: { body?: string } } } }) => {
        if (m.archive?.id) items.push({ id: m.archive.id, ...(m.archive.item?.message?.body ? { body: m.archive.item.message.body } : {}) });
      };
      c.on('mam:item', onItem as never);
      const p0 = Date.now();
      const fin = await c.searchHistory(room(), { paging: { max, before } });
      pageMs.push(Date.now() - p0);
      c.off('mam:item', onItem as never);
      pages++;
      // Each page arrives oldest-first; prepend so the overall array is chronological.
      bodies.unshift(...items.map((i) => i.body ?? ''));
      ids.unshift(...items.map((i) => i.id));
      complete = !!fin.complete || items.length === 0;
      before = fin.paging?.first ?? items[0]?.id ?? '';
      if (!before) break;
    }
    const seeded = bodies.filter((b) => b.startsWith('s5-'));
    const expected = Array.from({ length: TOTAL }, (_, i) => label(i));
    const summary = {
      max,
      pages,
      totalMs: Date.now() - t0,
      avgPageMs: Math.round(pageMs.reduce((a, b) => a + b, 0) / pageMs.length),
      maxPageMs: Math.max(...pageMs),
      items: ids.length,
      duplicateIds: ids.length - new Set(ids).size,
      completeFlagSeen: complete,
    };
    await observe('S5', `paging max=${max}`, summary);
    expect(summary.duplicateIds).toBe(0);
    expect(seeded).toEqual(expected);
  }, 300_000);

  it('records how join history relates to MAM (stanza-id, delay, stable ids)', async () => {
    // Join history may be in-memory only (ejabberd loses it on restart), so post fresh messages first.
    const poster = await connect('blue-co', { resource: uniq('s5post') });
    await joinRoom(poster, room(), uniq('poster'));
    for (let i = 0; i < 5; i++) {
      const body = uniq('s5-fresh');
      poster.sendMessage({ to: room(), type: 'groupchat', body });
      await waitFor(poster, 'message', (m) => m.body === body);
    }
    let lines: string[] = [];
    const c = await connect('blue-co', { resource: uniq('s5join'), onCreate: (x) => (lines = captureStanzas(x).lines) });
    const history: Array<{ body?: string; stanzaIds?: unknown; delay?: unknown }> = [];
    const onMsg = (m: { body?: string; delay?: unknown; stanzaIds?: unknown; from?: string }) => {
      if (m.from?.startsWith(room()) && m.delay) history.push({ ...(m.body ? { body: m.body } : {}), stanzaIds: m.stanzaIds, delay: m.delay });
    };
    c.on('message', onMsg as never);
    await joinRoom(c, room(), uniq('reader'), { maxstanzas: 5 });
    await new Promise((r) => setTimeout(r, 1_000));
    c.off('message', onMsg as never);

    const mam: Array<{ id: string; body?: string; delay?: unknown }> = [];
    const onItem = (m: { archive?: { id: string; item?: { message?: { body?: string }; delay?: unknown } } }) => {
      if (m.archive) mam.push({ id: m.archive.id, ...(m.archive.item?.message?.body ? { body: m.archive.item.message.body } : {}), delay: m.archive.item?.delay });
    };
    c.on('mam:item', onItem as never);
    await c.searchHistory(room(), { paging: { max: 5, before: '' } });
    c.off('mam:item', onItem as never);
    await saveStanzas('S5-join-history-vs-mam', lines);

    await observe('S5', 'join history (maxstanzas=5)', history);
    await observe('S5', 'MAM latest 5', mam);
    const historyIds = history.map((h) => JSON.stringify(h.stanzaIds));
    await observe('S5', 'join history carries stanza-id', historyIds.some((x) => x.includes(serverConfig().mucDomain)));
    expect(history.length).toBeGreaterThan(0);
    expect(mam.length).toBe(5);
  });
});
