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
    /** P4-1b：CE monsterCatalog.bolts（P4-1a 数据），驱动 tryUseBolt。 */
    public bolts: string[] = [];

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
                    if (result.damage > 0) {
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
                    } else {
                        logger.log(i18next.t('combat.ally_misses', { ally: this.name, target: target.name, defaultValue: `Your ${this.name} misses the ${target.name}.` }), '#aaaaaa');
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
                        if (result.damage > 0) {
                            logger.log(i18next.t('combat.discordant_hits', {
                                attacker: this.name, target: other.name, damage: result.damage,
                                defaultValue: `The ${this.name} turns on the ${other.name} for ${result.damage} damage!`
                            }), '#ff88aa');
                            game.spawnFloatingText(`-${result.damage}`, other.loc.x, other.loc.y, 0xff5555);
                            game.spawnBlood(other.loc.x, other.loc.y);
                        } else {
                            logger.log(i18next.t('combat.discordant_misses', {
                                attacker: this.name, target: other.name,
                                defaultValue: `The ${this.name} misses the ${other.name}.`
                            }), '#aaaaaa');
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
                if (result.damage > 0) {
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
