/**
 * src/test/p1_34_loopmap_reset.test.ts — P1-34：test 层 loopMap 必须随层重算
 *
 * 病灶（详见 ai_docs/p1_34_flaky_determinism_report.md）：
 *   Game 构造器以"当前时间"为种子跑一次 normal 生成，末尾把
 *   `analyzeLoopMap(grid)` 写进实例（Game.ts normal 路径汇合点）。harness/UI
 *   随后的 `startNewGame({ mode: 'test' })` 走 generateTestDepth 提前 return，
 *   从不重算 loopMap——构造器那次生成的环路图残留在 test 局上。时间种子是
 *   秒级精度：同一秒建的局共享同一张陈旧图，跨秒则不同。p4_9_safety_map 的
 *   T2（解析解）与 T7（决定性）由此间歇性翻红：buildSafetyMap 的 IN_LOOP
 *   -=10 分支吃到的是与当前网格无关的随机环路集合。
 *
 * 对抗性断言与各自捕获的错误实现：
 *   T1  模式切换残留（决定性锚点）：normal 局（seed 42，前提断言锁死"该局
 *       确有环路"）切到 test 后，loopMap 若仍是旧层的图（即错误实现"只在
 *       normal 路径末尾重算"），必与新层网格的重算结果不等。
 *   T2  harness 出生态残留：createHeadlessGame('test') 的 Game 构造器先跑过
 *       normal 生成（时间种子），错误实现下 loopMap 带着那张随机图的环路。
 *       全图逐格对比当前网格的 analyzeLoopMap——loopMap 的口径是"当前层
 *       网格的纯函数"（C-0 B4 同款契约），陈旧残留不可能对任意随机种子都
 *       巧合自洽。
 *
 * 两类断言都只加强不放松：修复后 test 层（花岗岩底板）的 analyzeLoopMap
 * 为全 false，与"测试舞台无环路"的语义一致；若未来 test 舞台长出环形
 * 地形，本测试仍按同一契约通过。
 */
import { describe, it, expect } from 'vitest';

import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { analyzeLoopMap } from '../engine/Map/LoopMap';

/** 全图逐格对比 game.loopMap 与对当前网格的重算结果，返回不一致格坐标。 */
function staleLoopCells(game: Game): string[] {
    const expected = analyzeLoopMap(game.grid);
    const stale: string[] = [];
    for (let x = 0; x < game.grid.width; x++) {
        for (let y = 0; y < game.grid.height; y++) {
            if ((game.loopMap[x]?.[y] ?? false) !== (expected[x]?.[y] ?? false)) {
                stale.push(`${x},${y}`);
            }
        }
    }
    return stale;
}

function loopTrueCount(game: Game): number {
    let n = 0;
    for (let x = 0; x < game.loopMap.length; x++) {
        for (let y = 0; y < game.loopMap[x]!.length; y++) {
            if (game.loopMap[x]![y]) n++;
        }
    }
    return n;
}

describe('P1-34: test 层 loopMap 随层重算（间歇性翻红根治的回归守卫）', () => {
    it('T1 模式切换：normal 局（seed 42，该局确有环路）切 test 后 loopMap 必须与新层网格自洽', () => {
        const game = createHeadlessGame(42, 'normal');
        // 前提（确定性，seed 固定）：该 normal 局有环路格。没有它，错误实现
        // 下的"残留全 false 巧合"会让本测试失去牙齿（seed 777 就是零环路局）。
        expect(loopTrueCount(game)).toBeGreaterThan(0);

        game.startNewGame({ seed: 20260915, mode: 'test' });

        const stale = staleLoopCells(game);
        expect(stale).toEqual([]);
    });

    it('T2 harness 出生态：test 局的 loopMap 与其网格自洽（构造器 normal 残留路径）', () => {
        for (const seed of [1, 20260915]) {
            const game = createHeadlessGame(seed, 'test');
            const stale = staleLoopCells(game);
            expect(stale).toEqual([]);
        }
    });
});
