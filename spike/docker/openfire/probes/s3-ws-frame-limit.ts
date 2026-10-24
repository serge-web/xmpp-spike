// Raw WebSocket: send an oversize stanza after auth-less open and print the close code/reason.
import WebSocket from 'ws';

const size = Number(process.argv[2] ?? 1_100_000);
const ws = new WebSocket(process.env['OPENFIRE_WS'] ?? 'ws://localhost:7070/ws/', 'xmpp');
ws.on('open', () => ws.send('<open xmlns="urn:ietf:params:xml:ns:xmpp-framing" to="localhost" version="1.0"/>'));
let sent = false;
ws.on('message', (d) => {
  const s = d.toString();
  console.log('IN', s.slice(0, 300));
  if (!sent && s.includes('stream:features')) {
    sent = true;
    ws.send(`<iq xmlns="jabber:client" type="get" id="big"><query xmlns="jabber:iq:version">${'A'.repeat(size)}</query></iq>`);
  }
});
ws.on('close', (code, reason) => console.log('CLOSE', code, reason.toString()));
setTimeout(() => process.exit(0), 5000);
