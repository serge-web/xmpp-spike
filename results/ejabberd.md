# ejabberd 26.09 (Docker Hub `ejabberd/ecs:26.09`, `sha256:8ebff5b218e686d5dbd93850ea17556d5b70d4c15918c3613e9302a357798e0e`)

Released 2026-09-30, 24 days before the spike. Erlang/OTP 27, Elixir 1.19. Stack: `spike/docker/ejabberd/`.

## Summary

**Mandatory checks:** S0 PASS, S1 PASS (quirky mechanism), S2 PASS (revocation needs subscription removal), S3 PASS, S4 PASS, S5 PASS (SQLite backend), S10 PASS (node-name listing accepted by human decision; admin page warning required).
**Verdict: selected** (human decision 2026-10-24). Every admin operation works over XMPP with the admin's own credentials.
**REST dependencies: 0.**

## Checks

### S0 Browser connectivity (gate)
Result: PASS
Mechanism / config: `ejabberd_http` listener on 5280 with `/ws: ejabberd_http_ws` (RFC 7395). `auth_method: [internal, anonymous]`, `auth_password_format: scram`, `anonymous_protocol: sasl_anon`.
Evidence: `S0-connectivity.test.ts` – admin and all four roles log in over `ws://`. `results/ejabberd/stanzas/S0-admin-login.xml`.
For the mock: with the hardened config (`auth_scram_hash: sha256`, set before accounts exist) the negotiated mechanism is **SCRAM-SHA-256**. The stock default is SCRAM-SHA-1. Stored SCRAM hashes are per-algorithm, so switching later needs every password reset. The HTTP API (`mod_http_api`) is not needed (see S4). CORS was not exercised because no REST is used.
REST / secret needed: no.

### S1 Read-only members (R1)
Result: PASS (mechanism has a provisioning quirk, see below)
Mechanism / config: rooms are `membersonly`, `moderatedroom`, `allow_voice_requests: false`, and `blue-obs` has affiliation `member`. At provisioning time, the admin logs in **as `blue-obs`** (it set that password), `blue-obs` joins, the admin, as moderator, sets `blue-obs` to role `visitor`, and both leave. **ejabberd persists that voice revocation per bare JID**, across leave/rejoin, a new session, a different nickname and a server restart. Nothing else is needed afterwards. No moderator is online during the test (asserted from occupant presence).
Mechanisms tried:
| Mechanism | Result |
|---|---|
| Members-only + moderated, observer = member | FAIL: members always get role `participant` (voice) |
| Not members-only, moderated, `members_by_default: false`, observer affiliation `none` → visitor, other forces outcast | Posting blocked, but **anonymous users and any non-outcast account can join as visitors and read** → fails confidentiality |
| Members-only + moderated, observer = member, voice revoked once by a moderator (persisted) | PASS |
| Role change by JID while the observer is offline | Not supported: `<bad-request/>` (role changes need the occupant's nick, i.e. it must be present) |
Evidence: `S1-read-only.test.ts` (client post, raw stanza post, post after reconnect, history + live receipt). Stanzas: `S1-client-post.xml`, `S1-raw-post.xml`, `S1-before-reconnect.xml`, `S1-after-reconnect.xml`.
For the mock:
- The error returned to the observer (other occupants get nothing):
  ```xml
  <message from='blue-hq@conference.localhost' type='error' id='…'>
    <error type='auth'><forbidden xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'/>
      <text xml:lang='en'>Visitors are not allowed to send messages to all occupants</text></error>
    <body>…original body…</body></message>
  ```
- The observer's self-presence shows `affiliation='member' role='visitor'`.
- **An affiliation change clears the stored role.** none→member gives `participant` again. Re-setting the same affiliation (member→member) keeps `visitor`. Any admin UI that re-applies affiliations must re-revoke voice.
REST / secret needed: no.

**S1b side-channel probes (de-risking, `S01b-read-only-bypass.test.ts`).** Each probe runs as `blue-obs` with `blue-co` watching.
| Channel | Stock room options | With the hardened profile |
|---|---|---|
| groupchat without joining (member, non-occupant) | blocked: `<not-acceptable/>` "Only occupants are allowed to send messages to the conference" | same |
| MUC/Sub subscribe, then groupchat | subscribe `<not-allowed/>` (`allow_subscription: false`); post `not-acceptable` | same |
| subject change, XEP-0308 correction | `<forbidden/>` (visitor) | same |
| `type=normal` to the room JID | silently dropped | same |
| voice request (muc#request form) | `<forbidden/>` "Voice requests are disabled in this conference" | same |
| admin re-saves room config | observer stays `visitor` | same |
| **private message to an occupant** | **delivered** | blocked: `<forbidden/>` "You are not allowed to send private messages" (`allow_private_messages_from_visitors: nobody`) |
| **presence status text** | **broadcast to the room** | not delivered (`allow_visitor_status: false`) |
| **nickname change** | **visible to the room** | `<not-allowed/>` "Visitors are not allowed to change their nicknames in this room" (`allow_visitor_nickchange: false`) |
The three options are now set in `provision/ejabberd.ts`, and the mock must reproduce those errors.

**Why the S1 mechanism works, and how stable it is (de-risking, 2026-10-24).**
- **It is deliberate code, not an accident.** `src/mod_muc_room.erl` (tag 26.09) keeps a `roles` map keyed by bare JID.
  - `set_role` writes into it. A `none` role is not stored unless the user is an outcast; the comment says "if someone is kicked, they will maintain the same role they had before".
  - `make_opts` persists the map with the room.
  - `get_occupant_initial_role` applies it on join **only when the room is `moderated`**.
- **Moderation is load-bearing:** with `moderatedroom=false` the observer joins as `participant` and can post. Re-enabling moderation restores `visitor`, because the stored map survives. `S01b` now asserts that every game room is moderated, and admin tooling must never offer unmoderated game rooms.
- **Across versions:** 26.07 passes S00, S01 and S01b (19 tests). An in-place upgrade 26.07 → 26.09 on the same SQLite volume kept the observer as `visitor` and passed `s8-state.ts verify` with all fixture state intact.
- The stored role map isn't shown by `ejabberdctl get_room_options`, so an audit has to join as the observer or read the database.

### S2 PubSub confidentiality and write control (R3, R10)
Result: PASS
Mechanism / config: `pubsub#access_model=whitelist`, with readers as `member` and publishers as `publisher` affiliations, and the admin as owner. `pubsub#publish_model=publishers`. `game-setup` and `assets:theme` are `open`.
Evidence: `S2-pubsub-acl.test.ts` (15 tests).
For the mock (error conditions):
| Attempt | Error |
|---|---|
| red-co items / item-by-id / subscribe on `objectives:blue` | `<not-allowed/>` type `cancel` |
| red-co disco#items on `objectives:blue` | result with 0 items (no error) |
| blue-co publish to `objectives:blue`; non-admin publish to `announcements` | `<forbidden/>` type `auth` |
| Affiliation changes (member, publisher, none) | take effect immediately for online sessions; no notification is sent to the affected user |
REST / secret needed: no.

### S3 Item size (R11)
Result: PASS
Mechanism / config: stock node cap `pubsub#max_payload_size = 250000` bytes. A ~100 KB JSON item round-trips intact.
Evidence: `S3-item-size.test.ts`. Largest round-trip on a default node is between 230,272 and 294,208 bytes (64 KB search). Above the cap, publish gets `<not-acceptable/>` type `modify`.
For the mock / ops:
- **A node owner cannot raise `pubsub#max_payload_size` above the server default.** Any value > 250000 gets `<resource-constraint/>` "Bad value of field 'pubsub#max_payload_size'".
- The operator can raise it server-wide with `mod_pubsub: default_node_config: {max_payload_size: N}`. Verified at 2 MB and 64 MB, with 32 MB items published over WebSocket.
- **No configurable WebSocket stanza cap.** `ejabberd_http_ws` copies the c2s listener's `max_stanza_size` (262144 here), but it is enforced by the XML stream parser, which WebSocket frames bypass:
  - A 300 KB room message is delivered.
  - PubSub items up to 32 MB were accepted when the node cap was raised.
  - Room messages above about **885 KB** close the sender's session ("Connection failed: connection closed") without a stanza error; the cause wasn't pinned down.
  - Mitigations: the stock 250 KB PubSub cap, the c2s shaper (rate, not size) and client-side limits. A proxy can't easily cap WebSocket message size. Residual risk is accepted for an internal deployment.
REST / secret needed: no.

### S4 Admin provisioning without a bundled secret (R5)
Result: PASS. Every operation is over XMPP with the admin's own session.
| Operation | How | REST / secret |
|---|---|---|
| create / delete user | XEP-0133 `add-user` / `delete-user` | no |
| set / reset password | XEP-0133 `change-user-password` | no |
| create room, set affiliations | MUC owner: join → `muc#owner` config form → `muc#admin` affiliation items | no |
| create node, access model, whitelist, publishers | PubSub owner: create with `node_config`, `pubsub#owner` affiliations | no |
| list online sessions | XEP-0133 `get-online-users-list` | no |
| end a user's sessions | XEP-0133 `end-user-session` | no |
Evidence: `S4-admin-provisioning.test.ts` (verifies effects, e.g. login after reset), `S4-admin.xml`, `S4-ended-session-user-side.xml`, `S4-deleted-user-side.xml`.
For the mock:
- `add-user` for an existing account → IQ error `<conflict/>`.
- **`end-user-session` uses field `accountjid` (jid-single)**, while XEP-0133 specifies `accountjids` (jid-multi). Submitting `accountjids` gets `<item-not-found/>` "No hook has processed this command". The harness fits fields to the returned form.
- Ended session: `<stream:error><policy-violation/><text>has been kicked</text></stream:error>`, then `<close/>`.
- Deleted user's online session: `<stream:error><conflict/><text>User removed</text></stream:error>`, then `<close/>`.
- ejabberd also exposes its whole admin API as ad-hoc commands (`mod_adhoc_api`, "API Commands" node), all available to the admin JID over XMPP.
REST / secret needed: no.

### S5 MAM paging at scale
Result: PASS (with the bundled SQLite backend)
Mechanism / config: `mod_mam` (`default: always`), with room archives on by default. `default_db: sql`, `sql_type: sqlite`.
Evidence: `S05-mam-paging.test.ts`. 10,000 messages were seeded in 86 s, about 116 msg/s from one client.
| Page size | Pages | Total | Average / max per page | Gaps / duplicates / order |
|---|---|---|---|---|
| 50 | 200 | 2.2 s | 11 / 24 ms | none / none / correct |
| 200 | 50 | 1.6 s | 31 / 44 ms | none / none / correct |
The `complete='true'` flag arrives on the last page.
For the mock:
- The MAM result id equals the `<stanza-id by='room@conference…'>` on live and join-history messages, so ids are stable across live, history and MAM. Ids are numeric strings (µs timestamps).
- **`<delay from>` differs**: join history uses the room JID (`s5-mam@conference.localhost`), while MAM forwarded items use the service JID (`conference.localhost`). Timestamps are identical.
- Join history (`maxstanzas=5`) gives the same 5 latest messages as a MAM `before=''` page of 5, so a client should de-duplicate by stanza-id.
- Page order: each page is oldest-first; RSM `<first>` is the cursor for the next `before`.
- **Join history is in memory only: after a server restart a joining occupant gets no history, while MAM still has everything** (checked: 0 join-history messages, MAM count 26). Clients must load room history from MAM, not rely on join history.
- **Surprise: the stock Mnesia backend is unusable at this scale.** Seeding ran at about 5 msg/s and a MAM count query (`max=0`) timed out after 15 s at ~9.5k messages. ejabberd logs a warning that Mnesia isn't recommended for MAM. Switching to SQLite is configuration only, with no extra service.
REST / secret needed: no.

### S6 Publisher notifications
Result: recorded
- A subscribed publisher **does** receive the event for its own publish.
- Notifications **carry the payload** (`pubsub#deliver_payloads` defaults to true) and are `type='headline'` messages from `pubsub.localhost`.
- Two publishes sent back-to-back arrive at a subscriber in publish order (1 then 2).
- Events go to the bare JID, so a session receives them only after sending initial presence. The harness does this now; before that change no events arrived.
- Subscriptions are by bare JID; unsubscribing must name that JID.
Evidence: `S06-publisher-notifications.test.ts`, `S6-publisher.xml`, `S6-subscriber.xml`.

### S7 Are groups needed? (R6)
Result: no groups needed
Every §4 rule is expressed with per-user affiliations. Nodes use only `open` or `whitelist` (member/publisher affiliations); rooms use per-JID `member` affiliations in members-only rooms. No shared roster groups, `roster` access model or `pubsub#roster_groups_allowed` are used. `mod_shared_roster` is loaded but unused. The cost is that admin tooling must write N affiliations per node or room, and revoke subscriptions too (see S12).
Evidence: `S07-groups.test.ts` reads the provisioned configuration back; S1, S2 and S10 prove enforcement.

### S8 Operations (NFR-2, NFR-10)
Result: PASS. **Air-gapped host install: pending human verification.**
- **Offline install:** `ops/offline-install.sh save` tags and saves the image (`docker save`, 7b830397… sha256 of the tar). `load-run` loads it and starts it with `--network none --pull never`. The server starts with only `lo` and accepts registrations. Tag before saving, because an archive saved by digest loads untagged.
- **TLS with an internal CA:** `spike/docker/tls/make-ca.sh` creates the CA and a `localhost` certificate with SANs for the service subdomains. `compose.tls.yaml` mounts it as `server.pem` (cert and key in one PEM). The listener on 5443 has `tls: true` and serves `/ws`. With `NODE_EXTRA_CA_CERTS=ca.crt`, StanzaJS gets a session over `wss://localhost:5443/ws`; without the CA, no session. `openssl s_client` reports verify 0.
- **Backup / restore:** `ops/backup.sh` does a cold backup (stop, tar the `database` volume holding SQLite and Mnesia, start). `ops/restore.sh` destroys the volume (`down -v`) and restores the tar. `spike/s8-state.ts verify` confirmed all logins, rooms with config and affiliations, all 16 nodes with access model and affiliations, the marker item, and the marker in blue-hq MAM. A marker written after the backup is absent after restore. **The persisted S1 visitor role also survives** a restore.
- A hot online backup is also possible (`ejabberdctl backup` for Mnesia plus SQLite `.backup`) but was not exercised.
- Admin console: web admin at `/admin` on 5280 (admin JID login). Not needed for anything above.

### S9 Escape hatch
Result: PASS (hello world loads)
Mechanism: an Erlang `gen_mod` module (`spike/docker/ejabberd/s9-module/`) is copied to `~/.ejabberd-modules/sources/mod_hello/`, then `ejabberdctl module_install mod_hello` **compiles it inside the running server** (no external toolchain). Config comes from `~/.ejabberd-modules/mod_hello/conf/mod_hello.yml`. Log: `mod_hello: hello from localhost`.
Effort: about 20 minutes to a working hello world. One gotcha: the source directory must be writable, because compile output goes beside it. A real read-only enforcement module would hook `muc_filter_message` (Erlang). Docs are adequate: docs.ejabberd.im covers module development and `ext_mod`, and the ejabberd-contrib repo has many examples. Erlang is a niche skill.
Not used in any other check.

### S10 Anonymous access limits (D20, NFR-21)
Result: **PASS (by human decision 2026-10-24).** Every content and action limit holds. Anonymous users can list PubSub node *names*; this is **accepted**. Real names are kept for convenience, and the WRX1 admin page must warn that node names may be visible to a capable user and that admins should use obfuscated names if that matters. The S10 check now records the listing and asserts that no listed protected node is readable.
| Attempt as SASL ANONYMOUS (`<random>@localhost`) | Outcome |
|---|---|
| read `game-setup`, `assets:theme` | allowed |
| read `objectives:*`, `announcements`, `forces:*`, `roles:*`, `game-state` | `<not-allowed/>` cancel |
| join any game room | `<registration-required/>` auth, "Membership is required to enter this room" |
| MAM of any game room | `<forbidden/>` auth, "Only members may query archives of this room" |
| create a room | `<forbidden/>` auth, "Room creation is denied by service policy" |
| publish to `game-setup`, create a node | denied |
| XEP-0133 list registered users | denied |
| disco#items on MUC service | empty (game rooms are `publicroom=false`) |
| disco#items on server | services only (`conference`, `pubsub`, "API Commands" node); no users |
| **disco#items on PubSub service** | **lists every node name**: `objectives:blue`, `roles:blue-co`, `rooms:…`, `forces:…` |
Node *contents* stay protected, but the names reveal role, force and room ids. Mitigations tried:
- `mod_pubsub: max_nodes_discoitems: 0` crashes the disco query (Mnesia `badarg`, `<internal-server-error/>`).
- `max_nodes_discoitems: 1` still lists one node.
- Neither is acceptable, so the config is stock.
Other options: opaque node ids (e.g. `objectives:<uuid>`), or a separate vhost for anonymous users (not tried).
Evidence: `S10-anonymous.test.ts`, `S10-anonymous.xml`.

### S11 Same role, two sessions (D22)
Result: recorded (works)
- Two `blue-co` sessions with different resources can both join `blue-hq` with nick `blue-co`. The second join succeeds and others see one occupant (two presence updates for the same nick).
- Both sessions receive every message.
- A post from one session reaches each other occupant **once**, and is also reflected to the sibling session once.
- When one session leaves, other occupants receive **no** unavailable presence, and the remaining session keeps receiving messages. ejabberd treats this as one multi-session occupant.
Evidence: `S11-two-sessions.test.ts`, `S11-*.xml`.

### S12 Live changes (D23, ADM-25)
Result: recorded (advisory). Grant-then-revoke works with no lock-out window.
Move online blue-co from blue to red:
1. Grant red (`red-hq` member, `objectives:red` member). Immediately, blue-co can read both objectives nodes and join `red-hq`. Nothing is pushed to the session.
2. Revoke blue (`blue-hq` affiliation none). The online session receives, in order:
   - bare `<presence type='unavailable' from='blue-hq@conference…'/>`;
   - self-presence `type='unavailable'` with `affiliation='none' role='none'` and status codes **110, 321** (removed because of an affiliation change).
3. **PubSub revocation needs two steps.** Setting the `objectives:blue` affiliation to none is not enough for a subscribed user, who keeps reading items and receiving events. The subscription must also be removed (owner `pubsub#owner` subscriptions, state none). After that, reads give `<not-allowed/>` and re-subscribe gives `<not-allowed/>`. The provisioning helper `revokeNodeAccess` does both.
Delete an online user: the session gets `<stream:error><conflict/><text>User removed</text>`. Other occupants see the user's room presence go unavailable. The user's room affiliation is removed automatically.
Evidence: `S12-live-changes.test.ts`, `S12-move-force.xml`, `S12-deleted-user.xml`.

## Hardening applied (de-risking, 2026-10-24)
The reference config now removes everything WRX1 doesn't use. The full suite (83 tests incl. S01b and C01) passes on a fresh database with it.
- **Authentication:** `auth_scram_hash: sha256` (SCRAM-SHA-256).
- **HTTP:** `/api` and `/admin` are removed from the HTTP listener (both return 404); `api_permissions` keeps only `ejabberdctl`.
- **Modules removed:**
  - `mod_adhoc_api`, which exposed the *entire* admin API as ad-hoc commands to the admin JID;
  - `mod_http_api`, `mod_announce` (announcements are a PubSub node), `mod_vcard` (user directory), `mod_last`, `mod_version`, `mod_privacy`, `mod_private`, `mod_shared_roster` (S7);
  - plus the image-default extras removed at setup (bosh, mqtt, proxy65, push, register, sip, stun, upload, fail2ban).
  Admin over XMPP is now XEP-0133 (`mod_configure`) plus MUC and PubSub owner only.
- **Rooms:** the S1b settings (`allow_private_messages_from_visitors: nobody`, `allow_visitor_status: false`, `allow_visitor_nickchange: false`, `allow_voice_requests: false`), moderated and members-only.
- **Still to decide for production:**
  - serve only `wss://` (drop the plain 5280 listener);
  - a c2s shaper value (currently `fast`, 100 kB/s, for S5 seeding);
  - MAM retention (`ejabberdctl delete_old_mam_messages` from cron, if games are archived elsewhere);
  - `max_user_sessions` (10).

## Operational notes
- **Install:** one container, official image, one YAML file. Admin bootstrap is a single `ejabberdctl register`; everything else is over XMPP.
- **Storage:** switch to bundled SQLite (`default_db: sql`). The stock Mnesia backend failed S5 performance. With SQLite the whole state is one volume.
- **TLS:** PEM file(s) in `certfiles`; any listener can have `tls: true`.
- **Backup/restore:** cold volume tar is simple and verified; hot backup is possible.
- **Config reload:** `ejabberdctl reload_config` doesn't re-apply every module option. `mod_pubsub` options needed a restart.
- **Admin console:** web admin at `/admin`. The whole admin API is also available as XEP-0050 commands to the admin JID (`mod_adhoc_api`), which suits a browser admin UI.
- **Docs:** comprehensive (docs.ejabberd.im), with every option documented. Some behaviours had to be found empirically: persisted roles, subscriptions surviving revocation, the `accountjid` field name.
- **Resources:** ~180 MB RAM idle under test; CPU stayed low with SQLite.

## Risks and surprises
0. **Join history isn't persisted** across restarts (S5); use MAM for history.
1. **S1 relies on persisted voice revocation**, deliberate ejabberd code (see S1) that isn't in XEP-0045, and it only applies while the room is moderated. It needs the observer to be online once during provisioning (done with the admin-set password), and it is **silently cleared by any affiliation change** (e.g. none→member). Admin tooling must re-apply it. A server upgrade could change it, so keep S1 in CI.
2. **S10 node-name enumeration**: accepted by human decision. Admin page warning required (see S10).
3. **PubSub revocation needs subscription removal as well as the affiliation change.** If admin tooling forgets this, a player moved off a force keeps receiving that force's objectives.
4. **No WebSocket stanza size limit** (32 MB accepted). Find and set a limit for the reference deployment (e.g. a reverse proxy frame limit, or `ejabberd_http` options), or accept the risk.
5. **The stock Mnesia backend is unsuitable for MAM at 10k messages.** SQLite is required.
6. SCRAM-SHA-1 is the default hash; choose `auth_scram_hash: sha256` before creating accounts if wanted.
7. XEP-0133 deviation: `end-user-session` uses field `accountjid`.
