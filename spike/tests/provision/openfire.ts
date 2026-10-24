import { makeAdapter } from './game.js';

// OpenFire 5.1.2 room configuration. Field names are OpenFire's own (see results/openfire.md):
// it has no per-room MAM toggle; the Monitoring plugin archives rooms that log conversations.
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
  // S1: no OpenFire mechanism passes; members-only + member gives voice (see results/openfire.md).
  observerAffiliation: 'member',
  outcastNonMembers: false,
  // OpenFire computes the role from the affiliation on every join; a voice revocation is not kept.
  revokeObserverVoice: false,
  // OpenFire 5.1.2 never echoes the leaver's own unavailable presence (XEP-0045 7.14).
  mucLeaveSelfPresence: false,
  // OpenFire whitelist = any non-outcast affiliate; 'member' is silently stored as 'outcast',
  // explicit 'none' affiliates are whitelisted but omitted from the owner's affiliation list.
  nodeReaderAffiliation: 'none',
  nodeRevokeAffiliation: 'outcast',
  outcastNonReaders: true,
});
