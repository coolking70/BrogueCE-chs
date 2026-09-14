/**
 * ⚠️ F 节的 play 快照断言锁定的是 P2-3（客观时间迁移）之前的状态。
 * P2-3 起该快照已被 p2_3_baseline.json 取代，此条 skip 保留为阶段证据。
 * A–E 节（真实速度/动画同源/输入锁）与 levels 段仍然有效，未动。
 */
/// <reference types="node" />
/**
 * src/test/p2_2_real_speed.test.ts — P2-2：真实速度 + 逐次动画 + 输入锁
 *
 * A. 速度生效（验收 1）：
 *    A1 初始 ticksUntilTurn = monsters.json 的 moveSpeed（Monsters.c:116）。
 *    A2 豺狼（moveSpeed=50）在玩家一次移动内行动两次（CE Time.c:2643 推进循环）。
 *    A3 食人魔（attackSpeed=200）两个玩家回合才攻击一次（Monsters.c 攻击出口）。
 *    A4 haste：玩家 movementSpeed/attackSpeed 减半 → 100 速怪物每两个玩家
 *       动作才行动一次；slowed：翻倍 → 一次玩家动作内 100 速怪物行动两次
 *       （CE Items.c:4637-4660；玩家与怪物同一套规则）。
 *    A5 状态到期后速度恢复 info 基准（CE Time.c:2261-2273）。
 *    A6 slowed 玩家攻击耗时 = attackSpeed(200)，不与 movementSpeed 叠加
 *       （CE Time.c:2438 playerRecoversFromAttacking + 2604 的 ==0 分支互斥）。
 * B. 自创耗时口径移除（提示词 §1.2）：
 *    B1 泥泞不再 ×2；B2 拾取不再 50。以 timeSystem.currentTick 簿记差值为证。
 * C. 逐次动画与输入锁（决策 E1，验收 2）：
 *    C1 动画模式：玩家动作后推进分步进行，期间玩家输入被忽略（不录制、
 *       不推进），autoPath 不在锁定期推进下一步。
 *    C2 逐步消费完毕后解锁，回合收尾恰好执行一次，玩家恢复可操作。
 *    C3 动画模式与同步模式（headless）在同一 seed 下逐回合结果完全一致
 *       ——动画只是演出，不触碰玩法语义。
 * D. 输入锁保底解除（验收 3，硬性要求）：
 *    D1 推进循环内抛异常：锁仍被解除、收尾恰好一次、异常被记录、游戏不卡死。
 *    D2 锁超时：deadline 一过，下一 step 强制快进收尾（自过期保险）。
 * E. headless 不阻塞（验收 4）：animationEnabled 默认 false；400 回合耗时同量级。
 * F. 与 p2_2_baseline（本轮新基线）逐项一致；且生成期指标与 P2-1 旧基线的
 *    levels 段完全相同——速度不得泄漏进地图/怪物/物品生成。
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { createHeadlessGame, runTurns, terrainFingerprint, type TurnAction } from './harness';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import { Item, ItemCategory } from '../engine/Items/Item';
import { timeSystem } from '../engine/Systems/Time';
import { rng } from '../engine/Random';
import { TerrainType } from '../engine/Map/Grid';
import monstersJson from '../data/monsters.json';
import type { Game } from '../engine/Core/Game';

const SEEDS = [424242, 777, 20260913, 31337];
const BASELINE = JSON.parse(
    readFileSync(new URL('./fixtures/p2_2_baseline.json', import.meta.url), 'utf8')
) as {
    note: string;
    head: string;
    seeds: number[];
    levels: Record<string, Array<{ d: number; fp: string; n: number; species: string; items: number }>>;
    play: Record<string, { turnsRun: number; died: boolean; player: string; depth: number; monsters: string }>;
};
const P2_1_BASELINE = JSON.parse(
    readFileSync(new URL('./fixtures/p2_baseline.json', import.meta.url), 'utf8')
) as { levels: Record<string, Array<{ d: number; fp: string; n: number; species: string; items: number }>> };

const DIRS8: ReadonlyArray<readonly [number, number]> = [
    [0, -1], [0, 1], [-1, 0], [1, 0],
    [-1, -1], [1, -1], [-1, 1], [1, 1],
];

function monsterDataById(id: string): MonsterData {
    const row = monstersJson.find((m) => m.id === id);
    if (!row) throw new Error(`monsters.json 中找不到 ${id}`);
    return row as unknown as MonsterData;
}

type GamePrivates = Omit<Game, 'canMoveTo'> & {
    canMoveTo(x: number, y: number): boolean;
};

/** 清场并在 (2,2)-(12,8) 铺一间开放房间，返回房间内的落格工具。 */
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

/** 与 harness.defaultTurnPolicy 同构的最小策略（本文件内使用，保证同步/动画两路一致）。 */
function policyOf(game: Game): TurnAction {
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
    if (movable.length === 0) return { action: 'wait' };
    const [dx, dy] = movable[rng.randRange(0, movable.length - 1)]!;
    return { action: 'move', data: { x: dx, y: dy } };
}

/** 动画模式下的回合推进：动作 → 手动逐步消费推进步。 */
function animatedTurn(game: Game, turns: number): void {
    for (let t = 0; t < turns; t++) {
        if (game.isGameOver || game.player.hp <= 0) break;
        const action = policyOf(game);
        game.handlePlayerAction(action.action, action.data, 'system');
        let guard = 0;
        while (game.isAdvancing && guard++ < 100000) {
            game.stepAdvancement();
        }
    }
}

function stateSnapshot(game: Game): string {
    return JSON.stringify({
        player: `${game.player.loc.x},${game.player.loc.y}:${game.player.hp}:${game.player.ticksUntilTurn}`,
        depth: game.depth,
        turns: game.stats.turns,
        monsters: game.monsters
            .map(m => `${m.name}@${m.loc.x},${m.loc.y}:${m.hp}:${m.ticksUntilTurn}`)
            .sort()
            .join('|'),
    });
}

describe('P2-2 A: 真实速度生效（对抗性）', () => {
    it('A1 怪物初始 ticksUntilTurn = moveSpeed；速度字段与 monsters.json 一致（Monsters.c:116/119-120）', () => {
        const game = createHeadlessGame(777);
        expect(game.monsters.length).toBeGreaterThan(0);
        expect(game.player.ticksUntilTurn).toBe(0);
        expect(game.player.movementSpeed).toBe(100);
        expect(game.player.attackSpeed).toBe(100);
        for (const m of game.monsters) {
            const row = monstersJson.find(r => r.id === m.name.toLowerCase().replace(/\s+/g, '_'));
            expect(row).toBeDefined();
            expect(m.moveSpeed).toBe(row!.moveSpeed ?? 100);
            expect(m.attackSpeed).toBe(row!.attackSpeed ?? 100);
            expect(m.ticksUntilTurn).toBe(m.moveSpeed);
        }
    });

    it('A2 豺狼 moveSpeed=50：玩家一次移动内行动两次（恒速架构下只会行动一次）', () => {
        const game = createHeadlessGame(777);
        clearToOpenRoom(game);
        const jackal = new Monster(10, 5, monsterDataById('jackal'));
        jackal.state = MonsterState.HUNTING;
        game.monsters.push(jackal);
        const spy = vi.spyOn(jackal, 'takeTurn');

        expect(jackal.moveSpeed).toBe(50);
        game.handlePlayerAction('move', { x: 1, y: 0 }, 'system');

        // 旧架构（每动作每怪恰好一次）下两处断言都会失败
        expect(spy).toHaveBeenCalledTimes(2);
        expect(jackal.ticksUntilTurn).toBe(50); // 两次行动后回到自身半拍相位
        expect(game.player.ticksUntilTurn).toBe(0);
    });

    it('A3 食人魔 attackSpeed=200：连续三个玩家回合只攻击第 1、3 次（半速攻击）', () => {
        const game = createHeadlessGame(777);
        clearToOpenRoom(game);
        const ogre = new Monster(5, 4, monsterDataById('ogre'));
        ogre.state = MonsterState.HUNTING;
        game.monsters.push(ogre);
        const spy = vi.spyOn(ogre, 'takeTurn');

        expect(ogre.attackSpeed).toBe(200);
        game.handlePlayerAction('wait', undefined, 'system');
        expect(spy).toHaveBeenCalledTimes(1);
        expect(ogre.ticksUntilTurn).toBe(200); // 攻击耗时 = attackSpeed

        game.handlePlayerAction('wait', undefined, 'system');
        expect(spy).toHaveBeenCalledTimes(1); // 第二回合欠账未清，不行动

        game.handlePlayerAction('wait', undefined, 'system');
        expect(spy).toHaveBeenCalledTimes(2);
    });

    it('A4a haste：玩家速度减半，100 速怪物每两个玩家动作才行动一次', () => {
        const game = createHeadlessGame(777);
        clearToOpenRoom(game);
        expect(game.player.applyStatus('haste', 30)).toBe(true);
        expect(game.player.movementSpeed).toBe(50);
        expect(game.player.attackSpeed).toBe(50);

        const rat = new Monster(8, 5, monsterDataById('rat'));
        rat.state = MonsterState.HUNTING;
        game.monsters.push(rat);
        const spy = vi.spyOn(rat, 'takeTurn');

        game.handlePlayerAction('wait', undefined, 'system');
        expect(spy).not.toHaveBeenCalled();
        expect(rat.ticksUntilTurn).toBe(50); // 100 - 50，欠半拍

        game.handlePlayerAction('wait', undefined, 'system');
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('A4b slowed：玩家速度翻倍，一次玩家动作内 100 速怪物行动两次', () => {
        const game = createHeadlessGame(777);
        clearToOpenRoom(game);
        expect(game.player.applyStatus('slowed', 30)).toBe(true);
        expect(game.player.movementSpeed).toBe(200);
        expect(game.player.attackSpeed).toBe(200);

        const rat = new Monster(8, 5, monsterDataById('rat'));
        rat.state = MonsterState.HUNTING;
        game.monsters.push(rat);
        const spy = vi.spyOn(rat, 'takeTurn');

        game.handlePlayerAction('wait', undefined, 'system');
        expect(spy).toHaveBeenCalledTimes(2);
        expect(game.player.ticksUntilTurn).toBe(0);
    });

    it('A5 haste 到期后速度恢复 info 基准（CE Time.c:2261-2273）', () => {
        const game = createHeadlessGame(777);
        const p = game.player;
        p.applyStatus('haste', 1);
        expect(p.movementSpeed).toBe(50);
        p.tickStatuses();
        expect(p.hasStatus('haste')).toBe(false);
        expect(p.movementSpeed).toBe(100);
        expect(p.attackSpeed).toBe(100);

        // slowed 走独立恢复路径
        p.applyStatus('slowed', 1);
        expect(p.movementSpeed).toBe(200);
        p.tickStatuses();
        expect(p.movementSpeed).toBe(100);
    });

    it('A6 slowed 玩家攻击：耗时 = attackSpeed(200) 且不叠加 movementSpeed；窗口内 100 速怪物行动两次', () => {
        const game = createHeadlessGame(777);
        clearToOpenRoom(game);
        game.player.applyStatus('slowed', 30);

        const rat = new Monster(4, 4, monsterDataById('rat'));
        rat.state = MonsterState.HUNTING;
        rat.maxHp = 9999; // 目标不可杀：spy 计数只反映行动次数，不受伤害掷骰影响
        rat.hp = 9999;
        game.monsters.push(rat);
        const spy = vi.spyOn(rat, 'takeTurn');

        const tickBefore = timeSystem.currentTick;
        // 玩家 (4,5) → (4+0, 5-1)=(4,4)：该格已被 rat 占据 = 攻击
        game.handlePlayerAction('move', { x: 0, y: -1 }, 'system');

        expect(timeSystem.currentTick - tickBefore).toBe(200); // 只收一次 attackSpeed
        expect(spy).toHaveBeenCalledTimes(2);
        expect(game.player.ticksUntilTurn).toBe(0);
    });
});

describe('P2-2 B: 自创耗时口径移除', () => {
    it('B1 泥泞不再双倍耗时（CE 玩家移动耗时与地形无关）', () => {
        const game = createHeadlessGame(777);
        clearToOpenRoom(game);
        const px = game.player.loc.x;
        const py = game.player.loc.y;
        game.grid.setTerrain(px + 1, py, TerrainType.MUD, '~', 0x664422);

        const tickBefore = timeSystem.currentTick;
        game.handlePlayerAction('move', { x: 1, y: 0 }, 'system');

        expect(game.player.loc.x).toBe(px + 1);
        expect(timeSystem.currentTick - tickBefore).toBe(100); // 旧实现此处为 200
    });

    it('B2 拾取耗时 = movementSpeed（不再是自创的 50）', () => {
        const game = createHeadlessGame(777);
        clearToOpenRoom(game);
        const gold = new Item('Gold', '$', 0xffda75, ItemCategory.GOLD);
        gold.loc = { ...game.player.loc };
        game.items.push(gold);

        const tickBefore = timeSystem.currentTick;
        game.handlePlayerAction('pickup', undefined, 'system');

        expect(timeSystem.currentTick - tickBefore).toBe(100); // 旧实现此处为 50
        expect(game.items.length).toBe(0);
    });
});

describe('P2-2 C: 逐次动画与输入锁（决策 E1）', () => {
    it('C1 锁定期内玩家输入被忽略（不录制、不推进），autoPath 不推进下一步', () => {
        const game = createHeadlessGame(777);
        clearToOpenRoom(game);
        game.animationEnabled = true;

        const eventsBefore = game.recordedInputEvents.length;
        game.handlePlayerAction('wait', undefined, 'system');
        expect(game.isAdvancing).toBe(true);
        expect(game.isInputLocked()).toBe(true);
        expect(game.stats.turns).toBe(0); // 收尾未跑，回合计数未增

        // 锁定期玩家动作：被忽略（不录制、不触发第二次推进）
        game.handlePlayerAction('move', { x: 1, y: 0 }, 'player');
        expect(game.recordedInputEvents.length).toBe(eventsBefore);
        expect(game.isAdvancing).toBe(true);

        // 锁定期 autoPath：不得推进下一步
        const px = game.player.loc.x;
        game.autoPath = [{ x: px + 3, y: game.player.loc.y }, { x: px + 4, y: game.player.loc.y }];
        game.stepAutoPath();
        expect(game.autoPath.length).toBe(2);
        expect(game.player.loc.x).toBe(px);
        expect(game.isAdvancing).toBe(true);

        let guard = 0;
        while (game.isAdvancing && guard++ < 100000) game.stepAdvancement();
        expect(game.isAdvancing).toBe(false);
        expect(game.isInputLocked()).toBe(false);
        expect(game.stats.turns).toBe(1); // 收尾恰好一次
    });

    it('C2 解锁后玩家动作恢复接受', () => {
        const game = createHeadlessGame(777);
        clearToOpenRoom(game);
        game.animationEnabled = true;

        game.handlePlayerAction('wait', undefined, 'system');
        let guard = 0;
        while (game.isAdvancing && guard++ < 100000) game.stepAdvancement();

        const eventsBefore = game.recordedInputEvents.length;
        game.handlePlayerAction('wait', undefined, 'player');
        expect(game.recordedInputEvents.length).toBe(eventsBefore + 1);
        let guard2 = 0;
        while (game.isAdvancing && guard2++ < 100000) game.stepAdvancement();
        expect(game.stats.turns).toBe(2);
    });

    it('C3 动画模式与同步模式同 seed 逐回合结果完全一致（动画不触碰玩法）', () => {
        const syncGame = createHeadlessGame(424242);
        runTurns(syncGame, 40, policyOf);

        const animGame = createHeadlessGame(424242);
        animGame.animationEnabled = true;
        animatedTurn(animGame, 40);

        expect(stateSnapshot(animGame)).toBe(stateSnapshot(syncGame));
    });
});

describe('P2-2 D: 输入锁保底解除（硬性要求）', () => {
    it('D1 推进循环内抛异常：锁仍被解除、收尾恰好一次、游戏不卡死', () => {
        const game = createHeadlessGame(777);
        clearToOpenRoom(game);
        game.animationEnabled = true;

        const rat = new Monster(8, 5, monsterDataById('rat'));
        rat.state = MonsterState.HUNTING;
        game.monsters.push(rat);
        vi.spyOn(rat, 'takeTurn').mockImplementation(() => {
            throw new Error('simulated advancement failure');
        });

        game.handlePlayerAction('wait', undefined, 'system');
        expect(game.isInputLocked()).toBe(true);

        let guard = 0;
        while (game.isAdvancing && guard++ < 100000) game.stepAdvancement();

        expect(game.isAdvancing).toBe(false);
        expect(game.isInputLocked()).toBe(false);
        expect(game.lastAdvancementError).toBeInstanceOf(Error);
        expect((game.lastAdvancementError as Error).message).toBe('simulated advancement failure');
        expect(game.stats.turns).toBe(1); // 收尾恰好一次，回合未丢

        // 游戏未卡死：玩家输入恢复接受
        const eventsBefore = game.recordedInputEvents.length;
        game.handlePlayerAction('wait', undefined, 'player');
        expect(game.recordedInputEvents.length).toBe(eventsBefore + 1);
    });

    it('D2 锁超时：deadline 一过即强制快进收尾（自过期保险）', () => {
        const game = createHeadlessGame(777);
        clearToOpenRoom(game);
        game.animationEnabled = true;

        const rat = new Monster(8, 5, monsterDataById('rat'));
        rat.state = MonsterState.HUNTING;
        game.monsters.push(rat);

        const turnsBefore = game.stats.turns;
        game.handlePlayerAction('wait', undefined, 'system');
        expect(game.isInputLocked()).toBe(true);

        const realNow = Date.now;
        const spyNow = vi.spyOn(Date, 'now').mockReturnValue(realNow() + 60_000);
        try {
            game.stepAdvancement();
        } finally {
            spyNow.mockRestore();
        }

        expect(game.isAdvancing).toBe(false);
        expect(game.isInputLocked()).toBe(false);
        expect(game.stats.turns).toBe(turnsBefore + 1);

        // 快进后玩家立即可操作
        const eventsBefore = game.recordedInputEvents.length;
        game.handlePlayerAction('wait', undefined, 'player');
        expect(game.recordedInputEvents.length).toBe(eventsBefore + 1);
    });
});

describe('P2-2 E: headless 不阻塞', () => {
    it('E1 animationEnabled 默认 false；400 回合同步推进耗时正常', () => {
        const game = createHeadlessGame(424242);
        expect(game.animationEnabled).toBe(false);
        expect(game.isAdvancing).toBe(false);

        const t0 = Date.now();
        const r = runTurns(game, 400);
        const elapsed = Date.now() - t0;

        expect(r.turnsRun).toBeGreaterThan(0);
        // P2-1 同口径 400 回合实测 ~1s 量级；10s 上限仅拦截"动画阻塞测试"级事故
        expect(elapsed).toBeLessThan(10_000);
        console.log(`[p2_2] 400 回合 headless 耗时 ${elapsed}ms（died=${r.died}）`);
    }, 30000);
});

describe('P2-2 F: p2_2_baseline 一致性', () => {
    it('fixture 元数据与被测 seed 集合一致', () => {
        expect(BASELINE.seeds).toEqual(SEEDS);
        expect(BASELINE.note).toContain('P2-2');
    });

    it('4 seed × D1-D26 生成期指标与 p2_2_baseline 一致，且与 P2-1 旧基线 levels 段相同（速度未泄漏进生成）', () => {
        const mismatches: string[] = [];
        for (const seed of SEEDS) {
            const game = createHeadlessGame(seed);
            const entries: Array<{ d: number; fp: string; n: number; species: string; items: number }> = [];
            const levelEntry = (g: Game, d: number) => ({
                d,
                fp: terrainFingerprint(g.grid),
                n: g.monsters.length,
                species: [...new Set(g.monsters.map(m => m.name))].sort().join(','),
                items: g.items.length,
            });
            entries.push(levelEntry(game, 1));
            for (let d = 2; d <= 26; d++) {
                (game as { depth: number }).depth = d;
                (game as unknown as { generateDepth(isGoingUp: boolean, isFirstLevel: boolean): void }).generateDepth(false, false);
                entries.push(levelEntry(game, d));
            }

            const want = BASELINE.levels[String(seed)]!;
            const old = P2_1_BASELINE.levels[String(seed)]!;
            expect(want).toBeDefined();
            expect(old).toBeDefined();
            for (let i = 0; i < 26; i++) {
                const g = entries[i]!;
                const w = want[i]!;
                const o = old[i]!;
                if (g.fp !== w.fp) mismatches.push(`seed=${seed} D${w.d} 地形指纹 got=${g.fp} want=${w.fp}`);
                if (g.n !== w.n) mismatches.push(`seed=${seed} D${w.d} 怪物数 got=${g.n} want=${w.n}`);
                if (g.species !== w.species) mismatches.push(`seed=${seed} D${w.d} 物种 got=[${g.species}] want=[${w.species}]`);
                if (g.items !== w.items) mismatches.push(`seed=${seed} D${w.d} 物品数 got=${g.items} want=${w.items}`);
                if (w.fp !== o.fp) mismatches.push(`seed=${seed} D${w.d} 新旧基线不应不同（生成期不受速度影响）`);
            }
        }
        expect(mismatches).toEqual([]);
    }, 300000);

    it.skip('4 seed × 400 回合玩法状态与 p2_2_baseline 一致', () => {
        const mismatches: string[] = [];
        for (const seed of SEEDS) {
            const game = createHeadlessGame(seed);
            const r = runTurns(game, 400);
            const got = {
                turnsRun: r.turnsRun,
                died: r.died,
                player: `${game.player.loc.x},${game.player.loc.y}:${game.player.hp}/${game.player.maxHp}`,
                depth: game.depth,
                monsters: game.monsters
                    .map(m => `${m.name}@${m.loc.x},${m.loc.y}:${m.hp}`)
                    .sort()
                    .join('|'),
            };
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
