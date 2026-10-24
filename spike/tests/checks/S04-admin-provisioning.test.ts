// S4 Admin provisioning without a bundled secret (R5). Every op uses the admin's own XMPP session:
// XEP-0133 ad-hoc commands, MUC owner, PubSub owner. Each test verifies the effect, not just the reply.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serverConfig } from '../config.js';
import { captureStanzas, connect, disconnectAll, observe, outcome, saveStanzas, uniq, type Client } from '../harness.js';
import { admin as ops, ensureNode, ensureRoom } from '../provision/xmpp-admin.js';

const cfg = () => serverConfig();
const temp = uniq('s4user');
const tempJid = () => `${temp}@${cfg().domain}`;
let a: Client;
let lines: string[] = [];

beforeAll(async () => {
  a = await connect('admin', { resource: uniq('s4'), onCreate: (c) => (lines = captureStanzas(c).lines) });
});
afterAll(async () => {
  await saveStanzas('S4-admin', lines);
  await disconnectAll();
});

const fieldValues = (form: unknown): string[] =>
  ((form as { fields?: Array<{ value?: unknown }> } | undefined)?.fields ?? []).flatMap((f) =>
    Array.isArray(f.value) ? f.value.map(String) : f.value !== undefined ? [String(f.value)] : [],
  );

describe('S4 admin provisioning over XMPP (admin credentials only)', () => {
  it('create user (XEP-0133 add-user) — the new account can log in', async () => {
    const r = await outcome(ops.addUser(a, cfg().domain, tempJid(), 'pw-one'));
    await observe('S4', 'add-user', r.ok ? 'xmpp ad-hoc ok' : r);
    expect(r.ok).toBe(true);
    const u = await connect(temp, { password: 'pw-one', resource: uniq('t') });
    expect(u.sessionStarted).toBe(true);
    u.disconnect();
  });

  it('reset password (XEP-0133 change-user-password) — new password works, old fails', async () => {
    const r = await outcome(ops.changePassword(a, cfg().domain, tempJid(), 'pw-two'));
    await observe('S4', 'change-user-password', r.ok ? 'xmpp ad-hoc ok' : r);
    expect(r.ok).toBe(true);
    await expect(connect(temp, { password: 'pw-one', resource: uniq('t') })).rejects.toThrow();
    const u = await connect(temp, { password: 'pw-two', resource: uniq('t') });
    expect(u.sessionStarted).toBe(true);
  });

  it('list online sessions (XEP-0133 get-online-users-list) — includes the temp user', async () => {
    const r = await outcome(ops.onlineUsers(a, cfg().domain));
    await observe('S4', 'get-online-users-list', r.ok ? { values: fieldValues(r.value) } : r);
    expect(r.ok).toBe(true);
    expect(fieldValues(r.value).some((v) => v.includes(temp))).toBe(true);
  });

  it("end a user's sessions (XEP-0133 end-user-session) — the session is closed", async () => {
    let ulines: string[] = [];
    const u = await connect(temp, { password: 'pw-two', resource: uniq('t'), onCreate: (c) => (ulines = captureStanzas(c).lines) });
    const closed = new Promise<string>((resolve) => {
      u.on('stream:error', (e) => resolve(`stream:error ${e.condition}`));
      u.on('disconnected', () => resolve('disconnected'));
    });
    const r = await outcome(ops.endSessions(a, cfg().domain, tempJid()));
    expect(r.ok).toBe(true);
    const how = await Promise.race([closed, new Promise<string>((res) => setTimeout(() => res('still connected'), 5_000))]);
    await observe('S4', 'end-user-session: what the user session saw', how);
    await saveStanzas('S4-ended-session-user-side', ulines);
    expect(how).not.toBe('still connected');
  });

  it('create room and set affiliations (MUC owner) — affiliation list reflects it', async () => {
    const room = `${uniq('s4room')}@${cfg().mucDomain}`;
    await ensureRoom(a, room, { 'muc#roomconfig_persistentroom': true, 'muc#roomconfig_membersonly': true }, { [tempJid()]: 'member' });
    const members = await a.getRoomMembers(room, { affiliation: 'member' });
    const jids = (members.muc?.users ?? []).map((u) => String(u.jid));
    await observe('S4', 'room member list after set', jids);
    expect(jids).toContain(tempJid());
    await a.destroyRoom(room);
  });

  it('create node with access model, whitelist and publishers (PubSub owner)', async () => {
    const node = uniq('s4node');
    await ensureNode(a, cfg().pubsubDomain, node, { 'pubsub#access_model': 'whitelist', 'pubsub#publish_model': 'publishers' }, [
      { jid: tempJid(), affiliation: 'publisher' },
    ]);
    const conf = await a.getNodeConfig(cfg().pubsubDomain, node);
    expect(conf.fields?.find((f) => f.name === 'pubsub#access_model')?.value).toBe('whitelist');
    const affs = await a.getNodeAffiliations(cfg().pubsubDomain, node);
    const mine = (affs.items ?? []).find((i) => String(i.jid) === tempJid());
    expect(mine?.affiliation).toBe('publisher');
    await a.deleteNode(cfg().pubsubDomain, node);
  });

  it('delete user (XEP-0133 delete-user) — login then fails; online session is ended', async () => {
    let ulines: string[] = [];
    const u = await connect(temp, { password: 'pw-two', resource: uniq('t'), onCreate: (c) => (ulines = captureStanzas(c).lines) });
    const gone = new Promise<string>((resolve) => {
      u.on('stream:error', (e) => resolve(`stream:error ${e.condition}`));
      u.on('disconnected', () => resolve('disconnected'));
    });
    const r = await outcome(ops.deleteUser(a, cfg().domain, tempJid()));
    await observe('S4', 'delete-user', r.ok ? 'xmpp ad-hoc ok' : r);
    expect(r.ok).toBe(true);
    const how = await Promise.race([gone, new Promise<string>((res) => setTimeout(() => res('still connected'), 5_000))]);
    await observe('S4', 'delete-user: what the online session saw', how);
    await saveStanzas('S4-deleted-user-side', ulines);
    await expect(connect(temp, { password: 'pw-two', resource: uniq('t') })).rejects.toThrow();
  });
});


