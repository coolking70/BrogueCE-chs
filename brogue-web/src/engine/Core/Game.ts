/**
 * src/engine/Core/Game.ts
 * Main game state and orchestration
 */
import { Grid, TerrainType, DCOLS, DROWS, LightType } from '../Map/Grid';
import { Architect } from '../Generator/Architect';
import type { MachineResult } from '../Generator/BlueprintEngine';
import blueprintData from '../../data/blueprints.json';
import { Player, type HungerState } from '../../entities/Player';
import { Monster } from '../../entities/Monster';
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
import { ensureEntityIdAbove, type StatusId } from '../../entities/Creature';
import { timeSystem } from '../Systems/Time';
import { generateMonsterDetail, generateItemDetail, type DetailInfo } from '../UI/DetailGenerator';
import { logger } from '../Systems/Logger';
import { Pathfind } from '../Map/Pathfind';
import i18next from 'i18next';

import { EnvironmentManager } from '../Environment/Gas';
import { FOVSys } from '../Lighting/FOV';
import { LightMap } from '../Lighting/LightMap';
import { FloatingText } from '../Visuals/FloatingText';
import { STATUS_CONFIG } from '../Status/statusConfig';
import { getBoltForItem, boltPath, buildBoltFrames, BoltEffect, type BoltConfig, type BoltFrame, type BoltResult } from '../Combat/Bolt';

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
                visibleItems: this.visibleItems
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

            // Reposition player to stairs
            const targetStairType = isGoingUp ? TerrainType.STAIRS_DOWN : TerrainType.STAIRS_UP;
            let foundStair = false;
            for (let x = 0; x < this.grid.width; x++) {
                for (let y = 0; y < this.grid.height; y++) {
                    if (this.grid.getCell(x, y)?.terrain === targetStairType) {
                        this.player.loc.x = x;
                        this.player.loc.y = y;
                        foundStair = true;
                        break;
                    }
                }
                if (foundStair) break;
            }
        } else {
            // 1. Generate new level
            this.stats.maxDepth = Math.max(this.stats.maxDepth, this.depth);
            const architect = new Architect();
            this.grid = architect.generateLevel(this.depth);
            this.environment = new EnvironmentManager(this.grid);
            this.fov = new FOVSys(this.grid);
            this.lightMap = new LightMap(this.grid);

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

        if (!isFirstLevel) {
            if (isGoingUp && stairsDownPos) {
                this.player.loc.x = stairsDownPos.x;
                this.player.loc.y = stairsDownPos.y;
            } else if (!isGoingUp && stairsUpPos) {
                this.player.loc.x = stairsUpPos.x;
                this.player.loc.y = stairsUpPos.y;
            }
        }

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

        this.grid = new Grid(DCOLS, DROWS);
        this.environment = new EnvironmentManager(this.grid);
        this.fov = new FOVSys(this.grid);
        this.lightMap = new LightMap(this.grid);

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
                if (cell && (cell.isVisible || telepathyRevealed) && m.hp > 0) {
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

                if (blockingMonster) {
                    // Attack
                    const res = CombatSystem.attack(this.player, blockingMonster);
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
                            logger.log(i18next.t('combat.backstab', { monster: blockingMonster.name, damage: res.damage, weapon: weaponStr, defaultValue: `You backstab the ${blockingMonster.name} for ${res.damage} damage!` }), '#ff4444');
                        } else {
                            logger.log(i18next.t('combat.hit', { monster: blockingMonster.name, damage: res.damage, weapon: weaponStr, defaultValue: `You hit the ${blockingMonster.name} for ${res.damage} damage with ${weaponStr}.` }), '#ffcc00');
                        }
                        this.spawnFloatingText(`-${res.damage}`, blockingMonster.loc.x, blockingMonster.loc.y, 0xff5555);
                        // Handle runic trigger (enchantment-scaled chance computed in Combat.ts)
                        if (res.triggeredRunic) {
                            this.applyWeaponRunicEffect(blockingMonster, res.damage, res.triggeredRunic);
                        } else {
                            this.tryTriggerWeaponRunic(blockingMonster, res.damage);
                        }
                        this.spawnBlood(blockingMonster.loc.x, blockingMonster.loc.y);
                    } else {
                        logger.log(i18next.t('combat.miss', { monster: blockingMonster.name, defaultValue: `You missed the ${blockingMonster.name}.` }), '#888888');
                        this.spawnFloatingText(i18next.t('combat.miss_float', { defaultValue: 'Miss' }), blockingMonster.loc.x, blockingMonster.loc.y, 0xaaaaaa);
                    }

                    // Check if monster died
                    if (blockingMonster.hp <= 0) {
                        logger.log(i18next.t('combat.defeat', { monster: blockingMonster.name, defaultValue: `You defeated the ${blockingMonster.name}!` }), '#ffaa00');
                        this.stats.kills++;

                        // Handle Drops
                        if (rng.randPercent(Math.floor(blockingMonster.goldDropChance * 100))) {
                            const goldItem = new Item('Gold', '$', 0xffda75, ItemCategory.GOLD);
                            goldItem.loc = { ...blockingMonster.loc };
                            this.items.push(goldItem);
                        }

                        if (rng.randPercent(Math.floor(blockingMonster.itemDropChance * 100))) {
                            const isWeapon = rng.randPercent(50);
                            let droppedObj;
                            if (isWeapon) {
                                droppedObj = ItemLoader.spawnWeapon(rng.randPercent(50) ? 'dagger' : 'sword', blockingMonster.loc.x, blockingMonster.loc.y);
                            } else {
                                droppedObj = ItemLoader.spawnArmor(rng.randPercent(50) ? 'leather_armor' : 'chain_mail', blockingMonster.loc.x, blockingMonster.loc.y);
                            }
                            if (droppedObj) this.items.push(droppedObj);
                        }
                    }

                    this.needsRender = true;
                    // CE Time.c:2438：攻击耗时 = attackSpeed，在结算处累加
                    this.playerRecoversFromAttacking();
                    timeSystem.currentTick += this.player.attackSpeed;
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

                    // Move
                    this.player.loc.x = newX;
                    this.player.loc.y = newY;
                    this.needsRender = true;

                    // CE 的玩家移动耗时与地形无关（Time.c:2604 只看 movementSpeed）；
                    // web 原有的"泥泞 ×2"为自创口径，按 D1 移除。
                    timeSystem.currentTick += this.player.movementSpeed;

                    this.handleSpecialTileEntry();
                }

                if (this.needsRender) {
                    this.playerTurnEnded();
                }

            } else {
                // rest
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
                if (target) {
                    target.takeDamage(magnitude);
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
                    }
                } else {
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
                        m.takeDamage(magnitude);
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
                    // Remove all status effects from the target
                    if ('statusDurations' in target) {
                        const sd = (target as any).statusDurations as Record<string, number>;
                        for (const k of Object.keys(sd)) {
                            sd[k] = 0;
                        }
                    }
                    target.refreshSpeeds(); // P2-2：haste/slowed 被清，衍生速度立即复原
                    logger.log(i18next.t('bolt.negation_hit', {
                        name: item.name, target: target.name,
                        defaultValue: `${item.name} negates all magic on the ${target.name}!`
                    }), '#ffffff');
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

    private calculateStealthRange(): number {
        // Base range
        let range = 3;

        // Armor penalty
        if (this.player.equippedArmor) {
            range += Math.max(0, this.player.equippedArmor.weight - 2);
        }

        // Lighting modifier (if standing in light, much easier to see)
        const playerCell = this.grid.getCell(this.player.loc.x, this.player.loc.y);
        if (playerCell && playerCell.light === LightType.LIT) {
            range += 4;
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

    /**
     * CE Time.c:2438-2450 playerRecoversFromAttacking：玩家攻击的回合耗时在
     * 攻击结算处累加进 ticksUntilTurn，playerTurnEnded 的 ==0 分支因此跳过
     * movementSpeed——攻击耗时 = attackSpeed（haste/slow 同步生效）。
     * CE 的 ITEM_ATTACKS_STAGGER/QUICKLY 武器修正分支无法实现：web 武器数据
     * 模型没有 flags 字段（weapons.json 无该键，Item.ts 本轮禁改），详见报告。
     */
    private playerRecoversFromAttacking(): void {
        if (this.player.ticksUntilTurn >= 0) {
            this.player.ticksUntilTurn += this.player.attackSpeed;
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
     * 动画分帧（决策 E1）：animationEnabled=false（headless/默认）时一次性同步
     * 跑完整个循环 + 收尾，与 P2-1 逐格等价（速度本身除外）；true 时启动
     * 分步推进，每次怪物行动单独渲染一帧，期间输入被锁（见 beginAdvancement）。
     */
    private playerTurnEnded() {
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

        if (this.animationEnabled) {
            this.beginAdvancement(stealthRange);
            return;
        }

        const iter = this.advancementLoop(stealthRange);
        let step = iter.next();
        while (!step.done) step = iter.next();
        this.finishTurnEpilogue();
    }

    /**
     * CE Time.c:2643-2752 推进主循环的可分步版本：每个怪物行动后 yield 一次，
     * 供动画模式逐帧消费；同步模式一次性跑完（生成器同源，保证两条路径的
     * 调度语义永不漂移）。
     */
    private *advancementLoop(stealthRange: number): Generator<void, void, void> {
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
            }

            // CE Time.c:2720-2745：归零怪物行动。行动耗时按类型落账：
            // 攻击/施法出口在 Monster.takeTurn 内已置 attackSpeed（含
            // MONST_CAST_SPELLS_SLOWLY ×2）；移动/跳过（麻痹/俘虏/入迷等
            // takeTurn 早退）留 <= 0，由这里统一置 movementSpeed（CE
            // Time.c:2731 的不行动口径）。注意此处不 refreshSpeeds——公有
            // moveSpeed/attackSpeed 是"当前值"，直接写即生效（legacy 回置
            // 依赖此语义），重算反而会覆盖外部写入。
            for (const m of this.monsters) {
                if (this.isGameOver) break; // CE Time.c:2721 的 gameHasEnded 守卫
                if (m.hp > 0 && m.ticksUntilTurn <= 0) {
                    m.takeTurn(this, stealthRange);
                    if (m.ticksUntilTurn <= 0) {
                        m.ticksUntilTurn = m.movementSpeed;
                    }
                    yield; // P2-2 逐次动画：每次怪物行动单独一帧
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

    // ---- P2-2 逐次动画 + 输入锁（决策 E1）----

    /**
     * 动画开关：headless（harness/默认构造）为 false——playerTurnEnded 同步跑完，
     * 测试零开销、不阻塞；GameCanvas 挂载时置 true，怪物行动改为逐帧演出。
     */
    public animationEnabled: boolean = false;
    /** 一次怪物行动帧的展示时长（ms）。80ms ≈ 12.5 行动/秒：单步移动可辨认、成群怪不拖沓。 */
    public animationStepIntervalMs: number = 80;
    /** 输入锁硬上限（ms）：推进无论因何种原因卡住，超时后强制快进收尾。 */
    private static readonly ANIMATION_LOCK_TIMEOUT_MS = 5000;

    /** 推进进行中（怪物行动动画未播完）。配合 animationLockDeadline 构成自过期锁。 */
    public isAdvancing = false;
    /** 推进循环内捕获的最近异常（保底路径的诊断/测试观测点，正常推进恒为 null）。 */
    public lastAdvancementError: unknown = null;

    private advancementIter: Generator<void, void, void> | null = null;
    private animationAccumulatorMs = 0;
    private animationLockDeadline = 0;

    /**
     * 玩家输入是否被锁定。锁有两个独立保险：
     * ① deadline 比对——即便收尾代码因任何原因没有执行，锁也会在
     *    ANIMATION_LOCK_TIMEOUT_MS 后自动失效（自过期，绝不永久卡死）；
     * ② finishAdvancement 的 try/finally 式收尾——异常、超时、正常完成三条
     *    路径都汇入同一处解锁逻辑。
     */
    public isInputLocked(): boolean {
        return this.isAdvancing && Date.now() < this.animationLockDeadline;
    }

    /** 动画模式入口：建立分步推进并锁输入。收尾在 finishAdvancement。 */
    private beginAdvancement(stealthRange: number): void {
        this.advancementIter = this.advancementLoop(stealthRange);
        this.isAdvancing = true;
        this.lastAdvancementError = null;
        this.animationAccumulatorMs = 0;
        this.animationLockDeadline = Date.now() + Game.ANIMATION_LOCK_TIMEOUT_MS;
    }

    /** 渲染循环驱动：按 animationStepIntervalMs 的节拍消费推进步。 */
    public tickAdvancement(deltaMs: number): void {
        if (!this.isAdvancing || !this.advancementIter) return;
        this.animationAccumulatorMs += deltaMs;
        while (this.isAdvancing && this.animationAccumulatorMs >= this.animationStepIntervalMs) {
            this.animationAccumulatorMs -= this.animationStepIntervalMs;
            this.stepAdvancement();
        }
    }

    /**
     * 消费一步推进（一次怪物行动）。返回推进是否仍在进行。
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
            const isFlying = entity.hasStatus('flying') || entity.hasStatus('levitating') || (entity.abilities && entity.abilities.has('flying'));
            if (cell.terrain === TerrainType.WATER_DEEP && !isFlying) {
                if (entity === this.player) {
                    this.lastDamageSource = '';
                    logger.log(i18next.t('env.player_drowns', { defaultValue: 'You plunge into the dark water and drown.' }), '#0044ff');
                    this.triggerGameOver(false, i18next.t('death.drowned', { defaultValue: 'Drowned in deep water.' }));
                } else {
                    logger.log(i18next.t('env.monster_drowns', { name: name, defaultValue: `The ${name} drowns.` }), '#8888aa');
                    entity.die();
                }
                return;
            } else if (cell.terrain === TerrainType.LAVA && !isFlying && !entity.hasStatus('immune_fire') && !(entity.abilities && entity.abilities.has('immune_fire'))) {
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
            if (cell.isBurning && !entity.hasStatus('levitating') && !(entity.abilities && entity.abilities.has('immune_fire')) && !entity.hasStatus('immune_fire')) {
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
