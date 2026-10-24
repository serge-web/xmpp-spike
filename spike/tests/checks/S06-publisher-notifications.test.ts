// S6 Publisher notifications (record only): own-event delivery, payload in notifications, ordering.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serverConfig } from '../config.js';
import { captureStanzas, collect, connect, disconnectAll, observe, publishJson, saveStanzas, uniq, type Client } from '../harness.js';
import { nodes } from '../fixtures/game.js';

const svc = () => serverConfig().pubsubDomain;
const node = nodes.objectives('blue');
let pub: Client;
let sub: Client;
const logs: Record<string, string[]> = {};

type Ev = { pubsub?: { items?: { node?: string; published?: Array<{ id?: string; content?: { json?: { seq?: number } } }> } } };
const published = (m: Ev) => (m.pubsub?.items?.node === node ? (m.pubsub.items.published ?? []) : []);

beforeAll(async () => {
  pub = await connect('umpire-1', { resource: uniq('s6pub'), onCreate: (c) => (logs.pub = captureStanzas(c).lines) });
  sub = await connect('blue-co', { resource: uniq('s6sub'), onCreate: (c) => (logs.sub = captureStanzas(c).lines) });
  for (const c of [pub, sub]) {
    await c.unsubscribeFromNode(svc(), { node, jid: c.jid.split('/')[0]! }).catch(() => undefined);
    await c.subscribeToNode(svc(), node);
  }
});
afterAll(async () => {
  for (const c of [pub, sub]) await c.unsubscribeFromNode(svc(), { node, jid: c.jid.split('/')[0]! }).catch(() => undefined);
  await saveStanzas('S6-publisher', logs.pub ?? []);
  await saveStanzas('S6-subscriber', logs.sub ?? []);
  await disconnectAll();
});

describe('S6 publisher notifications', () => {
  it('records whether the publisher gets an event for its own publish, and whether payloads are included', async () => {
    const id = uniq('s6');
    const pubEvents = collect(pub, 'message', (m) => published(m as Ev).some((i) => i.id === id), 2_000);
    const subEvents = collect(sub, 'message', (m) => published(m as Ev).some((i) => i.id === id), 2_000);
    await publishJson(pub, node, { seq: 0 }, id);
    const [p, s] = await Promise.all([pubEvents, subEvents]);
    const payloadIncluded = published(s[0] as Ev)[0]?.content?.json !== undefined;
    await observe('S6', 'publisher (subscribed) receives own event', p.length > 0);
    await observe('S6', 'subscriber notification carries payload', payloadIncluded);
    await observe('S6', 'notification message type', (s[0] as { type?: string } | undefined)?.type ?? null);
    expect(s.length).toBeGreaterThan(0);
  });

  it('records arrival order of two publishes made back-to-back', async () => {
    const tag = uniq('s6o');
    const got = collect(sub, 'message', (m) => published(m as Ev).some((i) => i.id?.startsWith(tag)), 2_500);
    const acks = [publishJson(pub, node, { seq: 1 }, `${tag}-1`), publishJson(pub, node, { seq: 2 }, `${tag}-2`)];
    await Promise.all(acks);
    const order = (await got).flatMap((m) => published(m as Ev).map((i) => i.id));
    await observe('S6', 'subscriber event order for publish 1 then 2', order);
    expect(order).toHaveLength(2);
  });
});
