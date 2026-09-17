/**
 * src/test/p1_46_keybindings.test.ts — P1-46：移动键回到纯 vi 键，让出 CE 命令键
 *
 * 病灶：web 在 vi 键（hjkl/yubn）之上又绑了一套 WASD，而 CE **只用 vi 键移动**
 * （`Rogue.h:1161-1172`）——`w`/`a`/`s`/`d` 在 CE 里全是命令：
 *   w = SWAP_KEY(:1186)、a = APPLY_KEY(:1182)、s = SEARCH_KEY(:1177)、d = DROP_KEY(:1189)。
 * 四个 CE 命令键被一次性占掉。P1-42 的主动搜索因此无处安放；
 * "使用"与"丢弃"是 Phase B 必然要接的。2026-09-17 用户裁决：回到纯 vi 键。
 *
 * 本文件用**真实的键盘事件派发**验证，不用源码扫描——按项目规矩
 * （project_conventions.md「留痕测试必须防改写形态绕过」），
 * 扫描形态的断言容易被改写规避，行为断言不会。
 *
 * 对抗性：每条断言都对应一个具体的错误实现——
 *   AD1 WASD 没删干净（任一个仍触发 move）
 *   AD2 vi 键被误删（移动直接坏掉）
 *   AD3 `s` 接错动作（接成 move 或没接）
 *   AD4 方向键被顺手一起删掉（它们不与 CE 冲突，应保留）
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Direction } from '../types';

let InputManager: typeof import('../engine/Input').InputManager;

beforeAll(async () => {
    // Input.ts 在模块加载期就 addEventListener，node 环境无 window——装最小桩。
    const listeners: Record<string, ((e: any) => void)[]> = {};
    (globalThis as any).window = {
        addEventListener(type: string, fn: (e: any) => void) {
            (listeners[type] ??= []).push(fn);
        },
        __dispatch(type: string, ev: any) {
            for (const fn of listeners[type] ?? []) fn(ev);
        },
    };
    ({ InputManager } = await import('../engine/Input'));
});

afterAll(() => { delete (globalThis as any).window; });

/** 按一个键，返回这次按键触发的 (action, data) 列表。 */
function press(key: string): Array<[string, any]> {
    const got: Array<[string, any]> = [];
    const mgr = new InputManager();
    mgr.setCallback((action, data) => got.push([action, data]));
    // 构造器把自己的 handler 注册进了桩 window；派发给全部 handler，
    // 只有本实例的回调会记录（其它实例没设 callback）。
    (globalThis as any).window.__dispatch('keydown', { key });
    return got;
}

describe('P1-46 键位：移动回到纯 vi 键，CE 命令键让出', () => {
    it('AD1：w / a / s / d（及大写）一律不再触发移动', () => {
        for (const key of ['w', 'W', 'a', 'A', 'd', 'D']) {
            const moves = press(key).filter(([act]) => act === 'move');
            expect(moves, `按 '${key}' 仍触发了移动——WASD 没让干净，CE 的 ${key} 命令键仍被占`).toEqual([]);
        }
        // s 单独看：它应当触发 search 而非 move（见 AD3）
        for (const key of ['s', 'S']) {
            const moves = press(key).filter(([act]) => act === 'move');
            expect(moves, `按 '${key}' 触发了移动——它应该是 CE 的 SEARCH_KEY`).toEqual([]);
        }
    });

    it('AD2：vi 键 hjkl / yubn 仍然是移动，方向不能串', () => {
        const expected: Array<[string, Direction]> = [
            ['k', Direction.UP], ['j', Direction.DOWN],
            ['h', Direction.LEFT], ['l', Direction.RIGHT],
            ['y', Direction.UPLEFT], ['u', Direction.UPRIGHT],
            ['b', Direction.DOWNLEFT], ['n', Direction.DOWNRIGHT],
        ];
        for (const [key, dir] of expected) {
            expect(press(key), `vi 键 '${key}' 的移动方向不对（或被误删）`).toEqual([['move', dir]]);
        }
    });

    it('AD3：s / S 触发 search（CE SEARCH_KEY，P1-42 一直缺的那一行）', () => {
        for (const key of ['s', 'S']) {
            const acts = press(key).map(([a]) => a);
            expect(acts, `按 '${key}' 没有触发 search`).toContain('search');
        }
    });

    it('AD4：方向键保留（不与任何 CE 命令冲突）', () => {
        const expected: Array<[string, Direction]> = [
            ['ArrowUp', Direction.UP], ['ArrowDown', Direction.DOWN],
            ['ArrowLeft', Direction.LEFT], ['ArrowRight', Direction.RIGHT],
        ];
        for (const [key, dir] of expected) {
            expect(press(key), `方向键 '${key}' 被误删或方向串了`).toEqual([['move', dir]]);
        }
    });

    it('留痕：CE 的 w / a / d 三个命令键目前空闲（接 SWAP/APPLY/DROP 的轮次翻转本断言）', () => {
        for (const key of ['w', 'a', 'd']) {
            expect(press(key), `'${key}' 已被占用——接 CE 命令时请更新本留痕`).toEqual([]);
        }
    });

    it('B-2：CE THROW_KEY t 已接投掷入口（Rogue.h:1183）', () => {
        // 对抗性：t 没接上（[]）、接错动作（'move' 等）都翻红。
        expect(press('t'), `'t' 应触发 throw_item 动作`).toEqual([['throw_item', undefined]]);
        // CE 大写 T 是 RETHROW_KEY（Rogue.h:1184，重扔上一件）——web 无
        // lastItemThrown 簿记，B-2 明确不接；它也不得被顺手接成移动或投掷。
        expect(press('T'), `'T'(RETHROW) 未接，不得映射到其它动作`).toEqual([]);
    });
});
