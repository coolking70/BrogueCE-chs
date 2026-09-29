import { enchantedEquipment, armorStealthAdjustment } from '../Items/ItemEffectFormulas';
import { ItemCategory as C, type Item } from '../Items/Item';
import { ItemLoader } from '../Items/ItemLoader';
import { CombatSystem } from '../Combat/Combat';
import { accuracyFraction, damageFraction, enchantedDamage, netEnchant, playerDefense,
    strengthModifier, runicWeaponChance, weaponParalysisDuration, weaponSlowDuration,
    weaponConfusionDuration, weaponForceDistance, weaponImageCount, weaponImageDuration,
    armorImageCount, armorAbsorptionMax, armorReprisalPercent, reflectionChance } from '../Combat/CombatFormulas';
import { monsterIsInClass } from '../Combat/MonsterClass';
import monsters from '../../data/monsters.json';
import type { DetailSection, DetailLine } from './DetailGenerator';
import type { ItemDetailContext } from './ItemDetailContext';
import { itemKnowledge } from './ItemKnowledge';
import { detailText, signed } from './ItemDetailText';
import i18next from 'i18next';

export function equipmentDetail(item: Item, ctx: ItemDetailContext): DetailSection[] {
    const k = itemKnowledge(item, ctx), weapon = item.category === C.WEAPON;
    const req = item.strengthRequired ?? 0, str = ctx.strength;
    const ne = netEnchant(k.instanceKnown ? item.enchantment : 0, str, req);
    // Same inputs as ItemUseCoordinator.enchantChosenItem: +1 E and -1 strength
    // requirement (floored at zero). Do not call the mutator: throwing gear rolls RNG.
    const projection = enchantedEquipment(item.enchantment, req);
    const nextReq = projection.strengthRequired;
    const next = netEnchant(projection.enchantment, str, nextReq);
    const lines: DetailLine[] = [], sections: DetailSection[] = [];
    const add = (key: string, values: Record<string, number | string> = {}) => lines.push({ text: detailText(key, values) });
    const range = item.damage ? CombatSystem.parseDamageString(item.damage) : undefined;
    if (weapon && range) {
        add('weapon.base', { dice: item.damage!, low: range.min, high: range.max });
        if (k.instanceKnown) {
            add('weapon.actual', { low: Math.max(1, enchantedDamage(range.min, ne)), high: Math.max(1, enchantedDamage(range.max, ne)), enchant: signed(item.enchantment) });
            add('weapon.next', { low: Math.max(1, enchantedDamage(range.min, next)), high: Math.max(1, enchantedDamage(range.max, next)), strength: nextReq });
        }
        if (ctx.weapon !== undefined && !ctx.equipped) {
            const current = ctx.weapon;
            const currentRange = CombatSystem.parseDamageString(current?.damage ?? '1d2');
            const currentEnchant = current ? netEnchant(current.enchantment, str, current.strengthRequired) : 0;
            const accuracy = Math.trunc(100 * accuracyFraction(ne));
            const currentAccuracy = Math.trunc(100 * accuracyFraction(currentEnchant));
            const mean = (range.min + range.max) / 2 * damageFraction(ne);
            const currentMean = (currentRange.min + currentRange.max) / 2 * damageFraction(currentEnchant);
            add('weapon.compare', {
                assumption: !k.instanceKnown || current?.assumed ? detailText('assumed') : '',
                accuracy: signed(Math.trunc(accuracy * 100 / Math.max(1, currentAccuracy)) - 100),
                damage: signed(Math.trunc(mean * 100 / Math.max(0.01, currentMean)) - 100),
            });
        }
    } else if (!weapon && item.armor !== undefined) {
        add('armor.base', { armor: item.armor });
        if (k.instanceKnown) {
            if (ne !== 0 || item.enchantment !== 0) add('armor.actual', {
                armor: Math.round((item.armor + ne) * 100) / 100, enchant: signed(ne),
                note: ne !== item.enchantment ? detailText('strength.note') : '',
            });
            add('armor.next', { armor: Math.trunc(playerDefense(item.armor, projection.enchantment, str, nextReq) / 10), strength: nextReq });
        }
        if (ctx.armor !== undefined && !ctx.equipped) {
            const current = ctx.armor;
            const rating = Math.trunc(playerDefense(item.armor, k.instanceKnown ? item.enchantment : 0, str, req) / 10);
            const currentRating = current ? Math.trunc(playerDefense(current.armor ?? 0, current.enchantment, str, current.strengthRequired) / 10) : 0;
            add('armor.compare', { assumption: !k.instanceKnown || current?.assumed ? detailText('assumed') : '', armor: rating, current: currentRating });
            // CE armorStealthAdjustment / current Game.calculateStealthRange.
            const stealth = armorStealthAdjustment(req) - armorStealthAdjustment(current?.strengthRequired ?? 0);
            if (stealth) add('armor.stealth', { change: signed(stealth) });
        }
    }
    if (item.strengthRequired !== undefined) {
        const mod = strengthModifier(str, req);
        add('strength', { required: req, strength: str, state: detailText(mod >= 0 ? 'strength.enough' : 'strength.low') });
        if (mod) add('strength.modifier', { modifier: signed(mod) });
    }
    if (!k.instanceKnown) add(weapon ? 'identify.weapon' : 'identify.armor', {
        remaining: item.charges ?? (weapon ? ItemLoader.WEAPON_KILLS_TO_AUTO_ID : ItemLoader.ARMOR_DELAY_TO_AUTO_ID),
    });
    if (item.isProtected) add('protected', { name: item.displayName });
    sections.push({ header: detailText(weapon ? 'header.weapon' : 'header.armor'), lines });
    if (item.runicType) {
        if (k.runicKnown) sections.push(runicDetail(item, ctx, ne, next));
        else if (k.instanceKnown) sections.push({ lines: [{ text: detailText('runic.unknown') }] });
    }
    return sections;
}

function runicDetail(item: Item, ctx: ItemDetailContext, ne: number, next: number): DetailSection {
    const id = item.runicType!, weapon = item.category === C.WEAPON, known = itemKnowledge(item, ctx).instanceKnown;
    const lines: DetailLine[] = [];
    const add = (key: string, values: Record<string, number | string> = {}) => lines.push({ text: detailText(key, values), color: '#ffcc44' });
    const name = i18next.t('runic.name.' + id, { defaultValue: detailText('runic.unreadable') }) ?? detailText('runic.unreadable');
    const target = detailText('class.' + (item.vorpalEnemy ?? 'unknown'));
    add((weapon ? 'weapon.runic.' : 'armor.runic.') + id, { target });
    if (weapon) {
        if (id === 'slaying') {
            if (!item.isProtected && monsters.some(m => monsterIsInClass(m.id, item.vorpalEnemy)
                && (m.behaviorFlags as readonly string[] | undefined)?.includes('MONST_DEFEND_DEGRADE_WEAPON'))) add('runic.acid');
        } else if (known) {
            const range = CombatSystem.parseDamageString(item.damage ?? '1d2');
            const weaponContext = { damageMin: range.min, damageMax: range.max,
                attacksStagger: item.flags?.includes('ITEM_ATTACKS_STAGGER'),
                attacksQuickly: item.flags?.includes('ITEM_ATTACKS_QUICKLY') };
            const chance = runicWeaponChance(ne, id, weaponContext), nextChance = runicWeaponChance(next, id, weaponContext);
            add('runic.chance', { chance, next: nextChance });
            if (chance < 2 && ctx.strength < (item.strengthRequired ?? 0)) add('runic.weak');
            const duration = { paralyzing: weaponParalysisDuration, slowing: weaponSlowDuration, confusion: weaponConfusionDuration }[id];
            if (duration) add('runic.duration', { turns: duration(ne), next: duration(next) });
            if (id === 'force') add('runic.force', { distance: weaponForceDistance(ne), next: weaponForceDistance(next) });
            if (id === 'multiplicity') add('runic.images', { count: weaponImageCount(ne), turns: weaponImageDuration(ne), nextCount: weaponImageCount(next), nextTurns: weaponImageDuration(next) });
        }
    } else if (known) {
        switch (id) {
            case 'multiplicity': add('runic.armor_images', { count: armorImageCount(ne), next: armorImageCount(next) }); break;
            case 'absorption':
                add('runic.absorption', { max: armorAbsorptionMax(ne), next: armorAbsorptionMax(next) });
                if (ctx.maxHp) add('runic.health_percent', { percent: Math.trunc(100 * armorAbsorptionMax(ne) / ctx.maxHp) });
                break;
            case 'reprisal': add('runic.reprisal', { percent: armorReprisalPercent(ne), next: armorReprisalPercent(next) }); break;
            case 'reflection': {
                // CE Items.c:4960-4992 rejects nonpositive net reflection.
                // Its old negative-enchant self-deflection prose has no executor.
                if (ne <= 0) add('runic.reflection_inactive');
                const chance = ne > 0 ? reflectionChance(ne) : 0, nextChance = next > 0 ? reflectionChance(next) : 0;
                add('runic.reflection', { chance, back: Math.trunc(chance * chance / 100), next: nextChance, nextBack: Math.trunc(nextChance * nextChance / 100) });
                break;
            }
        }
    }
    return { header: detailText('header.runic', { name }), lines };
}
