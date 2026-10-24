// S2 on OpenFire with OpenFire's own PubSub affiliation semantics (evidence for results/openfire.md):
// 'member' is stored as 'outcast'; 'none' = whitelisted (and hidden from the owner's list);
// 'outcast' = revoked; a 'none' reader that loses its last subscription loses its affiliation.
// Restores the fixture state for objectives:blue at the end (run spike/provision.ts afterwards anyway).
//   SERVER=openfire npx tsx spike/docker/openfire/probes/s2-affiliation-semantics.ts
import { captureStanzas, connect, disconnectAll, outcome, publishJson, saveStanzas, uniq, type Client } from '../../../tests/harness.js';

const svc = 'pubsub.localhost';
const node = 'objectives:blue';
const bare = (u: string) => `${u}@localhost`;
let al: string[] = [];
let rl: string[] = [];
let bl: string[] = [];
const admin = await connect('admin', { resource: uniq('a'), onCreate: (x) => (al = captureStanzas(x).lines) });
const red = await connect('red-co', { resource: uniq('r'), onCreate: (x) => (rl = captureStanzas(x).lines) });
const blue = await connect('blue-co', { resource: uniq('b'), onCreate: (x) => (bl = captureStanzas(x).lines) });
const r: Record<string, unknown> = {};
const read = async (c: Client) => {
  const o = await outcome(c.getItems(svc, node));
  return o.ok ? 'ok' : o.condition;
};
const listed = async () => JSON.stringify((await admin.getNodeAffiliations(svc, node)).items?.map((i) => `${i.jid}=${i.affiliation}`));
/** Remove every subscription on the node, by subid (OpenFire answers bad-request without one when a JID has several). */
async function clearSubs() {
  const res = (await admin.getNodeSubscribers(svc, node)) as { pubsub?: { subscriptions?: { items?: Array<{ jid?: unknown; subid?: string }> } } };
  for (const i of res.pubsub?.subscriptions?.items ?? []) {
    await admin.sendIQ({ to: svc, type: 'set', pubsub: { context: 'owner', subscriptions: { node, items: [{ jid: String(i.jid), state: 'none', ...(i.subid ? { subid: i.subid } : {}) }] } } } as never);
  }
}
const set = (u: string, affiliation: 'member' | 'none' | 'outcast' | 'publisher') => admin.updateNodeAffiliations(svc, node, [{ jid: bare(u), affiliation }]);

await clearSubs();
await set('red-co', 'outcast');
r['0 red-co read (outcast, fixture)'] = await read(red);
await set('red-co', 'member');
r['1 set red-co=member -> listed as'] = await listed();
r['1 red-co read'] = await read(red);
await set('red-co', 'none');
r['2 set red-co=none -> red-co read (same online session)'] = await read(red);
r['2 listed affiliations (none omitted)'] = await listed();
await set('red-co', 'outcast');
r['3 set red-co=outcast -> red-co read (same online session)'] = await read(red);

await set('blue-co', 'publisher');
r['4 blue-co=publisher: publish'] = (await outcome(publishJson(blue, node, { text: 'pub ok' }))).ok;
await set('blue-co', 'none');
const p = await outcome(publishJson(blue, node, { text: 'pub revoked' }));
r['5 blue-co=none: publish'] = p.ok ? 'ok' : p.condition;
r['5 blue-co=none: read'] = await read(blue);

const sub = await outcome(blue.subscribeToNode(svc, { node, jid: bare('blue-co') } as never));
r['6 blue-co subscribe (bare JID)'] = sub.ok ? 'ok' : sub.condition;
const sub2 = await outcome(blue.subscribeToNode(svc, { node, jid: bare('blue-co') } as never));
r['6 blue-co subscribe again (multiple-subscriptions on by default)'] = sub2.ok ? 'ok' : sub2.condition;
r['6 blue-co read with two subscriptions'] = await read(blue);
await clearSubs();
r['7 after its subscriptions are removed: blue-co read'] = await read(blue);
r['7 listed affiliations'] = await listed();

await set('blue-co', 'none');
r['8 restored blue-co=none: read'] = await read(blue);
console.log(JSON.stringify(r, null, 2));
await saveStanzas('S2-openfire-semantics-admin', al);
await saveStanzas('S2-openfire-semantics-red-co', rl);
await saveStanzas('S2-openfire-semantics-blue-co', bl);
await disconnectAll();
