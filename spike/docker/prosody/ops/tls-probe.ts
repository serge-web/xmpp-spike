// S8: log in over wss:// with StanzaJS, trusting only the internal test CA via NODE_EXTRA_CA_CERTS.
//   NODE_EXTRA_CA_CERTS=spike/docker/prosody/tls/ca.crt npx tsx spike/docker/prosody/ops/tls-probe.ts
// Without NODE_EXTRA_CA_CERTS the connection must fail certificate verification.
import * as XMPP from 'stanza';

const url = process.env['WSS_URL'] ?? 'wss://localhost:5381/xmpp-websocket';
const client = XMPP.createClient({
  jid: 'admin@localhost',
  password: process.env['ADMIN_PASSWORD'] ?? 'spike-password',
  transports: { websocket: url, bosh: false },
  allowResumption: false,
} as XMPP.AgentConfig);
let mech = '';
client.on('raw:outgoing', (xml: string) => {
  const m = /<auth [^>]*mechanism="([^"]+)"/.exec(xml);
  if (m) mech = m[1]!;
});
const timer = setTimeout(() => {
  console.log(`FAIL: no session over ${url} (NODE_EXTRA_CA_CERTS=${process.env['NODE_EXTRA_CA_CERTS'] ?? 'unset'})`);
  process.exit(1);
}, 8000);
client.on('session:started', () => {
  clearTimeout(timer);
  console.log(`OK: session ${client.jid} over ${url} with SASL ${mech}`);
  client.disconnect();
  setTimeout(() => process.exit(0), 200);
});
client.on('auth:failed', () => {
  console.log('FAIL: auth failed');
  process.exit(1);
});
client.on('stream:error' as 'session:started', (e: unknown) => console.log('stream error', e));
client.on('disconnected', (e: unknown) => console.log('disconnected', e ?? ''));
client.connect();
