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
/// <reference types="node" />
/**
 * src/test/p2_3_objective_time.test.ts — P2-3：客观时间块 + 完整回合修正
 *
 * A. 客观时间生效（验收 1，本轮最核心的对抗性断言）：
 *    A1 haste（玩家 50 tick/动作）连续两次动作，客观块只触发一次——
 *       营养只 -1、门先剩 50 再回到 100。"仍按玩家动作计"的错误实现
 *       会在两次动作后营养 -2 / 门从不走进 [50→0] 的轨迹。
 *    A2 slowed（200 tick/动作）一次动作，客观块触发两次——营养 -2。
 * B. 主观/客观分离（验收 2；按 CE 修正后的口径）：
 *    提示词验收 2 原文断言"饥饿在 haste 下按玩家动作数递减"，
 *    与 CE 冲突（Time.c:2213-2220 营养递减在 decrementPlayerStatus 内、
 *    只被客观块调用；Time.c:2848 注释佐证）——按项目常识 §5.4 以 CE 为准，
 *    本节断言：饥饿客观（随 tick）、回血与饥饿伤害主观（随玩家动作）、
 *    怪物状态客观（随 tick）。
 *    B1 haste 下两次动作：回血两次（主观），营养 -1（客观）。
 *    B2 haste 下两次动作：饥饿伤害 -2/动作（主观），不随客观块次数减半。
 *    B3 怪物状态按 tick 递减：haste 两动作 -1；slowed 一动作 -2。
 * C. spawnFuse 按 100 tick 递减（验收 3）：
 *    C1 haste 两次动作只递减一次（旧实现递减两次）。
 *    C2 slowed 一次动作递减两次并触发周期刷怪（旧实现只递减一次不触发）。
 * D. 完整回合修正（验收 4）：
 *    D1 quaff/read/eat/equip/unequip/drop/throw 每个动作后怪物确实行动
 *       （预先把怪物 ticksUntilTurn 压到 1，行动后必然被重置为 movementSpeed，
 *       "不触发回合结束"的错误实现下怪物保持 1 不动）。耗时为 movementSpeed。
 *    D2 楼梯不消耗回合（CE useStairs 无 playerTurnEnded，Movement.c:2508 起），
 *       但换层触发 synchronizePlayerTimeState（CE RogueMain.c:562）。
 * E. 状态到期同步：haste 在客观块内到期时，门被 synchronizePlayerTimeState
 *    对齐到玩家剩余 tick（CE Time.c:2261-2273）。
 * F. p2_3_baseline 一致性：levels 段与 P2-1/P2-2 基线完全相同（本轮不触碰
 *    生成期），play 段记录本轮之后的玩法状态。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

import { createHeadlessGame, runTurns, terrainFingerprint } from './harness';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { ItemCategory } from '../engine/Items/Item';
import { timeSystem } from '../engine/Systems/Time';
import { TerrainType } from '../engine/Map/Grid';
import monstersJson from '../data/monsters.json';
import type { Game } from '../engine/Core/Game';

const BASELINE = JSON.parse(
    readFileSync(new URL('./fixtures/p2_3_baseline.json', import.meta.url), 'utf8')
) as {
    note: string;
    head: string;
    seeds: number[];
    levels: Record<string, Array<{ d: number; fp: string; n: number; species: string; items: number }>>;
    play: Record<string, { turnsRun: number; died: boolean; player: string; depth: number; monsters: string }>;
};
const P2_2_BASELINE = JSON.parse(
    readFileSync(new URL('./fixtures/p2_2_baseline.json', import.meta.url), 'utf8')
) as { levels: Record<string, Array<{ d: number; fp: string; n: number; species: string; items: number }>> };
const P2_1_BASELINE = JSON.parse(
    readFileSync(new URL('./fixtures/p2_baseline.json', import.meta.url), 'utf8')
) as { levels: Record<string, Array<{ d: number; fp: string; n: number; species: string; items: number }>> };

const SEEDS = [424242, 777, 20260913, 31337];

function monsterDataById(id: string): MonsterData {
    const row = monstersJson.find((m) => m.id === id);
    if (!row) throw new Error(`monsters.json 中找不到 ${id}`);
    return row as unknown as MonsterData;
}

/** test 模式：开阔大厅、无怪物、无周期刷怪——时间语义测试的干净底座。 */
function createTimedGame(seed = 20260914): Game {
    const game = createHeadlessGame(seed, 'test');
    game.player.nutrition = 1000; // 远离阈值，档位迁移不干扰断言
    return game;
}

function waitOnce(game: Game): void {
    game.handlePlayerAction('wait', undefined, 'system');
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('P2-3 A: 客观时间生效（对抗性核心）', () => {
    it('A1 haste 下连续两次动作，客观块只触发一次（营养 -1；门 100→50→100）', () => {
        const game = createTimedGame();
        game.player.applyStatus('haste', 30);
        game.player.refreshSpeeds();
        expect(game.player.movementSpeed).toBe(50);

        waitOnce(game);
        // 第一个动作（50 tick）不足以耗尽 100 tick 的门：客观块未触发
        expect(game.ticksTillUpdateEnvironment).toBe(50);
        expect(game.player.nutrition).toBe(1000);

        waitOnce(game);
        // 第二个动作补满 100 tick：客观块恰好一次，营养只 -1
        expect(game.ticksTillUpdateEnvironment).toBe(100);
        expect(game.player.nutrition).toBe(999);
    });

    it('A2 slowed 下一次动作，客观块触发两次（营养 -2；门回到 100）', () => {
        const game = createTimedGame();
        game.player.applyStatus('slowed', 30);
        game.player.refreshSpeeds();
        expect(game.player.movementSpeed).toBe(200);

        waitOnce(game);
        expect(game.ticksTillUpdateEnvironment).toBe(100);
        expect(game.player.nutrition).toBe(998);
    });
});

describe('P2-3 B: 主观/客观分离', () => {
    it('B1 回血主观（haste 两动作回血两次），营养客观（同条件下只 -1）', () => {
        const game = createTimedGame();
        game.player.maxHp = 3000; // 回血速率 = maxHp/300 = 10/动作
        game.player.hp = 2980;
        game.player.applyStatus('haste', 30);
        game.player.refreshSpeeds();

        waitOnce(game);
        waitOnce(game);

        // 主观：每动作回 10，两动作 +20（若错误地挂进客观块则只 +10）
        expect(game.player.hp).toBe(3000);
        // 客观：营养只随 100 tick 消耗
        expect(game.player.nutrition).toBe(999);
    });

    it('B2 饥饿伤害主观：haste 下每动作 -1 HP（两次动作 -2），不随客观块减半', () => {
        const game = createTimedGame();
        // CE Time.c:949-963 会先自动吃包内食物；此用例只验证无食物的扣血链。
        game.player.inventory.items = game.player.inventory.items.filter(i => i.category !== ItemCategory.FOOD);
        game.player.nutrition = 0;
        game.player.hp = 100;
        game.player.applyStatus('haste', 30);
        game.player.refreshSpeeds();

        waitOnce(game);
        waitOnce(game);

        // CE Time.c:2523-2529：营养耗尽时每玩家动作 -1 HP（do 循环段）
        expect(game.player.hp).toBe(98);
    });

    it('B3 怪物状态按 tick 递减：haste 两动作 -1，slowed 一动作 -2', () => {
        const placeMonster = (g: Game) => {
            const mon = new Monster(6, 5, monsterDataById('rat'));
            mon.state = MonsterState.HUNTING;
            mon.hp = 999;
            mon.applyStatus('paralyzed', 10);
            g.monsters.push(mon);
            return mon;
        };

        const game = createTimedGame();
        game.player.applyStatus('haste', 30);
        game.player.refreshSpeeds();
        const m1 = placeMonster(game);
        waitOnce(game);
        waitOnce(game);
        expect(m1.getStatusDuration('paralyzed')).toBe(9);

        const game2 = createTimedGame();
        game2.player.applyStatus('slowed', 30);
        game2.player.refreshSpeeds();
        const m2 = placeMonster(game2);
        waitOnce(game2);
        expect(m2.getStatusDuration('paralyzed')).toBe(8);
    });
});

describe('P2-3 C: spawnFuse 按 100 tick 递减', () => {
    it('C1 haste 两次动作只递减一次（fuse 5→4），不触发刷怪', () => {
        const game = createHeadlessGame(20260914, 'normal');
        const spy = vi.spyOn(game, 'spawnPeriodicHorde');
        game.monsterSpawnFuse = 5;
        game.player.applyStatus('haste', 30);
        game.player.refreshSpeeds();

        waitOnce(game);
        waitOnce(game);

        expect(game.monsterSpawnFuse).toBe(4);
        expect(spy).not.toHaveBeenCalled();
    });

    it('C2 slowed 一次动作递减两次（fuse 2→0）并触发一次周期刷怪', () => {
        const game = createHeadlessGame(20260914, 'normal');
        const spy = vi.spyOn(game, 'spawnPeriodicHorde');
        game.monsterSpawnFuse = 2;
        game.player.applyStatus('slowed', 30);
        game.player.refreshSpeeds();

        waitOnce(game);

        expect(spy).toHaveBeenCalledTimes(1);
        // 触发后重置为 rand_range(125, 175)（Time.c:2324）
        expect(game.monsterSpawnFuse).toBeGreaterThanOrEqual(125);
        expect(game.monsterSpawnFuse).toBeLessThanOrEqual(175);
    });
});

describe('P2-3 D: 完整回合修正（花时间的动作怪物必须行动）', () => {
    /** 注入一只大厅内的 100 速猎手，并 spy 其 takeTurn：
     *  动作若真触发回合结束，推进循环必然让它在窗口内行动（恰好一次）；
     *  "只加 currentTick 不触发回合结束"的错误实现下 takeTurn 一次都不会被调。 */
    function primedRat(game: Game): { mon: Monster; tookTurn: () => number } {
        const mon = new Monster(6, 5, monsterDataById('rat'));
        mon.state = MonsterState.HUNTING;
        mon.hp = 999;
        mon.ticksUntilTurn = 1;
        game.monsters.push(mon);
        const spy = vi.spyOn(mon, 'takeTurn');
        return { mon, tookTurn: () => spy.mock.calls.length };
    }

    function expectFullTurn(game: Game, rat: { mon: Monster; tookTurn: () => number }, tickBefore: number): void {
        // 玩家不再欠 tick；怪物在窗口内恰好行动一次；耗时 = movementSpeed
        expect(game.player.ticksUntilTurn).toBe(0);
        expect(rat.tookTurn()).toBe(1);
        expect(timeSystem.currentTick - tickBefore).toBe(game.player.movementSpeed);
    }

    it('D1a quaff 是完整回合（CE Items.c:7633 apply → playerTurnEnded）', () => {
        const game = createTimedGame();
        const rat = primedRat(game);
        const potion = ItemLoader.spawnPotion('potion_of_healing', -1, -1)!;
        game.player.inventory.addItem(potion);

        const tickBefore = timeSystem.currentTick;
        game.quaffItem(potion);
        expectFullTurn(game, rat, tickBefore);
    });

    it('D1b read 是完整回合（CE Items.c:7633 apply → playerTurnEnded）', () => {
        const game = createTimedGame();
        const rat = primedRat(game);
        const scroll = ItemLoader.spawnScroll('scroll_of_identify', -1, -1)!;
        game.player.inventory.addItem(scroll);

        const tickBefore = timeSystem.currentTick;
        game.readItem(scroll);
        expectFullTurn(game, rat, tickBefore);
    });

    it('D1c eat 是完整回合（CE Items.c:7633 apply → playerTurnEnded）', () => {
        const game = createTimedGame();
        const rat = primedRat(game);
        const food = ItemLoader.spawnFood('ration_of_food', -1, -1)!;
        game.player.inventory.addItem(food);

        const tickBefore = timeSystem.currentTick;
        game.eatItem(food);
        expectFullTurn(game, rat, tickBefore);
    });

    it('D1d equip 是完整回合（CE Items.c:4024 equip → playerTurnEnded）', () => {
        const game = createTimedGame();
        const rat = primedRat(game);
        const sword = ItemLoader.spawnWeapon('sword', -1, -1)!;
        sword.enchantment = 0;
        sword.isCursed = false;
        game.player.inventory.addItem(sword);

        const tickBefore = timeSystem.currentTick;
        game.equipItem(sword);
        expectFullTurn(game, rat, tickBefore);
    });

    it('D1e unequip 是完整回合（CE Items.c:8349 unequipItem → playerTurnEnded）', () => {
        const game = createTimedGame();
        const rat = primedRat(game);
        const dagger = game.player.equippedWeapon!;
        expect(dagger).not.toBeNull();

        const tickBefore = timeSystem.currentTick;
        game.unequipItem(dagger);
        expectFullTurn(game, rat, tickBefore);
    });

    it('D1f drop 是完整回合（CE Items.c:8390 drop → playerTurnEnded）', () => {
        const game = createTimedGame();
        const rat = primedRat(game);
        const dart = ItemLoader.spawnWeapon('dart', -1, -1)!;
        dart.quantity = 5;
        game.player.inventory.addItem(dart);

        const tickBefore = timeSystem.currentTick;
        game.dropItem(dart);
        expectFullTurn(game, rat, tickBefore);
    });

    it('D1g throw 是完整回合（CE Items.c:7173 throwItem → playerTurnEnded）', () => {
        const game = createTimedGame();
        const rat = primedRat(game);
        const dart = ItemLoader.spawnWeapon('dart', -1, -1)!;
        dart.quantity = 5;
        game.player.inventory.addItem(dart);

        const tickBefore = timeSystem.currentTick;
        game.throwItemAt(dart, 6, 5);
        expectFullTurn(game, rat, tickBefore);
    });

    it('D2 楼梯不消耗回合（CE useStairs 无 playerTurnEnded），但换层同步客观门', () => {
        const game = createHeadlessGame(20260914, 'normal');
        game.grid.setTerrain(game.player.loc.x, game.player.loc.y, TerrainType.STAIRS_DOWN, '>', 0x00aaff);

        game.handlePlayerAction('stairs_down', undefined, 'system');
        expect(game.depth).toBe(2);
        // 换层后玩家不欠 tick；门被 synchronizePlayerTimeState 对齐到玩家剩余 tick
        expect(game.player.ticksUntilTurn).toBe(0);
        expect(game.ticksTillUpdateEnvironment).toBe(game.player.ticksUntilTurn);
    });
});

describe('P2-3 E: 状态到期时的客观门同步（CE Time.c:2261-2273）', () => {
    it('haste 在客观块内到期后，门对齐玩家剩余 tick（而非机械 +100）', () => {
        const game = createTimedGame();
        game.player.applyStatus('haste', 1); // 一次客观块后到期
        game.player.refreshSpeeds();

        waitOnce(game); // 50 tick，门 100→50，未触发
        expect(game.ticksTillUpdateEnvironment).toBe(50);
        waitOnce(game); // 再 50 tick：门触发；块内 haste 到期 → sync(门=玩家剩余 50)
        expect(game.player.hasStatus('haste')).toBe(false);
        expect(game.ticksTillUpdateEnvironment).toBe(50);
        expect(game.player.movementSpeed).toBe(100);
    });
});

describe('P2-3 F: p2_3_baseline 一致性', () => {
    it('fixture 元数据与被测 seed 集合一致', () => {
        expect(BASELINE.seeds).toEqual(SEEDS);
        expect(BASELINE.note).toContain('P2-3');
    });

    it.skip('4 seed × D1-D26 生成期指标与 p2_3_baseline 一致，且与 P2-1/P2-2 旧基线 levels 段相同（本轮不触碰生成）', () => {
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
            const p2_2 = P2_2_BASELINE.levels[String(seed)]!;
            const p2_1 = P2_1_BASELINE.levels[String(seed)]!;
            for (let i = 0; i < 26; i++) {
                const g = entries[i]!;
                if (g.fp !== want[i]!.fp) mismatches.push(`seed=${seed} D${want[i]!.d} 地形指纹 got=${g.fp} want=${want[i]!.fp}`);
                if (g.n !== want[i]!.n) mismatches.push(`seed=${seed} D${want[i]!.d} 怪物数 got=${g.n} want=${want[i]!.n}`);
                if (g.species !== want[i]!.species) mismatches.push(`seed=${seed} D${want[i]!.d} 物种 got=[${g.species}] want=[${want[i]!.species}]`);
                if (g.items !== want[i]!.items) mismatches.push(`seed=${seed} D${want[i]!.d} 物品数 got=${g.items} want=${want[i]!.items}`);
                if (JSON.stringify(g) !== JSON.stringify(p2_2[i])) mismatches.push(`seed=${seed} D${want[i]!.d} 与 P2-2 基线生成期指标不同（本轮不应触碰生成）`);
                if (JSON.stringify(g) !== JSON.stringify(p2_1[i])) mismatches.push(`seed=${seed} D${want[i]!.d} 与 P2-1 基线生成期指标不同（本轮不应触碰生成）`);
            }
        }
        expect(mismatches).toEqual([]);
    }, 300000);

    /**
     * ★ P1-26（2026-09-15）退役本断言——为何 skip：
     *
     * 它逐字比对 400 回合后的玩家坐标/HP/深度/每只怪物@坐标:血量，
     * 是一份"相位快照"。作为**当时**（P2-3）的基准记录它有效，但作为
     * 永久回归闸门它是错的：任何**有意的**玩法行为改动都必然打红它——
     * P4-8（气味追踪 + stealthRange + 3% 掷骰）已经打红过一次，只能由
     * 验收方授权重捕获；P4-9（safety map）/P4-10（waypoint）乃至 Phase C
     * 每一步都注定再撞。它抓不出真回归（每次都"预期会变"），只会制造
     * "顺手刷新基线"的压力，训练所有人把红灯当背景音——这与上方
     * levels 段的退役是同一个毛病。
     *
     * 生成与玩法的持续回归检测改由不依赖坐标的不变量承担：
     * src/test/p1_26_invariants.test.ts（5 种子 × D1-D26 的楼梯存在性、
     * 上下楼梯连通、可走格占比、生成不抛异常、同种子决定性），
     * 以及 generation_baseline.test.ts 的滚动基线。
     *
     * 用例体保留不删：fixture p2_3_baseline.json 的 play 段仍被它引用，
     * 且它仍是 P2-3 阶段"当时玩法状态"的可查证据（与 levels 段同待遇）。
     */
    it.skip('4 seed × 400 回合玩法状态与 p2_3_baseline 一致（本轮后的新基准）——P1-26 退役：相位快照当回归闸门会拦住一切有意改动，见上方注释', () => {
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
