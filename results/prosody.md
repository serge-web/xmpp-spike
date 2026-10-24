# Prosody 13.0.7 (Docker Hub `prosodyim/prosody:13.0`, digest `sha256:3003867be7f61877890d0f2ff0f1e2a439fd727bfd4bf5bc250c9c3278d5f757`)

- **Image source:** `prosodyim/prosody` on Docker Hub, the official image named in https://prosody.im/doc/docker ("Prosody (CI builds)", by Prosody Developers). The older `prosody/prosody` repository has had no updates since 0.11.9 (2021) and says it is no longer published.
- **Tags:** the project publishes only branch tags (`13.0`, `0.12`, `trunk`); there is no `latest` and there are no per-release tags. The pinned digest is the `13.0` tag as of 2026-10-24. It is the multi-arch index; amd64 is `sha256:e376ed0b24549621a288728ac053817e161660b931a6596c81adae85432d57f6`.
- **Version:** `prosodyctl about` reports `13.0 nightly build 100 (2026-09-24, cafd74b9c5ea)`. Its Lua code (`modules/`, `core/`, `util/`, `net/`) is byte-identical to the **13.0.7** release tarball (https://prosody.im/downloads/source/prosody-13.0.7.tar.gz, released 2026-09-24, 30 days ago). Lua 5.4, OpenSSL 3.5.7, LuaDBI 0.7.
- **Age rule (open question):** the *release* is 30 days old, but the *image* was rebuilt by Prosody's CI on 2026-10-21, 3 days ago. That rebuild was probably for base-OS package updates. Strictly read, ground rule 5 (at least 14 days old) fails for the image digest. Because there are no release tags, no image older than the last rebuild can be addressed. A human should decide: accept it (recommended, since the code is the 13.0.7 release), or build from a Debian base with the packages.prosody.im `prosody` 13.0.7 .deb.

## Summary

Mandatory checks: S0 **PASS**, **S1 FAIL**, S2 **PASS**, S3 **PASS**, S4 **PASS**, S5 **PASS**, S10 **PASS** (the only server with clean anonymous isolation). S1 is mandatory, so stock Prosody is **out** under the §7 decision rule, unless a human accepts a custom module (S9 shows one of about 45 lines that works).

REST dependencies: **0**. Every operation so far uses the admin's own XMPP session. Stock Prosody has no HTTP admin API; `mod_http_admin_api` is a community module and is not used.

## Checks

### S0 Browser connectivity
Result: PASS
Mechanism / config: `mod_websocket` at `ws://localhost:5380/xmpp-websocket` (container 5280). `authentication = "internal_hashed"`. `consider_websocket_secure = true` for dev ws://, so the default `c2s_require_encryption = true` still allows SASL. For `wss://`, see S8 (5381).
Evidence: `S0-connectivity.test.ts`, all 5 accounts log in. `results/prosody/stanzas/S0-admin-login.xml`: server offers `OAUTHBEARER SCRAM-SHA-1 PLAIN`, and StanzaJS uses `SCRAM-SHA-1`. Over TLS the server also offers `SCRAM-SHA-1-PLUS` (channel binding), and StanzaJS uses that. There is no SCRAM-SHA-256: `internal_hashed` stores SHA-1 SCRAM credentials.
CORS: stock Prosody has no HTTP admin API, so there is nothing to call cross-origin. The WebSocket endpoint does not check `Origin`. Its HTTP route has CORS enabled by default: `OPTIONS` with `Origin: https://wrx.example` returns `Access-Control-Allow-Origin: https://wrx.example`. To restrict origins, set `access_control_allow_origins`. The old `cross_domain_websocket` option is deprecated and ignored in 13.0.
For the mock: PLAIN is offered too, because ws:// is configured as "secure".
REST / secret needed: no.

### S1 Read-only members (R1)
Result: **FAIL.** No stock mechanism keeps `blue-obs` both unable to post and confidential to members across reconnects with no moderator online.
Mechanism / config tried (`spike/docker/prosody/explore/s1-mechanisms.ts`, log in `results/prosody/S1-mechanisms.txt`):

| # | Room config | blue-obs affiliation | Outcome |
|---|---|---|---|
| Baseline (committed profile) | members-only, moderated | member | Joins as `participant`; the post **is delivered** to blue-co. In Prosody, a moderated room only makes *unaffiliated* occupants visitors (`muc/moderated.lib.lua`: `muc-get-default-role` returns `visitor` only when `affiliation == nil`). Members always get `participant`. |
| M1 | members-only, moderated | member, then a moderator sets role `visitor` | Within that session, the post is rejected (`forbidden`), even after the moderator leaves. After blue-obs leaves and rejoins, it is `participant` again and the post **is delivered**. Prosody stores the role on the occupant (session) only and does not persist it per bare JID (`room_mt:set_role` → `save_occupant`). This differs from ejabberd. |
| M4 | members-only, *not* moderated | member + revoke | Same as M1: forbidden in that session, `participant` again on rejoin. |
| M3 | members-only | none | Cannot join: `<registration-required/>` (auth). Fails "can read". |
| M2 | **not** members-only, moderated | none (+ red-co outcast) | blue-obs joins as `visitor`. Client and raw posts are rejected after a reconnect, with no moderator online. The outcast red-co gets `<forbidden/>`. **But any other account joins as visitor and reads the room**: a brand-new user not on the outcast list joins, and so does an **anonymous** `…@anon.localhost` user. Outcasting is enumerable only for known JIDs, and anonymous JIDs are random. This breaks member-only confidentiality and S10. |
| (code review) | room password (`muc#roomconfig_roomsecret`) on M2 | none | Every joiner must supply the password, members included (`muc/password.lib.lua`). This would put a shared room secret in every client (ground rule 3), and anyone holding it could read. Not adopted; not run. |

Prosody 13 has no stock option for a default role per affiliation, a member-without-voice setting, or a permission that stops guests or unaffiliated users from joining non-members-only rooms. The only MUC permissions are create-room, create-persistent/public-room, recreate-destroyed-room and list-rooms.

Evidence: `S1-read-only.test.ts` (3 failed, 1 passed: "still receives history and live messages" passes). `[S1] blue-obs joined as role=participant affiliation=member; error=undefined`. Stanzas: `S1-client-post.xml`, `S1-raw-post.xml`, `S1-before-reconnect.xml`, `S1-after-reconnect.xml` (baseline, post delivered); `S1-explore-M1-voice-revoked-same-session.xml`, `S1-explore-M2-visitor-open-room.xml`, `S1-explore-M2-anonymous-joins-open-room.xml`.

Exact error stanza when a visitor posts (M1/M2/M4, client API and raw stanza alike):
```xml
<message type='error' from='s1-m2@conference.localhost' xmlns='jabber:client' to='blue-obs@localhost/…' id='ab966fd3-6e1c-444b-95a0-9a7d73eb6c3b'><error type='auth'><forbidden xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'/><text xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'>You do not currently have permission to speak in this chat</text></error></message>
```
For the mock: error type `auth`, condition `forbidden`, the `<text>` above, `from` = room bare JID, and the original `id` echoed. The original `<body>` is **not** echoed back. Other occupants receive nothing. A non-member joining a members-only room gets presence error `auth/registration-required`, and an outcast gets `auth/forbidden`; both carry `by=<room>`.
REST / secret needed: no (n/a).
Escape hatch: see S9. A roughly 45-line module makes listed JIDs permanent visitors and passes the S1 scenario.

### S2 PubSub confidentiality and write control (R3, R10)
Result: PASS (all 15 assertions in `S2-pubsub-acl.test.ts`).
Mechanism / config: `pubsub.localhost` component (`mod_pubsub`), with node creation restricted by the stock `:create-node` permission to `prosody:admin`. Nodes use `pubsub#access_model=whitelist` and `pubsub#publish_model=publishers`, with readers as `member` and publishers as `publisher` affiliations. `game-setup` and `assets:theme` are `open`. The admin is a server admin and gets `owner` on every node (`default_admin_affiliation`).
Evidence: red-co on `objectives:blue`: items `forbidden`/auth, single item `forbidden`, subscribe `forbidden`/auth, disco#items **error `forbidden`** (not an empty list). Publishing to `objectives:blue` as blue-co gives `forbidden`/auth. Affiliation changes apply immediately to online sessions, both grant and revoke. Stanzas: `S2-*.xml`.
For the mock: an unauthorised disco#items on a whitelist node returns an IQ error (`forbidden`), not an empty result.
REST / secret needed: no.

### S3 Item size
Result: PASS. A ~100 KB JSON item round-trips (`S03-item-size.test.ts`).
- **The limit is the stanza size, not the node:** the largest round-trip is between 230,272 and 294,208 bytes. Above that, **the server closes the stream** (the client sees an IQ timeout, then a disconnect), with no error stanza.
- `pubsub#max_payload_size` is not enforced: a node owner can set 8 MB and it is accepted, but the stanza limit still applies.
- Raise `c2s_stanza_size_limit` to allow bigger items.
For the mock: an oversize publish kills the session. Clients must keep items well under 256 KiB.
Note: `c2s_stanza_size_limit` defaults to 256 KiB (`mod_websocket` frame buffer = 2×). `mod_limits` is deliberately not loaded; the image's default config adds a 10 kb/s c2s rate limit.

### S4 Admin provisioning without a bundled secret
Result: PASS (`S04-admin-provisioning.test.ts`, effects verified). Every operation uses the admin's XMPP session: XEP-0133 add-user, change-user-password, delete-user, get-online-users-list and end-user-session; MUC owner for rooms; PubSub owner for nodes.
For the mock:
- An ended session receives **no stream error**, only `<close/>` (`S4-ended-session-user-side.xml`).
- A deleted user's session gets `<stream:error><not-authorized/><text>Account deleted</text>`.
Provisioning (`spike/tests/provision/prosody.ts`) already does, as the admin over XMPP: XEP-0133 add-user and change-user-password (`mod_admin_adhoc`), room create and config and affiliations (MUC owner/admin), node create and config and affiliations (PubSub owner). It is idempotent across re-runs.
**Quirk:** Prosody reports ad-hoc failures as a *successful* IQ with `status="completed"` and `<note type="error">Account already exists</note>`, not as an IQ error (ejabberd returns IQ `<conflict/>`). The shared `adhoc()` helper now throws `AdhocNoteError` on error notes.
Bootstrap: the only out-of-band step creates the `admin` account (image entrypoint `prosodyctl register` from `LOCAL`/`DOMAIN`/`PASSWORD`). Admin rights come from `admins = { "admin@localhost" }` in the config.

### S5 MAM paging at scale
Result: PASS (`S05-mam-paging.test.ts`). 10,000 messages were seeded in 79 s.
| Page size | Pages | Total | Average / max per page | Gaps / duplicates / order |
|---|---|---|---|---|
| 50 | 200 | 5.1 s | 26 / 59 ms | none / none / correct |
| 200 | 50 | 5.3 s | 107 / 148 ms | none / none / correct |
For the mock:
- Archive ids are **UUIDv7 strings** (ejabberd uses numeric µs timestamps). The MAM id equals the `stanza-id` on join history.
- Join history `<delay>` has `from=room JID` and a timestamp truncated to seconds. MAM `<delay>` has **no `from`** and millisecond precision.
Config: `storage = "sql"` with SQLite. The default internal store caps each archive at **10,000 items**, and at the cap `mod_muc_mam` silently drops the oldest 1%. Also set: `muc_log_by_default = true`, `muc_log_expires_after = "never"` (default 1 week), and `max_archive_query_results = 200` (default 50, which would cap page size 200).

### S6 Publisher notifications
Result: recorded. A subscribed publisher receives its own event; notifications carry the payload; they are `type='headline'`; back-to-back publishes arrive in order. These are the same as ejabberd.

### S7 Are groups needed?
Result: no groups needed. Every rule is expressed with `open`/`whitelist` access models and per-JID affiliations (`S07-groups.test.ts`).

### S8 Operations
Result: PASS for offline install from a local archive, TLS with an internal CA, and backup/restore. **Pending human:** the real air-gapped host install.
- **Offline install:** `ops/save-image.sh` → `docker save` (64 MB tar, sha256 `5f8aa76440f94507b83f5a218d3ba46bca98933d29c7f649e8726a3e3e0a56dc`). The image was deleted from the daemon (`docker rmi`), loaded from the tar, and started with `compose.offline.yaml` (`network_mode: none`, `pull_policy: never`, no ports). The container came up healthy with only the `lo` interface, no errors in the log, and `prosodyctl shell "user:list('localhost')"` listed all 5 accounts from the existing volume.
  **Surprise:** `docker save prosodyim/prosody@sha256:…` writes an *untagged* archive. After `docker load` the image is addressable only by ID, so compose's `repo:tag@digest` reference does not resolve and compose would try to pull. Tag first and save the tag. After loading, `prosodyim/prosody:13.0@sha256:3003…` resolves locally (RepoDigests are kept).
- **TLS:** `ops/make-test-ca.sh` creates an openssl test CA and one server certificate with SANs `localhost, conference.localhost, pubsub.localhost, anon.localhost`. `compose.tls.yaml` mounts it over `/etc/prosody/certs`. Prosody indexes certificates by SAN, so one cert covers every host and component ("Certificates loaded" for all four) with no extra config. `openssl s_client -CAfile ca.crt` returns `Verify return code: 0`. `ops/tls-probe.ts` connects StanzaJS over `wss://localhost:5381/xmpp-websocket` with `NODE_EXTRA_CA_CERTS=…/ca.crt` → `OK … with SASL SCRAM-SHA-1-PLUS`. Without the CA it fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`.
- **Backup/restore:** `ops/backup.sh` does a cold backup: stop, tar the data volume (one SQLite file, 8 KB compressed here) using the Prosody image's own `tar` with `--network none`, start. Downtime is a few seconds. `ops/restore.sh` runs `compose down -v` (volume destroyed), creates a new volume with compose labels, untars, and starts. Before the backup, `spike/s8-state.ts seed` wrote a marker item and a marker room message. After the restore, `spike/s8-state.ts verify` reported `all state present`: all 5 logins; all 3 rooms members-only and persistent with their member lists; all 16 nodes with their access model and affiliations; the marker item; and the marker message in blue-hq MAM. A second marker seeded *after* the backup was absent after the restore, so the state really came from the archive. The restore was run twice, once with the TLS overlay and once without.
- Not tried: a hot backup (sqlite online backup; the image has no `sqlite3` CLI) and the XEP-0227 export (`prosody-migrator`).
REST / secret needed: no.

### S9 Escape hatch
Result: done (effort assessment).
- **Language/toolchain:** Lua 5.4. No compile step and no build toolchain: a module is a single `.lua` file. The API is `module:hook(event, fn, priority)`, `module:add_feature`, `module:get_option_*` and `util.stanza`.
- **Loading:** put `mod_<name>.lua` in a plugin path (`plugin_paths`, or the stock `/usr/lib/prosody/modules`) and add it to `modules_enabled`. Alternatively, hot-load with `prosodyctl shell "module:load('<name>', '<host>')"`, with no restart; that is how it was done here.
- **Hello world:** `spike/docker/prosody/s9/modules/mod_wrx_hello.lua` (15 lines). It loaded on an isolated stack (`s9/compose.yaml`, project `wrx-prosody-s9`, since torn down), logged `wrx_hello loaded on localhost`, advertised `urn:wrx:hello` in disco#info, and answered the IQ: `<hello xmlns='urn:wrx:hello'>hello admin</hello>`.
- **R1 sketch:** `s9/modules/mod_wrx_muc_readonly.lua` (about 45 lines, about 30 minutes to write from reading the bundled `muc/*.lib.lua`). It adds a room-config field `{urn:wrx:muc}roomconfig_readonly` (jid-multi, persisted in room `_data`), forces listed JIDs to `visitor` on every join, and blocks re-voicing. In a members-only, unmoderated room with blue-obs as a `member`, blue-obs was `visitor` and got `forbidden` on two separate sessions with no moderator online, and blue-co received nothing (`stanzas/S9-readonly-module-second-session.xml`). It was never loaded on the main stack and never used by any check. Hardening (tests, edge cases such as nick changes or affiliation changes) would add perhaps 1–2 days.
- **Docs quality:** good. https://prosody.im/doc/developers covers the module API and events. The bundled MUC code is small and readable, and event names such as `muc-occupant-pre-join` and `muc-get-default-role` are in the code rather than fully documented, so reading code is needed for MUC internals.

### S10 Anonymous access limits
Result: **PASS** (`S10-anonymous.test.ts`, all 21 assertions).
- Anonymous users can read `game-setup` and `assets:theme`.
- Every protected node gives `<forbidden/>` auth.
- Room join gives `registration-required`; room MAM gives `forbidden`; room creation gives `not-allowed` "Room creation is restricted".
- Publishing, creating nodes and listing users are all denied.
- **disco#items on the PubSub service lists only the nodes the requester may access** (`assets:theme`, `game-setup`). Server disco lists services only (including `anon.localhost`).
Config: SASL ANONYMOUS is **per VirtualHost** in Prosody (`authentication = "anonymous"` cannot be combined with SCRAM on one host). It is on `anon.localhost`, and anonymous users are `<random>@anon.localhost`. `spike/tests/config.ts` has a new `anonymousDomain` for this. Defaults kept: `allow_anonymous_storage = false`, `allow_anonymous_s2s = false`. Already observed in S1 M2: an anonymous user *can* join a non-members-only room as visitor. Members-only rooms reject it with `registration-required`.

### S11 Same role, two sessions
Result: recorded (works).
- The second session joins with the same nick, and both sessions get all messages. A post from one reaches others once and the sibling once.
- When one session leaves, other occupants get a presence **update (available)**, not unavailable, and the remaining session keeps receiving messages.

### S12 Live changes
Result: recorded (advisory). Grant-then-revoke has no lock-out window.
- Revoking `blue-hq` affiliation sends self-presence unavailable with status **321**.
- **PubSub:** removing the whitelist affiliation also cuts off a subscribed reader. Unlike ejabberd, no separate subscription removal is needed (S2 records this).
- Deleting an online user: the session gets `<not-authorized/>` "Account deleted", and others see the user leave the room.
- **The deleted user's room member affiliation remains**, so admin tooling must remove it.

## Operational notes
- Stack: `spike/docker/prosody/compose.yaml` (project `wrx-prosody`; host ports 5380 HTTP/ws, 5381 HTTPS/wss, 5322 c2s). Config: `spike/docker/prosody/prosody.cfg.lua`, a full replacement of the image's env-templated config, with every change marked `CHANGE:`.
- Bundled modules only: websocket, admin_adhoc, admin_shell, mam, muc + muc_mam, pubsub, storage_sql, auth_anonymous.
- The healthcheck needed `pidfile` set; the image's config has none, so `prosodyctl status` fails without it.
- Admin console: none in stock Prosody. Use `prosodyctl shell` (local Unix socket) or XEP-0133 from any XMPP client.
- Docs: generally good and current for 13.0 (prosody.im/doc), including the Docker page. Small inconsistencies: the download page still points at the community `prosody-docker` repo, and `cross_domain_websocket` is still mentioned in places but is now deprecated.

## Risks and surprises
1. **R1 fails stock:** Prosody persists no per-JID voice or role. A moderated room silences only unaffiliated users, and members always get voice. See S1.
2. The image digest is newer than 14 days. There are no release tags, only branch tags that CI rebuilds. Open question for a human (see the header).
3. Ad-hoc command failures come back as an IQ *result* with an error note, not an IQ error (S4). Clients and the mock must check `<note type="error">`.
4. The default internal storage silently truncates archives at 10,000 items. Use SQL (S5).
5. SASL ANONYMOUS needs a separate host domain (S10).
6. disco#items on a forbidden node returns an IQ error, not an empty list (S2).
7. `docker save` by digest produces an untagged archive (S8).
8. Oversize stanzas (>~256 KiB) close the stream without an error (S3). `pubsub#max_payload_size` is not enforced.
9. Room affiliations of deleted accounts persist (S12).
