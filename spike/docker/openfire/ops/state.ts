// S8 backup/restore evidence for OpenFire.
//   SERVER=openfire npx tsx spike/docker/openfire/ops/state.ts seed     -> writes a marker, prints it
//   SERVER=openfire npx tsx spike/docker/openfire/ops/state.ts verify <marker>
// OpenFire hides 'none' (= whitelisted) PubSub affiliates from the owner's list, so whitelists are
// verified by behaviour: every planned reader can read the node, every other role is refused.
import { serverConfig } from '../../../tests/config.js';
import { connect, disconnectAll, joinRoom, outcome, publishJson, waitFor, type Client } from '../../../tests/harness.js';
import { ADMIN, nodes, roles, rooms } from '../../../tests/fixtures/game.js';
import { nodePlan } from '../../../tests/provision/game.js';

const cfg = serverConfig();
const bare = (u: string) => `${u}@${cfg.domain}`;
const [mode, markerArg] = process.argv.slice(2);
const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

async function seed() {
  const marker = `s8-${Date.now()}`;
  const admin = await connect(ADMIN, { resource: 's8' });
  await publishJson(admin, nodes.objectives('blue'), { text: marker }, marker);
  const co = await connect('blue-co', { resource: 's8' });
  const room = `blue-hq@${cfg.mucDomain}`;
  await joinRoom(co, room, 'blue-co');
  co.sendMessage({ to: room, type: 'groupchat', body: marker });
  await waitFor(co, 'message', (m) => m.body === marker);
  // Monitoring writes its archive in batches; give it time before a cold backup.
  await new Promise((r) => setTimeout(r, 5_000));
  console.log(marker);
}

async function verify(marker: string) {
  const clients: Record<string, Client> = {};
  for (const id of [ADMIN, ...roles.map((r) => r.id)]) {
    const c = await connect(id, { resource: 's8v' }).catch(() => undefined);
    check(!!c, `login ${id}`);
    if (c) clients[id] = c;
  }
  const admin = clients[ADMIN]!;
  for (const room of rooms) {
    const jid = `${room.id}@${cfg.mucDomain}`;
    const conf = await admin.getRoomConfig(jid).catch(() => undefined);
    const f = (n: string) => conf?.fields?.find((x) => x.name === n)?.value;
    check(f('muc#roomconfig_membersonly') === true && f('muc#roomconfig_persistentroom') === true, `room ${room.id} members-only+persistent`);
    const members = await admin.getRoomMembers(jid, { affiliation: 'member' }).catch(() => undefined);
    const got = new Set((members?.muc?.users ?? []).map((i: { jid?: string }) => String(i.jid)));
    check(room.members.map(bare).every((j) => got.has(j)) && got.size === room.members.length, `room ${room.id} members ${[...got].join(',')}`);
  }
  for (const n of nodePlan()) {
    const conf = await admin.getNodeConfig(cfg.pubsubDomain, n.node).catch(() => undefined);
    const access = conf?.fields?.find((x) => x.name === 'pubsub#access_model')?.value;
    check(access === n.access, `node ${n.node} access_model=${String(access)}`);
    if (n.access !== 'whitelist') continue;
    for (const r of roles) {
      const may = n.readers.includes(r.id) || n.publishers.includes(r.id);
      const res = await outcome(clients[r.id]!.getItems(cfg.pubsubDomain, n.node));
      check(res.ok === may, `node ${n.node}: ${r.id} ${may ? 'can' : 'cannot'} read (${res.ok ? 'ok' : res.condition})`);
    }
    const affs = await admin.getNodeAffiliations(cfg.pubsubDomain, n.node).catch(() => undefined);
    const pubs = new Set((affs?.items ?? []).filter((x) => x.affiliation === 'publisher').map((x) => String(x.jid)));
    check(n.publishers.every((u) => pubs.has(bare(u))), `node ${n.node} publishers ${[...pubs].join(',')}`);
  }
  const item = await outcome(admin.getItem(cfg.pubsubDomain, nodes.objectives('blue'), marker));
  check(item.ok, `item ${marker} in objectives:blue`);
  const found: string[] = [];
  const co = clients['blue-co']!;
  co.on('mam:item', (m: { archive?: { item?: { message?: { body?: string } } } }) => {
    const b = m.archive?.item?.message?.body;
    if (b) found.push(b);
  });
  await co.searchHistory(`blue-hq@${cfg.mucDomain}`, { paging: { max: 50, before: '' } });
  check(found.includes(marker), `MAM blue-hq contains ${marker} (latest ${found.length})`);
  await disconnectAll();
  if (failures.length) {
    console.log(`${failures.length} FAILED`);
    process.exit(1);
  }
  console.log('all ok');
}

if (mode === 'seed') await seed().finally(disconnectAll);
else if (mode === 'verify' && markerArg) await verify(markerArg);
else throw new Error('usage: state.ts seed | verify <marker>');
