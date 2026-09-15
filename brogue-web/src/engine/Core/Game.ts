/**
 * src/engine/Core/Game.ts
 * Main game state and orchestration
 */
import { Grid, TerrainType, DCOLS, DROWS } from '../Map/Grid';
import { Architect } from '../Generator/Architect';
import type { MachineResult } from '../Generator/BlueprintEngine';
import blueprintData from '../../data/blueprints.json';
import { Player, type HungerState } from '../../entities/Player';
import { Monster, applyShieldStatus, monstersAreTeammates, monstersAreEnemies } from '../../entities/Monster';
import { CombatSystem } from '../Combat/Combat';
import { weaponParalysisDuration, weaponConfusionDuration, weaponForceDistance, netEnchant, reflectionChance, armorAbsorptionMax, armorReprisalPercent } from '../Combat/CombatFormulas';
import { ItemCategory, Item } from '../Items/Item';
import { ItemLoader, type ConsumableConfig } from '../Items/ItemLoader';
import { rng } from '../Random';
import monsterData from '../../data/monsters.json';
import hordeData from '../../data/hordes.json';
import mutationData from '../../data/mutations.json';
import type { MonsterData, MonsterAbility, MutationData } from '../../entities/Monster';
import { MonsterState } from '../../entities/Monster';
import { Direction, type Pos } from '../../types';
import { ensureEntityIdAbove, type StatusId, type Creature } from '../../entities/Creature';
import { timeSystem } from '../Systems/Time';
import { generateMonsterDetail, generateItemDetail, type DetailInfo } from '../UI/DetailGenerator';
import { logger } from '../Systems/Logger';
import { Pathfind } from '../Map/Pathfind';
import { DijkstraMap, MAX_DISTANCE } from '../Map/Pathfinding';
import { ScentMap, obstructsScent } from '../Map/Scent';
import { buildSafetyMap, allocShortGrid, SAFETY_MAX_DISTANCE } from '../Map/SafetyMap';
import { analyzeLoopMap, emptyLoopMap } from '../Map/LoopMap';
import { WaypointSystem, WAYPOINT_SIGHT_RADIUS, type WaypointContext } from '../Map/WaypointMap';
import i18next from 'i18next';

import { EnvironmentManager } from '../Environment/Gas';
import { FOVSys } from '../Lighting/FOV';
import { LightMap } from '../Lighting/LightMap';
import { FloatingText } from '../Visuals/FloatingText';
import { STATUS_CONFIG } from '../Status/statusConfig';
import { getBoltForItem, boltPath, buildBoltFrames, BoltEffect, MONSTER_BOLT_TABLE, type BoltConfig, type BoltFrame, type BoltResult } from '../Combat/Bolt';

export type GameMode = 'normal' | 'easy' | 'wizard' | 'test';

export interface HordeMemberEntry {
    type: string;
    minCount: number;
    maxCount: number;
}

export interface HordeEntry {
    leader: string;
    members: HordeMemberEntry[];
    minLevel: number;
    maxLevel: number;
    frequency: number;
    spawnsIn: string | null;
    machine: number;
    flags: string[];
}

// ---- CE horde 抽取常量（BrogueCE-master/src） ----

/** GlobalsBrogue.c:1024 monsterOutOfDepthChance = 10 */
const MONSTER_OUT_OF_DEPTH_CHANCE = 10;
/** GlobalsBrogue.c:43 AMULET_LEVEL = 26 */
const AMULET_LEVEL = 26;
/** RogueMain.c:403 / Time.c:2324 monsterSpawnFuse = rand_range(125, 175) */
const SPAWN_FUSE_MIN = 125;
const SPAWN_FUSE_MAX = 175;
/** Items.c:4899 discordBlast：monst->status[STATUS_DISCORDANT] = 30（CE 无独立常量，硬编码） */
const DISCORD_DURATION = 30;

/**
 * D2 标志：web 自创的"深水淹死"（怪物/玩家站在深水格即死）。
 * CE 无此机制——全 CE 源码 grep drown 零匹配；深水 tile（Globals.c:413 DEEP_WATER）
 * 不带任何伤害旗标，坠入深水零伤害（Time.c:1146-1150 "You fall into deep water,
 * unharmed."）。CE 的地形旗标定义：
 *   Rogue.h:1932  T_LAVA_INSTA_DEATH = Fl(8)   // kills any non-levitating non-fire-immune creature instantly
 *   Rogue.h:1937  T_IS_DEEP_WATER    = Fl(13)  // steals items 50% of the time and moves them around randomly
 * 即：唯一的即死地形是熔岩，深水只偷物品、不杀任何东西。
 * 按决策 D2（自创内容保留代码、退出生效路径）置 false；二次开发如需恢复
 * 该自创机制，改回 true 即可。
 */
const WEB_ONLY_DEEP_WATER_DROWNING: boolean = false;

/**
 * HORDE_MACHINE_ONLY 复合标志的成员（Rogue.h:2049-2055）。
 * 注意 HORDE_SACRIFICE_TARGET 与 HORDE_VAMPIRE_FODDER 都在其中，不单独列出。
 */
export const HORDE_MACHINE_ONLY_FLAGS: readonly string[] = [
    'HORDE_MACHINE_BOSS',
    'HORDE_MACHINE_WATER_MONSTER',
    'HORDE_MACHINE_CAPTIVE',
    'HORDE_MACHINE_STATUE',
    'HORDE_MACHINE_TURRET',
    'HORDE_MACHINE_MUD',
    'HORDE_MACHINE_KENNEL',
    'HORDE_VAMPIRE_FODDER',
    'HORDE_MACHINE_LEGENDARY_ALLY',
    'HORDE_MACHINE_THIEF',
    'HORDE_MACHINE_GOBLIN_WARREN',
    'HORDE_SACRIFICE_TARGET',
];

/** 开局铺怪禁用集（Monsters.c:1090 populateMonsters -> spawnHorde） */
export const HORDE_POPULATE_FORBIDDEN_FLAGS: readonly string[] = [
    'HORDE_IS_SUMMONED',
    ...HORDE_MACHINE_ONLY_FLAGS,
];

/** 周期刷怪禁用集（Monsters.c:1133 spawnPeriodicHorde -> spawnHorde） */
export const HORDE_PERIODIC_FORBIDDEN_FLAGS: readonly string[] = [
    'HORDE_IS_SUMMONED',
    'HORDE_LEADER_CAPTIVE',
    'HORDE_NO_PERIODIC_SPAWN',
    ...HORDE_MACHINE_ONLY_FLAGS,
];

export interface GameSnapshotItem {
    id: number;
    name: string;
    char: string;
    color: number;
    category: number;
    loc: Pos;
    weight: number;
    quantity?: number;
    damage?: string;
    armor?: number;
    strengthRequired?: number;
    isCursed: boolean;
    isProtected?: boolean;
    enchantment: number;
    runicType?: string;
    runicKnown?: boolean;
    consumableId?: string;
    maxCharges?: number;
    charges?: number;
    rechargeTurns?: number;
    rechargeCounter?: number;
    cooldownTurns?: number;
    cooldownRemaining?: number;
    identityId?: string;
}

export interface GameSnapshot {
    version: number;
    savedAt: number;
    depth: number;
    seed: number;
    mode: GameMode;
    player: {
        loc: Pos;
        hp: number;
        maxHp: number;
        strength: number;
        nutrition: number;
        maxNutrition: number;
        statusDurations?: Partial<Record<StatusId, number>>;
        inventory: GameSnapshotItem[];
        equippedWeaponId: number | null;
        equippedArmorId: number | null;
        equippedRingId?: number | null;
        temporaryImmunities?: Partial<Record<StatusId, number>>;
    };
    monsters: Array<{
        id: number;
        loc: Pos;
        name: string;
        char: string;
        color: number;
        hp: number;
        maxHp: number;
        damageString: string;
        state: number;
        statusDurations?: Partial<Record<StatusId, number>>;
        goldDropChance: number;
        itemDropChance: number;
        onHitStatus?: StatusId;
        onHitChance?: number;
        onHitDuration?: number;
        statusImmunities?: StatusId[];
        statusResistTurns?: Partial<Record<StatusId, number>>;
        abilities?: string[];
    }>;
    items: GameSnapshotItem[];
    grid: Array<{
        x: number;
        y: number;
        terrain: TerrainType;
        char: string;
        color: number;
        isExplored: boolean;
        hasMemory: boolean;
        isBurning: boolean;
        burnDuration: number;
        isPassable: boolean;
        isOpaque: boolean;
    }>;
    gasGrid: Array<{
        x: number;
        y: number;
        type: number;
        density: number;
    }>;
    stats?: {
        kills: number;
        gold: number;
        turns: number;
        maxDepth: number;
    };
}

export interface LevelState {
    grid: Grid;
    environment: EnvironmentManager;
    fov: FOVSys;
    lightMap: LightMap;
    monsters: Monster[];
    items: Item[];
    visibleMonsters: Set<Monster>;
    visibleItems: Set<Item>;
    /** P1-31：该层的机器格集合（CE pmap machineNumber 派生），随层缓存。 */
    machineCells?: Set<number>;
}

export type RecordedInputData = number | { x: number; y: number } | string | null;

export interface RecordedInputEvent {
    index: number;
    tick: number;
    depth: number;
    player: Pos;
    action: string;
    data: RecordedInputData;
}

export interface GameRecording {
    version: number;
    recordedAt: number;
    seed: number;
    mode: GameMode;
    startDepth: number;
    events: RecordedInputEvent[];
}

type ReplayStatus = 'idle' | 'loaded' | 'playing' | 'finished';
type TestAssetCategory = 'weapons' | 'wands' | 'scrolls' | 'potions' | 'other' | 'terrain' | 'enemies' | 'blueprints' | 'runics';

interface TestRoomState {
    id: number;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    baselineItems: GameSnapshotItem[];
    baselineMonsters: Array<{
        id: number;
        loc: Pos;
        name: string;
        char: string;
        color: number;
        hp: number;
        maxHp: number;
        damageString: string;
        state: number;
        statusDurations?: Partial<Record<StatusId, number>>;
        goldDropChance: number;
        itemDropChance: number;
        onHitStatus?: StatusId;
        onHitChance?: number;
        onHitDuration?: number;
        statusImmunities?: StatusId[];
        statusResistTurns?: Partial<Record<StatusId, number>>;
    }>;
    baselineTerrains: Array<{
        x: number;
        y: number;
        terrain: TerrainType;
        char: string;
        color: number;
        isPassable: boolean;
        isOpaque: boolean;
    }>;
}

export class Game {
    public grid!: Grid;
    public environment!: EnvironmentManager;
    public fov!: FOVSys;
    public lightMap!: LightMap;
    public player: Player;
    public autoPath: Pos[] = [];
    public monsters: Monster[] = [];
    public items: Item[] = [];
    public visibleMonsters = new Set<Monster>();
    public visibleItems = new Set<Item>();
    public isMouseTraveling: boolean = false;
    public everSeenItems: Set<Item> = new Set();
    public everSeenMonsters: Set<Monster> = new Set();
    public travelTargetItem: Item | undefined = undefined;
    public floatingTexts: FloatingText[] = [];

    // Callback to trigger re-renders
    public onRenderRequested: (() => void) | null = null;

    private needsRender: boolean = true;
    public isInventoryOpen: boolean = false;

    public isThrowing: boolean = false;
    public throwItemTarget: Item | null = null;

    public isExamining: boolean = false;
    public inspectTarget: DetailInfo | null = null;
    public examinedEntityIds = new Set<string | number>();

    public depth: number = 1;
    public mode: GameMode = 'normal';
    public currentSeed: number = 0;

    // Time.c:2666 每回合递减；归零触发周期刷怪（Monsters.c:1128 spawnPeriodicHorde）
    public monsterSpawnFuse: number = 0;

    // CE rogue.ticksTillUpdateEnvironment（RogueMain.c:404 初值 100）：客观时间门。
    // P2-3 起作为 advancementLoop soonestTurn 的第三候选（Time.c:2651-2652），
    // 每 100 tick 触发一次 objectiveTimeBlock。
    public ticksTillUpdateEnvironment: number = 100;

    // P4-8：当前层的气味图（CE scentMap + rogue.scentTurnNumber）。每层生成时
    // 换新图（CE 跨层留存 levels[d].scentMap，web 不做多层留存）；每玩家回合
    // 在 playerTurnEnded 的主观时间块里重刷一次（CE Time.c:2610）。
    public scent: ScentMap = new ScentMap(DCOLS, DROWS);

    // P4-9：safety map（CE 全局 safetyMap，Time.c:1791 updateSafetyMap 构建）。
    // 每玩家回合最多重算一次（rogue.updatedSafetyMapThisTurn，Rogue.h:2452）：
    // 回合开始清零（Time.c:2616），有可见逃跑怪时主动预更新一次
    //（Time.c:2618-2626），其余由 getSafetyMap 惰性触发（Monsters.c:2386/2392）。
    public safetyMap: number[][] = allocShortGrid(DCOLS, DROWS, SAFETY_MAX_DISTANCE);
    public updatedSafetyMapThisTurn: boolean = false;

    // C-0：当前层的环路图（CE pmap 的 IN_LOOP 标志，Architect.c:192-244
    // analyzeMap 前三步）。进层时随地形确定性重算（生成完成 + 缓存恢复都算，
    // 对应 CE 的逐层 pmap flags；纯函数、零 RNG 消耗）。safety map 的
    // IN_LOOP -=10 分支由此供数（Time.c:1925-1927）。CE 运行期另有
    // staleLoopMap 触发的回合期重算（Time.c:2554-2556），web 本轮无地形
    // 晋升的中央挂钩，暂只在进层时计算（LoopMap.ts 头注已登记）。
    public loopMap: boolean[][] = emptyLoopMap();

    // P4-10：waypoint 系统（CE rogue.wpCoordinates/wpDistance/wpCount/
    // wpRefreshTicker）。构建在 generateDepth 的生成决策全部完成之后
    //（CE RogueMain.c:707：digDungeon → placeStairs → initializeLevel →
    // setUpWaypoints）；重访缓存层同样重建（CE RogueMain.c:771）；每 100 tick
    // 客观块滚动刷新一个（CE Time.c:2710-2714）。构建内部对流做了隔离
    //（RogueMain.c:691-707/733-735 的快照/恢复复刻），不移动 RNG 流。
    public waypoints: WaypointSystem = new WaypointSystem();

    // P1-31：本层机器格（CE pmap 的 IS_IN_MACHINE 旗标，Architect.c 生成期
    // 写入 machineNumber）。数据源是 BlueprintEngine 的 MachineResult.cells，
    // 仅新层生成期可得：重访层经 LevelState 缓存随层走；快照 schema 无此
    // 字段，读档后为空集（P1-35 复核登记，落位检查在该层退化为不查机器）。
    private machineCells: Set<number> = new Set();

    // Endgame & Stats
    public isGameOver: boolean = false;
    public gameOverWon: boolean = false;
    public gameOverReason: string = '';
    public stats = {
        kills: 0,
        gold: 0,
        turns: 0,
        maxDepth: 1
    };
    public lastDamageSource: string = '';
    public gameOverInventory: Array<{ name: string; category: number; enchantment: number; color: number }> = [];
    public gameOverScore: number = 0;

    public levels = new Map<number, LevelState>();
    public combatSystem: CombatSystem = new CombatSystem();
    public recordingStartAt: number = Date.now();
    public recordedInputEvents: RecordedInputEvent[] = [];
    private recordedInputIndex: number = 0;
    public replayRecording: GameRecording | null = null;
    public replayEvents: RecordedInputEvent[] = [];
    public replayCursor: number = 0;
    public replayStatus: ReplayStatus = 'idle';
    private replayFrameAccumulator: number = 0;
    private readonly replayFramesPerStep: number = 6;
    public signTexts = new Map<string, string>();
    public resetPlateRoomByPos = new Map<string, number>();
    public testRooms = new Map<number, TestRoomState>();
    public currentTestCategory: TestAssetCategory | null = null;

    constructor() {
        const startX = Math.floor(DCOLS / 2);
        const startY = Math.floor(DROWS / 2);
        this.player = new Player(startX, startY);
        this.startNewGame();
    }

    public startNewGame(options?: { seed?: number; mode?: GameMode }) {
        this.mode = options?.mode ?? 'normal';
        this.currentSeed = rng.seedRandomGenerator(options?.seed ?? 0);

        ItemLoader.initConsumables();
        logger.messages = [];
        timeSystem.currentTick = 0;

        this.depth = 1;
        this.levels.clear();
        this.monsters = [];
        this.items = [];
        this.visibleMonsters.clear();
        this.visibleItems.clear();
        this.autoPath = [];
        this.discardInFlightAdvancement();
        this.everSeenItems.clear();
        this.everSeenMonsters.clear();
        this.isMouseTraveling = false;
        this.isInventoryOpen = false;
        this.isThrowing = false;
        this.throwItemTarget = null;
        this.hoveredCell = null;
        this.hoveredText = '';
        this.floatingTexts = [];
        this.recordingStartAt = Date.now();
        this.recordedInputEvents = [];
        this.recordedInputIndex = 0;
        this.clearReplay();
        this.signTexts.clear();
        this.resetPlateRoomByPos.clear();
        this.testRooms.clear();
        this.currentTestCategory = null;

        this.player = new Player(Math.floor(DCOLS / 2), Math.floor(DROWS / 2));
        // RogueMain.c:403：monsterSpawnFuse 在开局时初始化（先于首层生成，保证 rng 流稳定）
        this.monsterSpawnFuse = rng.randRange(SPAWN_FUSE_MIN, SPAWN_FUSE_MAX);
        // RogueMain.c:404：客观时间门复位
        this.ticksTillUpdateEnvironment = 100;
        if (this.mode === 'easy') {
            this.player.maxHp = 45;
            this.player.hp = 45;
            this.player.strength = 14;
        } else if (this.mode === 'wizard') {
            this.player.maxHp = 999;
            this.player.hp = 999;
            this.player.strength = 18;
        }

        // 开局装备对齐 BrogueCE RogueMain.c:420-443：口粮 → 匕首 → 飞镖×15 → 皮甲。
        // 发放顺序不可调整：物品创建与生成会消耗全局 rng，回放系统依赖该顺序的确定性。
        const ration = ItemLoader.spawnFood('ration_of_food', -1, -1);
        if (ration) this.player.inventory.addItem(ration);

        const dagger = ItemLoader.spawnWeapon('dagger', -1, -1);
        if (dagger) {
            dagger.enchantment = 0;
            dagger.isCursed = false;
            dagger.runicType = undefined;
            dagger.runicKnown = true;
            this.player.inventory.addItem(dagger);
            this.player.equip(dagger);
        }

        const dart = ItemLoader.spawnWeapon('dart', -1, -1);
        if (dart) {
            dart.enchantment = 0;
            dart.isCursed = false;
            dart.runicType = undefined;
            dart.runicKnown = true;
            dart.quantity = 15;
            this.player.inventory.addItem(dart);
        }

        const leatherArmor = ItemLoader.spawnArmor('leather_armor', -1, -1);
        if (leatherArmor) {
            leatherArmor.enchantment = 0;
            leatherArmor.isCursed = false;
            leatherArmor.runicType = undefined;
            leatherArmor.runicKnown = true;
            this.player.inventory.addItem(leatherArmor);
            this.player.equip(leatherArmor);
        }

        this.generateDepth(false, true);
        this.needsRender = true;
        this.update();
    }

    private applyRandomMutation(mon: Monster, depth: number) {
        if (depth <= 10) return;
        if (mon.hasBehavior('MONST_NEVER_MUTATED') || mon.hasBehavior('MONST_INANIMATE') || mon.hasAbility('MA_NEVER_MUTATED') || mon.isCaged) return;

        const mutationChance = Math.min(75, (depth - 10) * 2); // Linear scale, 2% at D11, 32% at D26
        if (rng.randPercent(mutationChance)) {
            const validMutations = (mutationData as MutationData[]).filter(m => {
                if (m.forbiddenFlags && m.forbiddenFlags.some(f => mon.hasBehavior(f))) return false;
                if (m.forbiddenAbilityFlags && m.forbiddenAbilityFlags.some(f => mon.hasAbility(f))) return false;
                return true;
            });
            if (validMutations.length > 0) {
                const mut = validMutations[rng.randRange(0, validMutations.length - 1)];
                mon.mutate(mut as MutationData);
            }
        }
    }

    /** Resolve a blueprint item spawn category string to an actual item */
    private spawnBlueprintItem(category: string, id: string | undefined, x: number, y: number, depth: number): Item | null {
        if (id) {
            // Specific item
            if (category === 'SCROLL') return ItemLoader.spawnScroll(id, x, y);
            if (category === 'POTION') return ItemLoader.spawnPotion(id, x, y);
            if (category === 'KEY') return ItemLoader.spawnKey(id, x, y);
            return null;
        }

        // Resolve by category
        switch (category) {
            case 'SCROLL': {
                const scrolls = ItemLoader.genScrolls;
                if (scrolls.length > 0) return ItemLoader.spawnScroll(scrolls[rng.randRange(0, scrolls.length - 1)]!.id, x, y);
                return null;
            }
            case 'POTION': {
                const potions = ItemLoader.genPotions;
                if (potions.length > 0) return ItemLoader.spawnPotion(potions[rng.randRange(0, potions.length - 1)]!.id, x, y);
                return null;
            }
            case 'WEAPON': {
                const weapons = ItemLoader.genWeapons;
                if (weapons.length > 0) return ItemLoader.spawnWeapon(weapons[rng.randRange(0, weapons.length - 1)]!.id, x, y);
                return null;
            }
            case 'ARMOR': {
                const armors = ItemLoader.genArmors;
                if (armors.length > 0) return ItemLoader.spawnArmor(armors[rng.randRange(0, armors.length - 1)]!.id, x, y);
                return null;
            }
            case 'KEY': return ItemLoader.spawnKey('iron_key', x, y);
            case '_random_good_': {
                // Pick a random high-value item
                const roll = rng.randRange(0, 5);
                if (roll === 0) {
                    const wands = ItemLoader.genWands.filter(w => depth >= w.minDepth && depth <= w.maxDepth);
                    if (wands.length > 0) return ItemLoader.spawnWand(wands[rng.randRange(0, wands.length - 1)]!.id, x, y);
                }
                if (roll === 1) {
                    const staffs = ItemLoader.genStaffs.filter(s => depth >= s.minDepth && depth <= s.maxDepth);
                    if (staffs.length > 0) return ItemLoader.spawnStaff(staffs[rng.randRange(0, staffs.length - 1)]!.id, x, y);
                }
                if (roll === 2) {
                    const rings = ItemLoader.genRings.filter(r => depth >= r.minDepth && depth <= r.maxDepth);
                    if (rings.length > 0) return ItemLoader.spawnRing(rings[rng.randRange(0, rings.length - 1)]!.id, x, y);
                }
                if (roll === 3) {
                    const charms = ItemLoader.genCharms.filter(c => depth >= c.minDepth && depth <= c.maxDepth);
                    if (charms.length > 0) return ItemLoader.spawnCharm(charms[rng.randRange(0, charms.length - 1)]!.id, x, y);
                }
                if (roll === 4) return ItemLoader.spawnScroll('scroll_of_enchantment', x, y);
                return ItemLoader.spawnPotion('potion_of_life', x, y);
            }
            default:
                return null;
        }
    }

    /** Resolve a blueprint monster ID placeholder to actual MonsterData */
    private resolveBlueprintMonster(monsterId: string, depth: number): MonsterData | null {
        const allMonsters = monsterData as MonsterData[];
        const depthMonsters = allMonsters.filter(m => !m.machineOnly && depth >= m.minDepth && depth <= m.maxDepth);

        if (monsterId === '_depth_appropriate_') {
            if (depthMonsters.length === 0) return null;
            return depthMonsters[rng.randRange(0, depthMonsters.length - 1)]!;
        }
        if (monsterId === '_depth_boss_') {
            // Pick the strongest monster available at this depth
            if (depthMonsters.length === 0) return null;
            const sorted = [...depthMonsters].sort((a, b) => (b.hp ?? 0) - (a.hp ?? 0));
            return sorted[0]!;
        }
        if (monsterId === '_spider_') {
            // Try to find a spider-like monster, fallback to depth appropriate
            const spider = allMonsters.find(m => m.id === 'spider');
            if (spider && depth >= spider.minDepth && depth <= spider.maxDepth) return spider;
            if (depthMonsters.length === 0) return null;
            return depthMonsters[rng.randRange(0, depthMonsters.length - 1)]!;
        }
        if (monsterId === '_random_ally_') {
            // Pick a weaker monster as ally
            if (depthMonsters.length === 0) return null;
            const sorted = [...depthMonsters].sort((a, b) => (a.hp ?? 0) - (b.hp ?? 0));
            return sorted[rng.randRange(0, Math.min(2, sorted.length - 1))]!;
        }

        // Specific monster ID
        return allMonsters.find(m => m.id === monsterId) ?? null;
    }

    private generateDepth(isGoingUp: boolean = false, isFirstLevel: boolean = false) {
        if (this.mode === 'test') {
            this.generateTestDepth(isFirstLevel);
            // P4-10：test 层同样建 waypoint（CE RogueMain.c:707 的位置——
            // 该层的全部生成决策已完成之后）。
            this.rebuildWaypoints();
            this.fov.computeFOV(this.player.loc.x, this.player.loc.y, 10);
            this.onRenderRequested?.();
            return;
        }

        // Save current level state if it exists
        if (this.grid && !isFirstLevel) {
            this.levels.set(isGoingUp ? this.depth + 1 : this.depth - 1, {
                grid: this.grid,
                environment: this.environment,
                fov: this.fov,
                lightMap: this.lightMap,
                monsters: this.monsters,
                items: this.items,
                visibleMonsters: this.visibleMonsters,
                visibleItems: this.visibleItems,
                machineCells: this.machineCells
            });
        }

        const cached = this.levels.get(this.depth);

        if (cached) {
            // Restore from cache
            this.grid = cached.grid;
            this.environment = cached.environment;
            this.fov = cached.fov;
            this.lightMap = cached.lightMap;
            this.monsters = cached.monsters;
            this.items = cached.items;
            this.visibleMonsters = cached.visibleMonsters;
            this.visibleItems = cached.visibleItems;
            this.machineCells = cached.machineCells ?? new Set();

            // Reposition player to stairs（P1-31：落位走 CE RogueMain.c:837-869，
            // 先置楼梯位再向 4 邻域找合格格——不再直接站上楼梯）
            const targetStairType = isGoingUp ? TerrainType.STAIRS_DOWN : TerrainType.STAIRS_UP;
            let entryStair: Pos | null = null;
            for (let x = 0; x < this.grid.width; x++) {
                for (let y = 0; y < this.grid.height; y++) {
                    if (this.grid.getCell(x, y)?.terrain === targetStairType) {
                        entryStair = { x, y };
                        break;
                    }
                }
                if (entryStair) break;
            }
            if (entryStair) this.placePlayerOnLevelEntry(entryStair);
        } else {
            // 1. Generate new level
            this.stats.maxDepth = Math.max(this.stats.maxDepth, this.depth);
            const architect = new Architect();
            this.grid = architect.generateLevel(this.depth);
            this.environment = new EnvironmentManager(this.grid);
            this.fov = new FOVSys(this.grid);
            this.lightMap = new LightMap(this.grid);
            // P4-8：新层新气味图（CE 跨层留存 levels[d].scentMap，web 不做）
            this.scent = new ScentMap(DCOLS, DROWS);

            // Fresh state for new level
            this.monsters = [];
            this.items = [];
            this.visibleMonsters.clear();
            this.visibleItems.clear();

            // 2. Populate level with monsters and items, and STAIRS
            this.populateLevel(
                this.depth, isGoingUp, isFirstLevel,
                architect.machines, architect.altars, architect.trapVaults, architect.cages,
                architect.machineResults
            );
        }

        // P4-10：waypoint 构建。CE RogueMain.c:707 的位置——新层的全部生成
        // 决策（地形/物品/怪物）已由上方 populateLevel 完成；重访层（cached
        // 分支）对应 RogueMain.c:771 的"恢复后再建"。setUpWaypoints 内部做了
        // CE RogueMain.c:691-707/733-735 的流隔离（快照/恢复），shuffleList
        // 的抽取不落在主流上，对生成基线与玩法序列都是零扰动。
        // C-0：环路图同样在两层落地后确定性重算（CE 的 IN_LOOP 是逐层
        // pmap flags；analyzeLoopMap 纯函数、不消费 RNG）。
        this.loopMap = analyzeLoopMap(this.grid);
        this.rebuildWaypoints();

        // 3. Force full refresh
        this.fov.computeFOV(this.player.loc.x, this.player.loc.y, 10);
        this.onRenderRequested?.();
    }

    private populateLevel(
        depth: number,
        isGoingUp: boolean = false,
        isFirstLevel: boolean = false,
        machines: Array<{ door: Pos, center: Pos }> = [],
        altars: Array<{ door: Pos, positions: Pos[], groupId: number }> = [],
        trapVaults: Array<{ door: Pos, center: Pos, trapType: 'fire' | 'poison_gas' }> = [],
        cages: Array<{ door: Pos, cells: Pos[] }> = [],
        machineResults: MachineResult[] = []
    ) {
        // P1-31：本层机器格（CE pmap IS_IN_MACHINE，落位排除项之一）。
        this.machineCells = new Set();
        for (const mr of machineResults) {
            for (const c of mr.cells) this.machineCells.add(c.y * DCOLS + c.x);
        }

        // Collect all valid floor tiles
        const floorTiles: Pos[] = [];
        for (let x = 1; x < DCOLS - 1; x++) {
            for (let y = 1; y < DROWS - 1; y++) {
                if (this.grid.getCell(x, y)?.terrain === TerrainType.FLOOR) {
                    // Don't spawn right on top of player
                    if (Math.abs(x - this.player.loc.x) > 5 || Math.abs(y - this.player.loc.y) > 5) {
                        floorTiles.push({ x, y });
                    }
                }
            }
        }

        rng.shuffleList(floorTiles);

        // Place stairs Down (not on depth 26 - the amulet floor is the deepest)
        let stairsDownPos: Pos | null = null;
        if (floorTiles.length > 0 && this.depth < 26) {
            stairsDownPos = floorTiles.pop()!;
            this.grid.setTerrain(stairsDownPos.x, stairsDownPos.y, TerrainType.STAIRS_DOWN, '>', 0x00aaff);
        }

        // Place stairs Up
        let stairsUpPos: Pos | null = null;
        if (this.depth > 1 && floorTiles.length > 0) {
            stairsUpPos = floorTiles.pop()!;
            this.grid.setTerrain(stairsUpPos.x, stairsUpPos.y, TerrainType.STAIRS_UP, '<', 0xffaa00);
        } else if (this.depth === 1) {
            stairsUpPos = { x: Math.floor(DCOLS / 2), y: Math.floor(DROWS / 2) }; // Default vestibule
            this.grid.setTerrain(stairsUpPos.x, stairsUpPos.y, TerrainType.STAIRS_UP, '<', 0xffaa00);
        }

        // Spawn Amulet of Yendor on bottom floor
        if (this.depth === 26 && floorTiles.length > 0) {
            const hasAmuletInWorld = this.items.some(i => i.category === ItemCategory.AMULET && (i as any).identityId === 'amulet_of_yendor');
            const hasAmuletInInv = this.player.inventory.items.some(i => i.category === ItemCategory.AMULET && (i as any).identityId === 'amulet_of_yendor');
            if (!hasAmuletInWorld && !hasAmuletInInv) {
                const amuletPosIdx = rng.randRange(0, floorTiles.length - 1);
                const amuletPos = floorTiles[amuletPosIdx]!;
                const amulet = ItemLoader.spawnAmulet('amulet_of_yendor', amuletPos.x, amuletPos.y);
                if (amulet) {
                    this.items.push(amulet);
                    floorTiles.splice(amuletPosIdx, 1);
                }
            }
        }

        // Spawn keys and treasures for Machine Rooms
        for (const machine of machines) {
            // Spawn Key somewhere in the level
            if (floorTiles.length > 0) {
                const keyPos = floorTiles.pop()!;
                const key = ItemLoader.spawnKey('iron_key', keyPos.x, keyPos.y);
                if (key) this.items.push(key);
            }

            // Spawn Treasure in the machine room
            // Let's just pick one random good item: scroll of enchanting or wand of fire
            let treasure;
            if (rng.randPercent(50)) {
                treasure = ItemLoader.spawnScroll('scroll_of_enchanting', machine.center.x, machine.center.y);
            } else {
                // D2：原为硬编码 spawnWand('wand_of_fire')（web 自创，退出生成池），
                // 改为从魔杖生成池按深度抽取；池空则不放置宝藏。
                const validWands = ItemLoader.genWands.filter(w => depth >= w.minDepth && depth <= w.maxDepth);
                if (validWands.length > 0) {
                    treasure = ItemLoader.spawnWand(validWands[rng.randRange(0, validWands.length - 1)]!.id, machine.center.x, machine.center.y);
                }
            }
            if (treasure) this.items.push(treasure);
        }

        // Spawn items on Altars
        for (const altarRoom of altars) {
            for (const pos of altarRoom.positions) {
                // Altar items should be highly desirable. Let's spawn random wands, staffs, rings, charms, or enchants.
                const randType = rng.randRange(0, 4);
                let vaultItem = null;

                if (randType === 0) {
                    const validWands = ItemLoader.genWands.filter(w => depth >= w.minDepth && depth <= w.maxDepth);
                    if (validWands.length > 0) vaultItem = ItemLoader.spawnWand(validWands[rng.randRange(0, validWands.length - 1)]!.id, pos.x, pos.y);
                } else if (randType === 1) {
                    const validStaffs = ItemLoader.genStaffs.filter(s => depth >= s.minDepth && depth <= s.maxDepth);
                    if (validStaffs.length > 0) vaultItem = ItemLoader.spawnStaff(validStaffs[rng.randRange(0, validStaffs.length - 1)]!.id, pos.x, pos.y);
                } else if (randType === 2) {
                    const validRings = ItemLoader.genRings.filter(r => depth >= r.minDepth && depth <= r.maxDepth);
                    if (validRings.length > 0) vaultItem = ItemLoader.spawnRing(validRings[rng.randRange(0, validRings.length - 1)]!.id, pos.x, pos.y);
                } else if (randType === 3) {
                    const validCharms = ItemLoader.genCharms.filter(c => depth >= c.minDepth && depth <= c.maxDepth);
                    if (validCharms.length > 0) vaultItem = ItemLoader.spawnCharm(validCharms[rng.randRange(0, validCharms.length - 1)]!.id, pos.x, pos.y);
                } else {
                    vaultItem = ItemLoader.spawnScroll('scroll_of_enchantment', pos.x, pos.y);
                }

                if (!vaultItem) {
                    // Fallback
                    vaultItem = ItemLoader.spawnPotion('potion_of_life', pos.x, pos.y);
                }

                if (vaultItem) {
                    // Mark as floating / special color to stand out on the altar
                    this.items.push(vaultItem);
                }
            }
        }

        // Spawn items and keys for Trap Vaults (usually require a key if locked, but traps are just open rooms sometimes; here they are locked)
        for (const vault of trapVaults) {
            // Spawn Key
            if (floorTiles.length > 0) {
                const keyPos = floorTiles.pop()!;
                const key = ItemLoader.spawnKey('iron_key', keyPos.x, keyPos.y);
                if (key) this.items.push(key);
            }

            let treasure;
            if (rng.randPercent(40)) {
                // Charms or rings
                if (rng.randPercent(50)) {
                    const validRings = ItemLoader.genRings.filter(r => depth >= r.minDepth && depth <= r.maxDepth);
                    if (validRings.length > 0) treasure = ItemLoader.spawnRing(validRings[rng.randRange(0, validRings.length - 1)]!.id, vault.center.x, vault.center.y);
                } else {
                    const validCharms = ItemLoader.genCharms.filter(c => depth >= c.minDepth && depth <= c.maxDepth);
                    if (validCharms.length > 0) treasure = ItemLoader.spawnCharm(validCharms[rng.randRange(0, validCharms.length - 1)]!.id, vault.center.x, vault.center.y);
                }
            } else {
                treasure = ItemLoader.spawnPotion('potion_of_life', vault.center.x, vault.center.y);
            }
            if (treasure) this.items.push(treasure);
        }

        // Filter valid monsters by depth (exclude machine-only monsters from normal spawning)
        const validMonsters = (monsterData as MonsterData[]).filter(m =>
            !m.machineOnly &&
            depth >= m.minDepth &&
            depth <= m.maxDepth
        );

        // Spawn caged monsters
        for (const cage of cages) {
            // Spawn Key
            if (floorTiles.length > 0) {
                const keyPos = floorTiles.pop()!;
                const key = ItemLoader.spawnKey('iron_key', keyPos.x, keyPos.y);
                if (key) this.items.push(key);
            }
            // Spawn a monster inside
            if (cage.cells.length > 0 && validMonsters.length > 0) {
                const pos = cage.cells[0]!;
                const mData = validMonsters[rng.randRange(0, validMonsters.length - 1)];
                if (mData) {
                    const mon = new Monster(pos.x, pos.y, mData);
                    mon.isCaged = true;
                    this.monsters.push(mon);
                }
            }
        }

        // --- Blueprint Engine Machine Spawning ---
        for (const mr of machineResults) {
            // Spawn keys for locked doors
            if (mr.needsKey && floorTiles.length > 0) {
                const keyPos = floorTiles.pop()!;
                const key = ItemLoader.spawnKey('iron_key', keyPos.x, keyPos.y);
                if (key) this.items.push(key);
            }

            // Spawn items
            for (const spawn of mr.itemSpawns) {
                const item = this.spawnBlueprintItem(spawn.category, spawn.id, spawn.pos.x, spawn.pos.y, depth);
                if (item) this.items.push(item);
            }

            // Spawn monsters
            for (const spawn of mr.monsterSpawns) {
                const mData = this.resolveBlueprintMonster(spawn.monsterId, depth);
                if (mData) {
                    const mon = new Monster(spawn.pos.x, spawn.pos.y, mData);
                    if (spawn.isAlly) mon.isAlly = true;
                    if (spawn.isCaged) mon.isCaged = true;
                    this.applyRandomMutation(mon, depth);
                    this.monsters.push(mon);
                }
            }
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
            const spawn = this.rollSpawnDepth(depth);
            const forbidden = spawn.outOfDepth
                ? [...HORDE_POPULATE_FORBIDDEN_FLAGS, 'HORDE_NEVER_OOD']
                : HORDE_POPULATE_FORBIDDEN_FLAGS;
            const candidates = this.hordeCandidates(spawn.depth, forbidden);

            // Monsters.c:830-868：failsafe 50 —— 先抽 horde，再依其 spawnsIn 地形感知找落格
            //（CE randomMatchingLocation(loc, FLOOR, NOTHING, spawnsIn ? spawnsIn : -1)）：
            // spawnsIn 有值走全图地形匹配（findTerrainSpawnLocation），为空仍从 FLOOR
            // 池取格（保持既有行为）；找不到匹配格则重抽 horde（CE 同样在重试时重掷
            // pickHordeType）
            let hData: HordeEntry | null = null;
            let centerPos: Pos | null = null;
            for (let failsafe = 50; failsafe > 0; failsafe--) {
                const cand = this.pickHordeType(candidates);
                if (!cand) break;
                if (cand.spawnsIn) {
                    const pos = this.findTerrainSpawnLocation(cand.spawnsIn);
                    if (pos) {
                        hData = cand;
                        centerPos = pos;
                        break;
                    }
                } else if (floorTiles.length > 0) {
                    const idx = rng.randRange(0, floorTiles.length - 1);
                    const pos = floorTiles[idx]!;
                    if (this.hordeFitsTerrain(cand, pos)) {
                        hData = cand;
                        centerPos = pos;
                        floorTiles.splice(idx, 1);
                        break;
                    }
                }
            }
            if (!hData || !centerPos) continue;

            this.spawnHordeAt(hData, centerPos, depth, false, floorTiles);
        }

        const numItems = rng.randRange(3, 6);
        for (let i = 0; i < numItems && floorTiles.length > 0; i++) {
            const pos = floorTiles.pop()!;

            // Temporary expanded loot table
            const randType = rng.randRange(0, 9);
            let item;
            if (randType === 0) {
                const id = rng.randPercent(50) ? 'dagger' : 'sword';
                item = ItemLoader.spawnWeapon(id, pos.x, pos.y);
            } else if (randType === 1) {
                const id = rng.randPercent(50) ? 'leather_armor' : 'chain_mail';
                item = ItemLoader.spawnArmor(id, pos.x, pos.y);
            } else if (randType === 2) {
                const validPotions = ItemLoader.genPotions.filter(p => depth >= p.minDepth && depth <= p.maxDepth);
                if (validPotions.length > 0) {
                    const id = validPotions[rng.randRange(0, validPotions.length - 1)]!.id;
                    item = ItemLoader.spawnPotion(id, pos.x, pos.y);
                }
            } else if (randType === 3) {
                const validScrolls = ItemLoader.genScrolls.filter(s => depth >= s.minDepth && depth <= s.maxDepth);
                if (validScrolls.length > 0) {
                    const id = validScrolls[rng.randRange(0, validScrolls.length - 1)]!.id;
                    item = ItemLoader.spawnScroll(id, pos.x, pos.y);
                }
            } else if (randType === 4) {
                const validWands = ItemLoader.genWands.filter(w => depth >= w.minDepth && depth <= w.maxDepth);
                if (validWands.length > 0) {
                    const id = validWands[rng.randRange(0, validWands.length - 1)]!.id;
                    item = ItemLoader.spawnWand(id, pos.x, pos.y);
                }
            } else if (randType === 5) {
                const validStaffs = ItemLoader.genStaffs.filter(s => depth >= s.minDepth && depth <= s.maxDepth);
                if (validStaffs.length > 0) {
                    const id = validStaffs[rng.randRange(0, validStaffs.length - 1)]!.id;
                    item = ItemLoader.spawnStaff(id, pos.x, pos.y);
                }
            } else if (randType === 6) {
                const validRings = ItemLoader.genRings.filter(r => depth >= r.minDepth && depth <= r.maxDepth);
                if (validRings.length > 0) {
                    const id = validRings[rng.randRange(0, validRings.length - 1)]!.id;
                    item = ItemLoader.spawnRing(id, pos.x, pos.y);
                }
            } else if (randType === 7) {
                const validCharms = ItemLoader.genCharms.filter(c => depth >= c.minDepth && depth <= c.maxDepth);
                if (validCharms.length > 0) {
                    const id = validCharms[rng.randRange(0, validCharms.length - 1)]!.id;
                    item = ItemLoader.spawnCharm(id, pos.x, pos.y);
                }
            } else if (randType === 8) {
                if (rng.randPercent(10)) {
                    const validAmulets = ItemLoader.genAmulets.filter(a => depth >= a.minDepth && depth <= a.maxDepth);
                    if (validAmulets.length > 0) {
                        const id = validAmulets[rng.randRange(0, validAmulets.length - 1)]!.id;
                        item = ItemLoader.spawnAmulet(id, pos.x, pos.y);
                    }
                } else {
                    const validKeys = ItemLoader.genKeys.filter(k => depth >= k.minDepth && depth <= k.maxDepth);
                    if (validKeys.length > 0) {
                        const id = validKeys[rng.randRange(0, validKeys.length - 1)]!.id;
                        item = ItemLoader.spawnKey(id, pos.x, pos.y);
                    }
                }
            }

            if (item) {
                this.items.push(item);
            }
        }

        // P1-31：进层落位（CE RogueMain.c:817-869 "Position the player"，
        // 在全部生成决策完成之后执行）。CE stairDirection=±1 时先把玩家
        // 置于目标楼梯位、再向 4 邻域找合格格；web 首层的"强制 vestibule
        // 楼梯压着出生点"对应 CE stairDirection=0（fell into the level），
        // 以当前出生点（即 vestibule 楼梯格）为目标走同一 4 邻域规则挪离
        // 楼梯（与 CE getQualifyingLocNear 的口径差异在报告登记）。
        if (!isFirstLevel) {
            const entryStair = isGoingUp ? stairsDownPos : stairsUpPos;
            if (entryStair) this.placePlayerOnLevelEntry(entryStair);
        } else {
            this.placePlayerOnLevelEntry({ x: this.player.loc.x, y: this.player.loc.y });
        }
    }

    /**
     * P1-31：进层落位。CE RogueMain.c:837-869 逐句对应：
     *   1. 先把玩家置于目标格（楼梯）；
     *   2. 按 CE 方向枚举序（Rogue.h:413-422：UP/DOWN/LEFT/RIGHT = 北/南/西/东）
     *      找第一个"不阻挡通行、且无怪物/楼梯/机器"的邻格落位
     *      （CE：!cellHasTerrainFlag(loc, T_PATHING_BLOCKER) &&
     *        !(pmap flags & (HAS_MONSTER | HAS_STAIRS | IS_IN_MACHINE)))；
     *   3. 4 邻域全不合格 → 退到 getQualifyingPathLocNear（Grid.c:287）：
     *      以目标格为源的 dijkstra 扫描取"路径最近的合格格"。
     * 共同路径（2）零 RNG 消耗；兜底（3）的并列取一在 CE 即消费随机数
     *（deterministic=false），web 同样走 rng——仅在病态地形触发。
     */
    private placePlayerOnLevelEntry(target: Pos): void {
        this.player.loc.x = target.x;
        this.player.loc.y = target.y;
        const DIRS4: ReadonlyArray<readonly [number, number]> =
            [[0, -1], [0, 1], [-1, 0], [1, 0]]; // CE UP/DOWN/LEFT/RIGHT
        for (const [dx, dy] of DIRS4) {
            const x = target.x + dx!;
            const y = target.y + dy!;
            if (this.entryQualifiesForPlacement(x, y)) {
                this.player.loc.x = x;
                this.player.loc.y = y;
                return;
            }
        }
        const loc = this.findQualifyingPathLocNear(target);
        if (loc) {
            this.player.loc.x = loc.x;
            this.player.loc.y = loc.y;
        }
        // 无解：维持楼梯位。CE 在 Grid.c:347-356 还有路径无关的
        // getQualifyingLocNear 第二重兜底（web 的环形近似见
        // findQualifyingPathLocNear 尾部）；两者都失败属病态地图，CE 亦无解。
    }

    /**
     * P1-31：落位合格格判定。CE 两个旗标面（Rogue.h:1948）的 web 近似：
     *   - T_PATHING_BLOCKER = T_OBSTRUCTS_PASSABILITY | T_AUTO_DESCENT |
     *     T_IS_DF_TRAP | T_LAVA_INSTA_DEATH | T_IS_DEEP_WATER | T_IS_FIRE |
     *     T_SPONTANEOUSLY_IGNITES —— web：!isPassable（墙/花岗岩/深渊/密门）
     *     或 LAVA / WATER_DEEP / TRAP / 燃烧中；
     *   - HAS_MONSTER → getMonsterAt；HAS_STAIRS → 楼梯地形；
     *     IS_IN_MACHINE → machineCells（本层生成期数据）。
     * 楼梯本身不含 T_PATHING_BLOCKER（Globals.c:333-334），故 HAS_STAIRS
     * 必须单独排除——CE 的 4 邻域循环同样单列。
     */
    private entryQualifiesForPlacement(x: number, y: number): boolean {
        const cell = this.grid.getCell(x, y);
        if (!cell) return false;
        if (!cell.isPassable) return false;
        if (cell.terrain === TerrainType.LAVA ||
            cell.terrain === TerrainType.WATER_DEEP ||
            cell.terrain === TerrainType.TRAP ||
            cell.isBurning) return false;
        if (cell.terrain === TerrainType.STAIRS_UP ||
            cell.terrain === TerrainType.STAIRS_DOWN) return false;
        if (this.getMonsterAt(x, y)) return false;
        if (this.machineCells.has(y * DCOLS + x)) return false;
        return true;
    }

    /**
     * P1-31：CE Grid.c:287 getQualifyingPathLocNear 的 web 端口
     *（调用面 RogueMain.c:854-858：blockingTerrainFlags=T_DIVIDES_LEVEL、
     * forbiddenTerrainFlags=T_PATHING_BLOCKER、forbiddenMapFlags=
     * HAS_MONSTER|HAS_STAIRS|IS_IN_MACHINE、hallwaysAllowed=true、
     * deterministic=false）。路径代价按 T_DIVIDES_LEVEL 阻断（该类地形
     * 不可穿过），结果格按 T_PATHING_BLOCKER + 三项占用旗标过滤，取
     * "路径距离最小"的合格格；并列时 CE 用 rand_range 随机取一，web 同
     *（rng）。CE 末端还有一重路径无关的 getQualifyingLocNear 兜底，web 以
     * 切比雪夫环搜索近似（同旗标面、同随机取一）。
     */
    private findQualifyingPathLocNear(target: Pos): Pos | null {
        const width = this.grid.width;
        const height = this.grid.height;
        const cost = allocShortGrid(width, height, 1);
        const dist = allocShortGrid(width, height, MAX_DISTANCE);
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                const cell = this.grid.getCell(x, y);
                // CE T_DIVIDES_LEVEL（Rogue.h:1949）：不可作为路径的地形
                const dividesLevel = !cell || !cell.isPassable ||
                    cell.terrain === TerrainType.LAVA ||
                    cell.terrain === TerrainType.WATER_DEEP ||
                    cell.terrain === TerrainType.TRAP;
                if (dividesLevel) cost[x]![y] = -1; // CE PDS_FORBIDDEN
            }
        }
        // CE Grid.c:324-326：源格距离 1、代价强制 1（楼梯可作路径起点）
        dist[target.x]![target.y] = 1;
        cost[target.x]![target.y] = 1;
        const scanner = new DijkstraMap(width, height);
        scanner.batchScan(dist, cost, true); // CE dijkstraScan(grid, costMap, true)

        let best = MAX_DISTANCE;
        const ties: Pos[] = [];
        for (let x = 1; x < width - 1; x++) {
            for (let y = 1; y < height - 1; y++) {
                const d = dist[x]![y]!;
                if (d <= 0 || d >= MAX_DISTANCE || d > best) continue;
                if (!this.entryQualifiesForPlacement(x, y)) continue;
                if (d < best) {
                    best = d;
                    ties.length = 0;
                }
                ties.push({ x, y });
            }
        }
        if (ties.length > 0) {
            return ties.length === 1 ? ties[0]! : ties[rng.randRange(0, ties.length - 1)]!;
        }
        // CE Grid.c:347-356 的 getQualifyingLocNear 兜底（路径无关）：
        // 切比雪夫环由近及远，首个含合格格的环内随机取一。
        for (let r = 1; r <= Math.max(width, height); r++) {
            const ring: Pos[] = [];
            for (let dx = -r; dx <= r; dx++) {
                for (let dy = -r; dy <= r; dy++) {
                    if (Math.max(Math.abs(dx!), Math.abs(dy!)) !== r) continue;
                    const x = target.x + dx!;
                    const y = target.y + dy!;
                    if (x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1) continue;
                    if (!this.entryQualifiesForPlacement(x, y)) continue;
                    ring.push({ x, y });
                }
            }
            if (ring.length > 0) {
                return ring.length === 1 ? ring[0]! : ring[rng.randRange(0, ring.length - 1)]!;
            }
        }
        return null;
    }

    /**
     * Monsters.c:511 pickHordeType 的候选集：frequency > 0、不含任何禁用 flag、
     * 深度窗口 minLevel <= depth <= maxLevel（CE 硬窗口口径）。
     * depth 传 null 时跳过深度窗口（仅供统计候选池规模）。
     */
    public hordeCandidates(depth: number | null, forbiddenFlags: readonly string[]): HordeEntry[] {
        return (hordeData as HordeEntry[]).filter(h =>
            h.frequency > 0 &&
            (depth === null || (depth >= h.minLevel && depth <= h.maxLevel)) &&
            !h.flags.some(f => forbiddenFlags.includes(f))
        );
    }

    /**
     * Monsters.c:511 pickHordeType —— 按 frequency 加权抽取：
     * index = rand_range(1, Σfrequency)，遍历候选命中 index <= frequency 者即为选中。
     */
    public pickHordeType(candidates: HordeEntry[]): HordeEntry | null {
        const possCount = candidates.reduce((sum, h) => sum + h.frequency, 0);
        if (possCount <= 0) return null;
        let index = rng.randRange(1, possCount);
        for (const h of candidates) {
            if (index <= h.frequency) return h;
            index -= h.frequency;
        }
        return null;
    }

    /**
     * Monsters.c:797-805 spawnHorde 的 out-of-depth 掷骰：
     * 10% 概率（深度 1 不触发）从 depthLevel + rand_range(1, min(5, depthLevel/2))
     * 的更深层抽 horde；越过 amuletLevel 则钳回 max(depthLevel, amuletLevel)。
     */
    public rollSpawnDepth(depthLevel: number): { depth: number; outOfDepth: boolean } {
        if (depthLevel > 1 && rng.randPercent(MONSTER_OUT_OF_DEPTH_CHANCE)) {
            let depth = depthLevel + rng.randRange(1, Math.min(5, Math.floor(depthLevel / 2)));
            if (depth > AMULET_LEVEL) depth = Math.max(depthLevel, AMULET_LEVEL);
            return { depth, outOfDepth: true };
        }
        return { depth: depthLevel, outOfDepth: false };
    }

    /** spawnsIn 名 → 目标地形（CE tile 枚举 → TerrainType），hordeFitsTerrain 与
     *  findTerrainSpawnLocation 共用，保证两处口径永不漂移。 */
    private static readonly SPAWNS_IN_TERRAIN: Record<string, TerrainType> = {
        DEEP_WATER: TerrainType.WATER_DEEP,
        SHALLOW_WATER: TerrainType.WATER_SHALLOW,
        MUD: TerrainType.MUD,
        LAVA: TerrainType.LAVA,
    };

    /** Monsters.c:809-819：horde 落格地形约束（spawnsIn）。 */
    private hordeFitsTerrain(h: HordeEntry, pos: Pos): boolean {
        if (!h.spawnsIn) return true;
        const target = Game.SPAWNS_IN_TERRAIN[h.spawnsIn];
        // STATUE_*/CAGE/TURRET/WALL 等生成期专用落点不匹配普通地图格（CE 同样重抽）
        if (target === undefined) return false;
        return this.grid.getCell(pos.x, pos.y)?.terrain === target;
    }

    /**
     * CE Architect.c:3822 randomMatchingLocation 的 spawnsIn 路径（terrainType >= 0）：
     * 全图收集 terrain 匹配 spawnsIn 的格子并随机取一（等价 CE 的拒绝采样均匀分布），
     * 排除 CE 的占用约束 HAS_MONSTER / HAS_PLAYER / HAS_ITEM / IS_IN_MACHINE
     * （楼梯 terrain 与目标地形互斥，无需单独排除）。玩家切比雪夫距离 <= 5 的格
     * 与 FLOOR 落点池同口径排除（CE 入口楼梯 FOV 重试 25 次的 web 代理），
     * 再按调用方 Monsters.c:836 的 passableArcCount(loc) > 1 排除走廊/路口格。
     * 无合法格返回 null → 调用方按 Monsters.c:835 的 failsafe 50 重抽 horde。
     */
    private findTerrainSpawnLocation(spawnsIn: string): Pos | null {
        const target = Game.SPAWNS_IN_TERRAIN[spawnsIn];
        if (target === undefined) return null;
        const pool: Pos[] = [];
        for (let x = 1; x < DCOLS - 1; x++) {
            for (let y = 1; y < DROWS - 1; y++) {
                const cell = this.grid.getCell(x, y);
                if (!cell || cell.terrain !== target) continue;
                if (cell.machineNumber !== 0) continue; // CE IS_IN_MACHINE
                if (this.getMonsterAt(x, y)) continue; // CE HAS_MONSTER
                if (this.player.loc.x === x && this.player.loc.y === y) continue; // CE HAS_PLAYER
                if (this.items.some(it => it.loc.x === x && it.loc.y === y)) continue; // CE HAS_ITEM
                // 与 FLOOR 池同一玩家距离口径（"Don't spawn right on top of player"）
                if (Math.abs(x - this.player.loc.x) <= 5 && Math.abs(y - this.player.loc.y) <= 5) continue;
                if (this.passableArcCount(x, y) > 1) continue; // CE Monsters.c:836
                pool.push({ x, y });
            }
        }
        if (pool.length === 0) return null;
        return pool[rng.randRange(0, pool.length - 1)]!;
    }

    /**
     * CE Architect.c:171 passableArcCount：绕格一周统计 8 邻域"可通行↔不可通行"
     * 的弧段切换数（0=开阔地，1=贴墙，2=走廊，3+=路口）。web 的 cell.isPassable
     * 对应 CE cellIsPassableOrDoor（门在两侧均计为可通行）。
     */
    private passableArcCount(x: number, y: number): number {
        // CE GlobalsBase.c:39 cDirs（保持环游顺序）
        const C_DIRS: ReadonlyArray<readonly [number, number]> = [
            [0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1],
        ];
        const passable = (cx: number, cy: number): boolean =>
            this.grid.getCell(cx, cy)?.isPassable === true;
        let arcs = 0;
        for (let dir = 0; dir < 8; dir++) {
            const [nx, ny] = C_DIRS[dir]!;
            const [ox, oy] = C_DIRS[(dir + 7) % 8]!;
            if (passable(x + nx, y + ny) !== passable(x + ox, y + oy)) arcs++;
        }
        return arcs / 2;
    }

    /**
     * 生成一条 horde：领袖落 centerPos，成员在其周围环搜落格。
     * wandering=true 时领袖与成员状态置为 WANDERING（Time.c:2331-2340 周期刷怪语义）。
     * floorTiles 传入时把成员落格从中移除，避免后续物品生成落在怪物脚下。
     */
    private spawnHordeAt(h: HordeEntry, centerPos: Pos, depth: number, wandering: boolean, floorTiles?: Pos[]): boolean {
        const leaderMData = (monsterData as MonsterData[]).find(m => m.id === h.leader.toLowerCase());
        if (!leaderMData) return false;

        const leaderMon = new Monster(centerPos.x, centerPos.y, leaderMData);
        if (h.flags.includes('HORDE_LEADER_CAPTIVE')) {
            // Monsters.c:872-877：笼中俘虏 —— 上锁不行动、状态 WANDERING、HP 折至 1/4+1
            leaderMon.isCaged = true;
            leaderMon.state = MonsterState.WANDERING;
            leaderMon.hp = Math.floor(leaderMon.maxHp / 4) + 1;
        }
        this.applyRandomMutation(leaderMon, depth);
        if (wandering) leaderMon.state = MonsterState.WANDERING;
        this.monsters.push(leaderMon);

        // Spawn members nearby
        for (const member of h.members) {
            const count = rng.randRange(member.minCount, member.maxCount);
            const memberMData = (monsterData as MonsterData[]).find(m => m.id === member.type.toLowerCase());
            if (!memberMData) continue;

            for (let c = 0; c < count; c++) {
                searchLoop: for (let r = 1; r <= 5; r++) {
                    // Find a random free spot in a ring of radius `r`
                    // To keep it simple, checking all spots and picking the first valid one
                    for (let dx = -r; dx <= r; dx++) {
                        for (let dy = -r; dy <= r; dy++) {
                            if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                            const nx = centerPos.x + dx;
                            const ny = centerPos.y + dy;
                            const cell = this.grid.getCell(nx, ny);
                            if (cell && cell.isPassable && !this.monsters.some(m => m.loc.x === nx && m.loc.y === ny) && !(this.player.loc.x === nx && this.player.loc.y === ny)) {
                                const mon = new Monster(nx, ny, memberMData);
                                this.applyRandomMutation(mon, depth);
                                if (wandering) mon.state = MonsterState.WANDERING;
                                // P4-2：CE spawnHorde 对常规（非召唤）horde 同样经
                                // spawnMinions 落地成员，无条件设置 leader/MB_FOLLOWER
                                // （Monsters.c:742-744）。web 补上 leader 关系，使
                                // countMinions 统计"某召唤者已有多少直接随从"时，
                                // 对本身就是常规 horde 领袖（如 goblin warlord 麾下的
                                // 哥布林战队）的召唤者也能算对既有随从数。
                                mon.leader = leaderMon;
                                this.monsters.push(mon);

                                // Remove from floorTiles to avoid item overlaps
                                if (floorTiles) {
                                    const ftIdx = floorTiles.findIndex(ft => ft.x === nx && ft.y === ny);
                                    if (ftIdx !== -1) floorTiles.splice(ftIdx, 1);
                                }

                                break searchLoop;
                            }
                        }
                    }
                }
            }
        }
        return true;
    }

    /**
     * P4-2：在 center 周围按半径 1..5 做环形扫描，取第一个可站立、无怪物/玩家
     * 占用的格子。纯确定性扫描顺序，不消耗 RNG——与 spawnHordeAt 现有的成员
     * 落格搜索同一口径（该处历史实现即如此，未抽出复用是为了不触碰既有
     * spawnHordeAt 的行为面，见报告"边界"一节）。
     */
    private findNearbySpawnSpot(center: Pos): Pos | null {
        for (let r = 1; r <= 5; r++) {
            for (let dx = -r; dx <= r; dx++) {
                for (let dy = -r; dy <= r; dy++) {
                    if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                    const nx = center.x + dx;
                    const ny = center.y + dy;
                    const cell = this.grid.getCell(nx, ny);
                    if (!cell || !cell.isPassable) continue;
                    if (this.getMonsterAt(nx, ny)) continue;
                    if (this.player.loc.x === nx && this.player.loc.y === ny) continue;
                    return { x: nx, y: ny };
                }
            }
        }
        return null;
    }

    /**
     * P4-2：CE summonMinions 的 HORDE_SUMMONED_AT_DISTANCE 分支（Monsters.c:
     * 1005-1012，goblin warlord 专用）——"全图、玩家视野外、路径可达"的落点池。
     * CE 用 calculateDistances 做带地形代价的 Dijkstra、上限 DCOLS/2；web 简化
     * 为等权 8 邻域 BFS（代价恒为 1）、同样的 DCOLS/2 步数上限，如实记为简化
     * （CLAIRVOYANT_VISIBLE 等透视可见性在 web 无对应概念，一并跳过，只排除
     * 当前 FOV 内的格子）。
     */
    private findSummonAtDistanceLocations(from: Pos): Pos[] {
        const maxDist = Math.floor(DCOLS / 2);
        const dist = new Map<string, number>();
        const key = (x: number, y: number) => `${x},${y}`;
        const queue: Pos[] = [from];
        dist.set(key(from.x, from.y), 0);
        let qi = 0;
        while (qi < queue.length) {
            const cur = queue[qi++]!;
            const d = dist.get(key(cur.x, cur.y))!;
            if (d >= maxDist) continue;
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx === 0 && dy === 0) continue;
                    const nx = cur.x + dx;
                    const ny = cur.y + dy;
                    const k = key(nx, ny);
                    if (dist.has(k)) continue;
                    const cell = this.grid.getCell(nx, ny);
                    if (!cell || !cell.isPassable) continue;
                    if (cell.terrain === TerrainType.LAVA || cell.terrain === TerrainType.CHASM) continue;
                    dist.set(k, d + 1);
                    queue.push({ x: nx, y: ny });
                }
            }
        }

        const result: Pos[] = [];
        for (const [k, d] of dist) {
            if (d === 0 || d > maxDist) continue; // 排除起点自身
            const parts = k.split(',');
            const x = Number(parts[0]);
            const y = Number(parts[1]);
            const cell = this.grid.getCell(x, y);
            if (!cell || cell.isVisible) continue; // 玩家 FOV 外
            if (this.getMonsterAt(x, y)) continue;
            if (this.player.loc.x === x && this.player.loc.y === y) continue;
            result.push({ x, y });
        }
        return result;
    }

    /**
     * P4-2：CE summonMinions（Monsters.c:985）。对照：
     *   hordeID = pickHordeType(0, summonerType, 0, 0)   → hordeCandidates
     *             （HORDE_IS_SUMMONED && leader==summonerType，无深度窗口、
     *             无禁用 flag）+ pickHordeType（既有加权抽取，未改签名，
     *             见报告"pickHordeType 是否需要扩展签名"一节）
     *   if hordeID<0 return false                        → horde 为 null 早退
     *   MA_ENTER_SUMMONS：先把召唤者从 this.monsters 移除（用重新赋值而非
     *     splice，避免破坏 advancementLoop 那个正在进行中的 for-of，见报告）
     *   spawnMinions(hordeID, summoner, true, false)      → 按 horde.members
     *     落格生成，leader/isAlly/state 继承自 summoner（CE monst->leader=
     *     leader；monst->creatureState=leader->creatureState），
     *     ticksUntilTurn=101（Monsters.c:1034，防止本 tick 立即行动）
     *   HORDE_SUMMONED_AT_DISTANCE                        → findSummonAtDistanceLocations
     *     后逐个随机分配（对应 CE randomLocationInGrid 逐个 teleport）
     *   canSeeMonster(summoner) 消息                       → 简化为固定英文/中文
     *     兜底消息，不做"仅可见时才提示"的门（P4-1b 报告已记同类简化）
     * 已知简化（未实现，登记不做）：
     *   - MA_ENTER_SUMMONS 的 carriedMonster/demoteMonsterFromLeadership
     *     （召唤者变成新生怪物的"乘客"，日后被摧毁怪物复活召唤者）——web 没有
     *     carriedMonster 概念，任务验收口径本身也只要求"自身从场上消失、
     *     同时出现新怪物"，未要求这层复活机制，故不做，报告已说明。
     *   - itemPossible 参数（spawnMinions 召唤路径固定传 false，web 落地的
     *     Monster 构造本来就不带物品，天然一致，不需要额外处理）。
     * 返回值：是否至少召到一只随从（供未来调用方判断用，当前调用方
     * Monster.trySummon 按 CE 语义不依赖这个返回值决定是否耗费本回合）。
     */
    public summonMinionsFor(summoner: Monster): boolean {
        const candidates = (hordeData as HordeEntry[]).filter(h =>
            h.flags.includes('HORDE_IS_SUMMONED') && h.leader.toLowerCase() === summoner.typeId.toLowerCase()
        );
        const horde = this.pickHordeType(candidates);
        if (!horde) return false;

        const enterSummons = summoner.hasAbility('MA_ENTER_SUMMONS');
        if (enterSummons) {
            // 重新赋值（而非 splice）：不破坏调用方 advancementLoop 里正在
            // 进行中的 for (const m of this.monsters) 迭代（splice 当前元素
            // 会导致该 for-of 跳过下一个怪物，见报告"RNG/迭代安全"一节）。
            this.monsters = this.monsters.filter(m => m !== summoner);
        }

        const spawned: Monster[] = [];
        for (const member of horde.members) {
            const count = rng.randRange(member.minCount, member.maxCount);
            const memberMData = (monsterData as MonsterData[]).find(m => m.id === member.type.toLowerCase());
            if (!memberMData) continue;
            for (let c = 0; c < count; c++) {
                const pos = this.findNearbySpawnSpot(summoner.loc);
                if (!pos) continue;
                const mon = new Monster(pos.x, pos.y, memberMData);
                mon.leader = summoner;
                mon.isAlly = summoner.isAlly;
                mon.state = summoner.state;
                mon.ticksUntilTurn = 101; // CE Monsters.c:1034
                this.monsters.push(mon);
                spawned.push(mon);
            }
        }

        const atLeastOneMinion = spawned.length > 0;

        if (atLeastOneMinion && horde.flags.includes('HORDE_SUMMONED_AT_DISTANCE')) {
            const pool = this.findSummonAtDistanceLocations(summoner.loc);
            for (const mon of spawned) {
                if (pool.length === 0) break;
                const idx = rng.randRange(0, pool.length - 1);
                const dest = pool.splice(idx, 1)[0]!;
                mon.loc = { x: dest.x, y: dest.y };
            }
        }

        if (atLeastOneMinion) {
            logger.log(i18next.t('monster.summon_minions', {
                name: summoner.name,
                defaultValue: `${summoner.name} incants darkly!`
            }), '#c084fc');
        }

        return atLeastOneMinion;
    }

    /**
     * Monsters.c:1101 getRandomMonsterSpawnLocation 的 web 等价：
     * 候选格 = 可通行、非有害地形（熔岩/深渊）、非楼梯、无怪物、非玩家位、
     * 且不在玩家当前视野内（IN_FIELD_OF_VIEW 排除）；
     * 优先离玩家足够远（切比雪夫距离 >= floor(DCOLS/2)，近似 CE 的
     * 路径距离场 >= DCOLS/2 阈值），无远格则回退到任意视野外合法格。
     */
    private findPeriodicSpawnLocation(): Pos | null {
        const far: Pos[] = [];
        const near: Pos[] = [];
        const minFarDist = Math.floor(DCOLS / 2);
        for (let x = 1; x < DCOLS - 1; x++) {
            for (let y = 1; y < DROWS - 1; y++) {
                const cell = this.grid.getCell(x, y);
                if (!cell || !cell.isPassable) continue;
                if (cell.isVisible) continue;
                if (cell.terrain === TerrainType.LAVA || cell.terrain === TerrainType.CHASM) continue;
                if (cell.terrain === TerrainType.STAIRS_UP || cell.terrain === TerrainType.STAIRS_DOWN) continue;
                if (this.getMonsterAt(x, y)) continue;
                if (this.player.loc.x === x && this.player.loc.y === y) continue;
                const isFar = Math.max(Math.abs(x - this.player.loc.x), Math.abs(y - this.player.loc.y)) >= minFarDist;
                (isFar ? far : near).push({ x, y });
            }
        }
        const pool = far.length > 0 ? far : near;
        if (pool.length === 0) return null;
        return pool[rng.randRange(0, pool.length - 1)]!;
    }

    /**
     * Monsters.c:1128 spawnPeriodicHorde —— 周期刷怪：随机取视野外落点，
     * 用周期刷怪禁用集加权抽 horde 生成，领袖与随从均为 WANDERING。
     */
    public spawnPeriodicHorde(): boolean {
        if (this.mode === 'test') return false;
        const loc = this.findPeriodicSpawnLocation();
        if (!loc) return false;

        const spawn = this.rollSpawnDepth(this.depth);
        const forbidden = spawn.outOfDepth
            ? [...HORDE_PERIODIC_FORBIDDEN_FLAGS, 'HORDE_NEVER_OOD']
            : HORDE_PERIODIC_FORBIDDEN_FLAGS;

        // Monsters.c:814-828：落点固定时逐次重抽 horde 直到 spawnsIn 匹配（failsafe 50）
        for (let failsafe = 50; failsafe > 0; failsafe--) {
            const cand = this.pickHordeType(this.hordeCandidates(spawn.depth, forbidden));
            if (!cand) return false;
            if (this.hordeFitsTerrain(cand, loc)) {
                return this.spawnHordeAt(cand, loc, this.depth, true);
            }
        }
        return false;
    }

    private posKey(x: number, y: number) {
        return `${x},${y}`;
    }

    private getTestCategoryForDepth(depth: number): TestAssetCategory {
        const ordered: TestAssetCategory[] = ['weapons', 'wands', 'scrolls', 'potions', 'other', 'terrain', 'enemies', 'blueprints', 'runics'];
        return ordered[(depth - 1) % ordered.length]!;
    }

    private getTestCategoryLabel(category: TestAssetCategory) {
        switch (category) {
            case 'weapons': return '武器';
            case 'wands': return '法杖';
            case 'scrolls': return '卷轴';
            case 'potions': return '药水';
            case 'other': return '其他道具';
            case 'terrain': return '特殊地形';
            case 'enemies': return '敌人';
            case 'blueprints': return '机关房蓝图';
            case 'runics': return '附魔测试';
            default: return category;
        }
    }

    private handleExamineNearest() {
        // Find nearest visible monster
        const visibleMonsters = this.monsters.filter(m => {
            if (m.hp <= 0) return false;
            const cell = this.grid.getCell(m.loc.x, m.loc.y);
            return cell && cell.isVisible;
        });

        if (visibleMonsters.length > 0) {
            // Sort by distance
            visibleMonsters.sort((a, b) => {
                const da = Math.abs(a.loc.x - this.player.loc.x) + Math.abs(a.loc.y - this.player.loc.y);
                const db = Math.abs(b.loc.x - this.player.loc.x) + Math.abs(b.loc.y - this.player.loc.y);
                return da - db;
            });
            const m = visibleMonsters.find(mon => !this.examinedEntityIds.has(mon.id));
            if (m) {
                this.examinedEntityIds.add(m.id);
                const weaponDamageStr = this.player.equippedWeapon?.damage ?? "1d2";
                const [n, d] = weaponDamageStr.split('d').map(Number);
                this.inspectTarget = generateMonsterDetail(
                    m,
                    this.player.hp,
                    this.player.strength,
                    0, // 已废弃占位：防御由 DetailGenerator 内部用下方 armor 三元组经 playerDefense() 计算
                    [n || 1, (n || 1) * (d || 2)],
                    this.player.equippedWeapon?.enchantment ?? 0,
                    this.player.equippedWeapon?.strengthRequired ?? 12,
                    this.player.equippedArmor?.armor ?? 0,
                    this.player.equippedArmor?.enchantment ?? 0,
                    this.player.equippedArmor?.strengthRequired ?? 0 // 缺省口径对齐 Combat.ts 的 || 0
                );
                return;
            }
        }

        // If no monsters, find nearest visible item
        const visibleItems = this.items.filter(i => {
            const cell = this.grid.getCell(i.loc.x, i.loc.y);
            return cell && cell.isVisible;
        });

        if (visibleItems.length > 0) {
            visibleItems.sort((a, b) => {
                const da = Math.abs(a.loc.x - this.player.loc.x) + Math.abs(a.loc.y - this.player.loc.y);
                const db = Math.abs(b.loc.x - this.player.loc.x) + Math.abs(b.loc.y - this.player.loc.y);
                return da - db;
            });
            const i = visibleItems.find(item => !this.examinedEntityIds.has(item.id));
            if (i) {
                this.examinedEntityIds.add(i.id);
                this.inspectTarget = generateItemDetail(i, this.player.strength);
                return;
            }
        }

        // If we reach here, either there's nothing to examine,
        // or we already just examined the nearest entity.
        // Fall back to auto-explore behavior.
        this.handleAutoExplore();
    }

    public handleInspectAt(x: number, y: number) {
        const cell = this.grid.getCell(x, y);
        if (!cell || !cell.isVisible) return;

        const monster = this.getMonsterAt(x, y);
        if (monster && monster.hp > 0) {
            const weaponDamageStr = this.player.equippedWeapon?.damage ?? '1d2';
            const [n, d] = weaponDamageStr.split('d').map(Number);
            this.inspectTarget = generateMonsterDetail(
                monster,
                this.player.hp,
                this.player.strength,
                0, // 已废弃占位：防御由 DetailGenerator 内部用下方 armor 三元组经 playerDefense() 计算
                [n || 1, (n || 1) * (d || 2)],
                this.player.equippedWeapon?.enchantment ?? 0,
                this.player.equippedWeapon?.strengthRequired ?? 12,
                this.player.equippedArmor?.armor ?? 0,
                this.player.equippedArmor?.enchantment ?? 0,
                this.player.equippedArmor?.strengthRequired ?? 0 // 缺省口径对齐 Combat.ts 的 || 0
            );
            return;
        }

        const item = this.items.find((i) => i.loc.x === x && i.loc.y === y);
        if (item) {
            this.inspectTarget = generateItemDetail(item, this.player.strength);
        }
    }

    private createMonsterFromSnapshot(m: TestRoomState['baselineMonsters'][number]): Monster {
        const data = {
            id: m.name.toLowerCase().replace(/\s+/g, '_'),
            name: m.name,
            char: m.char,
            color: m.color,
            hp: m.maxHp,
            damage: m.damageString,
            minDepth: 1,
            maxDepth: 99,
            goldDropChance: m.goldDropChance,
            itemDropChance: m.itemDropChance,
            onHitStatus: m.onHitStatus,
            onHitChance: m.onHitChance,
            onHitDuration: m.onHitDuration,
            statusImmunities: m.statusImmunities,
            statusResistTurns: m.statusResistTurns
        };
        const monster = new Monster(m.loc.x, m.loc.y, data);
        monster.id = m.id;
        monster.hp = m.hp;
        monster.maxHp = m.maxHp;
        monster.state = m.state as any;
        monster.statusDurations = { ...(m.statusDurations ?? {}) };
        monster.refreshSpeeds(); // P2-2：状态直写绕过 applyStatus，需显式重算衍生速度
        monster.damageString = m.damageString;
        monster.goldDropChance = m.goldDropChance;
        monster.itemDropChance = m.itemDropChance;
        monster.onHitStatus = m.onHitStatus;
        monster.onHitChance = m.onHitChance ?? 0;
        monster.onHitDuration = m.onHitDuration ?? 0;
        monster.statusImmunities = new Set<StatusId>(m.statusImmunities ?? []);
        monster.statusResistTurns = { ...(m.statusResistTurns ?? {}) };
        return monster;
    }

    private generateTestDepth(isFirstLevel: boolean) {
        this.levels.clear();
        this.monsters = [];
        this.items = [];
        this.visibleMonsters.clear();
        this.visibleItems.clear();
        this.signTexts.clear();
        this.resetPlateRoomByPos.clear();
        this.testRooms.clear();
        this.machineCells.clear(); // P1-31：test 层无机器（防上一层残留）

        this.grid = new Grid(DCOLS, DROWS);
        this.environment = new EnvironmentManager(this.grid);
        this.fov = new FOVSys(this.grid);
        this.lightMap = new LightMap(this.grid);
        // P4-8：test 层同样换新气味图
        this.scent = new ScentMap(DCOLS, DROWS);
        // P1-34：loopMap 必须随层重算。test 分支在 generateDepth（591-599）提前
        // return，永远到不了 normal 路径末尾的 `this.loopMap = analyzeLoopMap(
        // this.grid)`；若不在此重算，实例上残留的是**上一个 normal 局**（Game
        // 构造器以"当前时间"种子跑的那次生成）的环路图——时间种子是秒级精度，
        // 同一秒内建的局共享同一张陈旧图、跨秒则不同，p4_9_safety_map 的 T2/T7
        // 因此间歇性翻红（同种子两次 run 的 IN_LOOP 集合不同）。analyzeLoopMap
        // 纯函数、零 RNG 消耗，不移动随机流（见 ai_docs/p1_34_flaky_determinism_report.md）。
        this.loopMap = analyzeLoopMap(this.grid);

        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                this.grid.setTerrain(x, y, TerrainType.GRANITE, ' ', 0x333333);
            }
        }

        const entryX = 4;
        const entryY = 3;
        const hallX = entryX + 2;
        const category = this.getTestCategoryForDepth(this.depth);
        this.currentTestCategory = category;
        const categoryLabel = this.getTestCategoryLabel(category);

        for (let x = 1; x <= hallX + 1; x++) {
            for (let y = 1; y <= 6; y++) {
                this.grid.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
            }
        }

        this.player.loc.x = entryX;
        this.player.loc.y = entryY;

        if (this.depth > 1) {
            this.grid.setTerrain(entryX - 1, entryY, TerrainType.STAIRS_UP, '<', 0xffaa00);
        }
        this.grid.setTerrain(entryX + 1, entryY, TerrainType.STAIRS_DOWN, '>', 0x00aaff);

        const depthSignX = entryX;
        const depthSignY = entryY + 1;
        this.grid.setTerrain(depthSignX, depthSignY, TerrainType.SIGN, '§', 0xffee88);
        this.signTexts.set(
            this.posKey(depthSignX, depthSignY),
            `第 ${this.depth} 层分类：${categoryLabel}`
        );

        type RoomPayload = {
            roomName: string;
            spawn: (x: number, y: number) => { item?: Item; monster?: Monster; terrainSet?: { terrain: TerrainType; char: string; color: number } };
        };

        const terrainEntries: RoomPayload[] = [
            { roomName: '浅水', spawn: () => ({ terrainSet: { terrain: TerrainType.WATER_SHALLOW, char: '~', color: 0x3366cc } }) },
            { roomName: '深水', spawn: () => ({ terrainSet: { terrain: TerrainType.WATER_DEEP, char: '~', color: 0x1133aa } }) },
            { roomName: '草地', spawn: () => ({ terrainSet: { terrain: TerrainType.GRASS, char: '"', color: 0x33aa33 } }) },
            { roomName: '灌木', spawn: () => ({ terrainSet: { terrain: TerrainType.FOLIAGE, char: '♠', color: 0x228822 } }) },
            { roomName: '岩浆', spawn: () => ({ terrainSet: { terrain: TerrainType.LAVA, char: '~', color: 0xff3300 } }) },
            { roomName: '深渊', spawn: () => ({ terrainSet: { terrain: TerrainType.CHASM, char: ' ', color: 0x111111 } }) }
        ];

        let assets: RoomPayload[] = [];
        if (category === 'weapons') {
            assets = ItemLoader.getWeaponConfigs().map((cfg) => ({
                roomName: cfg.name,
                spawn: (x, y) => ({ item: ItemLoader.spawnWeapon(cfg.id, x, y) ?? undefined })
            }));
        } else if (category === 'wands') {
            assets = ItemLoader.wands.map((cfg) => ({
                roomName: cfg.name,
                spawn: (x, y) => ({ item: ItemLoader.spawnWand(cfg.id, x, y) ?? undefined })
            }));
        } else if (category === 'scrolls') {
            assets = ItemLoader.scrolls.map((cfg) => ({
                roomName: cfg.trueName,
                spawn: (x, y) => ({ item: ItemLoader.spawnScroll(cfg.id, x, y) ?? undefined })
            }));
        } else if (category === 'potions') {
            assets = ItemLoader.potions.map((cfg) => ({
                roomName: cfg.trueName,
                spawn: (x, y) => ({ item: ItemLoader.spawnPotion(cfg.id, x, y) ?? undefined })
            }));
        } else if (category === 'other') {
            assets = [
                ...ItemLoader.getArmorConfigs().map((cfg) => ({
                    roomName: cfg.name,
                    spawn: (x: number, y: number) => ({ item: ItemLoader.spawnArmor(cfg.id, x, y) ?? undefined })
                })),
                ...ItemLoader.staffs.map((cfg) => ({
                    roomName: cfg.name,
                    spawn: (x: number, y: number) => ({ item: ItemLoader.spawnStaff(cfg.id, x, y) ?? undefined })
                })),
                ...ItemLoader.rings.map((cfg) => ({
                    roomName: cfg.name,
                    spawn: (x: number, y: number) => ({ item: ItemLoader.spawnRing(cfg.id, x, y) ?? undefined })
                })),
                ...ItemLoader.charms.map((cfg) => ({
                    roomName: cfg.name,
                    spawn: (x: number, y: number) => ({ item: ItemLoader.spawnCharm(cfg.id, x, y) ?? undefined })
                })),
                ...ItemLoader.keys.map((cfg) => ({
                    roomName: cfg.name,
                    spawn: (x: number, y: number) => ({ item: ItemLoader.spawnKey(cfg.id, x, y) ?? undefined })
                })),
                ...ItemLoader.amulets.map((cfg) => ({
                    roomName: cfg.name,
                    spawn: (x: number, y: number) => ({ item: ItemLoader.spawnAmulet(cfg.id, x, y) ?? undefined })
                }))
            ];
        } else if (category === 'terrain') {
            assets = terrainEntries;
        } else if (category === 'blueprints') {
            // Use blueprint data to create a test room per blueprint
            const bpList = blueprintData as unknown as Array<{
                id: string; name: string; depthRange: [number, number];
                features: Array<{
                    terrain?: string; trapType?: string; itemCategory?: string;
                    monsterId?: string; instanceCount: [number, number]; flags: string[]
                }>;
            }>;
            assets = bpList.map((bp) => ({
                roomName: `${bp.name} [D${bp.depthRange[0]}-${bp.depthRange[1]}]`,
                spawn: (x: number, y: number) => {
                    const result: { item?: Item; monster?: Monster; terrainSet?: { terrain: TerrainType; char: string; color: number } } = {};
                    // Place the first terrain feature if any
                    for (const feat of bp.features) {
                        if (feat.terrain && !result.terrainSet) {
                            const terrainMap: Record<string, { t: TerrainType; c: string; col: number }> = {
                                GRASS: { t: TerrainType.GRASS, c: '"', col: 0x33aa33 },
                                FOLIAGE: { t: TerrainType.FOLIAGE, c: '♠', col: 0x228822 },
                                BOG: { t: TerrainType.BOG, c: '~', col: 0x556633 },
                                WATER_SHALLOW: { t: TerrainType.WATER_SHALLOW, c: '~', col: 0x3366cc },
                                WATER_DEEP: { t: TerrainType.WATER_DEEP, c: '~', col: 0x1133aa },
                                LAVA: { t: TerrainType.LAVA, c: '~', col: 0xff4400 },
                                WEB: { t: TerrainType.WEB, c: '\\', col: 0xcccccc },
                                BLOOD: { t: TerrainType.BLOOD, c: '%', col: 0x880000 },
                                MUD: { t: TerrainType.MUD, c: '~', col: 0x664422 },
                                TRAP: { t: TerrainType.TRAP, c: '^', col: 0x884400 },
                                PRESSURE_PLATE: { t: TerrainType.PRESSURE_PLATE, c: '_', col: 0x446644 },
                                ALTAR: { t: TerrainType.ALTAR, c: 'A', col: 0xccccff },
                                SIGN: { t: TerrainType.SIGN, c: '!', col: 0xddddaa }
                            };
                            const vis = terrainMap[feat.terrain];
                            if (vis) result.terrainSet = { terrain: vis.t, char: vis.c, color: vis.col };
                        }
                        // Spawn first item feature
                        if (feat.flags.includes('MF_GENERATE_ITEM') && !result.item && feat.itemCategory) {
                            const item = this.spawnBlueprintItem(feat.itemCategory, undefined, x, y, this.depth);
                            if (item) result.item = item;
                        }
                        // Spawn first monster feature
                        if (feat.flags.includes('MF_GENERATE_MONSTER') && !result.monster && feat.monsterId) {
                            const mData = this.resolveBlueprintMonster(feat.monsterId, this.depth);
                            if (mData) result.monster = new Monster(x, y, mData);
                        }
                    }
                    return result;
                }
            }));
        } else if (category === 'runics') {
            const weaponRunics = ['paralyzing', 'venom', 'quietus', 'vampirism', 'speed', 'confusion', 'force', 'slaying', 'mercy'];
            const armorRunics = ['reflection', 'dampening', 'mutuality', 'respiration', 'vitality', 'absorption', 'reprisal', 'immunity'];

            const dummyMonsterData = (monsterData as MonsterData[]).find(m => m.id === 'troll') || (monsterData as MonsterData[])[0];

            assets = [
                ...weaponRunics.map((r) => ({
                    roomName: `W: ${r}`,
                    spawn: (x: number, y: number) => {
                        const item = ItemLoader.spawnWeapon('dagger', x, y);
                        if (item) {
                            item.runicType = r;
                            item.enchantment = 10;
                            item.runicKnown = true;
                        }
                        return { item: item ?? undefined, monster: new Monster(x + 1, y, dummyMonsterData!) };
                    }
                })),
                ...armorRunics.map((r) => ({
                    roomName: `A: ${r}`,
                    spawn: (x: number, y: number) => {
                        const item = ItemLoader.spawnArmor('leather_armor', x, y);
                        if (item) {
                            item.runicType = r;
                            item.enchantment = 10;
                            item.runicKnown = true;
                        }
                        return { item: item ?? undefined, monster: new Monster(x + 1, y, dummyMonsterData!) };
                    }
                }))
            ];
        } else {
            assets = (monsterData as MonsterData[]).map((cfg) => ({
                roomName: cfg.name,
                spawn: (x, y) => ({ monster: new Monster(x, y, cfg) })
            }));
        }

        const trunkY1 = 7;
        const trunkY2 = 21;
        const mainX = 4; // Vertical main road connecting the two horizontal trunks

        // Draw main roads
        for (let x = mainX; x < DCOLS - 2; x++) {
            this.grid.setTerrain(x, trunkY1, TerrainType.FLOOR, '.', 0x888888);
            this.grid.setTerrain(x, trunkY2, TerrainType.FLOOR, '.', 0x888888);
        }
        for (let y = Math.min(trunkY1, entryY); y <= Math.max(trunkY2, entryY); y++) {
            this.grid.setTerrain(mainX, y, TerrainType.FLOOR, '.', 0x888888);
        }
        // Ensure entry path
        for (let x = entryX; x <= mainX; x++) {
            this.grid.setTerrain(x, entryY, TerrainType.FLOOR, '.', 0x888888);
        }

        let roomId = 1;

        // Layout 4 rows of rooms: Y=1..5, 9..13, 15..19, 23..27
        const rowConfigs = [
            { y1: 1, y2: 5, branchY: 6, trunkY: 7, doorY: 5 },
            { y1: 9, y2: 13, branchY: 8, trunkY: 7, doorY: 9 },
            { y1: 15, y2: 19, branchY: 20, trunkY: 21, doorY: 19 },
            { y1: 23, y2: 27, branchY: 22, trunkY: 21, doorY: 23 }
        ];

        let assetIdx = 0;
        for (const row of rowConfigs) {
            for (let col = 0; col < 12; col++) {
                if (assetIdx >= assets.length) break;
                const payload = assets[assetIdx]!;

                const roomX1 = 6 + col * 6;
                const roomX2 = roomX1 + 4;
                const doorX = roomX1 + 2;

                // Draw room outline
                for (let x = roomX1; x <= roomX2; x++) {
                    for (let y = row.y1; y <= row.y2; y++) {
                        const isBorder = x === roomX1 || x === roomX2 || y === row.y1 || y === row.y2;
                        this.grid.setTerrain(x, y, isBorder ? TerrainType.WALL : TerrainType.FLOOR, isBorder ? '#' : '.', isBorder ? 0x555566 : 0x888888);
                    }
                }

                // Draw Door
                this.grid.setTerrain(doorX, row.doorY, TerrainType.DOOR, '+', 0xaa8844);

                // Draw Branch
                this.grid.setTerrain(doorX, row.branchY, TerrainType.FLOOR, '.', 0x888888);

                // Add Sign & Plate to the sides of the branch, facing the road
                const signX = doorX - 1;
                const plateX = doorX + 1;

                this.grid.setTerrain(signX, row.branchY, TerrainType.SIGN, '§', 0xffee88);
                this.signTexts.set(this.posKey(signX, row.branchY), `测试内容：${payload.roomName}`);

                this.grid.setTerrain(plateX, row.branchY, TerrainType.RESET_PLATE, '⊙', 0x66ccff);
                this.resetPlateRoomByPos.set(this.posKey(plateX, row.branchY), roomId);

                // Spawn payload in center
                const cx = doorX;
                const cy = row.y1 + 2;
                const spawned = payload.spawn(cx, cy);
                const roomItems: Item[] = [];
                const roomMonsters: Monster[] = [];

                if (spawned.terrainSet) {
                    this.grid.setTerrain(cx, cy, spawned.terrainSet.terrain, spawned.terrainSet.char, spawned.terrainSet.color);
                }
                if (spawned.item) {
                    this.items.push(spawned.item);
                    roomItems.push(spawned.item);
                }
                if (spawned.monster) {
                    this.monsters.push(spawned.monster);
                    roomMonsters.push(spawned.monster);
                }

                const baselineTerrains: TestRoomState['baselineTerrains'] = [];
                for (let x = roomX1; x <= roomX2; x++) {
                    for (let y = row.y1; y <= row.y2; y++) {
                        const cell = this.grid.getCell(x, y);
                        if (!cell) continue;
                        baselineTerrains.push({
                            x,
                            y,
                            terrain: cell.terrain,
                            char: cell.char,
                            color: cell.color,
                            isPassable: cell.isPassable,
                            isOpaque: cell.isOpaque
                        });
                    }
                }

                this.testRooms.set(roomId, {
                    id: roomId,
                    x1: roomX1,
                    y1: row.y1,
                    x2: roomX2,
                    y2: row.y2,
                    baselineItems: roomItems.map((it) => this.serializeItem(it)),
                    baselineMonsters: roomMonsters.map((m) => ({
                        id: m.id,
                        loc: { x: m.loc.x, y: m.loc.y },
                        name: m.name,
                        char: m.char,
                        color: m.color,
                        hp: m.hp,
                        maxHp: m.maxHp,
                        damageString: m.damageString,
                        state: m.state,
                        statusDurations: { ...m.statusDurations },
                        goldDropChance: m.goldDropChance,
                        itemDropChance: m.itemDropChance,
                        onHitStatus: m.onHitStatus,
                        onHitChance: m.onHitChance,
                        onHitDuration: m.onHitDuration,
                        statusImmunities: Array.from(m.statusImmunities),
                        statusResistTurns: { ...m.statusResistTurns }
                    })),
                    baselineTerrains
                });

                roomId++;
                assetIdx++;
            }
        }

        this.needsRender = true;
        if (!isFirstLevel) {
            logger.log(`测试模式：第 ${this.depth} 层（${categoryLabel}）`, '#88ccff');
        }
    }

    public spawnBlood(x: number, y: number) {
        const cell = this.grid.getCell(x, y);
        if (cell && (cell.terrain === TerrainType.FLOOR || cell.terrain === TerrainType.GRASS)) {
            // High chance to spawn blood on floor/grass
            if (rng.randPercent(60)) {
                cell.terrain = TerrainType.BLOOD;
                cell.char = '%';
                cell.color = 0xaa2222;
                cell.isPassable = true;
                cell.isOpaque = false;
                this.needsRender = true;
            }
        }
    }

    public spawnFloatingText(text: string, x: number, y: number, color: number | string = 0xffffff, life: number = 30) {
        this.floatingTexts.push(new FloatingText(text, x, y, color, life));
        this.needsRender = true;
    }

    public update() {
        // Run events until it's the player's turn 
        // OR the queue is empty

        if (this.needsRender && this.onRenderRequested) {
            // Update FOV & Lighting before rendering
            this.fov.computeFOV(this.player.loc.x, this.player.loc.y, 10);

            // Check discoveries
            const currentVisMonsters = new Set<Monster>();
            const currentVisItems = new Set<Item>();

            for (const m of this.monsters) {
                const cell = this.grid.getCell(m.loc.x, m.loc.y);
                const telepathyRevealed = this.player.hasStatus('telepathy') && m.hp > 0;
                // P4-3：CE Monsters.c:200-203 monsterIsHidden —— MONST_INVISIBLE 的怪物
                // （phantom）对非队友观察者恒定隐藏，忽略视野/光照/相邻，唯一的例外是
                // telepathy（IO.c:1264 canSeeMonster 配合 monsterRevealed 显示幽灵符号，
                // 这里简化为：仍能"察觉存在"但不能像正常怪物一样直接看见）。
                const trulyInvisible = m.isTrulyInvisible() && !this.player.hasStatus('telepathy');
                if (cell && (cell.isVisible || telepathyRevealed) && m.hp > 0 && !trulyInvisible) {
                    currentVisMonsters.add(m);
                    if (!this.visibleMonsters.has(m)) {
                        const seeMsg = i18next.t('vision.see_monster', { monster: m.name, defaultValue: `You see a ${m.name}.` });
                        const senseMsg = i18next.t('vision.sense_monster', { monster: m.name, defaultValue: `You sense a ${m.name}.` });
                        logger.log(cell.isVisible ? seeMsg : senseMsg, '#ffccaa');
                    }
                }
            }

            for (const i of this.items) {
                const cell = this.grid.getCell(i.loc.x, i.loc.y);
                if (cell && cell.isVisible) {
                    currentVisItems.add(i);
                    if (!this.visibleItems.has(i)) {
                        const iName = (i as any).displayName || i.name;
                        logger.log(i18next.t('vision.notice_item', { item: iName, defaultValue: `You notice a ${iName}.` }), '#cccccc');
                    }
                }
            }

            this.visibleMonsters = currentVisMonsters;
            this.visibleItems = currentVisItems;

            // Recompute dynamic lights
            this.lightMap.clear();

            // 1. Ambient lighting (very dark blue/grey base) or just 0
            // For real Brogue feel, the FOV boundary acts as light boundary.
            // We'll have the Player cast a yellowish torch light.
            this.lightMap.addLight(this.player.loc.x, this.player.loc.y, 8, '#ffccaa', 100);

            // 2. Add other glowing entities (lava, glowing items, etc) here later.

            this.onRenderRequested();
            this.needsRender = false;
        }
    }

    public isTimePaused() {
        return this.isInventoryOpen;
    }

    private toRecordedInputData(data: unknown): RecordedInputData {
        if (data === undefined || data === null) return null;
        if (typeof data === 'number' || typeof data === 'string') return data;
        if (typeof data === 'object') {
            const maybePos = data as { x?: unknown; y?: unknown };
            if (typeof maybePos.x === 'number' && typeof maybePos.y === 'number') {
                return { x: maybePos.x, y: maybePos.y };
            }
        }
        return String(data);
    }

    private recordInputEvent(action: string, data?: unknown) {
        this.recordedInputEvents.push({
            index: this.recordedInputIndex++,
            tick: timeSystem.currentTick,
            depth: this.depth,
            player: { x: this.player.loc.x, y: this.player.loc.y },
            action,
            data: this.toRecordedInputData(data)
        });
    }

    public exportRecording(): GameRecording {
        return {
            version: 1,
            recordedAt: Date.now(),
            seed: this.currentSeed,
            mode: this.mode,
            startDepth: 1,
            events: this.recordedInputEvents.map((event) => ({
                index: event.index,
                tick: event.tick,
                depth: event.depth,
                player: { x: event.player.x, y: event.player.y },
                action: event.action,
                data: event.data
            }))
        };
    }

    public clearRecording() {
        this.recordedInputEvents = [];
        this.recordedInputIndex = 0;
        this.recordingStartAt = Date.now();
    }

    public clearReplay() {
        this.replayRecording = null;
        this.replayEvents = [];
        this.replayCursor = 0;
        this.replayStatus = 'idle';
        this.replayFrameAccumulator = 0;
    }

    private decodeRecordedInputData(data: RecordedInputData): unknown {
        if (data === null) return undefined;
        if (typeof data === 'number' || typeof data === 'string') return data;
        return { x: data.x, y: data.y };
    }

    private isValidRecording(recording: unknown): recording is GameRecording {
        if (!recording || typeof recording !== 'object') return false;
        const r = recording as Partial<GameRecording>;
        return r.version === 1
            && typeof r.seed === 'number'
            && typeof r.mode === 'string'
            && Array.isArray(r.events);
    }

    public loadReplay(recording: unknown): boolean {
        if (!this.isValidRecording(recording)) return false;
        const safeRecording: GameRecording = {
            version: 1,
            recordedAt: recording.recordedAt ?? Date.now(),
            seed: recording.seed,
            mode: recording.mode,
            startDepth: recording.startDepth ?? 1,
            events: recording.events.map((event, idx) => ({
                index: typeof event.index === 'number' ? event.index : idx,
                tick: typeof event.tick === 'number' ? event.tick : 0,
                depth: typeof event.depth === 'number' ? event.depth : 1,
                player: {
                    x: typeof event.player?.x === 'number' ? event.player.x : 0,
                    y: typeof event.player?.y === 'number' ? event.player.y : 0
                },
                action: typeof event.action === 'string' ? event.action : 'wait',
                data: event.data ?? null
            }))
        };

        this.startNewGame({ seed: safeRecording.seed, mode: safeRecording.mode });
        this.clearRecording();
        this.replayRecording = safeRecording;
        this.replayEvents = safeRecording.events;
        this.replayCursor = 0;
        this.replayStatus = this.replayEvents.length > 0 ? 'loaded' : 'finished';
        this.replayFrameAccumulator = 0;
        this.needsRender = true;
        this.update();
        return true;
    }

    public replayPlay() {
        if (!this.replayRecording) return;
        if (this.replayCursor >= this.replayEvents.length) {
            this.replayStatus = 'finished';
            return;
        }
        this.replayStatus = 'playing';
    }

    public replayPause() {
        if (this.replayStatus === 'playing') {
            this.replayStatus = 'loaded';
        }
    }

    public replayRestart() {
        if (!this.replayRecording) return;
        this.loadReplay(this.replayRecording);
    }

    public replayStep(silent: boolean = false) {
        if (!this.replayRecording) return;
        // P2-2 输入锁：动画推进期间回放步同样不得插入（否则会在怪物行动的
        // 半途落地玩家动作，破坏逐次演出的因果顺序）
        if (this.isInputLocked()) return;
        if (this.replayCursor >= this.replayEvents.length) {
            this.replayStatus = 'finished';
            return;
        }
        const event = this.replayEvents[this.replayCursor];
        if (!event) return;
        this.handlePlayerAction(event.action, this.decodeRecordedInputData(event.data), 'system');
        this.update();
        this.replayCursor++;

        if (this.replayCursor >= this.replayEvents.length) {
            this.replayStatus = 'finished';
            if (!silent) {
                logger.log(i18next.t('replay.finished', { defaultValue: 'Replay finished.' }), '#88ccff');
            }
        } else if (this.replayStatus !== 'playing') {
            this.replayStatus = 'loaded';
        }
    }

    public tickReplay() {
        if (this.replayStatus !== 'playing') return;
        this.replayFrameAccumulator++;
        if (this.replayFrameAccumulator < this.replayFramesPerStep) return;
        this.replayFrameAccumulator = 0;
        this.replayStep();
    }

    public replaySeek(targetIndex: number) {
        if (!this.replayRecording) return;

        const total = this.replayEvents.length;
        const clamped = Math.max(0, Math.min(Math.floor(targetIndex), total));
        this.loadReplay(this.replayRecording);

        for (let i = 0; i < clamped; i++) {
            this.replayStep(true);
            if (this.replayStatus === 'finished') break;
        }

        if (this.replayStatus === 'playing') {
            this.replayStatus = 'loaded';
        }
    }

    public handlePlayerAction(action: string, data?: unknown, source: 'player' | 'system' = 'player') {
        // P4-8 返工：justRested 每次输入先清零，仅 wait 分支置位（CE IO.c:2521-2527
        // 的 REST/PERIOD/NUMPAD5 置位、Time.c:2874 回合末清除的等价口径）。
        this.justRested = false;
        if (source === 'player' && this.replayStatus === 'playing') {
            return;
        }

        // P2-2 输入锁（决策 E1）：怪物行动动画播完之前，玩家输入一律忽略
        // （不录制、不生效）。system 源不受锁约束——harness/脚本驱动必须始终可用。
        if (source === 'player' && this.isInputLocked()) {
            return;
        }

        if (source === 'player') {
            this.recordInputEvent(action, data);
        }

        if (this.player.hasStatus('paralyzed') && action !== 'toggle_inventory' && action !== 'escape') {
            logger.log(
                i18next.t('status.player.paralyzed_cannot_act', {
                    defaultValue: 'You are paralyzed and cannot act!'
                }),
                '#ff9999'
            );
            timeSystem.currentTick += this.player.movementSpeed;
            this.playerTurnEnded();
            return;
        }

        if (action === 'toggle_inventory') {
            this.isInventoryOpen = !this.isInventoryOpen;
            return;
        }

        if (action === 'escape') {
            if (this.isInventoryOpen) {
                this.isInventoryOpen = false;
            }
            return;
        }

        if (action === 'auto_explore') {
            this.handleAutoExplore();
            return;
        }

        if (action === 'examine') {
            this.handleExamineNearest();
            return;
        }

        if (action === 'stairs_up') {
            const cell = this.grid.getCell(this.player.loc.x, this.player.loc.y);
            if (cell && cell.terrain === TerrainType.STAIRS_UP) {
                if (this.depth > 1) {
                    this.depth--;
                    this.generateDepth(true);
                    // CE RogueMain.c:562：换层时 synchronizePlayerTimeState
                    this.synchronizePlayerTimeState();
                    logger.log(i18next.t('game.ascend', { depth: this.depth, defaultValue: `You ascend to depth ${this.depth}.` }), '#ffff00');
                } else {
                    const hasAmulet = this.player.inventory.items.some(i => i.category === ItemCategory.AMULET && (i as any).identityId === 'amulet_of_yendor');
                    if (hasAmulet) {
                        logger.log(i18next.t('game.win', { defaultValue: 'You escaped the Dungeons of Doom with the Amulet of Yendor!' }), '#00ff00');
                        this.triggerGameOver(true);
                    } else {
                        logger.log(i18next.t('game.entrance_blocked', { defaultValue: 'The entrance is blocked. You cannot leave without the Amulet of Yendor.' }), '#aaaaaa');
                    }
                }
            } else {
                logger.log(i18next.t('game.no_stairs_up', { defaultValue: 'There are no stairs up here.' }), '#aaaaaa');
            }
            return;
        }

        if (action === 'stairs_down') {
            const cell = this.grid.getCell(this.player.loc.x, this.player.loc.y);
            if (cell && cell.terrain === TerrainType.STAIRS_DOWN) {
                this.depth++;
                this.generateDepth(false);
                // CE RogueMain.c:562：换层时 synchronizePlayerTimeState
                this.synchronizePlayerTimeState();
                logger.log(i18next.t('game.descend', { depth: this.depth, defaultValue: `You descend to depth ${this.depth}.` }), '#ffff00');
            } else {
                logger.log(i18next.t('game.no_stairs_down', { defaultValue: 'There are no stairs down here.' }), '#aaaaaa');
            }
            return;
        }

        if (action === 'wait_or_stairs_down') {
            const cell = this.grid.getCell(this.player.loc.x, this.player.loc.y);
            if (cell && cell.terrain === TerrainType.STAIRS_DOWN) {
                this.handlePlayerAction('stairs_down', undefined, 'system');
            } else {
                this.handlePlayerAction('wait', undefined, 'system');
            }
            return;
        }

        // Intercept inputs if inventory is open (except toggle)
        if (this.isInventoryOpen) {
            return;
        }

        // Any manual action interrupts auto-pathing
        this.autoPath = [];
        this.everSeenMonsters.clear();
        this.everSeenItems.clear();

        if (action === 'move' || action === 'wait') {
            let dx = 0, dy = 0;

            if (typeof data === 'number') {
                const dir = data as Direction;
                if (dir === Direction.UP) { dx = 0; dy = -1; }
                else if (dir === Direction.DOWN) { dx = 0; dy = 1; }
                else if (dir === Direction.LEFT) { dx = -1; dy = 0; }
                else if (dir === Direction.RIGHT) { dx = 1; dy = 0; }
                else if (dir === Direction.UPLEFT) { dx = -1; dy = -1; }
                else if (dir === Direction.UPRIGHT) { dx = 1; dy = -1; }
                else if (dir === Direction.DOWNLEFT) { dx = -1; dy = 1; }
                else if (dir === Direction.DOWNRIGHT) { dx = 1; dy = 1; }
            } else if (typeof data === 'object' && data !== null) {
                const delta = data as { x?: number; y?: number };
                dx = delta.x || 0;
                dy = delta.y || 0;
            }

            if ((dx !== 0 || dy !== 0) && this.player.hasStatus('hallucinating') && rng.randPercent(35)) {
                const dirs: Array<[number, number]> = [
                    [0, -1], [0, 1], [-1, 0], [1, 0],
                    [-1, -1], [1, -1], [-1, 1], [1, 1]
                ];
                const dir = dirs[rng.randRange(0, dirs.length - 1)]!;
                dx = dir[0];
                dy = dir[1];
                logger.log(
                    i18next.t('status.player.hallucinating_stumble', {
                        defaultValue: 'You stumble in a random direction!'
                    }),
                    '#cc99ff'
                );
            }

            if ((dx !== 0 || dy !== 0) && this.player.hp > 0) {
                const newX = this.player.loc.x + dx;
                const newY = this.player.loc.y + dy;

                const blockingMonster = this.getMonsterAt(newX, newY);

                // P4-5：CE Movement.c:1296 failsafe —— MB_SEIZED 置位但抓取者已经
                // 不在相邻处（多半是被杀死后从 this.monsters 里被 playerTurnEnded
                // 过滤掉了，见 findLiveSeizer 注释），清掉陈旧标记，本回合按正常
                // 移动/攻击流程走（不提前 return，紧接着下面的 blockingMonster
                // 判断与移动分支照常执行）。
                if (this.player.seized && !this.findLiveSeizer()) {
                    this.player.seized = false;
                }

                // P4-7：CE Movement.c:1175-1186 —— 移动未被阻挡时（目标格可通行，
                // 或格内是 MONST_ATTACKABLE_THRU_WALLS 目标）先试鞭、再试矛；出手即
                // 耗掉本回合（CE：playerRecoversFromAttacking(true) + playerTurnEnded），
                // 不落回普通移动/攻击。CE 的 diagonalBlocked 起步守卫不移植（web 全局
                // 无对角墙角判定，P4-5 起同口径，见报告）。
                const destCell = this.grid.getCell(newX, newY);
                const moveNotBlocked = !!destCell?.isPassable ||
                    (!!blockingMonster && blockingMonster.hasBehavior('MONST_ATTACKABLE_THRU_WALLS'));
                if (moveNotBlocked && this.tryPlayerWeaponGeometryAttack(dx, dy)) {
                    this.needsRender = true;
                    this.playerRecoversFromAttacking(true);
                    timeSystem.currentTick += this.player.attackSpeed;
                } else if (blockingMonster) {
                    // Attack —— P4-7：CE Movement.c:1216-1247，buildHitList
                    // （sweep = 武器带 ITEM_ATTACKS_ALL_ADJACENT，Combat.c:2049-2090）
                    // + 攻击循环（循环内复查目标存活，对应 CE MB_IS_DYING 复查）。
                    const hitList = this.buildPlayerMeleeHitList(blockingMonster);
                    let anyAttackHit = false;
                    for (const target of hitList) {
                        if (target.hp <= 0) continue;
                        if (this.resolvePlayerMeleeAttackOn(target)) anyAttackHit = true;
                    }

                    this.needsRender = true;
                    // CE Time.c:2438：攻击耗时 = attackSpeed，在结算处累加；
                    // P4-7：钝器命中时 2×attackSpeed（Time.c:2442-2444）
                    this.playerRecoversFromAttacking(anyAttackHit);
                    timeSystem.currentTick += this.player.attackSpeed;
                } else if (this.player.seized) {
                    // P4-5：CE Movement.c:1267-1297（MB_SEIZED 检查，playerMoves()
                    // 内，在攻击分支之后、地形判定之前——移动进空地才会走到这里，
                    // 撞向抓着自己的怪物本身仍然是正常攻击，已经由上面的
                    // blockingMonster 分支处理，不受这里影响）。
                    // 已知简化：CE 这里区分"首次按键（committed=false，取消按键不
                    // 耗回合）"与"已提交/看不见抓取者（耗回合但不移动）"两段式；
                    // web 的 handlePlayerAction 每次调用即对应一次已提交的单步
                    // 输入，没有"排队按键、可取消"的上层缓冲，因此统一按 CE 的
                    // committed 分支处理：耗掉这一回合、玩家原地不动，见报告。
                    const seizer = this.findLiveSeizer()!;
                    logger.log(i18next.t('combat.player_seized_struggle', {
                        monster: seizer.name,
                        defaultValue: `You struggle but the ${seizer.name} is holding you!`
                    }), '#ff8888');
                    timeSystem.currentTick += this.player.movementSpeed;
                    this.playerTurnEnded();
                } else if (this.grid.getCell(newX, newY)?.terrain === TerrainType.LOCKED_DOOR) {
                    const keyItem = this.player.inventory.items.find((i: import('../Items/Item').Item) => i.category === ItemCategory.KEY);
                    if (keyItem) {
                        this.player.inventory.removeItem(keyItem);
                        this.grid.setTerrain(newX, newY, TerrainType.OPEN_DOOR, "'", 0xaa8844);
                        logger.log(i18next.t('door.unlocked', { defaultValue: 'You unlock the door with a key.' }), '#88ff88');

                        // Check if we freed a caged monster
                        for (const m of this.monsters) {
                            if (m.isCaged) {
                                // Cage interior is 1 step away from the door
                                const dist = Math.max(Math.abs(m.loc.x - newX), Math.abs(m.loc.y - newY));
                                if (dist <= 2) {
                                    m.isCaged = false;
                                    m.isAlly = true;
                                    logger.log(i18next.t('monster.freed', {
                                        monster: m.name,
                                        defaultValue: `The ${m.name} is grateful for its freedom and joins you!`
                                    }), '#88ff88');
                                    this.spawnFloatingText('Ally!', m.loc.x, m.loc.y, 0x88ff88);
                                }
                            }
                        }

                        this.needsRender = true;
                        timeSystem.currentTick += this.player.movementSpeed;
                    } else {
                        logger.log(i18next.t('door.locked', { defaultValue: 'The door is locked. You need a key.' }), '#ffaa88');
                        this.needsRender = true;
                    }
                } else if (this.grid.getCell(newX, newY)?.terrain === TerrainType.ALTAR) {
                    const altarItemIdx = this.items.findIndex(i => i.loc.x === newX && i.loc.y === newY);
                    if (altarItemIdx > -1) {
                        const altarItem = this.items[altarItemIdx]!;
                        if (this.player.inventory.addItem(altarItem)) {
                            logger.log(i18next.t('item.pickup_altar', { name: altarItem.displayName, defaultValue: `You claim ${altarItem.displayName} from the altar.` }), '#ffffaa');
                            this.items.splice(altarItemIdx, 1);

                            // Collapse other altars in the group
                            const groupId = this.grid.getCell(newX, newY)!.altarGroupId;
                            if (groupId !== null) {
                                let collapsedAtLeastOne = false;
                                for (let x = 1; x < DCOLS - 1; x++) {
                                    for (let y = 1; y < DROWS - 1; y++) {
                                        const c = this.grid.getCell(x, y);
                                        if (c && c.terrain === TerrainType.ALTAR && c.altarGroupId === groupId) {
                                            c.terrain = TerrainType.CHARRED_FLOOR;
                                            c.char = '.';
                                            c.color = 0x333333;
                                            c.altarGroupId = null;
                                            c.isPassable = true;
                                            // destroy any item there
                                            const otherIdx = this.items.findIndex(i => i.loc.x === x && i.loc.y === y);
                                            if (otherIdx > -1) {
                                                this.items.splice(otherIdx, 1);
                                                collapsedAtLeastOne = true;
                                            }
                                        }
                                    }
                                }
                                if (collapsedAtLeastOne) {
                                    logger.log(i18next.t('item.altar_collapse', { defaultValue: `The other altars sink into the floor.` }), '#aaaaaa');
                                }
                            }

                            this.needsRender = true;
                            // CE 无祭坛取物优惠耗时：与普通移动一样收满 movementSpeed
                            timeSystem.currentTick += this.player.movementSpeed;
                        } else {
                            logger.log(i18next.t('game.inventory_full', { defaultValue: 'Your inventory is full.' }), '#ff8888');
                        }
                    } else {
                        // Empty altar is walkable
                        this.player.loc.x = newX;
                        this.player.loc.y = newY;
                        this.needsRender = true;
                        timeSystem.currentTick += this.player.movementSpeed;
                        this.handleSpecialTileEntry();
                    }
                } else if (this.canMoveTo(newX, newY)) {
                    const currentCell = this.grid.getCell(this.player.loc.x, this.player.loc.y);
                    if (currentCell && currentCell.terrain === TerrainType.WEB) {
                        if (rng.randPercent(50)) {
                            logger.log(i18next.t('env.stuck_web', { defaultValue: 'You struggle against the sticky web.' }), '#aaaaaa');
                            if (rng.randPercent(20)) {
                                currentCell.terrain = TerrainType.FLOOR;
                                logger.log(i18next.t('env.break_web', { defaultValue: 'You break the web.' }), '#aaaaaa');
                            }
                            this.needsRender = true;
                            timeSystem.currentTick += this.player.movementSpeed;
                            if (this.needsRender) this.playerTurnEnded();
                            return;
                        }
                    }

                    // B-1：CE Movement.c:1368-1400 —— 突进/连枷目标在移动
                    // 【前】收集（连枷判据需要移动前坐标；突进看移动方向两格
                    // 之外），移动【后】结算（Movement.c:1480-1492）。
                    // 挣扎出网的 return 分支在上面：没动成就没有移动攻击。
                    const specialTargets = this.buildLungeFlailHitList(dx, dy, newX, newY);

                    // Move
                    this.player.loc.x = newX;
                    this.player.loc.y = newY;
                    this.needsRender = true;

                    if (specialTargets.length > 0) {
                        // B-1：CE Movement.c:1480-1492 —— 先移动后攻击；结算完
                        // 才 playerRecoversFromAttacking（攻击口径记进
                        // ticksUntilTurn，下方 playerTurnEnded 的 ==0 分支因此
                        // 跳过 movementSpeed——本回合耗时 = attackSpeed，刺剑
                        // 为 attackSpeed/2，与 CE 逐 tick 同构）。刺剑突进的
                        // lungeAttack 形参按武器旗标传入（CE Movement.c:1483）。
                        const lungeWeapon = !!this.player.equippedWeapon?.flags?.includes('ITEM_LUNGE_ATTACKS');
                        let anySpecialHit = false;
                        for (const target of specialTargets) {
                            if (target.hp <= 0) continue;
                            if (this.resolvePlayerMeleeAttackOn(target, lungeWeapon)) anySpecialHit = true;
                        }
                        // CE 的突进/连枷回合没有独立的 movementSpeed 开销：
                        // playerTurnEnded 只在 ticksUntilTurn==0 时补 movementSpeed，
                        // 攻击恢复已抢占该分支——currentTick 口径同步按攻击耗时记。
                        timeSystem.currentTick += this.player.attackSpeed;
                        this.playerRecoversFromAttacking(anySpecialHit);
                    } else {
                        // CE 的玩家移动耗时与地形无关（Time.c:2604 只看 movementSpeed）；
                        // web 原有的"泥泞 ×2"为自创口径，按 D1 移除。
                        timeSystem.currentTick += this.player.movementSpeed;
                    }

                    this.handleSpecialTileEntry();
                }

                if (this.needsRender) {
                    this.playerTurnEnded();
                }

            } else {
                // rest
                this.justRested = true; // P4-8 返工：CE rogue.justRested（IO.c:2521-2524）
                timeSystem.currentTick += this.player.movementSpeed;
                this.playerTurnEnded();
            }
        } else if (action === 'pickup') {
            const itemIndex = this.items.findIndex(i => i.loc.x === this.player.loc.x && i.loc.y === this.player.loc.y);
            if (itemIndex > -1) {
                const item = this.items[itemIndex]!;
                const cell = this.grid.getCell(this.player.loc.x, this.player.loc.y);

                const isFlying = this.player.hasStatus('flying') || this.player.hasStatus('levitating');
                if (cell && cell.terrain === TerrainType.WATER_DEEP && !isFlying) {
                    logger.log(i18next.t('item.deep_water_reach', { defaultValue: `The ${item.name} is deep underwater.` }), '#aaaaaa');
                    return;
                }
                if (cell && cell.terrain === TerrainType.LAVA && !isFlying && !this.player.hasStatus('immune_fire')) {
                    logger.log(i18next.t('item.lava_reach', { defaultValue: `The ${item.name} is submerged in lava.` }), '#ff4444');
                    return;
                }

                if (this.player.inventory.addItem(item)) {
                    if (item.category === ItemCategory.GOLD) {
                        this.stats.gold += 10; // Or whatever gold value
                    }
                    logger.log(i18next.t('item.pickup', { name: item.displayName, defaultValue: `You picked up ${item.displayName}.` }), '#ffffff');
                    this.items.splice(itemIndex, 1);
                    this.needsRender = true;
                    // CE 拾取无"半回合"优惠（自创口径移除），收满 movementSpeed
                    timeSystem.currentTick += this.player.movementSpeed;
                    this.playerTurnEnded();
                } else {
                    logger.log(i18next.t('game.inventory_full', { defaultValue: 'Your inventory is full.' }), '#ff8888');
                }
            }
        }
    }

    public equipItem(item: Item) {
        if (this.player.equip(item)) {
            logger.log(i18next.t('item.equip', { name: item.name, defaultValue: `You equipped the ${item.name}.` }), '#88ff88');
            this.syncEquipmentStatuses();
            this.needsRender = true;
            // CE Items.c:4024 equip() 以 playerTurnEnded() 收尾——完整回合
            timeSystem.currentTick += this.player.movementSpeed;
            this.playerTurnEnded();
        } else {
            logger.log(i18next.t('item.equip_fail', { name: item.name, defaultValue: `You cannot equip the ${item.name}.` }), '#ff8888');
        }
    }

    public unequipItem(item: Item) {
        this.player.unequip(item);
        logger.log(i18next.t('item.unequip', { name: item.name, defaultValue: `You took off the ${item.name}.` }), '#aaaaaa');
        this.syncEquipmentStatuses();
        this.needsRender = true;
        // CE Items.c:8349 unequipItem 成功路径以 playerTurnEnded() 收尾——完整回合
        timeSystem.currentTick += this.player.movementSpeed;
        this.playerTurnEnded();
    }

    public dropItem(item: Item) {
        if (this.player.inventory.removeItem(item)) {
            this.player.unequip(item);
            this.syncEquipmentStatuses();
            item.loc = { x: this.player.loc.x, y: this.player.loc.y };
            this.items.push(item);
            logger.log(i18next.t('item.drop', { name: item.name, defaultValue: `Dropped ${item.name}.` }), '#aaaaaa');
            this.needsRender = true;
            // CE Items.c:8390 drop() 以 playerTurnEnded() 收尾——完整回合
            timeSystem.currentTick += this.player.movementSpeed;
            this.playerTurnEnded();
        }
    }

    public quaffItem(item: Item) {
        if (item.category !== ItemCategory.POTION) return;

        // Remove from inventory
        if (this.player.inventory.removeItem(item)) {
            const trueId = (item as any).consumableId;
            const data = ItemLoader.potions.find(p => p.id === trueId);

            if (data) {
                // Log what we are drinking before we might identify it
                const quaffedName = item.displayName;
                logger.log(i18next.t('potion.quaff', { name: quaffedName, defaultValue: `You quaff the ${quaffedName}.` }), '#cccccc');

                // Execute effect
                switch (data.effect) {
                    case 'heal_full':
                        this.player.hp = this.player.maxHp;
                        logger.log(i18next.t('potion.heal_full', { defaultValue: 'You feel much better!' }), '#44ff44');
                        break;
                    case 'heal_partial':
                        this.player.hp = Math.min(this.player.hp + Math.floor(this.player.maxHp / 2), this.player.maxHp);
                        logger.log(i18next.t('potion.heal_partial', { defaultValue: 'You feel slightly better.' }), '#44ff44');
                        break;
                    case 'gain_strength':
                        this.player.strength += 1;
                        logger.log(i18next.t('potion.strength', { defaultValue: 'You feel stronger!' }), '#ff4444');
                        break;
                    case 'fall_down':
                        logger.log(i18next.t('potion.descent', { defaultValue: 'The floor opens beneath you!' }), '#ff8844');
                        break;
                    case 'fire_burst':
                        logger.log(i18next.t('potion.fire_burst', { defaultValue: 'Flames burst out of the bottle!' }), '#ffaa00');
                        this.environment.ignite(this.player.loc.x, this.player.loc.y);
                        this.environment.ignite(this.player.loc.x + 1, this.player.loc.y);
                        this.environment.ignite(this.player.loc.x - 1, this.player.loc.y);
                        break;
                    case 'poison_burst':
                        logger.log(i18next.t('potion.poison_burst', { defaultValue: 'A toxic cloud billows around you!' }), '#88ff88');
                        this.environment.addGas(this.player.loc.x, this.player.loc.y, 2, 70);
                        break;
                    case 'confusion_burst':
                        this.applyTimedStatus(this.player, 'hallucinating', 12);
                        logger.log(i18next.t('potion.confusion_burst', { defaultValue: 'Reality bends and shimmers around you!' }), '#cc99ff');
                        break;
                    case 'paralyze_burst':
                        this.applyTimedStatus(this.player, 'paralyzed', 8);
                        logger.log(i18next.t('potion.paralyze_burst', { defaultValue: 'You are frozen in place!' }), '#cc99ff');
                        break;
                    case 'hallucinate_burst':
                        this.applyTimedStatus(this.player, 'hallucinating', 20);
                        logger.log(i18next.t('potion.hallucinate_burst', { defaultValue: 'The world transforms into a swirling kaleidoscope of colors!' }), '#cc99ff');
                        break;
                    case 'creeping_death':
                        this.environment.addGas(this.player.loc.x, this.player.loc.y, 1, 100); // Will add actual caustic gas later
                        logger.log(i18next.t('potion.creeping_death', { defaultValue: 'A terrifying green gas fills the area!' }), '#88ff88');
                        break;
                    case 'resist_fire':
                        this.player.grantTemporaryImmunity('burning' as any, 50);
                        logger.log(i18next.t('potion.resist_fire', { defaultValue: 'You feel comfortably cool.' }), '#88ccff');
                        break;
                    case 'become_invisible':
                        this.applyTimedStatus(this.player, 'invisible', 30);
                        logger.log(i18next.t('potion.become_invisible', { defaultValue: 'You fade perfectly into the shadows.' }), '#aaaaaa');
                        break;
                    case 'levitate':
                        this.applyTimedStatus(this.player, 'levitating', 30);
                        logger.log(i18next.t('potion.levitate', { defaultValue: 'You float gently into the air.' }), '#aaaaff');
                        break;
                    case 'telepathy':
                        this.applyTimedStatus(this.player, 'telepathy', 40);
                        logger.log(i18next.t('potion.telepathy', { defaultValue: 'Your mind expands outwardly.' }), '#aaaaff');
                        break;
                    case 'speed':
                        this.applyTimedStatus(this.player, 'haste', 30);
                        logger.log(i18next.t('potion.speed', { defaultValue: 'Everything around you seems to slow down.' }), '#ffffaa');
                        break;
                    case 'detect_magic':
                        logger.log(i18next.t('potion.detect_magic', { defaultValue: 'You sense magical auras nearby.' }), '#aaaaff');
                        break;
                    default:
                        logger.log(i18next.t('potion.unknown', { defaultValue: 'It tastes weird.' }), '#aaaaaa');
                        break;
                }

                if (!ItemLoader.identifiedItems.has(trueId)) {
                    ItemLoader.identify(trueId);
                    logger.log(i18next.t('item.identified_as', { name: item.name, defaultValue: `It was a ${item.name}!` }), '#00ffff');
                }
            }

            this.needsRender = true;
            // CE Items.c:7633 apply()：POTION 分支后统一 playerTurnEnded()——完整回合
            timeSystem.currentTick += this.player.movementSpeed;
            this.playerTurnEnded();
        }
    }

    public eatItem(item: Item) {
        if (item.category !== ItemCategory.FOOD) return;

        if (this.player.inventory.removeItem(item)) {
            const trueId = (item as any).consumableId;
            const data = ItemLoader.food.find(f => f.id === trueId);

            if (data) {
                logger.log(i18next.t('food.eat', { name: item.displayName, defaultValue: `You eat the ${item.displayName}.` }), '#cccccc');

                if (data.effect === 'nourish') {
                    // CE Items.c:7491: nutrition = min(food.power + nutrition, STOMACH_SIZE)
                    const restore = (data as ConsumableConfig & { nutrition?: number }).nutrition ?? 0;
                    this.player.nutrition = Math.min(this.player.maxNutrition, this.player.nutrition + restore);
                    logger.log(i18next.t('food.nourish', { defaultValue: 'That tasted great! You feel full.' }), '#44ff44');
                }

                if (!ItemLoader.identifiedItems.has(trueId)) {
                    ItemLoader.identify(trueId);
                }
            }

            this.needsRender = true;
            // CE Items.c:7633 apply()：FOOD 分支后统一 playerTurnEnded()——完整回合
            timeSystem.currentTick += this.player.movementSpeed;
            this.playerTurnEnded();
        }
    }

    public readItem(item: Item) {
        if (item.category !== ItemCategory.SCROLL) return;

        if (this.player.inventory.removeItem(item)) {
            const trueId = (item as any).consumableId;
            const data = ItemLoader.scrolls.find(s => s.id === trueId);

            if (data) {
                const readName = item.displayName;
                logger.log(i18next.t('scroll.read', { name: readName, defaultValue: `You read the ${readName}.` }), '#cccccc');

                // Execute effect
                switch (data.effect) {
                    case 'reveal_map':
                        // Simple full reveal
                        for (let x = 0; x < DCOLS; x++) {
                            for (let y = 0; y < DROWS; y++) {
                                const cell = this.grid.getCell(x, y);
                                if (cell) cell.isExplored = true;
                            }
                        }
                        logger.log(i18next.t('scroll.mapping', { defaultValue: 'You have clairvoyance of the floor!' }), '#aaaaff');
                        break;
                    case 'teleport_random':
                        logger.log(i18next.t('scroll.teleport', { defaultValue: 'You are suddenly teleported!' }), '#ff44ff');
                        // Items.c:7803 SCROLL_TELEPORT: teleport(&player, INVALID_POS, true)
                        this.teleportPlayerRandom();
                        break;
                    case 'identify_item':
                        if (!this.identifyRandomItem()) {
                            logger.log(i18next.t('scroll.identify_fail', { defaultValue: 'Nothing new to identify.' }), '#aaaaaa');
                        } else {
                            logger.log(i18next.t('scroll.identify', { defaultValue: 'A flash of insight enters your mind!' }), '#ffff44');
                        }
                        break;
                    case 'enchant_item':
                        if (!this.enchantEquippedItem()) {
                            logger.log(i18next.t('scroll.enchant_fail', { defaultValue: 'Nothing happens.' }), '#aaaaaa');
                        } else {
                            logger.log(i18next.t('scroll.enchant', { defaultValue: 'Arcane force sharpens your gear.' }), '#99ddff');
                        }
                        break;
                    case 'remove_curse':
                        if (!this.removeCurseFromInventory()) {
                            logger.log(i18next.t('scroll.remove_curse_empty', { defaultValue: 'No cursed items to cleanse.' }), '#aaaaaa');
                        }
                        break;
                    case 'recharge_item':
                        if (!this.rechargeRandomArcana()) {
                            logger.log(i18next.t('scroll.recharge_item_empty', { defaultValue: 'No depleted arcana item to recharge.' }), '#aaaaaa');
                        }
                        break;
                    case 'protect_weapon':
                        // Items.c:7922-7938 SCROLL_PROTECT_WEAPON
                        this.protectEquippedGear(this.player.equippedWeapon, 'weapon');
                        break;
                    case 'protect_armor':
                        // Items.c:7906-7921 SCROLL_PROTECT_ARMOR
                        this.protectEquippedGear(this.player.equippedArmor, 'armor');
                        break;
                    case 'negate_burst':
                        logger.log(i18next.t('scroll.negate_burst', { defaultValue: 'A wave of silence radiates from the scroll.' }), '#888888');
                        break;
                    case 'sanctuary_burst':
                        logger.log(i18next.t('scroll.sanctuary', { defaultValue: 'A circle of holy light forms around you.' }), '#ffffaa');
                        break;
                    case 'shatter_burst':
                        logger.log(i18next.t('scroll.shatter', { defaultValue: 'The ground shakes violently!' }), '#ffaa88');
                        break;
                    case 'discord_burst':
                        // Items.c:8011 SCROLL_DISCORD: discordBlast("the scroll", DCOLS)
                        this.discordBlastFromPlayer('the scroll');
                        break;
                    case 'summon_monsters':
                        // Items.c:7977-7990 SCROLL_SUMMON_MONSTER
                        this.summonMonstersAroundPlayer();
                        break;
                    case 'amnesia':
                        logger.log(i18next.t('scroll.amnesia', { defaultValue: 'Your memory of this level is wiped clean.' }), '#aaaaaa');
                        break;
                    default:
                        logger.log(i18next.t('scroll.unknown', { defaultValue: 'The runes fade.' }), '#aaaaaa');
                        break;
                }

                if (!ItemLoader.identifiedItems.has(trueId)) {
                    ItemLoader.identify(trueId);
                    logger.log(i18next.t('item.was_a', { name: item.name, defaultValue: `It was a ${item.name}!` }), '#00ffff');
                }
            }

            this.needsRender = true;
            // CE Items.c:7633 apply()：SCROLL 分支后统一 playerTurnEnded()——完整回合
            timeSystem.currentTick += this.player.movementSpeed;
            this.playerTurnEnded();
        }
    }

    public useArcanaItem(item: Item) {
        if (
            item.category !== ItemCategory.WAND
            && item.category !== ItemCategory.STAFF
            && item.category !== ItemCategory.CHARM
        ) {
            return;
        }

        const identityId = (item as any).identityId as string | undefined;

        if (item.category === ItemCategory.CHARM) {
            const remaining = item.cooldownRemaining ?? 0;
            if (remaining > 0) {
                logger.log(i18next.t('arcana.cooldown', { name: item.name, turns: remaining, defaultValue: `${item.name} is on cooldown (${remaining} turns).` }), '#aaaaaa');
                return;
            }

            if (identityId === 'charm_of_health' || item.name.includes('Health')) {
                const healed = Math.min(this.player.maxHp - this.player.hp, 8);
                this.player.hp += healed;
                logger.log(i18next.t('arcana.charm_health', { item: item.name, heal: healed, defaultValue: `You invoke ${item.name} and recover ${healed} HP.` }), '#66ff88');
            } else if (identityId === 'charm_of_invisibility' || item.name.includes('Invisibility')) {
                this.applyTimedStatus(this.player, 'invisible', 18);
                logger.log(i18next.t('arcana.charm_invisibility', { item: item.name, defaultValue: `You invoke ${item.name} and vanish from sight.` }), '#99ccff');
            } else if (identityId === 'charm_of_speed' || item.name.includes('Speed')) {
                this.applyTimedStatus(this.player, 'levitating', 20);
                logger.log(i18next.t('arcana.charm_speed', { item: item.name, defaultValue: `You invoke ${item.name} and feel unnaturally swift.` }), '#99ddff');
            } else if (identityId === 'charm_of_protection' || item.name.includes('Protection')) {
                // Grant temporary immunity to a random negative status
                const negativeStatuses: StatusId[] = ['paralyzed', 'confused', 'hallucinating'];
                const chosen = negativeStatuses[rng.randRange(0, negativeStatuses.length - 1)] as StatusId;
                this.player.grantTemporaryImmunity(chosen, 15);
                logger.log(i18next.t('arcana.charm_protection', { item: item.name, status: this.getStatusLabel(chosen), defaultValue: `You invoke ${item.name} and feel shielded against ${this.getStatusLabel(chosen)}.` }), '#ffffaa');
            } else {
                logger.log(i18next.t('arcana.charm_generic', { item: item.name, defaultValue: `You invoke ${item.name}.` }), '#88ccff');
            }
            item.cooldownRemaining = item.cooldownTurns ?? 300;
            if (identityId && !ItemLoader.identifiedItems.has(identityId)) {
                ItemLoader.identify(identityId);
                logger.log(i18next.t('item.identify', { name: item.name, defaultValue: `You identify ${item.name}.` }), '#00ffff');
            }
            timeSystem.currentTick += 100;
            this.playerTurnEnded();
            return;
        }

        const charges = item.charges ?? 0;
        if (charges <= 0) {
            logger.log(i18next.t('arcana.no_charges', { name: item.name, defaultValue: `${item.name} has no charges.` }), '#ff8888');
            return;
        }

        item.charges = charges - 1;
        item.rechargeCounter = item.rechargeCounter ?? 0;
        if (identityId && !ItemLoader.identifiedItems.has(identityId)) {
            ItemLoader.identify(identityId);
            logger.log(i18next.t('item.identify', { name: item.name, defaultValue: `You identify ${item.name}.` }), '#00ffff');
        }

        // --- Try bolt system first ---
        const boltCfg = getBoltForItem(identityId ?? '');
        if (boltCfg) {
            this.zapBoltFromPlayer(boltCfg, item);
        } else if (identityId === 'wand_of_fire' || item.name.includes('Fire')) {
            const tx = this.player.loc.x;
            const ty = this.player.loc.y - 1;
            this.environment.ignite(tx, ty);
            logger.log(i18next.t('staff.fire_burst', { name: item.name, defaultValue: `A burst of fire leaps from ${item.name}!` }), '#ffaa00');
        } else if (identityId === 'staff_of_light' || item.name.includes('Light')) {
            this.applyTimedStatus(this.player, 'telepathy', 25);
            this.spawnFloatingText('+Light', this.player.loc.x, this.player.loc.y - 1, 0xffffaa);
            logger.log(i18next.t('staff.bright_aura', { name: item.name, defaultValue: `A bright aura radiates from ${item.name}.` }), '#ffffaa');
        } else {
            logger.log(i18next.t('item.use_generic', { name: item.name, defaultValue: `You use ${item.name}.` }), '#88ccff');
        }

        this.needsRender = true;
        timeSystem.currentTick += 100;
        this.playerTurnEnded();
    }

    // ----- Bolt Zapping System -----

    /**
     * Zap a bolt from the player toward a target.
     * Auto-targets the nearest visible monster, or fires in the player's last move direction.
     */
    public zapBoltFromPlayer(bolt: BoltConfig, item: Item) {
        // Find nearest visible monster as target
        const visibleMonsters = this.monsters
            .filter((m) => m.hp > 0 && this.grid.getCell(m.loc.x, m.loc.y)?.isVisible)
            .sort((a, b) => {
                const da = Math.abs(a.loc.x - this.player.loc.x) + Math.abs(a.loc.y - this.player.loc.y);
                const db = Math.abs(b.loc.x - this.player.loc.x) + Math.abs(b.loc.y - this.player.loc.y);
                return da - db;
            });

        let targetPos: Pos;
        if (bolt.selfTargeting) {
            targetPos = { x: this.player.loc.x, y: this.player.loc.y };
        } else if (visibleMonsters.length > 0) {
            const nearest = visibleMonsters[0] as Monster;
            targetPos = { x: nearest.loc.x, y: nearest.loc.y };
        } else {
            // Fire in the direction the player last moved (default: right)
            const lastDir = this.player.lastMoveDirection ?? Direction.RIGHT;
            const dirVec = this.directionToVec(lastDir);
            targetPos = {
                x: this.player.loc.x + dirVec.x * 20,
                y: this.player.loc.y + dirVec.y * 20,
            };
        }

        const result = this.computeBoltResult(bolt, this.player.loc, targetPos);
        this.applyBoltResult(result, item);
    }

    /** Convert a Direction enum to a unit vector. */
    private directionToVec(dir: Direction): Pos {
        switch (dir) {
            case Direction.UP: return { x: 0, y: -1 };
            case Direction.DOWN: return { x: 0, y: 1 };
            case Direction.LEFT: return { x: -1, y: 0 };
            case Direction.RIGHT: return { x: 1, y: 0 };
            case Direction.UPLEFT: return { x: -1, y: -1 };
            case Direction.UPRIGHT: return { x: 1, y: -1 };
            case Direction.DOWNLEFT: return { x: -1, y: 1 };
            case Direction.DOWNRIGHT: return { x: 1, y: 1 };
            default: return { x: 1, y: 0 };
        }
    }

    /**
     * Compute the bolt's travel path, checking for wall/creature collisions.
     */
    private computeBoltResult(bolt: BoltConfig, origin: Pos, target: Pos): BoltResult {
        const rawPath = boltPath(origin, target, bolt.maxRange > 0 ? bolt.maxRange : 40);
        const finalPath: Pos[] = [];
        let impactPos: Pos = origin;

        for (const pos of rawPath) {
            // Check bounds
            if (pos.x < 0 || pos.x >= DCOLS || pos.y < 0 || pos.y >= DROWS) break;

            // Check wall / obstacle
            const cell = this.grid.getCell(pos.x, pos.y);
            if (!cell) break;
            if (cell.terrain === TerrainType.WALL || cell.terrain === TerrainType.GRANITE) break;

            finalPath.push(pos);
            impactPos = pos;

            // Check for creature at this position
            const monster = this.monsters.find(m => m.hp > 0 && m.loc.x === pos.x && m.loc.y === pos.y);
            if (monster && !bolt.piercing) {
                break;
            }
            if (monster && bolt.piercing) {
                // Continue through for piercing bolts (like lightning)
            }
        }

        const frames = buildBoltFrames(finalPath, bolt);
        return {
            path: finalPath,
            impactPos,
            effect: bolt.effect,
            magnitude: bolt.magnitude,
            bolt,
            frames,
        };
    }

    /**
     * Apply the bolt result: schedule animation frames and apply the effect.
     */
    private applyBoltResult(result: BoltResult, item: Item) {
        // Queue animation frames for the renderer
        this.pendingBoltFrames = result.frames;
        this.currentBoltFrameIndex = 0;
        this.boltAnimStartTime = Date.now();

        // Apply the effect
        this.applyBoltEffect(result, item);
    }

    // Bolt animation state (consumed by the render loop in GameCanvas.vue)
    public pendingBoltFrames: BoltFrame[] = [];
    public currentBoltFrameIndex: number = 0;
    public boltAnimStartTime: number = 0;

    /** Advance the bolt animation by one tick. Returns true if animation is still playing. */
    public tickBoltAnimation(): boolean {
        if (this.pendingBoltFrames.length === 0) return false;
        const elapsed = Date.now() - this.boltAnimStartTime;
        let accumulated = 0;
        for (let i = 0; i < this.pendingBoltFrames.length; i++) {
            const frame = this.pendingBoltFrames[i]!;
            accumulated += frame.durationMs;
            if (elapsed < accumulated) {
                this.currentBoltFrameIndex = i;
                return true;
            }
        }
        // Animation finished
        this.pendingBoltFrames = [];
        this.currentBoltFrameIndex = 0;
        return false;
    }

    /** Get the current bolt frame to render (if any). */
    public getCurrentBoltFrame(): BoltFrame | null {
        if (this.pendingBoltFrames.length === 0) return null;
        return this.pendingBoltFrames[this.currentBoltFrameIndex] ?? null;
    }

    /**
     * Apply the bolt's effect at its impact position and along its path.
     */
    /**
     * P4-3：玩家直接施法的伤害类 bolt（FIRE/LIGHTNING）不走 CombatSystem.attack，
     * 是 target.takeDamage(magnitude) 硬编码调用——这里补上 CE 的两条豁免：
     *   - MONST_INVULNERABLE（Combat.c:1806 inflictDamage）：伤害归零，不掉血。
     *   - MA_REFLECT_100/MONST_REFLECT_50（Items.c:4978-4983 projectileReflects，
     *     GlobalsBrogue.c boltCatalog "flame"/"lightning" 均无 BF_NEVER_REFLECTS）：
     *     伤害改记到玩家自己身上（弹道折返给施法者，Items.c:5681 reflectBolt）。
     * 返回 true 表示伤害按原计划打在 target 身上（调用方继续走命中消息分支）；
     * 返回 false 表示伤害被吞掉或反射（调用方跳过"命中"消息，改由这里的消息负责）。
     */
    private applyDirectBoltDamage(target: Creature, magnitude: number, reflectKey: string, reflectDefault: string): boolean {
        if (target instanceof Monster && target.isInvulnerable()) {
            logger.log(i18next.t('bolt.invulnerable_no_effect', {
                target: target.name,
                defaultValue: `The ${target.name} is unaffected.`
            }), '#aaaaaa');
            return false;
        }
        if (target instanceof Monster) {
            const chance = target.reflectChance();
            if (chance > 0 && rng.randPercent(chance)) {
                this.player.takeDamage(magnitude);
                logger.log(i18next.t(reflectKey, { target: target.name, defaultValue: reflectDefault }), '#99ddff');
                this.spawnFloatingText(`-${magnitude}`, this.player.loc.x, this.player.loc.y, 0x99ddff);
                return false;
            }
        }
        target.takeDamage(magnitude);
        return true;
    }

    private applyBoltEffect(result: BoltResult, item: Item) {
        const { effect, magnitude, impactPos, path } = result;

        // Find the monster at impact position
        const target = this.monsters.find(
            m => m.hp > 0 && m.loc.x === impactPos.x && m.loc.y === impactPos.y
        );

        switch (effect) {
            case BoltEffect.FIRE: {
                // Ignite on impact and deal damage
                this.environment.ignite(impactPos.x, impactPos.y);
                if (target && this.applyDirectBoltDamage(target, magnitude, 'bolt.fire_reflect', `The ${target.name} deflects the fire back at you!`)) {
                    logger.log(i18next.t('bolt.fire_hit', {
                        name: item.name, target: target.name, damage: magnitude,
                        defaultValue: `${item.name} scorches the ${target.name} for ${magnitude} damage!`
                    }), '#ff6600');
                    this.spawnFloatingText(`-${magnitude}`, target.loc.x, target.loc.y, 0xff4400);
                    if (target.hp <= 0) {
                        logger.log(i18next.t('bolt.fire_kill', {
                            target: target.name,
                            defaultValue: `The ${target.name} burns to death.`
                        }), '#ff8800');
                    } else {
                        // P4-4：CE Items.c:5213 splitMonster —— bolt 命中怪物时同样触发分裂。
                        this.trySplitMonster(target, this.player);
                    }
                } else if (!target) {
                    logger.log(i18next.t('bolt.fire_impact', {
                        name: item.name,
                        defaultValue: `A burst of fire leaps from ${item.name}!`
                    }), '#ffaa00');
                }
                // Fire along the path trail
                for (const p of path) {
                    this.environment.ignite(p.x, p.y);
                }
                break;
            }

            case BoltEffect.LIGHTNING: {
                // Lightning pierces through all creatures along the path and deals damage
                let totalDamage = 0;
                for (const p of path) {
                    const m = this.monsters.find(
                        mon => mon.hp > 0 && mon.loc.x === p.x && mon.loc.y === p.y
                    );
                    if (m) {
                        if (!this.applyDirectBoltDamage(m, magnitude, 'bolt.lightning_reflect', `The ${m.name} deflects the lightning back at you!`)) {
                            continue;
                        }
                        totalDamage += magnitude;
                        this.spawnFloatingText(`-${magnitude}`, m.loc.x, m.loc.y, 0x33ccff);
                        logger.log(i18next.t('bolt.lightning_hit', {
                            name: item.name, target: m.name, damage: magnitude,
                            defaultValue: `Lightning from ${item.name} strikes the ${m.name} for ${magnitude} damage!`
                        }), '#33ccff');
                        if (m.hp <= 0) {
                            logger.log(i18next.t('bolt.lightning_kill', {
                                target: m.name,
                                defaultValue: `The ${m.name} is electrocuted!`
                            }), '#55ddff');
                        } else {
                            // P4-4：同 FIRE 分支，Items.c:5213 splitMonster。
                            this.trySplitMonster(m, this.player);
                        }
                    }
                }
                if (totalDamage === 0) {
                    logger.log(i18next.t('bolt.lightning_miss', {
                        name: item.name,
                        defaultValue: `Lightning arcs from ${item.name} but finds no target.`
                    }), '#33ccff');
                }
                break;
            }

            case BoltEffect.POISON: {
                if (target) {
                    this.applyStatusToMonster(target, 'poisoned', magnitude * 3, 'magic');
                    logger.log(i18next.t('bolt.poison_hit', {
                        name: item.name, target: target.name,
                        defaultValue: `${item.name} envenomates the ${target.name}!`
                    }), '#55cc55');
                } else {
                    logger.log(i18next.t('bolt.poison_miss', {
                        name: item.name,
                        defaultValue: `Poison streams from ${item.name} but finds no target.`
                    }), '#55cc55');
                }
                break;
            }

            case BoltEffect.TELEPORT: {
                if (target) {
                    // Teleport the target to a random open cell
                    let dest: Pos | null = null;
                    for (let attempt = 0; attempt < 100; attempt++) {
                        const rx = rng.randRange(0, DCOLS - 1);
                        const ry = rng.randRange(0, DROWS - 1);
                        const rc = this.grid.getCell(rx, ry);
                        if (rc && rc.terrain === TerrainType.FLOOR) {
                            dest = { x: rx, y: ry };
                            break;
                        }
                    }
                    if (dest) {
                        target.loc.x = dest.x;
                        target.loc.y = dest.y;
                        logger.log(i18next.t('bolt.teleport_hit', {
                            name: item.name, target: target.name,
                            defaultValue: `${item.name} teleports the ${target.name} away!`
                        }), '#cc88ff');
                    }
                } else {
                    logger.log(i18next.t('bolt.teleport_miss', {
                        name: item.name,
                        defaultValue: `${item.name} flashes but finds no target.`
                    }), '#cc88ff');
                }
                break;
            }

            case BoltEffect.SLOW: {
                if (target) {
                    this.applyStatusToMonster(target, 'slowed', 20, 'magic');
                    logger.log(i18next.t('bolt.slow_hit', {
                        name: item.name, target: target.name,
                        defaultValue: `${item.name} slows the ${target.name}!`
                    }), '#888888');
                } else {
                    logger.log(i18next.t('bolt.slow_miss', { name: item.name, defaultValue: `${item.name} fires but finds no target.` }), '#888888');
                }
                break;
            }

            case BoltEffect.HEALING: {
                // Heals the player instead of targeting monsters
                const healed = Math.min(this.player.maxHp - this.player.hp, magnitude);
                this.player.hp += healed;
                logger.log(i18next.t('bolt.healing', {
                    name: item.name, heal: healed,
                    defaultValue: `${item.name} restores ${healed} HP!`
                }), '#44ff88');
                this.spawnFloatingText(`+${healed}`, this.player.loc.x, this.player.loc.y, 0x44ff88);
                break;
            }

            case BoltEffect.HASTE: {
                this.applyTimedStatus(this.player, 'hasted', 15);
                logger.log(i18next.t('bolt.haste', {
                    name: item.name,
                    defaultValue: `${item.name} fills you with supernatural speed!`
                }), '#ffff88');
                break;
            }

            case BoltEffect.BECKONING: {
                if (target) {
                    // Pull the target closer to the player
                    const dx = Math.sign(this.player.loc.x - target.loc.x);
                    const dy = Math.sign(this.player.loc.y - target.loc.y);
                    const newX = target.loc.x + dx * 2;
                    const newY = target.loc.y + dy * 2;
                    if (newX >= 0 && newX < DCOLS && newY >= 0 && newY < DROWS) {
                        const destCell = this.grid.getCell(newX, newY);
                        if (destCell && destCell.terrain !== TerrainType.WALL && destCell.terrain !== TerrainType.GRANITE) {
                            target.loc.x = newX;
                            target.loc.y = newY;
                        }
                    }
                    logger.log(i18next.t('bolt.beckoning_hit', {
                        name: item.name, target: target.name,
                        defaultValue: `${item.name} pulls the ${target.name} toward you!`
                    }), '#88ccff');
                } else {
                    logger.log(i18next.t('bolt.beckoning_miss', { name: item.name, defaultValue: `No target answers ${item.name}.` }), '#aaaaaa');
                }
                break;
            }

            case BoltEffect.DISCORD: {
                if (target) {
                    this.applyStatusToMonster(target, 'confused', 15, 'magic');
                    logger.log(i18next.t('bolt.discord_hit', {
                        name: item.name, target: target.name,
                        defaultValue: `${item.name} sows discord in the ${target.name}'s mind!`
                    }), '#ff88ff');
                } else {
                    logger.log(i18next.t('bolt.discord_miss', { name: item.name, defaultValue: `${item.name} fires but finds no target.` }), '#ff88ff');
                }
                break;
            }

            case BoltEffect.CONJURATION: {
                this.spawnFloatingText('Blade!', this.player.loc.x, this.player.loc.y - 1, 0xaaddff);
                logger.log(i18next.t('staff.phantom_force', { name: item.name, defaultValue: `Phantom force responds to ${item.name}.` }), '#aaddff');
                break;
            }

            case BoltEffect.SHIELDING: {
                this.applyTimedStatus(this.player, 'telepathy', 25);
                this.spawnFloatingText('+Light', this.player.loc.x, this.player.loc.y - 1, 0xffffaa);
                logger.log(i18next.t('staff.bright_aura', { name: item.name, defaultValue: `A bright aura radiates from ${item.name}.` }), '#ffffaa');
                break;
            }

            case BoltEffect.INVISIBILITY: {
                if (target) {
                    this.applyStatusToMonster(target, 'invisible', 20, 'magic');
                    logger.log(i18next.t('bolt.invisibility_hit', {
                        name: item.name, target: target.name,
                        defaultValue: `${item.name} makes the ${target.name} vanish!`
                    }), '#aaaaff');
                } else {
                    // Target self
                    this.applyTimedStatus(this.player, 'invisible', 20);
                    logger.log(i18next.t('bolt.invisibility_self', { name: item.name, defaultValue: `${item.name} wraps you in shadows.` }), '#aaaaff');
                }
                break;
            }

            case BoltEffect.EMPOWERMENT: {
                if (target && target.isAlly) {
                    target.maxHp = Math.floor(target.maxHp * 1.5);
                    target.hp = target.maxHp;
                    logger.log(i18next.t('bolt.empowerment_hit', {
                        name: item.name, target: target.name,
                        defaultValue: `${item.name} empowers the ${target.name}!`
                    }), '#ffff44');
                } else if (target) {
                    logger.log(i18next.t('bolt.empowerment_enemy', {
                        name: item.name, target: target.name,
                        defaultValue: `${item.name} empowers the ${target.name}!`
                    }), '#ffff44');
                    target.maxHp = Math.floor(target.maxHp * 1.3);
                    target.hp = target.maxHp;
                } else {
                    logger.log(i18next.t('bolt.empowerment_miss', { name: item.name, defaultValue: `${item.name} fires but finds no target.` }), '#ffff44');
                }
                break;
            }

            case BoltEffect.NEGATION: {
                if (target) {
                    // P4-3：CE Items.c:4483-4491 negate() —— MONST_DIES_IF_NEGATED 的怪物
                    // 被 negation 命中时直接死亡，而不是清状态（"是纯魔法造物，一旦
                    // 被消除魔法就无法维持存在"）。
                    if (target instanceof Monster && target.diesIfNegated()) {
                        logger.log(i18next.t('bolt.negation_dies', {
                            name: item.name, target: target.name,
                            defaultValue: `${target.name} falls to the ground, lifeless!`
                        }), '#ffffff');
                        target.takeDamage(target.hp);
                    } else {
                        // Remove all status effects from the target
                        if ('statusDurations' in target) {
                            const sd = (target as any).statusDurations as Record<string, number>;
                            for (const k of Object.keys(sd)) {
                                sd[k] = 0;
                            }
                        }
                        // P1-28：web 的 negate 不剥离 behaviorFlags（CE 的
                        // NEGATABLE_TRAITS 临时剥离+到期恢复未实现），旗标恒在，
                        // 故清空后立即重推导旗标派生状态——否则飞行/火免怪物
                        // 会被一次 negate 永久剥夺特性，CE 语义只是临时。
                        if (target instanceof Monster) target.syncFlagDerivedStatuses();
                        target.refreshSpeeds(); // P2-2：haste/slowed 被清，衍生速度立即复原
                        logger.log(i18next.t('bolt.negation_hit', {
                            name: item.name, target: target.name,
                            defaultValue: `${item.name} negates all magic on the ${target.name}!`
                        }), '#ffffff');
                    }
                } else {
                    logger.log(i18next.t('bolt.negation_miss', { name: item.name, defaultValue: `${item.name} fires but finds no target.` }), '#ffffff');
                }
                break;
            }

            case BoltEffect.TUNNELING: {
                // Dig through walls along the path
                for (const p of path) {
                    const cell = this.grid.getCell(p.x, p.y);
                    if (cell && (cell.terrain === TerrainType.WALL || cell.terrain === TerrainType.GRANITE)) {
                        cell.terrain = TerrainType.FLOOR;
                    }
                }
                logger.log(i18next.t('bolt.tunneling', {
                    name: item.name,
                    defaultValue: `${item.name} blasts a tunnel through the rock!`
                }), '#cc8855');
                break;
            }

            default:
                logger.log(i18next.t('item.use_generic', { name: item.name, defaultValue: `You use ${item.name}.` }), '#88ccff');
                break;
        }

    }

    /**
     * P4-1b：怪物施法的效果落地出口，被 Monster.tryUseBolt 调用（对应 CE
     * monsterCastSpell，Monsters.c:2764）。
     *
     * 设计取舍（"泛化 applyBoltEffect 但不破坏玩家路径"，详见报告）：没有
     * 直接改造上面那个巨大的、按 item 措辞的 applyBoltEffect switch——它的每个
     * 分支都绑死了"物品名 + 固定打玩家/固定回怪物"的叙事假设（如 HASTE/
     * SHIELDING 分支硬编码 this.player），改起来风险远大于收益。这里另开一个
     * 面向"施法者可以是怪物、目标可以是玩家或任意怪物"的精简出口，复用同一套
     * 底层原语（boltPath/buildBoltFrames 做路径与动画、applyStatusToMonster/
     * applyTimedStatus 做状态、environment.ignite 做点火、CombatSystem.attack
     * 做伤害判定），两条路径共享地基但不共享分支体，玩家原有调用
     * （zapBoltFromPlayer → applyBoltEffect）逐字节未改动。
     *
     * 伤害类 bolt（SPARK/FIRE/DRAGONFIRE/POISON_DART/DISTANCE_ATTACK）不走
     * CE zap() 的 bolt 专属伤害公式——那个公式在 Combat.ts/CombatFormulas.ts
     * （本轮禁改）里没有对应实现，重新发明一套会绕开项目既有的命中/防御/
     * onHit 状态管线。改用 CombatSystem.attack(caster, target)：这正是 P4-1a
     * 之前 'ranged' 占位桩已经在用的既有口径（centaur 等），伤害走怪物自己的
     * damageString，命中率/onHit（MA_POISONS 等）全部沿用，是本项目对"怪物
     * 远程攻击伤害"的既定简化，不是本轮新发明的。
     */
    public castMonsterBolt(caster: Monster, target: Creature, ceBoltName: string): void {
        const meta = MONSTER_BOLT_TABLE[ceBoltName];
        if (!meta || meta.effect === null) return; // 已知缺口/未映射，不应该走到这里

        const isPlayer = target === this.player;
        const targetName = isPlayer ? i18next.t('bolt.target_you', { defaultValue: 'you' }) : (target as Monster).name;

        // 动画：复用 boltPath/buildBoltFrames，用一个仅供施法出口使用的最小 BoltConfig。
        const path = boltPath(caster.loc, target.loc, 40);
        const visualBolt: BoltConfig = {
            id: `monster_bolt_${ceBoltName.toLowerCase()}`,
            name: ceBoltName,
            effect: meta.effect,
            magnitude: meta.magnitude,
            char: '*',
            color: 0xffcc66,
            maxRange: 0,
            piercing: false,
            selfTargeting: false,
        };
        this.pendingBoltFrames = buildBoltFrames(path, visualBolt);
        this.currentBoltFrameIndex = 0;
        this.boltAnimStartTime = Date.now();

        const casterLabel = caster.name;
        const logCast = (key: string, defaultValue: string, color: string) => {
            logger.log(i18next.t(key, { caster: casterLabel, target: targetName, defaultValue }), color);
        };

        switch (meta.effect) {
            case BoltEffect.SPARK:
            case BoltEffect.DISTANCE_ATTACK:
            case BoltEffect.POISON_DART:
            case BoltEffect.FIRE:
            case BoltEffect.DRAGONFIRE: {
                if (meta.effect === BoltEffect.FIRE || meta.effect === BoltEffect.DRAGONFIRE) {
                    this.environment.ignite(target.loc.x, target.loc.y);
                }
                // P4-3：CE GlobalsBrogue.c boltCatalog —— "spark"/"flame"/"dragonfire"
                // 都没有 BF_NEVER_REFLECTS，可被 MA_REFLECT_100/MONST_REFLECT_50 反射；
                // "arrow"(DISTANCE_ATTACK)/"poisoned dart"(POISON_DART) 标了
                // BF_NEVER_REFLECTS，永不反射。反射目标是原施法者 caster
                // （Items.c:5681 reflectBolt(originLoc...) 把弹道折返给发射者）。
                const canReflect = meta.effect === BoltEffect.SPARK
                    || meta.effect === BoltEffect.FIRE
                    || meta.effect === BoltEffect.DRAGONFIRE;
                const targetReflectChance = (canReflect && target instanceof Monster) ? target.reflectChance() : 0;
                const reflects = targetReflectChance > 0 && rng.randPercent(targetReflectChance);

                const result = CombatSystem.attack(caster, target, {
                    isWeaponAttack: false,
                    damageTarget: reflects ? caster : undefined,
                });
                if (result.kamikazeSelfDestruct) {
                    // P4-4：目前带 bolts 的怪物没有一只同时是 MA_KAMIKAZE（膨胀怪没有
                    // bolts），这里只是让 CombatSystem.attack 的通用出口在未来出现
                    // 这种组合时行为正确，不静默吞掉自爆语义。
                    logCast('bolt.monster_cast_kamikaze', `${casterLabel} bursts before the spell lands!`, '#ff8800');
                    break;
                }
                if (reflects) {
                    logCast('bolt.monster_cast_reflect', `${targetName} deflects the ${ceBoltName} back at ${casterLabel}!`, '#99ddff');
                    if (result.damage > 0) {
                        this.spawnFloatingText(`-${result.damage}`, caster.loc.x, caster.loc.y, 0x99ddff);
                        if (isPlayer) this.lastDamageSource = target.name;
                    }
                    break;
                }
                if (result.damage > 0) {
                    if (isPlayer) this.lastDamageSource = caster.name;
                    this.spawnFloatingText(`-${result.damage}`, target.loc.x, target.loc.y, 0xff5555);
                    if (isPlayer) {
                        this.spawnBlood(target.loc.x, target.loc.y);
                        this.tryTriggerArmorRunic(caster, result.damage);
                    }
                    logCast('bolt.monster_cast_hit', `${casterLabel} hits ${targetName} with ${ceBoltName} for ${result.damage} damage!`, '#ff8866');
                    if (isPlayer && caster.onHitStatus && caster.onHitDuration > 0 && rng.randPercent(Math.floor(caster.onHitChance * 100))) {
                        this.applyMonsterOnHitStatus(caster.name, caster.onHitStatus, caster.onHitDuration);
                    }
                    if (isPlayer && caster.hasAbility('MA_POISONS')) {
                        this.applyMonsterOnHitStatus(caster.name, 'poisoned', result.damage * 2);
                    }
                    if (isPlayer && caster.hasAbility('MA_CAUSES_WEAKNESS')) {
                        this.applyMonsterOnHitStatus(caster.name, 'weakened', 15);
                    }
                    if (isPlayer && caster.hasAbility('MA_HIT_HALLUCINATE')) {
                        this.applyMonsterOnHitStatus(caster.name, 'hallucinating', 15);
                    }
                    if (!isPlayer && (target as Monster).hp <= 0) {
                        // 怪物互殴致死：与既有 discordant 近战分支同口径，留给
                        // playerTurnEnded 的 filter(m.hp>0) 统一清理，不在这里重复。
                    } else if (!isPlayer) {
                        // P4-4：Items.c:5213 splitMonster —— bolt 命中怪物（此处目标非玩家）时同样触发分裂。
                        this.trySplitMonster(target as Monster, caster);
                    }
                } else {
                    logCast('bolt.monster_cast_miss', `${casterLabel} tries to hit ${targetName} with ${ceBoltName} but misses.`, '#aaaaaa');
                }
                break;
            }

            case BoltEffect.HEALING: {
                const amount = Math.max(1, Math.round(target.maxHp * 0.25));
                const healed = Math.min(target.maxHp - target.hp, amount);
                target.hp += healed;
                this.spawnFloatingText(`+${healed}`, target.loc.x, target.loc.y, 0x44ff88);
                logCast('bolt.monster_cast_heal', `${casterLabel} heals ${targetName} for ${healed} HP!`, '#44ff88');
                break;
            }

            case BoltEffect.HASTE: {
                if (isPlayer) {
                    this.applyTimedStatus(this.player, 'hasted', 15);
                } else {
                    this.applyStatusToMonster(target as Monster, 'hasted', 15, 'magic');
                }
                logCast('bolt.monster_cast_haste', `${casterLabel} hastes ${targetName}!`, '#ffff88');
                break;
            }

            case BoltEffect.SHIELDING: {
                applyShieldStatus(target, 15);
                logCast('bolt.monster_cast_shield', `${casterLabel} shields ${targetName}!`, '#ffffcc');
                break;
            }

            case BoltEffect.SLOW: {
                if (isPlayer) {
                    this.applyTimedStatus(this.player, 'slowed', meta.magnitude >= 10 ? 20 : 10);
                } else {
                    this.applyStatusToMonster(target as Monster, 'slowed', meta.magnitude >= 10 ? 20 : 10, 'magic');
                }
                logCast('bolt.monster_cast_slow', `${casterLabel} slows ${targetName}!`, '#888888');
                break;
            }

            case BoltEffect.DISCORD: {
                // CE case BE_DISCORD 已在 specificallyValidBoltTarget 里排除了玩家目标。
                if (!isPlayer) {
                    this.applyStatusToMonster(target as Monster, 'discordant', DISCORD_DURATION, 'magic');
                }
                logCast('bolt.monster_cast_discord', `${casterLabel} sows discord in ${targetName}!`, '#ff88ff');
                break;
            }

            case BoltEffect.NEGATION: {
                // P4-3：CE Items.c:4483-4491 negate() —— MONST_DIES_IF_NEGATED 直接死亡
                // 而非清状态（wisp/golem/spectral blade 等"纯魔法造物"被己方以外的
                // negation bolt 命中时会发生，例如敌对怪物对玩家的召唤物施放 negation）。
                if (!isPlayer && (target as Monster).diesIfNegated()) {
                    logCast('bolt.monster_cast_negation_dies', `${targetName} falls to the ground, lifeless!`, '#ffffff');
                    (target as Monster).takeDamage((target as Monster).hp);
                    break;
                }
                const durations = (target.statusDurations as unknown) as Record<string, number>;
                for (const k of Object.keys(durations)) durations[k] = 0;
                // P1-28：同 scroll 侧——negate 不剥旗标，清空后重推导派生状态。
                if (!isPlayer) (target as Monster).syncFlagDerivedStatuses();
                if (!isPlayer) (target as Monster).refreshSpeeds();
                else this.player.refreshSpeeds();
                logCast('bolt.monster_cast_negation', `${casterLabel} negates the magic on ${targetName}!`, '#ffffff');
                break;
            }

            case BoltEffect.BECKONING: {
                const dx = Math.sign(caster.loc.x - target.loc.x);
                const dy = Math.sign(caster.loc.y - target.loc.y);
                const newX = target.loc.x + dx * 2;
                const newY = target.loc.y + dy * 2;
                const destCell = this.grid.getCell(newX, newY);
                if (destCell && destCell.terrain !== TerrainType.WALL && destCell.terrain !== TerrainType.GRANITE && !this.getMonsterAt(newX, newY)) {
                    target.loc.x = newX;
                    target.loc.y = newY;
                }
                logCast('bolt.monster_cast_beckon', `${casterLabel} beckons ${targetName} closer!`, '#88ccff');
                break;
            }

            default:
                break;
        }

        this.needsRender = true;
    }

    public rechargeArcanaItem(item: Item): boolean {
        if (item.category !== ItemCategory.WAND && item.category !== ItemCategory.STAFF) return false;
        if (typeof item.maxCharges !== 'number') return false;
        const current = item.charges ?? 0;
        if (current >= item.maxCharges) {
            logger.log(`${item.name} is already fully charged.`, '#aaaaaa');
            return false;
        }
        item.charges = item.maxCharges;
        item.rechargeCounter = 0;
        logger.log(`${item.name} is fully recharged.`, '#66ddff');
        timeSystem.currentTick += 100;
        this.playerTurnEnded();
        return true;
    }

    public uncurseItem(item: Item): boolean {
        if (!item.isCursed) {
            logger.log(`${item.name} is not cursed.`, '#aaaaaa');
            return false;
        }
        item.isCursed = false;
        if (item.enchantment < 0) item.enchantment = 0;
        logger.log(i18next.t('scroll.dark_aura', { name: item.name, defaultValue: `A dark aura leaves ${item.name}.` }), '#88ffcc');
        timeSystem.currentTick += 100;
        this.playerTurnEnded();
        return true;
    }

    private identifyRandomItem(): boolean {
        const candidates = this.player.inventory.items.filter((invItem) => {
            const consumableId = (invItem as any).consumableId as string | undefined;
            const identityId = (invItem as any).identityId as string | undefined;
            return (consumableId && !ItemLoader.identifiedItems.has(consumableId))
                || (identityId && !ItemLoader.identifiedItems.has(identityId));
        });
        if (candidates.length === 0) return false;
        const target = candidates[rng.randRange(0, candidates.length - 1)]!;
        const consumableId = (target as any).consumableId as string | undefined;
        const identityId = (target as any).identityId as string | undefined;
        const id = consumableId ?? identityId;
        if (!id) return false;
        ItemLoader.identify(id);
        logger.log(i18next.t('item.identify_target', { name: target.name, defaultValue: `You identify ${target.name}.` }), '#00ffff');
        return true;
    }

    private removeCurseFromInventory(): boolean {
        const cursed = this.player.inventory.items.find((invItem) => invItem.isCursed);
        if (!cursed) return false;
        cursed.isCursed = false;
        if (cursed.enchantment < 0) cursed.enchantment = 0;
        logger.log(`${cursed.name} is no longer cursed.`, '#88ffcc');
        return true;
    }

    private enchantEquippedItem(): boolean {
        const target = this.player.equippedWeapon ?? this.player.equippedArmor;
        if (!target) return false;
        target.enchantment += 1;
        if (target.enchantment >= 0) {
            target.isCursed = false;
        }
        if (target.runicType) {
            target.runicKnown = true;
        } else if ((target.category === ItemCategory.WEAPON || target.category === ItemCategory.ARMOR) && rng.randPercent(20)) {
            if (target.category === ItemCategory.WEAPON) {
                const runics = ItemLoader.GENERATED_WEAPON_RUNICS;
                target.runicType = runics[rng.randRange(0, runics.length - 1)];
            } else {
                const runics = ItemLoader.GENERATED_ARMOR_RUNICS;
                target.runicType = runics[rng.randRange(0, runics.length - 1)];
            }
            target.runicKnown = true;
            logger.log(`${target.name} awakens a ${target.runicType} rune!`, '#88ccff');
        }
        return true;
    }

    private rechargeRandomArcana(): boolean {
        const candidates = this.player.inventory.items.filter((invItem) =>
            (invItem.category === ItemCategory.WAND || invItem.category === ItemCategory.STAFF)
            && typeof invItem.maxCharges === 'number'
            && (invItem.charges ?? 0) < invItem.maxCharges
        );
        if (candidates.length === 0) return false;
        const target = candidates[rng.randRange(0, candidates.length - 1)]!;
        target.charges = target.maxCharges;
        target.rechargeCounter = 0;
        logger.log(`${target.name} crackles with restored power.`, '#66ddff');
        return true;
    }

    /**
     * Items.c:7906-7938 SCROLL_PROTECT_ARMOR / SCROLL_PROTECT_WEAPON：
     * 对应装备打上 ITEM_PROTECTED（web 字段 isProtected），并对该件 uncurse
     * （Items.c:7740 uncurse 只清诅咒标志、不动负附魔，故不复用整包解咒的
     * removeCurseFromInventory——那会把 enchantment 负值清零，语义不同）。
     * 无对应装备时 "but it quickly disperses."，卷轴照常消耗。
     */
    private protectEquippedGear(gear: Item | null, kind: 'weapon' | 'armor'): void {
        if (!gear) {
            logger.log(i18next.t('scroll.protect_fail', {
                defaultValue: 'A protective golden light surrounds you, but it quickly disperses.'
            }), '#aaaaaa');
            return;
        }
        gear.isProtected = true;
        logger.log(i18next.t(kind === 'weapon' ? 'scroll.protect_weapon' : 'scroll.protect_armor', {
            name: gear.displayName,
            defaultValue: `A protective golden light covers your ${gear.displayName}.`
        }), '#ffffaa');
        if (gear.isCursed) {
            gear.isCursed = false;
            logger.log(i18next.t('scroll.protect_uncurse', {
                name: gear.displayName,
                defaultValue: `A malevolent force leaves your ${gear.displayName}.`
            }), '#88ffcc');
        }
    }

    /**
     * Items.c:4883-4902 discordBlast(emitterName, DCOLS)：
     * 对视野内（IN_FIELD_OF_VIEW）、距玩家 ≤ DCOLS 的非无生命/非无敌怪物
     * 施加 discordant 状态 30 回合（Items.c:4899 硬编码）。
     * MONST_INANIMATE/MONST_INVULNERABLE 豁免同 CE（Items.c:4896）。
     */
    private discordBlastFromPlayer(emitterName: string): void {
        logger.log(i18next.t('scroll.discord', {
            emitter: emitterName,
            defaultValue: `${emitterName} emits a wave of unsettling purple radiation!`
        }), '#c084fc');

        const px = this.player.loc.x;
        const py = this.player.loc.y;
        for (const m of this.monsters) {
            if (m.hp <= 0) continue;
            if (m.hasBehavior('MONST_INANIMATE') || m.hasAbility('MONST_INVULNERABLE')) continue;
            // CE 为 IN_FIELD_OF_VIEW（玩家 FOV）；web 用玩家→怪物的实时视线判定，
            // 等价且不依赖渲染流程的 FOV 缓存刷新
            if (!this.hasLineOfSight(px, py, m.loc.x, m.loc.y)) continue;
            const distSq = (px - m.loc.x) * (px - m.loc.x) + (py - m.loc.y) * (py - m.loc.y);
            if (distSq > DCOLS * DCOLS) continue;
            this.applyStatusToMonster(m, 'discordant', DISCORD_DURATION);
        }
    }

    /**
     * Items.c:7977-7990 SCROLL_SUMMON_MONSTER：
     * 至多 25 轮尝试，每轮对玩家 8 邻格依次判定——格子可通行、无怪物
     * （CE 为 !T_OBSTRUCTS_PASSABILITY && !HAS_MONSTER）且 10% 掷骰命中时，
     * 在该格经 spawnHorde(0, ...) 抽取并生成一只怪物，总数上限 3。
     * CE spawnHorde 的禁用集 HORDE_LEADER_CAPTIVE | HORDE_NO_PERIODIC_SPAWN |
     * HORDE_IS_SUMMONED | HORDE_MACHINE_ONLY 与 HORDE_PERIODIC_FORBIDDEN_FLAGS
     * 完全一致，out-of-depth 掷骰同样适用；生成后 wakeUp(monst) → HUNTING。
     * 差异：CE 每次 spawnHorde 落下整队（领袖+成员），单次召唤可超 3 只；
     * web 按验收口径钳制"场上新增 ≤3 只"，每只取抽中 horde 的领袖种类。
     */
    private summonMonstersAroundPlayer(): void {
        const nbDirs = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, -1]];
        let numberOfMonsters = 0;

        for (let j = 0; j < 25 && numberOfMonsters < 3; j++) {
            for (const [dx, dy] of nbDirs) {
                if (numberOfMonsters >= 3) break;
                const x = this.player.loc.x + dx!;
                const y = this.player.loc.y + dy!;
                const cell = this.grid.getCell(x, y);
                if (!cell || !cell.isPassable || this.getMonsterAt(x, y)) continue;
                if (!rng.randPercent(10)) continue;

                // CE spawnHorde(0, ...)：10% out-of-depth + 禁用集过滤 + frequency 加权抽 horde
                const spawn = this.rollSpawnDepth(this.depth);
                const forbidden = spawn.outOfDepth
                    ? [...HORDE_PERIODIC_FORBIDDEN_FLAGS, 'HORDE_NEVER_OOD']
                    : HORDE_PERIODIC_FORBIDDEN_FLAGS;
                const horde = this.pickHordeType(this.hordeCandidates(spawn.depth, forbidden));
                if (!horde) continue;

                const mData = (monsterData as MonsterData[]).find(m => m.id === horde.leader.toLowerCase());
                if (!mData) continue;
                const mon = new Monster(x, y, mData);
                this.applyRandomMutation(mon, this.depth);
                mon.state = MonsterState.HUNTING; // Items.c:7987 wakeUp(monst)
                this.monsters.push(mon);
                numberOfMonsters++;
            }
        }

        if (numberOfMonsters > 1) {
            logger.log(i18next.t('scroll.summon_many', {
                defaultValue: 'The fabric of space ripples, and monsters appear!'
            }), '#ff4444');
        } else if (numberOfMonsters === 1) {
            logger.log(i18next.t('scroll.summon_one', {
                defaultValue: 'The fabric of space ripples, and a monster appears!'
            }), '#ff4444');
        } else {
            logger.log(i18next.t('scroll.summon', {
                defaultValue: 'The fabric of space boils violently around you, but nothing happens.'
            }), '#aaaaaa');
        }
    }

    public enterThrowMode(item: Item) {
        this.isThrowing = true;
        this.throwItemTarget = item;
        logger.log(i18next.t('throw.select_target', { name: item.displayName, defaultValue: `Select a target to throw the ${item.displayName}.` }), '#ffffff');
    }

    public throwItemAt(item: Item, tx: number, ty: number) {
        this.isThrowing = false;
        this.throwItemTarget = null;

        if (!this.grid.isValidPos(tx, ty)) return;

        if (this.player.inventory.removeItem(item)) {
            // Check if item is a potion
            if (item.category === ItemCategory.POTION) {
                const trueId = (item as any).consumableId;
                const data = ItemLoader.potions.find(p => p.id === trueId);

                logger.log(i18next.t('throw.shatter', { name: item.displayName, defaultValue: `You throw the ${item.displayName}. It shatters!` }), '#ffaa00');

                if (data) {
                    // Identify if not identified
                    if (!ItemLoader.identifiedItems.has(trueId)) {
                        ItemLoader.identify(trueId);
                        logger.log(i18next.t('item.was_a', { name: item.name, defaultValue: `It was a ${item.name}!` }), '#00ffff');
                    }

                    // Apply splash effect
                    if (data.effect === 'fire_burst') {
                        this.environment.ignite(tx, ty);
                        // Ignite neighbors
                        const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, 1], [-1, 1], [1, -1]];
                        for (const [dx, dy] of dirs) this.environment.ignite(tx + dx!, ty + dy!);
                    } else if (data.effect === 'poison_burst') {
                        this.environment.addGas(tx, ty, 2 /* POISON */, 100);
                    } else if (data.effect === 'confusion_burst') {
                        this.environment.addGas(tx, ty, 3 /* CONFUSION */, 100);
                    } else if (data.effect === 'heal_full') {
                        const mob = this.getMonsterAt(tx, ty);
                        if (mob) {
                            mob.hp = mob.maxHp;
                            logger.log(i18next.t('monster.looks_healthy', { name: mob.name, defaultValue: `The ${mob.name} looks healthy.` }), '#44ff44');
                        } else if (tx === this.player.loc.x && ty === this.player.loc.y) {
                            this.player.hp = this.player.maxHp;
                        }
                    }
                }
            } else {
                // Not a potion, just drops it there
                logger.log(i18next.t('throw.generic', { name: item.displayName, defaultValue: `You throw the ${item.displayName}.` }), '#aaaaaa');
                item.loc = { x: tx, y: ty };
                this.items.push(item);
            }

            this.needsRender = true;
            // CE Items.c:7173 throwItem() 以 playerTurnEnded() 收尾——完整回合
            timeSystem.currentTick += this.player.movementSpeed;
            this.playerTurnEnded();
        }
    }

    /**
     * CE rogue.justRested 的 web 近似：本回合的输入是否为等待。
     * CE 里 REST/PERIOD/NUMPAD5 每次按键置位（IO.c:2521-2527）、回合末清除
     * （Time.c:2874）；web 在 handlePlayerAction 入口清零、wait 分支置位，
     * 供 calculateStealthRange 的"刚休息过再减半"消费。
     */
    private justRested: boolean = false;

    /**
     * P4-8 返工：CE currentStealthRange()（Time.c:791-832）的口径对齐。
     * 旧实现（基数 3 + 护甲 weight − 2 + 光照 +4）为自创公式，与 CE 无一处
     * 对应，据此算出的 awareness 皮筋比 CE 短约三倍。
     *
     * 逐项对照（取舍详情见 ai_docs/p4_8_scent_map_report.md）：
     *   - 隐身恒 1                    Time.c:795-797  ✅ 照抄
     *   - 基数 14                     Time.c:793      ✅ 照抄
     *   - playerInDarkness 再减半     Light.c:283-287 ❌ 略去——web 无"矿灯可被
     *     调暗"概念（Cell.light 全工程无写入方，旧公式的 LIT+4 实为死代码）
     *   - IS_IN_SHADOW 减半（可叠加） Light.c:222 一族 ✅ 近似为恒处于阴影：
     *     CE 里矿灯不驱散阴影（Light.c:70-71 注释），而 web 目前唯一光源就是
     *     玩家自己的火把（addLight(player)），故玩家恒在阴影中 → 减半一次。
     *     将来接入岩浆/火把等地形光源时应改为查询玩家格。
     *   - 护甲力量需求加成            Time.c:784-790  ✅ max(0, strengthRequired − 12)
     *   - 刚休息过（本回合是等待）减半 Time.c:813-815  ✅ justRested 近似为
     *     "本回合输入是 wait"（CE IO.c:2521-2527 的 REST/PERIOD/NUMPAD5）
     *   - STATUS_AGGRAVATING          Time.c:817-819  ❌ 略去——web 无该状态
     *   - 戒指 stealthBonus           Time.c:822-824  ❌ 略去——web 未实装
     *     （ring_of_stealth 属 D2 自创池，无代码消费）
     *   - 下限钳制 2 / 1              Time.c:826-829  ✅ 照抄
     */
    private calculateStealthRange(): number {
        if (this.player.hasStatus('invisible')) return 1;

        let range = 14;
        // IS_IN_SHADOW 的 web 近似：玩家恒处于阴影（唯一光源是自己的矿灯类火把）
        range = Math.floor(range / 2);

        const armor = this.player.equippedArmor;
        if (armor) {
            range += Math.max(0, (armor.strengthRequired || 0) - 12);
        }

        if (this.justRested) {
            range = Math.ceil(range / 2);
        }

        if (range < 2 && !this.justRested) {
            range = 2;
        } else if (range < 1) {
            range = 1;
        }
        return range;
    }

    private applyTimedStatus(entity: Player | Monster, status: StatusId, duration: number): boolean {
        const applied = entity.applyStatus(status, duration, 'refresh');
        if (!applied) return false;
        if (entity === this.player) {
            if (status === 'paralyzed') logger.log(i18next.t('status.player.paralyzed', { defaultValue: 'You are paralyzed!' }), '#ff9999');
            if (status === 'confused' || status === 'hallucinating') {
                logger.log(i18next.t('status.player.disoriented', { defaultValue: 'Your senses become unstable.' }), '#cc99ff');
            }
            if (status === 'invisible') logger.log(i18next.t('status.player.invisible_on', { defaultValue: 'You fade from sight.' }), '#99ccff');
            if (status === 'telepathy') logger.log(i18next.t('status.player.telepathy_on', { defaultValue: 'You feel minds around you.' }), '#99ddff');
            if (status === 'levitating') logger.log(i18next.t('status.player.levitating_on', { defaultValue: 'You float above the ground.' }), '#bbddff');
            if (status === 'regenerating') logger.log(i18next.t('status.player.regenerating_on', { defaultValue: 'Vital energy surges through you.' }), '#99ff99');
        }
        return true;
    }

    private getStatusLabel(status: StatusId): string {
        return STATUS_CONFIG[status]?.label ?? status;
    }

    private applyStatusToMonster(monster: Monster, status: StatusId, duration: number, source: 'magic' | 'gas' | 'runic' = 'magic'): boolean {
        if (monster.statusImmunities.has(status)) {
            if (source !== 'gas') {
                logger.log(
                    i18next.t('status.monster.immune', {
                        monster: monster.name,
                        status: this.getStatusLabel(status),
                        defaultValue: `${monster.name} is immune to ${this.getStatusLabel(status)}.`
                    }),
                    '#b0b0b0'
                );
            }
            return false;
        }

        const reduce = monster.statusResistTurns[status] ?? 0;
        const effectiveDuration = Math.max(1, duration - reduce);
        const applied = monster.applyStatus(status, effectiveDuration, 'refresh');
        if (!applied) return false;
        if (reduce > 0 && source !== 'gas') {
            logger.log(
                i18next.t('status.monster.resisted', {
                    monster: monster.name,
                    status: this.getStatusLabel(status),
                    defaultValue: `${monster.name} resists ${this.getStatusLabel(status)}.`
                }),
                '#b0e0ff'
            );
        }
        return true;
    }

    private getPlayerStatusResistance(status: StatusId): { nullifyChance: number; durationReduction: number } {
        let nullifyChance = 0;
        let durationReduction = 0;

        const ringIdentity = (this.player.equippedRing as any)?.identityId as string | undefined;
        if (ringIdentity === 'ring_of_awareness') {
            if (status === 'confused' || status === 'hallucinating') {
                nullifyChance += 0.25;
                durationReduction += 1;
            } else if (status === 'paralyzed') {
                nullifyChance += 0.1;
                durationReduction += 1;
            }
        }

        if (this.player.equippedArmor?.runicType === 'dampening') {
            durationReduction += 1;
        }

        return { nullifyChance, durationReduction };
    }

    public applyMonsterOnHitStatus(monsterName: string, status: StatusId, duration: number): boolean {
        // Check temporary immunity from charm_of_protection
        if ((this.player.temporaryImmunities[status] ?? 0) > 0) {
            logger.log(
                i18next.t('status.player.temp_immune', {
                    status: this.getStatusLabel(status),
                    defaultValue: `You are immune to ${this.getStatusLabel(status)}!`
                }),
                '#ffffaa'
            );
            return false;
        }

        const resistance = this.getPlayerStatusResistance(status);
        if (resistance.nullifyChance > 0 && rng.randPercent(Math.floor(resistance.nullifyChance * 100))) {
            logger.log(
                i18next.t('status.player.resisted', {
                    status: this.getStatusLabel(status),
                    defaultValue: `You resist ${this.getStatusLabel(status)}.`
                }),
                '#a7f3d0'
            );
            return false;
        }

        const effectiveDuration = Math.max(1, duration - resistance.durationReduction);
        const applied = this.applyTimedStatus(this.player, status, effectiveDuration);
        if (!applied) return false;
        if (status === 'paralyzed') {
            logger.log(
                i18next.t('status.player.inflicted_paralyzed', {
                    monster: monsterName,
                    defaultValue: `The ${monsterName} paralyzes you!`
                }),
                '#ff9999'
            );
        } else if (status === 'confused' || status === 'hallucinating') {
            logger.log(
                i18next.t('status.player.inflicted_disoriented', {
                    monster: monsterName,
                    defaultValue: `The ${monsterName} leaves you disoriented!`
                }),
                '#cc99ff'
            );
        } else if (status === 'invisible') {
            logger.log(
                i18next.t('status.player.inflicted_invisible', {
                    monster: monsterName,
                    defaultValue: `The ${monsterName}'s magic blurs your form.`
                }),
                '#99ccff'
            );
        } else {
            logger.log(
                i18next.t('status.player.inflicted_generic', {
                    monster: monsterName,
                    status: this.getStatusLabel(status),
                    defaultValue: `The ${monsterName} inflicts ${this.getStatusLabel(status)}.`
                }),
                '#ffaaaa'
            );
        }
        return true;
    }

    private syncEquipmentStatuses() {
        const ring = this.player.equippedRing;
        if (!ring) return;
        const identityId = (ring as any).identityId as string | undefined;
        if (identityId === 'ring_of_awareness') {
            this.player.setStatusDuration('telepathy', 2);
        } else if (identityId === 'ring_of_regeneration') {
            this.player.setStatusDuration('regenerating', 2);
        }
    }

    private tryTriggerWeaponRunic(target: Monster, damage: number) {
        const weapon = this.player.equippedWeapon;
        if (!weapon?.runicType) return;

        if (weapon.runicType === 'paralyzing' && rng.randPercent(18)) {
            const applied = this.applyStatusToMonster(target, 'paralyzed', 3, 'runic');
            if (!applied) return;
            weapon.runicKnown = true;
            logger.log(
                i18next.t('runic.weapon.paralyzing', {
                    target: target.name,
                    defaultValue: `Runic power paralyzes the ${target.name}!`
                }),
                '#99ccff'
            );
            this.spawnFloatingText('Paralyzed', target.loc.x, target.loc.y, 0x99ccff);
            return;
        }

        if (weapon.runicType === 'venom' && rng.randPercent(20)) {
            const extra = rng.randRange(1, 3);
            target.takeDamage(extra);
            weapon.runicKnown = true;
            logger.log(
                i18next.t('runic.weapon.venom', {
                    target: target.name,
                    damage: extra,
                    defaultValue: `Runic venom wounds the ${target.name} for ${extra}.`
                }),
                '#88dd88'
            );
            this.spawnFloatingText(`-${extra}`, target.loc.x, target.loc.y, 0x66dd66);
            return;
        }

        if (weapon.runicType === 'quietus' && rng.randPercent(5)) {
            target.takeDamage(9999);
            weapon.runicKnown = true;
            logger.log(
                i18next.t('runic.weapon.quietus', {
                    target: target.name,
                    defaultValue: `Runic magic instantly slays the ${target.name}!`
                }),
                '#ccaaff'
            );
            return;
        }

        if (weapon.runicType === 'vampirism' && rng.randPercent(20)) {
            const heal = Math.max(1, Math.floor(damage * 0.5));
            this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal);
            weapon.runicKnown = true;
            logger.log(
                i18next.t('runic.weapon.vampirism', {
                    target: target.name,
                    heal: heal,
                    defaultValue: `Your weapon drains ${heal} life from the ${target.name}.`
                }),
                '#ff4444'
            );
            return;
        }

        if (weapon.runicType === 'speed' && rng.randPercent(20)) {
            target.takeDamage(damage);
            weapon.runicKnown = true;
            logger.log(
                i18next.t('runic.weapon.speed', {
                    target: target.name,
                    defaultValue: `Your weapon blurs, striking the ${target.name} again for ${damage}!`
                }),
                '#ffffaa'
            );
            this.spawnFloatingText(`-${damage}`, target.loc.x, target.loc.y, 0x66dd66);
            return;
        }

        if (weapon.runicType === 'confusion' && rng.randPercent(15)) {
            const applied = this.applyStatusToMonster(target, 'confused', 6, 'runic');
            if (!applied) return;
            weapon.runicKnown = true;
            logger.log(
                i18next.t('runic.weapon.confusion', {
                    target: target.name,
                    defaultValue: `The ${target.name} is confused by your strike!`
                }),
                '#cc99ff'
            );
            this.spawnFloatingText('Confused', target.loc.x, target.loc.y, 0x99ccff);
            return;
        }
    }

    /**
     * Apply a weapon runic effect that was already determined to trigger by Combat.ts.
     * This is separate from tryTriggerWeaponRunic, which uses legacy flat-chance triggers.
     * applyWeaponRunicEffect is called when Combat.ts's enchantment-scaled trigger fires.
     */
    private applyWeaponRunicEffect(target: Monster, damage: number, runicType: string) {
        const weapon = this.player.equippedWeapon;
        if (!weapon) return;
        weapon.runicKnown = true;

        const enchant = weapon.enchantment;

        switch (runicType) {
            case 'paralyzing': {
                const duration = weaponParalysisDuration(enchant);
                const applied = this.applyStatusToMonster(target, 'paralyzed', duration, 'runic');
                if (applied) {
                    logger.log(i18next.t('runic.weapon.paralyzing', { target: target.name, defaultValue: `Runic power paralyzes the ${target.name}!` }), '#99ccff');
                    this.spawnFloatingText('Paralyzed', target.loc.x, target.loc.y, 0x99ccff);
                }
                break;
            }
            case 'venom': {
                const poisonDmg = Math.max(1, Math.floor(damage * 0.5));
                const applied = this.applyStatusToMonster(target, 'poisoned', poisonDmg, 'runic');
                if (applied) {
                    target.takeDamage(poisonDmg);
                    logger.log(i18next.t('runic.weapon.venom', { target: target.name, damage: poisonDmg, defaultValue: `Runic venom wounds the ${target.name} for ${poisonDmg}.` }), '#88dd88');
                    this.spawnFloatingText(`-${poisonDmg}`, target.loc.x, target.loc.y, 0x66dd66);
                }
                break;
            }
            case 'quietus': {
                target.takeDamage(9999);
                logger.log(i18next.t('runic.weapon.quietus', { target: target.name, defaultValue: `Runic magic instantly slays the ${target.name}!` }), '#ccaaff');
                break;
            }
            case 'slaying': {
                target.takeDamage(9999);
                logger.log(i18next.t('runic.weapon.slaying', { target: target.name, defaultValue: `Your weapon of slaying destroys the ${target.name}!` }), '#ff6666');
                break;
            }
            case 'vampirism': {
                const heal = Math.max(1, Math.floor(damage * 0.5));
                this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal);
                logger.log(i18next.t('runic.weapon.vampirism', { target: target.name, heal, defaultValue: `Your weapon drains ${heal} life from the ${target.name}.` }), '#ff4444');
                break;
            }
            case 'speed': {
                target.takeDamage(damage);
                logger.log(i18next.t('runic.weapon.speed', { target: target.name, defaultValue: `Your weapon blurs, striking the ${target.name} again for ${damage}!` }), '#ffffaa');
                this.spawnFloatingText(`-${damage}`, target.loc.x, target.loc.y, 0xffffaa);
                break;
            }
            case 'confusion': {
                const confDuration = weaponConfusionDuration(enchant);
                const applied = this.applyStatusToMonster(target, 'confused', confDuration, 'runic');
                if (applied) {
                    logger.log(i18next.t('runic.weapon.confusion', { target: target.name, defaultValue: `The ${target.name} is confused by your strike!` }), '#cc99ff');
                    this.spawnFloatingText('Confused', target.loc.x, target.loc.y, 0x99ccff);
                }
                break;
            }
            case 'force': {
                const dist = weaponForceDistance(enchant);
                logger.log(i18next.t('runic.weapon.force', { target: target.name, dist, defaultValue: `Your blow launches the ${target.name} backward ${dist} tiles!` }), '#ffffff');
                this.spawnFloatingText('Force!', target.loc.x, target.loc.y, 0xffffff);
                // Apply knockback
                const dx = target.loc.x - this.player.loc.x;
                const dy = target.loc.y - this.player.loc.y;
                const ndx = Math.sign(dx);
                const ndy = Math.sign(dy);
                for (let i = 0; i < dist; i++) {
                    const nx = target.loc.x + ndx;
                    const ny = target.loc.y + ndy;
                    const cell = this.grid.getCell(nx, ny);
                    if (!cell || !cell.isPassable || this.getMonsterAt(nx, ny)) break;
                    target.loc.x = nx;
                    target.loc.y = ny;
                }
                break;
            }
            case 'mercy': {
                // Reduce the target to 1 HP instead of killing
                if (target.hp <= 0) {
                    target.hp = 1;
                }
                logger.log(i18next.t('runic.weapon.mercy', { target: target.name, defaultValue: `Your weapon of mercy spares the ${target.name}.` }), '#88ff88');
                break;
            }
            default:
                break;
        }
    }

    public tryTriggerArmorRunic(attacker: Monster, incomingDamage: number) {
        const armor = this.player.equippedArmor;
        if (!armor?.runicType) return;

        // CE 以 melee 形参区分近战/远程（Combat.c:896 applyArmorRunicEffect）。
        // web 仅有的两个调用点（Monster.ts 远程分支 dist>1 / 近战分支 dist<=1）
        // 以攻击者相邻性等价区分。
        const melee =
            Math.abs(attacker.loc.x - this.player.loc.x) <= 1 &&
            Math.abs(attacker.loc.y - this.player.loc.y) <= 1;

        // 符文强度吃 netEnchant（含力量修正、钳 [-20,50]），与 P1-11 的 playerDefense
        // 同源；取值口径与 Combat.ts:73-78 一致（strengthRequired 缺省 0）。
        const netEnch = netEnchant(armor.enchantment ?? 0, this.player.strength, armor.strengthRequired ?? 0);

        if (armor.runicType === 'reflection' && !melee && rng.randPercent(reflectionChance(netEnch))) {
            // CE：reflection 只作用于投掷物/法术（Items.c:4969 projectileReflects），
            // 对近战永不触发；触发率 reflectionChance(netEnchant)（PowerTables.c:109-123）。
            const reflected = Math.max(1, Math.floor(incomingDamage * 0.5));
            attacker.takeDamage(reflected);
            armor.runicKnown = true;
            logger.log(
                i18next.t('runic.armor.reflection', {
                    target: attacker.name,
                    damage: reflected,
                    defaultValue: `Your armor reflects ${reflected} damage to ${attacker.name}!`
                }),
                '#99ddff'
            );
            this.spawnFloatingText(`-${reflected}`, attacker.loc.x, attacker.loc.y, 0x99ddff);
            return;
        }

        if (armor.runicType === 'mutuality' && melee) {
            // CE Combat.c:976-1024（A_MUTUALITY）：恒触发（无概率判定）；伤害与相邻
            // 敌方均摊 share = (damage + count) / (count + 1)（C 整数除法），攻击者本身
            // 不计入摊派名单（Combat.c:987 monst != attacker）。CE 的 applyArmorRunicEffect
            // 唯一调用点在近战 attack() 内（Combat.c:1272 恒传 melee=true），故远程不触发。
            const hitList = this.monsters.filter(m =>
                m !== attacker &&
                m.hp > 0 &&
                !m.isAlly &&
                !m.hasBehavior('MONST_IMMUNE_TO_WEAPONS') &&
                !m.hasBehavior('MONST_INVULNERABLE') &&
                Math.abs(m.loc.x - this.player.loc.x) <= 1 &&
                Math.abs(m.loc.y - this.player.loc.y) <= 1
            );
            const count = hitList.length;
            if (count > 0 && incomingDamage > 0) {
                const share = Math.floor((incomingDamage + count) / (count + 1));
                // web 的伤害在调用前已落地：把"伤害降为 share"建模为回补差值
                this.player.hp = Math.min(this.player.maxHp, this.player.hp + (incomingDamage - share));
                for (const m of hitList) {
                    m.takeDamage(share);
                    this.spawnFloatingText(`-${share}`, m.loc.x, m.loc.y, 0xddaaff);
                }
                armor.runicKnown = true;
                logger.log(
                    i18next.t('runic.armor.mutuality', {
                        target: attacker.name,
                        damage: share,
                        defaultValue: `Your armor pulses, and the damage is shared with the adjacent enemies!`
                    }),
                    '#ddaaff'
                );
            }
            return;
        }

        if (armor.runicType === 'vitality' && rng.randPercent(15)) {
            // web 自创符文（CE 无 A_VITALITY），本轮保留现有行为。
            this.applyTimedStatus(this.player, 'regenerating', 15);
            armor.runicKnown = true;
            logger.log(
                i18next.t('runic.armor.vitality', {
                    defaultValue: `Your armor pulses with healing energy.`
                }),
                '#44ff44'
            );
            return;
        }

        if (armor.runicType === 'respiration' && rng.randPercent(20)) {
            // CE 语义为毒气/蒸汽的常驻免疫（Time.c:411-424、Monsters.c:1414），
            // 与受击无关；效果与触发事件均不同，本轮保留现有行为（差异见报告）。
            this.player.grantTemporaryImmunity('burning' as any, 1);
            this.player.grantTemporaryImmunity('confused' as any, 1);
            armor.runicKnown = true;
            logger.log(
                i18next.t('runic.armor.respiration', {
                    defaultValue: `Your armor shields you from ambient hazards.`
                }),
                '#44ffff'
            );
            return;
        }

        if (armor.runicType === 'dampening' && rng.randPercent(25)) {
            // CE 语义为爆炸伤害的常驻吸收（Time.c:355-367），与受击无关；
            // 本轮保留现有行为（差异见报告）。
            const healBack = Math.min(incomingDamage, 2);
            this.player.hp = Math.min(this.player.maxHp, this.player.hp + healBack);
            armor.runicKnown = true;
            logger.log(
                i18next.t('runic.armor.dampening', {
                    heal: healBack,
                    defaultValue: `Your armor absorbs impact and restores ${healBack} HP.`
                }),
                '#aaffaa'
            );
            this.spawnFloatingText(`+${healBack}`, this.player.loc.x, this.player.loc.y, 0xaaffaa);
        }

        if (armor.runicType === 'absorption' && melee) {
            // CE Combat.c:1026-1035（A_ABSORPTION）：恒触发（无概率判定），每次受击
            // damage -= rand_range(1, armorAbsorptionMax(netEnchant))（PowerTables.c:107）；
            // 仅全额吸收时提示并自动鉴定（Combat.c:1030-1034），部分吸收静默。
            // CE 唯一调用点在近战 attack() 内（Combat.c:1272），故远程不触发。
            const absorbRoll = rng.randRange(1, armorAbsorptionMax(netEnch));
            const absorbed = Math.min(absorbRoll, incomingDamage);
            if (absorbed > 0) {
                this.player.hp = Math.min(this.player.maxHp, this.player.hp + absorbed);
            }
            if (absorbRoll >= incomingDamage) {
                armor.runicKnown = true;
                logger.log(
                    i18next.t('runic.armor.absorption', {
                        damage: absorbed,
                        defaultValue: `Your armor pulses and absorbs the blow!`
                    }),
                    '#aaddff'
                );
                this.spawnFloatingText(`+${absorbed}`, this.player.loc.x, this.player.loc.y, 0xaaddff);
            }
            return;
        }

        if (armor.runicType === 'reprisal' && melee &&
            !attacker.hasBehavior('MONST_INANIMATE') &&
            !attacker.hasBehavior('MONST_INVULNERABLE')) {
            // CE Combat.c:1037-1056（A_REPRISAL）：仅近战、恒触发（无概率判定），
            // 反弹 armorReprisalPercent(netEnchant)% 伤害（PowerTables.c:106）：
            // max(1, percent * damage / 100)（C 整数除法）。
            const reprisalDmg = Math.max(1, Math.trunc((armorReprisalPercent(netEnch) * incomingDamage) / 100));
            attacker.takeDamage(reprisalDmg);
            armor.runicKnown = true;
            logger.log(
                i18next.t('runic.armor.reprisal', {
                    target: attacker.name,
                    damage: reprisalDmg,
                    defaultValue: `Your armor retaliates with ${reprisalDmg} damage to ${attacker.name}!`
                }),
                '#ff8844'
            );
            this.spawnFloatingText(`-${reprisalDmg}`, attacker.loc.x, attacker.loc.y, 0xff8844);
            return;
        }

        if (armor.runicType === 'immunity') {
            // CE Combat.c:1058-1063（A_IMMUNITY）：被动常驻、无概率判定，仅当攻击者
            // 属于护甲的 vorpalEnemy 类别时伤害归零（monsterIsInClass）。web 物品模型
            // 尚无 vorpalEnemy 字段（本轮不可改 Item.ts），类别门无法落地——保留全额
            // 抵挡效果，仅移除恒真的 randPercent(100)（类别判定差距见报告）。
            this.player.hp = Math.min(this.player.maxHp, this.player.hp + incomingDamage);
            armor.runicKnown = true;
            logger.log(
                i18next.t('runic.armor.immunity', {
                    target: attacker.name,
                    defaultValue: `Your armor's immunity protects you from the ${attacker.name}!`
                }),
                '#ffff44'
            );
            return;
        }
    }

    private tickCreatureStatuses() {
        const playerExpired = this.player.tickStatuses();
        // CE Time.c:2261-2273：玩家 haste/slow 到期时恢复 info 基准速度并
        // synchronizePlayerTimeState（客观门对齐玩家剩余 tick）。web 的速度
        // 恢复由 tickStatuses → refreshSpeeds 完成，这里补同步调用。
        if (playerExpired.includes('haste') || playerExpired.includes('hasted') || playerExpired.includes('slowed')) {
            this.synchronizePlayerTimeState();
        }
        for (const status of playerExpired) {
            if (status === 'invisible') logger.log(i18next.t('status.player.invisible_off', { defaultValue: 'You are no longer invisible.' }), '#cccccc');
            if (status === 'telepathy') logger.log(i18next.t('status.player.telepathy_off', { defaultValue: 'Your telepathic sense fades.' }), '#cccccc');
            if (status === 'levitating') logger.log(i18next.t('status.player.levitating_off', { defaultValue: 'You touch ground again.' }), '#cccccc');
            if (status === 'regenerating') logger.log(i18next.t('status.player.regenerating_off', { defaultValue: 'Your regenerative aura fades.' }), '#cccccc');
            if (status === 'paralyzed') logger.log(i18next.t('status.player.paralyzed_off', { defaultValue: 'You can move again.' }), '#cccccc');
            if (status === 'confused' || status === 'hallucinating') {
                logger.log(i18next.t('status.player.disoriented_off', { defaultValue: 'Your thoughts become clear again.' }), '#cccccc');
            }
        }

        for (const m of this.monsters) {
            m.tickStatuses();
        }
    }

    /** CE Time.c:937-948 — one message per hunger-tier crossing, no repeat while it persists. */
    private logHungerTransition(state: HungerState) {
        switch (state) {
            case 'hungry':
                logger.log(i18next.t('status.player.hungry', { defaultValue: 'You are hungry.' }), '#ffcc00');
                break;
            case 'weak':
                logger.log(i18next.t('status.player.weak_with_hunger', { defaultValue: 'You feel weak with hunger.' }), '#ff9900');
                break;
            case 'faint':
                logger.log(i18next.t('status.player.faint_with_hunger', { defaultValue: 'You feel faint with hunger.' }), '#ff6600');
                break;
            case 'starving':
                logger.log(i18next.t('status.player.starving_to_death', { defaultValue: 'You are starving to death!' }), '#ff0000');
                break;
            default:
                break;
        }
    }

    // ------------------------------------------------------------------
    // P4-7：玩家武器攻击几何 + 钝器口径（CE 以玩家为攻击者的分支）
    //
    // 与 P4-6 怪物侧的关系：几何语义（射程/受阻/倒序/横扫覆盖）逐条镜像
    // Monster.ts 的 performWhipAttack/performSpearAttack/performSweepAttack，
    // 但不直接复用其函数体——那些是 Monster 的私有方法且结算出口是怪物侧
    // 消息（ally/discordant/hostile 三种 voice），玩家攻击有独立的结算词汇
    // 与后置处理（武器符文/偷袭/掉落/经验）；本轮文件边界也不允许改
    // Monster.ts 把它们提炼成共享模块。可复用的部分（8 向旋转表、射线逐格
    // 口径、willAttackTarget 判定、倒序循环）均按同构方式落地，见各方法注释。
    // ------------------------------------------------------------------

    /**
     * P4-7：CE monsterWillAttackTarget 的玩家版，与 Monster.willAttackTarget
     * 同口径：存活、非被囚禁（isCaged ≈ MB_CAPTIVE）、敌对。
     */
    private playerWillAttackTarget(defender: Monster): boolean {
        if (defender.hp <= 0) return false;
        if (defender.isCaged) return false;
        return monstersAreEnemies(this.player, defender);
    }

    /**
     * B-1：CE Movement.c:1368-1400 —— 突进（ITEM_LUNGE_ATTACKS）与连枷
     * （ITEM_PASS_ATTACKS）的移动攻击目标收集，在玩家实际移动【前】调用
     * （连枷判据需要移动前坐标），移动【后】由调用方结算（Movement.c:1480-1492）。
     *   - 突进（Movement.c:1369-1391）：只看移动方向两格之外（player.loc +
     *     2*方向单位向量）那一格；目标须可见或已揭示、是敌人、非盟友、未在
     *     死亡中、不在阻挡通行的格内（除非 MONST_ATTACKABLE_THRU_WALLS）。
     *   - 连枷（buildFlailHitList，Movement.c:1025-1048）：遍历全部怪物，
     *     ★核心判据是"与移动前、移动后两格都相邻"（Chebyshev 距离均为 1，
     *     Monsters.c distanceBetween）——连枷是在两格之间挥过去的，不是
     *     "打所有相邻敌人"；其余过滤同突进（canSeeMonster → 敌人/非盟友/
     *     未死亡/格可通行或可隔墙打）。
     * 简化口径（与 P4-7 鞭/矛同款）：canSeeMonster/monsterRevealed 以
     * !invisible 近似（web 无照明级 targeting 视野）；敌我判定走
     * playerWillAttackTarget（存活+非被囚禁+敌对）再显式排除 isAlly
     *（对应 CE 的 creatureState != MONSTER_ALLY，web 两维度独立）。
     * abortAttack 确认提示（误伤盟友/酸怪）本轮明确不做——盟友根本进不了
     * 名单（见上），酸怪照打。hitList 顺序：突进目标占首、连枷随后（CE 同）。
     */
    private buildLungeFlailHitList(dx: number, dy: number, newX: number, newY: number): Monster[] {
        const flags = this.player.equippedWeapon?.flags;
        if (!flags?.length) return [];
        const ux = Math.sign(dx);
        const uy = Math.sign(dy);
        if (ux === 0 && uy === 0) return [];
        const hitList: Monster[] = [];
        const canStrike = (m: Monster, cell: { isPassable: boolean } | null | undefined): boolean =>
            !!cell &&
            this.playerWillAttackTarget(m) &&
            !m.isAlly &&
            !m.hasStatus('invisible') &&
            (cell.isPassable || m.hasBehavior('MONST_ATTACKABLE_THRU_WALLS'));
        // 突进：两格之外的那一格（Movement.c:1370-1391）
        if (flags.includes('ITEM_LUNGE_ATTACKS')) {
            const tx = this.player.loc.x + 2 * ux;
            const ty = this.player.loc.y + 2 * uy;
            const cell = this.grid.getCell(tx, ty);   // CE coordinatesAreInMap
            const m = cell ? this.getMonsterAt(tx, ty) : undefined;
            if (m && canStrike(m, cell)) hitList.push(m);
        }
        // 连枷：同时与移动前、移动后两格相邻（Movement.c:1025-1048）
        if (flags.includes('ITEM_PASS_ATTACKS')) {
            for (const m of this.monsters) {
                if (hitList.includes(m)) continue;
                if (Math.max(Math.abs(m.loc.x - this.player.loc.x), Math.abs(m.loc.y - this.player.loc.y)) !== 1) continue;
                if (Math.max(Math.abs(m.loc.x - newX), Math.abs(m.loc.y - newY)) !== 1) continue;
                if (canStrike(m, this.grid.getCell(m.loc.x, m.loc.y))) hitList.push(m);
            }
        }
        return hitList;
    }

    /**
     * P4-7：CE buildHitList（Combat.c:2049-2090）玩家侧。非 sweep（武器无
     * ITEM_ATTACKS_ALL_ADJACENT）照 CE 返回 [defender]；sweep 以主目标方向为
     * 起点旋转遍历 8 邻格（CE 原文的 nbDirs/cDirs 表混用只影响命中顺序、覆盖
     * 集合即 8 邻格全覆盖——P4-6 §3.2 同口径，单表旋转），逐格要求
     * playerWillAttackTarget 且（格可通行 或 目标 MONST_ATTACKABLE_THRU_WALLS）。
     * 偏离 CE 的一处保守取舍：sweep 过滤后为空的唯一情形是主目标本身不可攻击
     * （盟友/被囚禁）——此时落回 [primary] 保留 web 既有"撞谁打谁"的行为
     * （CE 该场景在 Movement.c:1155 就整体跳过攻击块，且误伤盟友要走
     * abortAttack 确认提示，本轮明确不做），避免出现"穿过盟友走位"的回归。
     */
    private buildPlayerMeleeHitList(primary: Monster): Monster[] {
        if (!this.player.equippedWeapon?.flags?.includes('ITEM_ATTACKS_ALL_ADJACENT')) {
            return [primary];
        }
        const dirs8: ReadonlyArray<readonly [number, number]> =
            [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]];
        const dx = Math.sign(primary.loc.x - this.player.loc.x);
        const dy = Math.sign(primary.loc.y - this.player.loc.y);
        let dir = dirs8.findIndex(d => d[0] === dx && d[1] === dy);
        if (dir < 0) dir = 0; // CE：dir==NO_DIRECTION 时取 UP（主目标必相邻，实际不可达）
        const hitList: Monster[] = [];
        for (let i = 0; i < 8; i++) {
            const d = dirs8[(dir + i) % 8]!;
            const tx = this.player.loc.x + d[0];
            const ty = this.player.loc.y + d[1];
            const cell = this.grid.getCell(tx, ty);
            if (!cell) continue; // CE coordinatesAreInMap
            const defender = this.getMonsterAt(tx, ty);
            if (!defender || !this.playerWillAttackTarget(defender)) continue;
            if (!cell.isPassable && !defender.hasBehavior('MONST_ATTACKABLE_THRU_WALLS')) continue;
            hitList.push(defender);
        }
        return hitList.length > 0 ? hitList : [primary];
    }

    /**
     * P4-7：CE Movement.c:1175-1186 玩家侧入口——朝方向移动/攻击时先试鞭
     * （handleWhipAttacks）再试矛（handleSpearAttacks），出手即返回 true（耗回
     * 合，不落回普通移动）。斧不在其中：CE 的横扫只挂在"目标格有怪"的普通
     * 近战分支（buildHitList sweep）。dx/dy 统一取符号归一成 8 向单位步。
     */
    private tryPlayerWeaponGeometryAttack(dx: number, dy: number): boolean {
        const flags = this.player.equippedWeapon?.flags;
        if (!flags?.length) return false;
        const ux = Math.sign(dx);
        const uy = Math.sign(dy);
        if (ux === 0 && uy === 0) return false;
        if (flags.includes('ITEM_ATTACKS_EXTEND') && this.playerWhipAttack(ux, uy)) return true;
        if (flags.includes('ITEM_ATTACKS_PENETRATE') && this.playerSpearAttack(ux, uy)) return true;
        return false;
    }

    /**
     * P4-7：CE handleWhipAttacks（Movement.c:855-912）玩家分支 + getImpactLoc
     * （Items.c:4300-4332，maxDistance=5、returnLastEmptySpace=false、BOLT_WHIP），
     * 射线口径与 Monster.performWhipAttack 同构：沿方向逐格推进，第一个"未隐藏
     * 的活物"或"阻挡通行/视线的格子"就是打击点；打击点上没有可攻击的敌人就
     * 不出手（返回 false，调用方照常移动）。玩家分支的 canSeeMonster 复查
     *（Movement.c:893）与怪物侧同款简化：web 无照明级可见性 targeting，
     * 只按 invisible 状态近似 monsterIsHidden（P4-1b 起同口径）。
     */
    private playerWhipAttack(dirX: number, dirY: number): boolean {
        let strike: Monster | undefined;
        for (let i = 0; i < 5; i++) {
            const tx = this.player.loc.x + (1 + i) * dirX;
            const ty = this.player.loc.y + (1 + i) * dirY;
            const cell = this.grid.getCell(tx, ty);
            if (!cell) break; // CE isPosInMap：射线出图
            const c = this.getMonsterAt(tx, ty);
            if (c && !c.hasStatus('invisible')) {
                // 未隐藏的活物挡弹（CE getImpactLoc 的 monster 分支，隐藏者被穿过）
                strike = c;
                break;
            }
            if (!cell.isPassable || cell.isOpaque) {
                // 阻挡通行/视线的格子截停：打击点落在墙格上 → monsterAtLoc 为空
                break;
            }
        }
        if (!strike || !this.playerWillAttackTarget(strike)) return false;
        this.resolvePlayerMeleeAttackOn(strike);
        return true;
    }

    /**
     * P4-7：CE handleSpearAttacks（Movement.c:917-1023）玩家分支，射线口径与
     * Monster.performSpearAttack 同构：沿方向收集至多 2 格上的敌人（贴脸 i==0
     * 无条件算数；远处那格要求目标未隐藏），收集时目标格必须可通行（或目标带
     * MONST_ATTACKABLE_THRU_WALLS），中途遇阻挡通行/视线的格子即 break（:976-979）。
     * ★ CE Movement.c:1005-1009：攻击顺序人为倒序（先远后近），注释原文
     *   "Artificially reverse the order of the attacks, so that spears of
     *   force can send both monsters flying."——照实现，测试锁死。
     */
    private playerSpearAttack(dirX: number, dirY: number): boolean {
        const hitList: Monster[] = [];
        let proceed = false;
        for (let i = 0; i < 2; i++) {
            const tx = this.player.loc.x + (1 + i) * dirX;
            const ty = this.player.loc.y + (1 + i) * dirY;
            const cell = this.grid.getCell(tx, ty);
            if (!cell) break; // CE isPosInMap
            const defender = this.getMonsterAt(tx, ty);
            if (defender &&
                (cell.isPassable || defender.hasBehavior('MONST_ATTACKABLE_THRU_WALLS')) &&
                this.playerWillAttackTarget(defender)) {
                hitList.push(defender);
                if (i === 0 || !defender.hasStatus('invisible')) {
                    proceed = true;
                }
            }
            if (!cell.isPassable || cell.isOpaque) {
                break;
            }
        }
        if (!proceed) return false;
        // CE Movement.c:1007-1009：先打远的、后打近的（倒序）
        for (let i = hitList.length - 1; i >= 0; i--) {
            this.resolvePlayerMeleeAttackOn(hitList[i]!);
        }
        return true;
    }

    /**
     * P4-7：玩家近战对单个目标的完整结算——从 handlePlayerAction 的既有
     * 内联块原样抽出（消息/隐身现形/漂浮文字/符文/血迹/分裂/击杀掉落），
     * 普通近战循环与鞭/矛几何出口共用，保证几何击杀与贴脸击杀走完全相同的
     * 后置处理。返回该次攻击是否命中。
     * 末尾的钝器击退对应 CE Combat.c:1398-1401（attack() 内、命中且目标存活
     * 的分支）：复用 P4-5 的 processStaggerHit（invulnerable/immobile/inanimate/
     * caged 豁免、终点不可站则不推）。武器几何旗标与 STAGGER 互斥（一把武器
     * 只有一种），放在共享出口里与 CE 的 attack() 内位置一致。
     * B-1：lungeAttack 对应 CE attack() 第三形参——刺剑突进结算时传 true
     *（Movement.c:1482-1483 按武器 LUNGE 旗标），该击自动命中且吃 ×3 倍率
     * （Combat.c:1239/1259-1268）；连枷/普通近战传 false。呈现差异登记：
     * CE 对突进命中追加"（猛烈突刺）"措辞（Combat.c:1298），web 复用普通
     * 命中文案——补专用文案需新增 zh_CN.json 键，在本轮文件边界外（见报告）。
     */
    private resolvePlayerMeleeAttackOn(target: Monster, lungeAttack = false): boolean {
        const res = CombatSystem.attack(this.player, target, lungeAttack ? { lungeAttack: true } : undefined);
        if (this.player.hasStatus('invisible')) {
            this.player.setStatusDuration('invisible', 0);
            logger.log(
                i18next.t('status.player.invisible_break_attack', {
                    defaultValue: 'You reveal yourself as you strike.'
                }),
                '#cccccc'
            );
        }
        if (res.hit && res.damage > 0) {
            const weaponStr = res.weaponName === 'bare hands' ? i18next.t('combat.bare_hands', { defaultValue: 'bare hands' }) : res.weaponName;
            if (res.backstab) {
                logger.log(i18next.t('combat.backstab', { monster: target.name, damage: res.damage, weapon: weaponStr, defaultValue: `You backstab the ${target.name} for ${res.damage} damage!` }), '#ff4444');
            } else {
                logger.log(i18next.t('combat.hit', { monster: target.name, damage: res.damage, weapon: weaponStr, defaultValue: `You hit the ${target.name} for ${res.damage} damage with ${weaponStr}.` }), '#ffcc00');
            }
            this.spawnFloatingText(`-${res.damage}`, target.loc.x, target.loc.y, 0xff5555);
            // Handle runic trigger (enchantment-scaled chance computed in Combat.ts)
            if (res.triggeredRunic) {
                this.applyWeaponRunicEffect(target, res.damage, res.triggeredRunic);
            } else {
                this.tryTriggerWeaponRunic(target, res.damage);
            }
            this.spawnBlood(target.loc.x, target.loc.y);
            // P4-4：CE splitMonster(defender, attacker)（Combat.c:1424，attack() 主路径）。
            this.trySplitMonster(target, this.player);
        } else {
            logger.log(i18next.t('combat.miss', { monster: target.name, defaultValue: `You missed the ${target.name}.` }), '#888888');
            this.spawnFloatingText(i18next.t('combat.miss_float', { defaultValue: 'Miss' }), target.loc.x, target.loc.y, 0xaaaaaa);
        }

        // Check if monster died
        if (target.hp <= 0) {
            logger.log(i18next.t('combat.defeat', { monster: target.name, defaultValue: `You defeated the ${target.name}!` }), '#ffaa00');
            this.stats.kills++;

            // Handle Drops
            if (rng.randPercent(Math.floor(target.goldDropChance * 100))) {
                const goldItem = new Item('Gold', '$', 0xffda75, ItemCategory.GOLD);
                goldItem.loc = { ...target.loc };
                this.items.push(goldItem);
            }

            if (rng.randPercent(Math.floor(target.itemDropChance * 100))) {
                const isWeapon = rng.randPercent(50);
                let droppedObj;
                if (isWeapon) {
                    droppedObj = ItemLoader.spawnWeapon(rng.randPercent(50) ? 'dagger' : 'sword', target.loc.x, target.loc.y);
                } else {
                    droppedObj = ItemLoader.spawnArmor(rng.randPercent(50) ? 'leather_armor' : 'chain_mail', target.loc.x, target.loc.y);
                }
                if (droppedObj) this.items.push(droppedObj);
            }
        }

        // P4-7：钝器击退（CE Combat.c:1398-1401；"命中且目标存活"对应 CE 的
        // else-survive 分支，P4-5 口径与 Monster.ts 三处近战出口一致）
        if (res.hit && !res.kamikazeSelfDestruct && !res.seized && target.hp > 0 &&
            this.player.equippedWeapon?.flags?.includes('ITEM_ATTACKS_STAGGER')) {
            this.processStaggerHit(this.player, target);
        }
        return res.hit;
    }

    /**
     * CE Time.c:2438-2450 playerRecoversFromAttacking：玩家攻击的回合耗时在
     * 攻击结算处累加进 ticksUntilTurn，playerTurnEnded 的 ==0 分支因此跳过
     * movementSpeed——攻击耗时 = attackSpeed（haste/slow 同步生效）。
     * P4-7：ITEM_ATTACKS_STAGGER 分支落地（Time.c:2442-2444）——钝器命中时
     * 额外恢复一个完整攻击回合（+= 2×attackSpeed）；anAttackHit 对应 CE 形参
     * （普通近战传 anyAttackHit，鞭/矛几何出口按 CE Movement.c:1178 字面传 true）。
     * B-1：ITEM_ATTACKS_QUICKLY 分支落地（Time.c:2445-2446）——刺剑恢复减半
     *（attackSpeed/2，向下取整），分支优先级照 CE：STAGGER（且命中）>
     * QUICKLY > 普通。
     */
    private playerRecoversFromAttacking(anAttackHit: boolean): void {
        if (this.player.ticksUntilTurn >= 0) {
            if (this.player.equippedWeapon?.flags?.includes('ITEM_ATTACKS_STAGGER') && anAttackHit) {
                this.player.ticksUntilTurn += 2 * this.player.attackSpeed;
            } else if (this.player.equippedWeapon?.flags?.includes('ITEM_ATTACKS_QUICKLY')) {
                this.player.ticksUntilTurn += Math.floor(this.player.attackSpeed / 2);
            } else {
                this.player.ticksUntilTurn += this.player.attackSpeed;
            }
        }
    }

    /**
     * CE Time.c:2435-2438 synchronizePlayerTimeState：速度变化（haste/slow 到期）
     * 与换层时调用，把客观时间门对齐到玩家剩余 tick。
     */
    public synchronizePlayerTimeState(): void {
        this.ticksTillUpdateEnvironment = this.player.ticksUntilTurn;
    }

    /**
     * CE Time.c:2468 playerTurnEnded —— 玩家回合结束后的"最近事件推进"调度：
     * 玩家动作计时累加进 ticksUntilTurn，随后 while 循环里反复求 soonestTurn
     * （全部存活怪物与玩家剩余 tick 的最小值），把所有怪物批量扣减这么多 tick，
     * 让归零的怪物行动，直到玩家重新可行动（ticksUntilTurn 归零）。
     *
     * P2-2 真实速度口径：玩家动作耗时 = player.movementSpeed（攻击走
     * playerRecoversFromAttacking 的 attackSpeed，CE Time.c:2604/2438）；
     * 怪物行动耗时在 advancementLoop 内按行动类型落账——攻击/施法出口由
     * Monster.endTurnWithAttack 置 attackSpeed（MONST_CAST_SPELLS_SLOWLY ×2），
     * 移动与跳过（麻痹/俘虏/入迷，CE Time.c:2731）由循环统一置 movementSpeed。
     *
     * P2-3 客观时间：soonestTurn 加入第三候选 ticksTillUpdateEnvironment
     * （CE Time.c:2651-2652）；门归零时 +100 并执行 objectiveTimeBlock
     * （CE Time.c:2653-2712）。
     *
     * 动画节奏（决策 E1-修订，CE Time.c:2704 口径）：animationEnabled=false
     * （headless/默认）时一次性同步跑完整个循环 + 收尾，与 P2-1 逐格等价
     * （速度本身除外）；true 时启动分步推进，但生成器只在慢回合（玩家 >100
     * tick）的 100-tick 客观块处 yield 暂停点——常规动作零插帧，一次 step
     * 即跑完，期间输入被锁（见 beginAdvancement）。自动寻路/自动探索
     * （isAutoTraveling，对应 CE rogue.playbackFastForward）直接走同步路径，
     * 全程不进分步、不暂停。
     */
    /**
     * CE alliedCloneCount（Combat.c:180-208）。P4-4：只统计当前驻留的
     * this.monsters——web 不像 CE 那样同时把相邻楼层的怪物列表留在内存里，
     * 上限 100 在实践中不会被触碰，不影响可观察行为（报告已登记此简化）。
     */
    private alliedCloneCount(monst: Monster): number {
        let count = 0;
        for (const m of this.monsters) {
            if (m !== monst && m.typeId === monst.typeId && monstersAreTeammates(m, monst)) {
                count++;
            }
        }
        return count;
    }

    /**
     * P4-5：CE processStaggerHit（Combat.c:1118-1136），从 specialHit()
     * （Combat.c:534，只在"命中且未杀死目标"的 else-survive 分支里调用，
     * 见 Combat.c:1385-1406：inflictDamage 杀死目标时直接进 if 分支
     * return，走不到 specialHit）沿"攻击者→被击者"方向把目标推开一格：
     * 目标坐标各轴分别 clamp(-1,1) 后加到当前坐标；若越界/终点是墙/终点
     * 已有人（怪物或玩家）占用，则什么都不发生。复核结论（写入报告）：
     * 紧邻的 MA_POISONS（Combat.c:524）与 MA_CAUSES_WEAKNESS（Combat.c:529）
     * 都带 `&& damage > 0`，MA_ATTACKS_STAGGER（Combat.c:534）单独一行、
     * 没有这个条件——照实现，不比照邻居补上 damage>0。
     * 调用方（Monster.ts 三处近战出口）用 `!kamikazeSelfDestruct && hit` 做
     * 门槛，对应"命中"这一前提；"未被杀死"由调用方在调用前检查 defender.hp>0
     * （对应 CE 的 kill/survive 分支二选一）。
     * 已知简化：不检查 CE 的 MB_CAPTIVE，用 web 的 isCaged（拘禁待救援怪物，
     * 语义等价——见 Monster.ts:225）近似；不做 diagonalBlocked 式对角墙角检查
     * （web 的 canMoveTo 本身不含对角穿墙判定，与既有移动/寻路代码同口径）。
     */
    /**
     * P4-5：CE Movement.c:1267-1297 的搜索循环——在 this.monsters（已死怪物
     * 在上一次 playerTurnEnded 里被过滤掉，见该函数顶部的
     * `this.monsters = this.monsters.filter(m => m.hp > 0)`）里找一个仍然
     * seizing、与玩家为敌、且与玩家相邻的怪物。找不到即代表抓取者已经死亡
     * 或已经不再相邻，对应 CE "杀死抓取者后自动解除抓取"的行为——这里没有
     * 另开一条"死亡时清 MB_SEIZED"的分支，而是复用 CE 原本的实现方式：
     * 搜索失败就是失败，调用方据此清空 player.seized。
     */
    private findLiveSeizer(): Monster | undefined {
        return this.monsters.find(m =>
            m.hp > 0 && m.seizing &&
            monstersAreEnemies(m, this.player) &&
            Math.max(Math.abs(m.loc.x - this.player.loc.x), Math.abs(m.loc.y - this.player.loc.y)) === 1
        );
    }

    // public：与 trySplitMonster 不同，这个方法只在 Monster.ts（另一个模块）的
    // 三处近战出口被调用，没有 Game.ts 内部自身的调用点——保持 private 会被
    // vue-tsc 的 noUnusedLocals 判定为"未使用"（跨模块的 `(game as any)` 调用
    // 对类型检查器不可见）。调用方仍按项目既有约定用 `(game as any)` 转接，
    // 这里只是把可见性开放到匹配实际调用面。
    public processStaggerHit(attacker: Creature, defender: Creature): void {
        if (defender instanceof Monster &&
            (defender.isInvulnerable() || defender.hasBehavior('MONST_IMMOBILE') ||
                defender.hasBehavior('MONST_INANIMATE') || defender.isCaged)) {
            return;
        }
        const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
        const newX = clamp1(defender.loc.x - attacker.loc.x) + defender.loc.x;
        const newY = clamp1(defender.loc.y - attacker.loc.y) + defender.loc.y;
        if (!this.canMoveTo(newX, newY)) return;
        if (this.getMonsterAt(newX, newY)) return;
        if (this.player.loc.x === newX && this.player.loc.y === newY) return;
        defender.loc.x = newX;
        defender.loc.y = newY;
    }

    /**
     * CE splitMonster（Combat.c:222-310）。P4-4：MA_CLONE_SELF_ON_DEFEND 的
     * 果冻类怪物受到伤害后（仍存活），在其所在的同阵营连通怪物群外缘随机选
     * 一格复制自身，血量对半（向上取整，CE `(currentHP+1)/2`）。
     *
     * 已知简化（详见报告）：
     *   - 用 grid.isPassable 且非深水/熔岩近似 CE 的 monsterAvoids（web 没有
     *     该函数的完整移植，无法区分"该怪物具体会不会踩火/踩网"等精细规则）。
     *   - 分裂体不继承父代已学行为——直接用 monsters.json 重新构造即天然满足
     *     CE 这条限制；变异（mutation）沿用父代，对齐 CE "mutation effects are
     *     inherited, they're not learned abilities"。
     *   - 不处理 CE 末尾"非飞行怪清除 1000 tick 悬浮状态"的边角情形（分裂体
     *     本就不会带着这个状态出生）。
     */
    private trySplitMonster(defender: Monster, attacker: Creature): void {
        if (!defender.hasAbility('MA_CLONE_SELF_ON_DEFEND')) return;
        if (defender.hp <= 0) return;
        if (this.alliedCloneCount(defender) >= 100) return;

        const key = (x: number, y: number) => `${x},${y}`;
        const dirs4: Array<[number, number]> = [[0, -1], [0, 1], [-1, 0], [1, 0]];

        // 1) 连通同阵营怪物群（4 方向 flood fill）；攻击者相邻时预先并入该组
        //    （CE 注释：让果冻能在走廊里分裂到玩家背后）。
        const inGroup = new Set<string>();
        inGroup.add(key(defender.loc.x, defender.loc.y));
        const dist = Math.max(Math.abs(defender.loc.x - attacker.loc.x), Math.abs(defender.loc.y - attacker.loc.y));
        if (dist <= 1 && this.grid.isValidPos(attacker.loc.x, attacker.loc.y)) {
            inGroup.add(key(attacker.loc.x, attacker.loc.y));
        }
        const queue: Array<{ x: number; y: number }> = [{ x: defender.loc.x, y: defender.loc.y }];
        while (queue.length > 0) {
            const cur = queue.shift()!;
            for (const [dx, dy] of dirs4) {
                const nx = cur.x + dx, ny = cur.y + dy;
                if (!this.grid.isValidPos(nx, ny)) continue;
                const k = key(nx, ny);
                if (inGroup.has(k)) continue;
                const m = this.getMonsterAt(nx, ny);
                if (m && monstersAreTeammates(m, defender)) {
                    inGroup.add(k);
                    queue.push({ x: nx, y: ny });
                }
            }
        }

        // 2) 群外缘的合格空格（两阶段扫描，与 CE 的 monsterGrid/eligibleGrid
        //    双重 x-major/y-minor 循环同序，保证同种子下选点可复现）。
        const eligibleSet = new Set<string>();
        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                if (!inGroup.has(key(x, y))) continue;
                for (const [dx, dy] of dirs4) {
                    const nx = x + dx, ny = y + dy;
                    if (!this.grid.isValidPos(nx, ny)) continue;
                    const nk = key(nx, ny);
                    if (inGroup.has(nk) || eligibleSet.has(nk)) continue;
                    const cell = this.grid.getCell(nx, ny);
                    if (!cell || !cell.isPassable) continue;
                    if (cell.terrain === TerrainType.LAVA || cell.terrain === TerrainType.WATER_DEEP) continue;
                    if (this.player.loc.x === nx && this.player.loc.y === ny) continue;
                    if (this.getMonsterAt(nx, ny)) continue;
                    eligibleSet.add(nk);
                }
            }
        }
        if (eligibleSet.size === 0) return; // CE：无合格格子则不分裂，也不扣血

        const eligibleList: Array<{ x: number; y: number }> = [];
        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                if (eligibleSet.has(key(x, y))) eligibleList.push({ x, y });
            }
        }
        const idx = rng.randRange(1, eligibleList.length) - 1; // CE: rand_range(1, eligibleLocationCount)
        const spot = eligibleList[idx]!;

        // 3) 血量对半（先于克隆，CE 顺序：currentHP=(currentHP+1)/2 → cloneMonster）
        defender.hp = Math.ceil(defender.hp / 2);

        const cloneData = (monsterData as MonsterData[]).find(d => d.id === defender.typeId);
        if (!cloneData) return;
        const clone = new Monster(spot.x, spot.y, cloneData);
        if (defender.mutation) {
            clone.mutate(defender.mutation);
        }
        clone.hp = defender.hp;
        clone.maxHp = defender.maxHp;
        clone.isAlly = defender.isAlly;
        clone.leader = defender.leader;
        clone.state = defender.state;
        clone.ticksUntilTurn = Math.max(clone.ticksUntilTurn, 101); // CE: max(ticksUntilTurn, 101)
        this.monsters.push(clone);

        logger.log(i18next.t('combat.monster_splits', {
            name: defender.name,
            defaultValue: `The ${defender.name} splits in two!`
        }), '#88ff88');
        this.needsRender = true;
    }

    /**
     * CE Combat.c:1963-1990（MA_DF_ON_DEATH 分支）。P4-4：为 hp<=0 且未处理过
     * 的怪物触发一次死亡地形效果，deathEffectTriggered 保证只触发一次。
     * 从两处调用（playerTurnEnded 顶部、finishTurnEpilogue 开头）覆盖
     * "玩家行动本身杀死目标"与"推进循环内怪物互殴/环境效果杀死目标"两种
     * 时序，尽量做到同回合触发，而不是拖到下一次 playerTurnEnded 才生效。
     *
     * 本轮只接了两种：
     *   - bloat → DF_BLOAT_DEATH（毒气，Globals.c:654 GAS 层，startprob 当
     *     体积单点喷发）。web 的 addGas density 上限 0-100（非 CE 的 2000
     *     "体积"量纲），取项目既有毒气类道具/陷阱的满值 100（Game.ts 的
     *     poison_burst 药水、地板陷阱均用 80-100），不新发明映射公式。
     *   - explosive_bloat → DF_BLOAT_EXPLOSION（GAS_EXPLOSION 地形，
     *     Globals.c:496 T_IS_FIRE|T_CAUSES_EXPLOSIVE_DAMAGE——覆盖在原有地形
     *     之上，不检查底下能不能烧）。web 没有瞬时范围爆炸伤害机制，复用
     *     environment.igniteForced 覆盖死亡格 + 四方向相邻格；用 igniteForced
     *     而不是 ignite 是验收打回后的修正——ignite() 只对 GRASS/FOLIAGE/
     *     BOG/DOOR 生效，地牢里绝大多数格子是石地板，用它会导致"这只怪物的
     *     全部存在意义在常见情况下不发生"（见报告"验收打回"一节）。伤害交给
     *     既有的"燃烧中每回合掉血"结算，不新造爆炸伤害公式。
     * 未接（报告已登记，均为已知缺口，非本轮范围）：
     *   - pit_bloat 的 DF_HOLE_POTION 需要洞/坠落地形，web 无坠落子系统
     *     （fall_down 只打印日志）——pit bloat 本轮只自爆，不生成洞。
     *   - vampire 的 DF_BLOOD_EXPLOSION 是纯血迹装饰，web 无血迹层。
     */
    private triggerDeathFeatures(): void {
        for (const m of this.monsters) {
            if (m.hp > 0) continue;
            if (m.deathEffectTriggered) continue;
            if (!m.hasAbility('MA_DF_ON_DEATH')) continue;
            m.deathEffectTriggered = true;

            if (m.typeId === 'bloat') {
                this.environment.addGas(m.loc.x, m.loc.y, 2 /* GasType.POISON */, 100);
                logger.log(i18next.t('death.bloat_gas', {
                    name: m.name,
                    defaultValue: `The ${m.name} releases a cloud of caustic gas!`
                }), '#88ff88');
                this.needsRender = true;
            } else if (m.typeId === 'explosive_bloat') {
                // P4-4 验收打回修正：用 igniteForced（不看地形可燃性），不是 ignite。
                this.environment.igniteForced(m.loc.x, m.loc.y);
                const dirs4: Array<[number, number]> = [[0, -1], [0, 1], [-1, 0], [1, 0]];
                for (const [dx, dy] of dirs4) {
                    this.environment.igniteForced(m.loc.x + dx, m.loc.y + dy);
                }
                logger.log(i18next.t('death.bloat_explosion', {
                    name: m.name,
                    defaultValue: `The ${m.name} explodes in a burst of flame!`
                }), '#ff8800');
                this.needsRender = true;
            }
            // pit_bloat / vampire：本轮不接，见函数注释。
        }
    }

    private playerTurnEnded() {
        this.triggerDeathFeatures();
        this.monsters = this.monsters.filter(m => m.hp > 0);
        this.syncEquipmentStatuses();

        const stealthRange = this.calculateStealthRange();

        // CE Time.c:2604-2609：== 0 时累加 movementSpeed（攻击路径已在
        // playerRecoversFromAttacking 里累加过 attackSpeed，不会进此分支）；
        // < 0 分支对应 CE 的免费回合残留（player.ticksUntilTurn = -1）。
        this.player.refreshSpeeds();
        if (this.player.ticksUntilTurn === 0) {
            this.player.ticksUntilTurn += this.player.movementSpeed;
        } else if (this.player.ticksUntilTurn < 0) {
            this.player.ticksUntilTurn = 0;
        }

        // ---- P4-8：气味（CE Time.c:2506-2510 + Time.c:2610，主观玩家时间块）----
        // 每玩家回合恰好一次：先推进 scentTurnNumber（隐身 +10，否则 +3，对应
        // Time.c:2506-2509），再整图重刷气味（updateScent，Time.c:2610——CE 里
        // 两处都在 playerTurnEnded 内、怪物推进循环之前）。挂在 100-tick 客观块
        // 是错误实现：haste（50 tick/动作）下会漏刷、slowed（200 tick/动作）下
        // 会一回合刷两次。
        this.scent.turnNumber += this.player.hasStatus('invisible') ? 10 : 3;
        if (this.scent.turnNumber > 20000) {
            this.scent.resetTurnNumber(); // CE Time.c:2511-2513 → resetScentTurnNumber
        }
        this.scent.update(
            this.grid,
            this.player.loc.x,
            this.player.loc.y,
            // CE 半径为 DCOLS * FP_FACTOR（Time.c:770-771，等效无圆形截断）；
            // web 取 DCOLS + DROWS ≥ 地图对角线，同样不截断任何格。
            this.fov.computeFOVMask(this.player.loc.x, this.player.loc.y, DCOLS + DROWS, obstructsScent)
        );

        // ---- P4-9：safety map 的回合期管理（CE Time.c:2616-2626，主观玩家块、
        // 怪物推进之前）----先清"本回合已重算"闩锁；再扫描怪物表，若存在所在格
        // 在玩家 FOV 内的逃跑怪则主动预更新一次并停（break）——本回合内其余
        // 逃跑怪（含看不见玩家的）都复用这张图，getSafetyMap 不再重算。
        this.updatedSafetyMapThisTurn = false;
        for (const m of this.monsters) {
            if (m.hp > 0 && m.state === MonsterState.FLEEING &&
                this.grid.getCell(m.loc.x, m.loc.y)?.isVisible) {
                this.updateSafetyMap();
                break;
            }
        }

        if (this.animationEnabled && !this.isAutoTraveling()) {
            this.beginAdvancement(stealthRange);
            return;
        }

        const iter = this.advancementLoop(stealthRange);
        let step = iter.next();
        while (!step.done) step = iter.next();
        this.finishTurnEpilogue();
    }

    /**
     * P4-9：CE Time.c:1791 updateSafetyMap。构建详情见 SafetyMap.buildSafetyMap；
     * CE 在函数首行置位 rogue.updatedSafetyMapThisTurn（Time.c:1795），web 侧
     * 由本方法在构建后置位。C-0 起 isInLoop 由 loopMap 供数（Time.c:1925-1927
     * 的 IN_LOOP -=10 分支生效）。
     */
    public updateSafetyMap(): void {
        this.safetyMap = buildSafetyMap({
            grid: this.grid,
            playerX: this.player.loc.x,
            playerY: this.player.loc.y,
            playerLevitating: this.player.hasStatus('levitating'),
            playerImmuneToFire: this.player.hasStatus('immune_fire'),
            monsterAt: (x, y) => this.getMonsterAt(x, y),
            isInLoop: (x, y) => this.loopMap[x]?.[y] === true,
        });
        this.updatedSafetyMapThisTurn = true;
    }

    /**
     * P4-10：WaypointSystem 的宿主环境结构面（CE 侧散落在全局的
     * getFOVMask/monsterAtLoc/player 引用）。FOV 以 T_OBSTRUCTS_SCENT 为遮挡
     * （web 近似 obstructsScent）、半径 WAYPOINT_SIGHT_RADIUS——与气味图同源，
     * CE Architect.c:3048 同款。
     */
    public wpContext(): WaypointContext {
        return {
            grid: this.grid,
            monsters: this.monsters,
            computeWaypointFOV: (x, y) => this.fov.computeFOVMask(x, y, WAYPOINT_SIGHT_RADIUS, obstructsScent),
            isOccupiedByMonster: (x, y) => this.getMonsterAt(x, y) !== undefined,
            playerLoc: this.player.loc,
        };
    }

    /**
     * P4-10：waypoint 全量重建。对应 CE setUpWaypoints 的三个调用时机：
     *   - 关卡生成决策完成之后（generateDepth 两个分支的汇合点，RogueMain.c:707）
     *   - 重访缓存层恢复之后（同一位置，RogueMain.c:771）
     *   - 地形剧变之后（Items.c:5558 BE_TUNNELING）——web 尚无挖掘/洪水类
     *     地形剧变（P4-9 报告同款登记），本方法是预留的接入点。
     */
    public rebuildWaypoints(): void {
        this.waypoints.setUpWaypoints(this.wpContext());
    }

    /**
     * CE Time.c:2643-2752 推进主循环的可分步版本。E1-修订口径：只在慢回合的
     * 100-tick 客观块处 yield 一次暂停请求（毫秒数），供动画模式渲染暂停点
     * 画面并等待；怪物行动不再单独成帧。同步模式一次性跑完（生成器同源，
     * 保证两条路径的调度语义永不漂移）。
     */
    private *advancementLoop(stealthRange: number): Generator<number, void, void> {
        // CE Time.c:2471：fastForward 是 playerTurnEnded 内的局部变量，
        // 置位后本回合不再进入暂停分支（E1-修订：锁存，至多暂停一次）
        let fastForward = false;
        while (this.player.ticksUntilTurn > 0) {
            let soonestTurn = this.player.ticksUntilTurn;
            for (const m of this.monsters) {
                if (m.hp > 0 && m.ticksUntilTurn < soonestTurn) {
                    soonestTurn = m.ticksUntilTurn;
                }
            }
            // CE Time.c:2652：客观时间门是 soonestTurn 的第三候选。
            if (this.ticksTillUpdateEnvironment < soonestTurn) {
                soonestTurn = this.ticksTillUpdateEnvironment;
            }

            for (const m of this.monsters) {
                if (m.hp > 0) m.ticksUntilTurn -= soonestTurn;
            }

            // CE Time.c:2653-2655：客观时间门推进，归零则 +100 并执行客观块。
            this.ticksTillUpdateEnvironment -= soonestTurn;
            if (this.ticksTillUpdateEnvironment <= 0) {
                this.ticksTillUpdateEnvironment += 100;
                this.objectiveTimeBlock();
                // CE Time.c:2713-2715：岩浆/毒气等致死后立即退出推进
                if (this.isGameOver) return;
                // CE Time.c:2704-2707：仅当玩家本次动作慢于一个标准回合
                //（>100 tick；此刻玩家 tick 尚未递减，口径与 CE 一致）才暂停。
                // 自动寻路/探索对应 rogue.playbackFastForward——锁存但不暂停。
                if (this.player.ticksUntilTurn > 100 && !fastForward) {
                    fastForward = true;
                    if (!this.isAutoTraveling()) {
                        yield Game.ANIMATION_PAUSE_MS; // pauseAnimation(25, PAUSE_BEHAVIOR_DEFAULT)
                    }
                }
            }

            // CE Time.c:2720-2745：归零怪物行动。行动耗时按类型落账：
            // 攻击/施法出口在 Monster.takeTurn 内已置 attackSpeed（含
            // MONST_CAST_SPELLS_SLOWLY ×2）；移动/跳过（麻痹/俘虏/入迷等
            // takeTurn 早退）留 <= 0，由这里统一置 movementSpeed（CE
            // Time.c:2731 的不行动口径）。注意此处不 refreshSpeeds——公有
            // moveSpeed/attackSpeed 是"当前值"，直接写即生效（legacy 回置
            // 依赖此语义），重算反而会覆盖外部写入。
            // E1-修订：怪物行动不 yield——常规动作一次性跑完后统一渲染
            // （CE 连"豺狼 50 tick 走两步"也不单独成帧）。
            for (const m of this.monsters) {
                if (this.isGameOver) break; // CE Time.c:2721 的 gameHasEnded 守卫
                if (m.hp > 0 && m.ticksUntilTurn <= 0) {
                    m.takeTurn(this, stealthRange);
                    if (m.ticksUntilTurn <= 0) {
                        m.ticksUntilTurn = m.movementSpeed;
                    }
                }
            }

            this.player.ticksUntilTurn -= soonestTurn;
            if (this.isGameOver) return; // CE Time.c:2756-2758
        }
    }

    /**
     * CE Time.c:2657-2712 客观时间块：每 100 tick（客观时间）恰好执行一次，
     * 与玩家动作数解耦——haste（50 tick/动作）下两次动作才触发一次，
     * slowed（200 tick/动作）下一次动作触发两次。
     *
     * 与 CE 的逐条对照：
     * - rechargeItemsIncrementally(1) → tickArcanaResources()（法杖/魔杖充能、护符冷却）
     * - processIncrementalAutoID()    → web 无渐进鉴定系统，跳过（报告已列）
     * - rogue.monsterSpawnFuse--      → monsterSpawnFuse--，归零触发周期刷怪
     *                                   （CE 触发点在 decrementPlayerStatus 尾部，
     *                                   Time.c:2322-2325，同属客观块）
     * - decrementMonsterStatus(monst) → tickCreatureStatuses()（web 合并实现
     *   玩家+怪物状态；玩家 haste/slow 到期处按 CE Time.c:2261-2273 调用
     *   synchronizePlayerTimeState）
     * - updateEnvironment()           → updateFires/updateGases + applyEnvironmentalEffects
     *   （web 的 applyEnvironmentalEffects 同时覆盖 CE 的
     *   applyInstantTileEffectsToCreature——深渊/岩浆/燃烧的瞬时结算）
     * - decrementPlayerStatus()       → tickTemporaryImmunities + tickNutrition
     *   （营养递减与饥饿档位在 CE 位于 decrementPlayerStatus 内、由客观块调用；
     *   回血/饥饿伤害则是主观的，见 finishTurnEpilogue 的 recoverPerTurn）
     * - DFChance 地形特征生成 / monstersApproachStairs → web 无对应系统，跳过（报告已列）
     */
    private objectiveTimeBlock(): void {
        this.tickArcanaResources();

        // Time.c:2666 / Monsters.c:1128：每 100 tick monsterSpawnFuse--，
        // 归零触发周期刷怪并重置 fuse（CE 触发在 decrementPlayerStatus 尾部）
        if (this.mode !== 'test') {
            this.monsterSpawnFuse--;
            if (this.monsterSpawnFuse <= 0) {
                this.spawnPeriodicHorde();
                this.monsterSpawnFuse = rng.randRange(SPAWN_FUSE_MIN, SPAWN_FUSE_MAX);
            }
        }

        this.tickCreatureStatuses();

        // Let environment update
        this.environment.updateFires();
        this.environment.updateGases();

        // Apply fire/gas damage to everyone
        this.applyEnvironmentalEffects();

        const expiredImmunities = this.player.tickTemporaryImmunities();
        for (const im of expiredImmunities) {
            logger.log(i18next.t('status.player.immunity_off', { status: this.getStatusLabel(im), defaultValue: `Your immunity to ${this.getStatusLabel(im)} fades.` }), '#cccccc');
        }

        this.player.tickNutrition();
        const hungerTransition = this.player.consumeHungerTransition();
        if (hungerTransition) {
            this.logHungerTransition(hungerTransition);
        }

        // P4-10：滚动 waypoint 刷新（CE Time.c:2710-2714）——客观时间块的
        // 最后一步（CE 里在 monstersApproachStairs 之后）。每 100 tick 恰好
        // 重算一个 waypoint；全量重建只在关卡生成/重访时发生。
        this.waypoints.rollingRefresh(this.wpContext());
    }

    /**
     * 回合收尾：推进循环结束（或动画播完/兜底中止）后必须恰好执行一次。
     *
     * P2-3 起"主观/客观分离"：环境演化、物品充能、玩家/怪物状态递减、
     * 营养递减、spawnFuse 均已迁入 objectiveTimeBlock（每 100 tick，客观）；
     * 这里只保留 CE do 循环（Time.c:2494-2545）的每玩家动作部分——
     * 饥饿伤害与回血（recoverPerTurn）、回合数、死亡结算。
     */
    private finishTurnEpilogue() {
        // P4-4：推进循环（怪物互殴/环境效果）内产生的死亡在本回合结束前补触发一次，
        // 与 playerTurnEnded 顶部那次合起来覆盖"玩家动作本身杀死目标"与"推进循环
        // 内杀死目标"两种时序；deathEffectTriggered 保证不会被处理两次。
        this.triggerDeathFeatures();

        // 主观饥饿结算：饥饿伤害 / 回血（CE Time.c:2523-2541，每玩家动作一次）
        const recovery = this.player.recoverPerTurn();
        if (recovery === 'starving') {
            this.lastDamageSource = 'starvation';
        }

        if (this.mode === 'wizard') {
            // Wizard mode in stage-1 is intentionally permissive.
            this.player.hp = this.player.maxHp;
        }

        this.stats.turns++;

        if (this.player.hp <= 0 && !this.isGameOver) {
            let deathReason: string;
            if (this.lastDamageSource && this.lastDamageSource !== 'fire' && this.lastDamageSource !== 'steam' && this.lastDamageSource !== 'creeping death' && this.lastDamageSource !== 'starvation' && this.lastDamageSource !== 'poison') {
                deathReason = i18next.t('death.killed_by', { monster: this.lastDamageSource, defaultValue: `Killed by a ${this.lastDamageSource}.` });
            } else if (this.lastDamageSource === 'fire') {
                deathReason = i18next.t('death.burned', { defaultValue: 'Burned to death.' });
            } else if (this.lastDamageSource === 'steam') {
                deathReason = i18next.t('death.scalded', { defaultValue: 'Scalded to death by steam.' });
            } else if (this.lastDamageSource === 'creeping death') {
                deathReason = i18next.t('death.creeping_death', { defaultValue: 'Consumed by creeping death.' });
            } else if (this.lastDamageSource === 'starvation') {
                deathReason = i18next.t('death.starved', { defaultValue: 'Starved to death.' });
            } else if (this.lastDamageSource === 'poison') {
                deathReason = i18next.t('death.poisoned', { defaultValue: 'Died of poison.' });
            } else {
                deathReason = i18next.t('death.unknown', { defaultValue: 'Killed by unknown causes.' });
            }
            this.triggerGameOver(false, deathReason);
        }

        this.needsRender = true;
    }

    // ---- P2-4 CE 口径动画（决策 E1-修订）+ 输入锁 ----

    /**
     * 动画开关：headless（harness/默认构造）为 false——playerTurnEnded 同步跑完，
     * 测试零开销、不阻塞；GameCanvas 挂载时置 true。
     *
     * E1-修订（CE Time.c:2704 口径）：不再"每次怪物行动单独成帧"——
     * 常规动作（玩家 ≤100 tick）推进全程零插帧、一次性渲染；只有玩家动作
     * 慢于一个标准回合（>100 tick）时，在 100-tick 客观块处暂停
     * ANIMATION_PAUSE_MS，本回合锁存至多一次；自动寻路/自动探索全程不暂停。
     */
    public animationEnabled: boolean = false;
    /**
     * 慢回合在 100-tick 客观块处的暂停时长（ms）。
     * CE Time.c:2704 pauseAnimation(25, PAUSE_BEHAVIOR_DEFAULT)：Rogue.h:3057
     * 签名为 `pauseAnimation(short milliseconds, ...)`——参数即毫秒；
     * pauseBrogue（IO.c:2371）先 commitDraws() 渲染当前画面再延迟。
     * 原 P2-2 的 animationStepIntervalMs（80ms × 每次怪物行动）随逐次动画
     * 模型一并移除——新模型没有"每行动帧"的概念，唯一的时间常量就是这里的
     * 暂停时长。
     */
    public static readonly ANIMATION_PAUSE_MS = 25;
    /** 输入锁硬上限（ms）：推进无论因何种原因卡住，超时后强制快进收尾。 */
    private static readonly ANIMATION_LOCK_TIMEOUT_MS = 5000;

    /** 推进进行中（慢回合的暂停点未消费完/收尾未跑）。配合 animationLockDeadline 构成自过期锁。 */
    public isAdvancing = false;
    /** 推进循环内捕获的最近异常（保底路径的诊断/测试观测点，正常推进恒为 null）。 */
    public lastAdvancementError: unknown = null;
    /** 消费下一步之前需等待的毫秒数；>0 表示正停在动画暂停点（CE pauseAnimation 期间）。 */
    public pendingPauseMs = 0;

    private advancementIter: Generator<number, void, void> | null = null;
    private animationAccumulatorMs = 0;
    private animationLockDeadline = 0;

    /**
     * 玩家输入是否被锁定。锁有两个独立保险：
     * ① deadline 比对——即便收尾代码因任何原因没有执行，锁也会在
     *    ANIMATION_LOCK_TIMEOUT_MS 后自动失效（自过期，绝不永久卡死）；
     * ② finishAdvancement 的 try/finally 式收尾——异常、超时、正常完成三条
     *    路径都汇入同一处解锁逻辑。
     * 常规动作（≤100 tick）生成器零 yield，下一个渲染帧即解锁，玩家无感。
     */
    public isInputLocked(): boolean {
        return this.isAdvancing && Date.now() < this.animationLockDeadline;
    }

    /**
     * CE rogue.playbackFastForward 的 web 对应（Rogue.h:2523 "disables drawing
     * and prevents pauses"）：自动寻路 / 自动探索 / 鼠标行进期间，推进不做
     * 任何动画暂停。playerTurnEnded 入口据此直接走同步路径（零插帧、零锁），
     * advancementLoop 的暂停点据此跳过 yield（双保险，位置对应 CE 循环内
     * `rogue.playbackFastForward ||` 短路项）。
     *
     * 三个信号：inAutoTravelStep 是 stepAutoPath 调用栈内的显式标志——
     * 路径最后一步会先 shift() 清空 autoPath 再结算回合，到达终点的拾取
     * 回合同样发生在 autoPath 清空之后，仅靠 autoPath.length 会把这些步
     * 误判成普通回合而重新引入卡顿；autoPath/isMouseTraveling 覆盖
     * stepAutoPath 之外的状态（如路径已设好、步进还没开始的间隙）。
     */
    public isAutoTraveling(): boolean {
        return this.inAutoTravelStep || this.autoPath.length > 0 || this.isMouseTraveling;
    }

    /** stepAutoPath 调用栈内为 true（try/finally 保证复位），见 isAutoTraveling。 */
    private inAutoTravelStep = false;

    /** 动画模式入口：建立分步推进并锁输入。收尾在 finishAdvancement。 */
    private beginAdvancement(stealthRange: number): void {
        this.advancementIter = this.advancementLoop(stealthRange);
        this.isAdvancing = true;
        this.lastAdvancementError = null;
        this.animationAccumulatorMs = 0;
        this.pendingPauseMs = 0;
        this.animationLockDeadline = Date.now() + Game.ANIMATION_LOCK_TIMEOUT_MS;
    }

    /**
     * 渲染循环驱动：停在暂停点时按 pendingPauseMs 等待（CE pauseAnimation
     * 的 25ms——期间画面已渲染出暂停点状态），否则每个渲染帧消费一步。
     */
    public tickAdvancement(deltaMs: number): void {
        if (!this.isAdvancing || !this.advancementIter) return;
        this.animationAccumulatorMs += deltaMs;
        if (this.animationAccumulatorMs < this.pendingPauseMs) return;
        this.animationAccumulatorMs = 0;
        this.pendingPauseMs = 0;
        this.stepAdvancement();
    }

    /**
     * 消费一步推进。返回推进是否仍在进行：
     * - 慢回合推进到 100-tick 客观块暂停点：记录 pendingPauseMs、渲染暂停点
     *   画面（CE pauseBrogue 先 commitDraws 再延迟），返回 true；
     * - 生成器跑完（常规回合在这里一步完成，全程零中间帧）：收尾解锁，
     *   返回 false。
     * 异常/超时路径在内部收尾解锁后返回 false，绝不向外泄漏锁死的局面。
     */
    public stepAdvancement(): boolean {
        if (!this.isAdvancing || !this.advancementIter) return false;
        if (Date.now() >= this.animationLockDeadline) {
            // 保底①：锁超时——快进剩余调度并立即收尾解锁
            this.finishAdvancement();
            return false;
        }
        try {
            const r = this.advancementIter.next();
            if (r.done) {
                this.finishAdvancement();
                return false;
            }
            // 暂停点：先渲染当前状态再等待（r.value = 暂停毫秒数）
            this.pendingPauseMs = r.value;
            this.needsRender = true;
            this.update();
        } catch (err) {
            // 保底②：推进循环抛异常——记录证据、收尾、解锁（不吞掉证据）
            this.lastAdvancementError = err;
            this.finishAdvancement();
            return false;
        }
        return this.isAdvancing;
    }

    /**
     * 收束一次分步推进：三条路径（正常完成/超时快进/异常）全部汇入这里，
     * 释放输入锁并恰好执行一次回合收尾。若推进被中止（收尾时玩家仍欠 tick，
     * 即超时快进或异常路径），放弃本回合剩余调度、玩家行动权立即交还；
     * 未行动的怪物保留各自剩余 tick，随后续回合自然结算。
     */
    private finishAdvancement(): void {
        const iter = this.advancementIter;
        this.advancementIter = null;
        this.isAdvancing = false;
        this.animationAccumulatorMs = 0;
        this.pendingPauseMs = 0;
        const aborted = this.player.ticksUntilTurn > 0;
        if (iter) {
            try {
                iter.return();
            } catch {
                // 生成器可能已因异常终止，忽略
            }
        }
        if (aborted) {
            this.player.ticksUntilTurn = 0;
        }
        this.finishTurnEpilogue();
        this.update();
    }

    /** 场景重建（新游戏/读档/回放）时丢弃可能在途的推进，避免继承卡死的输入锁。 */
    public discardInFlightAdvancement(): void {
        const iter = this.advancementIter;
        this.advancementIter = null;
        this.isAdvancing = false;
        this.animationAccumulatorMs = 0;
        this.pendingPauseMs = 0;
        if (iter) {
            try {
                iter.return();
            } catch {
                // 同 finishAdvancement：生成器可能已终止
            }
        }
    }

    private tickArcanaResources() {
        for (const item of this.player.inventory.items) {
            if (item.category === ItemCategory.WAND || item.category === ItemCategory.STAFF) {
                if (
                    typeof item.maxCharges === 'number'
                    && typeof item.charges === 'number'
                    && item.charges < item.maxCharges
                ) {
                    item.rechargeCounter = (item.rechargeCounter ?? 0) + 1;
                    const turns = item.rechargeTurns ?? 200;
                    if (item.rechargeCounter >= turns) {
                        item.charges += 1;
                        item.rechargeCounter = 0;
                        logger.log(`${item.name} regains a charge.`, '#66ddff');
                    }
                }
            } else if (item.category === ItemCategory.CHARM) {
                const remain = item.cooldownRemaining ?? 0;
                if (remain > 0) {
                    item.cooldownRemaining = remain - 1;
                }
            }
        }
    }

    private serializeItem(item: Item): GameSnapshotItem {
        return {
            id: item.id,
            name: item.name,
            char: item.char,
            color: item.color,
            category: item.category,
            loc: { x: item.loc.x, y: item.loc.y },
            weight: item.weight,
            quantity: item.quantity,
            damage: item.damage,
            armor: item.armor,
            strengthRequired: item.strengthRequired,
            isCursed: item.isCursed,
            isProtected: item.isProtected,
            enchantment: item.enchantment,
            runicType: item.runicType,
            runicKnown: item.runicKnown,
            consumableId: (item as any).consumableId,
            maxCharges: item.maxCharges,
            charges: item.charges,
            rechargeTurns: item.rechargeTurns,
            rechargeCounter: item.rechargeCounter,
            cooldownTurns: item.cooldownTurns,
            cooldownRemaining: item.cooldownRemaining,
            identityId: (item as any).identityId
        };
    }

    private deserializeItem(s: GameSnapshotItem): Item {
        const item = new Item(s.name, s.char, s.color, s.category as ItemCategory);
        item.id = s.id;
        item.loc = { x: s.loc.x, y: s.loc.y };
        item.weight = s.weight;
        // 旧存档无 quantity 字段，回落为 Item 默认堆叠数 1
        item.quantity = s.quantity ?? 1;
        item.damage = s.damage;
        item.armor = s.armor;
        item.strengthRequired = s.strengthRequired;
        item.isCursed = s.isCursed;
        // 旧存档无 isProtected 字段，回落为 false
        item.isProtected = s.isProtected ?? false;
        item.enchantment = s.enchantment;
        item.runicType = s.runicType;
        item.runicKnown = !!s.runicKnown;
        item.maxCharges = s.maxCharges;
        item.charges = s.charges;
        item.rechargeTurns = s.rechargeTurns;
        item.rechargeCounter = s.rechargeCounter;
        item.cooldownTurns = s.cooldownTurns;
        item.cooldownRemaining = s.cooldownRemaining;
        if (s.identityId) {
            (item as any).identityId = s.identityId;
        }
        if (s.consumableId) {
            (item as any).consumableId = s.consumableId;
        }
        return item;
    }

    public toSnapshot(): GameSnapshot {
        const gridCells: GameSnapshot['grid'] = [];
        for (let x = 0; x < this.grid.width; x++) {
            for (let y = 0; y < this.grid.height; y++) {
                const cell = this.grid.getCell(x, y);
                if (!cell) continue;
                gridCells.push({
                    x,
                    y,
                    terrain: cell.terrain,
                    char: cell.char,
                    color: cell.color,
                    isExplored: cell.isExplored,
                    hasMemory: cell.hasMemory,
                    isBurning: cell.isBurning,
                    burnDuration: cell.burnDuration,
                    isPassable: cell.isPassable,
                    isOpaque: cell.isOpaque
                });
            }
        }

        const gasGrid: GameSnapshot['gasGrid'] = [];
        for (let x = 0; x < this.grid.width; x++) {
            for (let y = 0; y < this.grid.height; y++) {
                const gas = this.environment.gasGrid[x]?.[y];
                if (!gas || gas.density <= 0) continue;
                gasGrid.push({
                    x,
                    y,
                    type: gas.type,
                    density: gas.density
                });
            }
        }

        return {
            version: 1,
            savedAt: Date.now(),
            depth: this.depth,
            seed: this.currentSeed,
            mode: this.mode,
            player: {
                loc: { x: this.player.loc.x, y: this.player.loc.y },
                hp: this.player.hp,
                maxHp: this.player.maxHp,
                strength: this.player.strength,
                nutrition: this.player.nutrition,
                maxNutrition: this.player.maxNutrition,
                statusDurations: { ...this.player.statusDurations },
                inventory: this.player.inventory.items.map((it) => this.serializeItem(it)),
                equippedWeaponId: this.player.equippedWeapon?.id ?? null,
                equippedArmorId: this.player.equippedArmor?.id ?? null,
                equippedRingId: this.player.equippedRing?.id ?? null,
                temporaryImmunities: { ...this.player.temporaryImmunities }
            },
            monsters: this.monsters.map((m) => ({
                id: m.id,
                loc: { x: m.loc.x, y: m.loc.y },
                name: m.name,
                char: m.char,
                color: m.color,
                hp: m.hp,
                maxHp: m.maxHp,
                damageString: m.damageString,
                state: m.state,
                statusDurations: { ...m.statusDurations },
                goldDropChance: m.goldDropChance,
                itemDropChance: m.itemDropChance,
                onHitStatus: m.onHitStatus,
                onHitChance: m.onHitChance,
                onHitDuration: m.onHitDuration,
                statusImmunities: Array.from(m.statusImmunities),
                statusResistTurns: { ...m.statusResistTurns },
                abilities: Array.from(m.abilities)
            })),
            items: this.items.map((it) => this.serializeItem(it)),
            grid: gridCells,
            gasGrid,
            stats: { ...this.stats }
        };
    }

    public loadSnapshot(snapshot: GameSnapshot): boolean {
        if (!snapshot || snapshot.version !== 1) return false;

        // 实体 id 是模块级单调计数器（见 Creature.ts）。存档里的 id 可能来自
        // 更早的进程、已远超当前计数器值，必须先把计数器推到存档最大 id 之上，
        // 否则读档后新建的怪物/物品会与存档实体撞号。
        ensureEntityIdAbove(Math.max(
            0,
            ...snapshot.monsters.map((m) => m.id),
            ...snapshot.items.map((it) => it.id),
            ...snapshot.player.inventory.map((it) => it.id)
        ));

        this.mode = snapshot.mode;
        this.currentSeed = rng.seedRandomGenerator(snapshot.seed);
        ItemLoader.initConsumables();

        logger.messages = [];
        timeSystem.currentTick = 0;
        this.clearRecording();
        this.clearReplay();

        this.depth = snapshot.depth;
        this.grid = new Grid(DCOLS, DROWS);
        for (const c of snapshot.grid) {
            this.grid.setTerrain(c.x, c.y, c.terrain, c.char, c.color);
            const cell = this.grid.getCell(c.x, c.y);
            if (!cell) continue;
            cell.isExplored = c.isExplored;
            cell.hasMemory = c.hasMemory;
            cell.isVisible = false;
            cell.isBurning = c.isBurning;
            cell.burnDuration = c.burnDuration;
            cell.isPassable = c.isPassable;
            cell.isOpaque = c.isOpaque;
        }

        this.environment = new EnvironmentManager(this.grid);
        for (const g of snapshot.gasGrid) {
            this.environment.addGas(g.x, g.y, g.type as any, g.density);
        }
        this.fov = new FOVSys(this.grid);
        this.lightMap = new LightMap(this.grid);

        this.player = new Player(snapshot.player.loc.x, snapshot.player.loc.y);
        this.player.hp = snapshot.player.hp;
        this.player.maxHp = snapshot.player.maxHp;
        this.player.strength = snapshot.player.strength;
        this.player.nutrition = snapshot.player.nutrition;
        this.player.maxNutrition = snapshot.player.maxNutrition;
        this.player.statusDurations = { ...(snapshot.player.statusDurations ?? {}) };
        this.player.refreshSpeeds(); // P2-2：状态直写绕过 applyStatus，需显式重算衍生速度
        this.player.inventory.items = snapshot.player.inventory.map((it) => this.deserializeItem(it));
        this.player.equippedWeapon = this.player.inventory.items.find((it) => it.id === snapshot.player.equippedWeaponId) ?? null;
        this.player.equippedArmor = this.player.inventory.items.find((it) => it.id === snapshot.player.equippedArmorId) ?? null;
        this.player.equippedRing = this.player.inventory.items.find((it) => it.id === snapshot.player.equippedRingId) ?? null;
        this.player.temporaryImmunities = { ...(snapshot.player.temporaryImmunities ?? {}) };

        this.monsters = snapshot.monsters.map((m) => {
            const data = {
                id: m.name.toLowerCase().replace(/\s+/g, '_'),
                name: m.name,
                char: m.char,
                color: m.color,
                hp: m.maxHp,
                damage: m.damageString,
                minDepth: 1,
                maxDepth: 99,
                goldDropChance: m.goldDropChance,
                itemDropChance: m.itemDropChance,
                onHitStatus: m.onHitStatus,
                onHitChance: m.onHitChance,
                onHitDuration: m.onHitDuration,
                statusImmunities: m.statusImmunities,
                statusResistTurns: m.statusResistTurns,
                abilities: (m.abilities ?? []) as MonsterAbility[]
            };
            const monster = new Monster(m.loc.x, m.loc.y, data);
            monster.id = m.id;
            monster.hp = m.hp;
            monster.maxHp = m.maxHp;
            monster.state = m.state as any;
            monster.statusDurations = { ...(m.statusDurations ?? {}) };
            monster.refreshSpeeds(); // P2-2：状态直写绕过 applyStatus，需显式重算衍生速度
            monster.damageString = m.damageString;
            monster.goldDropChance = m.goldDropChance;
            monster.itemDropChance = m.itemDropChance;
            monster.onHitStatus = m.onHitStatus;
            monster.onHitChance = m.onHitChance ?? 0;
            monster.onHitDuration = m.onHitDuration ?? 0;
            monster.statusImmunities = new Set<StatusId>(m.statusImmunities ?? []);
            monster.statusResistTurns = { ...(m.statusResistTurns ?? {}) };
            return monster;
        });

        this.items = snapshot.items.map((it) => this.deserializeItem(it));
        if (snapshot.stats) {
            this.stats = { ...snapshot.stats };
        }

        // P1-35：读档后生成期派生态必须与当前网格自洽。loopMap 是网格的纯
        // 函数（P1-34 同一不变式的读档面），不重算就会沿用读档前那一局的
        // 环路图——safety map 的 IN_LOOP -=10 偏好按错误环路生效，静默失效。
        // analyzeLoopMap 纯函数、零 RNG 消耗，不影响读档的随机流。
        this.loopMap = analyzeLoopMap(this.grid);
        // P1-35 复核顺带补：waypoint 同为生成期派生态（CE 在重访层恢复后
        // 重建，RogueMain.c:771），不重建则漫游怪按上一局的 waypoint 走。
        // 构建内部流隔离，不动 RNG。
        this.rebuildWaypoints();
        // P1-35 复核顺带补：气味图快照 schema 无对应字段，陈局气味残留会
        // 误导嗅觉追踪——重置为空图（CE 语义是恢复 levels[d].scentMap，
        // web 缺数据源，报告登记）。
        this.scent = new ScentMap(DCOLS, DROWS);
        // P1-35 复核顺带补：机器格快照 schema 无对应字段，清空防上一层
        // 残留（落位检查在本层退化为不查机器，报告登记）。
        this.machineCells = new Set();

        this.visibleMonsters.clear();
        this.visibleItems.clear();
        this.autoPath = [];
        this.discardInFlightAdvancement();
        this.everSeenItems.clear();
        this.everSeenMonsters.clear();
        this.levels.clear();
        this.isMouseTraveling = false;
        this.isInventoryOpen = false;
        this.isThrowing = false;
        this.throwItemTarget = null;
        this.hoveredCell = null;
        this.hoveredText = '';
        this.floatingTexts = [];
        this.signTexts.clear();
        this.resetPlateRoomByPos.clear();
        this.testRooms.clear();
        this.currentTestCategory = null;
        this.needsRender = true;
        this.update();
        return true;
    }

    private applyEnvironmentalEffects() {
        const checkEntity = (entity: any, name: string) => {
            if (entity.hp <= 0) return;
            const x = entity.loc.x;
            const y = entity.loc.y;

            const cell = this.grid?.getCell(x, y);
            if (!cell) return;

            // Deep Water / Lava Death
            // 深水不致死（P1-27，决策 D2）：CE 的深水没有任何伤害（T_IS_DEEP_WATER
            // 只偷物品，Rogue.h:1937；坠落零伤害 Time.c:1146-1150），web 的淹死是
            // 自创内容，已通过 WEB_ONLY_DEEP_WATER_DROWNING 退出生效路径。
            // CE 深水的真实行为（50% 冲走携带物并随机移位，Time.c:556-590）属独立
            // 轮次，本轮不实现。悬浮/飞行生物照旧不进本分支。
            const isFlying = entity.hasStatus('flying') || entity.hasStatus('levitating') || (entity.abilities && entity.abilities.has('flying'));
            if (cell.terrain === TerrainType.WATER_DEEP && !isFlying) {
                if (WEB_ONLY_DEEP_WATER_DROWNING) {
                    // ---- web 自创"深水淹死"，按 D2 退出实际生效路径，代码原样保留 ----
                    if (entity === this.player) {
                        this.lastDamageSource = '';
                        logger.log(i18next.t('env.player_drowns', { defaultValue: 'You plunge into the dark water and drown.' }), '#0044ff');
                        this.triggerGameOver(false, i18next.t('death.drowned', { defaultValue: 'Drowned in deep water.' }));
                    } else {
                        logger.log(i18next.t('env.monster_drowns', { name: name, defaultValue: `The ${name} drowns.` }), '#8888aa');
                        entity.die();
                    }
                    return;
                }
            } else if (cell.terrain === TerrainType.LAVA && !isFlying
                && !entity.hasStatus('immune_fire')
                && !(entity.abilities && entity.abilities.has('immune_fire'))
                && !(entity.isInvulnerable && entity.isInvulnerable())) {
                // 熔岩豁免对齐 CE applyInstantTileEffectsToCreature（Time.c:183-190）：
                // 悬浮（STATUS_LEVITATING）、火焰免疫（STATUS_IMMUNE_TO_FIRE）、
                // 无敌（MONST_INVULNERABLE，全 CE 仅 Warden of Yendor 使用）。
                // CE 条款里的 T_ENTANGLES|T_OBSTRUCTS_PASSABILITY 与 TM_EXTINGUISHES_FIRE
                // 两个地形条件对纯岩浆 tile 恒假（Globals.c:420 LAVA 无这些旗标），
                // web 按地形类型分支即等价。
                if (entity === this.player) {
                    this.lastDamageSource = '';
                    logger.log(i18next.t('env.player_incinerated', { defaultValue: 'You are incinerated by the lava!' }), '#ff4400');
                    this.triggerGameOver(false, i18next.t('death.lava', { defaultValue: 'Incinerated by lava.' }));
                } else {
                    logger.log(i18next.t('env.monster_incinerated', { name: name, defaultValue: `The ${name} is incinerated.` }), '#aa6666');
                    entity.die();
                }
                return;
            }

            // Fire
            // CE 口径（Time.c:527 → exposeCreatureToFire Time.c:28-35）：火焰
            // 地形只豁免火焰免疫（STATUS_IMMUNE_TO_FIRE，旗标怪经
            // Monster.syncFlagDerivedStatuses 恒持有）与 MONST_INVULNERABLE
            // （P1-28 补齐，原实现缺）；另有 MB_SUBMERGED 与"非悬浮+灭火地形"
            // 两条 web 无对应物。原实现的 !hasStatus('levitating') 豁免在 CE
            // 不存在——火焰地形照烧悬浮生物（Time.c:527 无悬浮条款），且它会让
            // 旗标飞行怪物经派生悬浮状态获得 CE 没有的火免，故移除。
            if (cell.isBurning && !entity.hasStatus('immune_fire') && !(entity.abilities && entity.abilities.has('immune_fire')) && !(entity.isInvulnerable && entity.isInvulnerable())) {
                entity.hp -= 2; // Flat 2 damage for now
                if (entity === this.player) {
                    this.lastDamageSource = 'fire';
                    logger.log(i18next.t('env.player_burning', { defaultValue: 'You burn in the flames!' }), '#ff4444');
                }

                if (entity.hp <= 0) {
                    if (entity === this.player) {
                        logger.log(i18next.t('env.player_burned_death', { defaultValue: 'You have burned to death.' }), '#ff0000');
                    } else {
                        logger.log(i18next.t('env.burns_to_death', { name: name, defaultValue: `The ${name} burns to death.` }), '#888888');
                        entity.die();
                    }
                }
            }

            // Gas
            if (this.environment) {
                const gas = this.environment.gasGrid[x]?.[y];
                if (gas && gas.density > 0) {
                    if (gas.type === 2 /* GasType.POISON */) {
                        // Apply poisoned status instead of flat damage
                        const applied = entity === this.player
                            ? entity.applyStatus('poisoned', 5)
                            : this.applyStatusToMonster(entity as Monster, 'poisoned', 5, 'gas');
                        if (entity === this.player && applied) {
                            logger.log(i18next.t('env.player_poison_gas', { defaultValue: 'You breathe in toxic fumes!' }), '#aaeeaa');
                        }
                    } else if (gas.type === 3 /* GasType.CONFUSION */ && gas.density > 20) {
                        const applied = entity === this.player
                            ? entity.applyStatus('hallucinating', 6)
                            : this.applyStatusToMonster(entity as Monster, 'confused', 6, 'gas');
                        if (entity === this.player && applied) {
                            logger.log(i18next.t('env.player_confused_gas', { defaultValue: 'The confusion gas clouds your mind!' }), '#cc99ff');
                        }
                    } else if (gas.type === 4 /* GasType.STEAM */ && gas.density > 20) {
                        entity.hp -= 1;
                        if (entity === this.player) {
                            this.lastDamageSource = 'steam';
                            logger.log(i18next.t('env.player_scalded', { defaultValue: 'The steam scalds you!' }), '#cccccc');
                        }
                        if (entity.hp <= 0 && entity !== this.player) entity.die();
                    } else if (gas.type === 5 /* GasType.CREEPING_DEATH */) {
                        entity.hp -= 10;
                        if (entity === this.player) {
                            this.lastDamageSource = 'creeping death';
                            logger.log(i18next.t('env.player_creeping_death', { defaultValue: 'Spores of creeping death eat away at your flesh!' }), '#ff4444');
                        }
                        if (entity.hp <= 0 && entity !== this.player) entity.die();
                    }
                }
            }
        };

        checkEntity(this.player, 'Player');
        for (const m of this.monsters) {
            checkEntity(m, m.name);
        }

        // Destroy items in lava
        for (let i = this.items.length - 1; i >= 0; i--) {
            const item = this.items[i];
            if (!item) continue;
            const itemCell = this.grid.getCell(item.loc.x, item.loc.y);
            if (itemCell && itemCell.terrain === TerrainType.LAVA) {
                // Potions might shatter or boil, but for now they just burn up
                logger.log(i18next.t('item.destroyed_lava', { name: item.name, defaultValue: `${item.name} burns up in the lava.` }), '#aa5555');
                this.items.splice(i, 1);
            }
        }
    }

    public getMonsterAt(x: number, y: number): Monster | undefined {
        return this.monsters.find(m => m.loc.x === x && m.loc.y === y && m.hp > 0);
    }

    public hoveredCell: Pos | null = null;
    public hoveredText: string = '';

    private handleAutoExplore() {
        if (this.isInventoryOpen) return;

        // 1. Auto-Attack check
        const adjacentMonsters = Array.from(this.visibleMonsters).filter(m =>
            Math.abs(m.loc.x - this.player.loc.x) <= 1 && Math.abs(m.loc.y - this.player.loc.y) <= 1
        );

        if (adjacentMonsters.length > 0) {
            // Sort by HP ascending (lowest HP first)
            adjacentMonsters.sort((a, b) => a.hp - b.hp);
            const targetMob = adjacentMonsters[0];
            if (targetMob) {
                const dx = targetMob.loc.x - this.player.loc.x;
                const dy = targetMob.loc.y - this.player.loc.y;
                this.handlePlayerAction('move', { x: dx, y: dy }, 'system');
                return;
            }
        }

        // 2. User explicitly pressed 'x', ignore currently visible monsters & items for pathing purposes
        this.isMouseTraveling = false;
        for (const m of this.visibleMonsters) {
            this.everSeenMonsters.add(m);
        }
        for (const i of this.visibleItems) {
            this.everSeenItems.add(i);
        }

        const queue: Pos[] = [this.player.loc];
        const visited = new Set<string>();
        visited.add(`${this.player.loc.x},${this.player.loc.y}`);

        let target: Pos | null = null;

        while (queue.length > 0) {
            const curr = queue.shift()!;
            const cell = this.grid.getCell(curr.x, curr.y);

            const hasLoot = this.items.some(i => i.loc.x === curr.x && i.loc.y === curr.y);
            const isPlayerOnLoot = (curr.x === this.player.loc.x && curr.y === this.player.loc.y);

            if (cell && (!cell.isExplored || (hasLoot && !isPlayerOnLoot)) && cell.isPassable) {
                target = curr;
                break;
            }

            const dirs: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];
            for (const d of dirs) {
                const nx = curr.x + d[0];
                const ny = curr.y + d[1];
                const nextCell = this.grid.getCell(nx, ny);
                if (nextCell && this.grid.isValidPos(nx, ny) &&
                    nextCell.terrain !== TerrainType.WATER_DEEP &&
                    (nextCell.isPassable || !nextCell.isExplored)) {
                    const key = `${nx},${ny}`;
                    if (!visited.has(key)) {
                        visited.add(key);
                        queue.push({ x: nx, y: ny });
                    }
                }
            }
        }

        if (target) {
            this.setAutoPath(target.x, target.y);
        } else {
            logger.log(i18next.t('explore.nothing_more', { defaultValue: '这里没有什么可探索的了。' }), '#cccccc');
            this.autoPath = [];
        }
    }

    public handleMouseTravel(x: number, y: number) {
        if (this.isInventoryOpen) return;
        // P2-2 输入锁：动画期间不接受新的鼠标寻路
        if (this.isInputLocked()) return;

        if (this.isThrowing && this.throwItemTarget) {
            this.throwItemAt(this.throwItemTarget, x, y);
            return;
        }

        this.isMouseTraveling = true;

        // Ignore currently visible items and remembered items
        for (const i of this.visibleItems) {
            this.everSeenItems.add(i);
        }

        this.travelTargetItem = this.items.find(i => i.loc.x === x && i.loc.y === y);

        this.setAutoPath(x, y);
    }

    private canMoveTo(x: number, y: number): boolean {
        if (!this.grid.isValidPos(x, y)) return false;
        const cell = this.grid.getCell(x, y);
        if (!cell) return false;

        // Simplified collision
        const t = cell.terrain;
        if (t === TerrainType.GRANITE || t === TerrainType.WALL || t === TerrainType.SECRET_DOOR || t === TerrainType.LOCKED_DOOR) {
            return false;
        }
        if (t === TerrainType.WATER_DEEP) {
            return false;
        }

        return true;
    }

    public hasLineOfSight(x0: number, y0: number, x1: number, y1: number): boolean {
        let x = x0;
        let y = y0;
        const dx = Math.abs(x1 - x0);
        const dy = Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1;
        const sy = y0 < y1 ? 1 : -1;
        let err = dx - dy;

        while (!(x === x1 && y === y1)) {
            const e2 = 2 * err;
            if (e2 > -dy) {
                err -= dy;
                x += sx;
            }
            if (e2 < dx) {
                err += dx;
                y += sy;
            }

            if (x === x1 && y === y1) break;
            const cell = this.grid.getCell(x, y);
            if (!cell) return false;
            if (cell.isOpaque) return false;
        }
        return true;
    }

    private isInsideTestRoom(room: TestRoomState, x: number, y: number): boolean {
        return x >= room.x1 && x <= room.x2 && y >= room.y1 && y <= room.y2;
    }

    private resetTestRoom(roomId: number) {
        const room = this.testRooms.get(roomId);
        if (!room) return;

        this.items = this.items.filter((it) => !this.isInsideTestRoom(room, it.loc.x, it.loc.y));
        this.monsters = this.monsters.filter((m) => !this.isInsideTestRoom(room, m.loc.x, m.loc.y));

        for (const terrain of room.baselineTerrains) {
            this.grid.setTerrain(terrain.x, terrain.y, terrain.terrain, terrain.char, terrain.color);
            const cell = this.grid.getCell(terrain.x, terrain.y);
            if (!cell) continue;
            cell.isPassable = terrain.isPassable;
            cell.isOpaque = terrain.isOpaque;
            cell.isBurning = false;
            cell.burnDuration = 0;
            const gas = this.environment.gasGrid[terrain.x]?.[terrain.y];
            if (gas) {
                gas.density = 0;
            }
        }

        for (const itemSnapshot of room.baselineItems) {
            this.items.push(this.deserializeItem(itemSnapshot));
        }
        for (const monsterSnapshot of room.baselineMonsters) {
            this.monsters.push(this.createMonsterFromSnapshot(monsterSnapshot));
        }

        logger.log('重置踏板触发：房间已重置。', '#88ccff');
        this.needsRender = true;
    }

    private handleSpecialTileEntry() {
        const cell = this.grid.getCell(this.player.loc.x, this.player.loc.y);
        if (!cell) return;

        if (cell.terrain === TerrainType.SIGN) {
            const text = this.signTexts.get(this.posKey(this.player.loc.x, this.player.loc.y));
            if (text) {
                logger.log(`告示牌：${text}`, '#ffee88');
            }
        } else if (cell.terrain === TerrainType.RESET_PLATE) {
            const roomId = this.resetPlateRoomByPos.get(this.posKey(this.player.loc.x, this.player.loc.y));
            if (typeof roomId === 'number') {
                this.resetTestRoom(roomId);
            }
        } else if (cell.terrain === TerrainType.TRAP) {
            this.triggerTrap(this.player.loc.x, this.player.loc.y, cell);
        } else if (cell.terrain === TerrainType.PRESSURE_PLATE) {
            this.triggerPressurePlate(this.player.loc.x, this.player.loc.y);
        }

        // Check adjacent cells for secret doors (30% discovery chance per step)
        const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]] as const;
        for (const [dx, dy] of dirs) {
            const nx = this.player.loc.x + dx;
            const ny = this.player.loc.y + dy;
            const adjCell = this.grid.getCell(nx, ny);
            if (adjCell?.terrain === TerrainType.SECRET_DOOR && !adjCell.isDiscovered && rng.randPercent(30)) {
                adjCell.isDiscovered = true;
                // Reveal it as a door
                this.grid.setTerrain(nx, ny, TerrainType.DOOR, '+', 0xaa8844);
                logger.log(i18next.t('trap.secret_door_found', { defaultValue: 'You discovered a hidden door!' }), '#ffff88');
                this.needsRender = true;
            }
        }
    }

    /** Trigger a trap at (x, y). Converts it to FLOOR after triggering. */
    private triggerTrap(x: number, y: number, cell: import('../Map/Grid').Cell) {
        switch (cell.trapType) {
            case 'poison_gas':
                logger.log(i18next.t('trap.poison_gas', { defaultValue: 'You step on a poison gas trap! Toxic fumes billow out!' }), '#88ff88');
                this.environment.addGas(x, y, 2 /* POISON */, 80);
                break;
            case 'teleport':
                logger.log(i18next.t('trap.teleport', { defaultValue: 'You step on a teleport trap! You are whisked away!' }), '#ff88ff');
                this.teleportPlayerRandom();
                break;
            case 'fire':
                logger.log(i18next.t('trap.fire', { defaultValue: 'You step on a fire trap!' }), '#ff6600');
                this.environment.ignite(x, y);
                this.environment.ignite(x + 1, y);
                this.environment.ignite(x - 1, y);
                this.environment.ignite(x, y + 1);
                this.environment.ignite(x, y - 1);
                break;
        }
        // One-time use: convert to floor
        this.grid.setTerrain(x, y, TerrainType.CHARRED_FLOOR, '.', 0x554433);
        this.needsRender = true;
    }

    /** Pressure plate triggers all TRAP cells within radius 3. */
    private triggerPressurePlate(px: number, py: number) {
        logger.log(i18next.t('trap.pressure_plate', { defaultValue: 'You step on a pressure plate! Nearby traps spring to life!' }), '#ffcc44');
        for (let dx = -3; dx <= 3; dx++) {
            for (let dy = -3; dy <= 3; dy++) {
                if (dx === 0 && dy === 0) continue;
                const nx = px + dx;
                const ny = py + dy;
                const cell = this.grid.getCell(nx, ny);
                if (cell?.terrain === TerrainType.TRAP) {
                    this.triggerTrap(nx, ny, cell);
                }
            }
        }
        // Convert plate to floor after use
        this.grid.setTerrain(px, py, TerrainType.FLOOR, '.', 0x888888);
        this.needsRender = true;
    }

    /** Teleport player to a random walkable floor tile. */
    private teleportPlayerRandom() {
        const candidates: { x: number, y: number }[] = [];
        for (let x = 1; x < this.grid.width - 1; x++) {
            for (let y = 1; y < this.grid.height - 1; y++) {
                const cell = this.grid.getCell(x, y);
                if (cell?.isPassable && !this.getMonsterAt(x, y) &&
                    !(this.player.loc.x === x && this.player.loc.y === y)) {
                    candidates.push({ x, y });
                }
            }
        }
        if (candidates.length > 0) {
            const dest = candidates[rng.randRange(0, candidates.length - 1)]!;
            this.player.loc.x = dest.x;
            this.player.loc.y = dest.y;
            this.needsRender = true;
        }
    }

    private getTerrainName(terrain: TerrainType): string {
        switch (terrain) {
            case TerrainType.GRANITE:
                return i18next.t('terrain.granite', { defaultValue: '花岗岩墙壁' });
            case TerrainType.WALL:
                return i18next.t('terrain.wall', { defaultValue: '墙壁' });
            case TerrainType.DOOR:
                return i18next.t('terrain.door', { defaultValue: '关闭的门' });
            case TerrainType.OPEN_DOOR:
                return i18next.t('terrain.open_door', { defaultValue: '打开的门' });
            case TerrainType.WATER_SHALLOW:
                return i18next.t('terrain.shallow_water', { defaultValue: '浅水' });
            case TerrainType.WATER_DEEP:
                return i18next.t('terrain.deep_water', { defaultValue: '深水' });
            case TerrainType.CHASM:
                return i18next.t('terrain.chasm', { defaultValue: '深渊' });
            case TerrainType.LAVA:
                return i18next.t('terrain.lava', { defaultValue: '熔岩' });
            case TerrainType.GRASS:
                return i18next.t('terrain.grass', { defaultValue: '草地' });
            case TerrainType.FOLIAGE:
                return i18next.t('terrain.foliage', { defaultValue: '植被' });
            case TerrainType.BOG:
                return i18next.t('terrain.bog', { defaultValue: '沼泽' });
            case TerrainType.STAIRS_UP:
                return i18next.t('terrain.stairs_up', { defaultValue: '上行楼梯' });
            case TerrainType.STAIRS_DOWN:
                return i18next.t('terrain.stairs_down', { defaultValue: '下行楼梯' });
            case TerrainType.CHARRED_FLOOR:
                return i18next.t('terrain.charred_floor', { defaultValue: '烧焦的地面' });
            case TerrainType.SIGN:
                return i18next.t('terrain.sign', { defaultValue: '标牌' });
            case TerrainType.RESET_PLATE:
                return i18next.t('terrain.reset_plate', { defaultValue: '重置压板' });
            case TerrainType.TRAP:
                return i18next.t('terrain.trap', { defaultValue: '陷阱' });
            case TerrainType.SECRET_DOOR:
                return i18next.t('terrain.secret_door', { defaultValue: '暗门' });
            case TerrainType.PRESSURE_PLATE:
                return i18next.t('terrain.pressure_plate', { defaultValue: '压力板' });
            case TerrainType.LOCKED_DOOR:
                return i18next.t('terrain.locked_door', { defaultValue: '锁住的门' });
            case TerrainType.ALTAR:
                return i18next.t('terrain.altar', { defaultValue: '祭坛' });
            case TerrainType.WEB:
                return i18next.t('terrain.web', { defaultValue: '蛛网' });
            case TerrainType.BLOOD:
                return i18next.t('terrain.blood', { defaultValue: '血迹' });
            case TerrainType.MUD:
                return i18next.t('terrain.mud', { defaultValue: '泥浆' });
            case TerrainType.FLOOR:
            case TerrainType.NOTHING:
            default:
                return i18next.t('terrain.floor', { defaultValue: '地面' });
        }
    }

    public updateHover(x: number, y: number) {
        this.hoveredCell = { x, y };
        const cell = this.grid.getCell(x, y);

        if (!cell || (!cell.hasMemory && !cell.isVisible)) {
            this.hoveredText = i18next.t('hover.unknown', { defaultValue: '未知' });
            return;
        }

        const entities: string[] = [];

        // Check monster
        const m = this.getMonsterAt(x, y);
        if (m && cell.isVisible) entities.push(m.name);

        // Check items
        const itemsAtLoc = this.items.filter(i => i.loc.x === x && i.loc.y === y);
        if (cell.isVisible || cell.hasMemory) {
            itemsAtLoc.forEach(i => entities.push(i.displayName));
        }

        // Check player
        if (this.player.loc.x === x && this.player.loc.y === y && cell.isVisible) {
            entities.push(i18next.t('hover.you', { defaultValue: '你' }));
        }

        const separator = i18next.t('hover.separator', { defaultValue: '、' });
        const tName = this.getTerrainName(cell.terrain);

        let baseText = '';
        if (entities.length > 0) {
            baseText = i18next.t('hover.entity_on_terrain', {
                entities: entities.join(separator),
                terrain: tName,
                defaultValue: `${entities.join('、')}，位于${tName}`
            });
        } else {
            baseText = tName;
        }

        if (!cell.isVisible && cell.hasMemory && cell.isExplored) {
            if (entities.length > 0) {
                this.hoveredText = i18next.t('hover.remember_entity', {
                    entities: entities.join(separator),
                    defaultValue: `你记得在这里看到过${entities.join('、')}。`
                });
            } else {
                this.hoveredText = i18next.t('hover.remember_terrain', {
                    terrain: tName,
                    defaultValue: `你记得这里是${tName}。`
                });
            }
        } else {
            this.hoveredText = baseText;
        }

        if (cell.terrain === TerrainType.SIGN) {
            const signText = this.signTexts.get(this.posKey(x, y));
            if (signText) {
                this.hoveredText = `${this.hoveredText} ${signText}`;
            }
        }
    }

    public setAutoPath(x: number, y: number) {
        const path = Pathfind.findPath(this.grid, this.player.loc.x, this.player.loc.y, x, y, this.canMoveTo.bind(this));
        if (path && path.length > 0) {
            this.autoPath = path;
        } else {
            logger.log(i18next.t('ui.no_path', { defaultValue: '无法到达该位置。' }), '#aaaaaa');
            this.needsRender = true;
        }
    }

    public stepAutoPath() {
        if (this.autoPath.length === 0 || this.isInventoryOpen) return;
        // P2-2 输入锁：怪物行动动画播完之前，自动探索/寻路不得推进下一步
        // （GameCanvas 的 ticker 会持续重试，解锁后自然继续）
        if (this.isInputLocked()) return;

        // P2-4：本步连同其触发的攻击/拾取/回合结算一律按自动行进口径处理
        // （playerTurnEnded 同步推进、不暂停、不加锁）。try/finally 保证
        // 异常路径也复位。
        this.inAutoTravelStep = true;
        try {
            this.stepAutoPathInner();
        } finally {
            this.inAutoTravelStep = false;
        }
    }

    private stepAutoPathInner() {
        let shouldPause = false;
        const next = this.autoPath[0];
        if (!next) return;

        if (this.isMouseTraveling) {
            // Mouse travel logic:
            // 1. Prioritize destination. ONLY fight if blocked by an enemy.
            const blockMob = this.getMonsterAt(next.x, next.y);
            if (blockMob) {
                // Path blocked by monster, attack it!
                // （回合推进由 handlePlayerAction 的移动=攻击分支完成；
                //   原先此处再补一次 playerTurnEnded 属双重推进 bug，P2-2 修复）
                this.handlePlayerAction('move', { x: next.x - this.player.loc.x, y: next.y - this.player.loc.y }, 'system');
                // Do not clear autoPath, keep trying to move to destination unless user interrupts later.
                return;
            }

            // 2. Pause ONLY on brand new items found.
            for (const item of this.visibleItems) {
                if (!this.everSeenItems.has(item)) {
                    logger.log(i18next.t('explore.spot_item_stop_moving', { name: item.displayName, defaultValue: `You spot a ${item.displayName} and stop moving.` }), '#aaaaff');
                    shouldPause = true;
                    this.everSeenItems.add(item); // So we don't endlessly spam it if re-traveling
                    break;
                }
            }
        } else {
            // Explore 'x' logic:
            // 1. Check adjacent monsters. Attack and clear path if any.
            let adjacentMonster = null;
            for (const m of this.visibleMonsters) {
                if (Math.abs(m.loc.x - this.player.loc.x) <= 1 && Math.abs(m.loc.y - this.player.loc.y) <= 1) {
                    adjacentMonster = m;
                    break;
                }
                if (!this.everSeenMonsters.has(m)) {
                    logger.log(i18next.t('explore.spot_monster_stop_exploring', { name: m.name, defaultValue: `You spot a ${m.name} and stop exploring.` }), '#ffaaaa');
                    shouldPause = true;
                    this.everSeenMonsters.add(m);
                    break;
                }
            }

            if (adjacentMonster && !shouldPause) {
                // （回合推进由 handlePlayerAction 完成；原先的双重 playerTurnEnded
                //   已修，理由同上）
                this.handlePlayerAction('move', { x: adjacentMonster.loc.x - this.player.loc.x, y: adjacentMonster.loc.y - this.player.loc.y }, 'system');
                this.autoPath = [];
                return;
            }

            // 2. Check items
            if (!shouldPause) {
                for (const item of this.visibleItems) {
                    if (!this.everSeenItems.has(item)) {
                        logger.log(i18next.t('explore.spot_item_stop_exploring', { name: item.displayName, defaultValue: `You spot a ${item.displayName} and stop exploring.` }), '#aaaaff');
                        shouldPause = true;
                        this.everSeenItems.add(item);
                        break;
                    }
                }
            }
        }

        if (shouldPause) {
            this.autoPath = [];
            return;
        }

        // Ensure path is still valid space
        if (!this.canMoveTo(next.x, next.y)) {
            this.autoPath = [];
            logger.log('Path blocked.', '#ffaa88');
            this.needsRender = true;
            return;
        }

        this.autoPath.shift();

        // Move
        this.player.loc.x = next.x;
        this.player.loc.y = next.y;
        this.handleSpecialTileEntry();
        this.needsRender = true;

        // Auto-pickup if path reached destination
        if (this.autoPath.length === 0) {
            const hasLoot = this.items.some(i => i.loc.x === this.player.loc.x && i.loc.y === this.player.loc.y);
            if (hasLoot) {
                if (!this.isMouseTraveling || this.travelTargetItem) {
                    this.handlePlayerAction('pickup', undefined, 'system');
                }
            }
        }

        timeSystem.currentTick += this.player.movementSpeed;
        this.playerTurnEnded();
    }

    public triggerGameOver(won: boolean, reason?: string) {
        if (this.isGameOver) return;
        this.isGameOver = true;
        this.gameOverWon = won;
        this.gameOverReason = won
            ? i18next.t('death.victory_reason', { defaultValue: 'Escaped the Dungeons of Doom with the Amulet of Yendor!' })
            : (reason || i18next.t('death.unknown', { defaultValue: 'Killed by unknown causes.' }));
        this.recordedInputIndex = this.recordedInputEvents.length; // Stop accepting inputs

        // Capture inventory for end screen
        this.gameOverInventory = this.player.inventory.items.map(item => ({
            name: item.displayName,
            category: item.category,
            enchantment: item.enchantment,
            color: item.color
        }));

        // Calculate score: gold + item values + depth bonus
        let score = this.stats.gold;
        score += this.stats.maxDepth * 50;
        score += this.stats.kills * 10;
        for (const item of this.player.inventory.items) {
            if (item.category === ItemCategory.AMULET) {
                score += 10000; // Amulet is worth a lot
            } else {
                score += 100 + Math.max(0, item.enchantment) * 50;
            }
        }
        if (won) score *= 2; // Victory doubles score
        this.gameOverScore = score;

        this.needsRender = true;
    }
}

export const activeGame = new Game();
// @ts-ignore - Expose for testing/debugging
if (typeof window !== 'undefined') window.activeGame = activeGame;
