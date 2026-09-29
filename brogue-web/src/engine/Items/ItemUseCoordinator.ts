import { enchantedEquipment } from './ItemEffectFormulas';
import { Item, ItemCategory } from './Item';
import { ItemLoader } from './ItemLoader';
import { Player } from '../../entities/Player';
import { Monster } from '../../entities/Monster';
import { Creature, allocateEntityId } from '../../entities/Creature';
import type { Pos } from '../../types';
import type { BoltWorld } from '../Combat/BoltTrajectory';
import { timeSystem } from '../Systems/Time';
import { canEnchantArcana, enchantArcana } from './ArcanaEnchantment';
import { charmEffectDuration, charmHealing, charmProtection, charmRechargeDelay, charmShattering, charmGuardianLifespan, charmNegationRadius, isCharmKind } from './CharmModel';
import { logger } from '../Systems/Logger';
import i18next from 'i18next';
import type { StatusId } from '../../entities/Creature';
import { rng } from '../Random';

/** The inventory transaction is shared by quaffing, reading and throwing. */
export function consumeForUse(player: Player, item: Item): boolean {
    return player.inventory.consumeOne(item);
}

export function hasIdentifyTarget(player: Player): boolean {
    for (const item of player.inventory.items) ItemLoader.updateIdentifiableItem(item);
    return player.inventory.items.some(item => item.canBeIdentified);
}

export function canIdentifyChosenItem(player: Player, item: Item): boolean {
    if (!player.inventory.items.includes(item)) return false;
    ItemLoader.updateIdentifiableItem(item);
    return item.canBeIdentified;
}

export function canEnchantChosenItem(player: Player, item: Item): boolean {
    return player.inventory.items.includes(item) && (canEnchantArcana(item)
        || item.category === ItemCategory.RING
        || item.category === ItemCategory.WEAPON || item.category === ItemCategory.ARMOR);
}

export function enchantChosenItem(player: Player, item: Item, ports: {
    updateVision: () => void;
    logEnchanted: (item: Item) => void;
    logUncursed: (item: Item) => void;
}): void {
    // CE Items.c:7839-7899: the selected pack object, never a preferred slot.
    const wasCursed = item.isCursed;
    item.timesEnchanted++;
    if (item.category === ItemCategory.RING) {
        item.enchantment++;
        if (player.rings().includes(item) && item.identityId === 'ring_of_clairvoyance') ports.updateVision();
    } else if (canEnchantArcana(item)) {
        enchantArcana(item);
    } else {
        Object.assign(item, enchantedEquipment(item.enchantment, item.strengthRequired ?? 0));
        if (item.category === ItemCategory.WEAPON && item.quiverNumber) {
            item.quiverNumber = rng.randRange(1, 60000);
        }
        // CE equipItem(force), 7881 -> unequipItem:8665, clears current DONNING
        // without restarting it or changing maxStatus. Other gear is unaffected.
        if (item === player.equippedArmor) player.setStatusDuration('donning', 0);
    }
    // This mutation creates no rune and changes no knowledge. The readScroll
    // autoIdentify tail is handled after the flare by Game (Items.c:8019-8026).
    item.isCursed = false;
    ports.logEnchanted(item);
    if (wasCursed) ports.logUncursed(item);
}

/** In this CE tree readScroll reassigns theItem to the chosen target, then
 * compares its kind with SCROLL_ENCHANTING (0) and SCROLL_IDENTIFY (1) in
 * the autoIdentify tail. Preserve that observable behavior, including rune
 * revelation, only for the CE kinds with index >= 2 (Rogue.h:810-965).
 * Explicit IDs avoid depending on web table order or admitting retired kinds.
 */
export function enchantingAutoIdentifiesTarget(item: Item): boolean {
    const kinds: Partial<Record<ItemCategory, readonly string[]>> = {
        [ItemCategory.WEAPON]: ['broadsword', 'whip', 'rapier', 'flail', 'mace', 'war_hammer', 'spear', 'war_pike', 'axe', 'war_axe', 'dart', 'incendiary_dart', 'javelin'],
        [ItemCategory.ARMOR]: ['chain_mail', 'banded_mail', 'splint_mail', 'plate_mail'],
        [ItemCategory.RING]: ['ring_of_regeneration', 'ring_of_transference', 'ring_of_light', 'ring_of_awareness', 'ring_of_wisdom', 'ring_of_reaping'],
        [ItemCategory.STAFF]: ['staff_of_poison', 'staff_of_tunneling', 'staff_of_blinking', 'staff_of_entrancement', 'staff_of_obstruction', 'staff_of_discord', 'staff_of_conjuration', 'staff_of_healing', 'staff_of_haste', 'staff_of_protection'],
        [ItemCategory.WAND]: ['wand_of_polymorphism', 'wand_of_negation', 'wand_of_domination', 'wand_of_beckoning', 'wand_of_plenty', 'wand_of_invisibility', 'wand_of_empowerment'],
    };
    return kinds[item.category]?.includes(item.identityId ?? '') ?? false;
}

/** Invoke a ready charm. A false result leaves cooldown, identity and time untouched. */
export function invokeCharm(player: Player, item: Item, identityId: string | undefined, ports: {
    applyTimedStatus: (status: StatusId, duration: number) => void;
    extinguish: () => void;
    shatter: (radius: number) => void;
    summonGuardian: (lifespan: number) => void;
    teleport: () => void;
    rechargeStaffs: () => void;
    negate: (radius: number) => void;
    endTurn: () => void;
}): boolean {
    if (!isCharmKind(identityId)) return false;
    const duration = charmEffectDuration(identityId, item.enchantment);
    if (identityId === 'charm_of_health') {
        const healed = player.heal(charmHealing(item.enchantment), false);
        logger.log(i18next.t('arcana.charm_health', { item: item.name, heal: healed, defaultValue: `You invoke ${item.name} and recover ${healed} HP.` }), '#66ff88');
    } else if (identityId === 'charm_of_invisibility') {
        ports.applyTimedStatus('invisible', duration);
        player.setStatusDuration('invisible', duration);
        player.maxStatus.invisible = duration;
        logger.log(i18next.t('arcana.charm_invisibility', { item: item.name, defaultValue: `You invoke ${item.name} and vanish from sight.` }), '#99ccff');
    } else if (identityId === 'charm_of_speed') {
        player.setStatusDuration('slowed', 0);
        player.setStatusDuration('haste', 0);
        ports.applyTimedStatus('hasted', duration);
        player.setStatusDuration('hasted', duration);
        player.maxStatus.hasted = duration;
        logger.log(i18next.t('arcana.charm_speed', { item: item.name, defaultValue: `You invoke ${item.name} and feel unnaturally swift.` }), '#99ddff');
    } else if (identityId === 'charm_of_protection') {
        player.applyShield(charmProtection(item.enchantment));
        logger.log(i18next.t('arcana.charm_protection', { item: item.name, defaultValue: `A shimmering shield coalesces around you.` }), '#ffffaa');
    } else if (identityId === 'charm_of_telepathy') {
        ports.applyTimedStatus('telepathy', duration);
        player.setStatusDuration('telepathy', duration);
        player.maxStatus.telepathy = duration;
    } else if (identityId === 'charm_of_fire_immunity') {
        ports.applyTimedStatus('immune_fire', duration);
        player.setStatusDuration('immune_fire', duration);
        player.maxStatus.immune_fire = duration;
        ports.extinguish();
        logger.log(i18next.t('arcana.charm_fire_immunity', { defaultValue: 'You no longer fear fire.' }), '#ffbb66');
    } else if (identityId === 'charm_of_levitation') {
        ports.applyTimedStatus('levitating', duration);
        player.setStatusDuration('levitating', duration);
        player.maxStatus.levitating = duration;
        player.seized = false;
    } else if (identityId === 'charm_of_shattering') {
        logger.log(i18next.t('arcana.charm_shattering', { defaultValue: 'Your charm emits a wave of turquoise light that pierces the nearby walls!' }), '#40e0d0');
        ports.shatter(charmShattering(item.enchantment));
    } else if (identityId === 'charm_of_guardian') {
        logger.log(i18next.t('arcana.charm_guardian', { defaultValue: 'Your charm flashes and the form of a mythical guardian coalesces!' }), '#ccccff');
        ports.summonGuardian(charmGuardianLifespan(item.enchantment));
    } else if (identityId === 'charm_of_teleportation') {
        ports.teleport();
    } else if (identityId === 'charm_of_recharging') {
        ports.rechargeStaffs();
    } else if (identityId === 'charm_of_negation') {
        // CE useCharm adds one to the magnitude displayed in itemDetails.
        ports.negate(charmNegationRadius(item.enchantment) + 1);
    }
    item.cooldownTurns = charmRechargeDelay(identityId, item.enchantment);
    item.cooldownRemaining = item.cooldownTurns;
    if (!ItemLoader.identifiedItems.has(identityId)) {
        ItemLoader.identify(identityId);
        logger.log(i18next.t('item.identify', { name: item.name, defaultValue: `You identify ${item.name}.` }), '#00ffff');
    }
    finishItemUse(player, ports.endTurn);
    return true;
}

/** The callback runs after effects, so speed changes take effect on this turn. */
export function finishItemUse(player: Player, endTurn: () => void): void {
    timeSystem.currentTick += player.movementSpeed;
    endTurn();
}

export function prepareThrownItem(player: Player, item: Item, origin: Pos, isEquippedWeapon: boolean): Item {
    if (item.quantity > 1) {
        item.quantity--;
        const thrown = Object.assign(new Item(item.name, item.char, item.color, item.category), item);
        thrown.id = allocateEntityId();
        thrown.quantity = 1;
        thrown.loc = { ...origin };
        return thrown;
    }
    player.inventory.removeItem(item);
    if (isEquippedWeapon) player.unequip(item);
    item.loc = { ...origin };
    return item;
}

export function boltWorldFor(caster: Creature | null, player: Player, monsters: readonly Monster[], hideDetails = false): BoltWorld {
    return {
        caster, hideDetails,
        creatureAt: pos => {
            if (player.hp > 0 && player.loc.x === pos.x && player.loc.y === pos.y) return player;
            return monsters.find(m => m.hp > 0 && !m.isDormant && m.loc.x === pos.x && m.loc.y === pos.y);
        },
    };
}

/** Resolve and spend an already approved staff/wand target, preserving effect-before-charge order. */
export function commitArcanaTarget(item: Item, cursor: Pos, ports: {
    currentTurn?: number;
    zap: (item: Item, cursor: Pos) => { outcome?: { autoID?: boolean } | null };
    logIdentify: (item: Item) => void;
    logEmpty: (item: Item) => void;
}): ReturnType<typeof ports.zap> | null {
    const id = (item as Item & { identityId?: string }).identityId ?? '';
    const charges = item.charges ?? 0;
    if (charges <= 0 && item.identified === true) return null;
    if (charges > 0) {
        const result = ports.zap(item, cursor);
        if (result.outcome?.autoID && !ItemLoader.identifiedItems.has(id)) {
            ItemLoader.identifyItemKind(item);
            ports.logIdentify(item);
        }
        if (item.category === ItemCategory.STAFF && ports.currentTurn !== undefined) {
            item.knownStaffUses = [ports.currentTurn, ...item.knownStaffUses].slice(0, 3);
        }
        item.charges = charges - 1;
        if (item.category === ItemCategory.WAND) item.timesUsed = (item.timesUsed ?? 0) + 1;
        return result;
    }
    item.maxChargesKnown = true;
    ports.logEmpty(item);
    return null;
}
