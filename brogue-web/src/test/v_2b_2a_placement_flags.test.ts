/**
 * src/test/v_2b_2a_placement_flags.test.ts — V-2b-2a 放置旗标轮主验证面
 *
 * 本轮把 CE cellIsFeatureCandidate（Architect.c:492-588）的七步落位资格判定
 * 与其余 feature 级旗标接入 BlueprintEngine.findFeaturePosition（报告 §1/§2）。
 * 生产数据里本轮实现的旗标中只有 4 种带载体（MF_PERMIT_BLOCKING×7、
 * MF_IMPREGNABLE×1、MF_TREAT_AS_BLOCKING×1、MF_NOT_IN_HALLWAY×1），其余
 * 全部零载体——零载体 ≠ 可以不验：全部用**合成蓝图**验证（任务书 §3）。
 *
 * 隔离形态：与 v_1b / p1_33 同源的手工网格 + 手工房间 + 经 unknown 视图直调
 * 私有 applyBlueprint；每次运行 fresh grid + fresh engine + rng 重播种
 * （＝哨兵形态②的「完全隔离层 + 重播种」），vitest 单 worker 复用下 rng 是
 * 跨文件单例，逐次重播种使各测量互不依赖执行顺序。端到端流由
 * generation_baseline（本轮最后一步重捕获）与既有全局扫描哨兵把守。
 *
 * 对抗面（每个用例钉一种具体的、合理的错误实现）：
 *   T1  NOT_IN_HALLWAY：忽略旗标 → 走廊格落位 → 翻红
 *   T2  NOT_ON_LEVEL_PERIMETER：忽略旗标 → 边界格落位 → 翻红
 *   T3  BUILD_IN_WALLS：忽略旗标（落房间内）/ 用对角邻接（落墙角）→ 翻红
 *   T4  BUILD_ANYWHERE_ON_LEVEL：忽略旗标（落机器内）；带 GENERATE_ITEM 时
 *       漏掉 T_OBSTRUCTS_ITEMS|T_PATHING_BLOCKER 排除 → 翻红
 *   T5  EVERYWHERE：铺不满 / 忘了「不掷 instanceCount」（RNG 记账）→ 翻红
 *   T6  REPEAT_UNTIL_NO_PROGRESS：不做真循环（RNG 记账）/ 跨轮累加落位 → 翻红
 *   T7  阻断否决：否决缺位（切断格照落）/ PERMIT 旁路失效 / TREAT 触发失效 → 翻红
 *   T8  IMPREGNABLE：不置位 / 失败不随整图回滚 → 翻红
 *   T9  Q 族资格：指令不带 itemQualifiers → 翻红
 *   T10 NOT_IN_HALLWAY / NOT_ON_LEVEL_PERIMETER **先于** origin 检查
 *       （CE :504-516 注释明言顺序有语义）：BATO 前置检查缺位 → 翻红
 *   T11 FAR_FROM_ORIGIN：抄 NEAR 的就近选格 → 翻红
 *
 * 夹具全部写在测试文件里（任务书 §4：不动生产 blueprints.json）。
 */
import { describe, it, expect } from 'vitest';
import { Grid, TerrainType, DCOLS, DROWS } from '../engine/Map/Grid';
import { BlueprintEngine } from '../engine/Generator/BlueprintEngine';
import type { BlueprintDef, FeatureDef, MachineResult } from '../engine/Generator/BlueprintEngine';
import type { Pos } from '../types';
import { rng } from '../engine/Random';
import { passableArcCount } from '../engine/Items/ItemSpawnHeatMap';
import blueprintData from '../data/blueprints.json';

// ---------- 夹具 ----------

const GRANITE_STYLE = { char: ' ', color: 0x333333 } as const;

function blankGrid(): Grid {
    const grid = new Grid(DCOLS, DROWS);
    for (let x = 0; x < DCOLS; x++) {
        for (let y = 0; y < DROWS; y++) {
            grid.setTerrain(x, y, TerrainType.GRANITE, GRANITE_STYLE.char, GRANITE_STYLE.color);
        }
    }
    return grid;
}

function carve(grid: Grid, cells: Pos[], t: TerrainType = TerrainType.FLOOR): void {
    for (const p of cells) grid.setTerrain(p.x, p.y, t, '.', 0x888888);
}

type Room = { cells: Pos[]; center: Pos; door: Pos | null };

function makeBp(features: FeatureDef[], flags: string[] = ['BP_ROOM']): BlueprintDef {
    return {
        id: 'v2b2a_fixture',
        name: 'v2b2a_fixture',
        depthRange: [1, 26],
        roomSize: [6, 20],
        frequency: 1,
        category: 'test',
        flags,
        features,
    } as unknown as BlueprintDef;
}

function itemFeature(flags: string[], count: [number, number] = [1, 1], id = 'v2b2a_scroll'): FeatureDef {
    return { itemCategory: 'SCROLL', itemId: id, instanceCount: count, flags: ['MF_GENERATE_ITEM', ...flags] };
}

function terrainFeature(terrain: string, flags: string[], count: [number, number] = [1, 1]): FeatureDef {
    return { terrain, instanceCount: count, flags };
}

/** 经 unknown 视图取私有 applyBlueprint（v_1b/p1_33 同源做法）。 */
function getApplyBp(engine: BlueprintEngine) {
    return (engine as unknown as {
        applyBlueprint(bp: BlueprintDef, r: Room): MachineResult | null;
    }).applyBlueprint;
}

/** 单次隔离运行：fresh grid + fresh engine + 重播种。 */
function runOnce(
    buildGrid: () => Grid,
    bp: BlueprintDef,
    room: Room,
    seed: number
): { result: MachineResult | null; engine: BlueprintEngine; grid: Grid } {
    rng.seedRandomGenerator(seed);
    const grid = buildGrid();
    const engine = new BlueprintEngine(grid, 5);
    const result = getApplyBp(engine).call(engine, bp, room);
    return { result, engine, grid };
}

/**
 * 单次 applyBlueprint 的 substantive 掷骰增量（v_1b 的 measureDelta 同源）。
 * 每次测量前重播种，使各测量互不依赖执行顺序。
 */
function measureDelta(buildGrid: () => Grid, bp: BlueprintDef, room: Room): number {
    rng.seedRandomGenerator(20260919);
    const grid = buildGrid();
    const engine = new BlueprintEngine(grid, 5);
    const before = rng.randomNumbersGenerated;
    getApplyBp(engine).call(engine, bp, room);
    return rng.randomNumbersGenerated - before;
}

/** 20 格标准房间（x2-11 × y2-3）。 */
function room20(): Room {
    const cells: Pos[] = [];
    for (let x = 2; x <= 11; x++) {
        for (let y = 2; y <= 3; y++) cells.push({ x, y });
    }
    return { cells, center: { x: 5, y: 2 }, door: null };
}

const RUNS = 100;
const seedAt = (i: number): number => 20260919000 + i;

// ---------- 前提自检 ----------

describe('V-2b-2a 前提自检', () => {
    // 任务书 §3 的载体普查钉死（V-2b-2a 时验收方扫描 blueprints.json feature
    // flags 的结论）。**V-2b-2b 反转**（本文件在 V-2b-2b 任务书 §6 授权清单内）：
    // CE 3/4/5/19/20/23 号蓝图落地后，原"零载体"旗标中 BUILD_IN_WALLS /
    // EVERYWHERE / BUILD_ANYWHERE_ON_LEVEL / REPEAT_UNTIL_NO_PROGRESS 出现
    // 生产载体，其余载体数同步增长（新普查逐条核过 CE GlobalsBrogue.c
    // :198-220/:309-331 原表）。原"零载体不得动生成流"前提对新增载体旗标
    // 到期——CE 原表已核对、generation_baseline 随本轮重捕获。
    // MF_KEY_DISPOSABLE（2 载体）仍未实现，归 V-2b-6 钥匙轮反转。
    // **V-2b-3 二次反转**（本文件在 V-2b-3 的授权范围内——B 类留痕反转，
    // 且本文件是 V-2b-3 任务书 §5 明列的"所有钉 wiredBranchHit 的测试"之外
    // 的第三条 B 类）：18/22/24/25 号四条 wired 蓝图 + 67/68 两条麻痹陷阱
    // 蓝图落地后，本表的每个计数都按 CE GlobalsBrogue.c 原表重新普查一遍。
    // CE 原表逐条核过（行号见各断言的失败消息）；
    // 六条蓝图的逐字段转录由 v_2b_3_wired 的 E4 组另钉一遍。
    // **V-2b-4 三次顺延**（本文件在 V-2b-4 任务书 §4 授权清单内）：CE
    // 1/2/6/7/15/26/28 号七条蓝图落地、且 6 号原地接管 web 自创的
    // reward_commutation 之后，本表每个计数按 CE GlobalsBrogue.c 原表
    // （:183-197/:221-232/:289-294/:347-363）重新普查一遍。逐字段转录由
    // v_2b_4_altars 的 C 组另钉一遍。
    // **V-2b-5 四次顺延**（本文件在 V-2b-5 任务书 §5 授权清单内）：CE
    // 21/29/41/43/50/56/69/70 号八条蓝图落地后，本表每个计数按 CE
    // GlobalsBrogue.c 原表（:318-321/:364-368/:445-449/:460-463/:505-508/
    // :545-548/:608-616）重新普查一遍。逐字段转录由 v_2b_5_dormant 的
    // A4 组另钉一遍。本轮新出现载体的旗标：MF_GENERATE_HORDE（5）、
    // MF_MONSTERS_DORMANT（8）、MF_IN_VIEW_OF_ORIGIN（1，56 号炮塔——
    // 判据仍未实现，登记缺口见 BlueprintEngine.cellIsFeatureCandidate 头注）。
    it('P1（V-2b-5 四次顺延）feature 旗标载体普查与 V-2b-5 落地后的 CE 原表一致', () => {
        const count = (flag: string): number =>
            (blueprintData as BlueprintDef[]).reduce(
                (n, bp) => n + bp.features.filter(f => f.flags.includes(flag)).length,
                0
            );
        expect(count('MF_PERMIT_BLOCKING'), 'PERMIT_BLOCKING 载体数（V-2b-4 基线 26；V-2b-5 +1：21 号门位雕像 :320；V-2b-6 +3：10 号 cage key :251、35 号密门 :402、40 号铁闸 :443）').toBe(30);
        expect(count('MF_IMPREGNABLE'), 'IMPREGNABLE 载体数（V-2b-4 基线 26；V-2b-5 未增；V-2b-6 +2：10 号笼群 :250、40 号墙杆 :442）').toBe(28);
        expect(count('MF_TREAT_AS_BLOCKING'), 'TREAT_AS_BLOCKING 载体数（V-2b-4 基线 33；V-2b-5 +7：29 号祭坛 :366、41 号祭坛 :447、43 号祭坛+雕像 :461-462、50 号祭坛 :506、56 号祭坛+炮塔 :546-547；V-2b-6 +4：10 号笼群 :250、35 号祭坛 :400 + 陷阱门 :401、40 号祭坛 :437）').toBe(44);
        expect(count('MF_NOT_IN_HALLWAY'), 'NOT_IN_HALLWAY 载体数（V-2b-4 基线 15；V-2b-5 +6：29 号两条 :366-367、43 号两条 :461-462、50 号祭坛 :506、56 号祭坛 :546）；V-2b-6 后重普查 21 → 23').toBe(23);
        // 仍未实现：
        expect(count('MF_KEY_DISPOSABLE'), 'KEY_DISPOSABLE 载体数（V-2b-6 反转我）；V-2b-6 后重普查 2 → 3').toBe(3);
        // V-2b-2b 新载体（CE 原表核对）：
        expect(count('MF_BUILD_IN_WALLS'), 'BUILD_IN_WALLS 载体数（V-2b-4 基线 11；V-2b-5 +6：29 号鼠墙 :368、41 号火嘴 :449、50 号蠕虫墙 :507、56 号炮塔 :547、69 号进墙雕像 :611、70 号蠕虫墙 :614）；V-2b-6 后重普查 17 → 19').toBe(19);
        expect(count('MF_EVERYWHERE'), 'EVERYWHERE 载体数（V-2b-4 基线 11；V-2b-5 +4：21 号触发地板 :321、41 号地板 :446、69 号触发地板 :612、70 号触发地板 :615）').toBe(15);
        expect(count('MF_BUILD_ANYWHERE_ON_LEVEL'), 'BUILD_ANYWHERE 载体数（V-2b-3 基线 4；V-2b-5 未增）').toBe(4);
        expect(count('MF_REPEAT_UNTIL_NO_PROGRESS'), 'REPEAT 载体数（23 号陷阱；V-2b-3/4/5 未增）；V-2b-6 后重普查 1 → 2').toBe(2);
        expect(count('MF_NO_THROWING_WEAPONS'), 'NO_THROWING_WEAPONS 载体数（V-2b-4 基线 5；V-2b-5 未增）').toBe(5);
        expect(count('MF_REQUIRE_GOOD_RUNIC'), 'REQUIRE_GOOD_RUNIC 载体数（基线 2；V-2b-5 未增）').toBe(2);
        expect(count('MF_FAR_FROM_ORIGIN'), 'FAR_FROM_ORIGIN 载体数（V-2b-4 基线 4；V-2b-5 +5：29 号两条 :366-367、41 号祭坛+火嘴 :447/:449、43 号雕像 :462）；V-2b-6 后重普查 9 → 10').toBe(10);
        expect(count('MF_NEAR_ORIGIN'), 'NEAR_ORIGIN 载体数（V-2b-4 基线 8；V-2b-5 +4：41 号甲烷喷口 :448、43 号祭坛 :461、50 号祭坛 :506、56 号祭坛 :546）').toBe(12);
        expect(count('MF_BUILD_AT_ORIGIN'), 'BUILD_AT_ORIGIN 载体数（V-2b-4 基线 24；V-2b-5 +3：21 号雕像 :320、41 号门 :445、69 号原地雕像 :608）；V-2b-6 后重普查 27 → 29').toBe(29);
        expect(count('MF_ADOPT_ITEM'), 'ADOPT_ITEM 载体数（V-2b-4 基线 3；V-2b-5 +5：29/41/43/50/56 号祭坛各一 :366/:447/:461/:506/:546）；V-2b-6 后重普查 8 → 10').toBe(10);
        // V-2b-5 新载体（CE 原表核对）：
        expect(count('MF_GENERATE_HORDE'), 'GENERATE_HORDE 载体数（V-2b-5 首批载体：21 号 :320、43 号 :462、56 号 :547、69 号两条 :608/:611）；V-2b-6 后重普查 5 → 6').toBe(6);
        expect(count('MF_MONSTERS_DORMANT'), 'MONSTERS_DORMANT 载体数（V-2b-5 前唯一载体 15 号 :293；本轮 +8：21/29/43/50/56 号各一、69 号两条、70 号一条）').toBe(9);
        expect(count('MF_IN_VIEW_OF_ORIGIN'), 'IN_VIEW_OF_ORIGIN 载体数（既有 1：24 号图腾 :341；V-2b-5 +1：56 号炮塔 :547。判据未实现，登记缺口）').toBe(2);
        // 仍零载体（出现载体：核对 CE 原表 + 重捕获基线）：
        for (const flag of [
            'MF_REQUIRE_HEAVY_WEAPON',
        ]) {
            expect(count(flag), `${flag} 应为零载体（出现载体：核对 CE 原表 + 重捕获基线）`).toBe(0);
        }
    });
});

// ---------- §1 七步判定 ----------

describe('T1 MF_NOT_IN_HALLWAY（CE :507-510）', () => {
    // 房间 = 1 宽走廊 x4..11 × y10：中段（x5..10）arc=2（走廊格），
    // 两端（x4/x11）arc=1（允许）。center 预留在 (4,10)，可用端只剩 (11,10)。
    const cells: Pos[] = [];
    for (let x = 4; x <= 11; x++) cells.push({ x, y: 10 });
    const buildGrid = (): Grid => {
        const grid = blankGrid();
        carve(grid, cells);
        return grid;
    };
    const room: Room = { cells, center: { x: 4, y: 10 }, door: null };

    it('夹具自检：中段是走廊格（arc=2）、端点不是（arc=1）', () => {
        const grid = buildGrid();
        expect(passableArcCount(grid, 6, 10)).toBe(2);
        expect(passableArcCount(grid, 11, 10)).toBe(1);
    });

    it('带旗标：落位只允许 arc≤1 的端点（恒 (11,10)）', () => {
        const bp = makeBp([itemFeature(['MF_NOT_IN_HALLWAY'])]);
        for (let i = 0; i < RUNS; i++) {
            const { result, grid } = runOnce(buildGrid, bp, room, seedAt(i));
            expect(result, `run ${i}：两端可用、min=1，不应整机失败`).not.toBeNull();
            const pos = result!.itemSpawns[0]!.pos;
            expect(pos, `run ${i}：落在了走廊格`).toEqual({ x: 11, y: 10 });
            expect(passableArcCount(grid, pos.x, pos.y)).toBeLessThanOrEqual(1);
        }
        // 对抗面：忽略旗标的实现会让绝大多数 run 落进中段 → 上面 toEqual 翻红。
    });

    it('无旗标对照：中段走廊格确实可被选中（旗标有东西可滤）', () => {
        const bp = makeBp([itemFeature([])]);
        let sawHallway = 0;
        for (let i = 0; i < RUNS; i++) {
            const { result } = runOnce(buildGrid, bp, room, seedAt(i));
            expect(result).not.toBeNull();
            const pos = result!.itemSpawns[0]!.pos;
            if (pos.x >= 5 && pos.x <= 10) sawHallway++;
        }
        expect(sawHallway, '100 次里应有大量走廊格落位（否则夹具失去对抗意义）').toBeGreaterThan(20);
    });
});

describe('T2 MF_NOT_ON_LEVEL_PERIMETER（CE :513-516）', () => {
    // BUILD_ANYWHERE 域（全图扫描）：机器房间放在 (5,5)-(6,5)（机器格被
    // step 6 排除），候选 = 机器外的地板：边界格 (0,5)/(0,6) + 内部 (8,8)。
    const roomCells: Pos[] = [{ x: 5, y: 5 }, { x: 6, y: 5 }];
    const buildGrid = (): Grid => {
        const grid = blankGrid();
        carve(grid, roomCells);
        carve(grid, [{ x: 0, y: 5 }, { x: 0, y: 6 }, { x: 8, y: 8 }]);
        return grid;
    };
    const room: Room = { cells: roomCells, center: { x: 5, y: 5 }, door: null };

    it('带旗标（BUILD_ANYWHERE 域）：落位恒在非边界格 (8,8)', () => {
        const bp = makeBp([terrainFeature('GRASS', ['MF_BUILD_ANYWHERE_ON_LEVEL', 'MF_NOT_ON_LEVEL_PERIMETER'])]);
        for (let i = 0; i < RUNS; i++) {
            const { result, grid } = runOnce(buildGrid, bp, room, seedAt(i));
            expect(result, `run ${i}：(8,8) 可用，min=1 不应失败`).not.toBeNull();
            const placed = [{ x: 0, y: 5 }, { x: 0, y: 6 }, { x: 8, y: 8 }]
                .filter(p => grid.getCell(p.x, p.y)!.terrain === TerrainType.GRASS);
            expect(placed, `run ${i}：恰落 1 格`).toHaveLength(1);
            expect(placed[0], `run ${i}：边界格被选中`).toEqual({ x: 8, y: 8 });
        }
    });

    it('无旗标对照：边界格确实在候选域里', () => {
        const bp = makeBp([terrainFeature('GRASS', ['MF_BUILD_ANYWHERE_ON_LEVEL'])]);
        let sawPerimeter = 0;
        for (let i = 0; i < 200; i++) {
            const { result, grid } = runOnce(buildGrid, bp, room, seedAt(i));
            expect(result).not.toBeNull();
            if (grid.getCell(0, 6)!.terrain === TerrainType.GRASS) sawPerimeter++;
        }
        expect(sawPerimeter, '边界格应有机会被选中').toBeGreaterThan(10);
    });
});

describe('T3 MF_BUILD_IN_WALLS（CE :558-575）', () => {
    // 房间 x5-8 × y5-6（8 格），四周花岗岩墙。合格墙格 = 4 正邻 interior 的墙。
    const roomCells: Pos[] = [];
    for (let x = 5; x <= 8; x++) {
        for (let y = 5; y <= 6; y++) roomCells.push({ x, y });
    }
    const buildGrid = (): Grid => {
        const grid = blankGrid();
        carve(grid, roomCells);
        return grid;
    };
    const room: Room = { cells: roomCells, center: { x: 6, y: 5 }, door: null };

    it('物品落在 interior 之外的墙格：4 正邻房间、非边界，且并入机器', () => {
        const bp = makeBp([itemFeature(['MF_BUILD_IN_WALLS'])]);
        for (let i = 0; i < RUNS; i++) {
            const { result, grid } = runOnce(buildGrid, bp, room, seedAt(i));
            expect(result, `run ${i}：12 面墙格可用，min=1 不应失败`).not.toBeNull();
            const pos = result!.itemSpawns[0]!.pos;
            const cell = grid.getCell(pos.x, pos.y)!;
            // 非房间格（忽略了 BUILD_IN_WALLS 的实现会落回房间 → 翻红）：
            expect(roomCells.some(p => p.x === pos.x && p.y === pos.y), `run ${i}：落进了房间`).toBe(false);
            // 必须是墙（ Granité 未被打通）：
            expect(cell.terrain, `run ${i}：落格不是墙`).toBe(TerrainType.GRANITE);
            // 4 正邻（不是对角）之一是房间格（对角邻接实现会落墙角 → 翻红）：
            const orthAdjacent = roomCells.some(
                p => Math.abs(p.x - pos.x) + Math.abs(p.y - pos.y) === 1
            );
            expect(orthAdjacent, `run ${i}：(${pos.x},${pos.y}) 不与房间 4 正邻接`).toBe(true);
            // CE :1486-1488：feature 格并入机器（machineNumber 补写）。
            expect(cell.machineNumber, `run ${i}：feature 格未并入机器`).toBe(result!.machineNumber);
        }
    });

    it('无旗标对照：物品落在房间内部', () => {
        const bp = makeBp([itemFeature([])]);
        for (let i = 0; i < RUNS; i++) {
            const { result } = runOnce(buildGrid, bp, room, seedAt(i));
            expect(result).not.toBeNull();
            const pos = result!.itemSpawns[0]!.pos;
            expect(roomCells.some(p => p.x === pos.x && p.y === pos.y), `run ${i}：落到了房外`).toBe(true);
        }
    });
});

describe('T4 MF_BUILD_ANYWHERE_ON_LEVEL（CE :577-583）', () => {
    // 房间 x5-8 × y5-6（机器格）+ 外围：(2,2) FLOOR、(3,2) WATER_DEEP、
    // (4,2) CHASM。后两者的 T_IS_DEEP_WATER / T_AUTO_DESCENT 都在
    // T_PATHING_BLOCKER 里（Rogue.h:1948）。
    const roomCells: Pos[] = [];
    for (let x = 5; x <= 8; x++) {
        for (let y = 5; y <= 6; y++) roomCells.push({ x, y });
    }
    const buildGrid = (): Grid => {
        const grid = blankGrid();
        carve(grid, roomCells);
        carve(grid, [{ x: 2, y: 2 }]);
        carve(grid, [{ x: 3, y: 2 }], TerrainType.WATER_DEEP);
        carve(grid, [{ x: 4, y: 2 }], TerrainType.CHASM);
        return grid;
    };
    const room: Room = { cells: roomCells, center: { x: 6, y: 5 }, door: null };

    it('带 GENERATE_ITEM：物品只落 (2,2)（机器格与物品阻挡格全被排除）', () => {
        const bp = makeBp([itemFeature(['MF_BUILD_ANYWHERE_ON_LEVEL'])]);
        for (let i = 0; i < RUNS; i++) {
            const { result, grid } = runOnce(buildGrid, bp, room, seedAt(i));
            expect(result, `run ${i}：(2,2) 是唯一合格候选，min=1 不应失败`).not.toBeNull();
            const pos = result!.itemSpawns[0]!.pos;
            expect(pos, `run ${i}：物品落到了 (2,2) 之外`).toEqual({ x: 2, y: 2 });
            expect(grid.getCell(pos.x, pos.y)!.terrain).toBe(TerrainType.FLOOR);
        }
        // 对抗面：漏掉 T_OBSTRUCTS_ITEMS|T_PATHING_BLOCKER 排除的实现会把
        // WATER_DEEP/CHASM 也当候选 → 100 run 里几乎必然翻红。
    });

    it('无 GENERATE_ITEM 对照：WATER_DEEP/CHASM 确实在候选域（只排除机器格）', () => {
        const bp = makeBp([terrainFeature('GRASS', ['MF_BUILD_ANYWHERE_ON_LEVEL'])]);
        let sawBlocked = 0;
        for (let i = 0; i < 200; i++) {
            const { result, grid } = runOnce(buildGrid, bp, room, seedAt(i));
            expect(result).not.toBeNull();
            const t = grid.getCell(3, 2)!.terrain === TerrainType.GRASS
                || grid.getCell(4, 2)!.terrain === TerrainType.GRASS;
            if (t) sawBlocked++;
        }
        expect(sawBlocked, '非物品 feature 应可落在 WATER_DEEP/CHASM 上').toBeGreaterThan(10);
    });
});

// ---------- §2 其余旗标 ----------

describe('T5 MF_EVERYWHERE（CE :1387-1394）', () => {
    // 6 格房间；center 预留 → 可铺 5 格。instanceCount 故意给 [1,2]
    // （[1,1] 不掷骰，无法用 RNG 记账钉「EVERYWHERE 不掷 instanceCount」）。
    const cells: Pos[] = [];
    for (let x = 5; x <= 7; x++) {
        for (let y = 5; y <= 6; y++) cells.push({ x, y });
    }
    const buildGrid = (): Grid => {
        const grid = blankGrid();
        carve(grid, cells);
        return grid;
    };
    const room: Room = { cells, center: { x: 6, y: 5 }, door: null };
    const center = { x: 6, y: 5 };

    it('铺满所有合格格（center 预留除外），instanceCount 不约束铺放量', () => {
        const bp = makeBp([terrainFeature('GRASS', ['MF_EVERYWHERE'], [1, 2])]);
        const { result, grid } = runOnce(buildGrid, bp, room, seedAt(1));
        expect(result).not.toBeNull();
        const grass = cells.filter(p => grid.getCell(p.x, p.y)!.terrain === TerrainType.GRASS);
        expect(grass, 'EVERYWHERE 应铺满除 center 外的全部房间格').toHaveLength(cells.length - 1);
        expect(grid.getCell(center.x, center.y)!.terrain, 'center 预留不得被铺').toBe(TerrainType.FLOOR);
        // 对抗面：把 EVERYWHERE 当普通 count 处理的实现最多铺 2 格 → 翻红。
    });

    it('RNG 记账：EVERYWHERE 不掷 instanceCount（CE :1393 只在非 EVERYWHERE 分支）', () => {
        const withFlag = makeBp([terrainFeature('GRASS', ['MF_EVERYWHERE'], [1, 2])]);
        const withoutFlag = makeBp([terrainFeature('GRASS', [], [1, 2])]);
        const dFlag = measureDelta(buildGrid, withFlag, room);
        const dNo = measureDelta(buildGrid, withoutFlag, room);
        // 两夹具公共底数：shuffleList(6 格) = 5 掷；控制组多掷一次 instanceCount。
        expect(dFlag).toBe(5);
        expect(dNo).toBe(6);
        expect(dFlag, 'EVERYWHERE 多掷了 instanceCount').toBe(dNo - 1);
    });
});

describe('T6 MF_REPEAT_UNTIL_NO_PROGRESS 真循环（CE :1360-1670）', () => {
    // 2 格房间，center 预留 (6,10) → 每轮至多 1 个可用候选 (7,10)。
    // V-2b-2b 注：本组 itemFeature 必须带 personalSpace 1——REPEAT 循环的
    // 终止机制是"落位格被 occupied，下一轮候选耗尽、落 0 出循环"
    // （CE :1461-1470 占位 + :1675 min 豁免）；V-2b-2b 把 personalSpace=0
    // 的占位语义对齐 CE（不占格）后，REPEAT+不占位 的组合每轮都会重新
    // 选回同一格、永不退出（CE 目录里 REPEAT feature 的 reqSpace 全 ≥1，
    // 该病态组合无 CE 数据载体），故夹具补占位保持可终止。
    const buildGrid = (): Grid => {
        const grid = blankGrid();
        carve(grid, [{ x: 6, y: 10 }, { x: 7, y: 10 }]);
        return grid;
    };
    const room: Room = { cells: [{ x: 6, y: 10 }, { x: 7, y: 10 }], center: { x: 6, y: 10 }, door: null };

    it('min 豁免：候选耗尽时 REPEAT 不整机失败、也不跨轮累加落位', () => {
        // count [2,2]、min 2：第一轮只能落 1 → 非 REPEAT 整机失败；
        // REPEAT 豁免 min → 机器成立，但落位恰 1 件（CE 的 instance 每轮
        // 归零重数，跨轮不累加——累加实现会落 2 件 → 翻红）。
        const repeat = makeBp([itemFeature(['MF_REPEAT_UNTIL_NO_PROGRESS'], [2, 2], 'v2b2a_rep')]);
        (repeat.features[0] as FeatureDef).minimumInstanceCount = 2;
        (repeat.features[0] as FeatureDef).personalSpace = 1;
        const { result } = runOnce(buildGrid, repeat, room, seedAt(1));
        expect(result, 'REPEAT 应豁免 min 检查').not.toBeNull();
        expect(result!.itemSpawns, '跨轮不得累加落位（CE instance 每轮重置）').toHaveLength(1);

        const plain = makeBp([itemFeature([], [2, 2], 'v2b2a_rep')]);
        (plain.features[0] as FeatureDef).minimumInstanceCount = 2;
        (plain.features[0] as FeatureDef).personalSpace = 1;
        const { result: r2 } = runOnce(buildGrid, plain, room, seedAt(1));
        expect(r2, '无 REPEAT：min 不达应整机失败').toBeNull();
    });

    it('真循环：候选耗尽后再试一轮（多掷一次 instanceCount）', () => {
        // count [2,3]、min 1：第一轮落 1（≥min）→ REPEAT 触发第二轮；
        // 第二轮候选耗尽、落 0 <min → 出循环。共掷 2 次 instanceCount；
        // 旧实现（只豁免 min、不循环）只掷 1 次 → RNG 记账翻红。
        const repeat = makeBp([itemFeature(['MF_REPEAT_UNTIL_NO_PROGRESS'], [2, 3], 'v2b2a_rep')]);
        (repeat.features[0] as FeatureDef).minimumInstanceCount = 1;
        (repeat.features[0] as FeatureDef).personalSpace = 1;
        const plain = makeBp([itemFeature([], [2, 3], 'v2b2a_rep')]);
        (plain.features[0] as FeatureDef).minimumInstanceCount = 1;
        (plain.features[0] as FeatureDef).personalSpace = 1;
        const dRep = measureDelta(buildGrid, repeat, room);
        const dPlain = measureDelta(buildGrid, plain, room);
        expect(dRep, 'REPEAT 应多掷一轮 instanceCount').toBe(dPlain + 1);
    });
});

describe('T7 阻断否决（CE :1444-1452：PERMIT_BLOCKING / TREAT_AS_BLOCKING）', () => {
    // 路口区 x2-3 × y9-11 + 死胡同走廊 x4..8 × y10（房间 = 走廊，
    // center 预留 (4,10)）。堵 (5,10)/(6,10)/(7,10) 会封死外侧死角
    // （否决），堵 (8,10)（尽头格）不切断任何格（放行）。
    const corridor: Pos[] = [];
    for (let x = 4; x <= 8; x++) corridor.push({ x, y: 10 });
    const buildGrid = (): Grid => {
        const grid = blankGrid();
        const junction: Pos[] = [];
        for (let x = 2; x <= 3; x++) {
            for (let y = 9; y <= 11; y++) junction.push({ x, y });
        }
        carve(grid, junction);
        carve(grid, corridor);
        return grid;
    };
    const room: Room = { cells: corridor, center: { x: 4, y: 10 }, door: null };

    it('无 PERMIT 的阻断地形：只允许落在不切断的 (8,10)', () => {
        const bp = makeBp([terrainFeature('LOCKED_DOOR', [], [1, 1])]);
        for (let i = 0; i < RUNS; i++) {
            const { result, grid } = runOnce(buildGrid, bp, room, seedAt(i));
            expect(result, `run ${i}：(8,10) 可落，min=1 不应失败`).not.toBeNull();
            for (const p of corridor) {
                const t = grid.getCell(p.x, p.y)!.terrain;
                if (p.x === 8) {
                    expect(t, '尽头格应落上 LOCKED_DOOR').toBe(TerrainType.LOCKED_DOOR);
                } else {
                    expect(t, `(${p.x},10) 会封死死角，应被否决`).toBe(TerrainType.FLOOR);
                }
            }
        }
        // 对抗面：否决缺位的实现（旧 web 无条件落格）会把 LOCKED_DOOR 落在
        // (5,10)/(6,10)/(7,10) → 翻红。
    });

    it('MF_PERMIT_BLOCKING 旁路：同夹具不再否决（切断格可落）', () => {
        const bp = makeBp([terrainFeature('LOCKED_DOOR', ['MF_PERMIT_BLOCKING'], [1, 1])]);
        let sawCut = 0;
        for (let i = 0; i < 200; i++) {
            const { result, grid } = runOnce(buildGrid, bp, room, seedAt(i));
            expect(result).not.toBeNull();
            if (grid.getCell(5, 10)!.terrain === TerrainType.LOCKED_DOOR) sawCut++;
        }
        expect(sawCut, 'PERMIT 后 (5,10) 应有机会落上 LOCKED_DOOR').toBeGreaterThan(10);
        // 对抗面：PERMIT 旁路失效（照旧否决）的实现 → sawCut 恒 0 → 翻红。
    });

    it('MF_TREAT_AS_BLOCKING：非阻断地形（ALTAR）也触发否决', () => {
        const bp = makeBp([terrainFeature('ALTAR', ['MF_TREAT_AS_BLOCKING'], [1, 1])]);
        for (let i = 0; i < RUNS; i++) {
            const { result, grid } = runOnce(buildGrid, bp, room, seedAt(i));
            expect(result).not.toBeNull();
            expect(grid.getCell(8, 10)!.terrain, 'TREAT 下仍只允许 (8,10)').toBe(TerrainType.ALTAR);
            for (const p of corridor) {
                if (p.x !== 8) {
                    expect(grid.getCell(p.x, p.y)!.terrain, `(${p.x},10) 应被 TREAT 否决`).toBe(TerrainType.FLOOR);
                }
            }
        }
    });

    it('无 TREAT 对照：ALTAR 无需否决，切断格可落', () => {
        const bp = makeBp([terrainFeature('ALTAR', [], [1, 1])]);
        let sawCut = 0;
        for (let i = 0; i < 200; i++) {
            const { result, grid } = runOnce(buildGrid, bp, room, seedAt(i));
            expect(result).not.toBeNull();
            if (grid.getCell(5, 10)!.terrain === TerrainType.ALTAR) sawCut++;
        }
        expect(sawCut, 'ALTAR 无 TREAT 时不做否决').toBeGreaterThan(10);
    });

    it('否决耗尽候选 → min 不达 → 整机失败（CE :1676-1687）', () => {
        const bp = makeBp([terrainFeature('LOCKED_DOOR', [], [3, 3])]);
        (bp.features[0] as FeatureDef).minimumInstanceCount = 3;
        for (let i = 0; i < 20; i++) {
            const { result } = runOnce(buildGrid, bp, room, seedAt(i));
            expect(result, `run ${i}：只有 1 格可落、min=3，应整机失败`).toBeNull();
        }
    });
});

describe('T8 MF_IMPREGNABLE（CE :1491-1493）', () => {
    const roomCells: Pos[] = [];
    for (let x = 5; x <= 8; x++) {
        for (let y = 5; y <= 6; y++) roomCells.push({ x, y });
    }
    const buildGrid = (): Grid => {
        const grid = blankGrid();
        carve(grid, roomCells);
        return grid;
    };
    const room: Room = { cells: roomCells, center: { x: 6, y: 5 }, door: null };

    it('落位格打上不可挖掘标记，其余格不受染', () => {
        const bp = makeBp([terrainFeature('LOCKED_DOOR', ['MF_IMPREGNABLE', 'MF_PERMIT_BLOCKING'], [1, 1])]);
        const { result, engine, grid } = runOnce(buildGrid, bp, room, seedAt(1));
        expect(result).not.toBeNull();
        let impregCount = 0;
        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                if (engine.isImpregnable(x, y)) {
                    impregCount++;
                    expect(grid.getCell(x, y)!.terrain, `(${x},${y}) 被标了 IMPREGNABLE 但没落 LOCKED_DOOR`)
                        .toBe(TerrainType.LOCKED_DOOR);
                }
            }
        }
        expect(impregCount, 'IMPREGNABLE 标记数应恰等于落位数').toBe(1);
    });

    it('整机失败时随整图回滚（CE copyMap 连 pmap.flags 一起恢复）', () => {
        // feature1 落 IMPREGNABLE，feature2 min=2 必然不达 → 整机失败。
        const bp = makeBp([
            terrainFeature('LOCKED_DOOR', ['MF_IMPREGNABLE', 'MF_PERMIT_BLOCKING'], [1, 1]),
            { ...itemFeature([], [1, 1], 'v2b2a_rollback'), minimumInstanceCount: 2 },
        ]);
        rng.seedRandomGenerator(seedAt(1));
        const grid = buildGrid();
        const engine = new BlueprintEngine(grid, 5);
        const backup = (engine as unknown as { backupLevel(): unknown }).backupLevel();
        const result = getApplyBp(engine).call(engine, bp, room);
        expect(result, 'feature2 min=2 应使整机失败').toBeNull();
        // 失败后 restoreLevel 是 buildAMachine 的职责；手工驱动以验证
        // IMPREGNABLE 确实进了整图备份/恢复循环。
        (engine as unknown as { restoreLevel(b: unknown): void }).restoreLevel(backup);
        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                expect(engine.isImpregnable(x, y), `(${x},${y}) 失败回滚后仍带着 IMPREGNABLE`).toBe(false);
            }
        }
    });
});

describe('T9 Q 族物品资格下传（CE :1506-1509）', () => {
    const buildGrid = (): Grid => {
        const grid = blankGrid();
        carve(grid, room20().cells);
        return grid;
    };

    it('三个资格旗标随 MF_GENERATE_ITEM 指令下传', () => {
        const bp = makeBp([itemFeature(['MF_REQUIRE_GOOD_RUNIC', 'MF_NO_THROWING_WEAPONS', 'MF_REQUIRE_HEAVY_WEAPON'])]);
        const { result } = runOnce(buildGrid, bp, room20(), seedAt(1));
        expect(result).not.toBeNull();
        const qualifiers = result!.itemSpawns[0]!.itemQualifiers;
        expect(qualifiers, '指令应携带 Q 族资格旗标（消费点 Game.spawnBlueprintItem，边界外缺口）')
            .toEqual(['MF_NO_THROWING_WEAPONS', 'MF_REQUIRE_GOOD_RUNIC', 'MF_REQUIRE_HEAVY_WEAPON']);
    });

    it('无资格旗标：指令不带 itemQualifiers 字段', () => {
        const bp = makeBp([itemFeature([])]);
        const { result } = runOnce(buildGrid, bp, room20(), seedAt(1));
        expect(result).not.toBeNull();
        expect(result!.itemSpawns[0]!.itemQualifiers).toBeUndefined();
    });
});

describe('T10 前置检查先于 origin 检查（CE :504-516 的顺序语义）', () => {
    it('NOT_IN_HALLWAY：走廊上的 origin 使 BUILD_AT_ORIGIN feature 无落格', () => {
        // 走廊房间 x4..9 × y10，origin（door）= (6,10)——arc=2 的走廊格。
        const cells: Pos[] = [];
        for (let x = 4; x <= 9; x++) cells.push({ x, y: 10 });
        const buildGrid = (): Grid => {
            const grid = blankGrid();
            carve(grid, cells);
            return grid;
        };
        const room: Room = { cells, center: { x: 4, y: 10 }, door: { x: 6, y: 10 } };
        expect(passableArcCount(buildGrid(), 6, 10), '夹具自检：origin 应是走廊格').toBe(2);

        const withFlag = makeBp([itemFeature(['MF_BUILD_AT_ORIGIN', 'MF_NOT_IN_HALLWAY'])]);
        const { result } = runOnce(buildGrid, withFlag, room, seedAt(1));
        expect(result, '走廊 origin + NOT_IN_HALLWAY：BUILD_AT_ORIGIN 应无落格（CE 注释「整台机器失败」）')
            .toBeNull();

        const without = makeBp([itemFeature(['MF_BUILD_AT_ORIGIN'])]);
        const { result: r2 } = runOnce(buildGrid, without, room, seedAt(1));
        expect(r2).not.toBeNull();
        expect(r2!.itemSpawns[0]!.pos, '无 NOT_IN_HALLWAY 时 BATO 应钉在 origin').toEqual({ x: 6, y: 10 });
    });

    it('NOT_ON_LEVEL_PERIMETER：边界上的 origin 使 BUILD_AT_ORIGIN feature 无落格', () => {
        const cells: Pos[] = [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }];
        const buildGrid = (): Grid => {
            const grid = blankGrid();
            carve(grid, cells);
            return grid;
        };
        const room: Room = { cells, center: { x: 2, y: 5 }, door: { x: 0, y: 5 } };

        const withFlag = makeBp([itemFeature(['MF_BUILD_AT_ORIGIN', 'MF_NOT_ON_LEVEL_PERIMETER'])]);
        const { result } = runOnce(buildGrid, withFlag, room, seedAt(1));
        expect(result, '边界 origin + NOT_ON_LEVEL_PERIMETER：BATO 应无落格').toBeNull();

        const without = makeBp([itemFeature(['MF_BUILD_AT_ORIGIN'])]);
        const { result: r2 } = runOnce(buildGrid, without, room, seedAt(1));
        expect(r2).not.toBeNull();
        expect(r2!.itemSpawns[0]!.pos).toEqual({ x: 0, y: 5 });
    });
});

describe('T11 MF_FAR_FROM_ORIGIN（CE :1340-1341，曼哈顿镜像近似）', () => {
    // 走廊房间 x4..11 × y10，origin = center = (4,10)（door null），
    // center 预留 → 可用格 x5..11。NEAR 应恒取 (5,10)（最近），
    // FAR 应恒取 (11,10)（最远）。
    const cells: Pos[] = [];
    for (let x = 4; x <= 11; x++) cells.push({ x, y: 10 });
    const buildGrid = (): Grid => {
        const grid = blankGrid();
        carve(grid, cells);
        return grid;
    };
    const room: Room = { cells, center: { x: 4, y: 10 }, door: null };

    it('FAR 恒取曼哈顿最远的可用格', () => {
        const bp = makeBp([itemFeature(['MF_FAR_FROM_ORIGIN'])]);
        for (let i = 0; i < RUNS; i++) {
            const { result } = runOnce(buildGrid, bp, room, seedAt(i));
            expect(result).not.toBeNull();
            expect(result!.itemSpawns[0]!.pos, `run ${i}：FAR 落点`).toEqual({ x: 11, y: 10 });
        }
        // 对抗面：把 FAR 写成 NEAR（就近选格）的实现恒落 (5,10) → 翻红。
    });

    it('NEAR 对照：恒取曼哈顿最近的可用格（V-2b-1 既有行为不动）', () => {
        const bp = makeBp([itemFeature(['MF_NEAR_ORIGIN'])]);
        for (let i = 0; i < RUNS; i++) {
            const { result } = runOnce(buildGrid, bp, room, seedAt(i));
            expect(result).not.toBeNull();
            expect(result!.itemSpawns[0]!.pos, `run ${i}：NEAR 落点`).toEqual({ x: 5, y: 10 });
        }
    });
});
