/**
 * src/test/monster_damage_balance.test.ts — 怪物伤害记法修复（monsters.json → CE
 * randomRange 语义）的平衡回归。
 *
 * 背景：monsters.json 的 damage 原先把 CE 的 {min,max} 直接写成 "MINdMAX"，而
 * CombatSystem.parseDamageString 是掷骰记法（"XdY" → min=X, max=X*Y），导致怪物
 * 伤害被放大（如 ogre "9d13" 实为 9~117）。修复改为 "1dN+M"（min/max 与 CE 一致）。
 *
 * 两种口径，各 3 个固定 seed × 至多 2000 回合，逐回合采样玩家 HP：
 *  a) harness 默认策略（有相邻敌人则攻击，否则随机合法方向移动）——永不离开 D1，
 *     只能遇到 rat/kobold/jackal 一线浅层怪，对本次修复几乎不敏感（保留作为任务
 *     指定口径与基线）。
 *  b) 下楼策略（本文件测试侧实现，只调 harness/Game 公开接口，不改引擎）——
 *     攻击相邻敌人 → 站在下楼楼梯则下楼 → BFS 沿已探索区域走向下楼楼梯 →
 *     否则随机合法移动。会真实进入深层，暴露于 ogre/dragon 等高伤害数值，
 *     是本次修复的主要区分口径。
 *
 * 输出指标：存活回合数 / 是否死亡 / 死因 / 累计受伤量（Σ 正向 HP 回落，含环境
 * 伤害，前后对比口径一致）/ 受伤回合数。修复前后的对比数据见
 * ai_docs/monster_damage_notation_report.md。
 *
 * 注意：伤害区间改变会经 rng.range 的拒绝采样使 RNG 流分岔，修复前后不是逐回合
 * 可比的；本文件只输出聚合指标并断言机械不变式（不锁平衡数值，避免误报）。
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame, runTurns } from './harness';
import { Game } from '../engine/Core/Game';
import { TerrainType, type Grid } from '../engine/Map/Grid';
import { rng } from '../engine/Random';

const SEEDS = [20260913, 424242, 987654321];
const TURNS = 2000;

interface BalanceMetrics {
    seed: number;
    turnsRun: number;
    died: boolean;
    deathReason: string;
    damageTaken: number;
    turnsDamaged: number;
    finalHp: number;
    maxHp: number;
    maxDepth: number;
}

/** Game 上对测试有用但非 public 的成员（与 harness.ts 相同的 Omit 技巧，只读访问）。 */
type GamePrivates = Omit<Game, 'canMoveTo'> & {
    canMoveTo(x: number, y: number): boolean;
};

const DIRS8: ReadonlyArray<readonly [number, number]> = [
    [0, -1], [0, 1], [-1, 0], [1, 0],
    [-1, -1], [1, -1], [-1, 1], [1, 1],
];

/**
 * 下楼策略（测试侧组装，引擎零改动）：
 * 1) 有相邻敌人（8 向、存活、非盟友）→ 攻击（同 harness 默认策略）；
 * 2) 站在下楼楼梯上 → 'stairs_down'；
 * 3) BFS 限已探索可通行格找下楼楼梯 → 迈向它的一步（落格须可通行且无怪）；
 * 4) 兜底：随机合法方向移动（同 harness 默认策略，保持在 seed 随机流上）。
 */
function makeDescendingPolicy(): (game: Game, turn: number) => { action: string; data?: unknown } {
    return (game: Game) => {
        const px = game.player.loc.x;
        const py = game.player.loc.y;
        const privates = game as unknown as GamePrivates;

        // 1) 相邻敌人 → 攻击
        for (const [dx, dy] of DIRS8) {
            const monster = game.getMonsterAt(px + dx, py + dy);
            if (monster && monster.hp > 0 && !monster.isAlly) {
                return { action: 'move', data: { x: dx, y: dy } };
            }
        }

        // 2) 站在下楼楼梯 → 下楼
        const here = game.grid.getCell(px, py);
        if (here && here.terrain === TerrainType.STAIRS_DOWN) {
            return { action: 'stairs_down' };
        }

        // 3) BFS（仅已探索可通行格）找下楼楼梯，返回距离场
        const dist = bfsToStairsDown(game.grid, px, py);
        if (dist) {
            let best: [number, number] | undefined;
            let bestDist = dist.get(py * game.grid.width + px)!;
            for (const [dx, dy] of DIRS8) {
                const nx = px + dx;
                const ny = py + dy;
                const d = dist.get(ny * game.grid.width + nx);
                if (d === undefined) continue;
                if (d < bestDist && privates.canMoveTo(nx, ny) && !game.getMonsterAt(nx, ny)) {
                    best = [dx, dy];
                    bestDist = d;
                }
            }
            if (best) return { action: 'move', data: { x: best[0], y: best[1] } };
        }

        // 4) 兜底：随机合法方向
        const movable = DIRS8.filter(([dx, dy]) =>
            privates.canMoveTo(px + dx, py + dy) && !game.getMonsterAt(px + dx, py + dy)
        );
        if (movable.length === 0) {
            return { action: 'wait' };
        }
        const [dx, dy] = movable[rng_randIndex(movable.length)]!;
        return { action: 'move', data: { x: dx, y: dy } };
    };
}

/**
 * 从玩家位置 BFS（可通行格，全知模式——不要求已探索，让回归尽快抵达深层），
 * 键为 y*width+x；找不到下楼楼梯返回 null。
 */
function bfsToStairsDown(
    grid: Grid,
    px: number,
    py: number
): Map<number, number> | null {
    const width = grid.width;
    const height = grid.height;
    const key = (x: number, y: number) => y * width + x;
    const dist = new Map<number, number>();
    const queue: Array<[number, number]> = [[px, py]];
    dist.set(key(px, py), 0);
    let found = false;

    while (queue.length > 0) {
        const [cx, cy] = queue.shift()!;
        const d = dist.get(key(cx, cy))!;
        const cell = grid.getCell(cx, cy);
        if (cell && cell.terrain === TerrainType.STAIRS_DOWN && !(cx === px && cy === py)) {
            found = true;
        }
        for (const [dx, dy] of DIRS8) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const k = key(nx, ny);
            if (dist.has(k)) continue;
            const nextCell = grid.getCell(nx, ny);
            if (!nextCell || !nextCell.isPassable) continue;
            dist.set(k, d + 1);
            queue.push([nx, ny]);
        }
    }

    return found ? dist : null;
}

/** 项目 rng 取一个 [0, length-1] 的随机下标（与 harness 默认策略同一随机流）。 */
function rng_randIndex(length: number): number {
    return rng.randRange(0, length - 1);
}

function runSeed(seed: number, policy?: (game: Game, turn: number) => { action: string; data?: unknown }): BalanceMetrics {
    const game = createHeadlessGame(seed);
    let damageTaken = 0;
    let turnsDamaged = 0;
    let turnsRun = 0;
    let died = false;
    let maxDepth = game.depth;

    for (let i = 0; i < TURNS; i++) {
        const hpBefore = game.player.hp;
        const r = runTurns(game, 1, policy);
        turnsRun += r.turnsRun;
        maxDepth = Math.max(maxDepth, game.depth);
        const delta = hpBefore - game.player.hp;
        if (delta > 0) {
            damageTaken += delta;
            turnsDamaged++;
        }
        if (r.died) {
            died = true;
            break;
        }
    }

    return {
        seed,
        turnsRun,
        died,
        deathReason: game.gameOverReason,
        damageTaken,
        turnsDamaged,
        finalHp: game.player.hp,
        maxHp: game.player.maxHp,
        maxDepth,
    };
}

function assertMechanical(label: string, rows: BalanceMetrics[]): void {
    let totalTurns = 0;
    let totalDamage = 0;
    let deaths = 0;
    for (const r of rows) {
        console.log(
            `[balance:${label}] seed=${r.seed} turnsRun=${r.turnsRun} died=${r.died} ` +
            `deathReason="${r.deathReason}" damageTaken=${r.damageTaken} ` +
            `turnsDamaged=${r.turnsDamaged} finalHp=${r.finalHp}/${r.maxHp} maxDepth=${r.maxDepth}`
        );
        // 机械不变式（不锁平衡数值）：
        expect(r.turnsRun).toBeGreaterThan(0);
        expect(r.turnsRun).toBeLessThanOrEqual(TURNS);
        expect(Number.isFinite(r.damageTaken)).toBe(true);
        expect(r.damageTaken).toBeGreaterThanOrEqual(0);
        if (r.died) {
            expect(r.deathReason, `seed ${r.seed} 死亡必须有可追溯死因`).not.toBe('');
        }
        totalTurns += r.turnsRun;
        totalDamage += r.damageTaken;
        if (r.died) deaths++;
    }
    console.log(
        `[balance:${label}] TOTAL seeds=${rows.length} turnsRun=${totalTurns} deaths=${deaths} damageTaken=${totalDamage}`
    );
}

describe('怪物伤害平衡回归（3 seed × 2000 回合）', () => {
    it('a) harness 默认策略（任务指定口径，D1 随机游走）', () => {
        assertMechanical('default', SEEDS.map((s) => runSeed(s)));
    }, 120000);

    it('b) 下楼策略（补充口径，真实暴露深层怪物数值）', () => {
        assertMechanical('descend', SEEDS.map((s) => runSeed(s, makeDescendingPolicy())));
    }, 120000);
});
