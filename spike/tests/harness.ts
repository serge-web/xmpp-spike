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
