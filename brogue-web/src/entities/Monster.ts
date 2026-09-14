/**
 * src/entities/Monster.ts
 * Base Monster class mirroring Brogue's monster initialization
 */

import { Creature } from './Creature';
import { Player } from './Player';
import { rng } from '../engine/Random';
import type { Game } from '../engine/Core/Game';
import { Pathfind } from '../engine/Map/Pathfind';
import { CombatSystem } from '../engine/Combat/Combat';
import { logger } from '../engine/Systems/Logger';
import i18next from 'i18next';
import { ItemLoader } from '../engine/Items/ItemLoader';
import type { StatusId } from './Creature';
import { TerrainType } from '../engine/Map/Grid';
import { MONSTER_BOLT_TABLE, BoltEffect } from '../engine/Combat/Bolt';
import { reflectionChance } from '../engine/Combat/CombatFormulas';

// ----- P4-1b：怪物远程法术施放 -----
//
// 对照 CE Monsters.c 的 monstUseBolt/generallyValidBoltTarget/
// specificallyValidBoltTarget（见 ai_docs/p4_1b_monster_casting_report.md
// 的逐段对照）。web 没有 CE 的 MONSTER_ALLY/MONSTER_TRACKING_SCENT 等完整
// creatureState 谱系，也没有 MB_MARKED_FOR_SACRIFICE、STATUS_ENTRANCED 等，
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

/**
 * BE_SHIELDING 的"是否已被护盾"判定。web 的 StatusId（Creature.ts，本轮禁改）
 * 没有 'shielded' 项，护盾状态改用 statusDurations 上一个不在 StatusId 联合
 * 类型里的运行时 key 存放——Creature.tickStatuses() 按 Object.entries 遍历，
 * 对任意 key 都通用，到期会被自动清除，行为与其它状态一致。
 * 已知限制：CE 的护盾会挡伤害，但 CombatSystem.attack 的伤害结算在
 * Combat.ts（本轮禁改）里，这里没有打通"护盾挡伤害"的机械效果，只实现了
 * "目标是否已被护盾覆盖"这个判定 + 状态展示，见报告。
 */
const SHIELD_STATUS_KEY = 'shielded';
export function isShielded(c: Creature): boolean {
    return (((c.statusDurations as unknown) as Record<string, number>)[SHIELD_STATUS_KEY] ?? 0) > 0;
}
export function applyShieldStatus(c: Creature, duration: number): void {
    const durations = (c.statusDurations as unknown) as Record<string, number>;
    const current = durations[SHIELD_STATUS_KEY] ?? 0;
    durations[SHIELD_STATUS_KEY] = Math.max(current, duration);
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
 * BE_NEGATION 完整的九路判断（简化为"目标是敌人且处于可驱散状态"）。
 */
export function specificallyValidBoltTarget(caster: Monster, target: Creature, ceBoltName: string, game: Game): boolean {
    const meta = MONSTER_BOLT_TABLE[ceBoltName];
    if (!meta || meta.effect === null || meta.effect === BoltEffect.BLINKING) return false;

    if (meta.targetAllies && !monstersAreTeammates(caster, target)) return false;
    if (meta.targetEnemies && !monstersAreEnemies(caster, target)) return false;
    if (meta.targetEnemies && target instanceof Monster && target.hasBehavior('MONST_INVULNERABLE')) return false;
    if (meta.fiery && target.hasStatus('immune_fire')) return false;

    switch (meta.effect) {
        case BoltEffect.DISCORD:
            if (target.hasStatus('discordant') || target === game.player) return false;
            break;
        case BoltEffect.NEGATION:
            // 简化版 BE_NEGATION：只在目标（敌方）身上确有可驱散的增益/护盾时才放。
            if (!(target.hasStatus('hasted') || target.hasStatus('telepathy') || isShielded(target))) {
                return false;
            }
            break;
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
    public isCaged: boolean = false;
    public mutation?: MutationData;
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
    private regenCounter: number = 0;

    // Track original spawn loc for wandering logic
    public spawnLoc: { x: number, y: number } = { x: 0, y: 0 };

    constructor(x: number, y: number, data: MonsterData) {
        super(x, y, ItemLoader.translateName(data.name), data.char, data.color);
        this.maxHp = data.hp;
        this.hp = data.hp;
        this.damageString = data.damage;
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

    public hasBehavior(flag: string): boolean {
        return this.behaviorFlags.has(flag);
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
        // Prepend mutation name (e.g. "explosive rat")
        this.name = m.name + ' ' + this.name;
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

    public takeTurn(game: Game, stealthRange: number) {
        if (this.hp <= 0) return;
        if (this.hasStatus('paralyzed')) return;
        if (this.isCaged) return;

        if (this.regenTurns > 0 && this.hp < this.maxHp) {
            this.regenCounter++;
            if (this.regenCounter >= this.regenTurns) {
                this.hp = Math.min(this.maxHp, this.hp + 1);
                this.regenCounter = 0;
            }
        }

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
            if (this.tryUseBolt(game)) {
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

        if (this.isAlly) {
            // Find closest hostile monster
            let target: Monster | null = null;
            let minDist = Infinity;
            for (const other of game.monsters) {
                if (other === this || other.hp <= 0 || other.isAlly) continue;
                if (!game.grid.getCell(other.loc.x, other.loc.y)?.isVisible) continue;

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
            if (this.hp > this.maxHp * 0.75) {
                this.state = MonsterState.HUNTING;
            } else if (distToPlayer > playerDetectRange + 2) {
                this.state = MonsterState.WANDERING;
                return;
            } else {
                // Move away from player
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
                }
                return;
            }
        }

        if (this.state === MonsterState.HUNTING) {
            // CE Monsters.c:343-360/390：discordant 怪物敌我不分，会把相邻的其他
            // 怪物也当作攻击目标（对玩家仍视为敌人）。置于"丢失视野掉回 WANDERING"
            // 判定之前，使看不到玩家的 discordant 怪也会转身撕咬身边同类。
            if (this.hasStatus('discordant')) {
                // 方向顺序与下方 confused/WANDERING 分支的 dirs 保持一致（8 方向去重）
                const dirs8 = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, 1], [-1, 1], [1, -1]];
                for (const [dx, dy] of dirs8) {
                    const other = game.getMonsterAt(this.loc.x + dx!, this.loc.y + dy!);
                    if (other && other !== this && other.hp > 0) {
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

            if (!canSeePlayer && distToPlayer > playerDetectRange + 2) {
                this.state = MonsterState.WANDERING;
                return;
            }

            // P4-1b：原 abilities.has('ranged') 远程桩已移除，理由同上（ally 分支
            // 注释）——centaur 的 DISTANCE_ATTACK 现在完全走 tryUseBolt 出口。

            // Adjacent to player -> Melee Attack!
            if (distToPlayer <= 1) {
                const result = CombatSystem.attack(this, game.player);
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
                    game.tryTriggerArmorRunic(this, result.damage);
                    if (this.onHitStatus && this.onHitDuration > 0 && rng.randPercent(Math.floor(this.onHitChance * 100))) {
                        game.applyMonsterOnHitStatus(this.name, this.onHitStatus, this.onHitDuration);
                    }
                    if (this.hasAbility('MA_POISONS')) {
                        game.applyMonsterOnHitStatus(this.name, 'poisoned', result.damage * 2);
                    }
                    if (this.hasAbility('MA_CAUSES_WEAKNESS')) {
                        game.applyMonsterOnHitStatus(this.name, 'weakened', 15);
                    }
                    if (this.hasAbility('MA_HIT_HALLUCINATE')) {
                        game.applyMonsterOnHitStatus(this.name, 'hallucinating', 15);
                    }
                    if (this.hasAbility('MA_HIT_DEGRADE_ARMOR')) {
                        if (game.player.equippedArmor && game.player.equippedArmor.enchantment > -3) {
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

                const isLiquidOnly = this.hasBehavior('MONST_RESTRICTED_TO_LIQUID');
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
            // Wander randomly 20% of the time
            if (rng.randPercent(20)) {
                const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, 1], [-1, 1], [1, -1]];
                const dir = dirs[rng.randRange(0, dirs.length - 1)]!;
                const nx = this.loc.x + dir[0]!;
                const ny = this.loc.y + dir[1]!;
                const c = game.grid.getCell(nx, ny);
                const isLiquidTile = c && (c.terrain === TerrainType.WATER_SHALLOW || c.terrain === TerrainType.WATER_DEEP);
                const canEnter = c && (this.hasBehavior('MONST_RESTRICTED_TO_LIQUID') ? isLiquidTile : c.isPassable);
                if (canEnter && !game.getMonsterAt(nx, ny)) {
                    this.tryMoveTo(nx, ny, game);
                }
            }
        }
    }

    private tryMoveTo(nx: number, ny: number, game: any) {
        const currentCell = game.grid.getCell(this.loc.x, this.loc.y);
        if (currentCell && currentCell.terrain === TerrainType.WEB) {
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
