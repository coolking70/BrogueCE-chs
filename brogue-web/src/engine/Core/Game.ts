/**
 * src/engine/Core/Game.ts
 * Main game state and orchestration
 */
import { Grid, TerrainType, DCOLS, DROWS, DungeonLayer, type Cell } from '../Map/Grid';
import { blocksPassability, blocksVision, isDeepWater, isAutoDescent, TERRAIN_FLAGS, T_IS_FIRE, T_CAUSES_CONFUSION, T_CAUSES_DAMAGE, T_CAUSES_PARALYSIS, T_CAUSES_EXPLOSIVE_DAMAGE, T_RESPIRATION_IMMUNITIES, TM_EXTINGUISHES_FIRE, T_AUTO_DESCENT, T_ENTANGLES, T_IS_DEEP_WATER, T_PATHING_BLOCKER, T_OBSTRUCTS_PASSABILITY, T_OBSTRUCTS_VISION, T_OBSTRUCTS_ITEMS, TM_IS_SECRET, TM_ALLOWS_SUBMERGING, TM_PROMOTES_ON_PLAYER_ENTRY, TM_PROMOTES_ON_CREATURE, T_IS_DF_TRAP } from '../Map/TerrainCatalog';
import { isPathingBlocker } from '../Map/TerrainCatalog';
// B-4b：物品落位热力图与食物落位原语（CE Items.c:463-535 / Architect.c:171,3822）
import { ItemSpawnHeatMap, passableArcCount, randomMatchingLocation } from '../Items/ItemSpawnHeatMap';
import { cellTerrainMechFlags, cellTerrainFlags, catalogFeature, setDormantAwakener, spawnDungeonFeature } from '../Map/DungeonFeature';
import { DF, DUNGEON_FEATURE_CATALOG } from '../Map/DungeonFeatureCatalog';
import { Architect } from '../Generator/Architect';
// V-1c：奖励房配额计数器是 CE rogue.rewardRoomsGenerated 的 web 载体——
// run 级全局，开局清零（RogueMain.c:292 等价）并随存档往返（见快照字段注）。
import {
    getRewardRoomsGenerated,
    setRewardRoomsGenerated,
    resetRewardRoomsGenerated,
    type MachineMonsterSpawn,
    type MachineResult
} from '../Generator/BlueprintEngine';
import blueprintData from '../../data/blueprints.json';
import { Player, type HungerState } from '../../entities/Player';
import { Monster, monstersAreTeammates, monstersAreEnemies } from '../../entities/Monster';
import { CombatSystem } from '../Combat/Combat';
import { staffPoison } from '../Combat/Poison';
import { staffProtection } from '../Combat/Shielding';
import { staffBladeCount, bladeSpawnLocation } from '../Combat/Conjuration';
import { weaponParalysisDuration, weaponConfusionDuration, weaponForceDistance, netEnchant, armorAbsorptionMax, armorReprisalPercent } from '../Combat/CombatFormulas';
import { ItemCategory, Item } from '../Items/Item';
import { ItemLoader, type ConsumableConfig } from '../Items/ItemLoader';
import { restoreArcanaInstance } from '../Items/ArcanaInstance';
import { canEnchantArcana, enchantArcana } from '../Items/ArcanaEnchantment';
import { equippedWisdomBonus, tickStaffRecharge, rechargeStaffFully, restoreStaffRecharge } from '../Items/ArcanaRecharge';
import { rng } from '../Random';
import monsterData from '../../data/monsters.json';
import hordeData from '../../data/hordes.json';
import mutationData from '../../data/mutations.json';
import type { MonsterData, MonsterAbility, MutationData } from '../../entities/Monster';
import { MonsterState } from '../../entities/Monster';
import { Direction, type Pos } from '../../types';
import { ensureEntityIdAbove, allocateEntityId, type StatusId, type Creature } from '../../entities/Creature';
import { timeSystem } from '../Systems/Time';
import { generateMonsterDetail, generateItemDetail, type DetailInfo } from '../UI/DetailGenerator';
import { logger } from '../Systems/Logger';
import { Pathfind } from '../Map/Pathfind';
import { DijkstraMap, MAX_DISTANCE } from '../Map/Pathfinding';
import { ScentMap, obstructsScent } from '../Map/Scent';
import { buildSafetyMap, allocShortGrid, SAFETY_MAX_DISTANCE } from '../Map/SafetyMap';
import { analyzeLoopMap, emptyLoopMap } from '../Map/LoopMap';
import {
    promoteOnItemPickup,
    promoteOnItemPlaced,
    promoteOnStep,
    promoteLayersWithMechFlag,
    triggerCreatureTrapLayers,
    consumeTrapTile,
    tunnelize,
    spawnObstruction,
    runPromotionUpdate,
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

import { arcanaTargetCandidates, canObserveBoltCreature } from '../Combat/BoltTargeting';

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
    /**
     * B-1b：实例鉴定态随存档往返（P1-48）。identified 三态语义与内存一致：
     * undefined（JSON 落盘时丢键）≙ 无未知态；旧存档无这些字段 → deserializeItem
     * 按 B-1b 前的 spawn 语义重建（读档即"鉴定态全丢"旧行为）。
     */
    identified?: boolean;
    canBeIdentified?: boolean;
    maxChargesKnown?: boolean;
    /** B-1c：≙ ITEM_MAGIC_DETECTED；旧存档无此键 → false（未被 detect magic 照过）。 */
    magicDetected?: boolean;
    timesUsed?: number;
    consumableId?: string;
    /** W-5: distinguish saved E from legacy staff enchantment=0 placeholders. */
    arcanaInstanceVersion?: 1;
    maxCharges?: number;
    charges?: number;
    staffRechargeRemaining?: number;
    rechargeTurns?: number;
    rechargeCounter?: number;
    cooldownTurns?: number;
    cooldownRemaining?: number;
    identityId?: string;
    /**
     * B-4b：钥匙→锁的绑定（CE item.keyLoc，Rogue.h:1417）。空数组/缺键
     * ≙ 无绑定（旧存档与无绑定钥匙）。
     * V-2b-6：解锁消费端上线（Game.keyInPackFor）——disposableHere
     * （开锁后是否消耗钥匙，CE Movement.c:636-656 useKeyAt）随存档往返。
     */
    keyLoc?: Array<{ loc: Pos; machine: number; disposableHere?: boolean }>;
    /** V-2b-6：≙ CE item->originDepth——钥匙生成层（keyMatchesLocation 判据 1）。 */
    originDepth?: number;
}

export interface GameSnapshotMonster {
    /** W-16: tagged species/relationship/timing payload. No tag in pre-W16
     * saves means no conjuration relation; never turn a horde blade into an ally. */
    spectralBlade?: {
        isAlly: boolean;
        boundToPlayer: boolean;
        doesNotTrackLeader: boolean;
        ticksUntilTurn: number;
    };
    id: number;
    loc: Pos;
    name: string;
    char: string;
    color: number;
    hp: number;
    maxHp: number;
    damageString: string;
    regenTurns?: number;
    regenCounter?: number;
    state: number;
    statusDurations?: Partial<Record<StatusId, number>>;
    poisonAmount?: number;
    maxShield?: number;
    goldDropChance: number;
    itemDropChance: number;
    onHitStatus?: StatusId;
    onHitChance?: number;
    onHitDuration?: number;
    statusImmunities?: StatusId[];
    statusResistTurns?: Partial<Record<StatusId, number>>;
    abilities?: string[];
}

export interface GameSnapshot {
    version: number;
    savedAt: number;
    depth: number;
    seed: number;
    mode: GameMode;
    /** W-6: retain partial P2 objective blocks across saves; legacy default is 100. */
    ticksTillUpdateEnvironment?: number;
    /** W-7: a read scroll awaits a mandatory target and its turn is not settled yet. */
    pendingEnchantment?: boolean;
    /** W-13: CE IMPREGNABLE flags for the saved map. Older saves have no flags. */
    impregnableCells?: number[];
    player: {
        loc: Pos;
        hp: number;
        maxHp: number;
        strength: number;
        nutrition: number;
        maxNutrition: number;
        regenCarry?: number;
        statusDurations?: Partial<Record<StatusId, number>>;
        poisonAmount?: number;
        maxShield?: number;
        inventory: GameSnapshotItem[];
        equippedWeaponId: number | null;
        equippedArmorId: number | null;
        /** B-1b：戒指双槽。equippedRingId 是 B-1b 前单槽存档的遗留字段，
         *  仅在 loadSnapshot 兼容读取（→ 左槽），新存档不写入。 */
        equippedRingId?: number | null;
        ringLeftId?: number | null;
        ringRightId?: number | null;
        temporaryImmunities?: Partial<Record<StatusId, number>>;
    };
    monsters: GameSnapshotMonster[];
    /**
     * V-2b-5：休眠怪随存档往返（CE 的 dormantMonsters 链表）。旧存档无此
     * 字段 → 空表兜底（与"该存档没有休眠怪"同义）。
     */
    dormantMonsters?: GameSnapshotMonster[];
    items: GameSnapshotItem[];
    /**
     * B-1b：全局种类鉴定态随存档往返（P1-48；对应 CE itemTable.identified /
     * callTitle 的快照架构等价物——CE 走回放存档隐式持久，web 必须显式进快照，
     * B-0 §1.8）。旧存档无此字段 → initConsumables 的开局态兜底（鉴定丢失，
     * 与 B-1b 前行为一致）。
     */
    identifiedItems?: string[];
    /** B-1b：玩家绰号（ItemLoader.callTitles 的落盘形态；Map 不能直接 JSON 化）。 */
    callTitles?: Record<string, string>;
    /**
     * B-1c：detect magic 揭示过极性的种类集（CE itemTable.magicPolarityRevealed
     * 的快照等价物，Rogue.h:1436）。旧存档无此字段 → initConsumables 的开局
     * 全零兜底（等同"极性揭示丢失"，与 B-1c 前行为一致）。
     */
    magicPolarityRevealed?: string[];
    /**
     * V-1c：跨层奖励房配额计数器（CE rogue.rewardRoomsGenerated，Rogue.h:2504）
     * 随存档往返。它在 BlueprintEngine 的配额公式里抑制"约每 4 层 1 间"之外的
     * 额外奖励房——不进快照的话，读档后配额重新从 0 计数，奖励房泛滥。
     * 旧存档无此字段 → 按 0 兜底（CE 语义的"开局态"；旧档本身出自无配额版本，
     * 无更准的恢复目标）。
     */
    rewardRoomsGenerated?: number;
    grid: Array<{
        x: number;
        y: number;
        terrain: TerrainType;
        /**
         * C-4a-0：四层地形快照（CE pmap layers[NUMBER_TERRAIN_LAYERS]）。
         * 旧存档（无此字段）按 setTerrain 语义还原：terrain 进归属层、
         * 其余三层置 NOTHING——loadSnapshot 里钉死这条兼容路径。
         */
        layers?: TerrainType[];
        char: string;
        color: number;
        isExplored: boolean;
        hasMemory: boolean;
        /**
         * F-2a：isBurning 现为"跨层挂火地形"的派生读数（Grid.Cell getter），
         * 快照里仍随写（新存档与 layers 恒一致，读档经对账分支空转；
         * 旧存档迁移语义见 loadSnapshot）。burnDuration/burnTerrain 随
         * 倒计时模型退役——旧存档数据里的同名字段读档时忽略。
         */
        isBurning: boolean;
        isPassable: boolean;
        isOpaque: boolean;
        /** P1-37：机器旗标（IS_IN_MACHINE 等价物）随存档往返；0 缺省省体积，旧存档视为无机器。 */
        machineNumber?: number;
    }>;
    gasGrid: Array<{
        x: number;
        y: number;
        /** G-1 起 = GAS 层地形值（GasType 常量与其相等）；type/density 语义 = CE layers[GAS]/volume。 */
        type: number;
        /** G-1 起 = CE volume（0-65535），字段名保留为旧存档兼容。 */
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
    /** V-2b-5：休眠怪随层缓存（CE 的 dormantMonsters 链表是全局的，但 CE 无
     *  层缓存；web 的层缓存语义下它们属于生成它们的层，随层进退）。 */
    dormantMonsters?: Monster[];
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
        spectralBlade?: GameSnapshotMonster['spectralBlade'];
        id: number;
        loc: Pos;
        name: string;
        char: string;
        color: number;
        hp: number;
        maxHp: number;
        damageString: string;
        regenTurns?: number;
        regenCounter?: number;
        state: number;
        statusDurations?: Partial<Record<StatusId, number>>;
        poisonAmount?: number;
        maxShield?: number;
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
        /** C-4a-0：改存四层（此前为单值 terrain）；重置时按层直填还原。 */
        layers: TerrainType[];
        char: string;
        color: number;
        isPassable: boolean;
        isOpaque: boolean;
    }>;
}

/**
 * V-2b-4：首层固定前厅梯位的落点。
 *
 * CE 的不变量是"楼梯永不在机器格内"（`placeStairs` 回避 IS_IN_MACHINE，
 * Architect.c:3712/3738）。CE 的时序天然保证它——`placeStairs` 在
 * `digDungeon`（含 addMachines）之后调用。web 把首层的上行梯**硬编码**在
 * 地图正中（`{DCOLS/2, DROWS/2}`），同一时序下若正中已被机器覆盖就会破坏
 * 该不变量。
 *
 * V-2b-4 实测（seed999/D1）：CE 1 号蓝图 `reward_mixed_library` 的
 * gate choke 区间 [30,50] + BP_OPEN_INTERIOR 让机器内部可达数百格连通体，
 * 正中 (39,14) 落入其中——p1_33 的"机器结构合同"与 p1_37 的"内容落点不
 * 闯入机器格"双双翻红。修复按 CE 口径：梯位**避开机器格**。
 *
 * **严格最小**：正中只要不是机器格，就原样用它（哪怕它是岩石——旧行为
 * 就是把楼梯砸进正中，改动它会在 4 个基线种子上产生 94 处无谓偏离）。
 * 只有正中落在机器内部时，才按 Chebyshev 环序就近取第一个"非机器格、
 * 可通行、DUNGEON 层是 FLOOR"的格。**零 RNG**、确定性（环序固定）。
 * 找不到时返回 null，调用方退回硬编码正中（保持旧行为，不静默挪位）。
 */
function vestibuleStairPos(grid: Grid): Pos | null {
    const cx = Math.floor(DCOLS / 2);
    const cy = Math.floor(DROWS / 2);
    const centre = grid.getCell(cx, cy);
    if (centre && centre.machineNumber === 0) return { x: cx, y: cy }; // 旧行为：原样
    const usable = (x: number, y: number): boolean => {
        if (x < 1 || y < 1 || x >= DCOLS - 1 || y >= DROWS - 1) return false;
        const c = grid.getCell(x, y);
        if (!c) return false;
        return c.machineNumber === 0 && c.isPassable && c.layers.includes(TerrainType.FLOOR);
    };
    const rmax = Math.max(DCOLS, DROWS);
    for (let r = 1; r < rmax; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (const dy of [-r, r]) {
                if (usable(cx + dx, cy + dy)) return { x: cx + dx, y: cy + dy };
            }
        }
        for (let dy = -r + 1; dy <= r - 1; dy++) {
            for (const dx of [-r, r]) {
                if (usable(cx + dx, cy + dy)) return { x: cx + dx, y: cy + dy };
            }
        }
    }
    return null;
}

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
    private pendingFallenByDepth: Map<number, Monster[]> = new Map();

    private needsRender: boolean = true;
    public isInventoryOpen: boolean = false;

    /**
     * B-1b：鉴定卷轴的目标待选态（CE promptForItemOfType，Items.c:7783-7802）。
     * CE 是读卷轴回合内同步选目标且不可取消（do-while 强制选到合法目标为止）；
     * web 的 UI 是异步弹层——读卷轴的回合先正常推进（与 CE 同为整回合），
     * 弹层点选后立即落账、不再消耗回合（CE 的选择本身零回合成本）。
     * 选择期间复用背包弹层并封锁其余输入（escape/toggle 也不得关闭）。
     * 不进存档：读档/新局重置（挂起中的选择不跨场景）。
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
    public currentSeed: number = 0;

    /**
     * B-4a：≙ CE rogue.meteredItems（RogueMain.c:229-252 开局初始化；
     * Items.c:577-579 每层入口加频、674-686 写回、740-752 生成后扣减）。
     * 语义与索引全按 ItemLoader.CE_METERED_ITEMS_TABLE（前 14 卷轴后 16 药水）。
     * 未入 GameSnapshot——存读档会重置计量（与 B-1a 字段族同批缺口，登记）。
     */
    private meteredItems: { frequency: number; numberSpawned: number }[] = ItemLoader.initMeteredItems();
    /** B-4a：≙ CE rogue.foodSpawned（Items.c:697/732，食物保底公式的累计口径）。 */
    private foodSpawned: number = 0;
    /**
     * B-4b：≙ CE rogue.goldGenerated（Items.c:781 每堆金币生成时累加；
     * :602/:604 的产量调度读它）。仅生成期金币堆计入——web 的怪物金币掉落
     * （goldDropChance，CE 无此机制）不计入，与 CE 的 goldGenerated 口径一致。
     * 未入 GameSnapshot（与 meteredItems/foodSpawned 同批缺口，登记）。
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
    // 写入 machineNumber）。数据源是 BlueprintEngine 的 MachineResult.cells。
    // P1-37 起旗标本身随存档往返（快照 grid 的 machineNumber 字段），读档时
    // 从网格重建本集合——落位检查不再在读档层退化（P1-35 的登记已闭环）。
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

        // V-1c：奖励房配额计数随新局清零（CE RogueMain.c:292）。必须先于首层
        // 生成——配额公式按它决定本层建几台奖励机器。
        resetRewardRoomsGenerated();

        this.depth = 1;
        this.levels.clear();
        this.monsters = [];
        this.dormantMonsters = []; // V-2b-5：休眠表随新局清零
        this.items = [];
        // B-4a：计量表与食物累计随新局清零（CE initializeRogue 的
        // RogueMain.c:229-252 / rogue.foodSpawned 初值 0）。
        this.meteredItems = ItemLoader.initMeteredItems();
        this.foodSpawned = 0;
        // B-4b：金币产量计数随新局清零（CE RogueMain.c:384）。
        this.goldGenerated = 0;
        this.visibleMonsters.clear();
        this.visibleItems.clear();
        this.autoPath = [];
        this.discardInFlightAdvancement();
        this.everSeenItems.clear();
        this.everSeenMonsters.clear();
        this.isMouseTraveling = false;
        this.isInventoryOpen = false;
        this.pendingIdentify = false;
        this.pendingEnchantment = false;
        this.pendingArcana = null;
        // B-1c：恶意品确认待决态不得跨场景泄漏（与 pendingIdentify 同处复位）
        this.pendingUseConfirm = null;
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

        // P1-42：CE 开局时 rogue 全局字段随 game 加载归零——justSearched
        // （Rogue.h:2449）与 STATUS_SEARCHING 充能（Time.c:2397）不跨局保留。
        this.justSearched = false;
        this.searchingCharge = 0;

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
    private spawnBlueprintItem(category: string, id: string | undefined, x: number, y: number, depth: number): Item | null {
        if (id) {
            // Specific item
            if (category === 'SCROLL') return ItemLoader.spawnScroll(id, x, y);
            if (category === 'POTION') return ItemLoader.spawnPotion(id, x, y);
            if (category === 'KEY') return ItemLoader.spawnKey(id, x, y);
            return null;
        }

        // V-1a：多类别掩码（CE machineFeature.itemCategory 是位掩码，如神祠
        // "Shrine -- safe haven…" 的 (POTION|SCROLL|WEAPON|ARMOR|RING)，
        // GlobalsBrogue.c:561-565）。blueprints.json 以 '|' 连接的字符串转录。
        // CE 消费端是**两段抽取**（Architect.c:1504 generateItem(掩码, -1) →
        // makeItemInto Items.c:171-179）：先 pickItemCategory(掩码)（Items.c:85-107：
        // 按 13 槽定序、itemGenerationProbabilities_Brogue 类别加权选出一个类别），
        // 再在选中类别内 chooseKind 基表频率选 kind——不是把五类合成一张池子
        // 单次加权。递归进下方单类别分支即复用 T-1 已对齐的第二段。
        if (category.includes('|')) {
            const maskSet = new Set(category.split('|').map(s => s.trim()).filter(s => s.length > 0));
            // CE_ITEM_GENERATION_PROBABILITIES 即 CE 13 槽走表序
            // （GOLD,SCROLL,POTION,STAFF,WAND,WEAPON,ARMOR,FOOD,RING,CHARM,AMULET,GEM,KEY；
            // web 省略权重 0 的 GEM——B-4b 已登记行为等价）。掩码不含 GOLD，无需特例。
            const slots = ItemLoader.CE_ITEM_GENERATION_PROBABILITIES.filter(s => maskSet.has(ItemCategory[s.category]));
            let sum = 0;
            for (const s of slots) sum += s.weight;
            // CE sum==0 时原样返回掩码、makeItemInto 落 default 报错——web 掩码
            // 只含常规类别（各带正权重），此分支仅作防御，与 CE 的 fail 行为同向。
            if (sum <= 0) return null;
            let roll = rng.randRange(1, sum);
            for (const s of slots) {
                if (roll <= s.weight) {
                    return this.spawnBlueprintItem(ItemCategory[s.category], undefined, x, y, depth);
                }
                roll -= s.weight;
            }
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
            case 'RING': {
                // V-1a：掩码路径的第五类。与上方四支同构：chooseKind 基表加权
                // （CE 环之戒全 8 种基频 1，web 现有 6 种亦全为 1——light/reaping
                // 目录缺口登记不补）。CE 环生成无深度门（makeItemInto 直用全表）。
                const rings = ItemLoader.genRings;
                if (rings.length > 0) {
                    const pick = ItemLoader.chooseKind(rings.map(r => r.frequency ?? 0));
                    return ItemLoader.spawnRing(rings[pick]!.id, x, y);
                }
                return null;
            }
            case 'KEY':
                // B-4b：钥匙由锁具驱动（数量 == 锁数，见 machineResults 循环），
                // 类别级 KEY feature 不再发无绑定钥匙。显式指定 id 的 KEY 物品
                // （下方 id 分支）保留给未来的任务钥匙类蓝图——当前无调用者。
                return null;
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
            this.updateVision(); // C-7：CE updateVision 全链（原 computeFOV(10) 代理退役）
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
                dormantMonsters: this.dormantMonsters,
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
            this.dormantMonsters = cached.dormantMonsters ?? [];
            this.items = cached.items;
            this.visibleMonsters = cached.visibleMonsters;
            this.visibleItems = cached.visibleItems;
            this.machineCells = cached.machineCells ?? new Set();
            this.bindDormantAwakener();

            // Reposition player to stairs（P1-31：落位走 CE RogueMain.c:837-869，
            // 先置楼梯位再向 4 邻域找合格格——不再直接站上楼梯）
            const targetStairType = isGoingUp ? TerrainType.STAIRS_DOWN : TerrainType.STAIRS_UP;
            let entryStair: Pos | null = null;
            for (let x = 0; x < this.grid.width; x++) {
                for (let y = 0; y < this.grid.height; y++) {
                    if (this.grid.getCell(x, y)?.layers.includes(targetStairType)) { // F-1 跨层判定
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
            this.dormantMonsters = [];
            this.bindDormantAwakener();
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
            // （B-4b：architect.machines 不再传入——legacy machines 循环已删；
            //  V-2b-1：architect.trapVaults/cages 不再传入——两数组及其消费
            //  循环均为死代码，已删除）
            this.populateLevel(
                this.depth, isGoingUp, isFirstLevel,
                architect.machineResults
            );

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
        // C-7：CE RogueMain.c:671 进层时 updateColors + updateRingBonuses
        // （级联 updateMinersLightRadius）+ updateVision 的对应位置——
        // updateVision 内部先重算矿灯半径再做光照/可见性。
        this.updateVision();
        this.onRenderRequested?.();
    }

    private populateLevel(
        depth: number,
        isGoingUp: boolean = false,
        isFirstLevel: boolean = false,
        machineResults: MachineResult[] = []
    ) {
        // P1-31：本层机器格（CE pmap IS_IN_MACHINE，落位排除项之一）。
        this.machineCells = new Set();
        for (const mr of machineResults) {
            for (const c of mr.cells) this.machineCells.add(c.y * DCOLS + c.x);
        }

        // Collect all valid floor tiles
        // P1-37：牌堆排除机器格（machineNumber≠0 = CE 的 IS_IN_MACHINE，
        // Rogue.h:1113）。CE 的楼梯（Architect.c:3712/3738）、随机物品
        // （3597）、漫游怪群（3543）落点一律回避该旗标；web 的楼梯/护符/
        // 钥匙/随机物品/怪群领袖统一从本牌堆抽取，此处一处排除全部覆盖。
        // P1-33 曾以"宝库地板改判 CHARRED_FLOOR"达成同样效果（当时 Game.ts
        // 禁改），P1-37 起用地形类型冒充旗标的做法废除，宝库恢复普通地板。
        const floorTiles: Pos[] = [];
        for (let x = 1; x < DCOLS - 1; x++) {
            for (let y = 1; y < DROWS - 1; y++) {
                const cell = this.grid.getCell(x, y);
                if (!cell || !cell.layers.includes(TerrainType.FLOOR)) continue; // F-1 跨层判定
                if (cell.machineNumber !== 0) continue; // CE IS_IN_MACHINE
                // Don't spawn right on top of player
                if (Math.abs(x - this.player.loc.x) > 5 || Math.abs(y - this.player.loc.y) > 5) {
                    floorTiles.push({ x, y });
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
            // V-2b-4：首层固定前厅梯位——避开机器格（CE placeStairs 的
            // IS_IN_MACHINE 回避，见 vestibuleStairPos 头注）。
            stairsUpPos = vestibuleStairPos(this.grid)
                ?? { x: Math.floor(DCOLS / 2), y: Math.floor(DROWS / 2) }; // Default vestibule
            this.grid.setTerrain(stairsUpPos.x, stairsUpPos.y, TerrainType.STAIRS_UP, '<', 0xffaa00);
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
        for (const mr of machineResults) {
            // Spawn keys for locked doors
            // V-2b-6：generatedKey 机器跳过补偿循环——CE Architect.c 里钥匙
            // 只由 KEY feature 生成（:1523 addLocationToKey），没有"每锁一把
            // 补偿钥匙"一说；16 号的门与钥匙同 feature（keyLoc 绑定经领养链
            // 落地），不跳过会让它拿到两把钥匙（B-4b 防的"钥匙 ×2"回流）。
            if (mr.needsKey && !mr.generatedKey && mr.door && floorTiles.length > 0) {
                const keyPos = floorTiles.pop()!;
                const key = ItemLoader.spawnKey('iron_key', keyPos.x, keyPos.y);
                if (key) {
                    key.keyLoc = [{ loc: { x: mr.door.x, y: mr.door.y }, machine: mr.machineNumber, disposableHere: true }];
                    key.originDepth = depth;
                    this.items.push(key);
                }
            }

            // Spawn items
            for (const spawn of mr.itemSpawns) {
                // B-4b：KEY 类 feature 物品跳过——钥匙总量恒等于锁数。
                // V-2b-6：例外 = **经领养链路**（viaAdoption）落地的绑定钥匙。
                // CE Architect.c 里一切 KEY feature 要么 MF_OUTSOURCE（领养链
                // 落地）要么 MF_MONSTER_TAKE_ITEM（怪携带）——不存在"自产自销
                // 的室内钥匙"形态。web 的 key_rat_trap 室内钥匙（无外包）是该
                // 形态孤例：落在本机锁门之内、无钥匙不可达（死货），继续跳过、
                // 由补偿循环供钥匙；16 号门钥匙 / 10 号 cage key 经领养落地。
                if (spawn.category === 'KEY' && !spawn.viaAdoption) continue;
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
                if (!spawnCell || isPathingBlocker(spawnCell.terrain)) continue;
                const item = this.spawnBlueprintItem(spawn.category, spawn.id, spawn.pos.x, spawn.pos.y, depth);
                if (item) {
                    // V-2b-6：锁位绑定与生成层落到实化的物品上（CE Architect.c:1523
                    // addLocationToKey + :1524 originDepth = rogue.depthLevel）。
                    if (spawn.keyLoc) item.keyLoc = spawn.keyLoc.map(k => ({ ...k, loc: { ...k.loc } }));
                    item.originDepth = depth;
                    this.items.push(item);
                }
            }

            // Spawn monsters
            for (const spawn of mr.monsterSpawns) {
                // V-2b-5（CE Architect.c:1591-1599）：MF_GENERATE_HORDE 指令——
                // 按 horde 表成群生成（CE 在 spawnHorde 内部抽 horde 与核地形，
                // 落点即 feature 落点）。
                if (spawn.hordeFlags) {
                    this.spawnHordeAtFeature(spawn, depth, mr.machineNumber);
                    continue;
                }
                if (!spawn.monsterId) continue;
                const mData = this.resolveBlueprintMonster(spawn.monsterId, depth);
                if (mData) {
                    const mon = new Monster(spawn.pos.x, spawn.pos.y, mData);
                    if (spawn.isAlly) mon.isAlly = true;
                    if (spawn.isCaged) mon.isCaged = true;
                    // V-2b-6：MF_MONSTER_TAKE_ITEM 的物品实化（CE Architect.c:
                    // 1705-1710 `torchBearer->carriedItem = torch`；Monsters.c:150
                    // `carriedItem->originDepth = rogue.depthLevel`）。
                    if (spawn.carriedItem) {
                        const carried = this.spawnBlueprintItem(
                            spawn.carriedItem.category, spawn.carriedItem.id, spawn.pos.x, spawn.pos.y, depth
                        );
                        if (carried) {
                            if (spawn.carriedItem.keyLoc) carried.keyLoc = spawn.carriedItem.keyLoc.map(k => ({ ...k, loc: { ...k.loc } }));
                            carried.originDepth = depth;
                            mon.carriedItem = carried;
                        }
                    }
                    this.applyRandomMutation(mon, depth);
                    this.monsters.push(mon);
                    this.finalizeBlueprintMonster(mon, spawn, mr.machineNumber);
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
                            if (c && (c.terrain === TerrainType.STAIRS_UP || c.terrain === TerrainType.STAIRS_DOWN)) return true;
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
                // （F-1：跨层判定，火盖在深水/陷阱上不改变本判据——CE 全层 OR）
                const dividesLevel = !cell || !cell.isPassable ||
                    cell.layers.includes(TerrainType.LAVA) ||
                    cell.layers.includes(TerrainType.WATER_DEEP) ||
                    cell.layers.includes(TerrainType.TRAP);
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
    private spawnHordeAtFeature(spawn: MachineMonsterSpawn, depth: number, machineNumber: number): void {
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
            if (!cand) return; // CE :816-819 抽不到合格 horde → 不生成
            picked = cand;
            if (this.hordeFitsTerrain(cand, spawn.pos)) break;
        }
        if (!picked) return;

        const collected: Monster[] = [];
        this.spawnHordeAt(picked, spawn.pos, roll.depth, false, undefined, collected);
        for (const mon of collected) {
            this.finalizeBlueprintMonster(mon, spawn, machineNumber);
        }
    }

    /** Monsters.c:809-819：horde 落格地形约束（spawnsIn）。 */
    private hordeFitsTerrain(h: HordeEntry, pos: Pos): boolean {
        if (!h.spawnsIn) return true;
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
        if (h.flags.includes('HORDE_LEADER_CAPTIVE')) {
            // Monsters.c:872-877：笼中俘虏 —— 上锁不行动、状态 WANDERING、HP 折至 1/4+1
            leaderMon.isCaged = true;
            leaderMon.state = MonsterState.WANDERING;
            leaderMon.hp = Math.floor(leaderMon.maxHp / 4) + 1;
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
                searchLoop: for (let r = 1; r <= 5; r++) {
                    // Find a random free spot in a ring of radius `r`
                    // To keep it simple, checking all spots and picking the first valid one
                    for (let dx = -r; dx <= r; dx++) {
                        for (let dy = -r; dy <= r; dy++) {
                            if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                            const nx = centerPos.x + dx;
                            const ny = centerPos.y + dy;
                            const cell = this.grid.getCell(nx, ny);
                            // P1-37 + 验收方复核后的正确理由（执行方原引
                            // Monsters.c:809-819 → Architect.c:3543 不成立：
                            // 前者是 hordeID 重选循环，后者是"领袖撞上玩家/楼梯"
                            // 的重定位回退；成员铺开的真实对应物 spawnMinions
                            // Monsters.c:703-733 的禁忌旗标只有
                            // (HAS_PLAYER | HAS_STAIRS) 与 HAS_MONSTER，
                            // **不含 IS_IN_MACHINE**）。
                            //
                            // 但排除本身是必要的，理由在 web 侧：CE 的成员经
                            // getQualifyingPathLocNear 按**路径距离**落位，
                            // 锁门封住的密库在路径上走不进去，于是 CE 无需旗标
                            // 就结构性地把成员挡在了机器外面；web 这里是按
                            // 切比雪夫半径的**环形扫描**（上面的 r=1..5），
                            // 不看连通性——不排除就会把怪物直接塞进封死的宝库。
                            // 这与 P1-33 的 gateSealsOnlyInterior 同属
                            // "web 侧必要、CE 无对应"一类。
                            // 代价：移动 RNG 值序（424242/D26 楼梯位移）。
                            // 已登记 P1-41：把成员铺开改成路径距离落位，
                            // 届时这条排除应当随之取消。
                            if (cell && cell.isPassable && cell.machineNumber === 0 && !this.monsters.some(m => m.loc.x === nx && m.loc.y === ny) && !(this.player.loc.x === nx && this.player.loc.y === ny)) {
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
                                collected?.push(mon);

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
                    if (cell.layers.includes(TerrainType.LAVA) || cell.layers.includes(TerrainType.CHASM)) continue; // F-1 跨层判定
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
     * P1-37：CE 的远格池不排机器、回退池排 IS_IN_MACHINE（Monsters.c:1110
     * 的 getTerrainGrid 第二次调用才加入该旗标）——两池口径照搬。
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
                // F-1：跨层判定（火盖在岩浆/深渊/楼梯上不改变落点排除）
                if (cell.layers.includes(TerrainType.LAVA) || cell.layers.includes(TerrainType.CHASM)) continue;
                if (cell.layers.includes(TerrainType.STAIRS_UP) || cell.layers.includes(TerrainType.STAIRS_DOWN)) continue;
                if (this.getMonsterAt(x, y)) continue;
                if (this.player.loc.x === x && this.player.loc.y === y) continue;
                const isFar = Math.max(Math.abs(x - this.player.loc.x), Math.abs(y - this.player.loc.y)) >= minFarDist;
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
        if (m.spectralBlade) return this.deserializeMonster(m);
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
        monster.regenTurns = m.regenTurns ?? 0;
        monster.regenCounter = m.regenCounter ?? 0;
        monster.statusDurations = { ...(m.statusDurations ?? {}) };
        monster.restorePoison(m.poisonAmount);
        monster.restoreShield(m.maxShield);
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
        this.dormantMonsters = []; // test 层无休眠怪（防上一层残留）
        this.bindDormantAwakener();
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
                    baselineMonsters: roomMonsters.map((m) => ({
                        spectralBlade: this.serializeMonster(m).spectralBlade,
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
                        poisonAmount: m.poisonAmount,
                        maxShield: m.maxShield,
                        regenTurns: m.regenTurns,
                        regenCounter: m.regenCounter,
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
     * - 光明戒指增减（Items.c:8728，updateRingBonuses 末尾）——web 无
     *   ring_of_light 载体（D2 池/数据文件禁改），lightMultiplier 恒 1，登记。
     * - 黑暗状态增减（Items.c:8090 喝药 / :4692 解除）——web 无
     *   potion_of_darkness 载体，STATUS_DARKNESS 恒 0，登记。
     * - 水中减半（Light.c:150-152，rogue.inWater）——web 无该状态载体，恒 0，登记。
     */
    private refreshMinersLight(): void {
        this.minersLightBaseFixpt = minersLightBaseRadiusFixpt(this.depth);
        this.minersLight = updateMinersLightRadius(this.minersLightBaseFixpt, {
            lightMultiplier: 1,
            darknessStatus: 0,
            darknessMax: 0,
            inWater: 0,
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

        // 2. 燃烧生物的光（Light.c:249-251：STATUS_BURNING 且非 MONST_FIERY；
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

        // 3. 矿灯（Light.c:269：isMinersLight=true → 不驱散阴影、不圆截断）
        lm.paintLight({
            light: this.minersLightDef(),
            x: this.player.loc.x, y: this.player.loc.y,
            isMinersLight: true,
            maintainShadows: true,
        });

        // 4. VISIBLE（Movement.c:2582-2589）：IN_FIELD_OF_VIEW ∧ 光强和>50
        //    （CE 还有 !CLAIRVOYANT_DARKENED——web 无该机制，登记）。
        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                const cell = this.grid.getCell(x, y);
                if (!cell) continue;
                const visible = mask[x]![y]! && lm.lightSumAt(x, y) > VISIBILITY_THRESHOLD;
                cell.isVisible = visible;
                if (visible) {
                    cell.isExplored = true;
                    cell.hasMemory = true;
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

            // C-7：动态光照已并入 updateVision（地形光/燃烧生物/矿灯按 CE
            // Light.c:208-240 顺序泼入，渲染馈送由 fillRenderFromLighting 折算）。
            // 旧的"玩家火把 addLight(player, 8, '#ffccaa')"随矿灯管线退役。

            this.onRenderRequested();
            this.needsRender = false;
        }
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
            const cell = this.grid.getCell(this.player.loc.x, this.player.loc.y);
            if (cell && cell.layers.includes(TerrainType.STAIRS_DOWN)) { // F-1 跨层判定
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
            if (cell && cell.layers.includes(TerrainType.STAIRS_DOWN)) { // F-1 跨层判定
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
                } else if (this.grid.getCell(newX, newY)?.layers.includes(TerrainType.LOCKED_DOOR) // F-1 跨层判定
                    || this.grid.getCell(newX, newY)?.layers.includes(TerrainType.MONSTER_CAGE_CLOSED)) {
                    // V-2b-6：钥匙真实化（CE Movement.c:1160-1206 的 bump-to-unlock
                    // + Items.c:4036 keyMatchesLocation / 4051 keyInPackFor +
                    // Movement.c:616-656 useKeyAt 的 disposable 收口）。锁与笼共用
                    // 一条通路：LOCKED_DOOR 与 MONSTER_CAGE_CLOSED 都带
                    // TM_PROMOTES_WITH_KEY，钥匙按「坐标或机器号」匹配——
                    // 不再是"任意钥匙开任意锁"。
                    const keyCell = this.grid.getCell(newX, newY)!;
                    const isCage = keyCell.layers.includes(TerrainType.MONSTER_CAGE_CLOSED);
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
                            this.grid.setTerrain(newX, newY, TerrainType.OPEN_DOOR, "'", 0xaa8844);
                            logger.log(i18next.t('door.unlocked', { defaultValue: 'You unlock the door with a key.' }), '#88ff88');
                        }

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

                    // C-5：CE Movement.c:1474-1476——移动完成后站在渊格上只置
                    // MB_IS_FALLING，坠落由紧随其后的 playerTurnEnded 顶部结算
                    //（CE Time.c:2480-2486），不是踩上瞬间。
                    if (this.creatureShouldFall(this.player)) {
                        this.playerFalling = true;
                    }
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
                // F-1 跨层判定：火盖在深水/岩浆上不改变"够不着"判据
                if (cell && cell.layers.includes(TerrainType.WATER_DEEP) && !isFlying) {
                    logger.log(i18next.t('item.deep_water_reach', { defaultValue: `The ${item.name} is deep underwater.` }), '#aaaaaa');
                    return;
                }
                if (cell && cell.layers.includes(TerrainType.LAVA) && !isFlying && !this.player.hasStatus('immune_fire')) {
                    logger.log(i18next.t('item.lava_reach', { defaultValue: `The ${item.name} is submerged in lava.` }), '#ff4444');
                    return;
                }

                if (this.player.inventory.addItem(item)) {
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
        if (this.player.equip(item)) {
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
        if (this.player.inventory.removeItem(item)) {
            this.player.unequip(item);
            this.syncEquipmentStatuses();
            item.loc = { x: this.player.loc.x, y: this.player.loc.y };
            this.items.push(item);
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
                        this.applyTimedStatus(this.player, 'hallucinating', 12);
                        logger.log(i18next.t('potion.confusion_burst', { defaultValue: 'Reality bends and shimmers around you!' }), '#cc99ff');
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
                        this.applyTimedStatus(this.player, 'hallucinating', 20);
                        logger.log(i18next.t('potion.hallucinate_burst', { defaultValue: 'The world transforms into a swirling kaleidoscope of colors!' }), '#cc99ff');
                        break;
                    case 'creeping_death':
                        // P1-45（G-1）：占位的 `addGas(x, y, 1, 100)` 删除——
                        // 字面量 1 即旧 GasType.FIRE，喷出的是一团不渲染、无
                        // 效果、却占格扩散并挡住真气体的"幽灵气"（F-0 §2.2）。
                        // GasType.FIRE 死枚举随之退役；GasType 本身也已改基到
                        // GAS 层地形值，1 现在是 GRANITE，任何残留写法都会被
                        // addGas 的载体校验拒绝。creeping_death 是 web 自创
                        // 内容（CE 无此药水/气体，F-0 §5.2-5），按 D2 保留
                        // 本效果分支但退出生成池（见 D2_EXCLUDED_POTIONS）。
                        logger.log(i18next.t('potion.creeping_death', { defaultValue: 'A terrifying green gas fills the area!' }), '#88ff88');
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
                        if (this.burningDuration(this.player) > 0) {
                            this.extinguishCreatureFire(this.player);
                        }
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

    public readItem(item: Item, confirmed: boolean = false) {
        if (this.pendingEnchantment) return;
        if (item.category !== ItemCategory.SCROLL) return;
        if (!this.player.inventory.items.includes(item)) return;
        if ((item as Item & { consumableId?: string }).consumableId === 'scroll_of_enchantment'
            && (this.isInputLocked() || this.isGameOver || this.player.hp <= 0
                || this.player.hasStatus('paralyzed') || this.pendingIdentify || this.pendingArcana)) return;
        // B-1c：CE Items.c:7757-7767——同款恶意品确认（读卷轴分支）。
        if (this.gateMalevolentUse(item, confirmed)) return;

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
                        // Items.c:7922-7938 SCROLL_PROTECT_WEAPON
                        this.protectEquippedGear(this.player.equippedWeapon, 'weapon');
                        break;
                    case 'protect_armor':
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
            timeSystem.currentTick += this.player.movementSpeed;
            this.playerTurnEnded();
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
        this.cancelArcanaSelection(); // Consume the pending transaction exactly once.
        if (!bolt) return null;
        const charges = item.charges ?? 0;
        if (charges <= 0 && item.identified === true) return null;
        let result: BoltResult | null = null;
        if (charges > 0) {
            result = this.zapBoltFromPlayer(bolt, item, cursor);
            if (result.outcome?.autoID && !ItemLoader.identifiedItems.has(id)) {
                ItemLoader.identifyItemKind(item);
                logger.log(i18next.t('item.identify', { name: item.displayName, defaultValue: 'You identify {{name}}.' }), '#00ffff');
            }
            item.charges = charges - 1;
            if (item.category === ItemCategory.WAND) item.timesUsed = (item.timesUsed ?? 0) + 1;
        } else {
            item.maxChargesKnown = true;
            logger.log(i18next.t('arcana.no_charges', { name: item.displayName, defaultValue: '{{name}} has no charges.' }), '#ff8888');
        }
        this.needsRender = true;
        // CE Time.c:2604-2605 uses movementSpeed at turn end (after effects).
        timeSystem.currentTick += this.player.movementSpeed;
        this.playerTurnEnded();
        return result;
    }

    // ----- Bolt Zapping System -----

    /** Execute an explicit aim. Direct engine callers can retain the candidate/
     * last-direction fallback; inventory use always goes through confirmation. */
    public zapBoltFromPlayer(bolt: BoltConfig, item: Item, aim?: Pos): BoltResult {
        const first = aim ? undefined : this.getArcanaCandidates(item)[0];
        const dir = this.directionToVec(this.player.lastMoveDirection ?? Direction.RIGHT);
        const target = aim ?? (bolt.selfTargeting ? this.player.loc : first?.loc) ?? { x: this.player.loc.x + dir.x * 20, y: this.player.loc.y + dir.y * 20 };
        // Blink distance and tunneling budget are travel inputs, resolved from E.
        // Both staff identities remain deferred to W-25.
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
        return {
            caster, hideDetails,
            creatureAt: pos => {
                if (this.player.hp > 0
                    && this.player.loc.x === pos.x && this.player.loc.y === pos.y) return this.player;
                return this.monsters.find(m => m.hp > 0 && !m.isDormant
                    && m.loc.x === pos.x && m.loc.y === pos.y);
            },
        };
    }

    /** CE updateBolt :5440-5465: existing DF -> fire -> electricity, once per
     * reached cell, before checking its post-effect obstruction flags. The only
     * executable catalog pathDF today is dragonfire's existing DF_OBSIDIAN.
     * Web/vines remain disabled; no new DF definitions or effect algorithms. */
    private applyBoltTerrainAt(bolt: BoltConfig, pos: Pos): boolean {
        const before = this.boltTerrainSignature([], pos);
        const definition = bolt.ceType === null ? undefined : CE_BOLT_CATALOG[bolt.ceType];
        if (definition?.pathDF === 'DF_OBSIDIAN') {
            spawnDungeonFeature(this.grid, pos.x, pos.y, catalogFeature(DF.DF_OBSIDIAN), false);
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
                    applied = true;
                }
                autoID = this.applyBoltTerrainAt(result.bolt, pos) || autoID;
            },
        });
        Object.assign(result, actual);
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
    private applyDirectBoltDamage(target: Creature, result: BoltResult, item: Item): number | null {
        const staff = this.isDamageStaff(result.bolt, item);
        if ((target instanceof Monster && target.isInvulnerable())
            || (staff && result.effect === BoltEffect.FIRE && target.hasStatus('immune_fire'))) {
            logger.log(i18next.t('bolt.invulnerable_no_effect', {
                target: target.name,
                defaultValue: `The ${target.name} is unaffected.`
            }), '#aaaaaa');
            return null;
        }
        const damage = staff ? rollStaffDamage(resolveCEBoltMagnitude(result.bolt.ceType!, {
            kind: 'staff', enchantment: item.enchantment,
        }).value, rng) : result.magnitude;
        target.takeDamage(damage);
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
        return !(target instanceof Monster) || (!target.hasBehavior('MONST_INANIMATE') && !target.isInvulnerable());
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
                // heal(..., false): floor percent*maxHP/100, no minimum or panacea.
                healed = Math.min(target.maxHp - target.hp, Math.floor(magnitude * 10 * target.maxHp / 100));
                target.hp += healed;
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
            target: target.name, defaultValue: `The ${target.name} is unaffected.`
        }), '#aaaaaa');
        return { accepted, autoID, healed };
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
                const damage = target ? this.applyDirectBoltDamage(target, result, item) : null;
                if (target && damage !== null) {
                    logger.log(i18next.t('bolt.fire_hit', {
                        interpolation: { escapeValue: false },
                        name: item.displayName, target: target.name, damage,
                        defaultValue: `${item.displayName} scorches the ${target.name} for ${damage} damage!`
                    }), '#ff6600');
                    this.spawnFloatingText(`-${damage}`, target.loc.x, target.loc.y, 0xff4400);
                    if (target.hp <= 0) {
                        logger.log(i18next.t('bolt.fire_kill', {
                            target: target.name,
                            defaultValue: `The ${target.name} burns to death.`
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
                    const damage = this.applyDirectBoltDamage(m, result, item);
                    if (damage === null) {
                        continue;
                    }
                    totalDamage += damage;
                    this.spawnFloatingText(`-${damage}`, m.loc.x, m.loc.y, 0x33ccff);
                    logger.log(i18next.t('bolt.lightning_hit', {
                        interpolation: { escapeValue: false },
                        name: item.displayName, target: m.name, damage,
                        defaultValue: `Lightning from ${item.displayName} strikes the ${m.name} for ${damage} damage!`
                    }), '#33ccff');
                    if (m.hp <= 0) {
                        logger.log(i18next.t('bolt.lightning_kill', {
                            target: m.name,
                            defaultValue: `The ${m.name} is electrocuted!`
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
                        interpolation: { escapeValue: false }, name: item.displayName, target: target.name,
                        defaultValue: `${item.displayName} envenomates the ${target.name}!`
                    }), '#55cc55');
                } else {
                    logMiss('bolt.poison_miss', `Poison streams from ${item.displayName} but finds no target.`, '#55cc55');
                }
                break;
            }

            case BoltEffect.TELEPORT: {
                // CE Items.c:5220-5227: immunity precedes freeing; freeing
                // precedes destination search, even if that search later fails.
                if (target && !(target instanceof Monster && target.hasBehavior('MONST_IMMOBILE'))) {
                    if (target instanceof Monster && target.isCaged) this.freeCaptive(target);
                    if (this.teleportCreature(target)) {
                        logger.log(i18next.t('bolt.teleport_hit', {
                            name: item.displayName, target: target.name,
                            defaultValue: `${item.displayName} teleports the ${target.name} away!`
                        }), '#cc88ff');
                    }
                } else if (!target) {
                    logMiss('bolt.teleport_miss', `${item.displayName} flashes but finds no target.`, '#cc88ff');
                }
                break;
            }

            case BoltEffect.SLOW:
            case BoltEffect.HEALING:
            case BoltEffect.HASTE:
            case BoltEffect.DISCORD:
            case BoltEffect.INVISIBILITY: {
                if (!target) {
                    logMiss('arcana.no_observable_effect', 'You zap {{name}}.', '#aaaaaa');
                    break;
                }
                const ceMagnitude = resolveCEBoltMagnitude(result.bolt.ceType!, item.category === ItemCategory.STAFF
                    ? { kind: 'staff', enchantment: item.enchantment } : { kind: 'wand' }).value;
                const applied = this.applyBasicBoltEffect(target, effect, ceMagnitude);
                autoID = applied.autoID;
                if (!applied.accepted) break;
                const targetName = target === this.player ? i18next.t('bolt.target_you', { defaultValue: 'you' }) : target.name;
                const args = { interpolation: { escapeValue: false }, name: item.displayName, target: targetName, heal: applied.healed };
                switch (effect) {
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
                        name: item.displayName, target: target.name,
                        defaultValue: `${item.displayName} pulls the ${target.name} toward you!`
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
                const data = (monsterData as MonsterData[]).find(m => m.id === 'spectral_blade')!;
                for (let i = 0; i < staffBladeCount(e); i++) {
                    const at = bladeSpawnLocation(this, result.landingPos);
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
                const placed = spawnObstruction(this.grid, result.landingPos.x, result.landingPos.y, e,
                    pos => !!world.creatureAt(pos));
                // A visible effect is not required: CE detonateBolt always autoIDs.
                autoID = true;
                if (placed.pathingChanged) {
                    this.loopMap = analyzeLoopMap(this.grid);
                    this.updatedSafetyMapThisTurn = false;
                    this.autoPath = [];
                    this.isMouseTraveling = false;
                    // CE only rebuilds waypoints for tunneling, not obstruction.
                    // Existing rolling refresh reads the new passability.
                }
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
                if (target instanceof Monster && target.isAlly) {
                    target.maxHp = Math.floor(target.maxHp * 1.5);
                    target.hp = target.maxHp;
                    autoID = this.boltLivingTarget(target) && this.canObserveBoltTarget(target);
                    logger.log(i18next.t('bolt.empowerment_hit', {
                        name: item.displayName, target: target.name,
                        defaultValue: `${item.displayName} empowers the ${target.name}!`
                    }), '#ffff44');
                } else if (target instanceof Monster) {
                    logger.log(i18next.t('bolt.empowerment_enemy', {
                        name: item.displayName, target: target.name,
                        defaultValue: `${item.displayName} empowers the ${target.name}!`
                    }), '#ffff44');
                    target.maxHp = Math.floor(target.maxHp * 1.3);
                    target.hp = target.maxHp;
                    autoID = this.boltLivingTarget(target) && this.canObserveBoltTarget(target);
                } else {
                    logMiss('bolt.empowerment_miss', `${item.displayName} fires but finds no target.`, '#ffff44');
                }
                break;
            }

            case BoltEffect.NEGATION: {
                if (target) {
                    const before = JSON.stringify([target.hp, target.statusDurations]);
                    const seenBefore = this.canObserveBoltTarget(target);
                    // P4-3：CE Items.c:4483-4491 negate() —— MONST_DIES_IF_NEGATED 的怪物
                    // 被 negation 命中时直接死亡，而不是清状态（"是纯魔法造物，一旦
                    // 被消除魔法就无法维持存在"）。
                    if (this.negateCreatureMagic(target) === 'died') {
                        logger.log(i18next.t('bolt.negation_dies', {
                            name: item.displayName, target: target.name,
                            defaultValue: `${target.name} falls to the ground, lifeless!`
                        }), '#ffffff');
                    } else {
                        // P1-28 注（negate 不剥离 behaviorFlags——CE 的
                        // NEGATABLE_TRAITS 临时剥离+到期恢复未实现，旗标恒在，
                        // 清空后由 negateCreatureMagic 内的 syncFlagDerivedStatuses
                        // 重推导旗标派生状态）、P2-2（refreshSpeeds）同前。
                        logger.log(i18next.t('bolt.negation_hit', {
                            name: item.displayName, target: target.name,
                            defaultValue: `${item.displayName} negates all magic on the ${target.name}!`
                        }), '#ffffff');
                    }
                    autoID = seenBefore && before !== JSON.stringify([target.hp, target.statusDurations]);
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

    /**
     * P4-1b：怪物施法的效果落地出口，被 Monster.tryUseBolt 调用（对应 CE
     * monsterCastSpell，Monsters.c:2764）。
     *
     * 设计取舍（"泛化 applyBoltEffect 但不破坏玩家路径"，详见报告）：没有
     * 直接改造上面那个巨大的、按 item 措辞的 applyBoltEffect switch——它的每个
     * 分支都绑死了"物品名 + 固定打玩家/固定回怪物"的叙事假设（这些旧假设已由 W-9/W-15 的命中分支替换），改起来风险远大于收益。这里另开一个
     * 面向"施法者可以是怪物、目标可以是玩家或任意怪物"的精简出口，复用同一套
     * 底层原语（traceBolt/createBoltResult 做路径与动画、applyStatusToMonster/
     * applyTimedStatus 做状态、environment.ignite 做点火、CombatSystem.attack
     * 做伤害判定），两条路径共享地基但不共享分支体，玩家原有调用
     * （zapBoltFromPlayer → applyBoltEffect）保留。W-1 仅携带 caster/命中/落点
     * 契约并返回结果；W-2 在旧分支观察 autoID；W-3 按真实接触逐格调用。
     * W-9 起基础定向状态/治疗共用 applyBasicBoltEffect；其它分支保持旧边界。
     *
     * 伤害类 bolt（SPARK/FIRE/DRAGONFIRE/POISON_DART/DISTANCE_ATTACK）不走
     * CE zap() 的 bolt 专属伤害公式——那个公式在 Combat.ts/CombatFormulas.ts
     * （本轮禁改）里没有对应实现，重新发明一套会绕开项目既有的命中/防御/
     * onHit 状态管线。改用 CombatSystem.attack(caster, target)：这正是 P4-1a
     * 之前 'ranged' 占位桩已经在用的既有口径（centaur 等），伤害走怪物自己的
     * damageString，命中率/onHit（MA_POISONS 等）全部沿用，是本项目对"怪物
     * 远程攻击伤害"的既定简化，不是本轮新发明的。
     */
    public castMonsterBolt(caster: Monster, target: Creature, ceBoltName: string): BoltResult | undefined {
        const meta = MONSTER_BOLT_TABLE[ceBoltName];
        if (!meta || meta.effect === null) return; // 已知缺口/未映射，不应该走到这里

        const visualBolt: BoltConfig = {
            id: `monster_bolt_${ceBoltName.toLowerCase()}`,
            ceType: meta.ceType,
            name: ceBoltName,
            effect: meta.effect,
            magnitude: meta.magnitude,
            char: '*',
            color: 0xffcc66,
            maxRange: 0,
            piercing: false,
            selfTargeting: false,
        };
        let autoID = false;
        const boltResult = traceBolt(this.grid, visualBolt, caster.loc, target.loc, this.boltWorld(caster), {
            onReflection: reflection => this.observeBoltReflection(reflection),
            onCell: (pos, hit) => {
                if (hit) autoID = this.applyMonsterBoltHit(caster, hit.creature, ceBoltName, meta) || autoID;
                autoID = this.applyBoltTerrainAt(visualBolt, pos) || autoID;
            },
        });
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
        const seenBefore = this.canObserveBoltTarget(target);

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
                // BE_ATTACK keeps weapon immunity; BE_DAMAGE keeps the legacy
                // monster attack formula pending its separately scoped formula work.
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

            case BoltEffect.NEGATION: {
                // P4-3：CE Items.c:4483-4491 negate() —— MONST_DIES_IF_NEGATED 直接死亡
                // 而非清状态（wisp/golem/spectral blade 等"纯魔法造物"被己方以外的
                // negation bolt 命中时会发生，例如敌对怪物对玩家的召唤物施放 negation）。
                // 助手对玩家目标也走清状态支（diesIfNegated 是 Monster 专属判定）。
                const before = JSON.stringify([target.hp, target.statusDurations]);
                const outcome = this.negateCreatureMagic(target);
                autoID = seenBefore && before !== JSON.stringify([target.hp, target.statusDurations]);
                if (!isPlayer && outcome === 'died') {
                    logCast('bolt.monster_cast_negation_dies', `${targetName} falls to the ground, lifeless!`, '#ffffff');
                } else {
                    // P1-28 / P2-2 的重推导与速度复原已并入 negateCreatureMagic。
                    logCast('bolt.monster_cast_negation', `${casterLabel} negates the magic on ${targetName}!`, '#ffffff');
                }
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
        for (const invItem of this.player.inventory.items) {
            ItemLoader.updateIdentifiableItem(invItem);
        }
        if (!this.player.inventory.items.some((invItem) => invItem.canBeIdentified)) {
            return false;
        }
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
        if (!this.player.inventory.items.includes(item)) return false;
        ItemLoader.updateIdentifiableItem(item);
        if (!item.canBeIdentified) return false;
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

    /** Keep the legacy weapon-first equipped-gear rule, including its RNG, intact.
     * W-7 adds pack arcana as alternatives; it does not add rings/charms/spare gear.
     */
    public canEnchantTarget(item: Item): boolean {
        return this.player.inventory.items.includes(item) && (canEnchantArcana(item)
            || item === (this.player.equippedWeapon ?? this.player.equippedArmor));
    }

    public chooseEnchantTarget(item: Item): boolean {
        if (!this.pendingEnchantment || this.isInputLocked() || this.isGameOver
            || this.player.hp <= 0 || !this.canEnchantTarget(item)) return false;
        if (canEnchantArcana(item)) {
            enchantArcana(item);
            logger.log(i18next.t('item.arcana_enchanted', { name: item.displayName,
                interpolation: { escapeValue: false }, defaultValue: 'Your {{name}} gleams briefly in the darkness.' }), '#99ddff');
        } else {
            this.enchantEquippedItem();
            logger.log(i18next.t('scroll.enchant', { defaultValue: 'Arcane force sharpens your gear.' }), '#99ddff');
        }
        this.pendingEnchantment = false;
        this.isInventoryOpen = false;
        this.needsRender = true;
        timeSystem.currentTick += this.player.movementSpeed;
        this.playerTurnEnded();
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
            // {{runic}} 暂为内部 id（如 paralyzing）——符文名的中文映射是既有
            // 缺口（物品名显示 {paralyzing} 同病），本轮只接 i18n 框架，登记报告。
            logger.log(i18next.t('item.runic_awakened', { name: target.name, runic: target.runicType, defaultValue: `${target.name} awakens a ${target.runicType} rune!` }), '#88ccff');
        }
        return true;
    }

    /** CE Items.c:7904 -> rechargeItems(STAFF | CHARM), all items in the pack.
     * CHARM uses the existing web cooldown representation; no charm model rewrite.
     */
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

    /**
     * negate() 的"清魔法"本体（B-3 抽取；此前在玩家 bolt 与怪物施法两处
     * NEGATION 分支各有一份，AoE 的 negationBlast 是第三个调用方——不复制
     * 第三份）。CE Items.c:4465 negate(creature*) 的 web 投影：
     *   - MONST_DIES_IF_NEGATED（仅怪物）→ 当场致死（killCreature(monst,false)
     *     的 web 等价口径 = takeDamage(hp)，P4-3 起沿用），返回 'died'；
     *   - 否则清空全部状态时长 → MONST 则 syncFlagDerivedStatuses（P1-28：
     *     web negate 不剥 behaviorFlags，旗标派生状态须重推导）→
     *     refreshSpeeds（P2-2：haste/slowed 清后衍生速度立即复原），返回
     *     'negated'。
     * CE negate() 其余支线（abilityFlags 剥离 / mutation 清除 / bolts 剥离 /
     * NEGATABLE_TRAITS 临时剥离）web 无载体，登记未实现（P1-28 注）。
     */
    private negateCreatureMagic(target: Creature): 'died' | 'negated' {
        if (target instanceof Monster && target.diesIfNegated()) {
            target.takeDamage(target.hp, true);
            return 'died';
        }
        const sd = target.statusDurations as Record<string, number>;
        for (const k of Object.keys(sd)) {
            sd[k] = 0;
        }
        target.restorePoison(); // existing negation clears countdown; clear concentration too
        target.restoreShield();
        if (target instanceof Monster) target.syncFlagDerivedStatuses();
        target.refreshSpeeds();
        return 'negated';
    }

    /**
     * Items.c:4827-4881 negationBlast(emitterName, distance)——SCROLL_NEGATION
     * 的 AoE（Items.c:8004-8006，distance = DCOLS）。discordBlast 的同构姊妹：
     *   1. 消息 "emits a numbing torrent of anti-magic!"（:4831）；
     *   2. colorFlash（:4833）web 无视觉系统载体，跳过（登记）；
     *   3. 先 negate(&player)（:4834，玩家自己也吃——状态全清，无消息）；
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
            if (this.negateCreatureMagic(m) === 'died') {
                logger.log(i18next.t('scroll.negation_monster_dies', {
                    target: m.name,
                    defaultValue: `${m.name} falls to the ground, lifeless!`
                }), '#ffffff');
            } else {
                // CE negate() 尾部 :4548-4552 的 per-monster combatMessage。
                logger.log(i18next.t('scroll.negation_stripped', {
                    target: m.name,
                    defaultValue: `${m.name} is stripped of special traits!`
                }), '#ffffff');
            }
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
                    // CE :4874 charges = charmRechargeDelay(kind, enchant1)。
                    // web 无护身符充能延迟系统（charmRechargeDelay 无实现、
                    // charms 无充能语义），登记 deferral——不能清零充能充数
                    // （CE 语义是"重置为再充能延迟"，不是清空）。
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

    /**
     * Items.c:4904-4939 crystalize(radius)——SCROLL_SHATTERING 的本体
     * （Items.c:8007-8010 卷轴侧先打消息再 crystalize(9)）。逐条：
     *   1. 全图扫描：欧氏距离² ≤ radius² 且非 IMPREGNABLE（:4911-4912——
     *      IMPREGNABLE 是 pmap 旗标，唯一置位源是机器蓝图 BP_IMPREGNABLE
     *      （Architect.c:938），web 无机器系统，该位恒 0，守卫结构性为真，
     *      登记无载体）；
     *   2. 仅当该格 **DUNGEON 层**的 tile 带 T_OBSTRUCTS_PASSABILITY |
     *      T_OBSTRUCTS_VISION 才处理（:4914——读 layers[DUNGEON]，不是
     *      cell.terrain 的最高优先级结果，否则盖了 SURFACE 层的墙被漏判）；
     *   3. layers[DUNGEON] = FORCEFIELD（:4916，直写层）→ 原地 spawn
     *      DF_SHATTERING_SPELL（:4917，碎石 tile web 无载体，DF 条目登记）；
     *   4. 格上有怪：MONST_ATTACKABLE_THRU_WALLS → 致死（inflictLethalDamage
     *      + killCreature 的 web 等价口径 = takeDamage(hp)）；否则
     *      freeCaptivesEmbeddedAt——web 无嵌墙俘虏载体（机器系统缺口），登记；
     *   5. 边界格覆写 CRYSTAL_WALL（:4928-4929 "boundary walls turn to
     *      crystal"——在 DF 之后，顺序照 CE）；
     *   6. 收尾 updateVision（:4935）——crystalize 当场改了视线阻挡，
     *      必须立即重算，不能等回合结算。
     *   colorFlash/displayLevel/refreshSideBar（:4936-4938）web 无对应载体，
     *   以 needsRender 收尾。
     *   启发式同步：web FOV/寻路读 cell.isOpaque/isPassable（setTerrain 的
     *   旧口径），直写层不经过 setTerrain，故按新 DUNGEON 地形重算——
     *   FORCEFIELD/CRYSTAL_WALL 都不挡视线 ⇒ 墙碎后玩家当场看穿。
     */
    private crystalizeFromPlayer(radius: number): void {
        const px = this.player.loc.x;
        const py = this.player.loc.y;
        for (let i = 0; i < DCOLS; i++) {
            for (let j = 0; j < DROWS; j++) {
                const distSq = (px - i) * (px - i) + (py - j) * (py - j);
                if (distSq > radius * radius) continue; // CE :4911 欧氏距离²
                const cell = this.grid.getCell(i, j);
                if (!cell) continue;
                // CE :4912 `!(pmap.flags & IMPREGNABLE)`：web 无机器蓝图系统，
                // 该位恒 0——守卫结构性为真（登记无载体）。
                const dungeonTile = cell.layers[DungeonLayer.DUNGEON]!;
                // CE :4914：读 DUNGEON 层的旗标，不是 cell.terrain 的竞速结果。
                if (!(TERRAIN_FLAGS[dungeonTile].flags & (T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_VISION))) continue;

                cell.layers[DungeonLayer.DUNGEON] = TerrainType.FORCEFIELD; // CE :4916
                // CE :4917 spawnDungeonFeature(DF_SHATTERING_SPELL)：该 DF 的
                // tile 是 RUBBLE（Globals.c:679，start=0 只落原点一格碎石），
                // web 无 RUBBLE 地形（登记于 DF_MISSING_TILES），catalogFeature
                // 对 null tile 抛错——落地无载体，spawn 跳过（零 RNG，CE 的
                // start=0 波前同样只标记原点）。RUBBLE 落地的轮次翻正为
                // 无条件 catalogFeature + spawnDungeonFeature。
                if (DUNGEON_FEATURE_CATALOG[DF.DF_SHATTERING_SPELL]?.tile !== null) {
                    spawnDungeonFeature(this.grid, i, j, catalogFeature(DF.DF_SHATTERING_SPELL), false);
                }

                const monst = this.getMonsterAt(i, j); // CE :4919 HAS_MONSTER
                if (monst) {
                    if (monst.hasBehavior('MONST_ATTACKABLE_THRU_WALLS')) {
                        monst.takeDamage(monst.hp, true); // CE :4922-4923 的 web 等价口径
                    }
                    // CE :4925 freeCaptivesEmbeddedAt(i, j)：web 无嵌墙俘虏
                    // 载体（机器系统缺口），登记 deferral。
                }
                if (i === 0 || i === DCOLS - 1 || j === 0 || j === DROWS - 1) {
                    cell.layers[DungeonLayer.DUNGEON] = TerrainType.CRYSTAL_WALL; // CE :4928-4929（DF 之后覆写）
                }
                // 启发式同步（见方法注）：FOV 遮挡 = cell.isOpaque。
                const eff = cell.terrain;
                cell.isPassable = !blocksPassability(eff);
                cell.isOpaque = blocksVision(eff);
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

    /**
     * CE 投掷射程（Items.c:7130）：12 + 2 × max(力量 − 虚弱量 − 12, 2)。
     * 注意下限是 2 不是 0——力 12 也能扔 16 格。web 的 weakened 状态时长
     * ≙ CE status[STATUS_WEAKENED]（虚弱量）。
     */
    private throwMaxDistance(): number {
        const weakness = this.player.statusDurations['weakened'] ?? 0;
        return 12 + 2 * Math.max(this.player.strength - weakness - 12, 2);
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

        if (!this.grid.isValidPos(tx, ty)) return;

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
        let thrown: Item;
        if (item.quantity > 1) {
            item.quantity--;
            thrown = Object.assign(
                new Item(item.name, item.char, item.color, item.category), item);
            // Object.assign 会把源件 id 一并覆盖过来——堆叠件与飞行件必须
            // 是两个可区分实体（落地拾回、按 id 查找都依赖这一点）
            thrown.id = allocateEntityId();
            thrown.quantity = 1;
            thrown.loc = { ...origin };
        } else {
            this.player.inventory.removeItem(item);
            if (isEquippedWeapon) this.player.unequip(item);
            thrown = item;
            thrown.loc = { ...origin };
        }

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
                    // 置位——miss 也激怒。web 无 ENTRANCED/魔法恐惧/CAPTIVE
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

    /**
     * P1-42：CE rogue.awarenessBonus（Rogue.h:2541）的 web 对应。
     * CE 由装备重算赋值（Items.c:8690 清零、8712 按 `20 × 感知戒指附魔`
     * 累加），影响两处：每步自动搜索强度（Time.c:2547）与主动搜索下限
     * （Time.c:2418/2427）。
     *
     * web 有 `ring_of_awareness` 物品（arcana.json:174），但现行语义是 web
     * 自创的（telepathy 状态 + 幻觉/麻痹抗性，Game.ts syncEquipmentStatuses /
     * getPlayerStatusResistance），**不是** CE 的 awarenessBonus——不在此强行
     * 接线（一件物品挂两套语义正是 P1-38 教训）。故恒回 CE 基线值 0，
     * 戒指接线登记为未实现（见 p1_42 报告）。
     */
    private awarenessBonus(): number {
        return 0;
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
     *   - 戒指 stealthBonus           Time.c:822-824  ❌ 略去——web 未实装
     *     （ring_of_stealth 属 D2 自创池，无代码消费）
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

        // B-1b：双戒指槽都要吃 awareness 抗性（CE updateRingBonuses 遍历两槽）
        for (const ring of this.player.rings()) {
            const ringIdentity = (ring as any)?.identityId as string | undefined;
            if (ringIdentity === 'ring_of_awareness') {
                if (status === 'confused' || status === 'hallucinating') {
                    nullifyChance += 0.25;
                    durationReduction += 1;
                } else if (status === 'paralyzed') {
                    nullifyChance += 0.1;
                    durationReduction += 1;
                }
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
        // B-1b：双戒指槽（CE updateRingBonuses 语义，两槽都生效）
        for (const ring of this.player.rings()) {
            const identityId = (ring as any).identityId as string | undefined;
            if (identityId === 'ring_of_awareness') {
                this.player.setStatusDuration('telepathy', 2);
            } else if (identityId === 'ring_of_regeneration') {
                this.player.setStatusDuration('regenerating', 2);
            }
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
            target.takeDamage(9999, true);
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
                    logger.log(i18next.t('runic.weapon.venom', { target: target.name, damage: poisonDmg, defaultValue: `Runic venom poisons the ${target.name} for ${poisonDmg} turns.` }), '#88dd88');
                }
                break;
            }
            case 'quietus': {
                target.takeDamage(9999, true);
                logger.log(i18next.t('runic.weapon.quietus', { target: target.name, defaultValue: `Runic magic instantly slays the ${target.name}!` }), '#ccaaff');
                break;
            }
            case 'slaying': {
                target.takeDamage(9999, true);
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

    /** Runtime attacks pass beforeDamage=true so armor acts before shielding
     * (CE Combat.c:1272,1325). Default preserves the public post-hit API. */
    public tryTriggerArmorRunic(attacker: Monster, incomingDamage: number, beforeDamage = false): number {
        let remainingDamage = incomingDamage;
        const prevent = (amount: number) => {
            remainingDamage -= amount;
            if (!beforeDamage) this.player.hp = Math.min(this.player.maxHp, this.player.hp + amount);
        };
        const armor = this.player.equippedArmor;
        if (!armor?.runicType) return remainingDamage;

        // CE 以 melee 形参区分近战/远程（Combat.c:896 applyArmorRunicEffect）。
        // web 仅有的两个调用点（Monster.ts 远程分支 dist>1 / 近战分支 dist<=1）
        // 以攻击者相邻性等价区分。
        const melee =
            Math.abs(attacker.loc.x - this.player.loc.x) <= 1 &&
            Math.abs(attacker.loc.y - this.player.loc.y) <= 1;

        // 符文强度吃 netEnchant（含力量修正、钳 [-20,50]），与 P1-11 的 playerDefense
        // 同源；取值口径与 Combat.ts:73-78 一致（strengthRequired 缺省 0）。
        const netEnch = netEnchant(armor.enchantment ?? 0, this.player.strength, armor.strengthRequired ?? 0);

        // W-4: reflection is resolved before bolt contact, including adjacent
        // casts. No post-damage half-hit shortcut and no second reflection roll.

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
                // CE distributes before the player's shield absorbs the remaining share.
                prevent(incomingDamage - share);
                for (const m of hitList) {
                    m.takeDamage(share, true);
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

        if (armor.runicType === 'respiration' && rng.randPercent(20)) {
            // CE 语义为毒气/蒸汽的常驻免疫（Time.c:411-424、Monsters.c:1414），
            // 与受击无关；效果与触发事件均不同，本轮保留现有行为（差异见报告）。
            // F-2b：原 'burning' as any 一行删除——temporaryImmunities 对燃烧
            // 无任何读者（P1-44 三重断线登记），是纯死代码；行为零变化。
            this.player.grantTemporaryImmunity('confused' as any, 1);
            armor.runicKnown = true;
            logger.log(
                i18next.t('runic.armor.respiration', {
                    defaultValue: `Your armor shields you from ambient hazards.`
                }),
                '#44ffff'
            );
            return remainingDamage;
        }

        if (armor.runicType === 'dampening' && rng.randPercent(25)) {
            // CE 语义为爆炸伤害的常驻吸收（Time.c:355-367），与受击无关；
            // 本轮保留现有行为（差异见报告）。
            const healBack = Math.min(incomingDamage, 2);
            prevent(healBack);
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
                prevent(absorbed);
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
            return remainingDamage;
        }

        if (armor.runicType === 'immunity') {
            // CE Combat.c:1058-1063（A_IMMUNITY）：被动常驻、无概率判定，仅当攻击者
            // 属于护甲的 vorpalEnemy 类别时伤害归零（monsterIsInClass）。web 物品模型
            // 尚无 vorpalEnemy 字段（本轮不可改 Item.ts），类别门无法落地——保留全额
            // 抵挡效果，仅移除恒真的 randPercent(100)（类别判定差距见报告）。
            prevent(incomingDamage);
            armor.runicKnown = true;
            logger.log(
                i18next.t('runic.armor.immunity', {
                    target: attacker.name,
                    defaultValue: `Your armor's immunity protects you from the ${attacker.name}!`
                }),
                '#ffff44'
            );
            return remainingDamage;
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
            this.resolvePoisonDamage(m);
        }
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
            // F-2b：燃烧自然燃尽（CE Time.c:2588 !--status → extinguishFireOnCreature
            // 的 "you are no longer on fire."）；蹚水灭火走 extinguishCreatureFire，
            // 不经过这条。（tickStatuses 返回类型是 StatusId[]，但逃生舱键
            // 'burning' 会在运行时出现——按存储侧同款口径比较字符串。）
            if ((status as string) === 'burning') logger.log(i18next.t('status.player.burning_off', { defaultValue: 'You are no longer on fire.' }), '#cccccc');
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
        if (res.hit && res.damage > 0) {
            const weaponStr = res.weaponName === 'bare hands' ? i18next.t('combat.bare_hands', { defaultValue: 'bare hands' }) : res.weaponName;
            if (res.backstab) {
                logger.log(i18next.t('combat.backstab', { monster: target.name, damage: res.damage, weapon: weaponStr, defaultValue: `You backstab the ${target.name} for ${res.damage} damage!` }), '#ff4444');
            } else if (lungeAttack) {
                // B-1 登记项由 P1-37 补齐：CE 对突进命中追加"（猛烈突刺）"
                // 措辞（Combat.c:1298-1299），中文 UI 走专用文案。
                logger.log(i18next.t('combat.lunge_hit', { monster: target.name, damage: res.damage, weapon: weaponStr, defaultValue: `You hit the ${target.name} for ${res.damage} damage with a vicious lunge!` }), '#ffcc00');
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
            if (weapon && !weapon.isProtected && weapon.enchantment >= -10) {
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
            logger.log(i18next.t('combat.defeat', { monster: target.name, defaultValue: `You defeated the ${target.name}!` }), '#ffaa00');
            this.stats.kills++;

            // B-1a：CE Combat.c:1427-1430——玩家近战击杀非无生命怪
            //（MB_WEAPON_AUTO_ID 在怪物生成时对非 MONST_INANIMATE 恒置，
            // Monsters.c:157-159）时扣减装备武器的熟悉度计数，满 20 杀实例亮。
            if (!target.hasBehavior('MONST_INANIMATE')
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

        const cloneData = (monsterData as MonsterData[]).find(d => d.id === defender.typeId);
        if (!cloneData) return;
        const clone = new Monster(spot.x, spot.y, cloneData);
        if (defender.mutation) {
            clone.mutate(defender.mutation);
        }
        clone.setStatusDuration('poisoned', defender.getStatusDuration('poisoned'));
        clone.restorePoison(defender.poisonAmount);
        clone.setStatusDuration('shielded', defender.getStatusDuration('shielded'));
        clone.restoreShield(defender.maxShield);
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
     *     web 等价，applyInstantExplosionAt）——伤害是 max(15-20, maxHP/2)
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
    private triggerDeathFeatures(): void {
        for (const m of this.monsters) {
            if (m.hp > 0) continue;
            if (m.deathEffectTriggered) continue;
            if (!m.hasAbility('MA_DF_ON_DEATH')) continue;
            m.deathEffectTriggered = true;

            if (m.typeId === 'bloat') {
                // G-1 折算：100（旧 0-100 密度）→ 2000 = DF_BLOAT_DEATH 的
                // startProbability（Globals.c:653，CE 的 bloat 毒气体积）。
                this.environment.addGas(m.loc.x, m.loc.y, GasType.POISON, 2000);
                logger.log(i18next.t('death.bloat_gas', {
                    name: m.name,
                    defaultValue: `The ${m.name} releases a cloud of caustic gas!`
                }), '#88ff88');
                this.needsRender = true;
            } else if (m.typeId === 'explosive_bloat') {
                // F-2c：CE 原链（Combat.c:1965-1967）——死亡 DF 经 DF 管线
                // 铺设，爆炸 tile 落到生物脚下当场结算瞬时伤害。石地板照铺
                // （fillSpawnMap 的 drawPriority 判据），与旧 igniteForced
                // 近似的"四方向火焰"形态一并退役。
                const feat = catalogFeature(DF.DF_BLOAT_EXPLOSION);
                const spawn = spawnDungeonFeature(this.grid, m.loc.x, m.loc.y, feat, false);
                this.applyInstantExplosionAt(spawn.builtCells);
                // CE :3235：新落火地形当场登记 CAUGHT_FIRE_THIS_TURN。
                if (spawn.caughtFireCells.length > 0) {
                    this.pendingCaughtFireCells = [
                        ...this.pendingCaughtFireCells,
                        ...spawn.caughtFireCells,
                    ];
                }
                logger.log(i18next.t('death.bloat_explosion', {
                    name: m.name,
                    defaultValue: `The ${m.name} explodes in a burst of flame!`
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
        if (this.onConfirmRequest) return this.onConfirmRequest(message);
        return true;
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
        if (this.player.hasStatus('hallucinating')) return false;   // !STATUS_CONFUSED
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
        } else if (cell?.layers.includes(TerrainType.HOLE)) {
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
            this.generateDepth(false);
            this.synchronizePlayerTimeState();

            // CE RogueMain.c:820-841：以旧渊格 (px,py) 为心落位。
            this.placePlayerOnFallLanding(px, py);

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
                    name: m.name,
                    defaultValue: `The ${m.name} plunges out of sight!`,
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
                    // CE :1561-1577：幸存者转层（leadership 降格与
                    // targetCorpseLoc 清理 web 无载体，登记）。
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
                || cell.layers.includes(TerrainType.STAIRS_DOWN)) return false;
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
        if (theItem.category !== ItemCategory.KEY) return false;
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

    private poisonedDuringTurn = false;

    private removeDeadMonsters(): void {
        // V-2b-6：死亡清扫前结算携带品掉落（CE Monsters.c:4075-4083
        // makeMonsterDropItem——击杀路径把 carriedItem 放回地面；CE 的
        // getQualifyingPathLocNear 择邻格语义 web 用"落怪原地"近似：怪物
        // 站的格必然可通行，登记偏差见报告）。CE 的物品落位守卫
        // （T_OBSTRUCTS_ITEMS | T_PATHING_BLOCKER）照抄——掉不进岩浆/深渊。
        for (const m of this.monsters) {
            if (m.hp > 0 || !m.carriedItem) continue;
            const dropCell = this.grid.getCell(m.loc.x, m.loc.y);
            if (dropCell && !isPathingBlocker(dropCell.terrain)) {
                m.carriedItem.loc = { x: m.loc.x, y: m.loc.y };
                this.items.push(m.carriedItem);
            }
            m.carriedItem = null;
        }
        this.monsters = this.monsters.filter(m => m.hp > 0);
    }

    private playerTurnEnded() {
        this.poisonedDuringTurn = this.player.hasStatus('poisoned');
        this.triggerDeathFeatures();
        this.removeDeadMonsters();

        // C-5：CE Time.c:2480-2486——玩家坠落在回合一切其余结算之前
        //（handleXPXP 之后、monstersFall 与推进循环之前）。playerFalls 内部
        // 会先让怪物随落（monstersFall，Time.c:1124），随后整段 return：
        // 坠落回合没有气味刷新、没有怪物推进。
        if (this.playerFalling) {
            this.playerFalls();
            return;
        }

        // C-5：CE Time.c:2486-2492——每个玩家回合末怪物坠落（注释原文：
        // 走得比环境更新更快的怪物不能悬在渊上行动）。CE :2492 位于
        // updateSafetyMap/气味等主观块之前；web 对应插在此处。
        this.monstersFall();

        this.syncEquipmentStatuses();

        // C-7 收尾轮补的每回合视野刷新：CE 里 updateVision 由每个动作结算
        // 路径 eager 调用（Movement.c:1942 移动 / Combat.c:802,968 攻击 /
        // Items.c:5509,5551 等），故 Time.c:2610 主观块读 currentStealthRange
        // 时 pmap 光照/IS_IN_SHADOW 恒新鲜。web 旧状只挂渲染钩子，headless
        // 或"动作已提交、渲染未跑"的窗口里光照是陈旧的——潜行会按玩家旧
        // 位置的暗态误判（p4_9 T1/T5 实证）。全程零 RNG 消费，不动生成流。
        this.updateVision();

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

        // ---- P1-42：每步低强度自动搜索（CE Time.c:2544-2552，主观玩家块、
        // 怪物推进之前）----
        // 站上任何一格只搜一次（Cell.autoSearched = CE SEARCHED_FROM_HERE，
        // Rogue.h:1090）；awarenessBonus 基线 0（见该方法注记），强度 30、
        // 半径 3。其后的充能清零：主动搜索只在连续回合累积，上一动作不是
        // 搜索（justSearched 为 false）则充能作废——CE Time.c:2550-2552。
        {
            const playerCell = this.grid.getCell(this.player.loc.x, this.player.loc.y);
            if (this.awarenessBonus() > -30 && playerCell && !playerCell.autoSearched) {
                this.searchForSecrets(this.awarenessBonus() + 30);
                playerCell.autoSearched = true;
            }
            if (!this.justSearched && this.searchingCharge > 0) {
                this.searchingCharge = 0;
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
                // C-5：CE Time.c:2866-2871——客观块内（环境瞬时结算）置位的
                // 玩家坠落旗标在本圈循环立即结算（CE 的 do-while 每圈在
                // applyInstantTileEffectsToCreature(&player) 之后检查）。
                if (this.playerFalling) {
                    this.playerFalls();
                    return;
                }
                // CE Time.c:2713-2715：岩浆/毒气等致死后立即退出推进
                if (this.isGameOver || this.player.hp <= 0) return;
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
     * - DFChance 地形特征生成 / monstersApproachStairs → web 无对应系统，跳过（报告已列）
     */
    private objectiveTimeBlock(): void {
        this.tickArcanaResources();

        // B-1a：CE Time.c:2664 processIncrementalAutoID——护甲/戒指的穿戴熟悉度
        // 在客观时间块内扣减（每 100 tick 恰好 1，与 rechargeItemsIncrementally(1)
        // 同源）。门槛 1000/1500 见 ItemLoader.ARMOR/RING_DELAY_TO_AUTO_ID。
        this.processIncrementalAutoID();

        // Time.c:2666 / Monsters.c:1128：每 100 tick monsterSpawnFuse--，
        // 归零触发周期刷怪并重置 fuse（CE 触发在 decrementPlayerStatus 尾部）
        if (this.mode !== 'test') {
            this.monsterSpawnFuse--;
            if (this.monsterSpawnFuse <= 0) {
                this.spawnPeriodicHorde();
                this.monsterSpawnFuse = rng.randRange(SPAWN_FUSE_MIN, SPAWN_FUSE_MAX);
            }
        }

        // Let environment update
        // F-2b：环境瞬时结算从块尾上移到晋升驱动之前，使块内次序对齐 CE
        // 客观块的怪物轨：applyInstantTileEffectsToCreature（Time.c:2671，
        // 踩火上状态/蹚水灭火/着火生物点燃所踩格）先于
        // decrementMonsterStatus（:2677，燃烧伤害结算）。落地燃烧状态机后
        // 该次序有实质语义：踩火当块"先挂状态、随后结算掉血"；蹚水当块
        // "先扑灭、结算段空转不掉血"。（CE 玩家轨是 per-action 的
        // playerTurnEnded 伤害 :2581 + 块尾 tile :2698；web 按 P2-3 既有的
        // 合并口径与怪物轨并轨，块内"环境→递减"对两轨取 CE 怪物序。
        // 差异登记：合并后玩家着火的首块伤害比 CE 提前一个动作出现。）
        this.applyEnvironmentalEffects();

        // F-2b：燃烧伤害结算在 tickCreatureStatuses 内（CE Time.c:2581-2591 /
        // Monsters.c:1877-1901），随本调用在环境段之后执行。
        this.tickCreatureStatuses();

        // C-5：CE updateEnvironment 的第一条语句（Time.c:1597 monstersFall）
        // ——100-tick 客观块内的渊上怪物在此坠落（先于晋升/火/气各段）。
        this.monstersFall();

        // C-4c：CE updateEnvironment 的晋升段（Time.c:1619-1684）——两趟随机
        // 晋升 + 记账趟。位置对应 CE 客观块里的 updateEnvironment（:2695，
        // 在 decrementPlayerStatus 之前）；web 的 updateFires/updateGases 承担
        // CE 的火/气体段，CE 的"晋升在火之前"次序据此保持。
        // F-2a：CE 的 CAUGHT_FIRE_THIS_TURN 在点燃瞬间生效（Architect.c:3235），
        // 下一 updateEnvironment 的晋升段据此跳过新火格的衰老掷骰（:1625）。
        // web 的旗标等价物归 Game 所有：玩家动作期间 ignite/igniteForced 攒下
        // 的登记必须在本块晋升驱动**之前**并入 skip 集，否则新点的火会被
        // 立即衰老（实测：起火当块即变 EMBERS、永不蔓延）。
        const queuedFire = this.environment.takeNewlyCaughtFire();
        const caughtFireSkip = queuedFire.length > 0
            ? [...this.pendingCaughtFireCells, ...queuedFire]
            : this.pendingCaughtFireCells;
        this.lastPromotionUpdate = runPromotionUpdate(this.grid, {
            keyOnTileAt: (x, y) => this.items.some(
                (it) => it.category === ItemCategory.KEY && it.loc.x === x && it.loc.y === y
            ),
            caughtFireCells: caughtFireSkip,
        });
        // AI-1：CE Time.c:2698——客观块内玩家所站格的 TM_PROMOTES_ON_CREATURE
        // 晋升（applyInstantTileEffectsToCreature(&player)）发生在 updateEnvironment
        // 的晋升段（:2695）**之后**：OPEN_DOOR 自带 promoteChance=10000
        // （Globals.c:329，rand_range(0,10000)<10000 ≈ 必然关门），玩家踩着门时
        // 晋升段先把开着的门关回，踩门晋升随即再次打开——净效果是"玩家站在
        // 门上时门保持开着，走开后门才在身后关上"（CE 原味）。web 此前唯一的
        // 踩门开门点在移动分支（handleSpecialTileEntry，先于本块的晋升驱动），
        // 开门被同一回合的环境晋升立即回弹——门西侧的气味（updateScent 的
        // T_OBSTRUCTS_SCENT 掩码穿不过关着的门）因此比 CE 少刷新一轮。此处按
        // CE 顺序补踩门晋升；promoteTile 本体无 RNG（Promotion.ts），不移流。
        const playerStepPromotions = promoteOnStep(this.grid, this.player.loc.x, this.player.loc.y);
        if (playerStepPromotions.length > 0) {
            this.lastPromotionUpdate.promotions.push(...playerStepPromotions);
            if (playerStepPromotions.some((r) => r.mutated)) this.needsRender = true;
        }
        // F-2a：CE :1665-1668 的记账趟语义——上回合遗留的起火登记在此清空，
        // 只有记账趟之后 WITHOUT_KEY 晋升新点的火存活到下一回合。
        this.pendingCaughtFireCells = this.lastPromotionUpdate.caughtFireRemaining;
        if (this.lastPromotionUpdate.renderDirty) {
            this.needsRender = true;
        }
        // DF 消息（CE :3370 message/playerCanSee 门控的游戏侧消费）：
        // 原点格对玩家可见才播，一次 spawn 至多一条。CE 目录描述是源文英文，
        // 与 CE 侧一致直记，不走 i18n（无键可译；报告已登记）。
        for (const p of this.lastPromotionUpdate.promotions) {
            if (p.spawn?.message && p.spawn.builtCells.some(
                (c) => this.grid.getCell(c.x, c.y)?.isVisible
            )) {
                logger.log(p.spawn.message, '#aaaaaa');
            }
        }
        // G-1：晋升链若接出了 GAS 层 DF（Architect.c:3384 volume 累加走
        // Cell.volume），镜像须对账一次。当前目录尚无已接线的 GAS DF
        // （归 G-2），本分支今天不可达——防御性对账，接线后即为活路径。
        if (this.lastPromotionUpdate.promotions.some((p) => (p.spawn?.gasVolumeAdded ?? 0) > 0)
            || this.lastPromotionUpdate.withoutKeyPromotions.some((p) => (p.spawn?.gasVolumeAdded ?? 0) > 0)) {
            this.environment.syncGasMirror();
        }

        // Let environment update
        // F-2a：updateFires 即 CE updateEnvironment 的火段（Time.c:1688-1700，
        // Promotion.runFireUpdate）。火段新登记的起火格（新点的火 + 上一玩家
        // 动作里 ignite/igniteForced 攒下的队列）并入 pendingCaughtFireCells，
        // 下一客观块的晋升驱动据此跳过它们的衰老掷骰（CE :1625 一格一回合
        // 至多晋升/衰老一次的语义）。遗留集不清丢：CE 的旗标活到下一记账趟。
        const fireCaught = this.environment.updateFires(this.pendingCaughtFireCells);
        if (fireCaught.length > 0) {
            this.pendingCaughtFireCells = [...this.pendingCaughtFireCells, ...fireCaught];
        }
        // F-2c：火段的爆炸落格（甲烷爆轰 → DF_EXPLOSION_FIRE）在落格瞬间
        // 结算（CE fillSpawnMap refresh 分支 Architect.c:3255-3260——发生在
        // 火段内部、updateVolumetricMedia 之前，故排干点在 updateGases 前）。
        // 顺带覆盖晋升趟落下的爆炸地形（本轮目录无此路径；CE promoteTile
        // :1268 同样 refreshCell=true，防御性对齐）。
        const explosiveCells = this.environment.takeExplosiveSpawnCells();
        for (const p of this.lastPromotionUpdate.promotions) {
            if (p.spawn) explosiveCells.push(...p.spawn.builtCells);
        }
        for (const p of this.lastPromotionUpdate.withoutKeyPromotions) {
            if (p.spawn) explosiveCells.push(...p.spawn.builtCells);
        }
        this.applyInstantExplosionAt(explosiveCells);
        // G-1：CE Time.c:1600-1616——先全场探测 GAS 层非空，非空才
        // `updateVolumetricMedia()` 连调**两次**（:1606 注释 "// update gases
        // twice"；一次调用 = 一轮 8 邻体积均分，两轮 = 气体每回合推进约
        // 2 格、消散期望也 ×2——QUICK 档约 −1.0/回合、SLOW 档约 −0.4）。
        // 探测守卫同时保住无气体回合的 RNG 流：updateVolumetricMedia 每格
        // 每轮各消耗一次随机舍入掷骰，空跑一回合就要白烧 2×DCOLS×DROWS 次
        // 抽取并移动后续一切随机事件（CE 的探测就是干这个的）。
        if (this.environment.hasVolumetricGas()) {
            this.environment.updateGases();
            this.environment.updateGases();
        }

        // （F-2b：applyEnvironmentalEffects 已上移到晋升驱动之前——见块首注释。
        // 燃烧/毒气等对生物的结算因此使用本块火/气演化**之前**的状态，与 CE
        // :2671 怪物 tile 段先于 updateEnvironment :2695 的取态一致。）

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
        this.removeDeadMonsters();

        // 主观饥饿结算：饥饿伤害 / 回血（CE Time.c:2523-2541，每玩家动作一次）
        const recovery = this.player.recoverPerTurn(this.poisonedDuringTurn);
        if (recovery === 'starving') {
            this.lastDamageSource = 'starvation';
        }

        if (this.mode === 'wizard') {
            // Wizard mode in stage-1 is intentionally permissive.
            this.player.hp = this.player.maxHp;
        }

        this.stats.turns++;

        // P1-42：CE Time.c:2874-2875——回合末清 justRested/justSearched。
        // justSearched 必须在下一动作前归 false，"连续回合充能"的判定
        // （playerTurnEnded 充能清零分支）才有意义。
        this.justSearched = false;

        if (this.player.hp <= 0 && !this.isGameOver) {
            let deathReason: string;
            if (this.lastDamageSource && this.lastDamageSource !== 'fire' && this.lastDamageSource !== 'steam' && this.lastDamageSource !== 'creeping death' && this.lastDamageSource !== 'starvation' && this.lastDamageSource !== 'poison' && this.lastDamageSource !== 'caustic gas') {
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
            } else if (this.lastDamageSource === 'caustic gas') {
                // G-3：POISON_GAS 按 CE 是直接伤害（T_CAUSES_DAMAGE），死因
                // 引 tile description（Time.c:622-625 "Killed by %s"，
                // "a cloud of caustic gas"）。
                deathReason = i18next.t('death.caustic_gas', { defaultValue: 'Killed by a cloud of caustic gas.' });
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
            // B-1b：实例鉴定态进存档（P1-48）。identified=undefined 的物品
            // （金币/食物/钥匙/护符等无未知态类别）JSON 落盘时自然丢键。
            identified: item.identified,
            canBeIdentified: item.canBeIdentified,
            maxChargesKnown: item.maxChargesKnown,
            // B-1c：实例 ITEM_MAGIC_DETECTED 进存档
            magicDetected: item.magicDetected,
            timesUsed: item.timesUsed,
            consumableId: (item as any).consumableId,
            arcanaInstanceVersion: item.arcanaInstanceVersion,
            maxCharges: item.maxCharges,
            charges: item.charges,
            staffRechargeRemaining: item.category === ItemCategory.STAFF
                ? restoreStaffRecharge(item.staffRechargeRemaining) : undefined,
            rechargeTurns: item.rechargeTurns,
            rechargeCounter: item.rechargeCounter,
            cooldownTurns: item.cooldownTurns,
            cooldownRemaining: item.cooldownRemaining,
            identityId: (item as any).identityId,
            // B-4b：钥匙绑定随存档往返（无绑定为空数组，JSON 落盘保留 []）
            keyLoc: item.keyLoc.map(k => ({ loc: { x: k.loc.x, y: k.loc.y }, machine: k.machine }))
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
        if (item.category === ItemCategory.STAFF || item.category === ItemCategory.WAND) {
            const isStaff = item.category === ItemCategory.STAFF;
            const table = isStaff ? ItemLoader.staffs : ItemLoader.wands;
            const legacyCapacity = table.find(cfg => cfg.id === s.identityId)?.maxCharges ?? 1;
            // Pure restoration only: never spawn/roll when reading old or current saves.
            Object.assign(item, restoreArcanaInstance(s, isStaff, legacyCapacity));
        }
        if (item.category === ItemCategory.STAFF) {
            item.staffRechargeRemaining = restoreStaffRecharge(s.staffRechargeRemaining);
        }
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
        // B-4b：钥匙绑定还原（旧存档无键 → 保持默认空数组）
        if (s.keyLoc) {
            item.keyLoc = s.keyLoc.map(k => ({ loc: { x: k.loc.x, y: k.loc.y }, machine: k.machine, disposableHere: k.disposableHere }));
        }
        // V-2b-6：生成层还原（旧存档无键 → undefined ≙ 当层，登记偏差见 Item 注）
        if (s.originDepth !== undefined) {
            item.originDepth = s.originDepth;
        }
        // B-1b：实例鉴定态直接落账（P1-48 反转 B-1a 的"按 spawn 语义重建"）。
        // 旧存档（B-1b 前，无 identified 键）保持旧行为：可未知类别按 spawn
        // 语义重建为未识别——读档即"鉴定全丢"的 B-1b 前既定迁移语义。
        if (s.identified === undefined) {
            const cat = item.category;
            if (cat === ItemCategory.WEAPON || cat === ItemCategory.ARMOR || cat === ItemCategory.POTION
                || cat === ItemCategory.SCROLL || cat === ItemCategory.WAND || cat === ItemCategory.STAFF
                || cat === ItemCategory.RING) {
                item.identified = false;
                item.canBeIdentified = true;
            } else {
                item.identified = true;
            }
        } else {
            item.identified = s.identified;
            item.canBeIdentified = s.canBeIdentified ?? false;
            item.maxChargesKnown = s.maxChargesKnown ?? false;
            item.timesUsed = s.timesUsed ?? 0;
        }
        // B-1c：实例 ITEM_MAGIC_DETECTED 落账；旧存档无此键 → false
        item.magicDetected = s.magicDetected ?? false;
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
                    layers: [...cell.layers],
                    char: cell.char,
                    color: cell.color,
                    isExplored: cell.isExplored,
                    hasMemory: cell.hasMemory,
                    isBurning: cell.isBurning,
                    isPassable: cell.isPassable,
                    isOpaque: cell.isOpaque,
                    // P1-37：机器旗标穿存档。0 不写（绝大多数格子无机器，省体积）
                    ...(cell.machineNumber !== 0 ? { machineNumber: cell.machineNumber } : {})
                });
            }
        }

        const gasGrid: GameSnapshot['gasGrid'] = [];
        for (let x = 0; x < this.grid.width; x++) {
            for (let y = 0; y < this.grid.height; y++) {
                const gas = this.environment.gasGrid[x]?.[y];
                if (!gas || gas.density <= 0) continue;
                // G-1：type=NONE 的不可见残气（CE 随机舍入的 volume 孤儿）
                // 不入档——无渲染无效果，且 addGas 的载体校验本来就会拒绝
                // NONE；旧档里 0-100 口径的旧枚举值则被 addGas 校验统一
                // 丢弃（登记报告）。
                if (gas.type === GasType.NONE) continue;
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
            ticksTillUpdateEnvironment: this.ticksTillUpdateEnvironment,
            pendingEnchantment: this.pendingEnchantment,
            impregnableCells: [...this.grid.impregnableCells],
            player: {
                loc: { x: this.player.loc.x, y: this.player.loc.y },
                hp: this.player.hp,
                maxHp: this.player.maxHp,
                strength: this.player.strength,
                nutrition: this.player.nutrition,
                maxNutrition: this.player.maxNutrition,
                statusDurations: { ...this.player.statusDurations },
                poisonAmount: this.player.poisonAmount,
                maxShield: this.player.maxShield,
                regenCarry: this.player.regenCarry,
                inventory: this.player.inventory.items.map((it) => this.serializeItem(it)),
                equippedWeaponId: this.player.equippedWeapon?.id ?? null,
                equippedArmorId: this.player.equippedArmor?.id ?? null,
                ringLeftId: this.player.ringLeft?.id ?? null,
                ringRightId: this.player.ringRight?.id ?? null,
                temporaryImmunities: { ...this.player.temporaryImmunities }
            },
            monsters: this.monsters.map((m) => this.serializeMonster(m)),
            // V-2b-5：休眠怪随存档往返（它们不在 monsters 里，漏了就是"读档后
            // 雕像里的怪凭空消失"）。旧存档无此字段 → 空表兜底。
            dormantMonsters: this.dormantMonsters.map((m) => this.serializeMonster(m)),
            items: this.items.map((it) => this.serializeItem(it)),
            // B-1b：全局种类鉴定态与绰号进存档（P1-48；Map 落盘为普通对象）
            identifiedItems: [...ItemLoader.identifiedItems],
            callTitles: Object.fromEntries(ItemLoader.callTitles),
            // B-1c：种类级极性揭示进存档
            magicPolarityRevealed: [...ItemLoader.magicPolarityRevealed],
            // V-1c：跨层奖励房配额计数随存档往返
            rewardRoomsGenerated: getRewardRoomsGenerated(),
            grid: gridCells,
            gasGrid,
            stats: { ...this.stats }
        };
    }

    /**
     * V-2b-5：怪物的快照序列化/反序列化抽出成对（原先是 toSnapshot 里的内联
     * map + loadSnapshot 里的内联 map，两处字段表必须人工保持同步；休眠怪
     * 也要走同一条路，顺势抽出，两半从此只有一份）。
     */
    private serializeMonster(m: Monster): GameSnapshotMonster {
        return {
            ...(m.typeId === 'spectral_blade' ? { spectralBlade: {
                isAlly: m.isAlly, boundToPlayer: m.boundToPlayer,
                doesNotTrackLeader: m.doesNotTrackLeader, ticksUntilTurn: m.ticksUntilTurn,
            } } : {}),
            id: m.id,
            loc: { x: m.loc.x, y: m.loc.y },
            name: m.name,
            char: m.char,
            color: m.color,
            hp: m.hp,
            maxHp: m.maxHp,
            damageString: m.damageString,
            regenTurns: m.regenTurns,
            regenCounter: m.regenCounter,
            state: m.state,
            statusDurations: { ...m.statusDurations },
            poisonAmount: m.poisonAmount,
            maxShield: m.maxShield,
            goldDropChance: m.goldDropChance,
            itemDropChance: m.itemDropChance,
            onHitStatus: m.onHitStatus,
            onHitChance: m.onHitChance,
            onHitDuration: m.onHitDuration,
            statusImmunities: Array.from(m.statusImmunities),
            statusResistTurns: { ...m.statusResistTurns },
            abilities: Array.from(m.abilities)
        };
    }

    private deserializeMonster(m: GameSnapshotMonster): Monster {
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
        const bladeData = m.spectralBlade ? (monsterData as MonsterData[]).find(d => d.id === 'spectral_blade') : undefined;
        const monster = new Monster(m.loc.x, m.loc.y, bladeData ?? data);
        monster.id = m.id;
        monster.hp = m.hp;
        monster.maxHp = m.maxHp;
        monster.state = m.state as any;
        monster.regenTurns = m.regenTurns ?? 0;
        monster.regenCounter = m.regenCounter ?? 0;
        monster.statusDurations = { ...(m.statusDurations ?? {}) };
        if (m.spectralBlade) {
            monster.isAlly = m.spectralBlade.isAlly === true;
            monster.boundToPlayer = m.spectralBlade.boundToPlayer === true;
            monster.doesNotTrackLeader = m.spectralBlade.doesNotTrackLeader === true;
            monster.ticksUntilTurn = Number.isFinite(m.spectralBlade.ticksUntilTurn)
                ? m.spectralBlade.ticksUntilTurn : monster.attackSpeed + 1;
            monster.syncFlagDerivedStatuses();
        }
        monster.restorePoison(m.poisonAmount);
        monster.restoreShield(m.maxShield);
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
        this.ticksTillUpdateEnvironment = snapshot.ticksTillUpdateEnvironment ?? 100;
        this.currentSeed = rng.seedRandomGenerator(snapshot.seed);
        ItemLoader.initConsumables();

        // B-1b：读档恢复全局种类鉴定态与绰号（P1-48）。initConsumables 已把
        // 两者清到开局态；旧存档（无字段）就停留在开局态 = B-1b 前"鉴定全丢"
        // 的既定迁移行为。
        if (snapshot.identifiedItems) {
            ItemLoader.identifiedItems.clear();
            for (const kindId of snapshot.identifiedItems) {
                ItemLoader.identifiedItems.add(kindId);
            }
        }
        if (snapshot.callTitles) {
            ItemLoader.callTitles.clear();
            for (const [kindId, title] of Object.entries(snapshot.callTitles)) {
                ItemLoader.callTitles.set(kindId, title);
            }
        }
        // B-1c：极性揭示回放（initConsumables 已清零；旧存档停在全零）
        if (snapshot.magicPolarityRevealed) {
            ItemLoader.magicPolarityRevealed.clear();
            for (const kindId of snapshot.magicPolarityRevealed) {
                ItemLoader.magicPolarityRevealed.add(kindId);
            }
        }

        // V-1c：奖励房配额计数恢复。旧存档无此字段 → 0（"开局态"兜底，
        // 见 GameSnapshot.rewardRoomsGenerated 注）。
        setRewardRoomsGenerated(snapshot.rewardRoomsGenerated ?? 0);

        logger.messages = [];
        timeSystem.currentTick = 0;
        this.clearRecording();
        this.clearReplay();

        this.depth = snapshot.depth;
        this.grid = new Grid(DCOLS, DROWS);
        this.grid.impregnableCells = new Set(snapshot.impregnableCells ?? []);
        this.dormantMonsters = []; // 读档重建（V-2b-5）：休眠怪不在 monsters 快照里
        this.bindDormantAwakener();
        for (const c of snapshot.grid) {
            const cell = this.grid.getCell(c.x, c.y);
            if (!cell) continue;
            if (c.layers) {
                // C-4a-0 新格式：四层原样还原。不走 setTerrainLayer——
                // "生产代码零调用点"的留痕约束；直填 layers 与存档逐层
                // 状态一一对应，也不动 char/color 之外的任何派生位。
                cell.layers = [
                    c.layers[0] ?? TerrainType.NOTHING,
                    c.layers[1] ?? TerrainType.NOTHING,
                    c.layers[2] ?? TerrainType.NOTHING,
                    c.layers[3] ?? TerrainType.NOTHING
                ];
                cell.char = c.char;
                cell.color = c.color;
            } else {
                // 旧格式（只有 terrain 字段）：按 setTerrain 语义还原——
                // terrain 进归属层、其余三层置 NOTHING。
                this.grid.setTerrain(c.x, c.y, c.terrain, c.char, c.color);
            }
            cell.isExplored = c.isExplored;
            cell.hasMemory = c.hasMemory;
            cell.isVisible = false;
            // F-2a：burnDuration/burnTerrain 随倒计时模型退役；isBurning 是
            // 派生读数不直写——旧存档迁移经下方对账分支写层（读的是存档
            // 数据里的 c.isBurning，不是派生位）。
            cell.isPassable = c.isPassable;
            cell.isOpaque = c.isOpaque;
            // P1-37：机器旗标随存档恢复（缺省 0 = 旧存档无此字段，视为无机器）。
            cell.machineNumber = c.machineNumber ?? 0;
            // F-1 起的镜像对账（F-2a 语义更新）：isBurning 恒等于层里的火地形。
            // 新存档两侧由派生保证，对账是空转；旧存档（数据 isBurning=true
            // 而层里无火——F-1 前的火不成地形）在此补写 SURFACE 火地形，
            // 反常组合（无火标志却有火地形）则摘除。
            const hadFire = cell.layers.some((t) => (TERRAIN_FLAGS[t].flags & T_IS_FIRE) !== 0);
            if (c.isBurning && !hadFire) {
                cell.layers[DungeonLayer.SURFACE] = TerrainType.PLAIN_FIRE;
            } else if (!c.isBurning && hadFire) {
                for (let l = 0; l < cell.layers.length; l++) {
                    if ((TERRAIN_FLAGS[cell.layers[l]!].flags & T_IS_FIRE) !== 0) {
                        cell.layers[l] = TerrainType.NOTHING;
                    }
                }
            }
        }

        this.environment = new EnvironmentManager(this.grid);
        // G-1：addGas 自带载体校验——旧档（0-100 口径的旧枚举值 2/3/4/5，
        // 以及 P1-45 幽灵气的 1）不再是合法 GAS 层地形值，统一被拒绝丢弃；
        // 新档的值就是 GAS 层地形原值，精确还原。
        for (const g of snapshot.gasGrid) {
            this.environment.addGas(g.x, g.y, g.type as GasType, g.density);
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
        this.player.restorePoison(snapshot.player.poisonAmount);
        this.player.restoreShield(snapshot.player.maxShield);
        this.player.regenCarry = snapshot.player.regenCarry ?? 0;
        this.player.refreshSpeeds(); // P2-2：状态直写绕过 applyStatus，需显式重算衍生速度
        this.player.inventory.items = snapshot.player.inventory.map((it) => this.deserializeItem(it));
        this.player.equippedWeapon = this.player.inventory.items.find((it) => it.id === snapshot.player.equippedWeaponId) ?? null;
        this.player.equippedArmor = this.player.inventory.items.find((it) => it.id === snapshot.player.equippedArmorId) ?? null;
        // B-1b：双戒指槽；旧存档的单槽 equippedRingId 迁移为左槽
        const legacyRingId = snapshot.player.ringLeftId ?? snapshot.player.equippedRingId ?? null;
        this.player.ringLeft = this.player.inventory.items.find((it) => it.id === legacyRingId) ?? null;
        this.player.ringRight = this.player.inventory.items.find((it) => it.id === snapshot.player.ringRightId) ?? null;
        this.player.temporaryImmunities = { ...(snapshot.player.temporaryImmunities ?? {}) };

        this.monsters = snapshot.monsters.map((m) => this.deserializeMonster(m));
        // V-2b-5：休眠怪还原进休眠表（不进 this.monsters——CE 同构）。
        this.dormantMonsters = (snapshot.dormantMonsters ?? []).map((m) => this.deserializeMonster(m));

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
        // 残留。P1-37 起旗标本身随存档往返（grid 格的 machineNumber 字段），
        // 据此重建——落位检查不再在读档层退化。
        this.machineCells = new Set();
        for (let x = 0; x < this.grid.width; x++) {
            for (let y = 0; y < this.grid.height; y++) {
                const cell = this.grid.getCell(x, y);
                if (cell && cell.machineNumber !== 0) this.machineCells.add(y * DCOLS + x);
            }
        }

        this.visibleMonsters.clear();
        this.visibleItems.clear();
        this.autoPath = [];
        this.discardInFlightAdvancement();
        this.everSeenItems.clear();
        this.everSeenMonsters.clear();
        this.levels.clear();
        this.isMouseTraveling = false;
        this.isInventoryOpen = false;
        this.pendingIdentify = false;
        this.pendingEnchantment = snapshot.pendingEnchantment ?? false;
        if (this.pendingEnchantment) this.isInventoryOpen = true;
        this.pendingArcana = null;
        // B-1c：恶意品确认待决态不得跨场景泄漏（与 pendingIdentify 同处复位）
        this.pendingUseConfirm = null;
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

    /**
     * CE fillSpawnMap refresh 分支（Architect.c:3255-3260）的爆炸部分：
     * 爆炸 tile 新落到某格时，对该格上的生物**当场**结算
     * applyInstantTileEffectsToCreature——这是"瞬时伤害"的出处（不经燃烧
     * 状态、不等下一个客观块）。免疫窗守卫在 resolveExplosionDamage 内，
     * 同一块多格命中同一生物只结算一次（首格上免疫，后续格被窗挡住——
     * CE 同款：applyInstantTileEffectsToCreature 每次调用都查 status）。
     * 调用点：bloat 死亡 DF（triggerDeathFeatures）、甲烷爆轰（火段后排干
     * takeExplosiveSpawnCells）、晋升趟落下的爆炸地形（本轮目录无此路径，
     * 防御性覆盖与 CE promoteTile refreshCell=true 对齐）。
     */
    private applyInstantExplosionAt(cells: Pos[]): void {
        if (cells.length === 0) return;
        const px = this.player.loc.x;
        const py = this.player.loc.y;
        for (const p of cells) {
            if (p.x === px && p.y === py) {
                this.resolveExplosionDamage(this.player);
            }
            for (const m of this.monsters) {
                if (m.hp > 0 && m.loc.x === p.x && m.loc.y === p.y) {
                    this.resolveExplosionDamage(m);
                }
            }
        }
    }

    /** Ordinary objective updates keep their original all-creature/gradual path.
     * Displacement evaluates just its recipient, without an extra gas damage tick
     * or global item destruction (CE instant versus gradual tile effects).
     */
    private applyEnvironmentalEffects(instantTarget?: Creature) {
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

            // Deep Water / Lava Death
            // 深水不致死（P1-27，决策 D2）：CE 的深水没有任何伤害（T_IS_DEEP_WATER
            // 只偷物品，Rogue.h:1937；坠落零伤害 Time.c:1146-1150），web 的淹死是
            // 自创内容，已通过 WEB_ONLY_DEEP_WATER_DROWNING 退出生效路径。
            // CE 深水的真实行为（50% 冲走携带物并随机移位，Time.c:556-590）属独立
            // 轮次，本轮不实现。悬浮/飞行生物照旧不进本分支。
            const isFlying = entity.hasStatus('flying') || entity.hasStatus('levitating') || (entity.abilities && entity.abilities.has('flying'));
            // F-1 跨层判定：火盖在深水/岩浆上不改变致死地形判据
            //（CE applyInstantTileEffectsToCreature 的 cellHasTerrainFlag 是全层 OR）
            if (cell.layers.includes(TerrainType.WATER_DEEP) && !isFlying) {
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
            } else if (cell.layers.includes(TerrainType.LAVA) && !isFlying
                && !entity.hasStatus('immune_fire')
                && !(entity.abilities && entity.abilities.has('immune_fire'))
                && !(entity.isInvulnerable && entity.isInvulnerable())
                && (!instantTarget || (!(cellTerrainFlags(this.grid, x, y) & T_ENTANGLES)
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

            if (instantTarget) {
                this.applyDisplacementTileEntry(instantTarget);
                // A teleport trap already committed and evaluated its new cell.
                if (instantTarget.loc.x !== x || instantTarget.loc.y !== y) return;
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

            // Explosion —— F-2c：爆炸瞬时伤害（Time.c:343-396，位于蜘蛛网段
            // 之后、毒气段 :411 之前的同一函数内——web 对应插在火段与气段
            // 之间）。守卫与免疫窗都在 resolveExplosionDamage 内；落格瞬间的
            // 另外两个调用点见 applyInstantExplosionAt。
            this.resolveExplosionDamage(entity);

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

                    // 有害气体伤害（T_CAUSES_DAMAGE，Time.c:592-640）：
                    // damage = max(1, maxHP/15 * ticks/100)（ticks=100 即
                    // max(1, ⌊maxHP/15⌋)——大怪更怕毒气，小怪保底 1）。
                    // 豁免 MONST_INANIMATE / MONST_INVULNERABLE / 潜水 +
                    // 玩家 respiration 符文（:614-624）。悬浮不豁免
                    // （CE 的悬浮守卫只在毒藤 T_CAUSES_POISON 分支）。
                    if (!instantTarget && (gasFlags & T_CAUSES_DAMAGE) !== 0 && !respirationImmune) {
                        const exempt = entity !== this.player
                            && ((entity as Monster).hasBehavior('MONST_INANIMATE')
                                || (entity as Monster).isInvulnerable());
                        if (!exempt) {
                            const damage = Math.max(1, Math.floor(entity.maxHp / 15));
                            entity.hp -= damage; // CE Time.c:616-632: gradual terrain damage bypasses shields.
                            if (entity === this.player) {
                                this.lastDamageSource = gasTile === TerrainType.STEAM ? 'steam' : 'caustic gas';
                                const msgKey = gasTile === TerrainType.STEAM
                                    ? 'env.player_scalded'
                                    : 'env.player_poison_gas';
                                logger.log(i18next.t(msgKey, {
                                    defaultValue: gasTile === TerrainType.STEAM
                                        ? 'The steam scalds you!'
                                        : 'You breathe in toxic fumes!'
                                }), gasTile === TerrainType.STEAM ? '#cccccc' : '#aaeeaa');
                            }
                            if (entity.hp <= 0 && entity !== this.player) entity.die();
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
        };

        if (instantTarget) {
            checkEntity(instantTarget, instantTarget.name);
            return;
        }
        checkEntity(this.player, 'Player');
        for (const m of this.monsters) {
            checkEntity(m, m.name);
        }

        // CE updateEnvironment clears PRESSURE_PLATE_DEPRESSED each objective block.
        this.displacementTrapDepressions?.delete(this.grid);

        // Destroy items in lava
        for (let i = this.items.length - 1; i >= 0; i--) {
            const item = this.items[i];
            if (!item) continue;
            const itemCell = this.grid.getCell(item.loc.x, item.loc.y);
            if (itemCell && itemCell.layers.includes(TerrainType.LAVA)) { // F-1 跨层判定
                // Potions might shatter or boil, but for now they just burn up
                logger.log(i18next.t('item.destroyed_lava', { name: item.name, defaultValue: `${item.name} burns up in the lava.` }), '#aa5555');
                this.items.splice(i, 1);
            }
        }
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
            // ★ 半落：CE 同时置 creatureMode = MODE_PERM_FLEEING，web 无该维
            //（Monster.ts 不在本轮授权清单），故永久性缺位——登记报告 §3。
            mon.state = MonsterState.FLEEING;
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
                    !nextCell.layers.includes(TerrainType.WATER_DEEP) && // F-1 跨层判定
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

        this.travelTargetItem = this.items.find(i => i.loc.x === x && i.loc.y === y);

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

        logger.log('重置踏板触发：房间已重置。', '#88ccff');
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
                logger.log(`告示牌：${text}`, '#ffee88');
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

        // C-4c：TM_PROMOTES_ON_STEP 的玩家侧触发（CE Time.c:278-288
        // pressurePlate 的 ON_CREATURE 分支；玩家入场即 ON_CREATURE）。
        // 放在既有特化处理之后：PRESSURE_PLATE 已被 web 自己的
        // triggerPressurePlate 写成 FLOOR，这里的逐层扫描自然不会再看见它
        // （web 板语义吸收了 CE 的板晋升）；DOOR 在上方无分支，从这里走
        // CE 链（vanish→DF_OPEN_DOOR）真正开门。
        const stepResults = promoteOnStep(this.grid, this.player.loc.x, this.player.loc.y);
        for (const r of stepResults) {
            if (r.mutated) this.needsRender = true;
        }
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
     *   - 密格判据：CE 是 cellHasTMFlag(TM_IS_SECRET)；web 取
     *     terrain === SECRET_DOOR——TM_IS_SECRET 在 web 目录中的唯一持有者
     *     就是 SECRET_DOOR（目录级等价由 p1_42 测试的绊线断言钉死）。写成
     *     字段读取会触发 c_4a 目录留痕的白名单红灯（本轮禁改那三个测试
     *     文件，见 discoverSecretAt 注记的冲突申报）；
     *   - rand_percent 语义与 web randPercent 逐位一致（先抽
     *     rand_range(0,99) 再 clamp 比较，CE Math.c:62-65）——**percent ≤ 0
     *     也消耗一次抽取**，不可"剪枝跳过"，否则 RNG 流位移。
     *
     * 返回是否发现了什么（CE 返回值；当前无消费者，留作对齐）。
     */
    private searchForSecrets(searchStrength: number): boolean {
        // 每层一次的全格预扫守卫：无未发现密门的层零开销短路（见字段注记）。
        if (this.secretScanDepth !== this.depth) {
            this.levelHasSecrets = false;
            for (let x = 0; x < this.grid.width && !this.levelHasSecrets; x++) {
                for (let y = 0; y < this.grid.height; y++) {
                    if (this.grid.getCell(x, y)?.layers.includes(TerrainType.SECRET_DOOR)) { // F-1 跨层判定
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
                if (cell && cell.layers.includes(TerrainType.SECRET_DOOR)) { // F-1 跨层判定
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

    /**
     * P1-42：CE discover(x, y)（Movement.c:2437-2457）对 SECRET_DOOR 的
     * 等效实现——密格显形为门。
     *
     * CE 的顺序是先清密格所在层（DUNGEON→FLOOR，:2444-2451）再走
     * discoverType 的 DF 落地链（:2452，五形参见 Rogue.h:2933；
     * DF_SHOW_DOOR = 单格、无传播、DUNGEON 层落 DOOR，Globals.c:624）。
     * 对 SECRET_DOOR 这一特例，净效果就是"该格 DUNGEON 层变 DOOR"。
     *
     * ★ 留痕与文件边界的冲突申报（第 7 起，项目常识"留痕规矩"）★
     * 走 CE 原样（清层 + DF 目录落地）会给三份 C-4 留痕接上第一个游戏侧
     * 读者——c_4b F1（DF 子系统符号白名单）、c_4a_0（落层写入口白名单）、
     * c_4a 目录（promote/fire 字段读者白名单）——而本轮禁改清单不含这三个
     * 测试文件（"违反即本轮作废"），任务书也未按常识要求提前把它们列入
     * 允许清单。故本实现取**今日逐位等价**的直写形态：setTerrain(DOOR)
     * （与被替换的旧 30% 代码同一写入口，且同时更新 char/color/isPassable/
     * isOpaque——CE 落地链走的层感知写入口不更新这些，直写反而免去补写）。
     * 等价前提"web 地形目录中 TM_IS_SECRET 的唯一持有者是 SECRET_DOOR"
     * 由 p1_42_secret_door_search.test.ts 的目录绊线断言钉死；该前提被
     * 打破时，本方法应迁移为 CE 原样（清层 + DF 链）并由验收方扩三份
     * 白名单。
     */
    private discoverSecretAt(x: number, y: number): boolean {
        const cell = this.grid.getCell(x, y);
        if (!cell || !cell.layers.includes(TerrainType.SECRET_DOOR)) return false; // F-1 跨层判定

        this.grid.setTerrain(x, y, TerrainType.DOOR, '+', 0xaa8844);
        cell.isDiscovered = true;
        logger.log(i18next.t('trap.secret_door_found', { defaultValue: 'You discovered a hidden door!' }), '#ffff88');
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

    /** Pressure plate triggers all TRAP cells within radius 3. */
    private triggerPressurePlate(px: number, py: number, target: Creature = this.player) {
        logger.log(i18next.t('trap.pressure_plate', { defaultValue: 'You step on a pressure plate! Nearby traps spring to life!' }), '#ffcc44');
        for (let dx = -3; dx <= 3; dx++) {
            for (let dy = -3; dy <= 3; dy++) {
                if (dx === 0 && dy === 0) continue;
                const nx = px + dx;
                const ny = py + dy;
                const cell = this.grid.getCell(nx, ny);
                if (cell?.layers.includes(TerrainType.TRAP)) { // F-1 跨层判定
                    this.triggerTrap(nx, ny, cell, target);
                }
            }
        }
        // Convert plate to floor after use
        consumeTrapTile(this.grid, px, py);
        this.needsRender = true;
    }

    /** CE Items.c:5516-5555. Both forward blink and beckoning commit through
     * W-11's placement primitive, including hazards, vision and player pickup.
     * Web has no SUBMERGED/STUCK/scent-turn carrier; leaving a web disentangles
     * without deleting it. SEIZED is not a synonym for CE STATUS_STUCK.
     */
    private finishBlink(result: BoltResult): boolean {
        return !!result.caster && !!result.landingPos
            && this.placeCreature(result.caster, result.landingPos, { pickupBeforeVision: true });
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
    public placeCreature(target: Creature, destination: Pos, options: { pickupBeforeVision?: boolean } = {}): boolean {
        if (target.hp <= 0 || (target.loc.x === destination.x && target.loc.y === destination.y)
            || !canPlaceCreature(this, target, destination)) return false;
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
        const candidates = teleportCandidates({ grid: this.grid, player: this.player, monsters: this.monsters, dormantMonsters: this.dormantMonsters, machineCells: this.machineCells }, target);
        if (candidates.length === 0) return false;
        const destination = candidates[rng.randRange(0, candidates.length - 1)]!;
        if (!this.placeCreature(target, destination)) return false;
        // STATUS_STUCK has no web state: web webs impede only movement from the
        // current tile, so magical relocation already disentangles without erasing
        // the web. SEIZED/SEIZING are deliberately retained, as in CE teleport.
        if (target instanceof Monster && this.waypoints) {
            this.waypoints.chooseNewWanderDestination(target, this.wpContext());
        }
        return true;
    }

    /** CE freeCaptive -> becomeAllyWith (Movement.c:726-758).
     * isAlly + leader=null is this engine's player-follower representation.
     * Ordinary key/cage rescue is intentionally not migrated in W-11.
     */
    public freeCaptive(monster: Monster): void {
        if (!monster.isCaged) return;
        let replacement: Monster | null = null;
        const groups = [this.monsters, this.dormantMonsters ?? [],
            ...[...(this.levels?.values() ?? [])].flatMap(level => [level.monsters, level.dormantMonsters ?? []])];
        for (const group of groups) for (const follower of group) {
            if (follower === monster || follower.leader !== monster) continue;
            if (follower.isDormant) follower.leader = null;
            else if (!replacement) { replacement = follower; follower.leader = null; }
            else {
                follower.leader = replacement;
                follower.targetWaypointIndex = monster.targetWaypointIndex;
                if (follower.targetWaypointIndex >= 0 && follower.waypointAlreadyVisited) {
                    follower.waypointAlreadyVisited[follower.targetWaypointIndex] = false;
                }
            }
        }
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
                        || !!this.grid.getCell(x, y)?.layers.some(t => t === TerrainType.STAIRS_UP || t === TerrainType.STAIRS_DOWN),
                    isMachineCell: (x, y) => !!this.machineCells?.has(y * DCOLS + x)
                        || !!this.grid.getCell(x, y)?.machineNumber,
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
        monster.seized = false;
        monster.state = MonsterState.WANDERING;
        logger.log(i18next.t('monster.freed', {
            monster: monster.name,
            defaultValue: `The ${monster.name} is grateful for its freedom and joins you!`
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
        // G-1：hover 的地形名优先取 GAS 层（CE tileText/tileFlavor 走
        // highestPriorityLayer(x,y,false)——含气层，Movement.c:106/113；
        // 站进毒气时 CE 悬浮提示显示"a cloud of caustic gas"）。
        // terrain getter 本身固定 skipGas（Grid.ts G-1 注：玩法读者走旗标
        // 并集世界），显示侧的气体偏好在这里补。
        const gasTile = cell.layers[DungeonLayer.GAS]!;
        const tName = this.getTerrainName(
            gasTile !== TerrainType.NOTHING ? gasTile : cell.terrain
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

        if (cell.layers.includes(TerrainType.SIGN)) { // F-1 跨层判定
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
            logger.log(i18next.t('move.path_blocked', { defaultValue: 'Path blocked.' }), '#ffaa88');
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
