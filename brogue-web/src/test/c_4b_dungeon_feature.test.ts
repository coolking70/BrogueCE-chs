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
import { DungeonLayer, Grid, TerrainType } from '../engine/Map/Grid';
import { TERRAIN_FLAGS } from '../engine/Map/TerrainCatalog';
import {
    DF,
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
    it('E1 恰 20 条（F-2a 增补 DF_ASH），且 DF 枚举 id 与 CE 枚举逐一对位（Rogue.h:1469 起）', () => {
        const keys = Object.keys(DUNGEON_FEATURE_CATALOG);
        expect(keys.length).toBe(20);
        expect(DF.DF_SHOW_DOOR).toBe(13);
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
        expect(DF.DF_BRIMSTONE_FIRE).toBe(104);
        expect(DF.DF_BRIDGE_FIRE).toBe(105);
        expect(DF.DF_EMBERS).toBe(107);
        expect(DF.DF_OBSIDIAN).toBe(109);
        expect(DF.DF_POISON_GAS_CLOUD).toBe(125);
        expect(DF.DF_MACHINE_PRESSURE_PLATE_USED).toBe(154);
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
        expect(catalogKeys.size, 'F-2a：EMBERS.promoteType=DF_ASH 入闭包，19 → 20').toBe(20);
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
    });

    it('E4 缺 tile 登记恰 9 条（F-2a 翻正 DF_PLAIN_FIRE/DF_EMBERS 后 11 → 9）：' +
        'catalogFeature 对其抛错点名；对其余 11 条正常转换', () => {
        const all = Object.keys(DUNGEON_FEATURE_CATALOG).map(Number) as DF[];
        const missing = new Set(DF_MISSING_TILES);
        expect(DF_MISSING_TILES.length).toBe(9);
        // 登记条目确实都是 tile=null，且抛错带 CE tile 名。
        for (const id of DF_MISSING_TILES) {
            expect(DUNGEON_FEATURE_CATALOG[id]!.tile, `DF#${id} 应为 null tile`).toBeNull();
            expect(() => catalogFeature(id), `DF#${id} 应拒绝`).toThrow(/tileType/);
            expect(() => catalogFeature(id)).toThrow(new RegExp(DUNGEON_FEATURE_CATALOG[id]!.ceTile));
        }
        // 其余 11 条（9 有 tile + 2 tileless）转换成功且字段保真。
        // F-2a 翻正位：DF_PLAIN_FIRE.tile=PLAIN_FIRE、DF_EMBERS.tile=EMBERS、
        // 新增 DF_ASH.tile=ASH——三者现在必须能正常转换（放回 missing 会红）。
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
        // tileless 两条件名字单（防有人把"登记"与"tile=0"混掉）。
        expect(catalogFeature(DF.DF_REPEL_CREATURES).tile).toBe(C.NOTHING);
        expect(catalogFeature(DF.DF_BRIDGE_FIRE).tile).toBe(C.NOTHING);
    });

    it('E5 目录条目不影响未登记 id：未抄录 id 的查询得到 undefined（219 枚举只抄 19 条）', () => {
        expect(DUNGEON_FEATURE_CATALOG[1 as DF]).toBeUndefined();   // DF_GRANITE_COLUMN
        expect(DUNGEON_FEATURE_CATALOG[218 as DF]).toBeUndefined(); // DF_STENCH_SMOLDER
        expect(() => catalogFeature(218 as DF)).toThrow(/未抄录/);
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
        ]);
        const pattern = /spawnDungeonFeature|spawnMapDF|fillSpawnMap|levelIsDisconnectedWithBlockingMap|catalogFeature|createSpawnMap|DUNGEON_FEATURE_CATALOG|DF_MISSING_TILES/;
        const offenders: string[] = [];
        for (const f of collect(srcDir).filter((p) => !p.split(sep).includes('test'))) {
            const rel = relative(srcDir, f).split(sep).join('/');
            if (allowed.has(rel)) continue;
            readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
                if (pattern.test(line.replace(/\/\/.*$/, ''))) {
                    offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
                }
            });
        }
        expect(offenders, `DF 子系统被生产代码引用（本轮是纯库）：\n${offenders.join('\n')}`).toEqual([]);
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

    it('F3 留痕：生产生成路径"每格至多一层非空"+ GAS 恒空未破（本轮库未接入生产）', () => {
        for (const seed of [424242, 777]) {
            const g: any = createHeadlessGame(seed);
            for (const depth of [1, 9]) {
                if (depth > 1) { g.depth = depth; g.generateDepth(false, false); }
                for (let x = 0; x < g.grid.width; x++) {
                    for (let y = 0; y < g.grid.height; y++) {
                        const cell = g.grid.getCell(x, y)!;
                        let nonEmpty = 0;
                        for (let l = 0; l < L.COUNT; l++) {
                            if (cell.layers[l] !== C.NOTHING) nonEmpty++;
                        }
                        expect(nonEmpty, `seed=${seed} D${depth} (${x},${y}) 每格至多一层非空`).toBeLessThanOrEqual(1);
                        expect(cell.layers[L.GAS], `seed=${seed} D${depth} (${x},${y}) GAS 恒空`).toBe(C.NOTHING);
                    }
                }
            }
        }
    });
});
