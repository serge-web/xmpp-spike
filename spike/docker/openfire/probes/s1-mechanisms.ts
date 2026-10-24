// S1 mechanism exploration on OpenFire (evidence for results/openfire.md). Creates and destroys
// throwaway rooms s1-<variant>@conference.localhost. Saves stanzas as results/openfire/stanzas/S1-openfire-*.
//   SERVER=openfire npx tsx spike/docker/openfire/probes/s1-mechanisms.ts
import { captureStanzas, collect, connect, disconnectAll, saveStanzas, sendRaw, uniq, waitFor, type Client } from '../../../tests/harness.js';
import { ensureRoom, leaveRoom } from '../../../tests/provision/xmpp-admin.js';
import adapter from '../../../tests/provision/openfire.js';

const MUC = 'conference.localhost';
const base = adapter.profile.roomConfig;
const j = (u: string) => `${u}@localhost`;

async function tryJoinPost(user: string, room: string, opts: { anonymous?: boolean } = {}, tag?: string) {
  const co = await connect('blue-co', { resource: uniq('co') });
  await co.joinRoom(room, 'blue-co');
  let lines: string[] = [];
  const c = opts.anonymous
    ? await connect('anon', { anonymous: true, onCreate: (x) => (lines = captureStanzas(x).lines) })
    : await connect(user, { resource: uniq('m'), onCreate: (x) => (lines = captureStanzas(x).lines) });
  const nick = opts.anonymous ? 'anon' : user;
  let join: string;
  let role: string | undefined;
  try {
    const p = await c.joinRoom(room, nick);
    role = p.muc?.role;
    join = `joined role=${role} aff=${p.muc?.affiliation}`;
  } catch (e) {
    const err = (e as { error?: { condition?: string } }).error;
    join = `join refused: ${err?.condition ?? String(e)}`;
    if (tag) await saveStanzas(tag, lines);
    await disconnectAll();
    return { join };
  }
  const body = uniq('post');
  const seen = collect(co, 'message', (m) => m.body === body, 2000);
  const err = waitFor(c, 'message', (m) => m.type === 'error', 2500).catch(() => undefined);
  c.sendMessage({ to: room, type: 'groupchat', body });
  const [e, d] = await Promise.all([err, seen]);
  if (tag) await saveStanzas(tag, lines);
  await disconnectAll();
  return { join, post: d.length ? 'DELIVERED' : `rejected: ${e?.error?.condition ?? 'no error stanza'}` };
}

async function setup(name: string, cfg: Record<string, string | boolean | string[]>, affs: Record<string, 'member' | 'none' | 'outcast'>) {
  const a = await connect('admin', { resource: uniq('adm') });
  const room = `${name}@${MUC}`;
  await ensureRoom(a, room, { ...base, ...cfg }, affs, false);
  await disconnectAll();
  return room;
}

const results: Record<string, unknown> = {};

// A: moderated + members-only, observer = member
{
  const r = await setup('s1-a', {}, { [j('blue-co')]: 'member', [j('blue-obs')]: 'member' });
  results['A moderated+membersonly, obs=member'] = await tryJoinPost('blue-obs', r);
}
// B: as A, plus a moderator revokes voice while obs is in the room; then obs reconnects.
{
  const r = await setup('s1-b', {}, { [j('blue-co')]: 'member', [j('blue-obs')]: 'member' });
  const obs = await connect('blue-obs', { resource: uniq('b') });
  await obs.joinRoom(r, 'blue-obs');
  const a = await connect('admin', { resource: uniq('adm') });
  await a.joinRoom(r, 'admin');
  await a.setRoomRole(r, 'blue-obs', 'visitor');
  const rolePresence = await waitFor(obs, 'presence', (p) => p.from === `${r}/blue-obs` && p.muc?.role === 'visitor', 3000).then(() => 'visitor presence ok', () => 'no visitor presence');
  // post while still in the room (moderator present)
  const body = uniq('in-session');
  const e1 = waitFor(obs, 'message', (m) => m.type === 'error', 2500).then((m) => m.error?.condition, () => 'none');
  obs.sendMessage({ to: r, type: 'groupchat', body });
  const inSession = await e1;
  await leaveRoom(a, r, 'admin', false);
  await disconnectAll();
  results['B voice revoked by moderator: in-session'] = { rolePresence, inSessionError: inSession };
  results['B voice revoked by moderator: after reconnect, no moderator'] = await tryJoinPost('blue-obs', r, {}, 'S1-openfire-B-after-reconnect');
}
// C: members-only, observer affiliation none
{
  const r = await setup('s1-c', {}, { [j('blue-co')]: 'member', [j('blue-obs')]: 'none' });
  results['C moderated+membersonly, obs=none'] = await tryJoinPost('blue-obs', r, {}, 'S1-openfire-C-join');
}
// D: moderated, NOT members-only, obs none (-> visitor), others outcast
{
  const r = await setup('s1-d', { 'muc#roomconfig_membersonly': false }, { [j('blue-co')]: 'member', [j('blue-obs')]: 'none', [j('red-co')]: 'outcast' });
  results['D moderated open room, obs=none'] = await tryJoinPost('blue-obs', r, {}, 'S1-openfire-D-obs');
  results['D ... red-co (outcast)'] = await tryJoinPost('red-co', r);
  results['D ... anonymous user'] = await tryJoinPost('anon', r, { anonymous: true }, 'S1-openfire-D-anon');
  results['D ... umpire-1 (no affiliation, not outcast)'] = await tryJoinPost('umpire-1', r);
}
// E: members-only + moderated, obs = member, presence broadcast excludes participant? (does not affect voice; recorded for completeness)
{
  const r = await setup('s1-e', { 'muc#roomconfig_presencebroadcast': ['moderator'] }, { [j('blue-co')]: 'member', [j('blue-obs')]: 'member' });
  results['E presencebroadcast=moderator only, obs=member'] = await tryJoinPost('blue-obs', r);
}
// F: room registration: can a non-member make itself a member when registration is enabled (stock default)?
{
  const r = await setup('s1-f', { 'x-muc#roomconfig_registration': true }, { [j('blue-co')]: 'member' });
  let lines: string[] = [];
  const red = await connect('red-co', { resource: uniq('reg'), onCreate: (x) => (lines = captureStanzas(x).lines) });
  const form = await red.sendIQ({ to: r, type: 'get', account: {} } as never).then(() => 'form ok', (e) => `form refused: ${(e as { error?: { condition?: string } }).error?.condition}`);
  // Submit a registration form (raw, StanzaJS has no MUC-register helper).
  const id = uniq('reg');
  const reply = waitFor(red, 'iq', (s) => s.id === id, 3000).then((s) => s.type, () => 'timeout');
  sendRaw(red, `<iq xmlns="jabber:client" type="set" to="${r}" id="${id}"><query xmlns="jabber:iq:register"><x xmlns="jabber:x:data" type="submit"><field var="FORM_TYPE"><value>http://jabber.org/protocol/muc#register</value></field><field var="muc#register_first"><value>r</value></field><field var="muc#register_last"><value>c</value></field><field var="muc#register_roomnick"><value>red-co</value></field></x></query></iq>`);
  const regType = await reply;
  await saveStanzas('S1-openfire-F-room-registration', lines);
  await disconnectAll();
  const a = await connect('admin', { resource: uniq('adm') });
  await a.joinRoom(r, 'admin');
  const members = await a.getRoomMembers(r, { affiliation: 'member' } as never).catch((e) => e);
  await leaveRoom(a, r, 'admin', false);
  await disconnectAll();
  results['F registration enabled: red-co self-registers in members-only room'] = { form, regType, members: JSON.stringify((members as { muc?: { users?: unknown } }).muc?.users ?? members) };
  results['F ... red-co join after registering'] = await tryJoinPost('red-co', r);
}

console.log(JSON.stringify(results, null, 2));
// cleanup
const a: Client = await connect('admin', { resource: uniq('adm') });
for (const v of ['a', 'b', 'c', 'd', 'e', 'f']) {
  const room = `s1-${v}@${MUC}`;
  await a.joinRoom(room, 'admin').catch(() => undefined);
  await a.destroyRoom(room).catch(() => undefined);
}
await disconnectAll();
