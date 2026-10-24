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
  if (cmd.status === 'completed') return failOnErrorNote(node, cmd);
  const fields: DataFormField[] = [
    { name: 'FORM_TYPE', type: 'hidden', value: ADMIN_NS },
    ...Object.entries(values).map(([name, value]) => ({ name, value }) as DataFormField),
  ];
  const res = await client.sendIQ({
    to,
    type: 'set',
    command: { node, ...(cmd.sid ? { sid: cmd.sid } : {}), action: 'complete', form: { type: 'submit', fields } },
  });
  return failOnErrorNote(node, res.command);
}

/**
 * XEP-0050 lets a server finish a command with status="completed" and <note type="error"/> instead of an
 * IQ error (OpenFire does this, e.g. "User already exists."). Surface that as a thrown error so a failed
 * admin operation is never mistaken for success. The note text is in error.text.
 */
function failOnErrorNote<T extends { notes?: Array<{ type?: string; value?: string }> } | undefined>(node: string, cmd: T): T {
  const note = cmd?.notes?.find((n) => n.type === 'error');
  if (note) {
    throw Object.assign(new Error(`${node}: ${note.value ?? 'error note'}`), {
      error: { condition: 'undefined-condition', text: note.value ?? '' },
      adhocNote: true,
    });
  }
  return cmd;
}

/**
 * Leave a room. With awaitSelfPresence=false, send the unavailable presence without waiting for the
 * service to echo it back (OpenFire 5.1.2 does not send the leaver its own unavailable presence).
 */
export async function leaveRoom(c: Client, roomJid: string, nick: string, awaitSelfPresence = true): Promise<void> {
  if (awaitSelfPresence) {
    await c.leaveRoom(roomJid, nick);
    return;
  }
  c.sendPresence({ to: `${roomJid}/${nick}`, type: 'unavailable' });
  await new Promise((r) => setTimeout(r, 200));
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
  awaitLeave = true,
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
  for (const [jid, aff] of Object.entries(affiliations)) {
    await c.setRoomAffiliation(roomJid, jid, aff);
  }
  await leaveRoom(c, roomJid, 'admin', awaitLeave);
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
  if (affiliations.length) await c.updateNodeAffiliations(service, node, affiliations);
}
