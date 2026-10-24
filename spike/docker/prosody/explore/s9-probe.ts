// S9: exercise mod_wrx_hello and mod_wrx_muc_readonly on the isolated S9 stack (ws://localhost:5390).
import * as XMPP from 'stanza';
import { writeFile } from 'node:fs/promises';
import { admin as adm, ensureRoom } from '../../../tests/provision/xmpp-admin.js';

const WS = 'ws://localhost:5390/xmpp-websocket';
const lines: string[] = [];
async function conn(user: string, password = 'spike-password', capture = false): Promise<XMPP.Agent> {
  const c = XMPP.createClient({ jid: `${user}@localhost`, password, resource: `r${Math.random().toString(36).slice(2, 6)}`, transports: { websocket: WS, bosh: false }, allowResumption: false } as XMPP.AgentConfig);
  if (capture) {
    c.on('raw:incoming', (x: string) => lines.push(`<!-- in -->\n${x}`));
    c.on('raw:outgoing', (x: string) => lines.push(`<!-- out -->\n${x}`));
  }
  await new Promise<void>((res, rej) => {
    c.once('session:started', () => res());
    c.once('auth:failed', () => rej(new Error('auth failed ' + user)));
    c.connect();
  });
  return c;
}

const a = await conn('admin');
// hello IQ (raw, since StanzaJS has no definition for urn:wrx:hello)
const helloReply = new Promise<string>((res) => a.on('raw:incoming', (x: string) => x.includes('urn:wrx:hello') && res(x)));
(a.transport as unknown as { socket: { send(s: string): void } }).socket.send(`<iq xmlns="jabber:client" type="get" to="localhost" id="h1"><hello xmlns="urn:wrx:hello"/></iq>`);
console.log('hello reply:', await helloReply);
const info = await a.getDiscoInfo('localhost');
console.log('disco feature urn:wrx:hello:', info.features?.includes('urn:wrx:hello'));

for (const u of ['blue-co', 'blue-obs']) {
  await adm.addUser(a, 'localhost', `${u}@localhost`, 'spike-password').catch(() => undefined);
}
const room = 'ro-test@conference.localhost';
await ensureRoom(a, room, {
  'muc#roomconfig_persistentroom': true, 'muc#roomconfig_membersonly': true, 'muc#roomconfig_moderatedroom': false,
  '{urn:wrx:muc}roomconfig_readonly': ['blue-obs@localhost'],
}, { 'blue-co@localhost': 'member', 'blue-obs@localhost': 'member' });

const co = await conn('blue-co');
await co.joinRoom(room, 'blue-co');
for (const attempt of [1, 2]) {
  const obs = await conn('blue-obs', 'spike-password', attempt === 2);
  const p = await obs.joinRoom(room, 'blue-obs');
  const body = `ro-${attempt}-${Date.now()}`;
  let seen = 0;
  const h = (m: { body?: string }) => { if (m.body === body) seen++; };
  co.on('message', h);
  const err = new Promise<unknown>((res) => obs.on('message', (m: { type?: string; error?: unknown }) => m.type === 'error' && res(m.error)));
  obs.sendMessage({ to: room, type: 'groupchat', body });
  const e = await Promise.race([err, new Promise((r) => setTimeout(() => r('no error'), 2000))]);
  await new Promise((r) => setTimeout(r, 500));
  co.off('message', h);
  console.log(`session ${attempt}: role=${p.muc && 'role' in p.muc ? (p.muc as { role?: string }).role : '?'} delivered=${seen} error=${JSON.stringify(e)}`);
  obs.disconnect();
  await new Promise((r) => setTimeout(r, 300));
}
await writeFile('results/prosody/explore-out/S9-readonly-session2.xml', lines.join('\n\n'));
process.exit(0);
