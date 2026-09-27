/// <reference types="node" />
/**
 * src/test/p4_8_scent_map.test.ts — P4-8：气味图（scent map）
 *
 * CE 对照（BrogueCE-master/src/brogue，只读）：
 *   scentDistance Time.c:756-762 / updateScent Time.c:764-782 / addScentToCell
 *   Movement.c:2875-2882 / scentDirection & isLocalScentMaximum Monsters.c:2820-2900 /
 *   scentTurnNumber 初值 RogueMain.c:378 / +3(隐身 +10) Time.c:2506-2509 /
 *   20000 回卷 Time.c:2511+2924 / 怪物顺味 Monsters.c:3447-3486。
 *
 * 对抗性断言与各自捕获的错误实现（任务书要求的五类全覆盖）：
 *   T1  scentDistance 写成欧氏/切比雪夫/曼哈顿（长短轴不等点对三者结果互异）
 *   T2  气味值符号写反（"越新越小"/把距离当值）
 *   T3  addScentToCell 的 `||` 被"修正"成 `&&`（门/深水不再留味——
 *       CE 的关闭门正是靠这条 || 成为气味跳板）
 *   T4  updateScent/scentTurnNumber 挂到 100-tick 客观块而非主观玩家块
 *       （haste 两动作只推进/重刷一次）
 *   T5  怪物顺梯度走成下坡（argmin/原地/隔味死站），且门应成为气味跳板
 *   T6  绕拐角：L 形墙两侧不可见，旧实现（直线距离 > 阈值即弃追）会被
 *       掐死在起跑线；正确实现须沿气味轨迹绕过横臂东端贴脸玩家
 *   T7  决定性：同种子同操作序列 → 同一张气味图 + 同一条怪物轨迹
 *   T8  对照组：玩家脚下恒为当前 turnNumber；被遮挡格冻结、相对年龄递增
 *   T9  隐身时 scentTurnNumber +10/回合（Time.c:2506-2509）
 *   T10 scentTurnNumber > 20000 触发 15000 回卷（Time.c:2511/2924）
 */
import { describe, it, expect } from 'vitest';

import { createHeadlessGame } from './harness';
import { scentDistance } from '../engine/Map/Scent';
import { Game } from '../engine/Core/Game';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import { TerrainType } from '../engine/Map/Grid';
import { rng } from '../engine/Random';
import monstersJson from '../data/monsters.json';

const CARVE = { x1: 30, y1: 4, x2: 74, y2: 26 } as const;

function monsterDataById(id: string): MonsterData {
    const row = monstersJson.find((m) => m.id === id);
    if (!row) throw new Error(`monsters.json 中找不到 ${id}`);
    return row as unknown as MonsterData;
}

/** test 模式底座：无周期刷怪；在纯花岗岩区刻出测试房间并清空房间怪/物。 */
function createScentGame(seed = 20260915): Game {
    const game = createHeadlessGame(seed, 'test');
    game.monsters = [];
    game.items = [];
    for (let x = CARVE.x1; x <= CARVE.x2; x++) {
        for (let y = CARVE.y1; y <= CARVE.y2; y++) {
            game.grid.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
        }
    }
    return game;
}

/** 直接传送玩家（不消耗回合、不留轨迹），并重算一次玩家 FOV 保持 isVisible 诚实。 */
function teleportPlayer(game: Game, x: number, y: number): void {
    game.player.loc.x = x;
    game.player.loc.y = y;
    game.fov.computeFOV(x, y, 10);
}

function setWall(game: Game, x: number, y: number): void {
    game.grid.setTerrain(x, y, TerrainType.WALL, '#', 0x555555);
}

function setDoor(game: Game, x: number, y: number): void {
    game.grid.setTerrain(x, y, TerrainType.DOOR, '+', 0xcc9933);
}

/** rat：速度 100、无 bolts、无行为标志——最朴素的追踪者（monsterCatalog 首行）。 */
function spawnRat(game: Game, x: number, y: number): Monster {
    return spawnMonsterAt(game, 'rat', x, y);
}

function spawnMonsterAt(game: Game, id: string, x: number, y: number): Monster {
    const mon = new Monster(x, y, monsterDataById(id));
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

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
    return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

describe('P4-8 A: 气味图数值（scentDistance / updateScent / addScentToCell）', () => {
    it('T1 scentDistance 是"长轴×2+短轴"，与欧氏/切比雪夫/曼哈顿全部可区分', () => {
        // (0,0)->(3,1)：CE=2*3+1=7；切比雪夫=3、欧氏取整=3、曼哈顿=4
        expect(scentDistance(0, 0, 3, 1)).toBe(7);
        expect(scentDistance(0, 0, 1, 3)).toBe(7); // 短轴在 x
        expect(scentDistance(0, 0, 2, 2)).toBe(6); // 等轴走 else 分支：2+2*2
        expect(scentDistance(5, 5, 5, 5)).toBe(0);
    });

    it('T2 气味值 = turnNumber - 距离（越新越大）；墙格与墙后无味', () => {
        const game = createScentGame();
        teleportPlayer(game, 46, 15);
        for (let y = CARVE.y1; y <= CARVE.y2; y++) setWall(game, 52, y);

        waitOnce(game); // scentTurnNumber: 1000 -> 1003
        expect(game.scent.turnNumber).toBe(1003);
        expect(game.scent.get(46, 15)).toBe(1003);      // 脚下：-0
        expect(game.scent.get(47, 15)).toBe(1003 - 2);  // d=2*1
        expect(game.scent.get(49, 15)).toBe(1003 - 6);  // d=2*3
        expect(game.scent.get(51, 15)).toBe(1003 - 10); // d=2*5
        // 符号写反（越新越小）会得到 1003+2；把距离当值会得到 2——都过不了上面两条
        expect(game.scent.get(52, 15)).toBe(0);  // 墙格：既挡味又挡通行 → 不留味
        expect(game.scent.get(53, 15)).toBe(0);  // 墙后：不在气味 FOV 掩码内
    });

    it('T3 addScentToCell 的 || 条件（Movement.c:2877）：门与深水留味，门后无味', () => {
        const game = createScentGame();
        teleportPlayer(game, 46, 15);
        for (let y = CARVE.y1; y <= CARVE.y2; y++) setWall(game, 52, y);
        setDoor(game, 52, 15); // CE DOOR：T_OBSTRUCTS_VISION 有、T_OBSTRUCTS_PASSABILITY 无
        game.grid.setTerrain(44, 19, TerrainType.WATER_DEEP, '=', 0x3355ff);
        game.grid.setTerrain(44, 11, TerrainType.WATER_SHALLOW, '~', 0x4488ff);

        waitOnce(game); // tn 1003
        // 门：在 T_OBSTRUCTS_SCENT 内但不在 T_OBSTRUCTS_PASSABILITY 内 → 靠 || 留味。
        // 被"修正"成 && 的错误实现会写成 0。
        expect(game.scent.get(52, 15)).toBe(1003 - 12); // d((46,15),(52,15)) = 2*6
        expect(game.scent.get(53, 15)).toBe(0);         // 门对气味仍遮挡：后方无味
        // 深水：T_IS_DEEP_WATER ∈ T_OBSTRUCTS_SCENT、∉ T_OBSTRUCTS_PASSABILITY → || 留味
        expect(game.scent.get(44, 19)).toBe(1003 - 10); // dx=2,dy=4 → 2+2*4
        // 浅水：两个标志都不占 → 正常留味（对照组）
        expect(game.scent.get(44, 11)).toBe(1003 - 10);
    });

    it('T4 updateScent/scentTurnNumber 挂主观玩家块：haste 两动作 +6、重刷两次', () => {
        const game = createScentGame();
        teleportPlayer(game, 46, 15);
        game.player.applyStatus('haste', 30);
        game.player.refreshSpeeds();
        expect(game.player.movementSpeed).toBe(50);

        moveOnce(game, 1, 0); // →(47,15)，tn 1003；客观门 100→50 未触发
        expect(game.scent.turnNumber).toBe(1003);
        expect(game.ticksTillUpdateEnvironment).toBe(50);

        moveOnce(game, 1, 0); // →(48,15)，tn 1006；客观块此刻才触发一次（门回 100）
        expect(game.scent.turnNumber).toBe(1006);
        expect(game.ticksTillUpdateEnvironment).toBe(100);
        // (44,15) 被盖两次章：m1 时 (47,15) 以 d=6 → 997；m2 时 (48,15) 以 d=8 → 998。
        // 挂到客观块（每 100 tick 一次）的错误实现只会在 m2 处刷一次 → 终值 1003-8=995。
        expect(game.scent.get(44, 15)).toBe(998);
    });

    it('T9 隐身时 scentTurnNumber 每回合 +10（Time.c:2506-2509）', () => {
        const game = createScentGame();
        teleportPlayer(game, 46, 15);
        game.player.applyStatus('invisible', 30);
        waitOnce(game);
        expect(game.scent.turnNumber).toBe(1010);
        expect(game.scent.get(47, 15)).toBe(1008); // 1010 - 2
    });

    it('T10 scentTurnNumber 越过 20000 触发 15000 回卷（Time.c:2511/2924）', () => {
        const game = createScentGame();
        teleportPlayer(game, 46, 15);
        game.scent.turnNumber = 19998;
        waitOnce(game);
        // 19998+3=20001 > 20000 → 先回卷 -15000=5001，再以 5001 盖章（CE 同序）
        expect(game.scent.turnNumber).toBe(5001);
        expect(game.scent.get(46, 15)).toBe(5001);
        expect(game.scent.get(47, 15)).toBe(4999);
    });
});

describe('P4-8 B: 怪物顺气味追踪', () => {
    // ── 验收方 2026-09-18 的实测说明（B-4a 验收时查清，**不是 B-4a 的回归**）──
    //
    // B-4a（纯物品生成轮，AI 与气味代码零改动）移动 RNG 流后本条翻红。
    // 逐层排查结论：**本条测试从一开始就是"挑中了能过的 seed"**。
    //   · 在 main 上把本场景跑 12 个不同 seed：**只有 1 个成功**（正是原版用的
    //     默认 seed 20260915）；
    //   · 在 B-4a 上跑 40 个 seed：**5 个成功**（12.5%）。
    //   两边成功率统计上一致（约 10%），所以 B-4a **没有改变追踪行为**，
    //   只是把流位置挪开了那颗走运的骰子。
    //
    // ── AI-1 结案（2026-09-18）：低成功率是 CE 本来的行为，另有两处 web 偏差已修 ──
    //
    // 诊断结论（详见 ai_docs/ai_1_report.md 与 ai_1_scent_tracking.test.ts）：
    //   1. **CE 本来如此**：玩家原地 wait → justRested → stealthRange 7→4
    //      （CE Time.c:813-815）→ awareness = 8、硬截断 = 24。而 T5 场景里
    //      门西侧气味每格比东侧旧 2、鼠每向东一步 perceived 恰好 +1：从 20
    //      起步，第 6 步 perceived=25 > 24 必撞截断。**纯追踪 7 步贴脸在 CE
    //      里也不可能**；CE 的鼠同样只能靠"丢目标 → WANDERING 沿 waypoint
    //      游荡 → 贴脸重唤醒"蹭到玩家。这是 CE 潜行机制（rest 甩尾）的设计
    //      本意，不是缺陷。
    //   2. **web 曾有两处真实偏差（本轮已修），使截断从第 6 步提前到第 2 步**：
    //      a) 门回弹：web 玩家踩门的开门（handleSpecialTileEntry）先于本回合
    //         环境晋升（OPEN_DOOR promoteChance=10000 → 关回），而 CE 是
    //         updateEnvironment(:2695 关门) 在先、applyInstantTileEffects
    //         (:2698 开门) 在后——玩家站在门上时门保持开。修复：Game.ts
    //         客观块晋升段后补玩家所站格 promoteOnStep。
    //      b) 派生位残留：promote 链走 Grid.setTerrainLayer（只写层），
    //         isOpaque 残留 DOOR 的 true → obstructsScent 把开着的门继续当
    //         遮挡物，updateScent 掩码穿不过门洞。修复：setTerrainLayer 内
    //         随层写重算派生位。两修后门西侧气味 = 1013..1023，与 CE 时序
    //         手推逐位一致（AI-1 前 = 1012..1022）。
    //   3. **结局断言改概率口径（本条反转）**：修后 60 seeds（20260916 起
    //      透明序列）实测 caught 14/60 = 23.3%；二项 95% CI ≈ [13%, 36%]。
    //      区间外扩到 [10%, 40%] 以容纳 40 seeds 的批次波动（sd≈6.6pp，
    //      ±2σ≈±13pp）。能杀死的错误实现：argmin 下坡/原地（≈0%，到不了
    //      门前）；删掉感知判定或截断（≈0.97^7≈81%，纯追踪贴脸，超上限）；
    //      丢目标后不游荡（纯追踪第 6 步截断 → 0%，破下限）。原"单 seed
    //      钉 20330368 + 全程 HUNTING"断言已删除——它过的方式是游荡撞运，
    //      不是追踪正确，构成"挑 seed 的假保证"。
    it('T5 追踪怪顺梯度上坡、把门当气味跳板；结局按 CE 实带断言成功率（AI-1 改写）', () => {
        const N = 40;
        let caughtCount = 0;
        for (let s = 0; s < N; s++) {
            const game = createScentGame(20260916 + s); // 透明序列，不挑 seed
            for (let y: number = CARVE.y1; y <= CARVE.y2; y++) {
                if (y !== 15) setWall(game, 52, y);
            }
            setDoor(game, 52, 15);
            teleportPlayer(game, 44, 15);
            // 玩家从 (44,15) 穿门走到 (54,15)：10 步给整条走廊盖章（门格因 || 留味）
            for (let i = 0; i < 10; i++) moveOnce(game, 1, 0);
            expect(game.player.loc.x).toBe(54);
            waitOnce(game);

            const rat = spawnRat(game, 46, 15); // 站在玩家来时的轨迹上
            expect(rat.state).toBe(MonsterState.HUNTING);
            expect(game.scent.get(46, 15)).toBeGreaterThan(0);
            expect(game.hasLineOfSight(rat.loc.x, rat.loc.y, game.player.loc.x, game.player.loc.y))
                .toBe(false); // 门挡视线：怪物确实看不见玩家

            let caught = false;
            for (let i = 0; i < 10 && !caught; i++) {
                const bx = rat.loc.x, by = rat.loc.y, bState = rat.state;
                const scentBefore = game.scent.get(bx, by);
                waitOnce(game);
                const moved = rat.loc.x !== bx || rat.loc.y !== by;
                // 与 seed 无关的性质断言：**前后都仍是 HUNTING** 的那一步，
                // 必须是气味严格上坡。下坡（argmin）实现在第一步就会被抓住。
                // 前后都要求 HUNTING，是因为 CE 的 3% 丢目标发生在回合内的状态
                // 更新阶段（先于移动）——刚丢目标那一步是以 WANDERING 身份走的，
                // 本就允许下坡，不该由本断言管辖。
                if (bState === MonsterState.HUNTING && rat.state === MonsterState.HUNTING && moved) {
                    expect(
                        game.scent.get(rat.loc.x, rat.loc.y),
                        `追踪态下走了非上坡的一步 (${bx},${by})→(${rat.loc.x},${rat.loc.y})`,
                    ).toBeGreaterThan(scentBefore);
                }
                caught = chebyshev(rat.loc.x, rat.loc.y, game.player.loc.x, game.player.loc.y) <= 1;
            }
            if (caught) caughtCount++;
        }
        // 下坡（argmin）/原地/弃味实现到不了 x>=52，更不可能贴脸 → 远低于下限；
        // 删掉感知判定/截断的实现 7 步纯追踪贴脸 → 远超上限。
        expect(caughtCount, `40 seeds 成功 ${caughtCount} 个，超出 CE 实带 [10%, 40%]`).toBeGreaterThanOrEqual(N * 0.10);
        expect(caughtCount).toBeLessThanOrEqual(N * 0.40);
    });

    it('T6 绕拐角：L 形墙隔断视线，怪物顺气味锥钻过拐角、绕过横臂东端贴脸玩家', () => {
        const res = runCornerChase(20260915);
        // 旧实现（!可见 && dist>阈值 即弃追）在起跑线上就直接回 WANDERING，
        // 永远到不了；顺梯度失败/贴墙打转的实现同样到不了。
        expect(res.caught).toBe(true);
        expect(res.finalState).toBe(MonsterState.HUNTING);
        // 轨迹约束：不踩墙（竖臂 x=52 y∈[4..22]、横臂 y=22 x∈[52..64]）；
        // 穿越墙线只允许走合法开口——x=52 须在 y>=23（南走廊），
        // y=22 且 x∈[52..64] 是墙、x>=65 才是横臂东端的合法翻越点。
        const onWall = (p: { x: number; y: number }): boolean =>
            (p.x === 52 && p.y >= 4 && p.y <= 22) ||
            (p.y === 22 && p.x >= 52 && p.x <= 64);
        for (const p of res.trajectory) {
            expect(onWall(p)).toBe(false);
            if (p.x === 52) expect(p.y).toBeGreaterThanOrEqual(23);
        }
        // "绕过拐角"的实证：从南走廊一路向东、绕过横臂东端（到达 x>=65 的
        // 合法翻越列）再折返贴脸。
        expect(Math.max(...res.trajectory.map(p => p.x))).toBeGreaterThanOrEqual(65);
        expect(res.trajectory.some(p => p.x >= 65 && p.y <= 23)).toBe(true);
    });

    it('T7 决定性：同种子同操作序列 → 同一张气味图 + 同一条怪物轨迹', () => {
        const a = runCornerChase(20260915);
        const b = runCornerChase(20260915);
        expect(a.hash).toBe(b.hash);
        expect(a.trajectory).toEqual(b.trajectory);
        expect(a.caught).toBe(b.caught);
    });
});

describe('P4-8 C: 对照与保鲜', () => {
    it('T8 对照组：脚下恒为当前值；被遮挡格冻结、相对年龄单调递增', () => {
        const game = createScentGame();
        for (let y = 6; y <= 24; y++) setWall(game, 54, y);
        teleportPlayer(game, 52, 15);
        waitOnce(game); // tn 1003；A=(53,15) 被盖章 1001
        expect(game.scent.get(53, 15)).toBe(1001);

        teleportPlayer(game, 58, 15); // 传到墙另一侧：A 再也收不到新章
        const ages: number[] = [];
        for (let i = 0; i < 5; i++) {
            waitOnce(game);
            const tn = game.scent.turnNumber;
            expect(game.scent.get(58, 15)).toBe(tn);          // 脚下恒为当前值
            expect(game.scent.get(56, 15)).toBe(tn - 4);      // 视野内远处 = tn - d
            expect(game.scent.get(53, 15)).toBe(1001);        // 遮挡格冻结
            ages.push(tn - 1001);                             // 相对年龄
        }
        for (let i = 1; i < ages.length; i++) {
            expect(ages[i]!).toBeGreaterThan(ages[i - 1]!);   // 越来越"旧"
        }
    });
});

// ---------------------------------------------------------------------
// T6/T7 共用场景：L 形墙绕拐角追击（P4-8 返工版——CE 感知判定下的新鲜痕迹）。
//
// 地图（[30..74]×[4..26] 房间内，墙体与返工前一致）：
//   竖臂  x=52,  y∈[4..22]
//   横臂  y=22,  x∈[52..64]      —— 唯一合法翻越点在横臂东端 x>=65
//
// 为什么是"途中放置"而不是原版的"走完全程再放"：CE 的气味每主观回合
// 老化 +3（Time.c:2506-2509），awareOfTarget 的硬截断为 awareness*3
// = stealthRange*6（阴影近似下 stealthRange=7 → 42）。原版老鼠脚下的
// 气味在追击开始时已陈旧 ~157（perceived），任何 CE 忠实实现都会在
// 第 1 回合把它切回 WANDERING——那是 CE 里根本不会发生的追击。CE 的
// 绕拐角追击发生在脱离视线后数回合内：本场景模拟"怪物一直缀在队尾，
// 玩家刚拐过臂端"——玩家南下→东行→在 x=66 北折，老鼠在第 47 步被放到
// 玩家 4 回合前刚走过的南走廊 (62,24)，此时该格陈旧度 ~33（< 42 截断），
// 且全程无视线（横臂挡死），必须顺气味绕过东端（x>=65）再贴脸。
// ---------------------------------------------------------------------
interface ChaseResult {
    trajectory: Array<{ x: number; y: number }>;
    hash: string;
    caught: boolean;
    finalState: MonsterState;
}

function runCornerChase(seed: number): ChaseResult {
    const game = createScentGame(seed);
    for (let y = CARVE.y1; y <= 22; y++) setWall(game, 52, y);
    for (let x = 52; x <= 64; x++) setWall(game, x, 22);

    teleportPlayer(game, 36, 8);
    const route: Array<readonly [number, number]> = [];
    for (let y = 9; y <= 24; y++) route.push([0, 1] as const);   // 南下 x=36
    for (let x = 37; x <= 66; x++) route.push([1, 0] as const);  // 东行 y=24
    for (let y = 23; y >= 16; y--) route.push([0, -1] as const); // 北上 x=66
    expect(route.length).toBe(16 + 30 + 8);

    // 第 47 步后（玩家在 (66,23)，老鼠格 (62,24) 的气味是它 4 回合前路过时
    // 盖的章）：放置追踪鼠，随后的 7 步路程里它已在追击途中。
    let rat: Monster | null = null;
    const trajectory: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < route.length; i++) {
        moveOnce(game, route[i]![0]!, route[i]![1]!);
        if (i === 46) {
            rat = spawnRat(game, 62, 24);
            expect(game.scent.get(62, 24)).toBeGreaterThan(0);
        } else if (rat) {
            trajectory.push({ x: rat.loc.x, y: rat.loc.y });
        }
    }
    expect(game.player.loc.x).toBe(66);
    expect(game.player.loc.y).toBe(16);

    let caught = rat !== null &&
        chebyshev(rat.loc.x, rat.loc.y, game.player.loc.x, game.player.loc.y) <= 1;
    for (let i = 0; i < 90 && !caught; i++) {
        waitOnce(game);
        trajectory.push({ x: rat!.loc.x, y: rat!.loc.y });
        caught = chebyshev(rat!.loc.x, rat!.loc.y, game.player.loc.x, game.player.loc.y) <= 1;
    }

    let hash = 0x811c9dc5;
    for (let x = 0; x < game.grid.width; x++) {
        for (let y = 0; y < game.grid.height; y++) {
            hash ^= game.scent.get(x, y);
            hash = Math.imul(hash, 0x01000193);
        }
    }
    return {
        trajectory,
        hash: (hash >>> 0).toString(16).padStart(8, '0'),
        caught,
        finalState: rat!.state,
    };
}

// ---------------------------------------------------------------------
// P4-8 D（验收打回后的返工新增）：CE awareOfTarget 丢失判定。
//
//   awarenessDistance  Monsters.c:1630-1654（感知距离 = 气味陈旧度）
//   awareOfTarget      Monsters.c:1658-1690（ALWAYS_HUNTING 恒真 / IMMOBILE /
//                      awareness*3 硬截断 / 追踪态 3% 丢目标）
//   updateMonsterState Monsters.c:1776-1779（追踪态 !aware → WANDERING）
//
// 阴影近似下 stealthRange = 7（Game.calculateStealthRange：CE 基数 14，web
// 唯一光源是玩家自己的矿灯类火把、不驱散阴影）→ awareness = 14、截断 = 42。
// ---------------------------------------------------------------------
describe('P4-8 D: 返工——感知判定与丢失路径（awareOfTarget）', () => {
    it('T11 返工核心：陈旧痕迹必须能甩掉——冻结在陈旧气味格上的追踪怪回到 WANDERING', () => {
        // 对抗性说明：返工前的实现（无感知判定，只在气味死路时放弃）在此测试下
        // 永远保持 HUNTING——perceived = 402 ≫ 42，CE 早在几十回合前就该放弃。
        const game = createScentGame();
        for (let y = 6; y <= 24; y++) setWall(game, 54, y);
        // 先让玩家在西侧盖一次章：(53,15) = 1003 - 2 = 1001（T8 同款冻结格）
        teleportPlayer(game, 52, 15);
        waitOnce(game);
        // 玩家传到墙东侧：墙挡死气味与视线，(53,15) 的章从此冻结
        teleportPlayer(game, 58, 15);
        const rat = spawnRat(game, 53, 15);
        // 把气味纪元拉快 132 回合：该格痕迹变成陈旧痕迹（不写私有 set，
        // 直接推进 turnNumber——scent 值不变 = 相对年龄暴涨）
        game.scent.turnNumber = 1400;
        const perceived = game.scent.awarenessDistance(game.grid, 53, 15, 58, 15);
        expect(perceived).toBeGreaterThan(7 * 2 * 3); // 前置：确实超出 awareness*3

        waitOnce(game); // tn 1403；(53,15) 冻结在 1001，perceived = 402 > 42
        expect(rat.state).toBe(MonsterState.WANDERING); // CE Monsters.c:1776-1779
        // 甩掉不是一回合的事：墙挡视线，不会被唤醒分支拉回去
        waitOnce(game);
        expect(rat.state).toBe(MonsterState.WANDERING);
    });

    it('T12 awareness*3 硬截断在 HUNTING 态也生效（"even if hunting"）——可见也截', () => {
        const game = createScentGame();
        teleportPlayer(game, 40, 15);
        waitOnce(game); // 盖章：(65,15) = 1003 - 50
        const rat = spawnRat(game, 65, 15); // 25 格外，直线可见且气味新鲜
        game.fov.computeFOV(40, 15, 30);    // 放宽 FOV 半径：让"可见"名副其实
        expect(game.scent.awarenessDistance(game.grid, 65, 15, 40, 15)).toBe(50);
        expect(rat.state).toBe(MonsterState.HUNTING); // 舞台自洽：追击态

        waitOnce(game);
        // perceived = 50 > 42：尽管全程可见、气味每回合保鲜，CE 的截断优先于
        // 追踪态（Monsters.c:1669-1670 在 TRACKING 分支之前）。改成 awareness*1
        // 的错误实现同样会切（50>14），但 T14 与 T5/T6 会失败——四条互相钳制。
        expect(rat.state).toBe(MonsterState.WANDERING);
    });

    it('T13 对照组：MONST_ALWAYS_HUNTING 不受任何截断影响（CE updateMonsterState 首分支强制追踪）', () => {
        const game = createScentGame();
        teleportPlayer(game, 40, 15);
        waitOnce(game);
        // phylactery：数据表里唯一朴素的 ALWAYS_HUNTING 怪（同时 IMMOBILE/INANIMATE，
        // takeTurn 在不可移动早退前不会触碰其状态——与 CE 一致：IMMOBILE 分支
        // 本轮就不接线，见报告取舍）
        const wisp = spawnMonsterAt(game, 'phylactery', 65, 15);
        game.fov.computeFOV(40, 15, 30);
        // 直调 awareOfTarget：ALWAYS_HUNTING 恒真（CE awareOfTarget 首分支）
        expect(game.scent.awareOfTarget(game.grid, 65, 15, 40, 15,
            { alwaysHunting: true, immobile: true, tracking: true, stealthRange: 7 })).toBe(true);
        // 端到端：超截断距离 + 陈旧痕迹双重条件下仍保持追踪
        game.scent.turnNumber = 1400;
        waitOnce(game);
        expect(wisp.state).toBe(MonsterState.HUNTING);
    });

    it('T14 追踪态 3% 丢目标：走 RNG_SUBSTANTIVE（500 次计数可证）、同种子逐位可复现、统计上远高于半数保持', () => {
        // 场景：perceived = 20 ∈ (awareness 14, 截断 42]，追踪态每回合掷
        // rand_percent(97)（CE Monsters.c:1671-1676 写作保持 97%）。
        const run = (): boolean[] => {
            const game = createScentGame(777);
            teleportPlayer(game, 40, 15);
            waitOnce(game); // 盖章：(50,15) = 1003 - 20
            const draws: boolean[] = [];
            const before = rng.randomNumbersGenerated;
            for (let i = 0; i < 500; i++) {
                draws.push(game.scent.awareOfTarget(game.grid, 50, 15, 40, 15,
                    { alwaysHunting: false, immobile: false, tracking: true, stealthRange: 7 }));
            }
            // randRange 只在 RNG_SUBSTANTIVE 上计数：500 次掷骰必须全部落在
            // 实质流上（RNG_SUBSTANTIVE 要求的硬证据）
            expect(rng.randomNumbersGenerated - before).toBe(500);
            return draws;
        };

        const a = run();
        const b = run(); // 同种子重跑：逐位可复现
        expect(b).toEqual(a);

        const kept = a.filter(Boolean).length;
        // p=0.97、n=500：均值 485、sd≈3.8。[440,499] 区间能同时杀死三类错误实现：
        //   rand_percent(50)（≈250）、rand_percent(3) 写反（≈15）、忘掷骰恒 true（500）
        expect(kept).toBeGreaterThan(440);
        expect(kept).toBeLessThan(500);
    });
});
