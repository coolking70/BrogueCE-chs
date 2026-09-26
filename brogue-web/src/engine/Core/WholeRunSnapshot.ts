/** Pure whole-run projection and world reconstruction. The live Game supplies
 * only the state and services consumed here; neither function receives Game. */
import { Item } from '../Items/Item';
import type { ItemLoader } from '../Items/ItemLoader';
import { Player } from '../../entities/Player';
import { Monster } from '../../entities/Monster';
import { DCOLS, DROWS } from '../Map/Grid';
import { ScentMap } from '../Map/Scent';
import { WaypointSystem } from '../Map/WaypointMap';
import { EnvironmentManager } from '../Environment/Gas';
import { FOVSys } from '../Lighting/FOV';
import { LightMap } from '../Lighting/LightMap';
import { collectMachineCells, machineCellsMatchGrid } from '../Map/MachineCells';
import { CE_DEEPEST_LEVEL } from '../Map/LakeSystem';
import { snapshotGrid, restoreGrid } from './LevelSnapshot';
import { copyFields, PLAYER_FIELDS, collectEntityGraph, restoreEntityGraph,
    serializeItem, serializeMonsterRow } from './EntitySnapshot';
import type { EntityCodecDeps } from './EntitySnapshot';
import { copyLevelSeeds, isLevelSeeds, type LevelSeed } from './LevelSeeds';
import { Random } from '../Random';
import { isSeed } from '../Seed';
import type { Game, GameRunSnapshot, LevelState, GameMode } from './Game';
import type { CellSnapshot } from './LevelSnapshot';
import type { GameSnapshotItem, GameSnapshotMonster, GameSnapshotPlayer, EntitySnapshotGraph } from './EntitySnapshot';
import type { RandomState } from '../Random';
import type { Pos } from '../../types';

export const WHOLE_RUN_SCHEMA = 'brogue-web-whole-run-v2' as const;

/** The run section is detached with the same JSON boundary as the original
 * Game method, including omission of undefined values. */
export function projectRunState<T>(state: T): T {
    return JSON.parse(JSON.stringify(state)) as T;
}

export interface LevelSnapshot {
    depth: number;
    width: number;
    height: number;
    grid: CellSnapshot[];
    impregnableCells?: number[];
    monsters: GameSnapshotMonster[];
    dormantMonsters: GameSnapshotMonster[];
    items: GameSnapshotItem[];
    scent: ReturnType<ScentMap['getState']>;
    waypoints: ReturnType<WaypointSystem['getState']>;
    environmentState: ReturnType<EnvironmentManager['getState']>;
    pendingCaughtFireCells: Pos[];
    trapDepressions: number[];
    machineCells: number[];
    visibleMonsterIds: number[];
    visibleItemIds: number[];
    /** CE absoluteTurnNumber at departure. */
    awaySince: number;
    playerExitedVia: Pos;
}

export interface GameSnapshot extends LevelSnapshot {
    /** U01 entity envelope version; schema discriminates whole-run saves. */
    version: number;
    schema: typeof WHOLE_RUN_SCHEMA;
    savedAt: number;
    seed: string;
    rngState: RandomState;
    levelSeeds: LevelSeed[];
    currentLevelDepth: number;
    /** Detached cached levels only. The active level is the top-level payload. */
    levels: LevelSnapshot[];
    pendingFallenItemsByDepth: Array<{ depth: number; items: GameSnapshotItem[] }>;
    pendingFallenByDepth: Array<{ depth: number; monsters: GameSnapshotMonster[] }>;
    purgatory: GameSnapshotMonster[];
    mode: GameMode;
    ticksTillUpdateEnvironment: number;
    pendingEnchantment: boolean;
    player: GameSnapshotPlayer;
    /** One graph across every floor, pending fall and ownership list. */
    entityGraph: EntitySnapshotGraph;
    identifiedItems: string[];
    wandFlavors?: Record<string, string>;
    staffFlavors?: Record<string, string>;
    flavors: ReturnType<typeof ItemLoader.snapshotFlavors>;
    callTitles: Record<string, string>;
    magicPolarityRevealed: string[];
    rewardRoomsGenerated: number;
    stats: Game['stats'];
    run: GameRunSnapshot;
}

export function snapshotLevel(depth: number, level: LevelState, trapDepressions: ReadonlySet<number> | undefined): LevelSnapshot {
    return {
        depth, width: level.grid.width, height: level.grid.height,
        grid: snapshotGrid(level.grid), impregnableCells: [...level.grid.impregnableCells],
        monsters: level.monsters.map(serializeMonsterRow),
        dormantMonsters: (level.dormantMonsters ?? []).map(serializeMonsterRow), items: level.items.map(serializeItem),
        scent: (level.scent ?? new ScentMap(level.grid.width, level.grid.height)).getState(),
        waypoints: (level.waypoints ?? new WaypointSystem()).getState(),
        environmentState: level.environment.getState(),
        pendingCaughtFireCells: (level.pendingCaughtFireCells ?? []).map(p => ({ ...p })),
        trapDepressions: [...(trapDepressions ?? [])],
        machineCells: [...collectMachineCells(level.grid)],
        visibleMonsterIds: [...level.visibleMonsters].map(m => m.id),
        visibleItemIds: [...level.visibleItems].map(i => i.id),
        awaySince: level.awaySince ?? 0,
        playerExitedVia: { ...(level.playerExitedVia ?? { x: 0, y: 0 }) },
    };
}

export interface WholeRunProjection {
    depth: number;
    currentLevelDepth: number | null;
    active: LevelState;
    levels: ReadonlyMap<number, LevelState>;
    snapshotLevel: (depth: number, level: LevelState) => LevelSnapshot;
    pendingFallenByDepth: ReadonlyMap<number, Monster[]>;
    pendingFallenItemsByDepth: ReadonlyMap<number, Item[]>;
    purgatory: Monster[];
    monsters: Monster[];
    dormantMonsters: Monster[];
    items: Item[];
    player: Player;
    everSeenMonsters: ReadonlySet<Monster>;
    everSeenItems: ReadonlySet<Item>;
    visibleMonsters: ReadonlySet<Monster>;
    visibleItems: ReadonlySet<Item>;
    travelTargetItem: Item | null | undefined;
    isAdvancing: boolean;
    currentSeed: string;
    levelSeeds: LevelSeed[];
    mode: GameMode;
    ticksTillUpdateEnvironment: number;
    pendingEnchantment: boolean;
    stats: GameSnapshot['stats'];
    run: GameSnapshot['run'];
    services: {
        rngState: () => RandomState;
        identifiedItems: () => string[];
        callTitles: () => Record<string, string>;
        magicPolarityRevealed: () => string[];
        flavors: () => GameSnapshot['flavors'];
        staffFlavors: () => Record<string, string>;
        wandFlavors: () => Record<string, string>;
        rewardRoomsGenerated: () => number;
    };
}

export function toWholeRunSnapshot(source: WholeRunProjection): GameSnapshot {
    if (source.isAdvancing) throw new Error('Cannot save during turn advancement');
    const levels = [...source.levels].filter(([depth]) => depth !== source.currentLevelDepth)
        .sort(([a], [b]) => a - b);
    const levelRoots = levels.flatMap(([, l]) => [...l.monsters, ...(l.dormantMonsters ?? [])]);
    const pendingFallenByDepth = [...source.pendingFallenByDepth].sort(([a], [b]) => a - b)
        .map(([depth, monsters]) => ({ depth, monsters: monsters.map(serializeMonsterRow) }));
    const roots = [...source.monsters, ...source.dormantMonsters, ...source.purgatory, ...levelRoots, ...[...source.pendingFallenByDepth.values()].flat()];
    const pendingFallenItemsByDepth = [...source.pendingFallenItemsByDepth].sort(([a], [b]) => a - b)
        .map(([depth, items]) => ({ depth, items: items.map(serializeItem) }));
    const ownedItems = [...[...source.pendingFallenItemsByDepth.values()].flat(), ...source.items, ...source.player.inventory.items, ...levels.flatMap(([, l]) => l.items)];
    const graph = collectEntityGraph([...roots, ...source.everSeenMonsters,
        ...source.visibleMonsters, ...levels.flatMap(([, l]) => [...l.visibleMonsters])], [...ownedItems, ...source.everSeenItems,
        ...source.visibleItems, ...levels.flatMap(([, l]) => [...l.visibleItems]),
        ...[source.player.equippedWeapon, source.player.equippedArmor, source.player.ringLeft, source.player.ringRight, source.travelTargetItem]
            .filter((item): item is Item => item != null)]);
    return {
        ...source.snapshotLevel(source.depth, source.active),
        version: 2, schema: WHOLE_RUN_SCHEMA, savedAt: Date.now(),
        seed: source.currentSeed, rngState: source.services.rngState(), levelSeeds: copyLevelSeeds(source.levelSeeds),
        currentLevelDepth: source.currentLevelDepth ?? source.depth,
        levels: levels.map(([depth, level]) => source.snapshotLevel(depth, level)), pendingFallenByDepth, pendingFallenItemsByDepth,
        purgatory: source.purgatory.map(serializeMonsterRow),
        mode: source.mode, ticksTillUpdateEnvironment: source.ticksTillUpdateEnvironment,
        pendingEnchantment: source.pendingEnchantment,
        player: {
            ...copyFields(source.player, PLAYER_FIELDS),
            statusImmunities: [...source.player.statusImmunities], hungerTransition: source.player.snapshotHungerTransition(),
            inventoryCapacity: source.player.inventory.capacity, inventory: source.player.inventory.items.map(serializeItem),
            equippedWeaponId: source.player.equippedWeapon?.id ?? null, equippedArmorId: source.player.equippedArmor?.id ?? null,
            ringLeftId: source.player.ringLeft?.id ?? null, ringRightId: source.player.ringRight?.id ?? null,
        },
        entityGraph: {
            monsters: graph.monsters.filter(m => !roots.includes(m)).map(serializeMonsterRow),
            items: graph.items.filter(item => !ownedItems.includes(item)).map(serializeItem),
        },
        identifiedItems: source.services.identifiedItems(), callTitles: source.services.callTitles(),
        magicPolarityRevealed: source.services.magicPolarityRevealed(), flavors: source.services.flavors(),
        staffFlavors: source.services.staffFlavors(),
        wandFlavors: source.services.wandFlavors(),
        rewardRoomsGenerated: source.services.rewardRoomsGenerated(), stats: { ...source.stats }, run: source.run,
    };
}

export function decodePlayer(saved: GameSnapshot['player'], items: Map<number, Item>): Player {
    const player = new Player(saved.loc.x, saved.loc.y);
    Object.assign(player, copyFields(saved, PLAYER_FIELDS));
    player.statusImmunities = new Set(saved.statusImmunities);
    player.restoreHungerTransition(saved.hungerTransition);
    player.inventory.capacity = saved.inventoryCapacity;
    player.inventory.items = saved.inventory.map(it => items.get(it.id)!);
    const equipment = (id: number | null): Item | null => id === null ? null : items.get(id)!;
    player.equippedWeapon = equipment(saved.equippedWeaponId);
    player.equippedArmor = equipment(saved.equippedArmorId);
    player.ringLeft = equipment(saved.ringLeftId); player.ringRight = equipment(saved.ringRightId);
    return player;
}

export function decodeWholeRunWorld(snapshot: GameSnapshot, deps: EntityCodecDeps): {
    entityGraph: ReturnType<typeof restoreEntityGraph>;
    restored: Map<number, LevelState>;
} {
    const levelRows = [snapshot, ...snapshot.levels];
    const entityGraph = restoreEntityGraph(
        [...levelRows.flatMap(l => [...l.monsters, ...l.dormantMonsters]),
             ...snapshot.pendingFallenByDepth.flatMap(q => q.monsters), ...(snapshot.purgatory ?? []), ...snapshot.entityGraph.monsters],
        [...levelRows.flatMap(l => l.items), ...snapshot.pendingFallenItemsByDepth.flatMap(q => q.items), ...snapshot.player.inventory, ...snapshot.entityGraph.items],
        [], [], deps);
    const resolve = <T>(map: Map<number, T>, id: number): T => {
        const value = map.get(id);
        if (!value) throw new Error(`Missing snapshot entity ${id}`);
        return value;
    };
    const restored = new Map<number, LevelState>(levelRows.map(saved => {
        const grid = restoreGrid(saved.width, saved.height, saved.grid, saved.impregnableCells!);
        const environment = new EnvironmentManager(grid);
        environment.setState(saved.environmentState);
        const waypoints = new WaypointSystem(); waypoints.setState(saved.waypoints);
        return [saved.depth, {
            grid, environment, fov: new FOVSys(grid), lightMap: new LightMap(grid),
            monsters: saved.monsters.map(m => resolve(entityGraph.monsters, m.id)),
            dormantMonsters: saved.dormantMonsters.map(m => resolve(entityGraph.monsters, m.id)),
            items: saved.items.map(i => resolve(entityGraph.items, i.id)),
            visibleMonsters: new Set(saved.visibleMonsterIds.map(id => resolve(entityGraph.monsters, id))),
            visibleItems: new Set(saved.visibleItemIds.map(id => resolve(entityGraph.items, id))),
            machineCells: collectMachineCells(grid), scent: ScentMap.fromState(saved.scent), waypoints,
            awaySince: saved.awaySince, playerExitedVia: { ...saved.playerExitedVia }, pendingCaughtFireCells: saved.pendingCaughtFireCells.map(p => ({ ...p })),
        }];
    }));
    return { entityGraph, restored };
}

export function isWholeRunSnapshot(value: unknown): value is GameSnapshot {
    const s = value as GameSnapshot | null;
    if (!s || s.version !== 2 || s.schema !== WHOLE_RUN_SCHEMA || !isSeed(s.seed)
        || !Random.isState(s.rngState) || !isLevelSeeds(s.levelSeeds)
        || s.currentLevelDepth !== s.depth || !s.run || !s.flavors || !s.player || !s.entityGraph
        || !Number.isFinite(s.ticksTillUpdateEnvironment) || typeof s.pendingEnchantment !== 'boolean'
        || !Array.isArray(s.identifiedItems) || !Array.isArray(s.magicPolarityRevealed)
        || !s.callTitles || !s.stats || !Number.isFinite(s.rewardRoomsGenerated)
        || !Array.isArray(s.run.meteredItems) || !Number.isFinite(s.run.foodSpawned)
        || !Number.isFinite(s.run.goldGenerated) || !Number.isFinite(s.run.currentTick)
        || !Number.isSafeInteger(s.run.nextEntityId) || s.run.nextEntityId < 1
        || !Number.isFinite(s.run.monsterSpawnFuse) || !Number.isFinite(s.run.absoluteTurnNumber)
        || typeof s.run.pendingIdentify !== 'boolean' || !s.run.logger
        || !Array.isArray(s.levels) || !Array.isArray(s.pendingFallenByDepth) || !Array.isArray(s.pendingFallenItemsByDepth)
        || (s.purgatory !== undefined && !Array.isArray(s.purgatory))) return false;
    const depths = new Set<number>();
    for (const level of [s, ...s.levels]) {
        if (!level || !Number.isInteger(level.depth) || level.depth < 1 || level.depth > CE_DEEPEST_LEVEL
            || depths.has(level.depth) || !s.levelSeeds[level.depth - 1]?.visited
            || level.width !== DCOLS || level.height !== DROWS
            || !Array.isArray(level.grid) || level.grid.length !== level.width * level.height
            || !Array.isArray(level.impregnableCells)
            || !level.grid.every(c => c && c.layers?.length === 4 && typeof c.machineNumber === 'number'
                && typeof c.rememberedTerrain === 'number' && Array.isArray(c.rememberedLayers)
                && (c.rememberedLayers.length === 0 || c.rememberedLayers.length === 4)
                && typeof c.isMagicMapped === 'boolean' && typeof c.knownTrapFree === 'boolean'
                && typeof c.rememberedTerrainFlags === 'number' && typeof c.rememberedTMFlags === 'number'
                && c.rememberedAppearance !== undefined && c.rememberedItem !== undefined
                && c.rememberedItemCategory !== undefined && c.rememberedFlags !== undefined)
            || !machineCellsMatchGrid(level.machineCells, level.grid)
            || !level.scent || level.scent.values.length !== level.width * level.height
            || !level.waypoints || !level.environmentState || !Array.isArray(level.monsters)
            || !Number.isFinite(level.awaySince) || !level.playerExitedVia
            || !Number.isInteger(level.playerExitedVia.x) || !Number.isInteger(level.playerExitedVia.y)
            || !Array.isArray(level.dormantMonsters) || !Array.isArray(level.items)) return false;
        depths.add(level.depth);
    }
    if (!Array.isArray(s.entityGraph.monsters) || !Array.isArray(s.entityGraph.items)
        || s.pendingFallenByDepth.some(level => !level || !Array.isArray(level.monsters))) return false;
    if (s.pendingFallenItemsByDepth.some(q => !q || !Number.isInteger(q.depth) || q.depth < 1 || q.depth > CE_DEEPEST_LEVEL
        || !Array.isArray(q.items) || q.items.some(item => !Number.isFinite(item.spawnTurnNumber)))) return false;
    const rows = [...s.monsters, ...s.dormantMonsters, ...(s.purgatory ?? []), ...s.entityGraph.monsters,
        ...s.levels.flatMap(l => [...l.monsters, ...l.dormantMonsters]), ...s.pendingFallenByDepth.flatMap(l => l.monsters)];
    if (rows.some(m => !Number.isInteger(m.entersLevelIn) || m.entersLevelIn < 0 || m.entersLevelIn > 150
        || !Number.isInteger(m.approaching) || m.approaching < 0 || m.approaching > 7)) return false;
    if (s.mode !== 'test' && s.levelSeeds.some((level, i) => level.visited && !depths.has(i + 1))) return false;
    return true;
}
