import { makeAdapter } from './game.js';

export default makeAdapter({
  roomConfig: {
    'muc#roomconfig_persistentroom': true,
    'muc#roomconfig_membersonly': true,
    'muc#roomconfig_moderatedroom': true,
    'muc#roomconfig_publicroom': false,
    'muc#roomconfig_whois': 'moderators',
    allow_voice_requests: false,
    mam: true,
  },
  observerAffiliation: 'member',
  outcastNonMembers: false,
  // S1 mechanism: ejabberd persists a moderator's voice revocation per bare JID across sessions
  // and restarts (cleared only by an affiliation change). See results/ejabberd.md.
  revokeObserverVoice: true,
});
