// WRX1 admin-tooling contract: the rules the admin UI (and the mock) must follow when changing a
// live game. Every operation uses the admin's own XMPP session. Rules came out of the spike:
//   R-A  Revoking PubSub read access = affiliation off the whitelist AND subscription removed
//        (ejabberd keeps serving a subscribed user otherwise; results/ejabberd.md S12).
//   R-B  Any room affiliation change for an observer must re-apply the voice revocation
//        (ejabberd clears the stored visitor role on affiliation change; S1).
//   R-C  Game rooms must stay moderated (stored roles only apply in moderated rooms; S1).
//   R-D  Moving a role between forces grants the new access before revoking the old (S12).
//   R-E  Deleting a role also removes its room affiliations, node affiliations and subscriptions
//        (Prosody leaves room affiliations behind; S12).

import type { Stanzas } from 'stanza';
import { serverConfig } from '../config.js';
import { connect, type Client } from '../harness.js';
import type { ServerProfile } from './game.js';
import { admin as adhoc, leaveRoom, nodeSubscribers, setSubscription } from './xmpp-admin.js';

type Aff = NonNullable<Stanzas.PubsubAffiliation['affiliation']>;

export interface NodeAccess {
  node: string;
  level: 'read' | 'publish';
}

export interface RoomAccess {
  room: string; // room localpart, e.g. "blue-hq"
  observer: boolean;
}

export class AdminOps {
  constructor(
    private readonly a: Client,
    private readonly profile: ServerProfile,
  ) {}

  private get cfg() {
    return serverConfig();
  }
  private bare(user: string) {
    return user.includes('@') ? user : `${user}@${this.cfg.domain}`;
  }
  private roomJid(room: string) {
    return room.includes('@') ? room : `${room}@${this.cfg.mucDomain}`;
  }
  private get awaitLeave() {
    return this.profile.mucLeaveSelfPresence ?? true;
  }

  /** Grant read or publish on a whitelist node. */
  async grantNode(user: string, access: NodeAccess): Promise<void> {
    const affiliation: Aff = access.level === 'publish' ? 'publisher' : (this.profile.nodeReaderAffiliation ?? 'member');
    await this.a.updateNodeAffiliations(this.cfg.pubsubDomain, access.node, [{ jid: this.bare(user), affiliation }]);
  }

  /** R-A: take the user off the whitelist AND remove any subscription. */
  async revokeNode(user: string, node: string): Promise<void> {
    const jid = this.bare(user);
    const affiliation: Aff = this.profile.nodeRevokeAffiliation ?? 'none';
    await this.a.updateNodeAffiliations(this.cfg.pubsubDomain, node, [{ jid, affiliation }]);
    if ((await nodeSubscribers(this.a, this.cfg.pubsubDomain, node)).includes(jid)) {
      await setSubscription(this.a, this.cfg.pubsubDomain, node, jid, 'none');
    }
  }

  /**
   * Add a user to a room (member). R-B: for an observer, re-apply the voice revocation, which needs
   * the observer to be present once; the admin logs in as the observer with the password it manages.
   */
  async addToRoom(user: string, access: RoomAccess, observerPassword?: string): Promise<void> {
    const room = this.roomJid(access.room);
    const aff = access.observer ? this.profile.observerAffiliation : 'member';
    await this.a.setRoomAffiliation(room, this.bare(user), aff);
    if (access.observer && this.profile.revokeObserverVoice) {
      if (!observerPassword) throw new Error(`addToRoom(${user}): observer voice needs the observer password (rule R-B)`);
      await this.revokeObserverVoice(user, room, observerPassword);
    }
  }

  /** Remove a user from a room (affiliation none; a members-only room ejects them, status 321). */
  async removeFromRoom(user: string, room: string): Promise<void> {
    await this.a.setRoomAffiliation(this.roomJid(room), this.bare(user), 'none');
  }

  /** R-B: observer joins once; admin (moderator) sets it to visitor; both leave. */
  async revokeObserverVoice(user: string, room: string, password: string): Promise<void> {
    const roomJid = this.roomJid(room);
    const local = user.split('@')[0]!;
    const obs = await connect(local, { resource: `admin-ops-${Date.now()}`, password });
    try {
      await obs.joinRoom(roomJid, local);
      await this.a.joinRoom(roomJid, 'admin');
      await this.a.setRoomRole(roomJid, local, 'visitor');
      await leaveRoom(this.a, roomJid, 'admin', this.awaitLeave);
      await leaveRoom(obs, roomJid, local, this.awaitLeave);
    } finally {
      obs.disconnect();
    }
  }

  /** R-C: report (and optionally fix) rooms that are not moderated. Returns the rooms that were not. */
  async ensureModerated(rooms: string[], fix: boolean): Promise<string[]> {
    const bad: string[] = [];
    for (const r of rooms) {
      const room = this.roomJid(r);
      await this.a.joinRoom(room, 'admin');
      const moderated = (await this.a.getRoomConfig(room)).fields?.find((f) => f.name === 'muc#roomconfig_moderatedroom')?.value;
      if (moderated !== true) {
        bad.push(r);
        if (fix) {
          await this.a.configureRoom(room, {
            type: 'submit',
            fields: [
              { name: 'FORM_TYPE', type: 'hidden', value: 'http://jabber.org/protocol/muc#roomconfig' },
              { name: 'muc#roomconfig_moderatedroom', value: true },
            ],
          });
        }
      }
      await leaveRoom(this.a, room, 'admin', this.awaitLeave);
    }
    return bad;
  }

  /**
   * R-D: move a role to a new set of rooms/nodes. Grants everything new first, then revokes what is
   * no longer held, so the session is never locked out.
   */
  async moveRole(
    user: string,
    from: { rooms: RoomAccess[]; nodes: NodeAccess[] },
    to: { rooms: RoomAccess[]; nodes: NodeAccess[] },
    observerPassword?: string,
  ): Promise<void> {
    for (const r of to.rooms) await this.addToRoom(user, r, observerPassword);
    for (const n of to.nodes) await this.grantNode(user, n);
    const keepRooms = new Set(to.rooms.map((r) => r.room));
    const keepNodes = new Set(to.nodes.map((n) => n.node));
    for (const r of from.rooms) if (!keepRooms.has(r.room)) await this.removeFromRoom(user, r.room);
    for (const n of from.nodes) if (!keepNodes.has(n.node)) await this.revokeNode(user, n.node);
  }

  /** R-E: delete the account and clean up every affiliation and subscription it held. */
  async deleteRole(user: string, held: { rooms: string[]; nodes: string[] }): Promise<void> {
    for (const r of held.rooms) await this.removeFromRoom(user, r);
    for (const n of held.nodes) await this.revokeNode(user, n);
    await adhoc.deleteUser(this.a, this.cfg.domain, this.bare(user));
  }
}
