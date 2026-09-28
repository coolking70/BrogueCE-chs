import species from '../../data/monsters.json';
import type { Pos } from '../../types';
import { DungeonLayer, type Grid } from '../Map/Grid';
import { DF } from '../Map/DungeonFeatureCatalog';
import { catalogFeature, spawnDungeonFeature } from '../Map/DungeonFeature';
import { rng } from '../Random';

export interface CreatureFeatureInfo {
    bloodType: number;
    DFChance: number;
    DFType: number;
}

const catalog = new Map<string, CreatureFeatureInfo>(species.map(({id, bloodType, DFChance, DFType}) =>
    [id, {bloodType, DFChance, DFType}]));
const noFeatures: Readonly<CreatureFeatureInfo> = { bloodType: 0, DFChance: 0, DFType: 0 };
export const PLAYER_BLOOD_TYPE = DF.DF_RED_BLOOD;

/** CE info is derived from the saved species/mutation and info-reset marker.
 * No new clock or serialized state. Resurrection resets info while retaining
 * mutation bookkeeping (Monsters.c:2937); polymorph changes the species id.
 * deathDFType also retains the two mutation overrides after negation removes
 * mutationIndex. Those two DF identities always have chance=0 in CE. */
export function creatureFeatureInfo(typeId: string, mutationId?: string, restoredDFType?: number): CreatureFeatureInfo {
    const base = catalog.get(typeId) ?? noFeatures;
    if (restoredDFType !== undefined) return { ...base, DFType: restoredDFType,
        DFChance: restoredDFType === DF.DF_MUTATION_EXPLOSION || restoredDFType === DF.DF_MUTATION_LICHEN ? 0 : base.DFChance };
    // Globals.c:1398-1401, Monsters.c:45-49. Other mutations retain DF info;
    // negation removes the ability but does not undo these info overrides.
    const mutationDF = mutationId === 'explosive' ? DF.DF_MUTATION_EXPLOSION
        : mutationId === 'infested' ? DF.DF_MUTATION_LICHEN : 0;
    return mutationDF ? { ...base, DFChance: 0, DFType: mutationDF } : { ...base };
}

/** Combat.c:1827-1837. Damage is AFTER shielding, HP is BEFORE the hit (and
 * before easy-mode scaling). Both integer divisions precede GAS volume ×100.
 * A bloodless/invulnerable/zero-damage target consumes no random numbers. */
export function creatureBloodFeature(bloodType: number, damage: number, currentHP: number, invulnerable = false) {
    if (!bloodType || damage <= 0 || currentHP <= 0 || invulnerable) return null;
    const blood = catalogFeature(bloodType as DF);
    const startProbability = Math.trunc(blood.startProbability
        * (15 + Math.trunc(Math.min(damage, currentHP) * 3 / 2)) / 100)
        * (blood.layer === DungeonLayer.GAS ? 100 : 1);
    return { ...blood, startProbability };
}

export function spawnCreatureBlood(grid: Grid, loc: Pos, bloodType: number,
    damage: number, currentHP: number, invulnerable = false) {
    const blood = creatureBloodFeature(bloodType, damage, currentHP, invulnerable);
    return blood ? spawnDungeonFeature(grid, loc.x, loc.y, blood, false) : null;
}

export type CreatureFeaturePhase = 'objective' | 'activation';
export interface CreatureFeatureSource extends CreatureFeatureInfo {
    loc: Pos;
    hp: number;
    isDormant: boolean;
    hasBehavior(flag: string): boolean;
}

/** Pure eligibility gate; ASLEEP, paralysis, invisibility and submersion do
 * not suppress emission. Activation is called after corpse absorption's early
 * return, BEFORE instant terrain effects and paralysis (Monsters.c:3337-3351). */
export function creatureFeatureChance(source: CreatureFeatureSource, phase: CreatureFeaturePhase): number {
    if (source.hp <= 0 || source.isDormant) return 0;
    const activated = source.hasBehavior('MONST_GETS_TURN_ON_ACTIVATION');
    return activated === (phase === 'activation') ? source.DFChance : 0;
}

/** Time.c:2685-2691 / Monsters.c:3341-3345. Always roll nonzero DFChance,
 * including 100% and DFType=0 (guardian spirit and Warden). DF_NONE is a no-op
 * after that roll, rather than a missing-catalog lookup. Never loop by speed. */
export function emitCreatureFeature(grid: Grid, source: CreatureFeatureSource,
    phase: CreatureFeaturePhase, random: Pick<typeof rng, 'randPercent'> = rng) {
    const chance = creatureFeatureChance(source, phase);
    if (!chance || !random.randPercent(chance) || !source.DFType) return null;
    return spawnDungeonFeature(grid, source.loc.x, source.loc.y, catalogFeature(source.DFType as DF), false);
}
