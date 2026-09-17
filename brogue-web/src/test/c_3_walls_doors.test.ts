/// <reference types="node" />
/**
 * src/test/c_3_walls_doors.test.ts — C-3：removeDiagonalOpenings / finishDoors / finishWalls
 *
 * CE 对照（BrogueCE-master/src/brogue/Architect.c，只读）：
 *   removeDiagonalOpenings 1913-1949（digDungeon 第 8 步，Architect.c:2936）
 *   finishDoors            2733-2756（第 13 步，2971）
 *   finishWalls            2480-2518（第 5 步 false = 2909；第 14 步 true = 2974）
 *
 * 断言策略（同 c_0/p1_33 房规）：单元对抗打在手工夹具上并逐一注明被捕获的
 * 错误实现；行为断言打在真实生成的关卡上；生产实参/阶段用观测字段钉住。
 *
 * 对抗清单（任务书第 4 条的五种错误实现 + 补充）：
 *   AD1  removeDiagonalOpenings 只扫一遍而非 do-while 收敛 → T9（机器侧格
 *        守卫使首趟掷骰落空，单趟变体永不收敛，do-while 变体重掷后解决）
 *   AD2  孤儿门两条判据任一写反 → T6a/T6b 夹具 + T8 真实层移除数
 *   AD3  密门概率不随深度 / clamp 上界写错 → T1 概率表 + T7 D1 零密门 +
 *        T8 D26 比率带
 *   AD4  机器内部的门被误改（machineNumber 守卫漏掉）→ T6d + T10 的 mn 恒
 *        不变量
 *   AD5  finishWalls 两次调用实参写反 → T3 对角暴露语义夹具（牙）+
 *        T4 生产调用记录
 *
 * 密门连通性口径（风险点 1 裁决）：web 有密门发现机制（Game.ts 移动邻接
 * 30% 揭示转 DOOR），CE 自身的环分析判据是
 * `T_PATHING_BLOCKER && !TM_IS_SECRET`（Architect.c:199-210，web 对应物
 * LoopMap.blocksPathing）——分析口径下密门视作通路。本文件的连通性闸门
 * （T12）按该口径执行：canMoveTo ∪ {SECRET_DOOR}。canMoveTo 字面口径的
 * 坏层（密门当作墙）只观测记录、不断言——p1_26/p1_33 的既有断言属验收方
 * 重校准范围（本轮禁改，结构性冲突见报告）。
 */
import { describe, it, expect } from 'vitest';

import { createHeadlessGame, terrainFingerprint } from './harness';
import { rng } from '../engine/Random';
import { Architect } from '../engine/Generator/Architect';
import { Grid, TerrainType, DCOLS, DROWS } from '../engine/Map/Grid';
import {
    removeDiagonalOpenings, finishDoors, finishWalls, secretDoorChance,
    obstructsPassability, obstructsVision, obstructsDiagonalMovement, isPathingBlocker,
    CE_AMULET_LEVEL,
} from '../engine/Map/WallDoorFinish';
import type { Game } from '../engine/Core/Game';

const SEEDS = [424242, 777, 20260913, 31337, 20260916];
const SWEEP_SEEDS = [424242, 777, 20260913, 31337, 20260916, 1, 42, 999, 20260915, 55555, 2, 3, 5, 7, 11];
const MAX_DEPTH = 26;

type Pos = { x: number; y: number };

// ---------------------------------------------------------------------------
// 夹具工具
// ---------------------------------------------------------------------------

function graniteGrid(): Grid {
    const g = new Grid(DCOLS, DROWS);
    for (let x = 0; x < DCOLS; x++) {
        for (let y = 0; y < DROWS; y++) g.setTerrain(x, y, TerrainType.GRANITE, ' ', 0x333333);
    }
    return g;
}
function floorAt(g: Grid, x: number, y: number): void { g.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888); }
function wallAt(g: Grid, x: number, y: number): void { g.setTerrain(x, y, TerrainType.WALL, '#', 0x555566); }
function doorAt(g: Grid, x: number, y: number): void { g.setTerrain(x, y, TerrainType.DOOR, '+', 0xaa8844); }

/** 测试本地的"只扫一遍"错误变体（AD1）：与生产同判据、同掷骰，无 do-while。 */
function removeDiagonalOpeningsSinglePass(grid: Grid): { passes: number; removed: number } {
    let removed = 0;
    for (let i = 0; i < DCOLS - 1; i++) {
        for (let j = 0; j < DROWS - 1; j++) {
            for (let k = 0; k <= 1; k++) {
                const passA = grid.getCell(i + k, j)!;
                const blockB = grid.getCell(i + (1 - k), j)!;
                const blockC = grid.getCell(i + k, j + 1)!;
                const passD = grid.getCell(i + (1 - k), j + 1)!;
                if (obstructsPassability(passA.terrain)
                    || !obstructsPassability(blockB.terrain) || !obstructsDiagonalMovement(blockB.terrain)
                    || !obstructsPassability(blockC.terrain) || !obstructsDiagonalMovement(blockC.terrain)
                    || obstructsPassability(passD.terrain)) {
                    continue;
                }
                let tx: number, ty: number, sx: number;
                if (rng.randPercent(50)) {
                    tx = i + (1 - k); ty = j; sx = i + k;
                } else {
                    tx = i + k; ty = j + 1; sx = i + (1 - k);
                }
                const target = grid.getCell(tx, ty)!;
                if (target.machineNumber !== 0) continue;
                const source = grid.getCell(sx, ty)!;
                grid.setTerrain(tx, ty, source.terrain, source.char, source.color);
                removed++;
            }
        }
    }
    return { passes: 1, removed };
}

/** 真实关卡上残余对角穿缝 pattern 计数（与生产同判据的独立复刻）。 */
function countDiagonalOpenings(grid: Grid): number {
    let n = 0;
    for (let i = 0; i < DCOLS - 1; i++) {
        for (let j = 0; j < DROWS - 1; j++) {
            for (let k = 0; k <= 1; k++) {
                const a = grid.getCell(i + k, j)!;
                const b = grid.getCell(i + (1 - k), j)!;
                const c = grid.getCell(i + k, j + 1)!;
                const d = grid.getCell(i + (1 - k), j + 1)!;
                if (!obstructsPassability(a.terrain)
                    && obstructsPassability(b.terrain) && obstructsDiagonalMovement(b.terrain)
                    && obstructsPassability(c.terrain) && obstructsDiagonalMovement(c.terrain)
                    && !obstructsPassability(d.terrain)) {
                    n++;
                }
            }
        }
    }
    return n;
}

// ---------------------------------------------------------------------------
// T1/T2：单元锚定
// ---------------------------------------------------------------------------

describe('C-3 单元锚定', () => {
    it('T1 secretDoorChance：CE Architect.c:2735 整除表 + clamp(0,67)', () => {
        // AD3：clamp 上界写错（67→100 等）、不随深度（恒值）、除数错都在此翻红。
        expect(CE_AMULET_LEVEL, 'amuletLevel 应为 26（GlobalsBrogue.c:43）').toBe(26);
        const want: Array<[number, number]> = [[1, 0], [2, 2], [3, 5], [5, 10], [10, 24], [14, 34], [20, 50], [26, 67]];
        for (const [d, v] of want) {
            expect(secretDoorChance(d), `D${d} 密门概率`).toBe(v);
        }
        expect(secretDoorChance(40), 'clamp 上界：D26 之后恒 67').toBe(67);
        for (let d = 1; d < 40; d++) {
            expect(secretDoorChance(d + 1)).toBeGreaterThanOrEqual(secretDoorChance(d));
        }
        expect(secretDoorChance(0)).toBe(0);
    });

    it('T2 旗标谓词全枚举快照（逐 TerrainType 钉死，防成员拼错/集合写反）', () => {
        const rows: Array<[TerrainType, boolean, boolean, boolean, boolean]> = [
            [TerrainType.NOTHING, false, false, false, false],
            [TerrainType.GRANITE, true, true, true, true],
            [TerrainType.FLOOR, false, false, false, false],
            [TerrainType.WALL, true, true, true, true],
            [TerrainType.DOOR, false, true, false, false],      // CE 门：挡视线不挡通行（Globals.c:328）
            [TerrainType.OPEN_DOOR, false, false, false, false],
            [TerrainType.WATER_SHALLOW, false, false, false, false],
            [TerrainType.WATER_DEEP, false, false, false, true],  // T_IS_DEEP_WATER：只进 PATHING_BLOCKER
            [TerrainType.CHASM, false, false, false, true],       // T_AUTO_DESCENT
            [TerrainType.LAVA, false, false, false, true],        // T_LAVA_INSTA_DEATH
            [TerrainType.GRASS, false, false, false, false],
            [TerrainType.FOLIAGE, false, false, false, false],
            [TerrainType.BOG, false, false, false, false],
            [TerrainType.STAIRS_UP, false, false, false, false],
            [TerrainType.STAIRS_DOWN, false, false, false, false],
            [TerrainType.CHARRED_FLOOR, false, false, false, false],
            [TerrainType.SIGN, false, false, false, false],
            [TerrainType.RESET_PLATE, false, false, false, false],
            [TerrainType.TRAP, false, false, false, true],        // T_IS_DF_TRAP 近似
            [TerrainType.SECRET_DOOR, true, true, true, true],    // T_OBSTRUCTS_EVERYTHING（分析口径另有 TM_IS_SECRET 豁免）
            [TerrainType.PRESSURE_PLATE, false, false, false, false],
            [TerrainType.LOCKED_DOOR, true, false, false, true],  // ~PORTCULLIS：挡通行不挡视线/对角
            [TerrainType.ALTAR, false, false, false, false],
            [TerrainType.WEB, false, false, false, false],
            [TerrainType.BLOOD, false, false, false, false],
            [TerrainType.MUD, false, false, false, false],
            [TerrainType.CHASM_EDGE, false, false, false, false],
            [TerrainType.OBSIDIAN, false, false, false, false],
            [TerrainType.BRIDGE, false, false, false, false],
            [TerrainType.BRIDGE_EDGE, false, false, false, false],
            [TerrainType.INERT_BRIMSTONE, false, false, false, true], // T_SPONTANEOUSLY_IGNITES
        ];
        for (const [t, pass, vision, diag, pathing] of rows) {
            expect(obstructsPassability(t), `obstructsPassability(${TerrainType[t]})`).toBe(pass);
            expect(obstructsVision(t), `obstructsVision(${TerrainType[t]})`).toBe(vision);
            expect(obstructsDiagonalMovement(t), `obstructsDiagonalMovement(${TerrainType[t]})`).toBe(diag);
            expect(isPathingBlocker(t), `isPathingBlocker(${TerrainType[t]})`).toBe(pathing);
        }
    });
});

// ---------------------------------------------------------------------------
// finishWalls
// ---------------------------------------------------------------------------

describe('C-3 finishWalls', () => {
    it('T3 对角暴露语义（AD5 的牙）：false 漏掉对角暴露、true 包含；两个方向都验', () => {
        // 花岗岩海 + 唯一地板 (2,2)；受试格 (1,1) 只在对角上邻着地板。
        const mk = (): Grid => {
            const g = graniteGrid();
            floorAt(g, 2, 2);
            return g;
        };
        // a) false：(1,1) 四正全阻挡 → 保持 GRANITE；正交邻地板的 (2,1)/(1,2) → WALL。
        const a = mk();
        finishWalls(a, false);
        expect(a.getCell(1, 1)!.terrain, 'false 实参下对角暴露不算暴露').toBe(TerrainType.GRANITE);
        expect(a.getCell(2, 1)!.terrain).toBe(TerrainType.WALL);
        expect(a.getCell(1, 2)!.terrain).toBe(TerrainType.WALL);
        // b) true：(1,1) 对角邻地板 → WALL。
        const b = mk();
        finishWalls(b, true);
        expect(b.getCell(1, 1)!.terrain, 'true 实参下对角暴露算暴露').toBe(TerrainType.WALL);
        // c) 反向：受试格先放 WALL，false 下（四正全阻挡）退回 GRANITE。
        const c = mk();
        wallAt(c, 1, 1);
        finishWalls(c, false);
        expect(c.getCell(1, 1)!.terrain, '未裸露 WALL 应回退 GRANITE').toBe(TerrainType.GRANITE);
        // d) 同 c 但 true：对角有地板 → 保持 WALL。
        const d = mk();
        wallAt(d, 1, 1);
        finishWalls(d, true);
        expect(d.getCell(1, 1)!.terrain, '对角裸露的 WALL 在 true 下保持').toBe(TerrainType.WALL);
    });

    it('T4 生产调用记录：第 5 步 false、第 14 步 true（实参写反在此翻红）', () => {
        for (const seed of SEEDS.slice(0, 2)) {
            rng.seedRandomGenerator(seed);
            const arch = new Architect();
            for (const depth of [2, 9]) {
                arch.generateLevel(depth);
                expect(arch.finishWallsCalls.length, `seed${seed}/D${depth} 应恰有两次 finishWalls`).toBe(2);
                expect(arch.finishWallsCalls[0]!.includingDiagonals,
                    `seed${seed}/D${depth} 第 5 步实参应为 false`).toBe(false);
                expect(arch.finishWallsCalls[1]!.includingDiagonals,
                    `seed${seed}/D${depth} 第 14 步实参应为 true`).toBe(true);
            }
        }
    });

    it('T5 真实关卡不变量：终态 GRANITE 的 8 邻必全部不暴露（等价于 CE 裸露补墙收敛）', () => {
        for (const seed of SEEDS.slice(0, 3)) {
            rng.seedRandomGenerator(seed);
            const arch = new Architect();
            for (const depth of [2, 14, 26]) {
                arch.generateLevel(depth);
                const g = arch.grid;
                const offenders: Pos[] = [];
                for (let x = 0; x < DCOLS; x++) {
                    for (let y = 0; y < DROWS; y++) {
                        if (g.getCell(x, y)!.terrain !== TerrainType.GRANITE) continue;
                        for (let dx = -1; dx <= 1 && offenders.length === 0; dx++) {
                            for (let dy = -1; dy <= 1; dy++) {
                                if (dx === 0 && dy === 0) continue;
                                const nb = g.getCell(x + dx, y + dy);
                                if (!nb) continue; // 图外不算暴露（CE coordinatesAreInMap）
                                const exposing = !obstructsVision(nb.terrain) || !obstructsPassability(nb.terrain);
                                if (exposing) { offenders.push({ x, y }); break; }
                            }
                        }
                    }
                }
                expect(offenders.slice(0, 8),
                    `seed${seed}/D${depth}：存在 8 邻暴露却未补成 WALL 的花岗岩（finishWalls 漏扫/判据写反）`
                ).toEqual([]);
            }
        }
    }, 300_000);
});

// ---------------------------------------------------------------------------
// finishDoors
// ---------------------------------------------------------------------------

describe('C-3 finishDoors', () => {
    /** 在花岗岩海上布置单扇门 (4,4)，邻格形态由用例自定。 */
    function doorFixture(): Grid {
        const g = graniteGrid();
        doorAt(g, 4, 4);
        return g;
    }

    it('T6a 孤儿判据一（十字皆通 → FLOOR）：写反（&& → ||）即红', () => {
        const g = doorFixture();
        floorAt(g, 3, 4); floorAt(g, 5, 4); floorAt(g, 4, 3); // (4,5) 保持花岗岩
        const stats = finishDoors(g, 1);
        expect(g.getCell(4, 4)!.terrain, '十字皆通的门应移成 FLOOR').toBe(TerrainType.FLOOR);
        expect(stats.orphanFlooredCross).toBe(1);
        expect(stats.orphanFlooredSealed).toBe(0);
        expect(stats.secretDoors).toBe(0);
    });

    it('T6b 孤儿判据二（四正 ≥3 阻挡 → FLOOR）：阈值写错（≥4 / ≤3）即红', () => {
        const g = doorFixture();
        wallAt(g, 3, 4); wallAt(g, 5, 4); wallAt(g, 4, 5); floorAt(g, 4, 3);
        const stats = finishDoors(g, 1);
        expect(g.getCell(4, 4)!.terrain, '三面被封的门应移成 FLOOR').toBe(TerrainType.FLOOR);
        expect(stats.orphanFlooredCross).toBe(0);
        expect(stats.orphanFlooredSealed).toBe(1);
        // 对照：恰好 2 个阻挡 + 2 个可通行的"正常门位"必须存活（阈值不配错的另一半）。
        const g2 = doorFixture();
        wallAt(g2, 3, 4); wallAt(g2, 5, 4); floorAt(g2, 4, 3); floorAt(g2, 4, 5);
        const stats2 = finishDoors(g2, 1);
        expect(g2.getCell(4, 4)!.terrain, '正常门位（上下通、左右墙）不得被当孤儿').toBe(TerrainType.DOOR);
        expect(stats2.orphanFlooredCross + stats2.orphanFlooredSealed).toBe(0);
    });

    it('T6c 存活门 + 密门升级：D1 恒 DOOR（概率 0），D26 同种子确定性升级', () => {
        const mkMeaningful = (): Grid => {
            const g = doorFixture();
            wallAt(g, 3, 4); wallAt(g, 5, 4); floorAt(g, 4, 3); floorAt(g, 4, 5);
            return g;
        };
        // AD3：概率不随深度变化（恒 67 之类）在此翻红——D1 必须 0 升级。
        const g1 = mkMeaningful();
        const s1 = finishDoors(g1, 1);
        expect(s1.secretChance).toBe(0);
        expect(g1.getCell(4, 4)!.terrain).toBe(TerrainType.DOOR);
        expect(s1.secretDoors).toBe(0);

        // D26：同种子两次调用结果一致（确定性）；大量门上升级率应贴近 67%。
        rng.seedRandomGenerator(20260916);
        const gA = mkMeaningful();
        const rA = finishDoors(gA, MAX_DEPTH);
        rng.seedRandomGenerator(20260916);
        const gB = mkMeaningful();
        const rB = finishDoors(gB, MAX_DEPTH);
        expect(rB.secretDoors).toBe(rA.secretDoors);
        expect(rA.secretChance).toBe(67);
        if (rA.secretDoors === 1) {
            expect(gA.getCell(4, 4)!.terrain).toBe(TerrainType.SECRET_DOOR);
        } else {
            expect(gA.getCell(4, 4)!.terrain).toBe(TerrainType.DOOR);
        }

        // 比率带：100 扇独立门、D26（67%）——恒 0 / 恒 100 / 阈值错都越界。
        rng.seedRandomGenerator(777);
        let secret = 0;
        const N = 100;
        for (let i = 0; i < N; i++) {
            const g = mkMeaningful();
            finishDoors(g, MAX_DEPTH);
            if (g.getCell(4, 4)!.terrain === TerrainType.SECRET_DOOR) secret++;
        }
        expect(secret, `D26 升级率 ${secret}/${N} 越界（期望 67% 附近）`).toBeGreaterThanOrEqual(50);
        expect(secret).toBeLessThanOrEqual(85);
    });

    it('T6d 机器门豁免（AD4）：machineNumber≠0 的门原样保留、不进牌堆、不耗骰', () => {
        rng.seedRandomGenerator(20260916);
        const g = doorFixture();
        wallAt(g, 3, 4); wallAt(g, 5, 4); floorAt(g, 4, 3); floorAt(g, 4, 5);
        g.getCell(4, 4)!.machineNumber = 3; // 机器内部的门
        const stats = finishDoors(g, MAX_DEPTH);
        expect(g.getCell(4, 4)!.terrain, '机器内部的门不得被孤儿移除/密门升级改动').toBe(TerrainType.DOOR);
        expect(stats.eligibleDoors, '机器门不计入 eligibleDoors').toBe(0);
        expect(stats.secretDoors).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// removeDiagonalOpenings
// ---------------------------------------------------------------------------

describe('C-3 removeDiagonalOpenings', () => {
    /**
     * AD1 夹具：两个互不干扰的对角穿缝 pattern。P2（远端）的上侧阻挡格
     * (11,10) 挂 machineNumber（CE 1938 守卫）——首趟掷骰命中机器侧时本次
     * 不改动；P1（近端）无守卫、首趟必有改动，使 cornerRemoved=true、
     * do-while 进入第二趟重掷 P2。"只扫一遍"的错误变体没有第二趟，
     * P2 永久卡死。种子扫描找出"首趟 P2 命中机器侧、第二趟命中自由侧"的
     * 种子（生产表现 = removed 恰为 2 且趟数 ≥3）。
     */
    function cornerFixture(): Grid {
        const g = graniteGrid();
        // P1（i=2,j=2,k=0）：双阻挡格均无守卫。
        floorAt(g, 2, 2); wallAt(g, 3, 2); wallAt(g, 2, 3); floorAt(g, 3, 3);
        // P2（i=10,j=10,k=0）：上侧阻挡格挂机器号。
        floorAt(g, 10, 10); wallAt(g, 11, 10); wallAt(g, 10, 11); floorAt(g, 11, 11);
        g.getCell(11, 10)!.machineNumber = 5;
        return g;
    }

    it('T9 do-while 收敛 vs 只扫一遍（AD1）：守卫落空后生产重掷解决、单趟变体卡死', () => {
        let chosen = -1;
        for (let seed = 1; seed <= 2000; seed++) {
            rng.seedRandomGenerator(seed);
            const g = cornerFixture();
            const stats = removeDiagonalOpenings(g);
            if (stats.removed === 2 && stats.passes >= 3) { chosen = seed; break; }
        }
        expect(chosen, '前 2000 个种子内应存在"P2 首趟命中机器侧、重掷后解决"的种子（否则本用例设计失效）')
            .toBeGreaterThan(0);

        // 生产（do-while）：两个 pattern 都解决，机器侧格原样。
        rng.seedRandomGenerator(chosen);
        const gp = cornerFixture();
        const sp = removeDiagonalOpenings(gp);
        expect(sp.removed, '生产应解决两个 pattern').toBe(2);
        expect(sp.passes, '生产必须扫到收敛（>1 趟）').toBeGreaterThanOrEqual(3);
        expect(gp.getCell(10, 11)!.terrain, 'P2 下侧阻挡格应被推开成可通行格').not.toBe(TerrainType.WALL);
        expect(gp.getCell(11, 10)!.terrain, '机器侧阻挡格不得被改动').toBe(TerrainType.WALL);
        expect(countDiagonalOpenings(gp), '收敛后不得再有任何对角穿缝').toBe(0);

        // 错误变体（只扫一遍、同种子同骰序）：P1 解决、P2 卡死。
        rng.seedRandomGenerator(chosen);
        const gf = cornerFixture();
        const sf = removeDiagonalOpeningsSinglePass(gf);
        expect(sf.removed, '单趟变体只解决了无守卫的 P1').toBe(1);
        expect(gf.getCell(10, 11)!.terrain).toBe(TerrainType.WALL);
        expect(countDiagonalOpenings(gf), '单趟变体残留对角穿缝 = 生产若退化成单趟即在此翻红').toBeGreaterThan(0);
    });

    it('T10 真实关卡：对角穿缝全数消除，且确有真实移除（非空转）', () => {
        let totalRemoved = 0;
        let totalResidual = 0;
        for (const seed of SEEDS.slice(0, 3)) {
            rng.seedRandomGenerator(seed);
            const arch = new Architect();
            for (let depth = 1; depth <= 8; depth++) {
                arch.generateTerrain(depth);
                totalRemoved += arch.diagonalFinishStats.removed;
                totalResidual += countDiagonalOpenings(arch.grid);
                expect(countDiagonalOpenings(arch.grid),
                    `seed${seed}/D${depth} 湖泊阶段完成后仍存在对角穿缝`).toBe(0);
            }
        }
        expect(totalRemoved, '全程零移除 = removeDiagonalOpenings 未生效或判据恒假').toBeGreaterThan(0);
        expect(totalResidual).toBe(0);
    }, 300_000);
});

// ---------------------------------------------------------------------------
// 管线集成：决定性、连通性闸门、留痕
// ---------------------------------------------------------------------------

type GameWithPrivates = Omit<Game, 'generateDepth' | 'canMoveTo'> & {
    generateDepth(isGoingUp: boolean, isFirstLevel: boolean): void;
    canMoveTo(x: number, y: number): boolean;
};

describe('C-3 管线集成', () => {
    it('T11 决定性：同种子两次全管线生成，指纹与 C-3 统计逐一一致', () => {
        for (const seed of [424242, 20260913]) {
            const run = (): string[] => {
                rng.seedRandomGenerator(seed);
                const arch = new Architect();
                const lines: string[] = [];
                for (let depth = 1; depth <= 6; depth++) {
                    arch.generateLevel(depth);
                    lines.push(`D${depth}:${terrainFingerprint(arch.grid)}` +
                        `|diag:${arch.diagonalFinishStats.passes},${arch.diagonalFinishStats.removed}` +
                        `|door:${arch.doorFinishStats!.eligibleDoors},${arch.doorFinishStats!.orphanFlooredCross},` +
                        `${arch.doorFinishStats!.orphanFlooredSealed},${arch.doorFinishStats!.secretDoors}` +
                        `|wall:${arch.finishWallsCalls.map(c => `${c.includingDiagonals ? 1 : 0},${c.graniteWalled},${c.wallsReverted}`).join(';')}`);
                }
                return lines;
            };
            const a = run();
            expect(run(), `seed${seed} 两次生成不一致（C-3 阶段混入非种子随机源）`).toEqual(a);
        }
    }, 300_000);

    it('T13 C-0 E1 全管线延伸：环路门位经 finishDoors/finishWalls(true) 后仍不落回墙', () => {
        for (const seed of SEEDS.slice(0, 3)) {
            rng.seedRandomGenerator(seed);
            const arch = new Architect();
            for (let depth = 1; depth <= 12; depth++) {
                arch.generateLevel(depth);
                for (const s of arch.loopDoorSites) {
                    const t = arch.grid.getCell(s.x, s.y)!.terrain;
                    expect(t === TerrainType.GRANITE || t === TerrainType.WALL,
                        `seed${seed}/D${depth} 门位 (${s.x},${s.y}) 终态 ${TerrainType[t]}`).toBe(false);
                }
            }
        }
    }, 300_000);

    it('T12 连通性闸门（15 种子 × D1-D26）：密门视作通路口径下坏层=0；机器格外的可走格单一连通块', () => {
        const bad: string[] = [];
        const strictBad: string[] = []; // canMoveTo 字面口径（密门当墙）——只观测，属验收方重校准范围
        const componentBad: string[] = [];
        const orphan = { cross: 0, sealed: 0 };
        const secretByDepth: Record<number, number> = {};
        let diagonalRemoved = 0;
        let levels = 0;

        for (const seed of SWEEP_SEEDS) {
            const game = createHeadlessGame(seed);
            for (let d = 1; d <= MAX_DEPTH; d++) {
                if (d > 1) {
                    (game as unknown as { depth: number }).depth = d;
                    (game as unknown as GameWithPrivates).generateDepth(false, false);
                }
                levels++;
                const grid = game.grid;
                const canMoveTo = (game as unknown as GameWithPrivates).canMoveTo.bind(game);
                const passableCorrected = (x: number, y: number): boolean =>
                    canMoveTo(x, y) || grid.getCell(x, y)!.terrain === TerrainType.SECRET_DOOR;

                const flood = (passable: (x: number, y: number) => boolean, start: Pos): Set<number> => {
                    const seen = new Set<number>([start.y * grid.width + start.x]);
                    const queue: Pos[] = [start];
                    while (queue.length > 0) {
                        const p = queue.pop()!;
                        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
                            const nx = p.x + dx, ny = p.y + dy;
                            if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
                            const key = ny * grid.width + nx;
                            if (seen.has(key) || !passable(nx, ny)) continue;
                            seen.add(key);
                            queue.push({ x: nx, y: ny });
                        }
                    }
                    return seen;
                };

                let up: Pos | null = null;
                let down: Pos | null = null;
                for (let x = 0; x < grid.width; x++) {
                    for (let y = 0; y < grid.height; y++) {
                        const t = grid.getCell(x, y)!.terrain;
                        if (t === TerrainType.STAIRS_UP) up = { x, y };
                        else if (t === TerrainType.STAIRS_DOWN) down = { x, y };
                    }
                }
                if (up && down) {
                    if (!flood(passableCorrected, up).has(down.y * grid.width + down.x)) {
                        bad.push(`seed${seed}/D${d}`);
                    }
                    if (!flood(canMoveTo, up).has(down.y * grid.width + down.x)) {
                        strictBad.push(`seed${seed}/D${d}`);
                    }
                }

                // p1_33 f 的密门口径修正版：必须可达集仍取**可走格**（canMoveTo ∩
                // 非机器，与 p1_33 f 同集），洪泛则允许穿过密门（CE
                // T_PATHING_BLOCKER && !TM_IS_SECRET 口径）——房间藏在密门后
                // 算可达。注意 SECRET_DOOR 本身不是可走格、不进必须可达集：
                // placeTraps 的 web 自创密门可能被机器墙整体围死（密门是"门"，
                // 不是目的地；其连通性由两侧地板格体现）。
                {
                    let seedCell: Pos | null = null;
                    const mustReach: Pos[] = [];
                    for (let x = 0; x < grid.width; x++) {
                        for (let y = 0; y < grid.height; y++) {
                            const cell = grid.getCell(x, y)!;
                            if (cell.machineNumber !== 0) continue;
                            if (!canMoveTo(x, y)) continue;
                            mustReach.push({ x, y });
                            if (!seedCell) seedCell = { x, y };
                        }
                    }
                    const reach = flood(passableCorrected, seedCell!);
                    const unreachable = mustReach.filter(p => !reach.has(p.y * grid.width + p.x));
                    if (unreachable.length > 0) {
                        const terr = unreachable.slice(0, 3).map(p => TerrainType[grid.getCell(p.x, p.y)!.terrain]);
                        componentBad.push(`seed${seed}/D${d}:${unreachable.length}格(${terr.join('/')})`);
                    }
                }
            }
        }

        // 实测汇报（报告数据源）：孤儿门/密门/对角穿缝统计随深度的分布。
        for (const seed of SWEEP_SEEDS.slice(0, 5)) {
            rng.seedRandomGenerator(seed);
            const arch = new Architect();
            for (let depth = 1; depth <= MAX_DEPTH; depth++) {
                arch.generateLevel(depth);
                orphan.cross += arch.doorFinishStats!.orphanFlooredCross;
                orphan.sealed += arch.doorFinishStats!.orphanFlooredSealed;
                secretByDepth[depth] = (secretByDepth[depth] ?? 0) + arch.doorFinishStats!.secretDoors;
                diagonalRemoved += arch.diagonalFinishStats.removed;
            }
        }
        const band = (lo: number, hi: number): number =>
            Object.entries(secretByDepth)
                .map(([d, n]) => ({ d: Number(d), n }))
                .filter(r => r.d >= lo && r.d <= hi)
                .reduce((a, b) => a + b.n, 0);
        console.log(`[c_3] 实测（5 种子 × D1-D26 合计）：孤儿门移除 十字=${orphan.cross} 封死=${orphan.sealed}；` +
            `密门 D1-5=${band(1, 5)} D6-13=${band(6, 13)} D14-19=${band(14, 19)} D20-26=${band(20, 26)}；` +
            `对角穿缝消除=${diagonalRemoved}`);
        console.log(`[c_3] 连通性：修正口径（密门视作通路）坏层=${bad.length || '无'}；` +
            `canMoveTo 字面口径坏层=${strictBad.length}（${strictBad.slice(0, 12).join('、')}${strictBad.length > 12 ? '…' : ''}）` +
            `——字面口径坏层为密门假阳性，p1_26/p1_33 重校准属验收方职责（本轮禁改）。`);

        expect(bad, `密门视作通路口径下仍存在不可达层（真回归，非假阳性）：\n${bad.join('\n')}`).toEqual([]);
        expect(componentBad, `非机器可走格（密门视作通路）存在不连通块：\n${componentBad.slice(0, 10).join('\n')}`).toEqual([]);
    }, 600_000);

    it('T14 留痕（明确不做）：C-4 promoteTile(ACTIVE 态) / 主动搜索行动', () => {
        // C-6：原首条断言（"runAutogenerators 无 web 对应物，出现即删"）已按
        // 其自带指示删除——C-6 已落地（src/engine/Map/AutoGenerator.ts，
        // 两趟接线见 Generator/Architect.ts）。"复核 overlay 占位退出"的结论：
        // web 自创 overlay（浅水/草/树/泥/网 blob + 深水闸门）仍保留——深水
        // overlay 是 C-2 湖泊管线的 lakeMap 来源，拔除属管线级改动，C-6 任务书
        // 未授权；与 CE 自动生成器草/树的重复供给已列入 c_6 报告"与预设不符"，
        // 由验收方裁决何时退池。
        // （原断言内容存档：expect(Architect.prototype.runAutogenerators)
        //     .toBeUndefined()——"runAutogenerators 已出现——C-6 已落地"）

        // C-4：DF 目录 / promoteTile 未实现。CE 硫矿点火链的 ACTIVE_BRIMSTONE
        // 终态地形不存在于 web 枚举。C-4 落地后删除本断言。
        expect((TerrainType as unknown as Record<string, unknown>).ACTIVE_BRIMSTONE,
            'ACTIVE_BRIMSTONE 已出现——C-4 已落地，请删除本留痕').toBeUndefined();
        expect((TerrainType as unknown as Record<string, unknown>).ACTIVE,
            '硫矿 ACTIVE 态已出现——C-4 已落地，请删除本留痕').toBeUndefined();

        // C-5：坠落子系统未实现（CHASM 族不生成，c_2_lakes_e2e 已有留痕，此处不重复）。

        // 密门的主动"搜索"行动未移植（web 只有 Game.ts 的移动邻接被动发现）。
        // 后续轮次补 CE search 行动后删除本断言。
        const game = createHeadlessGame(424242);
        const anyGame = game as unknown as Record<string, unknown>;
        expect(typeof anyGame.search, 'Game.search 已存在——主动搜索已实现，请删除本留痕').toBe('undefined');
        expect(typeof anyGame.searchAt, 'Game.searchAt 已存在——主动搜索已实现，请删除本留痕').toBe('undefined');
    });
});
