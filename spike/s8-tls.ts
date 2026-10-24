// S8 TLS probe: connect over wss:// trusting only the internal test CA.
//   NODE_EXTRA_CA_CERTS=spike/docker/tls/out/ca.crt WSS_URL=wss://localhost:5443/ws SERVER=<name> npx tsx spike/s8-tls.ts
import * as XMPP from 'stanza';
import { serverConfig } from './tests/config.js';

const url = process.env['WSS_URL'];
if (!url) throw new Error('WSS_URL required');
const cfg = serverConfig();
const client = XMPP.createClient({
  jid: `admin@${cfg.domain}`,
  password: process.env['ADMIN_PASSWORD'] ?? 'spike-password',
  transports: { websocket: url, bosh: false },
});
const timer = setTimeout(() => {
  console.error('FAIL: no session');
  process.exit(1);
}, 10_000);
client.on('session:started', () => {
  clearTimeout(timer);
  console.log(`PASS: session over ${url} as ${client.jid}`);
  client.disconnect();
  setTimeout(() => process.exit(0), 200);
});
client.on('disconnected', () => console.log('disconnected'));
client.connect();
