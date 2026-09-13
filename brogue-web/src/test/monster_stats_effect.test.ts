/**
 * src/test/monster_stats_effect.test.ts — 怪物五项战斗数值（accuracy/defense/
 * regen/moveSpeed/attackSpeed）接入 monsters.json 前后的行为效果对比。
 *
 * 方法（两路证据）：
 * 1. 配对聚合采样：同一组 seed 各跑 legacy / wired 两种模式各 N 次、每次 500 回合
 *    （createHeadlessGame + runTurns，src/test/harness.ts）。legacy 模式每回合把
 *    全部怪物的五字段规范回合并前的构造默认值（acc=100/def=0/regen=0/双速=100，
 *    与 Monster 构造函数对缺失字段的 ?? 默认完全一致），从而在运行时精确复现
 *    "数据未接线"的语义；wired 模式用合并后的真实数值。两者同 seed 同策略，
 *    聚合后对比玩家命中率与累计受伤量。
 *    注意：引擎 Monster.ts 的游荡逻辑使用未播种的 Math.random（L291/L482），
 *    单次运行不可复现，故必须聚合对比，不采信单局。
 * 2. 定向接敌：把一只清醒 troll（defense=70，Globals.c:1076）反复放到玩家相邻格
 *    近战 30 次，直接验证 defense 进入 Combat 命中掷骰（命中率应显著低于 100%）。
 *
 * ⚠ 断言一律不用严格相等/严格序比较受随机性影响的命中计数，原因与根治方向：
 * 1. Monster.ts 的混乱游走（L291/293）与 WANDERING 游走（L510/512）分支使用
 *    未播种的 Math.random()，同 seed 不可复现，会打乱整条遭遇序列；
 * 2. Game.ts:1944 幻态绊趔：hallucinating 状态下 35% 概率把移动方向随机偏转
 *    （该掷骰本身用 seeded rng，但"玩家此刻是否处于幻态"取决于被 (1) 打乱的
 *    遭遇序列），于是"预期的攻击"会偶发变成一次移动 → hits < attacks。
 *    实测 legacy 未命中：143/146、163/168、185/186，严格相等约 1/3 概率假失败。
 * 根治手段是把 Monster.ts 的 Math.random() 收编进 seeded rng——那是回放系统的
 * 前置条件，属于会改变 RNG 流结构、使全部既有确定性测试（地形指纹等）失效的
 * 改动，必须单独排期，不在本测试文件可修的范围内。在此之前，命中计数只能做
 * 统计区间断言（阈值及检出能力论证见 ai_docs/flaky_test_fix_report.md）。
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame, runTurns, type TurnAction, type TurnPolicy } from './harness';
import type { Game } from '../engine/Core/Game';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import { rng } from '../engine/Random';
import { TerrainType } from '../engine/Map/Grid';
import monstersJson from '../data/monsters.json';

const TURNS = 500;
// REPEATS 16 → 32：样本翻倍（回合数不变）以压缩聚合比率的随机波动，为下面的
// 统计阈值腾出双侧裕度——见文件头注释与 ai_docs/flaky_test_fix_report.md。
const REPEATS = 32;
const BASE_SEED = 77701;

// 命中计数的统计阈值（Math.random 收编进 seeded rng 之前的过渡方案）：
// - legacy 的合法未命中只来自"幻态绊趔偏转预期攻击"，实测 16×500 聚合下
//   未命中率 ≤3%（最差 5/168），5% 上限约 1.7× 于最差观测；命中率跌超 5 个
//   百分点（defense 泄漏进 legacy、命中公式回归等）必触发。
// - wired 的合法未命中来自真实 defense（深层 def>0 目标增多），实测 ≤6.4%，
//   15% 上限约 2.3× 于最差观测；命中率崩至 85% 以下必触发。
const LEGACY_MISS_RATIO_CAP = 0.05;
const LEGACY_MISS_FLOOR = 5;
const WIRED_MISS_RATIO_CAP = 0.15;
const WIRED_MISS_FLOOR = 6;

const DIRS8: ReadonlyArray<readonly [number, number]> = [
    [0, -1], [0, 1], [-1, 0], [1, 0],
    [-1, -1], [1, -1], [-1, 1], [1, 1],
];

type GamePrivates = Omit<Game, 'canMoveTo'> & {
    canMoveTo(x: number, y: number): boolean;
};

/** 合并前 Monster 构造函数对缺失字段的默认值（Monster.ts:102-109 的 ?? 侧）。 */
const LEGACY_DEFAULTS = { accuracy: 100, defense: 0, regen: 0, moveSpeed: 100, attackSpeed: 100 } as const;

interface Agg {
    runs: number;
    turnsRun: number;
    died: number;
    attacks: number;
    hits: number;
    kills: number;
    damageTaken: number;
    damageEvents: number;
    attacksOnDefended: number;
    maxDefenseSeen: number;
    maxDepthReached: number;
    /** 按目标怪物 id 统计的攻击/命中/其 defense 值（取首次见到时的值） */
    attacksById: Map<string, { attacks: number; hits: number; defense: number }>;
}

function newAgg(): Agg {
    return { runs: 0, turnsRun: 0, died: 0, attacks: 0, hits: 0, kills: 0, damageTaken: 0, damageEvents: 0, attacksOnDefended: 0, maxDefenseSeen: 0, maxDepthReached: 0, attacksById: new Map() };
}

/** 扫描本层下行楼梯位置（每层约 100×50 格，逐回合调用开销可接受）。 */
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

function makeSampler(agg: Agg, mode: 'legacy' | 'wired'): { policy: TurnPolicy; settle: (game: Game) => void } {
    let prevPlayerHp: number | null = null;
    let pendingTarget: { mon: Monster; hpBefore: number } | null = null;

    const settle = (game: Game): void => {
        if (prevPlayerHp === null) return;
        const drop = prevPlayerHp - game.player.hp;
        if (drop > 0) {
            agg.damageTaken += drop;
            agg.damageEvents++;
        }
        if (pendingTarget) {
            const { mon, hpBefore } = pendingTarget;
            pendingTarget = null;
            agg.attacks++;
            // Combat.ts：命中必造成 ≥1 伤害，故 HP 下降（或死亡）⟺ 命中
            if (mon.hp < hpBefore || mon.hp <= 0) agg.hits++;
            if (mon.hp <= 0) agg.kills++;
            const tally = agg.attacksById.get(mon.name) ?? { attacks: 0, hits: 0, defense: mon.defense };
            tally.attacks++;
            if (mon.hp < hpBefore || mon.hp <= 0) tally.hits++;
            tally.defense = mon.defense;
            agg.attacksById.set(mon.name, tally);
            if (mon.defense > 0) {
                agg.attacksOnDefended++;
                agg.maxDefenseSeen = Math.max(agg.maxDefenseSeen, mon.defense);
            }
        }
        prevPlayerHp = null;
    };

    const policy: TurnPolicy = (game): TurnAction | undefined => {
        settle(game);
        prevPlayerHp = game.player.hp;
        if (mode === 'legacy') {
            // 运行时把五字段规范回合并前默认值，复现"数据未接线"语义
            for (const m of game.monsters) {
                m.accuracy = LEGACY_DEFAULTS.accuracy;
                m.defense = LEGACY_DEFAULTS.defense;
                m.regenTurns = LEGACY_DEFAULTS.regen;
                m.moveSpeed = LEGACY_DEFAULTS.moveSpeed;
                m.attackSpeed = LEGACY_DEFAULTS.attackSpeed;
            }
        }

        const px = game.player.loc.x;
        const py = game.player.loc.y;
        const privates = game as unknown as GamePrivates;

        for (const [dx, dy] of DIRS8) {
            const monster = game.getMonsterAt(px + dx, py + dy);
            if (monster && monster.hp > 0 && !monster.isAlly) {
                pendingTarget = { mon: monster, hpBefore: monster.hp };
                return { action: 'move', data: { x: dx, y: dy } };
            }
        }

        // 无相邻敌人：向本层下行楼梯推进（踩到楼梯就下楼），以在 500 回合内
        // 进入有 defense>0 怪物的深度；找不到楼梯则退回随机游走。
        if (agg.maxDepthReached < game.depth) agg.maxDepthReached = game.depth;
        const stairs = findStairsDown(game);
        if (stairs && px === stairs.x && py === stairs.y) {
            return { action: 'stairs_down' };
        }
        const movable = DIRS8.filter(([dx, dy]) =>
            privates.canMoveTo(px + dx, py + dy) && !game.getMonsterAt(px + dx, py + dy)
        );
        if (movable.length === 0) {
            return { action: 'wait_or_stairs_down' };
        }
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
    };

    return { policy, settle };
}

/** 跑一个 seed 的 500 回合并把结果累进 agg。 */
function runOnce(seed: number, agg: Agg, mode: 'legacy' | 'wired'): void {
    const game = createHeadlessGame(seed, 'normal');
    const { policy, settle } = makeSampler(agg, mode);
    const r = runTurns(game, TURNS, policy);
    settle(game); // 补结算最后一个回合
    agg.runs++;
    agg.turnsRun += r.turnsRun;
    if (r.died) agg.died++;
}

describe(`怪物五项数值接线效果：legacy vs wired（${REPEATS} seed × ${TURNS} 回合配对聚合）`, () => {
    it('聚合对比：命中率与累计受伤量', () => {
        const legacy = newAgg();
        const wired = newAgg();
        for (let i = 0; i < REPEATS; i++) {
            const seed = BASE_SEED + i;
            runOnce(seed, legacy, 'legacy');
            runOnce(seed, wired, 'wired');
        }
        const rate = (a: Agg) => (a.attacks > 0 ? (a.hits / a.attacks * 100).toFixed(1) + '%' : 'n/a');
        const tallyStr = (a: Agg) =>
            [...a.attacksById.entries()].map(([name, t]) => `${name}(def=${t.defense}):${t.attacks}攻/${t.hits}中`).join(' ');
        console.log(`[monster_stats_effect] legacy: runs=${legacy.runs} turns=${legacy.turnsRun} died=${legacy.died} maxDepth=${legacy.maxDepthReached} attacks=${legacy.attacks} hits=${legacy.hits} rate=${rate(legacy)} damageTaken=${legacy.damageTaken} kills=${legacy.kills}`);
        console.log(`[monster_stats_effect]   legacy 目标: ${tallyStr(legacy) || '无'}`);
        console.log(`[monster_stats_effect] wired : runs=${wired.runs} turns=${wired.turnsRun} died=${wired.died} maxDepth=${wired.maxDepthReached} attacks=${wired.attacks} hits=${wired.hits} rate=${rate(wired)} damageTaken=${wired.damageTaken} kills=${wired.kills}`);
        console.log(`[monster_stats_effect]   wired 目标: ${tallyStr(wired) || '无'}`);

        expect(legacy.attacks).toBeGreaterThan(0);
        expect(wired.attacks).toBeGreaterThan(0);

        // ── 统计稳健断言（不要改回 toBe/toBeLessThan 严格比较，原因见文件头）──
        // legacy 语义下命中率恒为 100%（acc=100 × defenseFraction(0)=1，命中必掉血），
        // 但幻态绊趔会把"预期攻击"偏转成移动（Game.ts:1944，35%），且偏转是否发生
        // 受 Monster.ts 未播种 Math.random 影响而不可复现，故只能断言"未命中数很小"。
        // 阈值仍有检出能力：legacy 未命中一旦远超 5%（如 defense 泄漏回 legacy、
        // 命中公式被改坏出现固定 miss 率），本断言即报警。
        const legacyMisses = legacy.attacks - legacy.hits;
        const legacyAllowed = Math.max(LEGACY_MISS_FLOOR, Math.ceil(legacy.attacks * LEGACY_MISS_RATIO_CAP));
        expect(
            legacyMisses,
            `legacy 应近乎全中（acc=100 × defenseFraction(0)=1），实测未命中 ` +
            `${legacyMisses}/${legacy.attacks}（允许 ≤${legacyAllowed}）。` +
            `不能用严格相等的原因：Monster.ts 游走分支的未播种 Math.random + Game.ts 幻态绊趔` +
            `（hallucinating 时 35% 偏转移动方向）会把预期攻击变成一次移动，同 seed 不可复现，` +
            `严格相等实测约 1/3 概率假失败（143/146、163/168、185/186）。` +
            `根治需把 Math.random 收编进 seeded rng（回放系统前置条件，另行排期）。` +
            `若未命中数远超阈值，说明 legacy 语义或命中公式被破坏，请勿简单放宽阈值。`
        ).toBeLessThanOrEqual(legacyAllowed);

        // wired 下真实 defense 生效，证据分两层：
        // (a) 接线证据：聚合中确实出现对 def>0 怪物的攻击（若 defense 数据被拔掉则归零报警）
        expect(wired.attacksOnDefended).toBeGreaterThan(0);
        expect(wired.maxDefenseSeen).toBeGreaterThan(0);
        // (b) 效果证据：总命中率不得崩塌。不能用 wired.hits < wired.attacks：
        //     浅层 wired 目标几乎全是 def=0，对 def=17 Monkey 的 2 次攻击全中是完全
        //     正常的结果（实测出现过 145/145 假失败），n≈150 时严格序不成立。
        //     15% 上限 ≈ 2.3× 实测合法上限（深层跑 6.4%），命中率崩到 85% 以下即报警。
        const wiredMisses = wired.attacks - wired.hits;
        const wiredAllowed = Math.max(WIRED_MISS_FLOOR, Math.ceil(wired.attacks * WIRED_MISS_RATIO_CAP));
        expect(
            wiredMisses,
            `wired 命中率不应崩塌，实测未命中 ${wiredMisses}/${wired.attacks}（允许 ≤${wiredAllowed}）。` +
            `原严格序断言（wired.hits < wired.attacks、wired 命中率 < legacy 命中率）在浅层` +
            `def>0 目标稀少时属正常噪声，已被实测证伪（145/145、legacy 97.0% < wired 98.9%）。` +
            `若本断言失败，说明 defense 数据被整体改坏或命中公式回归。`
        ).toBeLessThanOrEqual(wiredAllowed);
    });
});

describe('定向接敌：真实 troll(defense=70, Globals.c:1076) 进入命中掷骰', () => {
    it('30 次近战中命中率显著低于 100%（CE 公式约 40%）且非 0', () => {
        const game = createHeadlessGame(BASE_SEED, 'normal');
        const trollRow = monstersJson.find((m) => m.id === 'troll');
        if (!trollRow) throw new Error('monsters.json 中找不到 troll');
        const troll = new Monster(game.player.loc.x, game.player.loc.y, trollRow as unknown as MonsterData);
        game.monsters.length = 0; // 清场：排除其他怪物的干扰
        game.monsters.push(troll);

        const priv = game as unknown as GamePrivates;
        const SWINGS = 30;
        let attempts = 0;
        let hits = 0;

        for (let i = 0; i < SWINGS; i++) {
            game.player.hp = game.player.maxHp; // 防止被 troll 反击打死
            const px = game.player.loc.x;
            const py = game.player.loc.y;
            let spot: { x: number; y: number } | null = null;
            for (const [dx, dy] of DIRS8) {
                const tx = px + dx;
                const ty = py + dy;
                if (priv.canMoveTo(tx, ty) && !game.getMonsterAt(tx, ty)) {
                    spot = { x: tx, y: ty };
                    break;
                }
            }
            if (!spot) break;
            // 放置一只清醒的 troll 到相邻格（HUNTING 状态避开沉睡 auto-hit）
            troll.loc = { x: spot.x, y: spot.y };
            troll.state = MonsterState.HUNTING;
            troll.hp = troll.maxHp;
            if (!game.monsters.includes(troll)) game.monsters.push(troll);

            const hpBefore = troll.hp;
            game.handlePlayerAction('move', { x: spot.x - px, y: spot.y - py }, 'system');
            // 目标格在玩家行动时被 troll 占据 → 该 action 必被转为对 troll 的攻击
            // （Game.ts:1759 移动即攻击）；随后 troll 自己的回合可能移动/回血，
            // 不影响"命中必掉血"的判定（regen 至多 +1，命中伤害 ≥1）。
            attempts++;
            if (troll.hp < hpBefore || troll.hp <= 0) hits++;
        }

        console.log(`[monster_stats_effect] troll 接敌: attempts=${attempts} hits=${hits} rate=${(hits / Math.max(1, attempts) * 100).toFixed(1)}%`);
        expect(attempts).toBeGreaterThanOrEqual(SWINGS - 5); // 绝大多数回合确实在挥击
        // defense=70 → 命中率 = 0.987^70 ≈ 40%；30 次全中的概率 ~1e-12
        expect(hits).toBeLessThan(attempts);
        // 全不中也几乎不可能（~1e-7），命中率确实非零
        expect(hits).toBeGreaterThan(0);
    });
});
