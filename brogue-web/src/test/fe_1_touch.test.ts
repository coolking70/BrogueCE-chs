/**
 * FE-1：前端/移动端适配的纯逻辑与边界守卫。
 *  1. 布局模式判定（四个验收视口）；
 *  2. 小屏跟随相机（桌面口径不变、跟随居中、边界夹紧）；
 *  3. 触屏手势识别（单击 / 长按 / 平移 / 捏合）；
 *  4. 触屏目标选择的命令映射；
 *  5. 录制边界：触屏命令栏/方向键/目标条发出的命令全部经 handlePlayerAction /
 *     executeCommand，录像可在另一实例零 OOS 回放；
 *  6. 结构守卫：触屏组件不直接调用引擎的状态修改方法。
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHeadlessGame } from './harness';
import { computeLayoutMode } from '../ui/layout';
import { computeMapCamera, MIN_READABLE_TILE_PX } from '../ui/mapCamera';
import { GestureTracker, LONG_PRESS_MS } from '../ui/touchGestures';
import { targetingTapCommand } from '../ui/targeting';
import { ItemCategory } from '../engine/Items/Item';
import { Direction, DCOLS, DROWS } from '../types';
import type { Game } from '../engine/Core/Game';

let computeMapLayout: (w: number, h: number, mode?: 'uniform' | 'stretch') => { scaleX: number; scaleY: number; offsetX: number; offsetY: number };
let TILE_SIZE = 16;
let dispatch: (action: string, data?: unknown) => void;
let inputManager: { setCallback(cb: (action: string, data?: unknown) => void): void };
beforeAll(async () => {
    // GameCanvas / Input 单例在模块加载期访问 window（p2_0 / ui_1 同款 stub）
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {}, devicePixelRatio: 1 });
    const canvas: any = await import('../components/GameCanvas.vue');
    computeMapLayout = canvas.computeMapLayout;
    TILE_SIZE = canvas.TILE_SIZE;
    ({ dispatch } = await import('../ui/commands'));
    ({ inputManager } = await import('../engine/Input') as any);
});

describe('FE-1 布局模式', () => {
    it('四个验收视口各得其所', () => {
        expect(computeLayoutMode(1440, 900)).toBe('desktop');
        expect(computeLayoutMode(768, 1024)).toBe('portrait');
        expect(computeLayoutMode(390, 844)).toBe('portrait');
        expect(computeLayoutMode(844, 390)).toBe('landscape');
        expect(computeLayoutMode(1024, 768)).toBe('desktop');
        expect(computeLayoutMode(1280, 560)).toBe('landscape');
    });
});

describe('FE-1 小屏跟随相机', () => {
    const cam = (w: number, h: number, focus = { x: 40, y: 14 }, zoom = 1, pan = { x: 0, y: 0 }) =>
        computeMapCamera(w, h, computeMapLayout(w, h, 'uniform'), DCOLS, DROWS, TILE_SIZE, focus, zoom, pan);

    it('桌面：每格已可读时原样使用 computeMapLayout（P2-6 口径不变）', () => {
        const base = computeMapLayout(1100, 900, 'uniform');
        const c = cam(1100, 900);
        expect(c.follow).toBe(false);
        expect([c.scaleX, c.scaleY, c.offsetX, c.offsetY]).toEqual([base.scaleX, base.scaleY, base.offsetX, base.offsetY]);
        const stretch = computeMapLayout(1100, 900, 'stretch');
        const s = computeMapCamera(1100, 900, stretch, DCOLS, DROWS, TILE_SIZE, { x: 1, y: 1 }, 1, { x: 0, y: 0 });
        expect(s.follow).toBe(false);
        expect(s.scaleX).toBe(stretch.scaleX);
    });

    it('手机竖屏：切入跟随，每格 ≥ 可读下限，玩家居中', () => {
        const c = cam(390, 700);
        expect(c.follow).toBe(true);
        expect(c.scaleX * TILE_SIZE).toBeGreaterThanOrEqual(MIN_READABLE_TILE_PX);
        const playerCenterX = c.offsetX + 40.5 * TILE_SIZE * c.scaleX;
        expect(Math.abs(playerCenterX - 195)).toBeLessThan(1);
    });

    it('边界夹紧：玩家在地图角落时地图不离开视口边缘；平移量被夹紧回写', () => {
        const left = cam(390, 700, { x: 0, y: 0 });
        expect(left.offsetX).toBe(0);
        const right = cam(390, 700, { x: DCOLS - 1, y: 0 });
        expect(right.offsetX + DCOLS * TILE_SIZE * right.scaleX).toBeCloseTo(390, 6);
        const panned = cam(390, 700, { x: 40, y: 14 }, 1, { x: 99999, y: 0 });
        expect(panned.offsetX).toBe(0);
        expect(panned.panX).toBeLessThan(99999);
    });

    it('缩放级改变每格像素，但不会小于整图适配', () => {
        const a = cam(390, 700, undefined, 1);
        const b = cam(390, 700, undefined, 2);
        expect(b.scaleX).toBeGreaterThan(a.scaleX);
        const tiny = cam(390, 700, undefined, 0.01);
        expect(tiny.scaleX).toBeGreaterThanOrEqual(computeMapLayout(390, 700, 'uniform').scaleX);
    });
});

describe('FE-1 触屏手势', () => {
    it('短按不动 = tap', () => {
        const g = new GestureTracker();
        g.down(1, 100, 100, 0);
        g.move(1, 103, 102);
        expect(g.up(1, 120)).toEqual([{ type: 'tap', x: 103, y: 102 }]);
    });
    it('按住不动 = longpress，之后抬起不再 tap', () => {
        const g = new GestureTracker();
        g.down(1, 50, 50, 0);
        expect(g.poll(LONG_PRESS_MS - 1)).toEqual([]);
        expect(g.poll(LONG_PRESS_MS)).toEqual([{ type: 'longpress', x: 50, y: 50 }]);
        expect(g.up(1, LONG_PRESS_MS + 100)).toEqual([]);
    });
    it('拖动 = pan（首帧补齐起点位移），抬起不 tap', () => {
        const g = new GestureTracker();
        g.down(1, 0, 0, 0);
        expect(g.move(1, 20, 0)).toEqual([{ type: 'pan', dx: 20, dy: 0 }]);
        expect(g.move(1, 25, 5)).toEqual([{ type: 'pan', dx: 5, dy: 5 }]);
        expect(g.up(1, 50)).toEqual([]);
    });
    it('双指 = pinch，松开后本轮不产生 tap', () => {
        const g = new GestureTracker();
        g.down(1, 0, 0, 0);
        g.down(2, 100, 0, 5);
        expect(g.move(2, 200, 0)).toEqual([{ type: 'pinch', factor: 2 }]);
        expect(g.up(2, 30)).toEqual([]);
        expect(g.up(1, 40)).toEqual([]);
    });
});

describe('FE-1 触屏目标选择映射', () => {
    const player = { x: 10, y: 10 };
    it('投掷：先瞄准，再点同一格才提交 mouse_travel；点自己忽略', () => {
        expect(targetingTapCommand('throw', { x: 11, y: 10 }, null, null, player)).toEqual({ kind: 'aim', x: 11, y: 10 });
        expect(targetingTapCommand('throw', { x: 11, y: 10 }, { x: 11, y: 10 }, null, player))
            .toEqual({ kind: 'execute', action: 'mouse_travel', data: { x: 11, y: 10 } });
        expect(targetingTapCommand('throw', { x: 15, y: 12 }, { x: 11, y: 10 }, null, player)).toEqual({ kind: 'aim', x: 15, y: 12 });
        expect(targetingTapCommand('throw', player, null, null, player)).toEqual({ kind: 'none' });
    });
    it('法杖：点别处 = move 光标增量；点光标所在格 = confirm_target', () => {
        expect(targetingTapCommand('arcana', { x: 20, y: 5 }, null, { x: 12, y: 9 }, player))
            .toEqual({ kind: 'dispatch', action: 'move', data: { x: 8, y: -4 } });
        expect(targetingTapCommand('arcana', { x: 12, y: 9 }, null, { x: 12, y: 9 }, player))
            .toEqual({ kind: 'dispatch', action: 'confirm_target' });
    });
});

describe('FE-1 录制边界：触屏命令录像可零 OOS 回放', () => {
    function farVisibleFloor(game: Game): { x: number; y: number } | null {
        const { x: px, y: py } = game.player.loc;
        let best: { x: number; y: number; d: number } | null = null;
        for (let x = 0; x < DCOLS; x++) for (let y = 0; y < DROWS; y++) {
            const cell = game.grid.getCell(x, y);
            const d = Math.max(Math.abs(x - px), Math.abs(y - py));
            if (cell?.isVisible && cell.isPassable && d >= 2 && d <= 6 && !game.getMonsterAt(x, y)
                && (!best || d > best.d)) best = { x, y, d };
        }
        return best;
    }

    it('命令栏 + 方向键 + 投掷两步确认 + 点地图寻路，经 dispatch/executeCommand 录制并回放一致', () => {
        const game = createHeadlessGame(4242);
        // 与 GameCanvas 注册的回调同构（去掉渲染用的 update 以外无差别）
        inputManager.setCallback((action, data) => { game.handlePlayerAction(action, data); game.update(); });

        dispatch('search');
        dispatch('wait');
        dispatch('move', Direction.RIGHT);
        dispatch('move', Direction.LEFT);
        dispatch('discoveries');
        dispatch('escape');
        dispatch('help');
        dispatch('escape');
        dispatch('stairs_down'); // 不在楼梯上：只记一条日志
        dispatch('toggle_inventory');
        dispatch('toggle_inventory');

        const darts = game.player.inventory.items.find(i => i.category === ItemCategory.WEAPON && i.quantity > 1);
        expect(darts).toBeDefined();
        game.executeItemCommand('throw', darts!); // 背包"投掷"按钮的同一路径
        expect(game.isThrowing).toBe(true);
        const target = farVisibleFloor(game);
        expect(target).not.toBeNull();
        // 触屏两步：第一步只设 UI 瞄准格（不产生命令），第二步提交
        const first = targetingTapCommand('throw', target!, null, null, game.player.loc);
        expect(first.kind).toBe('aim');
        const eventsBefore = game.recordedInputEvents.length;
        const second = targetingTapCommand('throw', target!, target, null, game.player.loc);
        expect(second.kind).toBe('execute');
        game.executeCommand('mouse_travel', target!); // = ui/commands.travelTo
        expect(game.recordedInputEvents.length).toBe(eventsBefore + 1);
        expect(game.isThrowing).toBe(false);

        const dest = farVisibleFloor(game);
        if (dest) {
            game.executeCommand('mouse_travel', dest);
            let guard = 0;
            while (game.autoPath.length && guard++ < 50) game.stepAutoPath();
        }

        const finalPos = { ...game.player.loc };
        const finalTurn = game.absoluteTurnNumber;
        const recording = game.exportRecording();
        expect(recording.events.length).toBeGreaterThanOrEqual(12);

        const replay = createHeadlessGame(1);
        expect(replay.loadReplay(JSON.parse(JSON.stringify(recording)))).toBe(true);
        while (replay.replayCursor < recording.events.length && !replay.replayError) replay.replayStep();
        expect(replay.replayError).toBeNull();
        expect(replay.replayCursor).toBe(recording.events.length);
        expect(replay.player.loc).toEqual(finalPos);
        expect(replay.absoluteTurnNumber).toBe(finalTurn);
    });
});

describe('FE-1 结构守卫：触屏组件只经录制边界改状态', () => {
    const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
    it('命令栏/方向键只 import ui/commands，不直接碰引擎', () => {
        for (const file of ['../components/CommandBar.vue', '../components/DPad.vue']) {
            const src = read(file);
            expect(src, file).toMatch(/from '\.\.\/ui\/commands'/);
            expect(src, file).not.toMatch(/activeGame|engine\/Core\/Game/);
        }
    });
    it('目标条/状态条/消息条/缩放钮/抽屉不调用 activeGame 的任何方法（只读字段）', () => {
        for (const file of ['../components/TargetBar.vue', '../components/MobileHud.vue', '../components/MessageStrip.vue',
            '../components/MapZoomControls.vue', '../components/SideDrawer.vue', '../ui/useGameHud.ts', '../ui/targeting.ts',
            '../ui/mapCamera.ts', '../ui/touchGestures.ts', '../ui/layout.ts']) {
            expect(read(file), file).not.toMatch(/activeGame\.\w+\s*\(/);
        }
    });
    it('ui/commands 是唯一出口：只用 triggerAction / executeCommand（+ 渲染用 update）', () => {
        const src = read('../ui/commands.ts').replace(/\/\*[\s\S]*?\*\//g, '');
        const calls = [...src.matchAll(/(?:activeGame|inputManager)\.(\w+)\(/g)].map(m => m[1]);
        expect(new Set(calls)).toEqual(new Set(['triggerAction', 'executeCommand', 'update']));
    });
    it('GameCanvas 的触屏分支改状态只经 ui/commands 或既有 executeCommand/triggerAction', () => {
        const src = read('../components/GameCanvas.vue');
        const start = src.indexOf('FE-1：触屏目标选择的命令落地');
        const end = src.indexOf('let pathingTimer');
        const block = src.slice(start, end);
        const gameCalls = new Set([...block.matchAll(/\bgame\.(\w+)\(/g)].map(m => m[1]));
        expect(gameCalls).toEqual(new Set(['executeCommand', 'update', 'handleInspectAt', 'updateHover']));
    });
});
