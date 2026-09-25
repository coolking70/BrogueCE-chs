import { ItemCategory } from '../Items/Item';

export interface ScoredItem {
    category: ItemCategory;
    quantity: number;
}

/** CE Items.c:itemValue. Other inventory categories have no sale value. */
export function itemValue(item: ScoredItem): number {
    if (item.category === ItemCategory.AMULET) return 35000;
    if (item.category === ItemCategory.GEM) return 5000 * item.quantity;
    return 0;
}

/** CE RogueMain.c:1169-1175,1305-1337,1373-1377. */
export function endgameScore(gold: number, items: ScoredItem[], won: boolean, superVictory: boolean, easy: boolean): number {
    let score = gold;
    if (won) {
        for (const item of items) {
            const value = itemValue(item);
            score += Math.max(0, superVictory && item.category === ItemCategory.AMULET ? value * 2 : value);
        }
    } else {
        score += 500 * lumenstoneCount(items);
    }
    return easy ? Math.trunc(score / 10) : score;
}

/** CE numberOfMatchingPackItems(GEM, ...) counts pack entries, not quantity
 * (Items.c; RogueMain.c:1170). Victory's itemValue does multiply quantity. */
export function lumenstoneCount(items: ScoredItem[]): number {
    return items.filter(item => item.category === ItemCategory.GEM).length;
}
