/// <reference types="node" />
/**
 * src/test/ai_1_scent_tracking.test.ts — AI-1：气味追击的诊断钉与两条放弃路径判别式。
 *
 * P1-52 结案背景（详见 ai_docs/ai_1_report.md）：T5 场景约 10% 的追击成功率
 * 不是 web 缺陷的主体——CE 在同场景同样追不上（玩家 wait → justRested →
 * stealthRange 4 → awareness 8 → 截断 24，而气味几何决定 perceived 每步 +1、
 * 第 6 步必撞截断，CE Monsters.c:1669-1670 + Time.c:813-815）。web 曾有的
 * 两处真实偏差已在本轮修复：
 *   F1 门回弹（Game.ts）：CE Time.c:2695→2698 的顺序是先 updateEnvironment
 *      （OPEN_DOOR promoteChance=10000 关回，Globals.c:329）、后
 *      applyInstantTileEffectsToCreature(&player)（玩家所站格
 *      TM_PROMOTES_ON_CREATURE 再开）——玩家站门上时门净状态=开、走开后
 *      门在身后关上。web 此前唯一开门点在移动分支、先于环境晋升，门被
 *      同回合回弹。修复=客观块晋升段后补玩家所站格 promoteOnStep。
 *   F2 派生位残留（Grid.ts）：promote 链走 setTerrainLayer（只写层），
 *      isOpaque 残留 DOOR 的 true → obstructsScent 把开着的门继续当遮挡物、
 *      updateScent 掩码穿不过门洞。修复=setTerrainLayer 内随层写重算。
 *
 * 本文件四组断言：
 *   A 气味时序钉值（决定性）：修后 T5 场景的气味图与 CE 时序手推逐位一致
 *     （1013..1023,1029,1031,1033）；踩门回合末门开、走完后门关（CE 原味）。
 *   B 两条放弃路径判别式：同一几何下，感知新旧决定 HUNTING→WANDERING 走
 *     哪条 CE 路径——①气味死路（Monsters.c:3475-3484：零感知骰、零位移、
 *     局部最大+不可见）vs ②感知丢失（awareOfTarget 硬截断/3% 骰，经
 *     updateMonsterState Monsters.c:1776-1779）。
 *   C awareOfTarget 的掷骰判别式（RNG 计数，确定性）：哪些分支消耗随机数、
 *     哪些不消耗（CE rand_percent 短路语义）。
 *   D 对抗断言：门洞气味值是 F1/F2 的死指数——回弹或残留任一复发即翻红。
 *
 * 对抗性与反向验证记录见 ai_docs/ai_1_report.md §对抗性测试（本轮执行了
 * 三条真实改坏 → 贴失败输出 → 还原）。
 */
import { describe, it, expect } from 'vitest';

import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { Monster, MonsterState } from '../entities/Monster';
import { TerrainType } from '../engine/Map/Grid';
import { rng } from '../engine/Random';
import monstersJson from '../data/monsters.json';

const CARVE = { x1: 30, y1: 4, x2: 74, y2: 26 } as const;

function monsterDataById(id: string): never {
    const row = monstersJson.find((m) => m.id === id);
    if (!row) throw new Error(`monsters.json 中找不到 ${id}`);
    return row as never;
}

/** T5 同款底座：纯花岗岩区刻房间 + 一道带门的墙。 */
function createChaseGame(seed = 20260915): Game {
    const game = createHeadlessGame(seed, 'test');
    game.monsters = [];
    game.items = [];
    for (let x = CARVE.x1; x <= CARVE.x2; x++) {
        for (let y = CARVE.y1; y <= CARVE.y2; y++) {
            game.grid.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
        }
    }
    for (let y: number = CARVE.y1; y <= CARVE.y2; y++) {
        if (y !== 15) game.grid.setTerrain(52, y, TerrainType.WALL, '#', 0x555555);
    }
    game.grid.setTerrain(52, 15, TerrainType.DOOR, '+', 0xcc9933);
    return game;
}

function teleportPlayer(game: Game, x: number, y: number): void {
    game.player.loc.x = x;
    game.player.loc.y = y;
    game.fov.computeFOV(x, y, 10);
}

function spawnRat(game: Game, x: number, y: number): Monster {
    const mon = new Monster(x, y, monsterDataById('rat'));
    mon.state = MonsterState.HUNTING;
    game.monsters.push(mon);
    return mon;
}

function waitOnce(game: Game): void {
    game.handlePlayerAction('wait', undefined, 'system');
}

function moveOnce(game: Game, dx: number, dy: number): void {
    game.handlePlayerAction('move', { x: dx, y: dy }, 'system');
}

describe('AI-1 A: 门洞气味时序钉值（F1/F2 修复的决定性证据，与 seed 无关）', () => {
    it('A1 玩家穿门后西侧气味 = CE 时序手推值 1013..1023；踩门回合末门开、走完后门关', () => {
        const game = createChaseGame(20260915);
        teleportPlayer(game, 44, 15);
        for (let i = 0; i < 10; i++) {
            moveOnce(game, 1, 0);
            if (i === 7) {
                // 第 8 步踩门：回合末（客观块晋升关门之后）玩家所站格的
                // TM_PROMOTES_ON_CREATURE 晋升把门再次打开（CE Time.c:2698）。
                // F1 回弹的错误实现下这里是 DOOR。
                expect(game.grid.getCell(52, 15)!.terrain,
                    '踩门回合结束时门应保持开着（CE Time.c:2695→2698 顺序）')
                    .toBe(TerrainType.OPEN_DOOR);
            }
        }
        // 玩家已离开：门在身后自动关上（OPEN_DOOR promoteChance=10000，
        // Globals.c:329）——CE 原味，不是缺陷。
        expect(game.grid.getCell(52, 15)!.terrain).toBe(TerrainType.DOOR);
        waitOnce(game);

        // 气味图钉值。时序推演（CE 对齐）：步 1..7 门未开，西侧各格收到
        // 当轮章；步 8 玩家踩门（updateScent 时门还关着，原点=门格）；
        // 步 9 玩家在 (53,15) 时门是开的（步 8 末 F1 补丁重开）→ 掩码穿门，
        // 西侧全部 +1 刷新；步 10 与 wait 轮门已关，西侧冻结。
        //   西侧 (46..51,15) = 1013,1015,1017,1019,1021,1023
        //   门格 (52,15)     = 1033-4 = 1029（wait 轮从 (54,15) 直视门面）
        //   东侧 (53,54,15)  = 1031, 1033
        // F2（isOpaque 残留）未修时步 9 穿不过门洞 → 西侧 = 1012..1022，翻红。
        const expected = [1013, 1015, 1017, 1019, 1021, 1023, 1029, 1031, 1033];
        const actual = Array.from({ length: 9 }, (_, i) => game.scent.get(46 + i, 15));
        expect(actual, '门西侧气味图与 CE 时序手推不一致（F1 门回弹或 F2 派生位残留复发）')
            .toEqual(expected);
    });

    it('A2 对照组：从未被踩过的门对气味仍遮挡（门后无味、门面留味）——F1/F2 不得波及', () => {
        const game = createChaseGame(20260915);
        teleportPlayer(game, 44, 15);
        waitOnce(game); // tn=1003；玩家从未移动，门保持关闭
        expect(game.grid.getCell(52, 15)!.terrain).toBe(TerrainType.DOOR);
        expect(game.scent.get(52, 15)).toBe(1003 - 16); // 门面 || 留味（P4-8 T3 同款）
        expect(game.scent.get(53, 15)).toBe(0);         // 关着的门挡气味：门后无味
    });
});

describe('AI-1 B: 两条放弃路径判别式（同一几何、不同感知新旧）', () => {
    // 共用几何：玩家 (51,15) wait 一次 → (51,15)=1003（原点）、两侧 = 1001；
    // 随后玩家传到墙东 (58,15)——墙线 x=52（门在 (52,15)）挡死 (51,15) 的
    // 视线与气味，(50..51,15) 的章从此冻结。鼠放 (51,15)：邻格味最高 1001
    // （严格小于），是冻结区的局部最大；且视线须穿门格 → 不可见。
    function setupFrozenRatAtScentPeak(seed: number): { game: Game; rat: Monster } {
        const game = createChaseGame(seed);
        teleportPlayer(game, 51, 15);
        waitOnce(game); // (51,15)=1003、(50,15)=(52,15)=1001
        teleportPlayer(game, 58, 15); // 门格挡死 (51,15) 的视线与气味
        const rat = spawnRat(game, 51, 15);
        expect(game.scent.get(51, 15)).toBe(1003);
        return { game, rat };
    }

    it('B1 路径①气味死路：感知仍在（perceived ≤ awareness，零骰）但局部最大且不可见 → WANDERING 且当回合零位移', () => {
        const { game, rat } = setupFrozenRatAtScentPeak(20260915);
        // scentTurnNumber 推到 1006：鼠回合感知 = (1006+3) - 1003 = 6
        // ≤ awareness（wait → justRested → stealthRange 4 → aw 8）→
        // awareOfTarget 追踪分支不掷骰恒真（CE Monsters.c:1677-1679），
        // 排除路径②的 3% 骰。
        game.scent.turnNumber = 1006;
        const before = rng.randomNumbersGenerated;
        waitOnce(game); // tn=1009；感知 9-1003=6 ≤ 8 → 保持；移动阶段顺味无路
        expect(rng.randomNumbersGenerated - before).toBe(0);

        expect(rat.state).toBe(MonsterState.WANDERING);
        expect(rat.loc.x).toBe(51); // 零位移：①分支 return，本回合不走
        expect(rat.loc.y).toBe(15);
        // 前置自洽：确实是"气味死路"而非"有更浓邻格进不去"——
        // 鼠格是局部最大（isLocalScentMaximum），且不在玩家视野内。
        expect(game.scent.isLocalScentMaximum(game.grid, 51, 15)).toBe(true);
        expect(game.grid.getCell(51, 15)!.isVisible).toBe(false);
        // CE Monsters.c:3482-3484：死路 + 非 ALWAYS_HUNTING + 不在玩家 FOV
        // → MONSTER_WANDERING（wanderToward(lastSeenPlayerAt) 因 web 无
        // lastSeen 记账退化为普通 WANDERING，P4-8 报告已登记）。
    });

    it('B2 路径②感知丢失（硬截断）：perceived > awareness*3 → WANDERING（CE Monsters.c:1776-1779）', () => {
        const { game, rat } = setupFrozenRatAtScentPeak(20260915);
        // 把气味纪元拉快：perceived = 1401 - 1003 = 398 ≫ 24（= aw 8 × 3）。
        game.scent.turnNumber = 1398;
        const perceived = game.scent.awarenessDistance(game.grid, 51, 15, 58, 15);
        expect(perceived).toBeGreaterThan(7 * 2 * 3); // 前置：确实超硬截断
        waitOnce(game); // tn=1401
        expect(rat.state).toBe(MonsterState.WANDERING);
        // 为什么这里不钉"零骰"：截断分支本身不掷骰（B3 第三段已直调钉死），
        // 但转 WANDERING 后鼠当回合就进游荡分支（waypoint 选择会掷骰），
        // 端到端的 RNG 增量混入了游荡开销。可钉的判别式是：
        //   ①（B1）当回合 return → 零骰 + 零位移；
        //   ②（本条）当回合即以 WANDERING 身份游荡 → 位移不再受气味梯度约束。
        // 下一步它可以下坡（此时已不是追踪态，p4_8 T5 的逐步上坡断言不管辖）。
    });

    it('B3 路径②感知丢失（3% 骰）的判别带：追踪态下 perceived 落在哪一段，决定掷不掷骰', () => {
        // 无墙无门的空房间：玩家 (40,15) wait 一次 → (65,15) = 1003-50
        // （scentDistance 2*25）。观察者在玩家 FOV 内（web 的 isVisible 是
        // 全图 FOV、无半径限制），awarenessDistance 走 min 直距分支
        //（CE Monsters.c:1639-1644）→ perceived 封顶 scentDistance=50。
        const game = createHeadlessGame(20260915, 'test');
        game.monsters = [];
        game.items = [];
        for (let x = CARVE.x1; x <= CARVE.x2; x++) {
            for (let y = CARVE.y1; y <= CARVE.y2; y++) {
                game.grid.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
            }
        }
        teleportPlayer(game, 40, 15);
        waitOnce(game); // tn=1003
        expect(game.scent.get(65, 15)).toBe(953);
        const params = { alwaysHunting: false, immobile: false, tracking: true, stealthRange: 7 };

        // perceived = min(973-953, 50) = 20 ∈ (aw 14, 截断 42] → 追踪态掷 1 骰
        //（97% 保持）——无论返回值，增量必须恰为 1（CE :1671-1676）。
        game.scent.turnNumber = 973;
        let before = rng.randomNumbersGenerated;
        const kept = game.scent.awareOfTarget(game.grid, 65, 15, 40, 15, params);
        expect(rng.randomNumbersGenerated - before).toBe(1);

        // perceived = min(967-953, 50) = 14 ≤ awareness → 0 骰恒真（CE :1677-1679）
        game.scent.turnNumber = 967;
        before = rng.randomNumbersGenerated;
        expect(game.scent.awareOfTarget(game.grid, 65, 15, 40, 15, params)).toBe(true);
        expect(rng.randomNumbersGenerated - before).toBe(0);

        // perceived = min(1100-953, 50) = 50 > 42 → 0 骰恒假（截断先于掷骰，:1669-1670）
        game.scent.turnNumber = 1100;
        before = rng.randomNumbersGenerated;
        expect(game.scent.awareOfTarget(game.grid, 65, 15, 40, 15, params)).toBe(false);
        expect(rng.randomNumbersGenerated - before).toBe(0);
        expect(kept === true || kept === false).toBe(true); // 保持/丢失皆可，关键是恰好 1 骰
    });
});
