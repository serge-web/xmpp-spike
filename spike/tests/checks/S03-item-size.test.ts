// S3 Item size (R11): ~100 KB JSON item with base64 image data; find the actual limits.

import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { serverConfig } from '../config.js';
import { connect, disconnectAll, NS_JSON, observe, outcome, publishJson, uniq, type Client } from '../harness.js';
import { nodes } from '../fixtures/game.js';

const svc = () => serverConfig().pubsubDomain;
afterAll(disconnectAll);

/** JSON payload whose serialised size is ~`bytes`. */
const payload = (bytes: number) => ({ kind: 'image', data: randomBytes(Math.ceil((bytes * 3) / 4)).toString('base64').slice(0, bytes) });

async function roundTrip(admin: Client, node: string, bytes: number) {
  const id = uniq('s3');
  const json = payload(bytes);
  const pub = await outcome(publishJson(admin, node, json, id));
  if (!pub.ok) return { ...pub, ok: false as const, stage: 'publish' };
  const got = await outcome(admin.getItem(svc(), node, id));
  if (!got.ok) return { ...got, ok: false as const, stage: 'fetch' };
  const content = (got.value as { content?: { itemType?: string; json?: { data?: string } } }).content;
  return { ok: content?.itemType === NS_JSON && content.json?.data === json.data, stage: 'compare' as const };
}

describe('S3 item size', () => {
  it('publishes and fetches a ~100 KB JSON item', async () => {
    const admin = await connect('admin', { resource: uniq('s3') });
    const r = await roundTrip(admin, nodes.assets('theme'), 100 * 1024);
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
  });

  it('records the largest item that round-trips on a default node', async () => {
    const r = await search(nodes.assets('theme'));
    await observe('S3', 'default node: largest round-trip bytes (64KB granularity)', r);
    expect(r.lo).toBeGreaterThanOrEqual(100 * 1024);
  }, 300_000);

  it('records whether a node owner can raise max_payload_size to 8 MB, and the limit then', async () => {
    const admin = await connect('admin', { resource: uniq('s3') });
    const node = 's3-big';
    await admin.deleteNode(svc(), node).catch(() => undefined);
    const created = await outcome(
      admin.createNode(svc(), node, {
        type: 'submit',
        fields: [
          { name: 'FORM_TYPE', type: 'hidden', value: 'http://jabber.org/protocol/pubsub#node_config' },
          { name: 'pubsub#max_payload_size', value: String(8 * 1024 * 1024) },
        ],
      }),
    );
    await observe('S3', 'create node with max_payload_size=8MB', created.ok ? 'ok' : created.condition);
    if (!created.ok) {
      // Node owners can't exceed the server's cap; that's the finding (raise it in server config instead).
      expect(created.condition).toBeTruthy();
      return;
    }
    const r = await search(node);
    await observe('S3', 'raised node: largest round-trip bytes (64KB granularity)', r);
    await disconnectAll();
    const again = await connect('admin', { resource: uniq('s3') });
    await again.deleteNode(svc(), node).catch(() => undefined);
    expect(r.lo).toBeGreaterThanOrEqual(100 * 1024);
  }, 300_000);
});

/** Binary search (64 KB granularity, 100 KB..4 MB) for the largest item that publishes and fetches intact. */
async function search(node: string) {
    let admin = await connect('admin', { resource: uniq('s3') });
    let lo = 100 * 1024;
    let hi = 4 * 1024 * 1024;
    let lastFailure: unknown;
    while (hi - lo > 64 * 1024) {
      const mid = Math.floor((lo + hi) / 2);
      let r: Awaited<ReturnType<typeof roundTrip>> | { ok: false; stage: string; error: string };
      try {
        r = await roundTrip(admin, node, mid);
      } catch (e) {
        r = { ok: false, stage: 'transport', error: String(e) };
      }
      if (!admin.sessionStarted) {
        // The server dropped the stream (e.g. stanza too large): note it and reconnect.
        lastFailure = { size: mid, ...r, note: 'stream closed by server' };
        await disconnectAll();
        admin = await connect('admin', { resource: uniq('s3') });
        hi = mid;
        continue;
      }
      if (r.ok) lo = mid;
      else {
        hi = mid;
        lastFailure = { size: mid, ...r };
      }
    }
    return { lo, lastFailure };
}
