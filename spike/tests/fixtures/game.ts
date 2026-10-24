// Test game definition from SPIKE-BRIEF.md §4. Server-independent.

export type ForceId = 'blue' | 'red' | 'umpire';

export interface Force {
  id: ForceId;
  umpire: boolean;
}

export interface Role {
  id: string;
  force: ForceId;
  observer: boolean;
}

export interface Room {
  id: string;
  members: string[]; // role ids
}

export const forces: Force[] = [
  { id: 'blue', umpire: false },
  { id: 'red', umpire: false },
  { id: 'umpire', umpire: true },
];

export const roles: Role[] = [
  { id: 'blue-co', force: 'blue', observer: false },
  { id: 'blue-obs', force: 'blue', observer: true },
  { id: 'red-co', force: 'red', observer: false },
  { id: 'umpire-1', force: 'umpire', observer: false },
];

export const ADMIN = 'admin';

const rolesOf = (...f: ForceId[]): string[] => roles.filter((r) => f.includes(r.force)).map((r) => r.id);

export const rooms: Room[] = [
  { id: 'blue-hq', members: rolesOf('blue', 'umpire') },
  { id: 'red-hq', members: rolesOf('red', 'umpire') },
  { id: 'negotiation', members: ['blue-co', 'red-co', ...rolesOf('umpire')] },
];

export const nodes = {
  gameSetup: 'game-setup',
  announcements: 'announcements',
  gameState: 'game-state',
  forces: (id: string) => `forces:${id}`,
  roles: (id: string) => `roles:${id}`,
  rooms: (id: string) => `rooms:${id}`,
  assets: (id: string) => `assets:${id}`,
  objectives: (forceId: ForceId) => `objectives:${forceId}`,
} as const;

/** Readers of objectives:<forceId>: that force's roles, umpire-force roles, admin. */
export const objectiveReaders = (forceId: ForceId): string[] => [...new Set([...rolesOf(forceId, 'umpire'), ADMIN])];

/** Publishers of objectives:<forceId>: admin and umpire-force roles only. */
export const objectivePublishers = (): string[] => [...rolesOf('umpire'), ADMIN];

/** Shared test password for every fixture account. Test-only; never used in client code. */
export const PASSWORD = 'spike-password';
