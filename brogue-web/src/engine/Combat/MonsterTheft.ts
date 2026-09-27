import { Monster, MonsterMode, MonsterState } from '../../entities/Monster';
import type { Player } from '../../entities/Player';
import { Item, ItemCategory } from '../Items/Item';
import { ItemLoader } from '../Items/ItemLoader';
import { copyFields, ITEM_FIELDS } from '../Core/EntitySnapshot';
import { rng } from '../Random';
import { monsterIsInClass } from './MonsterClass';
import { logger } from '../Systems/Logger';
import i18next from 'i18next';

/** CE generates an ALL_ITEMS allocation before overwriting it with the stack.
 * Keep that runtime lottery (including gold); never call the floor allocator. */
function allocateSplit(depth: number): Item {
    const slots = ItemLoader.CE_ITEM_GENERATION_PROBABILITIES;
    let roll = rng.randRange(1, slots.reduce((n, slot) => n + slot.weight, 0));
    const category = slots.find(slot => (roll -= slot.weight) <= 0)!.category;
    if (category === ItemCategory.GOLD) return ItemLoader.spawnGold(rng.randRange(50 + depth * 10, 100 + depth * 15), 0, 0)!;
    const entries = [
        [ItemCategory.SCROLL, ItemLoader.genScrolls, ItemLoader.spawnScroll],
        [ItemCategory.POTION, ItemLoader.genPotions, ItemLoader.spawnPotion],
        [ItemCategory.STAFF, ItemLoader.genStaffs, ItemLoader.spawnStaff],
        [ItemCategory.WAND, ItemLoader.genWands, ItemLoader.spawnWand],
        [ItemCategory.WEAPON, ItemLoader.genWeapons, ItemLoader.spawnWeapon],
        [ItemCategory.ARMOR, ItemLoader.genArmors, ItemLoader.spawnArmor],
        [ItemCategory.FOOD, ItemLoader.genFood, ItemLoader.spawnFood],
        [ItemCategory.RING, ItemLoader.genRings, ItemLoader.spawnMachineRing],
        [ItemCategory.CHARM, ItemLoader.genCharms, ItemLoader.spawnMachineCharm],
    ] as const;
    const entry = entries.find(row => row[0] === category)!;
    const kind = ItemLoader.chooseKind(entry[1].map(item => item.frequency ?? 0));
    return entry[2].call(ItemLoader, entry[1][kind]!.id, 0, 0, depth)!;
}

/** Called only after a surviving, successful attack; zero damage still qualifies.
 * attackHit is a SECOND accuracy test, after the no-item/confusion gates. */
export function stealFromPlayer(m: Monster, p: Player, attackHit: () => boolean, depth: number): Item | null {
    const armor = p.equippedArmor;
    if (!m.hasAbility('MA_HIT_STEAL_FLEE') || m.carriedItem || !p.inventory.items.length || m.hp <= 0
        || m.hasStatus('confused') || (armor?.runicType === 'immunity' && monsterIsInClass(m.typeId, armor.vorpalEnemy))
        || !attackHit()) return null;
    const equipped = new Set([p.equippedWeapon, p.equippedArmor, ...p.rings()]);
    const candidates = p.inventory.items.filter(item => !equipped.has(item) && !item.flags?.includes('ITEM_EQUIPPED'));
    if (!candidates.length) return null;
    let item = candidates[rng.randRange(1, candidates.length) - 1]!;
    const quantity = item.category === ItemCategory.WEAPON ? (item.quantity > 3 ? Math.trunc((item.quantity + 1) / 2) : item.quantity) : 1;
    if (quantity < item.quantity) {
        const split = allocateSplit(depth), id = split.id;
        Object.assign(split, copyFields(item, ITEM_FIELDS), { id, quantity });
        item.quantity -= quantity;
        item = split;
    } else p.inventory.removeItem(item);
    item.flags = (item.flags ?? []).filter(flag => flag !== 'ITEM_PLAYER_AVOIDS');
    m.carriedItem = item;
    m.creatureMode = MonsterMode.PERM_FLEEING;
    m.state = MonsterState.FLEEING;
    logger.log(i18next.t('combat.monster_stole_item', { monster: m.name, item: item.displayName,
        count: quantity, defaultValue: `The ${m.name} stole ${quantity} ${item.displayName}!` }), '#ff6666');
    return item;
}
