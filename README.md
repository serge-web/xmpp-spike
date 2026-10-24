# War Rooms X1: XMPP server selection spike

This repo holds a time-boxed spike that picks the XMPP server for **War Rooms X1 (WRX1)**, a browser-based wargaming tool. The XMPP server is its only backend.

We test three candidates against the same checks and choose between them on evidence:

- **OpenFire**
- **ejabberd**
- **Prosody**

The full instructions are in [`SPIKE-BRIEF.md`](SPIKE-BRIEF.md). The requirements behind it are in §10 of the WRX1 Software Requirements Document (SRD).

## Why this matters

WRX1 enforces game rules using **standard XMPP access controls only**. It has no app server, custom plugin or bot. So the server has to enforce the following rules itself:

- Observers can read rooms but not post.
- Each force's objectives are confidential.
- Only the admin publishes announcements.
- Anonymous visitors see only the welcome page.
- The admin provisions the game without a shared secret in the browser.

The spike also records exactly how each server behaves, including error conditions, event ordering and quirks. The browser **mock backend** used for demos and development must reproduce that behaviour.

## Status

| Server | Version | Mandatory checks | Verdict |
|---|---|---|---|
| OpenFire | – | not started | – |
| ejabberd | – | not started | – |
| Prosody | – | not started | – |

**Recommendation:** pending. See [`results/summary.md`](results/summary.md) when it exists.

## Checks

| ID | Check | Mandatory |
|---|---|---|
| S0 | Browser connectivity (WebSocket, SCRAM, CORS) | ✅ gate |
| S1 | Read-only members enforced by the server, with no moderator online | ✅ |
| S2 | PubSub confidentiality and write control | ✅ |
| S3 | ~100 KB PubSub items | ✅ |
| S4 | Admin provisioning without a bundled secret | ✅ |
| S5 | MAM/RSM paging over 10,000 messages | ✅ |
| S6 | Publisher notifications | record only |
| S7 | Whether server groups are needed | record only |
| S8 | Offline install, internal-CA TLS, backup and restore | tie-break |
| S9 | Effort to write a small server module | tie-break |
| S10 | Anonymous access limited to the welcome page | ✅ |
| S11 | One role, two sessions, same nickname | record only |
| S12 | Live game changes while players are online | advisory |

**Decision rule:** any failure in S0–S5 or S10 rules a server out. Among the servers that pass, the winner is the one with the fewest REST dependencies, then the simplest to operate, then the most extensible.

## Repo layout

```
SPIKE-BRIEF.md        instructions for whoever runs the spike (human or Claude Code)
spike/
  docker/<server>/    pinned compose stack and config per server
  tests/
    fixtures/         test game: forces, roles, rooms, PubSub nodes
    provision/        per-server provisioning adapters
    checks/           one test file per check, S0–S12
    harness.ts        connection and multi-client helpers
results/
  <server>.md         decision record per server
  <server>/stanzas/   captured XML for the mock team
  summary.md          comparison and recommendation
```

## Running the spike

Prerequisites: Docker with Compose, Node LTS and npm.

```bash
npm install

# start one server
docker compose -f spike/docker/ejabberd/compose.yaml up -d

# provision the test game and run every check against it
SERVER=ejabberd npm test

# stop it
docker compose -f spike/docker/ejabberd/compose.yaml down -v
```

Replace `ejabberd` with `openfire` or `prosody` to test the others. The tests **fail** if the server is unreachable; they never skip.

> The harness scaffold exists (`spike/tests/harness.ts`); compose stacks and checks are still to be written.

## Conventions

- Tests are written in TypeScript (strict mode) with StanzaJS, the same library as the WRX1 client, and run under Vitest over WebSocket.
- Every server image and package is pinned to an exact version at least 14 days old.
- Servers are used as shipped, with no custom modules, except for the effort check in S9.
- No shared secrets or API keys go in client code.
- Results are recorded as they are, including surprises. Behaviour is not worked around.

## After the spike

The winning server's compose stack and config become the WRX1 **reference deployment** and **CI target**. The tests in `spike/tests/checks/` become the starting point for the WRX1 **contract suite**, which runs against both the real server and the mock (SRD ARC-10/11).

## Not covered

- WRX1 UI
- Load testing beyond S5
- Clustering
- Federation
- Verifying the real air-gapped host install, which the team does by hand
