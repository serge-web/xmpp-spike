# WRX1 XMPP server spike: summary and recommendation

Spike run 2026-10-24 per `SPIKE-BRIEF.md`. The same contract suite (`spike/tests/checks/S00–S12`, StanzaJS over WebSocket) was run against all three servers. Per-server evidence is in `results/<server>.md`, `results/<server>/observations.jsonl` and `results/<server>/stanzas/`.

| | ejabberd | Prosody | OpenFire |
|---|---|---|---|
| Version | 26.09 (`ejabberd/ecs`, digest-pinned) | 13.0.7 (`prosodyim/prosody:13.0`, digest-pinned) | 5.1.2 (`ghcr.io/igniterealtime/openfire`, digest-pinned) + Monitoring 2.8.0 plugin |
| Storage used | bundled SQLite | bundled SQLite | embedded HSQLDB |

## Comparison

| Check | ejabberd | Prosody | OpenFire |
|---|---|---|---|
| **S0** WebSocket + SCRAM (gate) | PASS | PASS | PASS (after disabling SCRAM-SHA-1-PLUS on ws://) |
| **S1** read-only member, no moderator online | **PASS**: moderator voice revocation is persisted per JID; done once at provisioning | **FAIL**: revocation is per session only | **FAIL**: revocation is per session only |
| **S2** PubSub confidentiality / write control | PASS (revocation must also remove the subscription) | PASS | FAIL as written: `member` is silently stored as `outcast`; disco leaks item ids |
| **S3** ~100 KB item | PASS (node cap 250 000 B, no ws stanza cap seen) | PASS (stanza cap ~256 KiB, stream closed above it) | PASS (1 MiB ws frame cap, socket closed above it) |
| **S4** admin ops without a secret | PASS, all over XMPP | PASS, all over XMPP | PASS, all over XMPP |
| **S5** MAM paging over 10 000 messages | PASS (2.2 s / 200 pages) | PASS (5.1 s / 200 pages) | **FAIL**: duplicates and gaps |
| **S10** anonymous limits | **FAIL (strict)**: node *names* listed; all content and actions denied | **PASS** (separate anon vhost, filtered disco) | **FAIL**: node names listed |
| S6 publisher notifications | own event yes, payload yes, ordered | same | recorded |
| S7 groups needed? | no | no | no |
| S8 offline / TLS / backup | PASS (air-gap host pending) | PASS (air-gap host pending) | PASS (air-gap host pending) |
| S9 module effort | Erlang, compiled in-server, ~20 min | Lua, one file, ~15 min; read-only module ~45 lines | Java plugin, ~½ day |
| S11 one role, two sessions | works | works | works |
| S12 live changes | grant-then-revoke works | works | breaks (affiliation quirk; deleted user stays connected) |
| **REST dependencies** | **0** | **0** | **0** (REST plugin installed but unused) |

## Recommendation

**Choose ejabberd**, subject to one human decision on S10.

Under §7 as written, **no server passes every mandatory check**:
- ejabberd fails only S10, and only on a strict reading: an anonymous user can *list* PubSub node names but cannot read, subscribe, join, query MAM or publish.
- Prosody fails S1, the hard requirement (R1).
- OpenFire fails S1, S5 and S10.

Reasoning:
1. **ejabberd is the only server that passes S1 (R1) stock.** The brief makes S1 the stop condition, so ejabberd is the only server the SRD can proceed with without a custom module or a deferred decision.
2. ejabberd's S10 gap is a metadata leak, not an access-control failure. Two ways to close it without code:
   - **Accept** listing of names (role, force and room ids are not secret in most games).
   - **Make node names opaque** (e.g. `objectives:9f2c…`), so a listing reveals nothing. Mapping names to ids is the client's job. Not yet tested.
3. All three have 0 REST dependencies, so the first tie-break doesn't separate them. On operations, ejabberd and Prosody are both one-container, one-file setups; OpenFire needs a plugin for MAM, database-only settings done via the admin console, and an entrypoint fix for its embedded database.
4. **Fallback: Prosody plus a ~45-line custom read-only MUC module** (S9). Prosody is the cleanest server on S10 and very simple to run, but this breaks ground rule 2 (stock only) and SRD D2. That needs a human decision.

### Human decisions needed
1. **S10 on ejabberd:** accept node-name enumeration, adopt opaque node ids, or treat it as a fail. If it's a fail, no server passes, and the choice is between ejabberd + opaque ids and Prosody + module.
2. **Prosody image age:** the CI image digest is 3 days old (the release is 30 days old); there are no release tags. Only relevant if Prosody is chosen.
3. **S8:** the real air-gapped host install must be verified by the team (all three are marked pending).

## Open issues closed or left open

| Issue | Status |
|---|---|
| **R1** read-only members | **Closed for ejabberd** (persisted voice revocation, set once at provisioning). Open for Prosody/OpenFire without a module. Caveat: any affiliation change clears it, so admin tooling must re-apply it. |
| **R5** admin without a bundled secret | **Closed**: all S4 operations work over XMPP with the admin's own login on all three servers. No REST, no shared secret. |
| **R6** groups | **Closed**: no groups needed; everything is per-JID affiliations and whitelists. |
| **D16** server choice | **Proposed: ejabberd**, pending decision 1 above. |
| New: R3/R10 revocation | On ejabberd a subscribed reader keeps access after leaving the whitelist until its subscription is removed. Admin tooling must do both. |
| New: stanza size limits | ejabberd showed no WebSocket stanza cap (32 MB accepted); the reference deployment needs one. |

## Behaviours the mock must reproduce (ejabberd as reference)

Errors:
- Observer post: `<message type='error'>` from the room, `<error type='auth'><forbidden/>`, text "Visitors are not allowed to send messages to all occupants", body echoed. Other occupants receive nothing.
- PubSub read, item or subscribe without access: `<not-allowed/>` type `cancel`. Publish without rights: `<forbidden/>` type `auth`. disco#items on a node you can't read: empty result, not an error.
- Item over 250 000 bytes: `<not-acceptable/>` type `modify`. Owner setting `pubsub#max_payload_size` > 250000: `<resource-constraint/>`.
- Members-only room join by a non-member: `<registration-required/>` type `auth`. MAM query by a non-member: `<forbidden/>` type `auth`. Room creation by a non-admin: `<forbidden/>` "Room creation is denied by service policy".
- Ad-hoc `add-user` on an existing account: IQ `<conflict/>`. `end-user-session` takes field `accountjid`.

Session events:
- Session ended by admin: `<stream:error><policy-violation/>` "has been kicked". Account deleted: `<stream:error><conflict/>` "User removed".
- Removed from a room by affiliation change: self-presence `unavailable`, `affiliation='none' role='none'`, status codes 110 and 321, preceded by a bare-room unavailable presence.

Roles and affiliations:
- Observer self-presence: `affiliation='member' role='visitor'`. An affiliation change resets the role to `participant`; re-setting the same affiliation keeps `visitor`.
- Whitelist/publisher affiliation changes take effect immediately, with no notification to the user. A subscribed reader keeps access until its subscription is removed.

MAM and history:
- MAM ids equal `stanza-id` (numeric µs strings). Pages are oldest-first, cursor is RSM `first`, `complete='true'` on the last page.
- Join history `<delay from=room>`; MAM `<delay from=service>`.

PubSub events:
- Notifications are `headline` messages from the PubSub service, carry the payload, and go to the publisher too if subscribed. Publishes arrive in order.
- Events go to the bare JID and need the session to have sent presence.

Multiple sessions:
- Two sessions with the same nick share one occupant. One leaving sends others nothing.

## Contract-suite follow-ups (for ARC-10)
- Make grant/revoke affiliations come from the server profile if non-XEP-0060 servers (OpenFire) are ever targeted again.
- `setSubscription` should pass `subid` when a JID has several subscriptions.
- Set `pubsub#max_items` explicitly in provisioning (OpenFire defaults to 1).
- Checks S02, S06 and S12 mutate the fixture; isolate them in their own nodes and rooms to remove order dependence.
