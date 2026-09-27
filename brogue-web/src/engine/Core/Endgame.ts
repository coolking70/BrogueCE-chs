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
        score += 500 * deathLumenstoneEntryCount(items);
    }
    return easy ? Math.trunc(score / 10) : score;
}

/** CE RogueMain.c:1169-1175: death redeems each matching pack entry for 500 gold. */
export function deathLumenstoneEntryCount(items: ScoredItem[]): number {
    return items.filter(item => item.category === ItemCategory.GEM).length;
}

/** CE RogueMain.c:1312-1313,1364-1370: victory descriptions count every gem. */
export function victoryLumenstoneQuantity(items: ScoredItem[]): number {
    return items.reduce((quantity, item) => quantity + (item.category === ItemCategory.GEM ? item.quantity : 0), 0);
}
