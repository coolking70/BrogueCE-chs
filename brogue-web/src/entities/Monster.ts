/**
 * src/entities/Monster.ts
 * Base Monster class mirroring Brogue's monster initialization
 */

import { Creature } from './Creature';
import { rng } from '../engine/Random';
import type { Game } from '../engine/Core/Game';
import { Pathfind } from '../engine/Map/Pathfind';
import { CombatSystem } from '../engine/Combat/Combat';
import { logger } from '../engine/Systems/Logger';
import i18next from 'i18next';
import { ItemLoader } from '../engine/Items/ItemLoader';
import type { StatusId } from './Creature';
import { TerrainType } from '../engine/Map/Grid';

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

    // Movement & Combat speeds
    public regenTurns: number = 0;
    public moveSpeed: number = 100;
    public attackSpeed: number = 100;
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
        this.regenTurns = data.regen ?? 0;
        this.moveSpeed = data.moveSpeed ?? 100;
        this.attackSpeed = data.attackSpeed ?? 100;
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

    public mutate(m: MutationData) {
        this.mutation = m;
        // Prepend mutation name (e.g. "explosive rat")
        this.name = m.name + ' ' + this.name;
        this.color = m.color;

        // Apply stat multipliers
        this.maxHp = Math.max(1, Math.floor(this.maxHp * m.healthFactor));
        this.hp = this.maxHp;
        this.moveSpeed = Math.floor(this.moveSpeed * m.moveSpeedFactor);
        this.attackSpeed = Math.floor(this.attackSpeed * m.attackSpeedFactor);

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
                if (this.abilities.has('ranged') && minDist > 1 && minDist <= 8) {
                    const result = CombatSystem.attack(this, target);
                    if (result.damage > 0) {
                        logger.log(i18next.t('combat.ally_ranged_hits', {
                            ally: this.name, target: target.name, damage: result.damage,
                            defaultValue: `Your ${this.name} shoots the ${target.name} for ${result.damage} damage.`
                        }), '#88ff88');
                        game.spawnFloatingText(`-${result.damage}`, target.loc.x, target.loc.y, 0xff5555);
                        if (this.onHitStatus && this.onHitDuration > 0 && rng.randPercent(Math.floor(this.onHitChance * 100))) {
                            game.applyMonsterOnHitStatus(target.name, this.onHitStatus, this.onHitDuration);
                        }
                    } else {
                        logger.log(i18next.t('combat.ally_misses', { ally: this.name, target: target.name, defaultValue: `Your ${this.name} misses the ${target.name}.` }), '#aaaaaa');
                    }
                    return;
                }

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
            if (Math.random() < 0.7) {
                const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, 1], [-1, 1], [1, -1]];
                const dir = dirs[Math.floor(Math.random() * dirs.length)]!;
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
                        return;
                    }
                }
            }

            if (!canSeePlayer && distToPlayer > playerDetectRange + 2) {
                this.state = MonsterState.WANDERING;
                return;
            }

            // Ranged ability: stay back and attack from distance
            if (this.abilities.has('ranged') && canSeePlayer && distToPlayer > 1 && distToPlayer <= 8) {
                const result = CombatSystem.attack(this, game.player);
                if (result.damage > 0) {
                    game.lastDamageSource = this.name;
                    logger.log(i18next.t('combat.monster_ranged_hits', {
                        monster: this.name,
                        damage: result.damage,
                        defaultValue: `The ${this.name} shoots you for ${result.damage} damage.`
                    }), '#ff8866');
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
                } else {
                    logger.log(i18next.t('combat.monster_misses_you', { monster: this.name, defaultValue: `The ${this.name} misses you.` }), '#aaaaaa');
                }
                return;
            }

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
            if (Math.random() < 0.2) {
                const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, 1], [-1, 1], [1, -1]];
                const dir = dirs[Math.floor(Math.random() * dirs.length)]!;
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
