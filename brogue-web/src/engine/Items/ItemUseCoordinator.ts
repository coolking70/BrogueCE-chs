import { Item, ItemCategory } from './Item';
import { ItemLoader } from './ItemLoader';
import { Player } from '../../entities/Player';
import { Monster } from '../../entities/Monster';
import { Creature, allocateEntityId } from '../../entities/Creature';
import type { Pos } from '../../types';
import type { BoltWorld } from '../Combat/BoltTrajectory';
import { timeSystem } from '../Systems/Time';
import { canEnchantArcana, enchantArcana } from './ArcanaEnchantment';
import { charmEffectDuration, charmHealing, charmProtection, charmRechargeDelay, isCharmKind } from './CharmModel';
import { logger } from '../Systems/Logger';
import i18next from 'i18next';
import type { StatusId } from '../../entities/Creature';

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
        || item === (player.equippedWeapon ?? player.equippedArmor));
}

export function enchantChosenItem(player: Player, item: Item, ports: {
    updateVision: () => void;
    enchantEquippedGear: () => void;
    logArcana: (item: Item) => void;
    logGear: () => void;
}): void {
    if (item.category === ItemCategory.RING) {
        item.timesEnchanted++;
        item.enchantment++;
        item.isCursed = false;
        if (player.rings().includes(item) && item.identityId === 'ring_of_clairvoyance') ports.updateVision();
        ports.logArcana(item);
    } else if (canEnchantArcana(item)) {
        enchantArcana(item);
        ports.logArcana(item);
    } else {
        ports.enchantEquippedGear();
        ports.logGear();
    }
}

/** Invoke a ready charm. A false result leaves cooldown, identity and time untouched. */
export function invokeCharm(player: Player, item: Item, identityId: string | undefined, ports: {
    applyTimedStatus: (status: StatusId, duration: number) => void;
    extinguish: () => void;
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
        item.charges = charges - 1;
        if (item.category === ItemCategory.WAND) item.timesUsed = (item.timesUsed ?? 0) + 1;
        return result;
    }
    item.maxChargesKnown = true;
    ports.logEmpty(item);
    return null;
}
