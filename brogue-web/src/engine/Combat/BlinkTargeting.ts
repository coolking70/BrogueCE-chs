import type { Pos } from '../../types';
import { DungeonLayer, type Grid } from '../Map/Grid';
import type { Item } from '../Items/Item';
import { ItemLoader } from '../Items/ItemLoader';
import type { Player } from '../../entities/Player';
import { Monster } from '../../entities/Monster';
import { cellTerrainFlags, cellTerrainMechFlags } from '../Map/DungeonFeature';
import { T_OBSTRUCTS_PASSABILITY, T_OBSTRUCTS_VISION, T_LAVA_INSTA_DEATH,
    T_ENTANGLES, T_AUTO_DESCENT, TM_EXTINGUISHES_FIRE } from '../Map/TerrainCatalog';
import { getBoltForItem } from './Bolt';
import { boltLine, staffBlinkDistance } from './BoltTrajectory';

/** W-25 selection only: never execute trace hooks, reveal E, spend RNG or move anyone.
 * CE Items.c:7358 range is a visual cue, not a restriction on cursor coordinates.
 * The grid retains discovery booleans but no historical terrain-flags snapshot.
 */
export function blinkTargetPreview(grid: Grid, player: Player, monsters: readonly Monster[], item: Item, aim: Pos) {
    const id = (item as Item & { identityId?: string }).identityId;
    if (id !== 'staff_of_blinking') return null;
    const known = ItemLoader.identifiedItems.has(id);
    const maxDistance = item.identified || item.maxChargesKnown ? staffBlinkDistance(item.enchantment) : null;
    const world = { caster: player, hideDetails: !known, creatureAt: (p: Pos) =>
        monsters.find(m => m.hp > 0 && !m.isDormant && m.x === p.x && m.y === p.y
            && (m.isAlly || (!m.isTrulyInvisible() && !m.hasStatus('invisible')) || grid.getCell(p.x,p.y)!.layers[DungeonLayer.GAS])) };
    const path = boltLine(grid, player.loc, aim, getBoltForItem(id), world);
    const limited = path.slice(0, maxDistance ?? grid.width);
    const block = limited.findIndex(p => world.creatureAt(p)
        || (cellTerrainFlags(grid,p.x,p.y) & (T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_VISION)));
    const travel = block < 0 ? limited : limited.slice(0,block);
    const landing = travel[travel.length-1] ?? player.loc;
    let risk: 'none' | 'certain' | 'possible' = 'none';
    if (known && !player.hasStatus('immune_fire') && !player.hasStatus('levitating')) {
        // CE :7278 reads impact mech flags once, including for unknown-range scan.
        const extinguishes = cellTerrainMechFlags(grid,landing.x,landing.y) & TM_EXTINGUISHES_FIRE;
        const lava = (p: Pos) => {
            const flags = cellTerrainFlags(grid,p.x,p.y);
            return !!(flags & T_LAVA_INSTA_DEATH) && !(flags & (T_ENTANGLES | T_AUTO_DESCENT)) && !extinguishes;
        };
        const discovered = (p: Pos) => !!grid.getCell(p.x,p.y)?.hasMemory;
        if (maxDistance !== null) {
            if (discovered(landing) && lava(landing)) risk = 'certain';
        } else {
            let possible = false, certain = true;
            for (let i=0; i<travel.length; i++) {
                const p = travel[i]!;
                if (!discovered(p)) continue;
                if (lava(p)) possible = true;
                else if (i >= staffBlinkDistance(2)-1) certain = false;
            }
            if (possible) risk = certain ? 'certain' : 'possible';
        }
    }
    // Unknown kind keeps ordinary cursor UI. A known kind with unknown E gets
    // no numeric limit; its provisional line must not accidentally use real E.
    return { maxDistance, risk, path: known ? travel.filter(p => grid.getCell(p.x,p.y)!.hasMemory || grid.getCell(p.x,p.y)!.isVisible) : [] };
}
