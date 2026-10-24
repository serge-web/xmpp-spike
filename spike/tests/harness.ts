// Connection and multi-client helpers shared by every check.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as XMPP from 'stanza';
import { serverConfig } from './config.js';
import { PASSWORD } from './fixtures/game.js';

export type Client = XMPP.Agent;

export interface ConnectOptions {
  resource?: string;
  password?: string;
  /** Use SASL ANONYMOUS instead of a named account (S10). */
  anonymous?: boolean;
  timeoutMs?: number;
  /** Called before connecting, e.g. to attach captureStanzas so the login is recorded. */
  onCreate?: (client: Client) => void;
}

const live = new Set<Client>();

/** Connect over WebSocket and wait for session start. Rejects (never skips) if the server is unreachable. */
export async function connect(user: string, opts: ConnectOptions = {}): Promise<Client> {
  const cfg = serverConfig();
  const client = XMPP.createClient({
    jid: opts.anonymous ? cfg.domain : `${user}@${cfg.domain}`,
    password: opts.anonymous ? undefined : (opts.password ?? PASSWORD),
    ...(opts.resource ? { resource: opts.resource } : {}),
    transports: { websocket: cfg.websocketUrl, bosh: false },
    allowResumption: false,
  } as XMPP.AgentConfig);
  live.add(client);
  if (opts.anonymous) {
    // StanzaJS ranks ANONYMOUS lowest; disable the rest so the anonymous path is actually exercised.
    for (const m of ['EXTERNAL', 'SCRAM-SHA-256-PLUS', 'SCRAM-SHA-256', 'SCRAM-SHA-1-PLUS', 'SCRAM-SHA-1', 'DIGEST-MD5', 'OAUTHBEARER', 'X-OAUTH2', 'PLAIN']) {
      client.sasl.disable(m);
    }
  }
  opts.onCreate?.(client);

  const timeoutMs = opts.timeoutMs ?? 10_000;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${user}: no session after ${timeoutMs}ms`)), timeoutMs);
    client.once('session:started', () => {
      clearTimeout(timer);
      resolve();
    });
    client.once('auth:failed', () => {
      clearTimeout(timer);
      reject(new Error(`${user}: authentication failed`));
    });
    client.once('disconnected', () => {
      clearTimeout(timer);
      reject(new Error(`${user}: disconnected before session start`));
    });
    client.connect();
  });
  return client;
}

/** Disconnect every client opened via connect(). Call from afterEach/afterAll. */
export async function disconnectAll(): Promise<void> {
  await Promise.all(
    [...live].map(
      (c) =>
        new Promise<void>((resolve) => {
          if (!c.sessionStarted) return resolve();
          c.once('disconnected', () => resolve());
          c.disconnect();
        }),
    ),
  );
  live.clear();
}

/** Record raw XML in both directions so a check can save representative stanzas (ground rule 6). */
export function captureStanzas(client: Client): { lines: string[]; stop: () => void } {
  const lines: string[] = [];
  const onIn = (xml: string) => lines.push(`<!-- in -->\n${xml}`);
  const onOut = (xml: string) => lines.push(`<!-- out -->\n${xml}`);
  client.on('raw:incoming', onIn);
  client.on('raw:outgoing', onOut);
  return {
    lines,
    stop: () => {
      client.off('raw:incoming', onIn);
      client.off('raw:outgoing', onOut);
    },
  };
}

/** Write captured stanzas to results/<server>/stanzas/<name>.xml. */
export async function saveStanzas(name: string, lines: string[]): Promise<void> {
  const dir = join('results', serverConfig().name, 'stanzas');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${name}.xml`), lines.join('\n\n') + '\n');
}

/** Send raw XML on the WebSocket, bypassing StanzaJS serialisation and any client-side checks. */
export function sendRaw(client: Client, xml: string): void {
  const socket = (client.transport as unknown as { socket?: { send(data: string): void } }).socket;
  if (!socket) throw new Error('no WebSocket transport');
  socket.send(xml);
}

// Loose union: Message and Presence declare `muc` differently, so an intersection collapses to never.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyStanza = { from?: string; to?: string; type?: string; id?: string; body?: string; [k: string]: any };

/** Resolve with the first stanza of `kind` matching `pred`, or reject after `ms`. */
export function waitFor<T = AnyStanza>(
  client: Client,
  kind: 'message' | 'presence' | 'iq' | 'stanza',
  pred: (s: AnyStanza) => boolean,
  ms = 5_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const handler = (s: AnyStanza) => {
      if (!pred(s)) return;
      clearTimeout(timer);
      client.off(kind as 'message', handler as never);
      resolve(s as T);
    };
    const timer = setTimeout(() => {
      client.off(kind as 'message', handler as never);
      reject(new Error(`timeout waiting for ${kind}`));
    }, ms);
    client.on(kind as 'message', handler as never);
  });
}

/** Collect every stanza of `kind` matching `pred` for `ms`; used to prove that nothing arrives. */
export async function collect(
  client: Client,
  kind: 'message' | 'presence' | 'stanza',
  pred: (s: AnyStanza) => boolean,
  ms = 1_500,
): Promise<AnyStanza[]> {
  const got: AnyStanza[] = [];
  const handler = (s: AnyStanza) => {
    if (pred(s)) got.push(s);
  };
  client.on(kind as 'message', handler as never);
  await new Promise((r) => setTimeout(r, ms));
  client.off(kind as 'message', handler as never);
  return got;
}

/** Join a MUC room and wait for self-presence; resolves with the self-presence. */
export async function joinRoom(client: Client, room: string, nick: string, history?: { maxstanzas: number }) {
  return client.joinRoom(room, nick, history ? { muc: { type: 'join', history: { maxStanzas: history.maxstanzas } } } : {});
}

export const uniq = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
