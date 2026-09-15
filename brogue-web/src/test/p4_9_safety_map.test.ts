/// <reference types="node" />
/**
 * src/test/p4_9_safety_map.test.ts — P4-9：safety map（怪物逃跑寻路）
 *
 * CE 对照（BrogueCE-master/src/brogue，只读）：
 *   updateSafetyMap Time.c:1791-1932 / resetDistanceCellInGrid Time.c:1808-1822 /
 *   fleeingMonsterAwareOfPlayer Monsters.c:2360-2378 / getSafetyMap Monsters.c:2380-2400 /
 *   消费点 nextStep(getSafetyMap(monst), loc, NULL, true) Monsters.c:3503 /
 *   每回合闩锁 Time.c:2616-2626 / PDS 常量 Rogue.h:2782-2783（-1/-2）。
 *
 * 对抗性断言与各自捕获的错误实现：
 *   T1  死胡同（本轮价值所在）：贪心"切比雪夫最远邻格"实现必然钻进死胡同口
 *       （测试内复刻旧贪心逻辑证明陷阱必然触发）；safety map 实现必须南下逃走
 *   T2  `*= -3` 符号写反（怪物朝玩家跑）与漏掉饱和压缩 50*v/(50+v)——
 *       密封走廊的图值必须精确等于解析解 27-x
 *   T3  漏掉 IN_LOOP -= 10（环路偏好）——注入 isInLoop 谓词，对比有无环路
 *       的精确值差（含经第二次扫描传播到非环路格的间接差）
 *   T4  惰性更新失效——计数器断言一回合内只重算一次（CE Time.c:2616 闩锁 +
 *       Time.c:2618-2626 可见逃跑怪的主动预更新 break）
 *   T5  察觉不到玩家的逃跑者用了实时图而非私有快照（Monsters.c:2380-2400 双路径，
 *       含察觉后释放快照）
 *   T6  对照组：非逃跑状态的怪物行为完全不变（不触发 safety map、追击照旧）
 *   T7  决定性：同种子同局面 → 全图逐格相等 + 轨迹逐位相等（链路零随机）
 *   T8  真实关卡势场（验收打回锁死）：未改造的生成关卡 + 玩家站在开局楼梯上
 *       （打回探针的原场景）→ 全图取值数 ≥ 10 且多数可达格有逃跑方向。
 *       捕获的两类错误实现：种子死亡导致的全图平化（2 种取值）；
 *       第二段扫描漏加松弛代价（全局最小值铺满全图，取值同样塌缩）
 *
 * 舞台注意：waitOnce 会置位 justRested → stealthRange 减半（4）→ 逃跑皮筋
 * 缩到 6。T1/T7 用移动动作（不置位 justRested，皮筋 9）并把怪物轨迹设计在
 * 皮筋内；皮筋外怪物会被既有状态机切回 WANDERING（本轮不动的退出条件）。
 */
import { describe, it, expect } from 'vitest';

import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import { TerrainType } from '../engine/Map/Grid';
import { buildSafetyMap, safetyNextStep } from '../engine/Map/SafetyMap';
import monstersJson from '../data/monsters.json';

const CARVE = { x1: 30, y1: 4, x2: 74, y2: 26 } as const;

function monsterDataById(id: string): MonsterData {
    const row = monstersJson.find((m) => m.id === id);
    if (!row) throw new Error(`monsters.json 中找不到 ${id}`);
    return row as unknown as MonsterData;
}

/** test 模式底座：无周期刷怪；在纯花岗岩区刻出测试房间并清空房间怪/物。 */
function createSafetyGame(seed = 20260915): Game {
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

function waitOnce(game: Game): void {
    game.handlePlayerAction('wait', undefined, 'system');
}

function moveOnce(game: Game, dx: number, dy: number): void {
    game.handlePlayerAction('move', { x: dx, y: dy }, 'system');
}

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
    return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/** rat：速度 100、无 bolts、无行为标志——最朴素的追逐/逃跑者。
 *  关回血（regenTurns=0）防止回血把 hp 抬过 75% 退出线。 */
function spawnFleeingRat(game: Game, x: number, y: number): Monster {
    const mon = new Monster(x, y, monsterDataById('rat'));
    mon.state = MonsterState.FLEEING;
    mon.regenTurns = 0;
    mon.hp = Math.max(1, Math.floor(mon.maxHp * 0.5)); // >25% 进入线下、<=75% 退出线上
    game.monsters.push(mon);
    return mon;
}

/** 旧实现（改动前 Monster.ts 逃跑分支）的逐字复刻：贪心走向切比雪夫最远邻格。 */
function greedyFleeChoice(game: Game, mx: number, my: number): { x: number; y: number } | null {
    let bestScore = -Infinity;
    let bestCell: { x: number; y: number } | null = null;
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            const nx = mx + dx;
            const ny = my + dy;
            const c = game.grid.getCell(nx, ny);
            if (c && c.isPassable && !game.getMonsterAt(nx, ny) &&
                !(game.player.loc.x === nx && game.player.loc.y === ny)) {
                const dist = chebyshev(nx, ny, game.player.loc.x, game.player.loc.y);
                if (dist > bestScore) {
                    bestScore = dist;
                    bestCell = { x: nx, y: ny };
                }
            }
        }
    }
    return bestCell;
}

function countSafetyUpdates(game: Game): { n: number } {
    const counter = { n: 0 };
    const orig = game.updateSafetyMap.bind(game);
    (game as unknown as { updateSafetyMap: () => void }).updateSafetyMap = () => {
        counter.n++;
        orig();
    };
    return counter;
}

describe('P4-9: safety map（怪物逃跑寻路）', () => {
    it('T1 死胡同：贪心实现钻进死胡同口（陷阱实证），safety map 实现沿正确路线南下', () => {
        const game = createSafetyGame();
        // 地形（在开阔房间上布置）：
        //   玩家 (52,15)；怪物起点 (58,15)（T 字路口，皮筋内：d=6 ≤ 9）。
        //   死胡同：东向浅袋 (59,15)(60,15)，(61,15) 封口，y=14/16 的 59..61 封墙；
        //   正确逃生线：南下开阔区（越南离玩家越远、深水场越深）。
        //   y=14 的 54..58 封墙：堵死北上，把选择逼成"东（死胡同）vs 南（正确）"。
        for (let x = 54; x <= 58; x++) setWall(game, x, 14);
        for (let x = 59; x <= 61; x++) {
            setWall(game, x, 14);
            setWall(game, x, 16);
        }
        setWall(game, 61, 15);
        teleportPlayer(game, 52, 15);
        const rat = spawnFleeingRat(game, 58, 15);

        // 陷阱实证：旧贪心实现在起点必然选择死胡同口 (59,15)（切比雪夫 7 > 南下线 6）
        const greedy = greedyFleeChoice(game, 58, 15);
        expect(greedy).not.toBeNull();
        expect(greedy!.x).toBe(59);
        expect(greedy!.y).toBe(15);

        // safety map 实现：南下（第一步行向由图值决定，实测为正南 (58,16)），
        // 绝不踏入 y=15 的 x>=59 死胡同段。玩家东西微调（不置位 justRested），
        // 使怪物全程留在皮筋（stealth+2=9）内、持续处于 FLEEING。
        const trajectory: Array<[number, number]> = [[rat.loc.x, rat.loc.y]];
        for (let turn = 0; turn < 4; turn++) {
            moveOnce(game, turn % 2 === 0 ? -1 : 1, 0);
            trajectory.push([rat.loc.x, rat.loc.y]);
            if (rat.state !== MonsterState.FLEEING) break; // 跑出皮筋即停（既有退出条件）
        }
        for (const [x, y] of trajectory) {
            expect(!(x >= 59 && y === 15)).toBe(true); // 任何时刻不进死胡同
        }
        expect(trajectory[1]![1]).toBe(16); // 第一步：向南（正确逃生线），不是东（死胡同口）
        expect(trajectory[2]![1]).toBeGreaterThan(trajectory[1]![1]); // 继续向南
        expect(trajectory[3]![1]).toBeGreaterThan(trajectory[2]![1]);
    });

    it('T2 双重扫描 + 数值变换的解析解：密封走廊值 = 27-x；符号反/漏饱和全灭', () => {
        const game = createSafetyGame();
        // 密封 arena：整房填墙，只留 y=15 的 x∈[43..57] 一条走廊，玩家在 (44,15)。
        // 唯一"深水井"是东端 (57,15)：d=13 → 饱和 f(13)=50*13/63=10（截断）→ ×-3 = -30。
        // 第二次扫描把井向西段全廊传播（逐格 +1 路程）：值 = -30 + (57-x) = 27-x。
        // 玩家格本身 monsterCost 禁入 → 终局循环回写 30000（Time.c:1930-1935）。
        for (let x = CARVE.x1; x <= CARVE.x2; x++) {
            for (let y = CARVE.y1; y <= CARVE.y2; y++) {
                setWall(game, x, y);
            }
        }
        for (let x = 43; x <= 57; x++) {
            game.grid.setTerrain(x, 15, TerrainType.FLOOR, '.', 0x888888);
        }
        teleportPlayer(game, 44, 15);
        game.updateSafetyMap();

        const m = game.safetyMap;
        expect(m[57]![15]).toBe(-30); // 井底：f(13)=10 → -30
        expect(m[56]![15]).toBe(-29);
        expect(m[50]![15]).toBe(-23); // 27-50
        expect(m[45]![15]).toBe(-18); // 27-45
        // (43,15) 在玩家格西侧：玩家格 monsterCost 禁入，井的场传不过去，
        // 保持自身变换值 f(1)=0 → 0（CE 语义：怪物的"路程"绕不开玩家所在格）。
        // JS 的 0*-3 是 -0，用 === 0 断言（Object.is 区分 ±0，toBe 会失败）。
        expect(m[43]![15] === 0).toBe(true);
        // 玩家格：monsterCost 禁入 → 30000
        expect(m[44]![15]).toBe(30000);
        // 墙：monsterCost 禁入 → 30000
        expect(m[44]![14]).toBe(30000);
        expect(m[58]![15]).toBe(30000);
        // 符号写反（*= +3）：井底 +30；漏饱和（-3*d）：井底 -39、(45) -39+12=-27 ≠ -18——
        // 上面的精确断言把两种错误实现同时杀死。
    });

    it('T3 IN_LOOP -=10（Time.c:1925-1927）：环路格直接减 10，且经第二次扫描传到非环路格', () => {
        const game = createSafetyGame();
        for (let x = CARVE.x1; x <= CARVE.x2; x++) {
            for (let y = CARVE.y1; y <= CARVE.y2; y++) {
                setWall(game, x, y);
            }
        }
        for (let x = 43; x <= 57; x++) {
            game.grid.setTerrain(x, 15, TerrainType.FLOOR, '.', 0x888888);
        }
        teleportPlayer(game, 44, 15);

        const ctx = {
            grid: game.grid,
            playerX: 44,
            playerY: 15,
            playerLevitating: false,
            playerImmuneToFire: false,
            monsterAt: () => undefined,
            isInLoop: (x: number) => x >= 51, // 东半段"环路"
        };
        const withLoop = buildSafetyMap(ctx);
        const noLoop = buildSafetyMap({ ...ctx, isInLoop: () => false });

        // 井底在环路内：-30 - 10 = -40（CE 顺序：饱和 → ×-3 → -=10）
        expect(withLoop[57]![15]).toBe(-40);
        expect(noLoop[57]![15]).toBe(-30);
        // 环路邻格：先被自身 -10 压低，再被井的二次扫描拉到 -39
        expect(withLoop[56]![15]).toBe(-39);
        // 非环路格的间接差：井被加深 10 后，第二次扫描把西段也整体压低 10
        expect(withLoop[45]![15]).toBe(-28); // -40 + 12
        expect(noLoop[45]![15]).toBe(-18); // 27-45
        // 漏掉 -=10 的错误实现会让 withLoop 与 noLoop 全图相等
        expect(withLoop[50]![15]).toBe(-33);
        expect(noLoop[50]![15]).toBe(-23);
    });

    it('T4 惰性更新（Time.c:2616 闩锁 + 2618-2626 主动预更新 break）：一回合恰好一次', () => {
        const game = createSafetyGame();
        teleportPlayer(game, 52, 15);
        // 三只可见逃跑怪：CE 的主动预更新只认第一只（break），本回合其余全复用
        spawnFleeingRat(game, 56, 16);
        spawnFleeingRat(game, 57, 15);
        spawnFleeingRat(game, 56, 14);
        const counter = countSafetyUpdates(game);

        waitOnce(game); // 回合开始：清闩锁 → 主动预更新一次 → 三只怪行动全复用
        expect(counter.n).toBe(1);

        waitOnce(game); // 下一回合：再一次
        expect(counter.n).toBe(2);

        // "每只怪各算一张"的错误实现第一回合就得 ≥3；"挂在客观块/从不重算"得 0。
    });

    it('T5 察觉不到玩家的逃跑者用私有快照（Monsters.c:2380-2400 双路径），察觉后释放', () => {
        const game = createSafetyGame();
        // x=45 竖墙（y∈[13..17]）挡 LOS：怪物 (46,15) 在墙后、不在玩家 FOV；
        // 再用 (46,14)(47,14)(47,15)(47,16)(46,16) 把怪物完全围死——它每回合
        // 都会走快照路径调 getSafetyMap，但无下坡格可走（原地），皮筋稳定。
        for (let y = 13; y <= 17; y++) setWall(game, 45, y);
        setWall(game, 46, 14);
        setWall(game, 47, 14);
        setWall(game, 47, 15);
        setWall(game, 47, 16);
        setWall(game, 46, 16);
        teleportPlayer(game, 40, 15);
        const rat = spawnFleeingRat(game, 46, 15);
        const counter = countSafetyUpdates(game);
        expect(game.grid.getCell(46, 15)?.isVisible).toBe(false); // 舞台自洽：确实看不见

        waitOnce(game); // 回合1：无主动预更新（不可见）；怪行动 → 快照路径惰性构建
        expect(counter.n).toBe(1);
        const snapshot = rat.safetySnapshot;
        expect(snapshot).not.toBeNull();

        // 回合2：世界变了（玩家挪位），但怪仍察觉不到 → 复用快照，绝不重算
        teleportPlayer(game, 40, 14);
        waitOnce(game);
        expect(counter.n).toBe(1); // 没有第二次重算
        expect(game.updatedSafetyMapThisTurn).toBe(false); // 闩锁未被打开
        expect(rat.safetySnapshot).toBe(snapshot); // 还是同一张（同一引用，未释放未重建）

        // 察觉（贴脸 + 可见）→ CE 释放快照、改用实时图
        teleportPlayer(game, 40, 14);
        rat.loc.x = 41;
        rat.loc.y = 14;
        game.fov.computeFOV(40, 14, 10);
        expect(game.grid.getCell(41, 14)?.isVisible).toBe(true); // 舞台自洽：现在看得见
        waitOnce(game);
        expect(rat.safetySnapshot).toBeNull(); // CE freeGrid：察觉即释放
        expect(counter.n).toBe(2); // 本回合主动预更新（可见逃跑怪）发生过一次
    });

    it('T6 对照组：非逃跑状态不碰 safety map，行为与改动前一致', () => {
        const game = createSafetyGame();
        teleportPlayer(game, 40, 15);
        const rat = new Monster(44, 15, monsterDataById('rat'));
        rat.state = MonsterState.HUNTING;
        game.monsters.push(rat);
        const counter = countSafetyUpdates(game);

        const d0 = chebyshev(rat.loc.x, rat.loc.y, 40, 15);
        waitOnce(game);
        const d1 = chebyshev(rat.loc.x, rat.loc.y, 40, 15);
        expect(d1).toBeLessThan(d0); // 追击照旧（直寻/气味路径，非 safety map）
        expect(counter.n).toBe(0); // 全回合零次 safety map 构建
        expect(rat.state).toBe(MonsterState.HUNTING);
    });

    it('T7 决定性：同种子同局面 → 全图逐格相等 + 轨迹逐位相等（链路零随机）', () => {
        const run = (): { hash: number; trajectory: string } => {
            const game = createSafetyGame(20260915);
            for (let x = 54; x <= 58; x++) setWall(game, x, 14);
            for (let x = 59; x <= 61; x++) {
                setWall(game, x, 14);
                setWall(game, x, 16);
            }
            setWall(game, 61, 15);
            teleportPlayer(game, 52, 15);
            const rat = spawnFleeingRat(game, 58, 15);
            const trajectory: Array<[number, number]> = [];
            for (let turn = 0; turn < 4; turn++) {
                moveOnce(game, turn % 2 === 0 ? -1 : 1, 0);
                trajectory.push([rat.loc.x, rat.loc.y]);
            }
            game.updateSafetyMap();
            let hash = 2166136261;
            for (let x = 30; x <= 74; x++) {
                for (let y = 4; y <= 26; y++) {
                    hash = ((hash ^ game.safetyMap[x]![y]!) * 16777619) >>> 0;
                }
            }
            return { hash, trajectory: JSON.stringify(trajectory) };
        };
        const a = run();
        const b = run();
        expect(a.hash).toBe(b.hash);
        expect(a.trajectory).toBe(b.trajectory);
    });

    it('T8 真实关卡势场：玩家站在开局楼梯上（打回原场景）也必须有梯度与逃跑方向', () => {
        // 背景（验收打回）：验收探针实测全图只有 30000 / -111 两个值、
        // 60 个可达格 0 个有方向。根因：web 玩家开局站在 STAIRS_UP 上，
        // 而楼梯禁入赋值在玩家格修正之后执行，把唯一种子（cost=1, dist=0）
        // 打回 -1，第一段扫描在 cost>0 的种子条件下零入队、零传播，
        // 30000 → 150 → f(150)=37 → ×-3 = -111 铺满可达域。
        //
        // 与 T1/T2 的本质区别：不做任何地形改造、不传送玩家——normal 模式
        // 真实生成的关卡 + 出生态。T1/T2 的舞台会把玩家脚下的楼梯一并
        // 刻成地板，恰好永远踩不中这个数据状态（漏检原因，详见报告）。
        //
        // 锁死两类错误实现：
        //   - 种子死亡（打回的实现）：全图塌缩到 {30000, -111} 两种取值、方向率 0；
        //   - 第二段扫描漏加松弛代价（min(cell, neighbor) 无 +cost）：全局最小值
        //     铺满可达域，取值数同样塌缩到个位数——两处都过不了 ≥10 这条线。
        for (const seed of [42, 20260915]) {
            const game = createHeadlessGame(seed); // normal 模式：真实生成，零改造
            const px = game.player.loc.x;
            const py = game.player.loc.y;

            // 舞台自洽：web 玩家出生态就站在楼梯上（放置偏差，报告登记）——
            // 这正是打回探针的场景，梯度必须在此状态下成立。
            const startTerrain = game.grid.getCell(px, py)?.terrain;
            expect(startTerrain === TerrainType.STAIRS_UP || startTerrain === TerrainType.STAIRS_DOWN).toBe(true);

            game.updateSafetyMap(); // 走真实接线（CE Time.c:1791 updateSafetyMap）
            const m = game.safetyMap;

            const values = new Set<number>();
            let reachable = 0;
            let withDir = 0;
            for (let x = 1; x < game.grid.width - 1; x++) {
                for (let y = 1; y < game.grid.height - 1; y++) {
                    values.add(m[x]![y]!);
                    if (m[x]![y] !== 30000 && game.grid.getCell(x, y)?.isPassable) {
                        reachable++;
                        if (safetyNextStep(m, game.grid, x, y)) withDir++;
                    }
                }
            }

            expect(values.size).toBeGreaterThanOrEqual(10); // 平图 = 2
            expect(reachable).toBeGreaterThan(100); // 可达域不可忽略（密封走廊冒充不了真实关卡）
            expect(withDir / reachable).toBeGreaterThan(0.5); // 多数可达格给得出下坡方向；平图 = 0
        }
    });
});
