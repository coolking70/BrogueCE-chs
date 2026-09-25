/**
 * src/engine/Items/Inventory.ts
 * Manages picking up, dropping, and carrying items
 */

import { Item, ItemCategory } from './Item';

export class Inventory {
    public capacity: number = 26; // Brogue standard a-z inventory
    public items: Item[] = [];

    /** CE numberOfItemsInPack: ammunition occupies one place per stack. */
    public packCount(): number {
        return this.items.reduce((count, item) => count +
            (item.category === ItemCategory.WEAPON ? 1 : item.quantity), 0);
    }

    public hasSpace(item?: Item): boolean {
        if (!item) return this.packCount() < this.capacity;
        if (item.category === ItemCategory.GOLD) return true;
        // CE itemWillStackWithPack only compares the nonzero quiver number.
        // addItemToPack performs the stricter category/kind match afterward.
        if ((item.quiverNumber ?? 0) > 0
            && this.items.some(other => other.quiverNumber === item.quiverNumber)) return true;
        // CE tests the count before pickup, even when the incoming pile has
        // several non-weapon items and will put the pack over 26.
        return this.packCount() < this.capacity;
    }

    private kind(item: Item): string {
        return item.consumableId ?? item.identityId ?? item.name;
    }

    private stacksWith(a: Item, b: Item): boolean {
        if (a.category !== b.category || this.kind(a) !== this.kind(b)) return false;
        if (a.category === ItemCategory.FOOD || a.category === ItemCategory.POTION
            || a.category === ItemCategory.SCROLL) return true;
        return a.category === ItemCategory.WEAPON && (b.quiverNumber ?? 0) > 0
            && a.quiverNumber === b.quiverNumber;
    }

    private nextLetter(): string | undefined {
        return 'abcdefghijklmnopqrstuvwxyz'.split('').find(letter =>
            !this.items.some(item => item.inventoryLetter === letter));
    }

    public addItem(item: Item): boolean {
        if (!this.hasSpace(item)) return false;
        if (item.category === ItemCategory.GOLD) return true; // Currency belongs to Game.stats.
        const stack = this.items.find(other => this.stacksWith(other, item));
        if (stack) {
            stack.quantity += item.quantity;
            // CE conflateItemCharacteristics, Items.c:940-955.
            stack.magicDetected ||= item.magicDetected;
            if (item.identified === true) stack.identified = true;
            stack.isProtected ||= item.isProtected;
            stack.runicKnown ||= item.runicKnown;
            stack.canBeIdentified ||= item.canBeIdentified;
            stack.maxChargesKnown ||= item.maxChargesKnown;
            stack.enchantment = Math.max(stack.enchantment, item.enchantment);
            if (item.strengthRequired !== undefined)
                stack.strengthRequired = Math.min(stack.strengthRequired ?? item.strengthRequired, item.strengthRequired);
            if (!stack.originDepth || stack.originDepth !== item.originDepth) stack.originDepth = 0;
            return true;
        }
        if (!item.inventoryLetter || !/^[a-z]$/.test(item.inventoryLetter)
            || this.items.some(other => other.inventoryLetter === item.inventoryLetter))
            item.inventoryLetter = this.nextLetter();
        this.items.push(item);
        return true;
    }

    /** Consume one food, potion or scroll from its pack stack. */
    public consumeOne(item: Item): boolean {
        if (!this.items.includes(item)) return false;
        if (item.quantity > 1) { item.quantity--; return true; }
        return this.removeItem(item);
    }

    public removeItem(item: Item): boolean {
        const index = this.items.findIndex(i => i.id === item.id);
        if (index > -1) {
            this.items.splice(index, 1);
            return true;
        }
        return false;
    }

    public getWeight(): number {
        return this.items.reduce((total, item) => total + item.weight, 0);
    }
}
