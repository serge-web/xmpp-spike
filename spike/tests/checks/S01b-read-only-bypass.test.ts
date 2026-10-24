// S1 (continued): other ways the observer might put content in front of other occupants.
// Each probe: blue-obs tries a channel; blue-co (watching in the room) must receive nothing from it.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serverConfig } from '../config.js';
import { captureStanzas, collect, connect, disconnectAll, joinRoom, observe, saveStanzas, sendRaw, uniq, waitFor, type Client } from '../harness.js';

const room = () => `blue-hq@${serverConfig().mucDomain}`;
let co: Client;
let obs: Client;
let lines: string[] = [];

beforeAll(async () => {
  co = await connect('blue-co', { resource: uniq('s1b-co') });
  await joinRoom(co, room(), 'blue-co');
});
afterAll(async () => {
  await saveStanzas('S1b-bypass-probes', lines);
  await disconnectAll();
});

async function freshObserver(join = true) {
  obs = await connect('blue-obs', { resource: uniq('s1b-obs'), onCreate: (c) => (lines = captureStanzas(c).lines) });
  if (join) await joinRoom(obs, room(), 'blue-obs');
  return obs;
}

/** Did blue-co receive any stanza containing `marker`? */
async function seenByCo(marker: string, act: () => void | Promise<void>, ms = 2_000) {
  const got = collect(co, 'stanza', (s) => JSON.stringify(s).includes(marker), ms);
  const err = waitFor(obs, 'stanza', (s) => s.type === 'error' && JSON.stringify(s).includes(marker), ms).catch(() => undefined);
  await act();
  const [g, e] = await Promise.all([got, err]);
  return { delivered: g.length, error: (e as { error?: { condition?: string; text?: string } } | undefined)?.error ?? null };
}

describe('S1b observer bypass probes', () => {
  it('groupchat sent without joining the room (non-occupant member)', async () => {
    await freshObserver(false);
    const m = uniq('nojoin');
    const r = await seenByCo(m, () => {
      obs.sendMessage({ to: room(), type: 'groupchat', body: m });
    });
    await observe('S1b', 'groupchat without joining', r);
    expect(r.delivered).toBe(0);
    await obs.disconnect();
  });

  it('MUC/Sub subscription then groupchat without joining', async () => {
    await freshObserver(false);
    // urn:xmpp:mucsub:0 isn't modelled by StanzaJS; send raw and record the reply.
    const id = uniq('mucsub');
    const reply = waitFor(obs, 'iq', (s) => s.id === id, 3_000).catch(() => undefined);
    sendRaw(
      obs,
      `<iq xmlns="jabber:client" type="set" to="${room()}" id="${id}"><subscribe xmlns="urn:xmpp:mucsub:0" nick="blue-obs"><event node="urn:xmpp:mucsub:nodes:messages"/></subscribe></iq>`,
    );
    const rep = (await reply) as { type?: string; error?: { condition?: string } } | undefined;
    await observe('S1b', 'MucSub subscribe reply', rep ? { type: rep.type, error: rep.error?.condition ?? null } : 'no reply');
    const m = uniq('mucsub-post');
    const r = await seenByCo(m, () => {
      obs.sendMessage({ to: room(), type: 'groupchat', body: m });
    });
    await observe('S1b', 'groupchat after MucSub subscribe', r);
    expect(r.delivered).toBe(0);
    await obs.disconnect();
  });

  it('private message to an occupant (room/nick, type chat)', async () => {
    await freshObserver();
    const m = uniq('pm');
    const r = await seenByCo(m, () => {
      obs.sendMessage({ to: `${room()}/blue-co`, type: 'chat', body: m });
    });
    await observe('S1b', 'private message to occupant', r);
    expect(r.delivered).toBe(0);
  });

  it('change room subject', async () => {
    await freshObserver();
    const m = uniq('subject');
    const r = await seenByCo(m, () => {
      obs.sendMessage({ to: room(), type: 'groupchat', subject: m });
    });
    await observe('S1b', 'subject change', r);
    expect(r.delivered).toBe(0);
  });

  it('message correction (XEP-0308) of an earlier message', async () => {
    await freshObserver();
    const m = uniq('correction');
    const r = await seenByCo(m, () => {
      sendRaw(obs, `<message xmlns="jabber:client" to="${room()}" type="groupchat" id="${uniq('c')}"><body>${m}</body><replace xmlns="urn:xmpp:message-correct:0" id="anything"/></message>`);
    });
    await observe('S1b', 'XEP-0308 correction', r);
    expect(r.delivered).toBe(0);
  });

  it('type=normal message to the room JID', async () => {
    await freshObserver();
    const m = uniq('normal');
    const r = await seenByCo(m, () => {
      obs.sendMessage({ to: room(), type: 'normal', body: m });
    });
    await observe('S1b', 'type=normal to room', r);
    expect(r.delivered).toBe(0);
  });

  it('presence status text is not broadcast', async () => {
    await freshObserver();
    const m = uniq('status');
    const r = await seenByCo(m, () => {
      obs.sendPresence({ to: `${room()}/blue-obs`, status: m });
    });
    await observe('S1b', 'presence status text visible to others', r);
    expect(r.delivered).toBe(0);
  });

  it('nickname change is refused', async () => {
    await freshObserver();
    const nick = uniq('nick');
    const r = await seenByCo(nick, () => {
      obs.sendPresence({ to: `${room()}/${nick}` });
    });
    await observe('S1b', 'nick change visible to others', r);
    expect(r.delivered).toBe(0);

  });

  it('admin re-saving room config does not restore voice', async () => {
    const a = await connect('admin', { resource: uniq('s1b-a') });
    await a.joinRoom(room(), 'admin');
    const form = await a.getRoomConfig(room());
    await a.configureRoom(room(), { type: 'submit', fields: (form.fields ?? []).filter((f) => f.name) });
    await a.leaveRoom(room(), 'admin');
    a.disconnect();
    const o = await freshObserver(false);
    const p = await joinRoom(o, room(), 'blue-obs');
    await observe('S1b', 'observer role after admin re-saved room config', p.muc?.role ?? null);
    expect(p.muc?.role).toBe('visitor');
  });

  it('every game room is moderated (stored visitor roles only apply in moderated rooms)', async () => {
    const a = await connect('admin', { resource: uniq('s1b-mod') });
    const out: Record<string, unknown> = {};
    for (const id of ['blue-hq', 'red-hq', 'negotiation']) {
      const jid = `${id}@${serverConfig().mucDomain}`;
      await a.joinRoom(jid, 'admin');
      out[id] = (await a.getRoomConfig(jid)).fields?.find((f) => f.name === 'muc#roomconfig_moderatedroom')?.value;
      await a.leaveRoom(jid, 'admin');
    }
    await observe('S1b', 'rooms moderated', out);
    expect(Object.values(out).every((v) => v === true)).toBe(true);
  });

  it('voice request is not available', async () => {
    await freshObserver();
    const m = uniq('voicereq');
    const id = uniq('vr');
    const err = waitFor(obs, 'message', (s) => s.type === 'error' && s.id === id, 2_000).catch(() => undefined);
    sendRaw(
      obs,
      `<message xmlns="jabber:client" to="${room()}" id="${id}"><x xmlns="jabber:x:data" type="submit"><field var="FORM_TYPE"><value>http://jabber.org/protocol/muc#request</value></field><field var="muc#role"><value>participant</value></field></x><body>${m}</body></message>`,
    );
    const e = (await err) as { error?: { condition?: string; text?: string } } | undefined;
    await observe('S1b', 'voice request', e ? e.error : 'no error');
    obs.disconnect();
    const p = await joinRoom(await freshObserver(false), room(), 'blue-obs');
    expect(p.muc?.role).toBe('visitor');
  });
});
