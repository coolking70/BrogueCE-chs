/** CE Globals.c tileCatalog displayChar/foreColor/backColor (base components).
 * Dynamic depth colors are interpolated in Appearance.ts; these are CE Start values.
 * Web-only aliases are listed by their CE tile identity. */
import { TerrainType } from '../Map/Grid';

export interface BaseTerrainAppearance { readonly char: string; readonly color: string; readonly bgColor: number | null; readonly transparentFore?: boolean; readonly foreDynamic?: string; readonly backDynamic?: string }
export const TERRAIN_APPEARANCES: Record<TerrainType, BaseTerrainAppearance> = {
    [TerrainType.DUNGEON_PORTAL]: { char: "Ω", color: '#666699', bgColor: 0x19193f }, // CE Globals.c:336

    [TerrainType.NOTHING]: { char: " ", color: '#000000', bgColor: 0x000000 }, // CE NOTHING
    [TerrainType.GRANITE]: { char: "#", color: '#726666', bgColor: 0x191919 , foreDynamic: 'wallBackColor' }, // CE GRANITE
    [TerrainType.FLOOR]: { char: "\u00b7", color: '#4c4c4c', bgColor: 0x050519 , backDynamic: 'floorBackColor' }, // CE FLOOR
    [TerrainType.WALL]: { char: "#", color: '#111111', bgColor: 0x726666 , backDynamic: 'wallBackColor' }, // CE WALL
    [TerrainType.DOOR]: { char: "+", color: '#b25926', bgColor: 0x4c190c }, // CE DOOR
    [TerrainType.OPEN_DOOR]: { char: "'", color: '#b25926', bgColor: 0x4c190c }, // CE OPEN_DOOR
    [TerrainType.WATER_SHALLOW]: { char: "", color: '#474799', bgColor: 0x333399 , backDynamic: 'shallowWaterBackColor' }, // CE SHALLOW_WATER
    [TerrainType.WATER_DEEP]: { char: "~", color: '#0c1433', bgColor: 0x0c194f , backDynamic: 'deepWaterBackColor' }, // CE DEEP_WATER
    [TerrainType.CHASM]: { char: "\u2237", color: '#111126', bgColor: 0x000000 }, // CE CHASM
    [TerrainType.LAVA]: { char: "~", color: '#b23300', bgColor: 0xb23300 }, // CE LAVA
    [TerrainType.GRASS]: { char: "\"", color: '#266626', bgColor: null }, // CE GRASS
    [TerrainType.FOLIAGE]: { char: "\u2648", color: '#3fff3f', bgColor: null }, // CE FOLIAGE
    [TerrainType.BOG]: { char: "~", color: '#2d230c', bgColor: 0x3a2b11 }, // CE MUD
    [TerrainType.STAIRS_UP]: { char: "<", color: '#fff200', bgColor: 0x26260c }, // CE UP_STAIRS
    [TerrainType.STAIRS_DOWN]: { char: ">", color: '#fff200', bgColor: 0x26260c }, // CE DOWN_STAIRS
    [TerrainType.CHARRED_FLOOR]: { char: "'", color: '#333333', bgColor: null }, // CE ASH
    [TerrainType.SIGN]: { char: "\u2237", color: '#330c0c', bgColor: null }, // CE MACHINE_GLYPH
    [TerrainType.RESET_PLATE]: { char: "\u25c7", color: '#4c4c4c', bgColor: 0x0c0c3f , backDynamic: 'chasmEdgeBackColor' }, // CE MACHINE_PRESSURE_PLATE_USED
    [TerrainType.TRAP]: { char: "\u25c7", color: '#bf3fd8', bgColor: null }, // CE GAS_TRAP_POISON
    [TerrainType.SECRET_DOOR]: { char: "#", color: '#111111', bgColor: 0x726666 , backDynamic: 'wallBackColor' }, // CE SECRET_DOOR
    [TerrainType.PRESSURE_PLATE]: { char: "\u25c7", color: '#ffffff', bgColor: 0x0c0c3f , backDynamic: 'chasmEdgeBackColor' }, // CE MACHINE_PRESSURE_PLATE
    [TerrainType.LOCKED_DOOR]: { char: "+", color: '#ffffff', bgColor: 0x26264c }, // CE LOCKED_DOOR
    [TerrainType.ALTAR]: { char: "|", color: '#0c1116', bgColor: 0x592d2d }, // CE ALTAR_INERT
    [TerrainType.WEB]: { char: ":", color: '#ffffff', bgColor: null }, // CE SPIDERWEB
    [TerrainType.BLOOD]: { char: "\u00b7", color: '#993319', bgColor: null }, // CE RED_BLOOD
    [TerrainType.MUD]: { char: "~", color: '#2d230c', bgColor: 0x3a2b11 }, // CE MUD
    [TerrainType.CHASM_EDGE]: { char: "\u00b7", color: '#ffffff', bgColor: 0x0c0c3f , backDynamic: 'chasmEdgeBackColor' }, // CE CHASM_EDGE
    [TerrainType.OBSIDIAN]: { char: "\u00b7", color: '#4c4c4c', bgColor: 0x0f0014 }, // CE OBSIDIAN
    [TerrainType.BRIDGE]: { char: "=", color: '#541e1e', bgColor: 0x1e0705 }, // CE BRIDGE
    [TerrainType.BRIDGE_EDGE]: { char: "=", color: '#541e1e', bgColor: 0x1e0705 }, // CE BRIDGE_EDGE
    [TerrainType.INERT_BRIMSTONE]: { char: "'", color: '#ff7f19', bgColor: 0x2d1e16 }, // CE INERT_BRIMSTONE
    [TerrainType.ITEM_FIRE]: { char: "\u22cf", color: '#ffffff', bgColor: null }, // CE ITEM_FIRE
    [TerrainType.PLAIN_FIRE]: { char: "\u22cf", color: '#b23300', bgColor: null }, // CE PLAIN_FIRE
    [TerrainType.EMBERS]: { char: "'", color: '#b23300', bgColor: null }, // CE EMBERS
    [TerrainType.ASH]: { char: "'", color: '#333333', bgColor: null }, // CE ASH
    [TerrainType.POISON_GAS]: { char: " ", color: '#000000', bgColor: 0xbf3fd8 , transparentFore: true }, // CE POISON_GAS
    [TerrainType.CONFUSION_GAS]: { char: " ", color: '#000000', bgColor: 0x999999 , transparentFore: true }, // CE CONFUSION_GAS
    [TerrainType.STEAM]: { char: " ", color: '#000000', bgColor: 0xffffff , transparentFore: true }, // CE STEAM
    [TerrainType.GAS_FIRE]: { char: "\u22cf", color: '#b23300', bgColor: null }, // CE GAS_FIRE
    [TerrainType.METHANE_GAS]: { char: " ", color: '#000000', bgColor: 0x729926 , transparentFore: true }, // CE METHANE_GAS
    [TerrainType.PARALYSIS_GAS]: { char: " ", color: '#000000', bgColor: 0xff99a8 , transparentFore: true }, // CE PARALYSIS_GAS
    [TerrainType.GAS_EXPLOSION]: { char: "\u22cf", color: '#ffff00', bgColor: null }, // CE GAS_EXPLOSION
    [TerrainType.HOLE]: { char: "\u2237", color: '#111126', bgColor: 0x000000 }, // CE HOLE
    [TerrainType.HOLE_EDGE]: { char: "\u00b7", color: '#ffffff', bgColor: 0x0c0c3f , backDynamic: 'chasmEdgeBackColor' }, // CE HOLE_EDGE
    [TerrainType.FORCEFIELD]: { char: "#", color: '#003f3f', bgColor: 0x003f3f }, // CE FORCEFIELD
    [TerrainType.FORCEFIELD_MELT]: { char: "#", color: '#000000', bgColor: 0x003f3f }, // CE FORCEFIELD_MELT
    [TerrainType.CRYSTAL_WALL]: { char: "#", color: '#666699', bgColor: 0x666699 }, // CE CRYSTAL_WALL
    [TerrainType.SACRED_GLYPH]: { char: "\u2237", color: '#0c330c', bgColor: null }, // CE SACRED_GLYPH
    [TerrainType.CARPET]: { char: "\u00b7", color: '#3a4c60', bgColor: 0x26140c }, // CE CARPET
    [TerrainType.STATUE_INERT]: { char: "\u00df", color: '#726666', bgColor: 0x333333 , foreDynamic: 'wallBackColor' }, // CE STATUE_INERT
    [TerrainType.PEDESTAL]: { char: "|", color: '#0c1116', bgColor: 0x190c33 }, // CE PEDESTAL
    [TerrainType.STATUE_INERT_DOORWAY]: { char: "\u00df", color: '#726666', bgColor: 0x333333 , foreDynamic: 'wallBackColor' }, // CE STATUE_INERT_DOORWAY
    [TerrainType.WOODEN_BARRICADE]: { char: "#", color: '#b25926', bgColor: 0x050519 , backDynamic: 'floorBackColor' }, // CE WOODEN_BARRICADE
    [TerrainType.TRAP_DOOR_HIDDEN]: { char: "\u00b7", color: '#4c4c4c', bgColor: 0x050519 , backDynamic: 'floorBackColor' }, // CE TRAP_DOOR_HIDDEN
    [TerrainType.MACHINE_GLYPH]: { char: "\u2237", color: '#330c0c', bgColor: null }, // CE MACHINE_GLYPH
    [TerrainType.PORTCULLIS_CLOSED]: { char: "#", color: '#7f7f7f', bgColor: 0x050519 , backDynamic: 'floorBackColor' }, // CE PORTCULLIS_CLOSED
    [TerrainType.WORM_TUNNEL_OUTER_WALL]: { char: "#", color: '#111111', bgColor: 0x726666 , backDynamic: 'wallBackColor' }, // CE WORM_TUNNEL_OUTER_WALL
    [TerrainType.WALL_LEVER_HIDDEN]: { char: "#", color: '#111111', bgColor: 0x726666 , backDynamic: 'wallBackColor' }, // CE WALL_LEVER_HIDDEN
    [TerrainType.GAS_TRAP_PARALYSIS]: { char: "\u25c7", color: '#ff99a8', bgColor: null }, // CE GAS_TRAP_PARALYSIS
    [TerrainType.GAS_TRAP_PARALYSIS_HIDDEN]: { char: "\u00b7", color: '#4c4c4c', bgColor: 0x050519 , backDynamic: 'floorBackColor' }, // CE GAS_TRAP_PARALYSIS_HIDDEN
    [TerrainType.MACHINE_PARALYSIS_VENT_HIDDEN]: { char: "\u00b7", color: '#4c4c4c', bgColor: 0x050519 , backDynamic: 'floorBackColor' }, // CE MACHINE_PARALYSIS_VENT_HIDDEN
    [TerrainType.MACHINE_METHANE_VENT_HIDDEN]: { char: "\u00b7", color: '#4c4c4c', bgColor: 0x050519 , backDynamic: 'floorBackColor' }, // CE MACHINE_METHANE_VENT_HIDDEN
    [TerrainType.PILOT_LIGHT_DORMANT]: { char: "#", color: '#bf6026', bgColor: 0x726666 , backDynamic: 'wallBackColor' }, // CE PILOT_LIGHT_DORMANT
    [TerrainType.ALTAR_CAGE_OPEN]: { char: "|", color: '#0c1116', bgColor: 0x592d2d }, // CE ALTAR_CAGE_OPEN
    [TerrainType.ALTAR_CAGE_RETRACTABLE]: { char: "#", color: '#592d2d', bgColor: 0x262626 }, // CE ALTAR_CAGE_RETRACTABLE
    [TerrainType.COMMUTATION_ALTAR]: { char: "|", color: '#0c1116', bgColor: 0x2d3f2d }, // CE COMMUTATION_ALTAR
    [TerrainType.RESURRECTION_ALTAR]: { char: "|", color: '#0c1116', bgColor: 0x3f3d1e }, // CE RESURRECTION_ALTAR
    [TerrainType.AMULET_SWITCH]: { char: "\u00b7", color: '#4c4c4c', bgColor: 0x050519 , backDynamic: 'floorBackColor' }, // CE AMULET_SWITCH
    [TerrainType.STATUE_INSTACRACK]: { char: "\u00df", color: '#726666', bgColor: 0x333333 , foreDynamic: 'wallBackColor' }, // CE STATUE_INSTACRACK
    [TerrainType.TORCH_WALL]: { char: "#", color: '#ffbf4c', bgColor: 0x726666 , backDynamic: 'wallBackColor' }, // CE TORCH_WALL
    [TerrainType.ALTAR_SWITCH]: { char: "|", color: '#0c1116', bgColor: 0x592d2d }, // CE ALTAR_SWITCH
    [TerrainType.MACHINE_TRIGGER_FLOOR]: { char: "\u00b7", color: '#4c4c4c', bgColor: 0x050519 , backDynamic: 'floorBackColor' }, // CE MACHINE_TRIGGER_FLOOR
    [TerrainType.STATUE_DORMANT]: { char: "\u00df", color: '#726666', bgColor: 0x333333 , foreDynamic: 'wallBackColor' }, // CE STATUE_DORMANT
    [TerrainType.WALL_MONSTER_DORMANT]: { char: "#", color: '#111111', bgColor: 0x726666 , backDynamic: 'wallBackColor' }, // CE WALL_MONSTER_DORMANT
    [TerrainType.RAT_TRAP_WALL_DORMANT]: { char: "#", color: '#111111', bgColor: 0x726666 , backDynamic: 'wallBackColor' }, // CE RAT_TRAP_WALL_DORMANT
    [TerrainType.STATUE_DORMANT_DOORWAY]: { char: "\u00df", color: '#726666', bgColor: 0x333333 , foreDynamic: 'wallBackColor' }, // CE STATUE_DORMANT_DOORWAY
    [TerrainType.TURRET_DORMANT]: { char: "#", color: '#111111', bgColor: 0x726666 , backDynamic: 'wallBackColor' }, // CE TURRET_DORMANT
    [TerrainType.MONSTER_CAGE_OPEN]: { char: "|", color: '#050519', bgColor: 0x262626 , foreDynamic: 'floorBackColor' }, // CE MONSTER_CAGE_OPEN
    [TerrainType.MONSTER_CAGE_CLOSED]: { char: "#", color: '#7f7f7f', bgColor: 0x4c4c4c }, // CE MONSTER_CAGE_CLOSED
    [TerrainType.MACHINE_POISON_GAS_VENT_HIDDEN]: { char: "\u00b7", color: '#4c4c4c', bgColor: 0x050519 , backDynamic: 'floorBackColor' }, // CE MACHINE_POISON_GAS_VENT_HIDDEN
    [TerrainType.PORTCULLIS_DORMANT]: { char: "\u00b7", color: '#4c4c4c', bgColor: 0x050519 , backDynamic: 'floorBackColor' }, // CE PORTCULLIS_DORMANT
    [TerrainType.WALL_LEVER_HIDDEN_DORMANT]: { char: "#", color: '#111111', bgColor: 0x726666 , backDynamic: 'wallBackColor' }, // CE WALL_LEVER_HIDDEN_DORMANT
    [TerrainType.BONES]: { char: ",", color: '#cccc4c', bgColor: null }, // CE BONES
    [TerrainType.COFFIN_CLOSED]: { char: "-", color: '#541e1e', bgColor: 0x1e0705 }, // CE COFFIN_CLOSED
    [TerrainType.ALTAR_KEYHOLE]: { char: "|", color: '#0c1116', bgColor: 0x592d2d }, // CE ALTAR_KEYHOLE
    [TerrainType.ALTAR_SWITCH_RETRACTING]: { char: "|", color: '#0c1116', bgColor: 0x592d2d }, // CE ALTAR_SWITCH_RETRACTING
    [TerrainType.BRAZIER]: { char: "\u22cf", color: '#b23300', bgColor: 0x333333 }, // CE BRAZIER
    [TerrainType.DEMONIC_STATUE]: { char: "\u00df", color: '#726666', bgColor: 0x333333 , foreDynamic: 'wallBackColor' }, // CE DEMONIC_STATUE
    [TerrainType.FLAMETHROWER_HIDDEN]: { char: "\u00b7", color: '#4c4c4c', bgColor: 0x050519 , backDynamic: 'floorBackColor' }, // CE FLAMETHROWER_HIDDEN
    [TerrainType.GAS_TRAP_POISON_HIDDEN]: { char: "\u00b7", color: '#4c4c4c', bgColor: 0x050519 , backDynamic: 'floorBackColor' }, // CE GAS_TRAP_POISON_HIDDEN
    [TerrainType.MANACLE_L]: { char: "-", color: '#7f7f7f', bgColor: null }, // CE MANACLE_L
    [TerrainType.MANACLE_T]: { char: "|", color: '#7f7f7f', bgColor: null }, // CE MANACLE_T
    [TerrainType.PORTAL]: { char: "\u03a9", color: '#726666', bgColor: 0x050519 , foreDynamic: 'wallBackColor', backDynamic: 'floorBackColor' }, // CE PORTAL
    [TerrainType.SACRIFICE_ALTAR_DORMANT]: { char: "|", color: '#0c1116', bgColor: 0x592d2d }, // CE SACRIFICE_ALTAR_DORMANT
    [TerrainType.SACRIFICE_CAGE_DORMANT]: { char: "#", color: '#592d2d', bgColor: 0x262626 }, // CE SACRIFICE_CAGE_DORMANT
    [TerrainType.DEAD_GRASS]: { char: "\"", color: '#332100', bgColor: null }, // CE DEAD_GRASS
    [TerrainType.VOMIT]: { char: "\u00b7", color: '#997f0c', bgColor: null }, // CE VOMIT
    [TerrainType.LUMINESCENT_FUNGUS]: { char: "\"", color: '#267f7f', bgColor: null }, // CE LUMINESCENT_FUNGUS
    [TerrainType.DEAD_FOLIAGE]: { char: "\u2648", color: '#332100', bgColor: null }, // CE DEAD_FOLIAGE
    [TerrainType.RUBBLE]: { char: ",", color: '#7f7f7f', bgColor: null }, // CE RUBBLE
    [TerrainType.GRAY_FUNGUS]: { char: "\"", color: '#4c4c4c', bgColor: null }, // CE GRAY_FUNGUS
    [TerrainType.WORM_TUNNEL_MARKER_DORMANT]: { char: "", color: '#000000', bgColor: null , transparentFore: true }, // CE WORM_TUNNEL_MARKER_DORMANT
    [TerrainType.BLOODFLOWER_STALK]: { char: "\u2648", color: '#4c0c66', bgColor: 0x260719 }, // CE BLOODFLOWER_STALK
    [TerrainType.HAVEN_BEDROLL]: { char: "=", color: '#000000', bgColor: 0x19140c }, // CE HAVEN_BEDROLL
    [TerrainType.FLOOR_FLOODABLE]: { char: "\u00b7", color: '#4c4c4c', bgColor: 0x050519 , backDynamic: 'floorBackColor' }, // CE FLOOR_FLOODABLE
    [TerrainType.MUD_FLOOR]: { char: "\u00b7", color: '#3a2b11', bgColor: 0x0f0c07 }, // CE MUD_FLOOR
    [TerrainType.ELECTRIC_CRYSTAL_OFF]: { char: "\u00a4", color: '#666699', bgColor: 0x191919 }, // CE ELECTRIC_CRYSTAL_OFF
    [TerrainType.DARK_FLOOR_DORMANT]: { char: "\u00b7", color: '#4c4c4c', bgColor: 0x050519 , backDynamic: 'floorBackColor' }, // CE DARK_FLOOR_DORMANT
    [TerrainType.MACHINE_FLOOD_WATER_DORMANT]: { char: "", color: '#474799', bgColor: 0x333399 , backDynamic: 'shallowWaterBackColor' }, // CE MACHINE_FLOOD_WATER_DORMANT
    [TerrainType.MACHINE_COLLAPSE_EDGE_DORMANT]: { char: "\u00b7", color: '#4c4c4c', bgColor: 0x050519 , backDynamic: 'floorBackColor' }, // CE MACHINE_COLLAPSE_EDGE_DORMANT
    [TerrainType.CHASM_WITH_HIDDEN_BRIDGE_ACTIVE]: { char: "\u00b7", color: '#ffffff', bgColor: 0x0c0c3f , backDynamic: 'chasmEdgeBackColor' }, // CE CHASM_WITH_HIDDEN_BRIDGE_ACTIVE
    [TerrainType.FLOOD_WATER_SHALLOW]: { char: "", color: '#474799', bgColor: 0x333399 , backDynamic: 'shallowWaterBackColor' }, // CE FLOOD_WATER_SHALLOW
    [TerrainType.MACHINE_CHASM_EDGE]: { char: "\u00b7", color: '#ffffff', bgColor: 0x0c0c3f , backDynamic: 'chasmEdgeBackColor' }, // CE MACHINE_CHASM_EDGE
    [TerrainType.MACHINE_MUD_DORMANT]: { char: "\u00b7", color: '#2d230c', bgColor: 0x3a2b11 }, // CE MACHINE_MUD_DORMANT
    [TerrainType.MACHINE_GLYPH_INACTIVE]: { char: "\u2237", color: '#330c0c', bgColor: null }, // CE MACHINE_GLYPH_INACTIVE
    [TerrainType.ANCIENT_SPIRIT_VINES]: { char: ":", color: '#7f0c3f', bgColor: null }, // CE ANCIENT_SPIRIT_VINES
    [TerrainType.CHASM_WITH_HIDDEN_BRIDGE]: { char: "\u2237", color: '#111126', bgColor: 0x000000 }, // CE CHASM_WITH_HIDDEN_BRIDGE
    [TerrainType.LAVA_RETRACTABLE]: { char: "~", color: '#b23300', bgColor: 0xb23300 }, // CE LAVA_RETRACTABLE
    [TerrainType.MUD_WALL]: { char: "#", color: '#8c7200', bgColor: 0x331e07 }, // CE MUD_WALL
    [TerrainType.MUD_DOORWAY]: { char: "\u03a9", color: '#8c7200', bgColor: 0x0f0c07 }, // CE MUD_DOORWAY
    [TerrainType.MARBLE_FLOOR]: { char: "\u00b7", color: '#4c3a60', bgColor: 0x0f0c21 }, // CE MARBLE_FLOOR
    [TerrainType.FLOOD_TRAP]: { char: "\u25c7", color: '#0000ff', bgColor: null }, // CE FLOOD_TRAP
    [TerrainType.TURRET_LEVER]: { char: "/", color: '#111111', bgColor: 0x726666 , backDynamic: 'wallBackColor' }, // CE TURRET_LEVER
    [TerrainType.HAUNTED_TORCH_DORMANT]: { char: "#", color: '#ffbf4c', bgColor: 0x726666 , backDynamic: 'wallBackColor' }, // CE HAUNTED_TORCH_DORMANT
    [TerrainType.MACHINE_FLOOD_WATER_SPREADING]: { char: "", color: '#474799', bgColor: 0x333399 , backDynamic: 'shallowWaterBackColor' }, // CE MACHINE_FLOOD_WATER_SPREADING
    [TerrainType.MACHINE_COLLAPSE_EDGE_SPREADING]: { char: "\u00b7", color: '#ffffff', bgColor: 0x0c0c3f , backDynamic: 'chasmEdgeBackColor' }, // CE MACHINE_COLLAPSE_EDGE_SPREADING
    [TerrainType.STONE_BRIDGE]: { char: "\u00b7", color: '#ffffff', bgColor: 0x0c0c3f , backDynamic: 'chasmEdgeBackColor' }, // CE STONE_BRIDGE
    [TerrainType.LAVA_RETRACTING]: { char: "~", color: '#b23300', bgColor: 0xb23300 }, // CE LAVA_RETRACTING
    [TerrainType.FLOOD_WATER_DEEP]: { char: "~", color: '#0c1433', bgColor: 0x0c194f , backDynamic: 'deepWaterBackColor' }, // CE FLOOD_WATER_DEEP
    [TerrainType.PUDDLE]: { char: "\u00b7", color: '#333399', bgColor: null , foreDynamic: 'shallowWaterBackColor' }, // CE PUDDLE
    [TerrainType.DARK_FLOOR_DARKENING]: { char: "\u00b7", color: '#4c4c4c', bgColor: 0x050519 , backDynamic: 'floorBackColor' }, // CE DARK_FLOOR_DARKENING
    [TerrainType.DARK_FLOOR]: { char: "\u00b7", color: '#4c4c4c', bgColor: 0x050519 , backDynamic: 'floorBackColor' }, // CE DARK_FLOOR
    [TerrainType.ECTOPLASM]: { char: "\u00b7", color: '#72338c', bgColor: null }, // CE ECTOPLASM
    [TerrainType.HAUNTED_TORCH_TRANSITIONING]: { char: "#", color: '#ffbf4c', bgColor: 0x726666 , backDynamic: 'wallBackColor' }, // CE HAUNTED_TORCH_TRANSITIONING
    [TerrainType.HAUNTED_TORCH]: { char: "#", color: '#bf3366', bgColor: 0x726666 , backDynamic: 'wallBackColor' }, // CE HAUNTED_TORCH
    [TerrainType.ELECTRIC_CRYSTAL_ON]: { char: "\u00a4", color: '#ffffff', bgColor: 0x666699 }, // CE ELECTRIC_CRYSTAL_ON
    [TerrainType.STENCH_SMOKE_GAS]: { char: " ", color: '#000000', bgColor: 0x997f0c , transparentFore: true }, // CE STENCH_SMOKE_GAS
    [TerrainType.ANCIENT_SPIRIT_GRASS]: { char: "\"", color: '#266626', bgColor: null }, // CE ANCIENT_SPIRIT_GRASS
    [TerrainType.TRAMPLED_FOLIAGE]: { char: "\"", color: '#3fff3f', bgColor: null }, // CE Globals.c:474
    [TerrainType.ACTIVE_BRIMSTONE]: { char: "'", color: '#ff7f19', bgColor: 0x2d1e16 }, // CE Globals.c:425
    [TerrainType.BRIMSTONE_FIRE]: { char: "\u22cf", color: '#b23300', bgColor: null }, // CE Globals.c:493
    [TerrainType.OPEN_IRON_DOOR_INERT]: { char: "'", color: '#ffffff', bgColor: 0x26264c }, // CE Globals.c:332
    [TerrainType.BRIDGE_FALLING]: { char: "=", color: '#541e1e', bgColor: 0x1e0705 }, // CE Globals.c:429
    [TerrainType.MACHINE_PRESSURE_PLATE_USED]: { char: "\u25c7", color: "#4c4c4c", bgColor: 789565, backDynamic: 'chasmEdgeBackColor' }, // CE :403
    [TerrainType.TRAP_DOOR]: { char: "\u2237", color: "#111126", bgColor: 0 }, // CE :380
    [TerrainType.WALL_LEVER]: { char: "/", color: "#111111", bgColor: 7365475, backDynamic: 'wallBackColor' }, // CE :348
    [TerrainType.WALL_LEVER_PULLED]: { char: "\\", color: "#111111", bgColor: 7365475, backDynamic: 'wallBackColor' }, // CE :349
    [TerrainType.MACHINE_TRIGGER_FLOOR_REPEATING]: { char: "", color: "#000000", bgColor: null, transparentFore: true }, // CE :540
    [TerrainType.MACHINE_METHANE_VENT_DORMANT]: { char: "=", color: '#4c4c4c', bgColor: null }, // CE :399
    [TerrainType.MACHINE_METHANE_VENT]: { char: "=", color: '#4c4c4c', bgColor: null }, // CE :400
    [TerrainType.PILOT_LIGHT]: { char: "\u22cf", color: '#b23300', bgColor: 7365475, backDynamic: 'wallBackColor' }, // CE :343
    [TerrainType.MACHINE_PARALYSIS_VENT]: { char: "=", color: '#ff99a8', bgColor: null }, // CE :384
    [TerrainType.MACHINE_POISON_GAS_VENT_DORMANT]: { char: "=", color: '#4c4c4c', bgColor: null }, // CE :396
    [TerrainType.MACHINE_POISON_GAS_VENT]: { char: "=", color: '#4c4c4c', bgColor: null }, // CE :397
    [TerrainType.GAS_TRAP_POISON]: { char: "\u25c7", color: '#bf3fd8', bgColor: null }, // CE :378
    [TerrainType.FLAMETHROWER]: { char: "\u25c7", color: '#ff0000', bgColor: null }, // CE :388
    [TerrainType.ALTAR_CAGE_CLOSED]: { char: "#", color: "#592d2d", bgColor: 2500134 }, // CE :365
    [TerrainType.COMMUTATION_ALTAR_INERT]: { char: "|", color: "#000000", bgColor: 2965293 }, // CE :533
    [TerrainType.PIPE_GLOWING]: { char: "+", color: "#262626", bgColor: null }, // CE :534
    [TerrainType.RESURRECTION_ALTAR_INERT]: { char: "|", color: "#000000", bgColor: 4144414 }, // CE :539
    [TerrainType.SACRIFICE_ALTAR]: { char: "|", color: "#0c1116", bgColor: 5844269 }, // CE :544
    [TerrainType.PIPE_INERT]: { char: "+", color: "#000000", bgColor: null }, // CE :535
    [TerrainType.SACRIFICE_LAVA]: { char: "~", color: "#b23300", bgColor: 11678464 }, // CE :545
};
