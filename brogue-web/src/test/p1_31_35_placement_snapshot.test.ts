import { rng } from '../engine/Random';
/// <reference types="node" />
/**
 * src/test/p1_31_35_placement_snapshot.test.ts — P1-31 玩家落位避开楼梯 +
 * P1-35 读档重算 loopMap（及其余生成期派生态）
 *
 * CE 对照（BrogueCE-master/src/brogue，只读）：
 *   落位    RogueMain.c:817-869（先置楼梯位 → 4 邻域找合格格 →
 *           getQualifyingPathLocNear 兜底；方向序 Rogue.h:413-422 UP/DOWN/
 *           LEFT/RIGHT = 北/南/西/东；T_PATHING_BLOCKER Rogue.h:1948）
 *   safety  Time.c:1833-1843 的字面顺序：玩家格修正在前、楼梯禁入在后
 *           （P4-9 曾对调两段，P1-31 落位修复后按回退条件恢复 CE 顺序）
 *   loopMap P1-34 同一不变式的读档面：loopMap ≡ analyzeLoopMap(当前网格)
 *
 * 对抗性断言与各自捕获的错误实现：
 *   T1  旧实现"直接把玩家放上楼梯坐标"——多种子实测出生格地形码必为楼梯 → 红
 *   T2  邻域扫描方向序写错（如 8 邻域序 / 东优先）→ 十字舞台必落北格 → 红
 *   T3  4 邻域全不合格时不做兜底搜索（留在楼梯 / 落墙）→ 密封舞台唯一外环
 *       合格格 → 红
 *   T4  下潜（新层）/爬回（缓存层）两条进层路径仍站楼梯或远离目标楼梯 → 红
 *   T5  P4-9 偏离复发（玩家格修正再挪到楼梯禁入之后）：把玩家摆上楼梯这一
 *       CE 不可达态，CE 顺序必须产出平图 {-111, 30000}、方向率 0——对调后
 *       种子存活、长出梯度 → 红
 *   T6  T8 等价（P4-9 报告的零改造关卡梯度断言，本文件重建）：玩家不站楼梯
 *       的真实关卡必须有梯度与逃跑方向——回退若弄坏正常态 safety map → 红
 *   T7  读档不重算 loopMap（跨局读档：另一局网格 + 另一局残留环路图）→ 红
 *   T8  存档往返：自往返 + 跨局，loopMap 与当前网格重算逐格相等 → 红
 *   T9  读档不重建 waypoint（漫游怪按上一局 waypoint 走）→ 红
 *   T10 读档不重置气味图（嗅觉追踪吃到上一局气味轨迹/turnNumber）→ 红
 *
 * 注：p4_9_safety_map.test.ts 的 T8 内含"出生态站在楼梯上"的舞台自洽断言
 * （第 368-369 行），它锁死的是 P1-31 要消灭的病灶状态，修复后必然翻红；
 * 该文件属既有测试（禁止修改），其梯度核心由本文件 T6 等价重建并保持
 * 绿色——详见 ai_docs/p1_31_35_placement_and_snapshot_report.md。
 */
import { describe, it, expect } from 'vitest';

import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { TerrainType } from '../engine/Map/Grid';
import { safetyNextStep } from '../engine/Map/SafetyMap';
import { analyzeLoopMap } from '../engine/Map/LoopMap';
import type { Pos } from '../types';

/** 测试侧访问口：placePlayerOnLevelEntry / machineCells 是 private，
 *  与 harness.ts 的 GamePrivates 同款只读/定向调用通道（不做逻辑绕过）。 */
type PlacementPrivates = {
    placePlayerOnLevelEntry(target: Pos): void;
    machineCells: Set<number>;
};

function privates(game: Game): PlacementPrivates {
    return game as unknown as PlacementPrivates;
}

function findStair(game: Game, type: TerrainType): Pos | null {
    for (let x = 0; x < game.grid.width; x++) {
        for (let y = 0; y < game.grid.height; y++) {
            if (game.grid.getCell(x, y)?.terrain === type) return { x, y };
        }
    }
    return null;
}

function isStairs(terrain: TerrainType | undefined): boolean {
    return terrain === TerrainType.STAIRS_UP || terrain === TerrainType.STAIRS_DOWN;
}

/** CE Rogue.h:413-422 的 UP/DOWN/LEFT/RIGHT → 北/南/西/东。 */
const DIRS4: ReadonlyArray<readonly [number, number]> =
    [[0, -1], [0, 1], [-1, 0], [1, 0]];

function orthogonalAdjacent(game: Game, loc: Pos, type: TerrainType): boolean {
    return DIRS4.some(([dx, dy]) =>
        game.grid.getCell(loc.x + dx!, loc.y + dy!)?.terrain === type);
}

/** T8/T6 同款的势场健康度：不同取值数、可达格数、有下坡方向的可达格数。 */
function fieldHealth(game: Game): { values: Set<number>; reachable: number; withDir: number } {
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
    return { values, reachable, withDir };
}

/** 全图逐格对比 game.loopMap 与当前网格的重算结果，返回不一致格。 */
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

describe('P1-31: 进层落位避开楼梯（CE RogueMain.c:817-869）', () => {
    it('T1 出生态不站楼梯：多种子地形码实测，格可通行、无怪、与楼梯正交邻接', () => {
        // 捕获的错误实现：populateLevel 直接 this.player.loc = 楼梯坐标
        //（改动前的原实现）——5 个种子的出生格地形码会全部是 13（STAIRS_UP，
        // 验收探针的原始观察）。
        for (const seed of [42, 777, 1, 20260915, 271828]) {
            const game = createHeadlessGame(seed, 'normal');
            const { x, y } = game.player.loc;
            const terrain = game.grid.getCell(x, y)?.terrain;
            expect(isStairs(terrain), `seed ${seed}: 出生格 ${x},${y} 地形码 ${terrain}`).toBe(false);
            // CE 合格条件是 !T_PATHING_BLOCKER：草地/浅水/门都合格，不必是 FLOOR。
            expect(game.grid.getCell(x, y)?.isPassable, `seed ${seed}: 出生格不可通行`).toBe(true);
            expect(game.getMonsterAt(x, y), `seed ${seed}: 出生格有怪`).toBeUndefined();
            // CE 落位只在 4 邻域/兜底搜索里选格，正常地图下与目标楼梯
            // 切比雪夫距离 ≤ 1（兜底属病态地形，正常种子不该触发）。
            const up = findStair(game, TerrainType.STAIRS_UP);
            expect(up).not.toBeNull();
            const cheb = Math.max(Math.abs(x - up!.x), Math.abs(y - up!.y));
            expect(cheb, `seed ${seed}: 出生点距楼梯 ${cheb} > 1`).toBeLessThanOrEqual(1);
        }
    });

    it('T2 方向序 = CE Rogue.h:413-422（北>南>西>东）：十字舞台必落北格', () => {
        const game = createHeadlessGame(42, 'normal');
        game.monsters = [];
        privates(game).machineCells = new Set();
        // 十字舞台：目标格置楼梯，4 邻域全为地板且全部合格——
        // CE 按 dir=0..3 扫描，第一个合格格是北邻。
        const cx = 40;
        const cy = 10;
        game.grid.setTerrain(cx, cy, TerrainType.STAIRS_UP, '<', 0xffaa00);
        for (const [dx, dy] of DIRS4) {
            game.grid.setTerrain(cx + dx!, cy + dy!, TerrainType.FLOOR, '.', 0x888888);
        }
        privates(game).placePlayerOnLevelEntry({ x: cx, y: cy });
        expect(game.player.loc.x).toBe(cx);
        expect(game.player.loc.y).toBe(cy - 1); // 北邻（dir=0）
    });

    it('T3 4 邻域全不合格 → 兜底搜索：密封舞台唯一合格格在外环，必被找到', () => {
        const game = createHeadlessGame(42, 'normal');
        game.monsters = [];
        privates(game).machineCells = new Set();
        const stair = findStair(game, TerrainType.STAIRS_UP)!; // vestibule (39,14)
        // 密封舞台：5×5 全墙，只留中心（楼梯目标）与北侧距离 2 的一格地板。
        // 4 邻域全墙 → 主路径失败；dijkstra 路径域也被墙封死 → 落到路径无关
        // 的环形兜底；r=2 环内唯一合格格 = (stair.x, stair.y-2)。
        const escape: Pos = { x: stair.x, y: stair.y - 2 };
        for (let dx = -2; dx <= 2; dx++) {
            for (let dy = -2; dy <= 2; dy++) {
                if (dx === 0 && dy === 0) continue;
                if (dx === 0 && dy === -2) continue;
                game.grid.setTerrain(stair.x + dx!, stair.y + dy!, TerrainType.WALL, '#', 0x555555);
            }
        }
        game.grid.setTerrain(escape.x, escape.y, TerrainType.FLOOR, '.', 0x888888);

        // 错误实现一：4 邻域失败后放弃 → 玩家留在楼梯上。
        // 错误实现二：把 escape 直接当地板铺开 → 落点仍是楼梯格。
        privates(game).placePlayerOnLevelEntry(stair);
        expect(game.player.loc.x).toBe(escape.x);
        expect(game.player.loc.y).toBe(escape.y);
        expect(isStairs(game.grid.getCell(game.player.loc.x, game.player.loc.y)?.terrain)).toBe(false);
    });

    it('T4 真实下潜/爬回两条进层路径：落位不站楼梯且正交邻接目标楼梯', () => {
        const game = createHeadlessGame(42, 'normal');
        // 下潜：新层路径（populateLevel 末尾落位， monsters 已布设——HAS_MONSTER
        // 排除项在 CE 时序下有数据）。
        const down = findStair(game, TerrainType.STAIRS_DOWN);
        expect(down).not.toBeNull();
        game.player.loc.x = down!.x;
        game.player.loc.y = down!.y;
        game.handlePlayerAction('stairs_down', undefined, 'system');
        expect(game.depth).toBe(2);
        const d1 = game.player.loc;
        expect(isStairs(game.grid.getCell(d1.x, d1.y)?.terrain), '下潜后站楼梯上').toBe(false);
        expect(game.grid.getCell(d1.x, d1.y)?.isPassable).toBe(true);
        const up2 = findStair(game, TerrainType.STAIRS_UP);
        expect(up2).not.toBeNull();
        expect(orthogonalAdjacent(game, d1, TerrainType.STAIRS_UP),
            `下潜落位 (${d1.x},${d1.y}) 不与上层楼梯正交邻接`).toBe(true);

        // 爬回：缓存层路径（generateDepth cached 分支落位）。
        game.player.loc.x = up2!.x;
        game.player.loc.y = up2!.y;
        game.handlePlayerAction('stairs_up', undefined, 'system');
        expect(game.depth).toBe(1);
        const d0 = game.player.loc;
        expect(isStairs(game.grid.getCell(d0.x, d0.y)?.terrain), '爬回后站楼梯上').toBe(false);
        expect(orthogonalAdjacent(game, d0, TerrainType.STAIRS_DOWN),
            `爬回落位 (${d0.x},${d0.y}) 不与下层楼梯正交邻接`).toBe(true);
    });
});

describe('P1-31 回退 P4-9 偏离后的 safety map（Time.c:1833-1843 顺序）', () => {
    it('T5 CE 不可达态锁死：玩家被摆上楼梯 → CE 顺序必然平图 {-111,30000}、方向率 0', () => {
        // 玩家站楼梯时，后行的楼梯禁入会把唯一种子的代价打回 -1——这正是
        // CE 的字面行为（该状态被 RogueMain.c:839-869 的落位保证不可达）。
        // 锁死两类错误实现：
        //   - P4-9 偏离复发（玩家格修正挪到楼梯禁入之后）：种子存活 → 长出
        //     梯度 → values.size === 2 翻红；
        //   - "聪明"的再修正（跳过玩家所在楼梯的禁入）：同样长出梯度 → 红。
        for (const seed of [42, 20260915]) {
            const game = createHeadlessGame(seed, 'normal');
            const stair = findStair(game, TerrainType.STAIRS_UP)!;
            game.player.loc.x = stair.x;
            game.player.loc.y = stair.y;
            game.updateSafetyMap();
            const { values } = fieldHealth(game);
            // 平图的签名：种子死亡后全图只剩 30000→150→f(150)=37→×-3=-111 的
            // 环境值（环路井经第二段扫描在 -111 以下再衰减出 -112..-121，仍在
            // -111 及以下）；玩家格 monsterCost 禁入 → 终局回写 30000。
            // 关键判别式：没有任何格子高于 -111——若 P4-9 偏离复发（玩家格
            // 修正挪回楼梯禁入之后），玩家重新成为种子，近场长出 0/-3/-6 的
            // 梯度，本断言立即翻红。
            expect(values.has(-111), `seed ${seed}: 平图必须含环境值 -111，实测 ${[...values]}`).toBe(true);
            for (const v of values) {
                expect(v === 30000 || v <= -111, `seed ${seed}: 出现高于环境值的 ${v}——种子存活，平图签名破坏`).toBe(true);
            }
        }
    });

    it('T6 T8 等价（P4-9 零改造关卡梯度断言）：玩家不站楼梯的真实关卡必有梯度', () => {
        // P4-9 报告的回退条件验证：恢复 CE 顺序后，正常态（玩家不站楼梯，
        // P1-31 保证）的 safety map 不退化。p4_9_safety_map.test.ts 的 T8 因
        // 其舞台自洽断言（"出生态站楼梯"）与 P1-31 直接冲突而必然翻红且
        // 文件冻结，此处按同一判据重建梯度核心（取值数 ≥ 10、可达域 > 100、
        // 方向率 > 0.5）。
        for (const seed of [42, 20260915]) {
            const game = createHeadlessGame(seed, 'normal');
            const { x, y } = game.player.loc;
            expect(isStairs(game.grid.getCell(x, y)?.terrain),
                `seed ${seed}: 前提——修复后玩家不应站在楼梯上`).toBe(false);

            game.updateSafetyMap();
            const { values, reachable, withDir } = fieldHealth(game);
            expect(values.size, `seed ${seed}: 平图（取值 ${values.size}）`).toBeGreaterThanOrEqual(10);
            expect(reachable, `seed ${seed}: 可达域塌缩`).toBeGreaterThan(100);
            expect(withDir / reachable, `seed ${seed}: 方向率 ${withDir}/${reachable}`).toBeGreaterThan(0.5);
        }
    });
});

describe('P1-35: 读档后的生成期派生态（loopMap / waypoint / 气味）', () => {
    it('T7 跨局读档：loopMap 必须与读入网格的 analyzeLoopMap 逐格相等', () => {
        const a = createHeadlessGame(42, 'normal');
        // 是否存在环路不是读档合同的前提；下方必异污染格足以让漏重算翻红。
        const snap = a.toSnapshot();
        const b = createHeadlessGame(777, 'normal');
        // 人工污染一个确定格：错误实现“不重算”必然保留该陈值，
        // 不再借两张随机地图恰好不同来搭舞台。
        const expected = analyzeLoopMap(a.grid);
        b.loopMap[0]![0] = !expected[0]![0];
        expect(b.loopMap[0]![0], '人工陈值应与目标网格的重算值相反').not.toBe(expected[0]![0]);
        expect(staleLoopCells(b)).toContain('0,0'); // 边界格不可能是环路，与两局 seed 无关

        expect(b.loadSnapshot(snap)).toBe(true);
        expect(staleLoopCells(b)).toEqual([]);
    });

    it('T8 存档往返：自往返 + 跨局，loopMap 与重算结果逐格相等', () => {
        // 自往返
        const a = createHeadlessGame(42, 'normal');
        expect(a.loadSnapshot(a.toSnapshot())).toBe(true);
        expect(staleLoopCells(a)).toEqual([]);

        // 跨局往返（读档方的网格整体被替换）
        const c = createHeadlessGame(20260915, 'normal');
        const b = createHeadlessGame(777, 'normal');
        expect(b.loadSnapshot(c.toSnapshot())).toBe(true);
        expect(staleLoopCells(b)).toEqual([]);
    });

    it('T9 跨局读档：waypoint 必须已按读入网格重建（与显式重建一致且非空）', () => {
        const a = createHeadlessGame(42, 'normal');
        // U02b: rebuilding consumes the live stream. Pin the explicit rebuild
        // to the same input RNG as the original construction, not the later save point.
        let waypointInput = rng.getState();
        const rebuild = a.rebuildWaypoints.bind(a);
        a.rebuildWaypoints = () => { waypointInput = rng.getState(); rebuild(); };
        a.startNewGame({ seed: 42 });
        const snap = a.toSnapshot();
        const b = createHeadlessGame(777, 'normal');
        // 注入重建绝不可能产生的越界 sentinel，代替两局随机 waypoint
        // 坐标必须巧合不同的前提。
        b.waypoints.coordinates = [{ x: -1, y: -1 }];
        b.waypoints.count = 1;
        const staleCoords = JSON.stringify(b.waypoints.coordinates);

        expect(b.loadSnapshot(snap)).toBe(true);
        expect(b.waypoints.count).toBeGreaterThan(0);
        const afterLoad = JSON.stringify(b.waypoints.coordinates);
        // 先检查读档覆盖 sentinel，避免显式重建掩盖失败或先在幂等锚报错。
        expect(afterLoad, '读档后仍保留越界 sentinel waypoint').not.toBe(staleCoords);
        rng.setState(waypointInput);
        b.rebuildWaypoints(); // 同一网格、实体、RNG 输入的重建结果必须相等
        expect(JSON.stringify(b.waypoints.coordinates)).toBe(afterLoad);
    });

    it('T10 跨局读档：气味图重置（turnNumber 复位、陈局气味轨迹清零）', () => {
        const a = createHeadlessGame(42, 'normal');
        const snap = a.toSnapshot();
        const b = createHeadlessGame(777, 'normal');

        // 双方都在同一坐标留下各自的气味痕迹；读档后该格必须是 0。
        const px = b.player.loc.x;
        const py = b.player.loc.y;
        a.scent.turnNumber = 7000;
        a.scent.addScent(a.grid, px, py, 0);
        b.scent.turnNumber = 9000;
        b.scent.addScent(b.grid, px, py, 0);
        expect(b.scent.get(px, py)).toBe(9000); // 舞台自洽

        expect(b.loadSnapshot(snap)).toBe(true);
        expect(b.scent.turnNumber, 'turnNumber 未随读档复位').toBe(1000);
        expect(b.scent.get(px, py), '上一局的气味轨迹残留').toBe(0);
    });
});
