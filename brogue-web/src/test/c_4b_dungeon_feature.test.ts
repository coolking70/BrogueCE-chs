/**
 * src/test/c_4b_dungeon_feature.test.ts — C-4b：DF 目录 + 三个算法（纯库）。
 *
 * 被测：src/engine/Map/DungeonFeatureCatalog.ts（CE Globals.c:603-932 的
 * 19 条闭包投影）+ src/engine/Map/DungeonFeature.ts（spawnMapDF /
 * fillSpawnMap / spawnDungeonFeature / levelIsDisconnectedWithBlockingMap，
 * CE Architect.c:3278-3330 / 3208-3276 / 3359-3495 / 3137-3198）。
 *
 * 对抗性锚点（每条都能在任务书 §五.2 列举的具体错误实现下翻红）：
 *   A1  8 向扩散（正确：4 向）            A2  漏 startProb -= probDec
 *   A3  propTerrain 豁免条件写反          B1  drawPriority 比较方向写反
 *   B2  superpriority 被忽略              B3  blockedByOtherLayers 被忽略
 *   B4  SURFACE 的 SURFACE_EFFECTS 禁止漏掉
 *   C1  GAS 层走扩散（正确：volume 特例，零 RNG）
 *   C3  连通性否决失效/写反               C5  CLEAR_LOWER 方向写反
 *   C7  SUBSEQ_EVERYWHERE 用 fill 前的 spawnMap（正确：fill 后实际落点）
 *   D2  通行判据漏掉锁门/密门豁免
 *
 * 反向验证记录（改坏 → 真实失败输出 → 还原）见
 * ai_docs/c_4b_dungeon_feature_report.md §反向验证。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DungeonLayer, Grid, TerrainType, DRAW_PRIORITY } from '../engine/Map/Grid';
import { TERRAIN_FLAGS } from '../engine/Map/TerrainCatalog';
import {
    DF,
    DFF_ACTIVATE_DORMANT_MONSTER,
    DFF_CLEAR_LOWER_PRIORITY_TERRAIN,
    DFF_CLEAR_OTHER_TERRAIN,
    DFF_EVACUATE_CREATURES_FIRST,
    DFF_PERMIT_BLOCKING,
    DFF_SUBSEQ_EVERYWHERE,
    DUNGEON_FEATURE_CATALOG,
    DF_MISSING_TILES,
} from '../engine/Map/DungeonFeatureCatalog';
import type { DungeonFeature } from '../engine/Map/DungeonFeature';
import {
    catalogFeature,
    createSpawnMap,
    fillSpawnMap,
    levelIsDisconnectedWithBlockingMap,
    spawnDungeonFeature,
    spawnMapDF,
} from '../engine/Map/DungeonFeature';
import { rng } from '../engine/Random';
import { createHeadlessGame } from './harness';
// V-2b-7：E2 的起点改为数据驱动——直接扫蓝图的 featureDF 列。
import blueprintData from '../data/blueprints.json';

const C = TerrainType;
const L = DungeonLayer;

/** 全 FLOOR 空场。 */
function openGrid(w = 40, h = 40): Grid {
    const g = new Grid(w, h);
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) g.setTerrain(x, y, C.FLOOR);
    }
    return g;
}

/** 全 GRANITE 底板。 */
function rockGrid(w = 40, h = 40): Grid {
    const g = new Grid(w, h);
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) g.setTerrain(x, y, C.GRANITE);
    }
    return g;
}

/** 合成 DF（CE spawnDungeonFeature 收 dungeonFeature*，调用方可传改写副本）。 */
function feat(partial: Partial<DungeonFeature>): DungeonFeature {
    return {
        tile: C.NOTHING,
        layer: L.DUNGEON,
        startProbability: 0,
        probabilityDecrement: 0,
        flags: 0,
        propagationTerrain: C.NOTHING,
        subsequentDF: null,
        description: '',
        lightFlare: '',
        flashColor: '',
        effectRadius: 0,
        ...partial,
    };
}

/** 单格标记的 spawnMap。 */
function marked(grid: Grid, cells: Array<[number, number]>): ReturnType<typeof createSpawnMap> {
    const sm = createSpawnMap(grid);
    for (const [x, y] of cells) sm[y * grid.width + x] = 1;
    return sm;
}

describe('C-4b A：spawnMapDF（CE Architect.c:3278-3330）', () => {
    it('A1 对抗：4 向扩散——对角单点相触的双室不渗（8 向错误实现在此翻红）', () => {
        // 双室只在一个格角对角相触：A 室 (1..3,1..3)，B 室 (4..6,4..6)，
        // (3,3)-(4,4) 对角相邻，但 (3,4)/(4,3) 是 GRANITE——4 向过不去。
        // 注意入参口径：CE :3301-3308 不检查"已标记"，probDec=0 的非 GAS
        // 输入会在相邻格间无限刷新（CE 目录里所有走扩散的条目都有
        // probDec>0，靠衰减终止）——本组一律给 dec=1，100 波足够淹满 A 室。
        const g = rockGrid(10, 10);
        for (let x = 1; x <= 3; x++) {
            for (let y = 1; y <= 3; y++) g.setTerrain(x, y, C.FLOOR);
        }
        for (let x = 4; x <= 6; x++) {
            for (let y = 4; y <= 6; y++) g.setTerrain(x, y, C.FLOOR);
        }
        const sm = createSpawnMap(g);
        rng.seedRandomGenerator(20260916);
        spawnMapDF(g, 2, 2, C.NOTHING, false, 100, 1, sm); // 100%、慢衰减 → 淹满连通体
        // A 室全标记。
        for (let x = 1; x <= 3; x++) {
            for (let y = 1; y <= 3; y++) {
                expect(sm[y * 10 + x], `A室(${x},${y})`).toBeGreaterThan(0);
            }
        }
        // B 室一格都不许有——8 向错误实现会经 (3,3)→(4,4) 渗入。
        for (let x = 4; x <= 6; x++) {
            for (let y = 4; y <= 6; y++) {
                expect(sm[y * 10 + x], `B室(${x},${y}) 不应被 4 向波前到达`).toBe(0);
            }
        }
    });

    it('A2 对抗：probDec 衰减——start=50/dec=50 只扩一波，曼哈顿距离 ≥2 处必须为 0', () => {
        const g = openGrid();
        const sm = createSpawnMap(g);
        rng.seedRandomGenerator(4242);
        spawnMapDF(g, 20, 20, C.NOTHING, false, 50, 50, sm);
        expect(sm[20 * 40 + 20]).toBe(1); // 种子
        for (let x = 0; x < 40; x++) {
            for (let y = 0; y < 40; y++) {
                if (Math.abs(x - 20) + Math.abs(y - 20) >= 2) {
                    expect(sm[y * 40 + x], `(${x},${y}) 距离≥2 不应被标记（漏衰减的实现在此翻红）`).toBe(0);
                }
            }
        }
    });

    it('A3 对抗：propagationTerrain 豁免方向——带 propTerrain 的阻挡格放行、不带的照挡', () => {
        // 入参口径 1000/1：前 900 波 startProb≥100（clamp 后必中），目标格
        // 的到达与概率无关，断言不会因随机波动假红。
        // 场景一：y=10 行铺浅水；(10,10) 的 DUNGEON 层是楼梯
        //（T_OBSTRUCTS_SURFACE_EFFECTS）但它同时有 propTerrain=浅水 → 豁免放行。
        {
            const g = openGrid();
            for (let x = 8; x <= 12; x++) g.setTerrainLayer(x, 10, L.LIQUID, C.WATER_SHALLOW);
            g.setTerrainLayer(10, 10, L.DUNGEON, C.STAIRS_UP);
            const sm = createSpawnMap(g);
            spawnMapDF(g, 9, 10, C.WATER_SHALLOW, true, 1000, 1, sm);
            expect(sm[10 * 40 + 10], '豁免：propTerrain 格即使带 SURFACE 效应阻挡也可入').toBeGreaterThan(0);
            expect(sm[10 * 40 + 11], '豁免后扩散继续穿过该格').toBeGreaterThan(0);
            expect(sm[9 * 40 + 9], '无 propTerrain 的普通格不受豁免、也不该被标记').toBe(0);
            expect(sm[11 * 40 + 9], '无 propTerrain 的普通格不受豁免、也不该被标记').toBe(0);
        }
        // 场景二：楼梯（阻挡）但没有 propTerrain → 不可入。
        {
            const g = openGrid();
            for (let x = 8; x <= 12; x++) g.setTerrainLayer(x, 10, L.LIQUID, C.WATER_SHALLOW);
            g.setTerrainLayer(10, 9, L.DUNGEON, C.STAIRS_UP);
            const sm = createSpawnMap(g);
            spawnMapDF(g, 10, 10, C.WATER_SHALLOW, true, 1000, 1, sm);
            expect(sm[10 * 40 + 10], '种子格').toBeGreaterThan(0);
            expect(sm[10 * 40 + 9], '楼梯旁的浅水格 (9,10) 正常放行').toBeGreaterThan(0);
            expect(sm[9 * 40 + 10], '楼梯格 (10,9) 无 propTerrain 必须挡住扩散——豁免写反的实现在此翻红').toBe(0);
        }
    });

    it('A4 种子格清理：requirePropTerrain 且种子格自身没有 propTerrain → 收尾清 0（CE :3327-3329）', () => {
        const g = openGrid();
        const sm = createSpawnMap(g);
        spawnMapDF(g, 20, 20, C.WATER_SHALLOW, true, 100, 0, sm); // 种子格是 FLOOR，无浅水
        for (let x = 0; x < 40; x++) {
            for (let y = 0; y < 40; y++) {
                expect(sm[y * 40 + x], `(${x},${y}) 整图应为空`).toBe(0);
            }
        }
    });

    it('A5 startProbability=0：footprint 恰为种子一格（CE while 直接不进）', () => {
        const g = openGrid();
        const sm = createSpawnMap(g);
        spawnMapDF(g, 20, 20, C.NOTHING, false, 0, 0, sm);
        expect(sm[20 * 40 + 20]).toBe(1);
        expect(sm.reduce((a, b) => a + b, 0)).toBe(1);
    });

    it('A6 t>100 收敛分支 + 决定性：蛇形长廊全程淹没、值域被压回、同种子重跑逐字节相等', () => {
        // 蛇形 1 宽走廊：6 行 × 36 + 5 个连接头 ≈ 221 格。走廊里波前每波
        // 前进一格，走完全程要 ~220 波。入参 1000/1：前 900 波 startProb≥100
        // 必中，保证全程淹没与概率无关；1000 波 > 100 → 收敛分支必触发多次。
        const build = (): Grid => {
            const g = rockGrid(40, 40);
            const rows = [5, 7, 9, 11, 13, 15];
            for (const y of rows) {
                for (let x = 2; x <= 37; x++) g.setTerrain(x, y, C.FLOOR);
            }
            g.setTerrain(37, 6, C.FLOOR);  // y5→y7 右端下接
            g.setTerrain(2, 8, C.FLOOR);   // y7→y9 左端
            g.setTerrain(37, 10, C.FLOOR); // y9→y11 右端
            g.setTerrain(2, 12, C.FLOOR);  // y11→y13 左端
            g.setTerrain(37, 14, C.FLOOR); // y13→y15 右端
            return g;
        };
        const run = (): Uint8Array => {
            const g = build();
            const sm = createSpawnMap(g);
            rng.seedRandomGenerator(777);
            spawnMapDF(g, 2, 5, C.NOTHING, false, 1000, 1, sm);
            return sm;
        };
        const sm1 = run();
        const sm2 = run();
        expect(Array.from(sm2), '同种子两次运行必须逐字节相等（决定性）').toEqual(Array.from(sm1));
        // 全程淹没：走廊任一格都非零（抽查每行两端与中点 + 连接头）。
        const pathCells: Array<[number, number]> = [
            [2, 5], [20, 5], [37, 5], [37, 6],
            [37, 7], [20, 7], [2, 7], [2, 8],
            [2, 9], [20, 9], [37, 9], [37, 10],
            [37, 11], [20, 11], [2, 11], [2, 12],
            [2, 13], [20, 13], [37, 13], [37, 14],
            [37, 15], [20, 15], [2, 15],
        ];
        for (const [x, y] of pathCells) {
            expect(sm1[y * 40 + x], `走廊(${x},${y}) 应被波前淹没`).toBeGreaterThan(0);
        }
        // 收敛分支的判据：若无 t>100 改写，终值会冲到 ~220；
        // 有收敛时任何"两次收敛之间"的值 ≤100（t=101 的波会被改写为 2）。
        let maxV = 0;
        for (const v of sm1) maxV = Math.max(maxV, v);
        expect(maxV, '收敛分支必须把代际值压回 ≤100（无收敛的错误实现会到 ~220）').toBeLessThanOrEqual(100);
    });
});

describe('C-4b B：fillSpawnMap（CE Architect.c:3208-3276）', () => {
    it('B1 对抗：drawPriority 比较方向——旧 40 盖 55 拒、旧 55 盖 40 成、55==55 成（>= 锚）', () => {
        const g = openGrid(20, 20);
        // 旧 WATER_DEEP(40) ← 新 MUD(55)：40 >= 55 为假 → 拒。
        g.setTerrainLayer(5, 5, L.LIQUID, C.WATER_DEEP);
        let sm = marked(g, [[5, 5]]);
        let out = fillSpawnMap(g, L.LIQUID, C.MUD, sm, false, false);
        expect(out.accomplishedSomething, '40 上不得盖 55（比较方向写反的实现在此翻红）').toBe(false);
        expect(g.getCell(5, 5)!.layers[L.LIQUID]).toBe(C.WATER_DEEP);
        expect(sm[5 * 20 + 5], '未落格格的 spawnMap 要清 0（CE :3271）').toBe(0);
        // 旧 MUD(55) ← 新 WATER_DEEP(40)：55 >= 40 → 成。
        g.setTerrainLayer(6, 5, L.LIQUID, C.MUD);
        sm = marked(g, [[6, 5]]);
        out = fillSpawnMap(g, L.LIQUID, C.WATER_DEEP, sm, false, false);
        expect(out.accomplishedSomething).toBe(true);
        expect(g.getCell(6, 5)!.layers[L.LIQUID]).toBe(C.WATER_DEEP);
        // 平级 WATER_SHALLOW(55) ← MUD(55)：>= 含相等 → 成（CE :3228）。
        g.setTerrainLayer(7, 5, L.LIQUID, C.WATER_SHALLOW);
        sm = marked(g, [[7, 5]]);
        out = fillSpawnMap(g, L.LIQUID, C.MUD, sm, false, false);
        expect(out.accomplishedSomething, '平级（55==55）必须可覆盖——>= 被写成 > 的实现在此翻红').toBe(true);
        expect(g.getCell(7, 5)!.layers[L.LIQUID]).toBe(C.MUD);
    });

    it('B2 对抗：superpriority——旧 40 新 55 也可强行覆盖（忽略 superpriority 在此翻红）', () => {
        const g = openGrid(20, 20);
        g.setTerrainLayer(5, 5, L.LIQUID, C.WATER_DEEP);
        const sm = marked(g, [[5, 5]]);
        const out = fillSpawnMap(g, L.LIQUID, C.MUD, sm, false, true);
        expect(out.accomplishedSomething, 'superpriority 必须跳过优先级比较').toBe(true);
        expect(g.getCell(5, 5)!.layers[L.LIQUID]).toBe(C.MUD);
    });

    it('B3 对抗：blockedByOtherLayers——DUNGEON=WALL(0) 时禁写 LIQUID；无旗标则放行', () => {
        const g = openGrid(20, 20);
        g.setTerrain(5, 5, C.WALL); // 最高优先层 = WALL(0)
        g.setTerrain(8, 5, C.WALL); // 第二子步骤用干净格，避免互相污染
        // 无 blockedByOtherLayers：LIQUID 层本身为空（NOTHING=100）→ 放行。
        let sm = marked(g, [[5, 5]]);
        let out = fillSpawnMap(g, L.LIQUID, C.MUD, sm, false, false);
        expect(out.accomplishedSomething).toBe(true);
        expect(g.getCell(5, 5)!.layers[L.LIQUID]).toBe(C.MUD);
        // 有 blockedByOtherLayers：最高层 WALL(0) < 55 → 禁。
        sm = marked(g, [[8, 5]]);
        out = fillSpawnMap(g, L.LIQUID, C.MUD, sm, true, false);
        expect(out.accomplishedSomething, 'blockedByOtherLayers 被忽略的实现在此翻红').toBe(false);
        expect(g.getCell(8, 5)!.layers[L.LIQUID]).toBe(C.NOTHING);
    });

    it('B4 对抗：SURFACE 层 + T_OBSTRUCTS_SURFACE_EFFECTS 禁止（漏守卫在此翻红）', () => {
        const g = openGrid(20, 20);
        g.setTerrain(5, 5, C.STAIRS_UP); // 楼梯带 T_OBSTRUCTS_SURFACE_EFFECTS
        let sm = marked(g, [[5, 5]]);
        let out = fillSpawnMap(g, L.SURFACE, C.BLOOD, sm, false, false);
        expect(out.accomplishedSomething, '楼梯格的 SURFACE 层不得被写入').toBe(false);
        expect(g.getCell(5, 5)!.layers[L.SURFACE]).toBe(C.NOTHING);
        expect(sm[5 * 20 + 5]).toBe(0);
        // 对照：FLOOR 格可写。
        sm = marked(g, [[6, 5]]);
        out = fillSpawnMap(g, L.SURFACE, C.BLOOD, sm, false, false);
        expect(out.accomplishedSomething).toBe(true);
        expect(g.getCell(6, 5)!.layers[L.SURFACE]).toBe(C.BLOOD);
    });

    it('B5 已是同 tile 的格不算"建成"：accomplishedSomething=false 且 spawnMap 清 0', () => {
        const g = openGrid(20, 20);
        g.setTerrainLayer(5, 5, L.LIQUID, C.MUD);
        const sm = marked(g, [[5, 5]]);
        const out = fillSpawnMap(g, L.LIQUID, C.MUD, sm, false, false);
        expect(out.accomplishedSomething).toBe(false);
        expect(sm[5 * 20 + 5]).toBe(0);
    });
});

describe('C-4b C：spawnDungeonFeature 外壳（CE Architect.c:3359-3495）', () => {
    it('C1 对抗：GAS 层特例——零 RNG 消耗、仅原点 GAS 层、volume 增量登记（走扩散的实现在此翻红）', () => {
        const g = openGrid(20, 20);
        rng.seedRandomGenerator(20260916);
        const before = rng.randomNumbersGenerated;
        const res = spawnDungeonFeature(g, 10, 10, feat({
            tile: C.INERT_BRIMSTONE, // 合成组合：目录里 GAS 条目的 tile 都是登记项，用任意 web tile 测算法
            layer: L.GAS,
            startProbability: 325,
            probabilityDecrement: 0,
        }), true);
        expect(rng.randomNumbersGenerated - before, 'GAS 特例不走扩散、不掷骰（rand_percent 一次都不许调）').toBe(0);
        expect(res.succeeded).toBe(true);
        expect(res.gasVolumeAdded, 'volume 增量按 CE :3385 = startProbability').toBe(325);
        expect(g.getCell(10, 10)!.layers[L.GAS]).toBe(C.INERT_BRIMSTONE);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            expect(g.getCell(10 + dx, 10 + dy)!.layers[L.GAS], `邻格(${10 + dx},${10 + dy}) 不许被 GAS 波及`).toBe(C.NOTHING);
        }
        expect(res.builtCells, 'GAS 特例的落点集为空（CE blockingMap 全零）').toEqual([]);
    });

    it('C2 无地形 DF（真实 DF_REPEL_CREATURES）：footprint=原点、四层不动、EVAC 登记', () => {
        const g = openGrid(20, 20);
        const before = Array.from(g.getCell(10, 10)!.layers);
        const res = spawnDungeonFeature(g, 10, 10, catalogFeature(DF.DF_REPEL_CREATURES), true);
        expect(res.succeeded).toBe(true);
        expect(res.evacuationRequired, 'DFF_EVACUATE_CREATURES_FIRST 要置位登记（搬怪属游戏侧）').toBe(true);
        expect(res.builtCells).toEqual([{ x: 10, y: 10 }]);
        expect(Array.from(g.getCell(10, 10)!.layers), '无地形 DF 不得写任何层').toEqual(before);
    });

    it('C3 对抗：连通性否决——1 宽走廊的 CHASM 被拒；开阔房/PERMIT_BLOCKING/不 abort 放行', () => {
        // 用合成 CHASM 条目（无 subsequentDF）——真实的 DF_BRIDGE_FALL 链上
        // 挂着缺 tile 的 DF_BRIDGE_FALL_PREP（C6 已覆盖那条抛错路径），
        // 这里要隔离测连通性否决本身。
        const chasmFeat = feat({ tile: C.CHASM, layer: L.LIQUID });
        const buildCorridor = (): Grid => {
            const g = rockGrid(40, 40);
            for (let x = 1; x <= 38; x++) g.setTerrain(x, 10, C.FLOOR);
            return g;
        };
        // 1 宽走廊正中放 CHASM（T_PATHING_BLOCKER 系）→ 否决，一格都不落。
        let g = buildCorridor();
        let res = spawnDungeonFeature(g, 20, 10, chasmFeat, true);
        expect(res.succeeded, '切断走廊的 DF 必须被否决（连通性检查失效的实现在此翻红）').toBe(false);
        expect(g.getCell(20, 10)!.layers[L.LIQUID]).toBe(C.NOTHING);
        // 开阔房正中：周围绕得通 → 放行。
        g = openGrid(20, 20);
        res = spawnDungeonFeature(g, 10, 10, chasmFeat, true);
        expect(res.succeeded).toBe(true);
        expect(g.getCell(10, 10)!.layers[L.LIQUID]).toBe(C.CHASM);
        // DFF_PERMIT_BLOCKING：走廊里也放行。
        g = buildCorridor();
        const permit = { ...chasmFeat, flags: DFF_PERMIT_BLOCKING };
        res = spawnDungeonFeature(g, 20, 10, permit, true);
        expect(res.succeeded, 'DFF_PERMIT_BLOCKING 豁免否决（CE :3379）').toBe(true);
        expect(g.getCell(20, 10)!.layers[L.LIQUID]).toBe(C.CHASM);
        // abortIfBlocking=false（CE promoteTile 的调用形态，Time.c:1268）→ 放行。
        g = buildCorridor();
        res = spawnDungeonFeature(g, 20, 10, chasmFeat, false);
        expect(res.succeeded).toBe(true);
    });

    it('C4 DFF_CLEAR_OTHER_TERRAIN：足迹内其余非 GAS 层清空（DUNGEON 归 FLOOR、SURFACE 归 NOTHING）', () => {
        const g = openGrid(20, 20);
        g.setTerrainLayer(10, 10, L.LIQUID, C.WATER_SHALLOW);
        g.setTerrainLayer(10, 10, L.SURFACE, C.GRASS);
        const res = spawnDungeonFeature(g, 10, 10, feat({
            tile: C.CHASM,
            layer: L.LIQUID,
            flags: DFF_CLEAR_OTHER_TERRAIN,
        }), false);
        expect(res.succeeded).toBe(true);
        expect(g.getCell(10, 10)!.layers[L.LIQUID]).toBe(C.CHASM);
        expect(g.getCell(10, 10)!.layers[L.SURFACE], 'CLEAR_OTHER 清掉 SURFACE（CE :3434）').toBe(C.NOTHING);
        expect(g.getCell(10, 10)!.layers[L.DUNGEON], 'DUNGEON 层清成 FLOOR（CE :3434）').toBe(C.FLOOR);
    });

    it('C5 对抗：DFF_CLEAR_LOWER_PRIORITY_TERRAIN（真实 DF_OBSIDIAN）——40≤50 保留（方向写反在此翻红）', () => {
        const g = openGrid(20, 20);
        g.setTerrainLayer(10, 10, L.LIQUID, C.WATER_DEEP); // 40 ≤ OBSIDIAN 的 50 → 保留
        const res = spawnDungeonFeature(g, 10, 10, catalogFeature(DF.DF_OBSIDIAN), false);
        expect(res.succeeded).toBe(true);
        expect(g.getCell(10, 10)!.layers[L.SURFACE]).toBe(C.OBSIDIAN);
        expect(g.getCell(10, 10)!.layers[L.LIQUID], '优先级数字 ≤ 新 tile 的层必须保留（保留/清除写反的实现在此翻红）').toBe(C.WATER_DEEP);
        expect(g.getCell(10, 10)!.layers[L.DUNGEON], 'FLOOR(95) > 50 被清（清完仍是 FLOOR，CE :3434）').toBe(C.FLOOR);
    });

    it('C6 subsequentDF 链：INERT_BRIMSTONE 落层后链上缺 tile 的 BRIMSTONE_FIRE 抛错；BRIDGE_FIRE→CHASM→抛', () => {
        // DF_INERT_BRIMSTONE（tile ✓，start=0 → 原点一格）→ DF_BRIMSTONE_FIRE（登记 ✗）。
        const g = openGrid(20, 20);
        let threw = '';
        try {
            spawnDungeonFeature(g, 10, 10, catalogFeature(DF.DF_INERT_BRIMSTONE), false);
        } catch (err) {
            threw = (err as Error).message;
        }
        expect(g.getCell(10, 10)!.layers[L.LIQUID], '本体的 tile 先落层，链断在其后').toBe(C.INERT_BRIMSTONE);
        expect(threw, '链上的登记条目必须响亮点名缺的 tile（静默跳过=接出永不触发的晋升链）').toMatch(/BRIMSTONE_FIRE/);
        // DF_BRIDGE_FIRE（tile=0 合法无地形）→ DF_BRIDGE_FALL 落 CHASM → DF_BRIDGE_FALL_PREP（登记 ✗）抛。
        // 注意：链条在缺 tile 处抛出时外层 result 不会返回，message 登记的
        // 验证放在下方不抛错的合成条目上。
        const g2 = openGrid(20, 20);
        let threw2 = '';
        try {
            spawnDungeonFeature(g2, 10, 10, catalogFeature(DF.DF_BRIDGE_FIRE), false);
        } catch (err) {
            threw2 = (err as Error).message;
        }
        expect(g2.getCell(10, 10)!.layers[L.LIQUID], '链条中间环节真实落层').toBe(C.CHASM);
        expect(threw2).toMatch(/BRIDGE_FALLING/);
        // message 登记：CE description 原样进结果对象（:745 的文案在 E3 钉过）。
        const g3 = openGrid(20, 20);
        const res3 = spawnDungeonFeature(g3, 10, 10, feat({
            tile: C.OPEN_DOOR,
            layer: L.DUNGEON,
            description: 'test message registry',
        }), false);
        expect(res3.message, 'description 非空必须原样登记').toBe('test message registry');
        expect(g3.getCell(10, 10)!.layers[L.DUNGEON]).toBe(C.OPEN_DOOR);
    });

    it('C7 对抗：DFF_SUBSEQ_EVERYWHERE 只落在 fill 后的实际落点（用 fill 前 spawnMap 的实现在此翻红）', () => {
        // 场景：全场 FLOOR；(12..14, 9..11) 预铺 WATER_DEEP(40)。父 DF 铺
        // WATER_SHALLOW(55)（40<55 的格 fill 拒绝并从 spawnMap 除名），子 DF
        // OBSIDIAN 只许落在真铺到的格上；且子 DF 的 CLEAR_LOWER 会清掉
        // WATER_SHALLOW(55>50)——这正是 CE 目录里这对旗标的真实交互。
        const g = openGrid(20, 20);
        const patch: Array<[number, number]> = [];
        for (let x = 12; x <= 14; x++) {
            for (let y = 9; y <= 11; y++) {
                g.setTerrainLayer(x, y, L.LIQUID, C.WATER_DEEP);
                patch.push([x, y]);
            }
        }
        const res = spawnDungeonFeature(g, 10, 10, feat({
            tile: C.WATER_SHALLOW,
            layer: L.LIQUID,
            startProbability: 100,
            probabilityDecrement: 1, // CE 定义域内必须 dec>0（见 A1 注）
            flags: DFF_SUBSEQ_EVERYWHERE,
            subsequentDF: DF.DF_OBSIDIAN,
        }), false);
        expect(res.succeeded).toBe(true);
        for (const [x, y] of patch) {
            expect(g.getCell(x, y)!.layers[L.LIQUID], `补丁格(${x},${y}) 仍是深水（fill 拒绝）`).toBe(C.WATER_DEEP);
            expect(g.getCell(x, y)!.layers[L.SURFACE], `补丁格(${x},${y}) 不许被 SUBSEQ 波及（除名后的 spawnMap）`).toBe(C.NOTHING);
        }
        // 真铺到的格：子 DF 落 OBSIDIAN 到 SURFACE，并清掉父的 WATER_SHALLOW。
        expect(g.getCell(10, 10)!.layers[L.SURFACE]).toBe(C.OBSIDIAN);
        expect(g.getCell(10, 10)!.layers[L.LIQUID], "子 DF 的 CLEAR_LOWER 清走 55>50 的 WATER_SHALLOW").toBe(C.NOTHING);
        // 全场没有第三种状态：每个格要么是"补丁"，要么 SURFACE=OBSIDIAN。
        for (let x = 0; x < 20; x++) {
            for (let y = 0; y < 20; y++) {
                const inPatch = x >= 12 && x <= 14 && y >= 9 && y <= 11;
                const surface = g.getCell(x, y)!.layers[L.SURFACE];
                if (inPatch) continue;
                expect(surface, `(${x},${y}) 应被子 DF 覆盖`).toBe(C.OBSIDIAN);
            }
        }
    });

    it('C8 优先级门与晋升序列：DF_OPEN_DOOR 落在 FLOOR 上成；落在 DOOR 上被优先级挡但仍 succeeded', () => {
        // CE promoteTile（Time.c:1254-1268）先清层再 spawn——所以门能开。
        // 这里钉住两半：(a) 清层后（FLOOR 95 ≥ 25）落层成功；
        // (b) 不清层时 DOOR(8) < OPEN_DOOR(25) → 一格不落、但仍 succeeded
        //（CE :3410"只有堵了关卡才算失败"）。
        const g = openGrid(20, 20);
        let res = spawnDungeonFeature(g, 10, 10, catalogFeature(DF.DF_OPEN_DOOR), false);
        expect(res.succeeded).toBe(true);
        expect(res.builtCells).toEqual([{ x: 10, y: 10 }]);
        expect(g.getCell(10, 10)!.layers[L.DUNGEON]).toBe(C.OPEN_DOOR);
        g.setTerrain(11, 10, C.DOOR);
        res = spawnDungeonFeature(g, 11, 10, catalogFeature(DF.DF_OPEN_DOOR), false);
        expect(res.succeeded).toBe(true);
        expect(res.builtCells, '优先级挡住时不许虚报落点').toEqual([]);
        expect(g.getCell(11, 10)!.layers[L.DUNGEON]).toBe(C.DOOR);
    });

    it('C9 决定性：同种子同输入，spawnDungeonFeature 逐层逐格一致（多波 + 真实 RNG）', () => {
        const run = (): { layers: TerrainType[][][]; built: Array<[number, number]> } => {
            const g = openGrid(24, 24);
            rng.seedRandomGenerator(913);
            const res = spawnDungeonFeature(g, 12, 12, feat({
                tile: C.WATER_SHALLOW,
                layer: L.LIQUID,
                startProbability: 60,
                probabilityDecrement: 7,
            }), false);
            const layers: TerrainType[][][] = [];
            for (let x = 0; x < 24; x++) {
                layers[x] = [];
                for (let y = 0; y < 24; y++) layers[x]![y] = Array.from(g.getCell(x, y)!.layers);
            }
            const built = res.builtCells.map((p) => [p.x, p.y] as [number, number]);
            return { layers, built };
        };
        const a = run();
        const b = run();
        expect(b.layers).toEqual(a.layers);
        expect(b.built).toEqual(a.built);
        // 弱不变量：概率衰减下确实铺开了多格（否则用例退化）。
        expect(a.built.length).toBeGreaterThan(10);
    });
});

describe('C-4b D：levelIsDisconnectedWithBlockingMap（CE Architect.c:3137-3198）', () => {
    it('D1 1 宽走廊被单格阻断 → 1；开阔房中心 → 0', () => {
        const corridor = rockGrid(40, 40);
        for (let x = 1; x <= 38; x++) corridor.setTerrain(x, 10, C.FLOOR);
        let bm = marked(corridor, [[20, 10]]);
        expect(levelIsDisconnectedWithBlockingMap(corridor, bm, false)).toBe(1);

        const room = openGrid(20, 20);
        bm = marked(room, [[10, 10]]);
        expect(levelIsDisconnectedWithBlockingMap(room, bm, false)).toBe(0);
    });

    it('D2 对抗：锁门桥——阻断 LOCKED_DOOR 格判"断"（通行判据含锁门豁免；漏豁免在此翻红）', () => {
        // 双室由单格 LOCKED_DOOR 相连；把门格本身放进 blockingMap：
        // CE cellIsPassableOrDoor 把锁门视作可通行（TM_PROMOTES_WITH_KEY +
        // T_OBSTRUCTS_PASSABILITY，Architect.c:48-55）→ 两区漫进门格相触 → 1。
        const g = rockGrid(40, 40);
        for (let x = 2; x <= 18; x++) {
            for (let y = 8; y <= 12; y++) g.setTerrain(x, y, C.FLOOR);
        }
        for (let x = 20; x <= 37; x++) {
            for (let y = 8; y <= 12; y++) g.setTerrain(x, y, C.FLOOR);
        }
        g.setTerrain(19, 10, C.LOCKED_DOOR);
        let bm = marked(g, [[19, 10]]);
        expect(levelIsDisconnectedWithBlockingMap(g, bm, false), '锁门豁免缺失（用 terrainAllowsMove 口径）的实现在此翻红').toBe(1);
        // 对照：桥格是 GRANITE（两室本就隔死）→ 不断。
        g.setTerrain(19, 10, C.GRANITE);
        bm = marked(g, [[19, 10]]);
        expect(levelIsDisconnectedWithBlockingMap(g, bm, false)).toBe(0);
    });

    it('D3 countRegionSize=true 返回相触区对中较小者的格数（CE :3186-3190）', () => {
        const corridor = rockGrid(40, 40);
        for (let x = 1; x <= 38; x++) corridor.setTerrain(x, 10, C.FLOOR);
        const bm = marked(corridor, [[20, 10]]);
        // 左区 19 格（x=1..19），右区 18 格（x=21..38）→ min = 18。
        expect(levelIsDisconnectedWithBlockingMap(corridor, bm, true)).toBe(18);
    });
});

describe('C-4b E：目录完整性（CE Globals.c:603-932 抄录质量）', () => {
    it('E1 W-14 恰 135 条（原 134 + DF_FORCEFIELD）；历次闭包（C-6 增补 DF_GRASS/DF_FOLIAGE；B-3 增补 DF_FORCEFIELD_MELT/DF_SACRED_GLYPHS/DF_SHATTERING_SPELL；T-1 增补 DF_CRYSTAL_WALL；V-2b-2b 增补 DF_SHOW_TRAPDOOR_HALO/DF_SHOW_TRAPDOOR/DF_WOODEN_BARRICADE_BURN——TRAP_DOOR_HIDDEN.discoverType 与 WOODEN_BARRICADE.fireType 的载体，CE Globals.c:627/628/825；V-2b-3 增补 14 条 wired 载体 DF 链，见下；V-2b-4 增补 8 条祭坛族载体），且 DF 枚举 id 与 CE 枚举逐一对位（Rogue.h:1469 起）', () => {
        const keys = Object.keys(DUNGEON_FEATURE_CATALOG);
        // V-2b-3：35 → 49（+14）。CE Globals.c 目录行逐条：
        //   DF_RUBBLE :612、DF_SHOW_PARALYSIS_GAS_TRAP :626、DF_INACTIVE_GLYPH :726、
        //   DF_REVEAL_LEVER :732、DF_MEDIUM_HOLE :813、DF_OPEN_PORTCULLIS :854、
        //   DF_SHOW_METHANE_VENT :858、DF_METHANE_VENT_OPEN :859、
        //   DF_VENT_SPEW_METHANE :860、DF_PILOT_LIGHT :861、
        //   DF_DISCOVER_PARALYSIS_VENT :864、DF_PARALYSIS_VENT_SPEW :865、
        //   DF_REVEAL_PARALYSIS_VENT_SILENTLY :866、DF_WALL_SHATTER :924。
        // 它们是 18/22/24/25/67/68 号蓝图六条机器蓝图的 wired 晋升链落点
        // （逐字段钉死在 v_2b_3_wired 的 A 组与 E4 组）。
        // V-2b-4：49 → 57（+8）。CE Globals.c 目录行逐条：
        //   DF_LUMINESCENT_FUNGUS :608、DF_ITEM_CAGE_CLOSE :722、
        //   DF_ALTAR_COMMUTE :793、DF_MAGIC_PIPING :794、DF_ALTAR_RESURRECT :798、
        //   DF_MACHINE_FLOOR_TRIGGER_REPEATING :799、DF_CAGE_DISAPPEARS :812、
        //   DF_STATUE_SHATTER :873。前三条/后五条的归属见 DungeonFeatureCatalog
        //   的 V-2b-4 块注；逐字段钉死在 v_2b_4_altars 的 B 组。
        // V-2b-5：57 → 61（+4）。CE Globals.c 目录行逐条：
        //   DF_ALTAR_INERT :723、DF_WALL_CRACK :818、DF_CRACKING_STATUE :872、
        //   DF_TURRET_EMERGE :876（Rogue.h:1576/1666/1720/1724）。它们是
        //   21/29/43/50/56/69/70 号休眠载体地形 promoteType 链的落点，
        //   逐字段钉死在 v_2b_5_dormant 的 A3 组。
        // V-2b-5：57 → 61（+4，休眠唤醒轮：DF_ALTAR_INERT/DF_WALL_CRACK/
        // DF_CRACKING_STATUE/DF_TURRET_EMERGE）。
        // V-2b-6：61 → 68（+7，钥匙轮）。CE Globals.c 目录行逐条：
        //   DF_BONES :611、DF_CREATE_LEVER :734、DF_SHOW_POISON_GAS_VENT :851、
        //   DF_POISON_GAS_VENT_OPEN :852、DF_ACTIVATE_PORTCULLIS :853、
        //   DF_AMBIENT_BLOOD :869、DF_MONSTER_CAGE_OPENS :927。
        // 两条是 10 号 Kennel feature 的 DF 列（featureDF 载体本轮接上），
        // 五条是 40 号新地形三链字段拉入闭包的载体。
        // V-2b-7：68 → 90（+22，DF 特征系统轮）。CE Globals.c 目录行逐条：
        //   DF_DEAD_FOLIAGE :615、DF_SHOW_POISON_GAS_TRAP :625、
        //   DF_SHOW_FLAMETHROWER_TRAP :630、DF_VOMIT :652、DF_TUNNELIZE :678、
        //   DF_SMALL_DEAD_GRASS :689、DF_ALTAR_RETRACT :724、
        //   DF_PORTAL_ACTIVATE :725、DF_GLYPH_CIRCLE :731、
        //   DF_FLAMETHROWER :746、DF_EMBERS_PATCH :748、DF_SACRIFICE_ALTAR :802、
        //   DF_SACRIFICE_CAGE_ACTIVE :804、DF_COFFIN_BURSTS :807、
        //   DF_COFFIN_BURNS :808、DF_TRIGGER_AREA :809、
        //   DF_SURROUND_WOODEN_BARRICADE :824、DF_WORM_TUNNEL_MARKER_DORMANT :879、
        //   DF_WORM_TUNNEL_MARKER_ACTIVE :880、DF_SWAMP_WATER :903、
        //   DF_SWAMP :904、DF_SWAMP_MUD :905。
        // 来源三类：13 条目标蓝图 feature 的 DF 列 / 19 条新地形的三链字段 /
        // 上述两者的 subsequentDF 链展开。逐条字段钉死在 v_2b_7_features 的 B 组。
        // W-14：新增 CE 原行 DF_FORCEFIELD（51），阻障落点起点；不改变生成表。
        expect(keys.length).toBe(135);
        expect(DF.DF_FORCEFIELD).toBe(51);
        expect(DF.DF_SHOW_TRAPDOOR_HALO, 'V-2b-2b：CE Rogue.h:1487（Globals.c:627）').toBe(16);
        expect(DF.DF_SHOW_TRAPDOOR, 'V-2b-2b：TRAP_DOOR_HIDDEN.discoverType 的载体（Rogue.h:1488，Globals.c:628）').toBe(17);
        expect(DF.DF_WOODEN_BARRICADE_BURN, 'V-2b-2b：WOODEN_BARRICADE.fireType 的载体（Rogue.h:1669，Globals.c:825）').toBe(156);
        expect(DF.DF_CRYSTAL_WALL, 'T-1：runAutogenerators 表 index 1 的 DFType（Rogue.h:1471，Globals.c:607）').toBe(2);
        expect(DF.DF_GRASS, 'C-6：runAutogenerators 表 index 3 的 DFType（Rogue.h:1473，Globals.c:609）').toBe(4);
        expect(DF.DF_FOLIAGE, 'C-6：表 index 8 的 DFType（Rogue.h:1477，Globals.c:613）').toBe(8);
        expect(DF.DF_FORCEFIELD_MELT, 'B-3：FORCEFIELD.promoteType 的载体（Rogue.h:1527，Globals.c:675）').toBe(52);
        expect(DF.DF_SACRED_GLYPHS, 'B-3：SCROLL_SANCTUARY 的 DF（Rogue.h:1528，Globals.c:676）').toBe(53);
        expect(DF.DF_SHATTERING_SPELL, 'B-3：crystalize 的 DF（Rogue.h:1531，Globals.c:679）').toBe(56);
        expect(DF.DF_SHOW_DOOR).toBe(13);
        expect(DF.DF_BLOAT_EXPLOSION, 'F-2c：explosive bloat 的死亡 DF（Rogue.h:1508，Globals.c:1084 DFType 引用）').toBe(35);
        expect(DF.DF_REPEL_CREATURES).toBe(40);
        expect(DF.DF_ASH, 'F-2a：EMBERS.promoteType 的载体（Rogue.h:1524）').toBe(49);
        expect(DF.DF_STEAM_ACCUMULATION).toBe(43);
        expect(DF.DF_METHANE_GAS_PUFF).toBe(44);
        expect(DF.DF_TRAMPLED_FOLIAGE).toBe(61);
        expect(DF.DF_ACTIVE_BRIMSTONE).toBe(66);
        expect(DF.DF_INERT_BRIMSTONE).toBe(67);
        expect(DF.DF_OPEN_DOOR).toBe(81);
        expect(DF.DF_CLOSED_DOOR).toBe(82);
        expect(DF.DF_OPEN_IRON_DOOR_INERT).toBe(83);
        expect(DF.DF_BRIDGE_FALL_PREP).toBe(98);
        expect(DF.DF_BRIDGE_FALL).toBe(99);
        expect(DF.DF_PLAIN_FIRE).toBe(100);
        expect(DF.DF_GAS_FIRE, 'G-1：气体 tile 的 fireType 载体（Rogue.h:1593）').toBe(101);
        expect(DF.DF_EXPLOSION_FIRE, 'G-2：METHANE_GAS.promoteType 的载体（Rogue.h:1594）').toBe(102);
        expect(DF.DF_BRIMSTONE_FIRE).toBe(104);
        expect(DF.DF_BRIDGE_FIRE).toBe(105);
        expect(DF.DF_EMBERS).toBe(107);
        expect(DF.DF_OBSIDIAN).toBe(109);
        expect(DF.DF_POISON_GAS_CLOUD).toBe(125);
        expect(DF.DF_MACHINE_PRESSURE_PLATE_USED).toBe(154);
        expect(DF.DF_HOLE_2, 'C-5：DF_HOLE_POTION.subsequentDF 的载体（Rogue.h:1608）').toBe(115);
        expect(DF.DF_HOLE_DRAIN, 'C-5：HOLE.promoteType 的载体（Rogue.h:1609）').toBe(116);
        expect(DF.DF_HOLE_POTION, 'C-5：POTION_DESCENT / pit bloat 的 DF（Rogue.h:1632）').toBe(135);
        // V-2b-4：祭坛族轮八条（Rogue.h 枚举行逐条）。
        expect(DF.DF_LUMINESCENT_FUNGUS, 'V-2b-4：15 号蓝图 AMULET_SWITCH 的 DF 列（Rogue.h:1472，Globals.c:608）').toBe(3);
        expect(DF.DF_ITEM_CAGE_CLOSE, 'V-2b-4：ALTAR_CAGE_OPEN.promoteType（Rogue.h:1575，Globals.c:722）').toBe(85);
        expect(DF.DF_ALTAR_COMMUTE, 'V-2b-4：COMMUTATION_ALTAR.promoteType（Rogue.h:1641，Globals.c:793）').toBe(140);
        expect(DF.DF_MAGIC_PIPING, 'V-2b-4：6 号蓝图 COMMUTATION_ALTAR 的 DF 列（Rogue.h:1642，Globals.c:794）').toBe(141);
        expect(DF.DF_ALTAR_RESURRECT, 'V-2b-4：RESURRECTION_ALTAR.promoteType（Rogue.h:1646，Globals.c:798）').toBe(143);
        expect(DF.DF_MACHINE_FLOOR_TRIGGER_REPEATING, 'V-2b-4：7 号蓝图 RESURRECTION_ALTAR 的 DF 列（Rogue.h:1647，Globals.c:799）').toBe(144);
        expect(DF.DF_CAGE_DISAPPEARS, 'V-2b-4：ALTAR_CAGE_RETRACTABLE.promoteType（Rogue.h:1660，Globals.c:812）').toBe(151);
        expect(DF.DF_STATUE_SHATTER, 'V-2b-4：STATUE_INSTACRACK.discoverType（Rogue.h:1721，Globals.c:873）').toBe(188);
    });

    it('E2 闭包自洽：TerrainCatalog 字符串起点 + subsequentDF 展开 == 目录键集（多抄/漏抄/悬空全翻红）', () => {
        // 起点：31 地形的 fireType / discoverType / promoteType 非空字符串。
        const start = new Set<DF>();
        const terrainNames = Object.keys(TerrainType).filter((k) => Number.isNaN(Number(k)));
        for (const name of terrainNames) {
            const t = (TerrainType as unknown as Record<string, TerrainType>)[name]!;
            const entry = TERRAIN_FLAGS[t]!;
            for (const fld of [entry.fireType, entry.discoverType, entry.promoteType]) {
                if (!fld) continue;
                const id = (DF as unknown as Record<string, DF>)[fld];
                expect(id, `TerrainCatalog 引用的 ${fld} 必须是 DF 枚举成员`).toBeDefined();
                start.add(id!);
            }
        }
        // F-2c：DF_BLOAT_EXPLOSION 不经 TerrainCatalog 字符串（其载体 tile
        // 条目的三链字段全空），起点是怪物侧 monsterCatalog 的 DFType 列
        // （Globals.c:1084，web 消费点 Game.triggerDeathFeatures）——按第二
        // 起点登记（闭包守卫不变：目录键集仍须与闭包恰好相等）。
        start.add(DF.DF_BLOAT_EXPLOSION);
        // C-5：DF_HOLE_POTION 同款第二起点——不经 TerrainCatalog 字符串，
        // 起点是 POTION_DESCENT（Items.c:8097）与 pit bloat 死亡 DFType
        // （Globals.c:1039），web 消费点 Game.quaffItem / triggerDeathFeatures。
        start.add(DF.DF_HOLE_POTION);
        // C-6：DF_GRASS / DF_FOLIAGE 第二起点——不经 TerrainCatalog 字符串，
        // 起点是 autoGenerator 表 index 3/8 的 DFType 列（GlobalsBrogue.c:117/122，
        // 消费点 runAutogenerators → spawnDungeonFeature）。
        start.add(DF.DF_GRASS);
        start.add(DF.DF_FOLIAGE);
        // T-1：DF_CRYSTAL_WALL 第二起点——不经 TerrainCatalog 字符串
        //（CRYSTAL_WALL tile 的三链字段只有 fireType=DF_PLAIN_FIRE），起点是
        // autoGenerator 表 index 1 的 DFType 列（GlobalsBrogue.c:115，消费点
        // runAutogenerators → spawnDungeonFeature，同 DF_GRASS 先例）。
        start.add(DF.DF_CRYSTAL_WALL);
        // B-3：DF_SACRED_GLYPHS / DF_SHATTERING_SPELL 第二起点——不经
        // TerrainCatalog 字符串（SACRED_GLYPH tile 的三链字段全空；RUBBLE web
        // 无 tile）。起点是卷轴调用点：SCROLL_SANCTUARY（Items.c:7942）与
        // crystalize 的 per-cell spawn（Items.c:4917），web 消费点
        // Game.sanctuaryFromPlayer / crystalizeFromPlayer。
        // DF_FORCEFIELD_MELT 不需要第二起点——经 FORCEFIELD.promoteType
        // 字符串自动入闭包。
        // W-14：detonateBolt 动态复制 DF_FORCEFIELD；不是 pathDF/targetDF 或生成起点。
        start.add(DF.DF_FORCEFIELD);
        start.add(DF.DF_SACRED_GLYPHS);
        start.add(DF.DF_SHATTERING_SPELL);
        // V-2b-3：DF_MEDIUM_HOLE 第三起点（数据起点，web 当前零消费者）——
        // 不经 TerrainCatalog 字符串，也不被任何 subsequentDF 引用；CE 的起点
        // 是 22 号蓝图 feature 的 **DF 列**（GlobalsBrogue.c:324
        // `{DF_MEDIUM_HOLE, MACHINE_PRESSURE_PLATE, LIQUID, …}`），而 web 的
        // FeatureDef 没有 df 列（V-2b-7 的授权范围），故本轮它只有数据没有
        // 调用者。**留痕**：闭包守卫（集合全等）在此仍原样成立——不许因为
        // "反正没人用"把它从目录里删掉（CE 目录里有），也不许悄悄放宽成
        // 包含关系；V-2b-7 给 FeatureDef 接上 df 列时，本行应改为经蓝图数据
        // 自动入闭包并删除（届时 generation 相关捕获需同步）。
        start.add(DF.DF_MEDIUM_HOLE);
        // V-2b-4：DF_LUMINESCENT_FUNGUS :608 / DF_MAGIC_PIPING :794 /
        // DF_MACHINE_FLOOR_TRIGGER_REPEATING :799——三条**数据起点**（同
        // DF_MEDIUM_HOLE 先例）：CE 的起点是 6/7/15 号蓝图 feature 的 **DF 列**
        // （GlobalsBrogue.c:225 `{DF_MAGIC_PIPING, COMMUTATION_ALTAR, …}`、
        // :231 `{DF_MACHINE_FLOOR_TRIGGER_REPEATING, RESURRECTION_ALTAR, …}`、
        // :291 `{DF_LUMINESCENT_FUNGUS, AMULET_SWITCH, …}`），而 web 的
        // FeatureDef 没有 df 列（V-2b-7 的授权范围），故本轮它们只有数据没有
        // 调用者。**留痕**：闭包守卫（集合全等）在此仍原样成立——不许因为
        // "反正没人用"把它们从目录里删掉（CE 目录里有），也不许悄悄放宽成
        // 包含关系；V-2b-7 给 FeatureDef 接上 df 列时，本三行应改为经蓝图数据
        // 自动入闭包并删除（届时 generation 相关捕获需同步）。
        // 另五条（DF_ITEM_CAGE_CLOSE / DF_ALTAR_COMMUTE / DF_ALTAR_RESURRECT /
        // DF_CAGE_DISAPPEARS / DF_STATUE_SHATTER）经新地形的三链字段自动入闭包，
        // 无需第二起点。
        start.add(DF.DF_LUMINESCENT_FUNGUS);
        start.add(DF.DF_MAGIC_PIPING);
        start.add(DF.DF_MACHINE_FLOOR_TRIGGER_REPEATING);
        for (const id of [DF.DF_ADD_DORMANT_CHASM_HALO, DF.DF_LAVA_RETRACTABLE,
            DF.DF_SPREADABLE_WATER_POOL, DF.DF_ADD_MACHINE_COLLAPSE_EDGE_DORMANT,
            DF.DF_MUD_DORMANT, DF.DF_CATWALK_BRIDGE, DF.DF_CHASM_HOLE,
            DF.DF_LAKE_CELL]) start.add(id);
        // 同组目录中的状态转换入口由 9b 蓝图/尚未落地的中间 tile 消费；本轮
        // 仍把整组作为静态数据起点，确保集合全等守卫不被放宽。
        for (const id of [DF.DF_SPREADABLE_WATER, DF.DF_SHALLOW_WATER,
            DF.DF_WATER_SPREADS, DF.DF_SPREADABLE_DEEP_WATER_POOL,
            DF.DF_SPREADABLE_COLLAPSE, DF.DF_COLLAPSE, DF.DF_COLLAPSE_SPREADS,
            DF.DF_BRIDGE_ACTIVATE, DF.DF_BRIDGE_ACTIVATE_ANNOUNCE,
            DF.DF_BRIDGE_APPEARS, DF.DF_RETRACTING_LAVA,
            DF.DF_OBSIDIAN_WITH_STEAM, DF.DF_MUD_ACTIVATE, DF.DF_LAKE_HALO]) start.add(id);
        // V-2b-9c: DARK_FLOOR_DARKENING / HAUNTED_TORCH_TRANSITIONING
        // now supply their promoteType roots through the terrain scan above.
        // V-2b-6：DF_AMBIENT_BLOOD / DF_BONES 第二起点——本轮 FeatureDef 已有
        // df 列（feature.featureDF），但闭包是**静态数据扫描**，不运行蓝图；
        // CE 的起点是 10 号 Kennel feature 的 DF 列（GlobalsBrogue.c:252/253
        // `{DF_AMBIENT_BLOOD, 0, …}` / `{DF_BONES, 0, …}`），web 消费点
        // BlueprintEngine 的 featureDF 落位分支（CE Architect.c:1434-1440）。
        // ★ V-2b-7 起改为**数据驱动**：直接扫 blueprints.json 的
        // featureDF 列（V-2b-4/V-2b-6 的块注都写着"FeatureDef 接上 df 列后
        // 应改为经蓝图数据自动入闭包"——本轮兑现）。这样新增蓝图只要写错
        // DF 名，E2 的悬空引用检查会当场翻红，不必再手工加起点。
        for (const bp of blueprintData as unknown as Array<{ features: Array<{ featureDF?: string }> }>) {
            for (const feat of bp.features) {
                if (!feat.featureDF) continue;
                const id = (DF as unknown as Record<string, DF>)[feat.featureDF];
                expect(id, `blueprints.json 引用了非 DF 枚举成员：${feat.featureDF}`).toBeDefined();
                start.add(id!);
            }
        }
        // 沿 subsequentDF 闭包展开（悬空引用在此翻红）。
        const closure = new Set<DF>();
        const queue = [...start];
        while (queue.length > 0) {
            const id = queue.pop()!;
            if (closure.has(id)) continue;
            closure.add(id);
            const entry = DUNGEON_FEATURE_CATALOG[id];
            expect(entry, `闭包内的 DF#${id} 必须有目录条目（悬空 subsequentDF）`).toBeDefined();
            if (entry!.subsequentDF !== null) queue.push(entry!.subsequentDF);
        }
        // 集合相等：目录里多一条（闭包外）或少一条（漏抄）都翻红。
        const catalogKeys = new Set(Object.keys(DUNGEON_FEATURE_CATALOG).map(Number) as DF[]);
        expect([...closure].sort((a, b) => a - b)).toEqual([...catalogKeys].sort((a, b) => a - b));
        expect(catalogKeys.size, 'F-2a：DF_ASH 入闭包 19→20；G-1：DF_GAS_FIRE 入闭包 20→21；' +
            'G-2：DF_EXPLOSION_FIRE（经 METHANE_GAS.promoteType）入闭包 21→22；' +
            'F-2c：DF_BLOAT_EXPLOSION（经 bloat 的 DFType）入闭包 22→23；' +
            'C-5：DF_HOLE_POTION（药水/pit bloat 起点）→ DF_HOLE_2 → DF_HOLE_DRAIN' +
            '（经 HOLE.promoteType）入闭包 23→26；' +
            'C-6：DF_GRASS/DF_FOLIAGE（自动生成器表 index 3/8 起点）入闭包 26→28；' +
            'B-3：DF_FORCEFIELD_MELT（经 FORCEFIELD.promoteType）+ DF_SACRED_GLYPHS' +
            '/DF_SHATTERING_SPELL（卷轴起点）入闭包 28→31；' +
            'T-1：DF_CRYSTAL_WALL（自动生成器表 index 1 起点）入闭包 31→32；' +
            'V-2b-2b：DF_SHOW_TRAPDOOR_HALO/DF_SHOW_TRAPDOOR（TRAP_DOOR_HIDDEN.' +
            'discoverType 起点 + 其 subsequent）与 DF_WOODEN_BARRICADE_BURN' +
            '（WOODEN_BARRICADE.fireType 起点）入闭包 32→35；' +
            'V-2b-3：wired 载体 14 条入目录后，10 条经九条新地形的三链字段' +
            '（fireType/discoverType/promoteType）直接入闭包、3 条经 subsequentDF' +
            '（DF_RUBBLE ← DF_WALL_SHATTER、DF_VENT_SPEW_METHANE ←' +
            ' DF_METHANE_VENT_OPEN、DF_REVEAL_PARALYSIS_VENT_SILENTLY ←' +
            ' DF_PARALYSIS_VENT_SPEW）入闭包，第 14 条 DF_MEDIUM_HOLE 在 web 无' +
            '消费者（CE 起点是蓝图 feature 的 DF 列，见上方第三起点注）——35→49；' +
            'V-2b-4：祭坛族轮八条入目录后，5 条经七条新地形的三链字段' +
            '（promoteType/discoverType）直接入闭包、1 条经 subsequentDF' +
            '（DF_RUBBLE ← DF_STATUE_SHATTER，DF_RUBBLE 已在目录）入闭包，' +
            '其余 3 条（DF_LUMINESCENT_FUNGUS/DF_MAGIC_PIPING/' +
            'DF_MACHINE_FLOOR_TRIGGER_REPEATING）在 web 无消费者' +
            '（CE 起点是蓝图 feature 的 DF 列）——49→57；' +
            'V-2b-5：休眠唤醒轮四条入目录后全部经七条新地形的三链字段' +
            '（promoteType）自动入闭包——57→61；' +
            'V-2b-6：钥匙轮七条入目录后，5 条经六条新地形的三链字段' +
            '（promoteType/discoverType）直接入闭包，2 条（DF_AMBIENT_BLOOD/' +
            'DF_BONES）经 Kennel feature 的 DF 列起点入闭包——61→68；' +
            'V-2b-7：DF 特征系统轮 22 条入闭包（13 条目标蓝图 feature 的 DF 列' +
            '（现由 blueprints.json 数据驱动入起点）+ 19 条新地形的三链字段 + ' +
            '两条链展开环节 DF_EMBERS_PATCH/DF_SWAMP_MUD→DF_SWAMP_WATER）' +
            '——68→90→99；V-2b-9b 环境链与 DF_PUDDLE 闭包 →134；W-14 阻障起点 →135').toBe(135);
    });

    it('E3 字段抽查：BRIDGE_FALL_PREP 的 prop/200/100、BRIDGE_FIRE 的描述与 tile=0、其余代表条目', () => {
        const prep = DUNGEON_FEATURE_CATALOG[DF.DF_BRIDGE_FALL_PREP]!;
        expect(prep.ceLine).toBe(736);
        expect(prep.ceTile).toBe('BRIDGE_FALLING');
        expect(prep.tile).toBeNull();
        expect(prep.propagationTerrain, 'CE :736 的 propTerrain=BRIDGE').toBe(C.BRIDGE);
        expect(prep.startProbability).toBe(200);
        expect(prep.probabilityDecrement).toBe(100);

        const fire = DUNGEON_FEATURE_CATALOG[DF.DF_BRIDGE_FIRE]!;
        expect(fire.ceLine).toBe(745);
        expect(fire.ceTile).toBe('NOTHING');
        expect(fire.tile, 'CE :745 tile=0 → NOTHING（合法无地形 DF），不是 null（登记）').toBe(C.NOTHING);
        expect(fire.layer).toBe(L.DUNGEON);
        expect(fire.subsequentDF).toBe(DF.DF_BRIDGE_FALL);
        expect(fire.description).toContain('rope bridge snaps');
        expect(fire.lightFlare).toBe('FALLEN_TORCH_FLASH_LIGHT');

        const gas = DUNGEON_FEATURE_CATALOG[DF.DF_POISON_GAS_CLOUD]!;
        expect(gas.ceLine).toBe(770);
        expect(gas.layer).toBe(L.GAS);
        expect(gas.startProbability).toBe(1000);
        expect(gas.description).toContain('caustic gas');

        const repel = DUNGEON_FEATURE_CATALOG[DF.DF_REPEL_CREATURES]!;
        expect(repel.ceLine).toBe(663);
        expect(repel.flags).toBe(DFF_EVACUATE_CREATURES_FIRST);

        const obs = DUNGEON_FEATURE_CATALOG[DF.DF_OBSIDIAN]!;
        expect(obs.ceLine).toBe(749);
        expect(obs.flags).toBe(DFF_CLEAR_LOWER_PRIORITY_TERRAIN);
        expect(obs.tile).toBe(C.OBSIDIAN);
        expect(obs.layer).toBe(L.SURFACE);

        const show = DUNGEON_FEATURE_CATALOG[DF.DF_SHOW_DOOR]!;
        expect(show.ceLine).toBe(624);
        expect(show.tile).toBe(C.DOOR);
        expect(show.lightFlare).toBe('GENERIC_FLASH_LIGHT');

        const steam = DUNGEON_FEATURE_CATALOG[DF.DF_STEAM_ACCUMULATION]!;
        expect(steam.ceLine).toBe(666);
        expect(steam.startProbability, 'GAS 层 DF 的 start 列即 volume（CE Globals.c:600 注释）').toBe(15);
        expect(steam.probabilityDecrement).toBe(0);

        // G-2 接线：三条 GAS 层 DF 的 tile 列填上（tile 归属层必须同为 GAS
        // ——tile 填错层的实现在此翻红）。
        expect(gas.tile, 'G-2：DF_POISON_GAS_CLOUD 的 tile 接线').toBe(C.POISON_GAS);
        expect(steam.tile, 'G-2：DF_STEAM_ACCUMULATION 的 tile 接线').toBe(C.STEAM);
        const puff = DUNGEON_FEATURE_CATALOG[DF.DF_METHANE_GAS_PUFF]!;
        expect(puff.ceLine).toBe(667);
        expect(puff.tile, 'G-2：DF_METHANE_GAS_PUFF 的 tile 接线').toBe(C.METHANE_GAS);
        expect(puff.startProbability).toBe(2);
        for (const df of [DF.DF_POISON_GAS_CLOUD, DF.DF_STEAM_ACCUMULATION, DF.DF_METHANE_GAS_PUFF]) {
            const e = DUNGEON_FEATURE_CATALOG[df]!;
            expect(e.layer, `${DF[df]} 是 GAS 层 DF`).toBe(L.GAS);
            expect(e.probabilityDecrement, 'GAS 层 DF 的 decr 恒无效（Architect.c:3381-3387 特例）').toBe(0);
        }

        // G-1：DF_GAS_FIRE（Globals.c:741 {GAS_FIRE, SURFACE, 0, 0}）——
        // layer 是 SURFACE（GAS_FIRE 是十种 T_IS_FIRE 地形之一，不是气体层
        // 地形；F-0 §3.2 表未记 layer 列，G-1 实测翻正）。
        // G-2 接线：tile GAS_FIRE 已迁——"把 DF_GAS_FIRE 按 GAS 层接线"
        // 的错误实现（layer 改 GAS / tile 认成气体）在此翻红。
        const gasFire = DUNGEON_FEATURE_CATALOG[DF.DF_GAS_FIRE]!;
        expect(gasFire.ceLine).toBe(741);
        expect(gasFire.ceTile).toBe('GAS_FIRE');
        expect(gasFire.tile, 'G-2：DF_GAS_FIRE 的 tile 接线（SURFACE 火地形）').toBe(C.GAS_FIRE);
        expect(gasFire.layer, 'DF_GAS_FIRE 的 layer 是 SURFACE 不是 GAS（G-1 §八.1）').toBe(L.SURFACE);
        expect(gasFire.startProbability).toBe(0);

        // G-2 新增、F-2c 接线：DF_EXPLOSION_FIRE（Globals.c:742
        // {GAS_EXPLOSION, SURFACE, 60, 17}）—— METHANE_GAS 的爆轰
        // promoteType；GAS_EXPLOSION tile 已迁（F-2c，Globals.c:496），
        // 爆轰圈经既有管线真实落地。
        const boom = DUNGEON_FEATURE_CATALOG[DF.DF_EXPLOSION_FIRE]!;
        expect(boom.ceLine).toBe(742);
        expect(boom.ceTile).toBe('GAS_EXPLOSION');
        expect(boom.tile, 'F-2c：DF_EXPLOSION_FIRE 的 tile 接线（爆炸地形）').toBe(C.GAS_EXPLOSION);
        expect(boom.layer).toBe(L.SURFACE);
        expect(boom.startProbability).toBe(60);
        expect(boom.probabilityDecrement).toBe(17);

        // F-2c 新增：DF_BLOAT_EXPLOSION（Globals.c:654
        // {GAS_EXPLOSION, SURFACE, 350, 100, 0, "", EXPLOSION_FLARE_LIGHT}）
        // —— explosive bloat 的死亡 DF（Globals.c:1084 DFType 引用，
        // Combat.c:1965-1967 killCreature 播出）。与爆轰圈同 tile 不同参数。
        const bloat = DUNGEON_FEATURE_CATALOG[DF.DF_BLOAT_EXPLOSION]!;
        expect(bloat.ceLine).toBe(654);
        expect(bloat.ceTile).toBe('GAS_EXPLOSION');
        expect(bloat.tile).toBe(C.GAS_EXPLOSION);
        expect(bloat.layer).toBe(L.SURFACE);
        expect(bloat.startProbability).toBe(350);
        expect(bloat.probabilityDecrement).toBe(100);
        expect(bloat.description).toBe('');
        expect(bloat.lightFlare).toBe('EXPLOSION_FLARE_LIGHT');

        // B-3 新增三条：FORCEFIELD_MELT（Globals.c:675 {FORCEFIELD_MELT,
        // SURFACE, 0, 0}）、SACRED_GLYPHS（:676 {SACRED_GLYPH, SURFACE,
        // 100, 100, 0, "", EMPOWERMENT_LIGHT}）、SHATTERING_SPELL（:679
        // {RUBBLE, SURFACE, 0, 0, DFF_ACTIVATE_DORMANT_MONSTER}，行号由
        // 枚举对齐 + :677/:678 双锚推得）。
        const melt = DUNGEON_FEATURE_CATALOG[DF.DF_FORCEFIELD_MELT]!;
        expect(melt.ceLine).toBe(675);
        expect(melt.ceTile).toBe('FORCEFIELD_MELT');
        expect(melt.tile).toBe(C.FORCEFIELD_MELT);
        expect(melt.layer).toBe(L.SURFACE);
        expect(melt.startProbability).toBe(0);
        expect(melt.subsequentDF).toBeNull();

        const glyph = DUNGEON_FEATURE_CATALOG[DF.DF_SACRED_GLYPHS]!;
        expect(glyph.ceLine).toBe(676);
        expect(glyph.ceTile).toBe('SACRED_GLYPH');
        expect(glyph.tile).toBe(C.SACRED_GLYPH);
        expect(glyph.layer).toBe(L.SURFACE);
        expect(glyph.startProbability).toBe(100);
        expect(glyph.probabilityDecrement).toBe(100);
        expect(glyph.lightFlare).toBe('EMPOWERMENT_LIGHT');
        expect(glyph.flags).toBe(0);

        const shatter = DUNGEON_FEATURE_CATALOG[DF.DF_SHATTERING_SPELL]!;
        expect(shatter.ceLine).toBe(679);
        expect(shatter.ceTile).toBe('RUBBLE');
        // ★ V-2b-7 反转（留痕到期）：原断言是 "RUBBLE web 无地形 → 登记
        // null（入 DF_MISSING_TILES）"。本轮 RUBBLE 地形随 DF_TUNNELIZE
        //（55 号挖掘落点）落地，该条接上真 tile，同时它与 DF_RUBBLE /
        // DF_WALL_SHATTER / DF_STATUE_SHATTER 一并从 DF_MISSING_TILES 摘除
        //（v_2b-5 报告 §3 登记的"休眠唤醒链结构性堵点"由此解除）。
        // 守卫**变强**：不仅钉 tile 指向，还钉它真的脱离了缺 tile 名单。
        expect(shatter.tile, 'RUBBLE 地形 V-2b-7 已落地 → 不再是登记缺口').toBe(C.RUBBLE);
        expect(DF_MISSING_TILES, 'RUBBLE 已到位，本 DF 不得再留在缺 tile 名单里').not.toContain(DF.DF_SHATTERING_SPELL);
        expect(shatter.layer).toBe(L.SURFACE);
        expect(shatter.startProbability).toBe(0);
        expect(shatter.probabilityDecrement).toBe(0);
        expect(shatter.flags).toBe(DFF_ACTIVATE_DORMANT_MONSTER);
    });

    it('E4 缺 tile 登记恰 26 条（G-2 后 6；B-3 增 DF_SHATTERING_SPELL——RUBBLE tile web 无；V-2b-2b 增 DF_SHOW_TRAPDOOR；V-2b-3 增 11 条 wired 载体链环节；V-2b-4 增 7 条祭坛族载体）：' +
        'catalogFeature 对其抛错点名；对其余条目正常转换', () => {
        const all = Object.keys(DUNGEON_FEATURE_CATALOG).map(Number) as DF[];
        const missing = new Set(DF_MISSING_TILES);
        // V-2b-2b：DF_SHOW_TRAPDOOR 入列（TRAP_DOOR tile web 无），7 → 8。
        // V-2b-3：8 → 19（+11）。新增条目逐条见 DungeonFeatureCatalog 的
        // V-2b-3 块注：DF_RUBBLE(→RUBBLE)、DF_INACTIVE_GLYPH(→MACHINE_GLYPH_
        // INACTIVE)、DF_REVEAL_LEVER(→WALL_LEVER)、DF_MEDIUM_HOLE(→TRAP_DOOR)、
        // DF_OPEN_PORTCULLIS(→PORTCULLIS_DORMANT)、DF_SHOW_METHANE_VENT
        // (→MACHINE_METHANE_VENT_DORMANT)、DF_METHANE_VENT_OPEN
        // (→MACHINE_METHANE_VENT)、DF_PILOT_LIGHT(→PILOT_LIGHT)、
        // DF_DISCOVER_PARALYSIS_VENT(→MACHINE_PARALYSIS_VENT)、
        // DF_REVEAL_PARALYSIS_VENT_SILENTLY(同上)、DF_WALL_SHATTER(→RUBBLE)。
        // 链上 tile 已齐的三条（DF_SHOW_PARALYSIS_GAS_TRAP、DF_VENT_SPEW_METHANE、
        // DF_PARALYSIS_VENT_SPEW）**不入列**——它们是真能落地的环节，
        // 列入会让守卫失去意义（v_2b_3_wired 的 E4 组正向钉死这一点）。
        // V-2b-4：19 → 26（+7）。八条新目录条目里七条 tile=null
        //（DF_LUMINESCENT_FUNGUS→LUMINESCENT_FUNGUS、DF_ITEM_CAGE_CLOSE→
        // ALTAR_CAGE_CLOSED、DF_ALTAR_COMMUTE→COMMUTATION_ALTAR_INERT、
        // DF_MAGIC_PIPING→PIPE_GLOWING、DF_ALTAR_RESURRECT→
        // RESURRECTION_ALTAR_INERT、DF_MACHINE_FLOOR_TRIGGER_REPEATING→
        // MACHINE_TRIGGER_FLOOR_REPEATING、DF_STATUE_SHATTER→RUBBLE）；
        // 唯一带完整 tile 的 DF_CAGE_DISAPPEARS（tile ALTAR_INERT = web 既有
        // TerrainType.ALTAR）**不入列**——它真能落地。
        // V-2b-5：26 → 28（+2）。四条新目录条目里两条 tile=null
        //（DF_WALL_CRACK→RAT_TRAP_WALL_CRACKING :818、DF_CRACKING_STATUE→
        // STATUE_CRACKING :872）；另两条带完整 tile 故不入列——
        // DF_ALTAR_INERT（tile ALTAR_INERT = web TerrainType.ALTAR）与
        // DF_TURRET_EMERGE（tile = WALL，web 既有）。
        // V-2b-6：28 → 29（净 +1）。七条新目录条目里两条 tile=null
        //（DF_SHOW_POISON_GAS_VENT→MACHINE_POISON_GAS_VENT_DORMANT :851、
        // DF_POISON_GAS_VENT_OPEN→MACHINE_POISON_GAS_VENT :852）；五条带
        // 完整 tile 不入列——DF_CREATE_LEVER（WALL_LEVER_HIDDEN）、
        // DF_ACTIVATE_PORTCULLIS（PORTCULLIS_CLOSED）、DF_AMBIENT_BLOOD
        //（RED_BLOOD = TerrainType.BLOOD）、DF_MONSTER_CAGE_OPENS
        //（MONSTER_CAGE_OPEN）、DF_BONES（BONES，均本轮新增/既有）。
        // 同轮摘除 DF_OPEN_PORTCULLIS（tile PORTCULLIS_DORMANT 本轮落地）。
        // V-2b-7：29 → 31（摘 5 增 7）。摘除五条——RUBBLE 地形（DF_RUBBLE :612、
        // DF_SHATTERING_SPELL :679、DF_WALL_SHATTER :924、DF_STATUE_SHATTER :873）
        // 与 LUMINESCENT_FUNGUS 地形（DF_LUMINESCENT_FUNGUS :608）本轮落地；
        // 增补七条——22 条新目录条目里 tile 无 web 载体的
        //（DF_SHOW_POISON_GAS_TRAP→GAS_TRAP_POISON :625、DF_SHOW_FLAMETHROWER_TRAP
        // →FLAMETHROWER :630、DF_ALTAR_RETRACT→FLOOR_FLOODABLE :724、
        // DF_PORTAL_ACTIVATE→PORTAL_LIGHT :725、DF_SACRIFICE_ALTAR→SACRIFICE_ALTAR
        // :802、DF_COFFIN_BURSTS→COFFIN_OPEN :807、DF_WORM_TUNNEL_MARKER_ACTIVE
        // →WORM_TUNNEL_MARKER_ACTIVE :880）。另 15 条带完整 tile 不入列。
        expect(DF_MISSING_TILES.length).toBe(30); // V-2b-9d: glyph and stench carriers, 32 -> 30.
        // 登记条目确实都是 tile=null，且抛错带 CE tile 名。
        for (const id of DF_MISSING_TILES) {
            expect(DUNGEON_FEATURE_CATALOG[id]!.tile, `DF#${id} 应为 null tile`).toBeNull();
            expect(() => catalogFeature(id), `DF#${id} 应拒绝`).toThrow(/tileType/);
            expect(() => catalogFeature(id)).toThrow(new RegExp(DUNGEON_FEATURE_CATALOG[id]!.ceTile));
        }
        // 其余 59 条（90 − 31 缺 tile）转换成功且字段保真。
        // F-2a 翻正位：DF_PLAIN_FIRE.tile=PLAIN_FIRE、DF_EMBERS.tile=EMBERS、
        // 新增 DF_ASH.tile=ASH——三者现在必须能正常转换（放回 missing 会红）。
        // G-2 翻正位：DF_POISON_GAS_CLOUD / DF_STEAM_ACCUMULATION /
        // DF_METHANE_GAS_PUFF / DF_GAS_FIRE 四条接线（放回 missing 会红）。
        for (const id of all) {
            if (missing.has(id)) continue;
            const entry = DUNGEON_FEATURE_CATALOG[id]!;
            const f = catalogFeature(id);
            expect(f.tile, `DF#${id}`).toBe(entry.tile);
            expect(f.layer).toBe(entry.layer);
            expect(f.startProbability).toBe(entry.startProbability);
            expect(f.subsequentDF).toBe(entry.subsequentDF);
        }
        expect(catalogFeature(DF.DF_PLAIN_FIRE).tile, 'F-2a：火地形已存在，DF 必须能落地').toBe(C.PLAIN_FIRE);
        expect(catalogFeature(DF.DF_EMBERS).tile).toBe(C.EMBERS);
        expect(catalogFeature(DF.DF_ASH).tile).toBe(C.ASH);
        expect(catalogFeature(DF.DF_POISON_GAS_CLOUD).tile, 'G-2 接线').toBe(C.POISON_GAS);
        expect(catalogFeature(DF.DF_STEAM_ACCUMULATION).tile, 'G-2 接线').toBe(C.STEAM);
        expect(catalogFeature(DF.DF_METHANE_GAS_PUFF).tile, 'G-2 接线').toBe(C.METHANE_GAS);
        expect(catalogFeature(DF.DF_GAS_FIRE).tile, 'G-2 接线').toBe(C.GAS_FIRE);
        expect(catalogFeature(DF.DF_EXPLOSION_FIRE).tile, 'F-2c 接线').toBe(C.GAS_EXPLOSION);
        expect(catalogFeature(DF.DF_BLOAT_EXPLOSION).tile, 'F-2c 接线').toBe(C.GAS_EXPLOSION);
        // tileless 两条件名字单（防有人把"登记"与"tile=0"混掉）。
        expect(catalogFeature(DF.DF_REPEL_CREATURES).tile).toBe(C.NOTHING);
        expect(catalogFeature(DF.DF_BRIDGE_FIRE).tile).toBe(C.NOTHING);
    });

    // V-2b-9a-finish（验收方）：本轮把 throw 臂从 218 挪到 219，但 219 不是 DF——
    // CE `Rogue.h` 的枚举自 DF_GRANITE_COLUMN = 1 起数，末项是
    // DF_STENCH_SMOLDER = 218，219 是终止符 NUMBER_DUNGEON_FEATURES；
    // web 侧 DF 枚举同样止于 DF_STENCH_SMOLDER = 218。
    // 钉一个永远不可能成为目录成员的哨兵值 ⇒ 这条守卫退化为恒真（审计报告
    // 「挑 seed 的测试」分类里的**哑**），再也抓不住"未授权 id 混进目录"。
    // 改钉 217 = DF_STENCH_BURN：真实存在、刻意未抄录，且 g_2 的禁入名单仍列着它。
    // 将来谁把 217 抄进目录，这条会响。
    it('E5 目录条目不影响未登记 id：未抄录 id 的查询得到 undefined（218 项枚举已抄 131 条）', () => {
        expect(DUNGEON_FEATURE_CATALOG[1 as DF]).toBeUndefined();   // DF_GRANITE_COLUMN
        expect(DUNGEON_FEATURE_CATALOG[217 as DF]).toBeUndefined(); // DF_STENCH_BURN
        expect(() => catalogFeature(217 as DF)).toThrow(/未抄录/);
        // 219 = NUMBER_DUNGEON_FEATURES（枚举终止符，非 DF），越界查询同样得 undefined。
        expect(DUNGEON_FEATURE_CATALOG[219 as DF]).toBeUndefined();
    });
});

describe('C-4b F：留痕（本轮明确不做的事；C-4c 翻转）', () => {
    it('F1 留痕：DF 子系统符号的生产引用只出现在白名单文件（C-4d 接线机器时再扩清单）', () => {
        const srcDir = fileURLToPath(new URL('../', import.meta.url));
        const collect = (dir: string, out: string[] = []): string[] => {
            for (const name of readdirSync(dir)) {
                const p = join(dir, name);
                if (statSync(p).isDirectory()) collect(p, out);
                else if (/\.(ts|tsx|vue)$/.test(name)) out.push(p);
            }
            return out;
        };
        // 验收方 C-4c 后扩清单（按 F1 标题自带的指示："C-4c 接调用方后改白名单"）。
        // F-2a 扩 Gas.ts：火段的点火入口（ignite=exposeTileToFire 直燃、
        // igniteForced=DF_PLAIN_FIRE 生成）成为 DF 子系统的第一个火侧消费者
        // （任务书 §四提前授权的留痕到期翻转；越界守卫保留——白名单外仍全红）。
        const allowed = new Set([
            'engine/Map/DungeonFeature.ts',
            'engine/Map/DungeonFeatureCatalog.ts',
            'engine/Map/Promotion.ts',   // C-4c：promoteTile 经 spawnDungeonFeature 落地 DF
            'engine/Environment/Gas.ts', // F-2a：火段点火入口（exposeTileToFire/DF_PLAIN_FIRE spawn）
            'engine/Core/Game.ts',       // F-2c：bloat 死亡 DF（DF_BLOAT_EXPLOSION）
                                         // 经 catalogFeature+spawnDungeonFeature 铺设
                                         // + 落格瞬时爆炸伤害（MA_DF_ON_DEATH，
                                         // Combat.c:1965-1967 的 web 等价）
            'engine/Map/AutoGenerator.ts', // C-6：runAutogenerators 表驱动
                                           // catalogFeature+spawnDungeonFeature
                                           //（CE Architect.c:1811-1814）
            'engine/Generator/BlueprintEngine.ts', // V-2b-2a：机器 feature 落位的
                                           // 阻断否决（CE Architect.c:1445-1452）
                                           // 引 createSpawnMap +
                                           // levelIsDisconnectedWithBlockingMap。
                                           // **本条即本用例头注预告的「C-4d 接线
                                           // 机器时再扩清单」** —— 留痕前提
                                           //（DF 子系统是纯库、无机器侧生产读者）
                                           // 自本轮起为假，故扩清单而非删断言。
                                           // V-2b-9b 又在同一已授权文件激活
                                           // fillVestibuleInterior 的 BP_TREAT/
                                           // REQUIRE 复核；无需放宽到第二个文件。
        ]);
        const pattern = /spawnDungeonFeature|spawnMapDF|fillSpawnMap|levelIsDisconnectedWithBlockingMap|catalogFeature|createSpawnMap|DUNGEON_FEATURE_CATALOG|DF_MISSING_TILES/;
        // T-1（AI-1 登记）：原实现只剥 `//` 行注释，写在 /* */ 块注释里的
        // DF 符号字样会被误判为生产读者（AI-1 写新注释时实际踩到，被迫改写
        // 措辞绕开）。改为整文件小型状态机：
        //   - 行/块注释 → 等长空白（保留换行，行号稳定）；
        //   - '' / "" / `` 字符串（含 \ 转义）原样保留——字符串里的 `/*`、
        //     `//` 不被误当注释开头（否则会吞掉后续真实代码、制造假阴），
        //     字符串里的 pattern 字样仍参与匹配（沿用旧口径：注释豁免、
        //     字符串不豁免）。
        const stripComments = (src: string): string => {
            let out = '';
            let i = 0;
            let mode: 'code' | 'line' | 'block' | 'squote' | 'dquote' | 'template' = 'code';
            while (i < src.length) {
                const c = src[i]!;
                const d = src[i + 1] ?? '';
                if (mode === 'code') {
                    if (c === '/' && d === '/') { mode = 'line'; out += '  '; i += 2; continue; }
                    if (c === '/' && d === '*') { mode = 'block'; out += '  '; i += 2; continue; }
                    if (c === "'") { mode = 'squote'; out += c; i++; continue; }
                    if (c === '"') { mode = 'dquote'; out += c; i++; continue; }
                    if (c === '`') { mode = 'template'; out += c; i++; continue; }
                    out += c; i++; continue;
                }
                if (mode === 'line') {
                    if (c === '\n') { mode = 'code'; out += c; } else { out += ' '; }
                    i++; continue;
                }
                if (mode === 'block') {
                    if (c === '*' && d === '/') { mode = 'code'; out += '  '; i += 2; continue; }
                    out += c === '\n' ? '\n' : ' ';
                    i++; continue;
                }
                // 字符串态：转义对原样跳过；闭引号回 code 态。
                if (c === '\\') { out += c + d; i += 2; continue; }
                const quote = mode === 'squote' ? "'" : mode === 'dquote' ? '"' : '`';
                if (c === quote) mode = 'code';
                out += c; i++;
            }
            return out;
        };
        const offenders: string[] = [];
        for (const f of collect(srcDir).filter((p) => !p.split(sep).includes('test'))) {
            const rel = relative(srcDir, f).split(sep).join('/');
            if (allowed.has(rel)) continue;
            stripComments(readFileSync(f, 'utf8')).split('\n').forEach((line, i) => {
                if (pattern.test(line)) {
                    offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
                }
            });
        }
        expect(offenders, `DF 子系统被生产代码引用（本轮是纯库）：\n${offenders.join('\n')}`).toEqual([]);

        // T-1 D 组断言（AI-1 登记的误报场景）：扫描器行为本身的合成探针——
        //   行 1 块注释里的 DF 符号必须被豁免（旧实现误判为生产读者）；
        //   行 3 字符串里的 DF 符号仍按生产读者计（旧口径：字符串不豁免）；
        //   行 3 字符串里的 `/*` 不得被当成注释开头吞掉行 4（假阴形态）。
        const probe = [
            'const a = 1;',
            '/* engine/Map/DungeonFeatureCatalog.ts spawnDungeonFeature 示意 */',
            '// DUNGEON_FEATURE_CATALOG（行注释，维持豁免）',
            'const s = "not a comment /* DUNGEON_FEATURE_CATALOG";',
            'const d = 2;',
        ].join('\n');
        const probeLines = stripComments(probe).split('\n');
        expect(pattern.test(probeLines[0]!), '探针 0：普通代码无符号 → 不匹配').toBe(false);
        expect(pattern.test(probeLines[1]!), '块注释里的 DF 符号字样必须被豁免（T-1 修复点）').toBe(false);
        expect(pattern.test(probeLines[2]!), '行注释维持豁免').toBe(false);
        expect(pattern.test(probeLines[3]!), '字符串里的 DF 符号仍按生产读者计（旧口径不变）').toBe(true);
        expect(pattern.test(probeLines[4]!), '字符串里的 /* 不得吞掉后续代码（假阴守卫）').toBe(false);
    });

    // 验收方 C-4c 后翻转（原断言："promoteTile 本体不存在"）。
    // C-4c 已按设计实现它，这条留痕到期——这是留痕机制按设计工作的又一例：
    // 断言标题自己写明了"C-4c 实现"，验收时无需重新判断这条红是回归还是预期。
    const PROMOTE_TILE_DEFINERS = new Set(['engine/Map/Promotion.ts']);
    it('F2 留痕：promoteTile 只在白名单文件出现（C-4d 接线机器分支时复核此清单）', () => {
        const srcDir = fileURLToPath(new URL('../', import.meta.url));
        const offenders: string[] = [];
        const collect = (dir: string, out: string[] = []): string[] => {
            for (const name of readdirSync(dir)) {
                const p = join(dir, name);
                if (statSync(p).isDirectory()) collect(p, out);
                else if (/\.(ts|tsx|vue)$/.test(name)) out.push(p);
            }
            return out;
        };
        // 只匹配"函数定义/调用"形态——既有文件的文档注释里合法提到
        // promoteTile 这个词（LakeSystem/LoopMap/TerrainCatalog 的 C-4c 指引），
        // 那些不是代码引用。
        for (const f of collect(srcDir).filter((p) => !p.split(sep).includes('test'))) {
            const rel = relative(srcDir, f).split(sep).join('/');
            if (PROMOTE_TILE_DEFINERS.has(rel)) continue;
            readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
                if (/\bpromoteTile\s*\(/.test(line.replace(/\/\/.*$/, ''))) {
                    offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
                }
            });
        }
        expect(offenders, `promoteTile 出现在白名单之外的生产文件：\n${offenders.join('\n')}`).toEqual([]);
    });

    it('F3 留痕（C-6 已到期翻转）：生产生成的多层格仅限 CE 核实组合 + GAS 恒空', () => {
        // 原断言（C-4b）："生产生成路径每格至多一层非空"（前提：DF 库未接入
        // 生产生成）。C-6 把 runAutogenerators 接进 generateTerrain：DF_GRASS/
        // DF_FOLIAGE 经 fillSpawnMap 的 setTerrainLayer 落 SURFACE 层、
        // DUNGEON 保持 FLOOR（CE 语义：草长在地板上，两层数据并存）——
        // "至多一层"前提到期。翻转后守卫保留且更细：
        //   ① 单层格：任意一层非空、其余全空（现状形态不变）；
        //   ② 两层格：只允许 DUNGEON=FLOOR + SURFACE∈(GRASS,FOLIAGE)——
        //      出现任何其他多层组合（如生成期写 GAS、桥/火在生成期叠层）
        //      仍在本断言翻红；
        //   ③ GAS 层恒空不变（生成链无 GAS 写入点；气体是回合期现象）。
        // V-2b-9e-1：区域路由移动生成流，逐格追踪并回 CE 核实的新组合。
        // 按 [DUNGEON, LIQUID, GAS, SURFACE] 完整匹配，不扩成地形笛卡尔积。
        const verified9eLayers: ReadonlyArray<readonly TerrainType[]> = [
            // 9e-2 exact write traces: CE64 DF_ASH (Globals.c:645), and
            // CE61 DF_SWAMP's MUD (Globals.c:903–905) preserves other layers.
            // 424242/D9 (55,20); 777/D9 (17,9)/(20,8)/(25,11)/(37,16)/(37,18).
            [C.FLOOR, C.NOTHING, C.NOTHING, C.ASH],
            [C.NOTHING, C.MUD, C.NOTHING, C.WEB],
            [C.DOOR, C.MUD, C.NOTHING, C.GRAY_FUNGUS],
            [C.NOTHING, C.MUD, C.NOTHING, C.GRASS],
            [C.TRAP_DOOR_HIDDEN, C.MUD, C.NOTHING, C.GRASS],
            [C.TRAP_DOOR_HIDDEN, C.MUD, C.NOTHING, C.NOTHING],
            // CE31 :379–380: liquid floor marker, then altar in DUNGEON;
            // trace 777/D9 (76,2) retains the pre-existing SURFACE grass.
            [C.ALTAR_SWITCH, C.FLOOR_FLOODABLE, C.NOTHING, C.GRASS],
            // CE60 Idyll 先草木、后水塘（GlobalsBrogue.c:566-569）；
            // DF_SHALLOW_WATER_POOL 只写 LIQUID，不清其他层（Globals.c:899）。
            // DF_GRASS 的 propagationTerrain=0 但带 BLOCKED_BY_OTHER_LAYERS
            // （:609）；浅水 prio55 < 草60，不能倒说成“在浅水上后铺草”。
            // BP_NO_INTERIOR_FLAG 使这类格 machineNumber=0 也合法。
            [C.FLOOR, C.WATER_SHALLOW, C.NOTHING, C.GRASS],
            [C.FLOOR, C.WATER_SHALLOW, C.NOTHING, C.FOLIAGE],
            [C.NOTHING, C.WATER_SHALLOW, C.NOTHING, C.GRASS],
            [C.FLOOR, C.WATER_SHALLOW, C.NOTHING, C.NOTHING],
            // CE58 血草茎按 SURFACE 纯层写入（GlobalsBrogue.c:559），
            // 后来的 CE60 浅水边缘保留它；实测 seed424242/D1 (31,10)。
            [C.FLOOR, C.NOTHING, C.NOTHING, C.BLOODFLOWER_STALK],
            [C.FLOOR, C.WATER_SHALLOW, C.NOTHING, C.BLOODFLOWER_STALK],
            // CE61：DF_SWAMP → MUD → WATER（Globals.c:903-905），三者
            // flags=0，只覆盖目标层；泥可后铺在草木下、门下，灰菌可与水并存。
            [C.FLOOR, C.MUD, C.NOTHING, C.GRASS],
            [C.FLOOR, C.MUD, C.NOTHING, C.GRAY_FUNGUS],
            [C.FLOOR, C.WATER_SHALLOW, C.NOTHING, C.GRAY_FUNGUS],
            [C.NOTHING, C.MUD, C.NOTHING, C.FOLIAGE],
            [C.FLOOR, C.MUD, C.NOTHING, C.NOTHING],
            [C.DOOR, C.MUD, C.NOTHING, C.NOTHING],
            // Goblin warren：MUD_FLOOR 后接 DF_HAY（GlobalsBrogue.c:266/273）；
            // HAY 在 web 由 GRASS 承载（DungeonFeatureCatalog），只写 SURFACE。
            [C.MUD_FLOOR, C.NOTHING, C.NOTHING, C.GRASS],
            // CE34：FLOOR_FLOODABLE 明确写 DUNGEON（GlobalsBrogue.c:396），
            // 保留既有草/网；坍塌边缘 DF 写 LIQUID（Globals.c:837）。
            [C.FLOOR_FLOODABLE, C.NOTHING, C.NOTHING, C.GRASS],
            [C.FLOOR_FLOODABLE, C.NOTHING, C.NOTHING, C.WEB],
            [C.FLOOR_FLOODABLE, C.MACHINE_COLLAPSE_EDGE_DORMANT, C.NOTHING, C.NOTHING],
            [C.FLOOR_FLOODABLE, C.MACHINE_COLLAPSE_EDGE_DORMANT, C.NOTHING, C.GRASS],
        ];
        for (const seed of [424242, 777]) {
            const g: any = createHeadlessGame(seed);
            for (const depth of [1, 9]) {
                if (depth > 1) { g.depth = depth; g.generateDepth(false, false); }
                for (let x = 0; x < g.grid.width; x++) {
                    for (let y = 0; y < g.grid.height; y++) {
                        const cell = g.grid.getCell(x, y)!;
                        const nonEmpty: number[] = [];
                        for (let l = 0; l < L.COUNT; l++) {
                            if (cell.layers[l] !== C.NOTHING) nonEmpty.push(l);
                        }
                        expect(nonEmpty.length, `seed=${seed} D${depth} (${x},${y}) 至多三层（仅 CE 核实组合）`).toBeLessThanOrEqual(3);
                        const verified9e = verified9eLayers.some(
                            (layers) => layers.every((terrain, layer) => cell.layers[layer] === terrain)
                        );
                        if (verified9e) {
                            // CE58/34/Goblin warren 没有 NO_INTERIOR_FLAG，保留机器归属守卫。
                            if (cell.layers[L.SURFACE] === C.BLOODFLOWER_STALK
                                || [C.MUD_FLOOR, C.FLOOR_FLOODABLE, C.ALTAR_SWITCH].includes(cell.layers[L.DUNGEON] as TerrainType)) {
                                expect(cell.machineNumber).toBeGreaterThan(0);
                            }
                        } else if (nonEmpty.length === 3 && cell.layers[L.DUNGEON] === C.FLAMETHROWER_HIDDEN) {
                            // CE32 GlobalsBrogue.c:387-389：陷阱(DUNGEON)、
                            // 水塘浅水边缘(LIQUID)、DF_GRASS(SURFACE) 可同格。
                            // seed777/D9 的三格实测；逐字段全等，不放宽三层上限。
                            expect(cell.machineNumber).toBeGreaterThan(0);
                            expect(cell.layers).toEqual([C.FLAMETHROWER_HIDDEN, C.WATER_SHALLOW, C.NOTHING, C.GRASS]);
                        } else if (nonEmpty.length === 3) {
                            // 31 号在 FLOOR 上以 LIQUID 层铺 FLOOR_FLOODABLE，
                            // 其 FOLIAGE feature 又可在 SURFACE 层生长；
                            // 新确认的区域机器形态已由上面的逐字段白名单处理。
                            expect(cell.layers[L.DUNGEON]).toBe(C.FLOOR);
                            expect([
                                C.FLOOR_FLOODABLE,
                                C.MACHINE_FLOOD_WATER_DORMANT,
                                C.MACHINE_FLOOD_WATER_SPREADING,
                            ]).toContain(cell.layers[L.LIQUID]);
                            expect([C.GRASS, C.FOLIAGE]).toContain(cell.layers[L.SURFACE]);
                        }
                        if (nonEmpty.length === 2 && !verified9e) {
                            // V-2b-2b 扩（机器蓝图 3/4/5/19/20/23 号的 CE :1443
                            // 纯层写入——feature 地形写 feature.layer 列、不清其他
                            // 层，与格上既有内容叠加）：机器地形占 DUNGEON 的两层
                            // 形态加入白名单。出现清单之外的新组合时：先核对 CE
                            // 原表确属 :1443 字面行为，再在此补行并注明蓝图号。
                            const MACHINE_DUNGEON_TILES: ReadonlySet<TerrainType> = new Set([
                                C.CARPET,               // 3/4/5 号地毯
                                C.DOOR, C.SECRET_DOOR,  // 23 号门型替代组
                                C.TRAP_DOOR_HIDDEN,     // 23 号陷阱
                                // V-2b-9e-2: CE67/68 :603–609 explicitly write
                                // DUNGEON after vegetation, without clearing SURFACE.
                                C.GAS_TRAP_PARALYSIS, C.GAS_TRAP_PARALYSIS_HIDDEN,
                                C.MACHINE_PARALYSIS_VENT_HIDDEN,
                                C.WOODEN_BARRICADE,     // 19 号木栅
                                C.STATUE_INERT, C.STATUE_INERT_DOORWAY, C.PEDESTAL,
                                // V-2b-7：55 号 Worm tunnels 的 GRANITE 填充
                                //（GlobalsBrogue.c:367 `{0, GRANITE, DUNGEON,
                                // {150,150}, 1, … MF_REPEAT_UNTIL_NO_PROGRESS}`）
                                // 与它的伴侣 DF_WORM_TUNNEL_MARKER_DORMANT
                                //（LIQUID 层）构成 DUNGEON+Liquid 两层形态。
                                C.GRANITE,
                                C.MACHINE_GLYPH,        // 24/25 号机器符文（V-2b-5
                                                        // 实测首现于草上：seed424242
                                                        // /D9 (8,8) 符文压草）
                                // V-2b-5：休眠唤醒轮的 DUNGEON 层载体
                                //（21 号 STATUE_DORMANT_DOORWAY / 29 号
                                // RAT_TRAP_WALL_DORMANT / 43 号 STATUE_DORMANT /
                                // 50 号 WALL_MONSTER_DORMANT / 56 号
                                // TURRET_DORMANT / 41 号 DOOR+FLOOR / 69 号
                                // STATUE_DORMANT / 70 号 WALL_MONSTER_DORMANT）
                                C.ALTAR_SWITCH, C.MACHINE_TRIGGER_FLOOR,
                                C.STATUE_DORMANT, C.STATUE_DORMANT_DOORWAY,
                                C.WALL_MONSTER_DORMANT, C.RAT_TRAP_WALL_DORMANT,
                                C.TURRET_DORMANT,
                                // V-2b-7：DF 特征系统轮的 10 条 DUNGEON 层机器
                                // 载体（11/12/30/42/47/53 号蓝图 feature 的
                                // terrain 列 + layer=DUNGEON）。它们与既有一行
                                // 同源——CE Architect.c:1443 的纯层写入，无优先级
                                // 门，可与 autoGenerator/MF_EVERYWHERE 的 SURFACE
                                // 装饰（血/骨/枯草）叠层。实测首现：424242/D9
                                // (11,26) = DUNGEON SACRIFICE_CAGE_DORMANT +
                                // SURFACE BONES（47 号献祭房）。
                                C.COFFIN_CLOSED, C.ALTAR_KEYHOLE,
                                C.ALTAR_SWITCH_RETRACTING, C.BRAZIER,
                                C.DEMONIC_STATUE, C.FLAMETHROWER_HIDDEN,
                                C.GAS_TRAP_POISON_HIDDEN, C.PORTAL,
                                C.SACRIFICE_ALTAR_DORMANT, C.SACRIFICE_CAGE_DORMANT,
                            ]);
                            const NON_BLOCKING_LIQUIDS: ReadonlySet<TerrainType> = new Set([
                                C.WATER_SHALLOW, C.CHASM_EDGE, C.OBSIDIAN,
                                // V-2b-7：55 号的蠕虫隧道标记（零旗标可走，
                                // CE Globals.c:568 的 LIQUID 层不可见标记）。
                                C.WORM_TUNNEL_MARKER_DORMANT,
                                C.FLOOR_FLOODABLE,
                                C.MACHINE_CHASM_EDGE,
                                C.MACHINE_FLOOD_WATER_DORMANT,
                                C.MACHINE_FLOOD_WATER_SPREADING,
                                C.MACHINE_COLLAPSE_EDGE_DORMANT,
                                C.MACHINE_COLLAPSE_EDGE_SPREADING,
                                C.CHASM_WITH_HIDDEN_BRIDGE,
                                C.CHASM_WITH_HIDDEN_BRIDGE_ACTIVE,
                                C.STONE_BRIDGE,
                                C.LAVA_RETRACTABLE,
                                C.LAVA_RETRACTING,
                            ]);
                            // V-2b-5 扩：机器 feature 带 layer=DUNGEON 列的落格
                            // 走 CE :1443 `pmap.layers[layer] = terrain`
                            // **纯层写入**——无优先级门、不清 autoGenerator 已落
                            // 的草/树（autoGenerator 先于机器建层）。DUNGEON 是
                            // 任何机器载体（上表）时，与 SURFACE 草/树的两层
                            // 组合合法。其余组合仍按 fillSpawnMap 优先级门把关。
                            if (cell.layers[L.SURFACE] !== C.NOTHING) {
                                // ★ V-2b-7 扩：SURFACE 层的合法成员从"C-6 自动
                                // 生成器的草/树"扩到"机器 feature/DF 写在
                                // SURFACE 列的装饰"——CE Architect.c:1443
                                // `pmap.layers[layer] = terrain` 与 DF 的 layer 列
                                // 都是纯层写入，SURFACE 层因此可承载血/骨/枯草/
                                // 呕吐物/发光菌/碎石/镣铐。V-2b-6 的 Kennel
                                //（DF_AMBIENT_BLOOD/DF_BONES）早就有这个形态，
                                // 只是当时抽到的层恰好没有；非机器来源的
                                // SURFACE 仍在下方的优先级门里逐格把关。
                                const MACHINE_SURFACE_TILES: ReadonlySet<TerrainType> = new Set([
                                    C.GRASS, C.FOLIAGE,          // C-6 自动生成器
                                    C.WEB,                       // key_web_room（37 号）的 SURFACE feature
                                    C.BLOOD, C.BONES,            // V-2b-6 Kennel 血/骨
                                    C.DEAD_GRASS, C.VOMIT,       // V-2b-7：9/42 号
                                    C.LUMINESCENT_FUNGUS,        // 12/33/57 号
                                    C.DEAD_FOLIAGE, C.RUBBLE,    // 42/55 号
                                    C.GRAY_FUNGUS,               // 30 号 DF_SWAMP
                                    C.MANACLE_L, C.MANACLE_T,    // 9 号镣铐
                                ]);
                                // 其中**由 DF 层写入**（spawnDungeonFeature →
                                // fillSpawnMap，不与 DUNGEON 层比优先级）的成员。
                                // GRASS/FOLIAGE 不在内——它们同时是 C-6 自动生成器
                                // 的产物，走旧口径（优先级门）继续把关。
                                const DF_SURFACE_DECOR: ReadonlySet<TerrainType> = new Set([
                                    C.BLOOD, C.BONES, C.DEAD_GRASS, C.VOMIT,
                                    C.LUMINESCENT_FUNGUS, C.DEAD_FOLIAGE,
                                    C.RUBBLE, C.GRAY_FUNGUS,
                                    C.MANACLE_L, C.MANACLE_T,
                                ]);
                                expect(MACHINE_SURFACE_TILES,
                                    `seed=${seed} D${depth} (${x},${y}) 两层格的 SURFACE 属未知来源`).toContain(cell.layers[L.SURFACE]);
                                if (MACHINE_DUNGEON_TILES.has(cell.layers[L.DUNGEON] as TerrainType)) {
                                    // 合法（:1443 纯层写入，无优先级门）。
                                } else if (cell.machineNumber > 0
                                    && cell.layers[L.DUNGEON] === C.NOTHING
                                    && cell.layers[L.LIQUID] === C.WATER_SHALLOW
                                    && cell.layers[L.SURFACE] === C.GRASS) {
                                    // 既有 CE32 样本 seed777/D9 (73,17) 的精确组合。
                                    // 旧注“DF_GRASS 不带 BLOCKED_BY_OTHER_LAYERS”有误：
                                    // 浅水后铺可保留既有草，同格不能反推草能后铺于浅水。
                                    expect(cell.layers).toEqual([C.NOTHING, C.WATER_SHALLOW, C.NOTHING, C.GRASS]);
                                } else if (DF_SURFACE_DECOR.has(cell.layers[L.SURFACE] as TerrainType)) {
                                    // ★ V-2b-7 新增合法形态：**DF 写的 SURFACE
                                    // 装饰压在任意地基上**。CE 的
                                    // spawnDungeonFeature → fillSpawnMap 写
                                    // SURFACE 层时，只判"本层旧 drawPriority >=
                                    // 新"与 `!(旧最高优先级层带
                                    // T_OBSTRUCTS_SURFACE_EFFECTS)`（Architect.c:
                                    // 3228/3230），**不与 DUNGEON 层比优先级**；
                                    // 故血/骨/枯草/碎石落在陷阱、机器门等
                                    // DUNGEON 载体上是 CE 字面行为。
                                    // 实测首现：424242/D9 (26,6) =
                                    // DUNGEON TRAP + SURFACE BLOOD
                                    //（DF_AMBIENT_BLOOD 落在陷阱格上）。
                                    // 防线未松：喂不进墙族——WALL/GRANITE 带
                                    // T_OBSTRUCTS_SURFACE_EFFECTS，:3230 那一关
                                    // 就挡住了（本文件 G 组的 DF 单测另钉）。
                                } else {
                                // 基座按 CE fillSpawnMap 优先级门（Architect.c:3228
                                // `旧 prio >= 新 prio`）判定合法形态：
                                //   DUNGEON=FLOOR（草/树长在地板上，主形态）；
                                //   DUNGEON=CARPET（V-2b-2b：3 号菌林长在地毯上，
                                //     CE :1443 纯层写入、地毯在 DUNGEON 保留）；
                                //   LIQUID=WATER_SHALLOW（仅 FOLIAGE 45 盖浅水 55；
                                //     GRASS 60 > 55 被挡）、CHASM_EDGE（渊缘草）、
                                //     OBSIDIAN（硫矿镶边上的树，深层才可能出现）。
                                const baseOk: Array<[number, TerrainType]> = [
                                    [L.DUNGEON, C.FLOOR],
                                    [L.DUNGEON, C.CARPET],
                                    [L.LIQUID, C.WATER_SHALLOW],
                                    [L.LIQUID, C.CHASM_EDGE],
                                    [L.LIQUID, C.OBSIDIAN],
                                    [L.LIQUID, C.FLOOR_FLOODABLE],
                                    [L.LIQUID, C.MACHINE_FLOOD_WATER_DORMANT],
                                    [L.LIQUID, C.MACHINE_FLOOD_WATER_SPREADING],
                                ];
                                const surf = cell.layers[L.SURFACE] as TerrainType;
                                const ok = baseOk.some(([l, t]) =>
                                    cell.layers[l] === t
                                    && DRAW_PRIORITY[t] >= DRAW_PRIORITY[surf]);
                                // V-2b-7：失败信息带上**地形名**（原先只有层号，
                                // 排查"哪个 tile 与哪个 tile 叠了"要跑调试脚本）。
                                const layerNames = nonEmpty.slice().sort()
                                    .map((l) => `${l}:${(cell.layers as TerrainType[])[l]}`).join(' ');
                                expect(ok,
                                    `seed=${seed} D${depth} (${x},${y}) 两层组合 ` +
                                    layerNames + ` 不满足 CE 优先级门`).toBe(true);
                                }
                            } else if (cell.layers[L.DUNGEON] !== C.NOTHING
                                && MACHINE_DUNGEON_TILES.has(cell.layers[L.DUNGEON] as TerrainType)
                                && NON_BLOCKING_LIQUIDS.has(cell.layers[L.LIQUID] as TerrainType)) {
                                // 机器地形 + 非阻断液体的叠层（如 23 号陷阱写在
                                // 浅水层格上）——CE :1443 字面行为，合法。
                            } else if (cell.layers[L.DUNGEON] === C.FLOOR
                                && [C.FLOOR_FLOODABLE, C.MACHINE_FLOOD_WATER_DORMANT,
                                    C.MACHINE_FLOOD_WATER_SPREADING]
                                    .includes(cell.layers[L.LIQUID] as TerrainType)) {
                                // 31 号 Flood room 的 EVERYWHERE 特征按 CE 原表写在
                                // LIQUID 层：普通 FLOOR 上叠 FLOOR_FLOODABLE，取钥匙后
                                // 再由涨水 DF 改写该层。因此 0:2 + 1:103 是合法形态。
                            } else if (cell.layers[L.DUNGEON] === C.FLOOR
                                && cell.layers[L.LIQUID] === C.WATER_DEEP) {
                                // 深水是 LIQUID 层覆层，底下保留 FLOOR；本轮
                                // RNG 移动后 seed777/D9 首次进入该既有合法形态。
                            } else if (cell.layers[L.DUNGEON] === C.FLOOR
                                && cell.machineNumber > 0 && cell.layers[L.LIQUID] === C.WATER_SHALLOW) {
                                // CE32 DF_DEEP_WATER_POOL -> DF_SHALLOW_WATER_POOL
                                // (:900/:899)；seed777/D9 (70,26), machine #7。
                            } else if (cell.layers[L.DUNGEON] === C.FLOOR
                                && cell.machineNumber > 0
                                && [C.CHASM, C.CHASM_WITH_HIDDEN_BRIDGE, C.MACHINE_CHASM_EDGE]
                                    .includes(cell.layers[L.LIQUID] as TerrainType)) {
                                // V-2b-9c 流移后 seed424242/D9 machine #7 = CE36。
                                // GlobalsBrogue.c:410-411 的 CHASM / HIDDEN_BRIDGE
                                // 纯 LIQUID 写入 + DF_ADD_DORMANT_CHASM_HALO (:843)
                                // 均保留 DUNGEON=FLOOR。只新增这三种确证组合。
                            } else {
                                expect.unreachable(
                                    `seed=${seed} D${depth} (${x},${y}) 两层组合 ` +
                                    nonEmpty.slice().sort().map((l) => `${l}:${(cell.layers as TerrainType[])[l]}`).join(' ') +
                                    ` 不属于任何已知合法形态`);
                            }
                        }
                        expect(cell.layers[L.GAS], `seed=${seed} D${depth} (${x},${y}) GAS 恒空`).toBe(C.NOTHING);
                    }
                }
            }
        }
    });
});
