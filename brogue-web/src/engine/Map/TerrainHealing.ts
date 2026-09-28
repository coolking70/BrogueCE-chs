import type { Cell } from './Grid';
import { TERRAIN_FLAGS, T_CAUSES_HEALING } from './TerrainCatalog';

/** CE Time.c:645-657, exposeCreatureToGradualTileEffects. R6 supplies the same
 * exposure ticks used for gradual damage, then adds this amount to creature.hp.
 * This is not an instant-entry effect and does not consume RNG or mutate a cell.
 */
export function terrainHealingAmount(
    cell: Cell,
    currentHP: number,
    maxHP: number,
    ticks: number,
    inanimate = false,
    submerged = false,
): number {
    if (inanimate || submerged || currentHP >= maxHP
        || !cell.layers.some(tile => (TERRAIN_FLAGS[tile].flags & T_CAUSES_HEALING) !== 0)) return 0;
    // Preserve both C integer divisions; maxHP * ticks / 1500 is not equivalent.
    const amount = Math.max(1, Math.trunc(Math.trunc(maxHP / 15) * ticks / 100));
    return Math.min(amount, maxHP - currentHP);
}
