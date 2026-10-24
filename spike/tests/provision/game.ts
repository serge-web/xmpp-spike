// Provision the §4 test game over XMPP as the admin. Server differences come in via ServerProfile.

import type { Stanzas } from 'stanza';
import { serverConfig } from '../config.js';
import { connect, disconnectAll, type Client } from '../harness.js';
import { ADMIN, PASSWORD, forces, nodes, objectivePublishers, objectiveReaders, roles, rooms } from '../fixtures/game.js';
import { admin, ensureNode, ensureRoom, errorCondition, leaveRoom } from './xmpp-admin.js';
import type { ProvisioningAdapter } from './adapter.js';

type Aff = NonNullable<Stanzas.PubsubAffiliation['affiliation']>;

/** Server-specific provisioning choices. */
export interface ServerProfile {
  /** MUC room config fields applied to every game room. */
  roomConfig: Record<string, string | boolean | string[]>;
  /** Room affiliation for observer roles (S1 mechanism). */
  observerAffiliation: 'member' | 'none';
  /** Explicitly outcast roles that are not in a room (needed when rooms are not members-only). */
  outcastNonMembers: boolean;
  /**
   * S1: revoke the observer's voice once at provisioning time. The admin knows the observer's
   * password (it set it), logs in as the observer, joins, and revokes voice as moderator.
   * Only meaningful on servers that persist the revocation per bare JID (ejabberd does).
   */
  revokeObserverVoice: boolean;
  /**
   * Whether the MUC service echoes the leaver's own unavailable presence (XEP-0045 7.14). Default true.
   * OpenFire 5.1.2 does not, so provisioning must not wait for it there.
   */
  mucLeaveSelfPresence?: boolean;
  /**
   * Recognise "account already exists" from add-user, so provisioning converges by resetting the password.
   * Default: IQ error <conflict/> (ejabberd). OpenFire answers status="completed" with an error note.
   */
  isUserExists?: (e: unknown) => boolean;
  /**
   * PubSub affiliation that puts a reader on a whitelist node's whitelist. Default 'member' (XEP-0060).
   * OpenFire 5.1.2 has no 'member' affiliation: it silently stores any unknown value, including
   * 'member', as 'outcast', and treats every non-outcast affiliate (including explicit 'none') as
   * whitelisted.
   */
  nodeReaderAffiliation?: 'member' | 'none';
}

const allRoleIds = roles.map((r) => r.id);

/** Every PubSub node in the fixture: name -> { access model, readers, publishers }. */
export function nodePlan(): Array<{ node: string; access: 'open' | 'whitelist'; readers: string[]; publishers: string[] }> {
  const everyRole = { access: 'whitelist' as const, readers: allRoleIds, publishers: [] as string[] };
  return [
    { node: nodes.gameSetup, access: 'open', readers: [], publishers: [] },
    { node: nodes.assets('theme'), access: 'open', readers: [], publishers: [] },
    ...forces.map((f) => ({ node: nodes.forces(f.id), ...everyRole })),
    ...roles.map((r) => ({ node: nodes.roles(r.id), ...everyRole })),
    ...rooms.map((r) => ({ node: nodes.rooms(r.id), ...everyRole })),
    ...(['blue', 'red'] as const).map((f) => ({
      node: nodes.objectives(f),
      access: 'whitelist' as const,
      readers: objectiveReaders(f).filter((u) => u !== ADMIN),
      publishers: objectivePublishers().filter((u) => u !== ADMIN),
    })),
    { node: nodes.announcements, ...everyRole },
    { node: nodes.gameState, ...everyRole },
  ];
}

/** Have the observer join once so the admin (as moderator) can revoke its voice. */
async function revokeVoice(adminClient: Client, roomJid: string, observer: string, awaitLeave: boolean): Promise<void> {
  const obs = await connect(observer, { resource: 'provision' });
  await obs.joinRoom(roomJid, observer);
  await adminClient.joinRoom(roomJid, 'admin');
  await adminClient.setRoomRole(roomJid, observer, 'visitor');
  await leaveRoom(adminClient, roomJid, 'admin', awaitLeave);
  await leaveRoom(obs, roomJid, observer, awaitLeave);
  obs.disconnect();
}

export function makeAdapter(profile: ServerProfile): ProvisioningAdapter {
  const awaitLeave = profile.mucLeaveSelfPresence ?? true;
  const userExists = profile.isUserExists ?? ((e: unknown) => errorCondition(e) === 'conflict');
  const bare = (u: string) => `${u}@${serverConfig().domain}`;

  async function withAdmin<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const c = await connect(ADMIN, { resource: 'provision' });
    try {
      return await fn(c);
    } finally {
      await disconnectAll();
    }
  }

  return {
    profile,
    provision: () =>
      withAdmin(async (c) => {
        const cfg = serverConfig();
        for (const r of roles) {
          // add-user on an existing account fails (ejabberd: IQ error <conflict/>); reset the password to converge.
          try {
            await admin.addUser(c, cfg.domain, bare(r.id), PASSWORD);
          } catch (e) {
            if (!userExists(e)) throw e;
            await admin.changePassword(c, cfg.domain, bare(r.id), PASSWORD);
          }
        }
        for (const room of rooms) {
          const affs: Record<string, 'member' | 'none' | 'outcast'> = {};
          for (const id of allRoleIds) {
            const role = roles.find((x) => x.id === id)!;
            if (room.members.includes(id)) affs[bare(id)] = role.observer ? profile.observerAffiliation : 'member';
            else if (profile.outcastNonMembers) affs[bare(id)] = 'outcast';
          }
          const roomJid = `${room.id}@${cfg.mucDomain}`;
          await ensureRoom(c, roomJid, profile.roomConfig, affs, awaitLeave);
          if (profile.revokeObserverVoice) {
            for (const obsId of room.members.filter((id) => roles.find((x) => x.id === id)?.observer)) {
              await revokeVoice(c, roomJid, obsId, awaitLeave);
            }
          }
        }
        for (const n of nodePlan()) {
          const affs: Array<{ jid: string; affiliation: Aff; node: string }> = [
            ...n.readers.map((u) => ({ jid: bare(u), affiliation: (profile.nodeReaderAffiliation ?? 'member') as Aff, node: n.node })),
            ...n.publishers.map((u) => ({ jid: bare(u), affiliation: 'publisher' as Aff, node: n.node })),
          ];
          await ensureNode(
            c,
            cfg.pubsubDomain,
            n.node,
            { 'pubsub#access_model': n.access, 'pubsub#publish_model': 'publishers', 'pubsub#persist_items': true },
            affs,
          );
        }
      }),
    teardown: () =>
      withAdmin(async (c) => {
        const cfg = serverConfig();
        for (const n of nodePlan()) await c.deleteNode(cfg.pubsubDomain, n.node).catch(() => undefined);
        for (const room of rooms) await c.destroyRoom(`${room.id}@${cfg.mucDomain}`).catch(() => undefined);
        for (const r of roles) await admin.deleteUser(c, cfg.domain, bare(r.id)).catch(() => undefined);
      }),
  };
}
