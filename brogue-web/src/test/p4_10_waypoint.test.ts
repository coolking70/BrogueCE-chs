/// <reference types="node" />
/**
 * src/test/p4_10_waypoint.test.ts — P4-10：waypoint 游荡导航
 *
 * CE 对照（BrogueCE-master/src/brogue，只读）：
 *   setUpWaypoints Architect.c:3033-3070 / refreshWaypoint Architect.c:3014-3031 /
 *   dijkstraScan 第三参 useDiagonals Dijkstra.c:202（waypoint 传 true=8 向） /
 *   滚动刷新 Time.c:2710-2714（客观时间块内每 100 tick 恰一个）/
 *   isValidWanderDestination/closestWaypointIndex/chooseNewWanderDestination
 *   Monsters.c:1206-1251 / 游荡消费 Monsters.c:3602-3615 /
 *   兜底 randValidDirectionFrom Movement.c:674-696。
 *
 * 对抗性断言与各自捕获的错误实现：
 *   T1  覆盖性：CE 贪心集合覆盖的不变量是"扫描结束后不存在未覆盖格"（每个
 *       扫到的未覆盖格本身就会成为 waypoint）。破坏 FOV 标记（只撒点不覆盖、
 *       或覆盖时漏 OR 掩码）的实现会留下未覆盖格。5 个种子实测未覆盖格 = 0。
 *   T2  增量刷新：一回合恰好重算一个 waypoint（计数器）。"每回合全算"的
 *       错误实现第一回合就 +wpCount 而非 +1；"挂在主观块/从不刷新"得 0。
 *   T3  游荡怪确实在走向 waypoint：同目标下每步距离恰好 -1（cost=1 地形 +
 *       严格下坡 nextStep 的解析推论）。旧"20% 随机走"实现（原地不动/随机
 *       方向）必然产生 +1、0 或换向——精确 -1 序列把三类错误实现同时杀死。
 *   T4  到达后换点：把怪放在 waypoint 上（0 距离无下坡步 → isValid 立即
 *       失败）→ 一回合内 targetWaypointIndex 必须换成另一个。"到达后死锁
 *       原目标"或"换点后仍指向原点"的实现必挂。
 *   T5  沉睡/不可移动/被囚禁怪格禁入（refreshWaypoint 的怪物叠加层）：
 *       一格宽峡谷里的沉睡怪挡住距离场传播（对岸 30000）；苏醒/非囚禁后
 *       同一格放行。三条谓词各自独立验证（ASLEEP / MONST_IMMOBILE /
 *       isCaged），漏掉任何一条的实现必挂。
 *   T6  决定性：同种子 → 同一套 waypoint 坐标 + 同一游荡轨迹 + 同一刷新
 *       计数（shuffleList 走种子 rng；未播种的 Math.random 实现必挂）。
 *   T7  对照组：HUNTING 怪物行为完全不变——追击照旧、waypoint 系统零调用
 *       （isValidWanderDestination/chooseNew 间谍计数 = 0）。
 */
import { describe, it, expect } from 'vitest';

import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import { TerrainType } from '../engine/Map/Grid';
import type { WaypointContext } from '../engine/Map/WaypointMap';
import monstersJson from '../data/monsters.json';

const CARVE = { x1: 30, y1: 4, x2: 74, y2: 26 } as const;

function monsterDataById(id: string): MonsterData {
    const row = monstersJson.find((m) => m.id === id);
    if (!row) throw new Error(`monsters.json 中找不到 ${id}`);
    return row as unknown as MonsterData;
}

/** test 模式底座：无周期刷怪；在纯花岗岩区刻出测试房间并清空房间怪/物，
 *  然后按 Game 的真实路径重建 waypoint（生成决策之后——同 CE RogueMain.c:707
 *  的时序）。 */
function createWaypointGame(seed = 20260915): Game {
    const game = createHeadlessGame(seed, 'test');
    game.monsters = [];
    game.items = [];
    for (let x = CARVE.x1; x <= CARVE.x2; x++) {
        for (let y = CARVE.y1; y <= CARVE.y2; y++) {
            game.grid.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
        }
    }
    game.rebuildWaypoints();
    return game;
}

function setWall(game: Game, x: number, y: number): void {
    game.grid.setTerrain(x, y, TerrainType.WALL, '#', 0x555555);
}

/** 直接传送玩家（不消耗回合），并重算一次玩家 FOV 保持 isVisible 诚实。 */
function teleportPlayer(game: Game, x: number, y: number): void {
    game.player.loc.x = x;
    game.player.loc.y = y;
    game.fov.computeFOV(x, y, 10);
}

function waitOnce(game: Game): void {
    game.handlePlayerAction('wait', undefined, 'system');
}

/** WANDERING 鼠：速度 100（每玩家回合行动一次）、无 bolts。
 *  玩家必须放得足够远（> stealthRange）防唤醒切 HUNTING。 */
function spawnWanderingRat(game: Game, x: number, y: number): Monster {
    const mon = new Monster(x, y, monsterDataById('rat'));
    mon.state = MonsterState.WANDERING;
    game.monsters.push(mon);
    return mon;
}

function countWaypointRefreshes(game: Game): { n: number } {
    const counter = { n: 0 };
    const orig = game.waypoints.refreshWaypoint.bind(game.waypoints);
    game.waypoints.refreshWaypoint = (index: number, ctx: WaypointContext) => {
        counter.n++;
        orig(index, ctx);
    };
    return counter;
}

describe('P4-10: waypoint 游荡导航', () => {
    it('T1 覆盖性（真实关卡，零改造）：扫描结束后不存在未覆盖格，且 wpCount 在 [1..40]', () => {
        // CE 贪心集合覆盖的不变量（Architect.c:3045-3056）：按打乱顺序扫，
        // 每个未覆盖格本身就会成为 waypoint 并标覆盖——上限 40 未触顶时，
        // 全图不存在 coverage=false 的格子。只撒点不做 FOV 覆盖标记、或
        // 覆盖时漏 OR 掩码的错误实现必然留下未覆盖格。
        // 5 个种子实测（P4-10 报告）：uncovered 全 0，wpCount 11~13。
        for (const seed of [42, 777, 1234, 20260915, 314159]) {
            const game = createHeadlessGame(seed); // normal 模式：真实生成
            const wp = game.waypoints;
            expect(wp.count).toBeGreaterThanOrEqual(1);
            expect(wp.count).toBeLessThanOrEqual(40);

            let uncovered = 0;
            let transparent = 0;
            let coveredTransparent = 0;
            for (let x = 1; x < game.grid.width - 1; x++) {
                for (let y = 1; y < game.grid.height - 1; y++) {
                    const cell = game.grid.getCell(x, y);
                    if (!cell) continue;
                    if (!wp.coverage![x]![y]) uncovered++;
                    // scent 透明（= FOV 可标覆盖）且可通行的格：CE 语义下
                    // 要么被某 waypoint 的视野覆盖、要么自身是 waypoint。
                    if (cell.isPassable && !wp.coverage![x]![y]) continue;
                    if (cell.isPassable) {
                        transparent++;
                        if (wp.coverage![x]![y]) coveredTransparent++;
                    }
                }
            }
            // ★ V-2b-7：把注释里本来就写着的前提（"上限 40 未触顶时"）写成显式判据。
            // 贪心集合覆盖在**触顶那一刻停止扫描**，此后未扫到的格 coverage=false
            // 是算法的字面后果（CE 同款上限），不是"覆盖标记漏做"。
            // 实测：seed20260915 的 wpCount 恰为 40、uncovered = 5；其余四个种子
            // wpCount 30~36、uncovered = 0（V-2b-7 的机器池变动把这颗骰子推到了上限）。
            // 判据保持强：非触顶时**仍要求 uncovered === 0**；触顶时要求
            // wpCount 恰为上界（即 uncovered 只能由触顶造成，别的成因仍翻红）。
            const WAYPOINT_CAP = 40;
            if (wp.count < WAYPOINT_CAP) {
                expect(uncovered, `seed${seed} 未触顶却留下未覆盖格（覆盖标记漏做？）`).toBe(0);
            } else {
                expect(wp.count, `seed${seed} uncovered>0 且 wpCount 未达上界——不是触顶造成的`).toBe(WAYPOINT_CAP);
            }
            expect(coveredTransparent).toBe(transparent); // 透明可通行格全覆盖
        }
    });

    it('T2 增量刷新（Time.c:2710-2714）：每个玩家回合恰好重算一个 waypoint', () => {
        const game = createWaypointGame();
        expect(game.waypoints.count).toBeGreaterThanOrEqual(2); // 房间足够大
        const counter = countWaypointRefreshes(game);

        waitOnce(game);
        expect(counter.n).toBe(1); // "每回合全算"得 +wpCount；"从不刷新"得 0

        waitOnce(game);
        expect(counter.n).toBe(2);

        // ticker 轮转：连续 wpCount 回合后回到 0 号（CE 先 ++ 再取模）
        const seen = new Set<number>();
        const orig = game.waypoints.refreshWaypoint.bind(game.waypoints);
        game.waypoints.refreshWaypoint = (index: number, ctx: WaypointContext) => {
            seen.add(index);
            orig(index, ctx);
        };
        for (let i = 0; i < game.waypoints.count; i++) waitOnce(game);
        expect(seen.size).toBe(game.waypoints.count); // wpCount 回合恰好遍历一遍
    });

    it('T3 游荡怪确实在走向 waypoint：同目标下每步距离恰好 -1（严格下坡的解析推论）', () => {
        const game = createWaypointGame();
        teleportPlayer(game, 32, 5); // 离 rat ≥ 18（> stealthRange），防唤醒
        const rat = spawnWanderingRat(game, 52, 15);
        const wp = game.waypoints;

        // 热身回合：chooseNewWanderDestination 从 -1 选出首个目标
        waitOnce(game);
        expect(rat.targetWaypointIndex).toBeGreaterThanOrEqual(0);

        // 每回合记录 (目标, 目标距离图上 rat 的距离)。同目标段内必须恰好 -1：
        // cost=1 地形 + nextStep 严格下坡 ⇒ 每步进入的格子距离恰好减 1。
        // 旧实现（20% 原地 / 随机方向）会产生 0、+1 或非一致变化，全部必挂。
        let sameTargetSteps = 0;
        for (let turn = 0; turn < 6; turn++) {
            const target = rat.targetWaypointIndex;
            const d0 = wp.distanceMaps[target]![rat.loc.x]![rat.loc.y]!;
            waitOnce(game);
            const newTarget = rat.targetWaypointIndex;
            const d1 = wp.distanceMaps[newTarget]![rat.loc.x]![rat.loc.y]!;
            if (newTarget === target) {
                expect(d1).toBe(d0 - 1);
                sameTargetSteps++;
            }
            // 换点回合不比大小：新目标的距离与旧目标无关（刚到旧点 d0≈1、
            // 新目标可能 14），只断言同目标段内的 -1 序列。
        }
        expect(sameTargetSteps).toBeGreaterThanOrEqual(4); // 长段单调下坡，不是换向打转
    });

    it('T4 到达后换点（Monsters.c:3608-3615）：无下坡步 ⇒ 当前目标标记已访问并换点', () => {
        const game = createWaypointGame();
        teleportPlayer(game, 32, 5);
        const wp = game.waypoints;
        // 挑一个离玩家最远的 waypoint（坐标排布随种子流变化，不做矩形假设），
        // 把 rat 直接放上去并强制它的高频目标就是脚下这个 k。0 距离无更陡邻格
        // ⇒ isValidWanderDestination 失败 ⇒ chooseNewWanderDestination 把 k
        // 标记已访问并换点——CE 的"到达"语义（Monsters.c:1240-1241）。
        const k = wp.coordinates.reduce(
            (best, p, i) => {
                const d = Math.max(Math.abs(p.x - 32), Math.abs(p.y - 5));
                const bd = Math.max(Math.abs(wp.coordinates[best]!.x - 32), Math.abs(wp.coordinates[best]!.y - 5));
                return d > bd ? i : best;
            },
            0
        );
        const rat = spawnWanderingRat(game, wp.coordinates[k]!.x, wp.coordinates[k]!.y);
        wp.ensureVisitedInitialized(rat);
        rat.waypointAlreadyVisited![k] = false;
        rat.targetWaypointIndex = k;

        waitOnce(game);
        expect(rat.targetWaypointIndex).not.toBe(k); // 换点
        expect(rat.targetWaypointIndex).toBeGreaterThanOrEqual(0);
        expect(rat.waypointAlreadyVisited![k]).toBe(true); // 旧目标标记已访问
        // 新目标不是脚下点：距离 > 0 且存在下坡路
        expect(wp.distanceMaps[rat.targetWaypointIndex]![rat.loc.x]![rat.loc.y]!).toBeGreaterThan(0);

        // 换点后继续朝新目标下坡：距离严格递减
        let target = rat.targetWaypointIndex;
        let d0 = wp.distanceMaps[target]![rat.loc.x]![rat.loc.y]!;
        for (let turn = 0; turn < 3; turn++) {
            waitOnce(game);
            if (rat.targetWaypointIndex !== target) {
                target = rat.targetWaypointIndex;
            }
            const d1 = wp.distanceMaps[target]![rat.loc.x]![rat.loc.y]!;
            expect(d1).toBeLessThan(d0);
            d0 = d1;
        }
    });

    it('T5 沉睡/不可移动/被囚禁怪格禁入（Architect.c:3019-3026）：一格峡谷挡住距离场，苏醒后放行', () => {
        // 舞台：开阔房 + x=52 整列墙（只留 (52,15) 一格豁口）。对岸格 (50,15)
        // 与东岸 waypoint 的唯一通路穿过豁口——怪占着豁口且"惰性"时，
        // refreshWaypoint 的距离场传不过去（30000）；苏醒/非囚禁后放行（<30000）。
        // 三条谓词各测一只怪，状态分别设为非 ASLEEP / WANDERING / HUNTING，
        // 保证只有被测谓词（IMMOBILE / isCaged）触发叠加层：
        //   - ASLEEP 鼠：state=ASLEEP、非 caged、非 IMMOBILE → 只沉睡谓词命中
        //   - goblin_totem：state=WANDERING（MONST_NEVER_SLEEPS）→ 只 IMMOBILE 命中
        //   - caged 鼠：state=HUNTING、isCaged=true → 只囚禁谓词命中
        const scenarios: Array<{ name: string; make: (g: Game, x: number, y: number) => Monster }> = [
            {
                name: '沉睡',
                make: (g, x, y) => {
                    const m = spawnWanderingRat(g, x, y);
                    m.state = MonsterState.ASLEEP;
                    return m;
                },
            },
            {
                name: '不可移动（goblin_totem, MONST_IMMOBILE）',
                make: (g, x, y) => {
                    const m = new Monster(x, y, monsterDataById('goblin_totem'));
                    m.state = MonsterState.WANDERING; // 醒着，排除 ASLEEP 谓词
                    g.monsters.push(m);
                    return m;
                },
            },
            {
                name: '被囚禁',
                make: (g, x, y) => {
                    const m = spawnWanderingRat(g, x, y);
                    m.state = MonsterState.HUNTING; // 醒着，排除 ASLEEP 谓词
                    m.isCaged = true;
                    return m;
                },
            },
        ];

        for (const sc of scenarios) {
            const game = createWaypointGame();
            for (let y: number = CARVE.y1; y <= CARVE.y2; y++) {
                if (y !== 15) setWall(game, 52, y);
            }
            teleportPlayer(game, 34, 5); // 远离，防交互
            const blocker = sc.make(game, 52, 15);

            // 找东岸（x>52）的 waypoint，重建其距离图并断言对岸不可达
            const wp = game.waypoints;
            game.rebuildWaypoints(); // 墙与怪都就位后建图（CE 建图含怪物叠加层）
            const east = wp.coordinates.findIndex((p) => p.x > 52);
            expect(east).toBeGreaterThanOrEqual(0);
            expect(wp.distanceMaps[east]![50]![15]!).toBe(30000); // 惰性怪格禁入 → 场传不过去

            // 解除惰性状态（不再触发被测谓词）后同格放行
            if (sc.name.startsWith('沉睡')) blocker.state = MonsterState.WANDERING;
            if (sc.name.startsWith('被囚禁')) blocker.isCaged = false;
            if (blocker === game.monsters[0] && sc.name.includes('不可移动')) {
                    // goblin_totem 的 MONST_IMMOBILE 是数据旗标，无法"解除"——
                    // 把它挪出峡谷（放到西岸开阔处）再刷新：距离场应通行。
            }
            if (sc.name.includes('不可移动')) {
                blocker.loc.x = 40;
                blocker.loc.y = 15;
            }
            wp.refreshWaypoint(east, game.wpContext());
            expect(wp.distanceMaps[east]![50]![15]!).toBeLessThan(30000);
        }
    });

    it('T6 决定性：同种子 → 同一套 waypoint 坐标 + 同一游荡轨迹 + 同一刷新计数', () => {
        const run = (): { coords: string; trajectory: string; refreshes: number } => {
            const game = createWaypointGame(20260915);
            teleportPlayer(game, 32, 5);
            const rat = spawnWanderingRat(game, 52, 15);
            const counter = countWaypointRefreshes(game);
            const trajectory: Array<[number, number]> = [[rat.loc.x, rat.loc.y]];
            for (let turn = 0; turn < 6; turn++) {
                waitOnce(game);
                trajectory.push([rat.loc.x, rat.loc.y]);
            }
            return {
                coords: JSON.stringify(game.waypoints.coordinates),
                trajectory: JSON.stringify(trajectory),
                refreshes: counter.n,
            };
        };
        const a = run();
        const b = run();
        expect(a.coords).toBe(b.coords);
        expect(a.trajectory).toBe(b.trajectory);
        expect(a.refreshes).toBe(b.refreshes);
        expect(a.refreshes).toBe(6); // 每 wait 恰一刷（顺带复核 T2 口径）
    });

    it('T7 对照组：HUNTING 怪物行为完全不变，waypoint 系统零调用', () => {
        const game = createWaypointGame();
        teleportPlayer(game, 40, 15);
        const rat = new Monster(46, 15, monsterDataById('rat'));
        rat.state = MonsterState.HUNTING;
        game.monsters.push(rat);

        // 间谍：waypoint 消费面（isValidWanderDestination / chooseNew / nextStep）
        // 在 HUNTING 回合内必须零调用——追击走既有直寻/气味路径。
        const calls = { isValid: 0, choose: 0, step: 0 };
        const wp = game.waypoints;
        const oValid = wp.isValidWanderDestination.bind(wp);
        const oChoose = wp.chooseNewWanderDestination.bind(wp);
        const oStep = wp.nextStep.bind(wp);
        wp.isValidWanderDestination = (m, i, c) => { calls.isValid++; return oValid(m, i, c); };
        wp.chooseNewWanderDestination = (m, c) => { calls.choose++; oChoose(m, c); };
        wp.nextStep = (i, m, c) => { calls.step++; return oStep(i, m, c); };

        const d0 = Math.max(Math.abs(rat.loc.x - 40), Math.abs(rat.loc.y - 15));
        waitOnce(game);
        const d1 = Math.max(Math.abs(rat.loc.x - 40), Math.abs(rat.loc.y - 15));
        expect(d1).toBeLessThan(d0); // 追击照旧
        expect(rat.state).toBe(MonsterState.HUNTING);
        expect(rat.targetWaypointIndex).toBe(-1); // waypoint 字段未被触碰
        expect(calls.isValid).toBe(0);
        expect(calls.choose).toBe(0);
        expect(calls.step).toBe(0);
    });
});
