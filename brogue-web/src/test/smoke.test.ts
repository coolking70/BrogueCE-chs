/**
 * src/test/smoke.test.ts — headless 冒烟测试（确定性回归）
 *
 * a) 固定 seed 跑 2000 回合：全程不抛异常、无 unhandled rejection。
 *    玩家中途死亡是允许的（如实体现在结果里），不为跑满回合而干预游戏。
 * b) 同一 seed 生成两次：D1..D5 的 terrainFingerprint 两两相等。
 *    若失败 ⇒ 生成链路混入了非 seed 随机源，属重要发现（定位但不修）。
 * c) D1..D26 每层生成后 monsters.length > 0。
 *    任务原预设此条当前失败、要求 it.fails 红灯占位；实测 2600 层扫描（100 seed）
 *    无一空层，断言恒真 —— 故落为正式断言，并以 it.todo 保留 P1-2 后的加固占位。
 *    背景缺陷：hordes.json 经 Game.ts:711-723 的 CE flag 过滤（HORDE_IS_SUMMONED /
 *    HORDE_LEADER_CAPTIVE / HORDE_SACRIFICE_TARGET / HORDE_VAMPIRE_FODDER /
 *    HORDE_NO_PERIODIC_SPAWN / HORDE_MACHINE_*）后常规可刷 horde 仅 15 条且以水生怪
 *    为主，显形为 D9+ 的种类偏斜而非空层。过滤器忠于 CE，问题在数据侧——
 *    不要为任何转绿目的而放宽过滤或改生成逻辑。
 *
 * 下潜方式：直接设 game.depth 后调用私有 generateDepth(false, false)（测试侧只读
 * 访问私有成员），等价于走上下行楼梯触发的新层生成路径；各层均首次生成、无缓存复用。
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame, runTurns, terrainFingerprint, type RunTurnsResult } from './harness';
import type { Game } from '../engine/Core/Game';

/** 最小 process 类型：tsconfig.app 有意排除 @types/node 全局（types: ["vite/client"]），
 *  为不污染 App 的类型作用域，这里经 globalThis 取 process 并本地声明所需面。 */
interface MinimalProcess {
    on(eventName: string, listener: (reason: unknown) => void): unknown;
    off(eventName: string, listener: (reason: unknown) => void): unknown;
}
const proc = (globalThis as { process?: MinimalProcess }).process;

/** 三个用例各自使用独立的固定 seed，互不干扰。 */
const SMOKE_SEED = 20260913;
const DETERMINISM_SEED = 987654321;
const DEPTH_SCAN_SEED = 424242;

/** Omit 技巧：generateDepth 在 Game 里是 private，直接交叉会被 TS 归约为 never。 */
type GameWithPrivates = Omit<Game, 'generateDepth'> & {
    generateDepth(isGoingUp: boolean, isFirstLevel: boolean): void;
};

/** 下潜一层并触发全新生成（walk down stairs 的生成路径）。 */
function descendOne(game: Game, targetDepth: number): void {
    game.depth = targetDepth;
    (game as unknown as GameWithPrivates).generateDepth(false, false);
}

describe('headless 冒烟', () => {
    it(`a) 固定 seed ${SMOKE_SEED} 连跑 2000 回合：全程无异常、无 unhandled rejection（玩家死亡如实报告）`, () => {
        const rejections: unknown[] = [];
        const onUnhandledRejection = (reason: unknown) => {
            rejections.push(reason);
        };
        proc?.on('unhandledRejection', onUnhandledRejection);

        let fatal: unknown;
        let result: RunTurnsResult | undefined;
        let deathReason = '';

        try {
            const game = createHeadlessGame(SMOKE_SEED);
            result = runTurns(game, 2000);
            deathReason = game.gameOverReason;
        } catch (error) {
            fatal = error;
        } finally {
            proc?.off('unhandledRejection', onUnhandledRejection);
        }

        expect(fatal).toBeUndefined();
        expect(rejections).toEqual([]);
        expect(result).toBeDefined();
        expect(result!.turnsRun).toBeGreaterThan(0);
        expect(result!.turnsRun).toBeLessThanOrEqual(2000);
        if (result!.died) {
            // 死亡是允许的结果：必须跑不满 2000 回合，且原因可追溯
            expect(deathReason).not.toBe('');
            console.log(`[smoke] 玩家死于第 ${result!.turnsRun} 回合，死因：${deathReason}`);
        }
        console.log(
            `[smoke] turnsRun=${result!.turnsRun} died=${result!.died} logCount=${result!.logCount} deathReason="${deathReason}"`
        );
    });

    it(`b) 同一 seed ${DETERMINISM_SEED} 生成两次：D1..D5 的 terrainFingerprint 两两相等`, () => {
        const runs: string[][] = [];
        for (let run = 0; run < 2; run++) {
            const game = createHeadlessGame(DETERMINISM_SEED);
            const marks = [terrainFingerprint(game.grid)];
            for (let depth = 2; depth <= 5; depth++) {
                descendOne(game, depth);
                marks.push(terrainFingerprint(game.grid));
            }
            runs.push(marks);
        }

        for (let depth = 1; depth <= 5; depth++) {
            expect(runs[1]![depth - 1]).toBe(runs[0]![depth - 1]);
        }
    });

    // 【与任务预设不符的重要发现，详见交付报告 §5】
    // 任务预设本条当前会失败（hordes.json 数据缺陷：常规可刷 horde 仅 15 条且以水生怪为主），
    // 并要求以 it.fails 做红灯占位。实测（100 个 seed × D1..D26 = 2600 层扫描）：
    // 每层怪物数最少 1、从不为 0 —— 字面断言当前恒真，it.fails 会使套件变红
    // （vitest："Expect test to fail"），与「npm test 全绿」约束冲突。
    // 数据缺陷实际显形为【种类偏斜】而非空层：D9+ 普遍由 Eel / Bog monster / Kraken
    // 等水栖系主导（见交付报告 D1-D26 逐层表），Game.ts:711-723 的 flag 过滤忠于 CE，
    // 问题在数据侧。故本条先落为正式断言（当前即绿）；P1-2 重新提取 hordes.json 后，
    // 再把断言加固为「每层至少 N 只非水栖怪」之类更有牙齿的形态。
    it(`c) seed ${DEPTH_SCAN_SEED} 下 D1..D26 每层生成后 monsters.length > 0`, () => {
        const game = createHeadlessGame(DEPTH_SCAN_SEED);
        const counts: number[] = [];

        for (let depth = 1; depth <= 26; depth++) {
            if (depth > 1) descendOne(game, depth);
            counts.push(game.monsters.length);
        }

        const emptyDepths = counts
            .map((count, index) => (count === 0 ? index + 1 : 0))
            .filter(Boolean);
        expect(emptyDepths).toEqual([]);
    });

    // 红灯占位的原定形态（待 P1-2 后评估恢复）：任务要求对 c 用 it.fails 标注
    // 「红灯占位：待 P1-2 重新提取 hordes.json 后转为正式断言」——但因字面断言当前
    // 恒真（it.fails 会令套件变红），暂以 it.todo 记录该占位意图，P1-2 落地时
    // 按加固后的断言（如非水栖怪下限）重新接手。
    it.todo('c-placeholder 红灯占位：待 P1-2 重新提取 hordes.json 后转为正式断言（加固为每层非水栖怪数 > 0 之类的形态）');
});
