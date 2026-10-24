# ejabberd 26.09 (Docker Hub `ejabberd/ecs:26.09`, `sha256:8ebff5b218e686d5dbd93850ea17556d5b70d4c15918c3613e9302a357798e0e`)

Released 2026-09-30, 24 days before the spike. Erlang/OTP 27, Elixir 1.19. Stack: `spike/docker/ejabberd/`.

## Summary

<!-- SUMMARY -->

## Checks

### S0 Browser connectivity (gate)
Result: PASS
Mechanism / config: `ejabberd_http` listener on 5280 with `/ws: ejabberd_http_ws` (RFC 7395). `auth_method: [internal, anonymous]`, `auth_password_format: scram`, `anonymous_protocol: sasl_anon`.
Evidence: `S0-connectivity.test.ts` – admin and all four roles log in over `ws://`. `results/ejabberd/stanzas/S0-admin-login.xml`.
For the mock: the negotiated mechanism is **SCRAM-SHA-1**. SCRAM-SHA-256 is only offered if `auth_scram_hash: sha256` is set before accounts are created, because stored SCRAM hashes are per-algorithm. The HTTP API (`mod_http_api`) is not needed (see S4). CORS was not exercised because no REST is used.
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
- **No WebSocket stanza size limit was hit up to 32 MB.** `max_stanza_size` applies to the c2s listener, not `ejabberd_http_ws`. This is a resource-exhaustion risk to address in the reference deployment.
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
<!-- S5 -->

### S6 Publisher notifications
<!-- S6 -->

### S7 Are groups needed? (R6)
<!-- S7 -->

### S8 Operations (NFR-2, NFR-10)
<!-- S8 -->

### S9 Escape hatch
Result: PASS (hello world loads)
Mechanism: an Erlang `gen_mod` module (`spike/docker/ejabberd/s9-module/`) is copied to `~/.ejabberd-modules/sources/mod_hello/`, then `ejabberdctl module_install mod_hello` **compiles it inside the running server** (no external toolchain). Config comes from `~/.ejabberd-modules/mod_hello/conf/mod_hello.yml`. Log: `mod_hello: hello from localhost`.
Effort: about 20 minutes to a working hello world. One gotcha: the source directory must be writable, because compile output goes beside it. A real read-only enforcement module would hook `muc_filter_message` (Erlang). Docs are adequate: docs.ejabberd.im covers module development and `ext_mod`, and the ejabberd-contrib repo has many examples. Erlang is a niche skill.
Not used in any other check.

### S10 Anonymous access limits (D20, NFR-21)
<!-- S10 -->

### S11 Same role, two sessions (D22)
<!-- S11 -->

### S12 Live changes (D23, ADM-25)
<!-- S12 -->

## Operational notes
<!-- OPS -->

## Risks and surprises
<!-- RISKS -->
