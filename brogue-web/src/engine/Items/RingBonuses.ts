import type { Item } from './Item';

/** CE Items.c:1901-1909. Kind identification does not reveal instance E. */
export function effectiveRingEnchant(ring: Item): number {
    return ring.isIdentified ? ring.enchantment
        : Math.min(ring.enchantment, (ring.timesEnchanted ?? 0) + 1);
}

export function ringBonus(rings: readonly Item[], identity: string): number {
    return rings.reduce((sum, ring) => ring.identityId === identity
        ? sum + effectiveRingEnchant(ring) : sum, 0);
}

// CE PowerTables.c:125-135, 16-bit fixed point 0.75^E, E=-10..50.
const POW_REGEN = [
    1163770, 872827, 654620, 490965, 368224, 276168, 207126, 155344, 116508, 87381,
    65536, 49152, 36864, 27648, 20736, 15552, 11664, 8748, 6561, 4920, 3690,
    2767, 2075, 1556, 1167, 875, 656, 492, 369, 277, 207, 155, 116, 87, 65,
    49, 36, 27, 20, 15, 11, 8, 6, 4, 3, 2, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
] as const;

export function turnsForFullRegenInThousandths(bonus: number): number {
    const idx = Math.max(0, Math.min(POW_REGEN.length - 1, Math.trunc(bonus) + 10));
    return Math.trunc(300000 * POW_REGEN[idx]! / 65536) + 2000;
}
