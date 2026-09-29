import { ringStealthAdjustment, ringAwarenessBonus, ringClairvoyanceRadius, ringTransferencePercent } from '../Items/ItemEffectFormulas';
import type { Item } from '../Items/Item';
import { ItemLoader } from '../Items/ItemLoader';
import { turnsForFullRegenInThousandths } from '../Items/RingBonuses';
import { ringWisdomMultiplierPercent } from '../Items/ArcanaRecharge';
import { charmEffectDuration, charmHealing, charmProtection, charmRechargeDelay,
    charmShattering, charmGuardianLifespan, charmNegationRadius, isCharmKind } from '../Items/CharmModel';
import type { DetailSection, DetailLine } from './DetailGenerator';
import type { ItemDetailContext } from './ItemDetailContext';
import { itemKnowledge } from './ItemKnowledge';
import { detailText, signed } from './ItemDetailText';
import i18next from 'i18next';

export function ringDetail(item: Item, ctx: ItemDetailContext): DetailSection[] {
    const k = itemKnowledge(item, ctx), e = item.enchantment, lines: DetailLine[] = [];
    const add = (key: string, values: Record<string, number | string> = {}) => lines.push({ text: detailText(key, values) });
    if (k.instanceKnown && k.kindKnown) {
        add('ring.enchant', { enchant: signed(e) });
        switch (item.identityId) {
            case 'ring_of_clairvoyance':
                add(e > 0 ? 'ring.clairvoyance' : e < 0 ? 'ring.blindness' : 'ring.no_clairvoyance', { radius: ringClairvoyanceRadius(e), next: ringClairvoyanceRadius(e + 1) }); break;
            case 'ring_of_stealth': add('ring.stealth', { change: signed(ringStealthAdjustment(e)), next: signed(ringStealthAdjustment(e + 1)) }); break;
            case 'ring_of_regeneration': add('ring.regeneration', { turns: Math.floor(turnsForFullRegenInThousandths(e) / 1000), next: Math.floor(turnsForFullRegenInThousandths(e + 1) / 1000) }); break;
            case 'ring_of_transference': add(e < 0 ? 'ring.transference_bad' : 'ring.transference', { percent: Math.abs(ringTransferencePercent(e)), next: Math.abs(ringTransferencePercent(e + 1)) }); break;
            case 'ring_of_awareness': add('ring.awareness', { change: ringAwarenessBonus(e), next: ringAwarenessBonus(e + 1) }); break;
            case 'ring_of_reaping': add(e < 0 ? 'ring.reaping_bad' : 'ring.reaping', { turns: Math.abs(e), next: Math.abs(e + 1) }); break;
            case 'ring_of_wisdom': add('ring.wisdom', { percent: ringWisdomMultiplierPercent(e), next: ringWisdomMultiplierPercent(e + 1) }); break;
            // CE light has no separate numeric paragraph: its intro explains it.
        }
    } else {
        const remaining = item.charges ?? ItemLoader.RING_DELAY_TO_AUTO_ID;
        add('identify.ring', { remaining });
        if (!k.instanceKnown && (remaining < ItemLoader.RING_DELAY_TO_AUTO_ID || item.magicDetected)) add('ring.cap', { cap: item.timesEnchanted + 1 });
    }
    return lines.length ? [{ header: detailText('header.ring'), lines }] : [];
}

export function charmDetail(item: Item, ctx: ItemDetailContext): DetailSection[] {
    const id = item.identityId;
    if (!isCharmKind(id)) return [];
    const effectAt = (enchant: number): string => {
        switch (id) {
            case 'charm_of_health': return detailText('charm.health', { percent: charmHealing(enchant) });
            case 'charm_of_protection': return detailText('charm.protection', { damage: charmProtection(enchant) / 10 });
            case 'charm_of_speed': return detailText('charm.haste', { turns: charmEffectDuration(id, enchant) });
            case 'charm_of_fire_immunity': return detailText('charm.fire_immunity', { turns: charmEffectDuration(id, enchant) });
            case 'charm_of_invisibility': return detailText('charm.invisibility', { turns: charmEffectDuration(id, enchant) });
            case 'charm_of_telepathy': return detailText('charm.telepathy', { turns: charmEffectDuration(id, enchant) });
            case 'charm_of_levitation': return i18next.t('detail.charm.levitation', { turns: charmEffectDuration(id, enchant), defaultValue: 'Levitate for {{turns}} turns and break free of seizure' });
            case 'charm_of_shattering': return i18next.t('detail.charm.shattering', { radius: charmShattering(enchant), defaultValue: 'Shatter walls up to {{radius}} spaces away' });
            case 'charm_of_guardian': return i18next.t('detail.charm.guardian', { turns: charmGuardianLifespan(enchant), defaultValue: 'Summon a guardian for {{turns}} turns' });
            case 'charm_of_teleportation': return i18next.t('detail.charm.teleportation', { defaultValue: 'Teleport elsewhere on this floor' });
            case 'charm_of_recharging': return i18next.t('detail.charm.recharging', { defaultValue: 'Fully recharge staffs in your pack (not wands or charms)' });
            case 'charm_of_negation': return i18next.t('detail.charm.negation', { radius: charmNegationRadius(enchant), defaultValue: 'Negate yourself and visible creatures and floor items up to {{radius}} spaces away' });
        }
    };
    const e = item.enchantment;
    const lines: DetailLine[] = [
        { text: detailText('charm.effect', { effect: effectAt(e) }) },
        { text: detailText('charm.cooldown', { turns: charmRechargeDelay(id, e) }) },
        { text: i18next.t('detail.charm.enchanted', { effect: effectAt(e + 1), cooldown: charmRechargeDelay(id, e + 1), defaultValue: 'If enchanted: {{effect}}; recharge in {{cooldown}} turns' }) },
    ];
    if (id === 'charm_of_protection' && ctx.maxHp) lines.push({ text: detailText('charm.protection_percent', {
        percent: Math.trunc(100 * charmProtection(e) / 10 / ctx.maxHp), next: Math.trunc(100 * charmProtection(e + 1) / 10 / ctx.maxHp),
    }) });
    if (item.cooldownRemaining) lines.push({ text: detailText('charm.remaining', { turns: item.cooldownRemaining }), color: '#ff8844' });
    return [{ header: detailText('header.charm'), lines }];
}
