import { describe, expect, it } from 'vitest';
import { Inventory } from '../engine/Items/Inventory';
import { Item, ItemCategory } from '../engine/Items/Item';
import { createHeadlessGame } from './harness';

function item(category: ItemCategory, name: string, quantity = 1): Item {
    const result = new Item(name, '!', 0xffffff, category);
    result.quantity = quantity;
    return result;
}

describe('U20 CE pack accounting and stacks', () => {
    it('food stacks by kind but each unit occupies capacity; full pack rejects even matching food', () => {
        const pack = new Inventory();
        const first = item(ItemCategory.FOOD, 'Ration', 2);
        expect(pack.addItem(first)).toBe(true);
        expect(pack.addItem(item(ItemCategory.FOOD, 'Ration', 3))).toBe(true);
        expect(first.quantity).toBe(5);
        expect(pack.packCount()).toBe(5);
        for (let n = 0; n < 21; n++) expect(pack.addItem(item(ItemCategory.ARMOR, `Armor ${n}`))).toBe(true);
        expect(pack.packCount()).toBe(26);
        expect(pack.addItem(item(ItemCategory.FOOD, 'Ration'))).toBe(false);
        expect(pack.addItem(item(ItemCategory.GOLD, 'Gold', 99))).toBe(true);
        expect(pack.items.some(i => i.category === ItemCategory.GOLD)).toBe(false);
    });

    it('matching quiver enters full pack, distinct quiver does not; letters are stable and reused', () => {
        const pack = new Inventory();
        const darts = item(ItemCategory.WEAPON, 'Dart', 15);
        darts.quiverNumber = 7;
        expect(pack.addItem(darts)).toBe(true);
        for (let n = 0; n < 25; n++) pack.addItem(item(ItemCategory.ARMOR, `Armor ${n}`));
        const matching = item(ItemCategory.WEAPON, 'Dart', 4);
        matching.quiverNumber = 7;
        expect(pack.addItem(matching)).toBe(true);
        expect(darts.quantity).toBe(19);
        const different = item(ItemCategory.WEAPON, 'Dart');
        different.quiverNumber = 8;
        expect(pack.addItem(different)).toBe(false);
        const letter = pack.items[1]!.inventoryLetter;
        pack.removeItem(pack.items[1]!);
        expect(pack.addItem(different)).toBe(true);
        expect(different.inventoryLetter).toBe(letter);
        expect(darts.inventoryLetter).toBe('a');
    });

    it('CE quiver match ignores curse and identification while conflating known flags', () => {
        const pack = new Inventory();
        const a = item(ItemCategory.WEAPON, 'Dart', 2);
        a.quiverNumber = 11;
        a.identified = false;
        const b = item(ItemCategory.WEAPON, 'Dart', 3);
        b.quiverNumber = 11;
        b.isCursed = true;
        b.identified = true;
        b.magicDetected = true;
        b.enchantment = 2;
        pack.addItem(a);
        pack.addItem(b);
        expect(pack.items).toEqual([a]);
        expect(a.quantity).toBe(5);
        expect(a.identified).toBe(true);
        expect(a.magicDetected).toBe(true);
        expect(a.enchantment).toBe(2);
    });

    it('CE full-pack precheck compares quiver number before the stricter merge check', () => {
        const pack = new Inventory();
        const darts = item(ItemCategory.WEAPON, 'Dart');
        darts.quiverNumber = 19;
        pack.addItem(darts);
        for (let n = 0; n < 25; n++) pack.addItem(item(ItemCategory.ARMOR, `Armor ${n}`));
        const otherKind = item(ItemCategory.WEAPON, 'Incendiary Dart');
        otherKind.quiverNumber = 19;
        expect(pack.addItem(otherKind)).toBe(true);
        expect(pack.packCount()).toBe(27);
        expect(pack.items).toContain(otherKind);
    });

    it('throw and drop conserve quantity with distinct IDs through snapshot reload', () => {
        const game = createHeadlessGame(20260914);
        const ration = game.player.inventory.items.find(i => i.category === ItemCategory.FOOD)!;
        const extra = item(ItemCategory.FOOD, ration.name, 2);
        extra.consumableId = ration.consumableId;
        expect(game.player.inventory.addItem(extra)).toBe(true);
        expect(ration.quantity).toBe(3);
        game.dropItem(ration);
        const dropped = game.items.find(i => i.name === ration.name && i.loc.x === game.player.loc.x && i.loc.y === game.player.loc.y)!;
        expect(ration.quantity).toBe(2);
        expect(dropped.quantity).toBe(1);
        expect(dropped.id).not.toBe(ration.id);
        const saved = game.toSnapshot();
        const loaded = createHeadlessGame(1);
        expect(loaded.loadSnapshot(saved)).toBe(true);
        const packRation = loaded.player.inventory.items.find(i => i.id === ration.id)!;
        const floorRation = loaded.items.find(i => i.id === dropped.id)!;
        expect(packRation.quantity + floorRation.quantity).toBe(3);
        expect(packRation.inventoryLetter).toBe(ration.inventoryLetter);
    });
});
