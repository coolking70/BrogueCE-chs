import type { Random } from '../Random';

/** W-5: initial resources only. Recharge/enchantment lifecycle belongs to W-6. */
export interface ArcanaInstanceState {
    arcanaInstanceVersion?: 1;
    enchantment: number;
    maxCharges?: number;
    charges?: number;
}

/** All nine CE wand kinds; GlobalsBrogue.c:702-710, all clump factors = 1.
 * The two retired web wands retain their fixed legacy capacity. Pool order/frequencies live in arcana.json.
 */
export const WAND_INITIAL_RANGES: Readonly<Record<string, readonly [number, number, number]>> = {
    wand_of_teleportation: [3, 5, 1],
    wand_of_slowness: [2, 5, 1],
    wand_of_polymorphism: [3, 5, 1],
    wand_of_negation: [4, 6, 1],
    wand_of_domination: [1, 2, 1],
    wand_of_beckoning: [2, 4, 1],
    wand_of_plenty: [1, 2, 1],
    wand_of_invisibility: [3, 5, 1],
    wand_of_empowerment: [1, 1, 1],
};

/** CE Items.c:328-339: conditional 50%, then 15%, then an uncapped 10% tail. */
export function rollStaffEnchantment(random: Pick<Random, 'randPercent'>): number {
    let e = 2;
    if (random.randPercent(50)) {
        e++;
        if (random.randPercent(15)) {
            e++;
            while (random.randPercent(10)) e++;
        }
    }
    return e;
}

/** CE Items.c:347 / Math.c:34-56. A singleton range consumes no RNG. */
export function rollWandCharges(id: string, legacyCapacity: number,
    random: Pick<Random, 'randClumpedRange'>): number {
    const range = WAND_INITIAL_RANGES[id];
    return range ? random.randClumpedRange(...range) : legacyCapacity;
}

/**
 * Deterministic legacy migration: never call spawn/roll and never accept an RNG.
 * Old staff E was a placeholder (normally 0); recover E from original capacity,
 * not remaining charges. Retain depletion, even zero. JSON capacity is only a
 * fallback for older snapshots without a saved capacity. Versioned values round-trip.
 */
export function restoreArcanaInstance(saved: ArcanaInstanceState, isStaff: boolean,
    legacyCapacity: number): ArcanaInstanceState {
    if (saved.arcanaInstanceVersion === 1) {
        return {
            arcanaInstanceVersion: 1, enchantment: saved.enchantment,
            maxCharges: saved.maxCharges, charges: saved.charges,
        };
    }
    const capacity = saved.maxCharges ?? legacyCapacity;
    return {
        arcanaInstanceVersion: 1,
        enchantment: isStaff ? capacity : saved.enchantment,
        maxCharges: capacity,
        charges: saved.charges ?? capacity,
    };
}
