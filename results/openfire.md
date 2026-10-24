# OpenFire 5.1.2 (GHCR `ghcr.io/igniterealtime/openfire:v5.1.2`, digest `sha256:5c9119cd4ea6edaa4dfead0cccbeb98847614d47d61715de8fd98c3b189670d6`)

- **Image source:** the official Ignite Realtime image on GitHub Container Registry (`ghcr.io/igniterealtime/openfire`). It has tags `v5.0.1`–`v5.1.2`, `5.1`, `latest` and `main`. Docker Hub has no `igniterealtime` repositories. The image is built from the release on the release day: it was created 2026-08-17, the same day as the 5.1.2 announcement, which is 68 days ago. Base is Ubuntu 26.04 with Temurin JRE 17.0.19+10. `docker save` of the tag has sha256 `36f9f6a83e33599e7f2ae7aaf844d8a42100f152e86bdf0166c36f54b7a55c02`.
- **Release:** Openfire 5.1.2, announced 2026-08-17 at https://discourse.igniterealtime.org/t/openfire-5-1-2-release/96560. The tarball sha256 published there is `0f45006e319fb36bf869ef9ca3a3bef930a1bd683a792883b0b0b4c9a3974680` (`openfire_5_1_2.tar.gz`). The tarball was not used, because the image is official.
- **Plugins (official Ignite plugin repository, https://www.igniterealtime.org/projects/openfire/plugins.jsp):**
  - **Monitoring Service 2.8.0** (2026-06-04, requires 5.1.0), sha256 `ed7d1774…c94ab1`. This plugin is **needed**: core OpenFire 5.1.2 has no XEP-0313 MAM, and with it the MUC service advertises `urn:xmpp:mam:0/1/2`.
  - **REST API 1.12.0** (2025-07-04), sha256 `a1cd5b71…350ccf6`. It is installed but **disabled**, and nothing uses it (see S4). Ignite publishes no plugin checksums; the values above were recorded at first download and are checked by `spike/docker/openfire/fetch-plugins.sh`.
- **Stack:** `spike/docker/openfire/` contains `compose.yaml` (project `wrx-openfire`, host ports 7070 ws, 7443 wss, 9090 console, 5223→5222 c2s), `openfire.xml` (autosetup and every deliberate change, each with a comment), `entrypoint-wrapper.sh`, `bootstrap.sh`, `fetch-plugins.sh`, `ops/` (S8), `s9-plugin/` (S9, an isolated stack) and `probes/` (OpenFire-specific evidence scripts).

Bring-up: `./fetch-plugins.sh && docker compose up -d --wait && ./bootstrap.sh`, then `SERVER=openfire npx vitest run`.

## Summary

| Check | Result |
|---|---|
| S0 | **PASS** |
| S1 | **FAIL**: no stock mechanism makes a member read-only |
| S2 | **FAIL as written** (3 of 16). The rules can be enforced with OpenFire's non-standard affiliation semantics, but disco#items leaks item IDs and node metadata to non-readers. |
| S3 | **PASS** for 100 KB. The cap is about 1 MiB per WebSocket message. The shared search test timed out (see S3). |
| S4 | **PASS**: every operation over XMPP as admin; REST deps = 0 |
| S5 | **FAIL**: MAM RSM paging through 10,000 messages gives duplicates and gaps |
| S6 | recorded (the file failed in one run because of a fixture side effect, see S6) |
| S7 | PASS: no groups needed |
| S8 | **PASS** (offline start, internal-CA wss, backup and restore); the real air-gapped host install is **pending human** |
| S9 | hello-world and a read-only interceptor plugin load and work (about half a day for a Java developer) |
| S10 | **FAIL**: disco#items on the PubSub service lists every node to anonymous users |
| S11 | recorded, works |
| S12 | advisory: the grant-first move fails because of the `member`→`outcast` quirk; a deleted user's session stays connected |

**Verdict: out** under §7. OpenFire fails mandatory S1, S5 and S10, and fails S2 as the contract suite states it. **REST dependencies: 0.**

Shared-suite run (final, `--reporter=verbose`): 51 passed, 13 failed, 2 not run (the S06 `beforeAll` failed). Observations are in `results/openfire/observations.jsonl` and stanzas in `results/openfire/stanzas/`.

## Checks

### S0 Browser connectivity
Result: PASS (5/5).

Mechanism / config: built-in WebSocket endpoint `ws://localhost:7070/ws/` (RFC 7395); over TLS it is `wss://localhost:7443/ws/` (S8). Accounts use the default DB auth provider with `user.scramHashedPasswordOnly=true`, which autosetup sets.

Deliberate change: `sasl.mechs = SCRAM-SHA-1,ANONYMOUS`. Stock OpenFire offers `PLAIN ANONYMOUS SCRAM-SHA-1 SCRAM-SHA-1-PLUS` and advertises `<sasl-channel-binding><channel-binding type="tls-server-end-point"/>` **even on plain ws://**. StanzaJS then picks SCRAM-SHA-1-PLUS but sends the gs2 header `n,,` (no binding), and OpenFire answers `<failure><not-authorized/></failure>`: login fails for every account with stock settings. A browser cannot do tls-server-end-point binding in any case. There is no SCRAM-SHA-256.

Evidence: `S00-connectivity.test.ts`; `stanzas/S0-admin-login.xml` (`mechanism="SCRAM-SHA-1"`).

CORS:
- The admin console and REST API plugin (port 9090, when enabled) answer preflight with `Access-Control-Allow-Origin: *`, `Allow-Credentials: true`, `Allow-Headers: origin, content-type, accept, authorization`, and methods `GET, POST, PUT, DELETE, OPTIONS, HEAD`.
- The HTTP-bind port 7070 also answers `Allow-Origin: *`.
- The WebSocket endpoint does **not** check `Origin` (a connection with `Origin: https://evil.example` is accepted).

For the mock: `<limits xmlns="urn:xmpp:stream-limits:0"><max-bytes>1048576</max-bytes><idle-seconds>360</idle-seconds></limits>` appears in stream features. Stream management (`urn:xmpp:sm:3`) is enabled.

REST / secret needed: no.

### S1 Read-only members (R1)
Result: **FAIL**. No stock mechanism stops `blue-obs` posting while it keeps members-only confidentiality across reconnects with no moderator online.

How OpenFire assigns roles (`MUCRoom.getRole`, confirmed by test): owner/admin → moderator; member → **participant, always**; none → visitor if the room is moderated, otherwise participant. A moderator's voice revocation is held on the occupant only. It is not persisted per bare JID, unlike ejabberd. OpenFire has no "roles that may send messages" setting: its only role-related room option is `muc#roomconfig_presencebroadcast`.

Mechanisms tried (`spike/docker/openfire/probes/s1-mechanisms.ts`, output in `results/openfire/S1-mechanisms.json`):

| # | Room | blue-obs affiliation | Outcome |
|---|---|---|---|
| A (committed profile) | members-only, moderated | member | Joins as `participant`; the post **is delivered** (shared S1: 3 fail, "receives history and live" passes). |
| B | as A; a moderator sets role `visitor` | member | In that session the post is rejected `forbidden`. After reconnect, with no moderator present: `participant` again, and the post **is delivered**. |
| C | members-only, moderated | none | Cannot join: presence error `auth/registration-required` ("This is a member-only room. Membership is required."), so it fails "can read". |
| D | **not** members-only, moderated | none (+ red-co outcast) | blue-obs joins as `visitor`; the post is rejected after reconnect with no moderator. The outcast red-co gets `forbidden`. **But an anonymous user and any non-outcast account (umpire-1 without affiliation) join as visitor and read the room.** This breaks confidentiality and S10. |
| E | as A + `presencebroadcast=[moderator]` | member | No effect on voice; the post is delivered. |
| (code review) | D + room password | none | The password would be a shared secret in every client (ground rule 3). Not adopted. |

Exact error stanza (D, and B within the session; the client API and the raw stanza give the same result):
```xml
<message xmlns="jabber:client" id="d4ef46a3-…" to="blue-obs@localhost/…" type="error" from="s1-d@conference.localhost"><origin-id xmlns="urn:xmpp:sid:0" id="d4ef46a3-…"></origin-id><body>post-…</body><stanza-id xmlns="urn:xmpp:sid:0" id="288f926d-…" by="s1-d@conference.localhost"/><occupant-id xmlns="urn:xmpp:occupant-id:0" id="293c70…"/><error code="403" type="auth"><forbidden xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/><text xmlns="urn:ietf:params:xml:ns:xmpp-stanzas">You are not allowed to send a public message to the room (you might require 'voice').</text></error></message>
```

For the mock:
- The error is `auth`/`forbidden` with legacy `code="403"`, from the room bare JID.
- **The original body is echoed** in the error, and the error carries a `<stanza-id by=room>` and an `<occupant-id>` even though nothing was delivered.
- Other occupants receive nothing.

Evidence: `stanzas/S1-client-post.xml`, `S1-raw-post.xml`, `S1-before-reconnect.xml`, `S1-after-reconnect.xml` (baseline, delivered); `S1-openfire-B-after-reconnect.xml`, `S1-openfire-C-join.xml`, `S1-openfire-D-obs.xml`, `S1-openfire-D-anon.xml`.

Escape hatch: S9 shows that a roughly 70-line plugin makes listed JIDs read-only regardless of role.

**Related security default (F):** `x-muc#roomconfig_registration` defaults to **true**. With it, any non-outcast user (here red-co) can register with a members-only room (`jabber:iq:register`), and OpenFire makes that user a **member**, who then joins and posts (`S1-openfire-F-room-registration.xml`). The profile sets it to false. The mock and the real deployment must always do the same.

REST / secret needed: n/a.

### S2 PubSub confidentiality and write control (R3, R10)
Result: **FAIL as written** (13/16 pass). The access rules themselves can be enforced, but only with OpenFire-specific affiliations.

OpenFire affiliation semantics (`PubSubEngine.modifyNodeAffiliations`, `WhitelistAccess`, `Node.sendAffiliations`; `probes/s2-affiliation-semantics.ts`, output in `results/openfire/S2-affiliation-semantics.json`):
1. **OpenFire has no `member` affiliation.** Setting `member` (or any other unknown value) is **silently stored as `outcast`**, and the IQ result is success. The XEP-0060 whitelist grant therefore locks the user out.
2. **Whitelisted = any affiliate that is not an outcast**, including an explicit `none`. Provisioning grants readers `none` (`nodeReaderAffiliation: 'none'`) and revokes with `outcast`.
3. **`none` affiliates are omitted from the owner's affiliation list.** The admin cannot see a node's readers over XMPP. Convergence is done by explicitly outcasting every non-reader role (`outcastNonReaders`).
4. **A `none` reader whose last subscription is removed loses its affiliation, and so its read access.** This happens when the reader unsubscribes, or when an owner removes the subscription. S06's own unsubscribe locked blue-co out of `objectives:blue`.
5. `xmpp.pubsub.multiple-subscriptions` defaults to true. A second subscribe by the same bare JID succeeds, and from then on items requests fail `modify/bad-request` + `<subid-required/>`. An owner's subscription change without a `subid` fails `bad-request` too. This affects the shared `setSubscription`/`revokeNodeAccess` helpers.

With these semantics, grant and revoke apply at once to online sessions: `none` → can read in the same session, `outcast` → `not-allowed` in the same session. Publisher grant and revoke are immediate too.

Failing shared tests:
- *red-co cannot discover the items of objectives:blue*: disco#items on a whitelist node returns the **item IDs** to non-readers, and disco#info returns the meta-data form, including `pubsub#owner` and `pubsub#publisher` JIDs and the access model. Anonymous users get the same (S10).
- *adding red-co (member) grants read*: the grant becomes `outcast` (quirk 1).
- *revoking a SUBSCRIBED reader*: red-co cannot subscribe after the `member` grant (`not-allowed` + `closed-node`).

Errors for the mock:
- Read without access: `cancel/not-allowed` + `<closed-node xmlns="…pubsub#errors"/>` (legacy `code="405"`).
- Subscribe without access: same as read.
- Publish without rights: `auth/forbidden`.

Node defaults: `pubsub#max_items=1` (**a node keeps only its latest item** unless configured otherwise), `max_payload_size=10485760`, `deliver_payloads=true`, `persist_items=true`.

Evidence: `stanzas/S2-*.xml`, `S2-openfire-semantics-*.xml`.

REST / secret needed: no.

### S3 Item size (R11)
Result: PASS for the brief's requirement (a ~100 KB base64 JSON item publishes and fetches).

The limit is the WebSocket message size of **1 MiB** (1,048,576 bytes), which is also advertised as `max-bytes` in stream features. The largest item that round-trips is about **997 KB** (observation `lo: 997504`). Above the limit, Jetty closes the socket with **WebSocket close 1009 "Text message too large: 1,056,768 > 1,048,576"**, with no XMPP error. The in-flight IQ then only times out on the client (15 s). Evidence: `probes/s3-ws-frame-limit.ts`.

`pubsub#max_payload_size` defaults to 10 MB, and an owner can set 8 MB, but the transport cap still applies.

The two shared search tests hit their 30 s timeout. Each stream drop costs a 15 s IQ timeout, so this is a test-budget problem, not a server error.

Config: no server property for the WebSocket frame limit was found in the time box; `xmpp.parser.buffer.size` is the stanza-parser cap and was not changed.

REST / secret needed: no.

### S4 Admin provisioning without a bundled secret (R5)
Result: **PASS**. All operations run over XMPP as `admin@localhost`, with no REST and no secret.

| Operation | How |
|---|---|
| create / delete user | XEP-0133 `add-user` / `delete-user` |
| set / reset password | XEP-0133 `change-user-password` |
| create room, set affiliations | MUC owner (join, then `muc#owner` config, then `muc#admin` items) |
| create node, access model, whitelist, publishers | PubSub owner, using OpenFire semantics (S2) |
| list online sessions | XEP-0133 `get-online-users-list` |
| end a user's sessions | XEP-0133 `end-user-session`: the session is disconnected |

OpenFire also exposes `get-registered-users-list`, `disable-user`/`reenable-user`, group commands and `create-muc-room`.

Who may run them: server admins (`admin.authorizedJIDs`, which defaults to `admin@<domain>`).

For the mock:
- Ad-hoc failures are **not** IQ errors. They come back as `status="completed"` with `<note type="error">User already exists.</note>` / `User does not exist: …`. `adhoc()` raises `AdhocNoteError` for these.
- **`delete-user` does not end the user's online session**: it stays connected for at least 5 s and receives nothing (S04 records "still connected", S12 asserts it and fails). Later logins fail.

One-time operator steps outside S4:
- MUC service settings (room-creation restriction) live in the `ofMucServiceProp` DB table. No system property and no XMPP command sets them, so `bootstrap.sh` drives the admin console form (*Group Chat → Room Creation Permissions*) with the admin's credentials.
- Autosetup creates the admin account.

REST API plugin, for the record:
- It authenticates by **HTTP Basic with an admin account** (a non-admin gets 401), by a **shared secret**, or by a custom filter class.
- It needs the system property `adminConsole.access.allow-wildcards-in-excludes=true`; otherwise every call is redirected 302 to the console login.
- CORS is `*` (see S0).
- It was enabled briefly to measure this, then disabled again; no WRX1 operation uses it.

REST / secret needed: **no**.

### S5 MAM paging at scale
Result: **FAIL**.

Seeding 10,000 messages took 65.6 s. Paging backwards with RSM `before` until `complete`:

| Page size | Pages | Total | Avg page | Max page | Items | Duplicate IDs |
|---|---|---|---|---|---|---|
| max=50 | 200 | 12.1 s | 61 ms | 139 ms | 9,998 | 72 |
| max=200 | 50 | 4.9 s | 98 ms | 136 ms | 9,980 | 10 |

Both runs have gaps (bodies missing) and both set the `complete` flag.

Cause (observed): Monitoring orders and pages by the millisecond timestamp, and the burst seed produced many messages per millisecond. Within a page, results are in timestamp order, not ID order (e.g. ids `10026, 10024, 10025, 10027…`), so `before=<first id>` boundaries overlap or skip. Normal chat rates may not show this, but the server does not guarantee correct paging.

IDs and stamps for the mock:
- The MAM `<result id>` is Monitoring's **numeric DB id** (e.g. `10026`). It is **not** the `stanza-id`.
- The archived message still carries the original `<stanza-id by=room>` (a UUID), and that matches the UUID `stanza-id` in join history and live messages. De-duplication must use the inner `stanza-id`, not the result id.
- `<delay stamp>` is in ms. Join history carries `delay from=<real full JID of the sender>`.

Privacy: archived MUC messages include `<addresses><address type="ofrom" jid="<sender real full JID>"/></addresses>` in a room with `whois=moderators`. Every member who can read MAM sees real JIDs.

Evidence: `S05-mam-paging.test.ts`; `stanzas/S5-join-history-vs-mam.xml`.

REST / secret needed: no.

### S6 Publisher notifications
Result: recorded (run 2; in the final run the file failed in `beforeAll`).
- A subscribed publisher receives its own event: **yes**.
- Notifications carry the payload: **yes**.
- The event message has no `type` (normal).
- Two back-to-back publishes arrive in order 1, 2.
- Final run: S06's `beforeAll` unsubscribes, then subscribes, `blue-co` to `objectives:blue`. The unsubscribe removed blue-co's `none` affiliation (S2 quirk 4), so the subscribe failed `cancel/not-allowed`+`closed-node`, the file failed and its 2 tests were not run. The result depends on the order the files run in.

Evidence: `stanzas/S6-publisher.xml`, `S6-subscriber.xml` (from run 2).

### S7 Are groups needed? (R6)
Result: PASS. Every rule in §4 uses per-JID MUC affiliations and PubSub affiliations (whitelist = `none`, revoke = `outcast` on OpenFire). No node uses roster, presence or authorize access, and no shared/roster groups are used.

### S8 Operations (NFR-2, NFR-10)
Result: **PASS** in the container. The real air-gapped host install is **PENDING HUMAN**.

**Offline install:**
- `ops/save-image.sh` saves the tagged image (sha above) and plugin jars with a `SHA256SUMS` file.
- `docker load` and `docker compose -p wrx-openfire-offline -f compose.yaml -f compose.offline.yaml up` run with `network_mode: none` and `pull_policy: never`, on a fresh volume. First-boot autosetup, schema install and all 4 plugins (admin, monitoring, restapi, search) load with only `lo` present.
- `ops/offline-probe.sh`, run inside the container, opens a c2s stream and gets features (ANONYMOUS, SCRAM-SHA-1).
- Only the update check fails, as expected: "Error checking for updates" in the log.

**TLS:**
- `ops/make-test-ca.sh` creates a throwaway internal CA and a `localhost` certificate (SAN `localhost`, `*.localhost`, `127.0.0.1`).
- `ops/install-cert.sh` uses the image's `keytool` to replace alias `localhost_rsa` in the JKS identity store `/var/lib/openfire/conf/security/keystore` (password `changeit`, the OpenFire default), then restarts OpenFire. The console path is *Server → TLS/SSL Certificates*.
- Verification: `openssl s_client -connect 127.0.0.1:7443 -CAfile tls/ca.crt` returns `Verify return code: 0`. StanzaJS over `wss://localhost:7443/ws/` with `NODE_EXTRA_CA_CERTS=tls/ca.crt` connects and the S00 suite passes (5/5). Without the CA, it fails with `self-signed certificate in certificate chain`.

**Backup and restore (cold):**
- `ops/backup.sh` stops OpenFire and tars the whole data volume, 92 MB including the 10k-message MAM. The volume holds `conf/openfire.xml`, keystores, the embedded HSQLDB and plugins.
- `ops/restore.sh` runs `down -v`, creates a new volume, untars and starts.
- `ops/state.ts verify` passed **99/99** checks after restore (`results/openfire/S8-restore-verify.txt`):
  - all 5 logins;
  - 3 rooms, members-only and persistent, with exact member lists;
  - 16 nodes with access models;
  - per-role whitelist enforcement checked by behaviour, because `none` readers are invisible;
  - publishers;
  - the marker item in `objectives:blue`;
  - the marker message in blue-hq MAM.
- The custom TLS certificate also survived, and the MUC creation restriction lives in the DB, so it survived too.

Image quirk: the stock entrypoint creates `/var/lib/openfire/embedded-db` on the volume but never links it. HSQLDB opens `$OPENFIRE_HOME/embedded-db` (`/usr/local/openfire/embedded-db`), which is in the container layer, so the database would be lost when the container is recreated. `entrypoint-wrapper.sh` adds the symlink and then calls the unchanged `/sbin/entrypoint.sh`.

### S9 Escape hatch
Result: done. `spike/docker/openfire/s9-plugin/` contains `WrxReadOnlyPlugin.java` (about 70 lines including comments) and `plugin.xml`.
- **Language and toolchain:** Java 17. It is built with plain `javac` + `jar` in `eclipse-temurin:17.0.19_10-jdk@sha256:0861abc5…6f90` (published 2026-08-19, the same JDK as the image's JRE) against the jars in the pinned image (`build.sh`); no Maven needed. The documented route is Maven with Ignite's `plugins` parent POM.
- **Loading:** drop the jar into `plugins/` (the image copies `/opt/plugins/*.jar`); hot-deploy works. Log: `Successfully loaded plugin 'wrxreadonly-0.1.0'` and `WRX1 hello world: plugin loaded from /usr/local/openfire/plugins/wrxreadonly`.
- **Read-only sketch:** a `PacketInterceptor` rejects groupchat messages to `conference.<domain>` from listed bare JIDs and routes back a `auth/forbidden` error. Tested on an **isolated stack** (`wrx-openfire-s9`, ports 17070/19090, own volume, now removed): blue-obs, a plain member with role `participant`, was rejected in 2 of 2 rounds across reconnects, with nothing delivered (`probe.ts`, `stanzas/S9-openfire-readonly-plugin.xml`). A production version would use `MUCEventDelegate` or a room/affiliation-backed list.
- **Docs quality:** the plugin developer guide on igniterealtime.org is adequate. The interceptor and plugin APIs are stable, but most detail has to come from reading the OpenFire source (`Plugin`, `InterceptorManager`, `MUCRoom`).
- **Effort:** about half a day for a Java developer to reach production quality, plus packaging and CI.

Never enabled in the main stack.

### S10 Anonymous access limits (D20, NFR-21)
Result: **FAIL** (20/21).

Mechanism: SASL ANONYMOUS on the main domain (`xmpp.auth.anonymous=true` via autosetup). Anonymous JIDs look like `<uuid>@localhost/<uuid>`.

Anonymous **can** read `game-setup` and `assets:theme`.

Anonymous **cannot**:
- read whitelist nodes (`cancel/not-allowed`);
- join rooms (`auth/registration-required`);
- read room MAM (`auth/forbidden` "You are currently not allowed to access the archive of room …");
- create a room (`cancel/not-allowed` "You do not have permission to create a new room.");
- publish or create nodes;
- list users (XEP-0133 refused);
- list rooms (MUC disco#items is empty because the rooms are not public).

Fail: **disco#items on `pubsub.localhost` lists every node** (all 16 fixture nodes plus the S3 test node, including `objectives:*` and `roles:*`). On a whitelist node, disco#items also returns item IDs, and disco#info returns owner/publisher JIDs (S2). No stock setting to hide nodes was found.

Also noted:
- Server disco shows `search.localhost` (User Search plugin, bundled) and `proxy.localhost`; the users-directory test passed.
- In-band registration is disabled (`register.inband=false`, a deliberate change; the stock default lets anyone create accounts).

Evidence: `stanzas/S10-anonymous.xml`.

REST / secret needed: no.

### S11 Same role, two sessions (D22)
Result: works. A second `blue-co` session joins with the same nick (OpenFire multi-session nick). Others see one join presence per session (2). A post from session 1 appears once to the umpire and is also delivered to session 2. When session 1 leaves, the others see **no** presence and session 2 stays in the room.

For the mock: in general, OpenFire does **not** send the leaver its own unavailable presence (see Risks). With multi-session nicks, only the leaving session is told.

Evidence: `stanzas/S11-*.xml`.

### S12 Live changes (advisory)
- **Move blue-co to red, granting first:** the room grant applies at once (blue-co can join red-hq in the same session). The PubSub grant as written (`member`) **turns into `outcast`** (S2 quirk 1), so `objectives:red` stays unreadable and the check fails. With `none`, the grant works (S2 probe).
- **Revoke via `revokeNodeAccess`:** this sets `none`, which on OpenFire *keeps* whitelist access, and then removes subscriptions without a subid. The effect depends on whether a subscription existed (S2 quirks 2, 4, 5).
- **Delete an online user:** its session **stays connected** and receives nothing. Others in blue-hq see no unavailable presence. The user is no longer listed as a room member.

Evidence: `stanzas/S12-deleted-user.xml`.

## Operational notes
- **Install:** one container with the embedded HSQLDB; no external DB is needed. Unattended setup uses `<autosetup>` in `openfire.xml` (`XMPPServer.runAutoSetup`):
  - locale, domain and fqdn;
  - anonymous auth and the legacy SSL port;
  - property encryption;
  - DB mode and admin password;
  - optional users.

  Every other XML property is copied into the DB at first boot. After setup, OpenFire rewrites `openfire.xml`: it removes `<autosetup>` and the migrated properties and adds `<setup>true</setup>`. Later edits of those properties in the file have no effect, so change them in the admin console or re-run setup on a fresh volume.
- **Config not reachable by file:** MUC service settings live in the DB only. They are set with the admin console, which `bootstrap.sh` scripts with curl and CSRF tokens. The property name is inverted: service property `create.anyone=true` means room creation is *restricted*.
- **Admin console:** http://localhost:9090, login `admin`. It is complete, and every system property is editable (`server-properties.jsp`).
- **TLS:** JKS keystore with `keytool`, or import through the admin console. One identity store serves c2s and HTTP/WebSocket. Port 5222 c2s offers SASL before STARTTLS (TLS is optional by default).
- **Backup:** a cold copy of the volume is enough. A hot backup of the embedded DB was not tested.
- **Logs:** `/var/log/openfire/openfire.log`. It shows harmless NPEs from `WebSocketConnection.closeVirtualConnection` on client disconnect.
- **Docs:** the install guide covers autosetup only briefly; the full list of keys had to come from reading the source. The plugin docs are adequate.

## Risks and surprises
1. **No read-only member role** (S1). Members always get voice; voice revocation is lost on rejoin.
2. **The stock MUC room-registration default lets any user make themselves a member** of a members-only room (`x-muc#roomconfig_registration=true`).
3. **PubSub `member` → silently `outcast`.** Whitelist = any non-outcast affiliate, including `none`. `none` affiliates are hidden from the owner. A reader who unsubscribes loses access. Multiple subscriptions per JID are on by default, and after a second one, item fetches need a `subid`. The contract suite's XEP-0060 assumptions fail here, and the mock must reproduce OpenFire's behaviour if OpenFire were chosen.
4. **Node and item discovery leaks:** disco#items lists all nodes to anyone (including anonymous users), and lists item IDs for whitelist nodes. disco#info reveals owners and publishers.
5. **`pubsub#max_items` defaults to 1.** The fixture's provisioning does not set it, so every node keeps only its latest item.
6. **MAM via a plugin:** the result id ≠ stanza-id, paging is wrong under bursts, and archived MUC messages expose real sender JIDs (`ofrom`).
7. **No self-presence on MUC leave** (XEP-0045 §7.14). `ensureRoom`/`leaveRoom` must not wait for it (`mucLeaveSelfPresence: false`).
8. **SCRAM-SHA-1-PLUS is advertised over plain ws://** and breaks StanzaJS logins unless the SASL mechanisms are restricted.
9. **`delete-user` leaves the session online.**
10. **WebSocket close 1009 above 1 MiB**, with no XMPP error.
11. **The image's embedded-db path is not on the volume** (fixed with the wrapper symlink).
12. **Ad-hoc errors arrive as `<note type="error">` on a completed command.**
