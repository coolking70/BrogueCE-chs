/** X4-R5: CE Globals.c tileCatalog description/flavorText, including CE-only tiles.
 * Text lookups are pure: the caller supplies knowledge and optionally a locale.
 * No FOV queries, discovery, promotion, logging, or RNG happen here.
 */
import zhContent from '../../locales/zh_CN.content.json';
import { highestPriorityLayerOf, TerrainType } from '../Map/Grid';

export interface TerrainText {
    readonly description: string;
    readonly flavor: string;
}

/** All 215 CE identities; 188 nonempty flavors. Empty CE flavors stay empty.
 * WORM_TUNNEL_MARKER_DORMANT is an invisible marker with an empty CE description;
 * its localized display name is neutral ground, never a disclosure of the worm.
 */
export const CE_TERRAIN_TEXT: Readonly<Record<keyof typeof zhContent.terrain, TerrainText>> = zhContent.terrain;
export type CETerrainTextId = keyof typeof CE_TERRAIN_TEXT;
export type TerrainTextId = CETerrainTextId | keyof typeof zhContent.webTerrain;

/** Exhaustive web -> CE mapping. BOG is the legacy MUD alias. The four retired
 * web-only identities (CHARRED_FLOOR/SIGN/RESET_PLATE/TRAP) keep explicit text.
 * D1's STAIRS_UP needs atDungeonExit to distinguish CE DUNGEON_EXIT.
 */
export const TERRAIN_TEXT_IDS: Readonly<Record<TerrainType, TerrainTextId>> = {
    [TerrainType.NOTHING]: 'NOTHING',
    [TerrainType.GRANITE]: 'GRANITE',
    [TerrainType.FLOOR]: 'FLOOR',
    [TerrainType.WALL]: 'WALL',
    [TerrainType.DOOR]: 'DOOR',
    [TerrainType.OPEN_DOOR]: 'OPEN_DOOR',
    [TerrainType.WATER_SHALLOW]: 'SHALLOW_WATER',
    [TerrainType.WATER_DEEP]: 'DEEP_WATER',
    [TerrainType.CHASM]: 'CHASM',
    [TerrainType.LAVA]: 'LAVA',
    [TerrainType.GRASS]: 'GRASS',
    [TerrainType.FOLIAGE]: 'FOLIAGE',
    [TerrainType.BOG]: 'MUD',
    [TerrainType.STAIRS_UP]: 'UP_STAIRS',
    [TerrainType.STAIRS_DOWN]: 'DOWN_STAIRS',
    [TerrainType.CHARRED_FLOOR]: 'CHARRED_FLOOR',
    [TerrainType.SIGN]: 'SIGN',
    [TerrainType.RESET_PLATE]: 'RESET_PLATE',
    [TerrainType.TRAP]: 'TRAP',
    [TerrainType.SECRET_DOOR]: 'SECRET_DOOR',
    [TerrainType.PRESSURE_PLATE]: 'MACHINE_PRESSURE_PLATE',
    [TerrainType.LOCKED_DOOR]: 'LOCKED_DOOR',
    [TerrainType.ALTAR]: 'ALTAR_INERT',
    [TerrainType.WEB]: 'SPIDERWEB',
    [TerrainType.BLOOD]: 'RED_BLOOD',
    [TerrainType.MUD]: 'MUD',
    [TerrainType.CHASM_EDGE]: 'CHASM_EDGE',
    [TerrainType.OBSIDIAN]: 'OBSIDIAN',
    [TerrainType.BRIDGE]: 'BRIDGE',
    [TerrainType.BRIDGE_EDGE]: 'BRIDGE_EDGE',
    [TerrainType.INERT_BRIMSTONE]: 'INERT_BRIMSTONE',
    [TerrainType.PLAIN_FIRE]: 'PLAIN_FIRE',
    [TerrainType.EMBERS]: 'EMBERS',
    [TerrainType.ASH]: 'ASH',
    [TerrainType.POISON_GAS]: 'POISON_GAS',
    [TerrainType.CONFUSION_GAS]: 'CONFUSION_GAS',
    [TerrainType.STEAM]: 'STEAM',
    [TerrainType.GAS_FIRE]: 'GAS_FIRE',
    [TerrainType.METHANE_GAS]: 'METHANE_GAS',
    [TerrainType.PARALYSIS_GAS]: 'PARALYSIS_GAS',
    [TerrainType.GAS_EXPLOSION]: 'GAS_EXPLOSION',
    [TerrainType.HOLE]: 'HOLE',
    [TerrainType.HOLE_EDGE]: 'HOLE_EDGE',
    [TerrainType.FORCEFIELD]: 'FORCEFIELD',
    [TerrainType.FORCEFIELD_MELT]: 'FORCEFIELD_MELT',
    [TerrainType.CRYSTAL_WALL]: 'CRYSTAL_WALL',
    [TerrainType.SACRED_GLYPH]: 'SACRED_GLYPH',
    [TerrainType.CARPET]: 'CARPET',
    [TerrainType.STATUE_INERT]: 'STATUE_INERT',
    [TerrainType.PEDESTAL]: 'PEDESTAL',
    [TerrainType.STATUE_INERT_DOORWAY]: 'STATUE_INERT_DOORWAY',
    [TerrainType.WOODEN_BARRICADE]: 'WOODEN_BARRICADE',
    [TerrainType.TRAP_DOOR_HIDDEN]: 'TRAP_DOOR_HIDDEN',
    [TerrainType.MACHINE_GLYPH]: 'MACHINE_GLYPH',
    [TerrainType.PORTCULLIS_CLOSED]: 'PORTCULLIS_CLOSED',
    [TerrainType.WORM_TUNNEL_OUTER_WALL]: 'WORM_TUNNEL_OUTER_WALL',
    [TerrainType.WALL_LEVER_HIDDEN]: 'WALL_LEVER_HIDDEN',
    [TerrainType.GAS_TRAP_PARALYSIS]: 'GAS_TRAP_PARALYSIS',
    [TerrainType.GAS_TRAP_PARALYSIS_HIDDEN]: 'GAS_TRAP_PARALYSIS_HIDDEN',
    [TerrainType.MACHINE_PARALYSIS_VENT_HIDDEN]: 'MACHINE_PARALYSIS_VENT_HIDDEN',
    [TerrainType.MACHINE_METHANE_VENT_HIDDEN]: 'MACHINE_METHANE_VENT_HIDDEN',
    [TerrainType.PILOT_LIGHT_DORMANT]: 'PILOT_LIGHT_DORMANT',
    [TerrainType.ALTAR_CAGE_OPEN]: 'ALTAR_CAGE_OPEN',
    [TerrainType.ALTAR_CAGE_RETRACTABLE]: 'ALTAR_CAGE_RETRACTABLE',
    [TerrainType.COMMUTATION_ALTAR]: 'COMMUTATION_ALTAR',
    [TerrainType.RESURRECTION_ALTAR]: 'RESURRECTION_ALTAR',
    [TerrainType.AMULET_SWITCH]: 'AMULET_SWITCH',
    [TerrainType.STATUE_INSTACRACK]: 'STATUE_INSTACRACK',
    [TerrainType.TORCH_WALL]: 'TORCH_WALL',
    [TerrainType.ALTAR_SWITCH]: 'ALTAR_SWITCH',
    [TerrainType.MACHINE_TRIGGER_FLOOR]: 'MACHINE_TRIGGER_FLOOR',
    [TerrainType.STATUE_DORMANT]: 'STATUE_DORMANT',
    [TerrainType.WALL_MONSTER_DORMANT]: 'WALL_MONSTER_DORMANT',
    [TerrainType.RAT_TRAP_WALL_DORMANT]: 'RAT_TRAP_WALL_DORMANT',
    [TerrainType.STATUE_DORMANT_DOORWAY]: 'STATUE_DORMANT_DOORWAY',
    [TerrainType.TURRET_DORMANT]: 'TURRET_DORMANT',
    [TerrainType.MONSTER_CAGE_OPEN]: 'MONSTER_CAGE_OPEN',
    [TerrainType.MONSTER_CAGE_CLOSED]: 'MONSTER_CAGE_CLOSED',
    [TerrainType.MACHINE_POISON_GAS_VENT_HIDDEN]: 'MACHINE_POISON_GAS_VENT_HIDDEN',
    [TerrainType.PORTCULLIS_DORMANT]: 'PORTCULLIS_DORMANT',
    [TerrainType.WALL_LEVER_HIDDEN_DORMANT]: 'WALL_LEVER_HIDDEN_DORMANT',
    [TerrainType.BONES]: 'BONES',
    [TerrainType.COFFIN_CLOSED]: 'COFFIN_CLOSED',
    [TerrainType.ALTAR_KEYHOLE]: 'ALTAR_KEYHOLE',
    [TerrainType.ALTAR_SWITCH_RETRACTING]: 'ALTAR_SWITCH_RETRACTING',
    [TerrainType.BRAZIER]: 'BRAZIER',
    [TerrainType.DEMONIC_STATUE]: 'DEMONIC_STATUE',
    [TerrainType.FLAMETHROWER_HIDDEN]: 'FLAMETHROWER_HIDDEN',
    [TerrainType.GAS_TRAP_POISON_HIDDEN]: 'GAS_TRAP_POISON_HIDDEN',
    [TerrainType.MANACLE_L]: 'MANACLE_L',
    [TerrainType.MANACLE_T]: 'MANACLE_T',
    [TerrainType.PORTAL]: 'PORTAL',
    [TerrainType.SACRIFICE_ALTAR_DORMANT]: 'SACRIFICE_ALTAR_DORMANT',
    [TerrainType.SACRIFICE_CAGE_DORMANT]: 'SACRIFICE_CAGE_DORMANT',
    [TerrainType.DEAD_GRASS]: 'DEAD_GRASS',
    [TerrainType.VOMIT]: 'VOMIT',
    [TerrainType.LUMINESCENT_FUNGUS]: 'LUMINESCENT_FUNGUS',
    [TerrainType.DEAD_FOLIAGE]: 'DEAD_FOLIAGE',
    [TerrainType.RUBBLE]: 'RUBBLE',
    [TerrainType.GRAY_FUNGUS]: 'GRAY_FUNGUS',
    [TerrainType.WORM_TUNNEL_MARKER_DORMANT]: 'WORM_TUNNEL_MARKER_DORMANT',
    [TerrainType.BLOODFLOWER_STALK]: 'BLOODFLOWER_STALK',
    [TerrainType.HAVEN_BEDROLL]: 'HAVEN_BEDROLL',
    [TerrainType.FLOOR_FLOODABLE]: 'FLOOR_FLOODABLE',
    [TerrainType.CHASM_WITH_HIDDEN_BRIDGE]: 'CHASM_WITH_HIDDEN_BRIDGE',
    [TerrainType.LAVA_RETRACTABLE]: 'LAVA_RETRACTABLE',
    [TerrainType.MUD_FLOOR]: 'MUD_FLOOR',
    [TerrainType.MUD_WALL]: 'MUD_WALL',
    [TerrainType.MUD_DOORWAY]: 'MUD_DOORWAY',
    [TerrainType.MARBLE_FLOOR]: 'MARBLE_FLOOR',
    [TerrainType.FLOOD_TRAP]: 'FLOOD_TRAP',
    [TerrainType.ELECTRIC_CRYSTAL_OFF]: 'ELECTRIC_CRYSTAL_OFF',
    [TerrainType.TURRET_LEVER]: 'TURRET_LEVER',
    [TerrainType.HAUNTED_TORCH_DORMANT]: 'HAUNTED_TORCH_DORMANT',
    [TerrainType.DARK_FLOOR_DORMANT]: 'DARK_FLOOR_DORMANT',
    [TerrainType.MACHINE_FLOOD_WATER_DORMANT]: 'MACHINE_FLOOD_WATER_DORMANT',
    [TerrainType.MACHINE_FLOOD_WATER_SPREADING]: 'MACHINE_FLOOD_WATER_SPREADING',
    [TerrainType.MACHINE_COLLAPSE_EDGE_DORMANT]: 'MACHINE_COLLAPSE_EDGE_DORMANT',
    [TerrainType.MACHINE_COLLAPSE_EDGE_SPREADING]: 'MACHINE_COLLAPSE_EDGE_SPREADING',
    [TerrainType.CHASM_WITH_HIDDEN_BRIDGE_ACTIVE]: 'CHASM_WITH_HIDDEN_BRIDGE_ACTIVE',
    [TerrainType.STONE_BRIDGE]: 'STONE_BRIDGE',
    [TerrainType.LAVA_RETRACTING]: 'LAVA_RETRACTING',
    [TerrainType.FLOOD_WATER_SHALLOW]: 'FLOOD_WATER_SHALLOW',
    [TerrainType.FLOOD_WATER_DEEP]: 'FLOOD_WATER_DEEP',
    [TerrainType.MACHINE_CHASM_EDGE]: 'MACHINE_CHASM_EDGE',
    [TerrainType.PUDDLE]: 'PUDDLE',
    [TerrainType.MACHINE_MUD_DORMANT]: 'MACHINE_MUD_DORMANT',
    [TerrainType.DARK_FLOOR_DARKENING]: 'DARK_FLOOR_DARKENING',
    [TerrainType.DARK_FLOOR]: 'DARK_FLOOR',
    [TerrainType.ECTOPLASM]: 'ECTOPLASM',
    [TerrainType.HAUNTED_TORCH_TRANSITIONING]: 'HAUNTED_TORCH_TRANSITIONING',
    [TerrainType.HAUNTED_TORCH]: 'HAUNTED_TORCH',
    [TerrainType.ELECTRIC_CRYSTAL_ON]: 'ELECTRIC_CRYSTAL_ON',
    [TerrainType.MACHINE_GLYPH_INACTIVE]: 'MACHINE_GLYPH_INACTIVE',
    [TerrainType.STENCH_SMOKE_GAS]: 'STENCH_SMOKE_GAS',
    [TerrainType.ANCIENT_SPIRIT_VINES]: 'ANCIENT_SPIRIT_VINES',
    [TerrainType.ANCIENT_SPIRIT_GRASS]: 'ANCIENT_SPIRIT_GRASS',
    [TerrainType.DUNGEON_PORTAL]: 'DUNGEON_PORTAL',
    [TerrainType.ITEM_FIRE]: 'ITEM_FIRE',
    [TerrainType.TRAMPLED_FOLIAGE]: 'TRAMPLED_FOLIAGE',
    [TerrainType.ACTIVE_BRIMSTONE]: 'ACTIVE_BRIMSTONE',
    [TerrainType.BRIMSTONE_FIRE]: 'BRIMSTONE_FIRE',
    [TerrainType.OPEN_IRON_DOOR_INERT]: 'OPEN_IRON_DOOR_INERT',
    [TerrainType.BRIDGE_FALLING]: 'BRIDGE_FALLING',
    [TerrainType.MACHINE_PRESSURE_PLATE_USED]: 'MACHINE_PRESSURE_PLATE_USED',
    [TerrainType.TRAP_DOOR]: 'TRAP_DOOR',
    [TerrainType.WALL_LEVER]: 'WALL_LEVER',
    [TerrainType.WALL_LEVER_PULLED]: 'WALL_LEVER_PULLED',
    [TerrainType.MACHINE_TRIGGER_FLOOR_REPEATING]: 'MACHINE_TRIGGER_FLOOR_REPEATING',
    [TerrainType.MACHINE_METHANE_VENT_DORMANT]: 'MACHINE_METHANE_VENT_DORMANT',
    [TerrainType.MACHINE_METHANE_VENT]: 'MACHINE_METHANE_VENT',
    [TerrainType.PILOT_LIGHT]: 'PILOT_LIGHT',
    [TerrainType.MACHINE_PARALYSIS_VENT]: 'MACHINE_PARALYSIS_VENT',
    [TerrainType.MACHINE_POISON_GAS_VENT_DORMANT]: 'MACHINE_POISON_GAS_VENT_DORMANT',
    [TerrainType.MACHINE_POISON_GAS_VENT]: 'MACHINE_POISON_GAS_VENT',
    [TerrainType.GAS_TRAP_POISON]: 'GAS_TRAP_POISON',
    [TerrainType.FLAMETHROWER]: 'FLAMETHROWER',
    [TerrainType.ALTAR_CAGE_CLOSED]: 'ALTAR_CAGE_CLOSED',
    [TerrainType.COMMUTATION_ALTAR_INERT]: 'COMMUTATION_ALTAR_INERT',
    [TerrainType.PIPE_GLOWING]: 'PIPE_GLOWING',
    [TerrainType.RESURRECTION_ALTAR_INERT]: 'RESURRECTION_ALTAR_INERT',
    [TerrainType.SACRIFICE_ALTAR]: 'SACRIFICE_ALTAR',
    [TerrainType.PIPE_INERT]: 'PIPE_INERT',
    [TerrainType.SACRIFICE_LAVA]: 'SACRIFICE_LAVA',
    [TerrainType.RAT_TRAP_WALL_CRACKING]: 'RAT_TRAP_WALL_CRACKING',
    [TerrainType.STATUE_CRACKING]: 'STATUE_CRACKING',
    [TerrainType.COFFIN_OPEN]: 'COFFIN_OPEN',
    [TerrainType.WORM_TUNNEL_MARKER_ACTIVE]: 'WORM_TUNNEL_MARKER_ACTIVE',
    [TerrainType.PORTAL_LIGHT]: 'PORTAL_LIGHT',
    [TerrainType.FUNGUS_FOREST]: 'FUNGUS_FOREST',
    [TerrainType.TRAMPLED_FUNGUS_FOREST]: 'TRAMPLED_FUNGUS_FOREST',
    [TerrainType.SUNLIGHT_POOL]: 'SUNLIGHT_POOL',
    [TerrainType.DARKNESS_PATCH]: 'DARKNESS_PATCH',
    [TerrainType.DEEP_WATER_ALGAE_WELL]: 'DEEP_WATER_ALGAE_WELL',
    [TerrainType.DEEP_WATER_ALGAE_1]: 'DEEP_WATER_ALGAE_1',
    [TerrainType.DEEP_WATER_ALGAE_2]: 'DEEP_WATER_ALGAE_2',
    [TerrainType.NET_TRAP]: 'NET_TRAP',
    [TerrainType.NET_TRAP_HIDDEN]: 'NET_TRAP_HIDDEN',
    [TerrainType.NETTING]: 'NETTING',
    [TerrainType.ALARM_TRAP]: 'ALARM_TRAP',
    [TerrainType.ALARM_TRAP_HIDDEN]: 'ALARM_TRAP_HIDDEN',
    [TerrainType.GAS_TRAP_CONFUSION]: 'GAS_TRAP_CONFUSION',
    [TerrainType.GAS_TRAP_CONFUSION_HIDDEN]: 'GAS_TRAP_CONFUSION_HIDDEN',
    [TerrainType.FLOOD_TRAP_HIDDEN]: 'FLOOD_TRAP_HIDDEN',
    [TerrainType.STEAM_VENT]: 'STEAM_VENT',
    [TerrainType.DEWAR_CAUSTIC_GAS]: 'DEWAR_CAUSTIC_GAS',
    [TerrainType.DEWAR_CONFUSION_GAS]: 'DEWAR_CONFUSION_GAS',
    [TerrainType.DEWAR_PARALYSIS_GAS]: 'DEWAR_PARALYSIS_GAS',
    [TerrainType.DEWAR_METHANE_GAS]: 'DEWAR_METHANE_GAS',
    [TerrainType.BROKEN_GLASS]: 'BROKEN_GLASS',
    [TerrainType.LICHEN]: 'LICHEN',
    [TerrainType.DARKNESS_CLOUD]: 'DARKNESS_CLOUD',
    [TerrainType.ROT_GAS]: 'ROT_GAS',
    [TerrainType.BLOODFLOWER_POD]: 'BLOODFLOWER_POD',
    [TerrainType.HEALING_CLOUD]: 'HEALING_CLOUD',
    [TerrainType.HAY]: 'HAY',
    [TerrainType.URINE]: 'URINE',
    [TerrainType.JUNK]: 'JUNK',
    [TerrainType.BURNED_CARPET]: 'BURNED_CARPET',
    [TerrainType.GREEN_BLOOD]: 'GREEN_BLOOD',
    [TerrainType.PURPLE_BLOOD]: 'PURPLE_BLOOD',
    [TerrainType.ACID_SPLATTER]: 'ACID_SPLATTER',
    [TerrainType.WORM_BLOOD]: 'WORM_BLOOD',
    [TerrainType.UNICORN_POOP]: 'UNICORN_POOP',
    [TerrainType.GUARDIAN_GLOW]: 'GUARDIAN_GLOW',
    [TerrainType.FLAMEDANCER_FIRE]: 'FLAMEDANCER_FIRE',
    [TerrainType.DART_EXPLOSION]: 'DART_EXPLOSION',
    [TerrainType.CREATURE_FIRE]: 'CREATURE_FIRE',
};

/** CE discoverType -> dungeonFeatureCatalog.tile; a display-only projection.
 * Ordinarily discovery already replaces the tile. The explicit flag supports
 * callers holding a pre-discovery identity; do not borrow a live cell's flag
 * for a remembered snapshot. Dormant machines are NOT secret discoveries.
 */
export const REVEALED_TERRAIN: Readonly<Partial<Record<TerrainType, TerrainType>>> = {
    [TerrainType.SECRET_DOOR]: TerrainType.DOOR,
    [TerrainType.WALL_LEVER_HIDDEN]: TerrainType.WALL_LEVER,
    [TerrainType.GAS_TRAP_POISON_HIDDEN]: TerrainType.GAS_TRAP_POISON,
    [TerrainType.TRAP_DOOR_HIDDEN]: TerrainType.TRAP_DOOR,
    [TerrainType.GAS_TRAP_PARALYSIS_HIDDEN]: TerrainType.GAS_TRAP_PARALYSIS,
    [TerrainType.MACHINE_PARALYSIS_VENT_HIDDEN]: TerrainType.MACHINE_PARALYSIS_VENT,
    [TerrainType.GAS_TRAP_CONFUSION_HIDDEN]: TerrainType.GAS_TRAP_CONFUSION,
    [TerrainType.FLAMETHROWER_HIDDEN]: TerrainType.FLAMETHROWER,
    [TerrainType.FLOOD_TRAP_HIDDEN]: TerrainType.FLOOD_TRAP,
    [TerrainType.NET_TRAP_HIDDEN]: TerrainType.NET_TRAP,
    [TerrainType.ALARM_TRAP_HIDDEN]: TerrainType.ALARM_TRAP,
    [TerrainType.MACHINE_POISON_GAS_VENT_HIDDEN]: TerrainType.MACHINE_POISON_GAS_VENT_DORMANT,
    [TerrainType.MACHINE_METHANE_VENT_HIDDEN]: TerrainType.MACHINE_METHANE_VENT_DORMANT,
};

export interface TerrainTextOptions {
    readonly secretsRevealed?: boolean;
    readonly atDungeonExit?: boolean;
}

export function terrainTextId(terrain: TerrainType, options: TerrainTextOptions = {}): TerrainTextId {
    const known = options.secretsRevealed ? REVEALED_TERRAIN[terrain] ?? terrain : terrain;
    return known === TerrainType.STAIRS_UP && options.atDungeonExit
        ? 'DUNGEON_EXIT' : TERRAIN_TEXT_IDS[known];
}

export function getTerrainTextById(id: TerrainTextId, locale = zhContent): TerrainText {
    return id in locale.terrain
        ? locale.terrain[id as CETerrainTextId]
        : locale.webTerrain[id as keyof typeof locale.webTerrain];
}

export function getTerrainDescription(terrain: TerrainType, options: TerrainTextOptions = {}, locale = zhContent): string {
    return getTerrainTextById(terrainTextId(terrain, options), locale).description;
}

/** CE Movement.c:64-80: strict priority, DUNGEON/LIQUID/GAS/SURFACE tie order,
 * ignores NOTHING, all empty -> NOTHING. Reuse the existing CE priority selector.
 */
export function selectTerrainTextLayer(layers: readonly TerrainType[]): TerrainType {
    return layers[highestPriorityLayerOf(layers)] ?? TerrainType.NOTHING;
}

/** Exact CE tileFlavor for an observed/current stack (Movement.c:105-108).
 * No downward search for nonempty prose. In particular TRAP_DOOR_HIDDEN's
 * falling message is retained for the standing/contact caller, as in CE.
 * Hover/memory callers must use describeTerrain instead, which conceals it.
 */
export function tileFlavor(layers: readonly TerrainType[], options: TerrainTextOptions = {}, locale = zhContent): string {
    return getTerrainTextById(terrainTextId(selectTerrainTextLayer(layers), options), locale).flavor;
}

/** Each snapshot owns its knowledge. Supplying a visible snapshot is an explicit
 * caller assertion that it can be observed; omitted visible uses memory only.
 * Legacy memories may provide only terrain. No snapshot means unknown (null).
 */
export interface TerrainTextSnapshot extends TerrainTextOptions {
    readonly layers?: readonly TerrainType[];
    readonly terrain?: TerrainType;
}

export interface TerrainTextView {
    readonly visible?: TerrainTextSnapshot;
    readonly remembered?: TerrainTextSnapshot;
}

export function selectKnownTerrain(view: TerrainTextView): TerrainTextId | null {
    const snapshot = view.visible ?? view.remembered;
    if (!snapshot) return null;
    const terrain = snapshot.layers?.length
        ? selectTerrainTextLayer(snapshot.layers) : snapshot.terrain;
    return terrain === undefined ? null : terrainTextId(terrain, snapshot);
}

/** Safe display entry for hover/remembered locations. The hidden trapdoor's CE
 * flavor describes falling through it, so keep that contact-only prose out of
 * an undiscovered location inspection. Its description is already CE ground.
 */
export function describeTerrain(view: TerrainTextView, locale = zhContent): TerrainText | null {
    const id = selectKnownTerrain(view);
    if (id === null) return null;
    const text = getTerrainTextById(id, locale);
    return id === 'TRAP_DOOR_HIDDEN' ? { description: text.description, flavor: '' } : text;
}
