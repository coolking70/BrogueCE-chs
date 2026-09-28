/** Explicit CE identity exceptions. Missing entries are scope records, never
 * runtime fallbacks or instructions to add a generation root. X-4 A10 / R1.
 */
import { TerrainType } from './TerrainType';

export const CE_TERRAIN_ALIASES: Readonly<Record<string, TerrainType>> = {
    DOWN_STAIRS: TerrainType.STAIRS_DOWN,
    UP_STAIRS: TerrainType.STAIRS_UP,
    DUNGEON_EXIT: TerrainType.STAIRS_UP, // D1 exit behavior shares the up-stair carrier.
    ALTAR_INERT: TerrainType.ALTAR,
    MACHINE_PRESSURE_PLATE: TerrainType.PRESSURE_PLATE,
    DEEP_WATER: TerrainType.WATER_DEEP,
    SHALLOW_WATER: TerrainType.WATER_SHALLOW,
    RED_BLOOD: TerrainType.BLOOD,
    SPIDERWEB: TerrainType.WEB,
};

export const CE_TERRAIN_GAPS: Readonly<Record<string, string>> = {
    ICE_DEEP: 'inactive-freeze-root', ICE_DEEP_MELT: 'inactive-freeze-root',
    ICE_SHALLOW: 'inactive-freeze-root', ICE_SHALLOW_MELT: 'inactive-freeze-root',
    HOLE_GLOW: 'legacy-staff-hole',
    MANACLE_TL: 'unused-decoration', MANACLE_BR: 'unused-decoration',
    MANACLE_TR: 'unused-decoration', MANACLE_BL: 'unused-decoration',
    MANACLE_B: 'unused-decoration', MANACLE_R: 'unused-decoration',
};

export const CE_DF_GAPS: Readonly<Record<string, string>> = {
    DF_BLOAT_DEATH: 'existing-specialized-effect',
    DF_POISON_GAS_CLOUD_POTION: 'existing-specialized-effect',
    DF_PARALYSIS_GAS_CLOUD_POTION: 'existing-specialized-effect',
    DF_CONFUSION_GAS_CLOUD_POTION: 'existing-specialized-effect',
    DF_INCINERATION_POTION: 'existing-specialized-effect',
    DF_DEEP_WATER_FREEZE: 'inactive-freeze-root',
    DF_ALGAE_1_FREEZE: 'inactive-freeze-root', DF_ALGAE_2_FREEZE: 'inactive-freeze-root',
    DF_DEEP_WATER_MELTING: 'inactive-freeze-root', DF_DEEP_WATER_THAW: 'inactive-freeze-root',
    DF_SHALLOW_WATER_FREEZE: 'inactive-freeze-root',
    DF_SHALLOW_WATER_MELTING: 'inactive-freeze-root', DF_SHALLOW_WATER_THAW: 'inactive-freeze-root',
    DF_GRANITE_COLUMN: 'dead-autogenerator-index-zero',
    DF_METHANE_GAS_ARMAGEDDON: 'commented-debug-only',
    DF_STAFF_HOLE: 'legacy-staff-hole', DF_STAFF_HOLE_EDGE: 'legacy-staff-hole',
    DF_MEDIUM_LAVA_POND: 'no-active-root', DF_WALL_OPEN: 'no-active-root',
};

export const CE_MACHINE_GAPS: Readonly<Record<string, string>> = {
    MT_KEY_SUMMONING_CIRCLE_ROOM: 'CE48-disabled-in-Brogue',
    MT_REWARD_HEAVY_OR_RUNIC_WEAPON: 'CE72-Bullet-only',
};

export function terrainForCE(name: string): TerrainType | undefined {
    const own = TerrainType[name as keyof typeof TerrainType];
    return typeof own === 'number' ? own : CE_TERRAIN_ALIASES[name];
}
