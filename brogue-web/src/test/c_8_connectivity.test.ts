/// <reference types="node" />
/**
 * src/test/c_8_connectivity.test.ts — C-8：generateTerrain 连通性漏洞
 * （生成期 DF 放置否决缺 web 移动图口径）
 *
 * 诊断结论（数据与阶段表见 ai_docs/C-8_report.md）：
 *   - 坏层机制：runAutogenerators(false)（CE digDungeon 第 7 步）里
 *     DF_CRYSTAL_WALL（Globals.c:607，autoGenerator 表 GlobalsBrogue.c:115
 *     的 index 1）的传播足迹把已连通的关卡切成两块——seed12/D25 实测
 *     (38,9) 处 7 格足迹（草×1/地板×2/浅水×2/深水×1/墙×1）在 web 移动图上
 *     把 808 格干地切成 436/367，上/下行楼梯分居两块 → 卡死局。
 *     30 seed × D1-D26 扫描（修复前）恰此 1 例；闸门 15 seed 未含 seed 12，
 *     故 main 上的"坏层=0"是 seed 集运气（与「挑 seed 的测试」同型）。
 *   - 根因：spawnDungeonFeature 的连通性否决（CE :3377-3381 的 blocking
 *     条件）只跑 CE 判据 levelIsDisconnectedWithBlockingMap
 *     （Architect.c:3137-3198）。它的通行口径 cellIsPassableOrDoor
 *     （Architect.c:48-55）把 CHASM/LAVA/TRAP 算 T_PATHING_BLOCKER 阻挡；
 *     在该口径下被切远的远侧"本是孤岛、不贴带、不成 zone"，相位 1 无种子、
 *     相位 3 无相触 → 放行。web 移动图（canMoveTo ∪ SECRET_DOOR，8 向）
 *     里 CHASM/LAVA 可走，同一足迹是真实切断。
 *   - 修复：spawnDungeonFeature 的 blocking 否决改为 CE 判据与
 *     levelIsDisconnectedOnMovementGraph（web 移动图同形三相位）**并列加严**，
 *     任一判切断即否决。两查都是纯泛洪、**零 RNG 消耗**；未切断的层上
 *     放置行为零变化 → 生成期 RNG 流与 generation_baseline 不受影响。
 *
 * 对抗清单（每条注明被捕获的错误实现）：
 *   AD1  否决只跑 CE 判据（= 修复前形态）→ T3 壕沟夹具（spawn 级）
 *   AD2  移动图判据丢掉密门口径（plain terrainAllowsMove）→ T-AD2 密门夹具
 *   AD3  分区/漫带/相触退化成 4 向（CE 方向数）→ T-AD3 对角咽喉夹具
 *   AD4  否决一刀切（"贴带但未切断"的放置也被拒）→ T-AD4 隔墙双室夹具
 *   AD5  否决路径偷耗 RNG（重掷/补掷）→ T4 零消耗哨兵
 * 反向验证：真实失败输出见 ai_docs/C-8_report.md（否决接线回退为只跑
 * CE 判据后，T1/T2/T3/T-AD3 全部翻红；还原后全绿；仓库内无还原标记残留）。
 */
import { describe, it, expect } from 'vitest';

import { createHeadlessGame } from './harness';
import { rng } from '../engine/Random';
import { DungeonLayer, Grid, TerrainType } from '../engine/Map/Grid';
import type { Pos } from '../types';
import {
    spawnDungeonFeature,
    levelIsDisconnectedWithBlockingMap,
    levelIsDisconnectedOnMovementGraph,
    createSpawnMap,
    type DungeonFeature,
    type SpawnMap,
} from '../engine/Map/DungeonFeature';
import type { Game } from '../engine/Core/Game';

type GameWithPrivates = Omit<Game, 'generateDepth' | 'canMoveTo'> & {
    generateDepth(isGoingUp: boolean, isFirstLevel: boolean): void;
    canMoveTo(x: number, y: number): boolean;
};

const DIRS8: ReadonlyArray<readonly [number, number]> = [
    [0, -1], [0, 1], [-1, 0], [1, 0],
    [-1, -1], [1, -1], [-1, 1], [1, 1],
];

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function graniteGrid(w: number, h: number): Grid {
    const g = new Grid(w, h);
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) g.setTerrain(x, y, TerrainType.GRANITE, ' ', 0x333333);
    }
    return g;
}

function floorAt(g: Grid, x: number, y: number): void {
    g.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
}

/** 单格足迹的水晶墙 DF（startProbability=0 → spawnMapDF 只标种子格，
 *  足迹确定、零 RNG；fillSpawnMap 的优先级门槛 旧≥新(0) 恒真，必落格）。 */
const CRYSTAL_SINGLE: DungeonFeature = {
    tile: TerrainType.CRYSTAL_WALL,
    layer: DungeonLayer.DUNGEON,
    startProbability: 0,
    probabilityDecrement: 0,
    flags: 0,
    propagationTerrain: TerrainType.NOTHING,
    subsequentDF: null,
    description: '',
    lightFlare: '',
    flashColor: '',
    effectRadius: 0,
};

function bandOf(grid: Grid, cells: Array<[number, number]>): SpawnMap {
    const m = createSpawnMap(grid);
    for (const [x, y] of cells) m[y * grid.width + x] = 1;
    return m;
}

/** T12 口径的 8 向泛洪（canMoveTo ∪ SECRET_DOOR）。 */
function floodPass(game: Game, start: Pos): Set<number> {
    const grid = game.grid;
    const canMoveTo = (game as unknown as GameWithPrivates).canMoveTo.bind(game);
    const pass = (x: number, y: number): boolean =>
        canMoveTo(x, y) || grid.getCell(x, y)!.terrain === TerrainType.SECRET_DOOR;
    const seen = new Set<number>([start.y * grid.width + start.x]);
    const queue: Pos[] = [start];
    while (queue.length > 0) {
        const p = queue.pop()!;
        for (const [dx, dy] of DIRS8) {
            const nx = p.x + dx!, ny = p.y + dy!;
            if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
            const key = ny * grid.width + nx;
            if (seen.has(key) || !pass(nx, ny)) continue;
            seen.add(key);
            queue.push({ x: nx, y: ny });
        }
    }
    return seen;
}

function findStairs(game: Game): { up: Pos | null, down: Pos | null } {
    const grid = game.grid;
    let up: Pos | null = null;
    let down: Pos | null = null;
    for (let x = 0; x < grid.width; x++) {
        for (let y = 0; y < grid.height; y++) {
            const t = grid.getCell(x, y)!.terrain;
            if (t === TerrainType.STAIRS_UP) up = { x, y };
            else if (t === TerrainType.STAIRS_DOWN) down = { x, y };
        }
    }
    return { up, down };
}

/**
 * 壕沟夹具（T3/T4/AD1 的载体）：1 宽走廊正中一格 CHASM——
 * web 移动图里 CHASM 可走（corridor 连通）；CE 口径里它是 T_PATHING_BLOCKER。
 * 把水晶墙落在 CHASM 格上：web 图被真实切断，CE 判据看不到（盲区）。
 */
function chasmMoatCorridor(): Grid {
    const g = graniteGrid(41, 21);
    for (let x = 2; x <= 38; x++) floorAt(g, x, 10);
    g.setTerrain(20, 10, TerrainType.CHASM, '~', 0x777788);
    return g;
}

describe('C-8 生成期 DF 放置否决：web 移动图口径', () => {
    it('T1 复现样本回归：seed12 逐层下潜到 D25，上/下行楼梯互相可达且非机器可走格单连通', () => {
        const game = createHeadlessGame(12);
        for (let d = 2; d <= 25; d++) {
            (game as unknown as { depth: number }).depth = d;
            (game as unknown as GameWithPrivates).generateDepth(false, false);
        }
        const { up, down } = findStairs(game);
        expect(up, 'D25 缺上行楼梯').not.toBeNull();
        expect(down, 'D25 缺下行楼梯').not.toBeNull();
        const reach = floodPass(game, up!);
        expect(reach.has(down!.y * game.grid.width + down!.x),
            `seed12/D25 上行楼梯到不了下行楼梯（卡死局回归）：up=(${up!.x},${up!.y}) down=(${down!.x},${down!.y}) 可达=${reach.size}`).toBe(true);

        // T12 同口径的非机器可走格单连通（机器格 = IS_IN_MACHINE 豁免）。
        const grid = game.grid;
        const canMoveTo = (game as unknown as GameWithPrivates).canMoveTo.bind(game);
        const unreachable: Pos[] = [];
        for (let x = 0; x < grid.width; x++) {
            for (let y = 0; y < grid.height; y++) {
                const cell = grid.getCell(x, y)!;
                if (cell.machineNumber !== 0) continue;
                if (!canMoveTo(x, y) && cell.terrain !== TerrainType.SECRET_DOOR) continue;
                if (!reach.has(y * grid.width + x)) unreachable.push({ x, y });
            }
        }
        expect(unreachable, `seed12/D25 存在机器格外的不可走达格：${unreachable.slice(0, 5).map(p => `(${p.x},${p.y})`).join('、')}`).toEqual([]);
    }, 600_000);

    it('T2 广度断言（区间来自修复前后实测）：30 seed × D1-D25 坏层=0', () => {
        // 实测依据：修复前同区间恰 1 个坏层（seed12/D25，808→436/367）；
        // 修复后同区间 0 个（另做了 120 seed × D1-D26 的更宽复扫，见报告）。
        for (let seed = 1; seed <= 30; seed++) {
            const game = createHeadlessGame(seed);
            const check = (d: number): void => {
                const { up, down } = findStairs(game);
                if (!up || !down) {
                    throw new Error(`seed${seed}/D${d} 楼梯缺失（非 C-8 口径，请人工核查）up=${!!up} down=${!!down}`);
                }
                const reach = floodPass(game, up);
                const back = floodPass(game, down);
                const W = game.grid.width;
                expect(
                    reach.has(down.y * W + down.x) && back.has(up.y * W + up.x),
                    `seed${seed}/D${d} 上/下行楼梯不互相可达（卡死局）：up=(${up.x},${up.y})→${reach.has(down.y * W + down.x)} down=(${down.x},${down.y})→${back.has(up.y * W + up.x)}`,
                ).toBe(true);
            };
            check(1);
            for (let d = 2; d <= 25; d++) {
                (game as unknown as { depth: number }).depth = d;
                (game as unknown as GameWithPrivates).generateDepth(false, false);
                check(d);
            }
        }
    }, 900_000);

    it('T3 机制断言（AD1）：壕沟夹具上 CE 判据放行、移动图判据判切断、spawnDungeonFeature 真实否决', () => {
        const g = chasmMoatCorridor();
        const band = bandOf(g, [[20, 10]]);

        // 修复前唯一的判据（CE Architect.c:3137-3198）在本夹具上返回 0：
        // CHASM 在 cellIsPassableOrDoor 口径下是阻挡，远侧"本是孤岛不贴带"。
        expect(levelIsDisconnectedWithBlockingMap(g, band, false)).toBe(0);
        // 移动图判据（C-8 新增）判真实切断。
        expect(levelIsDisconnectedOnMovementGraph(g, band),
            '移动图判据未识别壕沟切断（8 向或 ∪SECRET 口径丢失的实现在此翻红）').toBe(true);

        // spawn 级：abortIfBlocking=true 必须否决且不改格（AD1：只跑 CE 判据
        // 的实现——修复前形态——在这里会 succeeded=true 并把 CHASM 改成水晶墙）。
        const before = g.getCell(20, 10)!.layers.map(t => t);
        const res = spawnDungeonFeature(g, 20, 10, CRYSTAL_SINGLE, true);
        expect(res.succeeded, '切断壕沟的水晶墙必须被否决（否决只跑 CE 判据的实现在此翻红）').toBe(false);
        expect(g.getCell(20, 10)!.layers).toEqual(before);
    });

    it('T4 零 RNG 消耗（AD5）：否决与放行两条路径的掷骰增量均为 0', () => {
        // 单格足迹（startProbability=0）的 spawn 全链无掷骰点：
        // spawnMapDF 只标种子、两个连通性判据是纯泛洪、fillSpawnMap 无骰。
        // 若有人在否决/放行路径里加掷骰（重试、重掷、补偿），这里翻红。
        const g1 = chasmMoatCorridor();
        rng.seedRandomGenerator(20260918);
        const before1 = rng.randomNumbersGenerated;
        spawnDungeonFeature(g1, 20, 10, CRYSTAL_SINGLE, true); // 走否决路径
        const vetoedCost = rng.randomNumbersGenerated - before1;

        const g2 = graniteGrid(21, 21);
        for (let x = 3; x <= 17; x++) {
            for (let y = 3; y <= 17; y++) floorAt(g2, x, y);
        }
        rng.seedRandomGenerator(20260918);
        const before2 = rng.randomNumbersGenerated;
        const ok = spawnDungeonFeature(g2, 10, 10, CRYSTAL_SINGLE, true); // 走放行路径
        const builtCost = rng.randomNumbersGenerated - before2;

        expect(ok.succeeded).toBe(true);
        expect(vetoedCost, '否决路径不得消耗 RNG').toBe(0);
        expect(builtCost, '放行路径（未切断）不得消耗 RNG').toBe(0);
    });

    it('T-AD2 判据丢掉密门口径：水晶墙封死唯一通路上的密门必须被否决', () => {
        const g = graniteGrid(41, 21);
        for (let x = 2; x <= 38; x++) floorAt(g, x, 10);
        g.setTerrain(20, 10, TerrainType.SECRET_DOOR, '#', 0x555555);
        const band = bandOf(g, [[20, 10]]);

        // 被捕获的错误实现：movementPassable 用 plain terrainAllowsMove
        // （SECRET_DOOR 阻挡）——密门被当作既有墙，"无新切断"而放行；
        // T12 的验收口径是 canMoveTo ∪ SECRET_DOOR，密门封死即真切断。
        expect(levelIsDisconnectedOnMovementGraph(g, band),
            '密门口径丢失（漏并 SECRET_DOOR 的实现在此翻红）').toBe(true);
        const res = spawnDungeonFeature(g, 20, 10, CRYSTAL_SINGLE, true);
        expect(res.succeeded, '封死密门的水晶墙必须被否决').toBe(false);
        expect(g.getCell(20, 10)!.terrain).toBe(TerrainType.SECRET_DOOR);
    });

    it('T-AD3 方向数退化成 4 向：对角咽喉夹具上 4 向判据盲、8 向判据真', () => {
        // 布局：西北口袋 P 只有对角贴着咽喉 (2,2)，东南主区 M 同样只有对角贴；
        // 正交邻格全是墙。填死 (2,2) 在 web 8 向移动图上切断 P 与 M；
        // 4 向实现（相位 1 的贴带种子、相位 3 的相触都只查正交）完全看不到。
        const g = graniteGrid(8, 8);
        floorAt(g, 1, 1); floorAt(g, 0, 0); floorAt(g, 0, 1); // P
        floorAt(g, 2, 2);                                     // 咽喉（-band）
        floorAt(g, 3, 3); floorAt(g, 4, 3); floorAt(g, 3, 4); floorAt(g, 4, 4); // M
        const band = bandOf(g, [[2, 2]]);

        expect(levelIsDisconnectedOnMovementGraph(g, band),
            '对角咽喉未被判切断（分区/相触退化成 4 向的实现在此翻红）').toBe(true);
        const res = spawnDungeonFeature(g, 2, 2, CRYSTAL_SINGLE, true);
        expect(res.succeeded, '封死对角咽喉的水晶墙必须被否决').toBe(false);
        expect(g.getCell(2, 2)!.terrain).toBe(TerrainType.FLOOR);
    });

    it('T-AD4 过度否决守卫：贴带但未切断的放置必须照常放行（隔墙双室夹具）', () => {
        // 两个房间隔着整行墙、别无连接；水晶墙落在墙格上——带两侧各有一区，
        // 但带内格本身是墙（不是新切断源）。被捕获的错误实现：
        // "存在 ≥2 个贴带区就否决"（少相位 2/3）会误伤这类无害放置。
        const g = graniteGrid(21, 21);
        for (let x = 2; x <= 8; x++) {
            for (let y = 2; y <= 6; y++) floorAt(g, x, y);
            for (let y = 8; y <= 12; y++) floorAt(g, x, y);
        }
        g.setTerrain(5, 7, TerrainType.WALL, '#', 0x555566); // 显式墙格（其余 GRANITE）
        const band = bandOf(g, [[5, 7]]);

        expect(levelIsDisconnectedOnMovementGraph(g, band),
            '无害放置被误判切断（把"贴带"当"切断"的实现在此翻红）').toBe(false);
        const res = spawnDungeonFeature(g, 5, 7, CRYSTAL_SINGLE, true);
        expect(res.succeeded, '墙格上的水晶墙必须照常放行').toBe(true);
        expect(g.getCell(5, 7)!.terrain).toBe(TerrainType.CRYSTAL_WALL);
    });
});
