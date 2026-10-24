-- Prosody 13.0.7 config for the WRX1 spike. Replaces the image's env-templated default
-- (/etc/prosody/prosody.cfg.lua) so every setting is visible here. Only bundled modules are used.
-- Every deliberate change from Prosody's defaults is commented with "CHANGE:".

-- CHANGE: the admin account is a server admin (prosody:admin role) on every host and component.
-- This is how it gets XEP-0133 ad-hoc commands, room creation and PubSub node creation.
admins = { "admin@localhost" }

-- CHANGE: listen on IPv4 only (the spike container has no IPv6).
interfaces = { "0.0.0.0" }
http_interfaces = { "0.0.0.0" }
https_interfaces = { "0.0.0.0" }
http_ports = { 5280 }
https_ports = { 5281 }

modules_enabled = {
	"disco";
	"roster";
	"saslauth";
	"tls";
	"ping";
	"time";
	"uptime";
	"version";
	"carbons";
	"blocklist";
	"smacks";
	"admin_adhoc"; -- XEP-0133 ad-hoc admin commands (S4: provisioning as the admin user)
	"admin_shell"; -- prosodyctl shell for operators (not used by tests)
	"websocket"; -- CHANGE: RFC 7395 WebSocket at /xmpp-websocket (S0, browser transport)
	"mam"; -- CHANGE: user archives (not needed by checks; room MAM is mod_muc_mam below)
}

-- CHANGE: in-band registration (mod_register_ibr) left out: accounts are created only by the
-- admin via ad-hoc commands. Defaults that the image enables but the game does not use
-- (pep, vcard, bookmarks, invites, limits) are left out to keep the surface small.
-- NOTE: mod_limits (default 10kb/s c2s rate limit in the image's config) is deliberately not
-- loaded; S3/S5 move large volumes over one session.

-- CHANGE: plain ws:// is accepted as secure in dev so SCRAM works without TLS. With TLS in
-- front (S8) clients use wss:// on 5281 instead. c2s_require_encryption stays at its default (true).
consider_websocket_secure = true
-- Default kept: in 13.0 mod_websocket does not check Origin and registers its HTTP route with
-- CORS enabled (the old cross_domain_websocket option is deprecated and ignored). To restrict
-- browser origins use access_control_allow_origins = { "https://wrx.example" }.

authentication = "internal_hashed" -- SCRAM-SHA-1 / SCRAM-SHA-256 with hashed stored credentials
-- CHANGE: SQL storage (bundled mod_storage_sql + LuaDBI in the image) with SQLite, instead of
-- the default flat files. The internal store caps each archive at 10,000 items
-- (storage_archive_item_limit), after which mod_muc_mam silently drops the oldest 1%;
-- Prosody's docs recommend SQL for archives. One file to back up: /var/lib/prosody/prosody.sqlite.
storage = "sql"
sql = { driver = "SQLite3", database = "prosody.sqlite" }

-- CHANGE: keep MAM indefinitely (default expiry is 1 week).
archive_expires_after = "never"

log = { info = "*console" }

-- CHANGE: pidfile so `prosodyctl status` (compose healthcheck) works; the image config has none.
pidfile = "/var/run/prosody/prosody.pid"

certificates = "certs"

-- Named accounts (SCRAM). Users, rooms and nodes are provisioned over XMPP by the admin.
VirtualHost "localhost"

-- CHANGE: SASL ANONYMOUS for the welcome page (S10). Prosody does anonymous auth per host,
-- so it needs its own VirtualHost; anonymous users get <random>@anon.localhost.
VirtualHost "anon.localhost"
	authentication = "anonymous"
	-- defaults kept: allow_anonymous_storage = false, allow_anonymous_s2s = false

Component "conference.localhost" "muc"
	modules_enabled = { "muc_mam" } -- CHANGE: room archives (XEP-0313 on MUC)
	-- CHANGE: only server admins may create rooms (default: any user may).
	restrict_room_creation = true
	-- CHANGE: room defaults that match the game (provisioning still sets them explicitly).
	muc_room_default_persistent = true
	muc_room_default_members_only = true
	muc_room_default_public = false
	-- CHANGE: archive every room by default, keep it forever.
	muc_log_by_default = true
	muc_log_expires_after = "never"
	-- CHANGE: allow RSM pages of up to 200 (S5); default max is 50.
	max_archive_query_results = 200

Component "pubsub.localhost" "pubsub"
	-- Stock behaviour: only prosody:admin may create nodes (:create-node permission);
	-- server admins get the "owner" affiliation on every node (default_admin_affiliation).
	-- Defaults kept: autocreate_on_publish = false, autocreate_on_subscribe = false.
