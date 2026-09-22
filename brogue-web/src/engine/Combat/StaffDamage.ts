import type { Random } from '../Random';

/** CE PowerTables.c:49-51. E is the STAFF instance's integer enchant1,
 * not its charges or the legacy BoltConfig damage constant. */
export function staffDamageRange(enchantment: number) {
    return {
        low: Math.floor((2 + enchantment) * 3 / 4),
        high: 4 + Math.floor(5 * enchantment / 2),
        clumps: 1 + Math.floor(enchantment / 3),
    };
}

/** Math.c:40-59: sum clumps of inclusive uniform rolls, wider dice first.
 * Called once per non-immune contact, never for preview or empty travel. */
export function rollStaffDamage(enchantment: number, random: Pick<Random, 'randClumpedRange'>): number {
    const { low, high, clumps } = staffDamageRange(enchantment);
    return random.randClumpedRange(low, high, clumps);
}
