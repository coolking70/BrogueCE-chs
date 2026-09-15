/**
 * src/test/c_4a_0_layer_model.test.ts — C-4a-0：四层地形模型的验收与留痕。
 *
 * 结构迁移判据：行为逐位不变（generation_baseline 保持绿），本文件负责
 * 结构本身的每一处可错点：
 *   - highestPriorityLayer 的比较方向 / 同级平局方向（CE Movement.c:64-80）；
 *   - setTerrain 的清层语义与跨层清除干跑计数；
 *   - 归属层表与 drawPriority 表（CE Globals.c tileCatalog / DF 目录）；
 *   - 存档新格式（layers）往返 + 旧格式（仅 terrain）向后兼容；
 *   - 同种子确定性在层粒度上成立（完整重走 D1→D26 链条对比，见用例内说明）；
 *   - 留痕：GAS 层恒空 / setTerrainLayer 生产零调用点 / 未引入地形属性表；
 *   - 干跑测量：15 种子 × D1-D26 的 (层, 旧地形 → 新地形) 事件表（C-4a 的输入）。
 *
 * 确定性口径说明（实测钉死的事实，2026-09-16）：web 的 rng 是全局单例，
 * startNewGame 会重播种（D1 恒可复现），但 generateDepth 沿用当前流且
 * web 没有 CE 的 per-level levelSeed 设施——因此"同种子"的可复现单元是
 * "从 startNewGame 起的完整生成链"，不是任意中间层的跳读。生成基线
 * （generation_baseline）与下面的确定性用例都按完整链口径比对。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    TerrainType, DungeonLayer, Cell, Grid,
    DRAW_PRIORITY, TERRAIN_HOME_LAYER,
    highestPriorityLayerOf,
    getCrossLayerClearStats, resetCrossLayerClearStats,
} from '../engine/Map/Grid';
import { createHeadlessGame } from './harness';

const C = TerrainType;
const L = DungeonLayer;

/** 既有扫盲用的 15 种子清单（与 c_2_lakes_e2e / p1_29 / p1_33 同一口径）。 */
const SWEEP_SEEDS = [424242, 777, 20260913, 31337, 20260916, 1, 42, 999, 20260915, 55555, 2, 3, 5, 7, 11];

function collectFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) collectFiles(p, out);
        else if (/\.(ts|tsx|vue)$/.test(name)) out.push(p);
    }
    return out;
}

/** 捕获一整层四层矩阵的快照（确定性对比用）。 */
function snapshotLayers(grid: Grid): TerrainType[][] {
    const out: TerrainType[][] = [];
    for (let x = 0; x < grid.width; x++) {
        for (let y = 0; y < grid.height; y++) {
            out.push([...grid.getCell(x, y)!.layers]);
        }
    }
    return out;
}

describe('C-4a-0 层枚举与表完备性', () => {
    it('DungeonLayer 数值序逐值对齐 CE Rogue.h:1293-1300（GAS 在 SURFACE 之前）', () => {
        // 错误实现示例：直觉序 DUNGEON/LIQUID/SURFACE/GAS → 本测试翻红。
        expect(L.DUNGEON).toBe(0);
        expect(L.LIQUID).toBe(1);
        expect(L.GAS).toBe(2);
        expect(L.SURFACE).toBe(3);
        expect(L.COUNT).toBe(4);
    });

    it('每个 TerrainType 成员都有归属层与 drawPriority（esbuild 不查类型，运行时钉死）', () => {
        // Record<TerrainType,…> 只是编译期约束；npm test 走 esbuild 只剥类型，
        // 新增枚举成员忘补表时必须在这里红。
        const names = Object.keys(TerrainType).filter((k) => Number.isNaN(Number(k)));
        expect(names.length).toBeGreaterThanOrEqual(31);
        for (const name of names) {
            const t = (TerrainType as unknown as Record<string, TerrainType>)[name]!;
            expect(DRAW_PRIORITY, `DRAW_PRIORITY 缺 ${name}`).toHaveProperty(String(t));
            expect(TERRAIN_HOME_LAYER, `TERRAIN_HOME_LAYER 缺 ${name}`).toHaveProperty(String(t));
        }
    });

    it('Cell.layers 长度为 4，新格四层全 NOTHING', () => {
        const cell = new Cell(3, 4);
        expect(cell.layers).toHaveLength(4);
        for (let l = 0; l < L.COUNT; l++) {
            expect(cell.layers[l]).toBe(C.NOTHING);
        }
        expect(cell.terrain).toBe(C.NOTHING); // 全空 → NOTHING（CE best=0 → layers[0]=NOTHING）
    });
});

describe('C-4a-0 highestPriorityLayer 语义（CE Movement.c:64-80）', () => {
    function gridWith(layersAt: Array<{ layer: DungeonLayer; t: TerrainType }>): { g: Grid; cell: Cell } {
        const g = new Grid(4, 4);
        for (const { layer, t } of layersAt) g.setTerrainLayer(1, 1, layer, t);
        return { g, cell: g.getCell(1, 1)! };
    }

    it('取 drawPriority 最小者：FLOOR(95) 之下的 GRASS(60) 胜出（比较方向写反即翻红）', () => {
        const { g, cell } = gridWith([
            { layer: L.DUNGEON, t: C.FLOOR },   // prio 95
            { layer: L.SURFACE, t: C.GRASS },   // prio 60
        ]);
        expect(highestPriorityLayerOf(cell.layers)).toBe(L.SURFACE);
        expect(g.highestPriorityLayer(1, 1)).toBe(L.SURFACE);
        expect(cell.terrain).toBe(C.GRASS);
    });

    it('同优先级先遇到的层胜出：DUNGEON 的 WALL 压过 LIQUID 的 GRANITE（< 写成 <= 即翻红）', () => {
        const { cell } = gridWith([
            { layer: L.DUNGEON, t: C.WALL },     // prio 0，层序在前
            { layer: L.LIQUID, t: C.GRANITE },   // prio 0，层序在后
        ]);
        expect(highestPriorityLayerOf(cell.layers)).toBe(L.DUNGEON);
        expect(cell.terrain).toBe(C.WALL);
    });

    it('skipGas 跳过 GAS 层（CE skipGas 形参逐位照搬）', () => {
        // GAS 里的 GRASS(60) 比 SURFACE 里的 BLOOD(80) 优先级更高：
        // 不跳过 → GAS 胜；跳过 → SURFACE 胜。
        const { g, cell } = gridWith([
            { layer: L.GAS, t: C.GRASS },
            { layer: L.SURFACE, t: C.BLOOD },
        ]);
        expect(g.highestPriorityLayer(1, 1, false)).toBe(L.GAS);
        expect(g.highestPriorityLayer(1, 1, true)).toBe(L.SURFACE);
        expect(cell.terrain).toBe(C.GRASS);
    });
});

describe('C-4a-0 setTerrain 清层语义与直接赋值', () => {
    it('setTerrain 覆盖后其余三层必须全空（漏清任一层 → getter 返回旧地形，翻红）', () => {
        const g = new Grid(4, 4);
        g.setTerrain(1, 1, C.GRASS);
        g.setTerrain(1, 1, C.FLOOR);
        const cell = g.getCell(1, 1)!;
        // 错误实现示例：只写归属层不清其余 → SURFACE 残留 GRASS(60) < FLOOR(95)，
        // getter 返回 GRASS → 本断言翻红。
        expect(cell.terrain).toBe(C.FLOOR);
        expect(cell.layers[L.DUNGEON]).toBe(C.FLOOR);
        for (const l of [L.LIQUID, L.GAS, L.SURFACE]) {
            expect(cell.layers[l], `层 ${l} 应被清空`).toBe(C.NOTHING);
        }
    });

    it('直接赋值 cell.terrain = t 与 setTerrain 的层语义一致（禁改文件的 8 个直写点靠它逐位不变）', () => {
        const cell = new Cell(0, 0);
        cell.terrain = C.BLOOD;
        expect(cell.layers[L.SURFACE]).toBe(C.BLOOD);
        for (const l of [L.DUNGEON, L.LIQUID, L.GAS]) {
            expect(cell.layers[l]).toBe(C.NOTHING);
        }
        expect(cell.terrain).toBe(C.BLOOD);
        cell.terrain = C.FLOOR;
        expect(cell.terrain).toBe(C.FLOOR);
        expect(cell.layers[L.SURFACE]).toBe(C.NOTHING); // 旧内容被清，不是残留
    });

    it('setTerrain 写 NOTHING：全层清空，getter 返回 NOTHING', () => {
        const g = new Grid(4, 4);
        g.setTerrain(2, 2, C.LAVA);
        g.setTerrain(2, 2, C.NOTHING);
        const cell = g.getCell(2, 2)!;
        for (let l = 0; l < L.COUNT; l++) expect(cell.layers[l]).toBe(C.NOTHING);
        expect(cell.terrain).toBe(C.NOTHING);
    });
});

describe('C-4a-0 归属层表（错误归属 → 具体后果翻红）', () => {
    /** 用"写入后落在哪一层"直接钉死归属表：归属写错 → 层位置断言翻红。 */
    function homeLayerViaSetTerrain(t: TerrainType): DungeonLayer {
        const g = new Grid(4, 4);
        g.setTerrain(1, 1, t);
        const cell = g.getCell(1, 1)!;
        const occupied: DungeonLayer[] = [];
        for (let l = 0; l < L.COUNT; l++) {
            if (cell.layers[l] !== C.NOTHING) occupied.push(l as DungeonLayer);
        }
        expect(occupied, `terrain ${t} 应恰好占据一层`).toHaveLength(1);
        expect(cell.layers[occupied[0]!]).toBe(t);
        return occupied[0]!;
    }

    it('液体必须落 LIQUID：把某个液体写进 SURFACE 的错误实现在这里翻红', () => {
        expect(homeLayerViaSetTerrain(C.WATER_DEEP)).toBe(L.LIQUID);
        expect(homeLayerViaSetTerrain(C.WATER_SHALLOW)).toBe(L.LIQUID);
        expect(homeLayerViaSetTerrain(C.LAVA)).toBe(L.LIQUID);
        expect(homeLayerViaSetTerrain(C.CHASM)).toBe(L.LIQUID);
        expect(homeLayerViaSetTerrain(C.MUD)).toBe(L.LIQUID);
        expect(homeLayerViaSetTerrain(C.BOG)).toBe(L.LIQUID);
        expect(homeLayerViaSetTerrain(C.INERT_BRIMSTONE)).toBe(L.LIQUID);
        // C-4a-0 勘察修正的两条：CE createWreath 把湖缘浅液写进 LIQUID
        // （Architect.c:2698；CHASM_EDGE 还有 DF 目录 {CHASM_EDGE, LIQUID,…}）。
        expect(homeLayerViaSetTerrain(C.CHASM_EDGE)).toBe(L.LIQUID);
        expect(homeLayerViaSetTerrain(C.OBSIDIAN)).toBe(L.LIQUID);
        expect(homeLayerViaSetTerrain(C.BRIDGE)).toBe(L.LIQUID);
    });

    it('表面地形必须落 SURFACE，结构地形必须落 DUNGEON', () => {
        for (const t of [C.GRASS, C.FOLIAGE, C.WEB, C.BLOOD, C.BRIDGE_EDGE]) {
            expect(homeLayerViaSetTerrain(t), `terrain ${t}`).toBe(L.SURFACE);
        }
        for (const t of [
            C.GRANITE, C.FLOOR, C.WALL, C.DOOR, C.OPEN_DOOR, C.SECRET_DOOR,
            C.LOCKED_DOOR, C.STAIRS_UP, C.STAIRS_DOWN, C.ALTAR, C.SIGN,
            C.RESET_PLATE, C.PRESSURE_PLATE, C.TRAP, C.CHARRED_FLOOR,
        ]) {
            expect(homeLayerViaSetTerrain(t), `terrain ${t}`).toBe(L.DUNGEON);
        }
    });

    it('归属表与 drawPriority 表与报告口径逐条一致（表被手滑改动即翻红）', () => {
        expect(TERRAIN_HOME_LAYER).toEqual({
            [C.NOTHING]: L.DUNGEON, [C.GRANITE]: L.DUNGEON, [C.FLOOR]: L.DUNGEON,
            [C.WALL]: L.DUNGEON, [C.DOOR]: L.DUNGEON, [C.OPEN_DOOR]: L.DUNGEON,
            [C.SECRET_DOOR]: L.DUNGEON, [C.LOCKED_DOOR]: L.DUNGEON,
            [C.STAIRS_UP]: L.DUNGEON, [C.STAIRS_DOWN]: L.DUNGEON, [C.ALTAR]: L.DUNGEON,
            [C.SIGN]: L.DUNGEON, [C.RESET_PLATE]: L.DUNGEON, [C.TRAP]: L.DUNGEON,
            [C.PRESSURE_PLATE]: L.DUNGEON, [C.CHARRED_FLOOR]: L.DUNGEON,
            [C.WATER_SHALLOW]: L.LIQUID, [C.WATER_DEEP]: L.LIQUID, [C.CHASM]: L.LIQUID,
            [C.LAVA]: L.LIQUID, [C.INERT_BRIMSTONE]: L.LIQUID, [C.BRIDGE]: L.LIQUID,
            [C.MUD]: L.LIQUID, [C.BOG]: L.LIQUID, [C.CHASM_EDGE]: L.LIQUID,
            [C.OBSIDIAN]: L.LIQUID,
            [C.GRASS]: L.SURFACE, [C.FOLIAGE]: L.SURFACE, [C.WEB]: L.SURFACE,
            [C.BLOOD]: L.SURFACE, [C.BRIDGE_EDGE]: L.SURFACE,
        });
        expect(DRAW_PRIORITY).toEqual({
            [C.NOTHING]: 100, [C.GRANITE]: 0, [C.FLOOR]: 95, [C.WALL]: 0,
            [C.DOOR]: 8, [C.OPEN_DOOR]: 25, [C.SECRET_DOOR]: 0, [C.LOCKED_DOOR]: 15,
            [C.STAIRS_UP]: 30, [C.STAIRS_DOWN]: 30, [C.ALTAR]: 17, [C.SIGN]: 7,
            [C.RESET_PLATE]: 15, [C.TRAP]: 30, [C.PRESSURE_PLATE]: 15,
            [C.CHARRED_FLOOR]: 95, [C.WATER_SHALLOW]: 55, [C.WATER_DEEP]: 40,
            [C.CHASM]: 40, [C.LAVA]: 40, [C.INERT_BRIMSTONE]: 40, [C.BRIDGE]: 45,
            [C.BRIDGE_EDGE]: 45, [C.MUD]: 55, [C.BOG]: 55, [C.CHASM_EDGE]: 80,
            [C.OBSIDIAN]: 50, [C.GRASS]: 60, [C.FOLIAGE]: 45, [C.WEB]: 19,
            [C.BLOOD]: 80,
        });
    });
});

describe('C-4a-0 跨层清除干跑计数', () => {
    it('跨层覆盖逐事件计数；同层覆盖不产生事件', () => {
        resetCrossLayerClearStats();
        const g = new Grid(4, 4);
        // SURFACE 的草被 DUNGEON 的地板清掉 → 记 (SURFACE, GRASS → FLOOR)。
        g.setTerrain(1, 1, C.GRASS);
        g.setTerrain(1, 1, C.FLOOR);
        let stats = getCrossLayerClearStats();
        expect(stats).toContainEqual({ layer: L.SURFACE, from: C.GRASS, to: C.FLOOR, count: 1 });
        // 同层覆盖（水→水，独占另一格）不记：C-4a 的分歧只可能来自跨层清除。
        g.setTerrain(2, 2, C.WATER_DEEP);
        g.setTerrain(2, 2, C.WATER_SHALLOW);
        stats = getCrossLayerClearStats();
        expect(stats.filter((s) => s.to === C.WATER_SHALLOW)).toEqual([]);
        expect(stats.filter((s) => s.to === C.WATER_DEEP)).toEqual([]);
        // 清空也计数：其余层的旧内容确实被清掉了。
        g.setTerrain(3, 3, C.BLOOD);
        g.setTerrain(3, 3, C.NOTHING);
        expect(getCrossLayerClearStats()).toContainEqual({ layer: L.SURFACE, from: C.BLOOD, to: C.NOTHING, count: 1 });
    });
});

describe('C-4a-0 存档', () => {
    it('新格式往返：四层逐层还原（含测试手造的多层格）', () => {
        const game = createHeadlessGame(424242);
        // 手造多层格（测试专用入口写入），证明快照保真到每一层，而不是只保真
        // 到 getter。两层都显式覆写，胜出者因此与该格的原始内容无关：
        // (10,10) FLOOR(95) + GRASS(60) → getter GRASS；(11,11) FLOOR(95) +
        // WATER_DEEP(40) → getter WATER_DEEP。
        game.grid.setTerrainLayer(10, 10, L.DUNGEON, C.FLOOR);
        game.grid.setTerrainLayer(10, 10, L.SURFACE, C.GRASS);
        game.grid.setTerrainLayer(11, 11, L.DUNGEON, C.FLOOR);
        game.grid.setTerrainLayer(11, 11, L.LIQUID, C.WATER_DEEP);
        const before = (x: number, y: number) => [...game.grid.getCell(x, y)!.layers];

        const snap = game.toSnapshot();
        const reloaded = createHeadlessGame(1);
        expect(reloaded.loadSnapshot(snap)).toBe(true);

        for (const [x, y] of [[10, 10], [11, 11], [12, 12]] as Array<[number, number]>) {
            expect(reloaded.grid.getCell(x, y)!.layers).toEqual(before(x, y));
            expect(reloaded.grid.getCell(x, y)!.terrain).toBe(game.grid.getCell(x, y)!.terrain);
        }
        expect(reloaded.grid.getCell(10, 10)!.terrain).toBe(C.GRASS); // 60 < 95，草在地板上
        expect(reloaded.grid.getCell(11, 11)!.terrain).toBe(C.WATER_DEEP);
    });

    it('旧格式兼容：只有 terrain 字段的存档读入后 getter 逐格还原且层归一（读到 NOTHING 即翻红）', () => {
        const game = createHeadlessGame(777);
        const snap = game.toSnapshot();
        const expected: Array<{ x: number; y: number; terrain: TerrainType }> =
            snap.grid.map((c) => ({ x: c.x, y: c.y, terrain: c.terrain }));

        // 模拟 C-4a-0 之前的旧存档：整张 grid 删掉 layers 字段。
        const legacy: typeof snap = {
            ...snap,
            grid: snap.grid.map(({ layers: _layers, ...rest }) => rest),
        };
        const reloaded = createHeadlessGame(1);
        expect(reloaded.loadSnapshot(legacy)).toBe(true);

        let checked = 0;
        for (const cell of expected) {
            const got = reloaded.grid.getCell(cell.x, cell.y)!;
            // 错误实现示例：读不到 layers 时直接把层留成全 NOTHING → getter
            // 返回 NOTHING → 这里翻红。
            expect(got.terrain, `(${cell.x},${cell.y}) 旧档还原`).toBe(cell.terrain);
            const home = TERRAIN_HOME_LAYER[cell.terrain];
            for (let l = 0; l < L.COUNT; l++) {
                expect(got.layers[l]).toBe(l === home ? cell.terrain : C.NOTHING);
            }
            checked++;
        }
        expect(checked).toBeGreaterThan(1000);
    });
});

describe('C-4a-0 确定性（同种子 → 四层逐格逐层相等）', () => {
    it('同种子两次完整生成链（D1→D26），四层逐格逐层相等', () => {
        // 口径：b 在 a 的整条链走完之后**重新 createHeadlessGame**——
        // startNewGame 重播种使整条链可复现；若在 a 走链途中创建 b 再对比，
        // b 的后续 generateDepth 沿用被 a 推进过的全局流，本来就不该相等。
        const walkAndCapture = (seed: number): TerrainType[][][] => {
            const g: any = createHeadlessGame(seed);
            const caps: TerrainType[][][] = [snapshotLayers(g.grid)];
            for (let d = 2; d <= 26; d++) {
                g.depth = d;
                g.generateDepth(false, false);
                caps.push(snapshotLayers(g.grid));
            }
            return caps;
        };
        for (const seed of [424242, 777]) {
            const capsA = walkAndCapture(seed);
            const capsB = walkAndCapture(seed);
            expect(capsB).toHaveLength(capsA.length);
            for (let d = 0; d < capsA.length; d++) {
                expect(capsB[d], `seed=${seed} D${d + 1}`).toEqual(capsA[d]);
            }
        }
    });
});

describe('C-4a-0 留痕（本轮明确不做的事，断言现状）', () => {
    it('留痕（已反转，C-4b）：setTerrainLayer 调用点只出现在清单许可的文件', () => {
        // 原断言（C-4a-0）："生产代码中 setTerrainLayer 调用点数为 0"。
        // C-4b 的 fillSpawnMap 按 CE Architect.c:3246 逐格落层，必然调用它，
        // 按本断言自带的指示翻转为白名单式（B-1 反转范本）：
        // 许可清单 = fillSpawnMap 所在的算法文件。C-4c 接生成/晋升调用后
        // 若 setTerrainLayer 出现新的调用文件，把文件加进下方 ALLOWLIST
        // 并在任务报告里说明，其余任何出现都翻红（越界守卫保留）。
        const ALLOWLIST = new Set([
            'engine/Map/DungeonFeature.ts', // C-4b：fillSpawnMap / DFF_CLEAR_* 跨层清理
            'engine/Map/Promotion.ts',      // C-4c：promoteTile 的 TM_VANISHES_UPON_PROMOTION 清层（CE Time.c:1258-1261 按层写）
        ]);
        const srcDir = fileURLToPath(new URL('../', import.meta.url));
        const prodFiles = collectFiles(srcDir).filter((f) => !f.split(sep).includes('test'));
        const offenders: string[] = [];
        for (const f of prodFiles) {
            const rel = relative(srcDir, f);
            readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
                if (/\.setTerrainLayer\s*\(/.test(line) && !ALLOWLIST.has(rel.split(sep).join('/'))) {
                    offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
                }
            });
        }
        expect(offenders, `setTerrainLayer 调用点超出许可清单 ${[...ALLOWLIST].join(', ')}：\n${offenders.join('\n')}`).toEqual([]);
    });

    it('留痕：GAS 层恒空（气体走独立 Gas.ts 网格；C-4a 接入 CE 气体层后反转）', () => {
        for (const seed of [424242, 20260916]) {
            const g: any = createHeadlessGame(seed);
            for (const depth of [1, 5, 12, 26]) {
                if (depth > 1) { g.depth = depth; g.generateDepth(false, false); }
                for (let x = 0; x < g.grid.width; x++) {
                    for (let y = 0; y < g.grid.height; y++) {
                        expect(g.grid.getCell(x, y)!.layers[L.GAS]).toBe(C.NOTHING);
                    }
                }
            }
        }
    });

    it('留痕：Grid.ts 未引入地形属性表（flags / mechFlags / promoteType / fireType / promoteChance 归 C-4a）', () => {
        const gridSrc = readFileSync(
            fileURLToPath(new URL('../engine/Map/Grid.ts', import.meta.url)),
            'utf8'
        );
        // 去注释后扫描：CE 旗标名允许出现在文档注释里（C-2 遗留），不允许
        // 以代码标识符的形态进入 Grid.ts。（Grid.ts 无含 "//" 的字符串字面量，
        // 行注释通删是安全的。）
        const codeOnly = gridSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        const forbidden = ['promoteType', 'promoteChance', 'fireType', 'mechFlags', 'T_IS_FLAMMABLE', 'T_SPONTANEOUSLY_IGNITES'];
        const hits = forbidden.filter((name) => codeOnly.includes(name));
        expect(hits, `C-4a 的属性表标识符不应提前进入 Grid.ts 代码：${hits.join(', ')}`).toEqual([]);
    });
});

describe('C-4a-0 干跑测量：15 种子 × D1-D26 跨层清除事件表', () => {
    it('全量生成并输出 (层, 旧地形 → 新地形) × 次数（C-4a 的分歧规模输入；只测量不修复）', () => {
        resetCrossLayerClearStats();
        for (const seed of SWEEP_SEEDS) {
            const g: any = createHeadlessGame(seed);
            for (let d = 2; d <= 26; d++) {
                g.depth = d;
                g.generateDepth(false, false);
            }
        }
        const stats = getCrossLayerClearStats();
        const total = stats.reduce((acc, s) => acc + s.count, 0);

        // 弱不变量：真实生成必然发生过跨层覆盖（生成器把地板改湖、把草改地板…）。
        expect(total, '跨层清除事件总数应 > 0').toBeGreaterThan(0);
        // GAS 层恒空 → 不存在"清掉 GAS 层内容"的事件。
        const gasEvents = stats.filter((s) => s.layer === L.GAS);
        expect(gasEvents, 'GAS 层不应有任何被清除事件').toEqual([]);

        const nameT = (t: TerrainType) => TerrainType[t];
        const nameL = (l: DungeonLayer) => DungeonLayer[l];
        const byLayer = new Map<string, number>();
        for (const s of stats) {
            byLayer.set(nameL(s.layer), (byLayer.get(nameL(s.layer)) ?? 0) + s.count);
        }
        const lines: string[] = [
            `| 层 | 被清地形 → 新地形 | 次数 |`,
            `| --- | --- | --- |`,
        ];
        for (const s of stats) {
            lines.push(`| ${nameL(s.layer)} | ${nameT(s.from)} → ${nameT(s.to)} | ${s.count} |`);
        }
        console.log(
            `[C-4a-0 干跑测量] 15 种子 × D1-D26 共 ${SWEEP_SEEDS.length * 26} 层，` +
            `跨层清除事件 ${total} 次，组合 ${stats.length} 种。按层合计：` +
            [...byLayer.entries()].map(([l, n]) => `${l}=${n}`).join('，') +
            '\n' + lines.join('\n')
        );
    });
});
