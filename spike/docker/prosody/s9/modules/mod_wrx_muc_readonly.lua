-- S9 effort sketch for R1: persistent per-JID read-only occupants in Prosody MUC rooms.
-- NEVER enabled on the main spike stack (ground rule 2); exists only to size the escape hatch.
-- Room owners set a list of bare JIDs via an extra room-config field; those JIDs always join as
-- "visitor" (so stock moderation rules reject their groupchat with <forbidden/>), on every
-- session, with no moderator online. Stored in the room's persisted _data.
local jid_bare = require "prosody.util.jid".bare;

local field = "{urn:wrx:muc}roomconfig_readonly";

local function get_list(room)
	return room._data.wrx_readonly or {};
end

module:hook("muc-config-form", function(event)
	local jids = {};
	for j in pairs(get_list(event.room)) do jids[#jids + 1] = j; end
	table.insert(event.form, {
		name = field;
		type = "jid-multi";
		label = "Read-only occupants (always visitors)";
		value = jids;
	});
end, 80 - 4);

module:hook("muc-config-submitted/" .. field, function(event)
	local set = {};
	for _, j in ipairs(event.value or {}) do set[jid_bare(j)] = true; end
	event.room._data.wrx_readonly = next(set) and set or nil;
	event.status_codes["104"] = true;
end);

-- Every join (any session, any reconnect): listed JIDs become visitors.
module:hook("muc-occupant-pre-join", function(event)
	if get_list(event.room)[event.occupant.bare_jid] then
		event.occupant.role = "visitor";
	end
end, -1);

-- Belt and braces: never let a listed JID be voiced back (e.g. by a moderator by mistake).
module:hook("muc-pre-set-role", function(event)
	if event.role ~= "visitor" and event.role ~= nil and get_list(event.room)[event.occupant.bare_jid] then
		event.allowed, event.error, event.condition = false, "cancel", "not-allowed";
	end
end);

module:log("info", "wrx_muc_readonly loaded on %s", module.host);
