import type { Creature, StatusId } from '../../entities/Creature';
import { Monster } from '../../entities/Monster';
import { CE_BOLT_CATALOG, CEBoltFlags, CEBoltType } from './BoltCatalog';

/** Rogue.h NEGATABLE_TRAITS / MA_NON_NEGATABLE_ABILITIES. */
export const NEGATABLE_TRAITS: ReadonlySet<string> = new Set([
    'MONST_INVISIBLE', 'MONST_DEFEND_DEGRADE_WEAPON', 'MONST_IMMUNE_TO_WEAPONS',
    'MONST_FLIES', 'MONST_FLITS', 'MONST_IMMUNE_TO_FIRE', 'MONST_REFLECT_50',
    'MONST_FIERY', 'MONST_MAINTAINS_DISTANCE',
]);
export const NON_NEGATABLE_ABILITIES: ReadonlySet<string> = new Set([
    'MA_ATTACKS_PENETRATE', 'MA_ATTACKS_ALL_ADJACENT', 'MA_ATTACKS_EXTEND', 'MA_ATTACKS_STAGGER',
]);
// Globals.c mutationCatalog: removing the mutation identity never reverses info stats.
export const NEGATABLE_MUTATIONS: ReadonlySet<string> = new Set([
    'explosive', 'infested', 'grappling', 'vampiric', 'toxic', 'reflective',
]);

/** Globals.c statusEffectCatalog, restricted to existing web states. Haste and
 * flying are legacy aliases; regenerating has no CE negatable equivalent.
 * Weakness/nausea are non-negatable; fear/darkness clear to zero. */
const NEGATABLE_STATUSES: readonly StatusId[] = [
    'telepathy', 'hallucinating', 'levitating', 'slowed', 'hasted', 'haste',
    'confused', 'discordant', 'immune_fire', 'entranced', 'shielded', 'invisible', 'flying', 'magical_fear', 'darkness',
];
const PLAYER_ONE_TURN: ReadonlySet<StatusId> = new Set(['telepathy', 'levitating', 'immune_fire', 'flying']);

export function negateCreatureStatusEffects(target: Creature, isPlayer: boolean): boolean {
    if (target instanceof Monster && target.isInvulnerable()) return false;
    let affected = false;
    for (const id of NEGATABLE_STATUSES) {
        if (!target.hasStatus(id)) continue;
        affected = true;
        // Keep web's inactive shield-max normalization; poison is untouched.
        target.setStatusDuration(id, isPlayer && PLAYER_ONE_TURN.has(id) ? 1 : 0);
    }
    return affected;
}

function boltFlags(name: string): number {
    const type = CEBoltType[name as keyof typeof CEBoltType];
    return typeof type === 'number' ? CE_BOLT_CATALOG[type].flags : 0;
}
const isBolt = (name: string | undefined): name is string => !!name && name !== 'NONE';
export function hasNegatableBolt(bolts: readonly string[]): boolean {
    // First CE loop scans all 20 slots, including beyond a sentinel.
    return bolts.slice(0, 20).some(name => isBolt(name) && !(boltFlags(name) & CEBoltFlags.NOT_NEGATABLE));
}

/** Items.c:4530-4543, including backupBolts[i] (not the erased array) as
 * terminator. CE does not clear the surviving tail after compaction: preserve
 * that literal behavior. In this CE catalog every nonzero bolt is negatable. */
export function negateBolts(bolts: readonly string[]): string[] {
    const backup = Array.from({ length: 20 }, (_, i) => bolts[i] ?? 'NONE');
    const result = backup.map(name => isBolt(name) && !(boltFlags(name) & CEBoltFlags.NOT_NEGATABLE) ? 'NONE' : name);
    for (let i = 0, j = 0; i < 20 && isBolt(backup[i]); i++) {
        if (boltFlags(backup[i]!) & CEBoltFlags.NOT_NEGATABLE) result[j++] = backup[i]!;
    }
    const end = result.findIndex(name => !isBolt(name));
    return result.slice(0, end < 0 ? 20 : end);
}

/** Items.c:4421, AUTOMATIC known-item targeting, not contact immunity or
 * auto-identification. In particular this omits telepathy/hallucination. */
export function negationWillAffectMonster(target: Monster, isBolt = true): boolean {
    if (target.isInvulnerable() || (isBolt && target.hasAbility('MA_REFLECT_100'))) return false;
    return [...target.abilityFlags].some(f => !NON_NEGATABLE_ABILITIES.has(f))
        || target.seizing || target.diesIfNegated()
        || [...target.behaviorFlags].some(f => NEGATABLE_TRAITS.has(f))
        || (['immune_fire', 'slowed', 'hasted', 'haste', 'confused', 'entranced',
            'discordant', 'shielded', 'invisible', 'levitating', 'flying', 'magical_fear'] as const).some(id => target.hasStatus(id))
        || target.hasAlteredSpeeds()
        || !!(target.mutation && NEGATABLE_MUTATIONS.has(target.mutation.id))
        || hasNegatableBolt(target.bolts);
}
