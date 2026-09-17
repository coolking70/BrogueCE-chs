/**
 * src/test/c_6_autogenerators.test.ts — C-6：runAutogenerators（digDungeon 最后一步）
 *
 * CE 事实来源：Rogue.h:2754-2772（结构体）、variants/GlobalsBrogue.c:111-171
 * （brogue 表 49 条）、Architect.c:1782-1860（本体）、Architect.c:2933/2952
 * （digDungeon 两处调用）、Architect.c:3822-3845（randomMatchingLocation）。
 *
 * 对抗性清单（每条都能在具体错误实现下翻红）：
 *   AD-1 两趟分流写反（buildAreaMachines 分支反转）
 *   AD-2 数量公式 /100 漏掉 + maxNumber 封顶失效 + 负数截断方向
 *   AD-3 frequency 追加循环写成 if（或漏掉）
 *   AD-4 落点不检查 foundation（DUNGEON 基座 / LIQUID 基座两向）
 *   AD-5 深度约束写反 / 边界含端写错
 *   AD-6 表保真：49 条全字段对照 CE 原行 + 死条目 index 0 + 深水枚举名
 *   AD-7 无载体条目被接成空转链（真实目录 machine 趟零 RNG 消耗）
 *   AD-8 接线与管线位置（两趟调用点存在且统计归位）
 * 反向哨兵：
 *   S-1 火与气体：本轮目录无任何火/气体条目被接（wired 集 = {3,8}），
 *       加上既有 f 链/g 链/c_5 套件（合成场景）不动——真实地图锚定的
 *       FIRE-NAT 哨兵（g_2/g_3）预期翻红，重捕获归验收方（C-5 先例）。
 *   S-2 坏层闸门：p1_26/p1_29/p1_33 在其自身文件复跑（本轮不触碰）。
 */
import { describe, it, expect } from 'vitest';
import { Architect } from '../engine/Generator/Architect';
import {
    AUTO_GENERATOR_CATALOG,
    WIRED_AUTOGENERATOR_INDEXES,
    runAutogenerators,
    randomMatchingLocation,
    type AutoGeneratorEntry,
} from '../engine/Map/AutoGenerator';
import { DungeonLayer, Grid, TerrainType } from '../engine/Map/Grid';
import { rng } from '../engine/Random';

// ---------------------------------------------------------------------------
// 合成目录 / 合成网格工具（单元层对抗测试用）
// ---------------------------------------------------------------------------

function mkEntry(over: Partial<AutoGeneratorEntry>): AutoGeneratorEntry {
    return {
        ceLine: 0,
        index: 1,
        terrain: null,
        ceTerrain: '0',
        layer: DungeonLayer.SURFACE,
        df: null,
        ceDf: '0',
        ceDfId: 0,
        machine: 0,
        ceMachine: '0',
        requiredDungeonFoundationType: TerrainType.FLOOR,
        requiredLiquidFoundationType: TerrainType.NOTHING,
        minDepth: 0,
        maxDepth: 40,
        frequency: 0,
        minNumberIntercept: 0,
        minNumberSlope: 0,
        maxNumber: 10,
        carrier: 'wired',
        note: '',
        ...over,
    };
}

/** 死条目占位（CE 循环从 1 起，合成目录的下标 0 不会被遍历）。 */
const DEAD0 = (): AutoGeneratorEntry => mkEntry({ index: 0, carrier: 'dead-index0' });

/** 全 FLOOR 内区 + 边界墙的合成网格。 */
function mkFloorGrid(w = 40, h = 24): Grid {
    const g = new Grid(w, h);
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
            const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
            g.setTerrain(x, y, border ? TerrainType.WALL : TerrainType.FLOOR, '.', 0x888888);
        }
    }
    return g;
}

function grassCells(g: Grid): Array<{ x: number, y: number }> {
    const out: Array<{ x: number, y: number }> = [];
    for (let x = 0; x < g.width; x++) {
        for (let y = 0; y < g.height; y++) {
            if (g.getCell(x, y)!.layers[DungeonLayer.SURFACE] === TerrainType.GRASS) {
                out.push({ x, y });
            }
        }
    }
    return out;
}

describe('C-6 对抗：runAutogenerators 的 CE 规则逐条（合成目录）', () => {
    it('AD-1 对抗：两趟分流——buildAreaMachines 写反在此翻红（合成一趟必挂）', () => {
        // CE `(gen->machine > 0) == buildAreaMachines`：false 趟只跑非机器条目，
        // true 趟只跑机器条目。两个合成条目各据一趟，任何"合成一趟"的写法
        // （分支写反 / 条件漏掉 / 恒 true）都会让两趟的可见条目集相同。
        const SYN = [
            DEAD0(),
            mkEntry({ index: 1, terrain: TerrainType.GRASS, minNumberIntercept: 500, maxNumber: 5 }),
            mkEntry({ index: 2, machine: 67, minNumberIntercept: 100, maxNumber: 3 }),
        ];

        rng.seedRandomGenerator(777);
        const sFalse = runAutogenerators(mkFloorGrid(), 5, false, SYN);
        expect(sFalse.buildAreaMachines).toBe(false);
        expect(sFalse.entries.map(e => e.index), 'false 趟必须只跑非机器条目').toEqual([1]);
        expect(sFalse.entries[0]!.built).toBe(5);

        rng.seedRandomGenerator(778);
        const sTrue = runAutogenerators(mkFloorGrid(), 5, true, SYN);
        expect(sTrue.buildAreaMachines).toBe(true);
        expect(sTrue.entries.map(e => e.index), 'true 趟必须只跑机器条目').toEqual([2]);
        expect(sTrue.totalBuilt, 'web 无 CE 机器系统：机器条目计数但不落地').toBe(0);
        expect(sTrue.entries[0]!.count).toBe(1);
    });

    it('AD-2 对抗：数量公式的 /100、maxNumber 封顶、负数向零截断（任何一处错在此翻红）', () => {
        // 草地同款参数（GlobalsBrogue.c:117：1000/-80/max10）：深度 1 应为
        // trunc(920/100)=9。漏 /100 的实现得 min(920,10)=10 → 翻红。
        const FORM = [
            DEAD0(),
            mkEntry({ index: 1, terrain: TerrainType.GRASS, minDepth: 0, maxDepth: 40, minNumberIntercept: 1000, minNumberSlope: -80, maxNumber: 10 }),
        ];
        rng.seedRandomGenerator(4242);
        const d1 = runAutogenerators(mkFloorGrid(), 1, false, FORM);
        expect(d1.entries[0]!.count, '深度 1：trunc((1000-80)/100)=9（漏 /100 得 10）').toBe(9);
        expect(d1.entries[0]!.built).toBe(9);
        expect(d1.totalBuilt).toBe(9);

        rng.seedRandomGenerator(4242);
        const d10 = runAutogenerators(mkFloorGrid(), 10, false, FORM);
        expect(d10.entries[0]!.count, '深度 10：trunc(200/100)=2').toBe(2);

        rng.seedRandomGenerator(4242);
        const d14 = runAutogenerators(mkFloorGrid(), 14, false, FORM);
        expect(d14.entries[0]!.count, '深度 14：trunc(-120/100)=-1（C 向零截断；floor 会得 -2）').toBe(-1);
        expect(d14.entries[0]!.built, '负 count：for 循环不执行').toBe(0);

        // 封顶：公式 10 但 maxNumber 3 → 恰 3（封顶失效得 10 → 翻红）。
        const CAP = [
            DEAD0(),
            mkEntry({ index: 1, terrain: TerrainType.GRASS, minDepth: 0, maxDepth: 40, minNumberIntercept: 1000, maxNumber: 3 }),
        ];
        rng.seedRandomGenerator(4243);
        const capped = runAutogenerators(mkFloorGrid(), 5, false, CAP);
        expect(capped.entries[0]!.count, 'min(公式 10, max 3)=3').toBe(3);
        expect(capped.entries[0]!.built).toBe(3);
    });

    it('AD-3 对抗：frequency 追加循环——写成 if 或漏掉在此翻红', () => {
        // 公式 0 + frequency 100：while 每次都掷骰且必中，count 一路加到
        // maxNumber=5。写成 if 只加 1；漏掉整段得 0。
        const FREQ = [
            DEAD0(),
            mkEntry({ index: 1, terrain: TerrainType.GRASS, minDepth: 0, maxDepth: 40, frequency: 100, maxNumber: 5 }),
        ];
        rng.seedRandomGenerator(99);
        const r = runAutogenerators(mkFloorGrid(), 3, false, FREQ);
        expect(r.entries[0]!.count, 'frequency 100 追加到 maxNumber=5').toBe(5);
        expect(r.entries[0]!.built).toBe(5);

        // 公式 1 + frequency 100 + max 10：追加到满 10（封顶判断在掷骰之后仍生效）。
        const FREQ2 = [
            DEAD0(),
            mkEntry({ index: 1, terrain: TerrainType.GRASS, minDepth: 0, maxDepth: 40, minNumberIntercept: 100, frequency: 100, maxNumber: 10 }),
        ];
        rng.seedRandomGenerator(98);
        const r2 = runAutogenerators(mkFloorGrid(), 3, false, FREQ2);
        expect(r2.entries[0]!.count, '公式 1 + 追加到 max=10').toBe(10);
    });

    it('AD-4a 对抗：落点必须检查 DUNGEON 基座（不检查的实现把草铺上墙）', () => {
        const g = mkFloorGrid();
        // 内区几乎全填墙，只留一个 4×4 地板口袋。
        for (let x = 2; x < g.width - 2; x++) {
            for (let y = 2; y < g.height - 2; y++) {
                const inPocket = x >= 10 && x < 14 && y >= 8 && y < 12;
                g.setTerrain(x, y, inPocket ? TerrainType.FLOOR : TerrainType.WALL, '#', 0x555555);
            }
        }
        const FOUND = [
            DEAD0(),
            mkEntry({ index: 1, terrain: TerrainType.GRASS, minDepth: 0, maxDepth: 40, minNumberIntercept: 500, maxNumber: 5 }),
        ];
        rng.seedRandomGenerator(555);
        const r = runAutogenerators(g, 3, false, FOUND);
        expect(r.entries[0]!.built).toBe(5);
        const cells = grassCells(g);
        expect(cells.length).toBeGreaterThan(0);
        for (const p of cells) {
            expect(g.getCell(p.x, p.y)!.layers[DungeonLayer.DUNGEON],
                `草落在非 FLOOR 基座 (${p.x},${p.y})——落点未检查 foundation`).toBe(TerrainType.FLOOR);
        }
    });

    it('AD-4b 对抗：落点必须检查 LIQUID 基座（DEEP_WATER 基座只落深水格）', () => {
        const g = mkFloorGrid();
        // 6 个"CE 形状的湖格"：DUNGEON 保持 FLOOR、LIQUID 写深水（CE 湖格
        // 语义；web 现役 fillLakes 走覆盖式写法，其格的 DUNGEON 已被清空——
        // 无论哪种形态，非深水格都必须被拒）。
        const deepCells: Array<[number, number]> = [[5, 5], [6, 5], [5, 6], [20, 10], [21, 10], [30, 15]];
        for (const [x, y] of deepCells) {
            g.setTerrainLayer(x, y, DungeonLayer.LIQUID, TerrainType.WATER_DEEP);
        }
        const ALGAE_LIKE = [
            DEAD0(),
            mkEntry({
                index: 1, terrain: TerrainType.GRASS, minDepth: 0, maxDepth: 40,
                minNumberIntercept: 500, maxNumber: 5,
                requiredLiquidFoundationType: TerrainType.WATER_DEEP,
            }),
        ];
        rng.seedRandomGenerator(556);
        const r = runAutogenerators(g, 3, false, ALGAE_LIKE);
        expect(r.entries[0]!.built).toBe(5);
        for (const p of grassCells(g)) {
            expect(g.getCell(p.x, p.y)!.layers[DungeonLayer.LIQUID],
                `草落在无深水基座的格 (${p.x},${p.y})——LIQUID foundation 未检查`).toBe(TerrainType.WATER_DEEP);
        }
    });

    it('AD-5 对抗：深度约束——写反或边界开合写错在此翻红（CE 含两端）', () => {
        const DEP = [
            DEAD0(),
            mkEntry({ index: 1, terrain: TerrainType.GRASS, minDepth: 5, maxDepth: 8, minNumberIntercept: 100, maxNumber: 10 }),
        ];
        for (const depth of [4, 9, 40]) {
            rng.seedRandomGenerator(31);
            const r = runAutogenerators(mkFloorGrid(), depth, false, DEP);
            expect(r.entries, `深度 ${depth} 在窗口 [5,8] 外，必须零条目`).toEqual([]);
        }
        for (const depth of [5, 8]) {
            rng.seedRandomGenerator(32);
            const r = runAutogenerators(mkFloorGrid(), depth, false, DEP);
            expect(r.entries[0]!.built, `深度 ${depth} 在窗口 [5,8] 内（含两端）`).toBeGreaterThan(0);
        }
    });

    it('AD-6 对抗：randomMatchingLocation 的 CE 语义——500 次全败返回 null 且恰消耗 1000 个随机数', () => {
        const g = mkFloorGrid(20, 12);
        for (let x = 1; x < 19; x++) {
            for (let y = 1; y < 11; y++) {
                g.setTerrain(x, y, TerrainType.WALL, '#', 0x555555);
            }
        }
        rng.seedRandomGenerator(1234);
        const before = rng.randomNumbersGenerated;
        const loc = randomMatchingLocation(g, TerrainType.FLOOR, TerrainType.NOTHING);
        expect(loc, '无任何合法格：500 次全败 → null').toBeNull();
        expect(rng.randomNumbersGenerated - before,
            'CE do-while 恰 500 轮 × 每轮 2 抽（x、y 各一）；写错循环边界在此翻红').toBe(1000);

        // 占用检查：machineNumber ≠ 0 的格不可选（CE HAS_* 旗标的生成期投影）。
        const g2 = mkFloorGrid(20, 12);
        g2.getCell(10, 5)!.machineNumber = 7;
        rng.seedRandomGenerator(4321);
        for (let i = 0; i < 50; i++) {
            const p = randomMatchingLocation(g2, TerrainType.FLOOR, TerrainType.NOTHING)!;
            expect(p).not.toBeNull();
            expect(p.x === 10 && p.y === 5, '机器格被选中——占用检查缺失').toBe(false);
        }
    });
});

// ---------------------------------------------------------------------------
// 表保真（GlobalsBrogue.c:114-170 逐行对照）
// ---------------------------------------------------------------------------

/** CE 表 49 行的数值列 [minDepth, maxDepth, frequency, minNumberIntercept,
 *  minNumberSlope, maxNumber]（直接从 C 源逐行转写；发现不符即抄录错误）。 */
const CE_ROWS: Array<readonly [number, number, number, number, number, number]> = [
    [1, 40, 60, 100, 0, 4],      // 0  DF_GRANITE_COLUMN（死条目）
    [14, 40, 15, -325, 25, 5],   // 1  DF_CRYSTAL_WALL
    [7, 40, 15, -300, 70, 14],   // 2  DF_LUMINESCENT_FUNGUS
    [0, 10, 0, 1000, -80, 10],   // 3  DF_GRASS        ← wired
    [4, 9, 0, -200, 80, 10],     // 4  DF_DEAD_GRASS
    [9, 14, 0, 1200, -80, 10],   // 5  DF_DEAD_GRASS
    [12, 39, 30, 0, 0, 4],       // 6  DF_BONES
    [0, 39, 30, 0, 0, 4],        // 7  DF_RUBBLE
    [0, 8, 15, 1000, -333, 10],  // 8  DF_FOLIAGE      ← wired
    [13, 40, 30, -600, 50, 12],  // 9  DF_FUNGUS_FOREST
    [10, 40, 50, 0, 0, 2],       // 10 DF_BUILD_ALGAE_WELL（深水基座）
    [6, 39, 5, -100, 35, 3],     // 11 STATUE_INERT（墙基座）
    [10, 39, 50, 0, 0, 3],       // 12 STATUE_INERT（地板基座）
    [6, 39, 5, -200, 70, 12],    // 13 TORCH_WALL
    [2, 4, 20, 0, 0, 1],         // 14 GAS_TRAP_POISON
    [2, 5, 20, 0, 0, 1],         // 15 NET_TRAP
    [2, 6, 20, 0, 0, 1],         // 16 MT_PARALYSIS_TRAP_AREA
    [4, 7, 20, 0, 0, 1],         // 17 ALARM_TRAP
    [2, 10, 20, 0, 0, 1],        // 18 GAS_TRAP_CONFUSION
    [4, 12, 20, 0, 0, 1],        // 19 FLAMETHROWER
    [10, 14, 20, 0, 0, 1],       // 20 FLOOD_TRAP
    [5, 39, 20, 100, 0, 3],      // 21 GAS_TRAP_POISON_HIDDEN
    [6, 39, 20, 100, 0, 3],      // 22 NET_TRAP_HIDDEN
    [7, 39, 20, 100, 0, 3],      // 23 MT_PARALYSIS_TRAP_HIDDEN_AREA
    [8, 39, 20, 100, 0, 2],      // 24 ALARM_TRAP_HIDDEN
    [9, 39, 20, 100, 0, 2],      // 25 TRAP_DOOR_HIDDEN
    [11, 39, 20, 100, 0, 3],     // 26 GAS_TRAP_CONFUSION_HIDDEN
    [13, 39, 20, 100, 0, 3],     // 27 FLAMETHROWER_HIDDEN
    [15, 39, 20, 100, 0, 3],     // 28 FLOOD_TRAP_HIDDEN
    [1, 39, 30, 0, 0, 2],        // 29 MT_SWAMP_AREA
    [0, 5, 15, 500, -150, 10],   // 30 DF_SUNLIGHT
    [1, 15, 15, 500, -50, 10],   // 31 DF_DARKNESS
    [16, 39, 30, 100, 0, 3],     // 32 STEAM_VENT
    [40, 40, 100, 0, 0, 600],    // 33 CRYSTAL_WALL（最深层）
    [8, 39, 2, 0, 0, 2],         // 34 DEWAR_CAUSTIC_GAS
    [8, 39, 2, 0, 0, 2],         // 35 DEWAR_CONFUSION_GAS
    [8, 39, 2, 0, 0, 2],         // 36 DEWAR_PARALYSIS_GAS
    [8, 39, 2, 0, 0, 2],         // 37 DEWAR_METHANE_GAS
    [40, 40, 100, 0, 0, 200],    // 38 DF_LUMINESCENT_FUNGUS（最深层）
    [1, 30, 25, 140, -10, 3],    // 39 MT_BLOODFLOWER_AREA
    [5, 26, 7, 0, 0, 1],         // 40 MT_SHRINE_AREA
    [1, 5, 15, 0, 0, 1],         // 41 MT_IDYLL_AREA
    [10, 40, 15, 0, 0, 2],       // 42 MT_REMNANT_AREA
    [7, 40, 12, 0, 0, 5],        // 43 MT_DISMAL_AREA
    [5, 39, 6, 0, 0, 2],         // 44 MT_BRIDGE_TURRET_AREA
    [5, 39, 6, 0, 0, 2],         // 45 MT_LAKE_PATH_TURRET_AREA
    [6, 39, 15, 0, 0, 3],        // 46 MT_TRICK_STATUE_AREA
    [12, 39, 10, 0, 0, 2],       // 47 MT_SENTINEL_AREA
    [12, 39, 12, 0, 0, 3],       // 48 MT_WORM_AREA
];

describe('C-6 表保真：49 条逐行对照 CE（GlobalsBrogue.c:114-170）', () => {
    it('AD-7 表长 49、数值列逐条相等、死条目 index 0、基座列抽查', () => {
        expect(AUTO_GENERATOR_CATALOG.length, 'CE numberAutogenerators（GlobalsBrogue.c:1047）').toBe(49);
        for (let i = 0; i < 49; i++) {
            const e = AUTO_GENERATOR_CATALOG[i]!;
            const row = CE_ROWS[i]!;
            const got: readonly number[] = [e.minDepth, e.maxDepth, e.frequency, e.minNumberIntercept, e.minNumberSlope, e.maxNumber];
            expect(got, `表行 ${i}（GlobalsBrogue.c:${e.ceLine}）数值列不符`).toEqual(row);
            expect(e.index).toBe(i);
        }
        // CE 上游死条目：循环从 AG=1 起，表首 granite column 永不执行。
        expect(AUTO_GENERATOR_CATALOG[0]!.carrier, 'CE 上游死条目（文件头 ★）——若上游修复才翻转').toBe('dead-index0');
        expect(AUTO_GENERATOR_CATALOG[0]!.ceDf).toBe('DF_GRANITE_COLUMN');
        // 深水基座枚举名陷阱（任务书预警：成员是 WATER_DEEP 不是 DEEP_WATER）。
        expect(AUTO_GENERATOR_CATALOG[10]!.requiredLiquidFoundationType).toBe(TerrainType.WATER_DEEP);
        expect(AUTO_GENERATOR_CATALOG[10]!.ceDf).toBe('DF_BUILD_ALGAE_WELL');
        // wired 集恰为草/树两条。
        expect(WIRED_AUTOGENERATOR_INDEXES, 'C-6 接入集（载体盘点表裁决）').toEqual([3, 8]);
        expect(AUTO_GENERATOR_CATALOG[3]!.df).toBeDefined();
        expect(AUTO_GENERATOR_CATALOG[8]!.df).toBeDefined();
        // dewars 是唯一的 terrain+DF 双列条目族（CE 34-37 行）。
        for (const i of [34, 35, 36, 37]) {
            expect(AUTO_GENERATOR_CATALOG[i]!.ceTerrain.startsWith('DEWAR_'), `行 ${i} 应是 dewar`).toBe(true);
            expect(AUTO_GENERATOR_CATALOG[i]!.ceDf).toBe('DF_CARPET_AREA');
        }
    });
});

// ---------------------------------------------------------------------------
// 集成：真实目录 × 真实生成管线
// ---------------------------------------------------------------------------

describe('C-6 集成：真实目录在真实生成里的行为', () => {
    it('AD-8 接线：generateTerrain 跑非机器趟且真的长草/树；generateLevel 跑机器趟', () => {
        rng.seedRandomGenerator(20260917);
        const arch = new Architect();
        arch.generateTerrain(5);

        // 非机器趟：位置在 fillLakes 之后（generateTerrain 内），统计归位。
        expect(arch.autogenNonMachine, 'generateTerrain 后非机器趟统计必须存在（接线被删在此翻红）').not.toBeNull();
        expect(arch.autogenNonMachine!.buildAreaMachines).toBe(false);
        const idxs = arch.autogenNonMachine!.entries.map(e => e.index);
        for (const i of idxs) {
            expect([3, 8], `统计里出现了非 wired 条目 index ${i}——无载体条目被接上`).toContain(i);
        }
        expect(arch.autogenNonMachine!.totalBuilt, 'D5 草/树一条都没长——接线或数量公式错').toBeGreaterThan(0);
        // 机器趟在 generateLevel 阶段：generateTerrain 后应为 null。
        expect(arch.autogenMachine).toBeNull();

        // 全管线：机器趟统计存在但恒为空（本轮机器条目全无载体）。
        rng.seedRandomGenerator(20260917);
        const arch2 = new Architect();
        arch2.generateLevel(5);
        expect(arch2.autogenMachine, 'generateLevel 后机器趟统计必须存在（接线被删在此翻红）').not.toBeNull();
        expect(arch2.autogenMachine!.buildAreaMachines).toBe(true);
        expect(arch2.autogenMachine!.entries, '机器趟出现条目——无载体条目被接成空转').toEqual([]);
        expect(arch2.autogenMachine!.totalBuilt).toBe(0);
    });

    it('AD-7 哨兵：真实目录的机器趟零 RNG 消耗（空转链在此翻红）', () => {
        rng.seedRandomGenerator(20260917);
        const arch = new Architect();
        arch.generateTerrain(5);
        const before = rng.randomNumbersGenerated;
        const s = runAutogenerators(arch.grid, 5, true);
        expect(s.entries).toEqual([]);
        expect(s.totalBuilt).toBe(0);
        expect(rng.randomNumbersGenerated - before,
            '机器趟消耗了 RNG——有未接条目绕过了载体跳过（C-4c 硫矿式空转）').toBe(0);
    });

    it('实测：草/树的实际生成数随深度分布（CE 数量公式的 web 落地曲线）', () => {
        const SEEDS = [424242, 777];
        const byDepth: Record<number, { grass: number, foliage: number, levels: number }> = {};
        for (const seed of SEEDS) {
            for (let depth = 1; depth <= 26; depth++) {
                rng.seedRandomGenerator(seed);
                const arch = new Architect();
                arch.generateTerrain(depth);
                const s = arch.autogenNonMachine!;
                const row = (byDepth[depth] ??= { grass: 0, foliage: 0, levels: 0 });
                for (const e of s.entries) {
                    if (e.index === 3) row.grass += e.built;
                    if (e.index === 8) row.foliage += e.built;
                }
                row.levels++;
            }
        }
        const lines: string[] = [];
        for (const d of Object.keys(byDepth).map(Number).sort((a, b) => a - b)) {
            const r = byDepth[d]!;
            lines.push(`D${d}\tgrass=${r.grass}\tfoliage=${r.foliage}`);
        }
        console.log(`[c_6] 草/树生成数随深度分布（${SEEDS.length} 种子合计，built 口径）:\n${lines.join('\n')}`);

        // 深度窗口的对抗核对：草窗口 D1-10 且公式值在窗口内恒正（每层必有）；
        // 树窗口 D1-8 但公式只在 D1-2 为正（(1000-333d)/100：D1=6、D2=3、
        // D3 起为 0/负）——D3-8 只剩 frequency 15% 的追加，逐层不保证。
        for (const d of Object.keys(byDepth).map(Number).sort((a, b) => a - b)) {
            const r = byDepth[d]!;
            if (d <= 8) {
                expect(r.grass, `D${d} 应有草（CE 表行 117 窗口 1-10，公式恒正）`).toBeGreaterThan(0);
            } else if (d === 9 || d === 10) {
                expect(r.grass, `D${d} 应有草（窗口尾）`).toBeGreaterThan(0);
                expect(r.foliage, `D${d} 不该有树（窗口闭于 8；frequency 追加需连中 29 次，实测恒 0）`).toBe(0);
            } else {
                expect(r.grass, `D${d} 不该有草（maxDepth 10）`).toBe(0);
                expect(r.foliage, `D${d} 不该有树`).toBe(0);
            }
        }
        // 反真空：公式为正的层必须真的长出来。
        expect(byDepth[1]!.foliage, 'D1 树（公式 6）').toBeGreaterThan(0);
        expect(byDepth[2]!.foliage, 'D2 树（公式 3）').toBeGreaterThan(0);
        let total = 0;
        for (let d = 1; d <= 10; d++) total += byDepth[d]!.grass;
        expect(total, 'D1-10 草实例合计为 0——自动生成器整段没跑').toBeGreaterThan(20);
    });

    it('哨兵 S-1：本轮只落草/树（GRASS/FOLIAGE），不新增任何火/气体/坠落族地形', () => {
        // 自动生成器当前 wired 集只有 DF_GRASS/DF_FOLIAGE（两个 SURFACE 层
        // 装饰 DF）；机器趟恒空（上两条已断言）。本条把"这两趟总共只可能
        // 写 GRASS/FOLIAGE"钉成表级事实：wired 条目的 df tile 与 terrain
        // 字段只能是这两个值。有人往 wired 集加火/气体/坠落条目而不改本
        // 断言时，须先过 F/G/C-5 哨兵套件复核。
        for (const i of WIRED_AUTOGENERATOR_INDEXES) {
            const e = AUTO_GENERATOR_CATALOG[i]!;
            const tile = e.df !== null ? e.ceDf : e.ceTerrain;
            expect(['DF_GRASS', 'DF_FOLIAGE'], `wired 条目 ${i}（${tile}）超出本轮裁决集`).toContain(tile);
        }
        expect(WIRED_AUTOGENERATOR_INDEXES).toEqual([3, 8]);
    });
});

// ---------------------------------------------------------------------------
// 留痕（明确不做；写明哪一轮来反转）
// ---------------------------------------------------------------------------

describe('C-6 留痕：未接条目登记（每条写明激活轮）', () => {
    it('留痕 T1：光照类条目未接——C-7 光照目录落地后反转（index 13/30/31/38）', () => {
        for (const i of [13, 30, 31, 38]) {
            const e = AUTO_GENERATOR_CATALOG[i]!;
            expect(e.carrier === 'c7-light' || e.carrier === 'no-tile',
                `index ${i}（${e.ceTerrain || e.ceDf}）应保持未接`).toBe(true);
        }
        // 激活指示：C-7 落 SUNLIGHT_POOL/DARKNESS_PATCH/LUMINESCENT_FUNGUS/
        // TORCH_WALL 四 tile + 光照目录后，把这四条的 carrier 翻成 'wired'，
        // 并把它们从本断言移入 AD-7 的 wired 集断言。
        expect(AUTO_GENERATOR_CATALOG[30]!.ceDf).toBe('DF_SUNLIGHT');
        expect(AUTO_GENERATOR_CATALOG[31]!.ceDf).toBe('DF_DARKNESS');
    });

    it('留痕 T2：陷阱族（显/隐）未接——按 CE tile 目录落地陷阱后反转（index 14-15/17-22/24-28/32）', () => {
        const trapRows = [14, 15, 17, 18, 19, 20, 21, 22, 24, 25, 26, 27, 28, 32];
        for (const i of trapRows) {
            const e = AUTO_GENERATOR_CATALOG[i]!;
            expect(e.carrier, `index ${i}（${e.ceTerrain}）应保持 no-tile`).toBe('no-tile');
        }
        // 激活指示：CE 陷阱是独立 tile（T_IS_DF_TRAP + fireType/discoverType，
        // 显隐两态）。web 的通用 TRAP+trapType 是自创语义，不得作为载体；
        // 激活轮需逐个落地 CE 陷阱 tile 后把 carrier 翻 'wired'。
    });

    it('留痕 T3：CE 机器族未接——建出 CE 机器系统（buildAMachine 对应物）后反转（13 条）', () => {
        const machineRows = AUTO_GENERATOR_CATALOG.filter(e => e.machine > 0).map(e => e.index);
        expect(machineRows.length, 'CE 表机器条目数').toBe(13);
        for (const e of AUTO_GENERATOR_CATALOG) {
            if (e.machine > 0) {
                expect(e.carrier, `index ${e.index}（${e.ceMachine}）应保持 no-machine`).toBe('no-machine');
            }
        }
        // 激活指示：web 的 BlueprintEngine（自造 blueprints.json）不是 CE 机器
        // 系统；激活轮需 buildAMachine 的忠实移植 + blueprintCatalog_Brogue，
        // 并给 MT_PARALYSIS_TRAP_AREA(67)/MT_PARALYSIS_TRAP_HIDDEN_AREA(68)/
        // MT_SWAMP_AREA(61)/MT_BLOODFLOWER_AREA(58)/MT_SHRINE_AREA(59)/
        // MT_IDYLL_AREA(60)/MT_REMNANT_AREA(63)/MT_DISMAL_AREA(64)/
        // MT_BRIDGE_TURRET_AREA(65)/MT_LAKE_PATH_TURRET_AREA(66)/
        // MT_TRICK_STATUE_AREA(69)/MT_WORM_AREA(70)/MT_SENTINEL_AREA(71)
        // 逐条翻 'wired'（MT 数值为 Rogue.h:2668-2753 逐位推算，激活轮重核）。
    });

    it('留痕 T4：装饰/植物/dewar 族未接——随各自 tile 落地轮反转', () => {
        const noTileRows = [1, 2, 4, 5, 6, 7, 9, 10, 11, 12, 33, 34, 35, 36, 37];
        for (const i of noTileRows) {
            expect(AUTO_GENERATOR_CATALOG[i]!.carrier, `index ${i} 应保持 no-tile`).toBe('no-tile');
        }
        // 激活指示：CRYSTAL_WALL(1,33)/LUMINESCENT_FUNGUS(2,38 归 C-7)/
        // DEAD_GRASS(4,5)/BONES(6)/RUBBLE(7)/FUNGUS_FOREST(9)/
        // 藻井链(10)/STATUE_INERT(11,12)/DEWAR 四兄弟(34-37，容器 tile +
        // DF_CARPET_AREA 的 CARPET tile)。每落一个 tile 就翻对应条目。
    });

    it('留痕 T5：index 0（granite column）是 CE 上游死条目——除非上游修复，永不接', () => {
        expect(AUTO_GENERATOR_CATALOG[0]!.carrier).toBe('dead-index0');
        // 反转条件（仅一种）：BrogueCE 上游把 runAutogenerators 的循环起点改
        // 为 0 或给表补占位条目。web 不得单方面"修"这个死条目（D1：一律按 CE）。
    });
});
