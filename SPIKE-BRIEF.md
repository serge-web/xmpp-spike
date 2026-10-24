# War Rooms X1: XMPP server selection spike brief

This brief tells Claude Code, or a developer, how to run the server selection spike in §10 of the War Rooms X1 SRD. Put it in the root of an empty repo as `SPIKE-BRIEF.md`, and reference it from `CLAUDE.md`.

## 1. Purpose

WRX1 is a browser-based wargaming tool. Its only backend is an XMPP server: MUC rooms for chat, PubSub nodes for game documents, MAM for history, and presence. Game rules are enforced by **standard XMPP access controls only**, with no custom plugin or bot (SRD D2).

The spike decides which server to use by testing evidence, not opinion. There are three candidates:

- **OpenFire**
- **ejabberd**
- **Prosody**

For each server, the spike finds out whether the checks below pass, how each is configured, and exactly how the server behaves. The browser mock backend will be built to match that behaviour (SRD §11, ARC-10/11).

**Time box:** about 3 days per server. If one check blocks you for more than half a day, record it as BLOCKED with your evidence and move on.

## 2. Ground rules

1. **Record what actually happens.** Don't work around a surprising behaviour; write it down, because the mock depends on these records.
2. **Use stock servers only.** No source changes and no custom modules, except to assess effort in S9. Using official or bundled modules and configuration is fine.
3. **No shared secrets in the client.** Anything that would need an API secret in browser code counts as a fail for that operation.
4. **Tests fail, they never skip.** If a server is unreachable, the run fails.
5. **Pin everything.** Use exact image digests and package versions. Choose stable releases at least 14 days old, and record the version and image source in each decision record.
6. **Capture the stanzas.** For every check, save the representative request and response stanzas (XML) under `results/<server>/stanzas/`. The mock team will use them.
7. **Ask a human** before relaxing a ground rule, or when a check needs real hardware or networks (see S8).
8. **Send progress notifications** at milestones (each server finished, final summary): `curl -d "msg" ntfy.sh/iancc2025`

## 3. Setup

Recommended repo layout:

```
spike/
  docker/
    openfire/   compose + config
    ejabberd/   compose + config
    prosody/    compose + config
  tests/
    fixtures/           test game definition (below)
    provision/          per-server provisioning adapters
    checks/             one file per check, S0–S12
    harness.ts          connect helpers, multi-client utilities
  results/
    <server>.md         decision record (template in §6)
    <server>/stanzas/   captured XML
    summary.md          comparison and recommendation
```

The tests are written in TypeScript in strict mode. They run on Node with **StanzaJS**, the same library the client will use, under Vitest. Connect over **WebSocket** (RFC 7395), as the browser will.

Each server runs in its own Docker Compose stack. Run one at a time, or on separate ports. Use the same test suite for all three servers, so that only the provisioning adapters and config files differ.

The contract suite is meant to outlive the spike. Keep the checks independent of any one server, so the suite can become the ARC-10 contract suite that runs against both the server and the mock.

## 4. Test game fixture

Provision the following on each server. Use the admin account's own credentials wherever possible; S4 tests exactly this.

| Item | Detail |
|---|---|
| Forces | `blue`, `red`, `umpire` (the umpire force has the umpire flag) |
| Roles (one XMPP account each) | `blue-co`, `blue-obs` (observer), `red-co`, `umpire-1` |
| Admin | `admin` |
| Rooms (MUC, members-only, persistent) | `blue-hq` (blue + umpire), `red-hq` (red + umpire), `negotiation` (`blue-co`, `red-co`, umpire) |
| PubSub nodes (JSON payloads) | `game-setup` (anonymous-readable), `forces:<id>`, `roles:<id>`, `rooms:<id>`, `assets:<id>`, `objectives:<forceId>`, `announcements`, `game-state` (reserved, empty) |

Access rules:

| Node or room | Read | Publish or post |
|---|---|---|
| `objectives:<forceId>` | that force's roles, umpire-force roles, admin | admin and umpire-force roles only |
| `announcements` | every role | admin only |
| `blue-obs` in rooms | can read | can never post |

## 5. Checks

The mandatory checks are S0–S5 and S10. S0 is added by this brief as a gate. The other checks feed the tie-break.

### S0 Browser connectivity (gate)

- StanzaJS connects over `wss://` (or `ws://` in dev) and authenticates with SCRAM.
- If the server has an HTTP admin API, record whether it supports CORS for a browser origin.
- **Pass:** every role logs in over WebSocket.

### S1 Read-only members (SRD risk R1)

`blue-obs` must be unable to post in rooms it belongs to. This must be enforced by the server, **survive reconnection**, and work **with no moderator online**.

- Try the available mechanisms: moderated rooms with a default role per affiliation, member-without-voice options, server-specific room settings, and outcast/visitor combinations.
- Test with `blue-obs` logging in fresh, attempting a groupchat message, reconnecting and trying again. A raw stanza should be sent too, bypassing any client-side checks.
- Other occupants must receive nothing, and `blue-obs` must receive an error. Record the error condition.
- `blue-obs` must still receive room history and live messages.
- **Pass:** the server rejects the post in every case, with no online moderator.

### S2 PubSub confidentiality and write control (R3, R10)

- `red-co` cannot fetch, subscribe to or discover the items of `objectives:blue`.
- `blue-co` can read `objectives:blue` but cannot publish to it.
- `umpire-1` can read and publish to every `objectives:*` node.
- Every role can read `announcements`; only `admin` can publish to it.
- Changes to the whitelist and publishers take effect for sessions that are already online.
- **Pass:** every rule above is enforced by the server.

### S3 Item size (R11)

- Publish and fetch a JSON item containing about 100 KB of base64 image data.
- Find the actual maximum item and stanza size, and record the relevant config setting.
- **Pass:** 100 KB works with a documented configuration.

### S4 Admin provisioning without a bundled secret (R5)

For each operation below, record **how** it was done and whether it needed REST or a secret:

- create and delete a user;
- set or reset a password;
- create a room and set affiliations;
- create a node and set its access model, whitelist and publishers;
- list online sessions;
- end a user's sessions.

Use the admin's own credentials only: XEP-0133 ad-hoc commands, MUC owner, PubSub owner, or an HTTP API authenticated as the admin user.

**Pass:** every operation is possible with no shared secret in the client.

### S5 MAM paging at scale

- Seed 10,000 messages into a room.
- From a fresh session, page backwards from the latest message using RSM `before=<uid>` until the start, with page sizes of 50 and 200.
- Check that there are no gaps or duplicates and that the order is correct. Measure the time for each page and in total.
- Check how join history merges with MAM, and record which stanza IDs and stamps are stable (`stanza-id`, `<delay>`).
- **Pass:** paging through the full history is complete and correct.

### S6 Publisher notifications

- Does the publisher receive an event for its own publish?
- Do notifications carry the payload?
- What order do events arrive in when two publishes are made close together?
- Record the behaviour; there is no pass or fail.

### S7 Are groups needed? (R6)

- Can every access rule in §4 be achieved with per-user affiliations and whitelists alone, without shared or roster groups?
- Record which features, if any, would need groups.

### S8 Operations (NFR-2, NFR-10)

- Install with networking turned off, from images or archives saved locally.
- Set up TLS using a test internal CA that you generate.
- Back up and restore, and confirm that users, rooms, affiliations, nodes, items and MAM all survive.
- **Human follow-up:** the real air-gapped host install must be verified by the team; mark this as pending in the record.

### S9 Escape hatch

- Estimate the effort to write a minimal server module, for example one that enforces read-only. Note the language, toolchain, how the module is loaded and the quality of the docs.
- A "hello world" module that loads successfully is enough. **Do not** use it in any other check.

### S10 Anonymous access limits (D20, NFR-21)

- With SASL ANONYMOUS, the user **can** read `game-setup` and the game theme assets.
- The user **cannot** read `objectives:*`, read the rooms or their MAM, list users or nodes beyond what the welcome page needs, publish, or join rooms.
- **Pass:** every one of these limits is enforced.

### S11 Same role, two sessions (D22)

- Two `blue-co` sessions with different resources join `blue-hq` with the same nickname.
- Both receive every message, and a post from either appears once to everyone else.
- One session leaving does not remove the other.
- Record the server's multi-session nickname behaviour.

### S12 Live changes (D23, ADM-25)

This check is advisory.

- While `blue-co` is online, move it from blue to red by changing affiliations and the whitelist. Record what the online session receives and in what order.
- Grant the new access before revoking the old, and confirm there is no window in which the session is locked out.
- Delete an online user and record what its session sees.

## 6. Decision record template (`results/<server>.md`)

```
# <Server> <version> (image/source, digest)

## Summary
PASS / FAIL on mandatory checks; overall verdict; REST dependencies count.

## Checks
### S<n> <title>
Result: PASS | FAIL | PARTIAL | BLOCKED
Mechanism / config: <exact settings>
Evidence: <test name(s), log excerpts>
For the mock: <error conditions, event ordering, quirks to reproduce>
REST / secret needed: yes/no — detail

## Operational notes
Install, TLS, backup/restore, admin console, docs quality.

## Risks and surprises
```

## 7. Decision rule and final output

The rules for choosing a server are:

- A server that fails any of S0–S5 or S10 is out.
- Among the servers that pass, prefer the one with the **fewest REST dependencies**. Break ties on **operational simplicity**, then on **extensibility** (S9).
- If no server passes S1, stop and report. The SRD defers that decision until after the spike (PLY-39).

`results/summary.md` should contain:

- a comparison table of check × server;
- the recommendation, with your reasoning;
- the open issues it closes or leaves open: R1, R5, R6 and D16;
- a list of server behaviours the mock must reproduce.

The winning server's compose stack and config become the reference deployment and the CI target.

## 8. Out of scope

- Building any WRX1 UI.
- Load testing beyond S5.
- Clustering or high availability.
- Federation.
