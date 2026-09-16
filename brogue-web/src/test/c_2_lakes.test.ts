/**
 * src/test/c_2_lakes.test.ts — C-2：湖泊四类液体 / 镶边 / 边界打通 / 建桥
 * （单元契约与构造性对抗场景；真实生成关卡上的行为断言与实测统计在
 *   c_2_lakes_e2e.test.ts。两文件分工的原因：cleanUpLakeBoundaries 与
 *   buildABridge 的判别性微结构（异类湖相邻、深渊带走向与绕行距离）在
 *   真实关卡上不可控也不可复现，只能在构造网格上钉死判据；所有"真实
 *   关卡会出现什么"的断言都放在 e2e 文件。）
 *
 * CE 对照（BrogueCE-master/src/brogue/ 只读）：
 *   liquidType 2518-2550 / fillLake 2554-2570 / createWreath 2692-2707 /
 *   fillLakes 2709-2730 / cleanUpLakeBoundaries 1856-1912 /
 *   buildABridge 2786-2876 / pathingDistance Dijkstra.c:252。
 *   gameConst：minimumLavaLevel=4、minimumBrimstoneLevel=17、
 *   deepestLevel=40、depthAccelerator=1（GlobalsBrogue.c:1019-1022、43-44）。
 *
 * 对抗性测试 ↔ 错误实现映射（任务书 §测试要求 4）：
 *   AD-A1 深度门槛写反 → 「深度门槛」用例：浅层出岩浆/硫矿、深层缺硫矿即红
 *   AD-A2 最深层未强制深水 → 「最深层特例」用例：D40 出现非深水即红
 *   AD-A3 镶边按液体取错（岩浆不该有镶边）→ 「液体→镶边契约」用例
 *   AD-A4 cleanUpLakeBoundaries 把不同类的湖打通 → 「异类湖不通融」用例
 *   AD-A5 桥架错地方 / 架完连通性变差 → 5b 深水不可架桥 / 5c 绕行不够不架 /
 *         5d 全程贴墙不架 / 5a 架桥必须真的缩短两岸路程
 */
import { describe, it, expect } from 'vitest';
import { Grid, TerrainType, DCOLS, DROWS } from '../engine/Map/Grid';
import { liquidType, fillLakes, cleanUpLakeBoundaries, buildABridge, CE_DEEPEST_LEVEL } from '../engine/Map/LakeSystem';
import { terrainAllowsMove, DIRS8 } from '../engine/Map/Connectivity';
import { rng } from '../engine/Random';

const ENSEMBLE = 400; // 每深度抽样次数（种子化，确定性）

type LiquidRow = ReturnType<typeof liquidType>;

function drawEnsemble(depth: number, seed: number): LiquidRow[] {
    rng.seedRandomGenerator(seed);
    const out: LiquidRow[] = [];
    for (let i = 0; i < ENSEMBLE; i++) out.push(liquidType(depth));
    return out;
}

function makeGrid(w: number, h: number, base: TerrainType): Grid {
    const g = new Grid(w, h);
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
            g.setTerrain(x, y, base, base === TerrainType.GRANITE ? ' ' : '.', 0x333333);
        }
    }
    return g;
}

function stamp(g: Grid, x0: number, y0: number, w: number, h: number, t: TerrainType): void {
    for (let x = x0; x < x0 + w; x++) {
        for (let y = y0; y < y0 + h; y++) {
            g.setTerrain(x, y, t, t === TerrainType.CHASM ? ' ' : '.', 0x444444);
        }
    }
}

function count(g: Grid, t: TerrainType): number {
    let n = 0;
    for (let x = 0; x < g.width; x++) {
        for (let y = 0; y < g.height; y++) {
            if (g.getCell(x, y)?.terrain === t) n++;
        }
    }
    return n;
}

/** 8 向泛洪（terrainAllowsMove 口径）：从 start 可达的格数。 */
function floodSize(g: Grid, sx: number, sy: number): number {
    const seen = new Set<number>([sy * g.width + sx]);
    const queue: Array<{ x: number, y: number }> = [{ x: sx, y: sy }];
    while (queue.length > 0) {
        const p = queue.shift()!;
        for (const [dx, dy] of DIRS8) {
            const nx = p.x + dx;
            const ny = p.y + dy;
            if (nx < 0 || ny < 0 || nx >= g.width || ny >= g.height) continue;
            const key = ny * g.width + nx;
            if (seen.has(key)) continue;
            const cell = g.getCell(nx, ny);
            if (!cell || !terrainAllowsMove(cell.terrain)) continue;
            seen.add(key);
            queue.push({ x: nx, y: ny });
        }
    }
    return seen.size;
}

/** 8 向 BFS 路程（CE T_PATHING_BLOCKER 口径：深渊/岩浆/深水/硫矿/墙都挡路）；不可达 = -1。 */
function pathDistance(g: Grid, sx: number, sy: number, tx: number, ty: number): number {
    const pathable = (x: number, y: number): boolean => {
        const t = g.getCell(x, y)?.terrain;
        return t !== undefined && !(t === TerrainType.WALL || t === TerrainType.GRANITE
            || t === TerrainType.SECRET_DOOR || t === TerrainType.LOCKED_DOOR
            || t === TerrainType.WATER_DEEP || t === TerrainType.CHASM
            || t === TerrainType.LAVA || t === TerrainType.INERT_BRIMSTONE);
    };
    if (!pathable(sx, sy) || !pathable(tx, ty)) return -1;
    const dist = new Map<number, number>([[sy * g.width + sx, 0]]);
    const queue: Array<{ x: number, y: number }> = [{ x: sx, y: sy }];
    while (queue.length > 0) {
        const p = queue.shift()!;
        const d = dist.get(p.y * g.width + p.x)!;
        if (p.x === tx && p.y === ty) return d;
        for (const [dx, dy] of DIRS8) {
            const nx = p.x + dx;
            const ny = p.y + dy;
            if (nx < 0 || ny < 0 || nx >= g.width || ny >= g.height) continue;
            const key = ny * g.width + nx;
            if (dist.has(key) || !pathable(nx, ny)) continue;
            dist.set(key, d + 1);
            queue.push({ x: nx, y: ny });
        }
    }
    return -1;
}

describe('C-2 liquidType：深度门槛与液体→镶边契约（CE 2518-2550）', () => {
    it('对抗 AD-A1：深度门槛——D1-3 无岩浆/硫矿（深水或深渊），D4-16 无硫矿，D17-39 四类齐现', () => {
        // C-5 翻转：候选域恢复 CE 原样（含 2=深渊）。D1-3 的 randMin=1 →
        // 候选 {1,2} = 深水/深渊二选一，仍不得出现岩浆/硫矿。
        const shallow = drawEnsemble(1, 901);
        expect(shallow.every(r => r.deep === TerrainType.WATER_DEEP || r.deep === TerrainType.CHASM),
            'D1-3 应只有深水/深渊；出现别的液体 = 深度门槛写反').toBe(true);
        expect(shallow.some(r => r.deep === TerrainType.WATER_DEEP), 'D1 400 抽全无深水 = 深水候选丢失').toBe(true);
        expect(shallow.some(r => r.deep === TerrainType.CHASM), 'D1 400 抽全无深渊 = C-5 解禁未生效').toBe(true);

        const mid = drawEnsemble(10, 902); // D4-16：候选 {0,1,2}（岩浆/深水/深渊），无硫矿
        expect(mid.some(r => r.deep === TerrainType.LAVA), 'D10 候选域含岩浆，400 抽全无 = 岩浆被错误排除').toBe(true);
        expect(mid.every(r => r.deep !== TerrainType.INERT_BRIMSTONE),
            'D10 < minimumBrimstoneLevel(17)，出现硫矿 = 深度门槛写反').toBe(true);

        const deep = drawEnsemble(20, 903); // D17-39：候选 {0,1,2,3}
        expect(deep.some(r => r.deep === TerrainType.INERT_BRIMSTONE),
            'D20 ≥ 17，400 抽全无硫矿 = 硫矿被错误排除（深层不出硫矿）').toBe(true);
        expect(deep.some(r => r.deep === TerrainType.LAVA), 'D20 岩浆应仍然可选').toBe(true);
        // C-5 翻转：原断言"D20 无 CHASM"随解禁到期；新事实 = 四类液体全部齐现
        //（((3/4)^400) ≈ 0 的漏抽概率，漏即候选域又被收窄）。
        expect(deep.some(r => r.deep === TerrainType.CHASM), 'D20 400 抽全无深渊 = CHASM 候选被重新剔除').toBe(true);
        expect(deep.some(r => r.deep === TerrainType.WATER_DEEP), 'D20 深水候选丢失').toBe(true);
    });

    it('对抗 AD-A2：最深层特例——depth=40 恒深水（CE 2526-2528）', () => {
        const rows = drawEnsemble(CE_DEEPEST_LEVEL, 904);
        expect(rows.every(r => r.deep === TerrainType.WATER_DEEP),
            `deepestLevel(${CE_DEEPEST_LEVEL}) 应强制 rand=1（深水）；出现别的液体 = 最深层特例缺失`).toBe(true);
    });

    it('对抗 AD-A3：液体→镶边契约——岩浆不镶边、深水镶浅水×2、深渊镶渊缘×1、硫矿镶黑曜石×2', () => {
        for (const depth of [1, 4, 10, 17, 25, 39, 40]) {
            for (const r of drawEnsemble(depth, 905)) {
                if (r.deep === TerrainType.LAVA) {
                    expect([r.shallow, r.shallowWidth],
                        `D${depth} 岩浆不得有镶边（CE case 0：NOTHING/0）；得到 ${TerrainType[r.shallow]}×${r.shallowWidth}`)
                        .toEqual([TerrainType.NOTHING, 0]);
                } else if (r.deep === TerrainType.WATER_DEEP) {
                    expect([r.shallow, r.shallowWidth], `D${depth} 深水镶边应为浅水×2`).toEqual([TerrainType.WATER_SHALLOW, 2]);
                } else if (r.deep === TerrainType.CHASM) {
                    // C-5：CE case 2（Architect.c:2537-2539）——渊缘×1。
                    expect([r.shallow, r.shallowWidth], `D${depth} 深渊镶边应为渊缘×1`).toEqual([TerrainType.CHASM_EDGE, 1]);
                } else if (r.deep === TerrainType.INERT_BRIMSTONE) {
                    expect([r.shallow, r.shallowWidth], `D${depth} 硫矿镶边应为黑曜石×2`).toEqual([TerrainType.OBSIDIAN, 2]);
                }
            }
        }
    });

    it('C-5 已反转（原留痕：liquidType 全深度域永不产生深渊族——风险裁决 1）：' +
        '候选域恢复 CE 原样后，深渊族在全深度域出现且镶边契约恒成立', () => {
        // 原断言内容（留痕存档）：for 全深度域 expect(r.deep === CHASM ||
        // r.shallow === CHASM_EDGE).toBe(false)——"CHASM 禁令被解除却未同步
        // 坠落子系统"。C-5（坠落子系统）落地，按该留痕自带的指示反转：
        // 候选域中的 2 已加回、坠落本体已接（Game.playerFalls/monstersFall）。
        // 越界守卫（不放宽）：只认 {CHASM → CHASM_EDGE ×1} 这一种深渊族形态，
        // 且 D40 最深层特例（恒深水）不被解禁冲掉。
        let chasmDraws = 0;
        for (let depth = 1; depth <= CE_DEEPEST_LEVEL; depth++) {
            for (const r of drawEnsemble(depth, 906)) {
                if (r.deep === TerrainType.CHASM) {
                    chasmDraws++;
                    expect([r.shallow, r.shallowWidth],
                        `D${depth} 深渊族的镶边形态被改（CE case 2：CHASM_EDGE×1）`)
                        .toEqual([TerrainType.CHASM_EDGE, 1]);
                }
            }
        }
        expect(chasmDraws, '全深度域 400×40 抽全无深渊 = C-5 解禁未生效或又被剔除').toBeGreaterThan(0);
    });
});

describe('C-2 fillLakes：灌注、合并与镶边（CE 2554-2570 / 2692-2730）', () => {
    it('镶边只落在 FLOOR/DOOR 上，绝不把墙变成可走地形；欧氏圆盘半径=2 生效', () => {
        // 深水湖 x8-11/y6-8，湖外一圈地板 x7-12/y5-9，再外全是花岗岩。
        // D1 → 恒深水 + 浅水×2 镶边：圈上 18 格都距湖 ≤1（圆盘内）→ 全变浅水。
        const g = makeGrid(20, 15, TerrainType.GRANITE);
        stamp(g, 7, 5, 6, 5, TerrainType.FLOOR);
        const lake = new Set<number>();
        for (let x = 8; x < 12; x++) for (let y = 6; y < 9; y++) lake.add(y * 20 + x);

        rng.seedRandomGenerator(907);
        fillLakes(g, lake, 1);

        expect(count(g, TerrainType.WATER_DEEP), '湖体 12 格应全部灌注深水').toBe(12);
        expect(count(g, TerrainType.WATER_SHALLOW), '外圈 18 格地板应全部镶上浅水').toBe(18);
        for (let x = 0; x < 20; x++) {
            for (let y = 0; y < 15; y++) {
                const cell = g.getCell(x, y)!;
                if (x < 7 || x > 12 || y < 5 || y > 9) {
                    expect(cell.terrain === TerrainType.GRANITE && !terrainAllowsMove(cell.terrain),
                        `墙格 (${x},${y}) 被灌注/镶边改动（terrain=${TerrainType[cell.terrain]}）`).toBe(true);
                }
            }
        }
    });

    it('scanWidth=4 合并：切比雪夫距离 ≤4 的第二个湖并入同一组件、共用一次液体抽取', () => {
        const g = makeGrid(30, 15, TerrainType.GRANITE);
        stamp(g, 4, 6, 3, 3, TerrainType.FLOOR);
        stamp(g, 10, 6, 3, 3, TerrainType.FLOOR); // 与左湖间隔 3 格（≤4）
        const lake = new Set<number>();
        for (let x = 4; x < 7; x++) for (let y = 6; y < 9; y++) lake.add(y * 30 + x);
        for (let x = 10; x < 13; x++) for (let y = 6; y < 9; y++) lake.add(y * 30 + x);

        rng.seedRandomGenerator(908); // D1：深水/深渊二选一（C-5 解禁后候选域含 2）
        fillLakes(g, lake, 1);
        // C-5 注：原断言钉死"D1 恒深水 = 18 格 WATER_DEEP"，其前提（D1 候选域
        // 剔除 2）已随解禁到期。合并守卫本身不放宽：18 格湖体必须被 ±4 窗
        // 合并成一个组件、灌注同一种液体（深水或深渊二选一，CE liquidType）。
        const water = count(g, TerrainType.WATER_DEEP);
        const chasm = count(g, TerrainType.CHASM);
        expect(water + chasm, '两湖应被 ±4 窗合并成一个组件全部灌注（18 格湖体）').toBe(18);
        expect(water === 0 || chasm === 0, '一次抽取的液体必须单一（合并组件不得混液）').toBe(true);
        expect(lake.size).toBe(0);
    });
});

describe('C-2 cleanUpLakeBoundaries：只通同类湖（CE 1856-1912）', () => {
    /** 单行布局（y=4 行，上下各加一行厚度）：深|墙|深|墙|岩浆|墙|深 */
    function cleanupScene(): Grid {
        const g = makeGrid(20, 7, TerrainType.GRANITE);
        stamp(g, 1, 3, 4, 3, TerrainType.WATER_DEEP);  // x1-4
        stamp(g, 5, 3, 1, 3, TerrainType.WALL);        // x5  同类夹墙
        stamp(g, 6, 3, 4, 3, TerrainType.WATER_DEEP);  // x6-9
        stamp(g, 10, 3, 1, 3, TerrainType.WALL);       // x10 异类夹墙
        stamp(g, 11, 3, 4, 3, TerrainType.LAVA);       // x11-14
        stamp(g, 15, 3, 1, 3, TerrainType.WALL);       // x15 异类夹墙
        stamp(g, 16, 3, 3, 3, TerrainType.WATER_DEEP); // x16-18
        return g;
    }

    it('对抗 AD-A4：[深水][墙][岩浆] 异类湖之间的墙不得被打通；[深水][墙][深水] 则打通', () => {
        const g = cleanupScene();
        cleanUpLakeBoundaries(g);
        expect(g.getCell(5, 4)!.terrain, '同类（深水|深水）之间的夹墙应被打通成深水').toBe(TerrainType.WATER_DEEP);
        expect(g.getCell(10, 4)!.terrain, '异类（深水|岩浆）之间的夹墙必须保持 WALL——旗标相等判据缺失即在此翻红').toBe(TerrainType.WALL);
        expect(g.getCell(15, 4)!.terrain, '异类（岩浆|深水）之间的夹墙必须保持 WALL').toBe(TerrainType.WALL);
    });

    it('web 守卫：[深水][岩浆][深水] 的岩浆不得被改成深水（可走格不可删，登记的模型差异）', () => {
        const g = makeGrid(12, 5, TerrainType.GRANITE);
        stamp(g, 1, 2, 4, 1, TerrainType.WATER_DEEP);
        stamp(g, 5, 2, 1, 1, TerrainType.LAVA);
        stamp(g, 6, 2, 4, 1, TerrainType.WATER_DEEP);

        cleanUpLakeBoundaries(g);
        expect(g.getCell(5, 2)!.terrain,
            'CE 会把该岩浆改成深水（两层模型下不改变可走性）；web 单层模型下这会删掉一个可走格、可能切断干地——守卫必须跳过')
            .toBe(TerrainType.LAVA);
    });

    it('门不是边界：[深水][门][深水] 的门原样保留（CE DOOR 无 OBSTRUCTS 旗标）', () => {
        const g = makeGrid(12, 5, TerrainType.GRANITE);
        stamp(g, 1, 2, 4, 1, TerrainType.WATER_DEEP);
        stamp(g, 5, 2, 1, 1, TerrainType.DOOR);
        stamp(g, 6, 2, 4, 1, TerrainType.WATER_DEEP);

        cleanUpLakeBoundaries(g);
        expect(g.getCell(5, 2)!.terrain).toBe(TerrainType.DOOR);
    });

    it('幂等：饱和后的网格再跑一遍零改动', () => {
        const g = cleanupScene();
        cleanUpLakeBoundaries(g);
        const before: TerrainType[] = [];
        for (let y = 0; y < 7; y++) {
            for (let x = 0; x < 20; x++) before.push(g.getCell(x, y)!.terrain);
        }

        cleanUpLakeBoundaries(g);
        for (let x = 0; x < 20; x++) {
            for (let y = 0; y < 7; y++) {
                expect(g.getCell(x, y)!.terrain, `(${x},${y}) 第二遍清理不应有任何改动`).toBe(before[y * 20 + x]!);
            }
        }
    });
});

describe('C-2 buildABridge：桥只架深渊、且必须值得架（CE 2786-2876）', () => {
    /**
     * 桥梁场景（30×20）：整间大厅地板，中央深渊/深水带 x12-15。
     * tall=true：带体 y1-14 顶到上缘——顶部无绕行，只能从底部 y15-18 绕
     * （绕行远 → 中部行满足比值判据 → 必架桥）。
     * tall=false：带体 y7-10 居中——顶部底部都能绕（绕行近 → 比值恒不
     * 达标 → 必不架桥）。D1 时比值范围 211~322：居中带任意行的
     * 100*绕行/跨度 ≤ 200，任何 r 下都被否决。
     */
    function bridgeScene(fill: TerrainType, tall: boolean): Grid {
        const g = makeGrid(30, 20, TerrainType.GRANITE);
        stamp(g, 1, 1, 28, 18, TerrainType.FLOOR);
        stamp(g, 12, tall ? 1 : 7, 4, tall ? 14 : 4, fill);
        return g;
    }

    function bridgeUntilDone(g: Grid, depth: number): number {
        let built = 0;
        while (buildABridge(g, depth)) built++;
        return built;
    }

    it('对抗 AD-A5a：值得架的深渊带 → 架桥，且两岸可走路程真的变短（可走性只增不减）', () => {
        rng.seedRandomGenerator(910);
        const g = bridgeScene(TerrainType.CHASM, true);
        const sizeBefore = floodSize(g, 5, 1);
        // (5,1)→(24,1) 的直线横穿深渊带（y1-14 全被切）。路程用 CE
        // pathingDistance 口径（T_PATHING_BLOCKER 挡路）——这正是 CE 比值
        // 判据的度量；terrainAllowsMove 口径下深渊本来"可走"，量不出桥的价值。
        const distBefore = pathDistance(g, 5, 1, 24, 1);

        const built = bridgeUntilDone(g, 1);
        expect(built, '存在绕行遥远的深渊带时必须架桥').toBeGreaterThan(0);
        expect(count(g, TerrainType.BRIDGE), '桥格必须落地').toBeGreaterThan(0);
        expect(count(g, TerrainType.BRIDGE_EDGE), '两端岸格必须有桥端桩点').toBeGreaterThanOrEqual(2 * built);
        // 桥格只落在原深渊带上（CE：k 扫描只经过 CHASM 格）
        for (let x = 0; x < 30; x++) {
            for (let y = 0; y < 20; y++) {
                if (g.getCell(x, y)?.terrain === TerrainType.BRIDGE) {
                    expect(x >= 12 && x <= 15, `桥格 (${x},${y}) 落在深渊带之外`).toBe(true);
                }
            }
        }
        expect(terrainAllowsMove(TerrainType.BRIDGE), '桥地形必须可走').toBe(true);
        expect(floodSize(g, 5, 1), '架桥后可达格数不得减少').toBeGreaterThanOrEqual(sizeBefore);
        const distAfter = pathDistance(g, 5, 1, 24, 1);
        expect(distAfter, `架桥的意义是缩短两岸路程：before=${distBefore} after=${distAfter}` +
            '——架了桥却没变快 = 比值判据/落点判据失守').toBeLessThan(distBefore);
    });

    it('对抗 AD-A5b：深水带不可架桥（T_CAN_BE_BRIDGED = 深渊独占，CE Rogue.h:1953）', () => {
        rng.seedRandomGenerator(911);
        const g = bridgeScene(TerrainType.WATER_DEEP, true);
        expect(bridgeUntilDone(g, 1), '深水不是可架桥地形——架了即把 CAN_BE_BRIDGED 误当成湖阻断集').toBe(0);
    });

    it('对抗 AD-A5c：绕行不够远（带体居中、两侧都能绕）→ 比值判据否决，不架桥', () => {
        rng.seedRandomGenerator(912);
        const g = bridgeScene(TerrainType.CHASM, false);
        expect(bridgeUntilDone(g, 1), '绕行/跨度=200% 恒小于比值阈值(≥211%)，架了即比值判据缺失').toBe(0);
    });

    it('对抗 AD-A5d：桥线全程贴墙（无开敞段）→ foundExposure 否决，不架桥', () => {
        rng.seedRandomGenerator(913);
        const g = makeGrid(30, 12, TerrainType.GRANITE);
        stamp(g, 1, 5, 28, 1, TerrainType.FLOOR);  // 走廊行 y=5
        stamp(g, 12, 5, 6, 1, TerrainType.CHASM);  // 深渊 x12-17；y4/y6 全程是墙
        expect(bridgeUntilDone(g, 1), '全程贴墙的深渊不该架桥（CE 2822-2826 foundExposure）').toBe(0);
    });

    it('C-5 已反转（原断言：无绕行 → 不架桥，据"C-2 留形 pathingDistance 不可达=-1"）：' +
        '无绕行的全高深渊带恰恰必须架桥（CE Dijkstra.c:247 pdsClear 30000——' +
        '不可达距离 30000 使比值判据恒真，这正是桥存在的意义）', () => {
        // 原断言内容（留痕存档）：expect(bridgeUntilDone(g, 1)).toBe(0)——
        // 它把 C-2 留形实现里"不可达返回 -1"的错误行为钉成了合同。C-5 §六
        // 逐字重核判定该实现错误：CE pathingDistance 的距离图以 30000 清空
        // （PDS_FORBIDDEN=-1 是 calculateDistances 的代价标记，非距离值），
        // 100*30000/(k-i) > ratio 恒真 → 必须架桥。新事实：同一场景架桥 > 0。
        rng.seedRandomGenerator(914);
        const g = makeGrid(30, 20, TerrainType.GRANITE);
        stamp(g, 1, 1, 28, 18, TerrainType.FLOOR);
        stamp(g, 12, 1, 4, 18, TerrainType.CHASM); // y1-18 全高深渊，无任何绕行
        expect(bridgeUntilDone(g, 1), '干地被深渊带完全切断时必须架桥（比值判据对 30000 恒真）').toBeGreaterThan(0);
    });

    it('决定性：同种子同网格 → 架桥决策逐一相同', () => {
        const run = (): { built: number, bridge: number, edge: number } => {
            rng.seedRandomGenerator(915);
            const g = bridgeScene(TerrainType.CHASM, true);
            const built = bridgeUntilDone(g, 1);
            return { built, bridge: count(g, TerrainType.BRIDGE), edge: count(g, TerrainType.BRIDGE_EDGE) };
        };
        expect(run()).toEqual(run());
    });
});

describe('C-2 管线常数', () => {
    it('DCOLS/DROWS 与真实网格尺寸一致（LakeSystem 边界哨兵）', () => {
        expect(DCOLS).toBe(79);
        expect(DROWS).toBe(29);
    });
});
