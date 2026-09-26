/**
 * Floor generation transaction. Ports are live accessors and bound callbacks:
 * a stair retry discards only that attempt's geometry, a successful dig commits
 * machine entities before deferred population, and the return seed reinstates
 * the run streams before entry/catch-up.
 */
import type { GenerationPorts, HordeEntry } from './Game';
import { type MachineEntityRuntime, type MachineItemSpawn, type MachineMonsterSpawn, type MachineResult } from '../Generator/BlueprintEngine';
import { getMachineObservationHook, type MachineTrace } from '../Generator/MachineObservation';
import { stairFallbackQualifies, stairCandidates, clearStairVicinity } from '../Generator/Stairs';
import { qualifyingNear } from '../Generator/GenerationPlacement';
import { scheduleLevelFollowers } from '../Movement/LevelTravel';
import { collectMachineCells } from '../Map/MachineCells';
import { Grid, TerrainType, DCOLS, DROWS, DungeonLayer } from '../Map/Grid';
import { cellTerrainFlags, setDormantAwakener, setAllyResurrector, setDungeonFeatureEffects } from '../Map/DungeonFeature';
import { T_OBSTRUCTS_ITEMS, T_PATHING_BLOCKER } from '../Map/TerrainCatalog';
import { Architect } from '../Generator/Architect';
import { Monster } from '../../entities/Monster';
import { Item, ItemCategory } from '../Items/Item';
import { ItemLoader } from '../Items/ItemLoader';
import { rng, RNGType } from '../Random';
import { EnvironmentManager } from '../Environment/Gas';
import { FOVSys } from '../Lighting/FOV';
import { LightMap } from '../Lighting/LightMap';
import { ScentMap } from '../Map/Scent';
import { WaypointSystem } from '../Map/WaypointMap';
import { analyzeLoopMap } from '../Map/LoopMap';
import { CE_DEEPEST_LEVEL } from '../Map/LakeSystem';
import { ItemSpawnHeatMap, passableArcCount, randomMatchingLocation } from '../Items/ItemSpawnHeatMap';
import type { Pos } from '../../types';

const AMULET_LEVEL = 26;
const HORDE_MACHINE_ONLY_FLAGS: readonly string[] = [
    'HORDE_MACHINE_BOSS', 'HORDE_MACHINE_WATER_MONSTER', 'HORDE_MACHINE_CAPTIVE',
    'HORDE_MACHINE_STATUE', 'HORDE_MACHINE_TURRET', 'HORDE_MACHINE_MUD',
    'HORDE_MACHINE_KENNEL', 'HORDE_VAMPIRE_FODDER', 'HORDE_MACHINE_LEGENDARY_ALLY',
    'HORDE_MACHINE_THIEF', 'HORDE_MACHINE_GOBLIN_WARREN', 'HORDE_SACRIFICE_TARGET',
];
const HORDE_POPULATE_FORBIDDEN_FLAGS: readonly string[] = ['HORDE_IS_SUMMONED', ...HORDE_MACHINE_ONLY_FLAGS];

export function createMachineRuntime(ports: GenerationPorts, depth: number): MachineEntityRuntime {
        const created: Monster[] = [];
        const items = new Map<string | MachineItemSpawn, Item>();
        const remove = (mon: Monster): void => {
            ports.demoteMonsterFromLeadership(mon);
            ports.monsters = ports.monsters.filter(m => m !== mon);
            ports.dormantMonsters = ports.dormantMonsters.filter(m => m !== mon);
            ports.visibleMonsters.delete(mon);
            mon.carriedItem = null;
            mon.leader = null;
            mon.hp = 0;
        };
        const itemsHas = (item: Item): boolean => [...items.values()].includes(item);
        return {
            item: (spawn, place) => {
                const identity = spawn.instanceId ?? spawn;
                let item = items.get(identity) ?? spawn.entity;
                if (!item) {
                    const previous = (spawn.priorItemIds ?? []).map(id => {
                        const prior = items.get(id);
                        if (!prior) throw new Error(`Missing prior machine item: ${id}`);
                        return prior;
                    });
                    item = ports.spawnBlueprintItem(spawn.category, spawn.id, spawn.pos.x, spawn.pos.y,
                        depth, spawn.itemQualifiers ?? [], previous) ?? undefined;
                    if (!item) throw new Error(`Cannot generate machine item: ${spawn.category}/${spawn.id ?? '*'}`);
                }
                spawn.entity = item; items.set(identity, item);
                item.loc = {...spawn.pos};
                if (spawn.keyLoc) item.keyLoc = spawn.keyLoc.map(k => ({...k, loc: {...k.loc}}));
                if (spawn.itemFlags) {
                    item.flags = [...new Set([...(item.flags ?? []), ...spawn.itemFlags])];
                    if (spawn.itemFlags.includes('ITEM_MAX_CHARGES_KNOWN')) item.maxChargesKnown = true;
                }
                item.originDepth = depth;
                // CE placeItemAt accepts the feature location unconditionally.
                // A cage may obstruct movement while retaining its eventual reward.
                ports.items = ports.items.filter(i => i !== item);
                if (place) ports.items.push(item);
                return item;
            },
            handOff: (spawn, item) => {
                const bearer = spawn.entities?.[0];
                if (!bearer || !item.entity) throw new Error('Machine item has no realized bearer');
                ports.items = ports.items.filter(i => i !== item.entity);
                bearer.carriedItem = item.entity;
                item.entity.loc = {...bearer.loc};
            },
            checkpoint: () => {
                const start = created.length;
                const previous = new Map(items);
                const floor = new Set(ports.items);
                const carriers = new Map([...ports.monsters, ...ports.dormantMonsters].map(m => [m, m.carriedItem]));
                const borrowed = [...items.values()].map(item => ({item, loc: {...item.loc},
                    keyLoc: item.keyLoc?.map(k => ({...k, loc: {...k.loc}})), flags: item.flags ? [...item.flags] : undefined,
                    originDepth: item.originDepth, maxChargesKnown: item.maxChargesKnown}));
                return () => {
                    const discarded = new Set([...items].filter(([id]) => !previous.has(id)).map(([, item]) => item));
                    ports.items = ports.items.filter(item => !discarded.has(item) && (!itemsHas(item) || floor.has(item)));
                    for (const mon of [...ports.monsters, ...ports.dormantMonsters]) {
                        if (mon.carriedItem && (discarded.has(mon.carriedItem) || borrowed.some(b => b.item === mon.carriedItem))) mon.carriedItem = null;
                    }
                    for (const item of floor) if (itemsHas(item) && !ports.items.includes(item)) ports.items.push(item);
                    for (const state of borrowed) Object.assign(state.item, {loc: state.loc, keyLoc: state.keyLoc,
                        flags: state.flags, originDepth: state.originDepth, maxChargesKnown: state.maxChargesKnown});
                    items.clear(); for (const [id, item] of previous) items.set(id, item);
                    for (const mon of created.splice(start)) remove(mon);
                    for (const [mon, item] of carriers) if (mon.hp > 0 && (ports.monsters.includes(mon) || ports.dormantMonsters.includes(mon))) mon.carriedItem = item;
                    for (let x = 0; x < ports.grid.width; x++) for (let y = 0; y < ports.grid.height; y++) ports.grid.getCell(x, y)!.hasDormantMonster = false;
                    for (const mon of ports.dormantMonsters) ports.grid.getCell(mon.x, mon.y)!.hasDormantMonster = true;
                };
            },
            hasItem: (x, y) => ports.items.some(i => i.x === x && i.y === y),
            hasMonster: (x, y) => ports.monsters.some(m => m.hp > 0 && m.x === x && m.y === y),
            spawn: (spawn, machineNumber) => {
                const made: Monster[] = [];
                // Both CE spawnHorde and the explicit monsterID branch quietly
                // replace an occupant. Do not run combat/death-drop callbacks.
                const old = ports.monsters.find(m => m.hp > 0 && m.x === spawn.pos.x && m.y === spawn.pos.y);
                if (spawn.hordeFlags) {
                    ports.spawnHordeAtFeature(spawn, depth, machineNumber, made);
                    if (made.length && old) remove(old);
                } else if (spawn.monsterId) {
                    if (old) remove(old);
                    const data = ports.resolveBlueprintMonster(spawn.monsterId, depth);
                    if (data) {
                        const mon = new Monster(spawn.pos.x, spawn.pos.y, data);
                        if (spawn.isAlly) mon.isAlly = true;
                        if (spawn.isCaged) mon.isCaged = true;
                        ports.applyRandomMutation(mon, depth);
                        ports.monsters.push(mon);
                        ports.finalizeBlueprintMonster(mon, spawn, machineNumber);
                        made.push(mon);
                    }
                }
                created.push(...made);
                return made;
            },
        };
    }

export function generateDepth(ports: GenerationPorts, isGoingUp: boolean = false, isFirstLevel: boolean = false, fell: boolean = false) {
        const exit = { ...ports.player.loc };
        const level = ports.levelSeeds[ports.depth - 1];
        if (!level) throw new RangeError('Missing level seed');
        if (level.visited && ports.currentLevelDepth !== ports.depth && !ports.levels.has(ports.depth) && ports.mode !== 'test') {
            // A visited map must have its real world payload, never regenerate it.
            throw new Error('Visited level state is unavailable');
        }
        rng.setRNG(RNGType.RNG_SUBSTANTIVE);
        if (ports.mode === 'test') {
            ports.generateTestDepth(isFirstLevel);
            level.visited = true;
            ports.currentLevelDepth = ports.depth;
            // P4-10：test 层同样建 waypoint（CE RogueMain.c:707 的位置——
            // 该层的全部生成决策已完成之后）。
            ports.rebuildWaypoints();
            ports.updateVision(); // C-7：CE updateVision 全链（原 computeFOV(10) 代理退役）
            ports.onRenderRequested?.();
            return;
        }

        if (ports.currentLevelDepth !== null && ports.currentLevelDepth !== ports.depth) {
            if (fell) ports.currentLevelExitedVia = { ...exit };
            scheduleLevelFollowers(ports.grid, ports.monsters, exit, fell ? 0 : isGoingUp ? -1 : 1);
        }
        // The active layer is already visited even before it has a detached cache entry.
        // Track its real depth; test harnesses can jump depths or re-enter the current map.
        if (ports.grid && ports.currentLevelDepth !== null) {
            setDormantAwakener(ports.grid, null);
            setAllyResurrector(ports.grid, null);
            setDungeonFeatureEffects(ports.grid, null);
            ports.levels.set(ports.currentLevelDepth, {
                grid: ports.grid,
                environment: ports.environment,
                fov: ports.fov,
                lightMap: ports.lightMap,
                monsters: ports.monsters,
                dormantMonsters: ports.dormantMonsters,
                items: ports.items,
                visibleMonsters: ports.visibleMonsters,
                visibleItems: ports.visibleItems,
                machineCells: ports.machineCells,
                scent: ports.scent,
                waypoints: ports.waypoints,
                awaySince: ports.currentLevelDepth === ports.depth ? ports.currentLevelAwaySince : ports.absoluteTurnNumber,
                playerExitedVia: { ...ports.currentLevelExitedVia },
                pendingCaughtFireCells: ports.pendingCaughtFireCells,
            });
        }
        const scentTurnNumber = ports.scent.turnNumber;
        const cached = ports.levels.get(ports.depth);

        if (cached) {
            // Restore from cache
            ports.grid = cached.grid;
            ports.scent = cached.scent ?? new ScentMap(DCOLS, DROWS);
            ports.scent.turnNumber = scentTurnNumber;
            ports.waypoints = cached.waypoints ?? new WaypointSystem();
            ports.currentLevelAwaySince = cached.awaySince ?? 0;
            ports.currentLevelExitedVia = { ...(cached.playerExitedVia ?? { x: 0, y: 0 }) };
            ports.pendingCaughtFireCells = cached.pendingCaughtFireCells ?? [];
            ports.environment = cached.environment;
            ports.fov = cached.fov;
            ports.lightMap = cached.lightMap;
            ports.activeFlares = []; ports.terrainFlashes = []; ports.flareLightMap = null; ports.flareElapsedMs = 0;
            ports.monsters = cached.monsters;
            ports.dormantMonsters = cached.dormantMonsters ?? [];
            ports.items = cached.items;
            ports.visibleMonsters = cached.visibleMonsters;
            ports.visibleItems = cached.visibleItems;
            ports.machineCells = collectMachineCells(ports.grid);
            ports.bindDormantAwakener();

            ports.rebuildWaypoints(); // Revisit: live stream, no level reseeding.
        } else {
            // CE startLevel: draw a nonzero return seed, then initialize BOTH streams.
            let oldSeed: bigint;
            do { oldSeed = rng.rand64bits(); } while (oldSeed === 0n);
            rng.seedRandomGenerator(level.levelSeed);
            try {
                // 1. Generate new level
                ports.stats.maxDepth = Math.max(ports.stats.maxDepth, ports.depth);
                // CE RogueMain.startLevel: dig -> placeStairs, at most 50 attempts
                // within this same level RNG stream. Failed geometry is discarded.
                ports.monsters = [];
                ports.items = [];
                ports.dormantMonsters = [];
                let architect!: Architect;
                let stairsPlaced = false;
                for (let attempt = 0; attempt < 50; attempt++) {
                    ports.monsters = [];
                    ports.dormantMonsters = [];
                    ports.items = [];
                    ports.grid = new Grid(DCOLS, DROWS);
                    ports.player.loc = {x: 0, y: 0}; // CE removes the player during digDungeon.
                    ports.pendingCaughtFireCells = [];
                    ports.bindDormantAwakener(); // Later machine DFs see already-created entities.
                    architect = new Architect(ports.grid, ports.createMachineRuntime(ports.depth));
                    ports.grid = architect.generateLevel(ports.depth);
                    if (ports.placeStairs(architect.machineResults)) {
                        stairsPlaced = true;
                        break;
                    }
                }
                if (!stairsPlaced) throw new Error(`Failed to place stairs at depth ${ports.depth} after 50 attempts`);
                ports.environment = new EnvironmentManager(ports.grid);
                ports.fov = new FOVSys(ports.grid);
                ports.lightMap = new LightMap(ports.grid);
                ports.activeFlares = []; ports.terrainFlashes = []; ports.flareLightMap = null; ports.flareElapsedMs = 0;
                ports.scent = new ScentMap(DCOLS, DROWS);
                ports.scent.turnNumber = scentTurnNumber;
                ports.currentLevelAwaySince = 0;
                ports.currentLevelExitedVia = { x: 0, y: 0 };
                ports.pendingCaughtFireCells = [];
                ports.waypoints = new WaypointSystem();

                // Machine entities already occupy the successfully generated level.
                ports.visibleMonsters = new Set();
                ports.visibleItems = new Set();

                // 2. Populate the successfully stair-equipped level with monsters and items
                // （B-4b：architect.machines 不再传入——legacy machines 循环已删；
                //  V-2b-1：architect.trapVaults/cages 不再传入——两数组及其消费
                //  循环均为死代码，已删除）
                ports.populateLevel(
                    ports.depth, isGoingUp, isFirstLevel,
                    architect.machineResults
                );

                // CE initializeLevel restores fallen items before monsters, in the level RNG stream.
                ports.restoreFallenItems();

                // C-5：取走坠到本层的怪物幸存者（CE startLevel "Load up next
                // level's monsters and items, since one might have fallen from
                // above"——RogueMain.c:673-676；重定位= restoreMonster 的
                // MB_PREPLACED 分支，Architect.c:3537-3550）。CE 用
                // getQualifyingPathLocNear，web 复用 P1-31 的同口径端口。
                const fallen = ports.pendingFallenByDepth.get(ports.depth);
                if (fallen && fallen.length > 0) {
                    ports.pendingFallenByDepth.delete(ports.depth);
                    for (const m of fallen) {
                        const spot = ports.findQualifyingPathLocNear(m.loc);
                        if (spot) {
                            m.loc.x = spot.x;
                            m.loc.y = spot.y;
                        }
                        m.preplaced = false; // CE :3548 清 MB_PREPLACED
                        ports.monsters.push(m);
                    }
                }
                ports.rebuildWaypoints(); // CE: inside the new level stream, before oldSeed.
                level.visited = true;
            } finally {
                // Generation borrows the off-map position; environment catch-up
                // owns its own borrow, and level entry owns the final placement.
                ports.player.loc = { ...exit };
                // This is reseeding from oldSeed, not restoring the pre-entry state tuple.
                rng.seedRandomGenerator(oldSeed);
            }
        }

        if (cached) ports.restoreFallenItems();

        // No active-floor alias while environmental falls modify ownership.
        ports.levels.delete(ports.depth);
        for (let x = 0; x < ports.grid.width; x++) for (let y = 0; y < ports.grid.height; y++) {
            ports.grid.getCell(x, y)!.isVisible = false;
        }
        ports.catchUpEnvironment(cached ? Math.max(0, ports.absoluteTurnNumber - (cached.awaySince ?? 0)) : 50);
        if (fell) ports.placePlayerOnFallLanding(exit.x, exit.y);
        else {
            const entry = ports.levelStair(isGoingUp ? TerrainType.STAIRS_DOWN : TerrainType.STAIRS_UP);
            if (entry) ports.placePlayerOnLevelEntry(entry);
        }
        ports.restoreLevelResidents();
        ports.currentLevelDepth = ports.depth;
        // Active ownership is never duplicated by a stale cached array.
        ports.levels.delete(ports.depth);
        ports.updatedSafetyMapThisTurn = false;
        // Pure derived topology; waypoint draws belong to the branches above.
        ports.loopMap = analyzeLoopMap(ports.grid);

        // 3. Force full refresh
        // C-7：CE RogueMain.c:671 进层时 updateColors + updateRingBonuses
        // （级联 updateMinersLightRadius）+ updateVision 的对应位置——
        // updateVision 内部先重算矿灯半径再做光照/可见性。
        ports.needsRender = true;
        ports.updateVision();
        ports.onRenderRequested?.();
    }

export function placeStairs(ports: GenerationPorts, machineResults: MachineResult[] = []): boolean {
        const level = ports.levelSeeds[ports.depth - 1]!;
        const occupied = new Set([
            ...machineResults.flatMap(m => [...m.itemSpawns.filter(s => !s.entity),
                ...m.monsterSpawns.filter(s => !s.entities)]).map(s => s.pos),
            ...ports.items.map(i => i.loc), ...ports.monsters.map(m => m.loc), ...ports.dormantMonsters.map(m => m.loc),
        ].map(p => p.y * ports.grid.width + p.x));
        const candidates = stairCandidates(ports.grid, occupied);
        const choose = (target: Pos): Pos | null => {
            const preferred = qualifyingNear(ports.grid, target, (x, y) => candidates.has(y * ports.grid.width + x));
            if (preferred) {
                Architect.prepareStairLoc(ports.grid, preferred);
                clearStairVicinity(ports.grid, preferred, candidates);
                return preferred;
            }
            return qualifyingNear(ports.grid, target, (x, y) => stairFallbackQualifies(ports.grid, x, y, occupied));
        };
        if (ports.depth <= CE_DEEPEST_LEVEL) {
            const down = choose(level.downStairsLoc);
            if (!down) return false;
            Architect.installStair(ports.grid, down, ports.depth === CE_DEEPEST_LEVEL ? TerrainType.DUNGEON_PORTAL : TerrainType.STAIRS_DOWN);
            occupied.add(down.y * ports.grid.width + down.x);
            level.downStairsLoc = down;
            if (!ports.levelSeeds[ports.depth]!.visited) ports.levelSeeds[ports.depth]!.upStairsLoc = { ...down };
        }
        const up = choose(level.upStairsLoc);
        if (!up) return false;
        Architect.installStair(ports.grid, up, TerrainType.STAIRS_UP);
        level.upStairsLoc = up;
        return true;
    }

export function populateLevel(ports: GenerationPorts,
        depth: number,
        _isGoingUp: boolean = false,
        _isFirstLevel: boolean = false,
        machineResults: MachineResult[] = []
    ) {
        // U04c/K31: CE membership is the final per-cell machine flag, including
        // external features and excluding cleared BP_NO_INTERIOR_FLAG cells.
        ports.machineCells = collectMachineCells(ports.grid);

        // Collect all valid floor tiles
        // P1-37：牌堆排除机器格（machineNumber≠0 = CE 的 IS_IN_MACHINE，
        // Rogue.h:1113）。CE 的楼梯（Architect.c:3712/3738）、随机物品
        // （3597）、漫游怪群（3543）落点一律回避该旗标；web 的护符/
        // 钥匙/随机物品/怪群领袖统一从本牌堆抽取，此处一处排除全部覆盖。
        // P1-33 曾以"宝库地板改判 CHARRED_FLOOR"达成同样效果（当时 Game.ts
        // 禁改），P1-37 起用地形类型冒充旗标的做法废除，宝库恢复普通地板。
        const floorTiles: Pos[] = [];
        // A previous floor's player position must not select this floor's stair deck.
        // Keep the existing exclusion shape, anchored to this level's initialization plan.
        const generationOrigin = ports.levelSeeds[depth - 1]!.upStairsLoc;
        for (let x = 1; x < DCOLS - 1; x++) {
            for (let y = 1; y < DROWS - 1; y++) {
                const cell = ports.grid.getCell(x, y);
                if (!cell || !cell.layers.includes(TerrainType.FLOOR)) continue; // F-1 跨层判定
                if (cell.machineNumber !== 0) continue; // CE IS_IN_MACHINE
                // Don't spawn right on top of player
                if (Math.abs(x - generationOrigin.x) > 5 || Math.abs(y - generationOrigin.y) > 5) {
                    floorTiles.push({ x, y });
                }
            }
        }

        rng.shuffleList(floorTiles);

        // placeStairs belongs to generateDepth's dig/retry transaction. Population
        // only consumes the committed coordinates; it must not relocate stairs.
        const stairsUpPos = ports.levelSeeds[depth - 1]!.upStairsLoc;
        const stairsDownPos = ports.depth <= CE_DEEPEST_LEVEL ? ports.levelSeeds[depth - 1]!.downStairsLoc : null;
        for (let i = floorTiles.length - 1; i >= 0; i--) {
            const p = floorTiles[i]!;
            if ((p.x === stairsUpPos.x && p.y === stairsUpPos.y)
                || (stairsDownPos && p.x === stairsDownPos.x && p.y === stairsDownPos.y)) floorTiles.splice(i, 1);
        }

        // B-4b：CE Items.c:608-655——物品落位热力图（上行梯泛洪 → 归零 pass →
        // totalHeat）。**构建零 RNG**，故提前到一切内容物（护符/钥匙/怪群/物品）
        // 落位之前：归零 pass 的失败保护会把「泛洪不可达的孤岛」改成 WALL
        //（CE 同款，Items.c:620-624），必须发生在任何物品进牌堆格之前，
        // 否则已落位的钥匙会被新墙掩埋（本轮实测 seed777/D25 真实发生）。
        // 机器格（IS_IN_MACHINE）在归零 pass 里被先置 0、不会触发改墙
        //（CE 语义同：锁死的机器房内部没有热、也不改墙）。
        // CE 在 populateItems 内构建（楼梯之后、物品之前）；web 的
        // populateLevel 把两段合并在同一方法里，此处即「populateItems 开头」。
        const heatMap = ItemSpawnHeatMap.build(
            ports.grid,
            stairsUpPos ?? { x: ports.player.loc.x, y: ports.player.loc.y },
            { machineCells: ports.machineCells }
        );
        // 失败保护改墙后，牌堆里可能残留已变 WALL 的格——清出去，
        // 保证钥匙/护符/怪群领袖后续从牌堆取格仍然全部可站立。
        for (let i = floorTiles.length - 1; i >= 0; i--) {
            const t = floorTiles[i]!;
            const c = ports.grid.getCell(t.x, t.y);
            if (!c || !c.isPassable) floorTiles.splice(i, 1);
        }

        ports.placeAmuletForLevel(floorTiles);

        // B-4b：删除两个 web 自创的「结构性投放点」（登记于报告）：
        // 1) legacy machines 循环——每锁房发一把钥匙（与下方 machineResults
        //    循环重复，钥匙 ×2 的根源）+ 每房 50% 硬编码附魔卷轴/随机魔杖宝藏
        //    （CE 的机器房宝物只来自蓝图 feature 表的 MF_GENERATE_ITEM 条目，
        //    即下方 itemSpawns 路径；CE 无「机器房另发宝藏」机制）。
        // 2) 祭坛逐格投放循环——每个 ALTAR 格 20% 附魔卷轴 / 兜底 life 药水
        //    （CE GlobalsBrogue.c:218/269/279：feature 表每实例每条目恰一件，
        //    且 Commutation Altars（:232-237）本就无物品）。祭坛房的物品同样
        //    只走 itemSpawns。B-4a 实测的「附魔 60/局、life 18/局压不下来」
        //    主要由这两个循环贡献，此处是本轮唯一的拆除杠杆。
        // Ordinary random floor loot uses its safe-location filter above;
        // machine recipes use the explicit CE feature location below.

        // V-2b-1：删除 web 自创的「Trap Vaults 投放循环」——消费
        // architect.trapVaults（声明后从未 push 的死数组），每台机器发一把
        // 铁钥匙 + 40% 戒指/符咒 / 兜底 life 药水到 vault.center。数组恒空
        // → 循环从不运行、从不消耗 RNG；删除是纯死代码清除，生成流逐位不变。
        // center 投放的安全前提由 blueprint_center.test.ts 用例 e 钉住。

        // V-2b-1：删除 web 自创的「Caged Monsters 投放循环」——消费同样恒空的
        // architect.cages（发钥匙 + 笼中怪物）。validMonsters 过滤是它的唯一
        // 消费者，连带删除（noUnusedLocals）。

        // --- Blueprint Engine Machine Spawning ---
        // B-4b：钥匙由锁具驱动（CE populateItems 零钥匙——Items.c:673 起的
        // 主循环不含 KEY；钥匙只来自与锁具绑定的蓝图 feature 条目，
        // GlobalsBrogue.c:250/258/262/300，且带 ITEM_IS_KEY，经
        // MF_OUTSOURCE_ITEM_TO_MACHINE 放进「守卫机器」）。web 口径：
        // 一个 LOCKED_DOOR 锁（needsKey 机器的门）⇔ 恰一把铁钥匙，
        // key.keyLoc 记录锁位与机器号（CE keyMatchesLocation 的两个匹配键）。
        // 放置沿用 floorTiles 牌堆（机器格已排除，钥匙永不落机器内——
        // CE 的 MF_OUTSOURCE 语义在 web 的最小近似，守卫机器留形待激活）。
        // U05a: a deferred instance has exactly one owner. Check the complete
        // flattened transaction before materialization, including child machines.
        const owners = new Set<string | MachineItemSpawn>();
        for (const mr of machineResults) {
            for (const spawn of [...mr.itemSpawns, ...mr.monsterSpawns.flatMap(m => m.carriedItem ? [m.carriedItem] : [])]) {
                const identity = spawn.instanceId ?? spawn;
                if (owners.has(identity)) throw new Error(`Duplicate machine item owner: ${spawn.instanceId}`);
                owners.add(identity);
            }
        }
        const registry = new Map(machineResults.flatMap(m => m.generatedItems ?? [])
            .filter(s => s.instanceId).map(s => [s.instanceId!, s]));
        const instances = new Map<string | MachineItemSpawn, Item>();
        const recordItem = getMachineObservationHook() ? (trace: MachineTrace, mr: MachineResult,
            spawn: MachineItemSpawn, item: Item, owner: 'floor' | 'monster', ownerId?: number): void => {
            const parsed = spawn.instanceId ? Number(spawn.instanceId.split(':')[0]) : mr.machineNumber;
            trace.products.push({ kind: 'item', featureIndex: spawn.placementFeatureIndex ?? spawn.sourceFeatureIndex ?? null,
                sourceMachineNumber: Number.isSafeInteger(parsed) ? parsed : mr.machineNumber,
                sourceFeatureIndex: spawn.sourceFeatureIndex,
                instanceId: item.id, name: item.name, pos: { ...item.loc }, owner, ownerId });
        } : null;
        const materialize = (spawn: MachineItemSpawn, pos: Pos): Item | null => {
            const identity = spawn.instanceId ?? spawn;
            let item = spawn.entity ?? instances.get(identity);
            if (!item) {
                // The CE duplicate list includes earlier creations and committed child
                // creations, but not an incoming adopted item or a later sibling.
                const previous = (spawn.priorItemIds ?? []).map(id => {
                    const prior = registry.get(id);
                    if (!prior) throw new Error(`Missing prior machine item: ${id}`);
                    return instances.get(id) ?? materialize(prior, prior.pos)!;
                });
                item = ports.spawnBlueprintItem(spawn.category, spawn.id, pos.x, pos.y, depth,
                    spawn.itemQualifiers ?? [], previous) ?? undefined;
                // CE generateItem never returns null. Invalid web requests must not
                // silently publish a machine with a missing reward/required item.
                if (!item) throw new Error(`Cannot generate machine item: ${spawn.category}/${spawn.id ?? '*'}`);
                instances.set(identity, item);
            }
            item.loc = { ...pos };
            if (spawn.keyLoc) item.keyLoc = spawn.keyLoc.map(k => ({ ...k, loc: { ...k.loc } }));
            if (spawn.itemFlags) {
                item.flags = [...new Set([...(item.flags ?? []), ...spawn.itemFlags])];
                if (spawn.itemFlags.includes('ITEM_MAX_CHARGES_KNOWN')) item.maxChargesKnown = true;
            }
            item.originDepth = depth;
            return item;
        };
        const handOff = (mon: Monster, spawn: MachineMonsterSpawn, mr: MachineResult): void => {
            if (!spawn.carriedItem) return;
            if (spawn.carriedItem.entity && mon.carriedItem === spawn.carriedItem.entity) {
                if (mr.observation) recordItem!(mr.observation, mr, spawn.carriedItem, mon.carriedItem, 'monster', mon.id);
                return;
            }
            // CE :1705-1710 discards the bearer's previous carried item.
            mon.carriedItem = materialize(spawn.carriedItem, mon.loc);
            if (mr.observation && mon.carriedItem) recordItem!(mr.observation, mr, spawn.carriedItem, mon.carriedItem, 'monster', mon.id);
        };
        for (const mr of machineResults) {
            const trace = mr.observation;
            if (trace) {
                trace.seed = ports.currentSeed;
                for (const feature of mr.featureSpawns) {
                    if (feature.terrain) trace.products.push({ kind: 'terrain', featureIndex: feature.featureIndex,
                        name: feature.terrain, pos: { ...feature.pos } });
                    if (feature.featureDF) trace.products.push({ kind: 'featureDF', featureIndex: feature.featureIndex,
                        name: feature.featureDF, pos: { ...feature.pos } });
                }
            }
            // Spawn keys for locked doors
            // V-2b-6：generatedKey 机器跳过补偿循环——CE Architect.c 里钥匙
            // 只由 KEY feature 生成（:1523 addLocationToKey），没有"每锁一把
            // 补偿钥匙"一说；16 号的门与钥匙同 feature（keyLoc 绑定经领养链
            // 落地），不跳过会让它拿到两把钥匙（B-4b 防的"钥匙 ×2"回流）。
            if (mr.needsKey && !mr.generatedKey && mr.door && floorTiles.length > 0) {
                // 保持牌堆逆序；仅取物品合格格，危险格仍留给其他消费者。
                let keyIndex = floorTiles.length - 1;
                while (keyIndex >= 0) {
                    const p = floorTiles[keyIndex]!;
                    if (!(cellTerrainFlags(ports.grid, p.x, p.y) & (T_OBSTRUCTS_ITEMS | T_PATHING_BLOCKER))) break;
                    keyIndex--;
                }
                const keyPos = keyIndex >= 0 ? floorTiles.splice(keyIndex, 1)[0]! : null;
                const key = keyPos ? ItemLoader.spawnKey('iron_key', keyPos.x, keyPos.y) : null;
                if (key) {
                    key.keyLoc = [{ loc: { x: mr.door.x, y: mr.door.y }, machine: mr.machineNumber, disposableHere: true }];
                    key.originDepth = depth;
                    ports.items.push(key);
                }
            }

            // Spawn items
            for (const spawn of mr.itemSpawns) {
                if (spawn.entity) {
                    if (trace && ports.items.includes(spawn.entity)) recordItem!(trace, mr, spawn, spawn.entity, 'floor');
                    continue;
                }
                // B-4b：KEY 类 feature 物品跳过——钥匙总量恒等于锁数。
                // V-2b-6：例外 = **经领养链路**（viaAdoption）落地的绑定钥匙。
                // CE Architect.c 里一切 KEY feature 要么 MF_OUTSOURCE（领养链
                // 落地）要么 MF_MONSTER_TAKE_ITEM（怪携带）——不存在"自产自销
                // 的室内钥匙"形态。web 的 key_rat_trap 室内钥匙（无外包）是该
                // 形态孤例：落在本机锁门之内、无钥匙不可达（死货），继续跳过、
                // 由补偿循环供钥匙；16 号门钥匙 / 10 号 cage key 经领养落地。
                if (spawn.category === 'KEY' && !spawn.viaAdoption) {
                    if (trace) trace.products.push({ kind: 'item', featureIndex: spawn.placementFeatureIndex ?? spawn.sourceFeatureIndex ?? null,
                        pos: { ...spawn.pos }, outcome: 'unadopted key skipped' });
                    continue;
                }
                // CE Architect.c:1531 / Items.c:422-434 places a machine item
                // directly on its feature square, including a closed cage.
                // Match the immediate runtime path; never silently lose an
                // adopted key because the current terrain blocks movement.
                if (!ports.grid.getCell(spawn.pos.x, spawn.pos.y)) continue;
                const item = materialize(spawn, spawn.pos);
                if (item) {
                    ports.items.push(item);
                    if (trace) recordItem!(trace, mr, spawn, item, 'floor');
                }
            }

            // Spawn monsters
            for (const spawn of mr.monsterSpawns) {
                if (spawn.entities) {
                    // U25 reports final ownership/location, including later DF
                    // movement, awakening and quiet replacement during construction.
                    if (trace) for (const mon of spawn.entities) {
                        const product = trace.products.find(p => p.kind === 'monster' && p.instanceId === mon.id);
                        if (!product) continue;
                        product.pos = {...mon.loc};
                        product.owner = ports.dormantMonsters.includes(mon) ? 'dormant' : ports.monsters.includes(mon) ? 'floor' : undefined;
                        if (!product.owner) product.outcome = 'removed during construction';
                    }
                    const leader = spawn.entities[0];
                    if (leader && (ports.monsters.includes(leader) || ports.dormantMonsters.includes(leader))) handOff(leader, spawn, mr);
                    continue;
                }
                // V-2b-5（CE Architect.c:1591-1599）：MF_GENERATE_HORDE 指令——
                // 按 horde 表成群生成（CE 在 spawnHorde 内部抽 horde 与核地形，
                // 落点即 feature 落点）。
                if (spawn.hordeFlags) {
                    const beforeIds = trace ? new Set([...ports.monsters, ...ports.dormantMonsters].map(m => m.id)) : null;
                    const leader = ports.spawnHordeAtFeature(spawn, depth, mr.machineNumber);
                    if (leader) handOff(leader, spawn, mr);
                    if (trace && beforeIds) for (const mon of [...ports.monsters, ...ports.dormantMonsters]) {
                        if (beforeIds.has(mon.id)) continue;
                        trace.products.push({ kind: 'monster', featureIndex: spawn.sourceFeatureIndex ?? null,
                            instanceId: mon.id, name: mon.name, pos: { ...mon.loc },
                            owner: mon.isDormant ? 'dormant' : 'floor' });
                    }
                    continue;
                }
                if (!spawn.monsterId) continue;
                const mData = ports.resolveBlueprintMonster(spawn.monsterId, depth);
                if (mData) {
                    const mon = new Monster(spawn.pos.x, spawn.pos.y, mData);
                    if (spawn.isAlly) mon.isAlly = true;
                    if (spawn.isCaged) mon.isCaged = true;
                    handOff(mon, spawn, mr);
                    ports.applyRandomMutation(mon, depth);
                    ports.monsters.push(mon);
                    ports.finalizeBlueprintMonster(mon, spawn, mr.machineNumber);
                    if (trace) trace.products.push({ kind: 'monster', featureIndex: spawn.sourceFeatureIndex ?? null,
                        instanceId: mon.id, name: mon.name, pos: { ...mon.loc },
                        owner: spawn.dormant ? 'dormant' : 'floor' });
                }
            }
            if (trace) getMachineObservationHook()?.(trace);
        }

        // （P1-31：进层落位不再在此处直接站上楼梯——移到本方法末尾、
        // 怪物/物品全部布设完成之后执行，与 CE RogueMain.c:817 "Position
        // the player" 的时序一致，HAS_MONSTER 排除项才有数据可用。）

        // Horde generation —— CE Monsters.c:1085 populateMonsters：
        // 数量 = min(20, 6 + 3*max(0, depth - AMULET_LEVEL))（D26 前基数恒为 6），
        // 随后 60% 概率反复 +1（期望约 +1.5）
        let numHordes = Math.min(20, 6 + 3 * Math.max(0, depth - AMULET_LEVEL));
        while (rng.randPercent(60)) numHordes++;

        for (let i = 0; i < numHordes && floorTiles.length > 0; i++) {
            // Monsters.c:797-805 spawnHorde：10% out-of-depth（深度 1 不触发），
            // OOD 抽取时禁用集额外加上 HORDE_NEVER_OOD
            const spawn = ports.rollSpawnDepth(depth);
            const forbidden = spawn.outOfDepth
                ? [...HORDE_POPULATE_FORBIDDEN_FLAGS, 'HORDE_NEVER_OOD']
                : HORDE_POPULATE_FORBIDDEN_FLAGS;
            const candidates = ports.hordeCandidates(spawn.depth, forbidden);

            // Monsters.c:830-868：failsafe 50 —— 先抽 horde，再依其 spawnsIn 地形感知找落格
            //（CE randomMatchingLocation(loc, FLOOR, NOTHING, spawnsIn ? spawnsIn : -1)）：
            // spawnsIn 有值走全图地形匹配（findTerrainSpawnLocation），为空仍从 FLOOR
            // 池取格（保持既有行为）；找不到匹配格则重抽 horde（CE 同样在重试时重掷
            // pickHordeType）
            let hData: HordeEntry | null = null;
            let centerPos: Pos | null = null;
            for (let failsafe = 50; failsafe > 0; failsafe--) {
                const cand = ports.pickHordeType(candidates);
                if (!cand) break;
                if (cand.spawnsIn) {
                    const pos = ports.findTerrainSpawnLocation(cand.spawnsIn);
                    if (pos) {
                        hData = cand;
                        centerPos = pos;
                        break;
                    }
                } else if (floorTiles.length > 0) {
                    const idx = rng.randRange(0, floorTiles.length - 1);
                    const pos = floorTiles[idx]!;
                    const cell = ports.grid.getCell(pos.x, pos.y)!;
                    if (ports.hordeFitsTerrain(cand, pos)
                        && cell.layers[DungeonLayer.DUNGEON] === TerrainType.FLOOR
                        && cell.layers[DungeonLayer.LIQUID] === TerrainType.NOTHING
                        && !(cellTerrainFlags(ports.grid, pos.x, pos.y) & T_OBSTRUCTS_ITEMS)
                        && !ports.getMonsterAt(pos.x, pos.y)
                        && !ports.dormantMonsters.some(m => m.hp > 0 && m.x === pos.x && m.y === pos.y)
                        && !ports.items.some(item => item.x === pos.x && item.y === pos.y)) {
                        hData = cand;
                        centerPos = pos;
                        floorTiles.splice(idx, 1);
                        break;
                    }
                }
            }
            if (!hData || !centerPos) continue;

            ports.spawnHordeAt(hData, centerPos, depth, false, floorTiles);
        }

        // CE Items.c:572–610：护符层以后只分配定额宝石，无普通金币或计量增长。
        const deep = ports.depth > AMULET_LEVEL;
        let numItems: number;
        let numGoldPiles = 0;
        if (deep) {
            numItems = ItemLoader.CE_LUMENSTONE_DISTRIBUTION[ports.depth - AMULET_LEVEL - 1] ?? 0;
        } else {
            numItems = 3;
            while (rng.randPercent(60)) numItems++;
            if (ports.depth <= 2) {
                numItems += 2; // CE: "4 extra items to kickstart your career as a rogue"
            } else if (ports.depth <= 4) {
                numItems++;
            }
            // CE Items.c:590-596：金币堆数 = min(5, depth*depthAccelerator/4)，
            // 然后 60% 起每轮递减 15 的奖励循环（60→45→30→15→0），上限 10。
            // depthAccelerator = 1（GlobalsBrogue.c:1019）。
            numGoldPiles = Math.min(5, Math.floor(ports.depth * 1 / 4));
            for (let goldBonusProbability = 60;
                 rng.randPercent(goldBonusProbability) && numGoldPiles <= 10;
                 goldBonusProbability -= 15) {
                numGoldPiles++;
            }
            // CE Items.c:597-608：产量调度——past goldAdjustmentStartDepth（=6，
            // GlobalsBrogue.c:1033）后按上一深度为止的 goldGenerated 与
            // POW_GOLD[d] ± 320d/420d 比较，堆数 ±2；d = depth*accelerator - 1。
            if (ports.depth >= 6) {
                const d = ports.depth * 1 - 1;
                if (ports.goldGenerated < ItemLoader.aggregateGoldLowerBound(d)) {
                    numGoldPiles += 2;
                } else if (ports.goldGenerated > ItemLoader.aggregateGoldUpperBound(d)) {
                    numGoldPiles -= 2;
                }
            }
            if (numGoldPiles < 0) numGoldPiles = 0;
        }

        // 热力图已在本方法开头（楼梯之后）构建（B-4b：零 RNG，提前构建
        // 以使失败保护改墙先于一切内容物落位）——此处直接使用。

        // B-4a：CE Items.c:668-672——每层一次的 randomDepthOffset（depth>2 时
        // 两次独立 rand_range(-1,1)，三角分布；不是一次 rand_range(-2,2)）。
        let randomDepthOffset = 0;
        if (ports.depth > 2) {
            randomDepthOffset = rng.randRange(-1, 1) + rng.randRange(-1, 1);
        }
        // CE Items.c:577-579：每层入口给计量表加 incrementFrequency。
        if (!deep) ItemLoader.incrementMeteredItems(ports.meteredItems);

        // CE Items.c:663-767：主物品循环。生成决策（spawnPopulateItem）在先、
        // 选点在后——普通物品走热力图（heat 加权，密门后房间被偏好），
        // 食物与力量药水走 randomMatchingLocation 且不落走廊（CE 注释：
        // "Food and gain strength don't follow the heat map."）。
        for (let i = 0; i < numItems; i++) {
            const item = ports.spawnPopulateItem(ports.depth, randomDepthOffset);
            if (!item) continue;
            if (deep) item.originDepth = ports.depth;
            const isFood = item.category === ItemCategory.FOOD;
            // CE Items.c:693–696：额外食物不扣宝石配额。
            if (deep && isFood) numItems++;
            const isStrengthPotion = item.category === ItemCategory.POTION
                && (item as any).consumableId === 'potion_of_strength';
            let loc: Pos | null;
            if (isFood || isStrengthPotion) {
                // CE Items.c:729-734：do { randomMatchingLocation(FLOOR, NOTHING, -1) }
                // while (passableArcCount > 1)。占用判据对齐 CE 的
                // HAS_MONSTER|HAS_STAIRS|HAS_ITEM|IS_IN_MACHINE（HAS_PLAYER 不查——
                // CE populateItems 时玩家尚未进层）。CE 的 while 无次数上限；
                // web 加 50 次上限防病态图挂死，耗尽则退回热力图（登记偏差）。
                loc = null;
                for (let tries = 0; tries < 50; tries++) {
                    const cand = randomMatchingLocation(ports.grid, {
                        dungeonType: TerrainType.FLOOR,
                        liquidType: TerrainType.NOTHING,
                        isOccupied: (x, y) => {
                            if (ports.getMonsterAt(x, y)) return true;
                            if (ports.items.some(it => it.loc.x === x && it.loc.y === y)) return true;
                            const c = ports.grid.getCell(x, y);
                            if (c && (c.terrain === TerrainType.STAIRS_UP || c.terrain === TerrainType.STAIRS_DOWN || c.terrain === TerrainType.DUNGEON_PORTAL)) return true;
                            return false;
                        },
                        isMachineCell: (x, y) => ports.machineCells.has(y * DCOLS + x),
                    });
                    if (!cand) break;
                    if (passableArcCount(ports.grid, cand.x, cand.y) <= 1) {
                        loc = cand;
                        break;
                    }
                }
                if (!loc) loc = heatMap.getItemSpawnLoc();
            } else {
                loc = heatMap.getItemSpawnLoc();
            }
            if (!loc) continue; // CE：totalHeat 耗尽是 assert 级病态；丢弃该件（登记偏差）
            item.loc = { x: loc.x, y: loc.y };
            ports.items.push(item);
            // CE Items.c:736-738：对每件生成物（含食物路径）都在其落点降温。
            heatMap.coolHeatMapAt(loc.x, loc.y);
        }

        // CE Items.c:769-783：金币——主物品循环排除 GOLD（"so it's not a
        // punishment"），堆数与产量调度见上；每堆 quantity =
        // rand_range(50 + depth*10*accel, 100 + depth*15*accel)（Items.c:377），
        // 走热力图落位，并计入 goldGenerated。
        for (let i = 0; i < numGoldPiles; i++) {
            const quantity = rng.randRange(50 + ports.depth * 10 * 1, 100 + ports.depth * 15 * 1);
            const loc = heatMap.getItemSpawnLoc();
            if (!loc) break;
            heatMap.coolHeatMapAt(loc.x, loc.y);
            const gold = ItemLoader.spawnGold(quantity, loc.x, loc.y);
            if (gold) {
                ports.items.push(gold);
                ports.goldGenerated += quantity;
            }
        }

    }
