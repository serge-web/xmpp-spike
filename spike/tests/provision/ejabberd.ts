import { makeAdapter } from './game.js';

export default makeAdapter({
  roomConfig: {
    'muc#roomconfig_persistentroom': true,
    'muc#roomconfig_membersonly': true,
    'muc#roomconfig_moderatedroom': true,
    'muc#roomconfig_publicroom': false,
    'muc#roomconfig_whois': 'moderators',
    mam: true,
  },
  observerAffiliation: 'member',
  outcastNonMembers: false,
});
