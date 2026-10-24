// Load probe (de-risking, not a brief check): N players in 3 rooms post every PERIOD ms for DURATION ms;
// the admin publishes to a whitelist node every second. Measures delivery latency and errors.
//   SERVER=ejabberd PLAYERS=40 DURATION=60000 npx tsx spike/load.ts
import { execSync } from 'node:child_process';
import { serverConfig } from './tests/config.js';
import { connect, disconnectAll, joinRoom, publishJson, type Client } from './tests/harness.js';
import { admin as adhoc, ensureNode, ensureRoom, errorCondition } from './tests/provision/xmpp-admin.js';
import { adapterFor } from './tests/provision/index.js';

const PLAYERS = Number(process.env['PLAYERS'] ?? 40);
const DURATION = Number(process.env['DURATION'] ?? 60_000);
const PERIOD = Number(process.env['PERIOD'] ?? 2_000);
const PW = 'load-password';
const cfg = serverConfig();
const bare = (u: string) => `${u}@${cfg.domain}`;
const users = Array.from({ length: PLAYERS }, (_, i) => `load-${String(i).padStart(3, '0')}`);
const roomOf = (i: number) => `load-room-${i % 3}@${cfg.mucDomain}`;
const NODE = 'load-node';

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]! : NaN;
};

const { profile } = await adapterFor();
const admin = await connect('admin', { resource: 'load' });
for (const u of users) {
  try {
    await adhoc.addUser(admin, cfg.domain, bare(u), PW);
  } catch (e) {
    if (errorCondition(e) !== 'conflict') throw e;
  }
}
for (let r = 0; r < 3; r++) {
  const affs = Object.fromEntries(users.filter((_, i) => i % 3 === r).map((u) => [bare(u), 'member' as const]));
  await ensureRoom(admin, `load-room-${r}@${cfg.mucDomain}`, profile.roomConfig, affs);
}
await ensureNode(admin, cfg.pubsubDomain, NODE, { 'pubsub#access_model': 'whitelist', 'pubsub#publish_model': 'publishers' },
  users.map((u) => ({ jid: bare(u), affiliation: 'member' as const })));

const roomLat: number[] = [];
const eventLat: number[] = [];
let errors = 0;
const errorKinds: Record<string, number> = {};
let disconnects = 0;
const clients: Client[] = new Array(PLAYERS);
const t0 = Date.now();
await Promise.all(
  users.map(async (u, i) => {
    const c = await connect(u, { password: PW, resource: 'load' });
    clients[i] = c; // index must match users[i] / roomOf(i)
    c.on('disconnected', () => disconnects++);
    c.on('message', (m) => {
      if (m.type === 'error') {
        errors++;
        const k = `${m.error?.condition ?? '?'}: ${m.error?.text ?? ''}`;
        errorKinds[k] = (errorKinds[k] ?? 0) + 1;
      }
      const sent = Number(/^t=(\d+);/.exec(m.body ?? '')?.[1]);
      if (sent && !m.delay) roomLat.push(Date.now() - sent);
      const ev = JSON.stringify(m.pubsub ?? '');
      const at = Number(/"sent":(\d+)/.exec(ev)?.[1]);
      if (at) eventLat.push(Date.now() - at);
    });
    await joinRoom(c, roomOf(i), u);
    await c.subscribeToNode(cfg.pubsubDomain, NODE).catch(() => errors++);
  }),
);
const connectMs = Date.now() - t0;

let sent = 0;
const stop = Date.now() + DURATION;
const timers = clients.map((c, i) =>
  setInterval(() => {
    if (Date.now() > stop) return;
    c.sendMessage({ to: roomOf(i), type: 'groupchat', body: `t=${Date.now()}; load message from ${users[i]}` });
    sent++;
  }, PERIOD + (i % 7) * 13),
);
const pub = setInterval(() => void publishJson(admin, NODE, { sent: Date.now() }).catch(() => errors++), 1_000);
const stats: string[] = [];
const sampler = setInterval(() => {
  try {
    stats.push(execSync(`docker stats --no-stream --format '{{.CPUPerc}} {{.MemUsage}}' wrx-ejabberd-ejabberd-1`).toString().trim());
  } catch {
    /* sampling is best effort */
  }
}, 10_000);
await new Promise((r) => setTimeout(r, DURATION + 3_000));
timers.forEach(clearInterval);
clearInterval(pub);
clearInterval(sampler);

console.log(
  JSON.stringify(
    {
      players: PLAYERS,
      durationMs: DURATION,
      connectAndJoinMs: connectMs,
      roomMessagesSent: sent,
      roomDeliveries: roomLat.length,
      roomLatencyMs: { p50: pct(roomLat, 50), p95: pct(roomLat, 95), max: pct(roomLat, 100) },
      pubsubEvents: eventLat.length,
      pubsubLatencyMs: { p50: pct(eventLat, 50), p95: pct(eventLat, 95), max: pct(eventLat, 100) },
      errors,
      errorKinds,
      disconnects,
      serverStats: stats,
    },
    null,
    2,
  ),
);
await disconnectAll();
// Clean up the load accounts, rooms and node.
const c = await connect('admin', { resource: 'load-clean' });
await c.deleteNode(cfg.pubsubDomain, NODE).catch(() => undefined);
for (let r = 0; r < 3; r++) await c.destroyRoom(`load-room-${r}@${cfg.mucDomain}`).catch(() => undefined);
for (const u of users) await adhoc.deleteUser(c, cfg.domain, bare(u)).catch(() => undefined);
await disconnectAll();
