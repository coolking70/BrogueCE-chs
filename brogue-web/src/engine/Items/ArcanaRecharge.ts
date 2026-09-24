import type { Item } from './Item';
import type { Random } from '../Random';

/** CE Items.c:338: staffs start at 500 points (blink/obstruction: 1000), not a roll.
 * New instances and missing save fields share the same deterministic initializer.
 * Missing pre-W-6 save fields use this same deterministic value. The old ascending
 * rechargeCounter/rechargeTurns pair has different units and is deliberately ignored.
 */
export const INITIAL_STAFF_RECHARGE = 500;

export function restoreStaffRecharge(remaining?: number, identityId?: string): number {
    return typeof remaining === 'number' && Number.isFinite(remaining)
        ? Math.trunc(remaining) : initialStaffRecharge(identityId);
}

/** CE Items.c:338 / Time.c:2028; obstruction is prepared but remains out of pool. */
function isSlowStaff(identityId?: string): boolean {
    return identityId === 'staff_of_blinking' || identityId === 'staff_of_obstruction';
}
export function initialStaffRecharge(identityId?: string): number {
    return isSlowStaff(identityId) ? 1000 : INITIAL_STAFF_RECHARGE;
}
function staffRechargeBaseDuration(identityId?: string): number {
    return isSlowStaff(identityId) ? 10000 : 5000;
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
    let remaining = restoreStaffRecharge(item.staffRechargeRemaining, identityId);
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

/** CE Items.c:4726-4729: full uses + deterministic kind-specific cycle reset. */
export function rechargeStaffFully(item: StaffResource, identityId?: string): void {
    if (item.maxCharges !== undefined) item.charges = item.maxCharges;
    item.staffRechargeRemaining = staffChargeDuration(item, identityId) ?? initialStaffRecharge(identityId);
}
