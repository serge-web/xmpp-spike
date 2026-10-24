// Server-neutral admin operations over XMPP using the admin's own session (SPIKE-BRIEF S4):
// XEP-0133 ad-hoc commands, MUC owner (XEP-0045) and PubSub owner (XEP-0060).

import type { Client } from '../harness.js';
import type { Constants, Stanzas } from 'stanza';

type DataForm = Stanzas.DataForm;
type DataFormField = Stanzas.DataFormField;
type MUCAffiliation = Constants.MUCAffiliation;
type PubsubAffiliation = Stanzas.PubsubAffiliation;

/** The defined-condition of an IQ error thrown by StanzaJS, if any. */
export function errorCondition(e: unknown): string | undefined {
  return (e as { error?: { condition?: string } }).error?.condition;
}

const ADMIN_NS = 'http://jabber.org/protocol/admin';

/** Run a two-step ad-hoc command: execute to get the form, then complete with our values. */
export async function adhoc(client: Client, to: string, node: string, values: Record<string, string | string[]>) {
  const first = await client.sendIQ({ to, type: 'set', command: { node, action: 'execute' } });
  const cmd = first.command;
  if (!cmd) throw new Error(`${node}: no command payload`);
  if (cmd.status === 'completed') return cmd;
  // Fit our values to the form the server returned: servers differ on singular/plural field names
  // (ejabberd end-user-session uses `accountjid` where XEP-0133 specifies `accountjids`).
  const offered = new Set((cmd.form?.fields ?? []).map((f) => f.name));
  const fit = (name: string, value: string | string[]): [string, string | string[]] => {
    if (offered.size === 0 || offered.has(name)) return [name, value];
    if (name.endsWith('s') && offered.has(name.slice(0, -1))) return [name.slice(0, -1), Array.isArray(value) ? value[0]! : value];
    if (offered.has(`${name}s`)) return [`${name}s`, Array.isArray(value) ? value : [value]];
    return [name, value];
  };
  const fields: DataFormField[] = [
    { name: 'FORM_TYPE', type: 'hidden', value: ADMIN_NS },
    ...Object.entries(values).map(([n, v]) => {
      const [name, value] = fit(n, v);
      return { name, value } as DataFormField;
    }),
  ];
  const res = await client.sendIQ({
    to,
    type: 'set',
    command: { node, ...(cmd.sid ? { sid: cmd.sid } : {}), action: 'complete', form: { type: 'submit', fields } },
  });
  return res.command;
}

export const admin = {
  addUser: (c: Client, domain: string, jid: string, password: string) =>
    adhoc(c, domain, `${ADMIN_NS}#add-user`, { accountjid: jid, password, 'password-verify': password }),
  deleteUser: (c: Client, domain: string, jid: string) =>
    adhoc(c, domain, `${ADMIN_NS}#delete-user`, { accountjids: [jid] }),
  changePassword: (c: Client, domain: string, jid: string, password: string) =>
    adhoc(c, domain, `${ADMIN_NS}#change-user-password`, { accountjid: jid, password }),
  endSessions: (c: Client, domain: string, jid: string) =>
    adhoc(c, domain, `${ADMIN_NS}#end-user-session`, { accountjids: [jid] }),
  onlineUsers: async (c: Client, domain: string, max = '100') => {
    const res = await adhoc(c, domain, `${ADMIN_NS}#get-online-users-list`, { max_items: max });
    return res?.form;
  },
  registeredUsers: async (c: Client, domain: string, max = '100') => {
    const res = await adhoc(c, domain, `${ADMIN_NS}#get-registered-users-list`, { max_items: max });
    return res?.form;
  },
};

/** Create (by joining) or update a room as owner, submit config, then set affiliations. */
export async function ensureRoom(
  c: Client,
  roomJid: string,
  config: Record<string, string | boolean | string[]>,
  affiliations: Record<string, MUCAffiliation>,
): Promise<void> {
  await c.joinRoom(roomJid, 'admin');
  const current = await c.getRoomConfig(roomJid);
  const known = new Set((current.fields ?? []).map((f) => f.name));
  const missing = Object.keys(config).filter((k) => !known.has(k));
  if (missing.length) throw new Error(`${roomJid}: server room config lacks fields ${missing.join(', ')}`);
  await c.configureRoom(roomJid, {
    type: 'submit',
    fields: [
      { name: 'FORM_TYPE', type: 'hidden', value: 'http://jabber.org/protocol/muc#roomconfig' },
      ...Object.entries(config).map(([name, value]) => ({ name, value }) as DataFormField),
    ],
  });
  // Converge: drop member/admin/outcast affiliations not in the plan (e.g. left over from S12).
  // Same-affiliation re-sets are harmless (they keep a persisted role, see S1).
  for (const aff of ['member', 'admin', 'outcast'] as const) {
    const res = await c.getRoomMembers(roomJid, { affiliation: aff });
    for (const u of res.muc?.users ?? []) {
      const jid = String(u.jid);
      if (!(jid in affiliations)) await c.setRoomAffiliation(roomJid, jid, 'none');
    }
  }
  for (const [jid, aff] of Object.entries(affiliations)) {
    await c.setRoomAffiliation(roomJid, jid, aff);
  }
  await c.leaveRoom(roomJid, 'admin');
}

export function nodeConfigForm(config: Record<string, string | boolean | string[]>): DataForm {
  return {
    type: 'submit',
    fields: [
      { name: 'FORM_TYPE', type: 'hidden', value: 'http://jabber.org/protocol/pubsub#node_config' },
      ...Object.entries(config).map(([name, value]) => ({ name, value }) as DataFormField),
    ],
  };
}

/** Create the node if absent, (re)apply config, and set affiliations (whitelist = member). */
export async function ensureNode(
  c: Client,
  service: string,
  node: string,
  config: Record<string, string | boolean | string[]>,
  affiliations: PubsubAffiliation[],
): Promise<void> {
  try {
    await c.createNode(service, node, nodeConfigForm(config));
  } catch (e) {
    if (errorCondition(e) !== 'conflict') throw e;
    await c.configureNode(service, node, nodeConfigForm(config));
  }
  // Converge: reset any non-owner affiliation not in the plan.
  const wanted = new Set(affiliations.map((a) => String(a.jid)));
  const current = await c.getNodeAffiliations(service, node);
  const stale = (current.items ?? [])
    .filter((i) => i.affiliation !== 'owner' && !wanted.has(String(i.jid)))
    .map((i) => ({ jid: String(i.jid), affiliation: 'none' as const }));
  if (stale.length || affiliations.length) await c.updateNodeAffiliations(service, node, [...stale, ...affiliations]);
  // Subscriptions outlive affiliation removal on some servers (ejabberd: a subscribed user keeps
  // reading and receiving events after leaving the whitelist), so drop subscriptions of non-members.
  if (config['pubsub#access_model'] === 'whitelist') {
    for (const jid of await nodeSubscribers(c, service, node)) {
      if (!wanted.has(jid)) await setSubscription(c, service, node, jid, 'none');
    }
  }
}

/** Bare JIDs subscribed to a node (owner view). */
export async function nodeSubscribers(c: Client, service: string, node: string): Promise<string[]> {
  const res = (await c.getNodeSubscribers(service, node)) as { pubsub?: { subscriptions?: { items?: Array<{ jid?: unknown }> } } };
  return (res.pubsub?.subscriptions?.items ?? []).map((i) => String(i.jid).split('/')[0]!);
}

export function setSubscription(c: Client, service: string, node: string, jid: string, state: 'none' | 'subscribed') {
  return c.updateNodeSubscriptions(service, node, [{ jid, state } as Stanzas.PubsubSubscription]);
}

/** Fully revoke a user's access to a whitelist node: affiliation none AND subscription removed. */
export async function revokeNodeAccess(c: Client, service: string, node: string, jid: string): Promise<void> {
  await c.updateNodeAffiliations(service, node, [{ jid, affiliation: 'none' }]);
  if ((await nodeSubscribers(c, service, node)).includes(jid)) await setSubscription(c, service, node, jid, 'none');
}
