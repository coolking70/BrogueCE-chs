/**
 * src/test/armor_model_effect.test.ts — 护甲模型改造（"减伤" → CE "命中概率"模型）
 * 前后的行为配对对照。
 *
 * 改动内容（CombatFormulas.ts / Combat.ts）：
 * - legacy（改造前）：defenderDefense = round(baseArmor * 1.065^netEnch)（乘法，
 *   个位数小值），命中后 damage -= defenderDefense（护甲减伤），下限 1。
 * - wired（改造后）：defenderDefense = (armor + netEnchant) * 10（CE 内部 ×10
 *   标度，Items.c:8515-8523），只进命中率公式（Combat.c:140），命中后全额伤害，
 *   无任何减伤步骤。
 *
 * 方法（沿用 monster_stats_effect.test.ts 的 legacy/wired 配对聚合模式）：
 * 1. legacyAttack 是改造前 Combat.ts attack() 的逐行忠实复刻（乘法护甲公式与
 *    伤害扣减都保留），通过临时替换静态方法 CombatSystem.attack 注入引擎，
 *    因此 legacy/wired 两侧共用同一套 Game/Monster/Player 与 RNG 流，差异只剩
 *    护甲模型本身；
 * 2. 两种模式各跑同一组固定 seed × 400 回合（createHeadlessGame + runTurns，
 *    见 harness.ts），策略为"相邻敌人则攻击，否则向楼下推进"；
 * 3. 观察器包装统计所有 怪物→玩家 攻击的命中与伤害，另计死亡次数与最大深度。
 *
 * ⚠ 断言均为聚合统计断言而非逐回合严格相等：Monster.ts 游走分支使用未播种
 * Math.random（同 seed 不可复现），与 monster_stats_effect.test.ts 文件头所记
 * 为同一限制。护甲模型差异的效应量远大于该噪声（见各断言阈值论证）。
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame, runTurns, type TurnAction } from './harness';
import type { Game } from '../engine/Core/Game';
import { CombatSystem, type AttackResult } from '../engine/Combat/Combat';
import {
    netEnchant,
    hitProbability,
    damageFraction,
    clumpedRoll,
    runicWeaponChance,
    playerDefense,
} from '../engine/Combat/CombatFormulas';
import { rng } from '../engine/Random';
import { Creature } from '../entities/Creature';
import { Player } from '../entities/Player';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import { Item, ItemCategory } from '../engine/Items/Item';
import { TerrainType } from '../engine/Map/Grid';
import monstersJson from '../data/monsters.json';

const TURNS = 400;
const SEEDS = 20;
const BASE_SEED = 88301;

// ─── 护甲档位 ───
// strength 取该档的力量需求（盈余 0），使档位的"显示防御"恰为 face value：
// 皮甲+0 → 显示 3，板甲+3 → 显示 11+3=14。跨档位对比含力量对武器命中的
// 影响（同档内 legacy/wired 配对完全同构，不受此影响）。
interface Tier {
    key: string;
    label: string;
    base: number | null; // armors.json 显示值口径；null = 不穿甲
    ench: number;
    strReq: number;
    strength: number;
}
const TIERS: Tier[] = [
    { key: 'none', label: '无护甲', base: null, ench: 0, strReq: 0, strength: 12 },
    { key: 'leather+0', label: '皮甲+0（显示3）', base: 3, ench: 0, strReq: 10, strength: 10 },
    { key: 'leather+3', label: '皮甲+3（显示6）', base: 3, ench: 3, strReq: 10, strength: 10 },
    { key: 'plate+0', label: '板甲+0（显示11）', base: 11, ench: 0, strReq: 19, strength: 19 },
    { key: 'plate+3', label: '板甲+3（显示14）', base: 11, ench: 3, strReq: 19, strength: 19 },
];

/** 改造前的护甲"减伤值"公式（CombatFormulas.ts 旧实现，乘法）。 */
function legacyArmorProtection(baseArmor: number, enchantment: number, playerStrength: number, requiredStrength: number): number {
    const netEnch = netEnchant(enchantment, playerStrength, requiredStrength);
    return Math.max(0, Math.round(baseArmor * damageFraction(netEnch)));
}

// ─── legacyAttack：改造前 Combat.ts attack() 的忠实复刻 ───
// 与 wired 的唯一差异 = 旧 defenderDefense 公式 + 命中后 damage -= protection。
// rng 调用顺序与旧实现一致，保证"改造前"语义被精确重现。
function legacyAttack(attacker: Creature, defender: Creature): AttackResult {
    let attackerAccuracy = 100;
    let defenderDefense = 0;
    let damageString = '1d4';
    let weaponName = 'bare hands';
    let weaponEnchant: number | undefined;
    let weaponRunic: string | undefined;
    let backstab = false;
    let clumping = 1;

    if (attacker instanceof Player) {
        if (attacker.equippedWeapon && attacker.equippedWeapon.damage) {
            damageString = attacker.equippedWeapon.damage;
            weaponName = attacker.equippedWeapon.name;
            const strReq = attacker.equippedWeapon.strengthRequired || 0;
            weaponEnchant = netEnchant(attacker.equippedWeapon.enchantment, attacker.strength, strReq);
            weaponRunic = attacker.equippedWeapon.runicType;
        }
    } else if (attacker instanceof Monster) {
        attackerAccuracy = attacker.accuracy;
        damageString = attacker.damageString || '1d3';
        weaponName = 'claws/teeth';
    }

    if (defender instanceof Monster) {
        defenderDefense = defender.defense;
    } else if (defender instanceof Player) {
        if (defender.equippedArmor && defender.equippedArmor.armor) {
            const strReq = defender.equippedArmor.strengthRequired || 0;
            defenderDefense = legacyArmorProtection(
                defender.equippedArmor.armor,
                defender.equippedArmor.enchantment,
                defender.strength,
                strReq
            );
        }
    }

    const defenderStuck = defender.hasStatus('paralyzed');
    const defenderAsleep = (defender instanceof Monster) && (defender.state === 0);
    const autoHit = defenderStuck || defenderAsleep;
    if (defenderAsleep || defenderStuck) backstab = true;

    let hitProb: number;
    if (autoHit) {
        hitProb = 100;
    } else {
        hitProb = hitProbability(attackerAccuracy, defenderDefense, weaponEnchant);
    }

    if (!rng.randPercent(hitProb)) {
        return { damage: 0, weaponName, hit: false, backstab: false };
    }

    const parts = CombatSystem.parseDamageString(damageString);
    let damage = clumpedRoll(parts.min, parts.max, clumping, (lo, hi) => rng.randRange(lo, hi));

    if (weaponEnchant !== undefined && weaponEnchant !== 0) {
        const dmgMult = damageFraction(weaponEnchant);
        damage = Math.max(1, Math.round(damage * dmgMult));
    }
    if (attacker instanceof Monster && attacker.hasStatus('weakened')) {
        damage = Math.max(1, Math.floor(damage * 0.5));
    }
    if (attacker instanceof Player && attacker.hasStatus('weakened')) {
        damage = Math.max(1, Math.floor(damage * 0.5));
    }
    if (backstab) {
        damage *= 3;
    }
    if (attacker instanceof Player && attacker.hasStatus('invisible') && !backstab) {
        damage = Math.floor(damage * 1.5);
    }

    // ★ legacy 专属：护甲减伤（wired 已删除该步骤）
    if (defender instanceof Player && defender.equippedArmor?.armor) {
        const strReq = defender.equippedArmor.strengthRequired || 0;
        const protection = legacyArmorProtection(
            defender.equippedArmor.armor,
            defender.equippedArmor.enchantment,
            defender.strength,
            strReq
        );
        damage -= protection;
    }
    if (damage < 1) damage = 1;

    let triggeredRunic: string | undefined;
    if (weaponRunic && attacker instanceof Player && attacker.equippedWeapon) {
        const enchant = attacker.equippedWeapon.enchantment;
        const triggerChance = runicWeaponChance(enchant);
        let adjustedChance = triggerChance;
        if (backstab && adjustedChance < 100) {
            adjustedChance = Math.min(adjustedChance * 2, Math.floor((adjustedChance + 100) / 2));
        }
        if (rng.randPercent(adjustedChance)) {
            triggeredRunic = weaponRunic;
        }
    }

    defender.takeDamage(damage);
    return { damage, weaponName, hit: true, backstab, triggeredRunic };
}

// ─── 聚合统计 ───
interface Agg {
    runs: number;
    turnsRun: number;
    died: number;
    maxDepth: number;
    monAttacks: number; // 怪物→玩家 攻击次数
    monHits: number;    // 怪物→玩家 命中次数
    monDamage: number;  // 怪物→玩家 命中造成的累计伤害
}
function newAgg(): Agg {
    return { runs: 0, turnsRun: 0, died: 0, maxDepth: 0, monAttacks: 0, monHits: 0, monDamage: 0 };
}

type GamePrivates = Omit<Game, 'canMoveTo'> & { canMoveTo(x: number, y: number): boolean };

const DIRS8: ReadonlyArray<readonly [number, number]> = [
    [0, -1], [0, 1], [-1, 0], [1, 0],
    [-1, -1], [1, -1], [-1, 1], [1, 1],
];

function findStairsDown(game: Game): { x: number; y: number } | null {
    const grid = game.grid;
    for (let y = 0; y < grid.height; y++) {
        for (let x = 0; x < grid.width; x++) {
            if (grid.getCell(x, y)?.terrain === TerrainType.STAIRS_DOWN) {
                return { x, y };
            }
        }
    }
    return null;
}

/** 相邻敌人则攻击，否则向楼下推进（参考 monster_stats_effect 的策略）。 */
function combatPolicy(game: Game): TurnAction {
    const px = game.player.loc.x;
    const py = game.player.loc.y;
    const privates = game as unknown as GamePrivates;

    for (const [dx, dy] of DIRS8) {
        const monster = game.getMonsterAt(px + dx, py + dy);
        if (monster && monster.hp > 0 && !monster.isAlly) {
            return { action: 'move', data: { x: dx, y: dy } };
        }
    }

    const stairs = findStairsDown(game);
    if (stairs && px === stairs.x && py === stairs.y) {
        return { action: 'stairs_down' };
    }
    const movable = DIRS8.filter(([dx, dy]) =>
        privates.canMoveTo(px + dx, py + dy) && !game.getMonsterAt(px + dx, py + dy)
    );
    if (movable.length === 0) return { action: 'wait_or_stairs_down' };
    if (stairs) {
        let best: readonly [number, number] | null = null;
        let bestDist = Math.abs(px - stairs.x) + Math.abs(py - stairs.y);
        for (const [dx, dy] of movable) {
            const d = Math.abs(px + dx - stairs.x) + Math.abs(py + dy - stairs.y);
            if (d < bestDist) {
                bestDist = d;
                best = [dx, dy];
            }
        }
        if (best) return { action: 'move', data: { x: best[0], y: best[1] } };
    }
    const [dx, dy] = movable[rng.randRange(0, movable.length - 1)]!;
    return { action: 'move', data: { x: dx, y: dy } };
}

/**
 * 在 mode 指定的护甲模型下跑 fn。
 * legacy：临时把 CombatSystem.attack 换成 legacyAttack；
 * wired：用引擎真实实现。
 * 两种模式都经 observe 包装统计 怪物→玩家 的攻击/命中/伤害。
 */
function runWithModel<T>(
    mode: 'legacy' | 'wired',
    agg: Agg,
    fn: () => T
): T {
    const impl = mode === 'legacy' ? legacyAttack : CombatSystem.attack;
    const owner = CombatSystem as unknown as { attack: unknown };
    const original = owner.attack;
    owner.attack = function (attacker: Creature, defender: Creature): AttackResult {
        const result = impl.call(CombatSystem, attacker, defender);
        if (attacker instanceof Monster && defender instanceof Player) {
            agg.monAttacks++;
            if (result.hit) {
                agg.monHits++;
                agg.monDamage += result.damage;
            }
        }
        return result;
    };
    try {
        return fn();
    } finally {
        owner.attack = original;
    }
}

function equipTier(game: Game, tier: Tier): void {
    if (tier.base === null) {
        game.player.equippedArmor = null;
    } else {
        const armor = new Item('test armor', ']', 0x888888, ItemCategory.ARMOR);
        armor.armor = tier.base;
        armor.strengthRequired = tier.strReq;
        armor.enchantment = tier.ench;
        game.player.equippedArmor = armor;
    }
    game.player.strength = tier.strength;
}

function runOnce(seed: number, tier: Tier, mode: 'legacy' | 'wired', agg: Agg): void {
    const game = createHeadlessGame(seed, 'normal');
    equipTier(game, tier);
    runWithModel(mode, agg, () => {
        const r = runTurns(game, TURNS, combatPolicy);
        agg.turnsRun += r.turnsRun;
        if (r.died) agg.died++;
    });
    agg.runs++;
    agg.maxDepth = Math.max(agg.maxDepth, game.depth);
}

/** 每档在该模型下"纸面"防御值（喂给命中公式的数值）与对应 acc=100 命中率。 */
function expectedDefense(tier: Tier, mode: 'legacy' | 'wired'): number {
    if (tier.base === null) return 0;
    if (mode === 'legacy') {
        return legacyArmorProtection(tier.base, tier.ench, tier.strength, tier.strReq);
    }
    return playerDefense(tier.base, tier.ench, tier.strength, tier.strReq);
}

describe(`护甲模型改造前后配对对照（${TIERS.length} 档 × ${SEEDS} seed × ${TURNS} 回合）`, () => {
    // 验收方 2026-09-17 上调 180s → 360s：本用例是 5 档 × 20 种子 × 400 回合的
    // 聚合测试，在**跨链并行**下已两次被自己的看门狗饿死
    // （B-1b 验收一次、B-1c 验收一次，后者实测 247s 被 180s 砍掉；
    // 空载单跑 96s）。并行已是常态，180s 的余量不够。
    // 注意：全局 `testTimeout` 对它无效——它自带 timeout，以本行为准。
    it(`聚合对比：玩家被命中率 / 累计受伤 / 死亡次数`, { timeout: 360_000 }, () => {
        const results: Record<string, { legacy: Agg; wired: Agg }> = {};
        for (const tier of TIERS) {
            const legacy = newAgg();
            const wired = newAgg();
            for (let i = 0; i < SEEDS; i++) {
                const seed = BASE_SEED + i;
                runOnce(seed, tier, 'legacy', legacy);
                runOnce(seed, tier, 'wired', wired);
            }
            results[tier.key] = { legacy, wired };

            const fmt = (a: Agg) => {
                const rate = a.monAttacks > 0 ? (a.monHits / a.monAttacks * 100).toFixed(1) + '%' : 'n/a';
                const perAtk = a.monAttacks > 0 ? (a.monDamage / a.monAttacks).toFixed(2) : 'n/a';
                return `attacks=${a.monAttacks} hits=${a.monHits} rate=${rate} dmg=${a.monDamage} (dmg/atk=${perAtk}) died=${a.died}/${a.runs} turns=${a.turnsRun} maxDepth=${a.maxDepth}`;
            };
            console.log(`[armor_model_effect] ${tier.label}`);
            console.log(`[armor_model_effect]   legacy(防御值=${expectedDefense(tier, 'legacy')}): ${fmt(legacy)}`);
            console.log(`[armor_model_effect]   wired (防御值=${expectedDefense(tier, 'wired')}): ${fmt(wired)}`);
        }

        // ── 断言（聚合统计口径；不使用逐回合严格相等，原因见文件头）──

        // 0) 两侧都确实发生了怪物→玩家攻击（采样有效）
        for (const tier of TIERS) {
            expect(results[tier.key]!.legacy.monAttacks).toBeGreaterThan(0);
            expect(results[tier.key]!.wired.monAttacks).toBeGreaterThan(0);
        }

        // 1) 无护甲档：两侧模型完全等价（防御值同为 0、无减伤步骤）。
        //    但 legacy/wired 是各自独立跑完整局：Monster.ts 游走分支的未播种
        //    Math.random 使轨迹自由发散（遭遇的怪物组合、深度、死亡时点都不同），
        //    聚合命中率差实测可在 1.5pp ~ 10.6pp 间波动（20 seed 样本），
        //    阈值取 15pp——模型若真被破坏（如 wired 对无甲目标算出非零防御、
        //    或命中公式回归），偏差方向性且量级 30pp+，仍有充分检出能力。
        //    引擎级"无甲=防御 0"的强断言由下方定向测试承担（无甲 60 挥击必全中）。
        {
            const { legacy, wired } = results['none']!;
            const lr = legacy.monHits / legacy.monAttacks;
            const wr = wired.monHits / wired.monAttacks;
            expect(Math.abs(lr - wr)).toBeLessThanOrEqual(0.15);
        }

        // 2) 板甲+3 档：防御值 13 → 140，wired 被命中率必须显著低于 legacy
        //    （acc=100 怪物：legacy ≈ 0.987^13 ≈ 84.5%，wired ≈ 0.987^140 ≈ 16%）。
        //    阈值 20 个百分点仅为效应量的下界保护，实测差距预期远大于此。
        {
            const { legacy, wired } = results['plate+3']!;
            const lr = legacy.monHits / legacy.monAttacks;
            const wr = wired.monHits / wired.monAttacks;
            expect(lr - wr).toBeGreaterThan(0.20);
            // wired 下"完全不被命中"不应发生（0.987^140 ≈ 16% >> 0）
            expect(wired.monHits).toBeGreaterThan(0);
            expect(wired.monAttacks - wired.monHits).toBeGreaterThan(0);
        }

        // 3) 皮甲+0 档：legacy 防御值 3 且命中后 -3 伤害；wired 防御值 35。
        //    对 acc=100 攻击者：legacy 命中率 ≈ 97%（伤害 -3），wired ≈ 70%（全额）。
        //    wired 命中率必须显著更低（阈值 5 个百分点，效应量下界保护）。
        {
            const { legacy, wired } = results['leather+0']!;
            const lr = legacy.monHits / legacy.monAttacks;
            const wr = wired.monHits / wired.monAttacks;
            expect(lr - wr).toBeGreaterThan(0.05);
        }

        // 4) 死亡次数配对报告：仅要求字段有效（次数不超过局数），数值本身写入
        //    交付报告——死亡受深层怪物强度主导，方向性不作为断言。
        for (const tier of TIERS) {
            expect(results[tier.key]!.legacy.died).toBeLessThanOrEqual(results[tier.key]!.legacy.runs);
            expect(results[tier.key]!.wired.died).toBeLessThanOrEqual(results[tier.key]!.wired.runs);
        }
    });
});

describe('定向验证：真实怪物(acc=100)攻击穿甲玩家，防御值进入命中掷骰', () => {
    // monkey：monsters.json acc=100, def=17（与护甲无关，玩家被命中率的防御项
    // 只来自玩家侧）。直接调 CombatSystem.attack(monster, player)（与
    // Monster.ts:379/410 怪物攻击玩家完全同一路径），60 次挥击统计命中率。
    // - 无护甲：期望 100%
    // - 板甲+3（wired 防御值 140）：期望 0.987^140 ≈ 15.9%
    // - 板甲+3（legacy 防御值 13，round(11*1.065^3)）：期望 0.987^13 ≈ 84.5%
    const SWINGS = 60;

    function swingGame(tier: Tier, mode: 'legacy' | 'wired'): { attempts: number; hits: number } {
        const game = createHeadlessGame(BASE_SEED, 'normal');
        equipTier(game, tier);
        const monkeyRow = monstersJson.find((m) => m.id === 'monkey');
        if (!monkeyRow) throw new Error('monsters.json 中找不到 monkey');
        const monkey = new Monster(game.player.loc.x, game.player.loc.y, monkeyRow as unknown as MonsterData);
        game.monsters.length = 0;
        game.monsters.push(monkey);

        let attempts = 0;
        let hits = 0;
        runWithModel(mode, newAgg(), () => {
            for (let i = 0; i < SWINGS; i++) {
                game.player.hp = game.player.maxHp; // 防止被击杀干扰采样
                monkey.hp = monkey.maxHp;
                monkey.state = MonsterState.HUNTING; // 避开沉睡 auto-hit
                const r = CombatSystem.attack(monkey, game.player);
                attempts++;
                if (r.hit) hits++;
            }
        });
        return { attempts, hits };
    }

    it('板甲+3：wired 命中率显著低于 legacy，且均非 0/100%（60 次挥击）', { timeout: 60_000 }, () => {
        const none = swingGame(TIERS[0]!, 'wired');
        const wired = swingGame(TIERS[4]!, 'wired');
        const legacy = swingGame(TIERS[4]!, 'legacy');
        console.log(`[armor_model_effect] 定向: monkey(acc=100) 60 挥击 → 无护甲 wired=${none.hits}/${none.attempts}` +
            ` 板甲+3 legacy=${legacy.hits}/${legacy.attempts} 板甲+3 wired=${wired.hits}/${wired.attempts}`);

        // 无护甲 = 两侧等价模型：acc=100 vs 防御 0 → 期望全中（容忍 Math.random
        // 无关的个别噪声——此路径无 Math.random，理论上应精确 100%）
        expect(none.hits).toBe(none.attempts);

        // 板甲+3 wired：期望 ~16%。上界 35% 约 +4σ（σ≈4.7%），效应量充足。
        expect(wired.hits).toBeGreaterThan(0); // 全不中概率 ~1e-6
        expect(wired.hits / wired.attempts).toBeLessThan(0.35);

        // 板甲+3 legacy：期望 ~83%。下界 60% 约 -4.5σ。
        expect(legacy.hits / legacy.attempts).toBeGreaterThan(0.60);
        expect(legacy.hits).toBeLessThan(legacy.attempts); // 0.987^13 → 必有未命中

        // 效应量方向：legacy 命中率显著高于 wired
        expect(legacy.hits).toBeGreaterThan(wired.hits + 10);
    });
});
