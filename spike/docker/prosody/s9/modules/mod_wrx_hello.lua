-- S9 effort check: minimal Prosody module. NEVER enabled on the main spike stack.
-- Logs on load, advertises a disco#info feature, and answers <hello xmlns="urn:wrx:hello"/> IQs.
local st = require "prosody.util.stanza";

local xmlns_hello = "urn:wrx:hello";

module:add_feature(xmlns_hello);

module:hook("iq-get/host/" .. xmlns_hello .. ":hello", function(event)
	local origin, stanza = event.origin, event.stanza;
	origin.send(st.reply(stanza):tag("hello", { xmlns = xmlns_hello }):text("hello " .. (origin.username or "?")));
	return true;
end);

module:log("info", "wrx_hello loaded on %s", module.host);
