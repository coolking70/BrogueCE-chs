import { ItemCategory as C, type Item } from '../Items/Item';
import { WAND_INITIAL_RANGES } from '../Items/ArcanaInstance';
import { staffChargeDuration, ringWisdomRechargeIncrement } from '../Items/ArcanaRecharge';
import { staffDamageRange } from '../Combat/StaffDamage';
import { staffPoison } from '../Combat/Poison';
import { staffProtection } from '../Combat/Shielding';
import { staffBlinkDistance } from '../Combat/BoltTrajectory';
import { staffEntrancementDuration } from '../Movement/Entrancement';
import { staffBladeCount } from '../Combat/Conjuration';
import type { DetailSection, DetailLine } from './DetailGenerator';
import type { ItemDetailContext } from './ItemDetailContext';
import { itemKnowledge } from './ItemKnowledge';
import { detailText } from './ItemDetailText';

/** CE Items.c:2938-3226; resource and effect knowledge are independent. */
export function arcanaDetail(item: Item, ctx: ItemDetailContext): DetailSection[] {
    const k = itemKnowledge(item, ctx), staff = item.category === C.STAFF;
    // CE stores capacity and E in the same field. Web stores both: when only
    // capacity is revealed, project that known value, never the hidden E field.
    const knownEnchant = k.instanceKnown ? item.enchantment : k.capacityKnown ? item.maxCharges : undefined;
    const lines: DetailLine[] = [];
    const add = (key: string, values: Record<string, number | string> = {}) => lines.push({ text: detailText(key, values) });
    if (k.chargesKnown && item.charges !== undefined) {
        if (staff && item.maxCharges !== undefined) add('staff.charges', { charges: item.charges, max: item.maxCharges });
        else if (!staff) add('wand.charges', { charges: item.charges });
    } else if (staff && k.capacityKnown && item.maxCharges !== undefined) {
        add('staff.capacity', { max: item.maxCharges });
    }
    if (staff) {
        add('staff.recharge');
        if (knownEnchant !== undefined) {
            const duration = staffChargeDuration({ enchantment: knownEnchant }, item.identityId);
            const increment = ringWisdomRechargeIncrement(ctx.apparentRingBonuses?.ring_of_wisdom ?? 0);
            // Use actual objective-turn point increments (W-6). The random cycle
            // and hidden remaining timer are never sampled/read for a preview.
            if (duration !== undefined && increment > 0) {
                const nextDuration = staffChargeDuration({ enchantment: knownEnchant + 1 }, item.identityId)!;
                add('staff.recharge_turns', { turns: Math.trunc(duration / increment), next: Math.trunc(nextDuration / increment) });
            } else if (increment === 0) add('staff.recharge_stopped');
        }
        if (ctx.currentTurn !== undefined && ctx.knownStaffUses) {
            const ages = ctx.knownStaffUses.filter(turn => turn > 0 && turn <= ctx.currentTurn!).slice(0, 3).map(turn => ctx.currentTurn! - turn);
            if (ages.length) add('staff.history', { ages: ages.join('、') });
        }
        if (k.kindKnown && ['staff_of_blinking', 'staff_of_obstruction'].includes(item.identityId ?? '')) add('staff.slow');
        if (k.kindKnown && knownEnchant !== undefined) {
            const e = knownEnchant, next = e + 1;
            switch (item.identityId) {
                case 'staff_of_lightning': case 'staff_of_fire': {
                    const a = staffDamageRange(e), b = staffDamageRange(next);
                    add('staff.damage', { low: a.low, high: a.high, nextLow: b.low, nextHigh: b.high,
                        percent: Math.trunc(100 * (b.low + b.high) / (a.low + a.high)) - 100 });
                    add(item.identityId === 'staff_of_fire' ? 'staff.fire' : 'staff.lightning');
                    break;
                }
                case 'staff_of_poison': add('staff.poison', { turns: staffPoison(e), next: staffPoison(next) }); break;
                case 'staff_of_tunneling': add('staff.tunneling', { layers: e, next }); break;
                case 'staff_of_blinking': add('staff.blinking', { distance: staffBlinkDistance(e), next: staffBlinkDistance(next) }); break;
                case 'staff_of_entrancement': add('staff.entrancement', { turns: staffEntrancementDuration(e), next: staffEntrancementDuration(next) }); break;
                case 'staff_of_healing':
                    // The current rules have these three linear conversions inline
                    // in Game.applyBasicBoltEffect (:4581/4589/4617). Preserve
                    // those exact expressions; R6 must extract shared pure helpers.
                    add('staff.healing', { percent: Math.min(100, 10 * e), next: Math.min(100, 10 * next) }); break;
                case 'staff_of_haste': add('staff.haste', { turns: 2 + 4 * e, next: 2 + 4 * next }); break;
                case 'staff_of_discord': add('staff.discord', { turns: 4 * e, next: 4 * next }); break;
                // CE deliberately adds no magnitude paragraph for obstruction;
                // its kind description and slow recharge explain the effect.
                case 'staff_of_obstruction': break;
                case 'staff_of_conjuration': add('staff.conjuration', { count: staffBladeCount(e), next: staffBladeCount(next) }); break;
                case 'staff_of_protection': add('staff.protection', { damage: staffProtection(e) / 10, next: staffProtection(next) / 10 }); break;
            }
        }
    } else {
        if (!k.chargesKnown) add((item.timesUsed ?? 0) > 0 ? 'wand.used' : 'wand.unused', { count: item.timesUsed ?? 0 });
        // A range is kind-level information, never a back door to identify an
        // otherwise unknown wand from its enchanting increment.
        const range = k.kindKnown ? WAND_INITIAL_RANGES[item.identityId ?? ''] : undefined;
        if (range) {
            if (!k.chargesKnown) add('wand.range', { low: range[0], high: range[1] });
            add('wand.enchant', { charges: range[0] });
        }
        add('wand.recharge');
    }
    return [{ header: detailText('header.arcana'), lines }];
}
