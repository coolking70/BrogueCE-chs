/** Pure CE visibility/discovery predicates. No logging, mutation or RNG. */
import type { Player } from '../../entities/Player';
import type { Monster } from '../../entities/Monster';
import { ItemCategory, type Item } from '../Items/Item';
import type { Cell, Grid } from '../Map/Grid';
import { TERRAIN_FLAGS, TM_INTERRUPT_EXPLORATION_WHEN_SEEN } from '../Map/TerrainCatalog';
import { canSeeMonster } from '../UI/MonsterVisibility';

export function visibleEntities(player: Player, grid: Grid, monsters: readonly Monster[], items: readonly Item[]) {
    return {
        monsters: new Set(monsters.filter(m => canSeeMonster(player, grid, m))),
        items: new Set(items.filter(i => grid.getCell(i.x, i.y)?.isVisible)),
    };
}

/** CE Movement.c:2592-2616: keys require an undiscovered, directly seen
 * cell; terrain additionally excludes MAGIC_MAPPED cells. */
export function firstSeenFeatures(cell: Cell, directlyVisible: boolean, items: readonly Item[]) {
    if (!directlyVisible || cell.isExplored) return { keys: [], terrain: undefined };
    return {
        keys: items.filter(i => i.category === ItemCategory.KEY && i.x === cell.x && i.y === cell.y),
        terrain: cell.isMagicMapped ? undefined : cell.layers.find(t =>
            TERRAIN_FLAGS[t].mechFlags & TM_INTERRUPT_EXPLORATION_WHEN_SEEN),
    };
}
