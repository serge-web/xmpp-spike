import { makeAdapter } from './game.js';

export default makeAdapter({
  roomConfig: {
    'muc#roomconfig_persistentroom': true,
    'muc#roomconfig_membersonly': true,
    'muc#roomconfig_moderatedroom': true,
    'muc#roomconfig_publicroom': false,
    'muc#roomconfig_whois': 'moderators',
    allow_voice_requests: false,
    // S1b: close the observer's side channels (all on by default): PMs to occupants,
    // presence status text, and nickname changes are otherwise visible to the room.
    allow_private_messages_from_visitors: 'nobody',
    allow_visitor_status: false,
    allow_visitor_nickchange: false,
    mam: true,
  },
  observerAffiliation: 'member',
  outcastNonMembers: false,
  // S1 mechanism: ejabberd persists a moderator's voice revocation per bare JID across sessions
  // and restarts (cleared only by an affiliation change). See results/ejabberd.md.
  revokeObserverVoice: true,
});
