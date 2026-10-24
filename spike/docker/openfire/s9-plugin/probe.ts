// S9 only, against the isolated stack in this directory:
//   OPENFIRE_WS=ws://localhost:17070/ws/ SERVER=openfire npx tsx spike/docker/openfire/s9-plugin/probe.ts
// blue-obs (listed in WRX_READONLY_JIDS) is a plain *member* of a moderated members-only room, which on
// stock OpenFire gives it voice. With the sketch plugin its posts must be rejected, after reconnect too.
import { captureStanzas, collect, connect, disconnectAll, saveStanzas, uniq, waitFor } from '../../../tests/harness.js';
import { admin, AdhocNoteError, ensureRoom } from '../../../tests/provision/xmpp-admin.js';

const d = 'localhost';
const room = `s9-room@conference.${d}`;
const a = await connect('admin', { resource: 's9' });
for (const u of ['blue-co', 'blue-obs']) {
  await admin.addUser(a, d, `${u}@${d}`, 'spike-password').catch((e) => {
    if (!(e instanceof AdhocNoteError)) throw e;
  });
}
await ensureRoom(a, room, { 'muc#roomconfig_persistentroom': true, 'muc#roomconfig_membersonly': true, 'muc#roomconfig_moderatedroom': true, 'x-muc#roomconfig_registration': false }, { [`blue-co@${d}`]: 'member', [`blue-obs@${d}`]: 'member' }, false);
await disconnectAll();

for (const round of [1, 2]) {
  const co = await connect('blue-co', { resource: uniq('co') });
  await co.joinRoom(room, 'blue-co');
  let lines: string[] = [];
  const obs = await connect('blue-obs', { resource: uniq('obs'), onCreate: (c) => (lines = captureStanzas(c).lines) });
  const self = await obs.joinRoom(room, 'blue-obs');
  const body = uniq('s9');
  const seen = collect(co, 'message', (m) => m.body === body, 2000);
  const err = waitFor(obs, 'message', (m) => m.type === 'error', 3000).catch(() => undefined);
  obs.sendMessage({ to: room, type: 'groupchat', body });
  const [e, delivered] = await Promise.all([err, seen]);
  console.log(`round ${round}: blue-obs role=${self.muc?.role} -> error=${e?.error?.condition ?? 'none'} delivered=${delivered.length}`);
  if (round === 1) await saveStanzas('S9-openfire-readonly-plugin', lines);
  await disconnectAll();
}
