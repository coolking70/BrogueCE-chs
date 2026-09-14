/// <reference types="node" />
/**
 * src/test/p2_4_animation_cadence.test.ts — P2-4：动画节奏改按 CE 口径（E1-修订）+ 居中修复
 *
 * A. 常规动作不分帧（验收 2）：玩家 ticksUntilTurn = 100 的普通动作，
 *    推进步数为 1（生成器零 yield）、推进过程恰好 1 次渲染（收尾帧）。
 *    对抗旧行为：P2-2 逐次动画下每个怪物行动单独 yield 一帧（步骤 ≥2、渲染 ≥2）。
 * B. 慢动作才暂停且锁存（验收 3）：
 *    B1 slowed（200 tick）等待：恰好 1 次暂停（pendingPauseMs = 25），
 *       暂停点渲染 1 帧 + 收尾 1 帧。
 *    B2 锁存对抗：白盒把玩家移动耗时抬到 400 tick（CE slowed×重武器可产生的
 *       >200-tick 回合形态；web 玩家 info 速度恒 100/100，自然路径最多 200），
 *       跨越 3 个满足 >100 判定的客观块——锁存实现只暂停 1 次，
 *       "无锁存"的错误实现会暂停 3 次。
 * C. 自动寻路不暂停（验收 4）：slowed + autoPath / isMouseTraveling 时
 *    playerTurnEnded 走同步路径——stepAutoPath 返回后 isAdvancing 恒 false、
 *    回合同步完成（CE rogue.playbackFastForward 语义）。
 * D. 输入锁仍随分步推进生效（验收 5 的补充观测）：慢回合锁定期内玩家输入被
 *    忽略、autoPath 不推进；消费完毕解锁。D1（异常解锁）/D2（超时自解）
 *    本体继续在 p2_2_real_speed.test.ts 运行，不在本文件重复。
 * E. 居中使用容器尺寸（验收 6）：computeMapOffset 在"窗口宽 = 容器宽 + 340"
 *    场景下不含侧栏那 340px；并附源码守卫——GameCanvas.vue 不得再引用
 *    window.innerWidth/innerHeight（正是本轮修复的 bug 源头）。
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import { TerrainType } from '../engine/Map/Grid';
import { DCOLS, DROWS } from '../types';
import monstersJson from '../data/monsters.json';

// GameCanvas.vue 的模块依赖（Input.ts 单例）在模块加载期访问 window；
// headless 下先 stub 再动态导入，取模块级导出的 computeMapOffset / TILE_SIZE。
let computeMapOffset: (w: number, h: number) => { offsetX: number; offsetY: number };
let TILE_SIZE: number;

beforeAll(async () => {
    vi.stubGlobal('window', {
        addEventListener: () => {},
        removeEventListener: () => {},
    });
    const mod = await import('../components/GameCanvas.vue');
    computeMapOffset = mod.computeMapOffset;
    TILE_SIZE = mod.TILE_SIZE;
});

function monsterDataById(id: string): MonsterData {
    const row = monstersJson.find((m) => m.id === id);
    if (!row) throw new Error(`monsters.json 中找不到 ${id}`);
    return row as unknown as MonsterData;
}

/** 清场并在 (2,2)-(12,8) 铺一间开放房间（与 p2_2 同型，保证环境可控）。 */
function clearToOpenRoom(game: Game): void {
    game.monsters.length = 0;
    game.items.length = 0;
    for (let x = 2; x <= 12; x++) {
        for (let y = 2; y <= 8; y++) {
            game.grid.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
        }
    }
    game.player.loc.x = 4;
    game.player.loc.y = 5;
    game.player.hp = 9999;
}

interface DriveStats {
    /** stepAdvancement 调用次数（=1 表示生成器零 yield、一步跑完）。 */
    steps: number;
    /** 停在暂停点的次数（stepAdvancement 返回 true；E1-修订下每回合 ≤1）。 */
    pauses: number;
    /** 推进期间 onRenderRequested 触发次数（暂停点帧 + 收尾帧）。 */
    renders: number;
}

/** 动画模式下执行一次动作并逐步消费到解锁，统计步数/暂停数/渲染数。 */
function driveAnimatedTurn(game: Game, act: () => void): DriveStats {
    let renders = 0;
    game.onRenderRequested = () => { renders++; };
    let steps = 0;
    let pauses = 0;
    act();
    while (game.isAdvancing && steps < 10000) {
        if (game.stepAdvancement()) pauses++;
        steps++;
    }
    game.onRenderRequested = null;
    return { steps, pauses, renders };
}

describe('P2-4 A: 常规动作不分帧（验收 2）', () => {
    it('100 tick 的普通动作：零暂停、一步跑完、推进过程只有收尾 1 帧', () => {
        const game = createHeadlessGame(777);
        clearToOpenRoom(game);
        // 放一只 100 速老鼠：逐次动画旧模型会因它的行动多 yield 一帧
        const rat = new Monster(8, 5, monsterDataById('rat'));
        rat.state = MonsterState.HUNTING;
        game.monsters.push(rat);
        game.animationEnabled = true;

        expect(game.player.movementSpeed).toBe(100); // wait = 恰好 100 tick
        const r = driveAnimatedTurn(game, () => game.handlePlayerAction('wait', undefined, 'system'));

        expect(r.pauses).toBe(0);   // 不满足 >100 → 完全不暂停（CE Time.c:2704）
        expect(r.steps).toBe(1);    // 生成器零 yield：一步完成（旧模型 ≥2 步）
        expect(r.renders).toBe(1);  // 只有收尾帧（旧模型暂停帧+收尾帧 ≥2）
        expect(game.isAdvancing).toBe(false);
        expect(game.isInputLocked()).toBe(false);
        expect(game.stats.turns).toBe(1); // 收尾恰好一次
    });
});

describe('P2-4 B: 慢动作才暂停且本回合锁存（验收 3）', () => {
    it('B1 slowed（200 tick）等待：恰好 1 次暂停，暂停值 = 25ms，暂停点渲染 1 帧', () => {
        const game = createHeadlessGame(777);
        clearToOpenRoom(game);
        game.animationEnabled = true;
        expect(game.player.applyStatus('slowed', 30)).toBe(true);
        expect(game.player.movementSpeed).toBe(200); // >100 → 慢回合

        let renders = 0;
        game.onRenderRequested = () => { renders++; };
        game.handlePlayerAction('wait', undefined, 'system');

        expect(game.isAdvancing).toBe(true);
        expect(game.pendingPauseMs).toBe(0);          // 尚未消费到暂停点
        expect(game.stepAdvancement()).toBe(true);    // 第 1 步停在暂停点
        expect(game.pendingPauseMs).toBe(Game.ANIMATION_PAUSE_MS);
        expect(game.pendingPauseMs).toBe(25);         // CE pauseAnimation(25, ...)
        expect(game.isAdvancing).toBe(true);
        expect(game.stepAdvancement()).toBe(false);   // 第 2 步跑完收尾
        expect(game.pendingPauseMs).toBe(0);
        expect(game.isAdvancing).toBe(false);
        expect(renders).toBe(2);                      // 暂停点帧 + 收尾帧（均经 onRenderRequested 计数）
        expect(game.stats.turns).toBe(1);
    });

    it('B2 400 tick 回合（白盒构造）：锁存生效，跨 3 个满足 >100 的客观块也只暂停 1 次', () => {
        const game = createHeadlessGame(777);
        clearToOpenRoom(game);
        game.animationEnabled = true;

        const rat = new Monster(8, 5, monsterDataById('rat'));
        rat.state = MonsterState.HUNTING;
        game.monsters.push(rat);
        const ratSpy = vi.spyOn(rat, 'takeTurn');

        // 白盒：movementSpeed 恒 400（CE slowed×重武器可产生的 >200-tick 回合）。
        // refreshSpeeds 的写回被空 set 拦下，玩家 wait = 400 tick。
        Object.defineProperty(game.player, 'movementSpeed', {
            configurable: true,
            get: () => 400,
            set: () => { /* 故意保持 400，覆盖 refreshSpeeds 的写回 */ },
        });

        const r = driveAnimatedTurn(game, () => game.handlePlayerAction('wait', undefined, 'system'));

        // 回合确实跨越 400 tick：100 速老鼠行动 4 次（客观块触发 4 次）
        expect(ratSpy).toHaveBeenCalledTimes(4);
        // 无锁存的错误实现会在 400/300/200 tick 的三个块各暂停一次 → 3
        expect(r.pauses).toBe(1);
        expect(r.renders).toBe(2);
        expect(game.player.ticksUntilTurn).toBe(0); // 回合完整跑完，非中止
        expect(game.stats.turns).toBe(1);
    });
});

describe('P2-4 C: 自动寻路/鼠标行进全程不暂停（验收 4）', () => {
    it('C1 slowed + autoPath：stepAutoPath 同步完成，从未进入分步推进', () => {
        const game = createHeadlessGame(777);
        clearToOpenRoom(game);
        game.animationEnabled = true;
        // slowed（200 tick/步）：若误入动画路径，此场景必然产生暂停与输入锁
        expect(game.player.applyStatus('slowed', 30)).toBe(true);

        const px = game.player.loc.x;
        const py = game.player.loc.y;
        game.autoPath = [{ x: px + 1, y: py }, { x: px + 2, y: py }];

        game.stepAutoPath();
        expect(game.isAdvancing).toBe(false);     // 同步路径，不建立分步推进
        expect(game.isInputLocked()).toBe(false); // 全程无输入锁
        expect(game.pendingPauseMs).toBe(0);
        expect(game.player.loc.x).toBe(px + 1);   // 步进已发生
        expect(game.stats.turns).toBe(1);         // 收尾同步执行

        game.stepAutoPath();                       // 锁未介入，路径继续
        expect(game.player.loc.x).toBe(px + 2);
        expect(game.stats.turns).toBe(2);
    });

    it('C2 slowed + isMouseTraveling：同上，鼠标行进不吃动画', () => {
        const game = createHeadlessGame(777);
        clearToOpenRoom(game);
        game.animationEnabled = true;
        expect(game.player.applyStatus('slowed', 30)).toBe(true);
        game.isMouseTraveling = true;

        const px = game.player.loc.x;
        const py = game.player.loc.y;
        game.autoPath = [{ x: px + 1, y: py }, { x: px + 2, y: py }];

        game.stepAutoPath();
        expect(game.isAdvancing).toBe(false);
        expect(game.isInputLocked()).toBe(false);
        expect(game.pendingPauseMs).toBe(0);
        expect(game.player.loc.x).toBe(px + 1);
        expect(game.stats.turns).toBe(1);
    });
});

describe('P2-4 D: 输入锁仍随分步推进生效（验收 5 的补充观测）', () => {
    it('慢回合锁定期内玩家输入被忽略、autoPath 不推进；消费完毕解锁', () => {
        const game = createHeadlessGame(777);
        clearToOpenRoom(game);
        game.animationEnabled = true;
        expect(game.player.applyStatus('slowed', 30)).toBe(true);

        const eventsBefore = game.recordedInputEvents.length;
        game.handlePlayerAction('wait', undefined, 'system');
        expect(game.isAdvancing).toBe(true);
        expect(game.isInputLocked()).toBe(true);
        expect(game.stats.turns).toBe(0); // 收尾未跑

        // 锁定期玩家动作：被忽略（不录制、不触发第二次推进）
        game.handlePlayerAction('move', { x: 1, y: 0 }, 'player');
        expect(game.recordedInputEvents.length).toBe(eventsBefore);

        // 锁定期 autoPath：不得推进下一步
        const px = game.player.loc.x;
        game.autoPath = [{ x: px + 3, y: game.player.loc.y }, { x: px + 4, y: game.player.loc.y }];
        game.stepAutoPath();
        expect(game.autoPath.length).toBe(2);
        expect(game.player.loc.x).toBe(px);

        let guard = 0;
        while (game.isAdvancing && guard++ < 10000) game.stepAdvancement();
        expect(game.isAdvancing).toBe(false);
        expect(game.isInputLocked()).toBe(false);
        expect(game.stats.turns).toBe(1); // 收尾恰好一次
    });
});

describe('P2-4 E: 居中使用容器尺寸而非窗口尺寸（验收 6）', () => {
    const MAP_W = DCOLS * 16; // 79 × 16 = 1264
    const MAP_H = DROWS * 16; // 29 × 16 = 464

    it('E1 computeMapOffset 按传入视口居中：窗口宽 = 容器宽 + 340 时，offsetX 不含那 340', () => {
        expect(typeof computeMapOffset).toBe('function');

        // 容器 2000px，窗口 2340px（= 2000 + 340 侧栏）
        const byContainer = computeMapOffset(2000, 700);
        expect(byContainer.offsetX).toBe((2000 - MAP_W) / 2); // 368
        expect(byContainer.offsetY).toBe((700 - MAP_H) / 2);  // 118

        // 旧实现（误用 window.innerWidth）的值——恰好多出侧栏宽的一半
        const byWindow = computeMapOffset(2340, 700);
        expect(byWindow.offsetX - byContainer.offsetX).toBe(170);
    });

    // ⚠️ 原 E2 断言"容器小于地图时 offsetX 钳到 0"——那正是长期"侧栏遮挡"bug 本身：
    // 钳到 0 等于默许地图溢出容器被硬切。该测试把错误行为固化成了正确行为，
    // 是这个 bug 反复"修好"又复现的原因之一。P2-5 改为等比缩放后重写此条。
    it('E2 容器小于地图时不出现负偏移，且缩放后不溢出（原断言固化了 bug，已重写）', () => {
        const r = computeMapOffset(1000, 400);
        expect(r.offsetX).toBeGreaterThanOrEqual(0);
        expect(r.offsetY).toBeGreaterThanOrEqual(0);
    });

    it('E3 TILE_SIZE 导出口径不变（16px）', () => {
        expect(TILE_SIZE).toBe(16);
    });

    it('E4 源码守卫：GameCanvas.vue 不得再用 window.innerWidth/innerHeight（本轮 bug 源头）', () => {
        const src = readFileSync(new URL('../components/GameCanvas.vue', import.meta.url), 'utf8');
        expect(src).not.toMatch(/window\.innerWidth|window\.innerHeight/);
    });
});

// ── P2-5 追加：地图必须自适应容器，不得溢出被切 ──────────────────────────────
// 长期未修复的"侧栏遮挡"真凶：地图固定 79×16 = 1264px，旧实现用
// max(0, (viewport - map)/2) 把负偏移钳成 0，窗口放不下时直接溢出硬切。
// 实测：窗口 1280 切 21 列、1440 切 11 列、1604 才是完整显示的临界点。
describe('P2-5 F: 地图自适应容器（长期"侧栏遮挡"bug 的真因）', () => {
    const DCOLS_ = 79, DROWS_ = 29;

    it('F1 容器放不下时等比缩小，地图右缘绝不超出容器', async () => {
        const mod: any = await import('../components/GameCanvas.vue');
        const compute = mod.computeMapLayout;
        const TILE = mod.TILE_SIZE;
        expect(typeof compute).toBe('function');
        const mapW = DCOLS_ * TILE, mapH = DROWS_ * TILE;
        // 覆盖窄到宽：每一档都不许溢出
        for (const contW of [640, 940, 1100, 1260, 1264, 1460, 1580, 2220]) {
            const contH = 900;
            const { scale, offsetX, offsetY } = compute(contW, contH);
            const right = offsetX + mapW * scale;
            const bottom = offsetY + mapH * scale;
            expect(right, `容器宽 ${contW} 时地图右缘 ${right} 溢出`).toBeLessThanOrEqual(contW + 0.001);
            expect(bottom, `容器高 ${contH} 时地图下缘 ${bottom} 溢出`).toBeLessThanOrEqual(contH + 0.001);
            expect(scale).toBeGreaterThan(0);
            expect(scale).toBeLessThanOrEqual(1);
        }
    });

    it('F2 放得下时不放大（scale 上限 1）且保持居中', async () => {
        const mod: any = await import('../components/GameCanvas.vue');
        const compute = mod.computeMapLayout;
        const TILE = mod.TILE_SIZE;
        const mapW = DCOLS_ * TILE;
        const { scale, offsetX } = compute(2220, 900);
        expect(scale).toBe(1);
        expect(offsetX).toBeCloseTo((2220 - mapW) / 2, 5);
    });

    it('F3 回归：1260px 容器（1600 窗口 − 340 侧栏）下最后一列完整可见', async () => {
        const mod: any = await import('../components/GameCanvas.vue');
        const compute = mod.computeMapLayout;
        const TILE = mod.TILE_SIZE;
        const { scale, offsetX } = compute(1260, 900);
        // 最后一列（索引 78）的右缘
        const lastColRight = offsetX + DCOLS_ * TILE * scale;
        expect(lastColRight).toBeLessThanOrEqual(1260 + 0.001);
        // 修复前：scale 恒为 1、offsetX 为 0 → 右缘 1264 > 1260，切掉 4px
        expect(scale).toBeLessThan(1);
    });
});
