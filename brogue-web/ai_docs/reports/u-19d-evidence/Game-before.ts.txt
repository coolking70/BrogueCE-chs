import type { MachineEntityRuntime } from '../Generator/BlueprintEngine';
import { itemIsSwappable, enchantLevelKnown, swapItemToEnchantLevel } from '../Items/Commutation';
import { generateQualifiedMachineItem } from '../Items/MachineItemGeneration';
import { stairFallbackQualifies, stairCandidates, clearStairVicinity } from '../Generator/Stairs';
import { minionPlacement, generationDistances, qualifyingNear, speciesForbiddenFlags } from '../Generator/GenerationPlacement';
import { scheduleLevelFollowers, travelDistanceMap, travelPlacement, restoreTravelPosition, APPROACHING_DOWNSTAIRS, APPROACHING_UPSTAIRS, APPROACHING_PIT } from '../Movement/LevelTravel';
import { snapshotLevel as projectLevel, projectRunState, toWholeRunSnapshot,
    decodeWholeRunWorld, decodePlayer, isWholeRunSnapshot, type LevelSnapshot, type GameSnapshot } from './WholeRunSnapshot';
import { memoryTerrainAppearance } from '../UI/Appearance';
import { collectMachineCells } from '../Map/MachineCells';
import { initializeLevelSeeds, copyLevelSeeds, type LevelSeed } from './LevelSeeds';
import { NEGATABLE_TRAITS, NON_NEGATABLE_ABILITIES, NEGATABLE_MUTATIONS, hasNegatableBolt, negateBolts, negateCreatureStatusEffects } from '../Combat/Negation';
import { cloneLocation } from '../Combat/Cloning';
import { advancementLoop, objectiveTimeBlock, updateEnvironment, playerTurnEnded, finishTurnEpilogue, type TimePorts } from './TimeCoordinator';
import { anyoneWantABite } from '../Combat/MonsterAbsorption';
/**
 * src/engine/Core/Game.ts
 * Main game state and orchestration
 */
import { Grid, TerrainType, DCOLS, DROWS, DungeonLayer, DRAW_PRIORITY, type Cell } from '../Map/Grid';
import { blocksPassability, isDeepWater, isAutoDescent, TERRAIN_FLAGS, T_CAUSES_CONFUSION, T_CAUSES_NAUSEA, T_CAUSES_DAMAGE, T_CAUSES_PARALYSIS, T_CAUSES_EXPLOSIVE_DAMAGE, T_RESPIRATION_IMMUNITIES, TM_EXTINGUISHES_FIRE, T_AUTO_DESCENT, T_ENTANGLES, T_IS_DEEP_WATER, T_MOVES_ITEMS, T_PATHING_BLOCKER, T_DIVIDES_LEVEL, T_OBSTRUCTS_DIAGONAL_MOVEMENT, T_OBSTRUCTS_PASSABILITY, T_OBSTRUCTS_VISION, T_OBSTRUCTS_ITEMS, TM_IS_SECRET, TM_ALLOWS_SUBMERGING, TM_PROMOTES_ON_PLAYER_ENTRY, TM_PROMOTES_WITH_KEY, TM_PROMOTES_ON_CREATURE, TM_SWAP_ENCHANTS_ACTIVATION, TM_PROMOTES_ON_SACRIFICE_ENTRY, T_IS_DF_TRAP, T_HARMFUL_TERRAIN, T_SACRED, T_IS_FIRE, T_LAVA_INSTA_DEATH } from '../Map/TerrainCatalog';
import { isPathingBlocker } from '../Map/TerrainCatalog';
// B-4b：物品落位热力图与食物落位原语（CE Items.c:463-535 / Architect.c:171,3822）
import { ItemSpawnHeatMap, passableArcCount, randomMatchingLocation } from '../Items/ItemSpawnHeatMap';
import { cellTerrainMechFlags, cellTerrainFlags, catalogFeature, discoverSecretsAt, setDormantAwakener, setAllyResurrector, setDungeonFeatureEffects, terrainMechFlags, spawnDungeonFeature } from '../Map/DungeonFeature';
import { DF } from '../Map/DungeonFeatureCatalog';
import { Architect } from '../Generator/Architect';
// V-1c：奖励房配额计数器是 CE rogue.rewardRoomsGenerated 的 web 载体——
// run 级全局，开局清零（RogueMain.c:292 等价）并随存档往返（见快照字段注）。
import {
    getRewardRoomsGenerated,
    setRewardRoomsGenerated,
    resetRewardRoomsGenerated,
    resetMachineCounter, getNextMachineNumber, restoreNextMachineNumber,
    type MachineItemSpawn, type MachineMonsterSpawn,
    type MachineResult
} from '../Generator/BlueprintEngine';
import blueprintData from '../../data/blueprints.json';
import { getMachineObservationHook, setMachineObservationSeed, type MachineTrace } from '../Generator/MachineObservation';
import { Player, STOMACH_SIZE, type HungerState } from '../../entities/Player';
import { Monster, monstersAreTeammates, monstersAreEnemies } from '../../entities/Monster';
import { CombatSystem } from '../Combat/Combat';
import { staffPoison } from '../Combat/Poison';
import { staffProtection } from '../Combat/Shielding';
import { staffEntrancementDuration, ENTRANCEMENT_DIRECTIONS, entrancementPassable, entrancementDiagonalBlocked } from '../Movement/Entrancement';
import { wandDominate } from '../Combat/Domination';
import { staffBladeCount, bladeSpawnLocation } from '../Combat/Conjuration';
import { weaponParalysisDuration, weaponConfusionDuration, weaponSlowDuration, weaponImageCount, weaponImageDuration, armorImageCount, weaponForceDistance, netEnchant, damageFraction, armorAbsorptionMax, armorReprisalPercent } from '../Combat/CombatFormulas';
import { monsterIsInClass } from '../Combat/MonsterClass';
import { ItemCategory, Item } from '../Items/Item';
import { consumeForUse, finishItemUse, prepareThrownItem, boltWorldFor, commitArcanaTarget, hasIdentifyTarget, canIdentifyChosenItem, canEnchantChosenItem, enchantChosenItem, invokeCharm } from '../Items/ItemUseCoordinator';
import { endgameScore, lumenstoneCount } from './Endgame';
import { saveHighScore } from './HighScores';
import { ItemLoader } from '../Items/ItemLoader';
import { charmRechargeDelay, isCharmKind } from '../Items/CharmModel';
import { equippedWisdomBonus, tickStaffRecharge, rechargeStaffFully } from '../Items/ArcanaRecharge';
import { ringBonus } from '../Items/RingBonuses';
import { rng, Random, RNGType } from '../Random';
import { normalizeSeed, isSeed, type SeedInput } from '../Seed';
import monsterData from '../../data/monsters.json';
import hordeData from '../../data/hordes.json';
import mutationData from '../../data/mutations.json';
import type { MonsterData, MutationData } from '../../entities/Monster';
import { MonsterMode, MonsterState } from '../../entities/Monster';
import { Direction, type Pos } from '../../types';
import { ensureEntityIdAbove, resetEntityIds, getNextEntityId, restoreNextEntityId, type StatusId, type Creature } from '../../entities/Creature';
import { timeSystem } from '../Systems/Time';
import { generateMonsterDetail, generateItemDetail, type DetailInfo } from '../UI/DetailGenerator';
import { logger } from '../Systems/Logger';
import { Pathfind } from '../Map/Pathfind';
import { DijkstraMap, MAX_DISTANCE } from '../Map/Pathfinding';
import { ScentMap, obstructsScent } from '../Map/Scent';
import { buildSafetyMap, allocShortGrid, SAFETY_MAX_DISTANCE } from '../Map/SafetyMap';
import { analyzeLoopMap, emptyLoopMap } from '../Map/LoopMap';
import {
    promoteOnCommutation,
    discoverTerrain,
    promoteOnPlayerBump,
    promoteOnItemPickup,
    promoteOnItemPlaced,
    promoteOnStep,
    breakEntanglingTerrain,
    promoteLayersWithMechFlag,
    triggerCreatureTrapLayers,
    consumeTrapTile,
    tunnelize,
    spawnObstruction,
    type PromotionUpdateResult,
} from '../Map/Promotion';
import { CE_DEEPEST_LEVEL } from '../Map/LakeSystem';
import { WaypointSystem, WAYPOINT_SIGHT_RADIUS, type WaypointContext } from '../Map/WaypointMap';
import i18next from 'i18next';

/**
 * D2（G-1 / P1-45）：从随机生成池排除的药水。
 * potion_of_creeping_death：B-4a 复核更正——它是 **CE 原生**药水（=POTION_LICHEN，
 * "creeping death"，potionTable_Brogue 末条 GlobalsBrogue.c:681，frequency=7），
 * F-0 §5.2-5 "CE 无 creeping death 药水"的判语与 CE 源码不符。维持退池的真实
 * 理由是：web 的效果分支是纯 stub（只打日志，无 lichen），且 DF_LICHEN_PLANTED
 * 缺载体（THROWN_FUNCTIONAL_POTION_EFFECTS 注释同此口径）——生成"什么都不做
 * 的药水"比不生成更糟。载体补齐轮回池（登记于 B-4a 报告）。
 * 数据侧的收口（consumables.json excludeFromGeneration 标记）留给数据文件轮次。
 */
const D2_EXCLUDED_POTIONS: ReadonlySet<string> = new Set(['potion_of_creeping_death']);

import { EnvironmentManager, GasType } from '../Environment/Gas';
import { FOVSys } from '../Lighting/FOV';
import { LightMap } from '../Lighting/LightMap';
import {
    LIGHT_CATALOG,
    LightKind,
    MONSTER_INTRINSIC_LIGHT,
    MUTATION_LIGHT,
    VISIBILITY_THRESHOLD,
    minersLightBaseRadiusFixpt,
    minersLightColorAtDepth,
    updateMinersLightRadius,
    type LightSourceDef,
    type MinersLightState,
} from '../Map/LightCatalog';
import { FloatingText } from '../Visuals/FloatingText';
import { STATUS_CONFIG } from '../Status/statusConfig';
import { exposeBoltPathToElectricity, getBoltForItem, boltPath, createBoltResult, BoltEffect, BOLT_EFFECT_CE_EFFECT, MONSTER_BOLT_TABLE, type BoltConfig, type BoltFrame, type BoltResult, type BoltReflection, type MonsterBoltMeta } from '../Combat/Bolt';
import { traceBolt, type BoltWorld } from '../Combat/BoltTrajectory';
import { CE_BOLT_CATALOG, CEBoltEffect, CEBoltType, resolveCEBoltMagnitude } from '../Combat/BoltCatalog';
import { rollStaffDamage } from '../Combat/StaffDamage';
import { canPlaceCreature, teleportCandidates, captiveItemDropCandidates } from '../Movement/CreaturePlacement';

import { blinkTargetPreview } from '../Combat/BlinkTargeting';
import { MONSTER_BLINK } from '../Combat/MonsterBlink';
import { arcanaTargetCandidates, canObserveBoltCreature } from '../Combat/BoltTargeting';
import { canSeeMonster, canDirectlySeeMonster, canDisplayMonster, monsterHidden } from '../UI/MonsterVisibility';

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

// One instance contract for ordinary, mutated, polymorphed and cloned entities.
import { restoreEntityGraph, entityCodecDeps,
    serializeItem as encodeItem, deserializeItem as decodeItem,
    serializeMonster as encodeMonster,
    type GameSnapshotItem, type GameSnapshotMonster } from './EntitySnapshot';
export type { GameSnapshotItem, GameSnapshotMonster } from './EntitySnapshot';

export { WHOLE_RUN_SCHEMA } from './WholeRunSnapshot';

export type { LevelSnapshot, GameSnapshot } from './WholeRunSnapshot';
export type GameRunSnapshot = ReturnType<Game['snapshotRunState']>;

export interface LevelState {
    grid: Grid;
    environment: EnvironmentManager;
    fov: FOVSys;
    lightMap: LightMap;
    monsters: Monster[];
    /** CE levels[d].dormantMonsters: dormant ownership belongs to its floor. */
    dormantMonsters?: Monster[];
    items: Item[];
    visibleMonsters: Set<Monster>;
    visibleItems: Set<Item>;
    /** P1-31：该层的机器格集合（CE pmap machineNumber 派生），随层缓存。 */
    machineCells?: Set<number>;
    scent?: ScentMap;
    waypoints?: WaypointSystem;
    awaySince?: number;
    playerExitedVia?: Pos;
    pendingCaughtFireCells?: Pos[];
}

export type RecordedInputData = number | { x: number; y: number } | string | null;

export interface RecordedInputEvent {
    index: number;
    tick: number;
    depth: number;
    player: Pos;
    action: string;
    data: RecordedInputData;
    decisions?: boolean[];
    turn?: number;
    rng?: ReturnType<typeof rng.getState>;
    end?: { won: boolean; superVictory: boolean; score: number };
}

export interface GameRecording {
    version: number;
    recordedAt: number;
    /** Exports are canonical decimal strings; safe numeric recordings remain readable. */
    seed: string | number;
    mode: GameMode;
    startDepth: number;
    events: RecordedInputEvent[];
}

type ReplayStatus = 'idle' | 'loaded' | 'playing' | 'finished';
interface RecordingRuntime {
    replayError: string | null;
    commandDecisions: boolean[] | null;
    replayDecisionCursor: number;
    recordingFromNewGame: boolean;
}
const recordingRuntime = new WeakMap<Game, RecordingRuntime>();
function recordingState(game: Game): RecordingRuntime {
    let state = recordingRuntime.get(game);
    if (!state) {
        state = { replayError: null, commandDecisions: null, replayDecisionCursor: 0, recordingFromNewGame: true };
        recordingRuntime.set(game, state);
    }
    return state;
}
type TestAssetCategory = 'weapons' | 'wands' | 'scrolls' | 'potions' | 'other' | 'terrain' | 'enemies' | 'blueprints' | 'runics';

interface TestRoomState {
    id: number;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    baselineItems: GameSnapshotItem[];
    baselineMonsters: GameSnapshotMonster[];
    baselineTerrains: Array<{
        x: number;
        y: number;
        /** C-4a-0：改存四层（此前为单值 terrain）；重置时按层直填还原。 */
        layers: TerrainType[];
        char: string;
        color: number;
        isPassable: boolean;
        isOpaque: boolean;
    }>;
}

const superVictoryState = new WeakMap<Game, boolean>();

export class Game {
    public grid!: Grid;
    public environment!: EnvironmentManager;
    public fov!: FOVSys;
    public lightMap!: LightMap;
    public player: Player;
    /**
     * C-7：CE rogue.minersLight 的动态两列（Rogue.h:2486-2487）——基础半径
     * 随深度衰减（RogueMain.c:666-670），每次 updateVision 前由
     * refreshMinersLight 重算（纯函数、不消费 RNG；CE 的触发点
     * Items.c:4692/8090/8728 在 web 的载体缺口见该方法注释）。
     */
    public minersLight: MinersLightState = { radiusHundredths: 0, radialFadeToPercent: 35 };
    private minersLightBaseFixpt: number = 0;
    public autoPath: Pos[] = [];
    public monsters: Monster[] = [];
    /**
     * V-2b-5：CE 全局 `dormantMonsters`（Monsters.c:4156-4210 的第二条链表）。
     * 休眠怪**不在 `this.monsters` 里**——CE 摘链换表让「不占格、不获回合、
     * 不可见、monsterAtLoc 找不到」四件事一并成立，web 照抄同一结构：
     * 本表里的怪被回合推进、视野、寻路占用、落位资格等所有
     * `this.monsters` 读取者天然忽略，无需逐点加判断。
     */
    public dormantMonsters: Monster[] = [];
    /** CE purgatory: eligible dead allies awaiting a resurrection altar. */
    public purgatory: Monster[] = [];
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

    /**
     * C-5：CE confirm(char *prompt, boolean defaultAnswer)（IO.c）的引擎侧钩子——
     * 跳入已知深渊前的确认（Movement.c:1303-1322）。UI 轮把确认对话框接到
     * onConfirmRequest 上；钩子为 null（headless/未接线）时按"确认"处理，
     * 与 CE defaultAnswer 分支的差异登记在 C-5 报告。
     */
    public onConfirmRequest: ((message: string) => boolean) | null = null;

    /**
     * C-5：CE player.bookkeepingFlags & MB_IS_FALLING 的 web 等价位（Player
     * 在禁改清单，位挂在 Game 上）。置位点：踩渊之后（Movement.c:1474-1476）、
     * 下坠药水（Items.c:8098-8100）、环境结算（Time.c:168-176）；结算点：
     * playerTurnEnded 顶部（Time.c:2480-2486）与推进循环的即时检查
     * （Time.c:2866-2871），两处都走 playerFalls()。
     */
    private playerFalling: boolean = false;
    /** CE PRESSURE_PLATE_DEPRESSED: transient entry guard, reset each objective block. */
    private displacementTrapDepressions?: WeakMap<Grid, Set<number>>;

    /**
     * C-5：坠到"下一层"的怪物幸存者的暂存区（CE prependCreature 到
     * levels[rogue.depthLevel].monsters，Time.c:1567-1570——目标层此时可能
     * 尚未生成）。键 = 目标层深度；generateDepth 的新层分支在 populateLevel
     * 之后取走（restoreMonster-lite 重定位后并入 this.monsters）；
     * 目标层已缓存时直接并入缓存层的怪物表。
     */
    private pendingFallenItemsByDepth: Map<number, Item[]> = new Map();
    private pendingFallenByDepth: Map<number, Monster[]> = new Map();

    private needsRender: boolean = true;
    public isInventoryOpen: boolean = false;
    public referenceScreen: 'discoveries' | 'help' | null = null;

    /**
     * B-1b：鉴定卷轴的目标待选态（CE promptForItemOfType，Items.c:7783-7802）。
     * CE 是读卷轴回合内同步选目标且不可取消（do-while 强制选到合法目标为止）；
     * web 的 UI 是异步弹层——读卷轴的回合先正常推进（与 CE 同为整回合），
     * 弹层点选后立即落账、不再消耗回合（CE 的选择本身零回合成本）。
     * 选择期间复用背包弹层并封锁其余输入（escape/toggle 也不得关闭）。
     * U03: mandatory selection survives a checkpoint; reopening costs no extra turn.
     */
    public pendingIdentify: boolean = false;
    public pendingEnchantment: boolean = false;
    // W-2: transient choice, never persisted; selection cannot spend a turn.
    public pendingArcana: { item: Item; cursor: Pos } | null = null;

    public isThrowing: boolean = false;
    public throwItemTarget: Item | null = null;

    public isExamining: boolean = false;
    public inspectTarget: DetailInfo | null = null;
    public examinedEntityIds = new Set<string | number>();

    public depth: number = 1;
    public mode: GameMode = 'normal';
    public currentSeed: string = '0';

    /**
     * B-4a：≙ CE rogue.meteredItems（RogueMain.c:229-252 开局初始化；
     * Items.c:577-579 每层入口加频、674-686 写回、740-752 生成后扣减）。
     * 语义与索引全按 ItemLoader.CE_METERED_ITEMS_TABLE（前 14 卷轴后 16 药水）。
     * U03: preserved in GameSnapshot.run.meteredItems.
     */
    private meteredItems: { frequency: number; numberSpawned: number }[] = ItemLoader.initMeteredItems();
    /** B-4a：≙ CE rogue.foodSpawned（Items.c:697/732，食物保底公式的累计口径）。 */
    private foodSpawned: number = 0;
    /**
     * B-4b：≙ CE rogue.goldGenerated（Items.c:781 每堆金币生成时累加；
     * :602/:604 的产量调度读它）。仅生成期金币堆计入——web 的怪物金币掉落
     * （goldDropChance，CE 无此机制）不计入，与 CE 的 goldGenerated 口径一致。
     * U03: preserved in GameSnapshot.run.goldGenerated.
     */
    private goldGenerated: number = 0;

    // Time.c:2666 每回合递减；归零触发周期刷怪（Monsters.c:1128 spawnPeriodicHorde）
    public monsterSpawnFuse: number = 0;

    // CE rogue.ticksTillUpdateEnvironment（RogueMain.c:404 初值 100）：客观时间门。
    // P2-3 起作为 advancementLoop soonestTurn 的第三候选（Time.c:2651-2652），
    // 每 100 tick 触发一次 objectiveTimeBlock。
    public ticksTillUpdateEnvironment: number = 100;

    // C-4c：最近一次晋升驱动的结果（测量/测试读取；不进存档——驱动无跨回合
    // 状态，唯一跨回合量 caughtFireRemaining 已回喂 pendingCaughtFireCells）。
    public lastPromotionUpdate: PromotionUpdateResult | null = null;

    // C-4c：CE pmap CAUGHT_FIRE_THIS_TURN 的跨回合存活部分（CE Time.c:1668
    // 只在下一回合记账趟清）。web 无格旗标，由 Game 持有、按 CE 语义回喂驱动。
    private pendingCaughtFireCells: Pos[] = [];

    // CE levels[d].scentMap: each floor retains its values. The active map's
    // turnNumber is the run clock, carried forward on entry (U03).
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
    // 客观块滚动刷新一个（CE Time.c:2710-2714）。U02b: new-level builds use
    // the level RNG; revisit builds consume the live stream. U03 saves all products.
    public waypoints: WaypointSystem = new WaypointSystem();

    // U04c: detached grid.machineNumber projection, never MachineResult.cells.
    // Blueprint commit/rollback owns all number writes; rebuild after generation
    // and each grid replacement. Snapshots validate this redundant projection.
    private machineCells: Set<number> = new Set();

    // Endgame & Stats
    public isGameOver: boolean = false;
    public gameOverWon: boolean = false;
    public get gameOverSuperVictory(): boolean { return superVictoryState.get(this) ?? false; }
    public set gameOverSuperVictory(value: boolean) { superVictoryState.set(this, value); }
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

    public levelSeeds: LevelSeed[] = [];
    private currentLevelDepth: number | null = null;
    public absoluteTurnNumber = 0;
    private currentLevelAwaySince = 0;
    private currentLevelExitedVia: Pos = { x: 0, y: 0 };
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
    public get replayError(): string | null { return recordingState(this).replayError; }
    private set replayError(value: string | null) { recordingState(this).replayError = value; }
    private get commandDecisions(): boolean[] | null { return recordingState(this).commandDecisions; }
    private set commandDecisions(value: boolean[] | null) { recordingState(this).commandDecisions = value; }
    private get replayDecisionCursor(): number { return recordingState(this).replayDecisionCursor; }
    private set replayDecisionCursor(value: number) { recordingState(this).replayDecisionCursor = value; }
    private get recordingFromNewGame(): boolean { return recordingState(this).recordingFromNewGame; }
    private set recordingFromNewGame(value: boolean) { recordingState(this).recordingFromNewGame = value; }
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

    public startNewGame(options?: { seed?: SeedInput; mode?: GameMode }) {
        // Validate before retiring the current run (unsafe numeric inputs cannot be recovered).
        const seed = normalizeSeed(options?.seed ?? 0);
        // U00: retire the old run before seeding/allocating the next one. Returning
        // the iterator must not run an old turn's epilogue against the new world.
        this.discardInFlightAdvancement();
        if (this.grid) { setDormantAwakener(this.grid, null); setAllyResurrector(this.grid, null); setDungeonFeatureEffects(this.grid, null); }
        for (const level of this.levels.values()) { setDormantAwakener(level.grid, null); setAllyResurrector(level.grid, null); setDungeonFeatureEffects(level.grid, null); }
        this.purgatory = [];
        this.animationLockDeadline = 0;
        this.lastAdvancementError = null;
        this.inAutoTravelStep = false;

        this.mode = options?.mode ?? 'normal';
        rng.setRNG(RNGType.RNG_SUBSTANTIVE);
        this.currentSeed = rng.seedRandomGenerator(seed);
        if (getMachineObservationHook()) setMachineObservationSeed(this.currentSeed);
        rng.resetCounters();
        this.levelSeeds = initializeLevelSeeds(rng, this.currentSeed);

        ItemLoader.initConsumables();
        logger.reset();
        timeSystem.currentTick = 0;

        // V-1c：奖励房配额计数随新局清零（CE RogueMain.c:292）。必须先于首层
        // 生成——配额公式按它决定本层建几台奖励机器。
        resetRewardRoomsGenerated();
        // Normal generation resets this per level; test mode can bypass it.
        resetMachineCounter();

        this.depth = 1;
        this.currentLevelDepth = null;
        this.absoluteTurnNumber = 0;
        this.currentLevelAwaySince = 0;
        this.currentLevelExitedVia = { x: 0, y: 0 };
        this.levels = new Map();
        this.monsters = [];
        this.dormantMonsters = []; // V-2b-5：休眠表随新局清零
        this.items = [];
        // B-4a：计量表与食物累计随新局清零（CE initializeRogue 的
        // RogueMain.c:229-252 / rogue.foodSpawned 初值 0）。
        this.meteredItems = ItemLoader.initMeteredItems();
        this.foodSpawned = 0;
        // B-4b：金币产量计数随新局清零（CE RogueMain.c:384）。
        this.goldGenerated = 0;
        this.visibleMonsters = new Set();
        this.visibleItems = new Set();
        this.autoPath = [];
        this.everSeenItems = new Set();
        this.everSeenMonsters = new Set();
        this.travelTargetItem = undefined;
        this.scent = new ScentMap(DCOLS, DROWS);
        this.playerFalling = false;
        this.displacementTrapDepressions = undefined;
        this.pendingFallenByDepth = new Map();
        this.pendingFallenItemsByDepth = new Map();
        this.lastPromotionUpdate = null;
        this.pendingCaughtFireCells = [];
        this.machineCells = new Set();
        this.waypoints = new WaypointSystem();
        this.safetyMap = allocShortGrid(DCOLS, DROWS, SAFETY_MAX_DISTANCE);
        this.updatedSafetyMapThisTurn = false;
        this.isGameOver = false;
        this.gameOverWon = false;
        this.gameOverSuperVictory = false;
        this.gameOverReason = '';
        this.stats = { kills: 0, gold: 0, turns: 0, maxDepth: 1 };
        this.lastDamageSource = '';
        this.gameOverInventory = [];
        this.gameOverScore = 0;
        this.isMouseTraveling = false;
        this.isInventoryOpen = false;
        this.pendingIdentify = false;
        this.pendingEnchantment = false;
        this.pendingArcana = null;
        // B-1c：恶意品确认待决态不得跨场景泄漏（与 pendingIdentify 同处复位）
        this.pendingUseConfirm = null;
        this.isThrowing = false;
        this.throwItemTarget = null;
        this.isExamining = false;
        this.inspectTarget = null;
        this.examinedEntityIds = new Set();
        this.pendingBoltFrames = [];
        this.activeFlares = [];
        this.terrainFlashes = [];
        this.flareLightMap = null;
        this.flareElapsedMs = 0;
        this.currentBoltFrameIndex = 0;
        this.boltAnimStartTime = 0;
        this.hoveredCell = null;
        this.hoveredText = '';
        this.floatingTexts = [];
        this.recordingStartAt = Date.now();
        this.recordedInputEvents = [];
        this.recordedInputIndex = 0;
        this.recordingFromNewGame = true;
        this.clearReplay();
        this.signTexts = new Map();
        this.resetPlateRoomByPos = new Map();
        this.testRooms = new Map();
        this.currentTestCategory = null;

        // P1-42：CE 开局时 rogue 全局字段随 game 加载归零——justSearched
        // （Rogue.h:2449）与 STATUS_SEARCHING 充能（Time.c:2397）不跨局保留。
        this.justSearched = false;
        this.searchingCharge = 0;
        this.justRested = false;
        this.secretScanDepth = -1;
        this.levelHasSecrets = false;
        this.poisonedDuringTurn = false;

        // No RNG draws: stable run-local IDs include carried/leader references.
        // UI callbacks and animationEnabled are session settings and stay intact.
        resetEntityIds();
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
            // B-1a：CE RogueMain.c:423-425 开局匕首 identify(theItem)——实例全亮
            dagger.identified = true;
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
            dart.identified = true; // CE RogueMain.c:431-433
            this.player.inventory.addItem(dart);
        }

        const leatherArmor = ItemLoader.spawnArmor('leather_armor', -1, -1);
        if (leatherArmor) {
            leatherArmor.enchantment = 0;
            leatherArmor.isCursed = false;
            leatherArmor.runicType = undefined;
            leatherArmor.runicKnown = true;
            leatherArmor.identified = true; // CE RogueMain.c:439-441
            this.player.inventory.addItem(leatherArmor);
            this.player.equip(leatherArmor);
        }

        this.generateDepth(false, true);
        this.needsRender = true;
        this.update();
    }

    /**
     * B-4a：populateItems 逐件生成决策（CE Items.c:667-756 的 web 移植）。
     * 顺序对齐 CE：食物保底 → 计量阈值/硬保底 → pickItemCategory 加权抽类别
     * → chooseKind 加权抽种类 → 生成后计量扣减。
     * B-4b 起**落位不再由本方法决定**：物品以占位坐标生成，落位（热力图 /
     * 食物例外路径）由 populateLevel 的主循环按 CE Items.c:726-739 的顺序执行。
     *
     * 与 CE 的两处已登记偏差：
     *  - 深度门（minDepth/maxDepth）不再参与此类抽取：CE 的 chooseKind 无深度门，
     *    web 的 minDepth/maxDepth 列为 web 自创口径（登记于报告）。
     */
    private spawnPopulateItem(depth: number, randomDepthOffset: number): Item | null {
        // B-4b：占位坐标——落位由调用方在生成决策之后按 CE 顺序另行选择
        //（CE：generateItem 在先、选点在后），生成函数只产出不选址。
        const pos = { x: 0, y: 0 };
        const table = ItemLoader.CE_METERED_ITEMS_TABLE;

        // ---- CE Items.c:674-686：把计量表频率写回工作表 ----
        // 只写 incrementFrequency != 0 的条目。CE 的落点是 scrollTable[j]（j<14）
        // 或 potionTable[j - numberScrollKinds]（j>=14）——web 由条目自带的 webId
        // 承载落点，配对恒为 table[j] ↔ meteredItems[j]（表序即 CE 序）。
        const meteredFreq = new Map<string, number>();
        for (let j = 0; j < table.length; j++) {
            const e = table[j]!;
            if (e.incrementFrequency === 0) continue;
            if (e.webId) meteredFreq.set(e.webId, this.meteredItems[j]!.frequency);
        }

        // ---- CE Items.c:685-691：食物保底（营养下限）----
        if (ItemLoader.foodGuaranteeTriggered(this.foodSpawned, depth, randomDepthOffset)) {
            const id = this.chooseKindFromPool(ItemLoader.genFood.map(f => f.id), ItemLoader.genFood.map(f => f.frequency), meteredFreq);
            const item = id ? ItemLoader.spawnFood(id, pos.x, pos.y) : null;
            if (item) {
                this.foodSpawned += ItemLoader.food.find(f => f.id === id)?.nutrition ?? 0;
                // CE 对每件生成物都跑扣减循环（FOOD 无匹配条目 → 无事发生）
                this.decrementMeteredForSpawn(ItemCategory.FOOD, id!);
                return item;
            }
        }

        // ---- CE Items.c:700-716：计量阈值强制生成 + 按层硬保底 ----
        // CE 语义：全表按序找**第一条**命中阈值或硬保底的条目，命中即整件
        // 生成该种类（跳过 pickItemCategory）。
        for (let j = 0; j < table.length; j++) {
            const e = table[j]!;
            const m = this.meteredItems[j]!;
            const thresholdHit = e.levelScaling !== 0
                && m.numberSpawned * e.genMultiplier + e.genIncrement < depth * e.levelScaling + randomDepthOffset;
            const guaranteeHit = depth === e.levelGuarantee
                && m.numberSpawned < e.itemNumberGuarantee;
            if (!thresholdHit && !guaranteeHit) continue;
            if (!e.webId) break; // 目录缺该种类（登记），退回普通抽取
            const item = this.spawnConsumableById(e.webId, e.category, pos);
            if (item) {
                this.decrementMeteredForSpawn(
                    e.category === 'SCROLL' ? ItemCategory.SCROLL : ItemCategory.POTION,
                    e.webId);
                return item;
            }
        }

        // ---- CE Items.c:88-107 pickItemCategory：类别加权抽取 ----
        const category = ItemLoader.pickItemCategory();
        let id: string | null = null;
        switch (category) {
            case ItemCategory.SCROLL:
                id = this.chooseKindFromPool(ItemLoader.genScrolls.map(s => s.id), ItemLoader.genScrolls.map(s => s.frequency), meteredFreq);
                break;
            case ItemCategory.POTION: {
                // D2（G-1 / P1-45）：creeping_death 维持退池——CE 原生（=POTION_LICHEN，
                // GlobalsBrogue.c:681，先前"web 自创"的判语有误，见 B-4a 报告），
                // 但 web 的效果是纯 stub 且 DF_LICHEN_PLANTED 缺载体，生成"什么都不做
                // 的药水"比不生成更糟。载体补齐轮回池。
                const pool = ItemLoader.genPotions.filter(p => !D2_EXCLUDED_POTIONS.has(p.id));
                id = this.chooseKindFromPool(pool.map(p => p.id), pool.map(p => p.frequency), meteredFreq);
                break;
            }
            case ItemCategory.WEAPON:
                id = this.chooseKindFromPool(ItemLoader.genWeapons.map(w => w.id), ItemLoader.genWeapons.map(w => w.frequency), meteredFreq);
                break;
            case ItemCategory.ARMOR:
                id = this.chooseKindFromPool(ItemLoader.genArmors.map(a => a.id), ItemLoader.genArmors.map(a => a.frequency), meteredFreq);
                break;
            case ItemCategory.FOOD:
                id = this.chooseKindFromPool(ItemLoader.genFood.map(f => f.id), ItemLoader.genFood.map(f => f.frequency), meteredFreq);
                break;
            case ItemCategory.WAND:
                id = this.chooseKindFromPool(ItemLoader.genWands.map(w => w.id), ItemLoader.genWands.map(w => w.frequency), meteredFreq);
                break;
            case ItemCategory.STAFF:
                id = this.chooseKindFromPool(ItemLoader.genStaffs.map(s => s.id), ItemLoader.genStaffs.map(s => s.frequency), meteredFreq);
                break;
            case ItemCategory.RING:
                id = this.chooseKindFromPool(ItemLoader.genRings.map(r => r.id), ItemLoader.genRings.map(r => r.frequency), meteredFreq);
                break;
            case ItemCategory.CHARM:
                id = this.chooseKindFromPool(ItemLoader.genCharms.map(c => c.id), ItemLoader.genCharms.map(c => c.frequency), meteredFreq);
                break;
            default:
                return null; // KEY/AMULET 权重 0，不可达；GOLD 不参与生成期抽取
        }
        if (!id) return null;
        const item = this.spawnKindById(category, id, pos, depth);
        if (item) {
            // CE Items.c:740-752：普通抽取路径同样要在生成后扣减计量表——
            // 漏掉这一步会让 enchanting/life/strength 的频率只涨不跌（首轮
            // 实测：附魔卷轴 72/局、life 药水 22 只/局，全部因此而来）。
            this.decrementMeteredForSpawn(category, id);
        }
        return item;
    }

    /** CE chooseKind 的池化封装：ids/freqs 等长，计量覆盖值优先于基表频率。 */
    private chooseKindFromPool(ids: string[], freqs: Array<number | undefined>, meteredFreq: Map<string, number>): string | null {
        if (ids.length === 0) return null;
        const effective = ids.map((id, i) => meteredFreq.get(id) ?? freqs[i] ?? 10);
        return ids[ItemLoader.chooseKind(effective)] ?? null;
    }

    /** 卷轴/药水共用 spawn（计量强制分支用）。 */
    private spawnConsumableById(id: string, category: 'SCROLL' | 'POTION', pos: Pos): Item | null {
        return category === 'SCROLL'
            ? ItemLoader.spawnScroll(id, pos.x, pos.y)
            : ItemLoader.spawnPotion(id, pos.x, pos.y);
    }

    private spawnKindById(category: ItemCategory, id: string, pos: Pos, depth: number): Item | null {
        switch (category) {
            case ItemCategory.SCROLL: return ItemLoader.spawnScroll(id, pos.x, pos.y);
            case ItemCategory.POTION: return ItemLoader.spawnPotion(id, pos.x, pos.y);
            case ItemCategory.WEAPON: return ItemLoader.spawnWeapon(id, pos.x, pos.y, depth);
            case ItemCategory.ARMOR: return ItemLoader.spawnArmor(id, pos.x, pos.y, depth);
            case ItemCategory.FOOD: return ItemLoader.spawnFood(id, pos.x, pos.y);
            case ItemCategory.WAND: return ItemLoader.spawnWand(id, pos.x, pos.y);
            case ItemCategory.STAFF: return ItemLoader.spawnStaff(id, pos.x, pos.y);
            case ItemCategory.RING: return ItemLoader.spawnRing(id, pos.x, pos.y);
            case ItemCategory.CHARM: return ItemLoader.spawnCharm(id, pos.x, pos.y);
            default: return null;
        }
    }

    /**
     * CE Items.c:740-752：生成后扣减。对**每一件**生成物跑全表：
     * category/kind 双匹配的条目 frequency -= decrementFrequency、numberSpawned++。
     * 占位条目（decrement=0）同样 numberSpawned++（CE 无 increment 门）。
     * 配对锚点：table[j] ↔ meteredItems[j] 一一对应；任何"按目录序 +14 之类的
     * 换算"都会错位（反向验证②的打击面）。
     */
    private decrementMeteredForSpawn(category: ItemCategory, kindId: string | undefined): void {
        const ceCat = category === ItemCategory.SCROLL ? 'SCROLL'
            : category === ItemCategory.POTION ? 'POTION' : null;
        if (!ceCat || !kindId) return;
        const table = ItemLoader.CE_METERED_ITEMS_TABLE;
        for (let j = 0; j < table.length; j++) {
            const e = table[j]!;
            if (e.category === ceCat && e.webId === kindId) {
                this.meteredItems[j]!.frequency -= e.decrementFrequency;
                this.meteredItems[j]!.numberSpawned++;
            }
        }
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
    private spawnBlueprintItem(category: string, id: string | undefined, x: number, y: number, depth: number,
        qualifiers?: readonly string[], previous: readonly Item[] = []): Item | null {
        const generate = () => this.rollBlueprintItem(category, id, x, y, depth);
        // Standalone/DF requests use generateItem; only machine creation applies Q.
        return qualifiers === undefined ? generate() : generateQualifiedMachineItem(generate, qualifiers, previous);
    }

    private rollBlueprintItem(category: string, id: string | undefined, x: number, y: number, depth: number): Item | null {
        // V-1a：多类别掩码（CE machineFeature.itemCategory 是位掩码，如神祠
        // "Shrine -- safe haven…" 的 (POTION|SCROLL|WEAPON|ARMOR|RING)，
        // GlobalsBrogue.c:561-565）。blueprints.json 以 '|' 连接的字符串转录。
        // CE 消费端是**两段抽取**（Architect.c:1504 generateItem(掩码, -1) →
        // makeItemInto Items.c:171-179）：先 pickItemCategory(掩码)（Items.c:85-107：
        // 按 13 槽定序、itemGenerationProbabilities_Brogue 类别加权选出一个类别），
        // 再在选中类别内 chooseKind 基表频率选 kind——不是把五类合成一张池子
        // 单次加权。单类别和显式 kind 同样先抽类别（CE 无提前返回）。
        if (category) {
            const maskSet = new Set(category.split('|').map(s => s.trim()).filter(s => s.length > 0));
            // CE_ITEM_GENERATION_PROBABILITIES 即 CE 13 槽走表序
            // （GOLD,SCROLL,POTION,STAFF,WAND,WEAPON,ARMOR,FOOD,RING,CHARM,AMULET,GEM,KEY；
            // web 省略权重 0 的 GEM——B-4b 已登记行为等价）。掩码不含 GOLD，无需特例。
            const slots = ItemLoader.CE_ITEM_GENERATION_PROBABILITIES.filter(s => maskSet.has(ItemCategory[s.category]));
            let sum = 0;
            for (const s of slots) sum += s.weight;
            // CE sum==0 时原样返回掩码、makeItemInto 落 default 报错——web 掩码
            // 只含常规类别（各带正权重），此分支仅作防御，与 CE 的 fail 行为同向。
            if (sum <= 0 && category.includes('|')) return null;
            let roll = sum > 0 ? rng.randRange(1, sum) : 0;
            for (const s of slots) {
                if (sum > 0 && roll <= s.weight) {
                    category = ItemCategory[s.category];
                    break;
                }
                roll -= s.weight;
            }
        }

        if (id) {
            // Specific item
            if (category === 'WEAPON') return ItemLoader.spawnWeapon(id, x, y, depth);
            if (category === 'ARMOR') return ItemLoader.spawnArmor(id, x, y, depth);
            if (category === 'SCROLL') return ItemLoader.spawnScroll(id, x, y);
            if (category === 'POTION') return ItemLoader.spawnPotion(id, x, y);
            if (category === 'KEY') return ItemLoader.spawnKey(id, x, y);
            if (category === 'STAFF') return ItemLoader.spawnStaff(id, x, y);
            if (category === 'WAND') return ItemLoader.spawnWand(id, x, y);
            if (category === 'RING') return ItemLoader.spawnMachineRing(id, x, y);
            if (category === 'CHARM') return ItemLoader.spawnMachineCharm(id, x, y);
            if (category === 'AMULET') return ItemLoader.spawnAmulet(id, x, y);
            return null;
        }

        // Resolve by category.
        // P1-53（T-1）：无 id 分支改走 chooseKind 基表频率加权（CE 的蓝图/feature
        // 类别物品路径：Architect.c:1504 generateItem(feature->itemCategory,
        // feature->itemKind) → makeItemInto（Items.c:171）itemKind<0 →
        // chooseKind（Items.c:409-420））。两处 CE 语义要点：
        //   1. **无深度门**——CE 的物品种类抽取不存在深度过滤（makeItemInto 直用
        //      全表），web 原 SCROLL/POTION/WEAPON/ARMOR 分支同样无过滤，故此处
        //      直接对全表加权，不是「先过滤再加权」；
        //   2. **用基表频率、不带计量覆盖**——CE 的计量频率只在 populateItems
        //      内部写回工作表且有 memcpy 备份/还原（Items.c:569-580），蓝图机器
        //      在 digDungeon 期先于 populateItems，见到的是基表。因此 enchanting
        //      / life / strength（基频 0）从本路径**永不被抽中**（等概率时代
        //      它们照常出现，是 B-4b 登记的附魔卷轴超标主因）。
        switch (category) {
            case 'SCROLL': {
                const scrolls = ItemLoader.genScrolls;
                if (scrolls.length > 0) {
                    const pick = ItemLoader.chooseKind(scrolls.map(s => s.frequency ?? 0));
                    return ItemLoader.spawnScroll(scrolls[pick]!.id, x, y);
                }
                return null;
            }
            case 'POTION': {
                // D2（B-4a 更正口径）：creeping_death 是 CE 原生 POTION_LICHEN
                // （GlobalsBrogue.c:681），但 web 效果为 stub 且 DF_LICHEN_PLANTED
                // 缺载体——真实理由与回池条件见 D2_EXCLUDED_POTIONS 处注释。
                // （登记偏差：CE 的 lichen 基频 7 参与加权；web 先剔除再在剩余
                // 池内归一化。）
                const potions = ItemLoader.genPotions.filter(
                    (p) => !D2_EXCLUDED_POTIONS.has(p.id)
                );
                if (potions.length > 0) {
                    const pick = ItemLoader.chooseKind(potions.map(p => p.frequency ?? 0));
                    return ItemLoader.spawnPotion(potions[pick]!.id, x, y);
                }
                return null;
            }
            case 'WEAPON': {
                const weapons = ItemLoader.genWeapons;
                if (weapons.length > 0) {
                    const pick = ItemLoader.chooseKind(weapons.map(w => w.frequency ?? 0));
                    return ItemLoader.spawnWeapon(weapons[pick]!.id, x, y, depth);
                }
                return null;
            }
            case 'ARMOR': {
                const armors = ItemLoader.genArmors;
                if (armors.length > 0) {
                    const pick = ItemLoader.chooseKind(armors.map(a => a.frequency ?? 0));
                    return ItemLoader.spawnArmor(armors[pick]!.id, x, y, depth);
                }
                return null;
            }
            case 'STAFF': {
                const pool = ItemLoader.genStaffs;
                if (!pool.length) return null;
                const pick = ItemLoader.chooseKind(pool.map(s => s.frequency ?? 0));
                return ItemLoader.spawnStaff(pool[pick]!.id, x, y);
            }
            case 'WAND': {
                const pool = ItemLoader.genWands;
                if (!pool.length) return null;
                const pick = ItemLoader.chooseKind(pool.map(w => w.frequency ?? 0));
                return ItemLoader.spawnWand(pool[pick]!.id, x, y);
            }
            case 'RING': {
                // V-1a：掩码路径的第五类。与上方四支同构：chooseKind 基表加权
                // （CE 环之戒全 8 种基频 1，web 现有 6 种亦全为 1——light/reaping
                // 目录缺口登记不补）。CE 环生成无深度门（makeItemInto 直用全表）。
                const rings = ItemLoader.genRings;
                if (rings.length > 0) {
                    const pick = ItemLoader.chooseKind(rings.map(r => r.frequency ?? 0));
                    return ItemLoader.spawnMachineRing(rings[pick]!.id, x, y);
                }
                return null;
            }
            case 'CHARM': {
                const charms = ItemLoader.genCharms;
                if (!charms.length) return null;
                const pick = ItemLoader.chooseKind(charms.map(c => c.frequency ?? 0));
                return ItemLoader.spawnMachineCharm(charms[pick]!.id, x, y);
            }
            case 'AMULET':
                // CE Items.c:379: sole kind 0, identified, no kind/quality roll.
                // CE15 uses AMULET/-1 through the same deferred machine path.
                return ItemLoader.spawnAmulet('amulet_of_yendor', x, y);
            case 'KEY':
                // B-4b：钥匙由锁具驱动（数量 == 锁数，见 machineResults 循环），
                // 类别级 KEY feature 不再发无绑定钥匙。显式指定 id 的 KEY 物品
                // （下方 id 分支）保留给未来的任务钥匙类蓝图——当前无调用者。
                return null;
            default:
                return null;
        }
    }

    /** CE buildAMachine creates entities inside the feature loop. The ledger is
     * shared across recursive machines; abort deletes all creations since the
     * checkpoint without restoring RNG or resurrecting quietly replaced monsters. */
    private createMachineRuntime(depth: number): MachineEntityRuntime {
        const created: Monster[] = [];
        const items = new Map<string | MachineItemSpawn, Item>();
        const remove = (mon: Monster): void => {
            this.demoteMonsterFromLeadership(mon);
            this.monsters = this.monsters.filter(m => m !== mon);
            this.dormantMonsters = this.dormantMonsters.filter(m => m !== mon);
            this.visibleMonsters.delete(mon);
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
                    item = this.spawnBlueprintItem(spawn.category, spawn.id, spawn.pos.x, spawn.pos.y,
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
                // Eligibility and adopted-item reachability remain BlueprintEngine's contract.
                this.items = this.items.filter(i => i !== item);
                if (place) this.items.push(item);
                return item;
            },
            handOff: (spawn, item) => {
                const bearer = spawn.entities?.[0];
                if (!bearer || !item.entity) throw new Error('Machine item has no realized bearer');
                this.items = this.items.filter(i => i !== item.entity);
                bearer.carriedItem = item.entity;
                item.entity.loc = {...bearer.loc};
            },
            checkpoint: () => {
                const start = created.length;
                const previous = new Map(items);
                const floor = new Set(this.items);
                const carriers = new Map([...this.monsters, ...this.dormantMonsters].map(m => [m, m.carriedItem]));
                const borrowed = [...items.values()].map(item => ({item, loc: {...item.loc},
                    keyLoc: item.keyLoc?.map(k => ({...k, loc: {...k.loc}})), flags: item.flags ? [...item.flags] : undefined,
                    originDepth: item.originDepth, maxChargesKnown: item.maxChargesKnown}));
                return () => {
                    const discarded = new Set([...items].filter(([id]) => !previous.has(id)).map(([, item]) => item));
                    this.items = this.items.filter(item => !discarded.has(item) && (!itemsHas(item) || floor.has(item)));
                    for (const mon of [...this.monsters, ...this.dormantMonsters]) {
                        if (mon.carriedItem && (discarded.has(mon.carriedItem) || borrowed.some(b => b.item === mon.carriedItem))) mon.carriedItem = null;
                    }
                    for (const item of floor) if (itemsHas(item) && !this.items.includes(item)) this.items.push(item);
                    for (const state of borrowed) Object.assign(state.item, {loc: state.loc, keyLoc: state.keyLoc,
                        flags: state.flags, originDepth: state.originDepth, maxChargesKnown: state.maxChargesKnown});
                    items.clear(); for (const [id, item] of previous) items.set(id, item);
                    for (const mon of created.splice(start)) remove(mon);
                    for (const [mon, item] of carriers) if (mon.hp > 0 && (this.monsters.includes(mon) || this.dormantMonsters.includes(mon))) mon.carriedItem = item;
                    for (let x = 0; x < this.grid.width; x++) for (let y = 0; y < this.grid.height; y++) this.grid.getCell(x, y)!.hasDormantMonster = false;
                    for (const mon of this.dormantMonsters) this.grid.getCell(mon.x, mon.y)!.hasDormantMonster = true;
                };
            },
            hasItem: (x, y) => this.items.some(i => i.x === x && i.y === y),
            hasMonster: (x, y) => this.monsters.some(m => m.hp > 0 && m.x === x && m.y === y),
            spawn: (spawn, machineNumber) => {
                const made: Monster[] = [];
                // Both CE spawnHorde and the explicit monsterID branch quietly
                // replace an occupant. Do not run combat/death-drop callbacks.
                const old = this.monsters.find(m => m.hp > 0 && m.x === spawn.pos.x && m.y === spawn.pos.y);
                if (spawn.hordeFlags) {
                    this.spawnHordeAtFeature(spawn, depth, machineNumber, made);
                    if (made.length && old) remove(old);
                } else if (spawn.monsterId) {
                    if (old) remove(old);
                    const data = this.resolveBlueprintMonster(spawn.monsterId, depth);
                    if (data) {
                        const mon = new Monster(spawn.pos.x, spawn.pos.y, data);
                        if (spawn.isAlly) mon.isAlly = true;
                        if (spawn.isCaged) mon.isCaged = true;
                        this.applyRandomMutation(mon, depth);
                        this.monsters.push(mon);
                        this.finalizeBlueprintMonster(mon, spawn, machineNumber);
                        made.push(mon);
                    }
                }
                created.push(...made);
                return made;
            },
        };
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

    private generateDepth(isGoingUp: boolean = false, isFirstLevel: boolean = false, fell: boolean = false) {
        const exit = { ...this.player.loc };
        const level = this.levelSeeds[this.depth - 1];
        if (!level) throw new RangeError('Missing level seed');
        if (level.visited && this.currentLevelDepth !== this.depth && !this.levels.has(this.depth) && this.mode !== 'test') {
            // A visited map must have its real world payload, never regenerate it.
            throw new Error('Visited level state is unavailable');
        }
        rng.setRNG(RNGType.RNG_SUBSTANTIVE);
        if (this.mode === 'test') {
            this.generateTestDepth(isFirstLevel);
            level.visited = true;
            this.currentLevelDepth = this.depth;
            // P4-10：test 层同样建 waypoint（CE RogueMain.c:707 的位置——
            // 该层的全部生成决策已完成之后）。
            this.rebuildWaypoints();
            this.updateVision(); // C-7：CE updateVision 全链（原 computeFOV(10) 代理退役）
            this.onRenderRequested?.();
            return;
        }

        if (this.currentLevelDepth !== null && this.currentLevelDepth !== this.depth) {
            if (fell) this.currentLevelExitedVia = { ...exit };
            scheduleLevelFollowers(this.grid, this.monsters, exit, fell ? 0 : isGoingUp ? -1 : 1);
        }
        // The active layer is already visited even before it has a detached cache entry.
        // Track its real depth; test harnesses can jump depths or re-enter the current map.
        if (this.grid && this.currentLevelDepth !== null) {
            setDormantAwakener(this.grid, null);
            setAllyResurrector(this.grid, null);
            setDungeonFeatureEffects(this.grid, null);
            this.levels.set(this.currentLevelDepth, {
                grid: this.grid,
                environment: this.environment,
                fov: this.fov,
                lightMap: this.lightMap,
                monsters: this.monsters,
                dormantMonsters: this.dormantMonsters,
                items: this.items,
                visibleMonsters: this.visibleMonsters,
                visibleItems: this.visibleItems,
                machineCells: this.machineCells,
                scent: this.scent,
                waypoints: this.waypoints,
                awaySince: this.currentLevelDepth === this.depth ? this.currentLevelAwaySince : this.absoluteTurnNumber,
                playerExitedVia: { ...this.currentLevelExitedVia },
                pendingCaughtFireCells: this.pendingCaughtFireCells,
            });
        }
        const scentTurnNumber = this.scent.turnNumber;
        const cached = this.levels.get(this.depth);

        if (cached) {
            // Restore from cache
            this.grid = cached.grid;
            this.scent = cached.scent ?? new ScentMap(DCOLS, DROWS);
            this.scent.turnNumber = scentTurnNumber;
            this.waypoints = cached.waypoints ?? new WaypointSystem();
            this.currentLevelAwaySince = cached.awaySince ?? 0;
            this.currentLevelExitedVia = { ...(cached.playerExitedVia ?? { x: 0, y: 0 }) };
            this.pendingCaughtFireCells = cached.pendingCaughtFireCells ?? [];
            this.environment = cached.environment;
            this.fov = cached.fov;
            this.lightMap = cached.lightMap;
            this.activeFlares = []; this.terrainFlashes = []; this.flareLightMap = null; this.flareElapsedMs = 0;
            this.monsters = cached.monsters;
            this.dormantMonsters = cached.dormantMonsters ?? [];
            this.items = cached.items;
            this.visibleMonsters = cached.visibleMonsters;
            this.visibleItems = cached.visibleItems;
            this.machineCells = collectMachineCells(this.grid);
            this.bindDormantAwakener();

            this.rebuildWaypoints(); // Revisit: live stream, no level reseeding.
        } else {
            // CE startLevel: draw a nonzero return seed, then initialize BOTH streams.
            let oldSeed: bigint;
            do { oldSeed = rng.rand64bits(); } while (oldSeed === 0n);
            rng.seedRandomGenerator(level.levelSeed);
            try {
                // 1. Generate new level
                this.stats.maxDepth = Math.max(this.stats.maxDepth, this.depth);
                // CE RogueMain.startLevel: dig -> placeStairs, at most 50 attempts
                // within this same level RNG stream. Failed geometry is discarded.
                this.monsters = [];
                this.items = [];
                this.dormantMonsters = [];
                let architect!: Architect;
                let stairsPlaced = false;
                for (let attempt = 0; attempt < 50; attempt++) {
                    this.monsters = [];
                    this.dormantMonsters = [];
                    this.items = [];
                    this.grid = new Grid(DCOLS, DROWS);
                    this.player.loc = {x: 0, y: 0}; // CE removes the player during digDungeon.
                    this.pendingCaughtFireCells = [];
                    this.bindDormantAwakener(); // Later machine DFs see already-created entities.
                    architect = new Architect(this.grid, this.createMachineRuntime(this.depth));
                    this.grid = architect.generateLevel(this.depth);
                    if (this.placeStairs(architect.machineResults)) {
                        stairsPlaced = true;
                        break;
                    }
                }
                if (!stairsPlaced) throw new Error(`Failed to place stairs at depth ${this.depth} after 50 attempts`);
                this.environment = new EnvironmentManager(this.grid);
                this.fov = new FOVSys(this.grid);
                this.lightMap = new LightMap(this.grid);
                this.activeFlares = []; this.terrainFlashes = []; this.flareLightMap = null; this.flareElapsedMs = 0;
                this.scent = new ScentMap(DCOLS, DROWS);
                this.scent.turnNumber = scentTurnNumber;
                this.currentLevelAwaySince = 0;
                this.currentLevelExitedVia = { x: 0, y: 0 };
                this.pendingCaughtFireCells = [];
                this.waypoints = new WaypointSystem();

                // Machine entities already occupy the successfully generated level.
                this.visibleMonsters = new Set();
                this.visibleItems = new Set();

                // 2. Populate the successfully stair-equipped level with monsters and items
                // （B-4b：architect.machines 不再传入——legacy machines 循环已删；
                //  V-2b-1：architect.trapVaults/cages 不再传入——两数组及其消费
                //  循环均为死代码，已删除）
                this.populateLevel(
                    this.depth, isGoingUp, isFirstLevel,
                    architect.machineResults
                );

                // CE initializeLevel restores fallen items before monsters, in the level RNG stream.
                this.restoreFallenItems();

                // C-5：取走坠到本层的怪物幸存者（CE startLevel "Load up next
                // level's monsters and items, since one might have fallen from
                // above"——RogueMain.c:673-676；重定位= restoreMonster 的
                // MB_PREPLACED 分支，Architect.c:3537-3550）。CE 用
                // getQualifyingPathLocNear，web 复用 P1-31 的同口径端口。
                const fallen = this.pendingFallenByDepth.get(this.depth);
                if (fallen && fallen.length > 0) {
                    this.pendingFallenByDepth.delete(this.depth);
                    for (const m of fallen) {
                        const spot = this.findQualifyingPathLocNear(m.loc);
                        if (spot) {
                            m.loc.x = spot.x;
                            m.loc.y = spot.y;
                        }
                        m.preplaced = false; // CE :3548 清 MB_PREPLACED
                        this.monsters.push(m);
                    }
                }
                this.rebuildWaypoints(); // CE: inside the new level stream, before oldSeed.
                level.visited = true;
            } finally {
                // Generation borrows the off-map position; environment catch-up
                // owns its own borrow, and level entry owns the final placement.
                this.player.loc = { ...exit };
                // This is reseeding from oldSeed, not restoring the pre-entry state tuple.
                rng.seedRandomGenerator(oldSeed);
            }
        }

        if (cached) this.restoreFallenItems();

        // No active-floor alias while environmental falls modify ownership.
        this.levels.delete(this.depth);
        for (let x = 0; x < this.grid.width; x++) for (let y = 0; y < this.grid.height; y++) {
            this.grid.getCell(x, y)!.isVisible = false;
        }
        this.catchUpEnvironment(cached ? Math.max(0, this.absoluteTurnNumber - (cached.awaySince ?? 0)) : 50);
        if (fell) this.placePlayerOnFallLanding(exit.x, exit.y);
        else {
            const entry = this.levelStair(isGoingUp ? TerrainType.STAIRS_DOWN : TerrainType.STAIRS_UP);
            if (entry) this.placePlayerOnLevelEntry(entry);
        }
        this.restoreLevelResidents();
        this.currentLevelDepth = this.depth;
        // Active ownership is never duplicated by a stale cached array.
        this.levels.delete(this.depth);
        this.updatedSafetyMapThisTurn = false;
        // Pure derived topology; waypoint draws belong to the branches above.
        this.loopMap = analyzeLoopMap(this.grid);

        // 3. Force full refresh
        // C-7：CE RogueMain.c:671 进层时 updateColors + updateRingBonuses
        // （级联 updateMinersLightRadius）+ updateVision 的对应位置——
        // updateVision 内部先重算矿灯半径再做光照/可见性。
        this.needsRender = true;
        this.updateVision();
        this.onRenderRequested?.();
    }

    private levelStair(type: TerrainType): Pos | null {
        for (let x = 0; x < this.grid.width; x++) for (let y = 0; y < this.grid.height; y++) {
            if (this.grid.getCell(x, y)!.layers.includes(type)) return { x, y };
        }
        return null;
    }

    /** CE Architect.restoreMonster; JSON decoding never invokes this lifecycle. */
    private restoreLevelResident(m: Monster, map?: number[][]): void {
        if (m.entersLevelIn > 0) {
            if (map) restoreTravelPosition(this.grid, m, map);
            m.preplaced = true;
        }
        const cell = this.grid.getCell(m.x, m.y);
        if (m.preplaced || (m.x === this.player.x && m.y === this.player.y)
            || cell?.layers.includes(TerrainType.STAIRS_UP) || cell?.layers.includes(TerrainType.STAIRS_DOWN) || cell?.layers.includes(TerrainType.DUNGEON_PORTAL)) {
            const spot = travelPlacement(this, m, m.loc, true, true, true);
            if (spot) m.loc = spot;
        }
        m.preplaced = false;
        m.entersLevelIn = m.approaching = 0;
        m.isAbsorbing = false;
        m.corpseAbsorptionCounter = 0;
        // CE MB_FOLLOWER: a real level entry retires an absent monster leader.
        // This does not run during JSON decoding, which preserves the whole graph.
        if (m.leader && !this.monsters.includes(m.leader)) m.leader = null;
    }

    private restoreLevelResidents(): void {
        const stairs = travelDistanceMap(this.grid, this.monsters, this.player.loc, T_PATHING_BLOCKER);
        const pit = travelDistanceMap(this.grid, this.monsters, this.currentLevelExitedVia, T_PATHING_BLOCKER);
        for (const m of this.monsters) {
            if (m.hp <= 0) continue;
            this.restoreLevelResident(m, m.approaching & APPROACHING_PIT ? pit : stairs);
        }
    }

    /** CE Time.monstersApproachStairs: visited adjacent floors only, once per
     * objective block, never during environment catch-up or JSON restoration. */
    private monstersApproachStairs(): void {
        for (const depth of [this.depth - 1, this.depth + 1]) {
            const level = this.levels.get(depth);
            if (!level || !this.levelSeeds[depth - 1]?.visited) continue;
            for (const m of [...level.monsters]) {
                if (m.hp <= 0) continue;
                if (m.entersLevelIn > 1) m.entersLevelIn--;
                else if (m.entersLevelIn === 1) this.monsterEntersLevel(m, level);
            }
        }
    }

    private monsterEntersLevel(m: Monster, source: LevelState): void {
        const pit = !(m.approaching & (APPROACHING_DOWNSTAIRS | APPROACHING_UPSTAIRS));
        const origin = pit ? source.playerExitedVia : this.levelStair(m.approaching & APPROACHING_DOWNSTAIRS
            ? TerrainType.STAIRS_UP : TerrainType.STAIRS_DOWN);
        if (!origin) throw new Error('Missing level travel exit');
        m.loc = { ...origin };
        m.clearCorpseTargetOnLevelChange();
        if (!pit) {
            const spot = travelPlacement(this, m, m.loc, false, false, false);
            if (spot) m.loc = spot;
            const occupant = [this.player, ...this.monsters].find(c => c.hp > 0 && c.x === m.x && c.y === m.y);
            if (occupant) {
                const displaced = travelPlacement(this, occupant, m.loc, true, false, false, true);
                if (displaced) occupant.loc = displaced;
            }
        }
        source.monsters.splice(source.monsters.indexOf(m), 1);
        source.visibleMonsters.delete(m);
        this.monsters.unshift(m);
        m.entersLevelIn = 0;
        m.preplaced = true;
        m.falling = false;
        this.restoreLevelResident(m);
        m.ticksUntilTurn = m.movementSpeed;
        if (pit && !m.hasStatus('levitating')) {
            const damage = rng.randClumpedRange(6, 12, 2);
            if (!m.isInvulnerable()) {
                m.interruptCorpseAbsorption(damage);
                m.hp -= m.absorbShieldDamage(damage);
                if (m.hp <= 0) (m as unknown as { die(): void }).die();
            }
        }
        this.needsRender = true;
    }

    /** CE placeStairs: closest qualifying wall ring, then no-liquid fallback.
     * Deferred machine products only reserve their positions; U19c ordering stays separate. */
    private placeStairs(machineResults: MachineResult[] = []): boolean {
        const level = this.levelSeeds[this.depth - 1]!;
        const occupied = new Set([
            ...machineResults.flatMap(m => [...m.itemSpawns.filter(s => !s.entity),
                ...m.monsterSpawns.filter(s => !s.entities)]).map(s => s.pos),
            ...this.items.map(i => i.loc), ...this.monsters.map(m => m.loc), ...this.dormantMonsters.map(m => m.loc),
        ].map(p => p.y * this.grid.width + p.x));
        const candidates = stairCandidates(this.grid, occupied);
        const choose = (target: Pos): Pos | null => {
            const preferred = qualifyingNear(this.grid, target, (x, y) => candidates.has(y * this.grid.width + x));
            if (preferred) {
                Architect.prepareStairLoc(this.grid, preferred);
                clearStairVicinity(this.grid, preferred, candidates);
                return preferred;
            }
            return qualifyingNear(this.grid, target, (x, y) => stairFallbackQualifies(this.grid, x, y, occupied));
        };
        if (this.depth <= CE_DEEPEST_LEVEL) {
            const down = choose(level.downStairsLoc);
            if (!down) return false;
            Architect.installStair(this.grid, down, this.depth === CE_DEEPEST_LEVEL ? TerrainType.DUNGEON_PORTAL : TerrainType.STAIRS_DOWN);
            occupied.add(down.y * this.grid.width + down.x);
            level.downStairsLoc = down;
            if (!this.levelSeeds[this.depth]!.visited) this.levelSeeds[this.depth]!.upStairsLoc = { ...down };
        }
        const up = choose(level.upStairsLoc);
        if (!up) return false;
        Architect.installStair(this.grid, up, TerrainType.STAIRS_UP);
        level.upStairsLoc = up;
        return true;
    }

    private populateLevel(
        depth: number,
        _isGoingUp: boolean = false,
        _isFirstLevel: boolean = false,
        machineResults: MachineResult[] = []
    ) {
        // U04c/K31: CE membership is the final per-cell machine flag, including
        // external features and excluding cleared BP_NO_INTERIOR_FLAG cells.
        this.machineCells = collectMachineCells(this.grid);

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
        const generationOrigin = this.levelSeeds[depth - 1]!.upStairsLoc;
        for (let x = 1; x < DCOLS - 1; x++) {
            for (let y = 1; y < DROWS - 1; y++) {
                const cell = this.grid.getCell(x, y);
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
        const stairsUpPos = this.levelSeeds[depth - 1]!.upStairsLoc;
        const stairsDownPos = this.depth <= CE_DEEPEST_LEVEL ? this.levelSeeds[depth - 1]!.downStairsLoc : null;
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
            this.grid,
            stairsUpPos ?? { x: this.player.loc.x, y: this.player.loc.y },
            { machineCells: this.machineCells }
        );
        // 失败保护改墙后，牌堆里可能残留已变 WALL 的格——清出去，
        // 保证钥匙/护符/怪群领袖后续从牌堆取格仍然全部可站立。
        for (let i = floorTiles.length - 1; i >= 0; i--) {
            const t = floorTiles[i]!;
            const c = this.grid.getCell(t.x, t.y);
            if (!c || !c.isPassable) floorTiles.splice(i, 1);
        }

        // Spawn Amulet of Yendor on bottom floor
        // U18a-2：物品旁路只筛自己的候选，不改楼梯/horde 共用牌堆的资格。
        const amuletTiles = this.depth === 26 ? floorTiles.filter(p =>
            !(cellTerrainFlags(this.grid, p.x, p.y) & (T_OBSTRUCTS_ITEMS | T_PATHING_BLOCKER))) : [];
        if (this.depth === 26 && amuletTiles.length > 0) {
            const hasAmuletInWorld = this.items.some(i => i.category === ItemCategory.AMULET && (i as any).identityId === 'amulet_of_yendor');
            const hasAmuletInInv = this.player.inventory.items.some(i => i.category === ItemCategory.AMULET && (i as any).identityId === 'amulet_of_yendor');
            if (!hasAmuletInWorld && !hasAmuletInInv) {
                const amuletPosIdx = rng.randRange(0, amuletTiles.length - 1);
                const amuletPos = amuletTiles[amuletPosIdx]!;
                const amulet = ItemLoader.spawnAmulet('amulet_of_yendor', amuletPos.x, amuletPos.y);
                if (amulet) {
                    this.items.push(amulet);
                    floorTiles.splice(floorTiles.indexOf(amuletPos), 1);
                }
            }
        }

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
        // P1-43/P1-20 的落格可通行性判据（isPathingBlocker）对 itemSpawns
        // 路径仍生效（见下方消费点），判据不因本删除而松动。

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
                item = this.spawnBlueprintItem(spawn.category, spawn.id, pos.x, pos.y, depth,
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
                trace.seed = this.currentSeed;
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
                    if (!(cellTerrainFlags(this.grid, p.x, p.y) & (T_OBSTRUCTS_ITEMS | T_PATHING_BLOCKER))) break;
                    keyIndex--;
                }
                const keyPos = keyIndex >= 0 ? floorTiles.splice(keyIndex, 1)[0]! : null;
                const key = keyPos ? ItemLoader.spawnKey('iron_key', keyPos.x, keyPos.y) : null;
                if (key) {
                    key.keyLoc = [{ loc: { x: mr.door.x, y: mr.door.y }, machine: mr.machineNumber, disposableHere: true }];
                    key.originDepth = depth;
                    this.items.push(key);
                }
            }

            // Spawn items
            for (const spawn of mr.itemSpawns) {
                if (spawn.entity) {
                    if (trace && this.items.includes(spawn.entity)) recordItem!(trace, mr, spawn, spawn.entity, 'floor');
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
                // P1-43：蓝图特征落点可能选中护城河的岩浆格（key_lava_moat 一类），
                // 物品于是掉进岩浆——实测 seed777/D7 scroll_of_enchantment
                // @ (26,12) terrain=LAVA。CE 的物品落位一律回避
                // `T_OBSTRUCTS_ITEMS | T_PATHING_BLOCKER`，岩浆的
                // T_LAVA_INSTA_DEATH 正在后者里（`Rogue.h:1948`）。
                // 这里是消费点兜底（一处覆盖全部蓝图物品）；**根治应在
                // BlueprintEngine 的特征选址**——见路线图 P1-43，
                // 那样机器不会因此静默少一件宝物。
                const spawnCell = this.grid.getCell(spawn.pos.x, spawn.pos.y);
                // 验收方 2026-09-17 修正判据（S-1 的改造哨兵抓到的真阳性）：
                // P1-43 当初我写的是硬编码 `terrain === LAVA`，**口径太窄**——
                // C-6 的地图上产物落到了 `INERT_BRIMSTONE`（自燃硫矿）格。
                // CE 的物品落位判据是 `T_OBSTRUCTS_ITEMS | T_PATHING_BLOCKER`
                // （`Rogue.h:1948` 的并集含 T_SPONTANEOUSLY_IGNITES / T_LAVA_INSTA_DEATH /
                // T_AUTO_DESCENT / T_IS_DEEP_WATER…），而 C-4a 早就把它做成了
                // `isPathingBlocker`——我当时没用它，这正是"统一判据"要防的事。
                if (!spawnCell || isPathingBlocker(spawnCell.terrain)) {
                    if (trace) trace.products.push({ kind: 'item', featureIndex: spawn.placementFeatureIndex ?? spawn.sourceFeatureIndex ?? null,
                        pos: { ...spawn.pos }, outcome: 'destination blocked' });
                    continue;
                }
                const item = materialize(spawn, spawn.pos);
                if (item) {
                    this.items.push(item);
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
                        product.owner = this.dormantMonsters.includes(mon) ? 'dormant' : this.monsters.includes(mon) ? 'floor' : undefined;
                        if (!product.owner) product.outcome = 'removed during construction';
                    }
                    const leader = spawn.entities[0];
                    if (leader && (this.monsters.includes(leader) || this.dormantMonsters.includes(leader))) handOff(leader, spawn, mr);
                    continue;
                }
                // V-2b-5（CE Architect.c:1591-1599）：MF_GENERATE_HORDE 指令——
                // 按 horde 表成群生成（CE 在 spawnHorde 内部抽 horde 与核地形，
                // 落点即 feature 落点）。
                if (spawn.hordeFlags) {
                    const beforeIds = trace ? new Set([...this.monsters, ...this.dormantMonsters].map(m => m.id)) : null;
                    const leader = this.spawnHordeAtFeature(spawn, depth, mr.machineNumber);
                    if (leader) handOff(leader, spawn, mr);
                    if (trace && beforeIds) for (const mon of [...this.monsters, ...this.dormantMonsters]) {
                        if (beforeIds.has(mon.id)) continue;
                        trace.products.push({ kind: 'monster', featureIndex: spawn.sourceFeatureIndex ?? null,
                            instanceId: mon.id, name: mon.name, pos: { ...mon.loc },
                            owner: mon.isDormant ? 'dormant' : 'floor' });
                    }
                    continue;
                }
                if (!spawn.monsterId) continue;
                const mData = this.resolveBlueprintMonster(spawn.monsterId, depth);
                if (mData) {
                    const mon = new Monster(spawn.pos.x, spawn.pos.y, mData);
                    if (spawn.isAlly) mon.isAlly = true;
                    if (spawn.isCaged) mon.isCaged = true;
                    handOff(mon, spawn, mr);
                    this.applyRandomMutation(mon, depth);
                    this.monsters.push(mon);
                    this.finalizeBlueprintMonster(mon, spawn, mr.machineNumber);
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
                    const cell = this.grid.getCell(pos.x, pos.y)!;
                    if (this.hordeFitsTerrain(cand, pos)
                        && cell.layers[DungeonLayer.DUNGEON] === TerrainType.FLOOR
                        && cell.layers[DungeonLayer.LIQUID] === TerrainType.NOTHING
                        && !(cellTerrainFlags(this.grid, pos.x, pos.y) & T_OBSTRUCTS_ITEMS)
                        && !this.getMonsterAt(pos.x, pos.y)
                        && !this.dormantMonsters.some(m => m.hp > 0 && m.x === pos.x && m.y === pos.y)
                        && !this.items.some(item => item.x === pos.x && item.y === pos.y)) {
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

        // ── B-4b：CE Items.c:565-608 populateItems 的数量与调度半边 ──────────
        // 每层物品数 = 3 + 无上界几何分布（60% 反复 +1）+ 深度加成。
        // （旧实现 randRange(3,6) 是均匀分布、有上界，分布形状与 CE 不同。）
        let numItems = 3;
        while (rng.randPercent(60)) numItems++;
        if (this.depth <= 2) {
            numItems += 2; // CE: "4 extra items to kickstart your career as a rogue"
        } else if (this.depth <= 4) {
            numItems++;
        }
        // CE Items.c:582：numberOfItems += gameConst->extraItemsPerLevel。
        // Brogue 变体该值为 0（GlobalsBrogue.c:1032，逐字核对）。
        // CE Items.c:570-572：depthLevel > amuletLevel 时走 lumenstone 分支
        //（numberOfItems = lumenstoneDistribution[...], numberOfGoldPiles = 0）。
        // web 无流明石系统且 DEEPEST_LEVEL == AMULET_LEVEL == 26，分支结构性
        // 不可达——照抄留形：激活流明石时需补 lumenstoneDistribution 表
        //（GlobalsBrogue.c:105：{3,3,3,2,2,2,2,2,1,1,1,1,1,1}）并重核 CE。

        // CE Items.c:590-596：金币堆数 = min(5, depth*depthAccelerator/4)，
        // 然后 60% 起每轮递减 15 的奖励循环（60→45→30→15→0），上限 10。
        // depthAccelerator = 1（GlobalsBrogue.c:1019）。
        let numGoldPiles = Math.min(5, Math.floor(this.depth * 1 / 4));
        for (let goldBonusProbability = 60;
             rng.randPercent(goldBonusProbability) && numGoldPiles <= 10;
             goldBonusProbability -= 15) {
            numGoldPiles++;
        }
        // CE Items.c:597-608：产量调度——past goldAdjustmentStartDepth（=6，
        // GlobalsBrogue.c:1033）后按上一深度为止的 goldGenerated 与
        // POW_GOLD[d] ± 320d/420d 比较，堆数 ±2；d = depth*accelerator - 1。
        if (this.depth >= 6) {
            const d = this.depth * 1 - 1;
            if (this.goldGenerated < ItemLoader.aggregateGoldLowerBound(d)) {
                numGoldPiles += 2;
            } else if (this.goldGenerated > ItemLoader.aggregateGoldUpperBound(d)) {
                numGoldPiles -= 2;
            }
        }
        if (numGoldPiles < 0) numGoldPiles = 0;

        // 热力图已在本方法开头（楼梯之后）构建（B-4b：零 RNG，提前构建
        // 以使失败保护改墙先于一切内容物落位）——此处直接使用。

        // B-4a：CE Items.c:668-672——每层一次的 randomDepthOffset（depth>2 时
        // 两次独立 rand_range(-1,1)，三角分布；不是一次 rand_range(-2,2)）。
        let randomDepthOffset = 0;
        if (this.depth > 2) {
            randomDepthOffset = rng.randRange(-1, 1) + rng.randRange(-1, 1);
        }
        // CE Items.c:577-579：每层入口给计量表加 incrementFrequency。
        ItemLoader.incrementMeteredItems(this.meteredItems);

        // CE Items.c:663-767：主物品循环。生成决策（spawnPopulateItem）在先、
        // 选点在后——普通物品走热力图（heat 加权，密门后房间被偏好），
        // 食物与力量药水走 randomMatchingLocation 且不落走廊（CE 注释：
        // "Food and gain strength don't follow the heat map."）。
        for (let i = 0; i < numItems; i++) {
            const item = this.spawnPopulateItem(this.depth, randomDepthOffset);
            if (!item) continue;
            const isFood = item.category === ItemCategory.FOOD;
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
                    const cand = randomMatchingLocation(this.grid, {
                        dungeonType: TerrainType.FLOOR,
                        liquidType: TerrainType.NOTHING,
                        isOccupied: (x, y) => {
                            if (this.getMonsterAt(x, y)) return true;
                            if (this.items.some(it => it.loc.x === x && it.loc.y === y)) return true;
                            const c = this.grid.getCell(x, y);
                            if (c && (c.terrain === TerrainType.STAIRS_UP || c.terrain === TerrainType.STAIRS_DOWN || c.terrain === TerrainType.DUNGEON_PORTAL)) return true;
                            return false;
                        },
                        isMachineCell: (x, y) => this.machineCells.has(y * DCOLS + x),
                    });
                    if (!cand) break;
                    if (passableArcCount(this.grid, cand.x, cand.y) <= 1) {
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
            this.items.push(item);
            // CE Items.c:736-738：对每件生成物（含食物路径）都在其落点降温。
            heatMap.coolHeatMapAt(loc.x, loc.y);
        }

        // CE Items.c:769-783：金币——主物品循环排除 GOLD（"so it's not a
        // punishment"），堆数与产量调度见上；每堆 quantity =
        // rand_range(50 + depth*10*accel, 100 + depth*15*accel)（Items.c:377），
        // 走热力图落位，并计入 goldGenerated。
        for (let i = 0; i < numGoldPiles; i++) {
            const quantity = rng.randRange(50 + this.depth * 10 * 1, 100 + this.depth * 15 * 1);
            const loc = heatMap.getItemSpawnLoc();
            if (!loc) break;
            heatMap.coolHeatMapAt(loc.x, loc.y);
            const gold = ItemLoader.spawnGold(quantity, loc.x, loc.y);
            if (gold) {
                this.items.push(gold);
                this.goldGenerated += quantity;
            }
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
     * P1-31 / U18a-2：落位合格格判定。CE 两个旗标面（Rogue.h:1948）：
     *   - T_PATHING_BLOCKER = T_OBSTRUCTS_PASSABILITY | T_AUTO_DESCENT |
     *     T_IS_DF_TRAP | T_LAVA_INSTA_DEATH | T_IS_DEEP_WATER | T_IS_FIRE |
     *     T_SPONTANEOUSLY_IGNITES —— 全层旗标并集，不读绘制投影或旧派生位；
     *   - HAS_MONSTER → getMonsterAt；HAS_STAIRS → 楼梯地形；
     *     IS_IN_MACHINE → machineCells（本层生成期数据）。
     * 楼梯本身不含 T_PATHING_BLOCKER（Globals.c:333-334），故 HAS_STAIRS
     * 必须单独排除——CE 的 4 邻域循环同样单列。
     */
    private entryQualifiesForPlacement(x: number, y: number): boolean {
        const cell = this.grid.getCell(x, y);
        if (!cell) return false;
        if (cellTerrainFlags(this.grid, x, y) & T_PATHING_BLOCKER) return false;
        if (cell.layers.includes(TerrainType.STAIRS_UP) ||
            cell.layers.includes(TerrainType.STAIRS_DOWN) || cell.layers.includes(TerrainType.DUNGEON_PORTAL)) return false;
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
     * 切比雪夫环搜索（同旗标面、同随机取一）。
     */
    private findQualifyingPathLocNear(target: Pos): Pos | null {
        // CE Grid.c:300：首格合格立即返回，不分配网格、不耗骰。DL 是 PB 的子集。
        if (this.entryQualifiesForPlacement(target.x, target.y)) return { ...target };
        const width = this.grid.width;
        const height = this.grid.height;
        const cost = allocShortGrid(width, height, 1);
        const dist = allocShortGrid(width, height, MAX_DISTANCE);
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                const flags = cellTerrainFlags(this.grid, x, y);
                // CE Grid.c:316–320：DL 禁路径；D 单独覆盖成 O，不能把 F 当墙角。
                // 火和硫矿不在 DL 内，即使它们不合格为 PB 终点，也可作为路径。
                if (flags & T_DIVIDES_LEVEL) cost[x]![y] = -1;
                if (flags & T_OBSTRUCTS_DIAGONAL_MOVEMENT) cost[x]![y] = -2;
            }
        }
        // CE Grid.c:324-326：源格距离 1、代价强制 1（楼梯可作路径起点）
        dist[target.x]![target.y] = 1;
        cost[target.x]![target.y] = 1;
        const scanner = new DijkstraMap(width, height);
        scanner.batchScan(dist, cost, true); // CE dijkstraScan(grid, costMap, true)

        let best = MAX_DISTANCE;
        const ties: Pos[] = [];
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
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
            return ties[rng.randRange(0, ties.length - 1)]!;
        }
        // CE Grid.c:347-356 的 getQualifyingLocNear 兜底（路径无关）：
        // 切比雪夫环由近及远，首个含合格格的环内随机取一。
        for (let r = 0; r < Math.max(width, height); r++) {
            const ring: Pos[] = [];
            for (let dx = -r; dx <= r; dx++) {
                for (let dy = -r; dy <= r; dy++) {
                    if (Math.max(Math.abs(dx!), Math.abs(dy!)) !== r) continue;
                    const x = target.x + dx!;
                    const y = target.y + dy!;
                    if (x < 0 || y < 0 || x >= width || y >= height) continue;
                    if (!this.entryQualifiesForPlacement(x, y)) continue;
                    ring.push({ x, y });
                }
            }
            if (ring.length > 0) {
                return ring[rng.randRange(1, ring.length) - 1]!;
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
        MACHINE_MUD_DORMANT: TerrainType.MACHINE_MUD_DORMANT,
        LAVA: TerrainType.LAVA,
        // V-2b-5：休眠机器族的两个生成期专用落点（CE hordeCatalog 的
        // STATUE_DORMANT / TURRET_DORMANT 行——蓝图的 MF_GENERATE_HORDE
        // 把 horde 落在刚铺好的休眠载体格上）。普通地图不会有这两种地形，
        // 普通铺怪池又用 HORDE_MACHINE_ONLY 排除了这些 horde，所以这条映射
        // 只会被机器 horde 路径行使。
        STATUE_DORMANT: TerrainType.STATUE_DORMANT,
        TURRET_DORMANT: TerrainType.TURRET_DORMANT,
        // V-2b-6：10 号 Kennel 的笼子（CE hordeCatalog_Brogue 的 kennel 怪群
        // spawnsIn 列 = MONSTER_CAGE_CLOSED，GlobalsBrogue.c:890 起）。
        MONSTER_CAGE_CLOSED: TerrainType.MONSTER_CAGE_CLOSED,
    };

    /**
     * V-2b-5：CE Architect.c:1591-1599 的 MF_GENERATE_HORDE 分支 + 其内层
     * spawnHorde(0, {featX,featY}, …) 的完整语义。
     *
     *   - forbidden = (HORDE_IS_SUMMONED | HORDE_LEADER_CAPTIVE) & ~hordeFlags
     *     （CE :1594 字面——feature 自己要求的旗标从禁用集里除名）；
     *   - required = feature->hordeFlags（CE :1595），即 horde 必须**全部**带上；
     *   - OOD 掷骰照常（Monsters.c:794-804 在 spawnHorde 内部，机器 horde 同样
     *     适用，命中时 forbidden 追加 HORDE_NEVER_OOD）；
     *   - 落点即 feature 落点，CE :812-828 按 spawnsIn 核地形、不合则重抽
     *     （failsafe 50）；50 次耗尽后 CE **照样落下最后一次抽中的 horde**
     *     （`while (--failsafe && tryAgain)` 退出时不再复核）——照抄。
     *   - horde 的领袖与成员（CE spawnMinions Monsters.c:743 同置
     *     MB_JUST_SUMMONED）一并走机器收尾：记属机 / 睡姿 / 休眠。
     */
    private spawnHordeAtFeature(spawn: MachineMonsterSpawn, depth: number, machineNumber: number, created?: Monster[]): Monster | null {
        const required = spawn.hordeFlags ?? [];
        const forbidden = ['HORDE_IS_SUMMONED', 'HORDE_LEADER_CAPTIVE']
            .filter(f => !required.includes(f));
        const roll = this.rollSpawnDepth(depth);
        const forbiddenFull = roll.outOfDepth
            ? [...forbidden, 'HORDE_NEVER_OOD']
            : forbidden;
        // CE pickHordeType（Monsters.c:511）的 requiredFlags 半边：
        // `~(hordeCatalog[i].flags) & requiredFlags` 为 0 才合格。
        const candidates = this.hordeCandidates(roll.depth, forbiddenFull)
            .filter(h => required.every(r => h.flags.includes(r)));

        let picked: HordeEntry | null = null;
        for (let failsafe = 50; failsafe > 0; failsafe--) {
            const cand = this.pickHordeType(candidates);
            if (!cand) return null; // CE :816-819 抽不到合格 horde → 不生成
            picked = cand;
            if (this.hordeFitsTerrain(cand, spawn.pos)) break;
        }
        if (!picked) return null;

        const collected: Monster[] = [];
        this.spawnHordeAt(picked, spawn.pos, depth, false, undefined, collected);
        for (const mon of collected) {
            this.finalizeBlueprintMonster(mon, spawn, machineNumber);
        }
        created?.push(...collected);
        return collected[0] ?? null; // spawnHordeAt records the leader first.
    }

    /** Monsters.c:809-819：horde 落格地形约束（spawnsIn）。 */
    private hordeFitsTerrain(h: HordeEntry, pos: Pos): boolean {
        // CE spawnHorde fixed-location selection uses PB, even for flyers.
        // Species exemptions belong to spawnMinions, not this horde-level check.
        if (!h.spawnsIn) return !(cellTerrainFlags(this.grid, pos.x, pos.y) & T_PATHING_BLOCKER);
        const target = Game.SPAWNS_IN_TERRAIN[h.spawnsIn];
        // STATUE_*/CAGE/TURRET/WALL 等生成期专用落点不匹配普通地图格（CE 同样重抽）
        if (target === undefined) return false;
        return this.grid.getCell(pos.x, pos.y)?.layers.includes(target) ?? false; // F-1 跨层判定
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
                if (!cell || !cell.layers.includes(target)) continue; // F-1 跨层判定
                if (cell.machineNumber !== 0) continue; // CE IS_IN_MACHINE
                if (cell.layers.includes(TerrainType.STAIRS_UP) || cell.layers.includes(TerrainType.STAIRS_DOWN) || cell.layers.includes(TerrainType.DUNGEON_PORTAL)) continue;
                if (this.dormantMonsters.some(m => m.hp > 0 && m.x === x && m.y === y)) continue;
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
    private spawnHordeAt(
        h: HordeEntry,
        centerPos: Pos,
        depth: number,
        wandering: boolean,
        floorTiles?: Pos[],
        /**
         * V-2b-5：收集本 horde 实际创建的每一只怪（领袖 + 成员）。CE 的
         * spawnedMonsters 缓冲按 MB_JUST_SUMMONED 收集同样的集合
         * （Monsters.c:743 成员也置位），机器的睡姿/休眠/记属机收尾要遍历它。
         * 缺省（undefined）= 不收集，既有调用方行为逐位不变。
         */
        collected?: Monster[]
    ): boolean {
        const leaderMData = (monsterData as MonsterData[]).find(m => m.id === h.leader.toLowerCase());
        if (!leaderMData) return false;

        const leaderMon = new Monster(centerPos.x, centerPos.y, leaderMData);
        // CE Monsters.c:883-885: only the horde leader is the marked sacrifice.
        leaderMon.markedForSacrifice = h.flags.includes('HORDE_SACRIFICE_TARGET');
        if (h.flags.includes('HORDE_LEADER_CAPTIVE')) {
            // Monsters.c:872-877：笼中俘虏 —— 上锁不行动、状态 WANDERING、HP 折至 1/4+1
            leaderMon.isCaged = true;
            leaderMon.state = MonsterState.WANDERING;
            leaderMon.hp = Math.floor(leaderMon.maxHp / 4) + 1;
        } else if (h.flags.includes('HORDE_ALLIED_WITH_PLAYER')) {
            // CE Monsters.c:879: portal legendary allies use the existing allegiance consumer.
            this.becomeAllyWith(leaderMon);
        }
        this.applyRandomMutation(leaderMon, depth);
        if (wandering) leaderMon.state = MonsterState.WANDERING;
        this.monsters.push(leaderMon);
        collected?.push(leaderMon);

        // Spawn members nearby
        for (const member of h.members) {
            const count = rng.randRange(member.minCount, member.maxCount);
            const memberMData = (monsterData as MonsterData[]).find(m => m.id === member.type.toLowerCase());
            if (!memberMData) continue;

            for (let c = 0; c < count; c++) {
                // CE spawnMinions creates each individual before searching for
                // its location. Even a failed placement consumes initialization RNG.
                let mon: Monster | undefined;
                if (collected) {
                    mon = new Monster(0, 0, memberMData);
                    this.applyRandomMutation(mon, depth);
                }
                const pos = this.findMinionSpawnSpot(centerPos, memberMData, h.spawnsIn, false, !!collected);
                if (!pos) break;
                if (!mon) {
                    mon = new Monster(pos.x, pos.y, memberMData);
                    this.applyRandomMutation(mon, depth);
                } else {
                    mon.loc = {...pos};
                    mon.spawnLoc = {...pos};
                    mon.state = leaderMon.state;
                }
                if (wandering) mon.state = MonsterState.WANDERING;
                mon.leader = leaderMon;
                mon.boundToLeader = h.flags.includes('HORDE_DIES_ON_LEADER_DEATH');
                // CE Monsters.c:753: the flag applies to every member as well as the leader.
                if (h.flags.includes('HORDE_ALLIED_WITH_PLAYER')) this.becomeAllyWith(mon);
                this.monsters.push(mon);
                collected?.push(mon);
                if (floorTiles) {
                    const index = floorTiles.findIndex(p => p.x === pos.x && p.y === pos.y);
                    if (index !== -1) floorTiles.splice(index, 1);
                }
            }
        }
        return true;
    }

    /** CE spawnMinions: species catalog flags, then up to 20 special-tile retries.
     * Uses current entity occupancy, without runtime immunity or monsterAvoids. */
    private findMinionSpawnSpot(origin: Pos, species: MonsterData, spawnsIn: string | null | undefined, summoned: boolean, machine = false): Pos | null {
        const target = spawnsIn ? Game.SPAWNS_IN_TERRAIN[spawnsIn] : undefined;
        if (spawnsIn && target === undefined) return null;
        let failsafe = 0;
        let pos: Pos | null;
        do {
            pos = minionPlacement(machine ? {grid: this.grid, player: this.player, monsters: this.monsters, dormantMonsters: []} : this, origin, species, summoned, target);
            if (!pos) return null;
        } while (target !== undefined && !this.grid.getCell(pos.x, pos.y)!.layers.includes(target) && failsafe++ < 20);
        return failsafe >= 20 ? null : pos;
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
        const distance = generationDistances(this, from, T_PATHING_BLOCKER | T_SACRED, true);
        const result: Pos[] = [];
        for (let x = 0; x < this.grid.width; x++) for (let y = 0; y < this.grid.height; y++) {
            const d = distance[x]![y]!;
            const cell = this.grid.getCell(x, y)!;
            if (d < 1 || d > Math.floor(DCOLS / 2) || cell.isVisible
                || (cellTerrainFlags(this.grid, x, y) & (T_PATHING_BLOCKER | T_HARMFUL_TERRAIN))
                || this.getMonsterAt(x, y) || (this.player.x === x && this.player.y === y)) continue;
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
     * MA_ENTER_SUMMONS stores the summoner in the last spawned host; its death
     * releases the original entity through removeDeadMonsters.
     * Remaining simplification: itemPossible 参数（spawnMinions 召唤路径固定传 false，web 落地的
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
                const pos = this.findMinionSpawnSpot(summoner.loc, memberMData, horde.spawnsIn, true);
                if (!pos) continue;
                const mon = new Monster(pos.x, pos.y, memberMData);
                mon.leader = summoner;
                mon.boundToLeader = horde.flags.includes('HORDE_DIES_ON_LEADER_DEATH');
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
                name: this.monsterDisplayName(summoner),
                defaultValue: `${this.monsterDisplayName(summoner)} incants darkly!`
            }), '#c084fc');
        }

        if (enterSummons) {
            if (atLeastOneMinion) {
                spawned[spawned.length - 1]!.carriedMonster = summoner;
                this.demoteMonsterFromLeadership(summoner);
            } else {
                this.monsters.unshift(summoner);
            }
        }

        return atLeastOneMinion;
    }

    /**
     * Monsters.c:1101 getRandomMonsterSpawnLocation 的 web 等价：
     * 候选格 = 可通行、非有害地形（熔岩/深渊）、非楼梯、无怪物、非玩家位、
     * 且不在玩家当前视野内（IN_FIELD_OF_VIEW 排除）；
     * 优先离玩家足够远（切比雪夫距离 >= floor(DCOLS/2)，近似 CE 的
     * 路径距离场 >= DCOLS/2 阈值），无远格则回退到任意视野外合法格。
     * P1-37：CE 的远格池不排机器、回退池排 IS_IN_MACHINE（Monsters.c:1110
     * 的 getTerrainGrid 第二次调用才加入该旗标）——两池口径照搬。
     */
    private findPeriodicSpawnLocation(): Pos | null {
        const far: Pos[] = [];
        const near: Pos[] = [];
        const minFarDist = Math.floor(DCOLS / 2);
        const distances = generationDistances(this, this.player.loc, T_DIVIDES_LEVEL, true);
        for (let x = 1; x < DCOLS - 1; x++) {
            for (let y = 1; y < DROWS - 1; y++) {
                const cell = this.grid.getCell(x, y);
                if (!cell || (cellTerrainFlags(this.grid, x, y) & (T_PATHING_BLOCKER | T_HARMFUL_TERRAIN))) continue;
                if (cell.isVisible) continue;
                // F-1：跨层判定（火盖在岩浆/深渊/楼梯上不改变落点排除）
                if (cell.layers.includes(TerrainType.LAVA) || cell.layers.includes(TerrainType.CHASM)) continue;
                if (cell.layers.includes(TerrainType.STAIRS_UP) || cell.layers.includes(TerrainType.STAIRS_DOWN) || cell.layers.includes(TerrainType.DUNGEON_PORTAL)) continue;
                if (this.getMonsterAt(x, y)) continue;
                if (this.player.loc.x === x && this.player.loc.y === y) continue;
                const distance = distances[x]![y]!;
                const isFar = distance >= minFarDist && distance < 30000;
                // CE 回退池的 IS_IN_MACHINE 排除：远格池不排，无远格可退时
                // （near 池）才回避机器（Monsters.c:1110 第二次 getTerrainGrid）
                if (!isFar && cell.machineNumber !== 0) continue;
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
            return canSeeMonster(this.player, this.grid, m);
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
                    this.player.effectiveStrength,
                    0, // 已废弃占位：防御由 DetailGenerator 内部用下方 armor 三元组经 playerDefense() 计算
                    [n || 1, (n || 1) * (d || 2)],
                    this.player.equippedWeapon?.enchantment ?? 0,
                    this.player.equippedWeapon?.strengthRequired ?? 12,
                    this.player.equippedArmor?.armor ?? 0,
                    this.player.equippedArmor?.enchantment ?? 0,
                    this.player.equippedArmor?.strengthRequired ?? 0, // 缺省口径对齐 Combat.ts 的 || 0
                    this.player.hasStatus('hallucinating'),
                    this.player.getStatusDuration('donning'),
                    this.player.hasStatus('stuck')
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
                this.inspectTarget = generateItemDetail(i, this.player.effectiveStrength);
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
        if (!cell) return;

        const monster = this.getMonsterAt(x, y);
        if (monster && canSeeMonster(this.player, this.grid, monster)) {
            const weaponDamageStr = this.player.equippedWeapon?.damage ?? '1d2';
            const [n, d] = weaponDamageStr.split('d').map(Number);
            this.inspectTarget = generateMonsterDetail(
                monster,
                this.player.hp,
                this.player.effectiveStrength,
                0, // 已废弃占位：防御由 DetailGenerator 内部用下方 armor 三元组经 playerDefense() 计算
                [n || 1, (n || 1) * (d || 2)],
                this.player.equippedWeapon?.enchantment ?? 0,
                this.player.equippedWeapon?.strengthRequired ?? 12,
                this.player.equippedArmor?.armor ?? 0,
                this.player.equippedArmor?.enchantment ?? 0,
                this.player.equippedArmor?.strengthRequired ?? 0, // 缺省口径对齐 Combat.ts 的 || 0
                this.player.hasStatus('hallucinating'),
                this.player.getStatusDuration('donning'),
                this.player.hasStatus('stuck')
            );
            return;
        }

        const item = this.items.find((i) => i.loc.x === x && i.loc.y === y);
        if (item && cell.isVisible) {
            this.inspectTarget = generateItemDetail(item, this.player.effectiveStrength);
        }
    }

    private createMonsterFromSnapshot(m: TestRoomState['baselineMonsters'][number]): Monster {
        return this.deserializeMonster(m);
    }

    private generateTestDepth(isFirstLevel: boolean) {
        if (this.grid) { setDormantAwakener(this.grid, null); setAllyResurrector(this.grid, null); setDungeonFeatureEffects(this.grid, null); }
        for (const level of this.levels.values()) { setDormantAwakener(level.grid, null); setAllyResurrector(level.grid, null); setDungeonFeatureEffects(level.grid, null); }
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
        this.dormantMonsters = []; // test 层无休眠怪（防上一层残留）
        this.bindDormantAwakener();
        this.environment = new EnvironmentManager(this.grid);
        this.fov = new FOVSys(this.grid);
        this.lightMap = new LightMap(this.grid);
                this.activeFlares = []; this.terrainFlashes = []; this.flareLightMap = null; this.flareElapsedMs = 0;
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
                spawn: (x, y) => ({ item: ItemLoader.spawnWeapon(cfg.id, x, y, this.depth) ?? undefined })
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
                    spawn: (x: number, y: number) => ({ item: ItemLoader.spawnArmor(cfg.id, x, y, this.depth) ?? undefined })
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
                        const item = ItemLoader.spawnWeapon('dagger', x, y, this.depth);
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
                        const item = ItemLoader.spawnArmor('leather_armor', x, y, this.depth);
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
                this.signTexts.set(this.posKey(signX, row.branchY), `测试内容：${ItemLoader.translateName(payload.roomName)}`);

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
                            layers: [...cell.layers],
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
                    baselineMonsters: roomMonsters.map(m => this.serializeMonster(m)),
                    baselineTerrains
                });

                roomId++;
                assetIdx++;
            }
        }

        this.needsRender = true;
        if (!isFirstLevel) {
        logger.log(i18next.t('game.test_mode_depth', { depth: this.depth, category: categoryLabel }), '#88ccff');
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

    // =========================================================================
    // C-7：CE 视野+光照管线（updateVision Time.c:859-913 → updateLighting
    // Light.c:208-240 → VISIBLE 阈值 Movement.c:2582-2589）。
    // 旧实现（fov.computeFOV(player, 10) + addLight(player, 8, '#ffccaa')）
    // 的"半径 10/8 硬编码"是 CE 无界 FOV + 光照阈值的 web 代理，本轮按 CE
    // 语义翻正：VISIBLE = 几何 FOV（无界，T_OBSTRUCTS_VISION 遮挡）
    // ∧ 三通道光强和 > VISIBILITY_THRESHOLD(50)。
    // =========================================================================

    /**
     * 矿灯半径重算。CE 的触发点与本轮载体现状：
     * - 进新层重置基础半径（RogueMain.c:666-671 → updateRingBonuses 级联）——
     *   本轮每次 updateVision 前重算（纯函数，值只随 depth 变化，等价）。
     * - 光明戒指（Items.c:8728）尚无可生成目录项，倍率保持基值 1。
     * - 黑暗状态由药水施加，并在计时、治愈、消魔时变化。
     * - inWater 按 Time.c:84-107 的深水、漂浮、缠绕、阻挡条件派生。
     */
    private refreshMinersLight(): void {
        this.minersLightBaseFixpt = minersLightBaseRadiusFixpt(this.depth);
        const flags = cellTerrainFlags(this.grid, this.player.loc.x, this.player.loc.y);
        const inWater = !!(flags & T_IS_DEEP_WATER)
            && !this.player.hasStatus('levitating')
            && !(flags & (T_ENTANGLES | T_OBSTRUCTS_PASSABILITY));
        this.minersLight = updateMinersLightRadius(this.minersLightBaseFixpt, {
            lightMultiplier: 1,
            darknessStatus: this.player.getStatusDuration('darkness'),
            darknessMax: this.player.maxStatus.darkness,
            inWater: Number(inWater),
        });
    }

    /** 矿灯作为 paintLight 输入（color = 随深度插值的 minersLightColor）。 */
    private minersLightDef(): LightSourceDef {
        const st = this.minersLight;
        return {
            color: minersLightColorAtDepth(this.depth),
            radius: { lowerBound: st.radiusHundredths, upperBound: st.radiusHundredths, clumpFactor: 1 },
            radialFadeToPercent: st.radialFadeToPercent,
            passThroughCreatures: true, // Globals.c:958 原列
        };
    }

    /** CE getFOVMask 的 HAS_MONSTER|HAS_PLAYER 遮挡谓词（Light.c:85）。 */
    private hasCreatureAtForLight(x: number, y: number): boolean {
        if (this.player.loc.x === x && this.player.loc.y === y) return true;
        return this.monsters.some((m) => m.hp > 0 && m.loc.x === x && m.loc.y === y);
    }

    /**
     * CE Light.c:283-287 playerInDarkness：玩家格三通道光强全部低于
     * 矿灯色 −10（+10 余量）——潜行范围减半判据之一（Time.c:798）。
     */
    private playerInDarkness(): boolean {
        const ch = this.lightMap.lightAt(this.player.loc.x, this.player.loc.y);
        if (!ch) return true;
        const mc = minersLightColorAtDepth(this.depth);
        return ch.r + 10 < mc.red && ch.g + 10 < mc.green && ch.b + 10 < mc.blue;
    }

    /**
     * CE updateVision 的 web 全链：几何 FOV 掩码（无界）→ 清光 → 泼发光
     * 地形/燃烧生物/矿灯 → 按"掩码 ∧ 光强>50"写 isVisible（并随可见标记
     * isExplored/hasMemory，保持 web 既有行为）→ 折算渲染馈送。
     * 除 depth 读取外全程零 RNG 消费（paintLight 确定性口径见 LightMap.ts 头注释）。
     */
    private updateVision(): void {
        this.refreshMinersLight();

        // Time.c:873：FOV 掩码半径 (DCOLS+DROWS)*FP_FACTOR ≈ 无界；
        // 遮挡 T_OBSTRUCTS_VISION = cell.isOpaque。
        const mask = this.fov.computeFOVMask(
            this.player.loc.x, this.player.loc.y, DCOLS + DROWS,
            (cell) => cell.isOpaque
        );

        const lm = this.lightMap;
        lm.clearLighting(); // Light.c:216-226：清零 + 全图 IS_IN_SHADOW

        // 1. 发光地形（Light.c:228-240：逐层扫描 tileCatalog.glowLight）
        const creatureBlocker = (x: number, y: number) => this.hasCreatureAtForLight(x, y);
        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                const cell = this.grid.getCell(x, y);
                if (!cell) continue;
                for (const t of cell.layers) {
                    if (t === TerrainType.NOTHING) continue;
                    const glow = TERRAIN_FLAGS[t]?.glowLight ?? LightKind.NO_LIGHT;
                    if (glow !== LightKind.NO_LIGHT) {
                        lm.paintLight({
                            light: LIGHT_CATALOG[glow]!,
                            x, y,
                            hasCreatureAt: creatureBlocker,
                        });
                    }
                }
            }
        }

        // 2. 生物固有光（Light.c:243-245）及燃烧光（:249-251）。
        for (const m of this.monsters) {
            if (m.hp <= 0) continue;
            const kind = m.markedForSacrifice ? LightKind.SACRIFICE_MARK_LIGHT : MONSTER_INTRINSIC_LIGHT[m.typeId];
            if (kind !== undefined) lm.paintLight({
                light: LIGHT_CATALOG[kind]!, x: m.loc.x, y: m.loc.y,
                hasCreatureAt: creatureBlocker,
            });
            const mutationKind = m.mutation && MUTATION_LIGHT[m.mutation.id];
            if (mutationKind !== undefined) lm.paintLight({
                light: LIGHT_CATALOG[mutationKind]!, x: m.loc.x, y: m.loc.y,
                hasCreatureAt: creatureBlocker,
            });
        }

        // 3. 燃烧生物的光（Light.c:249-251：STATUS_BURNING 且非 MONST_FIERY；
        //    CE 的遍历含玩家自己——updateLighting 的 handledPlayer 模式）
        const burningLight = LIGHT_CATALOG[LightKind.BURNING_CREATURE_LIGHT]!;
        const paintBurning = (entity: Player | Monster, fiery: boolean): void => {
            if (fiery) return;
            if (this.burningDuration(entity) > 0) {
                lm.paintLight({
                    light: burningLight,
                    x: entity.loc.x, y: entity.loc.y,
                    hasCreatureAt: creatureBlocker,
                });
            }
        };
        paintBurning(this.player, false);
        for (const m of this.monsters) {
            if (m.hp > 0) paintBurning(m, m.hasBehavior('MONST_FIERY'));
        }

        // 4. 矿灯（Light.c:269：isMinersLight=true → 不驱散阴影、不圆截断）
        lm.paintLight({
            light: this.minersLightDef(),
            x: this.player.loc.x, y: this.player.loc.y,
            isMinersLight: true,
            maintainShadows: true,
        });

        // CE Time.c:660-704: positive clairvoyance reveals nearby cells through
        // walls; a cursed ring darkens the same radius even inside ordinary FOV.
        const clairvoyance = ringBonus(this.player.rings(), 'ring_of_clairvoyance');
        const clairvoyanceRadius = clairvoyance > 0 ? clairvoyance + 1
            : clairvoyance < 0 ? 1 - clairvoyance : 0;
        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                const cell = this.grid.getCell(x, y);
                if (!cell) continue;
                const dx = this.player.loc.x - x, dy = this.player.loc.y - y;
                const inClairvoyance = clairvoyanceRadius > 0
                    && dx * dx + dy * dy < clairvoyanceRadius * clairvoyanceRadius + clairvoyanceRadius
                    && (cell.layers[DungeonLayer.DUNGEON] !== TerrainType.GRANITE || cell.isExplored);
                const darkened = clairvoyance < 0 && inClairvoyance
                    && (dx !== 0 || dy !== 0);
                const directlyVisible = mask[x]![y]! && lm.lightSumAt(x, y) > VISIBILITY_THRESHOLD && !darkened;
                cell.isClairvoyantVisible = clairvoyance > 0 && inClairvoyance && !directlyVisible;
                const visible = directlyVisible || cell.isClairvoyantVisible;
                cell.isVisible = visible;
                if (visible) {
                    cell.isExplored = true;
                    cell.hasMemory = true;
                    cell.rememberedTerrain = cell.terrain;
                    cell.rememberedLayers = [...cell.layers];
                    cell.rememberedAppearance = memoryTerrainAppearance(cell, this.depth);
                    cell.rememberedTerrainFlags = cellTerrainFlags(this.grid, x, y);
                    cell.rememberedTMFlags = cellTerrainMechFlags(this.grid, x, y);
                    cell.rememberedFlags = { passable: cell.isPassable, opaque: cell.isOpaque,
                        trapFree: (cell.rememberedTerrainFlags & T_IS_DF_TRAP) === 0 };
                    const item = this.items.find(i => i.loc.x === x && i.loc.y === y);
                    cell.rememberedItem = item ? { name: item.displayName, char: item.char, color: item.color } : null;
                    cell.rememberedItemCategory = item?.category ?? null;
                }
            }
        }

        // 5. 渲染馈送（GameCanvas 消费 getLight 接口不变——引擎数据升级，
        //    渲染层零改动）
        lm.fillRenderFromLighting();
    }

    public update() {
        // Run events until it's the player's turn
        // OR the queue is empty

        if (this.needsRender && this.onRenderRequested) {
            // Update FOV & Lighting before rendering
            // C-7：CE updateVision 全链（掩码→光照→VISIBLE 阈值→渲染馈送）
            this.updateVision();

            // Check discoveries
            const currentVisMonsters = new Set<Monster>();
            const currentVisItems = new Set<Item>();

            for (const m of this.monsters) {
                if (canSeeMonster(this.player, this.grid, m)) {
                    currentVisMonsters.add(m);
                    if (!this.visibleMonsters.has(m)) {
                        const seeMsg = i18next.t('vision.see_monster', { monster: m.name, defaultValue: `You see a ${m.name}.` });
                        const senseMsg = i18next.t('vision.sense_monster', { monster: m.name, defaultValue: `You sense a ${m.name}.` });
                        logger.log(canDirectlySeeMonster(this.player, this.grid, m) ? seeMsg : senseMsg, '#ffccaa');
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

            // C-7：动态光照已并入 updateVision（地形光/燃烧生物/矿灯按 CE
            // Light.c:208-240 顺序泼入，渲染馈送由 fillRenderFromLighting 折算）。
            // 旧的"玩家火把 addLight(player, 8, '#ffccaa')"随矿灯管线退役。

            this.onRenderRequested();
            this.needsRender = false;
        }
    }

    /** CE monsterName: a hidden creature's identity is not available to messages. */
    public monsterDisplayName(monster: Creature): string {
        if (monster === this.player) return monster.name;
        const target = monster as Monster;
        const visibleAtDeath = target.hp <= 0 && !monsterHidden(this.grid, target)
            && !!this.grid.getCell(target.loc.x, target.loc.y)?.isVisible;
        return canSeeMonster(this.player, this.grid, target) || visibleAtDeath ? target.name : '某个生物';
    }

    public isTimePaused() {
        return this.isInventoryOpen || !!this.pendingArcana || this.pendingEnchantment;
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

    private recordInputEvent(action: string, data: unknown, decisions: boolean[]) {
        this.recordedInputEvents.push({
            index: this.recordedInputIndex++,
            tick: timeSystem.currentTick,
            depth: this.depth,
            player: { x: this.player.loc.x, y: this.player.loc.y },
            action,
            data: this.toRecordedInputData(data),
            decisions,
            turn: this.absoluteTurnNumber,
            rng: rng.getState(),
            ...(this.isGameOver ? { end: { won: this.gameOverWon, superVictory: this.gameOverSuperVictory, score: this.gameOverScore } } : {})
        });
    }

    /** Every user command, including inventory and modal choices, crosses this boundary. */
    public executeCommand(action: string, data?: unknown, perform?: () => void): void {
        if (this.replayRecording || this.isInputLocked()) return;
        const decisions: boolean[] = [];
        this.commandDecisions = decisions;
        try {
            if (perform) perform(); else this.applyCommand(action, data);
            if (this.recordingFromNewGame) this.recordInputEvent(action, data, decisions);
        } finally {
            this.commandDecisions = null;
        }
    }

    private applyCommand(action: string, data?: unknown): void {
        if (action.startsWith('item:')) {
            const [operation, letter, ...rest] = String(data ?? '').split('|');
            const item = this.player.inventory.items.find(i => i.inventoryLetter === letter);
            if (operation !== 'confirm' && operation !== 'cancel' && !item) throw new Error(`Missing replay item ${letter}`);
            switch (operation) {
                case 'equip': this.equipItem(item!); break;
                case 'unequip': this.unequipItem(item!); break;
                case 'drop': this.dropItem(item!); break;
                case 'quaff': this.quaffItem(item!); break;
                case 'read': this.readItem(item!); break;
                case 'throw': this.enterThrowMode(item!); break;
                case 'eat': this.eatItem(item!); break;
                case 'use': this.useArcanaItem(item!); break;
                case 'identify': this.chooseIdentifyTarget(item!); break;
                case 'enchant': this.chooseEnchantTarget(item!); break;
                case 'call': this.callItem(item!, rest.join('|')); break;
                case 'confirm': this.confirmPendingUse(); break;
                case 'cancel': this.cancelPendingUse(); break;
                default: throw new Error(`Unknown item command ${operation}`);
            }
        } else if (action === 'mouse_travel') {
            const pos = data as Pos;
            this.handleMouseTravel(pos.x, pos.y);
        } else if (action === 'auto_step') {
            this.stepAutoPath();
        } else {
            this.performPlayerAction(action, data, 'system');
        }
    }

    public executeItemCommand(operation: string, item?: Item, title?: string, perform?: () => void): void {
        this.executeCommand('item:command', `${operation}|${item?.inventoryLetter ?? ''}|${title ?? ''}`, perform);
    }

    public exportRecording(): GameRecording {
        if (!this.recordingFromNewGame) throw new Error('Recording requires a fresh new game; saved games cannot continue a recording');
        return {
            version: 2,
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
                data: event.data,
                decisions: [...(event.decisions ?? [])],
                turn: event.turn,
                rng: event.rng,
                ...(event.end ? { end: { ...event.end } } : {})
            }))
        };
    }

    public clearRecording() {
        this.recordedInputEvents = [];
        this.recordedInputIndex = 0;
        this.recordingStartAt = Date.now();
        this.recordingFromNewGame = false;
    }

    public clearReplay() {
        this.replayRecording = null;
        this.replayEvents = [];
        this.replayCursor = 0;
        this.replayStatus = 'idle';
        this.replayFrameAccumulator = 0;
        this.replayError = null;
    }

    private decodeRecordedInputData(data: RecordedInputData): unknown {
        if (data === null) return undefined;
        if (typeof data === 'number' || typeof data === 'string') return data;
        return { x: data.x, y: data.y };
    }

    private isValidRecording(recording: unknown): recording is GameRecording {
        if (!recording || typeof recording !== 'object') return false;
        const r = recording as Partial<GameRecording>;
        const validSeed = isSeed(r.seed) || (typeof r.seed === 'number' && Number.isSafeInteger(r.seed) && r.seed >= 0);
        return r.version === 2
            && validSeed
            && (r.mode === 'normal' || r.mode === 'easy' || r.mode === 'wizard' || r.mode === 'test')
            && r.startDepth === 1
            && Array.isArray(r.events)
            && r.events.every((event, index) => !!event && typeof event === 'object'
                && event.index === index
                && typeof event.action === 'string'
                && (event.data === null || typeof event.data === 'string'
                    || (typeof event.data === 'number' && Number.isFinite(event.data))
                    || (!!event.data && typeof event.data === 'object'
                        && Number.isFinite(event.data.x) && Number.isFinite(event.data.y)))
                && typeof event.tick === 'number' && Number.isFinite(event.tick)
                && typeof event.turn === 'number' && Number.isFinite(event.turn)
                && typeof event.depth === 'number' && Number.isFinite(event.depth)
                && typeof event.player?.x === 'number' && typeof event.player?.y === 'number'
                && Array.isArray(event.decisions) && event.decisions.every(d => typeof d === 'boolean')
                && Random.isState(event.rng)
                && (event.end === undefined || (typeof event.end.won === 'boolean'
                    && typeof event.end.superVictory === 'boolean'
                    && Number.isSafeInteger(event.end.score))));
    }

    public loadReplay(recording: unknown): boolean {
        if (!this.isValidRecording(recording)) return false;
        const safeRecording: GameRecording = {
            version: 2,
            recordedAt: recording.recordedAt ?? Date.now(),
            seed: normalizeSeed(recording.seed),
            mode: recording.mode,
            startDepth: recording.startDepth ?? 1,
            events: recording.events.map((event) => ({
                index: event.index,
                tick: event.tick,
                depth: event.depth,
                player: { ...event.player },
                action: event.action,
                data: event.data,
                decisions: [...event.decisions!],
                turn: event.turn,
                rng: structuredClone(event.rng!),
                ...(event.end ? { end: { ...event.end } } : {})
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
        if (!this.replayRecording || this.replayError) return;
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
        // A stale programmatically injected recording cannot be played, but a restart
        // still retires the old run through U00's single new-game boundary.
        if (!this.isValidRecording(this.replayRecording)) {
            const { seed, mode } = this.replayRecording;
            this.startNewGame({ seed, mode });
            return;
        }
        this.loadReplay(this.replayRecording);
    }

    public replayStep(silent: boolean = false) {
        if (!this.replayRecording || this.replayError) return;
        // P2-2 输入锁：动画推进期间回放步同样不得插入（否则会在怪物行动的
        // 半途落地玩家动作，破坏逐次演出的因果顺序）
        if (this.isInputLocked()) return;
        if (this.replayCursor >= this.replayEvents.length) {
            this.replayStatus = 'finished';
            return;
        }
        const event = this.replayEvents[this.replayCursor];
        if (!event) return;
        this.commandDecisions = event.decisions ?? [];
        this.replayDecisionCursor = 0;
        try {
            this.applyCommand(event.action, this.decodeRecordedInputData(event.data));
            const actual = { tick: timeSystem.currentTick, depth: this.depth,
                player: this.player.loc, turn: this.absoluteTurnNumber, rng: rng.getState() };
            if (actual.tick !== event.tick || actual.depth !== event.depth
                || actual.player.x !== event.player.x || actual.player.y !== event.player.y
                || actual.turn !== event.turn || this.replayDecisionCursor !== event.decisions!.length
                || JSON.stringify(actual.rng) !== JSON.stringify(event.rng)) {
                throw new Error(`state mismatch after command ${event.index + 1}`);
            }
            if (!!event.end !== this.isGameOver || (event.end && (this.gameOverWon !== event.end.won
                || this.gameOverSuperVictory !== event.end.superVictory || this.gameOverScore !== event.end.score))) {
                throw new Error(`endgame mismatch after command ${event.index + 1}`);
            }
            this.update();
        } catch (error) {
            this.replayError = `OOS at command ${event.index + 1}: ${error instanceof Error ? error.message : String(error)}`;
            this.replayStatus = 'loaded';
            logger.log(this.replayError, '#ff6666');
            return;
        } finally {
            this.commandDecisions = null;
        }
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
        if (!this.isValidRecording(this.replayRecording)) {
            const { seed, mode } = this.replayRecording;
            this.startNewGame({ seed, mode });
            return;
        }

        const total = this.replayEvents.length;
        const clamped = Math.max(0, Math.min(Math.floor(targetIndex), total));
        const animationEnabled = this.animationEnabled;
        this.animationEnabled = false;
        try {
            this.loadReplay(this.replayRecording);
            for (let i = 0; i < clamped; i++) {
                this.replayStep(true);
                if (this.replayStatus === 'finished' || this.replayError) break;
            }
        } finally {
            this.animationEnabled = animationEnabled;
        }

        if (this.replayStatus === 'playing') {
            this.replayStatus = 'loaded';
        }
    }

    public handlePlayerAction(action: string, data?: unknown, source: 'player' | 'system' = 'player') {
        if (source === 'player') this.executeCommand(action, data);
        else this.performPlayerAction(action, data, source);
    }

    private performPlayerAction(action: string, data?: unknown, source: 'player' | 'system' = 'system') {
        if (action === 'discoveries' || action === 'help') {
            this.referenceScreen = this.referenceScreen === action ? null : action;
            return;
        }
        if (this.referenceScreen) {
            if (action === 'escape' || action === 'cancel_target') this.referenceScreen = null;
            return;
        }
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

        // CE Items.c:7824-7835: once read, enchantment requires a valid target;
        // Escape/close/cancel cannot discard the scroll's unresolved effect.
        if (this.pendingEnchantment) return;

        if (this.pendingArcana) {
            if (action === 'escape' || action === 'cancel_target') this.cancelArcanaSelection();
            else if (action === 'confirm_target') this.confirmArcanaTarget();
            else if (action === 'cycle_target') this.cycleArcanaTarget(data === -1);
            else if (action === 'move') {
                const delta = typeof data === 'number' ? this.directionToVec(data as Direction) : data as Pos | undefined;
                if (delta && Number.isFinite(delta.x) && Number.isFinite(delta.y)) {
                    this.setArcanaTarget(this.pendingArcana.cursor.x + delta.x, this.pendingArcana.cursor.y + delta.y);
                }
            }
            return; // No search, stairs, inventory, pathing or waiting through the modal.
        }

        if (action === 'confirm_target' || action === 'cycle_target' || action === 'cancel_target') return;

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
            // B-1b：鉴定目标选择中不得关闭弹层（CE Items.c:7791 do-while
            // 强制选到合法目标，ESC 会重新进入提示）
            if (this.pendingIdentify) return;
            this.isInventoryOpen = !this.isInventoryOpen;
            return;
        }

        if (action === 'escape') {
            if (this.pendingIdentify) return;
            if (this.isInventoryOpen) {
                this.isInventoryOpen = false;
            }
            return;
        }

        if (action === 'apply_item') {
            if (!this.pendingIdentify) this.isInventoryOpen = true;
            return;
        }

        if (action === 'throw_item') {
            // B-2：CE THROW_KEY（Rogue.h:1183）。CE 是同步的"扔什么?→扔哪里?"
            // 双提示；web 无同步提示层，近似为打开背包由玩家点物品的 Throw
            // 按钮再点目标格（B-1b identify 异步偏差的同款架构代价，登记）。
            // 瘫痪时走上方 paralyzed 分支被拦（CE 投掷也须能行动）。
            if (this.pendingIdentify) return;
            if (!this.isInventoryOpen) {
                this.isInventoryOpen = true;
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
            if (cell && cell.layers.includes(TerrainType.STAIRS_UP)) { // F-1 跨层判定
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
            const terminal = this.grid.getCell(this.player.x, this.player.y)?.layers.includes(TerrainType.DUNGEON_PORTAL);
            if (terminal && this.depth === CE_DEEPEST_LEVEL) {
                const hasAmulet = this.player.inventory.items.some(i => i.category === ItemCategory.AMULET);
                if (hasAmulet) this.triggerGameOver(true, undefined, true);
                else logger.log(i18next.t('game.entrance_blocked', { defaultValue: 'The entrance is blocked. You cannot leave without the Amulet of Yendor.' }), '#aaaaaa');
                return;
            }
            const cell = this.grid.getCell(this.player.loc.x, this.player.loc.y);
            if (cell && cell.layers.includes(TerrainType.STAIRS_DOWN) && this.depth < CE_DEEPEST_LEVEL) {
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
            if (cell && (cell.layers.includes(TerrainType.STAIRS_DOWN) || cell.layers.includes(TerrainType.DUNGEON_PORTAL))) { // F-1 跨层判定
                this.handlePlayerAction('stairs_down', undefined, 'system');
            } else {
                this.handlePlayerAction('wait', undefined, 'system');
            }
            return;
        }

        // Intercept inputs if inventory is open (except toggle)
        // B-1b：鉴定目标待选期间同样封锁（双保险；待选时 isInventoryOpen 恒 true）
        if (this.isInventoryOpen || this.pendingIdentify) {
            return;
        }

        // Any manual action interrupts auto-pathing
        this.autoPath = [];
        this.everSeenMonsters.clear();
        this.everSeenItems.clear();

        // P1-42：主动搜索命令（CE manualSearch，Time.c:2395-2430）。
        // 键位挂接被搁置：CE SEARCH_KEY='s'（Rogue.h:1177）与 web 既有
        // 's'=向下移动冲突（Input.ts），任务书明令冲突时只报告、不擅自改键位。
        // 引擎侧动作名定为 'search'；UI 键位决定后一行 Input.ts 即可接上
        // （onActionCallback('search')）。
        if (action === 'search') {
            this.manualSearch();
            return;
        }

        if (action === 'move' || action === 'wait') {
            let dx = 0, dy = 0;
            let spentTurn = false;

            if (action === 'move' && typeof data === 'number') {
                const dir = data as Direction;
                if (dir === Direction.UP) { dx = 0; dy = -1; }
                else if (dir === Direction.DOWN) { dx = 0; dy = 1; }
                else if (dir === Direction.LEFT) { dx = -1; dy = 0; }
                else if (dir === Direction.RIGHT) { dx = 1; dy = 0; }
                else if (dir === Direction.UPLEFT) { dx = -1; dy = -1; }
                else if (dir === Direction.UPRIGHT) { dx = 1; dy = -1; }
                else if (dir === Direction.DOWNLEFT) { dx = -1; dy = 1; }
                else if (dir === Direction.DOWNRIGHT) { dx = 1; dy = 1; }
            } else if (action === 'move' && typeof data === 'object' && data !== null) {
                const delta = data as { x?: number; y?: number };
                dx = delta.x || 0;
                dy = delta.y || 0;
            }

            if (action === 'move' && (!Number.isInteger(dx) || !Number.isInteger(dy)
                || Math.abs(dx) > 1 || Math.abs(dy) > 1 || (!dx && !dy))) return;
            if (action === 'move' && this.player.hasStatus('confused')) {
                // CE Movement.c:1097-1138 / randValidDirectionFrom(false):
                // all physically legal directions, including occupied/hazard cells.
                const choices = ENTRANCEMENT_DIRECTIONS.filter(([x,y]) => {
                    const at = { x: this.player.loc.x+x, y: this.player.loc.y+y };
                    return entrancementPassable(this.grid, at, false)
                        && !entrancementDiagonalBlocked(this.grid, this.player.loc, at);
                });
                if (!choices.length) return;
                if (!this.player.hasStatus('levitating') && !this.player.hasStatus('flying') && !this.player.hasStatus('immune_fire')
                    && choices.some(([x,y]) => {
                        const cell = this.grid.getCell(this.player.loc.x+x, this.player.loc.y+y)!;
                        return cell.hasMemory && cell.layers.includes(TerrainType.LAVA)
                            && !(cellTerrainFlags(this.grid, this.player.loc.x+x, this.player.loc.y+y) & T_ENTANGLES)
                            && !this.getMonsterAt(this.player.loc.x+x, this.player.loc.y+y);
                    }) && !this.requestConfirm(i18next.t('bolt.confused_lava', { defaultValue: 'Risk stumbling into lava?' }))) return;
                [dx,dy] = choices[rng.randRange(0, choices.length-1)]!;
            }

            if ((dx !== 0 || dy !== 0) && !this.player.hasStatus('confused') && this.player.hasStatus('hallucinating') && rng.randPercent(35)) {
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

                // CE Movement.c:1147-1161: bump the first obstructing
                // PLAYER_ENTRY layer without moving into the wall.
                if ((!blockingMonster || blockingMonster.isAlly || !this.canObserveBoltTarget(blockingMonster))
                    && promoteOnPlayerBump(this.grid, newX, newY, () => {
                        if (this.grid.getCell(newX, newY)?.layers.includes(TerrainType.WALL_LEVER)) {
                            logger.log(i18next.t('machine.lever_pulled', { defaultValue: 'The lever moves.' }), '#cccccc');
                        }
                    })) {
                    this.needsRender = true;
                    timeSystem.currentTick += this.player.movementSpeed;
                    this.playerTurnEnded();
                    return;
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
                    this.moveEntrancedMonsters(dx, dy);
                    spentTurn = true;
                    if (this.player.ticksUntilTurn !== -1) timeSystem.currentTick += this.player.attackSpeed;
                } else if (blockingMonster) {
                    // Attack —— P4-7：CE Movement.c:1216-1247，buildHitList
                    // （sweep = 武器带 ITEM_ATTACKS_ALL_ADJACENT，Combat.c:2049-2090）
                    // + 攻击循环（循环内复查目标存活，对应 CE MB_IS_DYING 复查）。
                    if (this.playerVomitAttempt()) return;
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
                    this.moveEntrancedMonsters(dx, dy);
                    spentTurn = true;
                    if (this.player.ticksUntilTurn !== -1) timeSystem.currentTick += this.player.attackSpeed;
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
                    spentTurn = true;
                    timeSystem.currentTick += this.player.movementSpeed;
                    this.moveEntrancedMonsters(dx, dy);
                } else if (this.grid.getCell(newX, newY)?.layers.includes(TerrainType.LOCKED_DOOR) // F-1 跨层判定
                    || this.grid.getCell(newX, newY)?.layers.includes(TerrainType.MONSTER_CAGE_CLOSED)
                    || this.grid.getCell(newX, newY)?.layers.includes(TerrainType.ALTAR_CAGE_CLOSED)) {
                    // V-2b-6：钥匙真实化（CE Movement.c:1160-1206 的 bump-to-unlock
                    // + Items.c:4036 keyMatchesLocation / 4051 keyInPackFor +
                    // Movement.c:616-656 useKeyAt 的 disposable 收口）。锁与笼共用
                    // 一条通路：LOCKED_DOOR 与 MONSTER_CAGE_CLOSED 都带
                    // TM_PROMOTES_WITH_KEY，钥匙按「坐标或机器号」匹配——
                    // 不再是"任意钥匙开任意锁"。
                    const keyCell = this.grid.getCell(newX, newY)!;
                    const isCage = keyCell.layers.includes(TerrainType.MONSTER_CAGE_CLOSED);
                    const isItemCage = keyCell.layers.includes(TerrainType.ALTAR_CAGE_CLOSED);
                    const keyItem = this.keyInPackFor(newX, newY, keyCell);
                    if (keyItem) {
                        // CE Movement.c:636-656：只有匹配条目（同坐标或同机器）
                        // 带 disposableHere 才消耗钥匙。缺省 true —— 旧存档里
                        // V-2b-6 前的绑定无该字段，行为与旧 web（恒消耗）一致。
                        const entry = this.keyMatchingEntry(keyItem, newX, newY, keyCell);
                        const disposable = entry?.disposableHere ?? true;
                        if (disposable) {
                            this.player.inventory.removeItem(keyItem);
                        }
                        if (isCage) {
                            // CE DF_MONSTER_CAGE_OPENS（Globals.c:927）：
                            // 笼锁打开 → MONSTER_CAGE_OPEN。
                            this.grid.setTerrain(newX, newY, TerrainType.MONSTER_CAGE_OPEN, '|', 0x999999);
                            logger.log(i18next.t('cage.unlocked', { defaultValue: 'You unlock the cage with a key.' }), '#88ff88');
                        } else {
                            // CE useKeyAt: the key promotes the actual layer through the DF transaction.
                            promoteLayersWithMechFlag(this.grid, newX, newY, TM_PROMOTES_WITH_KEY);
                            logger.log(i18next.t('door.unlocked', { defaultValue: 'You unlock the door with a key.' }), '#88ff88');
                        }

                        // The cage promotion releases its captive through the same
                        // relation transition used by magical rescue.
                        if (isCage) for (const m of this.monsters) {
                            if (m.isCaged) {
                                // Cage interior is 1 step away from the door
                                const dist = Math.max(Math.abs(m.loc.x - newX), Math.abs(m.loc.y - newY));
                                if (dist <= 2) {
                                    this.freeCaptive(m);
                                    this.spawnFloatingText(i18next.t('combat.ally_float', { defaultValue: 'Ally!' }), m.loc.x, m.loc.y, 0x88ff88);
                                }
                            }
                        }

                        if (isItemCage && !this.getMonsterAt(newX, newY)) {
                            // CE Movement.c:1166: a matching key permits entering
                            // the cage; the key remains on that tile in the pack.
                            this.player.loc = { x: newX, y: newY };
                            this.handleSpecialTileEntry();
                        }
                        this.needsRender = true;
                        spentTurn = true;
                        timeSystem.currentTick += this.player.movementSpeed;
                    } else {
                        // CE LOCKED_DOOR 的 flavor（Globals.c:331 描述列）：
                        // "you search your pack but do not have a matching key"
                        // ——有钥匙但都不认这把锁时按 CE 口径提示（收口后的
                        // 主路径：拿错钥匙/跨层钥匙不再被静默吞掉）。
                        const hasAnyKey = this.player.inventory.items.some(
                            (i: import('../Items/Item').Item) => i.category === ItemCategory.KEY
                        );
                        if (hasAnyKey) {
                            logger.log(i18next.t('door.no_matching_key', { defaultValue: 'You search your pack but do not have a matching key.' }), '#ffaa88');
                        } else {
                            logger.log(i18next.t('door.locked', { defaultValue: 'The door is locked. You need a key.' }), '#ffaa88');
                        }
                        this.needsRender = true;
                    }
                } else if (this.grid.getCell(newX, newY)?.layers.includes(TerrainType.ALTAR)) { // F-1 跨层判定
                    const altarItemIdx = this.items.findIndex(i => i.loc.x === newX && i.loc.y === newY);
                    if (altarItemIdx > -1) {
                        const altarItem = this.items[altarItemIdx]!;
                        if (this.player.inventory.addItem(altarItem)) {
                            logger.log(i18next.t('item.pickup_altar', { name: altarItem.displayName, defaultValue: `You claim ${altarItem.displayName} from the altar.` }), '#ffffaa');
                            this.items.splice(altarItemIdx, 1);

                            // V-2b-4：删除 web 自创的「取物塌陷同组祭坛」机制
                            //（原 3189-3214 行）。CE 完全没有祭坛分组概念
                            //（Rogue.h 全库零命中 altarGroupId / MF_ALTAR_GROUP），
                            // 该玩法依赖的 Cell.altarGroupId 与 MF_ALTAR_GROUP
                            // 旗标已同轮拆除。取物本身的行为（入包、日志、耗时）
                            // 逐字保留——CE Movement.c 的取物就是普通的
                            // "inventory 收了就收"，收满 movementSpeed。

                            this.needsRender = true;
                            // CE 无祭坛取物优惠耗时：与普通移动一样收满 movementSpeed
                            spentTurn = true;
                            timeSystem.currentTick += this.player.movementSpeed;
                        } else {
                            logger.log(i18next.t('game.inventory_full', { defaultValue: 'Your inventory is full.' }), '#ff8888');
                        }
                    } else {
                        // Empty altar is walkable
                        if (this.playerStruggle(dx, dy)) return;
                        if (this.playerVomitAttempt()) return;
                        this.player.loc.x = newX;
                        this.player.loc.y = newY;
                        this.moveEntrancedMonsters(dx, dy);
                        this.needsRender = true;
                        spentTurn = true;
                        timeSystem.currentTick += this.player.movementSpeed;
                        this.handleSpecialTileEntry();
                    }
                } else if (this.canMoveTo(newX, newY)
                    || (this.grid.getCell(newX, newY)?.layers.some(isDeepWater)
                        && !this.grid.getCell(newX, newY)?.layers.some(blocksPassability))) {
                    // C-5：CE Movement.c:1303-1322——踩**已发现**的渊格前的确认。
                    // 前置条件逐条照抄：目标格已发现（DISCOVERED|MAGIC_MAPPED）、
                    // 玩家非悬浮（STATUS_LEVITATING<=1）、非混乱（STATUS_CONFUSED）、
                    // 目标带 T_AUTO_DESCENT、(未被缠 || TM_PROMOTES_ON_PLAYER_ENTRY)、
                    // 非 TM_IS_SECRET。拒绝即取消按键（cancelKeystroke）——不移动、
                    // 不耗回合。未知渊格无提示（蒙眼跳坑是 CE 原味）。
                    if (this.diveConfirmationNeeded(newX, newY)
                        && !this.requestConfirm(i18next.t('fall.confirm', { defaultValue: 'Dive into the depths?' }))) {
                        return;
                    }
                    if (this.playerStruggle(dx, dy)) return;

                    // B-1：CE Movement.c:1368-1400 —— 突进/连枷目标在移动
                    // 【前】收集（连枷判据需要移动前坐标；突进看移动方向两格
                    // 之外），移动【后】结算（Movement.c:1480-1492）。
                    // 挣扎出网的 return 分支在上面：没动成就没有移动攻击。
                    if (this.playerVomitAttempt()) return;
                    // CE Movement.c:1432-1441 intercepts the actual stair
                    // coordinates before ordinary entry. Otherwise the newly
                    // live REPEL_CREATURES transaction ejects the player before
                    // the stair command can ever be used.
                    const levelStairs = this.levelSeeds?.[this.depth - 1];
                    const destination = this.grid.getCell(newX, newY)!;
                    const descending = levelStairs?.downStairsLoc.x === newX && levelStairs.downStairsLoc.y === newY
                        && destination.layers.some(t => t === TerrainType.STAIRS_DOWN || t === TerrainType.DUNGEON_PORTAL);
                    const ascending = levelStairs?.upStairsLoc.x === newX && levelStairs.upStairsLoc.y === newY
                        && destination.layers.includes(TerrainType.STAIRS_UP);
                    if (descending || ascending) {
                        const origin = { ...this.player.loc }, oldDepth = this.depth;
                        this.player.loc = { x: newX, y: newY };
                        this.handlePlayerAction(descending ? 'stairs_down' : 'stairs_up', undefined, 'system');
                        if (this.depth === oldDepth) this.player.loc = origin;
                        return;
                    }
                    const specialTargets = this.buildLungeFlailHitList(dx, dy, newX, newY);

                    // Move
                    this.player.loc.x = newX;
                    this.player.loc.y = newY;
                    this.moveEntrancedMonsters(dx, dy);
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
                        spentTurn = true;
                        if (this.player.ticksUntilTurn !== -1) timeSystem.currentTick += this.player.attackSpeed;
                        this.playerRecoversFromAttacking(anySpecialHit);
                    } else {
                        // CE 的玩家移动耗时与地形无关（Time.c:2604 只看 movementSpeed）；
                        // web 原有的"泥泞 ×2"为自创口径，按 D1 移除。
                        spentTurn = true;
                        timeSystem.currentTick += this.player.movementSpeed;
                    }

                    this.handleSpecialTileEntry();

                    // C-5：CE Movement.c:1474-1476——移动完成后站在渊格上只置
                    // MB_IS_FALLING，坠落由紧随其后的 playerTurnEnded 顶部结算
                    //（CE Time.c:2480-2486），不是踩上瞬间。
                    if (this.creatureShouldFall(this.player)) {
                        this.playerFalling = true;
                    }
                }

                if (spentTurn) {
                    this.playerTurnEnded();
                }

            } else {
                // rest
                this.justRested = true; // P4-8 返工：CE rogue.justRested（IO.c:2521-2524）
                spentTurn = true;
                timeSystem.currentTick += this.player.movementSpeed;
                this.playerTurnEnded();
            }
        } else if (action === 'pickup') {
            const itemIndex = this.items.findIndex(i => i.loc.x === this.player.loc.x && i.loc.y === this.player.loc.y);
            if (itemIndex > -1) {
                const item = this.items[itemIndex]!;
                const cell = this.grid.getCell(this.player.loc.x, this.player.loc.y);

                const isFlying = this.player.hasStatus('flying') || this.player.hasStatus('levitating');
                // F-1 跨层判定：火盖在深水/岩浆上不改变"够不着"判据
                if (cell && cell.layers.includes(TerrainType.WATER_DEEP) && !isFlying) {
                    logger.log(i18next.t('item.deep_water_reach', { defaultValue: `The ${item.name} is deep underwater.` }), '#aaaaaa');
                    return;
                }
                if (cell && cell.layers.includes(TerrainType.LAVA) && !isFlying && !this.player.hasStatus('immune_fire')) {
                    logger.log(i18next.t('item.lava_reach', { defaultValue: `The ${item.name} is submerged in lava.` }), '#ff4444');
                    return;
                }

                if (item.category === ItemCategory.GOLD || this.player.inventory.addItem(item)) {
                    // B-4b：金币拾取按堆叠数量入账（CE Items.c:781 同口径——
                    // 生成堆的 quantity 在生成时掷出；原 +10 硬编码是占位）。
                    if (item.category === ItemCategory.GOLD) {
                        this.stats.gold += item.quantity;
                    }
                    logger.log(i18next.t('item.pickup', { name: item.displayName, defaultValue: `You picked up ${item.displayName}.` }), '#ffffff');
                    this.items.splice(itemIndex, 1);
                    // C-4c：TM_PROMOTES_ON_ITEM_PICKUP（CE Items.c:819-829
                    // removeItemAt）。当前 31 地形零载体，调用为结构性忠实；
                    // 实际触发数见 c_4c 报告（0）。
                    for (const r of promoteOnItemPickup(this.grid, this.player.loc.x, this.player.loc.y)) {
                        if (r.mutated) this.needsRender = true;
                    }
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
        if (this.player.equip(item, false)) {
            logger.log(i18next.t('item.equip', { name: item.name, defaultValue: `You equipped the ${item.name}.` }), '#88ff88');
            // B-1a：CE Items.c:8583-8586——clairvoyance/light/stealth 三戒指戴上
            // 即 identifyItemKind（效果立即可感，无隐藏价值；web 无 light 戒指，
            // 清单在 ItemLoader.INSTANT_ID_RING_KINDS）。CE 无消息，静默亮。
            if (item.category === ItemCategory.RING
                && ItemLoader.isInstantIdentifyRing(item)
                && !(ItemLoader.identifiedItems.has((item as any).identityId))) {
                ItemLoader.identifyItemKind(item);
            }
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
        if (this.player.inventory.items.includes(item)) {
            // CE dropItem peels one food/potion/scroll, but drops an entire
            // throwing-weapon stack. The peeled copy needs its own entity ID.
            const peel = item.quantity > 1 && item.category !== ItemCategory.WEAPON;
            let dropped = item;
            if (peel) {
                const copy = new Item(item.name, item.char, item.color, item.category);
                dropped = Object.assign(copy, item, { id: copy.id, quantity: 1 });
                item.quantity--;
            } else {
                this.player.inventory.removeItem(item);
                this.player.unequip(item);
                this.syncEquipmentStatuses();
            }
            dropped.loc = { x: this.player.loc.x, y: this.player.loc.y };
            this.items.push(dropped);
            // C-4c：TM_PROMOTES_ON_ITEM（CE Items.c:1278-1286，物品落格时）。
            // 当前 31 地形零载体，调用为结构性忠实；实际触发数 0（报告）。
            for (const r of promoteOnItemPlaced(this.grid, this.player.loc.x, this.player.loc.y)) {
                if (r.mutated) this.needsRender = true;
            }
            logger.log(i18next.t('item.drop', { name: item.name, defaultValue: `Dropped ${item.name}.` }), '#aaaaaa');
            this.needsRender = true;
            // CE Items.c:8390 drop() 以 playerTurnEnded() 收尾——完整回合
            timeSystem.currentTick += this.player.movementSpeed;
            this.playerTurnEnded();
        }
    }

    // ===== B-1c：detect magic 极性揭示（CE Items.c:8027-8038 / 8137-8185）=====

    /**
     * 等待玩家确认的"恶意品使用"目标（CE 的 confirm() 是阻塞模态，web 没有；
     * 沿用 B-1b 的 pendingIdentify 同款待决态，由 InventoryOverlay 轮询渲染）。
     * null = 无待决。
     */
    public pendingUseConfirm: Item | null = null;

    /**
     * CE Items.c:8050-8052（喝）与 7757-7759（读）的前置条件，逐字复刻：
     *     magicCharDiscoverySuffix(category, kind) == -1
     *     && ((flags & ITEM_MAGIC_DETECTED) || kindTable.identified)
     * 语义：**只有当玩家已经有理由知道这是坏东西时**才拦一道。两个析取项
     * 缺一不可——
     *  - 漏掉 `== -1`：连生命药水都要确认；
     *  - 漏掉后半段：从没鉴定过、也没被 detect magic 照过的未知瓶子被提前
     *    剧透"这是坏东西"（反泄露，B-1a §2.3 同一类错误）。
     * 注意后半段读的是**实例**旗标 magicDetected，不是种类级的
     * magicPolarityRevealed——CE 在这里刻意用实例粒度。
     */
    public requiresMalevolentUseConfirmation(item: Item): boolean {
        if (ItemLoader.magicCharDiscoverySuffix(item) !== -1) return false;
        const kindId = (item as any).consumableId as string | undefined;
        const kindIdentified = !!kindId && ItemLoader.identifiedItems.has(kindId);
        return item.magicDetected || kindIdentified;
    }

    /** 待决确认的提示文案（CE 的两种 sprintf，Items.c:8054-8058 / 7761-7765）。 */
    public malevolentUseConfirmPrompt(item: Item): string {
        const kindId = (item as any).consumableId as string | undefined;
        const kindIdentified = !!kindId && ItemLoader.identifiedItems.has(kindId);
        const name = item.displayName;
        if (item.category === ItemCategory.SCROLL) {
            return kindIdentified
                ? i18next.t('item.confirm_read_known', { name, defaultValue: `Really read a scroll of ${name}?` })
                : i18next.t('item.confirm_read_cursed', { defaultValue: 'Really read a cursed scroll?' });
        }
        return kindIdentified
            ? i18next.t('item.confirm_drink_known', { name, defaultValue: `Really drink a potion of ${name}?` })
            : i18next.t('item.confirm_drink_cursed', { defaultValue: 'Really drink a cursed potion?' });
    }

    /** 玩家点"确认"：重入使用路径（CE confirm() 返回 true 后继续原函数）。 */
    public confirmPendingUse(): boolean {
        const target = this.pendingUseConfirm;
        if (!target) return false;
        this.pendingUseConfirm = null;
        if (target.category === ItemCategory.SCROLL) {
            this.readItem(target, true);
        } else {
            this.quaffItem(target, true);
        }
        return true;
    }

    /** 玩家点"取消"：CE `return false`——不消耗物品、不推进回合。 */
    public cancelPendingUse(): void {
        this.pendingUseConfirm = null;
    }

    /**
     * 共用的确认闸：需要确认且尚未确认时挂起待决态并返回 true（调用方立即
     * 返回，不消耗物品也不推进回合，对齐 CE 的 `return false`）。
     */
    private gateMalevolentUse(item: Item, confirmed: boolean): boolean {
        if (confirmed || !this.requiresMalevolentUseConfirmation(item)) {
            this.pendingUseConfirm = null;
            return false;
        }
        this.pendingUseConfirm = item;
        logger.log(this.malevolentUseConfirmPrompt(item), '#ffcc44');
        this.needsRender = true;
        return true;
    }

    /**
     * CE POTION_DETECT_MAGIC（Items.c:8137-8185）。三轮遍历 + 收口：
     *  1. 本层地面物品（CAN_BE_DETECTED）→ detectMagicOnItem；有极性的记
     *     hadEffectOnLevel。CE 还会给格子打 pmap ITEM_DETECTED（:8144）供
     *     地面 sigil 渲染——web 的 Grid.Cell 无此旗标且渲染层不在本轮边界内，
     *     留痕测试钉住（b_1c_detect_magic.test.ts 尾部）；
     *  2. 怪物携带品——**web 无载体**：Creature/Monster 没有 carriedItem 字段
     *     （全库 grep 零命中），CE 的这一轮在 web 结构性缺席，登记在报告；
     *  3. 背包物品 → detectMagicOnItem；有极性且不是药水自己的记 hadEffectOnPack
     *     （CE :8164 "Don't allow the potion of detect magic to detect itself"）；
     *  4. 有任何效果 → tryIdentifyLastItemKinds(HAS_INTRINSIC_POLARITY) + 三选一
     *     的"感到魔法气息"消息；否则报"感到没有魔法"。
     *
     * ★ 零掷骰：全程只读写状态，不碰 rng（任务书 §四硬门禁，哨兵 S1 钉住）。
     */
    private applyDetectMagic(theItem: Item): void {
        let hadEffectOnLevel = false;
        let hadEffectOnPack = false;

        for (const floorItem of this.items) {
            if (!ItemLoader.CAN_BE_DETECTED.has(floorItem.category)) continue;
            ItemLoader.detectMagicOnItem(floorItem);
            if (ItemLoader.itemMagicPolarity(floorItem) !== 0) {
                hadEffectOnLevel = true;
            }
        }

        for (const packItem of this.player.inventory.items) {
            if (!ItemLoader.CAN_BE_DETECTED.has(packItem.category)) continue;
            ItemLoader.detectMagicOnItem(packItem);
            if (ItemLoader.itemMagicPolarity(packItem) !== 0 && packItem !== theItem) {
                hadEffectOnPack = true;
            }
        }
        // CE 里被喝的药水此刻**仍在** packItems 里（consumePackItem 在 switch 之后），
        // 因此它自己也会被 detectMagicOnItem 照到（只是不计入 hadEffectOnPack）。
        // web 的 quaffItem 在进入效果前就把它移出了背包，这里显式补上这一次调用，
        // 保持"喝完之后该种类的极性已揭示"与 CE 一致。
        if (ItemLoader.CAN_BE_DETECTED.has(theItem.category)) {
            ItemLoader.detectMagicOnItem(theItem);
        }

        if (hadEffectOnLevel || hadEffectOnPack) {
            ItemLoader.tryIdentifyLastItemKindsAllPolarityCategories();
            if (hadEffectOnLevel && hadEffectOnPack) {
                logger.log(i18next.t('potion.detect_magic', { defaultValue: 'you can somehow feel the presence of magic on the level and in your pack.' }), '#aaaaff');
            } else if (hadEffectOnLevel) {
                logger.log(i18next.t('potion.detect_magic_level', { defaultValue: 'you can somehow feel the presence of magic on the level.' }), '#aaaaff');
            } else {
                logger.log(i18next.t('potion.detect_magic_pack', { defaultValue: 'you can somehow feel the presence of magic in your pack.' }), '#aaaaff');
            }
        } else {
            logger.log(i18next.t('potion.detect_magic_none', { defaultValue: 'you can somehow feel the absence of magic on the level and in your pack.' }), '#aaaaff');
        }
    }

    public quaffItem(item: Item, confirmed: boolean = false) {
        if (item.category !== ItemCategory.POTION) return;
        // B-1c：CE Items.c:8050-8060——恶意且玩家已知时先 confirm，取消即
        // `return false`（不消耗药水、不推进回合）。
        if (this.gateMalevolentUse(item, confirmed)) return;

        // Remove from inventory
        if (consumeForUse(this.player, item)) {
            const trueId = (item as any).consumableId;
            const data = ItemLoader.potions.find(p => p.id === trueId);

            if (data) {
                // Log what we are drinking before we might identify it
                const quaffedName = item.displayName;
                logger.log(i18next.t('potion.quaff', { name: quaffedName, defaultValue: `You quaff the ${quaffedName}.` }), '#cccccc');

                // Execute effect
                switch (data.effect) {
                    case 'heal_full': {
                        const oldMaxHp = this.player.maxHp;
                        const wasInjured = this.player.hp < oldMaxHp;
                        this.player.maxHp += 10; // CE POTION_LIFE range {10,10,0}
                        this.player.hp = this.player.maxHp;
                        for (const status of ['hallucinating', 'confused', 'nauseous', 'slowed'] as const) {
                            if (this.player.getStatusDuration(status) > 1) this.player.setStatusDuration(status, 1);
                        }
                        if (this.player.getStatusDuration('weakened') > 1) this.player.setStatusDuration('weakened', 0);
                        this.player.setStatusDuration('poisoned', 0);
                        this.player.setStatusDuration('darkness', 0);
                        this.updateVision();
                        const percent = Math.floor(this.player.maxHp * 100 / oldMaxHp) - 100;
                        logger.log(wasInjured
                            ? i18next.t('potion.life_healed', { percent, defaultValue: `You heal completely and your maximum health increases by ${percent}%.` })
                            : i18next.t('potion.life_max', { percent, defaultValue: `Your maximum health increases by ${percent}%.` }), '#44ff44');
                        break;
                    }
                    case 'heal_partial':
                        this.player.hp = Math.min(this.player.hp + Math.floor(this.player.maxHp / 2), this.player.maxHp);
                        logger.log(i18next.t('potion.heal_partial', { defaultValue: 'You feel slightly better.' }), '#44ff44');
                        break;
                    case 'gain_strength':
                        this.createFlare(this.player.loc.x, this.player.loc.y, LightKind.POTION_STRENGTH_LIGHT);
                        this.player.strength += 1;
                        if (this.player.hasStatus('weakened')) this.player.setStatusDuration('weakened', 1);
                        this.player.weaknessAmount = 0;
                        logger.log(i18next.t('potion.strength', { defaultValue: 'You feel stronger!' }), '#ff4444');
                        break;
                    case 'fall_down':
                        // C-5（吸收 P1-22）：CE Items.c:8095-8100 POTION_DESCENT——
                        // 原地铺 DF_HOLE_POTION（HOLE_EDGE 波前 + subsequentDF
                        // DF_HOLE_2 落 HOLE），非悬浮则置 MB_IS_FALLING；坠落由
                        // 本动作末尾的 playerTurnEnded（Items.c:7633 apply() 收口）
                        // 顶部结算。悬浮时洞照开、人不坠（CE 原味）。
                        logger.log(i18next.t('potion.descent', { defaultValue: 'The floor opens beneath you!' }), '#ff8844');
                        {
                            const hole = catalogFeature(DF.DF_HOLE_POTION);
                            spawnDungeonFeature(this.grid, this.player.loc.x, this.player.loc.y, hole, false);
                        }
                        if (!this.player.hasStatus('levitating')) {
                            this.playerFalling = true;
                        }
                        break;
                    case 'fire_burst':
                        logger.log(i18next.t('potion.fire_burst', { defaultValue: 'Flames burst out of the bottle!' }), '#ffaa00');
                        // F-2a：CE 焚化类药水是 DF 生成家族（DF_INCINERATION_POTION
                        // {PLAIN_FIRE, SURFACE, 100, 37}，Globals.c:781——火地形
                        // 直接铺上，不看底下可不可燃），走 igniteForced。
                        this.environment.igniteForced(this.player.loc.x, this.player.loc.y);
                        this.environment.igniteForced(this.player.loc.x + 1, this.player.loc.y);
                        this.environment.igniteForced(this.player.loc.x - 1, this.player.loc.y);
                        break;
                    case 'poison_burst':
                        logger.log(i18next.t('potion.poison_burst', { defaultValue: 'A toxic cloud billows around you!' }), '#88ff88');
                        // G-1 量纲折算：70（旧 0-100 密度）→ 1000 =
                        // DF_POISON_GAS_CLOUD_POTION 的 startProbability
                        // （Globals.c:779；半径 4 的铺展由体积扩散自然长出）。
                        this.environment.addGas(this.player.loc.x, this.player.loc.y, GasType.POISON, 1000);
                        break;
                    case 'confusion_burst':
                        this.environment.addGas(this.player.loc.x, this.player.loc.y, GasType.CONFUSION, 1000);
                        logger.log(i18next.t('potion.confusion_burst', { defaultValue: 'A shimmering cloud of rainbow-colored gas billows out of the open flask!' }), '#cc99ff');
                        break;
                    case 'paralyze_burst':
                        // G-3：CE 喝麻痹药水不是直上状态，而是原地爆出麻痹
                        // 气云（Items.c:8117-8120 → DF_PARALYSIS_GAS_CLOUD_
                        // POTION，Globals.c:778 {PARALYSIS_GAS, GAS, 1000}；
                        // 扔掷同款 Items.c:6994-6997）。玩家自己站在云里，
                        // 由气体效果判定上 STATUS_PARALYZED（max(…,20)，
                        // Time.c:493-495）——"自食其果"是 CE 原味。云体积
                        // 1000（G-1 折算口径同毒药水）；CE 的 &pink 光效
                        // 半径 4 属渲染列，web 无光效列，登记不迁移。
                        // 既有 key 的文案（"你被定身了！"）描述的正是随后
                        // 到来的麻痹结局，沿用（仅增键边界的折中，见报告）。
                        logger.log(i18next.t('potion.paralyze_burst', { defaultValue: 'You are frozen in place!' }), '#cc99ff');
                        this.environment.addGas(this.player.loc.x, this.player.loc.y, GasType.PARALYSIS, 1000);
                        break;
                    case 'hallucinate_burst':
                        this.player.setStatusDuration('hallucinating', 300);
                        this.player.maxStatus.hallucinating = 300;
                        logger.log(i18next.t('potion.hallucinate_burst', { defaultValue: 'The world transforms into a swirling kaleidoscope of colors!' }), '#cc99ff');
                        break;
                    case 'creeping_death':
                        // CE POTION_LICHEN 是地衣 DF，不是气体。U17 补齐
                        // DF_LICHEN_PLANTED 的扩散/接触副作用前维持退池。
                        logger.log(i18next.t('potion.creeping_death', { defaultValue: 'A handful of tiny spores burst out of the open flask!' }), '#88ff88');
                        break;
                    case 'resist_fire':
                        // P1-44 修复（F-2b）：CE POTION_FIRE_IMMUNITY（Items.c:8188-8193）——
                        // status[IMMUNE_TO_FIRE] = magnitude（randClump(range)，
                        // GlobalsBrogue.c:672 火免药水 range={150,150,0} ⇒ 恒 150），
                        // 且若正在燃烧立即扑灭。原实现 grantTemporaryImmunity
                        // ('burning' as any, 50) 三重断线：'burning' 不在 StatusId
                        // 联合；temporaryImmunities 全库唯一读者是近战 on-hit 状态
                        // （applyMonsterOnHitStatus）；火焰伤害查的是 immune_fire
                        // 状态——药水实际什么都没做（时长 50 同为自创，一并按 CE
                        // 翻正；相邻药水的同族时长漂移登记给物品表轮）。
                        this.applyTimedStatus(this.player, 'immune_fire', 150);
                        this.player.maxStatus.immune_fire = 150;
                        if (this.burningDuration(this.player) > 0) {
                            this.extinguishCreatureFire(this.player);
                        }
                        logger.log(i18next.t('potion.resist_fire', { defaultValue: 'You feel comfortably cool.' }), '#88ccff');
                        break;
                    case 'become_invisible':
                        this.player.setStatusDuration('invisible', 75);
                        this.player.maxStatus.invisible = 75;
                        logger.log(i18next.t('potion.become_invisible', { defaultValue: 'You fade perfectly into the shadows.' }), '#aaaaaa');
                        break;
                    case 'levitate':
                        this.player.setStatusDuration('levitating', 100);
                        this.player.maxStatus.levitating = 100;
                        logger.log(i18next.t('potion.levitate', { defaultValue: 'You float gently into the air.' }), '#aaaaff');
                        break;
                    case 'telepathy':
                        this.player.setStatusDuration('telepathy', 300);
                        this.player.maxStatus.telepathy = 300;
                        logger.log(i18next.t('potion.telepathy', { defaultValue: 'Your mind expands outwardly.' }), '#aaaaff');
                        break;
                    case 'speed':
                        this.player.setStatusDuration('slowed', 0);
                        this.player.setStatusDuration('haste', 25);
                        this.player.maxStatus.haste = 25;
                        logger.log(i18next.t('potion.speed', { defaultValue: 'Everything around you seems to slow down.' }), '#ffffaa');
                        break;
                    case 'darkness':
                        this.player.applyStatus('darkness', 400);
                        this.updateVision();
                        logger.log(i18next.t('potion.darkness', { defaultValue: 'Your vision flickers as a cloak of darkness settles around you!' }), '#aaaaaa');
                        break;
                    case 'detect_magic':
                        // B-1c：CE Items.c:8137-8185 POTION_DETECT_MAGIC
                        this.applyDetectMagic(item);
                        break;
                    default:
                        logger.log(i18next.t('potion.unknown', { defaultValue: 'It tastes weird.' }), '#aaaaaa');
                        break;
                }

                if (!ItemLoader.identifiedItems.has(trueId)) {
                    // B-1a：CE Items.c:8199-8205 喝药水 autoIdentify（种类亮），
                    // 经 identifyItemKind 走"最后一种类升格"联动。
                    ItemLoader.identifyItemKind(item);
                    logger.log(i18next.t('item.identified_as', { name: item.name, defaultValue: `It was a ${item.name}!` }), '#00ffff');
                }
            }

            this.needsRender = true;
            // CE Items.c:7633 apply()：POTION 分支后统一 playerTurnEnded()——完整回合
            finishItemUse(this.player, () => this.playerTurnEnded());
        }
    }

    public eatItem(item: Item): void {
        if (this.isInputLocked() || this.isGameOver || this.player.hp <= 0
            || this.player.hasStatus('paralyzed')) return;
        if (!this.consumeFood(item, true)) return;
        // CE Items.c:7633 apply()：FOOD 分支后统一 playerTurnEnded()。
        timeSystem.currentTick += this.player.movementSpeed;
        this.playerTurnEnded();
    }

    /** CE Items.c:7477-7505; automatic eating uses the same nutrition and message path. */
    private consumeFood(item: Item, confirm: boolean): boolean {
        if (item.category !== ItemCategory.FOOD || !this.player.inventory.items.includes(item)) return false;
        const trueId = (item as Item & { consumableId?: string }).consumableId;
        const data = ItemLoader.food.find(f => f.id === trueId);
        if (!data) return false;
        const nutrition = data.nutrition ?? 0;
        if (confirm && STOMACH_SIZE - this.player.nutrition < nutrition
            && !this.requestConfirm(i18next.t('food.not_hungry_confirm', {
                food: trueId === 'ration_of_food' ? 'food' : 'mango',
                defaultValue: `You're not hungry enough to fully enjoy the ${trueId === 'ration_of_food' ? 'food' : 'mango'}. Eat it anyway?`,
            }))) return false;

        if (!this.player.inventory.consumeOne(item)) return false;
        this.player.nutrition = Math.min(STOMACH_SIZE, this.player.nutrition + nutrition);
        this.player.refreshHungerState();
        logger.log(trueId === 'ration_of_food'
            ? i18next.t('food.ration_tasted', { defaultValue: 'That food tasted delicious!' })
            : i18next.t('food.mango_tasted', { defaultValue: 'My, what a yummy mango!' }), '#44ff44');
        this.needsRender = true;
        return true;
    }

    public readItem(item: Item, confirmed: boolean = false) {
        if (this.pendingEnchantment) return;
        if (item.category !== ItemCategory.SCROLL) return;
        if (!this.player.inventory.items.includes(item)) return;
        if ((item as Item & { consumableId?: string }).consumableId === 'scroll_of_enchantment'
            && (this.isInputLocked() || this.isGameOver || this.player.hp <= 0
                || this.player.hasStatus('paralyzed') || this.pendingIdentify || this.pendingArcana)) return;
        // B-1c：CE Items.c:7757-7767——同款恶意品确认（读卷轴分支）。
        if (this.gateMalevolentUse(item, confirmed)) return;

        if (consumeForUse(this.player, item)) {
            const trueId = (item as any).consumableId;
            const data = ItemLoader.scrolls.find(s => s.id === trueId);

            if (data) {
                const readName = item.displayName;
                logger.log(i18next.t('scroll.read', { name: readName, defaultValue: `You read the ${readName}.` }), '#cccccc');

                // Execute effect
                switch (data.effect) {
                    case 'reveal_map':
                        // Items.c:7945-7971: reveal secret doors, then map only
                        // dungeon/liquid layers of undiscovered non-granite cells.
                        for (let x = 0; x < DCOLS; x++) {
                            for (let y = 0; y < DROWS; y++) {
                                const cell = this.grid.getCell(x, y);
                                if (!cell) continue;
                                if (discoverSecretsAt(this.grid, x, y)) { // CE discover()（Movement.c:2437）
                                    cell.isDiscovered = true;
                                    cell.isExplored = false;
                                }
                                if (cell.isExplored || cell.layers[DungeonLayer.DUNGEON] === TerrainType.GRANITE) continue;
                                const dungeon = cell.layers[DungeonLayer.DUNGEON]!;
                                const liquid = cell.layers[DungeonLayer.LIQUID]!;
                                const mappedFlags = TERRAIN_FLAGS[dungeon].flags | TERRAIN_FLAGS[liquid].flags;
                                cell.rememberedTerrainFlags = mappedFlags;
                                cell.rememberedTMFlags = terrainMechFlags(dungeon) | terrainMechFlags(liquid);
                                cell.isMagicMapped = true;
                                cell.rememberedLayers = [dungeon, liquid, TerrainType.NOTHING, TerrainType.NOTHING];
                                cell.rememberedTerrain = liquid !== TerrainType.NOTHING && DRAW_PRIORITY[liquid] < DRAW_PRIORITY[dungeon] ? liquid : dungeon;
                                cell.rememberedAppearance = memoryTerrainAppearance(cell, this.depth);
                                cell.rememberedFlags = {
                                    passable: (mappedFlags & T_OBSTRUCTS_PASSABILITY) === 0,
                                    opaque: (mappedFlags & T_OBSTRUCTS_VISION) !== 0,
                                    trapFree: (mappedFlags & T_IS_DF_TRAP) === 0,
                                };
                            }
                        }
                        for (let x = 0; x < DCOLS; x++) for (let y = 0; y < DROWS; y++) {
                            const cell = this.grid.getCell(x, y)!;
                            if (!(cellTerrainFlags(this.grid, x, y) & T_IS_DF_TRAP)) cell.knownTrapFree = true;
                        }
                        logger.log(i18next.t('scroll.mapping', { defaultValue: 'You have clairvoyance of the floor!' }), '#aaaaff');
                        break;
                    case 'teleport_random':
                        logger.log(i18next.t('scroll.teleport', { defaultValue: 'You are suddenly teleported!' }), '#ff44ff');
                        // Items.c:7803 SCROLL_TELEPORT: teleport(&player, INVALID_POS, true)
                        this.teleportPlayerRandom();
                        break;
                    case 'identify_item':
                        // B-1a（反驳 B-0 §1.4 表格第 2 行）：CE Items.c:7776-7781——
                        // 读 identify 卷轴先 identify(theItem) 亮自身种类并宣告
                        // "this is a scroll of identify."，然后才让玩家选目标。
                        // enchanting 同样在专属分支提前自亮（Items.c:7817）。
                        // B-1b：目标改为玩家指定（CE promptForItemOfType，
                        // Items.c:7783-7802）；无可鉴物品时 "everything in your
                        // pack is already identified."——两种情况卷轴都照常消耗
                        // （CE "regardless, the scroll is consumed"）。
                        if (!ItemLoader.identifiedItems.has(trueId)) {
                            ItemLoader.identifyItemKind(item);
                        }
                        logger.log(i18next.t('scroll.reveal_identify', { defaultValue: 'This is a scroll of identify.' }), '#00ffff');
                        if (!this.beginIdentifySelection()) {
                            logger.log(i18next.t('scroll.identify_fail', { defaultValue: 'Everything in your pack is already identified.' }), '#aaaaaa');
                        }
                        break;
                    case 'enchant_item':
                        // Items.c:7817-7818: reveal the scroll BEFORE selecting.
                        // The generic auto-ID exclusion below is not "never ID".
                        ItemLoader.identifyItemKind(item);
                        logger.log(i18next.t('scroll.reveal_enchantment', { defaultValue: 'This is a scroll of enchanting.' }), '#00ffff');
                        if (this.player.inventory.items.some(target => this.canEnchantTarget(target))) {
                            this.pendingEnchantment = true;
                            this.isInventoryOpen = true;
                            this.needsRender = true;
                            return; // Complete the read's time AFTER applying the chosen effect.
                        }
                        logger.log(i18next.t('scroll.enchant_fail', { defaultValue: 'Nothing happens.' }), '#aaaaaa');
                        break;
                    case 'remove_curse':
                        if (!this.removeCurseFromInventory()) {
                            logger.log(i18next.t('scroll.remove_curse_empty', { defaultValue: 'No cursed items to cleanse.' }), '#aaaaaa');
                        }
                        break;
                    case 'recharge_item':
                        if (!this.rechargeStaffsAndCharms()) {
                            logger.log(i18next.t('scroll.recharge_item_empty', { defaultValue: 'No staffs or charms to recharge.' }), '#aaaaaa');
                        }
                        break;
                    case 'protect_weapon':
                            this.createFlare(this.player.loc.x, this.player.loc.y, LightKind.SCROLL_PROTECTION_LIGHT);
                        // Items.c:7922-7938 SCROLL_PROTECT_WEAPON
                        this.protectEquippedGear(this.player.equippedWeapon, 'weapon');
                        break;
                    case 'protect_armor':
                            this.createFlare(this.player.loc.x, this.player.loc.y, LightKind.SCROLL_PROTECTION_LIGHT);
                        // Items.c:7906-7921 SCROLL_PROTECT_ARMOR
                        this.protectEquippedGear(this.player.equippedArmor, 'armor');
                        break;
                    case 'negate_burst':
                        // Items.c:8004-8006 SCROLL_NEGATION: negationBlast("the scroll", DCOLS)
                        this.negationBlastFromPlayer('the scroll');
                        break;
                    case 'sanctuary_burst':
                        // Items.c:7941-7943 SCROLL_SANCTUARY: 脚下 DF_SACRED_GLYPHS
                        this.sanctuaryFromPlayer();
                        break;
                    case 'shatter_burst':
                        // Items.c:8007-8010 SCROLL_SHATTERING: 先消息后 crystalize(9)
                        logger.log(i18next.t('scroll.shatter', { defaultValue: 'the scroll emits a wave of turquoise light that pierces the nearby walls!' }), '#40e0d0');
                        this.crystalizeFromPlayer(9);
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

                // B-1a：CE Items.c:8019-8026——卷轴用完即亮种类，例外是
                // enchanting 与 identify（上 case 已提前自亮，此处
                // 跳过避免重复消息）。web id 对齐：scroll_of_enchantment ≙
                // SCROLL_ENCHANTING、scroll_of_identify ≙ SCROLL_IDENTIFY。
                if (!ItemLoader.identifiedItems.has(trueId)
                    && trueId !== 'scroll_of_enchantment'
                    && trueId !== 'scroll_of_identify') {
                    ItemLoader.identifyItemKind(item);
                    logger.log(i18next.t('item.was_a', { name: item.name, defaultValue: `It was a ${item.name}!` }), '#00ffff');
                }
            }

            this.needsRender = true;
            // CE Items.c:7633 apply()：SCROLL 分支后统一 playerTurnEnded()——完整回合
            finishItemUse(this.player, () => this.playerTurnEnded());
        }
    }

    public useArcanaItem(item: Item) {
        if (this.isInputLocked() || this.isGameOver || this.player.hp <= 0 || this.player.hasStatus('paralyzed')
            || this.pendingIdentify || this.pendingEnchantment || this.pendingArcana || !this.player.inventory.items.includes(item)) return;
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

            invokeCharm(this.player, item, identityId, {
                applyTimedStatus: (status, duration) => { this.applyTimedStatus(this.player, status, duration); },
                extinguish: () => this.extinguishCreatureFire(this.player),
                endTurn: () => this.playerTurnEnded(),
            });
            return;
        }

        // CE Items.c:7342: only ITEM_IDENTIFIED makes an empty attempt free.
        // Kind-known and MAX_CHARGES_KNOWN alone do not reveal current charges.
        if ((item.charges ?? 0) <= 0 && item.identified === true) {
            logger.log(i18next.t('arcana.no_charges', { name: item.displayName, defaultValue: '{{name}} has no charges.' }), '#ff8888');
            return;
        }
        if (!getBoltForItem(identityId ?? '')) return;
        const first = this.getArcanaCandidates(item)[0];
        this.pendingArcana = { item, cursor: { ...(first?.loc ?? this.player.loc) } };
        this.isInventoryOpen = false;
        this.isThrowing = false;
        this.throwItemTarget = null;
        this.autoPath = [];
        this.isMouseTraveling = false;
        this.needsRender = true;
    }

    public getArcanaCandidates(item: Item): Monster[] {
        return arcanaTargetCandidates(this.player, this.grid, this.monsters, item);
    }

    public getArcanaPreview() {
        const pending = this.pendingArcana;
        return pending ? blinkTargetPreview(this.grid, this.player, this.monsters, pending.item, pending.cursor) : null;
    }

    public setArcanaTarget(x: number, y: number): boolean {
        if (!this.pendingArcana || this.isInputLocked() || !Number.isInteger(x) || !Number.isInteger(y)
            || !this.grid.isValidPos(x, y)) return false;
        this.pendingArcana.cursor = { x, y };
        this.needsRender = true;
        return true;
    }

    public cycleArcanaTarget(reverse = false) {
        const pending = this.pendingArcana;
        if (!pending || this.isInputLocked()) return;
        const candidates = this.getArcanaCandidates(pending.item);
        if (!candidates.length) return;
        const index = candidates.findIndex(m => m.loc.x === pending.cursor.x && m.loc.y === pending.cursor.y);
        const next = index < 0 ? (reverse ? candidates.length - 1 : 0)
            : (index + (reverse ? -1 : 1) + candidates.length) % candidates.length;
        this.setArcanaTarget(candidates[next]!.loc.x, candidates[next]!.loc.y);
    }

    public cancelArcanaSelection() {
        this.pendingArcana = null;
        this.needsRender = true;
    }

    /** CE Items.c:7368-7440: choose -> resolve/autoID -> spend existing charge
     * -> one movement-speed turn. Initial charges and recharge remain W-5/W-6. */
    public confirmArcanaTarget(): BoltResult | null {
        const pending = this.pendingArcana;
        if (!pending || this.isInputLocked()) return null;
        const { item, cursor } = pending;
        if (this.isGameOver || this.player.hp <= 0 || this.player.hasStatus('paralyzed')
            || !this.player.inventory.items.includes(item)) {
            this.cancelArcanaSelection();
            return null;
        }
        if (cursor.x === this.player.loc.x && cursor.y === this.player.loc.y) {
            this.cancelArcanaSelection(); // CE Items.c:6502-6506 rejects origin.
            return null;
        }
        if (!this.grid.isValidPos(cursor.x, cursor.y)) return null;
        const id = (item as Item & { identityId?: string }).identityId ?? '';
        const bolt = getBoltForItem(id);
        const preview = this.getArcanaPreview();
        if (this.replayStatus !== 'playing' && preview?.risk === 'certain') {
            logger.log(i18next.t('arcana.blink_certain_death', { defaultValue: 'That would be certain death!' }), '#ff8888');
            this.cancelArcanaSelection();
            return null;
        }
        if (this.replayStatus !== 'playing' && preview?.risk === 'possible' && !(this.onConfirmRequest?.(i18next.t('arcana.blink_unknown_lava', {
            defaultValue: 'Blink across lava with unknown range?'
        })) ?? false)) {
            this.cancelArcanaSelection();
            return null;
        }
        this.cancelArcanaSelection(); // Consume the pending transaction exactly once.
        if (!bolt) return null;
        if ((item.charges ?? 0) <= 0 && item.identified === true) return null;
        const result = commitArcanaTarget(item, cursor, {
            zap: (targetItem, targetCursor) => this.zapBoltFromPlayer(bolt, targetItem, targetCursor),
            logIdentify: targetItem => logger.log(i18next.t('item.identify', { name: targetItem.displayName, defaultValue: 'You identify {{name}}.' }), '#00ffff'),
            logEmpty: targetItem => logger.log(i18next.t('arcana.no_charges', { name: targetItem.displayName, defaultValue: '{{name}} has no charges.' }), '#ff8888'),
        }) as BoltResult | null;
        this.needsRender = true;
        // CE Time.c:2604-2605 uses movementSpeed at turn end (after effects).
        finishItemUse(this.player, () => this.playerTurnEnded());
        return result;
    }

    // ----- Bolt Zapping System -----

    /** Execute an explicit aim. Direct engine callers can retain the candidate/
     * last-direction fallback; inventory use always goes through confirmation. */
    public zapBoltFromPlayer(bolt: BoltConfig, item: Item, aim?: Pos): BoltResult {
        this.bindDungeonFeatureEffects();
        const first = aim ? undefined : this.getArcanaCandidates(item)[0];
        const dir = this.directionToVec(this.player.lastMoveDirection ?? Direction.RIGHT);
        const target = aim ?? (bolt.selfTargeting ? this.player.loc : first?.loc) ?? { x: this.player.loc.x + dir.x * 20, y: this.player.loc.y + dir.y * 20 };
        // Blink distance and tunneling budget are travel inputs, resolved from E.
        // W-25 connects both identities to the normal inventory entry.
        const travelBolt = bolt.effect === BoltEffect.BLINKING || bolt.effect === BoltEffect.TUNNELING ? {
            ...bolt, char: bolt.effect === BoltEffect.BLINKING ? this.player.char : bolt.char,
            magnitude: resolveCEBoltMagnitude(bolt.effect === BoltEffect.BLINKING ? CEBoltType.BLINKING : CEBoltType.TUNNELING, item.category === ItemCategory.STAFF
                ? { kind: 'staff', enchantment: item.enchantment } : { kind: 'catalog' }).value,
        } : bolt;
        const result = this.computeBoltResult(travelBolt, this.player.loc, target);
        this.applyBoltResult(result, item);
        return result;
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
        return traceBolt(this.grid, bolt, origin, target, this.boltWorld(this.player));
    }

    private boltWorld(caster: Creature | null, hideDetails = false): BoltWorld {
        return boltWorldFor(caster, this.player, this.monsters, hideDetails);
    }

    /** Bolt identities select DFs; the common transaction handles all contact,
     * recursive promotion, path invalidation and creature/item refresh. */
    private spawnEntanglingBoltFeature(name: string, pos: Pos): void {
        const id = name === 'DF_WEB_SMALL' ? DF.DF_WEB_SMALL
            : name === 'DF_WEB_LARGE' ? DF.DF_WEB_LARGE
            : name === 'DF_ANCIENT_SPIRIT_GRASS' ? DF.DF_ANCIENT_SPIRIT_GRASS
            : name === 'DF_ANCIENT_SPIRIT_VINES' ? DF.DF_ANCIENT_SPIRIT_VINES : null;
        if (id === null) return;
        spawnDungeonFeature(this.grid, pos.x, pos.y, catalogFeature(id), false);
    }

    /** CE updateBolt :5440-5465: DF -> fire -> electricity, once per reached
     * cell, before checking post-effect obstruction. Origin is not a step. */
    private applyBoltTerrainAt(bolt: BoltConfig, pos: Pos): boolean {
        const before = this.boltTerrainSignature([], pos);
        const definition = bolt.ceType === null ? undefined : CE_BOLT_CATALOG[bolt.ceType];
        if (definition?.pathDF === 'DF_OBSIDIAN') {
            spawnDungeonFeature(this.grid, pos.x, pos.y, catalogFeature(DF.DF_OBSIDIAN), false);
        }
        if (definition?.effect === CEBoltEffect.NONE && definition.pathDF) {
            this.spawnEntanglingBoltFeature(definition.pathDF, pos);
        }
        const beforeFire = this.boltTerrainSignature([], pos);
        if (bolt.effect === BoltEffect.FIRE || bolt.effect === BoltEffect.DRAGONFIRE) {
            this.environment.ignite(pos.x, pos.y);
        }
        const fireChanged = beforeFire !== this.boltTerrainSignature([], pos);
        const electric = exposeBoltPathToElectricity(this.grid, [pos], bolt.effect);
        const changed = before !== this.boltTerrainSignature([], pos);
        if (changed || electric) this.updateVision();
        return electric || fireChanged;
    }

    /** Execute travel against live terrain/occupancy. A preview cannot know what
     * ignition/promotion will open, so replace it with the actually travelled route. */
    private applyBoltResult(result: BoltResult, item: Item) {
        let autoID = false, applied = false, dug = false;
        const impactFrames: BoltFrame[] = [];
        let alreadyReflected = false;
        const hideDetails = !ItemLoader.identifiedItems.has((item as Item & { identityId?: string }).identityId ?? '');
        const actual = traceBolt(this.grid, result.bolt, result.origin, result.aimPos,
            this.boltWorld(result.caster, hideDetails), {
            onTunnel: (pos, atOrigin) => {
                const changed = this.tunnelAt(pos);
                dug = changed || dug;
                if (!atOrigin) autoID = changed || autoID;
                return changed;
            },
            onReflection: reflection => {
                alreadyReflected = true;
                this.observeBoltReflection(reflection);
            },
            onCell: (pos, hit) => {
                if (hit && result.effect !== BoltEffect.OBSTRUCTION && result.effect !== BoltEffect.CONJURATION) {
                    const contact = createBoltResult(result.bolt, result.caster, result.origin, result.aimPos, [pos], [hit]);
                    autoID = this.applyBoltEffect(contact, item, alreadyReflected) || autoID;
                    impactFrames.push(...contact.frames.slice(1));
                    applied = true;
                }
                autoID = this.applyBoltTerrainAt(result.bolt, pos) || autoID;
            },
        });
        Object.assign(result, actual);
        result.frames.push(...impactFrames);
        // Landing effects still run on misses. W-9 directed effects require a hit;
        // an empty path has no detonation (in particular no origin fire).
        if (!applied && result.landingPos) autoID = this.applyBoltEffect(result, item) || autoID;
        if (result.effect === BoltEffect.TUNNELING && result.landingPos) {
            // CE detonateBolt always rebuilds waypoints. Other derived maps only
            // need invalidation if an excavation (including origin) succeeded.
            if (dug) {
                this.loopMap = analyzeLoopMap(this.grid);
                this.updatedSafetyMapThisTurn = false;
                this.autoPath = [];
                this.isMouseTraveling = false;
                this.needsRender = true;
            }
            this.rebuildWaypoints(true);
            if (autoID) logger.log(i18next.t('bolt.tunneling', {
                name: item.displayName,
                defaultValue: `${item.displayName} blasts a tunnel through the rock!`
            }), '#cc8855');
        }
        result.outcome = { autoID, casterMovement: this.boltCasterMovement(result) };
        if (hideDetails) result.frames = result.frames.map(frame => ({ ...frame, char: '*', color: 0xaaaaaa }));
        this.pendingBoltFrames = result.frames;
        this.currentBoltFrameIndex = 0;
        this.boltAnimStartTime = Date.now();
    }

    /** CE tunnelize's creature callbacks. All layer writes/DF/diagonal repair
     * stay in Map/Promotion; turret death follows DF dormant activation. */
    private tunnelAt(pos: Pos): boolean {
        const changed = tunnelize(this.grid, pos.x, pos.y, {
            beforeOpen: p => {
                const monster = this.getMonsterAt(p.x, p.y);
                if (monster?.isCaged && !(monster.hasBehavior('MONST_ATTACKABLE_THRU_WALLS') || monster.hasBehavior('MONST_TURRET'))
                    && (cellTerrainFlags(this.grid, p.x, p.y) & T_OBSTRUCTS_PASSABILITY)) this.freeCaptive(monster);
            },
            afterOpen: p => {
                const monster = this.getMonsterAt(p.x, p.y);
                // MONST_TURRET is an unexpanded CE composite in web data (Rogue.h:2093).
                if (monster && (monster.hasBehavior('MONST_ATTACKABLE_THRU_WALLS') || monster.hasBehavior('MONST_TURRET'))) monster.takeDamage(monster.hp, true);
            },
        });
        if (changed) this.updateVision();
        return changed;
    }

    // CE Light.c:291-403. Flares are transient display light. Keeping their
    // channels separate prevents render cadence from changing gameplay FOV/RNG.
    private activeFlares: Array<{ x: number; y: number; kind: LightKind; coeff: number; change: number }> = [];
    private flareLightMap: LightMap | null = null;
    private flareElapsedMs = 0;

    private terrainFlashes: Array<{ cells: Map<number, number>; color: { r: number; g: number; b: number }; radius: number; frames: number; elapsed: number }> = [];

    /** CE IO.colorFlash: snapshot qualifying cells, then expand/fade in 50ms
     * frames. Drawing only; no FOV, memory contents or RNG changes. */
    private colorFlash(name: string, radius: number, origin: Pos, frames = 4, discovered = false): void {
        const colors: Record<string, { r: number; g: number; b: number }> = {
            yellow: { r: 100, g: 100, b: 0 }, // CE GlobalsBase.c:86; DF_ARMOR_IMMOLATION
            gray: { r: 50, g: 50, b: 50 }, darkGray: { r: 30, g: 30, b: 30 }, darkBlue: { r: 0, g: 0, b: 50 },
        };
        const color = colors[name];
        if (!color) throw new Error(`Unmapped CE flash color: ${name}`);
        const cells = new Map<number, number>();
        const fieldOfView = discovered ? null : this.fov.computeFOVMask(this.player.x, this.player.y,
            this.grid.width + this.grid.height, cell => !!(cellTerrainFlags(this.grid, cell.x, cell.y) & T_OBSTRUCTS_VISION));
        for (let x = Math.max(0, origin.x - radius); x <= Math.min(this.grid.width - 1, origin.x + radius); x++) {
            for (let y = Math.max(0, origin.y - radius); y <= Math.min(this.grid.height - 1, origin.y + radius); y++) {
                const cell = this.grid.getCell(x, y)!;
                const squared = (x-origin.x)**2 + (y-origin.y)**2;
                if (squared <= radius**2 && (discovered ? cell.isExplored || cell.isMagicMapped : fieldOfView?.[x]?.[y] || cell.isVisible)) {
                    cells.set(y * this.grid.width + x, Math.floor(Math.sqrt(squared)));
                }
            }
        }
        if (cells.size) (this.terrainFlashes ??= []).push({ cells, color, radius, frames, elapsed: 0 });
        this.needsRender = true;
    }

    public terrainFlashAt(x: number, y: number): { r: number; g: number; b: number } | null {
        let result: { r: number; g: number; b: number } | null = null;
        for (const flash of this.terrainFlashes ?? []) {
            const distance = flash.cells.get(y * this.grid.width + x);
            const frame = Math.min(flash.frames, 1 + Math.floor(flash.elapsed / 50));
            const radius = Math.max(1, Math.trunc(flash.radius * frame / flash.frames));
            if (distance === undefined || distance > radius) continue;
            const fade = Math.min(100, Math.trunc((flash.frames - frame) * 500 / flash.frames));
            const intensity = Math.trunc(fade * (100 - Math.trunc(100 * (radius - distance - 2) / radius)) / 100);
            result ??= { r: 0, g: 0, b: 0 };
            result.r += Math.trunc(flash.color.r * intensity / 100);
            result.g += Math.trunc(flash.color.g * intensity / 100);
            result.b += Math.trunc(flash.color.b * intensity / 100);
        }
        return result;
    }

    public createFlare(x: number, y: number, kind: LightKind): void {
        if (!LIGHT_CATALOG[kind] || !this.grid.isValidPos(x, y)) return;
        this.activeFlares ??= []; // legacy headless fixtures construct via Object.create(Game.prototype)
        this.flareElapsedMs ??= 0;
        this.activeFlares.push({ x, y, kind, coeff: 100000, change: -15 });
        this.needsRender = true;
    }

    public visualLightAt(x: number, y: number) {
        const base = this.lightMap.lightAt(x, y);
        const flare = this.flareLightAt(x, y);
        if (!base || !flare) return base;
        return { r: base.r + flare.r, g: base.g + flare.g, b: base.b + flare.b };
    }

    public flareLightAt(x: number, y: number) {
        return this.flareLightMap?.lightAt(x, y) ?? null;
    }

    /** One CE flare step per 10ms; the final step requests a clean redraw. */
    public tickFlareAnimation(deltaMs: number): boolean {
        const flashChanged = !!this.terrainFlashes?.length;
        this.terrainFlashes = (this.terrainFlashes ?? []).filter(flash => {
            flash.elapsed += Math.max(0, deltaMs);
            return flash.elapsed < flash.frames * 50;
        });
        if (!this.activeFlares.length) return flashChanged;
        this.flareElapsedMs += Math.max(0, deltaMs);
        if (this.flareElapsedMs < 10) return flashChanged;
        const steps = Math.min(100, Math.floor(this.flareElapsedMs / 10));
        this.flareElapsedMs %= 10;
        for (let step = 0; step < steps; step++) {
            this.activeFlares = this.activeFlares.filter(flare => {
                flare.coeff += Math.trunc(flare.change * 100);
                flare.change = Math.trunc(flare.change * 12 / 10);
                return flare.coeff >= 0;
            });
        }
        if (!this.activeFlares.length) {
            this.flareLightMap = null;
            return true;
        }
        const overlay = new LightMap(this.grid);
        overlay.clearLighting();
        for (const flare of this.activeFlares) {
            const source = LIGHT_CATALOG[flare.kind]!;
            const scale = flare.coeff / 100000;
            overlay.paintLight({
                light: { ...source, color: {
                    ...source.color,
                    red: Math.trunc(source.color.red * scale),
                    green: Math.trunc(source.color.green * scale),
                    blue: Math.trunc(source.color.blue * scale),
                } },
                x: flare.x, y: flare.y,
                radiusHundredths: Math.trunc(source.radius.lowerBound * scale),
            });
        }
        this.flareLightMap = overlay;
        return true;
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
        return true; // redraw once to clear the last projectile frame
    }

    /** Get the current bolt frame to render (if any). */
    public getCurrentBoltFrame(): BoltFrame | null {
        if (this.pendingBoltFrames.length === 0) return null;
        return this.pendingBoltFrames[this.currentBoltFrameIndex] ?? null;
    }

    /** Reflection is travel, never a damage redirect or an autoID observation.
     * Armor identification is independent of identification of the fired item. */
    private observeBoltReflection(reflection: BoltReflection): void {
        if (reflection.creature === this.player && this.player.equippedArmor?.runicType === 'reflection') {
            this.player.equippedArmor.runicKnown = true;
        }
    }

    /** W-8 migrates only the two CE damage STAFFs. Retired invented wands
     * retain their legacy constants; monster BE_DAMAGE has its own exit. */
    private isDamageStaff(bolt: BoltConfig, item: Item): boolean {
        return item.category === ItemCategory.STAFF
            && (bolt.ceType === CEBoltType.FIRE || bolt.ceType === CEBoltType.LIGHTNING);
    }

    /** CE Items.c:5159-5168: immunity precedes staffDamage's RNG. No physical
     * attack/accuracy/armor/weapon immunity. null distinguishes immunity. */
    private applyDirectBoltDamage(target: Creature, result: BoltResult, item: Item, alreadyReflected = false): number | null {
        const staff = this.isDamageStaff(result.bolt, item);
        if ((target instanceof Monster && target.isInvulnerable())
            || (staff && result.effect === BoltEffect.FIRE && target.hasStatus('immune_fire'))) {
            logger.log(i18next.t('bolt.invulnerable_no_effect', {
                target: this.monsterDisplayName(target),
                defaultValue: `The ${this.monsterDisplayName(target)} is unaffected.`
            }), '#aaaaaa');
            return null;
        }
        const damage = staff ? rollStaffDamage(resolveCEBoltMagnitude(result.bolt.ceType!, {
            kind: 'staff', enchantment: item.enchantment,
        }).value, rng) : result.magnitude;
        const hpDamage = target.absorbShieldDamage(damage);
        if (result.caster) CombatSystem.transferMonsterHealth(result.caster, target, hpDamage);
        target.takeDamage(hpDamage, true);
        if (target.hp > 0) {
            if (target instanceof Monster && (!target.isAlly || target.hasStatus('magical_fear'))
                && (target.state !== MonsterState.FLEEING || target.hasStatus('magical_fear'))) {
                target.state = MonsterState.HUNTING;
                target.setStatusDuration('magical_fear', 0);
            }
            target.shortenMagicalFear();
            if (target instanceof Monster) target.enrageAfterAttack();
            if (!alreadyReflected) target.setStatusDuration('entranced', 0);
        }
        return damage;
    }

    private boltCasterMovement(result: BoltResult) {
        const to = result.caster?.loc;
        return to && (to.x !== result.origin.x || to.y !== result.origin.y)
            ? { from: { ...result.origin }, to: { ...to } } : null;
    }

    private canObserveBoltTarget(target: Creature): boolean {
        return canObserveBoltCreature(this.player, this.grid, target);
    }

    /** Snapshot only cells the existing effect touches; never execute an effect twice. */
    private boltTerrainSignature(path: readonly Pos[], impact: Pos): string {
        return JSON.stringify([...path, impact].map(p => this.grid.getCell(p.x, p.y)?.layers));
    }

    private boltLivingTarget(target: Creature): boolean {
        return !(target instanceof Monster) || (!target.hasCEBehavior('MONST_INANIMATE') && !target.isInvulnerable());
    }

    /** W-9: shared player/monster directed effects. CE Items.c:4636-4706,
     * 4941-4957,5242-5273,5366-5372,5390-5404; PowerTables.c:53/55.
     * magnitude is instance E for STAFF, catalog magnitude for WAND/monsters.
     * These CE writes deliberately bypass generic web immunity/resist/max-refresh;
     * scrolls, potions, gas and runics retain their existing status entry points. */
    private applyBasicBoltEffect(target: Creature, effect: BoltEffect, magnitude: number): { accepted: boolean; autoID: boolean; healed: number } {
        const seen = this.canObserveBoltTarget(target);
        const living = this.boltLivingTarget(target);
        let accepted = living, autoID = false, healed = 0;
        switch (effect) {
            case BoltEffect.HEALING:
                healed = target.heal(magnitude * 10, false);
                accepted = true; // CE healing has no INANIMATE/INVULNERABLE gate.
                autoID = seen; // Also at full health or when rounding yields zero.
                break;
            case BoltEffect.SLOW:
            case BoltEffect.HASTE:
                if (accepted) {
                    target.setStatusDuration('haste', 0); // web alias of CE HASTED
                    target.setStatusDuration('hasted', effect === BoltEffect.HASTE ? 2 + 4 * magnitude : 0);
                    target.setStatusDuration('slowed', effect === BoltEffect.SLOW ? 5 * magnitude : 0);
                    target.refreshSpeeds();
                }
                autoID = true; // CE flashes on contact even when slow/haste rejects.
                break;
            case BoltEffect.INVISIBILITY:
                accepted = living && (!(target instanceof Monster) || !target.isTrulyInvisible());
                if (accepted) {
                    // Decide observation BEFORE invisibility changes perception.
                    autoID = target === this.player || (target instanceof Monster && target.isAlly)
                        || (seen && this.player.hasStatus('telepathy'));
                    target.setStatusDuration('invisible', 15 * magnitude);
                }
                break;
            case BoltEffect.ENTRANCEMENT:
                if (target === this.player) {
                    target.setStatusDuration('confused', staffEntrancementDuration(magnitude));
                    autoID = true;
                } else if (accepted && target instanceof Monster) {
                    target.setStatusDuration('entranced', staffEntrancementDuration(magnitude));
                    // CE wakeUp: target budget is reset to 100 even when already awake.
                    if (!target.isAlly) target.state = MonsterState.HUNTING;
                    target.ticksUntilTurn = 100;
                    for (const teammate of this.monsters) {
                        if (teammate === target || teammate.hp <= 0 || teammate.isDormant || !monstersAreTeammates(target, teammate)) continue;
                        if (teammate.state === MonsterState.ASLEEP || teammate.state === MonsterState.WANDERING) {
                            teammate.ticksUntilTurn = Math.max(100, teammate.ticksUntilTurn);
                        }
                        if (!target.isAlly) teammate.state = MonsterState.HUNTING;
                    }
                    // CE canSeeMonster after status write: entrancement reveals its recipient.
                    autoID = this.canObserveBoltTarget(target);
                }
                break;
            case BoltEffect.DISCORD:
                if (accepted) {
                    target.setStatusDuration('discordant', Math.max(target.getStatusDuration('discordant'), 4 * magnitude));
                    autoID = seen;
                }
                break;
            default:
                throw new Error('Not a basic directed bolt effect');
        }
        if (!accepted) logger.log(i18next.t('bolt.invulnerable_no_effect', {
            target: this.monsterDisplayName(target), defaultValue: `The ${this.monsterDisplayName(target)} is unaffected.`
        }), '#aaaaaa');
        return { accepted, autoID, healed };
    }

    /** CE updateBolt: immunity, then free captive, then destination search. */
    private teleportBoltTarget(target: Creature): boolean {
        if (target instanceof Monster && target.hasCEBehavior('MONST_IMMOBILE')) return false;
        if (target instanceof Monster && target.isCaged) this.freeCaptive(target);
        return this.teleportCreature(target);
    }

    private polymorphBoltTarget(target: Creature | undefined): boolean {
        if (!(target instanceof Monster) || !target.polymorph(() => this.demoteMonsterFromLeadership(target))) return false;
        const autoID = !target.hasStatus('invisible');
        this.updateVision();
        this.needsRender = true;
        return autoID;
    }

    /** Items.c:5274-5300 always allies to the player, even for a hostile caster. */
    private dominateBoltTarget(target: Creature | undefined): boolean {
        let autoID = false;
        // CE Items.c:5274-5300: no writes until the roll succeeds.
        // Player, inanimate and invulnerable contacts cannot be dominated.
        if (!(target instanceof Monster) || target.hasCEBehavior('MONST_INANIMATE') || target.isInvulnerable()) return false;
        const success = rng.randPercent(wandDominate(target));
        if (success) {
            target.setStatusDuration('discordant', 0);
            this.becomeAllyWith(target);
            target.dominated = true;
        }
        // canSeeMonster is evaluated AFTER conversion; a newly allied
        // invisible creature on a visible tile can now be observed.
        autoID = this.canObserveBoltTarget(target);
        if (autoID) logger.log(success
            ? i18next.t('bolt.domination_success', { target: this.monsterDisplayName(target), defaultValue: '{{target}} is bound to your will!' })
            : i18next.t('bolt.domination_resisted', { target: this.monsterDisplayName(target), defaultValue: '{{target}} resists the bolt of domination.' }),
            success ? '#88ff88' : '#aaaaaa');
        return autoID;
    }

    /** Items.c:5493-5514: actual landing, catalog/instance magnitude; blades
     * are bound to the player for every caster. Reuses W16 placement/lifecycle. */
    private conjureBladesAt(landing: Pos, magnitude: number): boolean {
        let autoID = false;
        const data = (monsterData as MonsterData[]).find(m => m.id === 'spectral_blade')!;
        for (let i = 0; i < staffBladeCount(magnitude); i++) {
            const at = bladeSpawnLocation(this, landing);
            if (!at) break; // No invalid/off-map entities when the level is full.
            const blade = new Monster(at.x, at.y, data);
            blade.isAlly = true;
            blade.boundToPlayer = true;
            blade.doesNotTrackLeader = true;
            // Player followers use leader=null (also used by freed captives).
            // CE sets info.attackSpeed + 1, not movementSpeed or a lifetime.
            blade.ticksUntilTurn = blade.attackSpeed + 1;
            blade.goldDropChance = blade.itemDropChance = 0; // CE blade has no MONST_CARRY_ITEM_* flags.
            this.monsters.push(blade);
            autoID = true; // W-2 handoff: only a real entity identifies.
        }
        return autoID;
    }

    private applyBoltEffect(result: BoltResult, item: Item, alreadyReflected = false): boolean {
        const { effect, impactPos } = result;
        let autoID = false;
        // Consume the traced contact, not a new location lookup (which could
        // pick a dormant occupant, or a creature moved/spawned by an earlier hit).
        const contact = result.hits.find(h => h.pos.x === impactPos.x && h.pos.y === impactPos.y);
        const target = contact?.creature;

        const known = ItemLoader.identifiedItems.has((item as Item & { identityId?: string }).identityId ?? '');
        const logMiss = (key: string, fallback: string, color: string) => {
            logger.log(known ? i18next.t(key, { name: item.displayName, defaultValue: fallback })
                : i18next.t('arcana.no_observable_effect', { name: item.displayName, defaultValue: 'You zap {{name}}.' }), known ? color : '#aaaaaa');
        };
        switch (effect) {
            case BoltEffect.FIRE: {
                if (target) autoID = true; // CE :5146-5150, even if immune; reflectors never enter this branch.
                // Terrain exposure is sequenced by the travel loop after contact.
                const damage = target ? this.applyDirectBoltDamage(target, result, item, alreadyReflected) : null;
                if (target && damage !== null) {
                    logger.log(i18next.t('bolt.fire_hit', {
                        interpolation: { escapeValue: false },
                        name: item.displayName, target: this.monsterDisplayName(target), damage,
                        defaultValue: `${item.displayName} scorches the ${this.monsterDisplayName(target)} for ${damage} damage!`
                    }), '#ff6600');
                    this.spawnFloatingText(`-${damage}`, target.loc.x, target.loc.y, 0xff4400);
                    if (target.hp <= 0) {
                        logger.log(i18next.t('bolt.fire_kill', {
                            target: this.monsterDisplayName(target),
                            defaultValue: `The ${this.monsterDisplayName(target)} burns to death.`
                        }), '#ff8800');
                    } else {
                        // CE :5207-5213: surviving fiery hit ignites the creature
                        // before splitting; player-reflected bolts do not split.
                        const staff = this.isDamageStaff(result.bolt, item);
                        if (staff && (target instanceof Player || target instanceof Monster)) this.exposeCreatureToFire(target);
                        if (target instanceof Monster && (!staff || !alreadyReflected)) this.trySplitMonster(target, this.player);
                    }
                } else if (!target) {
                    logMiss('bolt.fire_impact', `A burst of fire leaps from ${item.displayName}!`, '#ffaa00');
                }
                break;
            }

            case BoltEffect.LIGHTNING: {
                // Lightning pierces through all creatures along the path and deals damage
                let totalDamage = 0;
                for (const hit of result.hits) {
                    const m = hit.creature;
                    autoID = true; // CE BE_DAMAGE contact, not HP delta.
                    const damage = this.applyDirectBoltDamage(m, result, item, alreadyReflected);
                    if (damage === null) {
                        continue;
                    }
                    totalDamage += damage;
                    this.spawnFloatingText(`-${damage}`, m.loc.x, m.loc.y, 0x33ccff);
                    logger.log(i18next.t('bolt.lightning_hit', {
                        interpolation: { escapeValue: false },
                        name: item.displayName, target: this.monsterDisplayName(m), damage,
                        defaultValue: `Lightning from ${item.displayName} strikes the ${this.monsterDisplayName(m)} for ${damage} damage!`
                    }), '#33ccff');
                    if (m.hp <= 0) {
                        logger.log(i18next.t('bolt.lightning_kill', {
                            target: this.monsterDisplayName(m),
                            defaultValue: `The ${this.monsterDisplayName(m)} is electrocuted!`
                        }), '#55ddff');
                    } else if (m instanceof Monster && (!this.isDamageStaff(result.bolt, item) || !alreadyReflected)) {
                        // CE Items.c:5210-5213, including the reflection guard.
                        this.trySplitMonster(m, this.player);
                    }
                }
                if (totalDamage === 0) {
                    logMiss('bolt.lightning_miss', `Lightning arcs from ${item.displayName} but finds no target.`, '#33ccff');
                }
                break;
            }

            case BoltEffect.POISON: {
                if (target) {
                    const enchantment = resolveCEBoltMagnitude(result.bolt.ceType!, {
                        kind: 'staff', enchantment: item.enchantment,
                    }).value;
                    const applied = target.addPoison(staffPoison(enchantment), 1);
                    autoID = applied && this.canObserveBoltTarget(target); // CE Items.c:5322-5331
                    if (autoID) logger.log(i18next.t('bolt.poison_hit', {
                        interpolation: { escapeValue: false }, name: item.displayName, target: this.monsterDisplayName(target),
                        defaultValue: `${item.displayName} envenomates the ${this.monsterDisplayName(target)}!`
                    }), '#55cc55');
                } else {
                    logMiss('bolt.poison_miss', `Poison streams from ${item.displayName} but finds no target.`, '#55cc55');
                }
                break;
            }

            case BoltEffect.TELEPORT: {
                // CE Items.c:5220-5227: immunity precedes freeing; freeing
                // precedes destination search, even if that search later fails.
                if (target && this.teleportBoltTarget(target)) {
                    logger.log(i18next.t('bolt.teleport_hit', {
                        name: item.displayName, target: this.monsterDisplayName(target),
                        defaultValue: `${item.displayName} teleports the ${this.monsterDisplayName(target)} away!`
                    }), '#cc88ff');
                } else if (!target) {
                    logMiss('bolt.teleport_miss', `${item.displayName} flashes but finds no target.`, '#cc88ff');
                }
                break;
            }

            case BoltEffect.PLENTY: {
                if (target && this.boltLivingTarget(target) && !(target instanceof Monster && target.hasBehavior('MONST_TURRET'))) {
                    const clone = this.cloneMonster(target);
                    if (clone) {
                        target.hp = Math.floor((target.hp + 1) / 2);
                        clone.hp = Math.floor((clone.hp + 1) / 2);
                        if (this.canObserveBoltTarget(clone)) logger.log(i18next.t('bolt.plenty_clone', {
                            target: clone.name, defaultValue: 'Another {{target}} appears!',
                        }), '#88ff88');
                        // CE Items.c:5384: success identifies even outside sight.
                        autoID = true;
                    }
                }
                break;
            }

            case BoltEffect.POLYMORPH: {
                autoID = this.polymorphBoltTarget(target);
                break;
            }

            case BoltEffect.DOMINATION: {
                autoID = this.dominateBoltTarget(target);
                break;
            }

            case BoltEffect.SLOW:
            case BoltEffect.HEALING:
            case BoltEffect.HASTE:
            case BoltEffect.DISCORD:
            case BoltEffect.INVISIBILITY:
            case BoltEffect.ENTRANCEMENT: {
                if (!target) {
                    logMiss('arcana.no_observable_effect', 'You zap {{name}}.', '#aaaaaa');
                    break;
                }
                const ceMagnitude = resolveCEBoltMagnitude(result.bolt.ceType!, item.category === ItemCategory.STAFF
                    ? { kind: 'staff', enchantment: item.enchantment } : { kind: 'wand' }).value;
                const applied = this.applyBasicBoltEffect(target, effect, ceMagnitude);
                autoID = applied.autoID;
                if (!applied.accepted) break;
                const targetName = target === this.player ? i18next.t('bolt.target_you', { defaultValue: 'you' }) : this.monsterDisplayName(target);
                const args = { interpolation: { escapeValue: false }, name: item.displayName, target: targetName, heal: applied.healed };
                switch (effect) {
                    case BoltEffect.ENTRANCEMENT:
                        logger.log(target === this.player
                            ? i18next.t('bolt.entrancement_reflected', { defaultValue: 'The bolt hits you and you suddenly feel disoriented.' })
                            : i18next.t('bolt.entrancement_hit', { ...args, defaultValue: '{{target}} is entranced!' }), '#ffff88');
                        break;
                    case BoltEffect.SLOW: logger.log(i18next.t('bolt.slow_hit', { ...args, defaultValue: '{{name}} slows {{target}}!' }), '#888888'); break;
                    case BoltEffect.HEALING: logger.log(i18next.t('bolt.healing', { ...args, defaultValue: '{{name}} restores {{heal}} HP to {{target}}!' }), '#44ff88'); break;
                    case BoltEffect.HASTE: logger.log(i18next.t('bolt.haste', { ...args, defaultValue: '{{name}} fills {{target}} with supernatural speed!' }), '#ffff88'); break;
                    case BoltEffect.DISCORD: logger.log(i18next.t('bolt.discord_hit', { ...args, defaultValue: '{{name}} sows discord in the mind of {{target}}!' }), '#ff88ff'); break;
                    case BoltEffect.INVISIBILITY: logger.log(i18next.t('bolt.invisibility_hit', { ...args, defaultValue: '{{name}} makes {{target}} vanish!' }), '#aaaaff'); break;
                }
                if (effect === BoltEffect.HEALING) this.spawnFloatingText(`+${applied.healed}`, target.loc.x, target.loc.y, 0x44ff88);
                break;
            }

            case BoltEffect.BLINKING: {
                autoID = this.finishBlink(result);
                break;
            }

            case BoltEffect.BECKONING: {
                if (target) {
                    autoID = this.beckonCreature(target, result.caster);
                    logger.log(i18next.t('bolt.beckoning_hit', {
                        name: item.displayName, target: this.monsterDisplayName(target),
                        defaultValue: `${item.displayName} pulls the ${this.monsterDisplayName(target)} toward you!`
                    }), '#88ccff');
                } else {
                    logMiss('bolt.beckoning_miss', `No target answers ${item.displayName}.`, '#aaaaaa');
                }
                break;
            }

            case BoltEffect.CONJURATION: {
                if (!result.landingPos) break;
                const e = resolveCEBoltMagnitude(CEBoltType.CONJURATION, item.category === ItemCategory.STAFF
                    ? { kind: 'staff', enchantment: item.enchantment } : { kind: 'catalog' }).value;
                autoID = this.conjureBladesAt(result.landingPos, e);
                if (autoID) logMiss('staff.phantom_force', `Phantom force responds to ${item.displayName}.`, '#aaddff');
                this.updateVision();
                this.needsRender = true;
                break;
            }

            case BoltEffect.OBSTRUCTION: {
                if (!result.landingPos) break;
                const e = resolveCEBoltMagnitude(CEBoltType.OBSTRUCTION, item.category === ItemCategory.STAFF
                    ? { kind: 'staff', enchantment: item.enchantment } : { kind: 'catalog' }).value;
                const world = this.boltWorld(result.caster);
                spawnObstruction(this.grid, result.landingPos.x, result.landingPos.y, e,
                    pos => !!world.creatureAt(pos));
                // A visible effect is not required: CE detonateBolt always autoIDs.
                autoID = true;
                this.updateVision();
                this.needsRender = true;
                break;
            }

            case BoltEffect.SHIELDING: {
                if (target) {
                    const magnitude = resolveCEBoltMagnitude(CEBoltType.SHIELDING, item.category === ItemCategory.STAFF
                        ? { kind: 'staff', enchantment: item.enchantment } : { kind: 'wand' }).value;
                    target.applyShield(staffProtection(magnitude));
                    autoID = true; // CE Items.c:5412-5413: contact, even if hidden/unchanged.
                    this.spawnFloatingText(this.getStatusLabel('shielded'), target.loc.x, target.loc.y, 0xffffaa);
                }
                break;
            }

            case BoltEffect.EMPOWERMENT: {
                // CE Items.c:5311: player/INANIMATE/INVULNERABLE are untouched.
                // Enemy and ally recipients use the same repeatable operation.
                if (target instanceof Monster && target.empower()) {
                    autoID = this.canObserveBoltTarget(target);
                    if (autoID) {
                        this.createFlare(target.x, target.y, LightKind.EMPOWERMENT_LIGHT);
                        logger.log(i18next.t('bolt.empowerment_hit', {
                            name: item.displayName, target: this.monsterDisplayName(target),
                            defaultValue: `${item.displayName} empowers the ${this.monsterDisplayName(target)}!`
                        }), '#88ff99');
                    }
                } else if (!target) {
                    logMiss('bolt.empowerment_miss', `${item.displayName} fires but finds no target.`, '#ffff44');
                }
                break;
            }

            case BoltEffect.NEGATION: {
                if (target) {
                    const affected = this.negateCreatureMagic(target);
                    // CE Items.c:5302-5307 checks visibility AFTER negate (e.g.
                    // an invisible monster becomes visible). It uses negate's
                    // return, never the narrower automatic-target predicate.
                    autoID = affected && this.canObserveBoltTarget(target);
                } else {
                    logMiss('bolt.negation_miss', `${item.displayName} fires but finds no target.`, '#ffffff');
                }
                break;
            }

            case BoltEffect.TUNNELING:
                // W-13: excavation/budget runs during travel, never replays a path.
                break;

            default:
                logger.log(i18next.t('item.use_generic', { name: item.displayName, defaultValue: `You use ${item.displayName}.` }), '#88ccff');
                break;
        }

        return autoID;
    }

    /** Monster.tryUseBolt's contact/terrain exit. U06 BE_DAMAGE uses the
     * shared CE staffDamage primitive at catalog magnitude; BE_ATTACK keeps
     * CombatSystem.attack. Travel owns reflection and actual recipients. */
    /** CE moveAlly leash while resting/searching; seized/faster-enemy overrides
     * belong to the monster decision, not the player action state. */
    public allyBlinkLeashLength(): number {
        return this.justRested || this.justSearched ? 10 : 4;
    }

    /** U07: CE zap from the dedicated monster selector. No inventory, player
     * targeting guard or generic creature-target eligibility is involved. */
    public castMonsterBlink(caster: Monster, aim: Pos): BoltResult {
        const cell = this.grid.getCell(caster.x, caster.y);
        if (cell?.isVisible && (!caster.hasStatus('invisible') || cell.layers[DungeonLayer.GAS])) {
            logger.log(i18next.t('combat.monster_blinks', { monster: this.monsterDisplayName(caster),
                defaultValue: `The ${this.monsterDisplayName(caster)} blinks.` }), '#aaaaaa');
        }
        const result = traceBolt(this.grid, MONSTER_BLINK, caster.loc, aim, this.boltWorld(caster));
        this.finishBlink(result);
        this.pendingBoltFrames = result.frames;
        this.currentBoltFrameIndex = 0;
        this.boltAnimStartTime = Date.now();
        result.outcome = { autoID: false, casterMovement: this.boltCasterMovement(result) };
        this.needsRender = true;
        return result;
    }

    public castMonsterBolt(caster: Monster, target: Creature, ceBoltName: string): BoltResult | undefined {
        const meta = MONSTER_BOLT_TABLE[ceBoltName];
        if (!meta || meta.effect === null || meta.effect === BoltEffect.TUNNELING
            || meta.effect === BoltEffect.OBSTRUCTION) return; // CE monsters never cast these.
        this.bindDungeonFeatureEffects(); // Direct engine callers share the same world ports as player bolts.

        if (meta.effect === BoltEffect.NONE && this.canObserveBoltTarget(caster)) {
            if (ceBoltName === 'SPIDERWEB') logger.log(i18next.t('bolt.monster_cast_web', {
                caster: this.monsterDisplayName(caster), defaultValue: '{{caster}} launches a sticky web.',
            }), '#cccccc');
            else logger.log(i18next.t('bolt.monster_cast_vines', {
                caster: this.monsterDisplayName(caster), defaultValue: '{{caster}} releases carnivorous vines into the ground.',
            }), '#99bb55');
        }
        const definition = CE_BOLT_CATALOG[meta.ceType];
        const visualBolt: BoltConfig = {
            id: `monster_bolt_${ceBoltName.toLowerCase()}`,
            ceType: meta.ceType,
            name: ceBoltName,
            effect: meta.effect,
            magnitude: meta.magnitude,
            char: meta.ceType === CEBoltType.ANCIENT_SPIRIT_VINES ? '"' : '*',
            color: meta.effect === BoltEffect.NONE ? (meta.ceType === CEBoltType.SPIDERWEB ? 0xffffff : 0xddbb88) : 0xffcc66,
            maxRange: 0,
            piercing: false,
            selfTargeting: false,
        };
        let autoID = false;
        const boltResult = traceBolt(this.grid, visualBolt, caster.loc, target.loc, this.boltWorld(caster), {
            onReflection: reflection => this.observeBoltReflection(reflection),
            onCell: (pos, hit) => {
                if (hit) autoID = this.applyMonsterBoltHit(caster, hit.creature, ceBoltName, meta) || autoID;
                // CE Items.c:5168-5178: lethal player damage returns before
                // tile exposure and terminates even a piercing spark.
                if (BOLT_EFFECT_CE_EFFECT[meta.effect!] === CEBoltEffect.DAMAGE && this.player.hp <= 0) return false;
                autoID = this.applyBoltTerrainAt(visualBolt, pos) || autoID;
            },
        });
        // CE detonateBolt :5562: target DF at the actual landing, even a wall
        // or an intervening creature; never at the requested target by fiat.
        if (meta.effect === BoltEffect.NONE && definition.targetDF && boltResult.landingPos) {
            this.spawnEntanglingBoltFeature(definition.targetDF, boltResult.landingPos);
            this.updateVision();
        }
        if (meta.effect === BoltEffect.CONJURATION && boltResult.landingPos) {
            autoID = this.conjureBladesAt(boltResult.landingPos, meta.magnitude);
            this.updateVision();
        }
        this.pendingBoltFrames = boltResult.frames;
        this.currentBoltFrameIndex = 0;
        this.boltAnimStartTime = Date.now();
        boltResult.outcome = { autoID, casterMovement: this.boltCasterMovement(boltResult) };
        this.needsRender = true;
        return boltResult;
    }

    /** Existing per-recipient effects/formulas. Travel has already resolved
     * reflection: defense, immunity and splitting use the actual recipient. */
    private applyMonsterBoltHit(caster: Monster, target: Creature, ceBoltName: string, meta: MonsterBoltMeta): boolean {
        let autoID = false;
        const isPlayer = target === this.player;
        const targetName = isPlayer ? i18next.t('bolt.target_you', { defaultValue: 'you' }) : (target as Monster).name;
        const casterLabel = this.monsterDisplayName(caster);
        const logCast = (key: string, defaultValue: string, color: string) => {
            logger.log(i18next.t(key, { caster: casterLabel, target: targetName, defaultValue }), color);
        };

        switch (meta.effect) {
            case BoltEffect.LIGHTNING:
            case BoltEffect.SPARK:
            case BoltEffect.FIRE:
            case BoltEffect.DRAGONFIRE: {
                autoID = true; // CE BE_DAMAGE identifies on contact, even immunity.
                if ((meta.fiery && target.hasStatus('immune_fire'))
                    || (target instanceof Monster && target.isInvulnerable())) {
                    if (this.canObserveBoltTarget(target)) logger.log(i18next.t('bolt.invulnerable_no_effect', {
                        target: targetName, defaultValue: `${targetName} is unaffected.`,
                    }), '#aaaaaa');
                    break; // immunity precedes all damage RNG; terrain still runs.
                }
                const damage = rollStaffDamage(meta.magnitude, rng);
                const hpDamage = target.absorbShieldDamage(damage);
                // CE inflictDamage transfers after shielding and before death,
                // including when reflection makes caster and victim identical.
                CombatSystem.transferMonsterHealth(caster, target, hpDamage);
                target.takeDamage(hpDamage, true); // shield already consumed once.
                if (hpDamage > 0) {
                    // CE monsterCastSpell: a reflected monster bolt still kills
                    // in the original caster's name, never in the reflector's.
                    if (isPlayer) this.lastDamageSource = caster.name;
                    this.spawnFloatingText(`-${hpDamage}`, target.loc.x, target.loc.y, 0xff5555);
                    if (isPlayer) this.spawnBlood(target.loc.x, target.loc.y);
                }
                logCast('bolt.monster_cast_hit', `${casterLabel} hits ${targetName} with ${ceBoltName} for ${hpDamage} damage!`, '#ff8866');
                if (target.hp > 0) {
                    // CE survivor/moralAttack effects, also on a fully shielded
                    // hit and on monster-origin reflected hits (Items.c:5195-5213).
                    if (target instanceof Monster && (!target.isAlly || target.hasStatus('magical_fear'))
                        && (target.state !== MonsterState.FLEEING || target.hasStatus('magical_fear'))) {
                        target.state = MonsterState.HUNTING;
                        target.setStatusDuration('magical_fear', 0);
                    }
                    if (meta.fiery && (target instanceof Player || target instanceof Monster)) this.exposeCreatureToFire(target);
                    if (target.hasStatus('paralyzed')) {
                        target.setStatusDuration('paralyzed', 0);
                        target.ticksUntilTurn = Math.min(caster.attackSpeed, 100) - 1;
                    }
                    target.setStatusDuration('entranced', 0);
                    target.shortenMagicalFear();
                    if (target instanceof Monster) target.enrageAfterAttack();
                    if (target instanceof Monster) this.trySplitMonster(target, caster);
                }
                // Death DF and carried drops retain the normal turn cleanup owner.
                break;
            }

            case BoltEffect.DISTANCE_ATTACK:
            case BoltEffect.POISON_DART: {
                // BE_ATTACK retains its attack roll, weapon immunity and riders.
                // Reflection already ran in travel and has no on-hit adjustment.
                // Only install the armor hook when there is a runic effect to apply.
                const armorRunic = isPlayer ? this.player.equippedArmor?.runicType : undefined;
                const result = CombatSystem.attack(caster, target, {
                    isWeaponAttack: BOLT_EFFECT_CE_EFFECT[meta.effect] === CEBoltEffect.ATTACK,
                    ...(armorRunic && armorRunic !== 'reflection'
                        ? { beforeDamage: (damage: number) => this.tryTriggerArmorRunic(caster, damage, true) } : {}),
                });
                autoID = true; // CE :5136-5150: attack/damage attempt, including miss/immunity.
                if (result.kamikazeSelfDestruct) {
                    // P4-4：目前带 bolts 的怪物没有一只同时是 MA_KAMIKAZE（膨胀怪没有
                    // bolts），这里只是让 CombatSystem.attack 的通用出口在未来出现
                    // 这种组合时行为正确，不静默吞掉自爆语义。
                    logCast('bolt.monster_cast_kamikaze', `${casterLabel} bursts before the spell lands!`, '#ff8800');
                    break;
                }
                if (result.damage > 0) {
                    if (isPlayer) this.lastDamageSource = caster.name;
                    this.spawnFloatingText(`-${result.damage}`, target.loc.x, target.loc.y, 0xff5555);
                    if (isPlayer) {
                        this.spawnBlood(target.loc.x, target.loc.y);
                    }
                    logCast('bolt.monster_cast_hit', `${casterLabel} hits ${targetName} with ${ceBoltName} for ${result.damage} damage!`, '#ff8866');
                    if (isPlayer && caster.onHitStatus && caster.onHitDuration > 0 && rng.randPercent(Math.floor(caster.onHitChance * 100))) {
                        this.applyMonsterOnHitStatus(caster.name, caster.onHitStatus, caster.onHitDuration);
                    }
                    if (isPlayer && caster.hasAbility('MA_POISONS')
                        && BOLT_EFFECT_CE_EFFECT[meta.effect] !== CEBoltEffect.ATTACK) {
                        this.applyMonsterOnHitStatus(caster.name, 'poisoned', result.damage * 2);
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
                const applied = this.applyBasicBoltEffect(target, meta.effect, meta.magnitude);
                const healed = applied.healed;
                autoID = applied.autoID;
                this.spawnFloatingText(`+${healed}`, target.loc.x, target.loc.y, 0x44ff88);
                logCast('bolt.monster_cast_heal', `${casterLabel} heals ${targetName} for ${healed} HP!`, '#44ff88');
                break;
            }

            case BoltEffect.HASTE: {
                const applied = this.applyBasicBoltEffect(target, meta.effect, meta.magnitude);
                autoID = applied.autoID;
                if (!applied.accepted) break;
                logCast('bolt.monster_cast_haste', `${casterLabel} hastes ${targetName}!`, '#ffff88');
                break;
            }

            case BoltEffect.SHIELDING: {
                autoID = true; // CE shielding has no living/visibility gate.
                target.applyShield(staffProtection(meta.magnitude));
                logCast('bolt.monster_cast_shield', `${casterLabel} shields ${targetName}!`, '#ffffcc');
                break;
            }

            case BoltEffect.SLOW: {
                const applied = this.applyBasicBoltEffect(target, meta.effect, meta.magnitude);
                autoID = applied.autoID;
                if (!applied.accepted) break;
                logCast('bolt.monster_cast_slow', `${casterLabel} slows ${targetName}!`, '#888888');
                break;
            }

            case BoltEffect.DISCORD: {
                // Candidate rejection is not contact immunity: reflection can hit anyone.
                const applied = this.applyBasicBoltEffect(target, meta.effect, meta.magnitude);
                autoID = applied.autoID;
                if (!applied.accepted) break;
                logCast('bolt.monster_cast_discord', `${casterLabel} sows discord in ${targetName}!`, '#ff88ff');
                break;
            }

            case BoltEffect.TELEPORT:
                this.teleportBoltTarget(target);
                break; // CE teleport never sets autoID.

            case BoltEffect.POLYMORPH:
                autoID = this.polymorphBoltTarget(target);
                break;

            case BoltEffect.DOMINATION:
                autoID = this.dominateBoltTarget(target);
                break;

            case BoltEffect.POISON:
                autoID = target.addPoison(staffPoison(meta.magnitude), 1) && this.canObserveBoltTarget(target);
                break;

            case BoltEffect.INVISIBILITY:
            case BoltEffect.ENTRANCEMENT:
                autoID = this.applyBasicBoltEffect(target, meta.effect, meta.magnitude).autoID;
                break;

            case BoltEffect.NEGATION: {
                const affected = this.negateCreatureMagic(target);
                autoID = affected && this.canObserveBoltTarget(target);
                break;
            }

            case BoltEffect.BECKONING: {
                autoID = this.beckonCreature(target, caster);
                logCast('bolt.monster_cast_beckon', `${casterLabel} beckons ${targetName} closer!`, '#88ccff');
                break;
            }

            default:
                break;
        }

        this.needsRender = true;
        return autoID;
    }

    /**
     * B-1b：鉴定卷轴的目标指定（CE promptForItemOfType，Items.c:7783-7802）。
     * 先整包 updateIdentifiableItem 扫一遍（≙ CE updateIdentifiableItems，
     * Items.c:7719-7727），无可鉴目标返回 false（"everything in your pack is
     * already identified."，卷轴照常消耗）；否则进入待选态并弹出背包
     * （复用背包弹层承载选择 UI，见 InventoryOverlay）。
     * 零掷骰：目标是玩家决定——B-1a 旧 identifyRandomItem 的 randRange 抽取
     * 随本方法移除。
     */
    private beginIdentifySelection(): boolean {
        if (!hasIdentifyTarget(this.player)) return false;
        this.pendingIdentify = true;
        this.isInventoryOpen = true;
        this.needsRender = true;
        return true;
    }

    /**
     * B-1b：玩家在待选弹层点选目标（CE do-while 循环的合法出口，
     * Items.c:7788-7802）。非法目标（不在背包 / 无可鉴之处）返回 false 并
     * 留在待选态——对齐 CE "选到合法目标为止"的强制语义。落账走
     * identifyInstance：实例全亮（附魔+符文）并亮种类。选择本身零回合成本
     * （CE 在读卷轴的同一回合内同步完成）。
     */
    public chooseIdentifyTarget(item: Item): boolean {
        if (!this.pendingIdentify) return false;
        if (!canIdentifyChosenItem(this.player, item)) return false;
        this.pendingIdentify = false;
        this.isInventoryOpen = false;
        ItemLoader.identifyInstance(item);
        logger.log(i18next.t('scroll.identify', { defaultValue: 'A flash of insight enters your mind!' }), '#ffff44');
        logger.log(i18next.t('item.identify_target', { name: item.displayName, defaultValue: `You identify the ${item.displayName}.` }), '#00ffff');
        this.needsRender = true;
        return true;
    }

    /**
     * B-1b：call——给未识别的风味种类起绰号（CE call()，Items.c:1347-1437）。
     * 只对五张风味种类表（药水/卷轴/法杖/魔杖/戒指）开放且种类未识别；
     * 已识别 → "you already know what that is."（Items.c:1384/1440）。
     * CE 对武器/护甲/护符/食物等的 call 转题字（inscribeItem，per-item
     * inscription，Items.c:1373-1381）——web 尚无题字功能，Call 入口不对这些
     * 类别开放（登记报告）。空/纯空白文本 = 清除绰号（Items.c:1429-1432）。
     */
    public callItem(item: Item, title: string): boolean {
        const kindId = ((item as any).consumableId ?? (item as any).identityId) as string | undefined;
        const hasKindTable = item.category === ItemCategory.POTION || item.category === ItemCategory.SCROLL
            || item.category === ItemCategory.WAND || item.category === ItemCategory.STAFF
            || item.category === ItemCategory.RING;
        if (!kindId || !hasKindTable) return false;
        if (ItemLoader.identifiedItems.has(kindId)) {
            logger.log(i18next.t('item.already_known', { defaultValue: 'You already know what that is.' }), '#aaaaaa');
            return false;
        }
        ItemLoader.callKind(kindId, title);
        logger.log(i18next.t('item.called_as', { name: item.displayName, defaultValue: `They are now known as "${item.displayName}".` }), '#dd88ff');
        return true;
    }

    private removeCurseFromInventory(): boolean {
        const cursed = this.player.inventory.items.find((invItem) => invItem.isCursed);
        if (!cursed) return false;
        cursed.isCursed = false;
        if (cursed.enchantment < 0) cursed.enchantment = 0;
        logger.log(i18next.t('item.uncursed', { name: cursed.name, defaultValue: `${cursed.name} is no longer cursed.` }), '#88ffcc');
        return true;
    }

    /** CE scroll of enchanting accepts any carried ring (Items.c:7839-7860). */
    public canEnchantTarget(item: Item): boolean {
        return canEnchantChosenItem(this.player, item);
    }

    public chooseEnchantTarget(item: Item): boolean {
        if (!this.pendingEnchantment || this.isInputLocked() || this.isGameOver
            || this.player.hp <= 0 || !this.canEnchantTarget(item)) return false;
        enchantChosenItem(this.player, item, {
            updateVision: () => this.updateVision(),
            enchantEquippedGear: () => { this.enchantEquippedItem(); },
            logArcana: target => logger.log(i18next.t('item.arcana_enchanted', { name: target.displayName,
                interpolation: { escapeValue: false }, defaultValue: 'Your {{name}} gleams briefly in the darkness.' }), '#99ddff'),
            logGear: () => logger.log(i18next.t('scroll.enchant', { defaultValue: 'Arcane force sharpens your gear.' }), '#99ddff'),
        });
        this.createFlare(this.player.loc.x, this.player.loc.y, LightKind.SCROLL_ENCHANTMENT_LIGHT);
        this.pendingEnchantment = false;
        this.isInventoryOpen = false;
        this.needsRender = true;
        finishItemUse(this.player, () => this.playerTurnEnded());
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
            const runicName = i18next.t('runic.name.' + target.runicType, { defaultValue: '未知符文' });
            logger.log(i18next.t('item.runic_awakened', { name: target.name, runic: runicName, defaultValue: `${target.name} awakens a ${runicName} rune!` }), '#88ccff');
        }
        return true;
    }

    /** CE Items.c:7904 -> rechargeItems(STAFF | CHARM), all items in the pack. */
    private rechargeStaffsAndCharms(): boolean {
        let found = false;
        for (const item of this.player.inventory.items) {
            if (item.category === ItemCategory.STAFF) {
                rechargeStaffFully(item, (item as any).identityId);
            } else if (item.category === ItemCategory.CHARM) {
                item.cooldownRemaining = 0;
            } else {
                continue;
            }
            found = true;
            logger.log(i18next.t('item.power_restored', { interpolation: { escapeValue: false }, name: item.displayName, defaultValue: `${item.displayName} crackles with restored power.` }), '#66ddff');
        }
        return found;
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

    /** CE Items.c:4465 negate, shared by player bolts, reflected/monster
     * bolts and scroll blasts. The return is the CE effect/autoID boolean;
     * recovering learning slots and evaluating the tile alone do not set it. */
    private negateCreatureMagic(target: Creature): boolean {
        if (target.hp <= 0) return false;
        const monster = target instanceof Monster ? target : undefined;
        const originalName = target.name;
        let affected = false;
        // CE does these two operations BEFORE the death/invulnerability gate.
        if (monster) {
            for (const flag of monster.abilityFlags) {
                if (!NON_NEGATABLE_ABILITIES.has(flag)) {
                    monster.abilityFlags.delete(flag);
                    monster.wasNegated = affected = true;
                }
            }
        }
        if (target.seizing) { target.seizing = false; affected = true; }
        if (monster?.diesIfNegated()) {
            // killCreature bypasses both protection and invulnerability.
            const message = monster.hasStatus('levitating')
                ? i18next.t('negation.dissipates', { target: originalName, defaultValue: `${originalName} dissipates into thin air!` })
                : monster.hasBehavior('MONST_INANIMATE') || monster.hasBehavior('MONST_TURRET')
                    ? i18next.t('negation.shatters', { target: originalName, defaultValue: `${originalName} shatters into tiny pieces!` })
                    : i18next.t('bolt.negation_dies', { target: originalName, defaultValue: `${originalName} falls to the ground, lifeless!` });
            monster.hp = 0;
            monster.takeDamage(0, true);
            logger.log(message, '#ffffff');
            this.needsRender = true;
            return true;
        }
        if (!monster?.isInvulnerable()) {
            const hadPlayerDarkness = target === this.player && target.hasStatus('darkness');
            affected = negateCreatureStatusEffects(target, target === this.player) || affected;
            if (hadPlayerDarkness && !target.hasStatus('darkness')) this.updateVision();
            if (monster?.hasBehavior('MONST_IMMUNE_TO_FIRE')) {
                monster.behaviorFlags.delete('MONST_IMMUNE_TO_FIRE');
                monster.wasNegated = affected = true;
            }
            if (target.hasAlteredSpeeds()) affected = true;
            if (monster) monster.polymorphKeepsSpeed = false;
            target.refreshSpeeds();
            if (monster?.mutation && NEGATABLE_MUTATIONS.has(monster.mutation.id)) {
                // CE removes mutationIndex only: info HP/damage/speeds survive.
                monster.mutation = undefined;
                const species = (monsterData as MonsterData[]).find(d => d.id === monster.typeId);
                if (species) { monster.name = ItemLoader.translateName(species.name); monster.color = species.color; }
                monster.wasNegated = affected = true;
            }
            if (monster && [...monster.behaviorFlags].some(flag => NEGATABLE_TRAITS.has(flag))) {
                if (monster.hasBehavior('MONST_FIERY')) this.extinguishCreatureFire(monster);
                for (const flag of NEGATABLE_TRAITS) monster.behaviorFlags.delete(flag);
                monster.wasNegated = affected = true;
            }
            if (monster) {
                if (hasNegatableBolt(monster.bolts)) monster.wasNegated = affected = true;
                monster.bolts = negateBolts(monster.bolts);
                monster.newPowerCount = monster.totalPowerCount;
                // W-22 absorption runtime is deferred; no new absorption fields.
            }
            this.applyEnvironmentalEffects(target);
        }
        if (affected && monster) {
            logger.log(i18next.t('scroll.negation_stripped', {
                target: originalName, defaultValue: `${originalName} is stripped of special traits!`
            }), '#ffffff');
        }
        this.needsRender = true;
        return affected;
    }

    /**
     * Items.c:4827-4881 negationBlast(emitterName, distance)——SCROLL_NEGATION
     * 的 AoE（Items.c:8004-8006，distance = DCOLS）。discordBlast 的同构姊妹：
     *   1. 消息 "emits a numbing torrent of anti-magic!"（:4831）；
     *   2. colorFlash（:4833）web 无视觉系统载体，跳过（登记）；
     *   3. 先 negate(&player)（:4834，玩家自己也吃——按目录逐项处理，无消息）；
     *   4. 怪物循环（:4836-4846）：命中条件 = IN_FIELD_OF_VIEW **且**
     *      欧氏距离² ≤ distance²（web 的 FOV 口径沿 discordBlastFromPlayer：
     *      玩家→怪物实时视线判定）；diesIfNegated 当场死（CE 注释
     *      "This can be fatal."），否则清魔法（"is stripped of special
     *      traits" 消息在 CE negate() 尾部 :4548-4552）；
     *   5. 地面物品循环（:4847-4880）：同样的 FOV + 距离² 条件——**只作用
     *      于地面物品**（CE 遍历 floorItems，不含玩家背包/装备）；先无条件
     *      清 ITEM_MAGIC_DETECTED | ITEM_CURSED，再按 category 分派
     *      （WEAPON/ARMOR 附魔归零+符文消失+自动鉴定 / STAFF·WAND 充能清零 /
     *      RING 揭示 +0 / CHARM 重置充能延迟）。
     */
    private negationBlastFromPlayer(emitterName: string): void {
        logger.log(i18next.t('scroll.negate_burst', {
            emitter: emitterName,
            defaultValue: `${emitterName} emits a numbing torrent of anti-magic!`
        }), '#ff99ee');

        // CE :4834 negate(&player)——先于怪物循环，玩家自己的魔法也被清。
        this.negateCreatureMagic(this.player);

        const px = this.player.loc.x;
        const py = this.player.loc.y;
        const distance = DCOLS;
        for (const m of this.monsters) {
            if (m.hp <= 0) continue;
            if (!this.hasLineOfSight(px, py, m.loc.x, m.loc.y)) continue;
            const distSq = (px - m.loc.x) * (px - m.loc.x) + (py - m.loc.y) * (py - m.loc.y);
            if (distSq > distance * distance) continue;
            this.negateCreatureMagic(m);
        }

        // CE :4847 floorItems——web 的地面物品容器 = this.items（背包在
        // player.inventory，不经此表）。
        for (const theItem of this.items) {
            if (!this.hasLineOfSight(px, py, theItem.loc.x, theItem.loc.y)) continue;
            const distSq = (px - theItem.loc.x) * (px - theItem.loc.x) + (py - theItem.loc.y) * (py - theItem.loc.y);
            if (distSq > distance * distance) continue;

            theItem.magicDetected = false; // CE ITEM_MAGIC_DETECTED（:4851）
            theItem.isCursed = false;      // CE ITEM_CURSED
            switch (theItem.category) {
                case ItemCategory.WEAPON:
                case ItemCategory.ARMOR: {
                    // CE :4855 enchant1 = enchant2 = charges = 0：web 的
                    // enchantment ≙ enchant1、timesUsed ≙ enchant2（B-1a 字段
                    // 注）；charges 在武器/护甲上是**熟悉度倒计时**的复用位
                    // （CE Items.c:275/285 杀 20 敌/穿 1000 回合）——CE 在这里
                    // 确实把它一并清零，照抄。
                    theItem.enchantment = 0;
                    theItem.timesUsed = 0;
                    theItem.charges = 0;
                    // CE :4856 清 ITEM_RUNIC | RUNIC_HINTED | RUNIC_IDENTIFIED |
                    // ITEM_PROTECTED → 符文与保护消失。
                    theItem.runicType = undefined;
                    theItem.runicKnown = false;
                    theItem.isProtected = false;
                    // CE :4857 identify(theItem)：自动鉴定（实例全亮 + 亮种类；
                    // 在符文已清之后调用，CE identify() 内的 runic 分支自然不触发）。
                    ItemLoader.identifyInstance(theItem);
                    // CE :4858 清 pmap ITEM_DETECTED + :4859 refreshDungeonCell
                    // —— web 无 per-cell 物品探知标记（detect magic 走实例旗标
                    // magicDetected），无载体，跳过（登记）。
                    break;
                }
                case ItemCategory.STAFF:
                    theItem.charges = 0; // CE :4862
                    break;
                case ItemCategory.WAND:
                    // CE :4865-4866：清**剩余充能**（charges），不动 enchant2
                    // （web timesUsed 已放电计数）；并揭示充能上限。
                    theItem.charges = 0;
                    theItem.maxChargesKnown = true;
                    break;
                case ItemCategory.RING:
                    // CE :4869-4871：附魔归零 + ITEM_IDENTIFIED——揭示它现在是
                    // +0，但**不必然**揭示是哪种戒指（种类识别在 identifyItemKind
                    // 之外，这里不走 identifyInstance）。
                    theItem.enchantment = 0;
                    theItem.identified = true;
                    ItemLoader.updateIdentifiableItem(theItem); // CE updateIdentifiableItems()
                    break;
                case ItemCategory.CHARM:
                    // CE Items.c:4874: negation starts a full recharge cycle.
                    if (isCharmKind(theItem.identityId)) {
                        theItem.cooldownTurns = charmRechargeDelay(theItem.identityId, theItem.enchantment);
                        theItem.cooldownRemaining = theItem.cooldownTurns;
                    }
                    break;
                default:
                    break;
            }
        }
    }

    /**
     * Items.c:7941-7943 SCROLL_SANCTUARY：玩家脚下落 DF_SACRED_GLYPHS
     * （Globals.c:676 {SACRED_GLYPH, SURFACE, 100, 100, 0, "",
     * EMPOWERMENT_LIGHT}），然后打消息。CE 五参形态
     * spawnDungeonFeature(x, y, feat, refreshCell=true, abortIfBlocking=false)
     * ——web 签名无 refreshCell（渲染侧自理），第四参即 abortIfBlocking。
     * start=100/decr=100 的十字波前：中心格 + 4 正邻各一枚圣徽（CE 的
     * "forming glyphS where they alight"）。
     */
    private sanctuaryFromPlayer(): void {
        spawnDungeonFeature(this.grid, this.player.loc.x, this.player.loc.y,
            catalogFeature(DF.DF_SACRED_GLYPHS), false);
        logger.log(i18next.t('scroll.sanctuary', {
            defaultValue: 'sprays of color arc to the ground, forming glyphs where they alight.'
        }), '#ffffaa');
    }

    /** CE Items.c:4904-4939 crystalize: radius + IMPREGNABLE gate precedes
     * every terrain/DF/creature mutation. Only DUNGEON obstruction qualifies;
     * DF_SHATTERING_SPELL lays rubble and activates dormant monsters before
     * embedded creature handling, then unprotected boundary walls crystallize.
     * Refresh vision immediately; the web renderer consumes needsRender.
     */
    private crystalizeFromPlayer(radius: number): void {
        const px = this.player.loc.x;
        const py = this.player.loc.y;
        for (let i = 0; i < DCOLS; i++) {
            for (let j = 0; j < DROWS; j++) {
                const distSq = (px - i) * (px - i) + (py - j) * (py - j);
                if (distSq > radius * radius || this.grid.isImpregnable(i, j)) continue; // CE :4911-4912
                const cell = this.grid.getCell(i, j);
                if (!cell) continue;
                const dungeonTile = cell.layers[DungeonLayer.DUNGEON]!;
                // CE :4914：读 DUNGEON 层的旗标，不是 cell.terrain 的竞速结果。
                if (!(TERRAIN_FLAGS[dungeonTile].flags & (T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_VISION))) continue;

                cell.layers[DungeonLayer.DUNGEON] = TerrainType.FORCEFIELD; // CE :4916
                // CE :4917: RUBBLE on SURFACE, start=0; also wakes dormant monsters.
                spawnDungeonFeature(this.grid, i, j, catalogFeature(DF.DF_SHATTERING_SPELL), false);

                const monst = this.getMonsterAt(i, j); // CE :4919 HAS_MONSTER
                if (monst) {
                    // MONST_TURRET is an unexpanded CE composite in web data.
                    if (monst.hasBehavior('MONST_ATTACKABLE_THRU_WALLS') || monst.hasBehavior('MONST_TURRET')) {
                        monst.takeDamage(monst.hp, true); // CE inflictLethalDamage bypasses shields.
                    } else if (monst.isCaged && (cellTerrainFlags(this.grid, i, j) & T_OBSTRUCTS_PASSABILITY)) {
                        // Movement.c:760 freeCaptivesEmbeddedAt, after the DF as in CE.
                        this.freeCaptive(monst);
                    }
                }
                if (i === 0 || i === DCOLS - 1 || j === 0 || j === DROWS - 1) {
                    cell.layers[DungeonLayer.DUNGEON] = TerrainType.CRYSTAL_WALL; // CE :4928-4929（DF 之后覆写）
                }
                // Retained layers still obstruct even when the display layer does not.
                const flags = cellTerrainFlags(this.grid, i, j);
                cell.isPassable = !(flags & T_OBSTRUCTS_PASSABILITY);
                cell.isOpaque = !!(flags & T_OBSTRUCTS_VISION);
            }
        }
        this.updateVision(); // CE :4935 updateVision(false)——当场重算
        this.needsRender = true;
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
                if (!cell || (cellTerrainFlags(this.grid, x, y) & T_OBSTRUCTS_PASSABILITY) || this.getMonsterAt(x, y)) continue;
                if (!rng.randPercent(10)) continue;

                // CE spawnHorde(0, ...)：10% out-of-depth + 禁用集过滤 + frequency 加权抽 horde
                const spawn = this.rollSpawnDepth(this.depth);
                const forbidden = spawn.outOfDepth
                    ? [...HORDE_PERIODIC_FORBIDDEN_FLAGS, 'HORDE_NEVER_OOD']
                    : HORDE_PERIODIC_FORBIDDEN_FLAGS;
                const horde = this.pickHordeType(this.hordeCandidates(spawn.depth, forbidden));
                if (!horde || !this.hordeFitsTerrain(horde, { x, y })) continue;

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

    /**
     * CE 投掷射程（Items.c:7130）：12 + 2 × max(力量 − 虚弱量 − 12, 2)。
     * 注意下限是 2 不是 0——力 12 也能扔 16 格。虚弱量取 weaknessAmount，
     * 不使用 STATUS_WEAKENED 的持续时间。
     */
    private throwMaxDistance(): number {
        return 12 + 2 * Math.max(this.player.effectiveStrength - 12, 2);
    }

    /**
     * B-2：CE getQualifyingLocNear（Monsters.c:3960-4024，deterministic=false）
     * 的投掷落点版（Items.c:7058）：forbiddenTerrain = T_OBSTRUCTS_ITEMS |
     * T_OBSTRUCTS_PASSABILITY，forbiddenMap = HAS_ITEM；环序扫描（k=0 即
     * 目标格自身）计合格格数，rand_range(1, candidateLocs) 抽第 N 个。
     * 与 CE 的偏差：web randRange(1,1) 因上界≤下界短路**不消耗**掷骰
     *（CE 会消耗一次）——只影响流位置，不影响落点分布，登记报告。
     * 候选格不存在时 CE 是未初始化的 UB（实际不可达），web 回退目标格。
     */
    private qualifyingThrowLanding(target: Pos): Pos {
        const qualifies = (x: number, y: number): boolean => {
            if (!this.grid.isValidPos(x, y)) return false;
            if (cellTerrainFlags(this.grid, x, y) & (T_OBSTRUCTS_ITEMS | T_OBSTRUCTS_PASSABILITY)) return false;
            return !this.items.some(i => i.loc.x === x && i.loc.y === y);
        };
        const maxR = Math.max(DROWS, DCOLS);
        let candidateLocs = 0;
        for (let k = 0; k < maxR && !candidateLocs; k++) {
            for (let x = target.x - k; x <= target.x + k; x++) {
                for (let y = target.y - k; y <= target.y + k; y++) {
                    if (x === target.x - k || x === target.x + k || y === target.y - k || y === target.y + k) {
                        if (qualifies(x, y)) candidateLocs++;
                    }
                }
            }
        }
        if (candidateLocs === 0) return target;
        let randIndex = rng.randRange(1, candidateLocs);
        for (let k = 0; k < maxR; k++) {
            for (let x = target.x - k; x <= target.x + k; x++) {
                for (let y = target.y - k; y <= target.y + k; y++) {
                    if (x === target.x - k || x === target.x + k || y === target.y - k || y === target.y + k) {
                        if (qualifies(x, y) && --randIndex === 0) {
                            return { x, y };
                        }
                    }
                }
            }
        }
        return target; // 不可达（candidateLocs>0 时必然命中）
    }

    /**
     * CE 投掷药水的"功能性 7 种"（Items.c:6986-7026）→ web 载体（按 effect 名）：
     *   POTION_POISON      → poison_burst      addGas(POISON,1000)   （既有，G-1 折算）
     *   POTION_CONFUSION   → confusion_burst   addGas(CONFUSION,1000)（既有，G-1 折算）
     *   POTION_PARALYSIS   → paralyze_burst    addGas(PARALYSIS,1000)（G-3 同款）
     *   POTION_INCINERATION→ fire_burst        igniteForced 3×3      （既有，F-2a）
     *   POTION_DESCENT     → fall_down         DF_HOLE_POTION        （C-5 的 DF 已在目录）
     *   POTION_DARKNESS    → web 无该药水种类 —— 只登记不实现
     *   POTION_LICHEN      → potion_of_creeping_death 被 D2 退池且无
     *                        DF_LICHEN_PLANTED —— 只登记不实现
     * 载体在池的功能性药水才 autoIdentify（B-1a 的"全部亮"简化本轮反转）。
     */
    private static readonly THROWN_FUNCTIONAL_POTION_EFFECTS: ReadonlySet<string> =
        new Set(['poison_burst', 'confusion_burst', 'paralyze_burst', 'fire_burst', 'fall_down']);

    /**
     * CE Items.c:7036-7046 幻觉药水投掷特例：碎裂无害不亮，除非
     * (a) 这一件被 detect magic 照过（ITEM_MAGIC_DETECTED），或
     * (b) 善意药水种类全部已知（magicPolarityRevealedItemKindCount == 8，
     *     GlobalsBulletBrogue.c:1065 numberGoodPotionKinds=8；web 善意药水
     *     同为 8 种，B-1c 已核）。
     */
    private thrownPotionAutoIdentifies(item: Item, effect: string | undefined): boolean {
        if (effect === 'hallucinate_burst') {
            if (item.magicDetected) return true;
            const good = ItemLoader.potions
                .map(p => p.id)
                .filter(id => ItemLoader.kindPolarity(id) === 1);
            const known = good.filter(id =>
                ItemLoader.identifiedItems.has(id) || ItemLoader.isPolarityRevealed(id));
            return known.length === good.length && good.length > 0;
        }
        return !!effect && Game.THROWN_FUNCTIONAL_POTION_EFFECTS.has(effect);
    }

    public throwItemAt(item: Item, tx: number, ty: number) {
        this.isThrowing = false;
        this.throwItemTarget = null;

        if (!this.grid.isValidPos(tx, ty) || !this.player.inventory.items.includes(item)) return;

        // CE throwCommand（Items.c:7099-7111）：已装备且是最后一件 → 诅咒装备
        // 扔不出去（取消，不耗回合）。confirm 弹层是 UI 债，登记。
        const isEquippedWeapon = this.player.equippedWeapon === item;
        if (isEquippedWeapon && item.quantity <= 1 && item.isCursed) {
            logger.log(i18next.t('throw.cursed_equipped', {
                name: item.displayName,
                defaultValue: `You cannot unequip your ${item.displayName}; it appears to be cursed.`
            }), '#ff9999');
            return;
        }

        const origin = { ...this.player.loc };
        const maxDistance = this.throwMaxDistance();

        // CE throwCommand 尾段（Items.c:7152-7162）：先备好"飞行的那一件"，
        // 再更新背包。堆叠 >1：数量 -1，克隆件（quantity=1）起飞；
        // 最后一件：整件移出背包（已装备则先卸下）。
        const thrown = prepareThrownItem(this.player, item, origin, isEquippedWeapon);

        // —— 弹道（CE throwItem，Items.c:6882-6947）——
        // BOLT_NONE 取线（web 复用 boltPath 的 Bresenham 近似，怪物弹道同款）；
        // 逐格推进、上限 maxDistance；命中第一个非潜水生物即结算（web 无
        // 潜水簿记，不跳过任何怪——登记）；遇墙/挡视格退一格落地。
        const path = boltPath(origin, { x: tx, y: ty });
        let x = origin.x, y = origin.y;
        let hitSomethingSolid = false;
        for (let i = 0; i < path.length && i < maxDistance; i++) {
            x = path[i]!.x;
            y = path[i]!.y;

            const monst = this.getMonsterAt(x, y);
            if (monst && monst.hp > 0) {
                if (thrown.category === ItemCategory.WEAPON) {
                    // CE Items.c:6906-6921：命中 → 结算后投掷物消失；
                    // 未命中 → break，投掷物落在怪物所在格的合格邻格。
                    // CE 的 aggro（TRACKING_SCENT，Items.c:6791-6801）在掷骰前
                    // 置位——miss 也激怒。W-18 在 Combat 清 ENTRANCED；web 无魔法恐惧
                    // 豁免分支，仅保留盟友与逃跑怪不激怒的近似（登记）。
                    if (!monst.isAlly && monst.state !== MonsterState.FLEEING) {
                        monst.state = MonsterState.HUNTING;
                    }
                    const res = CombatSystem.resolveThrownWeapon(this.player, monst, thrown);
                    if (res.hit) {
                        if (res.killed) {
                            logger.log(i18next.t('throw.killed', {
                                weapon: thrown.displayName, monster: monst.name,
                                defaultValue: `The thrown ${thrown.displayName} killed the ${monst.name}!`
                            }), '#ffaa00');
                            this.stats.kills++;
                        } else {
                            logger.log(i18next.t('throw.hit', {
                                weapon: thrown.displayName, monster: monst.name, damage: res.damage,
                                defaultValue: `The ${thrown.displayName} hit the ${monst.name} for ${res.damage} damage.`
                            }), '#ffcc00');
                            // CE Items.c:6845-6849：符文只在目标存活时触发
                            //（resolveThrownWeapon 同口径只在存活时掷）。
                            if (res.triggeredRunic) {
                                this.applyWeaponRunicEffect(monst, res.damage, res.triggeredRunic);
                            }
                        }
                        this.spawnBlood(monst.loc.x, monst.loc.y);
                        this.needsRender = true;
                        timeSystem.currentTick += this.player.movementSpeed;
                        this.playerTurnEnded();
                        return;
                    }
                    logger.log(i18next.t('throw.miss', {
                        weapon: thrown.displayName, monster: monst.name,
                        defaultValue: `The thrown ${thrown.displayName} missed the ${monst.name}.`
                    }), '#888888');
                }
                break;
            }

            // CE Items.c:6926-6950：撞上挡通行/挡视格 → 退一格（point-blank
            // 撞墙则落在原地），hitSomethingSolid 供药水碎裂判定。
            if (cellTerrainFlags(this.grid, x, y) & (T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_VISION)) {
                i--;
                if (i >= 0) {
                    x = path[i]!.x;
                    y = path[i]!.y;
                } else {
                    x = origin.x;
                    y = origin.y;
                }
                hitSomethingSolid = true;
                break;
            }

            if (x === tx && y === ty) break; // CE Items.c:6946 到达目标格
        }

        // —— 药水碎裂（CE Items.c:6949-7047）——
        // 条件：撞了东西，或落点不是坠层格（T_AUTO_DESCENT）。扔进洞里的
        // 药水不碎，整瓶落到合格邻格（CE 原样）。
        if (thrown.category === ItemCategory.POTION) {
            const trueId = (thrown as any).consumableId as string | undefined;
            const data = ItemLoader.potions.find(p => p.id === trueId);
            const effect = data?.effect;
            const shatters = hitSomethingSolid ||
                !(cellTerrainFlags(this.grid, x, y) & T_AUTO_DESCENT);
            if (shatters) {
                logger.log(i18next.t('throw.shatter', {
                    name: thrown.displayName,
                    defaultValue: `You throw the ${thrown.displayName}. It shatters!`
                }), '#ffaa00');

                if (this.thrownPotionAutoIdentifies(thrown, effect)) {
                    // CE Items.c:7028 autoIdentify——功能性药水（或达成特例的
                    // 幻觉药水）碎裂即种类亮，经 identifyItemKind 走升格联动。
                    if (!ItemLoader.identifiedItems.has(trueId ?? '')) {
                        ItemLoader.identifyItemKind(thrown);
                        logger.log(i18next.t('item.was_a', {
                            name: thrown.name,
                            defaultValue: `It was a ${thrown.name}!`
                        }), '#00ffff');
                    }
                }

                if (effect === 'fire_burst') {
                    // F-2a：同 fire_burst 药水——CE 焚化类 = DF 生成家族。
                    this.environment.igniteForced(x, y);
                    const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, 1], [-1, 1], [1, -1]];
                    for (const [dx, dy] of dirs) this.environment.igniteForced(x + dx!, y + dy!);
                } else if (effect === 'poison_burst') {
                    // G-1 折算：DF_POISON_GAS_CLOUD_POTION startProbability 1000
                    //（Globals.c:779）。
                    this.environment.addGas(x, y, GasType.POISON, 1000);
                } else if (effect === 'confusion_burst') {
                    // G-1 折算：DF_CONFUSION_GAS_CLOUD_POTION（Globals.c:779）。
                    this.environment.addGas(x, y, GasType.CONFUSION, 1000);
                } else if (effect === 'paralyze_burst') {
                    // G-3 同款：DF_PARALYSIS_GAS_CLOUD_POTION → addGas 1000
                    //（Items.c:6994-6997 投掷与喝同链）。
                    this.environment.addGas(x, y, GasType.PARALYSIS, 1000);
                } else if (effect === 'fall_down') {
                    // C-5：DF_HOLE_POTION（HOLE_EDGE 波前 + subsequentDF DF_HOLE_2
                    // 落 HOLE）。CE 不对落点生物即时结算坠层（Items.c:7030-7033
                    // 的 applyInstantTileEffectsToCreature 是注释掉的死代码）。
                    spawnDungeonFeature(this.grid, x, y, catalogFeature(DF.DF_HOLE_POTION), false);
                }
                // 非功能性药水（含幻觉特例未达成时）：CE"splashes harmlessly"，
                // 无效果、不自亮（ce2 残留的 heal_full 投掷满血分支已按 CE 删除）。

                this.needsRender = true;
                timeSystem.currentTick += this.player.movementSpeed;
                this.playerTurnEnded();
                return; // 药水碎裂即消失（CE Items.c:7052）
            }
            // 未碎裂：落到洞边合格格（走下方通用落地）。
        }

        // —— 通用落地（CE Items.c:7055-7061）——
        logger.log(i18next.t('throw.generic', {
            name: thrown.displayName,
            defaultValue: `You throw the ${thrown.displayName}.`
        }), '#aaaaaa');
        const dropLoc = this.qualifyingThrowLanding({ x, y });
        thrown.loc = { ...dropLoc };
        this.items.push(thrown);

        this.needsRender = true;
        // CE Items.c:7173 throwItem() 以 playerTurnEnded() 收尾——完整回合
        timeSystem.currentTick += this.player.movementSpeed;
        this.playerTurnEnded();
    }

    /**
     * CE rogue.justRested 的 web 近似：本回合的输入是否为等待。
     * CE 里 REST/PERIOD/NUMPAD5 每次按键置位（IO.c:2521-2527）、回合末清除
     * （Time.c:2874）；web 在 handlePlayerAction 入口清零、wait 分支置位，
     * 供 calculateStealthRange 的"刚休息过再减半"消费。
     */
    private justRested: boolean = false;

    /**
     * P1-42：CE rogue.justSearched（Rogue.h:2449）——上一动作是主动搜索。
     * manualSearch 置位；CE 在 playerTurnEnded 尾部清除（Time.c:2875），
     * web 对应在 finishTurnEpilogue 尾部。它只被 playerTurnEnded 的充能
     * 清零分支消费（Time.c:2550-2552：搜索只在连续回合充能）。
     */
    private justSearched: boolean = false;

    /**
     * P1-42：CE player.status[STATUS_SEARCHING] 的充能计数（manualSearch
     * 累加、满 5 归零，Time.c:2397-2424）。**不能**放进会衰减的
     * statusDurations：CE 的 decrementPlayerStatus（Time.c:2211-2395 全函数）
     * 不碰 STATUS_SEARCHING，其唯一归零路径就是"非连续回合清零"分支与
     * 满充终搜自身。开局归零见 startNewGame。
     */
    private searchingCharge: number = 0;

    /**
     * P1-42：本层"是否存在未发现密门"的惰性缓存（secretScanDepth = 建立缓存
     * 时的层号，-1 = 无效）。searchForSecrets 首次在当前层被调用时全格扫一遍
     * （一层一次），此后无密门的层直接短路——自动搜索在每个新落格都会触发，
     * 没有这层守卫时每步的窗口扫描会累积成可观测的回合期开销（40k 回合的
     * armor_model 聚合测试实测敏感）。换层（depth 变化）即失效重扫；层内
     * 发现密门不失效——窗口扫描本就按 terrain 现查，发现的门自然不再命中。
     */
    private secretScanDepth: number = -1;
    private levelHasSecrets: boolean = false;

    /** CE Items.c:8712: awareness contributes twenty points per effective E. */
    private awarenessBonus(): number {
        return 20 * ringBonus(this.player.rings(), 'ring_of_awareness');
    }

    /**
     * P4-8 返工：CE currentStealthRange()（Time.c:791-832）的口径对齐。
     * 旧实现（基数 3 + 护甲 weight − 2 + 光照 +4）为自创公式，与 CE 无一处
     * 对应，据此算出的 awareness 皮筋比 CE 短约三倍。
     *
     * 逐项对照（取舍详情见 ai_docs/p4_8_scent_map_report.md）：
     *   - 隐身恒 1                    Time.c:795-797  ✅ 照抄
     *   - 基数 14                     Time.c:793      ✅ 照抄
     *   - playerInDarkness 再减半     Light.c:283-287 ✅ C-7 接线（光照管线
     *     落地后按玩家格三通道光强实时判定；黑暗药水载体仍缺，暂只由
     *     地形暗光触发）
     *   - IS_IN_SHADOW 减半（可叠加） Light.c:222 一族 ✅ C-7 翻正为查询
     *     玩家格（P4-8 时期的"恒减半"近似退役：矿灯不驱散阴影（Light.c:70-71
     *     注释），岩浆/烛光等地形光驱散——与 CE 语义一致）
     *   - 护甲力量需求加成            Time.c:784-790  ✅ max(0, strengthRequired − 12)
     *   - 刚休息过（本回合是等待）减半 Time.c:813-815  ✅ justRested 近似为
     *     "本回合输入是 wait"（CE IO.c:2521-2527 的 REST/PERIOD/NUMPAD5）
     *   - STATUS_AGGRAVATING          Time.c:817-819  ❌ 略去——web 无该状态
     *   - 戒指 stealthBonus           Time.c:822-824  ✅ 有效附魔接入
     *   - 下限钳制 2 / 1              Time.c:826-829  ✅ 照抄
     */
    private calculateStealthRange(): number {
        if (this.player.hasStatus('invisible')) return 1;

        let range = 14;
        // C-7 翻正 P4-8 的"恒处于阴影"近似（CE Time.c:798-806）：
        //   - playerInDarkness（Light.c:283-287）：玩家格三通道光强全部
        //     低于矿灯色−10 → 减半；
        //   - IS_IN_SHADOW（Light.c:97-99：矿灯不驱散阴影，地形/生物正色光
        //     驱散）→ 再减半，可叠加。周边无光源时玩家仍恒在阴影中（与
        //     CE 一致），站进岩浆/祭坛烛光等光照范围则恢复。
        if (this.playerInDarkness()) {
            range = Math.floor(range / 2);
        }
        if (this.lightMap.inShadowAt(this.player.loc.x, this.player.loc.y)) {
            range = Math.floor(range / 2);
        }

        const armor = this.player.equippedArmor;
        if (armor) {
            range += Math.max(0, (armor.strengthRequired || 0) - 12);
        }

        if (this.justRested) {
            range = Math.ceil(range / 2);
        }

        range += this.player.getStatusDuration('aggravating');
        // CE Time.c:821-823 / updateRingBonuses: a negative stealth bonus is multiplied by four.
        const stealth = ringBonus(this.player.rings(), 'ring_of_stealth');
        range -= stealth < 0 ? stealth * 4 : stealth;

        if (range < 2 && !this.justRested) {
            range = 2;
        } else if (range < 1) {
            range = 1;
        }
        return range;
    }

    /** CE Movement.c:700 / Monsters.c:3742. No HP/nutrition penalty.
     * Call only for physical movement/melee attempts, never rest or casting. */
    public tryVomit(entity: Creature): boolean {
        if (!entity.hasStatus('nauseous') || !rng.randPercent(25)) return false;
        spawnDungeonFeature(this.grid, entity.x, entity.y, catalogFeature(DF.DF_VOMIT), false);
        if (entity === this.player || this.visibleMonsters.has(entity as Monster)) {
            logger.log(i18next.t('status.vomit', { name: entity === this.player ? '你' : entity.name,
                defaultValue: `${entity === this.player ? '你' : entity.name}剧烈地呕吐。` }), '#b7a26b');
        }
        if (entity instanceof Monster) entity.ticksUntilTurn = entity.movementSpeed;
        this.needsRender = true;
        return true;
    }

    private playerVomitAttempt(): boolean {
        if (!this.tryVomit(this.player)) return false;
        timeSystem.currentTick += this.player.movementSpeed;
        this.playerTurnEnded();
        return true;
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
                        monster: this.monsterDisplayName(monster),
                        status: this.getStatusLabel(status),
                        defaultValue: `${this.monsterDisplayName(monster)} is immune to ${this.getStatusLabel(status)}.`
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
                    monster: this.monsterDisplayName(monster),
                    status: this.getStatusLabel(status),
                    defaultValue: `${this.monsterDisplayName(monster)} resists ${this.getStatusLabel(status)}.`
                }),
                '#b0e0ff'
            );
        }
        return true;
    }

    private getPlayerStatusResistance(_status: StatusId): { nullifyChance: number; durationReduction: number } {
        let nullifyChance = 0;
        let durationReduction = 0;

        return { nullifyChance, durationReduction };
    }

    public applyMonsterOnHitStatus(monsterName: string, status: StatusId, duration: number): boolean {
        // Preserve immunity granted by existing status sources.
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
        // Ring effects are consumed directly from equipped effective enchantments.
    }

    /**
     * Apply a weapon runic effect that was already determined to trigger by Combat.ts.
     * This is separate from tryTriggerWeaponRunic, which uses legacy flat-chance triggers.
     * applyWeaponRunicEffect is called when Combat.ts's enchantment-scaled trigger fires.
     */
    private applyWeaponRunicEffect(target: Monster, damage: number, runicType: string) {
        const weapon = this.player.equippedWeapon;
        if (!weapon) return;
        const previouslyKnown = weapon.runicKnown;
        // CE Combat.c:679-695: a visible flare/flash identifies before the
        // effect; submerged targets identify only through an observable effect.
        const visible = this.canObserveBoltTarget(target);
        if (visible) weapon.runicKnown = true;
        const enchant = netEnchant(weapon.enchantment, this.player.effectiveStrength, weapon.strengthRequired ?? 0);

        switch (runicType) {
            case 'paralyzing': {
                const duration = weaponParalysisDuration(enchant);
                // CE writes the status array directly; web's generic
                // statusImmunities are not a weapon runic eligibility gate.
                target.setStatusDuration('paralyzed', Math.max(target.getStatusDuration('paralyzed'), duration));
                target.maxStatus.paralyzed = target.getStatusDuration('paralyzed');
                if (visible) {
                    logger.log(i18next.t('runic.weapon.paralyzing', { target: this.monsterDisplayName(target), defaultValue: `Runic power paralyzes the ${this.monsterDisplayName(target)}!` }), '#99ccff');
                    this.spawnFloatingText(i18next.t('status.float.paralyzed', { defaultValue: 'Paralyzed' }), target.loc.x, target.loc.y, 0x99ccff);
                }
                break;
            }
            case 'venom': {
                const poisonDmg = Math.max(1, Math.floor(damage * 0.5));
                const applied = this.applyStatusToMonster(target, 'poisoned', poisonDmg, 'runic');
                if (applied) {
                    logger.log(i18next.t('runic.weapon.venom', { target: this.monsterDisplayName(target), damage: poisonDmg, defaultValue: `Runic venom poisons the ${this.monsterDisplayName(target)} for ${poisonDmg} turns.` }), '#88dd88');
                }
                break;
            }
            case 'quietus': {
                target.takeDamage(9999, true);
                weapon.runicKnown = true;
                logger.log(i18next.t('runic.weapon.quietus', { target: this.monsterDisplayName(target), defaultValue: `Runic magic instantly slays the ${this.monsterDisplayName(target)}!` }), '#ccaaff');
                break;
            }
            case 'slaying': {
                target.takeDamage(9999, true);
                weapon.runicKnown = true;
                logger.log(i18next.t('runic.weapon.slaying', { target: this.monsterDisplayName(target), defaultValue: `Your weapon of slaying destroys the ${this.monsterDisplayName(target)}!` }), '#ff6666');
                break;
            }
            case 'vampirism': {
                const heal = Math.max(1, Math.floor(damage * 0.5));
                this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal);
                logger.log(i18next.t('runic.weapon.vampirism', { target: this.monsterDisplayName(target), heal, defaultValue: `Your weapon drains ${heal} life from the ${this.monsterDisplayName(target)}.` }), '#ff4444');
                break;
            }
            case 'speed': {
                // CE grants a free player action; the attack recovery helper
                // skips adding attackSpeed while this sentinel is negative.
                if (this.player.ticksUntilTurn !== -1) {
                    this.player.ticksUntilTurn = -1;
                    weapon.runicKnown = true;
                    logger.log(i18next.t('runic.weapon.speed', { target: this.monsterDisplayName(target), defaultValue: 'Your weapon trembles and time freezes for a moment!' }), '#ffffaa');
                }
                break;
            }
            case 'slowing': {
                target.setStatusDuration('slowed', weaponSlowDuration(enchant));
                target.setStatusDuration('hasted', 0);
                if (visible) {
                    weapon.runicKnown = true;
                    logger.log(i18next.t('runic.weapon.slowing', { target: this.monsterDisplayName(target), defaultValue: `The ${this.monsterDisplayName(target)} slows down.` }), '#99cc99');
                }
                break;
            }
            case 'multiplicity': {
                const data = (monsterData as MonsterData[]).find(m => m.id === 'spectral_blade')!;
                const speedFactor = (weapon.flags?.includes('ITEM_ATTACKS_STAGGER') ? 2 : 1)
                    * (weapon.flags?.includes('ITEM_ATTACKS_QUICKLY') ? 0.5 : 1);
                const imageData = { ...data, attackSpeed: Math.trunc((data.attackSpeed ?? 100) * speedFactor) };
                for (let i = 0; i < weaponImageCount(enchant); i++) {
                    const at = bladeSpawnLocation(this, target.loc);
                    if (!at) break;
                    const blade = new Monster(at.x, at.y, imageData);
                    blade.isAlly = true;
                    blade.boundToPlayer = true;
                    blade.doesNotTrackLeader = true;
                    blade.ticksUntilTurn = 100;
                    blade.accuracy = 100 + 5 * Math.trunc(enchant);
                    const baseDamage = CombatSystem.parseDamageString(weapon.damage ?? '1d2');
                    const factor = damageFraction(enchant);
                    blade.damageString = `${Math.max(1, Math.trunc(baseDamage.min * factor))}-${Math.max(1, Math.trunc(baseDamage.max * factor))}`;
                    blade.setStatusDuration('lifespan_remaining', weaponImageDuration(enchant));
                    blade.goldDropChance = blade.itemDropChance = 0;
                    if (weapon.flags?.includes('ITEM_ATTACKS_STAGGER')) {
                        blade.abilityFlags.add('MA_ATTACKS_STAGGER');
                    }
                    if (weapon.flags?.includes('ITEM_ATTACKS_PENETRATE')) blade.abilityFlags.add('MA_ATTACKS_PENETRATE');
                    if (weapon.flags?.includes('ITEM_ATTACKS_ALL_ADJACENT')) blade.abilityFlags.add('MA_ATTACKS_ALL_ADJACENT');
                    if (weapon.flags?.includes('ITEM_ATTACKS_EXTEND')) blade.abilityFlags.add('MA_ATTACKS_EXTEND');
                    this.monsters.push(blade);
                }
                weapon.runicKnown = true;
                logger.log(i18next.t('runic.weapon.multiplicity', { name: weapon.displayName, defaultValue: `Your ${weapon.displayName} flashes, and spectral duplicates appear!` }), '#ffffff');
                break;
            }
            case 'confusion': {
                const confDuration = weaponConfusionDuration(enchant);
                target.setStatusDuration('confused', Math.max(target.getStatusDuration('confused'), confDuration));
                target.maxStatus.confused = target.getStatusDuration('confused');
                if (visible) {
                    logger.log(i18next.t('runic.weapon.confusion', { target: this.monsterDisplayName(target), defaultValue: `The ${this.monsterDisplayName(target)} is confused by your strike!` }), '#cc99ff');
                    this.spawnFloatingText(i18next.t('status.float.confused', { defaultValue: 'Confused' }), target.loc.x, target.loc.y, 0x99ccff);
                }
                break;
            }
            case 'force': {
                const dist = weaponForceDistance(enchant);
                logger.log(i18next.t('runic.weapon.force', { target: this.monsterDisplayName(target), dist, defaultValue: `Your blow launches the ${this.monsterDisplayName(target)} backward ${dist} tiles!` }), '#ffffff');
                this.spawnFloatingText(i18next.t('runic.force_float', { defaultValue: 'Force!' }), target.loc.x, target.loc.y, 0xffffff);
                // Apply knockback
                const dx = target.loc.x - this.player.loc.x;
                const dy = target.loc.y - this.player.loc.y;
                const ndx = Math.sign(dx);
                const ndy = Math.sign(dy);
                let traveled = 0;
                for (let i = 0; i < dist; i++) {
                    const nx = target.loc.x + ndx;
                    const ny = target.loc.y + ndy;
                    const cell = this.grid.getCell(nx, ny);
                    if (!cell || !cell.isPassable || this.getMonsterAt(nx, ny)) break;
                    target.loc.x = nx;
                    target.loc.y = ny;
                    traveled++;
                }
                // CE forceWeaponHit: a collision before full travel damages
                // both the launched creature and the creature it strikes.
                if (traveled > 0 && traveled < dist && target.hp > 0) {
                    const other = this.getMonsterAt(target.x + ndx, target.y + ndy);
                    if (!target.isImmuneToWeapons() && !target.isInvulnerable()) target.takeDamage(traveled);
                    if (other && !other.isImmuneToWeapons() && !other.isInvulnerable()) other.takeDamage(traveled);
                }
                break;
            }
            case 'mercy': {
                // CE heal(defender, onHitMercyHealPercent=50, false).
                target.hp = Math.min(target.maxHp, target.hp + Math.trunc(target.maxHp / 2));
                if (visible) weapon.runicKnown = true;
                logger.log(i18next.t('runic.weapon.mercy', { target: this.monsterDisplayName(target), defaultValue: `Your weapon of mercy spares the ${this.monsterDisplayName(target)}.` }), '#88ff88');
                break;
            }
            case 'plenty': {
                const clone = this.cloneMonster(target);
                if (clone && this.canObserveBoltTarget(clone)) weapon.runicKnown = true;
                break;
            }
            default:
                break;
        }
        if (!previouslyKnown && weapon.runicKnown) {
            logger.log(i18next.t('runic.weapon.identified', {
                name: weapon.displayName,
                defaultValue: `Your ${weapon.name} must be ${weapon.displayName}.`
            }), '#cccc99');
        }
    }

    /** Runtime attacks pass beforeDamage=true so armor acts before shielding
     * (CE Combat.c:1272,1325). Default preserves the public post-hit API. */
    public tryTriggerArmorRunic(attacker: Monster, incomingDamage: number, beforeDamage = false, melee = true): number {
        let remainingDamage = incomingDamage;
        const prevent = (amount: number) => {
            remainingDamage -= amount;
            if (!beforeDamage) this.player.hp = Math.min(this.player.maxHp, this.player.hp + amount);
        };
        const armor = this.player.equippedArmor;
        if (!armor?.runicType) return remainingDamage;

        // 符文强度吃 netEnchant（含力量修正、钳 [-20,50]），与 P1-11 的 playerDefense
        // 同源；取值口径与 Combat.ts:73-78 一致（strengthRequired 缺省 0）。
        const netEnch = netEnchant(armor.enchantment ?? 0, this.player.effectiveStrength, armor.strengthRequired ?? 0);

        // W-4: reflection is resolved before bolt contact, including adjacent
        // casts. No post-damage half-hit shortcut and no second reflection roll.

        if (armor.runicType === 'multiplicity' && melee &&
            !attacker.hasBehavior('MONST_INANIMATE') && !attacker.hasBehavior('MONST_INVULNERABLE') &&
            rng.randPercent(33)) {
            for (let i = 0; i < armorImageCount(netEnch); i++) {
                const clone = this.cloneMonster(attacker);
                if (!clone) break;
                clone.isAlly = true;
                clone.leader = null;
                clone.boundToPlayer = true;
                clone.doesNotTrackLeader = true;
                clone.abilityFlags.delete('MA_CAST_SUMMON');
                clone.abilityFlags.delete('MA_DF_ON_DEATH');
                clone.behaviorFlags.add('MONST_DIES_IF_NEGATED');
                clone.setStatusDuration('discordant', 0);
                clone.setStatusDuration('lifespan_remaining', 3);
                clone.maxStatus.lifespan_remaining = 3;
                clone.hp = clone.maxHp = 1;
                clone.defense = 0;
                clone.ticksUntilTurn = 100;
                clone.typeId = 'spectral_image';
                clone.name = attacker.name.length <= 6 ? `spectral ${attacker.name}` : 'spectral clone';
                clone.color = 0xff5555;
            }
            armor.runicKnown = true;
            logger.log(i18next.t('runic.armor.multiplicity', { name: armor.displayName,
                target: this.monsterDisplayName(attacker), defaultValue: `Your ${armor.displayName} flashes, and spectral images appear!` }), '#ff7777');
            return remainingDamage;
        }

        if (armor.runicType === 'mutuality') {
            // CE Combat.c:976-1024（A_MUTUALITY）：恒触发（无概率判定）；伤害与相邻
            // 敌方均摊 share = (damage + count) / (count + 1)（C 整数除法），攻击者本身
            // 不计入摊派名单（Combat.c:987）。近战与投掷命中均执行（Items.c:6822）。
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
                // CE distributes before the player's shield absorbs the remaining share.
                prevent(incomingDamage - share);
                for (const m of hitList) {
                    m.takeDamage(share, true);
                    this.spawnFloatingText(`-${share}`, m.loc.x, m.loc.y, 0xddaaff);
                }
                const wasKnown = armor.runicKnown;
                armor.runicKnown = true;
                if (!wasKnown) logger.log(
                    i18next.t('runic.armor.mutuality', {
                        target: attacker.name,
                        damage: share,
                        defaultValue: `Your armor pulses, and the damage is shared with the adjacent enemies!`
                    }),
                    '#ddaaff'
                );
            }
            return remainingDamage;
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
            return remainingDamage;
        }

        if (armor.runicType === 'absorption') {
            // CE Combat.c:1026-1035（A_ABSORPTION）：恒触发（无概率判定），每次受击
            // damage -= rand_range(1, armorAbsorptionMax(netEnchant))（PowerTables.c:107）；
            // 仅全额吸收时提示并自动鉴定（Combat.c:1030-1034），部分吸收静默。
            // 近战与投掷命中均执行（Items.c:6822）。
            const absorbRoll = rng.randRange(1, armorAbsorptionMax(netEnch));
            const absorbed = Math.min(absorbRoll, incomingDamage);
            if (absorbed > 0) {
                prevent(absorbed);
            }
            if (absorbRoll >= incomingDamage) {
                const wasKnown = armor.runicKnown;
                armor.runicKnown = true;
                if (!wasKnown) logger.log(
                    i18next.t('runic.armor.absorption', {
                        damage: absorbed,
                        defaultValue: `Your armor pulses and absorbs the blow!`
                    }),
                    '#aaddff'
                );
                this.spawnFloatingText(`+${absorbed}`, this.player.loc.x, this.player.loc.y, 0xaaddff);
            }
            return remainingDamage;
        }

        if (armor.runicType === 'reprisal' && melee &&
            !attacker.hasBehavior('MONST_INANIMATE') &&
            !attacker.hasBehavior('MONST_INVULNERABLE')) {
            // CE Combat.c:1037-1056（A_REPRISAL）：仅近战、恒触发（无概率判定），
            // 反弹 armorReprisalPercent(netEnchant)% 伤害（PowerTables.c:106）：
            // max(1, percent * damage / 100)（C 整数除法）。
            const reprisalDmg = Math.max(1, Math.trunc((armorReprisalPercent(netEnch) * incomingDamage) / 100));
            attacker.takeDamage(reprisalDmg, true);
            if (canSeeMonster(this.player, this.grid, attacker)) {
                armor.runicKnown = true;
                logger.log(
                    i18next.t('runic.armor.reprisal', {
                        target: attacker.name,
                        damage: reprisalDmg,
                        defaultValue: `Your armor retaliates with ${reprisalDmg} damage to ${attacker.name}!`
                    }), '#ff8844');
            }
            this.spawnFloatingText(`-${reprisalDmg}`, attacker.loc.x, attacker.loc.y, 0xff8844);
            return remainingDamage;
        }

        if (armor.runicType === 'immunity' && monsterIsInClass(attacker.typeId, armor.vorpalEnemy)) {
            prevent(incomingDamage);
            const wasKnown = armor.runicKnown;
            armor.runicKnown = true;
            if (!wasKnown) logger.log(
                i18next.t('runic.armor.immunity', {
                    target: attacker.name,
                    defaultValue: `Your armor's immunity protects you from the ${attacker.name}!`
                }),
                '#ffff44'
            );
            return remainingDamage;
        }
        if (armor.runicType === 'burden' && rng.randPercent(10)) {
            armor.strengthRequired = (armor.strengthRequired ?? 0) + 1;
            armor.runicKnown = true;
            logger.log(i18next.t('runic.armor.burden', { name: armor.displayName,
                defaultValue: `Your ${armor.displayName} suddenly feels heavier!` }), '#ff8888');
            return remainingDamage;
        }
        if (armor.runicType === 'vulnerability') {
            const wasKnown = armor.runicKnown;
            armor.runicKnown = true;
            if (!wasKnown) logger.log(i18next.t('runic.armor.vulnerability', { name: armor.displayName,
                defaultValue: `Your ${armor.displayName} pulses and you are wracked with pain!` }), '#ff8888');
            return remainingDamage * 2;
        }
        if (armor.runicType === 'immolation' && rng.randPercent(10)) {
            armor.runicKnown = true;
            logger.log(i18next.t('runic.armor.immolation', { name: armor.displayName,
                defaultValue: `Flames suddenly explode out of your ${armor.displayName}!` }), '#ff8844');
            // CE Combat.c:1086-1088: catalog DF_ARMOR_IMMOLATION, refresh on, no blocking abort.
            spawnDungeonFeature(this.grid, this.player.loc.x, this.player.loc.y,
                catalogFeature(DF.DF_ARMOR_IMMOLATION), false);
        }
        return remainingDamage;
    }

    /** W-10: one application per P2 objective block, before countdown decrement.
     * HP transition owns poison death; later damage sees hp<=0 and cannot kill twice.
     * Poison bypasses physical armor/shields (CE inflictDamage(..., true)). */
    private resolvePoisonDamage(entity: Player | Monster): void {
        if (entity.hp <= 0 || !entity.hasStatus('poisoned')) return;
        if (entity === this.player) this.poisonedDuringTurn = true;
        if (!entity.canBePoisoned()) return;
        entity.takeDamage(Math.max(1, entity.poisonAmount), true);
        if (entity === this.player) {
            this.lastDamageSource = 'poison';
        } else if (entity.hp <= 0) {
            if (this.canObserveBoltTarget(entity)) logger.log(i18next.t('env.poison_death', {
                name: entity.name, defaultValue: `The ${entity.name} dies of poison.`
            }), '#88aa88');
            this.stats.kills++;
            this.dropMonsterLoot(entity as Monster);
        }
    }

    private tickCreatureStatuses() {
        // F-2b：燃烧状态伤害（CE 玩家 Time.c:2581-2591 playerTurnEnded /
        // 怪 Monsters.c:1877-1901）在状态递减之前结算（CE 玩家序）。
        this.resolveBurningDamage(this.player);
        this.resolvePoisonDamage(this.player);
        for (const m of this.monsters) {
            m.recoverPerTick();
            this.resolveBurningDamage(m);
            // CE lifespan precedes poison; expiration is death, not shieldable damage.
            if (m.getStatusDuration('lifespan_remaining') !== 1) this.resolvePoisonDamage(m);
        }
        this.clearDisplacedEntanglement(this.player);
        const priorDarkness = this.player.getStatusDuration('darkness');
        const priorLevitation = this.player.hasStatus('levitating');
        const playerExpired = this.player.tickStatuses();
        if (this.player.getStatusDuration('darkness') !== priorDarkness
            || this.player.hasStatus('levitating') !== priorLevitation) this.updateVision();
        // CE Time.c:2261-2273：玩家 haste/slow 到期时恢复 info 基准速度并
        // synchronizePlayerTimeState（客观门对齐玩家剩余 tick）。web 的速度
        // 恢复由 tickStatuses → refreshSpeeds 完成，这里补同步调用。
        if (playerExpired.includes('haste') || playerExpired.includes('hasted') || playerExpired.includes('slowed')) {
            this.synchronizePlayerTimeState();
        }
        for (const status of playerExpired) {
            if (status === 'weakened') logger.log(i18next.t('status.player.weakened_off', { defaultValue: 'Your strength returns.' }), '#cccccc');
            if (status === 'nauseous') logger.log(i18next.t('status.player.nauseous_off', { defaultValue: 'You feel less nauseous.' }), '#cccccc');
            if (status === 'darkness') logger.log(i18next.t('status.player.darkness_off', { defaultValue: 'The cloak of darkness lifts.' }), '#cccccc');
            if (status === 'invisible') logger.log(i18next.t('status.player.invisible_off', { defaultValue: 'You are no longer invisible.' }), '#cccccc');
            if (status === 'telepathy') logger.log(i18next.t('status.player.telepathy_off', { defaultValue: 'Your telepathic sense fades.' }), '#cccccc');
            if (status === 'levitating') logger.log(i18next.t('status.player.levitating_off', { defaultValue: 'You touch ground again.' }), '#cccccc');
            if (status === 'regenerating') logger.log(i18next.t('status.player.regenerating_off', { defaultValue: 'Your regenerative aura fades.' }), '#cccccc');
            if (status === 'paralyzed') logger.log(i18next.t('status.player.paralyzed_off', { defaultValue: 'You can move again.' }), '#cccccc');
            if (status === 'confused' || status === 'hallucinating') {
                logger.log(i18next.t('status.player.disoriented_off', { defaultValue: 'Your thoughts become clear again.' }), '#cccccc');
            }
            // F-2b：燃烧自然燃尽（CE Time.c:2588 !--status → extinguishFireOnCreature
            // 的 "you are no longer on fire."）；蹚水灭火走 extinguishCreatureFire，
            // 不经过这条。（tickStatuses 返回类型是 StatusId[]，但逃生舱键
            // 'burning' 会在运行时出现——按存储侧同款口径比较字符串。）
            if ((status as string) === 'burning') logger.log(i18next.t('status.player.burning_off', { defaultValue: 'You are no longer on fire.' }), '#cccccc');
        }

        for (const m of this.monsters) {
            this.clearDisplacedEntanglement(m);
            const expired = m.tickStatuses();
            if (expired.includes('lifespan_remaining') && this.canObserveBoltTarget(m)) {
                logger.log(i18next.t('status.monster.lifespan_off', { name: this.monsterDisplayName(m), defaultValue: 'The {{name}} dissipates into thin air.' }), '#cccccc');
            }
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

    /** Existing web loot rolls shared by melee and poison deaths. */
    private dropMonsterLoot(target: Monster): void {
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
                droppedObj = ItemLoader.spawnWeapon(rng.randPercent(50) ? 'dagger' : 'sword', target.loc.x, target.loc.y, this.depth);
            } else {
                droppedObj = ItemLoader.spawnArmor(rng.randPercent(50) ? 'leather_armor' : 'chain_mail', target.loc.x, target.loc.y, this.depth);
            }
            if (droppedObj) this.items.push(droppedObj);
        }
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
        if (res.hit) {
            const weaponStr = res.weaponName === 'bare hands' ? i18next.t('combat.bare_hands', { defaultValue: 'bare hands' }) : res.weaponName;
            if (res.backstab) {
                logger.log(i18next.t('combat.backstab', { monster: this.monsterDisplayName(target), damage: res.damage, weapon: weaponStr, defaultValue: `You backstab the ${this.monsterDisplayName(target)} for ${res.damage} damage!` }), '#ff4444');
            } else if (lungeAttack) {
                // B-1 登记项由 P1-37 补齐：CE 对突进命中追加"（猛烈突刺）"
                // 措辞（Combat.c:1298-1299），中文 UI 走专用文案。
                logger.log(i18next.t('combat.lunge_hit', { monster: this.monsterDisplayName(target), damage: res.damage, weapon: weaponStr, defaultValue: `You hit the ${this.monsterDisplayName(target)} for ${res.damage} damage with a vicious lunge!` }), '#ffcc00');
            } else {
                logger.log(i18next.t('combat.hit', { monster: this.monsterDisplayName(target), damage: res.damage, weapon: weaponStr, defaultValue: `You hit the ${this.monsterDisplayName(target)} for ${res.damage} damage with ${weaponStr}.` }), '#ffcc00');
            }
            this.spawnFloatingText(`-${res.damage}`, target.loc.x, target.loc.y, 0xff5555);
            // Handle runic trigger (enchantment-scaled chance computed in Combat.ts)
            if (res.triggeredRunic) {
                this.applyWeaponRunicEffect(target, res.damage, res.triggeredRunic);
            }
            this.spawnBlood(target.loc.x, target.loc.y);
            // P4-4：CE splitMonster(defender, attacker)（Combat.c:1424，attack() 主路径）。
            this.trySplitMonster(target, this.player);
        } else {
            logger.log(i18next.t('combat.miss', { monster: this.monsterDisplayName(target), defaultValue: `You missed the ${this.monsterDisplayName(target)}.` }), '#888888');
            this.spawnFloatingText(i18next.t('combat.miss_float', { defaultValue: 'Miss' }), target.loc.x, target.loc.y, 0xaaaaaa);
        }

        // UI-2：CE Combat.c:1432-1450——玩家近战命中带 MONST_DEFEND_DEGRADE_WEAPON
        // 的防守方后，武器降级。豁免条件照抄 CE（同一 if）：
        //   ① !(flags & ITEM_PROTECTED)——isProtected 置位则完全跳过，无消息
        //     （与 I-1 护甲侧 Combat.c:425-431 同口径）；
        //   ② 非"针对该防守方类别的 W_SLAYING 符文武器"（monsterIsInClass）——
        //     web 无成员名册载体（CE 按monsterClassCatalog[].memberList 对
        //     monsterID 逐一比对，Monsters.c:293-301；monsters.json 无 MK_/名册
        //     数据），按 Game.ts:5974 A_IMMUNITY 类别门先例不落地，登记 ui-2 报告；
        //   ③ enchant1 >= -10（CE 字面含等号：-10 仍会再降到 -11，-11 才停）。
        // CE 降级后调 equipItem 刷新（:1443）——web 装备属性读取时即时推导，无需。
        // 位置对应 CE attack() 命中支尾部（splitMonster 之后、返回之前），故
        // 目标被这一击打死时降级照常发生；投掷路径（resolveThrownWeapon）不在
        // 此列——CE 的该块只在近战 attack() 里。
        if (res.hit && target.hasBehavior('MONST_DEFEND_DEGRADE_WEAPON')) {
            const weapon = this.player.equippedWeapon;
            if (weapon && !weapon.isProtected && weapon.enchantment >= -10
                && !(weapon.runicType === 'slaying' && monsterIsInClass(target.typeId, weapon.vorpalEnemy))) {
                weapon.enchantment -= 1;
                if (weapon.quiverNumber) {
                    // CE :1436-1438——投掷武器重掷 quiverNumber（唯一一笔交互期掷骰）
                    weapon.quiverNumber = rng.randRange(1, 60000);
                }
                logger.log(i18next.t('combat.weapon_weakens', {
                    weapon: weapon.name,
                    defaultValue: `your ${weapon.name} weakens!`
                }), '#646432'); // CE itemMessageColor {100,100,50}（Globals.c:281）
            }
        }

        // Check if monster died
        if (target.hp <= 0) {
            logger.log(i18next.t('combat.defeat', { monster: this.monsterDisplayName(target), defaultValue: `You defeated the ${this.monsterDisplayName(target)}!` }), '#ffaa00');
            this.stats.kills++;

            // B-1a：CE Combat.c:1427-1430——玩家近战击杀非无生命怪
            //（MB_WEAPON_AUTO_ID 在怪物生成时对非 MONST_INANIMATE 恒置，
            // Monsters.c:157-159）时扣减装备武器的熟悉度计数，满 20 杀实例亮。
            if (!target.hasBehavior('MONST_INANIMATE') && !target.isClone
                && ItemLoader.decrementWeaponAutoIDTimer(this.player.equippedWeapon)) {
                const weapon = this.player.equippedWeapon!;
                logger.log(i18next.t('item.familiar_weapon', {
                    name: weapon.displayName,
                    defaultValue: `You are now familiar enough with your weapon to identify it: ${weapon.displayName}.`
                }), '#00ffff');
            }

            this.dropMonsterLoot(target);
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
    /** CE Movement.c:714: direction is inverted once, before P2 scheduling.
     * Iterate a stable action cohort; attacks/traps can kill or create monsters.
     */
    private moveEntrancedMonsters(dx: number, dy: number): void {
        for (const monster of [...this.monsters]) {
            if (this.isGameOver) break;
            monster.moveEntranced(this, -dx, -dy);
        }
    }

    private findLiveSeizer(): Monster | undefined {
        return this.monsters.find(m =>
            m.hp > 0 && m.seizing && !m.hasStatus('entranced') &&
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

    /** CE Monsters.c:568-628. A supplied location belongs to splitMonster;
     * otherwise use CE's nearest qualifying path location. Preflight avoids
     * CE's unchecked INVALID_POS and leaves source/HP/world intact on failure. */
    public cloneMonster(source: Creature, splitLocation?: Pos): Monster | null {
        if (source.hp <= 0 || (!(source instanceof Monster) && source !== this.player)) return null;
        const spot = splitLocation ?? cloneLocation(this, source);
        if (!spot) return null;
        const clone = source instanceof Monster ? source.copyForClone() : Monster.copyPlayerForClone(this.player);
        if (source instanceof Monster && source.isCaged) this.becomeAllyWith(clone);
        clone.loc = { ...spot };
        // Preserve dormant chain ownership for direct helper callers.
        if (clone.isDormant) this.dormantMonsters.push(clone);
        else this.monsters.push(clone);
        this.needsRender = true;
        return clone;
    }

    /** CE Combat.c:222-327: select a contiguous-group edge, halve HP, clone,
     * then strip learned flags/bolts and the now-unsupported permanent flight.
     * P4-4's existing placement approximation remains: passable, no deep water
     * or lava; it is not the complete CE monsterAvoids movement policy. */
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
                    if (cell.layers.includes(TerrainType.LAVA) || cell.layers.includes(TerrainType.WATER_DEEP)) continue; // F-1 跨层判定
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

        const clone = this.cloneMonster(defender, spot)!;
        // CE Combat.c:291-322: only self-splitting strips learned traits. AND
        // with native/mutation flags never restores a currently missing trait.
        const native = (monsterData as MonsterData[]).find(d => d.id === defender.typeId);
        const behavior = new Set([...(native?.behaviorFlags ?? []), ...(defender.mutation?.behaviorFlags ?? [])]);
        const ability = new Set([...(native?.abilityFlags ?? []), ...(defender.mutation?.abilityFlags ?? [])]);
        clone.behaviorFlags = new Set([...clone.behaviorFlags].filter(f => behavior.has(f)));
        clone.abilityFlags = new Set([...clone.abilityFlags].filter(f => ability.has(f)));
        clone.bolts = [...(native?.bolts ?? [])];
        if (!clone.hasBehavior('MONST_FLIES') && clone.getStatusDuration('levitating') === 1000) {
            clone.setStatusDuration('levitating', 0);
        }

        logger.log(i18next.t('combat.monster_splits', {
            name: this.monsterDisplayName(defender),
            defaultValue: `The ${this.monsterDisplayName(defender)} splits in two!`
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
     *   - bloat → DF_BLOAT_DEATH（毒气，Globals.c:653 GAS 层，startprob 当
     *     体积单点喷发；原注释的 654 为行号漂移，本轮实测翻正）。G-1 起
     *     量纲即 CE 体积：注入 2000 = DF_BLOAT_DEATH 的 startProbability，
     *     旧 0-100 密度口径（满值 100）已随量纲退役。
     *   - explosive_bloat → DF_BLOAT_EXPLOSION（F-2c 翻正：CE 原链是
     *     killCreature 的 MA_DF_ON_DEATH 分支 Combat.c:1965-1967 以
     *     refreshCell=true 播 deathDF，Globals.c:1084 的 DFType =
     *     DF_BLOAT_EXPLOSION（Globals.c:654，GAS_EXPLOSION tile，start 350 /
     *     decr 100）。web 此前用 igniteForced×5 近似（F-2b §十.2 登记），
     *     现改走 DF 铺设 + 落格瞬时爆炸伤害（fillSpawnMap refresh 分支的
     *     web 等价，共享 DF refresh 事务）——伤害是 max(15-20, maxHP/2)
     *     的瞬时结算，与后续燃烧（火点燃生物）是两笔，不合并。
     *     新落爆炸格的起火登记并入 pendingCaughtFireCells（CE 旗标即时生效，
     *     下一晋升趟跳过其衰老掷骰）。
     * 未接（报告已登记，均为已知缺口，非本轮范围）：
     *   - vampire 的 DF_BLOOD_EXPLOSION 是纯血迹装饰，web 无血迹层。
     * C-5 接线 pit_bloat：CE monsterCatalog Globals.c:1039 的死亡 DFType =
     * DF_HOLE_POTION（与 killCreature 的 MA_DF_ON_DEATH 分支同款链路，
     * Combat.c:1965-1967，refreshCell=true / abortIfBlocking=false）——尸体
     * 脚下炸出 HOLE_EDGE 波前 + 原点 HOLE（T_AUTO_DESCENT），站在上面的
     * 生物由回合末的坠落结算收走。
     */
    private triggerDeathFeatures(target?: Monster): void {
        for (const m of target ? [target] : this.monsters) {
            if (m.hp > 0) continue;
            if (m.deathEffectTriggered) continue;
            if (!m.hasAbility('MA_DF_ON_DEATH')) continue;
            m.deathEffectTriggered = true;

            if (m.typeId === 'bloat') {
                // G-1 折算：100（旧 0-100 密度）→ 2000 = DF_BLOAT_DEATH 的
                // startProbability（Globals.c:653，CE 的 bloat 毒气体积）。
                this.environment.addGas(m.loc.x, m.loc.y, GasType.POISON, 2000);
                logger.log(i18next.t('death.bloat_gas', {
                    name: this.monsterDisplayName(m),
                    defaultValue: `The ${this.monsterDisplayName(m)} releases a cloud of caustic gas!`
                }), '#88ff88');
                this.needsRender = true;
            } else if (m.typeId === 'explosive_bloat') {
                // F-2c：CE 原链（Combat.c:1965-1967）——死亡 DF 经 DF 管线
                // 铺设，爆炸 tile 落到生物脚下当场结算瞬时伤害。石地板照铺
                // （fillSpawnMap 的 drawPriority 判据），与旧 igniteForced
                // 近似的"四方向火焰"形态一并退役。
                const feat = catalogFeature(DF.DF_BLOAT_EXPLOSION);
                spawnDungeonFeature(this.grid, m.loc.x, m.loc.y, feat, false);
                logger.log(i18next.t('death.bloat_explosion', {
                    name: this.monsterDisplayName(m),
                    defaultValue: `The ${this.monsterDisplayName(m)} explodes in a burst of flame!`
                }), '#ff8800');
                this.needsRender = true;
            } else if (m.typeId === 'pit_bloat') {
                // C-5：DF_HOLE_POTION 链（见函数注释）。abortIfBlocking=false
                // 与 CE :1965 的第四参一致——洞允许切断关卡。
                spawnDungeonFeature(this.grid, m.loc.x, m.loc.y, catalogFeature(DF.DF_HOLE_POTION), false);
                this.needsRender = true;
            }
            // vampire：本轮不接，见函数注释（DF_BLOOD_EXPLOSION 无血迹层）。
        }
    }

    // =========================================================================
    // C-5：坠落子系统（CHASM/HOLE 的 T_AUTO_DESCENT 消费端）
    //
    // CE 事实来源（BrogueCE-master/src/brogue/，只读）：
    //   - monsterShouldFall        Time.c:110-116（悬浮/缠绕/墙/MC_PREPLACED 豁免）
    //   - 置位点（回合末才坠）     Time.c:168-176（玩家置位后 return，怪物只置位）
    //   - playerFalls              Time.c:1122-1180（怪物随落 → 换层 → 伤害）
    //   - monstersFall             Time.c:1530-1583（6-12 clump2；守卫类必死；
    //                              幸存者 prependCreature 到下一层）
    //   - playerTurnEnded 坠落门   Time.c:2480-2492（先玩家后怪物）
    //   - 推进循环即时门           Time.c:2866-2871
    //   - 落位                     RogueMain.c:820-841（旧渊格坐标为心的
    //                              getQualifyingLocNear + 围湖逃生检查）
    //   - 跳渊确认                 Movement.c:1303-1322
    //   - 数值                     gameConst.fallDamageMin/Max = 8/10
    //                              （variants/GlobalsBrogue.c:1044-1045）
    // =========================================================================

    /** CE gameConst.fallDamageMin/Max（GlobalsBrogue.c:1044-1045）。 */
    private static readonly FALL_DAMAGE_MIN = 8;
    private static readonly FALL_DAMAGE_MAX = 10;

    /** CE confirm() 的 web 钩子转发；未接线时按"确认"处理（见字段注记）。 */
    private requestConfirm(message: string): boolean {
        if (this.replayRecording) {
            const decision = this.commandDecisions?.[this.replayDecisionCursor++];
            if (typeof decision !== 'boolean') throw new Error('missing confirmation decision');
            return decision;
        }
        const decision = this.onConfirmRequest ? this.onConfirmRequest(message) : true;
        this.commandDecisions?.push(decision);
        return decision;
    }

    /**
     * CE Movement.c:1303-1322 的前置条件串（返回 true = 需要确认）。
     * 目标格必须已发现、玩家非悬浮/非混乱、目标带 T_AUTO_DESCENT、
     * （未被缠 || 带 TM_PROMOTES_ON_PLAYER_ENTRY）、非 TM_IS_SECRET。
     * F-1 口径：旗标判据全部跨层。
     */
    private diveConfirmationNeeded(newX: number, newY: number): boolean {
        const cell = this.grid.getCell(newX, newY);
        if (!cell) return false;
        if (!cell.isDiscovered) return false;                       // DISCOVERED | MAGIC_MAPPED
        if (this.player.hasStatus('levitating')) return false;      // STATUS_LEVITATING <= 1
        if (this.player.hasStatus('confused') || this.player.hasStatus('hallucinating')) return false; // W-18: actual STATUS_CONFUSED; retain legacy hallucination gate
        if (!cell.layers.some(isAutoDescent)) return false;         // T_AUTO_DESCENT
        const entangled = cell.layers.some((t) => (TERRAIN_FLAGS[t].flags & T_ENTANGLES) !== 0);
        const mechFlags = cellTerrainMechFlags(this.grid, newX, newY);
        if (entangled && !(mechFlags & TM_PROMOTES_ON_PLAYER_ENTRY)) return false;
        if (mechFlags & TM_IS_SECRET) return false;                 // !TM_IS_SECRET
        return true;
    }

    /**
     * CE monsterShouldFall（Time.c:110-116）——玩家与怪物同式。悬浮豁免
     * （web 怪物的 MONST_FLIES 已折进 hasStatus('levitating')）；渊格判据
     * 跨层；被缠/占位不可坠（CE T_ENTANGLES | T_OBSTRUCTS_PASSABILITY）；
     * MB_PREPLACED（刚坠下来的幸存者）不坠。
     */
    private creatureShouldFall(entity: Player | Monster): boolean {
        if (entity.hasStatus('levitating')) return false;
        const x = entity.loc.x;
        const y = entity.loc.y;
        const cell = this.grid.getCell(x, y);
        if (!cell) return false;
        let flags = 0;
        for (let l = 0; l < DungeonLayer.COUNT; l++) {
            flags |= TERRAIN_FLAGS[cell.layers[l]!].flags;
        }
        if (!(flags & T_AUTO_DESCENT)) return false;
        if (flags & (T_ENTANGLES | T_OBSTRUCTS_PASSABILITY)) return false;
        if (entity !== this.player && (entity as Monster).preplaced) return false;
        return true;
    }

    /**
     * CE playerFalls（Time.c:1122-1180）逐段移植。调用前提：playerFalling
     * 已置位（Time.c:2480 或 :2866 的两个结算门）。次序照抄 CE：
     *   1. 脚下渊/洞 tile 的 flavor 文案（:1133-1141；web tile 无 flavorText
     *      列，按地形值分派 i18n 键）；
     *   2. monstersFall()——怪物先于换层随落（:1124 注释原文：怪物必须与
     *      玩家一起坠落，而不是悬在上一层）；
     *   3. 清 MB_IS_FALLING | MB_SEIZED | MB_SEIZING（:1137）；
     *      CE :1138 rogue.disturbed = true → web 同义：中断自动寻路；
     *   4. 非 40 层：depthLevel++ → startLevel（generateDepth(false) +
     *      synchronizePlayerTimeState，与楼梯流同一对入口）→ 旧渊格坐标
     *      为心的落位（RogueMain.c:820-841）→ randClumpedRange(8,10,2)
     *      落地伤害——深水零伤害（:1146-1150）、TM_ALLOWS_SUBMERGING 减半
     *      （:1156-1158，CE 整除）、其余全额（:1159-1163，经 inflictDamage：
     *      不吃护甲减免、MONST_INVULNERABLE 免疫；web 护盾本就不挡伤害，
     *      与全库现状同口径，登记）；
     *   5. 40 层：没有下一层可坠——"奇怪的力量" + 随机传送（:1164-1167，
     *      teleport(&player, INVALID_POS, true)）。
     */
    private playerFalls(): void {
        const px = this.player.loc.x;
        const py = this.player.loc.y;

        // CE :1133-1141：坠落 flavor 文案（tile 的 T_AUTO_DESCENT 层优先：
        // CHASM 在 LIQUID、HOLE 在 SURFACE，CE layerWithFlag 层序即此）。
        const cell = this.grid.getCell(px, py);
        if (cell?.layers.includes(TerrainType.CHASM)) {
            logger.log(i18next.t('fall.flavor_chasm', { defaultValue: 'You plunge downward into the chasm!' }), '#ff8844');
        } else if (cell?.layers.includes(TerrainType.TRAP_DOOR_HIDDEN)) {
            logger.log(i18next.t('fall.flavor_trapdoor', { defaultValue: 'You plunge through a hidden trap door!' }), '#ff8844');
        } else if (cell?.layers.includes(TerrainType.HOLE) || cell?.layers.includes(TerrainType.TRAP_DOOR)) {
            logger.log(i18next.t('fall.flavor_hole', { defaultValue: 'You plunge downward into the hole!' }), '#ff8844');
        } else {
            logger.log(i18next.t('fall.plunge', { defaultValue: 'You plunge downward!' }), '#ff8844');
        }

        // CE :1124：怪物随落（换层之前——幸存者入下一层，亡者不留）。
        this.monstersFall();

        // CE :1137-1138。
        this.playerFalling = false;
        this.player.seized = false;
        this.autoPath = [];

        if (this.depth < CE_DEEPEST_LEVEL) {
            this.depth++;
            // CE :1141 startLevel(rogue.depthLevel - 1, 0)——非楼梯入口
            //（stairDirection==0），web 与楼梯共用 generateDepth(false)，
            // 落位差异在下一行修正。
            this.generateDepth(false, false, true);
            this.synchronizePlayerTimeState();

            // generateDepth has placed the player after environment catch-up.

            // CE :1143-1162：落地伤害。
            const landX = this.player.loc.x;
            const landY = this.player.loc.y;
            const landCell = this.grid.getCell(landX, landY);
            let damage = rng.randClumpedRange(Game.FALL_DAMAGE_MIN, Game.FALL_DAMAGE_MAX, 2);
            if (landCell && landCell.layers.some(isDeepWater)) {
                logger.log(i18next.t('fall.unharmed_deep_water', { defaultValue: 'You fall into deep water, unharmed.' }), '#6688ff');
            } else {
                if (landCell
                    && (cellTerrainMechFlags(this.grid, landX, landY) & TM_ALLOWS_SUBMERGING)) {
                    damage = Math.floor(damage / 2); // CE :1157 damage /= 2（浅水/沼减半）
                }
                logger.log(i18next.t('fall.injured', { defaultValue: 'You are injured by the fall.' }), '#ff6666');
                this.player.hp -= this.player.absorbShieldDamage(damage);
                if (this.player.hp <= 0) {
                    // CE :1161-1163 killCreature + gameOver("Killed by a fall")
                    this.triggerGameOver(false, i18next.t('death.fall', { defaultValue: 'Killed by a fall.' }));
                    return;
                }
            }
        } else {
            // CE :1164-1167：最深层——奇怪的力量 + 随机传送。
            logger.log(i18next.t('fall.strange_force', { defaultValue: 'A strange force seizes you as you fall.' }), '#cc99ff');
            this.teleportPlayerRandom();
        }
        this.needsRender = true;
    }

    /**
     * CE monstersFall（Time.c:1530-1583）。对每个置位者（MB_IS_FALLING 或
     * monsterShouldFall）：
     *   - 可见 → "X 坠落消失在视线之外！"（:1548-1560，CE 自带的中文串）；
     *   - MONST_GETS_TURN_ON_ACTIVATION（守卫类/图腾）必死（:1553-1556，注释
     *     原文：绝不能活到下一层挡路）；
     *   - 其余 randClumpedRange(6, 12, 2)（:1558，注意与玩家的 8-10 是两张表）；
     *     幸存 → 清坠落位、置 MB_PREPLACED、送下一层（:1561-1577）；亡 → die。
     * 本层移除在扫描后统一执行（CE 的 removeCreature 即时摘链，web 迭代
     * this.monsters 快照后过滤——结果集相同）。
     */
    private monstersFall(): void {
        const fellOut = new Set<Monster>();
        for (const m of [...this.monsters]) {
            if (m.hp <= 0 || fellOut.has(m)) continue;
            if (!m.falling && !this.creatureShouldFall(m)) continue;
            m.falling = true;

            const loc = this.grid.getCell(m.loc.x, m.loc.y);
            if (loc?.isVisible) {
                logger.log(i18next.t('fall.monster_plunges', {
                    name: this.monsterDisplayName(m),
                    defaultValue: `The ${this.monsterDisplayName(m)} plunges out of sight!`,
                }), '#aaaaaa');
                this.needsRender = true;
            }

            if (m.hasBehavior('MONST_GETS_TURN_ON_ACTIVATION')) {
                (m as unknown as { die(): void }).die(); // CE :1553-1556
            } else {
                // CE :1560 inflictDamage(..., false): existing immunity gate, then shield.
                let died = false;
                if (!m.isInvulnerable()) {
                    m.hp -= m.absorbShieldDamage(rng.randClumpedRange(6, 12, 2));
                    if (m.hp <= 0) died = true;
                }
                if (!died) {
                    // CE :1561-1577：幸存者转层（leadership 降格仍另轮）。
                    m.clearCorpseTargetOnLevelChange(); // CE :1567: only position
                    m.setStatusDuration('entranced', 0); // CE Time.c:1564
                    m.seized = m.seizing = false;
                    m.falling = false;
                    m.preplaced = true;
                    fellOut.add(m);
                    const targetDepth = this.depth + 1;
                    const cached = this.levels.get(targetDepth);
                    if (cached) {
                        cached.monsters.push(m);
                    } else if (targetDepth <= CE_DEEPEST_LEVEL) {
                        const q = this.pendingFallenByDepth.get(targetDepth);
                        if (q) q.push(m);
                        else this.pendingFallenByDepth.set(targetDepth, [m]);
                    }
                    // 目标深度 > 40：CE 的 levels[] 容器恒可写而玩家不可达；
                    // web 无该容器，幸存者就地消失（登记）。
                } else {
                    (m as unknown as { die(): void }).die();
                }
            }
        }
        if (fellOut.size > 0) {
            this.monsters = this.monsters.filter((m) => !fellOut.has(m));
        }
    }

    /**
     * CE RogueMain.c:820-841（startLevel 的 stairDirection==0 落位）：以旧渊格
     * 坐标为心，getQualifyingLocNear（Grid.c:347-356，切比雪夫环由近及远、
     * 环内随机取一）找落点——阻挡集 = T_PATHING_BLOCKER **去掉深水**（可以
     * 落进深水），占用排除 = HAS_MONSTER | HAS_ITEM | HAS_STAIRS |
     * IS_IN_MACHINE。落进深水时做"能不能游出来"检查：到最近干地的
     * pathingDistance（游泳口径，深水不算阻断）不可达（CE 30000）= 围湖，
     * 挪到干地落点。
     */
    private placePlayerOnFallLanding(cx: number, cy: number): void {
        const landingOk = (x: number, y: number): boolean => {
            const cell = this.grid.getCell(x, y);
            if (!cell) return false;
            for (const t of cell.layers) {
                if (t === TerrainType.NOTHING) continue;
                const flags = TERRAIN_FLAGS[t].flags;
                // (T_PATHING_BLOCKER & ~T_IS_DEEP_WATER)：深水可落。
                if ((flags & T_PATHING_BLOCKER) && !(flags & T_IS_DEEP_WATER)) return false;
            }
            if (this.getMonsterAt(x, y)) return false;
            if (cell.layers.includes(TerrainType.STAIRS_UP)
                || cell.layers.includes(TerrainType.STAIRS_DOWN) || cell.layers.includes(TerrainType.DUNGEON_PORTAL)) return false;
            if (this.items.some((it) => it.loc.x === x && it.loc.y === y)) return false;
            if (this.machineCells.has(y * DCOLS + x)) return false;
            return true;
        };
        const strictDry = (x: number, y: number): boolean => {
            const cell = this.grid.getCell(x, y);
            if (!cell) return false;
            return !cell.layers.some((t) => t !== TerrainType.NOTHING
                && (TERRAIN_FLAGS[t].flags & T_PATHING_BLOCKER) !== 0);
        };
        const ringPick = (pred: (x: number, y: number) => boolean): Pos | null => {
            const maxR = Math.max(this.grid.width, this.grid.height);
            for (let r = 1; r <= maxR; r++) {
                const ring: Pos[] = [];
                for (let dx = -r; dx <= r; dx++) {
                    for (let dy = -r; dy <= r; dy++) {
                        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                        const x = cx + dx;
                        const y = cy + dy;
                        if (x <= 0 || y <= 0 || x >= this.grid.width - 1 || y >= this.grid.height - 1) continue;
                        if (!pred(x, y)) continue;
                        ring.push({ x, y });
                    }
                }
                if (ring.length > 0) {
                    return ring.length === 1 ? ring[0]! : ring[rng.randRange(0, ring.length - 1)]!;
                }
            }
            return null;
        };

        let loc = ringPick(landingOk);
        if (!loc) return; // 病态地图：CE 亦无解（getQualifyingLocNear 失败）。

        if (this.grid.getCell(loc.x, loc.y)!.layers.some(isDeepWater)) {
            // CE :827-839：围湖检查——游泳口径的 pathingDistance 到最近干地。
            const dryLoc = ringPick(strictDry);
            if (dryLoc && this.fallPathDistance(loc, dryLoc, true) === null) {
                loc = dryLoc; // CE :836-838：游不出去 → 落到干地。
            }
        }

        this.player.loc.x = loc.x;
        this.player.loc.y = loc.y;
    }

    /**
     * CE pathingDistance（Dijkstra.c:252）的局部 8 向 BFS（uniform 代价）。
     * allowSwim=true 时深水不算阻断（T_PATHING_BLOCKER & ~T_IS_DEEP_WATER，
     * CE RogueMain.c:835 的调用形态）；不可达返回 null（CE 距离图 30000）。
     */
    private fallPathDistance(from: Pos, to: Pos, allowSwim: boolean): number | null {
        const blocked = (x: number, y: number): boolean => {
            const cell = this.grid.getCell(x, y);
            if (!cell) return true;
            for (const t of cell.layers) {
                if (t === TerrainType.NOTHING) continue;
                const flags = TERRAIN_FLAGS[t].flags;
                if (!(flags & T_PATHING_BLOCKER)) continue;
                if (allowSwim && (flags & T_IS_DEEP_WATER)) continue;
                return true;
            }
            return false;
        };
        if (blocked(to.x, to.y)) return null;
        const key = (x: number, y: number): number => y * this.grid.width + x;
        const dist = new Map<number, number>([[key(to.x, to.y), 0]]);
        const queue: Array<{ x: number, y: number }> = [{ x: to.x, y: to.y }];
        const DIRS8: ReadonlyArray<readonly [number, number]> = [
            [0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1],
        ];
        while (queue.length > 0) {
            const p = queue.shift()!;
            const d = dist.get(key(p.x, p.y))!;
            if (p.x === from.x && p.y === from.y) return d;
            for (const [dx, dy] of DIRS8) {
                const nx = p.x + dx;
                const ny = p.y + dy;
                if (nx < 0 || ny < 0 || nx >= this.grid.width || ny >= this.grid.height) continue;
                const k = key(nx, ny);
                if (dist.has(k) || blocked(nx, ny)) continue;
                dist.set(k, d + 1);
                queue.push({ x: nx, y: ny });
            }
        }
        return null;
    }

    // ── V-2b-6：钥匙匹配三件套（CE Items.c:4036-4063 的 web 直译）────────

    /**
     * CE keyMatchesLocation（Items.c:4036-4049）。三判据缺一不可：
     * ① ITEM_IS_KEY（web = category KEY）；② originDepth == 当前深度
     * （跨层带下去的钥匙不认锁，CE :4038）；③ keyLoc 逐条
     * 「坐标匹配 或 机器号匹配」（两者是"或"，CE :4040/:4042）。
     * CE 的循环终止条件 `(loc.x || machine)` 是 keyLoc 数组的哨兵形态——
     * web 的 keyLoc 是紧凑数组、无哨兵条目，逐条直读即等价。
     * CE 的机器号比对不带 ≠0 守卫（:4042 字面）——web 所有
     * TM_PROMOTES_WITH_KEY 消费点（锁门/铁笼）都在机器内
     * （machineNumber ≠ 0），0==0 的退化形态不可达，照抄。
     */
    private keyMatchesLocation(theItem: Item, x: number, y: number, cell: Cell | undefined): boolean {
        if (theItem.category !== ItemCategory.KEY && !theItem.flags?.includes('ITEM_IS_KEY')) return false;
        // undefined = 旧存档/测试裸造的钥匙，按当层处理（登记偏差：CE 恒有值）
        if (theItem.originDepth !== undefined && theItem.originDepth !== this.depth) return false;
        for (const e of theItem.keyLoc) {
            if (e.loc.x === x && e.loc.y === y) return true; // CE :4040 posEq
            if (e.machine === (cell?.machineNumber ?? 0)) return true; // CE :4042
        }
        return false;
    }

    /** CE useKeyAt（Movement.c:636-656）的条目定位半边：找到匹配条目，
     *  供 disposableHere 收口。匹配谓词与 keyMatchesLocation 逐字一致。 */
    private keyMatchingEntry(
        theItem: Item, x: number, y: number, cell: Cell | undefined
    ): { loc: { x: number; y: number }; machine: number; disposableHere?: boolean } | null {
        for (const e of theItem.keyLoc) {
            if ((e.loc.x === x && e.loc.y === y) || e.machine === (cell?.machineNumber ?? 0)) return e;
        }
        return null;
    }

    /** CE keyInPackFor（Items.c:4051-4059）：按位置找背包里认这把锁的钥匙。 */
    private keyInPackFor(x: number, y: number, cell: Cell | undefined): Item | null {
        for (const item of this.player.inventory.items) {
            if (this.keyMatchesLocation(item, x, y, cell)) return item;
        }
        return null;
    }

    /** CE Items.c:4062-4084: a matching key can be on the floor, in the
     * occupant player's pack, or carried by the occupying monster. */
    private keyOnTileAt(x: number, y: number): boolean {
        return this.matchingKeyOnTileAt(x, y) !== null;
    }

    private matchingKeyOnTileAt(x: number, y: number): Item | null {
        const cell = this.grid.getCell(x, y) ?? undefined;
        const packKey = this.player.x === x && this.player.y === y ? this.keyInPackFor(x, y, cell) : null;
        if (packKey) return packKey;
        const floorKey = this.items.find(item => item.x === x && item.y === y && this.keyMatchesLocation(item, x, y, cell));
        if (floorKey) return floorKey;
        const carried = this.getMonsterAt(x, y)?.carriedItem;
        return carried && this.keyMatchesLocation(carried, x, y, cell) ? carried : null;
    }

    /** CE Time.c:543-546 / Movement.c:616-671: contact also uses keys on
     * passable altars, with the existing coordinate/depth/machine contract. */
    private useContactKeyAt(x: number, y: number): void {
        if (!(cellTerrainMechFlags(this.grid, x, y) & TM_PROMOTES_WITH_KEY)) return;
        const key = this.matchingKeyOnTileAt(x, y);
        if (!key) return;
        const cell = this.grid.getCell(x, y)!;
        const disposable = key.keyLoc.some(entry => entry.disposableHere
            && ((entry.loc.x === x && entry.loc.y === y)
                || (entry.machine === cell.machineNumber)));
        promoteLayersWithMechFlag(this.grid, x, y, TM_PROMOTES_WITH_KEY);
        if (disposable) {
            this.player.inventory.removeItem(key);
            const floorIndex = this.items.indexOf(key);
            if (floorIndex >= 0) this.items.splice(floorIndex, 1);
            const carrier = this.getMonsterAt(x, y);
            if (carrier?.carriedItem === key) carrier.carriedItem = null;
        }
    }

    private poisonedDuringTurn = false;

    private removeDeadMonsters(): void {
        // CE killCreature drops carried items before its death DF, then
        // releases a carried creature before corpse learning and demotion.
        const processDeath = (m: Monster): void => {
            if (m.hp > 0 || m.deathProcessed) return;
            m.deathProcessed = true; // before callbacks/released creatures
            if (m.carriedItem) {
                const candidates = captiveItemDropCandidates(this, m.loc, this.items);
                if (candidates.length > 0) {
                    m.carriedItem.loc = { ...candidates[rng.randRange(0, candidates.length - 1)]! };
                    if (!this.items.includes(m.carriedItem)) this.items.push(m.carriedItem);
                }
                m.carriedItem = null;
            }
            this.triggerDeathFeatures(m);
            if (!m.isDormant) {
                // Combat.c killCreature releases the passenger BEFORE learning.
                // Summon withdrawal, polymorph disposal, dormancy and room reset
                // remove live/detached entities directly and never enter here.
                if (m.carriedMonster) {
                    const passenger = m.carriedMonster;
                    m.carriedMonster = null;
                    if (passenger !== m && !passenger.deathProcessed && !this.monsters.includes(passenger)) {
                        passenger.loc = { ...m.loc };
                        passenger.ticksUntilTurn = 200;
                        this.monsters.unshift(passenger);
                        this.needsRender = true;
                        if (this.grid.getCell(passenger.loc.x, passenger.loc.y)?.isVisible) {
                            logger.log(i18next.t('monster.carried_appears', {
                                name: this.monsterDisplayName(passenger),
                                defaultValue: '{{name}} appears',
                            }), '#ffffff');
                        }
                        this.applyDisplacementTileEntry(passenger);
                        this.applyEnvironmentalEffects(passenger);
                        if (passenger.hp <= 0) {
                            processDeath(passenger); // nested kill finishes before the host's bite
                        }
                    }
                }
                anyoneWantABite(this, m);
            }
            this.demoteMonsterFromLeadership(m);
            // CE RogueMain.c:960-969: a dead player ally enters purgatory
            // only when its weapon auto-ID entitlement and resurrection flags allow it.
            if (m.isAlly && !m.leader && !m.leaderlessAfterDemotion && !m.doesNotResurrect
                && !m.isClone && (!m.hasBehavior('MONST_INANIMATE') || m.hasAbility('MA_ENTER_SUMMONS'))
                && !this.purgatory.includes(m)) this.purgatory.unshift(m);
        };
        for (const m of [...this.monsters]) processDeath(m);
        for (const m of [...this.dormantMonsters]) processDeath(m);
        this.monsters = this.monsters.filter(m => m.hp > 0);
        this.dormantMonsters = this.dormantMonsters.filter(m => m.hp > 0);
    }

    /** CE Time.c:2561-2564: demotion detaches bound followers; they die
     * at the next player turn, with ordinary death effects. ALLY is exempt. */
    private killOrphanedBoundFollowers(): void {
        for (const m of this.monsters) {
            if (m.hp > 0 && m.boundToLeader && !m.leader && !m.isAlly) m.takeDamage(m.hp, true);
        }
    }

    /** CE Time.c:549-590: gradual water effect uses the action's tick cost. */
    private sweepDeepWaterItem(creature: Creature, ticks: number): void {
        const { x, y } = creature.loc;
        const flags = cellTerrainFlags(this.grid, x, y);
        if (creature.hasStatus('levitating') || creature.hasStatus('flying')
            || !(flags & T_IS_DEEP_WATER) || (flags & (T_ENTANGLES | T_OBSTRUCTS_PASSABILITY))) return;
        if (creature instanceof Monster && creature.hasBehavior('MONST_IMMUNE_TO_WATER')) return;
        if (this.items.some(item => item.x === x && item.y === y)) return;
        if (creature instanceof Monster && !creature.carriedItem) return;
        if (!rng.randPercent(Math.floor(ticks * 50 / 100))) return;
        if (creature instanceof Monster) {
            const item = creature.carriedItem!;
            const candidates = captiveItemDropCandidates(this, creature.loc, this.items);
            if (!candidates.length) return;
            const dest = candidates[rng.randRange(0, candidates.length - 1)]!;
            creature.carriedItem = null;
            item.loc = { ...dest };
            this.items.push(item);
            promoteOnItemPlaced(this.grid, dest.x, dest.y);
        } else {
            const pack = this.player.inventory.items.filter(item =>
                item !== this.player.equippedWeapon && item !== this.player.equippedArmor
                && item !== this.player.ringLeft && item !== this.player.ringRight);
            if (!pack.length) return;
            const chosen = pack[rng.randRange(0, pack.length - 1)]!;
            let drop = chosen;
            if (chosen.quantity > 1 && chosen.category !== ItemCategory.WEAPON) {
                const peeled = new Item(chosen.name, chosen.char, chosen.color, chosen.category);
                drop = Object.assign(peeled, chosen, { id: peeled.id, quantity: 1, loc: { x, y } });
            }
            if (drop === chosen) this.player.inventory.removeItem(chosen);
            else chosen.quantity--;
            // CE dropItem first picks up an existing floor item; the occupied
            // cell guard above means that path cannot be reached here.
            drop.loc = { x, y };
            this.items.push(drop);
            logger.log(i18next.t('env.item_floats_away', {
                item: drop.displayName, defaultValue: '{{item}} floats away in the current!'
            }), '#ffffaa');
        }
        if (!(creature instanceof Monster)) promoteOnItemPlaced(this.grid, x, y);
        this.needsRender = true;
    }

    /** CE Items.c:1220-1254. A fall is an environment effect, not a DF refresh.
     * Keep the object in exactly one floor/queue; potions and D40 falls perish. */
    private fallFloorItems(): void {
        for (const item of [...this.items]) {
            if (this.absoluteTurnNumber < item.spawnTurnNumber
                || !(cellTerrainFlags(this.grid, item.x, item.y) & T_AUTO_DESCENT)) continue;
            const cell = this.grid.getCell(item.x, item.y)!;
            if (cell.isVisible) logger.log(i18next.t('item.plunges', {
                item: item.displayName, defaultValue: '{{item}} plunges out of sight!'
            }), '#ffffaa');
            this.items.splice(this.items.indexOf(item), 1);
            if (item.category !== ItemCategory.POTION && this.depth < CE_DEEPEST_LEVEL) {
                item.spawnTurnNumber = this.absoluteTurnNumber;
                const nextDepth = this.depth + 1;
                const queue = this.pendingFallenItemsByDepth.get(nextDepth) ?? [];
                queue.push(item);
                this.pendingFallenItemsByDepth.set(nextDepth, queue);
            }
            this.needsRender = true;
        }
    }

    /** CE Architect.c:3574-3603 restoreItems/getQualifyingLocNear. Items may land
     * in water, chasm or lava; only T_OBSTRUCTS_ITEMS and the CE map flags veto. */
    private restoreFallenItems(): void {
        const queue = this.pendingFallenItemsByDepth.get(this.depth);
        if (!queue?.length) return;
        this.pendingFallenItemsByDepth.delete(this.depth);
        for (const item of queue) {
            let candidates: Pos[] = [];
            for (let r = 0; r < Math.max(this.grid.width, this.grid.height) && !candidates.length; r++) {
                for (let x = item.x - r; x <= item.x + r; x++) for (let y = item.y - r; y <= item.y + r; y++) {
                    if (Math.max(Math.abs(x - item.x), Math.abs(y - item.y)) !== r) continue;
                    const cell = this.grid.getCell(x, y);
                    if (!cell || (cellTerrainFlags(this.grid, x, y) & T_OBSTRUCTS_ITEMS)
                        || cell.machineNumber || this.getMonsterAt(x, y)
                        || this.items.some(other => other.x === x && other.y === y)
                        || cell.layers.some(t => t === TerrainType.STAIRS_UP || t === TerrainType.STAIRS_DOWN || t === TerrainType.DUNGEON_PORTAL)) continue;
                    candidates.push({ x, y });
                }
            }
            if (!candidates.length) {
                const pending = this.pendingFallenItemsByDepth.get(this.depth) ?? [];
                pending.push(item); this.pendingFallenItemsByDepth.set(this.depth, pending);
                continue;
            }
            item.loc = candidates[rng.randRange(1, candidates.length) - 1]!;
            this.items.push(item);
            promoteOnItemPlaced(this.grid, item.x, item.y);
        }
    }

    /** CE Items.c:1177-1208 / 1293-1308: scan x then y, lock the first
     * eligible item and exchange with the first different level on this machine. */
    private commuteFloorItems(): void {
        // CE itemAtLoc exposes one floor item per cell. The web floor list may
        // contain overlapping drops; they must not act as two separate altars.
        const slots = new Map<string, Item>();
        for (const item of this.items) {
            const key = `${item.x},${item.y}`;
            if (!slots.has(key)) slots.set(key, item);
        }
        const floorItems = [...slots.values()];
        const machines = new Set(floorItems.filter(item =>
            cellTerrainMechFlags(this.grid, item.x, item.y) & TM_SWAP_ENCHANTS_ACTIVATION)
            .map(item => this.grid.getCell(item.x, item.y)!.machineNumber).filter(n => n > 0));
        for (const machine of machines) {
            promoteOnCommutation(this.grid, machine, () => {
                const items = floorItems.filter(item => itemIsSwappable(item)
                    && this.grid.getCell(item.x, item.y)?.machineNumber === machine
                    && (cellTerrainMechFlags(this.grid, item.x, item.y) & TM_SWAP_ENCHANTS_ACTIVATION))
                    .sort((a, b) => a.x - b.x || a.y - b.y);
                const first = items[0], second = first && items.find(item => item.enchantment !== first.enchantment);
                if (!first || !second) return false;
                const oldLevel = first.enchantment, oldKnown = enchantLevelKnown(first);
                for (const [item, level, known] of [[first, second.enchantment, enchantLevelKnown(second)],
                    [second, oldLevel, oldKnown]] as const) {
                    if (!swapItemToEnchantLevel(item, level, known)) {
                        this.items.splice(this.items.indexOf(item), 1);
                        if (this.grid.getCell(item.x, item.y)?.isVisible) logger.log(i18next.t('item.commutation_shatter', {
                            item: item.displayName, defaultValue: '{{item}} shatters from the strain!'
                        }), '#ffffaa');
                    }
                }
                this.needsRender = true;
                return true;
            });
        }
    }

    /** CE Items.c:1209-1277: floor items on moving liquid drift at environment updates. */
    private driftFloorItems(): void {
        for (const item of [...this.items]) {
            const { x, y } = item.loc;
            if (this.absoluteTurnNumber < item.spawnTurnNumber) continue;
            if (item.flags?.includes('ITEM_KIND_AUTO_ID')) ItemLoader.identifyItemKind(item);
            if (!(cellTerrainFlags(this.grid, x, y) & T_MOVES_ITEMS)) {
                promoteOnItemPlaced(this.grid, x, y);
                continue;
            }
            let candidates: Pos[] = [];
            for (let radius = 0; radius < Math.max(this.grid.width, this.grid.height) && !candidates.length; radius++) {
                for (let nx = x - radius; nx <= x + radius; nx++) {
                    for (let ny = y - radius; ny <= y + radius; ny++) {
                        if (nx !== x - radius && nx !== x + radius && ny !== y - radius && ny !== y + radius) continue;
                        if (!this.grid.isValidPos(nx, ny)
                            || (cellTerrainFlags(this.grid, nx, ny) & (T_OBSTRUCTS_ITEMS | T_OBSTRUCTS_PASSABILITY))
                            || this.items.some(other => other.x === nx && other.y === ny)) continue;
                        candidates.push({ x: nx, y: ny });
                    }
                }
            }
            if (!candidates.length) continue;
            const dest = candidates[rng.randRange(0, candidates.length - 1)]!;
            if (Math.max(Math.abs(dest.x - x), Math.abs(dest.y - y)) === 1) {
                item.loc = dest;
                this.needsRender = true;
            }
        }
    }

    /** Bind fresh state for each entry; callbacks preserve Game's private `this`. */
    private timePorts(): TimePorts {
        const game = this;
        return {
            world: {
                get grid() { return game.grid; },
                get player() { return game.player; },
                get monsters() { return game.monsters; },
                get items() { return game.items; },
                get environment() { return game.environment; },
                get waypoints() { return game.waypoints; },
                get scent() { return game.scent; },
                get fov() { return game.fov; },
                get levels() { return game.levels; },
                get stats() { return game.stats; },
            },
            clock: {
                get ticksTillUpdateEnvironment() { return game.ticksTillUpdateEnvironment; },
                set ticksTillUpdateEnvironment(value) { game.ticksTillUpdateEnvironment = value; },
                get absoluteTurnNumber() { return game.absoluteTurnNumber; },
                set absoluteTurnNumber(value) { game.absoluteTurnNumber = value; },
                get monsterSpawnFuse() { return game.monsterSpawnFuse; },
                set monsterSpawnFuse(value) { game.monsterSpawnFuse = value; },
                get lastPromotionUpdate() { return game.lastPromotionUpdate; },
                set lastPromotionUpdate(value) { game.lastPromotionUpdate = value; },
                get pendingCaughtFireCells() { return game.pendingCaughtFireCells; },
                set pendingCaughtFireCells(value) { game.pendingCaughtFireCells = value; },
                get needsRender() { return game.needsRender; },
                set needsRender(value) { game.needsRender = value; },
                get displacementTrapDepressions() { return game.displacementTrapDepressions; },
                get mode() { return game.mode; },
                get playerFalling() { return game.playerFalling; },
                get isGameOver() { return game.isGameOver; },
                animationPauseMs: Game.ANIMATION_PAUSE_MS,
                get poisonedDuringTurn() { return game.poisonedDuringTurn; },
                set poisonedDuringTurn(value) { game.poisonedDuringTurn = value; },
                get currentLevelDepth() { return game.currentLevelDepth; },
                get updatedSafetyMapThisTurn() { return game.updatedSafetyMapThisTurn; },
                set updatedSafetyMapThisTurn(value) { game.updatedSafetyMapThisTurn = value; },
                get searchingCharge() { return game.searchingCharge; },
                set searchingCharge(value) { game.searchingCharge = value; },
                get justSearched() { return game.justSearched; },
                set justSearched(value) { game.justSearched = value; },
                get animationEnabled() { return game.animationEnabled; },
                get lastDamageSource() { return game.lastDamageSource; },
                set lastDamageSource(value) { game.lastDamageSource = value; },
            },
            effects: {
                objectiveTimeBlock: () => game.objectiveTimeBlock(),
                playerFalls: () => game.playerFalls(),
                isAutoTraveling: () => game.isAutoTraveling(),
                sweepDeepWaterItem: (creature, ticks) => game.sweepDeepWaterItem(creature, ticks),
                monsterTakeTurn: (monster, stealthRange) => monster.takeTurn(game, stealthRange),
                updateEnvironment: () => game.updateEnvironment(),
                tickArcanaResources: () => game.tickArcanaResources(),
                processIncrementalAutoID: () => game.processIncrementalAutoID(),
                spawnPeriodicHorde: () => game.spawnPeriodicHorde(),
                applyEnvironmentalEffects: (target, objective) => game.applyEnvironmentalEffects(target, objective),
                tickCreatureStatuses: () => game.tickCreatureStatuses(),
                applyNauseaFromTerrain: (creature) => game.applyNauseaFromTerrain(creature),
                getStatusLabel: (status) => game.getStatusLabel(status),
                logHungerTransition: (transition) => game.logHungerTransition(transition),
                consumeFood: (item, prompt) => game.consumeFood(item, prompt),
                playerTurnEnded: () => game.playerTurnEnded(),
                monstersApproachStairs: () => game.monstersApproachStairs(),
                wpContext: () => game.wpContext(),
                monstersFall: () => game.monstersFall(),
                keyOnTileAt: (x, y) => game.keyOnTileAt(x, y),
                getMonsterAt: (x, y) => game.getMonsterAt(x, y),
                fallFloorItems: () => game.fallFloorItems(),
                burnFloorItems: () => game.burnFloorItems(),
                driftFloorItems: () => game.driftFloorItems(),
                commuteFloorItems: () => game.commuteFloorItems(),
                killOrphanedBoundFollowers: () => game.killOrphanedBoundFollowers(),
                removeDeadMonsters: () => game.removeDeadMonsters(),
                syncEquipmentStatuses: () => game.syncEquipmentStatuses(),
                updateVision: () => game.updateVision(),
                calculateStealthRange: () => game.calculateStealthRange(),
                updateSafetyMap: () => game.updateSafetyMap(),
                awarenessBonus: () => game.awarenessBonus(),
                searchForSecrets: (strength) => game.searchForSecrets(strength),
                beginAdvancement: (stealthRange) => game.beginAdvancement(stealthRange),
                advancementLoop: (stealthRange) => game.advancementLoop(stealthRange),
                finishTurnEpilogue: () => game.finishTurnEpilogue(),
                triggerGameOver: (victory, reason) => game.triggerGameOver(victory, reason),
            },
        };
    }

    private playerTurnEnded() {
        return playerTurnEnded(this.timePorts());
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
     *   - 关卡生成决策完成之后、oldSeed 回切之前（RogueMain.c:707）
     *   - 重访缓存层恢复之后（同一位置，RogueMain.c:771）
     *   - 地形剧变之后（Items.c:5558 BE_TUNNELING）——W-13 掘地结束接入。
     */
    public rebuildWaypoints(duringPlay = false): void {
        this.waypoints.setUpWaypoints(this.wpContext(), duringPlay);
    }

    /**
     * CE Time.c:2643-2752 推进主循环的可分步版本。E1-修订口径：只在慢回合的
     * 100-tick 客观块处 yield 一次暂停请求（毫秒数），供动画模式渲染暂停点
     * 画面并等待；怪物行动不再单独成帧。同步模式一次性跑完（生成器同源，
     * 保证两条路径的调度语义永不漂移）。
     */
    private *advancementLoop(stealthRange: number): Generator<number, void, void> {
        return yield* advancementLoop(this.timePorts(), stealthRange);
    }

    /**
     * CE Time.c:2657-2712 客观时间块：每 100 tick（客观时间）恰好执行一次，
     * 与玩家动作数解耦——haste（50 tick/动作）下两次动作才触发一次，
     * slowed（200 tick/动作）下一次动作触发两次。
     *
     * 与 CE 的逐条对照：
     * - rechargeItemsIncrementally(1) → tickArcanaResources()（法杖充能、护符冷却；WAND 不回电）
     * - processIncrementalAutoID()    → web 无渐进鉴定系统，跳过（报告已列）
     * - rogue.monsterSpawnFuse--      → monsterSpawnFuse--，归零触发周期刷怪
     *                                   （CE 触发点在 decrementPlayerStatus 尾部，
     *                                   Time.c:2322-2325，同属客观块）
     * - applyInstantTileEffectsToCreature（怪物 :2671 / 玩家 :2698）
     *       → applyEnvironmentalEffects（F-2b 起合并上移到块首：
     *         CE 怪物轨的"tile 先于 decrement"是燃烧状态机的实质次序）
     * - decrementMonsterStatus(monst) → tickCreatureStatuses()（web 合并实现
     *   玩家+怪物状态，紧随环境段；燃烧伤害结算在其内。玩家 haste/slow 到期
     *   处按 CE Time.c:2261-2273 调用 synchronizePlayerTimeState）
     * - updateEnvironment()           → 晋升驱动 + updateFires/updateGases
     *   （CE 的"晋升在火之前"次序据此保持）
     * - decrementPlayerStatus()       → tickTemporaryImmunities + tickNutrition
     *   （营养递减与饥饿档位在 CE 位于 decrementPlayerStatus 内、由客观块调用；
     *   回血/饥饿伤害则是主观的，见 finishTurnEpilogue 的 recoverPerTurn）
     * - DFChance 地形特征生成仍由后续内容轮负责；普通跨梯跟随接入块尾。
     */
    private objectiveTimeBlock(): void {
        return objectiveTimeBlock(this.timePorts());
    }

    /** CE Time.updateEnvironment. No player/monster status tick, regeneration,
     * nutrition, charging, spawning, scent, approach timer or action accounting. */
    private updateEnvironment(): void {
        return updateEnvironment(this.timePorts());
    }

    /** RogueMain.startLevel: run 50 updates for a new map, at most 100 for a
     * revisit. oldSeed is already installed. Borrow historical absolute time,
     * put the player in limbo, then restore both even if an update throws. */
    private catchUpEnvironment(timeAway: number): void {
        const position = { ...this.player.loc }, now = this.absoluteTurnNumber;
        this.player.loc = { x: 0, y: 0 };
        try {
            for (let remaining = Math.max(0, Math.min(100, Math.trunc(timeAway))) - 1; remaining >= 0; remaining--) {
                this.absoluteTurnNumber = Math.max(now, remaining) - remaining;
                this.updateEnvironment();
            }
        } finally {
            this.absoluteTurnNumber = now;
            this.player.loc = position;
        }
        if (this.ticksTillUpdateEnvironment <= 0) this.ticksTillUpdateEnvironment += 100;
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
        return finishTurnEpilogue(this.timePorts());
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

    /**
     * B-1a：CE Time.c:1987-2024 processIncrementalAutoID——对护甲与两枚戒指
     * （CE autoIdentifyItems[3] = {armor, ringLeft, ringRight}，Time.c:1988-1991；
     * web 双槽自 B-1b 起）的穿戴熟悉度倒计时。调用点在客观时间块内
     * （Time.c:2664），每块每件恰好扣 1。揭示时的玩家可见消息
     * （Time.c:2001-2003 "you are now familiar enough with your ... to
     * identify it."）在这里播；揭示状态本身的落账在 ItemLoader。
     */
    private processIncrementalAutoID(): void {
        for (const item of [this.player.equippedArmor, ...this.player.rings()]) {
            const revealed = ItemLoader.decrementWornFamiliarity(item);
            if (revealed === 'armor' && item) {
                logger.log(i18next.t('item.familiar_armor', {
                    name: item.displayName,
                    defaultValue: `You are now familiar enough with your armor to identify it: ${item.displayName}.`
                }), '#00ffff');
            }
            if (revealed === 'ring' && item) {
                logger.log(i18next.t('item.familiar_ring', {
                    name: item.displayName,
                    defaultValue: `You are now familiar enough with your ring to identify it: ${item.displayName}.`
                }), '#00ffff');
            }
        }
    }

    private tickArcanaResources() {
        const wisdom = equippedWisdomBonus(this.player.rings());
        for (const item of this.player.inventory.items) {
            if (item.category === ItemCategory.STAFF) {
                if (tickStaffRecharge(item, wisdom, rng, (item as any).identityId) > 0) {
                    logger.log(i18next.t('item.regains_charge', { interpolation: { escapeValue: false }, name: item.displayName, defaultValue: `${item.displayName} regains a charge.` }), '#66ddff');
                }
            } else if (item.category === ItemCategory.CHARM) {
                const remain = item.cooldownRemaining ?? 0;
                if (remain > 0) {
                    item.cooldownRemaining = remain - 1;
                }
            }
        }
    }

    private serializeItem(item: Item): GameSnapshotItem { return encodeItem(item); }
    private deserializeItem(s: GameSnapshotItem): Item { return decodeItem(s, entityCodecDeps); }

    private snapshotRunState() {
        return projectRunState({
            meteredItems: this.meteredItems, foodSpawned: this.foodSpawned, goldGenerated: this.goldGenerated,
            monsterSpawnFuse: this.monsterSpawnFuse, absoluteTurnNumber: this.absoluteTurnNumber,
            currentTick: timeSystem.currentTick, nextEntityId: getNextEntityId(), nextMachineNumber: getNextMachineNumber(),
            playerFalling: this.playerFalling, pendingIdentify: this.pendingIdentify,
            justSearched: this.justSearched, justRested: this.justRested, searchingCharge: this.searchingCharge,
            secretScanDepth: this.secretScanDepth, levelHasSecrets: this.levelHasSecrets,
            poisonedDuringTurn: this.poisonedDuringTurn,
            safetyMap: this.safetyMap, updatedSafetyMapThisTurn: this.updatedSafetyMapThisTurn,
            loopMap: this.loopMap,
            isGameOver: this.isGameOver, gameOverWon: this.gameOverWon, gameOverReason: this.gameOverReason,
            gameOverInventory: this.gameOverInventory, gameOverScore: this.gameOverScore, lastDamageSource: this.lastDamageSource,
            everSeenItemIds: [...this.everSeenItems].map(i => i.id),
            everSeenMonsterIds: [...this.everSeenMonsters].map(m => m.id),
            examinedEntityIds: [...this.examinedEntityIds],
            autoPath: this.autoPath, isMouseTraveling: this.isMouseTraveling, travelTargetItemId: this.travelTargetItem?.id ?? null,
            recordedInputEvents: this.recordedInputEvents, recordedInputIndex: this.recordedInputIndex,
            signTexts: [...this.signTexts], resetPlateRoomByPos: [...this.resetPlateRoomByPos],
            testRooms: [...this.testRooms], currentTestCategory: this.currentTestCategory,
            logger: logger.getState(),
        });
    }

    private activeLevelState(): LevelState {
        return {
            grid: this.grid, environment: this.environment, fov: this.fov, lightMap: this.lightMap,
            monsters: this.monsters, dormantMonsters: this.dormantMonsters, items: this.items,
            visibleMonsters: this.visibleMonsters, visibleItems: this.visibleItems,
            machineCells: this.machineCells, scent: this.scent, waypoints: this.waypoints,
            awaySince: this.currentLevelAwaySince, playerExitedVia: { ...this.currentLevelExitedVia }, pendingCaughtFireCells: this.pendingCaughtFireCells,
        };
    }

    private snapshotLevel(depth: number, level: LevelState): LevelSnapshot {
        return projectLevel(depth, level, this.displacementTrapDepressions?.get(level.grid));
    }

    /** Saves are turn-boundary checkpoints. A suspended JS generator cannot be
     * encoded; callers may retry once its existing animation has completed. */
    public toSnapshot(): GameSnapshot {
        if (this.isAdvancing) throw new Error('Cannot save during turn advancement');
        return toWholeRunSnapshot({
            depth: this.depth, currentLevelDepth: this.currentLevelDepth,
            active: this.activeLevelState(), levels: this.levels,
            snapshotLevel: (depth, level) => this.snapshotLevel(depth, level),
            pendingFallenByDepth: this.pendingFallenByDepth,
            pendingFallenItemsByDepth: this.pendingFallenItemsByDepth,
            purgatory: this.purgatory, monsters: this.monsters, dormantMonsters: this.dormantMonsters,
            items: this.items, player: this.player, everSeenMonsters: this.everSeenMonsters,
            everSeenItems: this.everSeenItems, visibleMonsters: this.visibleMonsters,
            visibleItems: this.visibleItems, travelTargetItem: this.travelTargetItem,
            isAdvancing: this.isAdvancing, currentSeed: this.currentSeed, levelSeeds: this.levelSeeds,
            mode: this.mode, ticksTillUpdateEnvironment: this.ticksTillUpdateEnvironment,
            pendingEnchantment: this.pendingEnchantment, stats: this.stats, run: this.snapshotRunState(),
            services: {
                rngState: () => rng.getState(),
                identifiedItems: () => [...ItemLoader.identifiedItems],
                callTitles: () => Object.fromEntries(ItemLoader.callTitles),
                magicPolarityRevealed: () => [...ItemLoader.magicPolarityRevealed],
                flavors: () => ItemLoader.snapshotFlavors(),
                staffFlavors: () => Object.fromEntries(ItemLoader.staffs.map(s => [s.id, ItemLoader.arcanaFlavorMap.get(s.id)!])),
                wandFlavors: () => Object.fromEntries(ItemLoader.wands.map(w => [w.id, ItemLoader.arcanaFlavorMap.get(w.id)!])),
                rewardRoomsGenerated: () => getRewardRoomsGenerated(),
            },
        });
    }

    private serializeMonster(m: Monster): GameSnapshotMonster { return encodeMonster(m); }

    private deserializeMonster(m: GameSnapshotMonster): Monster {
        const graph = restoreEntityGraph([m], [], [], [], entityCodecDeps);
        entityCodecDeps.ensureIdAbove(Math.max(0, ...graph.monsters.keys(), ...graph.items.keys()));
        return graph.monsters.get(m.id)!;
    }

    private restoreMonsterLeaders(snapshots: readonly GameSnapshotMonster[], monsters: readonly Monster[]): void {
        // Test-room reset also resolves payload/leader cycles after all roots exist.
        restoreEntityGraph(snapshots, [], monsters, [...this.items, ...this.player.inventory.items], entityCodecDeps);
    }

    public static isSnapshot(value: unknown): value is GameSnapshot {
        return isWholeRunSnapshot(value);
    }

    public loadSnapshot(snapshot: GameSnapshot): boolean {
        if (!Game.isSnapshot(snapshot)) return false;
        // Decode the entire world before retiring the live one.
        let decoded: ReturnType<typeof decodeWholeRunWorld>;
        try { decoded = decodeWholeRunWorld(snapshot, entityCodecDeps); } catch { return false; }
        const { entityGraph, restored } = decoded;
        const levelRows = [snapshot, ...snapshot.levels];

        this.discardInFlightAdvancement();
        if (this.grid) { setDormantAwakener(this.grid, null); setAllyResurrector(this.grid, null); setDungeonFeatureEffects(this.grid, null); }
        for (const level of this.levels.values()) { setDormantAwakener(level.grid, null); setAllyResurrector(level.grid, null); setDungeonFeatureEffects(level.grid, null); }
        this.animationLockDeadline = 0;
        this.lastAdvancementError = null;
        this.inAutoTravelStep = false;
        this.mode = snapshot.mode; this.depth = snapshot.depth; this.currentLevelDepth = snapshot.currentLevelDepth;
        this.currentSeed = snapshot.seed; this.levelSeeds = copyLevelSeeds(snapshot.levelSeeds);
        this.ticksTillUpdateEnvironment = snapshot.ticksTillUpdateEnvironment;
        const active = restored.get(this.depth)!;
        this.grid = active.grid; this.environment = active.environment; this.fov = active.fov; this.lightMap = active.lightMap;
        this.monsters = active.monsters; this.dormantMonsters = active.dormantMonsters!; this.items = active.items;
        this.visibleMonsters = active.visibleMonsters; this.visibleItems = active.visibleItems;
        this.machineCells = active.machineCells!; this.scent = active.scent!; this.waypoints = active.waypoints!;
        this.currentLevelExitedVia = { ...active.playerExitedVia! };
        this.currentLevelAwaySince = active.awaySince!; this.pendingCaughtFireCells = active.pendingCaughtFireCells!;
        this.displacementTrapDepressions = new WeakMap();
        for (const saved of levelRows) this.displacementTrapDepressions.set(restored.get(saved.depth)!.grid, new Set(saved.trapDepressions));
        restored.delete(this.depth); this.levels = restored;
        this.pendingFallenItemsByDepth = new Map(snapshot.pendingFallenItemsByDepth.map(q =>
            [q.depth, q.items.map(item => entityGraph.items.get(item.id)!)]));
        this.pendingFallenByDepth = new Map(snapshot.pendingFallenByDepth.map(q =>
            [q.depth, q.monsters.map(m => entityGraph.monsters.get(m.id)!)]));
        this.purgatory = (snapshot.purgatory ?? []).map(m => entityGraph.monsters.get(m.id)!);
        this.bindDormantAwakener();
        this.activeFlares = []; this.terrainFlashes = []; this.flareLightMap = null; this.flareElapsedMs = 0;

        this.player = decodePlayer(snapshot.player, entityGraph.items);

        const run = JSON.parse(JSON.stringify(snapshot.run)) as GameSnapshot['run'];
        this.meteredItems = run.meteredItems; this.foodSpawned = run.foodSpawned; this.goldGenerated = run.goldGenerated;
        this.monsterSpawnFuse = run.monsterSpawnFuse; this.absoluteTurnNumber = run.absoluteTurnNumber;
        timeSystem.currentTick = run.currentTick;
        restoreNextMachineNumber(run.nextMachineNumber);
        restoreNextEntityId(run.nextEntityId);
        ensureEntityIdAbove(Math.max(snapshot.player.id, 0, ...entityGraph.monsters.keys(), ...entityGraph.items.keys()));
        this.playerFalling = run.playerFalling;
        this.justSearched = run.justSearched; this.justRested = run.justRested; this.searchingCharge = run.searchingCharge;
        this.secretScanDepth = run.secretScanDepth; this.levelHasSecrets = run.levelHasSecrets;
        this.poisonedDuringTurn = run.poisonedDuringTurn;
        this.safetyMap = run.safetyMap; this.updatedSafetyMapThisTurn = run.updatedSafetyMapThisTurn; this.loopMap = run.loopMap;
        this.stats = { ...snapshot.stats }; this.isGameOver = run.isGameOver; this.gameOverWon = run.gameOverWon;
        this.gameOverReason = run.gameOverReason; this.gameOverInventory = run.gameOverInventory;
        this.gameOverScore = run.gameOverScore; this.lastDamageSource = run.lastDamageSource;
        this.everSeenItems = new Set(run.everSeenItemIds.map(id => entityGraph.items.get(id)!));
        this.everSeenMonsters = new Set(run.everSeenMonsterIds.map(id => entityGraph.monsters.get(id)!));
        this.examinedEntityIds = new Set(run.examinedEntityIds);
        this.autoPath = run.autoPath; this.isMouseTraveling = run.isMouseTraveling;
        this.travelTargetItem = run.travelTargetItemId === null ? undefined : entityGraph.items.get(run.travelTargetItemId);
        this.recordedInputEvents = run.recordedInputEvents; this.recordedInputIndex = run.recordedInputIndex;
        this.recordingStartAt = Date.now();
        // A snapshot is not a reproducible new-run prefix. Do not export a partial log.
        this.recordingFromNewGame = false;
        this.clearReplay();
        this.signTexts = new Map(run.signTexts); this.resetPlateRoomByPos = new Map(run.resetPlateRoomByPos);
        this.testRooms = new Map(run.testRooms); this.currentTestCategory = run.currentTestCategory;
        logger.setState(run.logger);
        ItemLoader.restoreFlavors(snapshot.flavors);
        ItemLoader.identifiedItems = new Set(snapshot.identifiedItems);
        ItemLoader.callTitles = new Map(Object.entries(snapshot.callTitles));
        ItemLoader.magicPolarityRevealed = new Set(snapshot.magicPolarityRevealed);
        setRewardRoomsGenerated(snapshot.rewardRoomsGenerated);

        this.pendingIdentify = run.pendingIdentify; this.pendingEnchantment = snapshot.pendingEnchantment;
        this.isInventoryOpen = this.pendingIdentify || this.pendingEnchantment;
        this.referenceScreen = null; this.pendingArcana = null; this.pendingUseConfirm = null;
        this.isThrowing = false; this.throwItemTarget = null; this.isExamining = false; this.inspectTarget = null;
        this.pendingBoltFrames = []; this.currentBoltFrameIndex = 0; this.boltAnimStartTime = 0;
        this.hoveredCell = null; this.hoveredText = ''; this.floatingTexts = []; this.lastPromotionUpdate = null;
        // Rebuild lighting without running update's discovery/auto-travel side
        // effects. Grid memory and visibility are themselves snapshot fields.
        this.updateVision();
        for (const saved of snapshot.grid) {
            const cell = this.grid.getCell(saved.x, saved.y)!;
            cell.isVisible = saved.isVisible; cell.isExplored = saved.isExplored; cell.hasMemory = saved.hasMemory;
            cell.rememberedTerrain = saved.rememberedTerrain;
            cell.rememberedAppearance = saved.rememberedAppearance;
            cell.rememberedLayers = saved.rememberedLayers;
            cell.rememberedItem = saved.rememberedItem;
            cell.rememberedItemCategory = saved.rememberedItemCategory;
            cell.isMagicMapped = saved.isMagicMapped;
            cell.rememberedTerrainFlags = saved.rememberedTerrainFlags;
            cell.rememberedTMFlags = saved.rememberedTMFlags;
            cell.knownTrapFree = saved.knownTrapFree;
            cell.rememberedFlags = saved.rememberedFlags;
        }
        this.needsRender = true;
        this.onRenderRequested?.();
        rng.setState(snapshot.rngState);
        return true;
    }

    // =========================================================================
    // F-2b：CE 的生物燃烧状态机（STATUS_BURNING，Rogue.h:2000）
    //
    // 载体申报：'burning' 不在 StatusId 联合里（src/entities/Creature.ts:9，
    // 本轮禁改清单，任务书 §三 明示"停下来申报，不擅自动"），状态载体走
    // statusDurations 的逃生舱键——沿用早期状态扩展的
    // 模式（Record<string, number> 视角读写）。收益：tickStatuses 对全键的
    // 每回合递减恰好复刻 CE 的燃烧寿命递减（Time.c:2588 / Monsters.c:1880），
    // 快照（玩家 Game.ts:5971 / 怪物 :5988 的 statusDurations 整对象往返）
    // 与 Sidebar 状态栏（遍历 statusDurations 查 STATUS_CONFIG）免费搭车。
    // =========================================================================
    /** CE STATUS_BURNING 上状态时长（Time.c:59-60 max(,7) 的字面 7）。 */
    private static readonly BURNING_DURATION_TURNS = 7;

    private burningDuration(entity: Player | Monster | Creature): number {
        return ((entity.statusDurations as unknown) as Record<string, number>)['burning'] ?? 0;
    }

    private setBurningDuration(entity: Player | Monster | Creature, turns: number): void {
        const durations = (entity.statusDurations as unknown) as Record<string, number>;
        if (turns > 0) {
            durations['burning'] = turns;
        } else {
            delete durations['burning'];
        }
    }

    /**
     * CE Time.c:2088-2098 extinguishFireOnCreature：清状态；玩家提示一句
     * （"you are no longer on fire."），怪物静默；光色/视野刷新 web 无对应
     * 矿灯光色系统，登记退化。
     */
    private extinguishCreatureFire(entity: Player | Monster): void {
        if (this.burningDuration(entity) <= 0) return;
        this.setBurningDuration(entity, 0);
        if (entity === this.player) {
            logger.log(i18next.t('status.player.burning_off', { defaultValue: 'You are no longer on fire.' }), '#cccccc');
        }
    }

    /** CE cellHasTMFlag(loc, TM)（Time.c:34-35/:227 的判据）：全层 mechFlags
     *  的并集查询，复用 DungeonFeature.cellTerrainMechFlags（C-4b 的白名单
     *  读者，c_4a E 留痕的扫描字段不经本文件出现）。 */
    private cellExtinguishesFire(x: number, y: number): boolean {
        return (cellTerrainMechFlags(this.grid, x, y) & TM_EXTINGUISHES_FIRE) !== 0;
    }

    /**
     * CE Time.c:28-61 exposeCreatureToFire 逐条移植：
     * 豁免（命中即 return，Time.c:30-35）——
     *   1. MB_IS_DYING（web 的已死判据 = hp<=0，Creature.die 归零口径）；
     *   2. STATUS_IMMUNE_TO_FIRE（旗标怪经 P1-28 的 syncFlagDerivedStatuses
     *      恒持有永久 immune_fire，通道自然生效）；
     *   3. MONST_INVULNERABLE（全 CE 仅 Warden of Yendor）；
     *   4. MB_SUBMERGED——web 无潜水簿记（Monster.ts generallyValidBoltTarget
     *      同款登记），不实现；
     *   5. (!STATUS_LEVITATING && 踩 TM_EXTINGUISHES_FIRE)——注意 CE 源码
     *      Time.c:34-35 的括号只包住这两条的合取：悬浮生物悬在灭火层上方，
     *      既不会被水免掉点火（火盖水的格子照烧它），也不会被水扑灭
     *      （:228 的灭火守卫同款 !levitating）。
     * 上状态（:59-60）：status = max(status, 7)——刷新而非叠加；首回合
     * （原 status==0）播报"着火"，玩家自己 / 可见怪物（CE canDirectlySeeMonster，
     * web 以格子可见度近似）。
     */
    private exposeCreatureToFire(entity: Player | Monster): void {
        if (entity.hp <= 0) return;
        if (entity.hasStatus('immune_fire')) return;
        if (entity !== this.player && (entity as Monster).isInvulnerable()) return;
        const cell = this.grid?.getCell(entity.loc.x, entity.loc.y);
        if (!cell) return;
        if (!entity.hasStatus('levitating') && this.cellExtinguishesFire(entity.loc.x, entity.loc.y)) return;

        const current = this.burningDuration(entity);
        if (current === 0) {
            if (entity === this.player) {
                logger.log(i18next.t('status.player.burning_on', { defaultValue: 'You catch fire!' }), '#ff6644');
            } else if (cell.isVisible) {
                logger.log(i18next.t('status.monster.burning_on', { monster: entity.name, defaultValue: `The ${entity.name} catches fire!` }), '#ff8866');
            }
        }
        this.setBurningDuration(entity, Math.max(current, Game.BURNING_DURATION_TURNS));
    }

    /**
     * 燃烧状态的每回合伤害结算。CE 玩家在 playerTurnEnded（Time.c:2581-2591）、
     * 怪物在 updateMonsterStatus（Monsters.c:1877-1901）；web 按 P2-3 的合并
     * 口径在客观块结算（与 poisoned 等状态同轨，haste/slow 下的每动作/每行动
     * 差异随之合并——既有登记口径）。先结算伤害后递减与 CE 玩家序一致
     * （Time.c:2582 伤害在 :2588 递减之前）；递减本身由 tickStatuses 统一完成。
     *
     * 免伤不免递减：CE 的掷骰在豁免判定之前（Time.c:2582、Monsters.c:1882
     * 均先 rand_range 后查 IMMUNE/INVULNERABLE），RNG 消耗顺序据此保持。
     * MONST_FIERY 不递减（Monsters.c:1879-1881）：web 数据里全部 FIERY 怪
     * 同时 IMMUNE_TO_FIRE、永不入烧，该分支登记不实现（报告 §载体盘点）。
     */
    private resolveBurningDamage(entity: Player | Monster): void {
        if (entity.hp <= 0) return;
        if (this.burningDuration(entity) <= 0) return;
        const damage = rng.randRange(1, 3); // CE rand_range(1,3)，免疫者照掷
        if (!entity.hasStatus('immune_fire')
            && !(entity !== this.player && (entity as Monster).isInvulnerable())) {
            if (entity instanceof Monster) entity.interruptCorpseAbsorption(damage);
            entity.hp -= damage; // CE Time.c:2584 / Monsters.c:1885: burning bypasses shields.
            if (entity === this.player) {
                this.lastDamageSource = 'fire';
                if (entity.hp <= 0) {
                    // 死亡结算本体在 finishTurnEpilogue 的 hp<=0 清扫
                    // （lastDamageSource='fire' → death.burned），此处只补铭牌。
                    logger.log(i18next.t('env.player_burned_death', { defaultValue: 'You have burned to death.' }), '#ff0000');
                }
            } else if (entity.hp <= 0) {
                logger.log(i18next.t('env.burns_to_death', { name: entity.name, defaultValue: `The ${entity.name} burns to death.` }), '#888888');
                (entity as unknown as { die(): void }).die();
            }
        }
    }

    // =========================================================================
    // F-2c：CE 的爆炸瞬时伤害（T_CAUSES_EXPLOSIVE_DAMAGE，Rogue.h:1944）
    //
    // 结算点：applyInstantTileEffectsToCreature 爆炸段（Time.c:343-396）——
    // 位于蜘蛛网段之后、毒气段之前；触发路径三条：tile 落到生物脚下
    // （fillSpawnMap refresh 分支 Architect.c:3255-3260，killCreature 的
    // 死亡 DF 与火段的甲烷爆轰都走它）、生物每回合行动（Monsters.c:3348/3701）、
    // 玩家客观块（Time.c:2671）——web 对应 applyEnvironmentalEffects（每客观块）
    // 加两条落格瞬间的调用点。
    //
    // 载体申报：'explosion_immunity' 不在 StatusId 联合里（src/entities/
    // Creature.ts），免疫窗走 statusDurations 逃生舱键——复刻
    // F-2b 'burning' 的既有模式（Record<string, number> 视角读写），
    // tickStatuses 对全键的每回合递减恰好复刻 CE 的免疫递减
    // （玩家 Time.c:2298-2300 / 怪物 updateMonsterStatus 的 default 分支
    // Monsters.c:2138-2142）。
    // =========================================================================
    /** CE STATUS_EXPLOSION_IMMUNITY 上状态时长（Time.c:348 的字面 5）。 */
    private static readonly EXPLOSION_IMMUNITY_TURNS = 5;

    private explosionImmunityDuration(entity: Player | Monster | Creature): number {
        return ((entity.statusDurations as unknown) as Record<string, number>)['explosion_immunity'] ?? 0;
    }

    private setExplosionImmunityDuration(entity: Player | Monster | Creature, turns: number): void {
        const durations = (entity.statusDurations as unknown) as Record<string, number>;
        if (turns > 0) {
            durations['explosion_immunity'] = turns;
        } else {
            delete durations['explosion_immunity'];
        }
    }

    /**
     * CE Time.c:343-353 的爆炸段逐条移植：
     *   守卫——T_CAUSES_EXPLOSIVE_DAMAGE（cellHasTerrainFlag 四层并集语义，
     *   cellTerrainFlags）、STATUS_EXPLOSION_IMMUNITY 为 0、
     *   !MB_SUBMERGED（web 无潜水簿记，F-2b 同款登记退化）。
     *   伤害——rand_range(15,20) 后取 max(·, maxHP/2)（CE :345-346：
     *   `damage = max(damage, monst->info.maxHP / 2)`，是**最大生命**的一半，
     *   不是当前血量的 50%——任务书转述有误，已按 CE 翻正）。
     *   上免疫——status = 5（Time.c:347，无 maxStatus 记账）。
     *   玩家——flavor 文案 + dampening 符文吸收（Time.c:352-359：完全挡下
     *   本次伤害 + 自动鉴定）+ 扣血 + 死亡铭牌（"Killed by a violent
     *   explosion" 经 lastDamageSource → finishTurnEpilogue 的 killed_by）。
     *   怪物——睡眠惊醒（:369-371）→ 扣血 → 死亡/幸存消息。
     * 返回是否实际结算了一次伤害（测试与调用方判据）。
     */
    private resolveExplosionDamage(entity: Player | Monster): boolean {
        if (entity.hp <= 0) return false;
        const x = entity.loc.x;
        const y = entity.loc.y;
        const cell = this.grid.getCell(x, y);
        if (!cell) return false;
        if (!(cellTerrainFlags(this.grid, x, y) & T_CAUSES_EXPLOSIVE_DAMAGE)) return false;
        if (this.explosionImmunityDuration(entity) > 0) return false;

        let damage = rng.randRange(15, 20);
        damage = Math.max(damage, Math.floor(entity.maxHp / 2));
        this.setExplosionImmunityDuration(entity, Game.EXPLOSION_IMMUNITY_TURNS);

        if (entity === this.player) {
            logger.log(i18next.t('env.player_explosion_hit', { defaultValue: 'The force of the explosion slams into you.' }), '#ffff44');
            // CE Time.c:352-359：dampening 护甲符文完全吸收爆炸伤害并自动鉴定。
            if (this.player.equippedArmor?.runicType === 'dampening') {
                logger.log(i18next.t('runic.armor.dampening_explosion', { defaultValue: 'Your armor pulses and absorbs the damage.' }), '#66ffff');
                this.player.equippedArmor.runicKnown = true;
                return true;
            }
            this.lastDamageSource = 'violent explosion';
            entity.hp -= entity.absorbShieldDamage(damage);
            return true;
        }

        const monst = entity as Monster;
        // CE :369-371：睡眠中的怪物被爆炸惊醒（→ TRACKING_SCENT，web 同义 HUNTING）。
        if (monst.state === MonsterState.ASLEEP) {
            monst.state = MonsterState.HUNTING;
        }
        const visible = cell.isVisible;
        monst.hp -= monst.isInvulnerable() ? 0 : monst.absorbShieldDamage(damage);
        if (monst.hp <= 0) {
            if (visible) {
                logger.log(i18next.t('env.monster_dies_in_explosion', {
                    name: monst.name,
                    defaultValue: `The ${monst.name} dies in a violent explosion.`
                }), '#ff8844');
            }
            (monst as unknown as { die(): void }).die();
        } else if (visible) {
            logger.log(i18next.t('env.monster_engulfed_explosion', {
                name: monst.name,
                defaultValue: `A violent explosion engulfs the ${monst.name}.`
            }), '#ffcc66');
        }
        return true;
    }

    /** Ordinary objective updates keep their original all-creature/gradual path.
     * Displacement evaluates just its recipient, without an extra gas damage tick
     * or global item destruction (CE instant versus gradual tile effects).
     */
    /** CE Time.c:313-333: flying/inanimate creatures can still be caught.
     * No refresh and no RNG when already stuck or web-immune. */
    public applyEntanglementFromTerrain(entity: Creature): void {
        if (entity.hp <= 0 || entity.hasStatus('stuck')
            || !(cellTerrainFlags(this.grid, entity.x, entity.y) & T_ENTANGLES)
            || (entity instanceof Monster && (entity.hasCEBehavior('MONST_IMMUNE_TO_WEBS') || entity.isInvulnerable()))) return;
        entity.applyStatus('stuck', rng.randRange(3, 7));
    }

    /** CE decrement*Status: lost terrain clears STUCK without decrementing it. */
    private clearDisplacedEntanglement(entity: Creature): void {
        if (!(cellTerrainFlags(this.grid, entity.x, entity.y) & T_ENTANGLES)) entity.setStatusDuration('stuck', 0);
    }

    private playerStruggle(dx: number, dy: number): boolean {
        if (!this.player.hasStatus('stuck') || !(cellTerrainFlags(this.grid, this.player.x, this.player.y) & T_ENTANGLES)) return false;
        this.player.setStatusDuration('stuck', this.player.getStatusDuration('stuck') - 1);
        if (!this.player.hasStatus('stuck')) {
            breakEntanglingTerrain(this.grid, this.player.x, this.player.y);
            logger.log(i18next.t('env.break_web', { defaultValue: 'You break the web.' }), '#aaaaaa');
            return false; // the final attempt also completes the move
        }
        logger.log(i18next.t('env.stuck_web', { defaultValue: 'You struggle against the sticky web.' }), '#aaaaaa');
        this.needsRender = true;
        timeSystem.currentTick += this.player.movementSpeed;
        this.moveEntrancedMonsters(dx, dy);
        this.playerTurnEnded();
        return true;
    }

    /** CE Time.c:421-439; MB_SUBMERGED has no web carrier yet. */
    private applyNauseaFromTerrain(entity: Creature): void {
        if (entity.hp <= 0 || !(cellTerrainFlags(this.grid, entity.x, entity.y) & T_CAUSES_NAUSEA)) return;
        if (entity instanceof Monster && (entity.hasBehavior('MONST_INANIMATE') || entity.isInvulnerable())) return;
        if (entity === this.player && this.player.equippedArmor?.runicType === 'respiration') {
            if (!this.player.equippedArmor.runicKnown) logger.log(i18next.t('runic.armor.respiration_gas', { defaultValue: 'Your armor trembles and a pocket of clean air swirls around you.' }), '#66ffff');
            this.player.equippedArmor.runicKnown = true;
            return;
        }
        const first = !entity.hasStatus('nauseous');
        entity.applyStatus('nauseous', 20);
        if (first && entity instanceof Monster && this.visibleMonsters.has(entity)
            && entity.state === MonsterState.ASLEEP) entity.state = MonsterState.HUNTING;
        if (first && entity === this.player) logger.log(i18next.t('status.player.nauseous_on'), '#b7a26b');
    }

    private applyEnvironmentalEffects(instantTarget?: Creature, deferPlayerNausea = false) {
        const checkEntity = (entity: any, name: string) => {
            if (entity.hp <= 0) return;
            const x = entity.loc.x;
            const y = entity.loc.y;

            const cell = this.grid?.getCell(x, y);
            if (!cell) return;

            // C-5：CE applyInstantTileEffectsToCreature 坠落段（Time.c:168-176，
            // 位于岩浆段之前）——渊上生物置坠落位。玩家置位后 CE 直接 return
            //（跳过本格其余地形效果）；怪物只置位不返回，继续本格其余结算
            //（"handled at end of turn"）。结算点在 playerTurnEnded 顶部与
            // 客观块的 monstersFall。
            if (this.creatureShouldFall(entity)) {
                if (entity === this.player) {
                    this.playerFalling = true;
                    return;
                }
                (entity as Monster).falling = true;
            }

            // Deep water has no instant damage (CE Time.c:556-590).
            const isFlying = entity.hasStatus('flying') || entity.hasStatus('levitating') || (entity.abilities && entity.abilities.has('flying'));
            // F-1 跨层判定：火盖在深水/岩浆上不改变致死地形判据
            //（CE applyInstantTileEffectsToCreature 的 cellHasTerrainFlag 是全层 OR）
            if ((cellTerrainFlags(this.grid, x, y) & T_LAVA_INSTA_DEATH) && !isFlying
                && !entity.hasStatus('immune_fire')
                && !(entity.abilities && entity.abilities.has('immune_fire'))
                && !(entity.isInvulnerable && entity.isInvulnerable())
                && (!instantTarget || (!(cellTerrainFlags(this.grid, x, y) & T_ENTANGLES)
                    && !(cellTerrainFlags(this.grid, x, y) & T_OBSTRUCTS_PASSABILITY)
                    && !this.cellExtinguishesFire(x, y)))) {
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

            // CE Time.c:240: grounded creatures also depress CE traps during
            // ordinary movement/wait contact, not just magical displacement.
            // Legacy TRAP/pressure-plate entry remains handled by its existing path.
            if (instantTarget || ((cellTerrainFlags(this.grid, x, y) & T_IS_DF_TRAP)
                && !cell.layers.includes(TerrainType.TRAP) && !cell.layers.includes(TerrainType.PRESSURE_PLATE))) {
                this.applyDisplacementTileEntry(entity);
                // A teleport trap already committed and evaluated its new cell.
                if (entity.loc.x !== x || entity.loc.y !== y) return;
            }

            // CE Time.c:301-312: sacrifice entry is independent of levitation.
            // The DF refresh re-enters this function after replacing the altar
            // with lava; the new terrain no longer has this activation bit.
            if (entity instanceof Monster && entity.markedForSacrifice
                && entity.machineHome === cell.machineNumber
                && (cellTerrainMechFlags(this.grid, x, y) & TM_PROMOTES_ON_SACRIFICE_ENTRY)) {
                promoteLayersWithMechFlag(this.grid, x, y, TM_PROMOTES_ON_SACRIFICE_ENTRY);
                if (entity.hp <= 0) return;
            }

            // Fire
            // F-2b：CE 两段模型的生物侧（Time.c:226-232 灭火 / :527-540 上状态
            // 与点燃所踩地形）。原"站燃烧格平扣 2"随燃烧状态机退役：站火格只
            // 上 STATUS_BURNING 状态（exposeCreatureToFire），伤害由燃烧状态
            // 每回合结算（tickCreatureStatuses → resolveBurningDamage，
            // CE 玩家 Time.c:2581-2591 / 怪 Monsters.c:1877-1901）。
            // 灭火先于点火（CE 同一函数内 :227 先于 :527）：燃烧生物蹚进
            // 灭火层先被扑灭；悬浮生物不被水扑灭（!levitating 守卫，Time.c:228）。
            if (this.burningDuration(entity) > 0
                && !entity.hasStatus('levitating')
                && !(entity !== this.player && (entity as Monster).hasBehavior('MONST_FIERY'))
                && this.cellExtinguishesFire(x, y)) {
                // CE :229 MONST_ATTACKABLE_THRU_WALLS 守卫：web 无该旗标载体，登记退化。
                this.extinguishCreatureFire(entity);
            }

            const applyContactFire = () => {
                if (cell.isBurning) {
                    // CE Time.c:527-528：踩 T_IS_FIRE → exposeCreatureToFire。
                    // 豁免（MB_IS_DYING / IMMUNE_TO_FIRE / MONST_INVULNERABLE /
                    // MB_SUBMERGED / 非悬浮+灭火层）全在 exposeCreatureToFire 内。
                    this.exposeCreatureToFire(entity);
                } else if (this.burningDuration(entity) > 0) {
                    // CE Time.c:529-540（else if：已火格无需再点）：着火生物点燃
                    // 所踩的可燃非火格——alwaysIgnite 直燃（Gas.ignite 即 CE :539
                    // exposeTileToFire(x,y,true)，可燃性与 12 次暴露封顶由其自守）。
                    // CE :538 的 MB_SUBMERGED|MB_IS_FALLING 守卫：web 无潜水/坠落
                    // 簿记（登记退化；水格已被上面的灭火分支扑灭，且水体链本身缓办）。
                    this.environment.ignite(x, y);
                }
            };
            if (!instantTarget) applyContactFire();

            // Explosion —— F-2c：爆炸瞬时伤害（Time.c:343-396，位于蜘蛛网段
            // 之后、毒气段 :411 之前的同一函数内——web 对应插在火段与气段
            // 之间）。守卫与免疫窗都在 resolveExplosionDamage 内；落格瞬间的
            // DF 逐格接触与普通地形结算共用此伤害出口。
            this.applyEntanglementFromTerrain(entity);
            this.resolveExplosionDamage(entity);
            // CE Time.c:370/392 returns on lethal contact before gas statuses.
            if (instantTarget && entity.hp <= 0) return;

            if (entity !== this.player || !deferPlayerNausea) this.applyNauseaFromTerrain(entity);

            // CE Time.c:592-640: all layers, once, in layer order. U08 vines
            // share gradual damage with gas; contact itself does not deal it.
            const damagingTile = cell.layers.find(tile => TERRAIN_FLAGS[tile].flags & T_CAUSES_DAMAGE);
            if (!instantTarget && damagingTile !== undefined) {
                const exempt = entity instanceof Monster && (entity.hasBehavior('MONST_INANIMATE') || entity.isInvulnerable());
                const armor = entity === this.player ? this.player.equippedArmor : null;
                if (!exempt && armor?.runicType === 'respiration') {
                    if (!armor.runicKnown) {
                        armor.runicKnown = true;
                        logger.log(i18next.t('runic.armor.respiration_gas', { defaultValue: 'Your armor trembles and a pocket of clean air swirls around you.' }), '#66ffff');
                    }
                } else if (!exempt) {
                    if (entity instanceof Monster) entity.interruptCorpseAbsorption(Math.max(1, Math.floor(entity.maxHp / 15)));
                    entity.hp -= Math.max(1, Math.floor(entity.maxHp / 15)); // bypasses shields
                    if (entity === this.player) {
                        const vines = damagingTile === TerrainType.ANCIENT_SPIRIT_VINES;
                        this.lastDamageSource = vines ? 'thorned vines' : damagingTile === TerrainType.STEAM ? 'steam' : 'caustic gas';
                        if (vines) logger.log(i18next.t('env.player_vines', { defaultValue: 'The thorned vines tear at your flesh!' }), '#99bb55');
                        else if (damagingTile === TerrainType.STEAM) logger.log(i18next.t('env.player_scalded', { defaultValue: 'The steam scalds you!' }), '#cccccc');
                        else logger.log(i18next.t('env.player_poison_gas', { defaultValue: 'You breathe in toxic fumes!' }), '#aaeeaa');
                    }
                    if (entity.hp <= 0 && entity !== this.player) entity.die();
                }
            }

            // Gas —— G-3 重裁（F-0 §5.3-10/11）：
            // CE 的气体效果判定**无阈值**（站进即判，Time.c:421-497 的
            // 恶心/混乱/麻痹 + :592-655 的伤害），状态每回合 max() 刷新
            // （`status = max(status, N)`——web applyStatus 'refresh' 即
            // Math.max 语义）；伤害按 `max(1, maxHP/15)` 比例
            // （applyGradualTileEffectsToCreature，Time.c:596-598，ticks=100）。
            // 分派按 GAS 层 tile 的 T_CAUSES_* 旗标（CE cellHasTerrainFlag
            // 语义），只看 tile 不看体积——燃气点燃后 volume=0 而 GAS 层
            // tile 暂留的收层前窗口（Time.c:1361-1368 怪癖）CE 同样命中。
            // 旧 0-100 时代的 CONFUSION/STEAM 密度 >20 阈值是 web 自创参数，
            // 随本轮退役；POISON_GAS 按 CE 是 T_CAUSES_DAMAGE 直接伤害
            // （不是上 'poisoned' 状态——CE 的毒状态走 addPoison，与气体
            // 无关）；CREEPING_DEATH 分支是 D2 留痕（无层载体，不可达）。
            if (this.environment) {
                const gasTile = cell.layers[DungeonLayer.GAS]!;
                if (gasTile !== TerrainType.NOTHING) {
                    const gasFlags = TERRAIN_FLAGS[gasTile].flags;
                    // CE Time.c:411-424 的 respiration 判定以
                    // `cellHasTerrainFlag(T_RESPIRATION_IMMUNITIES)` 为前置
                    // （:409-412）——甲烷等无该组旗标的气体不进豁免块，
                    // 也不触发自动鉴定。伤害/混乱/麻痹/恶心四旗标入组
                    // （Rogue.h:1956）。
                    const respirationImmune = (gasFlags & T_RESPIRATION_IMMUNITIES) !== 0
                        && entity === this.player
                        && this.player.equippedArmor?.runicType === 'respiration';
                    if (respirationImmune && !this.player.equippedArmor!.runicKnown) {
                        this.player.equippedArmor!.runicKnown = true;
                        logger.log(i18next.t('runic.armor.respiration_gas', { defaultValue: 'Your armor trembles and a pocket of clean air swirls around you.' }), '#66ffff');
                    }

                    // 混乱气体（T_CAUSES_CONFUSION，Time.c:443-470）：
                    // STATUS_CONFUSED = max(…, 25)，豁免 MONST_INANIMATE /
                    // MONST_INVULNERABLE；玩家看得见且首次上状态时惊醒
                    // 睡眠怪（:448-452，creatureState → TRACKING_SCENT）。
                    if ((gasFlags & T_CAUSES_CONFUSION) !== 0 && !respirationImmune) {
                        const exempt = entity !== this.player
                            && ((entity as Monster).hasBehavior('MONST_INANIMATE')
                                || (entity as Monster).isInvulnerable());
                        if (!exempt) {
                            // CE :449 的惊醒判据是"本回合赋值前 STATUS_CONFUSED
                            // 为 0"（外层还有 canDirectlySeeMonster——web 对应
                            // visibleMonsters），不是"本次刷新生效"。
                            const wasConfused = entity.getStatusDuration('confused') > 0;
                            const applied = entity === this.player
                                ? entity.applyStatus('confused', 25)
                                : this.applyStatusToMonster(entity as Monster, 'confused', 25, 'gas');
                            if (entity === this.player && applied) {
                                logger.log(i18next.t('env.player_confused_gas', { defaultValue: 'The confusion gas clouds your mind!' }), '#cc99ff');
                            }
                            if (!wasConfused && applied && entity !== this.player
                                && this.visibleMonsters.has(entity as Monster)
                                && (entity as Monster).state === MonsterState.ASLEEP) {
                                (entity as Monster).state = MonsterState.HUNTING;
                            }
                        }
                    }

                    // 麻痹气体（T_CAUSES_PARALYSIS，Time.c:471-497）：
                    // STATUS_PARALYZED = max(…, 20)，豁免同混乱 + 潜水
                    // （web 无潜水簿记，登记退化）。CE 不惊醒睡眠怪。
                    if ((gasFlags & T_CAUSES_PARALYSIS) !== 0 && !respirationImmune) {
                        const exempt = entity !== this.player
                            && ((entity as Monster).hasBehavior('MONST_INANIMATE')
                                || (entity as Monster).isInvulnerable());
                        if (!exempt) {
                            const applied = entity === this.player
                                ? entity.applyStatus('paralyzed', 20)
                                : this.applyStatusToMonster(entity as Monster, 'paralyzed', 20, 'gas');
                            if (entity === this.player && applied) {
                                logger.log(i18next.t('status.player.paralyzed', { defaultValue: 'You are paralyzed!' }), '#ff9999');
                            }
                        }
                    }

                    if (!instantTarget && this.environment.gasGrid[x]?.[y]?.type === GasType.CREEPING_DEATH) {
                        // D2 留痕：本分支随 creeping_death 退池后不可达
                        //（GasType.CREEPING_DEATH 无层载体，addGas 拒绝写入），
                        // 按口径保留代码。
                        entity.hp -= 10;
                        if (entity === this.player) {
                            this.lastDamageSource = 'creeping death';
                            logger.log(i18next.t('env.player_creeping_death', { defaultValue: 'Spores of creeping death eat away at your flesh!' }), '#ff4444');
                        }
                        if (entity.hp <= 0 && entity !== this.player) entity.die();
                    }
                }
            }
            // CE instantaneous order: promotion -> entanglement/explosion ->
            // gas statuses -> ignition. Dead creatures cannot be ignited.
            if (instantTarget && entity.hp > 0) applyContactFire();
            if (entity.hp > 0) this.useContactKeyAt(entity.loc.x, entity.loc.y);
        };

        if (instantTarget) {
            checkEntity(instantTarget, instantTarget.name);
            return;
        }
        checkEntity(this.player, 'Player');
        for (const m of this.monsters) {
            checkEntity(m, m.name);
        }

        this.destroyFloorItemsInLava();
    }

    /** CE Items.c:1256-1261: fire/lava destruction precedes liquid drift.
     * Future arrivals are inert during catch-up, and the amulet resists lava. */
    private burnFloorItems(lavaOnly = false): void {
        for (const item of [...this.items]) {
            if (this.absoluteTurnNumber < item.spawnTurnNumber) continue;
            const flags = cellTerrainFlags(this.grid, item.x, item.y);
            if (((flags & T_LAVA_INSTA_DEATH) && item.category !== ItemCategory.AMULET)
                || (!lavaOnly && (flags & T_IS_FIRE) && item.category === ItemCategory.SCROLL)) {
                this.burnFloorItem(item);
            }
        }
    }

    private destroyFloorItemsInLava(): void {
        this.burnFloorItems(true);
    }

    public getMonsterAt(x: number, y: number): Monster | undefined {
        return this.monsters.find(m => m.loc.x === x && m.loc.y === y && m.hp > 0);
    }

    // ══ V-2b-5：休眠子系统（CE Monsters.c:4156-4210 + Architect.c:1655-1661/
    //    3487-3496）════════════════════════════════════════════════════════

    /**
     * 把"唤醒回调"绑到当前 grid 上。`spawnDungeonFeature` 按 Grid 键控取回调
     * （见 DungeonFeature.setDormantAwakener 的头注），而 `this.grid` 随层换新
     * ——四处换 grid 的地方（新层 / 层缓存恢复 / test 层 / 读档）各调一次。
     * 忘调的表现是：该层上任何 DFF_ACTIVATE_DORMANT_MONSTER 的 DF 静默不唤醒。
     */
    private bindDormantAwakener(): void {
        setDormantAwakener(this.grid, (origin, builtCells) =>
            this.awakenDormantMonstersAt(origin, builtCells));
        setAllyResurrector(this.grid, origin => this.resurrectAlly(origin));
        this.bindDungeonFeatureEffects();
    }

    private bindDungeonFeatureEffects(): void {
        setDungeonFeatureEffects(this.grid, {
            creatures: () => [this.player, ...this.monsters.filter(m => !m.isDormant)]
                .filter(c => c.hp > 0).map(c => ({ loc: c.loc, forbiddenTerrain:
                    c instanceof Monster ? speciesForbiddenFlags({ behaviorFlags: [...c.behaviorFlags] }) : T_PATHING_BLOCKER })),
            refreshCell: pos => this.refreshDungeonFeatureCell(pos),
            flavor: pos => {
                if (this.player.x === pos.x && this.player.y === pos.y && !this.player.hasStatus('levitating')) {
                    logger.log(i18next.t('df.flavor', { terrain: this.getTerrainName(this.grid.getCell(pos.x, pos.y)!.terrain),
                        defaultValue: 'You are standing on {{terrain}}.' }), '#aaaaaa');
                }
            },
            instantEffects: pos => {
                const creature = this.player.hp > 0 && this.player.x === pos.x && this.player.y === pos.y
                    ? this.player : this.monsters.find(m => m.hp > 0 && !m.isDormant && m.x === pos.x && m.y === pos.y);
                if (creature) this.applyDungeonFeatureContact(creature);
            },
            burnItems: pos => this.burnFloorItemsAt(pos),
            caughtFire: pos => {
                this.pendingCaughtFireCells ??= [];
                if (!this.pendingCaughtFireCells.some(p => p.x === pos.x && p.y === pos.y)) this.pendingCaughtFireCells.push(pos);
            },
            playerFireOrDescent: () => {
                if (cellTerrainFlags(this.grid, this.player.x, this.player.y) & (T_IS_FIRE | T_AUTO_DESCENT)) {
                    this.applyDungeonFeatureContact(this.player);
                }
            },
            describe: (feat, pos) => {
                if ((this.player.x === 0 && this.player.y === 0) || !this.grid.getCell(pos.x, pos.y)?.isVisible) return false;
                logger.log(this.dungeonFeatureDescription(feat.description));
                return true;
            },
            aggravate: (radius, origin) => this.aggravateMonsters(radius, origin),
            flash: (color, radius, pos) => this.colorFlash(color, radius, pos),
            flare: (kind, pos) => this.createFlare(pos.x, pos.y, LightKind[kind as keyof typeof LightKind]),
            invalidatePathing: () => {
                this.loopMap = analyzeLoopMap(this.grid);
                this.updatedSafetyMapThisTurn = false;
                this.autoPath = []; this.isMouseTraveling = false;
            },
            invalidateShore: () => { this.updatedSafetyMapThisTurn = false; },
            gameHasEnded: () => this.isGameOver === true,
        });
    }

    /** A lethal instantaneous DF contact ends the fill immediately (CE Time.c:369-370).
     * Ordinary gradual/status deaths keep their existing turn-boundary cleanup. */
    private applyDungeonFeatureContact(creature: Creature): void {
        this.applyEnvironmentalEffects(creature);
        if (creature === this.player && creature.hp <= 0 && !this.isGameOver) {
            this.triggerGameOver(false, this.lastDamageSource === 'violent explosion'
                ? i18next.t('death.explosion', { defaultValue: 'Killed by a violent explosion.' })
                : i18next.t('death.killed_by', { monster: this.lastDamageSource, defaultValue: 'Killed by {{monster}}.' }));
        }
    }

    private refreshDungeonFeatureCell(pos: Pos): void {
        const cell = this.grid.getCell(pos.x, pos.y);
        if (cell?.layers.includes(TerrainType.WALL_LEVER_HIDDEN)) this.secretScanDepth = -1;
        if (cell?.isVisible) {
            cell.isExplored = true; cell.hasMemory = true;
            cell.rememberedTerrain = cell.terrain;
            cell.rememberedLayers = [...cell.layers];
            cell.rememberedAppearance = memoryTerrainAppearance(cell, this.depth);
            cell.rememberedTerrainFlags = cellTerrainFlags(this.grid, pos.x, pos.y);
            cell.rememberedTMFlags = cellTerrainMechFlags(this.grid, pos.x, pos.y);
            cell.rememberedFlags = { passable: cell.isPassable, opaque: cell.isOpaque,
                trapFree: !(cell.rememberedTerrainFlags & T_IS_DF_TRAP) };
            const item = this.items.find(i => i.x === pos.x && i.y === pos.y);
            cell.rememberedItem = item ? { name: item.displayName, char: item.char, color: item.color } : null;
            cell.rememberedItemCategory = item?.category ?? null;
        }
        this.needsRender = true;
    }

    private dungeonFeatureDescription(description: string): string {
        switch (description) {
            case "An old friend emerges from a bloom of sacred light!": return i18next.t('df.message_1', { defaultValue: "An old friend emerges from a bloom of sacred light!" });
            case "a cloud of caustic gas sprays upward from the floor!": return i18next.t('df.message_2', { defaultValue: "a cloud of caustic gas sprays upward from the floor!" });
            case "a demonic presence whispers its demand: \"Bring to me the marked sacrifice!\"": return i18next.t('df.message_3', { defaultValue: "a demonic presence whispers its demand: \"Bring to me the marked sacrifice!\"" });
            case "a scratching sound emanates from the nearby walls!": return i18next.t('df.message_4', { defaultValue: "a scratching sound emanates from the nearby walls!" });
            case "a stone bridge extends from the floor with a grinding sound.": return i18next.t('df.message_5', { defaultValue: "a stone bridge extends from the floor with a grinding sound." });
            case "a torch falls from its mount and lies sputtering on the floor.": return i18next.t('df.message_6', { defaultValue: "a torch falls from its mount and lies sputtering on the floor." });
            case "across the bog, bubbles rise ominously from the mud.": return i18next.t('df.message_7', { defaultValue: "across the bog, bubbles rise ominously from the mud." });
            case "as flames begin to lick the coffin, its tenant bursts forth!": return i18next.t('df.message_8', { defaultValue: "as flames begin to lick the coffin, its tenant bursts forth!" });
            case "cracks begin snaking across the marble surface of the statue!": return i18next.t('df.message_9', { defaultValue: "cracks begin snaking across the marble surface of the statue!" });
            case "deadly purple gas starts wafting out of hidden vents in the floor!": return i18next.t('df.message_10', { defaultValue: "deadly purple gas starts wafting out of hidden vents in the floor!" });
            case "explosive methane gas starts wafting out of hidden vents in the floor!": return i18next.t('df.message_11', { defaultValue: "explosive methane gas starts wafting out of hidden vents in the floor!" });
            case "flames quickly consume the wooden barricade.": return i18next.t('df.message_12', { defaultValue: "flames quickly consume the wooden barricade." });
            case "hissing fills the air as the lava begins to cool.": return i18next.t('df.message_13', { defaultValue: "hissing fills the air as the lava begins to cool." });
            case "paralytic gas sprays upward from hidden vents in the floor!": return i18next.t('df.message_14', { defaultValue: "paralytic gas sprays upward from hidden vents in the floor!" });
            case "the altar retracts into the ground with a grinding sound.": return i18next.t('df.message_15', { defaultValue: "the altar retracts into the ground with a grinding sound." });
            case "the archway flashes, and you catch a glimpse of another world!": return i18next.t('df.message_16', { defaultValue: "the archway flashes, and you catch a glimpse of another world!" });
            case "the area is flooded as water rises through imperceptible holes in the ground.": return i18next.t('df.message_17', { defaultValue: "the area is flooded as water rises through imperceptible holes in the ground." });
            case "the cage lifts off of the altar.": return i18next.t('df.message_18', { defaultValue: "the cage lifts off of the altar." });
            case "the cages lift off of the altars as you approach.": return i18next.t('df.cages_open', { defaultValue: 'the cages lift off of the altars as you approach.' });
            case "demonic cackling echoes through the room as the altar plunges downward!": return i18next.t('df.sacrifice_complete', { defaultValue: 'demonic cackling echoes through the room as the altar plunges downward!' });
            case "the cages lower to cover the altars.": return i18next.t('df.message_19', { defaultValue: "the cages lower to cover the altars." });
            case "the coffin opens and a dark figure rises!": return i18next.t('df.message_20', { defaultValue: "the coffin opens and a dark figure rises!" });
            case "the crystal absorbs the electricity and begins to glow.": return i18next.t('df.message_21', { defaultValue: "the crystal absorbs the electricity and begins to glow." });
            case "the items on the two altars flash with a brilliant light!": return i18next.t('df.message_22', { defaultValue: "the items on the two altars flash with a brilliant light!" });
            case "the light in the room flickers and you feel a chill in the air.": return i18next.t('df.message_23', { defaultValue: "the light in the room flickers and you feel a chill in the air." });
            case "the nearby wall explodes in a shower of stone fragments!": return i18next.t('df.message_24', { defaultValue: "the nearby wall explodes in a shower of stone fragments!" });
            case "the portcullis slowly rises from the ground into a slot in the ceiling.": return i18next.t('df.message_25', { defaultValue: "the portcullis slowly rises from the ground into a slot in the ceiling." });
            case "the rope bridge snaps from the heat and plunges into the chasm!": return i18next.t('df.message_26', { defaultValue: "the rope bridge snaps from the heat and plunges into the chasm!" });
            case "the statue shatters!": return i18next.t('df.message_27', { defaultValue: "the statue shatters!" });
            case "the wall above the lever shifts to reveal a spark turret!": return i18next.t('df.message_28', { defaultValue: "the wall above the lever shifts to reveal a spark turret!" });
            case "with a heavy mechanical sound, an iron portcullis falls from the ceiling!": return i18next.t('df.message_29', { defaultValue: "with a heavy mechanical sound, an iron portcullis falls from the ceiling!" });
            case "you hear a click, and the stones in the wall shift to reveal turrets!": return i18next.t('df.message_30', { defaultValue: "you hear a click, and the stones in the wall shift to reveal turrets!" });
            case "you notice a lever hidden behind a loose stone in the wall.": return i18next.t('df.message_31', { defaultValue: "you notice a lever hidden behind a loose stone in the wall." });
            case "you notice an inactive gas vent hidden in a crevice of the floor.": return i18next.t('df.message_32', { defaultValue: "you notice an inactive gas vent hidden in a crevice of the floor." });
            default: return description; // custom engine-provided localized feature
        }
    }

    /** Architect.fillSpawnMap burns only ITEM_FLAMMABLE (CE: scrolls).
     * Falling/drifting/enchant swaps remain in the floor-item time phase. */
    private burnFloorItemsAt(pos: Pos): void {
        for (const item of [...this.items]) {
            if (item.x === pos.x && item.y === pos.y && item.category === ItemCategory.SCROLL) this.burnFloorItem(item);
        }
    }

    /** CE Time.c:973 burnItem; removal precedes recursive DF refresh. */
    private burnFloorItem(item: Item): void {
        const index = this.items.indexOf(item);
        if (index < 0) return;
        const pos = { ...item.loc };
        this.items.splice(index, 1);
        if (this.grid.getCell(pos.x, pos.y)?.isVisible) logger.log(i18next.t('df.item_burns', {
            item: item.displayName, defaultValue: '{{item}} burns up!'
        }), '#ffaa55');
        this.refreshDungeonFeatureCell(pos);
        spawnDungeonFeature(this.grid, pos.x, pos.y, catalogFeature(DF.DF_ITEM_FIRE), false);
    }

    /** CE Items.c:4089: distance is path distance from the alarm, not from the
     * player and not Euclidean radius. Secret doors use calculateDistances. */
    private aggravateMonsters(radius: number, origin: Pos): void {
        this.waypoints.coordinates[0] = { ...origin };
        this.waypoints.refreshWaypoint(0, this.wpContext());
        const distances = generationDistances(this, origin, T_PATHING_BLOCKER, false);
        for (const m of this.monsters) {
            if (m.hp <= 0 || m.isDormant || distances[m.x]![m.y]! > radius) continue;
            if (m.state === MonsterState.ASLEEP) {
                m.state = m.creatureMode === MonsterMode.PERM_FLEEING ? MonsterState.FLEEING : MonsterState.HUNTING;
                m.ticksUntilTurn = 100;
                for (const mate of this.monsters) {
                    if (mate !== m && monstersAreTeammates(m, mate) && mate.creatureMode === MonsterMode.NORMAL) {
                        if (mate.state === MonsterState.ASLEEP || mate.state === MonsterState.WANDERING) mate.ticksUntilTurn = Math.max(100, mate.ticksUntilTurn);
                        if (!m.isAlly) mate.state = MonsterState.HUNTING;
                    }
                }
            }
            if (!m.isAlly && (m.leader as Creature | null) !== this.player) {
                m.state = m.creatureMode === MonsterMode.PERM_FLEEING ? MonsterState.FLEEING : MonsterState.HUNTING;
                m.behaviorFlags.delete('MONST_MAINTAINS_DISTANCE');
                m.abilityFlags.delete('MA_AVOID_CORRIDORS');
            }
        }
        for (let x = 0; x < this.grid.width; x++) for (let y = 0; y < this.grid.height; y++) {
            const distance = distances[x]![y]!;
            if (distance >= 0 && distance <= radius) this.scent.replaceScent(this.grid, x, y, 2 * distance);
        }
        if (this.player.x === origin.x && this.player.y === origin.y) this.player.applyStatus('aggravating', radius);
        if (distances[this.player.x]?.[this.player.y]! <= radius) {
            discoverSecretsAt(this.grid, origin.x, origin.y);
            const cell = this.grid.getCell(origin.x, origin.y)!;
            cell.hasMemory = true; cell.isDiscovered = true; cell.isExplored = true;
            this.colorFlash('gray', radius, origin, 10, true);
            if (!cell.isVisible) logger.log(i18next.t('df.alarm', {
                defaultValue: 'You hear a piercing shriek; something must have triggered a nearby alarm.'
            }), '#aaaaaa');
        }
        this.needsRender = true;
    }

    /** CE Monsters.c:2898-2945: choose from purgatory, then restore the same entity. */
    public resurrectAlly(origin: Pos): boolean {
        const speciesOrder = (m: Monster): number => (monsterData as MonsterData[]).findIndex(data => data.id === m.typeId);
        const candidate = [...this.purgatory].sort((a, b) =>
            b.totalPowerCount - a.totalPowerCount || speciesOrder(b) - speciesOrder(a))[0];
        if (!candidate) return false;
        const valid = (x: number, y: number): boolean => {
            const cell = this.grid.getCell(x, y);
            return !!cell && cell.isPassable && !(cellTerrainFlags(this.grid, x, y) & (T_PATHING_BLOCKER | T_HARMFUL_TERRAIN))
                && !this.getMonsterAt(x, y) && (this.player.loc.x !== x || this.player.loc.y !== y);
        };
        if (!this.grid.getCell(origin.x, origin.y)) return false;
        // CE getQualifyingPathLocNear: shortest walk through non-blocking,
        // non-harmful terrain; choose uniformly among equally near cells.
        const cost = allocShortGrid(this.grid.width, this.grid.height, 1);
        const dist = allocShortGrid(this.grid.width, this.grid.height, MAX_DISTANCE);
        for (let x = 0; x < this.grid.width; x++) for (let y = 0; y < this.grid.height; y++) {
            if (cellTerrainFlags(this.grid, x, y) & (T_PATHING_BLOCKER | T_HARMFUL_TERRAIN)) cost[x]![y] = -1;
        }
        cost[origin.x]![origin.y] = 1;
        dist[origin.x]![origin.y] = 1;
        new DijkstraMap(this.grid.width, this.grid.height).batchScan(dist, cost, true);
        let best = MAX_DISTANCE;
        const ties: Pos[] = [];
        for (let x = 0; x < this.grid.width; x++) for (let y = 0; y < this.grid.height; y++) {
            const d = dist[x]![y]!;
            if (d >= MAX_DISTANCE || d > best || !valid(x, y)) continue;
            if (d < best) { best = d; ties.length = 0; }
            ties.push({ x, y });
        }
        let loc: Pos | null = ties.length ? ties[rng.randRange(0, ties.length - 1)]! : null;
        // CE's path search falls back to a distance-only search when no
        // reachable qualifying tile exists.
        for (let radius = 0; radius < Math.max(this.grid.width, this.grid.height) && !loc; radius++) {
            const ring: Pos[] = [];
            for (let dx = -radius; dx <= radius; dx++) for (let dy = -radius; dy <= radius; dy++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
                const x = origin.x + dx, y = origin.y + dy;
                if (valid(x, y)) ring.push({ x, y });
            }
            if (ring.length) loc = ring[rng.randRange(0, ring.length - 1)]!;
        }
        if (!loc) return false;
        this.purgatory.splice(this.purgatory.indexOf(candidate), 1);
        candidate.loc = loc;
        candidate.deathProcessed = false;
        candidate.deathEffectTriggered = false;
        candidate.falling = false;
        if (!candidate.hasBehavior('MONST_FIERY')) (candidate.statusDurations as Record<string, number>).burning = 0;
        candidate.setStatusDuration('discordant', 0);
        candidate.heal(100, true);
        if (candidate.hasAbility('MA_ENTER_SUMMONS')) {
            const form = (monsterData as MonsterData[]).find(data => data.id === candidate.typeId);
            if (form) {
                candidate.abilityFlags = new Set(form.abilityFlags ?? []);
                candidate.behaviorFlags = new Set(form.behaviorFlags ?? []);
                candidate.syncFlagDerivedStatuses();
            }
            candidate.wasNegated = false;
        }
        this.monsters.unshift(candidate);
        this.needsRender = true;
        return true;
    }

    /**
     * CE Architect.c:3487-3496 的判定半边：休眠怪在 **DF 原点格** 或在
     * **DF 实际铺开的落点集** 里者，全部唤醒。两条析取缺一不可——
     * 只实现前者，`STATUE_DORMANT {3,5}` 一类一次多格的雕像群只会活一只；
     * 只实现后者，startProbability=0 的 DF（CE :679 DF_SHATTERING_SPELL）
     * 连原点那一只都漏。
     */
    private awakenDormantMonstersAt(origin: Pos, builtCells: readonly Pos[]): void {
        const built = new Set(builtCells.map(p => p.y * DCOLS + p.x));
        for (const monst of [...this.dormantMonsters]) {
            const atOrigin = monst.loc.x === origin.x && monst.loc.y === origin.y;
            if (!atOrigin && !built.has(monst.loc.y * DCOLS + monst.loc.x)) continue;
            this.toggleMonsterDormancy(monst);
        }
    }

    /**
     * CE toggleMonsterDormancy（Monsters.c:4156-4210）的直译，双向幂等：
     * 在 dormantMonsters 里 → 醒来；在 monsters 里 → 睡下；两表皆无 → 无操作
     * （CE 的两次 removeCreature 都失败时同样什么都不做）。
     *
     * 醒来方向的要点（CE :4158-4198，逐条）：
     *   - 移回正常表（CE prependCreature → web unshift，保持"最新醒的排最前"）；
     *   - 清格上的 HAS_DORMANT_MONSTER（:4165 → web `cell.hasDormantMonster`）；
     *   - **格被占（HAS_MONSTER | HAS_PLAYER）则重新选址**（:4168-4181）——
     *     漏了这支会出现两只怪叠格（CE 的 HasMonster/HAS_PLAYER 在 web 分别是
     *     `getMonsterAt` 与玩家坐标）。CE 用 getQualifyingPathLocNear 按
     *     "路径距离最小 + 并列随机"选格，web 直接复用同口径的
     *     `findQualifyingPathLocNear`（P4-9/P1-31 已按 CE 建好的那条）；
     *   - 醒来后 200 tick 内不动（:4192），给玩家反应时间；
     *   - MB_MARKED_FOR_SACRIFICE 的献祭链（:4183-4188）web 无该机制，跳过。
     *
     * 睡下方向（:4200-4209）：从 monsters 摘到 dormantMonsters、清 HAS_MONSTER
     * （web 的 getMonsterAt 派生自 this.monsters，摘表即生效）、置
     * HAS_DORMANT_MONSTER 与 MB_IS_DORMANT。CE 对可见性/回合调度零额外处理
     * ——不在这张表里就够了，web 同构。
     */
    public toggleMonsterDormancy(monst: Monster): void {
        const dormantIdx = this.dormantMonsters.indexOf(monst);
        if (dormantIdx !== -1) {
            // —— 醒来（CE :4158-4198）——
            this.dormantMonsters.splice(dormantIdx, 1);
            monst.isDormant = false; // CE :4195 清 MB_IS_DORMANT
            const fromCell = this.grid.getCell(monst.loc.x, monst.loc.y);
            if (fromCell) fromCell.hasDormantMonster = false; // CE :4165
            // CE :4168-4181：`pmap.flags & (HAS_MONSTER | HAS_PLAYER)` → 占用
            const occupied = !!this.getMonsterAt(monst.loc.x, monst.loc.y)
                || (this.player.hp > 0
                    && this.player.loc.x === monst.loc.x
                    && this.player.loc.y === monst.loc.y);
            if (occupied) {
                // CE :4169-4177 getQualifyingPathLocNear（"路径距离最小 + 并列
                // 随机"，HAS_PLAYER / HAS_MONSTER / HAS_STAIRS 一并回避）。web
                // 复用同口径的 findQualifyingPathLocNear（P1-31/P4-9 建好；
                // 其 machineCells 回避比 CE 多一项——web 侧必要，与
                // spawnHordeAt 成员铺开的排除同理由，见该方法内注）。
                let relocated = this.findQualifyingPathLocNear(monst.loc);
                // CE 的判据里 HAS_PLAYER 是硬回避项；web 的
                // entryQualifiesForPlacement 不查玩家坐标（它只服务玩家落位，
                // 玩家不会把自己选进自己），这里补上同一回避。
                if (relocated
                    && this.player.loc.x === relocated.x
                    && this.player.loc.y === relocated.y) {
                    relocated = null;
                }
                // CE Grid.c:347-356 的路径无关兜底（getQualifyingLocNear）——
                // web 同款切比雪夫环 = findNearbySpawnSpot（P4-2，回避
                // 怪/玩家/不可走）。
                if (!relocated) relocated = this.findNearbySpawnSpot(monst.loc);
                if (relocated) {
                    monst.loc = relocated;
                    const toCell = this.grid.getCell(relocated.x, relocated.y);
                    if (toCell) toCell.hasDormantMonster = false;
                }
                // 找不到合格格时留在原格（与 CE 的 getQualifyingPathLocNear
                // "总返回某处"的兜底同义；叠格是 CE 同款退化，不另造守卫）。
            }
            monst.ticksUntilTurn = Math.max(monst.ticksUntilTurn, 200); // CE :4192
            this.monsters.unshift(monst); // CE :4163 prependCreature
            // CE :4194 置 HAS_MONSTER——web 的 getMonsterAt 派生自本表，无需位。
            return;
        }

        const activeIdx = this.monsters.indexOf(monst);
        if (activeIdx !== -1) {
            // —— 睡下（CE :4200-4209）——
            this.monsters.splice(activeIdx, 1);
            this.dormantMonsters.unshift(monst); // CE :4203 prependCreature
            monst.isDormant = true; // CE :4207 置 MB_IS_DORMANT
            const cell = this.grid.getCell(monst.loc.x, monst.loc.y);
            if (cell) cell.hasDormantMonster = true; // CE :4206
            this.visibleMonsters.delete(monst); // 不再可见（CE 不在 monsters 表 ⇒ 画不到）
        }
    }

    /**
     * V-2b-5：CE Architect.c:1628-1661 的 MB_JUST_SUMMONED 段（机器怪落地
     * 收尾），对机器生成的**每一只**怪（含 horde 成员——CE spawnMinions
     * Monsters.c:743 同样置 MB_JUST_SUMMONED）执行。**前提：mon 已在
     * this.monsters 里**（单只路径由调用方 push、horde 路径由 spawnHordeAt
     * push——CE 的怪在 spawnHorde/generateMonster 时就已入表，本段只是
     * 后处理，不再入表一次；重复入表会让同一对象在两张表里各留一份）。
     *   - machineHome = machineNumber（:1661，"Monster remembers the machine
     *     that spawned it."）；
     *   - MF_MONSTERS_DORMANT → toggleMonsterDormancy（:1655-1656），且
     *     **否定条件**（:1656-1659）：不带 MF_MONSTER_SLEEPING 且非盟友者，
     *     醒来时是 TRACKING_SCENT（web 的 HUNTING，Scent.ts:73 同款映射）而
     *     不是 sleeping——别漏掉这个"不是"。
     *   - MF_MONSTER_SLEEPING（:1648-1650）→ MONSTER_SLEEPING。
     */
    private finalizeBlueprintMonster(mon: Monster, spawn: MachineMonsterSpawn, machineNumber: number): void {
        mon.machineHome = machineNumber;
        // V-2b-7 重构为 CE :1648-1659 的**三条并列独立分支**（原实现是
        // dormant / 非 dormant 二分的嵌套 else-if，语义等价但形状不同）：
        //   :1648-1650 MF_MONSTER_SLEEPING → MONSTER_SLEEPING
        //   :1651-1654 MF_MONSTER_FLEEING  → MONSTER_FLEEING (+MODE_PERM_FLEEING)
        //   :1655-1659 MF_MONSTERS_DORMANT → toggleMonsterDormancy，且
        //              **否定条件**：不带 SLEEPING 且非盟友者醒来是
        //              TRACKING_SCENT（web 的 HUNTING）——"不是"这一半别漏。
        // 顺序即 CE 字面：dormant 分支在后，它的赋值会覆盖前面的 fleeing。
        // 行为等价性：既有数据无 fleeing，三条改成并列后与旧嵌套逐态同结果
        //（报告的对抗性要求 ① 对这条改写作了回答）。
        if (spawn.sleeping) {
            mon.state = MonsterState.ASLEEP; // CE MONSTER_SLEEPING（:1648-1650）
        }
        if (spawn.fleeing) {
            mon.state = MonsterState.FLEEING;
            mon.creatureMode = MonsterMode.PERM_FLEEING;
        }
        if (spawn.dormant) {
            this.toggleMonsterDormancy(mon);
            if (!spawn.sleeping && !mon.isAlly) {
                mon.state = MonsterState.HUNTING; // CE MONSTER_TRACKING_SCENT
            }
        }
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

            const hasLoot = cell?.isVisible
                ? this.items.some(i => i.loc.x === curr.x && i.loc.y === curr.y)
                : !!cell?.rememberedItem;
            const isPlayerOnLoot = (curr.x === this.player.loc.x && curr.y === this.player.loc.y);

            if (cell && (!cell.isExplored || (hasLoot && !isPlayerOnLoot))
                && (cell.isVisible ? cell.isPassable : cell.rememberedFlags?.passable ?? !cell.isExplored)) {
                target = curr;
                break;
            }

            const dirs: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];
            for (const d of dirs) {
                const nx = curr.x + d[0];
                const ny = curr.y + d[1];
                const nextCell = this.grid.getCell(nx, ny);
                if (nextCell && this.grid.isValidPos(nx, ny) &&
                    !(nextCell.isVisible ? nextCell.layers : nextCell.rememberedLayers).includes(TerrainType.WATER_DEEP) &&
                    (nextCell.isVisible ? nextCell.isPassable : nextCell.rememberedFlags?.passable ?? !nextCell.isExplored)) {
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
        if (this.pendingArcana) {
            if (this.setArcanaTarget(x, y)) this.confirmArcanaTarget();
            return;
        }
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

        this.travelTargetItem = this.grid.getCell(x, y)?.isVisible
            ? this.items.find(i => i.loc.x === x && i.loc.y === y) : undefined;

        this.setAutoPath(x, y);
    }

    private canMoveTo(x: number, y: number): boolean {
        if (!this.grid.isValidPos(x, y)) return false;
        const cell = this.grid.getCell(x, y);
        if (!cell) return false;

        // C-4a：查表口径——!(T_OBSTRUCTS_PASSABILITY | T_IS_DEEP_WATER)
        // （TerrainCatalog.ts，CE Rogue.h:1924/1937）。对全部 TerrainType 与
        // 旧硬编码清单 {GRANITE, WALL, SECRET_DOOR, LOCKED_DOOR, WATER_DEEP}
        // 逐位一致（c_4a_terrain_catalog.test.ts 的迁移安全性用例全枚举钉死）。
        // F-1：按 CE cellHasTerrainFlag 的四层并集口径逐层判定——火盖在水上
        // （SURFACE 层 PLAIN_FIRE）时有效地形不再是深水，跨层读才能保住
        // "深水不可走"（CE Movement 的判据本就是全层 OR）。
        return !cell.layers.some((t) => blocksPassability(t) || isDeepWater(t));
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
            // C-4a-0：按层直填还原（基线 cells 至多一层非空，与原 setTerrain
            // 逐位等价）；char/color/通行位照旧由基线值覆盖。
            const cell = this.grid.getCell(terrain.x, terrain.y);
            if (!cell) continue;
            cell.layers = [...terrain.layers];
            cell.char = terrain.char;
            cell.color = terrain.color;
            cell.isPassable = terrain.isPassable;
            cell.isOpaque = terrain.isOpaque;
            // F-2a：isBurning 是派生读数（基线无火 ⇒ 复位后恒 false），
            // 原直写三行（isBurning/burnDuration/burnTerrain）随倒计时模型退役。
            // G-1：气体的事实来源在 layers[GAS]+volume（gasGrid 只是镜像），
            // 清气必须清真相——旧写法（只清镜像）会让气在下一 updateGases
            // 全量重建镜像时复活。
            this.environment.clearGasAt(terrain.x, terrain.y);
        }

        for (const itemSnapshot of room.baselineItems) {
            this.items.push(this.deserializeItem(itemSnapshot));
        }
        for (const monsterSnapshot of room.baselineMonsters) {
            this.monsters.push(this.createMonsterFromSnapshot(monsterSnapshot));
        }
        this.restoreMonsterLeaders(room.baselineMonsters, this.monsters);

        logger.log(i18next.t('machine.reset_room'), '#88ccff');
        this.needsRender = true;
    }

    private handleSpecialTileEntry() {
        const cell = this.grid.getCell(this.player.loc.x, this.player.loc.y);
        if (!cell) return;

        // F-1：以下判定全部跨层——火盖在机关/陷阱上（SURFACE）时不吞掉
        // 踩上效果（CE 的 TM_PROMOTES_ON_* 触发同样逐层扫）。
        if (cell.layers.includes(TerrainType.SIGN)) {
            const text = this.signTexts.get(this.posKey(this.player.loc.x, this.player.loc.y));
            if (text) {
                logger.log(i18next.t('machine.sign', { text }), '#ffee88');
            }
        } else if (cell.layers.includes(TerrainType.RESET_PLATE)) {
            const roomId = this.resetPlateRoomByPos.get(this.posKey(this.player.loc.x, this.player.loc.y));
            if (typeof roomId === 'number') {
                this.resetTestRoom(roomId);
            }
        } else if (cell.layers.includes(TerrainType.TRAP)) {
            this.triggerTrap(this.player.loc.x, this.player.loc.y, cell);
        } else if (cell.layers.includes(TerrainType.PRESSURE_PLATE)) {
            this.triggerPressurePlate(this.player.loc.x, this.player.loc.y);
        }

        // P1-42：旧的"四邻接密门 30% 揭示"已删除——它是 web 自创的近似，
        // 与 CE 的 search() 机制（半径/距离衰减/阻挡折扣/可见性）二选一，
        // 不留两套。密门发现现由两处 CE 对齐入口驱动：
        //   1. 每步低强度自动搜索（playerTurnEnded，CE Time.c:2544-2549）；
        //   2. 主动搜索命令（handlePlayerAction 'search'，CE Time.c:2395-2430）。

        // CE player entry activates PLAYER_ENTRY layers (vines/repeating floor)
        // and creature/item step layers. A used machine plate has no step flags.
        promoteLayersWithMechFlag(this.grid, this.player.x, this.player.y, TM_PROMOTES_ON_PLAYER_ENTRY);
        const stepResults = promoteOnStep(this.grid, this.player.loc.x, this.player.loc.y);
        for (const r of stepResults) {
            if (r.mutated) this.needsRender = true;
        }
        this.clearDisplacedEntanglement(this.player);
        this.applyEntanglementFromTerrain(this.player);
    }

    /**
     * P1-42：CE search(searchStrength)（Movement.c:2459-2489）的移植。
     * 以玩家为心、radius = strength/10（整除）的方形区域逐格扫描：
     *   - 判据 playerCanDirectlySee（Rogue.h:1276 = pmap VISIBLE 位）——web
     *     对应物是 FOV（论证见 p1_42 报告：语义是"玩家当前所见"，与渲染/
     *     怪物侦测共用同一定义，不再造第二套 LOS）。实现走
     *     fov.computeFOVMask（局部阴影投射、遮挡谓词与 computeFOV/castLight
     *     同为 isOpaque、半径 10 与 update() 的 computeFOV(…,10) 同一视野
     *     半径）：a) CE 的 search 只"读"可见性、不制造它——computeFOV 会
     *     顺带写 isVisible/isExplored/hasMemory，那属渲染管线职权；
     *     b) 掩码只在窗内确有密格时才计算，回合期常态零开销；
     *     c) 扫描窗是切比雪夫方形、掩码是欧氏圆——终搜扫描半径 16 超过
     *     视野半径 10 的部分按 CE 语义本就不可直视、必被可见性闸门排除；
     *   - 命中率 = strength − 距离×10，距离是切比雪夫距离（CE
     *     distanceBetween，Monsters.c:1587-1589 = max(|dx|,|dy|)）；
     *   - 目标格带 T_OBSTRUCTS_PASSABILITY 时先 ×2/3（Movement.c:2470-2472，
     *     走 TerrainCatalog.blocksPassability 查表）；
     *   - percent ≥ 100 时 CE 还置 KNOWN_TO_BE_TRAP_FREE（:2473-2475）——web
     *     无"隐藏陷阱知识"设施（TRAP 恒可见），无处可接，登记不实现；
     *   - 搜索当前已闭合的密门、陷门、墙杆、三种喷口和毒气/火焰陷阱；其余隐藏载体的
     *     显形链仍登记在 DF_MISSING_TILES，后续族接线前不伪造发现。
     *   - rand_percent 语义与 web randPercent 逐位一致（先抽
     *     rand_range(0,99) 再 clamp 比较，CE Math.c:62-65）——**percent ≤ 0
     *     也消耗一次抽取**，不可"剪枝跳过"，否则 RNG 流位移。
     *
     * 返回是否发现了什么（CE 返回值；当前无消费者，留作对齐）。
     */
    private searchForSecrets(searchStrength: number): boolean {
        // 每层一次的全格预扫守卫：无已支持密格的层零开销短路（见字段注记）。
        if (this.secretScanDepth !== this.depth) {
            this.levelHasSecrets = false;
            for (let x = 0; x < this.grid.width && !this.levelHasSecrets; x++) {
                for (let y = 0; y < this.grid.height; y++) {
                    if (this.grid.getCell(x, y)?.layers.some(t => t === TerrainType.SECRET_DOOR || t === TerrainType.TRAP_DOOR_HIDDEN || t === TerrainType.WALL_LEVER_HIDDEN || t === TerrainType.MACHINE_METHANE_VENT_HIDDEN || t === TerrainType.MACHINE_PARALYSIS_VENT_HIDDEN || t === TerrainType.MACHINE_POISON_GAS_VENT_HIDDEN || t === TerrainType.GAS_TRAP_POISON_HIDDEN || t === TerrainType.FLAMETHROWER_HIDDEN)) { // F-1 跨层判定
                        this.levelHasSecrets = true;
                        break;
                    }
                }
            }
            this.secretScanDepth = this.depth;
        }
        if (!this.levelHasSecrets) return false;

        const radius = Math.floor(searchStrength / 10);
        const px = this.player.loc.x;
        const py = this.player.loc.y;

        // 行主序收集扫描窗内的密格（CE :2466-2468 的双层 for 顺序）。
        // 窗内没有密格时连视野掩码都不必算——CE 的 search 对非密格零掷骰，
        // 这里同样零消耗，回合期常态开销只是一次窗口扫描。
        const secretCells: Array<{ x: number; y: number; cell: import('../Map/Grid').Cell }> = [];
        for (let i = px - radius; i <= px + radius; i++) {
            for (let j = py - radius; j <= py + radius; j++) {
                const cell = this.grid.getCell(i, j);
                if (cell && cell.layers.some(t => t === TerrainType.SECRET_DOOR || t === TerrainType.TRAP_DOOR_HIDDEN || t === TerrainType.WALL_LEVER_HIDDEN || t === TerrainType.MACHINE_METHANE_VENT_HIDDEN || t === TerrainType.MACHINE_PARALYSIS_VENT_HIDDEN || t === TerrainType.MACHINE_POISON_GAS_VENT_HIDDEN || t === TerrainType.GAS_TRAP_POISON_HIDDEN || t === TerrainType.FLAMETHROWER_HIDDEN)) { // F-1 跨层判定
                    secretCells.push({ x: i, y: j, cell });
                }
            }
        }
        if (secretCells.length === 0) return false;

        // CE 的 VISIBLE 旗标由显示管线每回合刷新到玩家当前位置
        // （updateVision，Time.c:859）；web 的 isVisible 刷新是惰性的
        // （update() 渲染前才重算），headless 推进走到这里时可能还是上一步
        // 的旧图——所以以"当前现算的掩码"为准，而不是读 cell.isVisible。
        // 掩码半径恒为 10（与 update() 的 computeFOV(…,10) 同一视野半径）：
        // 扫描窗是切比雪夫方形而掩码是欧氏圆，半径 3/6/16 的"缩水掩码"
        // 会把窗角上欧氏距离超界的格错判为不可见（A4 曾真实抓红）；
        // 终搜扫描半径 16 超过 10 的部分按 CE 语义本就不可直视。
        // 遮挡谓词与 FOV.castLight 同为 isOpaque。掩码只在窗内确有密格时
        // 才计算（上方守卫），回合期常态零开销。
        const canDirectlySee = this.fov.computeFOVMask(px, py, 10, (c) => c.isOpaque);

        let foundSomething = false;
        for (const { x, y, cell } of secretCells) {
            if (!canDirectlySee[x]?.[y]) continue; // CE playerCanDirectlySee 先于掷骰
            let percent = searchStrength
                - Math.max(Math.abs(x - px), Math.abs(y - py)) * 10;
            if (blocksPassability(cell.terrain)) {
                percent = (percent * 2) / 3;
            }
            percent = Math.min(percent, 100);
            if (rng.randPercent(percent)) {
                this.discoverSecretAt(x, y);
                foundSomething = true;
            }
        }
        return foundSomething;
    }

    /** CE discovery shares DF laying, refresh, description and flare effects. */
    private discoverSecretAt(x: number, y: number): boolean {
        const cell = this.grid.getCell(x, y);
        if (!cell) return false;
        const wasDoor = cell.layers.includes(TerrainType.SECRET_DOOR);
        if (!discoverTerrain(this.grid, x, y)) return false;
        cell.isDiscovered = true;
        if (wasDoor) logger.log(i18next.t('trap.secret_door_found', { defaultValue: 'You discovered a hidden door!' }), '#ffff88');
        this.needsRender = true;
        return true;
    }

    /**
     * P1-42：CE manualSearch（Time.c:2395-2430）——主动搜索命令。
     * 连续回合充能（<5 时强度 60/30，第 5 连搜做一次 160 的终搜并归零），
     * 不弱于当前被动搜索（Time.c:2427 max(...)），收尾照 rest 分支口径
     * 耗 movementSpeed 并 playerTurnEnded。
     */
    private manualSearch(): void {
        if (this.searchingCharge <= 0) {
            this.searchingCharge = 0;
        }
        this.searchingCharge += 1;

        let searchStrength: number;
        if (this.searchingCharge < 5) {
            searchStrength = this.awarenessBonus() >= 0 ? 60 : 30;
        } else {
            searchStrength = 160;
            logger.log(
                i18next.t('search.detailed_finished', { defaultValue: 'You finish your detailed search of the area.' }),
                '#cccccc'
            );
            this.searchingCharge = 0;
        }

        // CE Time.c:2427：主动搜索不弱于当前被动搜索。
        this.searchForSecrets(Math.max(searchStrength, this.awarenessBonus() + 30));

        this.justSearched = true;
        timeSystem.currentTick += this.player.movementSpeed;
        this.playerTurnEnded();
    }

    /** Trigger a trap at (x, y). Converts it to FLOOR after triggering. */
    private triggerTrap(x: number, y: number, cell: import('../Map/Grid').Cell, target: Creature = this.player) {
        switch (cell.trapType) {
            case 'poison_gas':
                logger.log(i18next.t('trap.poison_gas', { defaultValue: 'You step on a poison gas trap! Toxic fumes billow out!' }), '#88ff88');
                // G-1 折算：80 → 1000 = DF_POISON_GAS_CLOUD 的 startProbability
                // （Globals.c:770，毒气陷阱的原生 DF；接线本身归 G-2）。
                this.environment.addGas(x, y, GasType.POISON, 1000);
                break;
            case 'teleport':
                logger.log(i18next.t('trap.teleport', { defaultValue: 'You step on a teleport trap! You are whisked away!' }), '#ff88ff');
                this.teleportCreature(target);
                break;
            case 'fire':
                logger.log(i18next.t('trap.fire', { defaultValue: 'You step on a fire trap!' }), '#ff6600');
                // F-2a：CE 火焰喷射陷阱是 DF 生成家族（DF_FLAMETHROWER
                // {PLAIN_FIRE, SURFACE, 100, 37}，Globals.c:746），走 igniteForced。
                this.environment.igniteForced(x, y);
                this.environment.igniteForced(x + 1, y);
                this.environment.igniteForced(x - 1, y);
                this.environment.igniteForced(x, y + 1);
                this.environment.igniteForced(x, y - 1);
                break;
        }
        // One-time use: convert to floor
        // W-11: consume only the trap layer; keep the gas/fire just emitted.
        consumeTrapTile(this.grid, x, y, TerrainType.CHARRED_FLOOR);
        cell.char = '.';
        cell.color = 0x554433;
        this.needsRender = true;
    }

    /** CE Time.c:240-274: machine pressure plates promote and power their
     * machine; spatially nearby traps with another machine number are unrelated. */
    private triggerPressurePlate(px: number, py: number, _target: Creature = this.player) {
        logger.log(i18next.t('trap.pressure_plate', { defaultValue: 'A pressure plate clicks!' }), '#ffcc44');
        triggerCreatureTrapLayers(this.grid, px, py);
        this.needsRender = true;
    }

    /** CE Items.c:5516-5555. Both forward blink and beckoning commit through
     * W-11's placement primitive, including hazards, vision and player pickup.
     * Disentangle before landing contact, which may catch the caster in a new web.
     * SEIZED is not a synonym for CE STATUS_STUCK.
     */
    private finishBlink(result: BoltResult): boolean {
        const caster = result.caster, landing = result.landingPos;
        if (!caster || !landing || !this.canDisplaceCreature(caster, landing)) return false;
        caster.setStatusDuration('stuck', 0); // CE disentangle, before landing contact
        return this.placeCreature(caster, landing, { pickupBeforeVision: true });
    }

    /** CE Items.c:5076-5089,5228-5239: the target becomes a blink caster.
     * The eligibility gate precedes release, tracing and the minimum wait;
     * autoID depends on visibility, even if an obstacle prevents movement.
     * Monster BECKONING deliberately shares this implementation (W-12).
     */
    private beckonCreature(target: Creature, caster: Creature | null): boolean {
        if (!caster || target.hp <= 0 || (target instanceof Monster && target.hasBehavior('MONST_IMMOBILE'))) return false;
        const distance = Math.max(Math.abs(target.loc.x - caster.loc.x), Math.abs(target.loc.y - caster.loc.y));
        if (distance <= 1) return false;
        const seenBefore = this.canObserveBoltTarget(target);
        if (target instanceof Monster && target.isCaged) this.freeCaptive(target);
        const blink: BoltConfig = {
            id: 'beckoning_blink', name: '', ceType: CEBoltType.BLINKING, effect: BoltEffect.BLINKING,
            magnitude: Math.max(1, Math.trunc((distance - 2) / 2)),
            char: target.char, color: 0xffffff, maxRange: 0, piercing: false, selfTargeting: false,
        };
        const result = traceBolt(this.grid, blink, target.loc, caster.loc, this.boltWorld(target), undefined, { reverseBlink: true });
        this.finishBlink(result);
        target.ticksUntilTurn = Math.max(target.ticksUntilTurn, this.player.attackSpeed + 1);
        return seenBefore || this.canObserveBoltTarget(target);
    }

    /** CE setMonsterLocation (Monsters.c:3684-3715), safe commit for W-12.
     * No random search, immunity policy, captive release, attack or time cost.
     * A failed commit has no side effects. Hazards are legal here; only physical
     * obstruction/occupancy are rejected. Coordinates remain the occupancy source.
     */
    private canDisplaceCreature(target: Creature, destination: Pos, walkingSecretDoor = false): boolean {
        return target.hp > 0 && (target.x !== destination.x || target.y !== destination.y)
            && canPlaceCreature(this, target, destination, walkingSecretDoor);
    }

    public placeCreature(target: Creature, destination: Pos, options: { pickupBeforeVision?: boolean; walkingSecretDoor?: boolean } = {}): boolean {
        if (!this.canDisplaceCreature(target, destination, options.walkingSecretDoor)) return false;
        if (options.walkingSecretDoor && this.grid.getCell(destination.x, destination.y)?.isVisible) {
            this.discoverSecretAt(destination.x, destination.y);
        }
        target.loc.x = destination.x;
        target.loc.y = destination.y;
        this.needsRender = true;
        this.applyEnvironmentalEffects(target);
        const pickUp = () => {
            if (target === this.player && target.hp > 0 && !this.isGameOver) this.pickUpItemAfterDisplacement();
        };
        // CE teleport (Monsters.c:3709) sees before pickup; blink
        // (Items.c:5548-5551) sees after pickup and its terrain promotions.
        if (options.pickupBeforeVision) pickUp();
        // Visibility must reflect the committed location before the caller returns.
        // Also refresh after moving a luminous monster or triggering a terrain DF.
        this.updateVision();
        if (!options.pickupBeforeVision) pickUp();
        return true;
    }

    /** CE teleport(..., INVALID_POS, false); no fallback after the final filter. */
    private teleportCreature(target: Creature): boolean {
        const candidates = teleportCandidates({ grid: this.grid, player: this.player, monsters: this.monsters, dormantMonsters: this.dormantMonsters }, target);
        if (candidates.length === 0) return false;
        const destination = candidates[rng.randRange(0, candidates.length - 1)]!;
        if (!this.canDisplaceCreature(target, destination)) return false;
        target.setStatusDuration('stuck', 0); // CE teleport: release before setMonsterLocation
        if (!this.placeCreature(target, destination)) return false;
        // SEIZED/SEIZING are deliberately retained, as in CE teleport.
        if (target instanceof Monster && this.waypoints) {
            this.waypoints.chooseNewWanderDestination(target, this.wpContext());
        }
        return true;
    }

    /** CE Monsters.c:4103-4157. Shared by W-17 conversion and ONLY the
     * captive branch of W-19; unAlly itself does not call this. */
    private demoteMonsterFromLeadership(monster: Monster): void {
        let replacement: Monster | null = null;
        // Revisited levels retain a cached array until the next departure; it
        // can contain already removed entities. The live current lists win.
        const levels = [...(this.levels?.entries() ?? [])].filter(([depth]) => depth !== this.depth)
            .sort(([a], [b]) => a - b).map(([, level]) => level);
        // CE elects across active lists first, current level preferred. Dormant
        // followers are detached in a separate pass, never elected/reparented.
        const active = new Set([...(this.monsters ?? []), ...levels.flatMap(level => level.monsters)]);
        const dormant = new Set([...(this.dormantMonsters ?? []), ...levels.flatMap(level => level.dormantMonsters ?? [])]);
        for (const follower of active) {
            if (follower === monster || follower.hp <= 0 || follower.leader !== monster) continue;
            if (follower.boundToLeader || follower.isDormant || dormant.has(follower)) follower.leader = null;
            else if (!replacement) { replacement = follower; follower.leader = null; follower.leaderlessAfterDemotion = true; }
            else {
                follower.leader = replacement;
                follower.targetWaypointIndex = monster.targetWaypointIndex;
                if (follower.targetWaypointIndex >= 0 && follower.waypointAlreadyVisited) {
                    follower.waypointAlreadyVisited[follower.targetWaypointIndex] = false;
                }
            }
        }
        for (const follower of dormant) if (follower !== monster && follower.leader === monster) follower.leader = null;
    }

    /** CE Movement.c:728-742. Shared by domination and W-11 magical rescue;
     * ordinary key/cage rescue keeps its existing V-2b-5 entry point. */
    public becomeAllyWith(monster: Monster): void {
        this.demoteMonsterFromLeadership(monster);
        if (monster.carriedItem) {
            const candidates = captiveItemDropCandidates(this, monster.loc, this.items);
            // CE placeItemAt(INVALID_POS) uses randomMatchingLocation as a final
            // item-only fallback. This must never be used for CREATURE placement.
            const drop = candidates.length ? candidates[rng.randRange(0, candidates.length - 1)]!
                : randomMatchingLocation(this.grid, {
                    dungeonType: TerrainType.FLOOR, liquidType: TerrainType.NOTHING,
                    isOccupied: (x, y) => !!this.getMonsterAt(x, y)
                        || (this.player.loc.x === x && this.player.loc.y === y)
                        || this.items.some(item => item.loc.x === x && item.loc.y === y)
                        || !!this.grid.getCell(x, y)?.layers.some(t => t === TerrainType.STAIRS_UP || t === TerrainType.STAIRS_DOWN || t === TerrainType.DUNGEON_PORTAL),
                    isMachineCell: (x, y) => (this.grid.getCell(x, y)?.machineNumber ?? 0) !== 0,
                });
            // Pathological all-blocked item maps retain the item safely; CE's
            // subsequent placeItemAt(-1,-1) has no defined safe placement there.
            if (drop) {
                monster.carriedItem.loc = { ...drop };
                this.items.push(monster.carriedItem);
                monster.carriedItem = null;
                promoteOnItemPlaced(this.grid, drop.x, drop.y);
            }
        }

        monster.isCaged = false;
        monster.isAlly = true;
        monster.leader = null;
        monster.leaderlessAfterDemotion = false;
        monster.seized = false;
        monster.state = MonsterState.WANDERING; // isAlly is web's MONSTER_ALLY state.
        this.needsRender = true;
    }

    public freeCaptive(monster: Monster): void {
        if (!monster.isCaged) return;
        this.becomeAllyWith(monster);
        logger.log(i18next.t('monster.freed', {
            monster: this.monsterDisplayName(monster),
            defaultValue: `The ${this.monsterDisplayName(monster)} is grateful for its freedom and joins you!`
        }), '#88ff88');
        this.needsRender = true;
    }

    /** Entry promotions/traps only; periodic damage remains in objective time. */
    private applyDisplacementTileEntry(target: Creature): void {
        const { x, y } = target.loc;
        const cell = this.grid.getCell(x, y)!;
        if (!target.hasStatus('levitating')) {
            if (cell.layers.includes(TerrainType.TRAP)) this.triggerTrap(x, y, cell, target);
            else if (cell.layers.includes(TerrainType.PRESSURE_PLATE)) this.triggerPressurePlate(x, y, target);
            else if ((cellTerrainFlags(this.grid, x, y) & T_IS_DF_TRAP)
                && !(target instanceof Monster && target.hasBehavior('MONST_SUBMERGES')
                    && (cellTerrainMechFlags(this.grid, x, y) & TM_ALLOWS_SUBMERGING))) {
                // CE Time.c:240-274: per-cell depression -> fire DF -> normal
                // promotion/wiring. Existing CE traps are not the legacy TRAP id.
                const byGrid = this.displacementTrapDepressions ??= new WeakMap();
                let depressed = byGrid.get(this.grid);
                if (!depressed) { depressed = new Set(); byGrid.set(this.grid, depressed); }
                const key = y * this.grid.width + x;
                if (!depressed.has(key)) {
                    depressed.add(key);
                    // CE Time.c:249: visible hidden plates are discovered before
                    // their fire DF. Depression precedes the recursive DF refresh.
                    if (cell.isVisible && (cellTerrainMechFlags(this.grid, x, y) & TM_IS_SECRET)) {
                        this.discoverSecretAt(x, y);
                    }
                    triggerCreatureTrapLayers(this.grid, x, y);
                }
            }
        }
        // A nested teleport already handled its own destination entry.
        if (target.loc.x !== x || target.loc.y !== y) return;
        const mask = TM_PROMOTES_ON_CREATURE | (target === this.player ? TM_PROMOTES_ON_PLAYER_ENTRY : 0);
        promoteLayersWithMechFlag(this.grid, target.loc.x, target.loc.y, mask);
    }

    /** CE setMonsterLocation picks up without a second player action/turn. */
    private pickUpItemAfterDisplacement(): void {
        const index = this.items.findIndex(item => item.loc.x === this.player.loc.x && item.loc.y === this.player.loc.y);
        if (index < 0) return;
        const item = this.items[index]!;
        // CE Items.c:865-888: gold bypasses pack capacity and is currency,
        // never an inventory entry. W-11's ordinary-item pickup test missed it.
        if (item.category === ItemCategory.GOLD) this.stats.gold += item.quantity;
        else if (!this.player.inventory.addItem(item)) return;
        this.items.splice(index, 1);
        promoteOnItemPickup(this.grid, this.player.loc.x, this.player.loc.y);
        logger.log(i18next.t('item.pickup', { name: item.displayName, defaultValue: `You picked up ${item.displayName}.` }), '#ffffff');
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
            case TerrainType.ALTAR_CAGE_CLOSED: return i18next.t('terrain.altar_cage_closed', { defaultValue: '铁笼祭坛' });
            case TerrainType.COMMUTATION_ALTAR: return i18next.t('terrain.commutation_altar', { defaultValue: '置换祭坛' });
            case TerrainType.COMMUTATION_ALTAR_INERT: return i18next.t('terrain.commutation_inert', { defaultValue: '烧焦的置换祭坛' });
            case TerrainType.RESURRECTION_ALTAR: return i18next.t('terrain.resurrection_altar', { defaultValue: '复活祭坛' });
            case TerrainType.RESURRECTION_ALTAR_INERT: return i18next.t('terrain.resurrection_inert', { defaultValue: '烧焦的复活祭坛' });
            case TerrainType.PIPE_GLOWING: return i18next.t('terrain.pipe_glowing', { defaultValue: '发光的玻璃管道' });
            case TerrainType.PIPE_INERT: return i18next.t('terrain.pipe_inert', { defaultValue: '烧焦的玻璃管道' });
            case TerrainType.SACRIFICE_ALTAR: return i18next.t('terrain.sacrifice_altar', { defaultValue: '献祭祭坛' });
            case TerrainType.SACRIFICE_ALTAR_DORMANT: return i18next.t('terrain.sacrifice_dormant', { defaultValue: '休眠的献祭祭坛' });
            case TerrainType.SACRIFICE_LAVA: return i18next.t('terrain.sacrifice_lava', { defaultValue: '献祭熔岩坑' });
            case TerrainType.RAT_TRAP_WALL_CRACKING: return i18next.t('terrain.rat_trap_wall_cracking', { defaultValue: '开裂的鼠陷阱墙' });
            case TerrainType.STATUE_CRACKING: return i18next.t('terrain.statue_cracking', { defaultValue: '开裂的雕像' });
            case TerrainType.COFFIN_OPEN: return i18next.t('terrain.coffin_open', { defaultValue: '空棺木' });
            case TerrainType.WORM_TUNNEL_MARKER_ACTIVE: return i18next.t('terrain.worm_tunnel_marker_active', { defaultValue: '开裂的花岗岩墙' });
            case TerrainType.PORTAL_LIGHT: return i18next.t('terrain.portal_light', { defaultValue: '耀眼的光芒' });

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
            case TerrainType.DUNGEON_PORTAL:
                return i18next.t('terrain.crystal_portal', { defaultValue: '水晶传送门' });
            case TerrainType.STAIRS_DOWN:
                return i18next.t('terrain.stairs_down', { defaultValue: '下行楼梯' });
            case TerrainType.MACHINE_METHANE_VENT_DORMANT:
            case TerrainType.MACHINE_POISON_GAS_VENT_DORMANT:
            case TerrainType.MACHINE_PARALYSIS_VENT:
                return i18next.t('terrain.inactive_gas_vent', { defaultValue: 'An inactive gas vent' });
            case TerrainType.MACHINE_METHANE_VENT:
            case TerrainType.MACHINE_POISON_GAS_VENT:
                return i18next.t('terrain.gas_vent', { defaultValue: 'A gas vent' });
            case TerrainType.PILOT_LIGHT:
                return i18next.t('terrain.fallen_torch', { defaultValue: 'A fallen torch' });
            case TerrainType.PILOT_LIGHT_DORMANT:
                return i18next.t('terrain.wall_torch', { defaultValue: 'A wall-mounted torch' });
            case TerrainType.GAS_TRAP_POISON:
                return i18next.t('terrain.poison_gas_trap', { defaultValue: 'A caustic gas trap' });
            case TerrainType.FLAMETHROWER:
                return i18next.t('terrain.fire_trap', { defaultValue: 'A fire trap' });
            case TerrainType.MACHINE_METHANE_VENT_HIDDEN:
            case TerrainType.MACHINE_POISON_GAS_VENT_HIDDEN:
            case TerrainType.MACHINE_PARALYSIS_VENT_HIDDEN:
            case TerrainType.GAS_TRAP_POISON_HIDDEN:
            case TerrainType.FLAMETHROWER_HIDDEN:
                return i18next.t('terrain.floor', { defaultValue: '地板' });
            case TerrainType.MACHINE_PRESSURE_PLATE_USED:
                return i18next.t('terrain.pressure_plate_used', { defaultValue: 'An inactive pressure plate' });
            case TerrainType.TRAP_DOOR:
                return i18next.t('terrain.trap_door', { defaultValue: 'A hole' });
            case TerrainType.WALL_LEVER:
                return i18next.t('terrain.wall_lever', { defaultValue: 'A lever' });
            case TerrainType.WALL_LEVER_PULLED:
                return i18next.t('terrain.wall_lever_pulled', { defaultValue: 'An inactive lever' });
            case TerrainType.WALL_LEVER_HIDDEN:
                return i18next.t('terrain.wall', { defaultValue: '墙壁' });
            case TerrainType.MACHINE_TRIGGER_FLOOR_REPEATING:
            case TerrainType.TRAP_DOOR_HIDDEN:
                return i18next.t('terrain.floor', { defaultValue: '地板' });
            case TerrainType.TRAMPLED_FOLIAGE:
                return i18next.t('terrain.trampled_foliage', { defaultValue: 'Trampled foliage' });
            case TerrainType.ACTIVE_BRIMSTONE:
                return i18next.t('terrain.active_brimstone', { defaultValue: 'Hissing brimstone' });
            case TerrainType.INERT_BRIMSTONE:
                return i18next.t('terrain.inert_brimstone', { defaultValue: 'Hissing brimstone' });
            case TerrainType.BRIMSTONE_FIRE:
                return i18next.t('terrain.brimstone_fire', { defaultValue: 'Sulfurous flames' });
            case TerrainType.OPEN_IRON_DOOR_INERT:
                return i18next.t('terrain.open_iron_door_inert', { defaultValue: 'An open iron door' });
            case TerrainType.BRIDGE_FALLING:
                return i18next.t('terrain.bridge_falling', { defaultValue: 'A plummeting bridge' });
            case TerrainType.ITEM_FIRE:
                return i18next.t('terrain.item_fire', { defaultValue: 'Crackling flames' });
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
            case TerrainType.ANCIENT_SPIRIT_VINES:
                return 'thorned vines';
            case TerrainType.ANCIENT_SPIRIT_GRASS:
                return 'a tuft of grass';
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

        const sensedMonster = this.getMonsterAt(x, y);
        if (!cell || (!cell.hasMemory && !cell.isMagicMapped && !cell.isVisible
            && !(sensedMonster && canDisplayMonster(this.player, this.grid, sensedMonster)))) {
            this.hoveredText = i18next.t('hover.unknown', { defaultValue: '未知' });
            return;
        }

        const entities: string[] = [];

        // Check monster
        const m = this.getMonsterAt(x, y);
        if (m && canSeeMonster(this.player, this.grid, m)) {
            const label = m.displaysNegation && !this.player.hasStatus('hallucinating')
                ? i18next.t('negation.label', { defaultValue: 'Negated' }) : '';
            entities.push(label ? `${m.name} (${label})` : m.name);
        } else if (m && canDisplayMonster(this.player, this.grid, m)) {
            entities.push('x');
        }

        // Check items
        if (cell.isVisible) {
            this.items.filter(i => i.loc.x === x && i.loc.y === y)
                .forEach(i => entities.push(i.displayName));
        } else if (cell.hasMemory && cell.rememberedItem) {
            entities.push(cell.rememberedItem.name);
        }

        // Check player
        if (this.player.loc.x === x && this.player.loc.y === y && cell.isVisible) {
            entities.push(i18next.t('hover.you', { defaultValue: '你' }));
        }

        // CE IO.c:1278-1281 draws only the location marker on undiscovered cells.
        if (!cell.isVisible && !cell.hasMemory && !cell.isMagicMapped) {
            this.hoveredText = entities.join('、');
            return;
        }

        const separator = i18next.t('hover.separator', { defaultValue: '、' });
        // G-1：hover 的地形名优先取 GAS 层（CE tileText/tileFlavor 走
        // highestPriorityLayer(x,y,false)——含气层，Movement.c:106/113；
        // 站进毒气时 CE 悬浮提示显示"a cloud of caustic gas"）。
        // terrain getter 本身固定 skipGas（Grid.ts G-1 注：玩法读者走旗标
        // 并集世界），显示侧的气体偏好在这里补。
        const knownLayers = cell.isVisible ? cell.layers : cell.rememberedLayers;
        const gasTile = knownLayers[DungeonLayer.GAS] ?? TerrainType.NOTHING;
        const tName = this.getTerrainName(
            gasTile !== TerrainType.NOTHING ? gasTile
                : cell.isVisible ? cell.terrain : cell.rememberedTerrain
        );

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

        if (!cell.isVisible && (cell.hasMemory || cell.isMagicMapped)) {
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

        if (knownLayers.includes(TerrainType.SIGN)) {
            const signText = this.signTexts.get(this.posKey(x, y));
            if (signText) {
                this.hoveredText = `${this.hoveredText} ${signText}`;
            }
        }
    }

    public setAutoPath(x: number, y: number) {
        const knownPassable = (px: number, py: number): boolean => {
            const cell = this.grid.getCell(px, py);
            if (!cell) return false;
            if (cell.isVisible) return this.canMoveTo(px, py);
            if (cell.hasMemory || cell.isMagicMapped) {
                return !cell.rememberedLayers.some(t => blocksPassability(t) || isDeepWater(t));
            }
            return true; // An unknown frontier has no known obstruction.
        };
        const path = Pathfind.findPath(this.grid, this.player.loc.x, this.player.loc.y, x, y, knownPassable);
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
        const logStep = this.recordingFromNewGame && !this.replayRecording;
        const previousDecisions = this.commandDecisions;
        const decisions: boolean[] = [];
        if (logStep) this.commandDecisions = decisions;

        // P2-4：本步连同其触发的攻击/拾取/回合结算一律按自动行进口径处理
        // （playerTurnEnded 同步推进、不暂停、不加锁）。try/finally 保证
        // 异常路径也复位。
        this.inAutoTravelStep = true;
        try {
            this.stepAutoPathInner();
        } finally {
            this.inAutoTravelStep = false;
            this.commandDecisions = previousDecisions;
            if (logStep) this.recordInputEvent('auto_step', undefined, decisions);
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
                    logger.log(i18next.t('explore.spot_monster_stop_exploring', { name: this.monsterDisplayName(m), defaultValue: `You spot a ${this.monsterDisplayName(m)} and stop exploring.` }), '#ffaaaa');
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
            logger.log(i18next.t('move.path_blocked', { defaultValue: 'Path blocked.' }), '#ffaa88');
            this.needsRender = true;
            return;
        }

        // W-18: confused travel must use the same randomized direction as a key
        // press, and stop the stale planned path after that committed action.
        if (this.player.hasStatus('confused')) {
            this.handlePlayerAction('move', { x: next.x-this.player.loc.x, y: next.y-this.player.loc.y }, 'system');
            return;
        }
        this.autoPath.shift();
        const dx = next.x-this.player.loc.x, dy = next.y-this.player.loc.y;

        // Move
        this.player.loc.x = next.x;
        this.player.loc.y = next.y;
        this.moveEntrancedMonsters(dx, dy);
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

    public triggerGameOver(won: boolean, reason?: string, superVictory: boolean = false) {
        if (this.isGameOver) return;
        this.isGameOver = true;
        this.gameOverWon = won;
        this.gameOverSuperVictory = won && superVictory;
        const deathReason = reason || i18next.t('death.unknown', { defaultValue: 'Killed by unknown causes.' });
        this.gameOverReason = won
            ? i18next.t(superVictory ? 'endgame.mastered' : 'endgame.escaped', {
                defaultValue: superVictory ? 'Mastered the Dungeons of Doom!' : 'Escaped the Dungeons of Doom!'
            })
            : i18next.t('death.on_depth', {
                reason: deathReason.replace(/[.!。]+$/, ''), depth: this.depth,
                defaultValue: '{{reason}} on depth {{depth}}.'
            });
        this.recordedInputIndex = this.recordedInputEvents.length;

        // Capture inventory for end screen
        this.gameOverInventory = this.player.inventory.items.map(item => ({
            name: item.displayName,
            category: item.category,
            enchantment: item.enchantment,
            color: item.color
        }));

        const items = this.player.inventory.items;
        this.gameOverScore = endgameScore(this.stats.gold, items, won, this.gameOverSuperVictory, this.mode === 'easy');
        const gems = lumenstoneCount(items);
        const description = won
            ? i18next.t(gems === 0 ? 'endgame.score_escaped' : gems === 1 ? 'endgame.score_one_gem' : 'endgame.score_many_gems', {
                verb: superVictory ? i18next.t('endgame.mastered_verb', { defaultValue: 'Mastered' })
                    : i18next.t('endgame.escaped_verb', { defaultValue: 'Escaped' }),
                count: gems,
                defaultValue: gems === 0 ? '{{verb}} the Dungeons of Doom!'
                    : gems === 1 ? '{{verb}} the Dungeons of Doom with a lumenstone!'
                        : '{{verb}} the Dungeons of Doom with {{count}} lumenstones!'
            })
            : this.gameOverReason;
        if (!this.replayRecording && (!won || this.mode !== 'wizard')) {
            saveHighScore(this.gameOverScore, description);
        }

        this.needsRender = true;
    }
}

export const activeGame = new Game();
// @ts-ignore - Expose for testing/debugging
if (typeof window !== 'undefined') window.activeGame = activeGame;
