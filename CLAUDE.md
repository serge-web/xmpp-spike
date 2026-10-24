# CLAUDE.md

This repo runs the WRX1 XMPP server selection spike. **Read [`SPIKE-BRIEF.md`](SPIKE-BRIEF.md) first and follow it**; it is the source of truth for scope, checks (S0–S12), ground rules and outputs.

## Key rules (from the brief)

- Stock servers only: no source changes or custom modules (except S9 effort check).
- No shared secrets in client/test code paths that represent the browser.
- Tests fail, never skip. An unreachable server is a failure.
- Pin exact image digests and package versions, at least 14 days old. Record them in `results/<server>.md`.
- Save representative stanzas for every check under `results/<server>/stanzas/` (use `captureStanzas`/`saveStanzas` in `spike/tests/harness.ts`).
- Record surprising behaviour; don't work around it.
- Time box ~3 days per server; a check blocked > half a day is BLOCKED with evidence.
- Ask a human before relaxing a ground rule or when real hardware/networks are needed (S8 air-gap).
- Notify at milestones: `curl -d "msg" ntfy.sh/iancc2025`

## Layout

- `spike/docker/<server>/` – pinned compose stack + config
- `spike/tests/fixtures/game.ts` – §4 test game
- `spike/tests/provision/` – per-server adapters implementing `ProvisioningAdapter`
- `spike/tests/checks/` – one `S<n>-*.test.ts` per check, server-independent
- `spike/tests/config.ts` – per-server URLs/domains, selected by `SERVER`
- `results/` – decision records, stanzas, `summary.md` (at repo root, as in README)

## Commands

```bash
npm ci                 # install (use the lockfile; npm 10 hits an arborist bug on fresh resolve – use `npx npm@11 install` to change deps)
npm run typecheck      # tsc strict
SERVER=ejabberd npm test
```

## Environment notes

- Cloud container: Docker daemon isn't running by default. The SessionStart hook starts `dockerd`; manually: `sudo dockerd > /tmp/dockerd.log 2>&1 &`.
- Pinned toolchain: stanza 12.22.1, vitest 5.0.3, vite 8.3.4, typescript 5.9.3, @types/node 22.20.5, Node 22.
