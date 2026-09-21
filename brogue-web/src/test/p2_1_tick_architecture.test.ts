/**
 * ⚠️ 生成期基线比对已退役（P1-20，2026-09-14）
 *
 * 本文件中"与 pX_baseline 生成期指标一致"的断言，锁定的是**该阶段当时**的
 * 生成结果快照。它在当时有效——证明那一轮改动没有泄漏进地图生成。
 *
 * 但作为永久断言它是错的：任何一次**正当的**生成修复都会同时打断三份阶段基线
 * （P1-20 修复蓝图门格放物品即是一例），而唯一的"修法"是重采三份快照，
 * 那等于抹掉它们各自的历史意义。
 *
 * 故此处 skip 并保留为阶段证据；生成漂移的持续检测改由
 * `src/test/generation_baseline.test.ts` + `fixtures/generation_baseline.json`
 * 承担——那是一份**滚动**基线，只在生成确实应当改变时有意重采，
 * 并在提交信息中说明是哪次改动、为什么。
 */
/**
 * ⚠️ 本文件的 A 段与 B1/B3 锁定的是 P2-1 的**过渡期不变量**（"所有速度恒为 100、
 * 行为与 P2-1 前逐格一致"）。P2-2 已按设计放开真实速度，该不变量正当作废，
 * 相应断言由 src/test/p2_2_real_speed.test.ts 接管（A2 豺狼双动、A3 食人魔半速、
 * F 段新基线一致性）。
 *
 * 此处保留为历史记录并 skip，不删除——它们是"P2-1 确实做到了零行为变化"的证据。
 */
/// <reference types="node" />
/**
 * src/test/p2_1_tick_architecture.test.ts — P2-1：tick 制调度架构替换，零行为变化
 *
 * A. 零行为变化（本轮核心验收）：与 src/test/fixtures/p2_baseline.json
 *    （在 HEAD=dc614be、改动前采集）逐项比对——
 *    - 4 seed × D1-D26 的地形指纹 / 怪物数 / 物种集合 / 物品数；
 *    - 每 seed 跑 400 回合后的玩法状态（玩家坐标 HP、所在层、全部怪物位置与 HP）。
 *    任何一项不一致都意味着本轮引入了行为变化。采集口径已用改动前代码
 *    逐一复核与 fixture 完全一致。
 * B. 架构真实生效（对抗性，不是摆设）：
 *    B1 字段存在且初始口径正确（怪物满 TICKS_PER_TURN、玩家 0）。
 *    B2 ticks 门控行动：剩余 tick 多于玩家耗时的怪物本动作不行动且保留
 *       差值余量；剩余更少的怪物在多轮迭代中先行动、结束时带走非零余量。
 *       这两条在旧架构（"每动作每怪必行动一次"）下必然失败。
 *    B3 恒速口径下每个玩家动作后：每只存活怪物恰好行动一次、ticks 归满、
 *       玩家 ticks 归零（与旧行为逐格等价的直接断言）。
 * C. 事件队列已删除：Systems/Time.ts 及全部生产代码无排队式事件 API 符号，
 *    runMonsterTurns 不复存在，timeSystem.currentTick 仍在。
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHeadlessGame, runTurns, terrainFingerprint } from './harness';
import { TICKS_PER_TURN } from '../entities/Creature';
import { Monster, type MonsterData } from '../entities/Monster';
import { timeSystem } from '../engine/Systems/Time';
import type { Game } from '../engine/Core/Game';
import monsterDataJson from '../data/monsters.json';

const SEEDS = [424242, 777, 20260913, 31337];
const BASELINE = JSON.parse(
    readFileSync(new URL('./fixtures/p2_baseline.json', import.meta.url), 'utf8')
) as {
    head: string;
    seeds: number[];
    levels: Record<string, Array<{ d: number; fp: string; n: number; species: string; items: number }>>;
    play: Record<string, { turnsRun: number; died: boolean; player: string; depth: number; monsters: string }>;
};

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAT_DATA = (monsterDataJson as MonsterData[]).find(m => m.id === 'rat')!;

function stagedRat(game: Game, x: number, y: number): Monster {
    const rat = new Monster(x, y, RAT_DATA);
    rat.movementSpeed = TICKS_PER_TURN;
    game.monsters.push(rat);
    return rat;
}

/** 基线采集口径（levels）：单局顺序下探，D1 取自开局生成，D2-26 逐层 generateDepth。 */
function captureLevels(seed: number): Array<{ d: number; fp: string; n: number; species: string; items: number }> {
    const game = createHeadlessGame(seed);
    const entries = [levelEntry(game, 1)];
    for (let d = 2; d <= 26; d++) {
        (game as { depth: number }).depth = d;
        (game as unknown as { generateDepth(isGoingUp: boolean, isFirstLevel: boolean): void }).generateDepth(false, false);
        entries.push(levelEntry(game, d));
    }
    return entries;
}

function levelEntry(game: Game, d: number) {
    return {
        d,
        fp: terrainFingerprint(game.grid),
        n: game.monsters.length,
        species: [...new Set(game.monsters.map(m => m.name))].sort().join(','),
        items: game.items.length,
    };
}

/** 基线采集口径（play）：defaultTurnPolicy 跑 400 回合后的玩法状态快照。 */
function capturePlay(seed: number) {
    const game = createHeadlessGame(seed);
    const r = runTurns(game, 400);
    return {
        turnsRun: r.turnsRun,
        died: r.died,
        player: `${game.player.loc.x},${game.player.loc.y}:${game.player.hp}/${game.player.maxHp}`,
        depth: game.depth,
        monsters: game.monsters
            .map(m => `${m.name}@${m.loc.x},${m.loc.y}:${m.hp}`)
            .sort()
            .join('|'),
    };
}

describe('P2-1 A: 与 p2_baseline 逐项一致（零行为变化）', () => {
    it('fixture 元数据与被测 seed 集合一致', () => {
        expect(BASELINE.head).toBe('dc614be');
        expect(BASELINE.seeds).toEqual(SEEDS);
    });

    it.skip('4 seed × D1-D26：地形指纹 / 怪物数 / 物种集合 / 物品数 全部一致', () => {
        const mismatches: string[] = [];
        for (const seed of SEEDS) {
            const got = captureLevels(seed);
            const want = BASELINE.levels[String(seed)]!;
            expect(want).toBeDefined();
            expect(got.length).toBe(26);
            for (let i = 0; i < 26; i++) {
                const g = got[i]!;
                const w = want[i]!;
                if (g.d !== w.d) mismatches.push(`seed=${seed} 层序错位 got=D${g.d} want=D${w.d}`);
                if (g.fp !== w.fp) mismatches.push(`seed=${seed} D${w.d} 地形指纹 got=${g.fp} want=${w.fp}`);
                if (g.n !== w.n) mismatches.push(`seed=${seed} D${w.d} 怪物数 got=${g.n} want=${w.n}`);
                if (g.species !== w.species) mismatches.push(`seed=${seed} D${w.d} 物种 got=[${g.species}] want=[${w.species}]`);
                if (g.items !== w.items) mismatches.push(`seed=${seed} D${w.d} 物品数 got=${g.items} want=${w.items}`);
            }
        }
        expect(mismatches).toEqual([]);
    }, 300000);

    it.skip('4 seed × 400 回合玩法状态：玩家坐标 HP / 所在层 / 全部怪物位置与 HP 一致', () => {
        const mismatches: string[] = [];
        for (const seed of SEEDS) {
            const got = capturePlay(seed);
            const want = BASELINE.play[String(seed)]!;
            if (got.turnsRun !== want.turnsRun) mismatches.push(`seed=${seed} turnsRun got=${got.turnsRun} want=${want.turnsRun}`);
            if (got.died !== want.died) mismatches.push(`seed=${seed} died got=${got.died} want=${want.died}`);
            if (got.player !== want.player) mismatches.push(`seed=${seed} player got=${got.player} want=${want.player}`);
            if (got.depth !== want.depth) mismatches.push(`seed=${seed} depth got=${got.depth} want=${want.depth}`);
            if (got.monsters !== want.monsters) {
                const gm = got.monsters.split('|');
                const wm = want.monsters.split('|');
                mismatches.push(`seed=${seed} monsters got ${gm.length} 只 want ${wm.length} 只`);
                for (let i = 0; i < Math.max(gm.length, wm.length); i++) {
                    if (gm[i] !== wm[i]) mismatches.push(`  seed=${seed} [${i}] got=${gm[i]} want=${wm[i]}`);
                }
            }
        }
        expect(mismatches).toEqual([]);
    }, 300000);
});

describe('P2-1 B: ticksUntilTurn 真实驱动调度（对抗性）', () => {
    it.skip('B1 字段存在且初始口径正确：怪物满 TICKS_PER_TURN、玩家 0', () => {
        const game = createHeadlessGame(777);
        expect(game.monsters.length).toBeGreaterThan(0);
        expect(game.player.ticksUntilTurn).toBe(0);
        for (const m of game.monsters) {
            expect(m.ticksUntilTurn).toBe(TICKS_PER_TURN);
        }
    });

    it.skip('B3 恒速口径：一个玩家动作后每只存活怪物恰好行动一次、ticks 归满、玩家归零', () => {
        const game = createHeadlessGame(20260914);
        const spies = game.monsters
            .filter(m => m.hp > 0)
            .map(m => ({ m, spy: vi.spyOn(m, 'takeTurn') }));
        expect(spies.length).toBeGreaterThan(0);

        game.handlePlayerAction('wait', undefined, 'system');

        for (const { m, spy } of spies) {
            // 行动至多一次（若在他人回合内被波及死亡，则允许 0 次）
            expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
            if (m.hp > 0) {
                expect(spy).toHaveBeenCalledTimes(1);
                expect(m.ticksUntilTurn).toBe(TICKS_PER_TURN);
            }
        }
        expect(game.player.ticksUntilTurn).toBe(0);
    });

    it('B2a 剩余 tick 多于玩家耗时的怪物本动作不行动，且保留差值余量', () => {
        const game = createHeadlessGame(777);
        game.monsters.length = 0;
        const slow = stagedRat(game, game.player.loc.x + 1, game.player.loc.y);
        slow.ticksUntilTurn = 150; // 注入：比 TICKS_PER_TURN 慢半拍
        const spySlow = vi.spyOn(slow, 'takeTurn');

        game.handlePlayerAction('wait', undefined, 'system'); // 玩家耗时 = 100

        // 旧架构下 slow 会行动并归满 100 —— 两处断言都会失败
        expect(spySlow).not.toHaveBeenCalled();
        expect(slow.ticksUntilTurn).toBe(50); // 150 - 100，余量被保留
        expect(game.player.ticksUntilTurn).toBe(0);
    });

    it('B2b 剩余 tick 更少的怪物先行动；推进循环多轮迭代后其带走非零余量', () => {
        const game = createHeadlessGame(777);
        game.monsters.length = 0;
        const fast = stagedRat(game, game.player.loc.x + 1, game.player.loc.y);
        const follower = stagedRat(game, game.player.loc.x, game.player.loc.y + 1);
        fast.ticksUntilTurn = 50; // 注入：比 TICKS_PER_TURN 快半拍
        follower.ticksUntilTurn = TICKS_PER_TURN; // 显式驱动第 2 轮迭代
        const spyFast = vi.spyOn(fast, 'takeTurn');

        game.handlePlayerAction('wait', undefined, 'system'); // 玩家耗时 = 100

        // 第 1 轮迭代 soonest=50：fast 行动归满；第 2 轮 soonest=50：其余怪物行动。
        // 旧架构（单轮、每怪一次、归满 100）下末值 100，断言失败。
        expect(spyFast).toHaveBeenCalledTimes(1);
        expect(fast.ticksUntilTurn).toBe(50); // 50-50 归零 → 行动 +100 → 再扣 50
        expect(game.player.ticksUntilTurn).toBe(0);
    });
});

describe('P2-1 C: 事件队列已删除、旧调度不复存在', () => {
    it('Systems/Time.ts 无排队式事件 API，全仓生产代码无引用', () => {
        const timeTs = readFileSync(join(srcRoot, 'engine/Systems/Time.ts'), 'utf8');
        expect(timeTs).not.toMatch(/scheduleEvent|eventQueue|advanceToNextEvent|clearEventsForActor|ScheduledEvent/);

        const offenders: string[] = [];
        const walk = (dir: string): void => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                if (entry.name === 'test') continue; // 测试代码允许提及符号名
                const p = join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(p);
                    continue;
                }
                if (!/\.(ts|vue)$/.test(entry.name)) continue;
                if (p.endsWith(join('engine', 'Systems', 'Time.ts'))) continue; // 已单独断言
                if (/scheduleEvent|eventQueue|advanceToNextEvent|clearEventsForActor|ScheduledEvent/.test(readFileSync(p, 'utf8'))) {
                    offenders.push(p);
                }
            }
        };
        walk(srcRoot);
        expect(offenders).toEqual([]);
    });

    it('Game.ts 中 runMonsterTurns 不复存在，playerTurnEnded 是唯一调度入口', () => {
        const gameTs = readFileSync(join(srcRoot, 'engine/Core/Game.ts'), 'utf8');
        expect(gameTs).not.toContain('runMonsterTurns');
        expect(gameTs).toContain('playerTurnEnded');
    });

    it('timeSystem.currentTick 簿记仍可用', () => {
        expect(typeof timeSystem.currentTick).toBe('number');
    });
});
