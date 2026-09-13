/**
 * src/engine/Items/Inventory.ts
 * Manages picking up, dropping, and carrying items
 */

import { Item } from './Item';

export class Inventory {
    public capacity: number = 26; // Brogue standard a-z inventory
    public items: Item[] = [];

    public hasSpace(): boolean {
        return this.items.length < this.capacity;
    }

    public addItem(item: Item): boolean {
        if (this.hasSpace()) {
            this.items.push(item);
            return true;
        }
        return false;
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
