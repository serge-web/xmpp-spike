# WRX1 XMPP server spike: findings for the system architect

**Date:** 2026-10-24
**Scope:** SRD §10 server-selection spike, run per `SPIKE-BRIEF.md`.
**Decision:** **ejabberd 26.09** is selected as the WRX1 backend.
**Source of evidence:** `results/summary.md`, `results/ejabberd.md`, and the `results/<server>/` folders.

## 1. Decision and rationale

The same automated contract suite was run against three stock servers: StanzaJS over WebSocket, the WRX1 client library and transport.

| | ejabberd 26.09 | Prosody 13.0.7 | OpenFire 5.1.2 |
|---|---|---|---|
| S0 browser connectivity (gate) | ✅ | ✅ | ✅ |
| **S1 read-only observers (R1)** | ✅ | ❌ | ❌ |
| S2 PubSub confidentiality and write control | ✅ (see 3.2) | ✅ | ❌ (non-standard affiliations) |
| S3 ~100 KB items | ✅ | ✅ | ✅ |
| S4 admin without a shared secret (R5) | ✅ | ✅ | ✅ |
| S5 MAM paging, 10,000 messages | ✅ | ✅ | ❌ (duplicates and gaps) |
| S10 anonymous limits | ✅ (node names visible; accepted) | ✅ | ❌ |
| REST dependencies | 0 | 0 | 0 |

**Why ejabberd:**
- **It is the only server that enforces read-only observers (R1) with standard XMPP controls and no custom code.** It keeps a moderator's voice revocation per account, across reconnects, restarts and upgrades.
- Prosody would need a custom module of about 45 lines, which breaks SRD D2 ("standard XMPP access controls only"). OpenFire failed three mandatory checks.

## 2. Architecture confirmed

- **Backend:** a single ejabberd container with one config file and the bundled SQLite store. No app server, plugin or bot (D2 holds).
- **Transport:** browser to ejabberd over **WebSocket (RFC 7395)**, `wss://` only in production, with **SCRAM-SHA-256** authentication.
- **Rooms:** MUC rooms are members-only, persistent, **moderated** and archived (MAM).
- **Game documents:** PubSub nodes with JSON payloads. Access control uses the `whitelist` model (members and publishers); `game-setup` and the theme assets are `open`.
- **Groups (R6):** none needed. Every rule is expressed with per-user room and node affiliations.
- **Admin (R5):** every admin operation runs **over XMPP with the admin's own credentials**:
  - user create, delete and password reset, listing online users and ending sessions use XEP-0133 ad-hoc commands;
  - rooms and nodes use MUC owner and PubSub owner.
  There is **no REST API and no shared secret in the browser**.
- **Anonymous welcome page (D20):** uses SASL ANONYMOUS. Anonymous users can read `game-setup` and the theme assets only.

## 3. Design constraints WRX1 must adopt

These are the rules the WRX1 client, admin UI and mock must follow. Section 4 lists the admin-tooling rules R-A to R-F, which `AdminOps` (`spike/tests/provision/admin-ops.ts`) encodes and `C01-admin-tooling.test.ts` tests.

### 3.1 Read-only observers (R1)
- The observer is a room **member**. The admin revokes its voice once; to do this, the observer is logged in by the admin and the admin moderates it to `visitor`. ejabberd keeps that role per account.
- **Game rooms must always be moderated.** The stored role only applies in moderated rooms, and turning moderation off gives the observer voice. The admin UI must not offer an unmoderated game room.
- **Any change to an observer's room affiliation clears the stored role.** The admin UI must re-apply the revocation after every membership change (rule R-B).
- **The admin UI must manage observer passwords**, because re-applying R-B means logging in as the observer. Players can't change their own password (in-band registration is disabled), which keeps this workable.
- Room settings close the observer's other channels:
  - private messages to occupants;
  - presence status text;
  - nickname changes.
  Other routes are already refused: posting without joining, MUC/Sub, subject changes, message corrections and voice requests.

### 3.2 PubSub access changes (R3, R10)
- **Revoking a player's read access means removing the whitelist affiliation and its subscription (R-A).** In ejabberd a subscribed user keeps reading and receiving events after the affiliation alone is removed.
- Affiliation changes take effect immediately for online sessions, and **the user isn't notified**. The client must handle `<not-allowed/>` and `<forbidden/>` gracefully.
- Moving a role between forces must **grant the new access before revoking the old** (R-D). There is then no lock-out window.

### 3.3 History
- **Room join history is in memory only and is empty after a server restart.** The client must load room history from **MAM** (RSM paging backwards from the latest message). MAM held 10,000 messages and paged complete and in order, at 11–31 ms per page.
- MAM ids equal the `stanza-id` on live messages, so the client should de-duplicate by `stanza-id`.
- **Retention is tied to the room:** destroying a room deletes its archive (R-F), so deleting a game means destroying its rooms.

### 3.4 Payload sizes (R11)
- PubSub items are capped at **250,000 bytes** per item; above that the server returns `<not-acceptable/>`. A 100 KB image item works.
- Node owners can't raise the cap. The operator can, in server config.
- The client should keep documents and images well under 250 KB.

### 3.5 Sessions (D22, D23)
- The same role can be open in several sessions with the same nickname. Both receive everything, and other occupants see one occupant.
- An ended session receives `policy-violation` ("has been kicked"). A deleted account's session receives `conflict` ("User removed"). The client should treat both as forced logout.
- Removal from a room by an affiliation change sends unavailable presence with status codes **110 and 321**.

### 3.6 Anonymous visitors (accepted risk)
- Anonymous users **can list PubSub node names**, e.g. `objectives:blue` and `roles:<id>`, though **not their contents**.
- Accepted by decision: real names are kept for convenience. **The admin page must warn** that node names may be visible to a capable user, and suggest obfuscated names if names are sensitive.

## 4. Admin-tooling rules (for the admin UI and the mock)

| Rule | Requirement |
|---|---|
| R-A | Revoke node access = whitelist affiliation off **and** subscription removed |
| R-B | Re-apply the observer voice revocation after any change to an observer's room affiliation |
| R-C | Game rooms stay moderated; detect and fix if not |
| R-D | Move a role: grant new access, then revoke old |
| R-E | Delete a role: remove room and node affiliations and subscriptions, then the account. Deleting a missing account returns `item-not-found` (an ejabberd quirk) and should be treated as already deleted. |
| R-F | Game history lives as long as its rooms |

## 5. Reference deployment

- **Location:** `spike/docker/ejabberd/`. The image is pinned by digest (`ejabberd/ecs:26.09`).
- **Overlays:**
  - `compose.tls.yaml` mounts the certificate;
  - `compose.prod.yaml` publishes only `wss://` on 5443.
- **Hardened config:**
  - SCRAM-SHA-256;
  - no REST `/api` and no web admin;
  - minimal modules; the full-server admin-API module (`mod_adhoc_api`) is removed;
  - a per-player rate limit of 50 kB/s with a 300 kB burst;
  - in-band registration off.
- **Operations:**
  - offline install from a saved image works;
  - TLS with an internal CA works;
  - cold and **hot** backup with restore are verified, and the whole state is one SQLite file;
  - an in-place upgrade from 26.07 to 26.09 keeps all state, including the observer role.
- **CI:** `.github/workflows/contract-ejabberd.yml` runs the full contract suite (85 tests, about 3 minutes) on every push and PR.
- **Capacity (indicative):**
  - 40 players: 0 errors, room delivery p95 31 ms, about 94 MB of RAM;
  - 200 players, each posting every second: 0 errors, p95 678 ms, about 45% of one CPU and 250 MB.

## 6. Risks and open items

| # | Item | Severity | Mitigation / owner |
|---|---|---|---|
| 1 | The R1 mechanism depends on ejabberd's stored-role behaviour (deliberate code, but not an XMPP standard) | Medium | Keep S01/S01b/C01 in CI on every ejabberd upgrade; admin rules R-B and R-C |
| 2 | **No WebSocket stanza size cap.** Room messages over ~885 KB drop the sender's connection; PubSub is bounded only by the 250 KB node cap | Medium | Client-side limits and the rate limit. Accepted for an internal deployment; revisit if exposed more widely |
| 3 | Observer passwords must be admin-managed (R-B) | Medium | Admin UI requirement |
| 4 | Anonymous users can list node names | Low (accepted) | Admin page warning; opaque names available if needed |
| 5 | Join history isn't persisted | Low | Client uses MAM for history |
| 6 | **Air-gapped host install not yet verified** (S8) | Open | Team, on real hardware: `ops/offline-install.sh` |
| 7 | Mock fidelity (ARC-10/11) | Open | Run the contract suite against the mock when it exists; mock behaviours are listed in `results/summary.md` |

## 7. SRD issue status

| Issue | Status |
|---|---|
| R1 read-only members | **Closed** (ejabberd, with rules R-B and R-C) |
| R3 / R10 PubSub confidentiality and write control | **Closed** (whitelist and publishers; revocation per R-A) |
| R5 admin without a bundled secret | **Closed** (XMPP admin only, 0 REST) |
| R6 groups | **Closed** (not needed) |
| R11 item size | **Closed** (250 KB cap; 100 KB works) |
| D16 server choice | **Closed: ejabberd** |
| D20 anonymous access | **Closed**, with accepted node-name visibility |
| D22 same role, two sessions | **Closed** (works) |
| D23 live changes | **Closed** with rules R-A and R-D |
| NFR-2 / NFR-10 operations | Closed except the **air-gapped host install (open)** |

## 8. Recommended next steps

1. Adopt `spike/docker/ejabberd/` as the reference deployment, and the contract suite as the ARC-10 starting point.
2. Write the admin UI against the `AdminOps` rules, including observer-password management and the node-name warning.
3. Build the browser mock to reproduce the behaviours in `results/summary.md`, and run the contract suite against it.
4. Verify the air-gapped host install.
