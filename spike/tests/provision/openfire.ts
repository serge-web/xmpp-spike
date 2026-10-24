import { makeAdapter } from './game.js';

// OpenFire 5.1.2 room configuration. Field names are OpenFire's own (see results/openfire.md):
// it has no per-room MAM toggle; the Monitoring plugin archives every room that logs conversations.
export default makeAdapter({
  roomConfig: {
    'muc#roomconfig_persistentroom': true,
    'muc#roomconfig_membersonly': true,
    'muc#roomconfig_moderatedroom': true,
    'muc#roomconfig_publicroom': false,
    'muc#roomconfig_whois': 'moderators',
    'muc#roomconfig_allowinvites': false,
    'muc#roomconfig_changesubject': false,
    // Stock default is true: any non-outcast user can register with the room (XEP-0045 7.10) and
    // OpenFire then makes them a *member*, which defeats members-only. See results/openfire.md.
    'x-muc#roomconfig_registration': false,
    // Core room log; the Monitoring plugin serves MUC MAM from it.
    'muc#roomconfig_enablelogging': true,
  },
  observerAffiliation: 'member',
  outcastNonMembers: false,
  revokeObserverVoice: false,
  // OpenFire 5.1.2 never echoes the leaver's own unavailable presence (XEP-0045 7.14).
  mucLeaveSelfPresence: false,
  // add-user on an existing account: <command status="completed"><note type="error">User already exists.</note>
  // OpenFire whitelist = any non-outcast affiliate; 'member' is silently stored as 'outcast'.
  nodeReaderAffiliation: 'none',
  isUserExists: (e) => /already exists/i.test((e as { error?: { text?: string } }).error?.text ?? ''),
});
