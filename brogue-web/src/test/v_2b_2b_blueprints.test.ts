/**
 * src/test/v_2b_2b_blueprints.test.ts — V-2b-2b 主验证面
 *
 * 本轮落地（任务书 §1-§4）：蓝图级内部改造旗标 BP_OPEN_INTERIOR /
 * BP_PURGE_PATHING_BLOCKERS / BP_PURGE_LIQUIDS / BP_SURROUND_WITH_WALLS /
 * BP_IMPREGNABLE / BP_NO_INTERIOR_FLAG（CE Architect.c:858-945 / :1691）、
 * 六个地形载体 + FUNGUS_FOREST 别名、CE GlobalsBrogue.c 目录序
 * 3/4/5/19/20/23 六条蓝图、reward_pedestals 按 CE 拆回两条。
 *
 * 隔离形态：与 v_2b_2a 同源——手工网格 + 手工 room + unknown 视图直调
 * 私有 applyBlueprint；每次运行 fresh grid + fresh engine + rng 重播种。
 *
 * 对抗面（每个用例钉一种具体的、合理的错误实现）：
 *   T1  OPEN_INTERIOR 不扩张 / 把凸扩张做成凹吞噬 / 漏 granite→WALL 步 → 红
 *   T2  PURGE_PATHING_BLOCKERS 不清陷阱 / 越权清非阻断地形 → 红
 *   T3  PURGE_LIQUIDS 不清液体层 / 误清 DUNGEON 层 → 红
 *   T4  SURROUND_WITH_WALLS 漏 IS_GATE_SITE 豁免（机器封死）/ 漏四重豁免
 *       之一 / 给非阻断格补墙 → 红
 *   T5  IMPREGNABLE 漏 origin 豁免 / 漏外圈邻格 → 红
 *   T6  NO_INTERIOR_FLAG 不摘机器标记 / 把 wired 格也摘了 → 红
 *   T7  生产蓝图数据坏（地形名拼错/旗标错/instanceCount 错）→ 建造失败或
 *       产出偏离 CE → 红；§4 方案 2 的偏差形态被钉死（防止"顺手照抄"）
 *   T8  蓝图只存在不入池（抽签资格/深度区间写错）→ 端到端缺席 → 红
 */
import { describe, it, expect } from 'vitest';
import { Grid, TerrainType, DungeonLayer, DCOLS, DROWS } from '../engine/Map/Grid';
import { BlueprintEngine } from '../engine/Generator/BlueprintEngine';
import type { BlueprintDef, FeatureDef, MachineResult } from '../engine/Generator/BlueprintEngine';
import type { Pos } from '../types';
import { rng } from '../engine/Random';
import { analyzeChokeMap } from '../engine/Map/LoopMap';
import { createHeadlessGame } from './harness';
import blueprintData from '../data/blueprints.json';

// ---------- 夹具（v_2b_2a 同源） ----------

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

function rect(x0: number, y0: number, x1: number, y1: number): Pos[] {
    const cells: Pos[] = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) cells.push({ x, y });
    return cells;
}

type Room = { cells: Pos[]; center: Pos; door: Pos | null };

function getApplyBp(engine: BlueprintEngine) {
    return (engine as unknown as {
        applyBlueprint(bp: BlueprintDef, r: Room): MachineResult | null;
    }).applyBlueprint;
}

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

const byId = (id: string): BlueprintDef =>
    (blueprintData as BlueprintDef[]).find(b => b.id === id)!;

function terrainCount(grid: Grid, cells: Pos[], t: TerrainType): number {
    return cells.filter(p => grid.getCell(p.x, p.y)!.terrain === t).length;
}

// ---------- P1：六条蓝图数据逐字段等于 CE 原表 ----------

describe('V-2b-2b P1：生产蓝图数据 ≡ CE GlobalsBrogue.c 原表（:198-220/:309-331）', () => {
    // 逐字段转录（CE 位置参数序：depths, roomSize, freq, featureCt, profile, flags）。
    // MF 键名按 web FeatureDef 形态；minimumInstanceCount = CE minInsts 列。
    it('3 号 Treasure room：depths/roomSize/freq/flags/features 全等', () => {
        const bp = byId('reward_treasure_room');
        expect(bp.depthRange).toEqual([8, 26]);            // {8, AMULET_LEVEL}
        expect(bp.roomSize).toEqual([20, 40]);
        expect(bp.frequency).toBe(20);
        expect(bp.category).toBe('reward');
        expect(bp.flags).toEqual([
            'BP_ROOM', 'BP_REWARD', 'BP_PURGE_INTERIOR',
            'BP_SURROUND_WITH_WALLS', 'BP_OPEN_INTERIOR', 'BP_IMPREGNABLE',
        ]);
        expect(bp.features).toHaveLength(6);
        const f = (i: number): FeatureDef => bp.features[i]!;
        // {0, CARPET, DUNGEON, {0,0}, 0, …, MF_EVERYWHERE}
        expect(f(0).terrain).toBe('CARPET');
        expect(f(0).instanceCount).toEqual([0, 0]);
        expect(f(0).minimumInstanceCount).toBe(0);
        expect(f(0).flags).toEqual(['MF_EVERYWHERE']);
        // 药水 {5,7} min 2 与卷轴 {4,6} min 2：一条 MF_ALTERNATIVE 替代组
        expect(f(1).itemCategory).toBe('POTION');
        expect(f(1).instanceCount).toEqual([5, 7]);
        expect(f(1).minimumInstanceCount).toBe(2);
        expect(f(1).personalSpace).toBe(2);
        expect(f(1).flags).toEqual(['MF_GENERATE_ITEM', 'MF_ALTERNATIVE', 'MF_TREAT_AS_BLOCKING']);
        expect(f(2).itemCategory).toBe('SCROLL');
        expect(f(2).instanceCount).toEqual([4, 6]);
        expect(f(2).minimumInstanceCount).toBe(2);
        expect(f(2).flags).toEqual(['MF_GENERATE_ITEM', 'MF_ALTERNATIVE', 'MF_TREAT_AS_BLOCKING']);
        // FUNGUS_FOREST {3,4}（SURFACE 层——web 以 FOLIAGE 别名承载）
        expect(f(3).terrain).toBe('FUNGUS_FOREST');
        expect(f(3).instanceCount).toEqual([3, 4]);
        expect(f(3).minimumInstanceCount).toBe(0);
        expect(f(3).flags).toEqual([]);
        // 前厅递归 {1,1} min 1
        expect(f(4).flags).toEqual(['MF_BUILD_AT_ORIGIN', 'MF_PERMIT_BLOCKING', 'MF_BUILD_VESTIBULE']);
        // 雕像 {2,3} min 0：进墙 + 不可挖
        expect(f(5).terrain).toBe('STATUE_INERT');
        expect(f(5).instanceCount).toEqual([2, 3]);
        expect(f(5).minimumInstanceCount).toBe(0);
        expect(f(5).flags).toEqual(['MF_TREAT_AS_BLOCKING', 'MF_BUILD_IN_WALLS', 'MF_IMPREGNABLE']);
    });

    it('4 号 permanent pedestal 与 5 号 consumable pedestal：拆分后各自全等', () => {
        const p = byId('reward_pedestal_permanent');
        expect(p.depthRange).toEqual([5, 16]);
        expect(p.roomSize).toEqual([10, 30]);
        expect(p.frequency).toBe(30);
        expect(p.flags).toEqual([
            'BP_ROOM', 'BP_REWARD', 'BP_PURGE_INTERIOR',
            'BP_SURROUND_WITH_WALLS', 'BP_OPEN_INTERIOR', 'BP_IMPREGNABLE',
        ]);
        expect(p.features).toHaveLength(6);
        expect(p.features[0]!.flags).toEqual(['MF_EVERYWHERE']);
        expect(p.features[1]!.terrain).toBe('STATUE_INERT');
        expect(p.features[1]!.instanceCount).toEqual([2, 3]);
        expect(p.features[1]!.minimumInstanceCount).toBe(0);
        // 三个基座 feature = 一条 MF_ALTERNATIVE 替代组（CE :208-211）
        expect(p.features[2]).toMatchObject({ terrain: 'PEDESTAL', itemCategory: 'WEAPON', instanceCount: [1, 1], minimumInstanceCount: 1 });
        expect(p.features[2]!.flags).toEqual(['MF_GENERATE_ITEM', 'MF_ALTERNATIVE', 'MF_REQUIRE_GOOD_RUNIC', 'MF_NO_THROWING_WEAPONS', 'MF_TREAT_AS_BLOCKING']);
        expect(p.features[3]).toMatchObject({ terrain: 'PEDESTAL', itemCategory: 'ARMOR', instanceCount: [1, 1], minimumInstanceCount: 1 });
        expect(p.features[4]).toMatchObject({ terrain: 'PEDESTAL', itemCategory: 'STAFF', instanceCount: [2, 2], minimumInstanceCount: 2 });
        expect(p.features[5]!.flags).toEqual(['MF_BUILD_AT_ORIGIN', 'MF_PERMIT_BLOCKING', 'MF_BUILD_VESTIBULE']);

        const c = byId('reward_pedestal_consumable');
        expect(c.depthRange).toEqual([10, 26]);            // {10, AMULET_LEVEL}
        expect(c.roomSize).toEqual([10, 30]);
        expect(c.frequency).toBe(30);
        expect(c.features).toHaveLength(5);
        expect(c.features[1]!.instanceCount).toEqual([1, 3]); // 雕像 {1,3} min 0
        expect(c.features[2]).toMatchObject({ terrain: 'PEDESTAL', itemCategory: 'SCROLL', itemId: 'scroll_of_enchantment', instanceCount: [1, 1] });
        expect(c.features[3]).toMatchObject({ terrain: 'PEDESTAL', itemCategory: 'POTION', itemId: 'potion_of_life', instanceCount: [1, 1] });
        expect(c.features[2]!.flags).toEqual(['MF_GENERATE_ITEM', 'MF_ALTERNATIVE', 'MF_TREAT_AS_BLOCKING']);
        expect(c.features[3]!.flags).toEqual(['MF_GENERATE_ITEM', 'MF_ALTERNATIVE', 'MF_TREAT_AS_BLOCKING']);
    });

    it('19 号 barricade / 20 号 statue doorway / 23 号 pit traps：全等 + §4 偏差钉死', () => {
        const b = byId('vestibule_flammable_barricade');
        expect(b.depthRange).toEqual([1, 6]);
        expect(b.roomSize).toEqual([1, 1]);
        expect(b.frequency).toBe(10);
        expect(b.flags).toEqual(['BP_VESTIBULE']);
        // §4 方案 2：CE 原表为 3 个 feature（WOODEN_BARRICADE + 两件
        // MF_ALTERNATIVE 点火物 INCENDIARY_DART / POTION_INCINERATION）。
        // web 的 incendiary_dart 投掷落点不点火（引擎零消费点），照抄会让
        // 掷到飞镖的那一半房间不可解——本轮去掉飞镖 feature 与 ALTERNATIVE
        // 配对，只保留焚化药水。"飞镖点燃接线"轮反转本断言时：
        //   features 恢复 3 条 + 两条点火物各带 MF_ALTERNATIVE。
        expect(b.features).toHaveLength(2);
        expect(b.features[0]).toMatchObject({ terrain: 'WOODEN_BARRICADE', instanceCount: [1, 1], minimumInstanceCount: 1, personalSpace: 1 });
        expect(b.features[0]!.flags).toEqual(['MF_PERMIT_BLOCKING', 'MF_BUILD_AT_ORIGIN']);
        expect(b.features[1]).toMatchObject({ itemCategory: 'POTION', itemId: 'potion_of_incineration', instanceCount: [1, 1], minimumInstanceCount: 1, personalSpace: 1 });
        expect(b.features[1]!.flags).toEqual(['MF_GENERATE_ITEM', 'MF_BUILD_ANYWHERE_ON_LEVEL', 'MF_NOT_IN_HALLWAY']);
        for (const f of b.features) {
            expect(f.flags, '§4 方案 2：本轮不得有 ALTERNATIVE 载体（CE 19 号原文带，接线轮恢复）')
                .not.toContain('MF_ALTERNATIVE');
        }

        const s = byId('vestibule_statue_doorway');
        expect(s.depthRange).toEqual([1, 26]);             // {1, AMULET_LEVEL}
        expect(s.roomSize).toEqual([1, 1]);
        expect(s.frequency).toBe(6);
        expect(s.flags).toEqual(['BP_VESTIBULE']);
        expect(s.features).toHaveLength(2);
        expect(s.features[0]).toMatchObject({ terrain: 'STATUE_INERT_DOORWAY', instanceCount: [1, 1], minimumInstanceCount: 1 });
        expect(s.features[1]).toMatchObject({ itemCategory: 'SCROLL', itemId: 'scroll_of_shattering', instanceCount: [1, 1] });
        expect(s.features[1]!.flags).toEqual(['MF_GENERATE_ITEM', 'MF_BUILD_ANYWHERE_ON_LEVEL', 'MF_NOT_IN_HALLWAY']);

        const t = byId('vestibule_pit_trap_field');
        expect(t.depthRange).toEqual([1, 26]);
        expect(t.roomSize).toEqual([30, 60]);
        expect(t.frequency).toBe(8);
        expect(t.flags).toEqual(['BP_VESTIBULE', 'BP_OPEN_INTERIOR', 'BP_NO_INTERIOR_FLAG']);
        expect(t.features).toHaveLength(3);
        expect(t.features[0]).toMatchObject({ terrain: 'DOOR', instanceCount: [1, 1], minimumInstanceCount: 1, personalSpace: 1 });
        expect(t.features[0]!.flags).toEqual(['MF_PERMIT_BLOCKING', 'MF_BUILD_AT_ORIGIN', 'MF_ALTERNATIVE']);
        expect(t.features[1]).toMatchObject({ terrain: 'SECRET_DOOR', instanceCount: [1, 1], minimumInstanceCount: 1, personalSpace: 1 });
        expect(t.features[1]!.flags).toEqual(['MF_IMPREGNABLE', 'MF_PERMIT_BLOCKING', 'MF_BUILD_AT_ORIGIN', 'MF_ALTERNATIVE']);
        expect(t.features[2]).toMatchObject({ terrain: 'TRAP_DOOR_HIDDEN', instanceCount: [60, 60], minimumInstanceCount: 1, personalSpace: 1 });
        expect(t.features[2]!.flags).toEqual(['MF_TREAT_AS_BLOCKING', 'MF_REPEAT_UNTIL_NO_PROGRESS']);
    });
});

// ---------- T1：BP_OPEN_INTERIOR ----------

describe('V-2b-2b T1：BP_OPEN_INTERIOR（CE expandMachineInterior :607-674）', () => {
    // 5×5 房间中心一堵孤墙：8 邻全 interior 开格 → 吞并（凸化）。
    const pocketCells = rect(6, 6, 10, 10).filter(p => !(p.x === 8 && p.y === 8));
    const buildGrid = (): Grid => {
        const grid = blankGrid();
        carve(grid, pocketCells);
        grid.setTerrain(8, 8, TerrainType.WALL, '#', 0x555566);
        return grid;
    };
    const room: Room = { cells: pocketCells, center: { x: 8, y: 7 }, door: { x: 6, y: 8 } };

    it('凸化：内部孤墙被吞并成 FLOOR 并入机器', () => {
        const bp: BlueprintDef = {
            id: 'v2b2b_open', name: 'v2b2b_open', depthRange: [1, 26], roomSize: [20, 30],
            frequency: 1, category: 'test', flags: ['BP_ROOM', 'BP_OPEN_INTERIOR'], features: [],
        } as unknown as BlueprintDef;
        const { result, grid } = runOnce(buildGrid, bp, room, 20260919);
        expect(result).not.toBeNull();
        expect(grid.getCell(8, 8)!.terrain, '孤墙应被扩张吞并成 FLOOR').toBe(TerrainType.FLOOR);
        expect(result!.cells.some(p => p.x === 8 && p.y === 8), '吞并格应进机器 cells').toBe(true);
        // 吞并不掉外部：边界墙的 interior 开邻 ≤3 <4，房间外圈不得被吃
        expect(grid.getCell(4, 8)!.terrain).toBe(TerrainType.GRANITE);
        expect(result!.cells.length).toBe(pocketCells.length + 1);
    });

    it('无旗标对照：孤墙保留、不入机器（扩张器没被无条件执行）', () => {
        const bp: BlueprintDef = {
            id: 'v2b2b_plain', name: 'v2b2b_plain', depthRange: [1, 26], roomSize: [20, 30],
            frequency: 1, category: 'test', flags: ['BP_ROOM'], features: [],
        } as unknown as BlueprintDef;
        const { result, grid } = runOnce(buildGrid, bp, room, 20260919);
        expect(result).not.toBeNull();
        expect(grid.getCell(8, 8)!.terrain).toBe(TerrainType.WALL);
        expect(result!.cells.some(p => p.x === 8 && p.y === 8)).toBe(false);
    });

    it('吞并格的花岗岩邻墙改 WALL（CE :651-656）；洞开格不得被吞（外部世界检查）', () => {
        // 西边墙上开一个 1 格缺口 (6,8) 为 WALL、(5,8) 为 GRANITE：
        // (6,8) 的 interior 开邻 = 8-2=…（上下左均为墙，右侧 5 格开）→ 计 5 ≥4；
        // 外敞检查：左邻 (5,8) 为花岗岩（阻挡）→ 外敞 0 → (6,8) 被吞并，
        // 其花岗岩邻 (5,7)/(5,8)/(5,9) 改 WALL。
        const cells = rect(6, 6, 10, 10).filter(p => !(p.x === 6 && p.y === 8));
        const build2 = (): Grid => {
            const grid = blankGrid();
            carve(grid, cells);
            return grid;
        };
        const bp: BlueprintDef = {
            id: 'v2b2b_open2', name: 'v2b2b_open2', depthRange: [1, 26], roomSize: [20, 30],
            frequency: 1, category: 'test', flags: ['BP_ROOM', 'BP_OPEN_INTERIOR'], features: [],
        } as unknown as BlueprintDef;
        const { result, grid } = runOnce(build2, bp, { cells, center: { x: 8, y: 8 }, door: { x: 6, y: 7 } }, 20260919);
        expect(result).not.toBeNull();
        expect(grid.getCell(6, 8)!.terrain, '边缘缺口格被吞并').toBe(TerrainType.FLOOR);
        expect(grid.getCell(5, 8)!.terrain, 'CE :651-656：吞并格的花岗岩邻改 WALL').toBe(TerrainType.WALL);
        // 更外侧的花岗岩（非吞并格邻居）不得动
        expect(grid.getCell(4, 8)!.terrain).toBe(TerrainType.GRANITE);
    });
});

// ---------- T2/T3：PURGE_PATHING_BLOCKERS / PURGE_LIQUIDS ----------

describe('V-2b-2b T2：BP_PURGE_PATHING_BLOCKERS（CE :882-896）', () => {
    const cells = rect(6, 6, 10, 10);
    const buildGrid = (): Grid => {
        const grid = blankGrid();
        carve(grid, cells);
        grid.setTerrain(8, 7, TerrainType.TRAP, '^', 0x884400);
        grid.getCell(8, 7)!.trapType = 'poison_gas';
        return grid;
    };
    const room: Room = { cells, center: { x: 8, y: 9 }, door: { x: 6, y: 8 } };

    it('内部陷阱被清成 FLOOR；非阻断地形（草）保留', () => {
        const bp: BlueprintDef = {
            id: 'v2b2b_ppb', name: 'v2b2b_ppb', depthRange: [1, 26], roomSize: [20, 30],
            frequency: 1, category: 'test',
            flags: ['BP_ROOM', 'BP_PURGE_PATHING_BLOCKERS'],
            features: [{ terrain: 'GRASS', instanceCount: [1, 1], minimumInstanceCount: 1, flags: [] } as unknown as FeatureDef],
        } as unknown as BlueprintDef;
        const { result, grid } = runOnce(buildGrid, bp, room, 20260919);
        expect(result).not.toBeNull();
        expect(grid.getCell(8, 7)!.terrain, 'T_PATHING_BLOCKER 陷阱应被清').toBe(TerrainType.FLOOR);
        expect(terrainCount(grid, cells, TerrainType.GRASS), '非阻断地形不受此旗标影响').toBe(1);
    });

    it('无旗标对照：陷阱保留', () => {
        const bp: BlueprintDef = {
            id: 'v2b2b_ppb0', name: 'v2b2b_ppb0', depthRange: [1, 26], roomSize: [20, 30],
            frequency: 1, category: 'test', flags: ['BP_ROOM'], features: [],
        } as unknown as BlueprintDef;
        const { grid } = runOnce(buildGrid, bp, room, 20260919);
        expect(grid.getCell(8, 7)!.terrain).toBe(TerrainType.TRAP);
    });
});

describe('V-2b-2b T3：BP_PURGE_LIQUIDS（CE :897-907）', () => {
    const cells = rect(6, 6, 10, 10);
    const buildGrid = (): Grid => {
        const grid = blankGrid();
        carve(grid, cells);
        grid.setTerrainLayer(8, 7, DungeonLayer.LIQUID, TerrainType.WATER_SHALLOW);
        return grid;
    };
    const room: Room = { cells, center: { x: 8, y: 9 }, door: { x: 6, y: 8 } };

    it('液体层被清空（DUNGEON 层 FLOOR 保留）；浅水不是寻路阻断体，PURGE_PATHING_BLOCKERS 清不掉它', () => {
        const bp: BlueprintDef = {
            id: 'v2b2b_pl', name: 'v2b2b_pl', depthRange: [1, 26], roomSize: [20, 30],
            frequency: 1, category: 'test',
            flags: ['BP_ROOM', 'BP_PURGE_LIQUIDS', 'BP_PURGE_PATHING_BLOCKERS'],
            features: [],
        } as unknown as BlueprintDef;
        const { grid } = runOnce(buildGrid, bp, room, 20260919);
        expect(grid.getCell(8, 7)!.layers[DungeonLayer.LIQUID], '液体层应清空').toBe(TerrainType.NOTHING);
        expect(grid.getCell(8, 7)!.terrain, '地基层保留').toBe(TerrainType.FLOOR);
    });

    it('无旗标对照：液体保留', () => {
        const bp: BlueprintDef = {
            id: 'v2b2b_pl0', name: 'v2b2b_pl0', depthRange: [1, 26], roomSize: [20, 30],
            frequency: 1, category: 'test', flags: ['BP_ROOM'], features: [],
        } as unknown as BlueprintDef;
        const { grid } = runOnce(buildGrid, bp, room, 20260919);
        expect(grid.getCell(8, 7)!.layers[DungeonLayer.LIQUID]).toBe(TerrainType.WATER_SHALLOW);
    });
});

// ---------- T4/T5：SURROUND_WITH_WALLS / IMPREGNABLE（chokepoint 夹具） ----------

// 死角房 B（x17..24 × y5..10）经一格走廊嘴 (16,7) 连向西——(16,7) 的 ring
// 有三条可通行弧（东侧房 B、(15,7) 陷阱短枝、(15,8) 地板短枝）且上下皆
// 阻断 → 分析口径的 chokepoint/gate 位（CE IS_CHOKEPOINT 是">2 弧+夹缝"
// 的对角挤压点，直线走廊格不是）。origin = (16,7)。
// (15,7) TRAP 是"仅邻 origin"的可通行阻断体——它被补墙与否就是
// "机器会不会被自己的墙封死"的观测点（CE :912/:919 的 IS_GATE_SITE 豁免）。
const B_ROOM = rect(17, 5, 24, 10);
const CHOKE_ROOM_CELLS: Pos[] = [...B_ROOM, { x: 16, y: 7 }];
const CHOKE_ORIGIN: Pos = { x: 16, y: 7 };

function buildChokeGrid(): Grid {
    const grid = blankGrid();
    carve(grid, CHOKE_ROOM_CELLS);
    carve(grid, [{ x: 15, y: 8 }]);                                 // 短枝地板（第三条弧）
    grid.setTerrain(15, 7, TerrainType.TRAP, '^', 0x884400);        // 仅邻 origin 的阻断体
    grid.setTerrain(16, 6, TerrainType.WATER_DEEP, '~', 0x1133aa);  // 邻多格 interior 的阻断体
    grid.setTerrain(24, 4, TerrainType.WATER_DEEP, '~', 0x1133aa);  // 邻 interior (24,5)/(23,5)
    return grid;
}

describe('V-2b-2b T4：BP_SURROUND_WITH_WALLS（CE :908-932，含 IS_GATE_SITE 豁免）', () => {
    it('夹具自检：(16,7) 是分析口径的 gate 位，(15,7)/(16,6) 不是', () => {
        const analysis = analyzeChokeMap(buildChokeGrid());
        expect(analysis.gateSite[16]![7], '走廊嘴（三弧夹缝）应是 gate site').toBe(true);
        expect(analysis.gateSite[15]![7], '(15,7) 是叶子短枝，不是 gate 位').toBe(false);
        expect(analysis.gateSite[16]![6], '(16,6) 不是 gate 位').toBe(false);
    });

    it('非 gate 位的阻断外格补墙；origin 邻域豁免（否则机器被封死）；非阻断/挡通行外格不动', () => {
        const bp: BlueprintDef = {
            id: 'v2b2b_sww', name: 'v2b2b_sww', depthRange: [1, 26], roomSize: [40, 60],
            frequency: 1, category: 'test', flags: ['BP_ROOM', 'BP_SURROUND_WITH_WALLS'], features: [],
        } as unknown as BlueprintDef;
        const { result, grid } = runOnce(
            buildChokeGrid, bp,
            { cells: CHOKE_ROOM_CELLS, center: { x: 20, y: 7 }, door: CHOKE_ORIGIN },
            20260919
        );
        expect(result).not.toBeNull();
        expect(grid.getCell(16, 6)!.terrain, 'WATER_DEEP 邻 interior（非 gate 位）→ 补墙').toBe(TerrainType.WALL);
        expect(grid.getCell(24, 4)!.terrain, 'WATER_DEEP 邻 (24,5)/(23,5) → 补墙').toBe(TerrainType.WALL);
        expect(grid.getCell(15, 7)!.terrain,
            'origin 唯一阻断外邻：IS_GATE_SITE/origin 豁免——补了墙机器就被封死（CE :912/:919）')
            .toBe(TerrainType.TRAP);
        // 非阻断外格不补墙（短枝地板）
        expect(grid.getCell(15, 8)!.terrain).toBe(TerrainType.FLOOR);
        // 挡通行外格本来就不是候选（T_OBSTRUCTS_PASSABILITY 豁免）
        expect(grid.getCell(16, 8)!.terrain).toBe(TerrainType.GRANITE);
        expect(grid.getCell(14, 7)!.terrain).toBe(TerrainType.GRANITE);
    });

    it('origin 子句豁免：origin 已属父机器（前厅子机器形态，重算分析不再标它）时仍不补墙', () => {
        // 生产场景：前厅子机器的 origin = 父机器门位格（machineNumber ≠ 0）
        //——重算的 chokeMap 分析把它剔出 passMap，gateSite[origin] = false，
        // 此时 origin 豁免只剩 isGateSite 的 origin 子句（CE 的 pmap
        // IS_GATE_SITE 位在机器化后仍在，web 分析口径必须用 origin 子句补回）。
        const buildMarked = (): Grid => {
            const grid = buildChokeGrid();
            grid.getCell(CHOKE_ORIGIN.x, CHOKE_ORIGIN.y)!.machineNumber = 999; // 父机器
            return grid;
        };
        const bp: BlueprintDef = {
            id: 'v2b2b_sww2', name: 'v2b2b_sww2', depthRange: [1, 26], roomSize: [40, 60],
            frequency: 1, category: 'test', flags: ['BP_ROOM', 'BP_SURROUND_WITH_WALLS'], features: [],
        } as unknown as BlueprintDef;
        const { result, grid } = runOnce(
            buildMarked, bp,
            { cells: CHOKE_ROOM_CELLS, center: { x: 20, y: 7 }, door: CHOKE_ORIGIN },
            20260919
        );
        expect(result).not.toBeNull();
        expect(grid.getCell(15, 7)!.terrain,
            '(15,7) 仅邻 origin：origin 子句豁免失守 = 机器入口被封死（CE :912）')
            .toBe(TerrainType.TRAP);
        // 分析侧豁免不适用（origin 被剔出 passMap）——非 origin 邻的阻断格照常补墙
        expect(grid.getCell(16, 6)!.terrain).toBe(TerrainType.WALL);
    });
});

describe('V-2b-2b T5：BP_IMPREGNABLE（CE :938-958，含 IS_GATE_SITE 豁免）', () => {
    it('interior（origin 豁免）与外圈邻格全部标记；origin 唯一外邻不得沾染', () => {
        const bp: BlueprintDef = {
            id: 'v2b2b_imp', name: 'v2b2b_imp', depthRange: [1, 26], roomSize: [40, 60],
            frequency: 1, category: 'test', flags: ['BP_ROOM', 'BP_IMPREGNABLE'], features: [],
        } as unknown as BlueprintDef;
        const { result, engine } = runOnce(
            buildChokeGrid, bp,
            { cells: CHOKE_ROOM_CELLS, center: { x: 20, y: 7 }, door: CHOKE_ORIGIN },
            20260919
        );
        expect(result).not.toBeNull();
        expect(engine.isImpregnable(CHOKE_ORIGIN.x, CHOKE_ORIGIN.y), 'origin（gate 位）不标记').toBe(false);
        for (const p of B_ROOM) {
            expect(engine.isImpregnable(p.x, p.y), `interior (${p.x},${p.y}) 应标记`).toBe(true);
        }
        expect(engine.isImpregnable(16, 6), 'interior 外圈邻格应标记（CE :947-956）').toBe(true);
        expect(engine.isImpregnable(24, 4), 'interior 外圈邻格应标记').toBe(true);
        expect(engine.isImpregnable(15, 7), 'origin 唯一外邻：经 origin 的标记被豁免').toBe(false);
        expect(engine.isImpregnable(15, 8), 'origin 唯一外邻（短枝地板）不标记').toBe(false);
        expect(engine.isImpregnable(12, 12), '远离机器的格不沾染').toBe(false);
    });
});

// ---------- T6：BP_NO_INTERIOR_FLAG ----------

describe('V-2b-2b T6：BP_NO_INTERIOR_FLAG（CE :1691-1702）', () => {
    const cells = rect(6, 6, 10, 10);

    it('机器建成后全部格子的机器标记被摘除', () => {
        const bp: BlueprintDef = {
            id: 'v2b2b_nif', name: 'v2b2b_nif', depthRange: [1, 26], roomSize: [20, 30],
            frequency: 1, category: 'test', flags: ['BP_ROOM', 'BP_NO_INTERIOR_FLAG'], features: [],
        } as unknown as BlueprintDef;
        const { result, grid } = runOnce(buildGrid0, bp, { cells, center: { x: 8, y: 8 }, door: { x: 6, y: 8 } }, 20260919);
        expect(result).not.toBeNull();
        for (const p of result!.cells) {
            expect(grid.getCell(p.x, p.y)!.machineNumber, `(${p.x},${p.y}) 标记应被摘除`).toBe(0);
        }
        // feature 格（后并入机器的）同样摘除
        expect(grid.getCell(6, 8)!.machineNumber).toBe(0);
    });

    it('TM_IS_WIRED 豁免（CE :1694）——已按 V-2b-3 反转：预置 wired 格先被剪线，feature 自带载体才受豁免', () => {
        // ★★ V-2b-3 留痕反转：原断言的前提失效，不是回归 ★★
        //
        // 原断言（V-2b-2b 时）：在机器内部**预置**一块 PRESSURE_PLATE，断言它作为
        // "wired 格"被 CE Architect.c:1691-1702（BP_NO_INTERIOR_FLAG）豁免、
        // 保留机器标记。当时成立——因为 web 还没有 CE 剪线步（Architect.c:1238-1243）。
        //
        // V-2b-3 补齐该剪线步（CE 注释原文 "Clear wired tiles in case we stole
        // them from another machine"）后该前提不再为真：机器标记块先无条件把内部
        // 既有的 TM_IS_WIRED | TM_IS_CIRCUIT_BREAKER 层清成 FLOOR/NOTHING，于是
        // 到 :1694 时该格**已不带** TM_IS_WIRED，自然不获豁免。
        //
        // **这是 CE 的真实行为，实现侧无需改动**（已回源码复核；注意 web 代码
        // 注释里把剪线块记成 ":1244-1250"，实测是 **:1238-1243**，见报告）：
        //   - CE Architect.c:1228-1246 机器标记块，其中 **:1238-1243**：`for
        //     layer … if tileCatalog[pmap[i][j].layers[layer]].mechFlags &
        //     (TM_IS_WIRED | TM_IS_CIRCUIT_BREAKER) → layers[layer] =
        //     (layer == DUNGEON ? FLOOR : NOTHING)`——它在 **feature 落位之前**
        //     （feature 的并入机器标记在 :1486-1488，远晚于此）；
        //   - CE Architect.c:1690-1702 BP_NO_INTERIOR_FLAG：`machineNumber ==
        //     machineNumber && !cellHasTMFlag((pos){i,j}, TM_IS_WIRED |
        //     TM_IS_CIRCUIT_BREAKER)` 才清标记——剪线过的旧板在此已不合格。
        // 所以在 CE 里"机器吞并前就在格上的旧板"同样保不住标记。web 的现状
        //（标记 0）是 CE 的忠实结果；旧断言期望的 12 才是那个过期前提的产物。
        //
        // 按留痕反转纪律：不删断言，把两半事实都钉死——
        //   (a) 预置旧板：先剪线（地形回 FLOOR）→ 不获豁免 → 标记归零；
        //   (b) 蓝图**自己的** wired 载体（经 feature 在 :1238-1243 之后落位）：
        //       获豁免 → 保留标记。这一半正是原断言想守的东西，仍然守着。
        // 两条互为越界守卫：删掉 TM_IS_WIRED 豁免（BlueprintEngine.ts:1312）→
        // (b) 红；删掉剪线步（:924-933）→ (a) 红。（两条都做过反向验证，见报告。）
        const bpPreplaced: BlueprintDef = {
            id: 'v2b2b_nif2', name: 'v2b2b_nif2', depthRange: [1, 26], roomSize: [20, 30],
            frequency: 1, category: 'test', flags: ['BP_ROOM', 'BP_NO_INTERIOR_FLAG'], features: [],
        } as unknown as BlueprintDef;
        const preplaced = (): Grid => {
            const grid = blankGrid();
            carve(grid, cells);
            grid.setTerrain(8, 8, TerrainType.PRESSURE_PLATE, '_', 0x446644);
            return grid;
        };
        const r1 = runOnce(preplaced, bpPreplaced, { cells, center: { x: 8, y: 9 }, door: { x: 6, y: 8 } }, 20260919);
        expect(r1.result).not.toBeNull();
        expect(r1.grid.getCell(8, 8)!.layers[DungeonLayer.DUNGEON],
            'CE :1244-1250：机器吞并前就在格上的旧板应先被剪线清成 FLOOR').toBe(TerrainType.FLOOR);
        expect(r1.grid.getCell(8, 8)!.machineNumber,
            '剪线后已不带 TM_IS_WIRED → CE :1695 不豁免 → 标记归零').toBe(0);
        expect(r1.grid.getCell(9, 9)!.machineNumber, '普通格仍被摘除').toBe(0);

        // (b) feature 自带的 wired 载体：MF_BUILD_AT_ORIGIN → 落位确定（origin = door）。
        const bpOwnCarrier: BlueprintDef = {
            id: 'v2b2b_nif3', name: 'v2b2b_nif3', depthRange: [1, 26], roomSize: [20, 30],
            frequency: 1, category: 'test', flags: ['BP_ROOM', 'BP_NO_INTERIOR_FLAG'],
            features: [{
                terrain: 'GAS_TRAP_PARALYSIS', instanceCount: [1, 1], minimumInstanceCount: 1,
                personalSpace: 1, flags: ['MF_BUILD_AT_ORIGIN', 'MF_PERMIT_BLOCKING'],
            } as unknown as FeatureDef],
        } as unknown as BlueprintDef;
        const r2 = runOnce(buildGrid0, bpOwnCarrier, { cells, center: { x: 8, y: 9 }, door: { x: 6, y: 8 } }, 20260919);
        expect(r2.result, 'origin 是唯一候选，min=1 不应失败').not.toBeNull();
        const own = r2.grid.getCell(6, 8)!;
        expect(own.layers[DungeonLayer.DUNGEON], 'wired 载体应落在 origin（MF_BUILD_AT_ORIGIN）')
            .toBe(TerrainType.GAS_TRAP_PARALYSIS);
        expect(own.machineNumber, 'TM_IS_WIRED 格保留机器标记（CE :1695）').toBe(r2.result!.machineNumber);
        expect(r2.grid.getCell(9, 9)!.machineNumber, '非 wired 的普通格仍被摘除（越界守卫）').toBe(0);
    });

    function buildGrid0(): Grid {
        const grid = blankGrid();
        carve(grid, cells);
        return grid;
    }
});

// ---------- T7：生产蓝图合成行使（CE 数据真实驱动建造） ----------

describe('V-2b-2b T7：生产蓝图 applyBlueprint 行使（19/20/23 号）', () => {
    it('19 号：木栅钉在 origin，焚化药水落在层内非走廊格', () => {
        const build = (): Grid => {
            const grid = blankGrid();
            carve(grid, [{ x: 10, y: 10 }]);  // origin（前厅 {1,1} → interior 仅此一格）
            carve(grid, [{ x: 30, y: 15 }]);  // BATO+NOT_IN_HALLWAY 的唯一候选
            return grid;
        };
        const { result, grid } = runOnce(build, byId('vestibule_flammable_barricade'),
            { cells: [{ x: 10, y: 10 }], center: { x: 10, y: 10 }, door: { x: 10, y: 10 } }, 20260919);
        expect(result, '两 feature 均 min 1 且候选充足，不应失败').not.toBeNull();
        expect(grid.getCell(10, 10)!.terrain).toBe(TerrainType.WOODEN_BARRICADE);
        expect(result!.itemSpawns).toHaveLength(1);
        expect(result!.itemSpawns[0]).toMatchObject({ category: 'POTION', id: 'potion_of_incineration', pos: { x: 30, y: 15 } });
    });

    it('20 号：门内雕像钉在 origin，碎裂卷轴落在层内非走廊格', () => {
        const build = (): Grid => {
            const grid = blankGrid();
            carve(grid, [{ x: 10, y: 10 }]);
            carve(grid, [{ x: 30, y: 15 }]);
            return grid;
        };
        const { result, grid } = runOnce(build, byId('vestibule_statue_doorway'),
            { cells: [{ x: 10, y: 10 }], center: { x: 10, y: 10 }, door: { x: 10, y: 10 } }, 20260919);
        expect(result).not.toBeNull();
        expect(grid.getCell(10, 10)!.terrain).toBe(TerrainType.STATUE_INERT_DOORWAY);
        expect(result!.itemSpawns).toHaveLength(1);
        expect(result!.itemSpawns[0]).toMatchObject({ category: 'SCROLL', id: 'scroll_of_shattering', pos: { x: 30, y: 15 } });
    });

    it('23 号：门/密门二选一钉 origin，陷阱铺满其余内部，机器标记全摘', () => {
        const cells = rect(10, 10, 15, 15); // 36 格 ∈ roomSize [30,60]
        const build = (): Grid => {
            const grid = blankGrid();
            carve(grid, cells);
            return grid;
        };
        const { result, grid } = runOnce(build, byId('vestibule_pit_trap_field'),
            { cells, center: { x: 10, y: 12 }, door: { x: 10, y: 12 } }, 20260919);
        expect(result).not.toBeNull();
        // OPEN_INTERIOR 无处可扩（边界墙开邻 ≤3）→ cells 恒 36
        expect(result!.cells.length).toBe(36);
        const origin = grid.getCell(10, 12)!;
        expect(origin.terrain === TerrainType.DOOR || origin.terrain === TerrainType.SECRET_DOOR,
            `origin 应为门/密门二选一，实为 ${origin.terrain}`).toBe(true);
        // REPEAT_UNTIL_NO_PROGRESS：陷阱铺满除 origin 外的全部内部格
        const traps = cells.filter(p => grid.getCell(p.x, p.y)!.terrain === TerrainType.TRAP_DOOR_HIDDEN);
        expect(traps.length, '陷阱应铺满除 origin 外的 35 格').toBe(35);
        // NO_INTERIOR_FLAG：全格机器标记摘除（陷阱区不算机器内）
        for (const p of cells) {
            expect(grid.getCell(p.x, p.y)!.machineNumber, `(${p.x},${p.y}) 应无机器标记`).toBe(0);
        }
    });
});

describe('V-2b-2b T7b：生产蓝图 applyBlueprint 行使（3/4/5 号，含前厅递归）', () => {
    // 夹具：奖励房（x5..19 × y3..13，165 格）+ 门 (20,8) + 走廊 (21,22) +
    // 死角房 B（x23..28 × y6..11）+ 缺口 (29,8) + 死角房 C（x30..35 × y6..10）。
    // 内部必须够大：CE 3/4/5 号的药水/卷轴/菌林 feature 全部 reqSpace=2
    //（落位占 3×3）——CE GlobalsBrogue.c 原表按 chokeMap≤40 的大死角 +
    // BP_OPEN_INTERIOR 扩张运作，165 格内部才能在满掷（7 药水+6 卷轴+4 菌林
    // = 153 格位）下装下全部 feature，min 检查不因格子耗尽而假失败。
    // 房 C 的割点保证 MF_BUILD_VESTIBULE 递归出的前厅/领养机器有处可建
    //（vestibule_locked 的钥匙外包需要未标记的 gate 位）。
    const PARENT = rect(5, 3, 19, 13);
    const FIX_CELLS: Pos[] = [...PARENT, { x: 20, y: 8 }];
    const buildFixture = (): Grid => {
        const grid = blankGrid();
        carve(grid, PARENT);
        carve(grid, [{ x: 20, y: 8 }, { x: 21, y: 8 }, { x: 22, y: 8 }]);
        carve(grid, rect(23, 6, 28, 11));
        carve(grid, [{ x: 29, y: 8 }]);
        carve(grid, rect(30, 6, 35, 10));
        return grid;
    };
    const FIX_ROOM: Room = { cells: FIX_CELLS, center: { x: 12, y: 8 }, door: { x: 20, y: 8 } };
    const SEED = 20260919;

    it('夹具自检：门位与房 C 缺口是 gate 位（前厅递归有处可建）', () => {
        const analysis = analyzeChokeMap(buildFixture());
        expect(analysis.gateSite[20]![8]).toBe(true);
        expect(analysis.gateSite[29]![8]).toBe(true);
    });

    it('3 号：地毯铺满（center/door 保留）、雕像进墙、菌林 3-4、药水 XOR 卷轴、前厅子机器建成', () => {
        const { result, grid } = runOnce(buildFixture, byId('reward_treasure_room'), FIX_ROOM, SEED);
        expect(result, 'reward_treasure_room 应建成（失败=蓝图数据或 BP_* 改造有错）').not.toBeNull();
        const interior = result!.cells;
        // CE :1443 纯层写入：菌林落 SURFACE 不清 DUNGEON 地毯——地毯数按
        // DUNGEON 层计（effective terrain 会被菌林 45 < 85 压住）。
        const carpetCells = interior.filter(p => grid.getCell(p.x, p.y)!.layers[DungeonLayer.DUNGEON] === TerrainType.CARPET);
        expect(carpetCells.length, 'MF_EVERYWHERE 地毯铺满（166 - center - door）').toBe(164);
        const statues = rect(1, 1, DCOLS - 2, DROWS - 2).filter(p => grid.getCell(p.x, p.y)!.terrain === TerrainType.STATUE_INERT);
        expect(statues.length, '雕像 {2,3} 落在 interior 之外的墙格（BUILD_IN_WALLS）').toBeGreaterThanOrEqual(2);
        expect(statues.length).toBeLessThanOrEqual(3);
        for (const p of statues) {
            expect(interior.some(q => q.x === p.x && q.y === p.y), '雕像不得落在 interior 内').toBe(false);
        }
        expect(terrainCount(grid, interior, TerrainType.FOLIAGE), 'FUNGUS_FOREST 别名 → FOLIAGE {3,4}').toBeGreaterThanOrEqual(3);
        expect(terrainCount(grid, interior, TerrainType.FOLIAGE)).toBeLessThanOrEqual(4);
        const potions = result!.itemSpawns.filter(s => s.category === 'POTION');
        const scrolls = result!.itemSpawns.filter(s => s.category === 'SCROLL');
        expect(potions.length === 0 || scrolls.length === 0, 'CE :202-203 替代组：药水 XOR 卷轴').toBe(true);
        expect(potions.length === 0 || (potions.length >= 5 && potions.length <= 7)).toBe(true);
        expect(scrolls.length === 0 || (scrolls.length >= 4 && scrolls.length <= 6)).toBe(true);
        expect(result!.subMachines.length, 'MF_BUILD_VESTIBULE 前厅子机器应建成').toBeGreaterThanOrEqual(1);
    });

    it('4 号：恰一个基座 feature 建成（武器/护甲 1 件或法杖 2 根），绝无跨类别双份', () => {
        const { result } = runOnce(buildFixture, byId('reward_pedestal_permanent'), FIX_ROOM, SEED);
        expect(result).not.toBeNull();
        const bigPrizes = result!.itemSpawns.filter(s =>
            ['WEAPON', 'ARMOR', 'STAFF'].includes(s.category) && !s.id);
        const cats = new Set(bigPrizes.map(s => s.category));
        expect(cats.size, 'CE :208-211 替代三选一：恰一个类别').toBe(1);
        const n = bigPrizes.length;
        expect(n === 1 || n === 2, `大奖件数 ${n} ∉ {1,2}（法杖 [2,2] 一次两根）`).toBe(true);
        expect(result!.subMachines.length).toBeGreaterThanOrEqual(1);
    });

    it('5 号：附魔卷轴 XOR 生命药水，恰一件', () => {
        const { result } = runOnce(buildFixture, byId('reward_pedestal_consumable'), FIX_ROOM, SEED);
        expect(result).not.toBeNull();
        const ench = result!.itemSpawns.filter(s => s.id === 'scroll_of_enchantment');
        const life = result!.itemSpawns.filter(s => s.id === 'potion_of_life');
        expect(ench.length + life.length, 'CE :216-219 替代二选一：恰一件').toBe(1);
        expect(result!.subMachines.length).toBeGreaterThanOrEqual(1);
    });
});

// ---------- T8：端到端——六条蓝图在整局生成中真实入池 ----------

describe('V-2b-2b T8：整局生成入池（抽签资格 + 深度区间 + 递归路径）', () => {
    // 8 seed × D1-26：reward 池（#3 18%/##4 28%/#5 28% 每抽）≈ 60 抽、
    // 前厅递归 ≈ 60 次（#19 8%/#20 4.8%/#23 6.4% 每次递归）。
    // 三条前厅蓝图合并断言（合并缺席概率 <1e-5）；单条缺席的漏网风险由
    // T7 的合成行使兜底（数据/旗标正确性不依赖本条）。
    it('reward 三条各自出现；前厅三条合并出现', () => {        const proto = BlueprintEngine.prototype as unknown as Record<string, unknown>;
        const original = proto.buildMachines as (this: unknown) => MachineResult[];
        const all: MachineResult[] = [];
        proto.buildMachines = function (this: unknown) {
            const results = original.call(this);
            all.push(...results);
            return results;
        };
        try {
            for (const seed of [424242, 777, 20260913, 31337, 20260916, 1, 42, 999]) {
                const game = createHeadlessGame(seed);
                for (let d = 1; d <= 26; d++) {
                    if (d > 1) {
                        game.depth = d;
                        (game as unknown as { generateDepth(isGoingUp: boolean, isFirstLevel: boolean): void })
                            .generateDepth(false, false);
                    }
                }
            }
        } finally {
            proto.buildMachines = original;
        }
        const ids = new Set(all.map(r => r.blueprintId));
        for (const id of ['reward_treasure_room', 'reward_pedestal_permanent', 'reward_pedestal_consumable']) {
            expect(ids.has(id), `${id} 在 8 整局中一次都没建成——抽签资格/深度区间/旗标有错`).toBe(true);
        }
        const vestibuleTrio = ['vestibule_flammable_barricade', 'vestibule_statue_doorway', 'vestibule_pit_trap_field'];
        expect(vestibuleTrio.some(id => ids.has(id)),
            '三条 CE 前厅蓝图在 8 整局中全部缺席——递归资格有错').toBe(true);
    });
});
