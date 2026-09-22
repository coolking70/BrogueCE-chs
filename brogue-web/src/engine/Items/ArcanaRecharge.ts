import type { Item } from './Item';
import type { Random } from '../Random';

/** CE Items.c:338: ordinary staffs start with 500 recharge points, not a roll.
 * Lazy initialization leaves W-5 generation (including its RNG footprint) untouched.
 * Missing pre-W-6 save fields use this same deterministic value. The old ascending
 * rechargeCounter/rechargeTurns pair has different units and is deliberately ignored.
 */
export const INITIAL_STAFF_RECHARGE = 500;

export function restoreStaffRecharge(remaining?: number): number {
    return typeof remaining === 'number' && Number.isFinite(remaining)
        ? Math.trunc(remaining) : INITIAL_STAFF_RECHARGE;
}

/** Kind-specific extension point for W-12/W-14. CE uses 10000 for blinking and
 * obstruction (Time.c:2025-2032); their special cycles are NOT enabled in W-6.
 * Future activation also needs the corresponding initial timer and scroll reset.
 */
function staffRechargeBaseDuration(_identityId?: string): number {
    return 5000;
}

type StaffResource = Pick<Item, 'enchantment' | 'maxCharges' | 'charges' | 'staffRechargeRemaining'>;

/** CE integer division. Invalid/versioned E=0 is retained, never inferred from uses. */
export function staffChargeDuration(item: StaffResource, identityId?: string): number | undefined {
    if (!Number.isFinite(item.enchantment) || item.enchantment < 1) return undefined;
    return Math.max(1, Math.floor(staffRechargeBaseDuration(identityId) / item.enchantment));
}

/** PowerTables.c:72-82: exact 16-bit fixed-point table, clamped to [-10, 27].
 * Math.pow(1.3, E) rounds differently (e.g. E=1 gives 12 points, not 13).
 */
const POW_WISDOM = [
    4753, 6180, 8034, 10444, 13577, 17650, 22945, 29829, 38778, 50412,
    65536, 85196, 110755, 143982, 187177, 243330, 316329, 411228, 534597,
    694976, 903469, 1174510, 1526863, 1984922, 2580398, 3354518, 4360874,
    5669136, 7369877, 9580840, 12455093, 16191620, 21049107, 27363839,
    35572991, 46244888, 60118355, 78153861,
] as const;

export function ringWisdomRechargeIncrement(wisdom: number): number {
    const level = Math.max(-10, Math.min(27, Math.trunc(wisdom)));
    return Math.floor(10 * POW_WISDOM[level + 10]! / 65536);
}

/** CE effectiveRingEnchant (Items.c:1901-1909) + updateRingBonuses (:8714).
 * Web has no ring enchanting/timesEnchanted yet: unknown positive rings provide
 * at most +1; negative enchantments apply in full. Kind discovery alone is not ID.
 */
export function equippedWisdomBonus(rings: readonly Item[]): number {
    return rings.reduce((bonus, ring) => {
        if ((ring as Item & { identityId?: string }).identityId !== 'ring_of_wisdom') return bonus;
        return bonus + (ring.isIdentified ? ring.enchantment : Math.min(ring.enchantment, 1));
    }, 0);
}

/** Called exactly once per P2 objective 100-tick block, for inventory STAFF only.
 * Time.c:2036-2070: retain overshoot, including rolls needed to settle the timer
 * after reaching capacity at high wisdom. Only current uses and the timer change.
 */
export function tickStaffRecharge(item: StaffResource, wisdom: number,
    random: Pick<Random, 'randClumpedRange'>, identityId?: string): number {
    const duration = staffChargeDuration(item, identityId);
    if (duration === undefined || item.maxCharges === undefined || item.charges === undefined) return 0;
    const before = item.charges;
    let remaining = restoreStaffRecharge(item.staffRechargeRemaining);
    if (item.charges < item.maxCharges) remaining -= ringWisdomRechargeIncrement(wisdom);
    while (remaining <= 0) {
        if (item.charges < item.maxCharges) item.charges++;
        remaining += random.randClumpedRange(Math.max(Math.floor(duration / 3), 1), Math.floor(duration * 5 / 3), 3);
    }
    // Time.c:2068-2075: normalize an overlong timer (e.g. unusually high E,
    // or E changed while a cycle was pending). No new draw and no E/capacity write.
    while (remaining > Math.floor(duration * 5 / 3)) {
        if (item.charges > 0) item.charges--;
        remaining -= duration;
    }
    item.staffRechargeRemaining = remaining;
    return item.charges - before;
}

/** CE Items.c:4726-4729: full uses + deterministic ordinary cycle reset. */
export function rechargeStaffFully(item: StaffResource, identityId?: string): void {
    if (item.maxCharges !== undefined) item.charges = item.maxCharges;
    item.staffRechargeRemaining = staffChargeDuration(item, identityId) ?? INITIAL_STAFF_RECHARGE;
}
