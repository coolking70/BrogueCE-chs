/**
 * src/entities/Monster.ts
 * Base Monster class mirroring Brogue's monster initialization
 */

import { Creature, allocateEntityId } from './Creature';
import { knownPolymorphSpecies, polymorphHP, polymorphSpecies } from '../engine/Combat/Polymorph';
import { Player, TURNS_FOR_FULL_REGEN } from './Player';
import { rng } from '../engine/Random';
import type { Game } from '../engine/Core/Game';
import { Pathfind } from '../engine/Map/Pathfind';
import { getSafetyMapForMonster, safetyNextStep } from '../engine/Map/SafetyMap';
import type { WaypointSystem } from '../engine/Map/WaypointMap';
import { CombatSystem } from '../engine/Combat/Combat';
import { logger } from '../engine/Systems/Logger';
import i18next from 'i18next';
import { ItemLoader } from '../engine/Items/ItemLoader';
import type { Item } from '../engine/Items/Item';
import type { StatusId } from './Creature';
import { PERMANENT_STATUS_DURATION } from './Creature';
import { TerrainType } from '../engine/Map/Grid';
import { MONSTER_BOLT_TABLE, BoltEffect, type BoltConfig } from '../engine/Combat/Bolt';
import { CEBoltType } from '../engine/Combat/BoltCatalog';
import { reflectionChance } from '../engine/Combat/CombatFormulas';
import { bladeAvoids, bladeDiagonalBlocked, bladeStepToward, BLADE_DIRECTIONS } from '../engine/Combat/Conjuration';
import { boltLine } from '../engine/Combat/BoltTrajectory';
import { entrancementDiagonalBlocked, entrancementPassable } from '../engine/Movement/Entrancement';
import { cellTerrainFlags, cellTerrainMechFlags } from '../engine/Map/DungeonFeature';
import { T_ENTANGLES, TM_ALLOWS_SUBMERGING, T_LAVA_INSTA_DEATH, T_IS_DEEP_WATER, T_AUTO_DESCENT } from '../engine/Map/TerrainCatalog';

const BLADE_SIGHT: BoltConfig = { id: 'blade_sight', name: '', ceType: CEBoltType.NONE,
    effect: BoltEffect.NONE, magnitude: 0, char: '', color: 0, maxRange: 0, piercing: false, selfTargeting: false };

// ----- P4-1b：怪物远程法术施放 -----
//
// 对照 CE Monsters.c 的 monstUseBolt/generallyValidBoltTarget/
// specificallyValidBoltTarget（见 ai_docs/p4_1b_monster_casting_report.md
// 的逐段对照）。web 没有 CE 的 MONSTER_ALLY/MONSTER_TRACKING_SCENT 等完整
// creatureState 谱系，也没有 MB_MARKED_FOR_SACRIFICE 等，
// 下面按"够用且可测"的口径做了必要简化，均在报告里逐条说明，不静默偷工。

/** 阵营：player 阵营含玩家本身与所有 isAlly 怪物；hostile 阵营是其余怪物。 */
type Faction = 'player' | 'hostile';

function factionOf(c: Creature): Faction {
    if (c instanceof Player) return 'player';
    if (c instanceof Monster) return c.isAlly ? 'player' : 'hostile';
    return 'hostile';
}

/** CE monstersAreTeammates 的简化版：同阵营且都不处于 discordant。 */
export function monstersAreTeammates(a: Creature, b: Creature): boolean {
    if (a === b) return false;
    if (a.hasStatus('discordant') || b.hasStatus('discordant')) return false;
    return factionOf(a) === factionOf(b);
}

/** CE monstersAreEnemies 的简化版：阵营不同，或任一方 discordant（六亲不认）。 */
export function monstersAreEnemies(a: Creature, b: Creature): boolean {
    if (a === b) return false;
    if (a.hasStatus('discordant') || b.hasStatus('discordant')) return true;
    return factionOf(a) !== factionOf(b);
}

/**
 * P4-2：CE monsterSummons（Monsters.c:2418）的随从计数部分。
 *   盟友召唤者（isAlly）→ 统计所有 isAlly 怪物（含召唤者自身，CE 原样如此：
 *   for-loop 遍历包含 summoner 本身，summoner->creatureState==ALLY 时自己也
 *   会被算作一个"盟友"，不是笔误，照搬）。
 *   敌方召唤者 → 只统计 leader === 召唤者的直接随从（对应 CE
 *   MB_FOLLOWER && target->leader==monst；web 用 leader!==null 作为
 *   MB_FOLLOWER 的等价判据，二者在本项目里总是同步设置，见 Game.summonMinionsFor
 *   与 spawnHordeAt）。
 * 已知简化：CE 盟友召唤者还会跨层统计上下深度的盟友数（levels[depth-2]/
 * levels[depth]），web 单层地图模型没有"未加载深度的怪物列表"可查，
 * 故只统计当前层——按任务说明，此处简化并在报告中说明。
 */
export function countMinions(caster: Monster, allMonsters: readonly Monster[]): number {
    if (caster.isAlly) {
        return allMonsters.filter(m => m.isAlly).length;
    }
    return allMonsters.filter(m => m.leader === caster).length;
}

/** W-15: retain the P4-1b public helpers; the value now means tenths of HP. */
export function isShielded(c: Creature): boolean {
    return c.hasStatus('shielded');
}
export function applyShieldStatus(c: Creature, tenths: number): void {
    c.applyShield(tenths);
}

/**
 * CE generallyValidBoltTarget（Monsters.c:2543）。省略：MB_MARKED_FOR_SACRIFICE
 * 分支（web 无献祭机制）、MB_SUBMERGED 判定（web 无潜水簿记，用 invisible 状态
 * 近似 monsterIsHidden）。
 */
export function generallyValidBoltTarget(caster: Monster, target: Creature, game: Game): boolean {
    if (caster === target) return false;
    if (caster.hasStatus('discordant') && caster.state === MonsterState.WANDERING && target === game.player) {
        return false;
    }
    if (target.hasStatus('invisible')) return false;
    return game.hasLineOfSight(caster.loc.x, caster.loc.y, target.loc.x, target.loc.y);
}

/**
 * CE specificallyValidBoltTarget（Monsters.c:2596）。只覆盖 MONSTER_BOLT_TABLE
 * 里登记的 13 个已映射 bolt；effect===null（已知缺口）与 BLINKING 由调用方
 * （tryUseBolt）提前过滤，不会走到这里。
 * 省略的分支：BF_NEVER_REFLECTS/反射判定（web 无护甲反射对怪物生效的路径）、
 * forbiddenMonsterFlags（仅对 BECKONING 目标做了 MONST_IMMOBILE 近似）、
 * NEGATION 的实际可达资格已于 W-23 对齐（保留 CE catalog 的敌方门）。
 */
export function specificallyValidBoltTarget(caster: Monster, target: Creature, ceBoltName: string, game: Game): boolean {
    const meta = MONSTER_BOLT_TABLE[ceBoltName];
    if (!meta || meta.effect === null || meta.effect === BoltEffect.BLINKING) return false;

    // CE MC:2604 BF_TARGET_ENEMIES runs BEFORE the NEGATION switch.
    // Thus same-team entrancement/fear branches below that gate are unreachable
    // with the shipped NEGATION catalog; W-18's bypass was incorrect.
    if (target.hasStatus('entranced')
        && [BoltEffect.FIRE, BoltEffect.SPARK, BoltEffect.DRAGONFIRE, BoltEffect.DISTANCE_ATTACK, BoltEffect.POISON_DART].includes(meta.effect)
        && monstersAreEnemies(caster, target)) return false;
    if (meta.targetAllies && !monstersAreTeammates(caster, target)) return false;
    if (meta.targetEnemies && !monstersAreEnemies(caster, target)) return false;
    if (meta.targetEnemies && target instanceof Monster && target.hasBehavior('MONST_INVULNERABLE')) return false;
    if (meta.fiery && target.hasStatus('immune_fire')) return false;

    switch (meta.effect) {
        case BoltEffect.DISCORD:
            if (target.hasStatus('discordant') || target === game.player) return false;
            break;
        case BoltEffect.NEGATION:
            // CE MC:2613 reflective hostile gate, then :2681-2726 reasons.
            if (target instanceof Monster && !target.isAlly
                && (target.hasBehavior('MONST_REFLECT_50') || target.hasAbility('MA_REFLECT_100'))) return false;
            if (monstersAreEnemies(caster, target)) {
                if (target.hasStatus('hasted') || target.hasStatus('haste') || target.hasStatus('telepathy') || isShielded(target)) return true;
                if (target instanceof Monster && (target.diesIfNegated() || target.isImmuneToWeapons())) return true;
                const sameTeam = (caster.isAlly && (target === game.player || (target instanceof Monster && target.isAlly)))
                    || caster.leader === target || (target instanceof Monster && (target.leader === caster
                        || (caster.leader !== null && target.leader === caster.leader)));
                if (sameTeam && target.hasStatus('discordant') && !caster.hasStatus('discordant')
                    && !(target instanceof Monster && target.diesIfNegated())) return true;
                return (target.hasStatus('immune_fire') || target.hasStatus('levitating') || target.hasStatus('flying'))
                    && !!(cellTerrainFlags(game.grid, target.x, target.y) & (T_LAVA_INSTA_DEATH | T_IS_DEEP_WATER | T_AUTO_DESCENT));
            }
            return false;
        case BoltEffect.SLOW:
            if (target.hasStatus('slowed')) return false;
            break;
        case BoltEffect.HASTE:
            if (target.hasStatus('hasted')) return false;
            break;
        case BoltEffect.SHIELDING:
            if (isShielded(target)) return false;
            break;
        case BoltEffect.HEALING:
            if (target.hp >= target.maxHp) return false;
            break;
        case BoltEffect.BECKONING: {
            if (target instanceof Monster && (target.hasBehavior('MONST_IMMOBILE') || target.hasBehavior('MONST_TURRET'))) {
                return false;
            }
            const dist = Math.max(Math.abs(caster.loc.x - target.loc.x), Math.abs(caster.loc.y - target.loc.y));
            if (dist <= 1) return false;
            break;
        }
        default:
            break;
    }
    return true;
}

/** P4-6：CE monsterAtLoc 的 web 等价（含玩家）：该格上的玩家或存活怪物。 */
function creatureAtLoc(game: Game, x: number, y: number): Creature | undefined {
    if (game.player.hp > 0 && game.player.loc.x === x && game.player.loc.y === y) {
        return game.player;
    }
    return game.getMonsterAt(x, y);
}

export enum MonsterState {
    ASLEEP,
    WANDERING,
    HUNTING,
    FLEEING
}

export type MonsterAbility = 'flying' | 'regenerating' | 'ranged' | 'poisonous';

export interface MonsterData {
    id: string;
    name: string;
    char: string;
    color: number;
    hp: number;
    damage: string;
    clumping?: number;
    accuracy?: number;
    defense?: number;
    regen?: number;
    moveSpeed?: number;
    attackSpeed?: number;
    minDepth: number;
    maxDepth: number;
    machineOnly?: boolean;
    goldDropChance: number;
    itemDropChance: number;
    onHitStatus?: StatusId;
    onHitChance?: number;
    onHitDuration?: number;
    statusImmunities?: StatusId[];
    statusResistTurns?: Partial<Record<StatusId, number>>;
    abilities?: MonsterAbility[];
    behaviorFlags?: string[];
    abilityFlags?: string[];
    description?: string;
    /** P4-1a：CE monsterCatalog.bolts，去 BOLT_ 前缀、保持源码顺序。见 Bolt.ts MONSTER_BOLT_TABLE。 */
    bolts?: string[];
}

export interface MutationData {
    id: string;
    name: string;
    color: number;
    healthFactor: number;
    moveSpeedFactor: number;
    attackSpeedFactor: number;
    defenseFactor: number;
    damageFactor: number;
    abilityFlags: string[];
    behaviorFlags: string[];
    forbiddenFlags: string[];
    forbiddenAbilityFlags: string[];
    description: string;
}

export class Monster extends Creature {
    public state: MonsterState = MonsterState.ASLEEP;
    public damageString: string;
    public damageClumping: number;
    public goldDropChance: number = 0;
    public itemDropChance: number = 0;
    public onHitStatus?: StatusId;
    public onHitChance: number = 0;
    public onHitDuration: number = 0;
    public statusResistTurns: Partial<Record<StatusId, number>> = {};
    public abilities: Set<MonsterAbility> = new Set();
    public behaviorFlags: Set<string> = new Set();
    public abilityFlags: Set<string> = new Set();
    public isAlly: boolean = false;
    /** W-17: marks converted allies for combat/persistence; never a status timer. */
    public dominated = false;
    /** CE MB_BOUND_TO_LEADER, set from the horde flag without drawing RNG. */
    public boundToLeader = false;
    public isCaged: boolean = false;
    /**
     * V-2b-6：≙ CE creature->carriedItem（Rogue.h:2186 一带；机器侧写入点
     * Architect.c:1705-1710 `torchBearer->carriedItem = torch`，MF_MONSTER_
     * TAKE_ITEM feature 的物品随怪携带，怪死时掉落——Monsters.c:4075-4083
     * makeMonsterDropItem）。web 的物品在此以 Item 引用挂载（实化在
     * Game.populateLevel 的怪物消费点）；掉落结算在 playerTurnEnded 的
     * 死亡清扫。
     */
    public carriedItem?: Item | null;
    public mutation?: MutationData;
    /** W-19: effect/save tag, not a species or generation flag. */
    public polymorphed = false;
    /** W-20: clones have no carried loot or CE MB_WEAPON_AUTO_ID entitlement. */
    public isClone = false;
    public wasNegated = false;
    public get displaysNegation(): boolean {
        return this.wasNegated && this.newPowerCount === this.totalPowerCount;
    }
    /** CE creature counts survive cloning/polymorph; W-22 will consume slots. */
    public newPowerCount = 0;
    public totalPowerCount = 0;
    /** Carried creatures are detached payloads, never active occupants. W-19
     * discards them without death/loot; full enter-summons lifecycle is separate. */
    public carriedMonster: Monster | null = null;
    /** CE computes current speed BEFORE initializeStatus clears haste/slow. */
    public polymorphKeepsSpeed = false;
    public description: string = '';
    /**
     * P4-4：CE MA_DF_ON_DEATH（Combat.c:1963-1990）的一次性触发闸门。
     * Game.triggerDeathFeatures 在 playerTurnEnded/finishTurnEpilogue 两处
     * 都会扫描 hp<=0 的怪物（覆盖"玩家行动内击杀"与"推进循环内击杀"两种
     * 时序），靠这个字段保证同一只怪物只触发一次死亡地形效果。
     */
    public deathEffectTriggered: boolean = false;
    /** P4-1b：CE monsterCatalog.bolts（P4-1a 数据），驱动 tryUseBolt。 */
    public bolts: string[] = [];
    /** P4-2：monsters.json 的怪物种类 id（如 'goblin_conjurer'），对应 CE
     *  monsterID 枚举——summonMinionsFor 靠它匹配 hordes.json 的 leader 字段。
     *  与 Creature.id（每个实例独一无二的存档实体 id，number）是两码事。 */
    public typeId: string = '';
    /** P4-2：CE creature->leader + bookkeepingFlags&MB_FOLLOWER 的合并等价——
     *  非 null 即视为"是某召唤者/horde 领袖的直接随从"（MB_FOLLOWER）。
     *  由 Game.summonMinionsFor（召唤）与 Game.spawnHordeAt（常规 horde 成员，
     *  CE spawnHorde 同样经 spawnMinions 落地，一并设置 leader，见 P4-2 报告）
     *  两处赋值，countMinions 读取。 */
    public leader: Monster | null = null;
    /** W-16: player follower = isAlly + leader=null, matching the existing captive
     * convention. Binding is not a lifespan: CE exempts ALLY from orphan death. */
    public boundToPlayer: boolean = false;
    /** CE MB_DOES_NOT_TRACK_LEADER: hunt enemies, mill about when idle. */
    public doesNotTrackLeader: boolean = false;
    /**
     * P4-8：CE bookkeepingFlags & MB_GIVEN_UP_ON_SCENT。MONST_ALWAYS_HUNTING
     * 怪物顺气味走到死路（isLocalScentMaximum）时置位，此后改为直接寻路追玩家
     * （CE Monsters.c:3466-3469/3477-3481 的 pathTowardCreature 兜底）；
     * 重见玩家时清除（CE Monsters.c:2101/3234 的简化口径：重见即清）。
     */
    public givenUpOnScent: boolean = false;

    /**
     * P4-9：CE monst->safetyMap——察觉不到玩家的逃跑者的私有 safety map
     * 快照。getSafetyMap（Monsters.c:2380-2400）：察觉 → 释放（置 null）并
     * 用全局实时图；察觉不到 → 只拍一次，此后一直用这张旧图继续逃。
     */
    public safetySnapshot: number[][] | null = null;
    /**
     * C-5：CE bookkeepingFlags & MB_IS_FALLING（Rogue.h:2160"在回合末下坠"）。
     * 由 Game.applyEnvironmentalEffects（CE Time.c:168-176 同位）置位；
     * Game.monstersFall（CE Time.c:1530）结算——置位者即使本回合内离开了
     * 渊格也照坠（CE :1537 的 `MB_IS_FALLING ||` 分支）。
     */
    public falling: boolean = false;
    /**
     * C-5：CE bookkeepingFlags & MB_PREPLACED——"随层预放置"位。坠层幸存者
     * （CE Time.c:1562）置位：a) monsterShouldFall 豁免（CE Time.c:115，防
     * 落到下一层渊格立即连坠）；b) Game 在层生成后据此把幸存者重定位到合格
     * 格（CE restoreMonster Architect.c:3537-3550：MB_PREPLACED 强制走
     * getQualifyingPathLocNear），重定位后清除（CE :3548）。
     */
    public preplaced: boolean = false;

    /**
     * V-2b-5：CE `bookkeepingFlags & MB_IS_DORMANT`（Monsters.c:4195/4207 两处
     * 置/清）——"已休眠，不在 `monsters` 表里"的位。CE 的休眠是**换表**：
     * 睡下的怪从 `monsters` 摘链、挂到 `dormantMonsters`，于是「不占格
     * （HAS_MONSTER 清、HAS_DORMANT_MONSTER 置）+ 不获回合 + 不被
     * monsterAtLoc 找到 + 不可见」四件事一并成立，不需要在任何读取点加判断。
     * web 照抄同一结构：本字段为真 ⇔ 该实例在 `Game.dormantMonsters` 而不在
     * `Game.monsters`；位本身只作断言/调试的可查询事实（见
     * Game.toggleMonsterDormancy 的头注）。
     */
    public isDormant: boolean = false;

    /**
     * V-2b-5：CE `creature.machineHome`（Rogue.h:2211 一带；写入点
     * Architect.c:1661 `monst->machineHome = machineNumber;`——注释原文
     * "Monster remembers the machine that spawned it."）。
     *
     * 只有机器生成的怪才有非 0 值；自然刷怪（populateMonsters）留 0，与
     * CE 的 `creature` 零初始化一致。消费点见 Promotion.activateMachine 的
     * CE 怪物激活段（:1201-1227，本轮登记未接线，见报告 §1）。
     */
    public machineHome: number = 0;

    /**
     * P4-10：CE monst->targetWaypointIndex（Monsters.c:127，初值 -1）。
     * WANDERING 怪物朝该 waypoint 的距离图下坡走，到达/失效后由
     * chooseNewWanderDestination 换点。
     */
    public targetWaypointIndex: number = -1;

    /**
     * P4-10：CE monst->waypointAlreadyVisited（Monsters.c:128-129，定长
     * MAX_WAYPOINT_COUNT=40，≈50% 初始已访问均衡）。web 惰性初始化：CE 在
     * initializeMonster（生成期）就为每只怪消耗 40 次 rand_range(0,1)，照搬会
     * 移动生成期 RNG 流、打红 generation_baseline（任务书禁刷新基线）；改在
     * 玩法期首次触碰 waypoint 系统时消费同分布的 40 次种子掷骰。由
     * WaypointSystem.ensureVisitedInitialized 负责，不要手动赋值。
     */
    public waypointAlreadyVisited: boolean[] | null = null;

    // Movement & Combat speeds
    public regenTurns: number = 0;
    // CE info.movementSpeed / info.attackSpeed（monsterCatalog 基准值，P1-1 起
    // 来自 monsters.json）。基准必须存私有字段：公有的 moveSpeed/attackSpeed
    // 是"当前行动耗时"（CE creature->movementSpeed/attackSpeed，含 haste/slow
    // 修正）——调度器、DetailGenerator 与 monster_stats_effect 的 legacy 回置
    // 都按原字段名直接读写"当前值"，写即生效。
    private baseMoveSpeed: number = 100;
    private baseAttackSpeed: number = 100;
    public accuracy: number = 100;
    public defense: number = 0;

    // Regeneration counter
    public regenCounter: number = 0; // persisted with poison to preserve paused regeneration

    // Track original spawn loc for wandering logic
    public spawnLoc: { x: number, y: number } = { x: 0, y: 0 };

    constructor(x: number, y: number, data: MonsterData) {
        super(x, y, ItemLoader.translateName(data.name), data.char, data.color);
        this.maxHp = data.hp;
        this.hp = data.hp;
        this.damageString = data.damage;
        this.damageClumping = data.clumping ?? CombatSystem.parseDamageString(data.damage ?? '1d3').clumping;
        // Monsters.c:119-120：movementSpeed/attackSpeed 当前值由 info 基准推导
        // （无状态时即基准值）。
        this.regenTurns = data.regen ?? 0;
        this.baseMoveSpeed = data.moveSpeed ?? 100;
        this.baseAttackSpeed = data.attackSpeed ?? 100;
        this.refreshSpeeds();
        // Monsters.c:116 initializeMonster：ticksUntilTurn = info.movementSpeed。
        // P2-1 恒 TICKS_PER_TURN；P2-2 起取真实值（速度是"行动花费"，豺狼 50 双倍速）。
        this.ticksUntilTurn = this.moveSpeed;
        this.accuracy = data.accuracy ?? 100;
        this.defense = data.defense ?? 0;
        this.onHitStatus = data.onHitStatus;
        this.onHitChance = data.onHitChance ?? 0;
        this.onHitDuration = data.onHitDuration ?? 0;
        if (Array.isArray(data.statusImmunities)) {
            this.statusImmunities = new Set<StatusId>(data.statusImmunities);
        }
        if (data.statusResistTurns) {
            this.statusResistTurns = { ...data.statusResistTurns };
        }
        if (Array.isArray(data.abilities)) {
            this.abilities = new Set<MonsterAbility>(data.abilities);
        }
        if (Array.isArray(data.behaviorFlags)) {
            this.behaviorFlags = new Set<string>(data.behaviorFlags);
        }
        // P1-28：CE initializeStatus（Monsters.c:3904-3928）的 web 复刻——旗标
        // 在进入玩法前翻译成永久状态（详见 syncFlagDerivedStatuses）。CE 全部
        // 环境/目标判定只读 status 通道，web 此前缺这一层，monsters.json 写在
        // behaviorFlags 的 MONST_FLIES / MONST_IMMUNE_TO_FIRE 对
        // applyEnvironmentalEffects 等 status/abilities 读取点完全不可见
        // （abilities 通道全库无写入者，真实数据恒空）。
        this.syncFlagDerivedStatuses();
        if (Array.isArray(data.abilityFlags)) {
            this.abilityFlags = new Set<string>(data.abilityFlags);
        }
        this.description = data.description ?? '';
        this.bolts = Array.isArray(data.bolts) ? [...data.bolts] : [];
        this.typeId = data.id;
        // 70% chance to start asleep, otherwise wandering
        // CE logic: MONST_NEVER_SLEEPS or MONST_ALWAYS_HUNTING means they never start asleep.
        if (this.hasBehavior('MONST_NEVER_SLEEPS') || this.hasBehavior('MONST_ALWAYS_HUNTING')) {
            this.state = MonsterState.WANDERING; // Or EXPLORING/HUNTING based on other logic
        } else {
            this.state = rng.randPercent(70) ? MonsterState.ASLEEP : MonsterState.WANDERING;
        }
    }

    /** CE Monsters.c:568: copy current values, NOT catalog defaults. The explicit
     * container list is guarded by W-20's own-property audit and mutation tests.
     * leader is a creature pointer; carried payloads and safetyMap are cleared. */
    public copyForClone(): Monster {
        const clone: Monster = Object.assign(Object.create(Monster.prototype), this);
        clone.id = allocateEntityId();
        clone.loc = { ...this.loc };
        clone.spawnLoc = { ...this.spawnLoc };
        clone.statusDurations = { ...this.statusDurations };
        clone.maxStatus = { ...this.maxStatus };
        clone.statusImmunities = new Set(this.statusImmunities);
        clone.statusResistTurns = { ...this.statusResistTurns };
        clone.abilities = new Set(this.abilities);
        clone.behaviorFlags = new Set(this.behaviorFlags);
        clone.abilityFlags = new Set(this.abilityFlags);
        clone.bolts = [...this.bolts];
        clone.waypointAlreadyVisited = this.waypointAlreadyVisited ? [...this.waypointAlreadyVisited] : null;
        clone.mutation = this.mutation ? structuredClone(this.mutation) : undefined;
        clone.safetySnapshot = null;
        clone.carriedItem = null;
        // CE recursively creates then detaches a carried clone, but never assigns
        // it back to newMonst->carriedMonster. Do not invent a retained payload.
        clone.carriedMonster = null;
        clone.isCaged = false;
        clone.isClone = true;
        // Web rolls loot on death rather than generateMonster(itemPossible).
        clone.goldDropChance = clone.itemDropChance = 0;
        clone.ticksUntilTurn = 101;
        // W-16/W-17 represent &player as isAlly + leader=null.
        clone.leader = this.leader ?? (this.isAlly ? null : this);
        if (clone.behaviorFlags.has('MONST_MALE') && clone.behaviorFlags.has('MONST_FEMALE')) {
            clone.behaviorFlags.delete(rng.randPercent(50) ? 'MONST_MALE' : 'MONST_FEMALE');
        }
        return clone;
    }

    /** CE clones the player creature struct, not rogue's inventory/equipment.
     * Player and Monster have different JS shapes: project every shared Creature
     * field onto monster defaults, then apply the same clone exceptions. */
    public static copyPlayerForClone(player: Player): Monster {
        const model = new Monster(player.x, player.y, {
            id: 'player_clone', name: 'clone', char: player.char, color: 0x7f7f7f,
            hp: player.maxHp, damage: '1d2', accuracy: 100, defense: 0, regen: 20,
            moveSpeed: 100, attackSpeed: 100, minDepth: 1, maxDepth: 99,
            goldDropChance: 0, itemDropChance: 0,
        });
        // Player stores fractional HP; Monster stores elapsed regeneration turns.
        // Project current rate/progress without retaining a Player/inventory ref.
        const regenTurns = TURNS_FOR_FULL_REGEN / player.maxHp * (player.hasStatus('regenerating') ? 0.6 : 1);
        Object.assign(model, { regenTurns, regenCounter: player.regenCarry * regenTurns,
            name: ItemLoader.translateName('clone') || 'clone', hp: player.hp, maxHp: player.maxHp, carriedItem: null,
            statusDurations: { ...player.statusDurations }, statusImmunities: new Set(player.statusImmunities),
            poisonAmount: player.poisonAmount, maxShield: player.maxShield,
            weaknessAmount: player.weaknessAmount, maxStatus: { ...player.maxStatus },
            movementSpeed: player.movementSpeed, attackSpeed: player.attackSpeed,
            seized: player.seized, seizing: player.seizing,
            ticksUntilTurn: 101, isClone: true, isAlly: true, state: MonsterState.WANDERING });
        // leader=null + isAlly is the existing web representation of &player.
        return model;
    }

    /** CE Monsters.c:547 empowerMonster. Integer increases use CURRENT bounds
     * on every hit. Keep the existing web damage distribution (uniform); CE's
     * separate clumpFactor is not represented by this engine (W-21 report). */
    public empower(): boolean {
        if (this.hp <= 0 || this.hasBehavior('MONST_INANIMATE')
            || this.hasBehavior('MONST_TURRET') || this.isInvulnerable()) return false;
        const { min, max } = CombatSystem.parseDamageString(this.damageString);
        this.maxHp += 12;
        this.defense += 10;
        this.accuracy += 10;
        this.damageString = `${min + Math.max(1, Math.trunc(min / 10))}-${max + Math.max(1, Math.trunc(max / 10))}`;
        this.newPowerCount++;
        this.totalPowerCount++;
        this.heal(100, true);
        return true;
    }

    /** CE Items.c:4572-4631. Replace info IN PLACE; never construct/spawn or
     * copy an entity. Only captives demote their leadership, after status reset. */
    public polymorph(demote: () => void): boolean {
        if ((!knownPolymorphSpecies(this.typeId) && !(this.isClone && this.typeId === 'player_clone')) || this.hasBehavior('MONST_INANIMATE') || this.hasBehavior('MONST_TURRET') || this.isInvulnerable()) return false;
        // Preserve C operator precedence: stealing resets state even if not fleeing.
        if ((this.state === MonsterState.FLEEING && (this.hasBehavior('MONST_MAINTAINS_DISTANCE')
            || this.hasBehavior('MONST_FLEES_NEAR_DEATH'))) || this.hasAbility('MA_HIT_STEAL_FLEE')) {
            this.state = MonsterState.HUNTING;
        }
        // unAlly is NOT demoteMonsterFromLeadership. Other monsters' pointers
        // to this entity survive; hostile followers retain their own leader too.
        if (this.isAlly) {
            this.isAlly = false;
            this.leader = null;
            this.state = MonsterState.HUNTING;
        }
        this.dominated = false;
        this.mutation = undefined;
        this.carriedMonster = null; // CE freeCreature, not killCreature.
        const data = polymorphSpecies(this.typeId, rng);
        const hp = polymorphHP(this.hp, this.maxHp, data.hp);
        const hasted = this.hasStatus('hasted') || this.hasStatus('haste');
        const slowed = this.hasStatus('slowed');
        this.typeId = data.id;
        this.name = ItemLoader.translateName(data.name);
        this.char = data.char;
        this.color = data.color;
        this.description = data.description ?? '';
        this.maxHp = data.hp;
        this.hp = hp;
        this.damageString = data.damage;
        this.damageClumping = data.clumping ?? CombatSystem.parseDamageString(data.damage ?? '1d3').clumping;
        this.accuracy = data.accuracy ?? 100;
        this.defense = data.defense ?? 0;
        this.regenTurns = data.regen ?? 0; // web counter uses turns, not CE milliturns.
        this.baseMoveSpeed = data.moveSpeed ?? 100;
        this.baseAttackSpeed = data.attackSpeed ?? 100;
        this.movementSpeed = this.baseMoveSpeed;
        this.attackSpeed = this.baseAttackSpeed;
        if (hasted) { this.movementSpeed = Math.trunc(this.movementSpeed / 2); this.attackSpeed = Math.trunc(this.attackSpeed / 2); }
        if (slowed) { this.movementSpeed *= 2; this.attackSpeed *= 2; }
        this.polymorphKeepsSpeed = true;
        this.behaviorFlags = new Set(data.behaviorFlags ?? []);
        this.abilityFlags = new Set(data.abilityFlags ?? []);
        this.bolts = [...(data.bolts ?? [])];
        this.abilities = new Set(data.abilities ?? []);
        this.onHitStatus = data.onHitStatus;
        this.onHitChance = data.onHitChance ?? 0;
        this.onHitDuration = data.onHitDuration ?? 0;
        this.statusImmunities = new Set(data.statusImmunities ?? []);
        this.statusResistTurns = { ...data.statusResistTurns };
        // Web loot probabilities represent an existing inventory entitlement;
        // polymorph neither generates nor discards items (CE carriedItem stays).
        this.wasNegated = false;
        // newPowerCount/totalPowerCount belong to creature, not the replaced info.
        this.statusDurations = {};
        this.maxStatus = {};
        this.maxShield = 0; // maxStatus is reset; poisonAmount is NOT reset in CE.
        this.polymorphed = true;
        this.syncFlagDerivedStatuses();
        if (this.hasBehavior('MONST_FIERY')) (this.statusDurations as Record<string, number>).burning = PERMANENT_STATUS_DURATION;
        if (this.hasBehavior('MONST_INVISIBLE')) this.setStatusDuration('invisible', PERMANENT_STATUS_DURATION);
        if (this.isCaged) {
            demote();
            this.state = MonsterState.HUNTING;
            this.isCaged = false;
        }
        this.seized = this.seizing = false;
        this.ticksUntilTurn = Math.max(this.ticksUntilTurn, 101);
        return true;
    }

    /** Preserve CE's post-polymorph cached speed through unrelated statuses.
     * Explicit haste/slow writes and their expiration return to normal rules. */
    public override setStatusDuration(id: StatusId, duration: number): void {
        if (id === 'haste' || id === 'hasted' || id === 'slowed') this.polymorphKeepsSpeed = false;
        super.setStatusDuration(id, duration);
    }

    public override applyStatus(id: StatusId, duration: number, mode: 'refresh' | 'stack' = 'refresh'): boolean {
        const changed = super.applyStatus(id, duration, mode);
        if (id === 'magical_fear' && this.hasStatus(id)) this.state = MonsterState.FLEEING;
        return changed;
    }

    public override tickStatuses(): StatusId[] {
        const expired = super.tickStatuses();
        if (expired.includes('magical_fear')) {
            // CE restores ALLY if the leader is the player; web stores allegiance separately.
            this.isAlly = this.isAlly || this.leader instanceof Player;
            this.state = MonsterState.HUNTING;
        }
        return expired;
    }

    public override refreshSpeeds(): void {
        if (this.polymorphKeepsSpeed && !this.hasStatus('hasted') && !this.hasStatus('haste') && !this.hasStatus('slowed')) return;
        this.polymorphKeepsSpeed = false;
        super.refreshSpeeds();
    }

    public hasBehavior(flag: string): boolean {
        return this.behaviorFlags.has(flag);
    }

    /**
     * P1-28：CE initializeStatus（Monsters.c:3904-3928）的 web 复刻——把
     * behaviorFlags 里的永久特性翻译成对应状态（MONST_FLIES →
     * STATUS_LEVITATING=1000，MONST_IMMUNE_TO_FIRE →
     * STATUS_IMMUNE_TO_FIRE=1000）。CE 的下游消费点（熔岩 Time.c:183-190、
     * 火焰地形 exposeCreatureToFire Time.c:28-35、fiery bolt 目标筛选
     * Monsters.c:2624 等）只读 status，旗标经此翻译生效；不衰减由
     * isStatusPermanent 保证（CE updateMonsterStatus，Monsters.c:1852-1856 /
     * 1963-1967）。注意 CE 的 MONST_FLITS（飘忽移动）不翻译——它不是飞行，
     * 不豁免熔岩/压力板（web 现无对应机制，无需处理）。
     * W-23: only initialization/form changes rederive these states. CE negation
     * permanently strips the flags and clears their statuses; it never calls this.
     */
    public syncFlagDerivedStatuses(): void {
        if (this.hasBehavior('MONST_FLIES')) {
            this.setStatusDuration('levitating', PERMANENT_STATUS_DURATION);
        }
        if (this.hasBehavior('MONST_IMMUNE_TO_FIRE')) {
            this.setStatusDuration('immune_fire', PERMANENT_STATUS_DURATION);
        }
    }

    /** 见 Creature.isStatusPermanent：带旗标者的派生状态不随回合衰减。 */
    protected override isStatusPermanent(id: StatusId): boolean {
        if (this.polymorphed && (id as string) === 'burning') return this.hasBehavior('MONST_FIERY');
        if (this.polymorphed && id === 'invisible') return this.hasBehavior('MONST_INVISIBLE');
        if (id === 'levitating') return this.hasBehavior('MONST_FLIES');
        if (id === 'immune_fire') return this.hasBehavior('MONST_IMMUNE_TO_FIRE');
        return false;
    }

    /**
     * 公有 moveSpeed/attackSpeed = "当前行动耗时"（CE creature->movementSpeed /
     * ->attackSpeed）：moveSpeed 以存取器别名到 Creature.movementSpeed，保证
     * 直接写 m.moveSpeed（legacy 回置、调试）立即对调度生效。
     */
    public get moveSpeed(): number { return this.movementSpeed; }
    public set moveSpeed(v: number) { this.movementSpeed = v; }

    /** info 基准（CE monst->info.movementSpeed）：mutate() 改写基准后由 refreshSpeeds 生效。 */
    protected override get infoMovementSpeed(): number { return this.baseMoveSpeed; }
    protected override get infoAttackSpeed(): number { return this.baseAttackSpeed; }

    /**
     * CE Monsters.c（monstersTurn 各攻击/施法出口）：行动耗时 = attackSpeed，
     * MONST_CAST_SPELLS_SLOWLY 者减半行动频率（×2）。移动出口不在此赋值——
     * 由 Game 推进循环统一置 movementSpeed（CE Time.c:2731 的跳过口径同源）。
     */
    private endTurnWithAttack(): void {
        this.ticksUntilTurn = this.attackSpeed * (this.hasBehavior('MONST_CAST_SPELLS_SLOWLY') ? 2 : 1);
    }

    public mutate(m: MutationData) {
        this.mutation = m;
        // P1-30：变异名经 i18n 组装，语序与连接符收在资源键里（zh_CN
        // "mutation.<id>" 为"爆裂的{{name}}"式插值；harness 空资源回退英文
        // "explosive rat"）。CE mutationCatalog.title 见 Globals.c:1396 起。
        this.name = i18next.t('mutation.' + m.id, { name: this.name, defaultValue: m.name + ' ' + this.name });
        this.color = m.color;

        // Apply stat multipliers
        this.maxHp = Math.max(1, Math.floor(this.maxHp * m.healthFactor));
        this.hp = this.maxHp;
        this.baseMoveSpeed = Math.floor(this.baseMoveSpeed * m.moveSpeedFactor);
        this.baseAttackSpeed = Math.floor(this.baseAttackSpeed * m.attackSpeedFactor);
        // CE generateMonster 的顺序是 mutateMonster → initializeMonster：初始
        // ticksUntilTurn 与当前速度都取"突变后"的 info 基准。web 的 mutate 在
        // 构造之后调用，这里补齐两条初始化语义。
        this.refreshSpeeds();
        this.ticksUntilTurn = this.moveSpeed;

        // Adjust damage (only modifying the dice count 'A' in 'AdB')
        const match = this.damageString.match(/^(\d+)d(\d+)$/);
        if (match && match[1] && match[2]) {
            let count = parseInt(match[1]);
            const sides = parseInt(match[2]);
            if (!isNaN(count)) {
                count = Math.max(1, Math.floor(count * m.damageFactor));
                this.damageString = `${count}d${sides}`;
            }
        }

        // Add additional flags
        if (m.abilityFlags) {
            for (const f of m.abilityFlags) this.abilityFlags.add(f);
        }
        if (m.behaviorFlags) {
            for (const f of m.behaviorFlags) this.behaviorFlags.add(f);
        }
        // P1-28：突变新增旗标同样要翻译成永久状态（CE mutateMonster 先于 initializeStatus；
        // 与构造路径保持同一翻译层）。当前 mutations.json 不含
        // MONST_FLIES / MONST_IMMUNE_TO_FIRE，本调用是防御性的。
        this.syncFlagDerivedStatuses();
    }

    public hasAbility(flag: string): boolean {
        return this.abilityFlags.has(flag);
    }

    /**
     * P4-3：CE Combat.c:1806 inflictDamage — MONST_INVULNERABLE 使一切伤害
     * （近战/投掷/法术/环境）直接归零，是全 CE 唯一给 Warden of Yendor 用的
     * "打不死"标记（Globals.c 检索确认全表仅此一只）。
     */
    public isInvulnerable(): boolean {
        return this.hasBehavior('MONST_INVULNERABLE');
    }

    /**
     * P4-3：CE Combat.c:1243-1245 attack() —— MONST_IMMUNE_TO_WEAPONS 只把
     * "武器伤害"（近战 attacker->info.damage / Items.c:6812 投掷武器伤害）
     * 计算为 0，不经过 inflictDamage 的统一豁免（inflictDamage 本身只认
     * MONST_INVULNERABLE）。法术 bolt、火焰等其它伤害源不检查这个标志，
     * 因此仍然有效——不是免疫一切。
     */
    public isImmuneToWeapons(): boolean {
        return this.hasBehavior('MONST_IMMUNE_TO_WEAPONS');
    }

    /**
     * P4-3：CE Items.c:4978-4983 projectileReflects —— MA_REFLECT_100 令任意
     * 可反射 bolt（未标 BF_NEVER_REFLECTS）100% 反射回施法者；MONST_REFLECT_50
     * 等价于额外叠加 +4 附魔的反射护甲（netReflectionLevel += 4*FP_FACTOR），
     * 再走 PowerTables.c:109-123 reflectionChance 查表得到百分比。
     * 返回 0-100 的反射概率；两个标志都没有时返回 0。
     */
    public reflectChance(): number {
        if (this.hasAbility('MA_REFLECT_100')) return 100;
        if (this.hasBehavior('MONST_REFLECT_50')) return reflectionChance(4);
        return 0;
    }

    /**
     * P4-3：CE Items.c:4483-4491 negate() —— 被 negation 命中时，
     * MONST_DIES_IF_NEGATED 的怪物不是清状态，而是直接 killCreature。
     */
    public diesIfNegated(): boolean {
        return this.hasBehavior('MONST_DIES_IF_NEGATED');
    }

    /**
     * P4-3：CE Monsters.c:200-203 monsterIsHidden —— STATUS_INVISIBLE（由
     * MONST_INVISIBLE 在 initializeStatus 里恒设为 1000，Monsters.c:3920）
     * 且不在气体中时，对非队友观察者恒定隐藏，不因相邻/未修 telepathy 而例外。
     * web 侧用于 Game.update() 的可见怪物集合过滤（telepathy 例外见调用处，
     * 对应 CE canSeeMonster 通过 monsterRevealed 在有 telepathy 时显示幽灵符号）。
     */
    public isTrulyInvisible(): boolean {
        return this.hasBehavior('MONST_INVISIBLE');
    }

    /**
     * P4-2：CE monsterSummons（Monsters.c:2418）。对照：
     *   if (!(abilityFlags & MA_CAST_SUMMON)) return false;
     *   minionCount = countMinions(...)                          → countMinions()
     *   if (alwaysUse && minionCount < 50)                       → summonMinionsFor
     *   else if (MA_ENTER_SUMMONS): if (!rand_range(0,7))        → 1/8，summonMinionsFor
     *   else if ((非盟友 || minionCount<5) && !rand_range(0, n²*3+1)) → summonMinionsFor
     * CE 在"RNG 判定通过、决定尝试召唤"时即返回 true（即便 summonMinions 内部
     * 因找不到 hordeID 而实际没召到任何随从）——本项目 hordes.json 给每个
     * MA_CAST_SUMMON 怪物都配了至少一条 HORDE_IS_SUMMONED 条目（见报告核对
     * 表），这个"判定过了但没召到"的分支在当前数据下不可达，此处仍按 CE
     * 字面语义实现（不因数据凑巧而简化判定本身）。
     */
    public trySummon(game: Game): boolean {
        if (!this.hasAbility('MA_CAST_SUMMON')) return false;

        const alwaysUse = this.hasBehavior('MONST_ALWAYS_USE_ABILITY');
        const minionCount = countMinions(this, game.monsters);

        let attempt = false;
        if (alwaysUse && minionCount < 50) {
            attempt = true;
        } else if (this.hasAbility('MA_ENTER_SUMMONS')) {
            attempt = rng.randRange(0, 7) === 0;
        } else if ((!this.isAlly || minionCount < 5) && rng.randRange(0, minionCount * minionCount * 3 + 1) === 0) {
            attempt = true;
        }

        if (!attempt) return false;

        game.summonMinionsFor(this);
        // CE Monsters.c:3139：monstUseMagic 返回 true 的出口统一耗时（召唤与
        // 施法 bolt 共用同一处 tick 赋值），与 tryUseBolt 复用同一私有方法。
        this.endTurnWithAttack();
        return true;
    }

    /**
     * CE monstUseBolt（Monsters.c:2786）。对照：
     *   if (!bolts[0]) return false;                              → 空数组早退
     *   for target in [player, ...monsters]:                      → candidates 遍历（player 优先，同 CE）
     *     if generallyValidBoltTarget(caster, target):             → 视线 + 通用过滤
     *       for bolt in caster.bolts:                              → 按 monsters.json 原始顺序（P4-1a 已核实）
     *         if bolt.effect == BE_BLINKING: continue;              → specificallyValidBoltTarget 内部已直接拒绝
     *         if specificallyValidBoltTarget(caster, target, bolt):
     *           if ALWAYS_USE_ABILITY || rand_percent(30):
     *             cast; return true;
     *           // 否则不 break，继续尝试该目标的下一个 bolt（CE 原样：无 else）
     * 返回 true 表示本回合已经用掉（调用方据此 return，不再移动/近战）。
     */
    public tryUseBolt(game: Game): boolean {
        if (this.bolts.length === 0) return false;

        const candidates: Creature[] = [game.player, ...game.monsters.filter(m => m !== this && m.hp > 0)];
        for (const target of candidates) {
            if (target.hp <= 0) continue;
            if (!generallyValidBoltTarget(this, target, game)) continue;

            for (const ceBoltName of this.bolts) {
                if (!specificallyValidBoltTarget(this, target, ceBoltName, game)) continue;
                if (this.hasBehavior('MONST_ALWAYS_USE_ABILITY') || rng.randPercent(30)) {
                    game.castMonsterBolt(this, target, ceBoltName);
                    // CE Monsters.c:3139：施法出口耗时 = attackSpeed（CAST_SPELLS_SLOWLY ×2）。
                    this.endTurnWithAttack();
                    return true;
                }
            }
        }
        return false;
    }

    // ------------------------------------------------------------------
    // P4-6：三种攻击几何（怪物侧）
    //
    // CE 事实（本轮已独立确认，详见 ai_docs/p4_6_attack_geometry_report.md）：
    //   - MA_ATTACKS_PENETRATE    = 矛：直线穿透至多 2 格
    //     （handleSpearAttacks 门控，Movement.c:934 —— Rogue.h:2120 的注释
    //       "like an axe" 写反了，以代码为准）
    //   - MA_ATTACKS_ALL_ADJACENT = 斧：横扫全部相邻敌人
    //     （buildHitList(..., sweep=true)，Monsters.c:3879 —— Rogue.h:2121
    //       的注释同样写反）
    //   - MA_ATTACKS_EXTEND       = 鞭：沿直线远距离单体（射程 5）
    //     （handleWhipAttacks 门控，Movement.c:873 —— 这条注释是对的）
    // ------------------------------------------------------------------

    /**
     * CE monsterWillAttackTarget (Monsters.c:333-364), including W-18.
     * Entrancement permits attacking hostile teammates/captives; the ordinary enemy
     * fallback still permits attacking the player and player allies.
     */
    private willAttackTarget(defender: Creature): boolean {
        if (defender === this || defender.hp <= 0) return false;
        const ally = defender instanceof Player || (defender instanceof Monster && defender.isAlly);
        if (this.hasStatus('entranced') && !ally) return true;
        if (this.isAlly && defender.hasStatus('entranced')) return false;
        if (defender instanceof Monster && defender.isCaged) return false;
        return monstersAreEnemies(this, defender) || this.hasStatus('confused');
    }

    /** Movement.c:719 -> moveMonster, independent of the AI turn budget.
     * No pathfinding, flitting, confused reroll, swapping or terrain avoidance.
     * Existing web webs have no STATUS_STUCK counter: on an entangling tile
     * their physical hold supplies the same no-follow gate until freed.
     */
    public moveEntranced(game: Game, dx: number, dy: number): void {
        if (this.hp <= 0 || this.isDormant || !this.hasStatus('entranced')
            || this.hasStatus('paralyzed') || this.isCaged || (!dx && !dy)) return;
        if ((cellTerrainFlags(game.grid, this.loc.x, this.loc.y) & T_ENTANGLES)
            && !this.hasBehavior('MONST_IMMUNE_TO_WEBS') && !this.isInvulnerable()) return;
        const to = { x: this.loc.x + dx, y: this.loc.y + dy };
        if (!game.grid.isValidPos(to.x, to.y)) return;
        if (this.hasStatus('nauseous') && game.tryVomit(this)) return;
        if (this.hasBehavior('MONST_RESTRICTED_TO_LIQUID')
            && !(cellTerrainMechFlags(game.grid, to.x, to.y) & TM_ALLOWS_SUBMERGING)) return;
        const defender = creatureAtLoc(game, to.x, to.y);
        if (!defender) {
            if (this.seized && game.monsters.some(m => m !== this && m.hp > 0 && m.seizing
                && monstersAreEnemies(this, m)
                && Math.max(Math.abs(m.loc.x-this.loc.x), Math.abs(m.loc.y-this.loc.y)) === 1
                && !entrancementDiagonalBlocked(game.grid, this.loc, m.loc))) {
                this.ticksUntilTurn = this.movementSpeed;
                return;
            }
            this.seized = false;
            this.seizing = false;
        }
        if (this.hasAbility('MA_ATTACKS_EXTEND') && this.performWhipAttack(game, dx, dy)) return;
        if (this.hasAbility('MA_ATTACKS_PENETRATE') && this.performSpearAttack(game, dx, dy)) return;
        const throughWall = defender instanceof Monster && defender.hasBehavior('MONST_ATTACKABLE_THRU_WALLS');
        if (!throughWall && (!entrancementPassable(game.grid, to) || !entrancementPassable(game.grid, this.loc)
            || entrancementDiagonalBlocked(game.grid, this.loc, to))) return;
        if (defender) {
            if (!this.willAttackTarget(defender)) return;
            this.ticksUntilTurn = this.attackSpeed;
            if (this.hasAbility('MA_ATTACKS_ALL_ADJACENT')) this.performSweepAttack(game, defender);
            else this.resolveGeometryAttackOn(game, defender, 'hostile');
        } else if (game.placeCreature(this, to, { walkingSecretDoor: true })) {
            this.ticksUntilTurn = this.movementSpeed;
        }
    }

    /**
     * P4-6：CE handleWhipAttacks（Movement.c:855-912）怪物分支 + getImpactLoc
     * （Items.c:4300-4332，maxDistance=5、returnLastEmptySpace=false、BOLT_WHIP）：
     * 沿攻击方向逐格推进，第一个"未隐藏的活物"或"阻挡通行/视线的格子"就是
     * 打击点；打击点上没有可攻击的敌人就不出手（返回 false，调用方照常移动）。
     * 简化（任务书授权）：CE 用 zap(BOLT_WHIP) 做表现与结算，web 没有 bolt
     * 系统，直接用既有近战结算 CombatSystem.attack 打打击点上那一个目标，
     * 不为此新建 bolt 子系统（BE_ATTACK 类 bolt 的结算本就等价于近战攻击）。
     * 省略：diagonalBlocked（web 全局无对角墙角判定，P4-5 起同口径）。
     */
    private performWhipAttack(game: Game, dirX: number, dirY: number,
        voice: 'ally' | 'discordant' | 'hostile' = 'hostile'): boolean {
        let strike: Creature | undefined;
        for (let i = 0; i < 5; i++) {
            const tx = this.loc.x + (1 + i) * dirX;
            const ty = this.loc.y + (1 + i) * dirY;
            const cell = game.grid.getCell(tx, ty);
            if (!cell) break; // CE isPosInMap：射线出图
            const c = creatureAtLoc(game, tx, ty);
            if (c && !c.hasStatus('invisible')) {
                // 未隐藏的活物挡弹（CE getImpactLoc 的 monster 分支，隐藏者被穿过）
                strike = c;
                break;
            }
            if (!cell.isPassable || cell.isOpaque) {
                // 阻挡通行/视线的格子截停：strikeLoc 落在墙格上，
                // monsterAtLoc(墙格) 为空 → 不出手（Movement.c:888 的射程 5 由
                // 本循环 i<5 体现）
                break;
            }
        }
        if (!strike || !this.willAttackTarget(strike)) return false;
        this.resolveGeometryAttackOn(game, strike, voice);
        this.endTurnWithAttack();
        return true;
    }

    /**
     * P4-6：CE handleSpearAttacks（Movement.c:917-1023）怪物分支：
     * 沿方向收集至多 2 格上的敌人（贴脸那格 i==0 无条件算数；远处那格要求
     * 目标未隐藏——对怪物攻击者只需查 monsterIsHidden，web 用 invisible 状态
     * 近似，P4-1b 起同口径）；收集时目标格必须不阻挡通行（或目标带
     * MONST_ATTACKABLE_THRU_WALLS，如墙里的 turret），中途遇到阻挡通行/视线
     * 的格子就 break（穿不过墙）。
     * ★ CE Movement.c:1005-1009：攻击顺序人为倒序（先远后近），注释原文
     *   "Artificially reverse the order of the attacks, so that spears of
     *   force can send both monsters flying."——照实现，测试锁死。
     */
    private performSpearAttack(game: Game, dirX: number, dirY: number,
        voice: 'ally' | 'discordant' | 'hostile' = 'hostile'): boolean {
        const hitList: Creature[] = [];
        let proceed = false;
        for (let i = 0; i < 2; i++) {
            const tx = this.loc.x + (1 + i) * dirX;
            const ty = this.loc.y + (1 + i) * dirY;
            const cell = game.grid.getCell(tx, ty);
            if (!cell) break; // CE isPosInMap
            const defender = creatureAtLoc(game, tx, ty);
            if (defender &&
                (cell.isPassable ||
                    (defender instanceof Monster && defender.hasBehavior('MONST_ATTACKABLE_THRU_WALLS'))) &&
                this.willAttackTarget(defender)) {
                hitList.push(defender);
                if (i === 0 || !defender.hasStatus('invisible')) {
                    proceed = true;
                }
            }
            if (!cell.isPassable || cell.isOpaque) {
                // CE Movement.c:976-979：矛穿不过阻挡通行/视线的格子
                break;
            }
        }
        if (!proceed) return false;
        // CE Movement.c:1007-1009：先打远的、后打近的（倒序）
        for (let i = hitList.length - 1; i >= 0; i--) {
            this.resolveGeometryAttackOn(game, hitList[i]!, voice);
        }
        this.endTurnWithAttack();
        return true;
    }

    /**
     * P4-6：CE buildHitList（Combat.c:2049-2090）sweep 分支 + Monsters.c:3881-3889
     * 攻击循环：以主目标方向为起点旋转遍历 8 个邻格，把"可攻击的敌人"全部
     * 扫掉。CE 原文用 nbDirs 求 dir、却拿去索引 cDirs——两张表顺序不同
     * （GlobalsBase.c:38-39），净效果是 8 个邻格全覆盖、只有命中顺序受影响；
     * web 统一用一张 8 向表旋转，覆盖集合与 CE 完全一致，不逐格复刻这个
     * 表混用（如实取舍，见报告）。
     * 横扫只打 monsterWillAttackTarget 为真的目标（不误伤同阵营），墙里的
     * 目标除非 MONST_ATTACKABLE_THRU_WALLS 否则不打；攻击循环内重查存活
     * （CE Monsters.c:3884 的 MB_IS_DYING 复查）。
     */
    private performSweepAttack(game: Game, primaryTarget: Creature,
        voice: 'ally' | 'discordant' | 'hostile' = 'hostile'): void {
        const dirs8: ReadonlyArray<readonly [number, number]> =
            [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]];
        const dx = Math.sign(primaryTarget.loc.x - this.loc.x);
        const dy = Math.sign(primaryTarget.loc.y - this.loc.y);
        let dir = dirs8.findIndex(d => d[0] === dx && d[1] === dy);
        if (dir < 0) dir = 0; // CE：dir==NO_DIRECTION 时取 UP；primary 必相邻，实际不可达
        for (let i = 0; i < 8; i++) {
            const d = dirs8[(dir + i) % 8]!;
            const tx = this.loc.x + d[0];
            const ty = this.loc.y + d[1];
            const cell = game.grid.getCell(tx, ty);
            if (!cell) continue; // CE coordinatesAreInMap
            const defender = creatureAtLoc(game, tx, ty);
            if (!defender || defender.hp <= 0 || !this.willAttackTarget(defender)) continue;
            if (!cell.isPassable &&
                !(defender instanceof Monster && defender.hasBehavior('MONST_ATTACKABLE_THRU_WALLS'))) continue;
            this.resolveGeometryAttackOn(game, defender, voice);
        }
        this.endTurnWithAttack();
    }

    /**
     * P4-6：相邻近战出口的几何分发（对应 CE moveMonster 里"目标格有怪"的
     * 路径：handleWhipAttacks → handleSpearAttacks → buildHitList(sweep)）。
     * 鞭落空（如目标隐身且身后无人）时照 CE 落回普通近战；矛在相邻场景必然
     * proceed（i==0 命中即成立）；斧横扫恒耗回合（CE Monsters.c:3871 在攻击
     * 循环之前就置 ticksUntilTurn）。返回 true 表示本回合已被几何攻击耗掉。
     */
    private tryGeometryMeleeAdjacent(game: Game, primaryTarget: Creature,
        voice: 'ally' | 'discordant' | 'hostile' = 'hostile'): boolean {
        const dx = Math.sign(primaryTarget.loc.x - this.loc.x);
        const dy = Math.sign(primaryTarget.loc.y - this.loc.y);
        if (this.hasAbility('MA_ATTACKS_EXTEND') && this.performWhipAttack(game, dx, dy, voice)) return true;
        if (this.hasAbility('MA_ATTACKS_PENETRATE') && this.performSpearAttack(game, dx, dy, voice)) return true;
        if (this.hasAbility('MA_ATTACKS_ALL_ADJACENT')) {
            this.performSweepAttack(game, primaryTarget, voice);
            return true;
        }
        return false;
    }

    /**
     * P4-6：几何攻击的单目标结算 + 既有近战出口的后置处理（消息/漂浮文字/
     * onHit 状态/分裂/击退），口径与 takeTurn 的三个既有近战出口一致：
     * 目标为玩家走 HUNTING 出口同款、为怪物按 voice 使用对应出口的既有消息键
     * （ally/discordant 出口各有自己的消息词汇，几何攻击发生在哪个出口就沿用
     * 哪个出口的说法；hostile 对怪物的几何攻击用新键）。新增 i18n 键只带
     * defaultValue（harness 空资源回退 defaultValue，zh_CN 资源文件不在本轮
     * 文件边界内）。
     */
    private resolveGeometryAttackOn(game: Game, target: Creature, voice: 'ally' | 'discordant' | 'hostile'): void {
        const result = CombatSystem.attack(this, target, {
            beforeDamage: target === game.player ? damage => game.tryTriggerArmorRunic(this, damage, true) : undefined,
        });
        if (result.kamikazeSelfDestruct) {
            // 仅变异注入场景可达（五种几何怪原生无 MA_KAMIKAZE）
            const kamikazeKey = voice === 'ally' ? 'combat.ally_kamikaze'
                : voice === 'discordant' ? 'combat.discordant_kamikaze'
                : 'combat.geometry_kamikaze';
            logger.log(i18next.t(kamikazeKey, {
                attacker: this.name, target: target.name,
                defaultValue: `The ${this.name} bursts against the ${target.name}!`
            }), '#ff8800');
        } else if (result.seized) {
            const seizeKey = voice === 'ally' ? 'combat.ally_seizes'
                : voice === 'discordant' ? 'combat.discordant_seizes'
                : 'combat.geometry_seizes';
            logger.log(i18next.t(seizeKey, {
                attacker: this.name, target: target.name,
                defaultValue: `The ${this.name} seizes the ${target.name}!`
            }), '#ffcc88');
        } else if (target === game.player) {
            if (result.damage > 0) {
                game.lastDamageSource = this.name;
                logger.log(i18next.t('combat.monster_hits_you', {
                    monster: this.name,
                    damage: result.damage,
                    defaultValue: `The ${this.name} hits you for ${result.damage} damage.`
                }), '#ff6666');
                game.spawnFloatingText(`-${result.damage}`, game.player.loc.x, game.player.loc.y, 0xff5555);
                game.spawnBlood(game.player.loc.x, game.player.loc.y);
                if (this.onHitStatus && this.onHitDuration > 0 && rng.randPercent(Math.floor(this.onHitChance * 100))) {
                    game.applyMonsterOnHitStatus(this.name, this.onHitStatus, this.onHitDuration);
                }
                if (this.hasAbility('MA_HIT_HALLUCINATE')) {
                    game.applyMonsterOnHitStatus(this.name, 'hallucinating', 15);
                }
                if (this.hasAbility('MA_HIT_DEGRADE_ARMOR')) {
                    // I-1：ITEM_PROTECTED 豁免（CE Combat.c:425-431——带保护则完全
                    // 跳过腐蚀，无任何消息；isProtected 由 protect_weapon/armor
                    // 卷轴置位，Game.protectEquippedGear）。
                    if (game.player.equippedArmor && !game.player.equippedArmor.isProtected && game.player.equippedArmor.enchantment > -3) {
                        game.player.equippedArmor.enchantment -= 1;
                        logger.log(i18next.t('combat.armor_degraded', { defaultValue: 'Your armor is corroded by acid!' }), '#ffaaaa');
                    }
                }
                if (this.hasAbility('MA_HIT_STEAL_FLEE')) {
                    this.state = MonsterState.FLEEING;
                    logger.log(i18next.t('combat.monkey_steals', { defaultValue: `The ${this.name} grabs something and flees!` }), '#ffffaa');
                }
                if (game.player.hp <= 0) {
                    logger.log(i18next.t('combat.you_have_been_slain', {
                        defaultValue: 'You have been slain.'
                    }), '#ff0000');
                }
            } else {
                logger.log(i18next.t('combat.monster_misses_you', {
                    monster: this.name,
                    defaultValue: `The ${this.name} misses you.`
                }), '#aaaaaa');
                game.spawnFloatingText(
                    i18next.t('combat.miss_short', { defaultValue: 'Miss' }),
                    game.player.loc.x,
                    game.player.loc.y,
                    0xaaaaaa
                );
            }
        } else {
            // 打怪物：按 voice 沿用对应出口的既有消息键（ally/discordant），
            // hostile 对怪物的几何攻击用新键
            const hitKey = voice === 'ally' ? 'combat.ally_hits'
                : voice === 'discordant' ? 'combat.discordant_hits'
                : 'combat.geometry_hits_monster';
            const missKey = voice === 'ally' ? 'combat.ally_misses'
                : voice === 'discordant' ? 'combat.discordant_misses'
                : 'combat.geometry_misses_monster';
            if (result.damage > 0) {
                logger.log(i18next.t(hitKey, {
                    attacker: this.name, target: target.name, damage: result.damage,
                    defaultValue: voice === 'discordant'
                        ? `The ${this.name} turns on the ${target.name} for ${result.damage} damage!`
                        : `The ${this.name} hits the ${target.name} for ${result.damage} damage.`
                }), '#ff88aa');
                game.spawnFloatingText(`-${result.damage}`, target.loc.x, target.loc.y, 0xff5555);
                game.spawnBlood(target.loc.x, target.loc.y);
                (game as any).trySplitMonster(target, this);
                if (this.onHitStatus && this.onHitDuration > 0 && rng.randPercent(Math.floor(this.onHitChance * 100))) {
                    (game as any).applyStatusToMonster(target, this.onHitStatus, this.onHitDuration, 'poison');
                }
            } else {
                logger.log(i18next.t(missKey, {
                    attacker: this.name, target: target.name,
                    defaultValue: `The ${this.name} misses the ${target.name}.`
                }), '#aaaaaa');
            }
        }
        // P4-5 口径：命中且目标存活才推（CE specialHit 只在 defender 存活分支调用）
        if (result.hit && !result.kamikazeSelfDestruct && !result.seized &&
            target.hp > 0 && this.hasAbility('MA_ATTACKS_STAGGER')) {
            (game as any).processStaggerHit(this, target);
        }
    }

    /**
     * P4-6：主目标是否恰在本怪物某条 8 向射线上；返回射线步数（≥1），不在
     * 任何射线上返回 0。CE 的追击方向来自 scentDirection（Monsters.c:3473/3488，
     * 指向目标的 8 向梯度，不绕开友军）——所以直线上 2 格内的矛 / 5 格内的
     * 鞭在追击途中就出手，这是远程几何的主要触发方式。
     */
    private rayStepsTo(target: Creature): number {
        const vx = target.loc.x - this.loc.x;
        const vy = target.loc.y - this.loc.y;
        const k = Math.max(Math.abs(vx), Math.abs(vy));
        if (k < 1) return 0;
        const dx = Math.sign(vx);
        const dy = Math.sign(vy);
        return (vx === dx * k && vy === dy * k) ? k : 0;
    }

    /**
     * P4-6：追击（尚不相邻）阶段的鞭/矛尝试，沿"直指目标"的射线（CE
     * scentDirection → moveMonster 的同构）。命中即耗回合并返回 true。
     * 只在目标恰在 8 向射线上时尝试（CE 的射线也只沿 8 向延伸，斜线上
     * 不在射线延长线的目标本来就打不到）。
     */
    private tryGeometryRayTo(game: Game, target: Creature,
        voice: 'ally' | 'discordant' | 'hostile' = 'hostile'): boolean {
        if (!this.hasAbility('MA_ATTACKS_EXTEND') && !this.hasAbility('MA_ATTACKS_PENETRATE')) {
            return false;
        }
        if (this.rayStepsTo(target) === 0) return false;
        const dx = Math.sign(target.loc.x - this.loc.x);
        const dy = Math.sign(target.loc.y - this.loc.y);
        if (this.hasAbility('MA_ATTACKS_EXTEND') && this.performWhipAttack(game, dx, dy, voice)) return true;
        if (this.hasAbility('MA_ATTACKS_PENETRATE') && this.performSpearAttack(game, dx, dy, voice)) return true;
        return false;
    }

    public override canBePoisoned(): boolean {
        return super.canBePoisoned() && !this.hasBehavior('MONST_INANIMATE') && !this.isInvulnerable();
    }

    /** CE Monsters.c:1839-1847: objective regeneration precedes poison decrement. */
    public recoverPerTick(): void {
        if (this.hp > 0 && this.regenTurns > 0 && this.hp < this.maxHp && !this.hasStatus('poisoned')) {
            this.regenCounter++;
            if (this.regenCounter >= this.regenTurns) {
                this.hp = Math.min(this.maxHp, this.hp + 1);
                this.regenCounter = 0;
            }
        }
    }

    /** Preserve the actual converted form, including mutations/negated flags,
     * instead of guessing a species from a translated display name on load. */
    public dominationForm(): MonsterData | undefined {
        return this.dominated ? this.snapshotForm() : undefined;
    }

    /** Snapshot allocation is not spawning: no sleep lottery, translation, or
     * flag-derived status writes. The codec restores every remaining field. */
    public static allocateForSnapshot(form: MonsterData): Monster {
        const monster = Object.create(Monster.prototype) as Monster;
        monster.baseMoveSpeed = form.moveSpeed!;
        monster.baseAttackSpeed = form.attackSpeed!;
        return monster;
    }

    /** Shared W-17/W-18 payload for effects whose save must retain actual traits. */
    public snapshotForm(): MonsterData {
        return { id: this.typeId, name: this.name, char: this.char, color: this.color,
            hp: this.maxHp, damage: this.damageString, clumping: this.damageClumping, minDepth: 1, maxDepth: 99,
            accuracy: this.accuracy, defense: this.defense, regen: this.regenTurns,
            moveSpeed: this.baseMoveSpeed, attackSpeed: this.baseAttackSpeed,
            goldDropChance: this.goldDropChance, itemDropChance: this.itemDropChance,
            abilities: [...this.abilities], behaviorFlags: [...this.behaviorFlags],
            abilityFlags: [...this.abilityFlags], bolts: [...this.bolts], description: this.description,
            onHitStatus: this.onHitStatus, onHitChance: this.onHitChance, onHitDuration: this.onHitDuration,
            statusImmunities: [...this.statusImmunities], statusResistTurns: { ...this.statusResistTurns } };
    }

    public takeTurn(game: Game, stealthRange: number) {
        if (this.hp <= 0) return;
        if (this.hasStatus('paralyzed') || this.hasStatus('entranced')) return;
        if (this.isCaged) return;

        // P4-1b：CE monstUseMagic 在移动/近战之前优先尝试（monstersTurn 各出口
        // 调用 monstUseMagic 都在移动决策之前）。沉睡怪物不参与（CE 沉睡怪物
        // 根本不进 monstersTurn）；ALLY 与 HUNTING/WANDERING 共用同一个出口，
        // 与 CE 一致（generallyValidBoltTarget 只在 discordant+WANDERING 时
        // 排斥玩家目标，不整体禁止 WANDERING 施法）。
        if (this.state !== MonsterState.ASLEEP) {
            // P4-2：CE monstUseMagic = monsterSummons(monst, always) || monstUseBolt(monst)——
            // 召唤先于 bolt 判定，命中即用掉本回合，同一入口不再试 bolt。
            if (this.trySummon(game)) {
                return;
            }
            if (!(this.state === MonsterState.FLEEING && this.hasStatus('magical_fear')) && this.tryUseBolt(game)) {
                return;
            }
        }

        // CE MONST_IMMOBILE："monster won't move or perform melee attacks"；
        // MONST_TURRET 隐含 MONST_IMMOBILE（Rogue.h:2093）。web 的 behaviorFlags
        // 只存了 "MONST_TURRET" 这个复合标记（未展开成员 flags），这里按语义
        // 一并当作不可移动/不可近战处理。施法失败（未命中目标/未过 30%）时
        // 本回合无其它动作——不会像旧的 'ranged' 占位那样退化成普通近战/移动。
        const isImmobile = this.hasBehavior('MONST_IMMOBILE') || this.hasBehavior('MONST_TURRET');
        if (isImmobile) {
            return;
        }

        if (this.isAlly && !this.hasStatus('magical_fear')) {
            const independentBlade = this.typeId === 'spectral_blade' && this.doesNotTrackLeader;
            const canBladeStep = (p: { x: number; y: number }) => !(p.x === this.loc.x && p.y === this.loc.y)
                && !bladeAvoids(game.grid, p) && !bladeDiagonalBlocked(game.grid, this.loc, p)
                && !game.getMonsterAt(p.x, p.y) && !(game.player.loc.x === p.x && game.player.loc.y === p.y);
            // Find closest hostile monster
            let target: Monster | null = null;
            let minDist = Infinity;
            for (const other of game.monsters) {
                if (other === this || other.hp <= 0 || other.isAlly || other.hasStatus('entranced')) continue;
                if (independentBlade) {
                    // CE moveAlly/traversiblePathBetween: the blade's terrain path,
                    // not the player's FOV; never charge an invulnerable target.
                    if (other.isCaged || other.isInvulnerable() || other.isImmuneToWeapons()) continue;
                    const line = boltLine(game.grid, this.loc, other.loc, BLADE_SIGHT, {
                        caster: this, creatureAt: p => creatureAtLoc(game, p.x, p.y),
                    });
                    let reachable = false;
                    for (const p of line) {
                        if (p.x === other.loc.x && p.y === other.loc.y) { reachable = true; break; }
                        if (bladeAvoids(game.grid, p)) break;
                    }
                    if (!reachable || bladeAvoids(game.grid, other.loc)
                        || (other.hasStatus('invisible') && !rng.randPercent(33))) continue;
                } else if (!game.grid.getCell(other.loc.x, other.loc.y)?.isVisible) continue;

                const dist = Math.max(Math.abs(this.loc.x - other.loc.x), Math.abs(this.loc.y - other.loc.y));
                // P4-4：CE monsterFleesFrom（Monsters.c:2979-2982）—— 不主动冲向
                // MA_KAMIKAZE 目标（膨胀怪），已经贴脸的除外（不阻止已经相邻的近战，
                // 那部分由下面 minDist<=1 分支正常处理）。web 没有 monsterFleesFrom
                // 的完整移植（它还管无敌怪物/献祭目标等，本轮只接 kamikaze 这一条，
                // 其余在报告里登记为已知缺口）。
                if (dist > 1 && other.hasAbility('MA_KAMIKAZE')) continue;
                if (dist < minDist) {
                    minDist = dist;
                    target = other;
                }
            }

            if (target) {
                // We have an enemy
                // P4-1b：原先此处有 abilities.has('ranged') 的桩（minDist<=8 时走
                // CombatSystem.attack 冒充远程）。核实后 web 侧唯一同时带
                // abilities:['ranged'] 与 bolts 的怪物是 centaur（DISTANCE_ATTACK），
                // 已被上面新增的 tryUseBolt 出口接管；继续保留这个桩会导致
                // "30% 施法判定 miss 后又白嫖一次等效远程攻击"的双重远程，
                // 与 CE monstUseBolt 的语义不符，故整段移除（详见报告）。
                if (minDist <= 1) {
                    if (independentBlade && bladeDiagonalBlocked(game.grid, this.loc, target.loc)) return;
                    // P4-6：斧/矛/鞭的相邻近战几何分发（CE moveMonster 在普通
                    // attack 之前先试鞭/矛，sweep 替换单体近战）。
                    if (this.hasStatus('nauseous') && game.tryVomit(this)) return;
                    if (this.tryGeometryMeleeAdjacent(game, target, 'ally')) {
                        return;
                    }
                    const result = CombatSystem.attack(this, target);
                    if (result.kamikazeSelfDestruct) {
                        // P4-4：CE MA_KAMIKAZE（Combat.c:1159-1162）——攻击者代替
                        // 造成伤害而自毁，早于命中掷骰，不会走"miss"分支。
                        logger.log(i18next.t('combat.ally_kamikaze', {
                            ally: this.name, target: target.name,
                            defaultValue: `Your ${this.name} explodes against the ${target.name}!`
                        }), '#ff8800');
                    } else if (result.seized) {
                        // P4-5：CE MA_SEIZES（Combat.c:1212-1237）——第一次贴脸不是
                        // 攻击而是抓住，伤害恒 0，不算命中也不算 miss。
                        logger.log(i18next.t('combat.ally_seizes', {
                            ally: this.name, target: target.name,
                            defaultValue: `Your ${this.name} seizes the ${target.name}!`
                        }), '#ffcc88');
                    } else if (result.damage > 0) {
                        logger.log(i18next.t('combat.ally_hits', {
                            ally: this.name, target: target.name, damage: result.damage,
                            defaultValue: `Your ${this.name} hits the ${target.name} for ${result.damage} damage.`
                        }), '#88ff88');
                        game.spawnFloatingText(`-${result.damage}`, target.loc.x, target.loc.y, 0xff5555);
                        if (this.onHitStatus && this.onHitDuration > 0 && rng.randPercent(Math.floor(this.onHitChance * 100))) {
                            game.applyMonsterOnHitStatus(target.name, this.onHitStatus, this.onHitDuration); // Note: Game.ts applyMonsterOnHitStatus assumes player as target right now, we need to fix this if it handles player only, actually CombatSystem doesn't apply status, Game.ts does. Wait!
                            // Instead of Game method, just use applyStatusToMonster from game directly if it was public. We will check it later.
                            // Actually, Game's applyStatusToMonster exists!
                            (game as any).applyStatusToMonster(target, this.onHitStatus, this.onHitDuration, 'poison');
                        }
                        // P4-4：CE splitMonster(defender, attacker)（Combat.c:1424）——
                        // 命中后，若目标带 MA_CLONE_SELF_ON_DEFEND 且仍存活，尝试分裂。
                        (game as any).trySplitMonster(target, this);
                    } else {
                        logger.log(i18next.t('combat.ally_misses', { ally: this.name, target: target.name, defaultValue: `Your ${this.name} misses the ${target.name}.` }), '#aaaaaa');
                    }
                    // P4-5：CE specialHit()（Combat.c:534）只在"命中且未被杀死"时
                    // 调用 processStaggerHit——kamikaze/seize 分支已经 return，不会
                    // 走到这里；miss（result.hit===false）也被 !result.hit 排除。
                    if (result.hit && !result.kamikazeSelfDestruct && !result.seized &&
                        target.hp > 0 && this.hasAbility('MA_ATTACKS_STAGGER')) {
                        (game as any).processStaggerHit(this, target);
                    }
                    this.endTurnWithAttack();
                    return;
                } else {
                    if (independentBlade) {
                        const step = bladeStepToward(this.loc, target.loc, canBladeStep);
                        if (step) this.tryMoveTo(step.x, step.y, game);
                        return;
                    }
                    // P4-6：盟友追击途中先沿"直指目标"的射线试鞭/矛（CE
                    // moveMonster 的几何检查先于移动，见 tryGeometryRayTo 注释）。
                    if (this.tryGeometryRayTo(game, target, this.isAlly ? 'ally' : 'hostile')) {
                        return;
                    }
                    const isFlying = this.abilities.has('flying') || this.hasBehavior('MONST_FLIES');
                    const path = Pathfind.findPath(game.grid, this.loc.x, this.loc.y, target.loc.x, target.loc.y, (x, y) => {
                        const c = game.grid.getCell(x, y);
                        if (!c) return false;
                        if (isFlying) return !c.isOpaque && !game.getMonsterAt(x, y) && !(game.player.loc.x === x && game.player.loc.y === y);
                        return c.isPassable && !game.getMonsterAt(x, y) && !(game.player.loc.x === x && game.player.loc.y === y);
                    });

                    if (path && path.length > 0) {
                        const nextStep = path[0]!;
                        this.tryMoveTo(nextStep.x, nextStep.y, game);
                    }
                }
            } else {
                if (independentBlade) {
                    // CE monsterMillAbout(monst, 30), never follow the player.
                    if (rng.randPercent(30)) {
                        const steps = BLADE_DIRECTIONS.map(([dx, dy]) => ({ x: this.loc.x + dx, y: this.loc.y + dy })).filter(canBladeStep);
                        if (steps.length) {
                            const p = steps[rng.randRange(0, steps.length - 1)]!;
                            this.tryMoveTo(p.x, p.y, game);
                        }
                    }
                    return;
                }
                // Follow player
                const distToPlayer = Math.max(Math.abs(this.loc.x - game.player.loc.x), Math.abs(this.loc.y - game.player.loc.y));
                if (distToPlayer > 2) {
                    const isFlying = this.abilities.has('flying') || this.hasBehavior('MONST_FLIES');
                    const path = Pathfind.findPath(game.grid, this.loc.x, this.loc.y, game.player.loc.x, game.player.loc.y, (x, y) => {
                        const c = game.grid.getCell(x, y);
                        if (!c) return false;
                        if (isFlying) return !c.isOpaque && !game.getMonsterAt(x, y);
                        return c.isPassable && !game.getMonsterAt(x, y);
                    });

                    if (path && path.length > 0) {
                        const nextStep = path[0]!;
                        this.tryMoveTo(nextStep.x, nextStep.y, game);
                    }
                }
            }
            return;
        }

        const distToPlayer = Math.max(Math.abs(this.loc.x - game.player.loc.x), Math.abs(this.loc.y - game.player.loc.y));
        const canSeePlayer = game.hasLineOfSight(this.loc.x, this.loc.y, game.player.loc.x, game.player.loc.y);
        const playerDetectRange = game.player.hasStatus('invisible') ? 1 : stealthRange;

        // Wake up / Notice player logic
        if (this.state === MonsterState.ASLEEP || this.state === MonsterState.WANDERING) {
            if (canSeePlayer && distToPlayer <= playerDetectRange) {
                // Wake up and hunt!
                this.state = MonsterState.HUNTING;
                game.spawnFloatingText('!', this.loc.x, this.loc.y, 0xff0000);
            }
        }

        // P4-8 返工：CE updateMonsterState（Monsters.c:1718 起）每回合用
        // awareOfTarget 重算感知，追踪态丢失感知 → 回 WANDERING（Monsters.c:
        // 1776-1779；wanderToward(lastSeenPlayerAt) 因 web 无 lastSeen 记账
        // 退化为普通 WANDERING，见报告）。ALWAYS_HUNTING 在 CE 里是
        // updateMonsterState 的首分支（1725-1731）：强制保持 TRACKING 并直接
        // return，awareOfTarget 根本不被调用——这里同样短路，既豁免硬截断
        // 也不消耗 RNG 流。IMMOBILE 怪在上方 862 行已早退（web 炮塔无
        // 沉睡/唤醒状态机，CE 的 IMMOBILE 感知分支本轮不接线，见报告取舍）。
        // 不 return：CE 里 updateMonsterState 只改状态，怪物本回合继续以
        // 新状态行动（Web 落入下方 WANDERING 分支，同构）。
        if (this.state === MonsterState.HUNTING && !this.hasBehavior('MONST_ALWAYS_HUNTING')) {
            const awareOfPlayer = game.scent.awareOfTarget(
                game.grid, this.loc.x, this.loc.y, game.player.loc.x, game.player.loc.y,
                { alwaysHunting: false, immobile: isImmobile, tracking: true, stealthRange }
            );
            if (!awareOfPlayer) {
                this.state = MonsterState.WANDERING;
            }
        }

        if (this.hasStatus('confused')) {
            if (rng.randPercent(70)) {
                const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, 1], [-1, 1], [1, -1]];
                const dir = dirs[rng.randRange(0, dirs.length - 1)]!;
                const nx = this.loc.x + dir[0]!;
                const ny = this.loc.y + dir[1]!;
                const c = game.grid.getCell(nx, ny);
                if (c && c.isPassable && !game.getMonsterAt(nx, ny) && !(game.player.loc.x === nx && game.player.loc.y === ny)) {
                    this.tryMoveTo(nx, ny, game);
                }
                return;
            }
        }

        if (this.hasBehavior('MONST_FLEES_NEAR_DEATH') && this.hp < this.maxHp * 0.25 && this.state !== MonsterState.FLEEING) {
            this.state = MonsterState.FLEEING;
            game.spawnFloatingText('?', this.loc.x, this.loc.y, 0xaaaa00);
        }

        const isFlying = this.abilities.has('flying') || this.hasBehavior('MONST_FLIES');

        if (this.state === MonsterState.FLEEING) {
            if (!this.hasStatus('magical_fear') && this.hp > this.maxHp * 0.75) {
                this.state = MonsterState.HUNTING;
            } else if (!this.hasStatus('magical_fear') && distToPlayer > playerDetectRange + 2) {
                this.state = MonsterState.WANDERING;
                return;
            } else {
                // P4-9：顺 safety map 下坡逃（CE Monsters.c:3503
                // `dir = nextStep(getSafetyMap(monst), monst->loc, NULL, true)`）。
                // getSafetyMap 的双路径（实时图 / 察觉不到玩家的怪物私有快照）
                // 在 getSafetyMapForMonster 内（Monsters.c:2380-2400）。
                // 取代旧的"切比雪夫最远邻格"贪心——它只看直线距离不看连通性，
                // 会一头扎进死胡同（本轮的核心病灶）。
                const safetyCanEnter = (x: number, y: number): boolean => {
                    const c = game.grid.getCell(x, y);
                    if (!c) return false;
                    if (isFlying ? c.isOpaque : !c.isPassable) return false;
                    return !game.getMonsterAt(x, y) && !(game.player.loc.x === x && game.player.loc.y === y);
                };
                const map = getSafetyMapForMonster(game, this);
                const dir = safetyNextStep(map, game.grid, this.loc.x, this.loc.y);
                if (dir && safetyCanEnter(this.loc.x + dir[0], this.loc.y + dir[1])) {
                    this.tryMoveTo(this.loc.x + dir[0]!, this.loc.y + dir[1]!, game);
                    return;
                }
                if (dir && dir[0] !== 0 && dir[1] !== 0) {
                    // CE 的 moveMonster 兜底（Monsters.c:3510-3512 的
                    // moveMonsterPassivelyTowards）近似：对角下坡格被挡时，
                    // 尝试它的两个正交分量（CE 逐轴向目标滑动的简化口径）。
                    const orthogonal: Array<readonly [number, number]> =
                        [[this.loc.x + dir[0], this.loc.y], [this.loc.x, this.loc.y + dir[1]]];
                    for (const [cx, cy] of orthogonal) {
                        if (safetyCanEnter(cx, cy)) {
                            this.tryMoveTo(cx, cy, game);
                            return;
                        }
                    }
                }
                // 走投无路（Monsters.c:3513-3523）：CE 会反击贴脸的敌人（玩家
                // 优先，且 STATUS_MAGICAL_FEAR 豁免；CE 还会扫
                // 贴脸的其他怪物，web 无该目标谱系，见报告）。web 只处理贴脸
                // 玩家：过几何分发后走标准近战。
                if (distToPlayer <= 1 && !this.hasStatus('magical_fear')) {
                    if (this.hasStatus('nauseous') && game.tryVomit(this)) return;
                    if (this.tryGeometryMeleeAdjacent(game, game.player)) {
                        return;
                    }
                    const result = CombatSystem.attack(this, game.player);
                    if (result.kamikazeSelfDestruct) {
                        logger.log(i18next.t('combat.monster_kamikaze', {
                            monster: this.name,
                            defaultValue: `The ${this.name} lunges at you and bursts!`
                        }), '#ff8800');
                    } else if (result.seized) {
                        logger.log(i18next.t('combat.monster_seizes_you', {
                            monster: this.name,
                            defaultValue: `The ${this.name} seizes you!`
                        }), '#ffcc88');
                    } else if (result.damage > 0) {
                        game.lastDamageSource = this.name;
                        logger.log(i18next.t('combat.monster_hits_you', {
                            monster: this.name, damage: result.damage,
                            defaultValue: `The ${this.name} hits you for ${result.damage} damage.`
                        }), '#ff6666');
                        game.spawnFloatingText(`-${result.damage}`, game.player.loc.x, game.player.loc.y, 0xff5555);
                        game.spawnBlood(game.player.loc.x, game.player.loc.y);
                    } else {
                        logger.log(i18next.t('combat.monster_misses_you', {
                            monster: this.name,
                            defaultValue: `The ${this.name} misses you.`
                        }), '#aaaaaa');
                    }
                    this.endTurnWithAttack();
                }
                return;
            }
        }

        // W-16: close the new blade's combat loop without rewriting general ally
        // AI. CE MC:3449-3464 / 3575: awake enemies attack an adjacent ally;
        // hunting enemies prefer an accessible adjacent player. No horde targets
        // gain this branch unless W-17 actually converts them with domination.
        if ((this.state === MonsterState.HUNTING || this.state === MonsterState.WANDERING)
            && (this.state !== MonsterState.HUNTING || distToPlayer > 1
                || bladeDiagonalBlocked(game.grid, this.loc, game.player.loc))) {
            const blade = game.monsters.find(m => ((m.typeId === 'spectral_blade' && m.boundToPlayer) || (m.dominated && m.isAlly))
                && this.willAttackTarget(m) && Math.max(Math.abs(m.x - this.x), Math.abs(m.y - this.y)) === 1
                && !bladeDiagonalBlocked(game.grid, this.loc, m.loc)
                && (!m.hasStatus('invisible') || rng.randPercent(33)));
            if (blade) {
                if (this.hasStatus('nauseous') && game.tryVomit(this)) return;
                if (!this.tryGeometryMeleeAdjacent(game, blade)) {
                    this.resolveGeometryAttackOn(game, blade, 'hostile');
                    this.endTurnWithAttack();
                }
                return;
            }
        }

        if (this.state === MonsterState.HUNTING) {
            // P4-8：CE 在重获视野/贴近玩家时清 MB_GIVEN_UP_ON_SCENT
            //（Monsters.c:2101/3234，简化为"重见即清"）。
            if (canSeePlayer) {
                this.givenUpOnScent = false;
            }
            // CE Monsters.c:343-360/390：discordant 怪物敌我不分，会把相邻的其他
            // 怪物也当作攻击目标（对玩家仍视为敌人）。置于"丢失视野掉回 WANDERING"
            // 判定之前，使看不到玩家的 discordant 怪也会转身撕咬身边同类。
            if (this.hasStatus('discordant')) {
                // 方向顺序与下方 confused/WANDERING 分支的 dirs 保持一致（8 方向去重）
                const dirs8 = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, 1], [-1, 1], [1, -1]];
                for (const [dx, dy] of dirs8) {
                    const other = game.getMonsterAt(this.loc.x + dx!, this.loc.y + dy!);
                    if (other && other !== this && other.hp > 0) {
                        // P4-6：同 ally 分支——discordant 怪的近战同样先过几何分发
                        // （CE 同一条 moveMonster 路径，不区分阵营来源）。
                        if (this.hasStatus('nauseous') && game.tryVomit(this)) return;
                        if (this.tryGeometryMeleeAdjacent(game, other, 'discordant')) {
                            return;
                        }
                        const result = CombatSystem.attack(this, other);
                        if (result.kamikazeSelfDestruct) {
                            logger.log(i18next.t('combat.discordant_kamikaze', {
                                attacker: this.name, target: other.name,
                                defaultValue: `The ${this.name} explodes against the ${other.name}!`
                            }), '#ff8800');
                        } else if (result.seized) {
                            logger.log(i18next.t('combat.discordant_seizes', {
                                attacker: this.name, target: other.name,
                                defaultValue: `The ${this.name} seizes the ${other.name}!`
                            }), '#ffcc88');
                        } else if (result.damage > 0) {
                            logger.log(i18next.t('combat.discordant_hits', {
                                attacker: this.name, target: other.name, damage: result.damage,
                                defaultValue: `The ${this.name} turns on the ${other.name} for ${result.damage} damage!`
                            }), '#ff88aa');
                            game.spawnFloatingText(`-${result.damage}`, other.loc.x, other.loc.y, 0xff5555);
                            game.spawnBlood(other.loc.x, other.loc.y);
                            (game as any).trySplitMonster(other, this);
                        } else {
                            logger.log(i18next.t('combat.discordant_misses', {
                                attacker: this.name, target: other.name,
                                defaultValue: `The ${this.name} misses the ${other.name}.`
                            }), '#aaaaaa');
                        }
                        // P4-5：同上（ally 分支）——命中且未被杀死时才推。
                        if (result.hit && !result.kamikazeSelfDestruct && !result.seized &&
                            other.hp > 0 && this.hasAbility('MA_ATTACKS_STAGGER')) {
                            (game as any).processStaggerHit(this, other);
                        }
                        this.endTurnWithAttack();
                        return;
                    }
                }
            }

            // P4-8 返工更正：CE 的追踪怪有两条放弃路径——①气味死路（本分支，
            // scentDirection 无路 + isLocalScentMaximum + 不在玩家视野内 →
            // MONSTER_WANDERING，Monsters.c:3475-3484）；②气味太陈旧/太远
            // （awareOfTarget 的 awareness*3 硬截断与 3% 丢目标，经
            // updateMonsterState → MONSTER_WANDERING，Monsters.c:1776-1779）。
            // ②已在本回合开头（唤醒判定之后）接线。原先"按直线距离丢目标"
            // 的旧实现确实与 CE 不符，但正确替代是感知判定而非无截断。

            // P4-1b：原 abilities.has('ranged') 远程桩已移除，理由同上（ally 分支
            // 注释）——centaur 的 DISTANCE_ATTACK 现在完全走 tryUseBolt 出口。

            // Adjacent to player -> Melee Attack!
            if (distToPlayer <= 1) {
                // P4-6：同 ally 分支——怪物贴脸玩家的近战先过几何分发
                // （矛会顺带打中玩家身后的目标，斧会扫掉全部相邻敌人）。
                if (this.hasStatus('nauseous') && game.tryVomit(this)) return;
                if (this.tryGeometryMeleeAdjacent(game, game.player)) {
                    return;
                }
                const result = CombatSystem.attack(this, game.player, {
                    beforeDamage: damage => game.tryTriggerArmorRunic(this, damage, true),
                });
                if (result.kamikazeSelfDestruct) {
                    // P4-4：CE MA_KAMIKAZE（Combat.c:1159-1162）——攻击者自毁代替
                    // 造成伤害；三只膨胀怪的 damage 都是 0d1，本来也打不出伤害，
                    // 真正的杀伤来自死亡触发的 DF（Game.triggerDeathFeatures）。
                    logger.log(i18next.t('combat.monster_kamikaze', {
                        monster: this.name,
                        defaultValue: `The ${this.name} lunges at you and bursts!`
                    }), '#ff8800');
                    game.spawnFloatingText(
                        i18next.t('combat.kamikaze_short', { defaultValue: 'Boom!' }),
                        game.player.loc.x, game.player.loc.y, 0xff8800
                    );
                } else if (result.seized) {
                    // P4-5：CE MA_SEIZES（Combat.c:1212-1237）——第一次贴脸抓住玩家，
                    // 伤害恒 0，不进入命中率判定；玩家的移动解除见
                    // Game.handlePlayerAction 'move' 分支的 player.seized 检查。
                    logger.log(i18next.t('combat.monster_seizes_you', {
                        monster: this.name,
                        defaultValue: `The ${this.name} seizes you!`
                    }), '#ffcc88');
                } else if (result.damage > 0) {
                    game.lastDamageSource = this.name;
                    logger.log(i18next.t('combat.monster_hits_you', {
                        monster: this.name,
                        damage: result.damage,
                        defaultValue: `The ${this.name} hits you for ${result.damage} damage.`
                    }), '#ff6666');
                    game.spawnFloatingText(`-${result.damage}`, game.player.loc.x, game.player.loc.y, 0xff5555);
                    game.spawnBlood(game.player.loc.x, game.player.loc.y);
                    if (this.onHitStatus && this.onHitDuration > 0 && rng.randPercent(Math.floor(this.onHitChance * 100))) {
                        game.applyMonsterOnHitStatus(this.name, this.onHitStatus, this.onHitDuration);
                    }
                    if (this.hasAbility('MA_HIT_HALLUCINATE')) {
                        game.applyMonsterOnHitStatus(this.name, 'hallucinating', 15);
                    }
                    if (this.hasAbility('MA_HIT_DEGRADE_ARMOR')) {
                        // I-1：ITEM_PROTECTED 豁免（CE Combat.c:425-431——带保护则
                        // 完全跳过腐蚀，无任何消息）。与 resolveGeometryAttackOn
                        // 的近战支同款（P4-6 几何分发的两处落点都要过这道门）。
                        if (game.player.equippedArmor && !game.player.equippedArmor.isProtected && game.player.equippedArmor.enchantment > -3) {
                            game.player.equippedArmor.enchantment -= 1;
                            logger.log(i18next.t('combat.armor_degraded', { defaultValue: 'Your armor is corroded by acid!' }), '#ffaaaa');
                        }
                    }
                    if (this.hasAbility('MA_HIT_STEAL_FLEE')) {
                        this.state = MonsterState.FLEEING;
                        logger.log(i18next.t('combat.monkey_steals', { defaultValue: `The ${this.name} grabs something and flees!` }), '#ffffaa');
                    }
                    if (game.player.hp <= 0) {
                        logger.log(i18next.t('combat.you_have_been_slain', {
                            defaultValue: 'You have been slain.'
                        }), '#ff0000');
                    }
                } else {
                    logger.log(i18next.t('combat.monster_misses_you', {
                        monster: this.name,
                        defaultValue: `The ${this.name} misses you.`
                    }), '#aaaaaa');
                    game.spawnFloatingText(
                        i18next.t('combat.miss_short', { defaultValue: 'Miss' }),
                        game.player.loc.x,
                        game.player.loc.y,
                        0xaaaaaa
                    );
                }
                // P4-5：同上——命中且未被杀死时才推（kamikaze/seize 分支已经不会
                // 走到这里之外的判断，此处再显式排除一次以防未来分支顺序调整）。
                if (result.hit && !result.kamikazeSelfDestruct && !result.seized &&
                    game.player.hp > 0 && this.hasAbility('MA_ATTACKS_STAGGER')) {
                    (game as any).processStaggerHit(this, game.player);
                }
                this.endTurnWithAttack();
            } else {
                // Move towards or away from player depending on MAINTAINS_DISTANCE
                if (this.hasBehavior('MONST_MAINTAINS_DISTANCE') && canSeePlayer && distToPlayer < 3) {
                    // Try to move away
                    let bestScore = -Infinity;
                    let bestCell = null;
                    for (let dx = -1; dx <= 1; dx++) {
                        for (let dy = -1; dy <= 1; dy++) {
                            if (dx === 0 && dy === 0) continue;
                            const nx = this.loc.x + dx;
                            const ny = this.loc.y + dy;
                            const c = game.grid.getCell(nx, ny);
                            if (c && (isFlying ? !c.isOpaque : c.isPassable) && !game.getMonsterAt(nx, ny) && !(game.player.loc.x === nx && game.player.loc.y === ny)) {
                                const dist = Math.max(Math.abs(nx - game.player.loc.x), Math.abs(ny - game.player.loc.y));
                                if (dist > bestScore) {
                                    bestScore = dist;
                                    bestCell = { x: nx, y: ny };
                                }
                            }
                        }
                    }
                    if (bestCell) {
                        this.tryMoveTo(bestCell.x, bestCell.y, game);
                        return; // Successfully retreated
                    }
                    // If backed into a corner, behavior falls through to standard pursuit which will just sit there or attack next turn
                } else if (this.hasBehavior('MONST_MAINTAINS_DISTANCE') && canSeePlayer && distToPlayer === 3) {
                    // Do nothing, just maintain the exact distance and potentially attack if ranged
                    return;
                }

                // P4-6：追击途中先沿"直指玩家"的射线试鞭/矛（CE 追击方向来自
                // scentDirection，不绕开友军——Monsters.c:3473/3488 → 3817-3818；
                // 置于 MAINTAINS_DISTANCE 判定之后：保持距离的怪先撤退，撤退方向
                // 上的几何尝试由 tryMoveTo 的移动钩子承担，与 CE 一致）。
                if (this.tryGeometryRayTo(game, game.player)) {
                    return;
                }

                // P4-8：气味移动与直寻共用的移动准入（monsterAvoids 的 web 近似，
                // 与既有直寻/移动同口径：地形可进 + 无怪物 + 非玩家格）。
                const isLiquidOnly = this.hasBehavior('MONST_RESTRICTED_TO_LIQUID');
                const scentCanEnter = (x: number, y: number): boolean => {
                    const c = game.grid.getCell(x, y);
                    if (!c) return false;
                    if (isFlying) return !c.isOpaque && !game.getMonsterAt(x, y) && !(game.player.loc.x === x && game.player.loc.y === y);
                    if (isLiquidOnly) {
                        const isLiquid = c.terrain === TerrainType.WATER_SHALLOW || c.terrain === TerrainType.WATER_DEEP;
                        return isLiquid && !game.getMonsterAt(x, y) && !(game.player.loc.x === x && game.player.loc.y === y);
                    }
                    return c.isPassable && !game.getMonsterAt(x, y) && !(game.player.loc.x === x && game.player.loc.y === y);
                };

                if (!canSeePlayer && !(this.hasBehavior('MONST_ALWAYS_HUNTING') && this.givenUpOnScent)) {
                    // P4-8：CE Monsters.c:3473 —— 看不见玩家时顺气味梯度上坡移动
                    //（scentDirection：8 邻域取气味最大且严格大于当前格的一格，
                    // 含 CE 的对角弥散重试）。
                    const step = game.scent.stepDirection(game.grid, this.loc.x, this.loc.y, { canEnter: scentCanEnter });
                    if (step) {
                        this.tryMoveTo(this.loc.x + step[0], this.loc.y + step[1], game);
                        return;
                    }
                    if (!game.scent.isLocalScentMaximum(game.grid, this.loc.x, this.loc.y)) {
                        // 有更浓的邻格但进不去（被占/不可进）：本回合原地（CE 同）
                        return;
                    }
                    // 气味死路（局部最大）：
                    if (this.hasBehavior('MONST_ALWAYS_HUNTING')) {
                        // CE Monsters.c:3466-3469 + 3477-3481：放弃气味改直接寻路
                        //（pathTowardCreature + MB_GIVEN_UP_ON_SCENT）。落入下方直寻。
                        this.givenUpOnScent = true;
                    } else {
                        // CE Monsters.c:3482-3484：死路且不在玩家视野内 → 回游荡。
                        //（CE 还有 wanderToward(lastSeenPlayerAt)，web 无 lastSeen
                        // 记账，退化为普通 WANDERING，见报告。）
                        // 在玩家视野内的死路：原地保持追踪（CE：不做任何移动）。
                        if (!game.grid.getCell(this.loc.x, this.loc.y)?.isVisible) {
                            this.state = MonsterState.WANDERING;
                        }
                        return;
                    }
                }

                const path = Pathfind.findPath(game.grid, this.loc.x, this.loc.y, game.player.loc.x, game.player.loc.y, (x, y) => {
                    const c = game.grid.getCell(x, y);
                    if (!c) return false;
                    if (isFlying) return !c.isOpaque && !game.getMonsterAt(x, y);
                    if (isLiquidOnly) {
                        const isLiquid = c.terrain === TerrainType.WATER_SHALLOW || c.terrain === TerrainType.WATER_DEEP;
                        return isLiquid && !game.getMonsterAt(x, y);
                    }
                    return c.isPassable && !game.getMonsterAt(x, y);
                });

                if (path && path.length > 0) {
                    const nextStep = path[0]!;
                    this.tryMoveTo(nextStep.x, nextStep.y, game);
                }
            }
        } else if (this.state === MonsterState.WANDERING) {
            // P4-10：CE Monsters.c:3602-3615——游荡 = 朝目标 waypoint 的距离图
            // 下坡走（nextStep(map, loc, monst, false)，正向对角优先级）；目标
            // 失效或无路 → chooseNewWanderDestination 换点再试；仍无路 → 如
            // flitting 随机走一步（Monsters.c:3618-3619 randValidDirectionFrom）。
            // 取代旧的"20% 概率随机走"占位实现——CE 的游荡怪沿 waypoint 有
            // 目的地巡逻，不是布朗运动。
            const wp = game.waypoints as WaypointSystem;
            let dir: readonly [number, number] | null = null;
            if (wp.count > 0 && wp.isValidWanderDestination(this, this.targetWaypointIndex, game.wpContext())) {
                dir = wp.nextStep(this.targetWaypointIndex, this, game.wpContext());
            }
            // Monsters.c:3608-3615：无效或无下坡（含"已站在 waypoint 上"——
            // 0 距离无更陡邻格）→ 换点。isValidWanderDestination 的 nextStep
            // 与 CE 一样会被重复求值，保持同构、不求聪明。
            if (dir === null || !wp.isValidWanderDestination(this, this.targetWaypointIndex, game.wpContext())) {
                wp.chooseNewWanderDestination(this, game.wpContext());
                if (wp.isValidWanderDestination(this, this.targetWaypointIndex, game.wpContext())) {
                    dir = wp.nextStep(this.targetWaypointIndex, this, game.wpContext());
                }
            }
            if (dir === null) {
                // Monsters.c:3618-3619：仍无路 → 随机合法方向（深水里的鳗鱼
                // 就是这么游荡的）。count==0 时先于掷骰返回，CE Movement.c:693
                // 的防 OOS 注释同款。
                dir = this.randFlittingDirection(game);
            }
            if (dir !== null) {
                this.tryMoveTo(this.loc.x + dir[0]!, this.loc.y + dir[1]!, game);
            }
        }
    }

    /**
     * P4-10：CE Movement.c:674 randValidDirectionFrom(monst, x, y, true) 的 web
     * 近似——8 邻域内随机挑一个可进入方向。diagonalBlocked web 无对应，省略；
     * 占格排除比 CE 保守（CE 靠 moveMonster 处理阻挡/交换，web 的 tryMoveTo
     * 不会，不排除会叠怪）。count==0 时先于 randRange 返回（CE 同款防 OOS）。
     */
    private randFlittingDirection(game: Game): readonly [number, number] | null {
        const dirs: ReadonlyArray<readonly [number, number]> =
            [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]];
        const valid: Array<readonly [number, number]> = [];
        for (const [dx, dy] of dirs) {
            const nx = this.loc.x + dx!;
            const ny = this.loc.y + dy!;
            const c = game.grid.getCell(nx, ny);
            if (!c) continue;
            const isLiquidTile = c.terrain === TerrainType.WATER_SHALLOW || c.terrain === TerrainType.WATER_DEEP;
            const canEnter = this.hasBehavior('MONST_RESTRICTED_TO_LIQUID') ? isLiquidTile : c.isPassable;
            if (canEnter && !game.getMonsterAt(nx, ny) &&
                !(game.player.loc.x === nx && game.player.loc.y === ny)) {
                valid.push([dx!, dy!]);
            }
        }
        if (valid.length === 0) return null;
        return valid[rng.randRange(0, valid.length - 1)]!;
    }

    private tryMoveTo(nx: number, ny: number, game: Game) {
        if (nx === this.x && ny === this.y || !game.grid.getCell(nx, ny)) return;
        if (this.hasStatus('nauseous') && game.tryVomit(this)) return;
        const currentCell = game.grid.getCell(this.loc.x, this.loc.y);
        if (currentCell && currentCell.terrain === TerrainType.WEB
            && !(this.typeId === 'spectral_blade' && this.doesNotTrackLeader)) {
            // Monsters have a chance to get stuck in webs.
            // Let's say 50% chance for now.
            if (rng.randPercent(50)) {
                if (game.hasLineOfSight(this.loc.x, this.loc.y, game.player.loc.x, game.player.loc.y)) {
                    logger.log(i18next.t('env.monster_stuck_web', { monster: this.name, defaultValue: `The ${this.name} struggles against the web.` }), '#aaaaaa');
                }
                // Chance to break the web
                if (rng.randPercent(20)) {
                    currentCell.terrain = TerrainType.FLOOR;
                    if (game.hasLineOfSight(this.loc.x, this.loc.y, game.player.loc.x, game.player.loc.y)) {
                        logger.log(i18next.t('env.monster_break_web', { monster: this.name, defaultValue: `The ${this.name} breaks the web.` }), '#aaaaaa');
                    }
                }
                return; // Stuck, do not move
            }
        }

        // P4-6：CE moveMonster（Monsters.c:3809-3822）——怪物每次"尝试朝某方向
        // 移动/攻击"时，先于移动本身尝试鞭（MA_ATTACKS_EXTEND）与矛
        // （MA_ATTACKS_PENETRATE）：命中即耗掉回合且不移动。这是鞭 5 格 /
        // 矛 2 格远程几何的触发路径（追击/游荡/溃逃的每一步都先过这里，与
        // CE 把 handleWhipAttacks/handleSpearAttacks 挂在 moveMonster 内同构；
        // 位置在蛛网挣扎之后，与 CE 的检查顺序一致——被缠住的怪物先挣扎，
        // 不出手）。斧（ALL_ADJACENT）不在此处——CE 的横扫只挂在"目标格
        // 有怪"的近战分支（buildHitList），移动分支不横扫。
        const stepDx = Math.sign(nx - this.loc.x);
        const stepDy = Math.sign(ny - this.loc.y);
        if (!this.hasStatus('magical_fear') && (stepDx !== 0 || stepDy !== 0)) {
            if (this.hasAbility('MA_ATTACKS_EXTEND') && this.performWhipAttack(game, stepDx, stepDy)) return;
            if (this.hasAbility('MA_ATTACKS_PENETRATE') && this.performSpearAttack(game, stepDx, stepDy)) return;
        }

        this.loc.x = nx;
        this.loc.y = ny;

        // Apply mud delay via lowering speed/giving a 'stuck' penalty, or since we don't have fine-grained monster action points yet:
        // We can skip their next turn or reduce regenTurns, etc. For now we will just let it be, or maybe set a flag.
        // Actually simplest is giving them a temporary 'slow' status but we don't have arbitrary delay yet.
        // In Game.ts we use `timeSystem.currentTick += 200` for player, but monsters just run once per logic loop.
        // For monsters, maybe we can just randomly skip moves in MUD?
        const nextCell = game.grid.getCell(nx, ny);
        if (nextCell && nextCell.terrain === TerrainType.MUD) {
            // Give 50% chance to lose next turn via setting an internal 'sludge' delay or just wait.
            // Just leaving it raw for now until we rework monster speed fully.
        }
    }
}
