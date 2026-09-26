/** Terrain eligibility for automatic travel/exploration (Movement.c:2041-2178,
 * Monsters.c:1335-1502). Manual movement and forced displacement are separate.
 * This supplies the existing A* frontier policy, not CE's weighted cost map.
 */
import type { Player } from '../../entities/Player';
import type { Cell } from '../Map/Grid';
import { terrainMechFlags } from '../Map/DungeonFeature';
import {
    TERRAIN_FLAGS, T_OBSTRUCTS_PASSABILITY, T_AUTO_DESCENT, T_LAVA_INSTA_DEATH,
    T_IS_DEEP_WATER, T_IS_DF_TRAP, T_IS_FIRE, T_SPONTANEOUSLY_IGNITES,
    T_HARMFUL_TERRAIN, T_RESPIRATION_IMMUNITIES, T_CAUSES_POISON, TM_IS_SECRET,
} from '../Map/TerrainCatalog';

function knownFlags(cell: Cell): number {
    const layers = cell.isVisible ? cell.layers : cell.rememberedLayers;
    return layers.reduce((flags, tile) => flags | TERRAIN_FLAGS[tile].flags, 0);
}

export function playerTravelTerrainAllowed(cell: Cell, here: Cell, player: Player): boolean {
    if (!cell.isVisible && !cell.hasMemory && !cell.isMagicMapped && !cell.isExplored) return true;
    const flags = knownFlags(cell), origin = knownFlags(here);
    if (flags & T_OBSTRUCTS_PASSABILITY) return false;
    // CE monsterAvoids: the player cannot avoid an unrevealed floor hazard.
    // Physical walls are handled first, including undiscovered secret doors.
    const layers = cell.isVisible ? cell.layers : cell.rememberedLayers;
    if (layers.some(tile => terrainMechFlags(tile) & TM_IS_SECRET)) return true;
    let immune = 0;
    if (player.hasStatus('levitating') || player.hasStatus('flying'))
        immune |= T_CAUSES_POISON | T_AUTO_DESCENT | T_IS_DEEP_WATER | T_IS_DF_TRAP | T_LAVA_INSTA_DEATH;
    if (player.hasStatus('immune_fire')) immune |= T_IS_FIRE | T_SPONTANEOUSLY_IGNITES | T_LAVA_INSTA_DEATH;
    const armor = player.equippedArmor;
    if (armor?.runicKnown && armor.runicType === 'respiration') immune |= T_RESPIRATION_IMMUNITIES;
    const forbidden = flags & ~immune;
    if (forbidden & (T_AUTO_DESCENT | T_LAVA_INSTA_DEATH | T_IS_DF_TRAP)) return false;
    if ((forbidden & T_IS_DEEP_WATER) && !(origin & T_IS_DEEP_WATER)) return false;
    if ((forbidden & T_SPONTANEOUSLY_IGNITES) && !(origin & (T_IS_FIRE | T_SPONTANEOUSLY_IGNITES))) return false;
    if ((forbidden & T_IS_FIRE) && !(origin & T_IS_FIRE)) return false;
    if ((forbidden & (T_HARMFUL_TERRAIN & ~T_IS_FIRE)) && !(origin & (T_HARMFUL_TERRAIN & ~T_IS_FIRE))) return false;
    return true;
}
