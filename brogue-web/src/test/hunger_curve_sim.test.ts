/**
 * src/test/hunger_curve_sim.test.ts — 新饥饿曲线的 headless 实测（3 seed × 2000 回合）
 *
 * 用 harness.ts 的 createHeadlessGame 驱动真实 Game 实例，回答一个问题：在
 * STOMACH_SIZE=2150 的新饥饿曲线（比旧 12000 短 5.6 倍）下，玩家是否会在
 * 常规窗口内饿死。
 *
 * 三组运行：
 * - wait 策略 × 3 seed：原地等待，隔离出纯饥饿曲线（怪物仍会主动攻击，如实记录）。
 * - roam 策略 × 3 seed：本文件复刻 harness 默认策略（攻击相邻敌人 / 随机移动），
 *   观察真实玩法节奏下的饥饿进度（harness 的 defaultTurnPolicy 未导出，故本地复刻）。
 * - seed 7 roam 延长到 2300 回合：验证 nutrition 归零后的完整饿死流程。
 *
 * 断言只保证模拟本身可跑完；曲线数据经 console 输出供报告引用。
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame, type TurnPolicy } from './harness';
import type { Game } from '../engine/Core/Game';
import { rng } from '../engine/Random';
import { ItemCategory } from '../engine/Items/Item';

const SEEDS = [1, 7, 42];
const TURNS = 2000;
const CHECKPOINT = 250;

const waitPolicy: TurnPolicy = () => ({ action: 'wait' });

const DIRS8: ReadonlyArray<readonly [number, number]> = [
    [0, -1], [0, 1], [-1, 0], [1, 0],
    [-1, -1], [1, -1], [-1, 1], [1, 1],
];

type GamePrivates = { canMoveTo(x: number, y: number): boolean };

/** 复刻 harness defaultTurnPolicy：有相邻敌人则攻击，否则随机合法方向移动。 */
const roamPolicy: TurnPolicy = (game) => {
    const px = game.player.loc.x;
    const py = game.player.loc.y;
    const privates = game as unknown as GamePrivates;

    for (const [dx, dy] of DIRS8) {
        const monster = game.getMonsterAt(px + dx, py + dy);
        if (monster && monster.hp > 0 && !monster.isAlly) {
            return { action: 'move', data: { x: dx, y: dy } };
        }
    }

    const movable = DIRS8.filter(([dx, dy]) =>
        privates.canMoveTo(px + dx, py + dy) && !game.getMonsterAt(px + dx, py + dy)
    );
    if (movable.length === 0) {
        return { action: 'wait' };
    }
    const [dx, dy] = movable[rng.randRange(0, movable.length - 1)]!;
    return { action: 'move', data: { x: dx, y: dy } };
};

interface Transition { turn: number; objectiveTurn: number; state: string }
interface CurveSample { turn: number; nutrition: number; hp: number; state: string }
interface SimResult {
    seed: number;
    policy: string;
    turnsRun: number;
    died: boolean;
    deathCause: string;
    finalNutrition: number;
    finalHp: number;
    finalState: string;
    startNutrition: number;
    transitions: Transition[];
    curve: CurveSample[];
}

function deathCause(game: Game): string {
    return (game as unknown as { lastDamageSource: string }).lastDamageSource || 'unknown';
}

/** 逐回合推进并采样（不复用 runTurns：需要逐回合的饥饿状态转移与曲线观测）。 */
function simulate(seed: number, policy: TurnPolicy, label: string, maxTurns: number, withoutFood = false): SimResult {
    const game = createHeadlessGame(seed);
    const sim: SimResult = {
        seed,
        policy: label,
        turnsRun: 0,
        died: false,
        deathCause: '',
        finalNutrition: game.player.nutrition,
        finalHp: game.player.hp,
        finalState: game.player.hungerState,
        startNutrition: game.player.nutrition,
        transitions: [],
        curve: [{ turn: 0, nutrition: game.player.nutrition, hp: game.player.hp, state: game.player.hungerState }],
    };
    const objectiveStart = game.absoluteTurnNumber;
    let lastState = game.player.hungerState;
    for (let t = 1; t <= maxTurns; t++) {
        // The starvation scenario explicitly excludes food: CE automatically eats
        // the starting ration at nutrition <= 1 (Time.c:949-963).
        if (withoutFood) game.player.inventory.items = game.player.inventory.items.filter(i => i.category !== ItemCategory.FOOD);
        if (game.isGameOver || game.player.hp <= 0) {
            break;
        }
        const action = policy(game, t - 1);
        game.handlePlayerAction(action?.action ?? 'wait', action?.data, 'system');
        sim.turnsRun = t;
        if (game.player.hungerState !== lastState) {
            sim.transitions.push({ turn: t, objectiveTurn: game.absoluteTurnNumber - objectiveStart, state: game.player.hungerState });
            lastState = game.player.hungerState;
        }
        if (t % CHECKPOINT === 0) {
            sim.curve.push({
                turn: t,
                nutrition: game.player.nutrition,
                hp: game.player.hp,
                state: game.player.hungerState,
            });
        }
    }
    sim.finalNutrition = game.player.nutrition;
    sim.finalHp = game.player.hp;
    sim.finalState = game.player.hungerState;
    if (game.isGameOver || game.player.hp <= 0) {
        sim.died = true;
        sim.deathCause = deathCause(game);
    }
    return sim;
}

function formatResult(r: SimResult): string {
    return [
        `seed=${r.seed} policy=${r.policy} turns=${r.turnsRun} died=${r.died}${r.died ? ` cause=${r.deathCause}` : ''}`,
        `  nutrition ${r.startNutrition} -> ${r.finalNutrition}, hp=${r.finalHp}, state=${r.finalState}`,
        `  transitions: ${r.transitions.map(t => `${t.state}@${t.turn}`).join(', ') || '(none)'}`,
        `  curve: ${r.curve.map(c => `T${c.turn}:n${c.nutrition}/hp${c.hp}/${c.state}`).join('  ')}`,
    ].join('\n');
}

describe('2000 回合饥饿曲线实测（harness, 3 seeds × 2 策略）', () => {
    it('wait 策略：纯饥饿曲线', () => {
        const results = SEEDS.map(seed => simulate(seed, waitPolicy, 'wait', TURNS));
        console.log(`\n=== wait policy × ${TURNS} turns ===\n${results.map(formatResult).join('\n')}\n`);
        for (const r of results) {
            expect(r.turnsRun).toBeGreaterThan(0);
        }
    }, 300000);

    it('roam 策略：移动/战斗节奏下的饥饿进度', () => {
        const results = SEEDS.map(seed => simulate(seed, roamPolicy, 'roam', TURNS));
        console.log(`\n=== roam policy × ${TURNS} turns ===\n${results.map(formatResult).join('\n')}\n`);
        for (const r of results) {
            expect(r.turnsRun).toBeGreaterThan(0);
        }
    }, 300000);

    it('seed 7 roam 延长至 2300 回合：nutrition 归零后的完整饿死流程', () => {
        const r = simulate(7, roamPolicy, 'roam-extended', 2300, true);
        console.log(`\n=== seed 7 roam, 2300 turns ===\n${formatResult(r)}\n`);
        // wait 策略会在前期被怪物击杀（实测 49-205 回合），故延长运行用 roam：
        // CE Time.c:949-970: at nutrition 1 with no food, checkNutrition immediately sets 0.
        // Thus starvation starts at T2149, one turn before a plain decrement-to-zero model.
        // U17a restored stair traversal: input attempts are not objective turns.
        // Keep exact CE hunger thresholds, measured in actual objective blocks.
        expect(r.transitions.map(t => ({ turn: t.objectiveTurn, state: t.state }))).toEqual(expect.arrayContaining([
            { turn: 2100, state: 'faint' },
            { turn: 2149, state: 'starving' },
        ]));
        expect(r.died).toBe(true);
        expect(r.deathCause).toBe('starvation');
        expect(r.turnsRun).toBeGreaterThanOrEqual(2149);
        expect(r.turnsRun).toBeLessThanOrEqual(2300);
    }, 300000);
});
