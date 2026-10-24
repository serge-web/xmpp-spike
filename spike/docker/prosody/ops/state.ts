// S8 backup/restore evidence. Server-neutral apart from SERVER=<name>.
//   SERVER=prosody npx tsx spike/docker/prosody/ops/state.ts seed     -> writes a marker, prints it
//   SERVER=prosody npx tsx spike/docker/prosody/ops/state.ts verify <marker>
// verify checks: every fixture account logs in; rooms exist with their config and affiliations;
// every node exists with its access model and affiliations; the marker item is in objectives:blue;
// the marker message is in blue-hq's MAM archive.
import { serverConfig } from '../../../tests/config.js';
import { connect, disconnectAll, publishJson, waitFor, joinRoom } from '../../../tests/harness.js';
import { ADMIN, roles, rooms, nodes } from '../../../tests/fixtures/game.js';
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
  console.log(marker);
}

async function verify(marker: string) {
  for (const id of [ADMIN, ...roles.map((r) => r.id)]) {
    const ok = await connect(id, { resource: 's8v' }).then(() => true, () => false);
    check(ok, `login ${id}`);
  }
  const admin = await connect(ADMIN, { resource: 's8v-admin' });
  for (const room of rooms) {
    const jid = `${room.id}@${cfg.mucDomain}`;
    const conf = await admin.getRoomConfig(jid).catch(() => undefined);
    const f = (n: string) => conf?.fields?.find((x) => x.name === n)?.value;
    check(f('muc#roomconfig_membersonly') === true && f('muc#roomconfig_persistentroom') === true, `room ${room.id} members-only+persistent`);
    const members = await admin.getRoomMembers(jid, { affiliation: 'member' }).catch(() => undefined);
    const got = new Set((members?.muc?.users ?? []).map((i: { jid?: string }) => i.jid));
    const want = room.members.map(bare);
    check(want.every((j) => got.has(j)), `room ${room.id} members ${[...got].join(',')}`);
  }
  for (const n of nodePlan()) {
    const conf = await admin.getNodeConfig(cfg.pubsubDomain, n.node).catch(() => undefined);
    const access = conf?.fields?.find((x) => x.name === 'pubsub#access_model')?.value;
    check(access === n.access, `node ${n.node} access_model=${String(access)}`);
    if (n.readers.length || n.publishers.length) {
      const affs = await admin.getNodeAffiliations(cfg.pubsubDomain, n.node).catch(() => undefined);
      const list = affs?.items ?? [];
      const has = (u: string, ...a: string[]) => list.some((x) => x.jid === bare(u) && a.includes(x.affiliation ?? ''));
      // A reader that is also a publisher holds "publisher" (the last affiliation set wins).
      check(
        n.readers.every((u) => has(u, 'member', 'publisher')) && n.publishers.every((u) => has(u, 'publisher')),
        `node ${n.node} affiliations ${list.map((x) => `${x.jid}=${x.affiliation}`).join(',')}`,
      );
    }
  }
  const item = await admin.getItem(cfg.pubsubDomain, nodes.objectives('blue'), marker).catch(() => undefined);
  check(JSON.stringify(item ?? {}).includes(marker), `item ${marker} in objectives:blue`);
  const co = await connect('blue-co', { resource: 's8v-mam' });
  const found: string[] = [];
  co.on('mam:item', (m: { archive?: { item?: { message?: { body?: string } } } }) => {
    const b = m.archive?.item?.message?.body;
    if (b) found.push(b);
  });
  await co.searchHistory(`blue-hq@${cfg.mucDomain}`, { paging: { before: '', max: 50 } });
  check(found.includes(marker), `MAM blue-hq contains ${marker} (${found.length} msgs in last page)`);
  if (failures.length) {
    console.log(`${failures.length} failure(s)`);
    process.exitCode = 1;
  } else console.log('all state present');
}

try {
  if (mode === 'seed') await seed();
  else if (mode === 'verify' && markerArg) await verify(markerArg);
  else throw new Error('usage: state.ts seed | verify <marker>');
} finally {
  await disconnectAll();
}
process.exit(process.exitCode ?? 0);
