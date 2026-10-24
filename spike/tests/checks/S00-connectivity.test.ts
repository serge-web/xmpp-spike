// S0 Browser connectivity (gate): WebSocket + SCRAM for every account.

import { afterEach, describe, expect, it } from 'vitest';
import { captureStanzas, connect, disconnectAll, saveStanzas } from '../harness.js';
import { ADMIN, roles } from '../fixtures/game.js';

afterEach(disconnectAll);

describe('S0 browser connectivity', () => {
  it('admin authenticates over WebSocket with SCRAM', async () => {
    let lines: string[] = [];
    const client = await connect(ADMIN, {
      onCreate: (c) => {
        lines = captureStanzas(c).lines;
      },
    });
    expect(client.sessionStarted).toBe(true);
    const sasl = lines.find((l) => l.includes('<auth ') && l.includes('mechanism='));
    expect(sasl).toMatch(/mechanism="SCRAM-SHA-[0-9-]+(-PLUS)?"/);
    await saveStanzas('S0-admin-login', lines);
  });

  it.each(roles.map((r) => r.id))('%s authenticates over WebSocket', async (id) => {
    const client = await connect(id);
    expect(client.sessionStarted).toBe(true);
  });
});
