// S1 exploration on Prosody: try each read-only mechanism in throwaway rooms.
import { writeFile, mkdir } from 'node:fs/promises';
import { serverConfig } from '../../../tests/config.js';
import { captureStanzas, collect, connect, disconnectAll, joinRoom, sendRaw, uniq, waitFor, type Client } from '../../../tests/harness.js';
import { ensureRoom } from '../../../tests/provision/xmpp-admin.js';

const cfg = serverConfig();
const bare = (u: string) => `${u}@${cfg.domain}`;
const out: string[] = [];
const log = (...a: unknown[]) => {
  const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  console.log(s);
  out.push(s);
};

const base = {
  'muc#roomconfig_persistentroom': true,
  'muc#roomconfig_publicroom': false,
  'muc#roomconfig_whois': 'moderators',
  'muc#roomconfig_enablearchiving': true,
};

async function tryPost(obs: Client, room: string, co: Client, raw = false) {
  const body = uniq('p');
  const seen = collect(co, 'message', (m) => m.body === body, 1500);
  const err = waitFor(obs, 'message', (m) => m.type === 'error', 2000).catch(() => undefined);
  if (raw) sendRaw(obs, `<message xmlns="jabber:client" to="${room}" type="groupchat" id="${uniq('raw')}"><body>${body}</body></message>`);
  else obs.sendMessage({ to: room, type: 'groupchat', body });
  const [e, d] = await Promise.all([err, seen]);
  return { delivered: d.length, error: e?.error };
}

async function joinAs(user: string, room: string, opts: { anonymous?: boolean } = {}) {
  let lines: string[] = [];
  const c = await connect(user, { resource: uniq('x'), ...opts, onCreate: (cl) => (lines = captureStanzas(cl).lines) });
  try {
    const p = await joinRoom(c, room, opts.anonymous ? uniq('anon') : user);
    return { c, role: p.muc?.role, aff: p.muc?.affiliation, lines };
  } catch (e) {
    return { c, joinError: (e as { error?: unknown }).error ?? String(e), lines };
  }
}

async function main() {
  await mkdir('results/prosody/explore-out', { recursive: true });
  const admin = await connect('admin', { resource: 'scratch' });

  // M1: members-only + moderated, observer member, moderator revokes voice; does it persist?
  {
    const room = `s1-m1@${cfg.mucDomain}`;
    await ensureRoom(admin, room, { ...base, 'muc#roomconfig_membersonly': true, 'muc#roomconfig_moderatedroom': true }, {
      [bare('blue-co')]: 'member', [bare('blue-obs')]: 'member',
    });
    const co = await connect('blue-co', { resource: uniq('co') });
    await joinRoom(co, room, 'blue-co');
    const o1 = await joinAs('blue-obs', room);
    await admin.joinRoom(room, 'admin');
    await admin.setRoomRole(room, 'blue-obs', 'visitor');
    await new Promise((r) => setTimeout(r, 300));
    log('M1 after revoke, admin still in room:', await tryPost(o1.c, room, co));
    await admin.leaveRoom(room, 'admin');
    log('M1 after revoke, admin left (same session):', await tryPost(o1.c, room, co));
    await writeFile('results/prosody/explore-out/M1-revoked-same-session.xml', o1.lines.join('\n\n'));
    await o1.c.leaveRoom(room, 'blue-obs');
    const o2 = await joinAs('blue-obs', room);
    log('M1 rejoin role/aff:', o2.role, o2.aff, 'post:', await tryPost(o2.c, room, co));
    o2.c.disconnect();
    co.disconnect();
  }

  // M1b: same, but observer keeps a second session in the room while the first rejoins
  // (would the role survive while any session is present?) — informational.

  // M2: open (not members-only) + moderated, observer affiliation none, non-members outcast.
  {
    const room = `s1-m2@${cfg.mucDomain}`;
    await ensureRoom(admin, room, { ...base, 'muc#roomconfig_membersonly': false, 'muc#roomconfig_moderatedroom': true }, {
      [bare('blue-co')]: 'member', [bare('blue-obs')]: 'none', [bare('umpire-1')]: 'member', [bare('red-co')]: 'outcast',
    });
    const co = await connect('blue-co', { resource: uniq('co') });
    await joinRoom(co, room, 'blue-co');
    const o = await joinAs('blue-obs', room);
    log('M2 obs role/aff:', o.role, o.aff, 'post:', await tryPost(o.c, room, co), 'raw:', await tryPost(o.c, room, co, true));
    await writeFile('results/prosody/explore-out/M2-visitor.xml', o.lines.join('\n\n'));
    o.c.disconnect();
    const o2 = await joinAs('blue-obs', room);
    log('M2 obs after reconnect:', o2.role, await tryPost(o2.c, room, co));
    const red = await joinAs('red-co', room);
    log('M2 red-co (outcast) join:', red.role ?? red.joinError);
    const anon = await joinAs('anon', room, { anonymous: true });
    log('M2 anonymous join:', anon.role ?? anon.joinError, 'jid', anon.c.jid);
    await writeFile('results/prosody/explore-out/M2-anonymous-join.xml', anon.lines.join('\n\n'));
    // A brand-new account not in the outcast list
    const { admin: adm } = await import('../../../tests/provision/xmpp-admin.js');
    await adm.addUser(admin, cfg.domain, bare('s1-stranger'), 'x-pass').catch(() => undefined);
    const stranger = await connect('s1-stranger', { password: 'x-pass', resource: 'x' });
    const sp = await joinRoom(stranger, room, 's1-stranger').catch((e) => ({ err: (e as { error?: unknown }).error }));
    log('M2 new unlisted user join:', (sp as { muc?: { role?: string } }).muc?.role ?? sp);
    await adm.deleteUser(admin, cfg.domain, bare('s1-stranger')).catch(() => undefined);
    co.disconnect();
  }

  // M3: members-only, observer affiliation none: can it even join?
  {
    const room = `s1-m3@${cfg.mucDomain}`;
    await ensureRoom(admin, room, { ...base, 'muc#roomconfig_membersonly': true, 'muc#roomconfig_moderatedroom': true }, {
      [bare('blue-co')]: 'member', [bare('blue-obs')]: 'none',
    });
    const o = await joinAs('blue-obs', room);
    log('M3 obs join:', o.role ?? o.joinError);
  }

  // M4: members-only, NOT moderated, member + revoke: same question as M1 but unmoderated.
  {
    const room = `s1-m4@${cfg.mucDomain}`;
    await ensureRoom(admin, room, { ...base, 'muc#roomconfig_membersonly': true, 'muc#roomconfig_moderatedroom': false }, {
      [bare('blue-co')]: 'member', [bare('blue-obs')]: 'member',
    });
    const co = await connect('blue-co', { resource: uniq('co') });
    await joinRoom(co, room, 'blue-co');
    const o1 = await joinAs('blue-obs', room);
    await admin.joinRoom(room, 'admin');
    const r = await admin.setRoomRole(room, 'blue-obs', 'visitor').then(() => 'ok', (e) => (e as { error?: unknown }).error);
    await admin.leaveRoom(room, 'admin');
    log('M4 revoke in unmoderated room:', r, 'post:', await tryPost(o1.c, room, co));
    o1.c.disconnect();
    const o2 = await joinAs('blue-obs', room);
    log('M4 rejoin role:', o2.role);
    co.disconnect();
  }

  for (const r of ['s1-m1', 's1-m2', 's1-m3', 's1-m4']) await admin.destroyRoom(`${r}@${cfg.mucDomain}`).catch(() => undefined);
  await writeFile('results/prosody/explore-out/s1-mechanisms.txt', out.join('\n') + '\n');
  await disconnectAll();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
