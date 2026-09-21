/**
 * b_4b_item_placement.test.ts —— B-4b：物品「落在哪 / 多少个」的验收测试。
 *
 * 覆盖（任务书 §5.1）：
 *   1. 每层物品数量 = CE 无上界几何分布（对抗：均匀 3-6 实现必红）
 *   2. 热力图密门偏置（行为终点；对抗① +=3000→+=10 必红、对抗② ==→<= 必红）
 *   3. 归零 pass：heat 0 于墙/走廊弧/割点/环/机器格；50000 孤岛改 WALL
 *   4. 选点扫描序 i 外 j 内（对抗③的守卫；j 外 i 内必红）
 *   5. coolHeatMapAt 同热区（== currentHeat 才降温；<= 必红）
 *   6. 金币：堆数带 / quantity 带 / 拾取 += quantity / 局产量贴 aggregate 界
 *   7. 钥匙 == 锁（P1-50 的 140-166 已灭）；key.keyLoc 指向 LOCKED_DOOR
 *   8. 食物/力量药水：不落走廊（arc ≤ 1）；randomMatchingLocation 单元
 *   9. 食物保底：foodSpawned 累计曲线贴合 POW_FOOD 下限
 *
 * 哨兵纪律：全部为性质/分布/区间断言与 rng.randomNumbersGenerated 增量，
 * 不锚定 RNG 流绝对位置（任务书 §5.4）。
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame } from './harness';
import { Grid, DCOLS, DROWS, TerrainType } from '../engine/Map/Grid';
import { isPathingBlocker, obstructsItems, TERRAIN_FLAGS, TM_PROMOTES_WITH_KEY } from '../engine/Map/TerrainCatalog';
import { ItemSpawnHeatMap, passableArcCount, randomMatchingLocation } from '../engine/Items/ItemSpawnHeatMap';
import { analyzeLoopMap } from '../engine/Map/LoopMap';
import { ItemCategory } from '../engine/Items/Item';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { rng } from '../engine/Random';
import type { Pos } from '../types';

// ── 合成地图工具 ────────────────────────────────────────────────────────────

/** 全墙底板（Cell 默认 NOTHING 旗标为 0，会骗过泛洪——必须显式铺花岗岩）。 */
function solidGrid(): Grid {
    const g = new Grid(DCOLS, DROWS);
    for (let x = 0; x < DCOLS; x++) {
        for (let y = 0; y < DROWS; y++) {
            g.setTerrain(x, y, TerrainType.GRANITE, ' ', 0);
        }
    }
    return g;
}

function carve(g: Grid, x0: number, y0: number, x1: number, y1: number): void {
    for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
            g.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
        }
    }
}

function hline(g: Grid, x0: number, x1: number, y: number): void {
    for (let x = x0; x <= x1; x++) g.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
}

function put(g: Grid, x: number, y: number, t: TerrainType): void {
    g.setTerrain(x, y, t, '+', 0xaa8844);
}

/** 四层旗标并集的「物品非法格」判定（与生产判据同式，供真实链违例检查）。 */
function cellIsIllegalForItems(game: { grid: Grid }, x: number, y: number): boolean {
    const cell = game.grid.getCell(x, y);
    if (!cell) return true;
    for (const t of cell.layers) {
        if (t === TerrainType.NOTHING) continue;
        if (obstructsItems(t) || isPathingBlocker(t)) return true;
    }
    return false;
}

// ── 1. 热力图单元 ───────────────────────────────────────────────────────────

describe('B-4b 热力图单元（CE Items.c:463-535 / 610-633）', () => {
    it('T1 泛洪：普通房恒 5（无距离衰减）、穿门 +10；门格/走廊在归零 pass 清零', () => {
        const g = solidGrid();
        carve(g, 10, 10, 16, 15); // 房 A（上行梯）
        put(g, 17, 12, TerrainType.DOOR);
        hline(g, 18, 21, 12);
        put(g, 22, 12, TerrainType.DOOR);
        carve(g, 23, 10, 29, 15); // 房 B（隔两道门）
        const hm = ItemSpawnHeatMap.build(g, { x: 10, y: 10 }, { machineCells: new Set() });
        expect(hm.heatAt(10, 10)).toBe(5);            // 泛洪源
        expect(hm.heatAt(16, 15)).toBe(5);            // 房 A 远角仍 5（无距离衰减）
        expect(hm.heatAt(17, 12)).toBe(0);            // 单格门 = chokepoint → 归零（CE 同）
        expect(hm.heatAt(20, 12)).toBe(0);            // 1 宽走廊 = 走廊弧 → 归零（CE 同）
        expect(hm.heatAt(29, 10)).toBe(25);           // 房 B 隔两道门：5+10+10（门 +10 逐门累加）
    });

    it('T2 密门偏置（行为终点）：密门房的选中率远超面积占比——对抗①（+=3000→+=10）必红', () => {
        const g = solidGrid();
        carve(g, 10, 8, 17, 21);                    // 房 A 8×14（楼梯）
        put(g, 10, 10, TerrainType.STAIRS_UP);
        put(g, 18, 9, TerrainType.DOOR);            // 普通门 → 北走廊
        hline(g, 19, 22, 9);
        carve(g, 23, 6, 30, 12);                    // 房 B 8×7（普通门后）
        put(g, 18, 19, TerrainType.SECRET_DOOR);    // 密门 → 南走廊
        hline(g, 19, 22, 19);
        carve(g, 23, 16, 30, 22);                   // 房 C 8×7（密门后）
        const hm = ItemSpawnHeatMap.build(g, { x: 10, y: 10 }, { machineCells: new Set() });
        const inRoom = (p: Pos) =>
            (p.x >= 23 && p.x <= 30 && p.y >= 6 && p.y <= 12) ? 'B'
                : (p.x >= 23 && p.x <= 30 && p.y >= 16 && p.y <= 22) ? 'C' : '-';
        let b = 0, c = 0;
        const N = 600;
        for (let i = 0; i < N; i++) {
            const p = hm.getItemSpawnLoc();
            if (!p) continue;
            const r = inRoom(p);
            if (r === 'B') b++;
            if (r === 'C') c++;
        }
        // 两房等面积；密门房 heat≈3005/格、普通门房 15/格 → C 的选中份额
        // 应远高于 B（CE："often several items in well hidden secret rooms"）。
        expect(c, `密门房选中 ${c}/${N}，普通门房 ${b}/${N}——密门偏置缺失`).toBeGreaterThan(N * 0.4);
        expect(c, `密门房(${c}) 未显著高于普通门房(${b})`).toBeGreaterThan(b * 10);
    });

    it('T3 归零 pass：走廊弧/环/机器格/物品阻挡格 heat=0', () => {
        const g = solidGrid();
        carve(g, 10, 10, 20, 20);        // 大房
        // 房内挖一圈 1 宽的环（环形走廊）
        carve(g, 13, 13, 17, 17);
        for (let x = 14; x <= 16; x++) {
            for (let y = 14; y <= 16; y++) {
                if (x === 15 && y === 15) continue;
                g.setTerrain(x, y, TerrainType.GRANITE, ' ', 0);
            }
        }
        // (15,15) 成为中心柱（环眼）；环格 (13..17,13/17) 与 (13/17,14..16) 在环上
        const machine = new Set<number>();
        machine.add(10 * DCOLS + 10); // (x=10, y=10) 设为机器格
        const hm = ItemSpawnHeatMap.build(g, { x: 11, y: 11 }, { machineCells: machine });
        // 机器格 → 0
        expect(hm.heatAt(10, 10)).toBe(0);
        // 环上格：IN_LOOP → 0（C-0 的 analyzeLoopMap 口径）
        const ringCells: Array<[number, number]> = [
            [13, 13], [15, 13], [17, 13], [13, 15], [17, 15], [13, 17], [15, 17], [17, 17],
        ];
        for (const [x, y] of ringCells) {
            expect(hm.heatAt(x, y), `环上格(${x},${y}) 应为 0`).toBe(0);
        }
        // 普通开阔格仍在
        expect(hm.heatAt(11, 19)).toBeGreaterThan(0);
        expect(hm.currentTotalHeat).toBeGreaterThan(0);
    });

    it('T4 失败保护：真孤岛（8 向也不可达）→ heat 0 且改 WALL；对角可达的凹格保留地形', () => {
        const g = solidGrid();
        carve(g, 10, 10, 14, 14);          // 主房
        carve(g, 20, 20, 21, 21);          // 孤岛甲：完全封闭（四周全花岗岩，无对角接触）
        // 对角单点连接的凹岛乙：web 玩家 8 向可达，4 向泛洪不可达
        //（主房角 (14,14) ⇗ (15,15) ⇗ (16,16) ⇗ 凹岛 (17,17)）
        g.setTerrain(15, 15, TerrainType.FLOOR, '.', 0x888888);
        g.setTerrain(16, 16, TerrainType.FLOOR, '.', 0x888888);
        carve(g, 17, 17, 18, 18);
        const hm = ItemSpawnHeatMap.build(g, { x: 10, y: 10 }, { machineCells: new Set() });
        // 甲：两侧都不可达 → CE 失败保护改墙
        expect(hm.heatAt(20, 20)).toBe(0);
        expect(hm.heatAt(21, 21)).toBe(0);
        expect(g.getCell(20, 20)!.terrain).toBe(TerrainType.WALL);
        expect(g.getCell(21, 21)!.terrain).toBe(TerrainType.WALL);
        // 乙：4 向泛洪不可达 → heat 0（无物品偏置），但玩家 8 向可达 → 保留地形
        expect(hm.heatAt(17, 17)).toBe(0);
        expect(hm.heatAt(18, 18)).toBe(0);
        expect(g.getCell(17, 17)!.terrain, '对角可达的凹格不应被失败保护改墙（web 8 向口径）').toBe(TerrainType.FLOOR);
        expect(g.getCell(18, 18)!.terrain).toBe(TerrainType.FLOOR);
        // 主房不受影响
        expect(hm.heatAt(12, 12)).toBe(5);
    });

    it('T5 选点扫描序 = i 外 j 内（CE Items.c:520-528）——对抗③（换 j 外 i 内）必红', () => {
        const g = solidGrid();
        // 全图无门（所有 heat 格同为 5），靠几何错位使两种扫描序的第一格不同：
        //   i 外层（x 优先）：x=10 列最先 → (10,12)
        //   j 外层（y 优先）：y=8 行最先 → (12,8)
        carve(g, 10, 12, 14, 14);   // 房 1：x∈[10,14], y∈[12,14]
        carve(g, 12, 8, 16, 10);    // 房 2：x∈[12,16], y∈[8,10]
        carve(g, 14, 11, 14, 11);   // 房 1 ↔ 房 2 竖向连接（保证连通、不成环）
        hline(g, 14, 28, 13);       // 房 1 连到东侧楼梯房
        carve(g, 28, 10, 32, 16);   // 楼梯房
        const hm = ItemSpawnHeatMap.build(g, { x: 30, y: 13 }, { machineCells: new Set() });
        expect(hm.heatAt(10, 12)).toBe(5);
        expect(hm.heatAt(12, 8)).toBe(5);
        // 钉死 randIndex=1 → 扫描序遇到的第一个 heat 格
        const orig = rng.randRange.bind(rng);
        (rng as unknown as { randRange: unknown }).randRange = () => 1;
        try {
            const p = hm.getItemSpawnLoc();
            expect(p, '应能选点').not.toBeNull();
            expect(p!.x, 'i 外层扫描：x=10 列先于 y=8 行；选中 (12,8) 说明扫描序被换成 j 外层').toBe(10);
            expect(p!.y).toBe(12);
        } finally {
            (rng as unknown as { randRange: unknown }).randRange = orig;
        }
    });

    it('T6 coolHeatMapAt 只降「同热区」（== currentHeat）——对抗②（<=）必红', () => {
        const g = solidGrid();
        carve(g, 10, 10, 16, 15);              // 房 A（heat 5）
        put(g, 17, 12, TerrainType.DOOR);      // 门格（chokepoint → 0）
        carve(g, 18, 8, 30, 14);               // 门后房 B（heat 15，开阔非走廊）
        const hm = ItemSpawnHeatMap.build(g, { x: 10, y: 10 }, { machineCells: new Set() });
        expect(hm.heatAt(20, 12)).toBe(15);
        // 在房 B 的 (20,12) 降温：11×11 窗口 = x∈[15,25], y∈[7,17]
        hm.coolHeatMapAt(20, 12);
        // 窗口**内**的 heat-5 格（(15,11) 属房 A）不在同热区，不被降
        expect(hm.heatAt(15, 11), '窗口内的 heat-5 格不在同热区，不应被降').toBe(5);
        expect(hm.heatAt(12, 12), '窗口外的 heat-5 格不受影响').toBe(5);
        // 同热区（15）的窗口内格 → max(1, 15/10)=1
        expect(hm.heatAt(19, 12)).toBe(1);
        expect(hm.heatAt(21, 12)).toBe(1);
        // 被选格本体归零
        expect(hm.heatAt(20, 12)).toBe(0);
        // 窗口外（x=26 > 25）的同热区格保持 15
        expect(hm.heatAt(26, 12)).toBe(15);
    });
});

// ── 2. 数量与金币（真实生成链） ─────────────────────────────────────────────

interface PopSpy {
    counts: Map<number, number[]>; // depth → 每层人口件数
    items: Array<{ depth: number; item: any }>;
}

/** 挂钩 spawnPopulateItem 统计每层人口物品数与实例（不改变行为）。 */
function spyPopulation(game: any): PopSpy {
    const spy: PopSpy = { counts: new Map(), items: [] };
    const orig = game.spawnPopulateItem.bind(game);
    let depth = game.depth;
    const origGenerate = game.generateDepth.bind(game);
    game.generateDepth = function (up: boolean, first: boolean) {
        depth = game.depth;
        return origGenerate(up, first);
    };
    game.spawnPopulateItem = function (d: number, off: number) {
        const item = orig(d, off);
        if (!spy.counts.has(depth)) spy.counts.set(depth, []);
        spy.items.push({ depth, item });
        return item;
    };
    // 每层循环结束后调用方需自行收口；这里用 items 数组按层分段统计
    (game as any).__b4bSpy = spy;
    return spy;
}

describe('B-4b 每层数量与落位（真实生成链）', () => {
    it('T7 数量 = 3 + 无上界几何(60%) + 深度加成；均匀 3-6 实现必红', () => {
        const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
        const allCounts: Array<{ d: number; n: number }> = [];
        for (const seed of SEEDS) {
            const game: any = createHeadlessGame(seed);
            const spy = spyPopulation(game);
            for (let d = 2; d <= 6; d++) {
                const before = spy.items.length;
                game.depth = d;
                game.generateDepth(false, false);
                allCounts.push({ d, n: spy.items.length - before });
            }
        }
        for (const { d, n } of allCounts) {
            expect(n, `seed 组 D${d} 人口件数 ${n} < 下限`).toBeGreaterThanOrEqual(d <= 2 ? 5 : d <= 4 ? 4 : 3);
        }
        const maxN = Math.max(...allCounts.map(c => c.n));
        expect(maxN, `样本最大值 ${maxN} < 9：无上界几何分布的长尾缺失（均匀 3-6 的特征）`).toBeGreaterThanOrEqual(9);
        expect(allCounts.some(c => c.n >= 7), '没有任何一层 ≥7 件：仍是 3-6 有上界分布').toBe(true);
    });

    it('T7b 人口物品的落位性质：非机器 / 非环 / 非走廊弧 / 无物品阻挡旗标', () => {
        const game: any = createHeadlessGame(424242);
        const spy = spyPopulation(game);
        for (let d = 2; d <= 10; d++) {
            game.depth = d;
            game.generateDepth(false, false);
        }
        const loop = analyzeLoopMap(game.grid);
        const popItems = spy.items.filter(s => s.depth === game.depth && s.item).map(s => s.item);
        expect(popItems.length, '本层应有真实人口物品').toBeGreaterThan(0);
        // V-1a 修正断言范围（原断言对全部人口物品要求 IN_LOOP=false）：
        // CE Items.c:729-734——食物与力量药水**不走热力图**，落位是
        // do { randomMatchingLocation(FLOOR, NOTHING, -1) } while (passableArcCount > 1)，
        // 只回避走廊弧；randomMatchingLocation 不查环，CE 本就允许它们落
        // IN_LOOP 格（V-1a 移动生成流后 seed424242/D10 实测一枚干粮落环上格，
        // 与 CE 语义一致，非回归）。热力图路径物品的 IN_LOOP 断言保留原严度。
        const followsHeatMap = (it: any) => !(it.category === ItemCategory.FOOD
            || (it.category === ItemCategory.POTION && (it as any).consumableId === 'potion_of_strength'));
        for (const it of popItems) {
            const { x, y } = it.loc;
            const idx = y * DCOLS + x;
            expect(game.machineCells.has(idx), `人口物品 (${x},${y}) 落机器格`).toBe(false);
            if (followsHeatMap(it)) {
                expect(loop[x]![y], `人口物品 (${x},${y}) 落 IN_LOOP 格`).toBe(false);
            }
            expect(passableArcCount(game.grid, x, y), `人口物品 (${x},${y}) 落走廊弧格`).toBeLessThanOrEqual(1);
            expect(cellIsIllegalForItems(game, x, y), `人口物品 (${x},${y}) 落物品非法格`).toBe(false);
        }
    });

    it('T8 金币：堆数在 CE 公式带内、quantity 在 rand_range(50+d10, 100+d15) 带内', () => {
        for (const seed of [424242, 777, 31337]) {
            const game: any = createHeadlessGame(seed);
            for (let d = 1; d <= 12; d++) {
                if (d > 1) { game.depth = d; game.generateDepth(false, false); }
                const golds = game.items.filter((i: any) => i.category === ItemCategory.GOLD);
                // 公式带：base = min(5, floor(d/4))；bonus ∈ [0,4] 且 ≤10；D≥6 调度 ±2
                const base = Math.min(5, Math.floor(d / 4));
                const lo = Math.max(0, base - (d >= 6 ? 2 : 0));
                const hi = Math.min(10, base + 4 + (d >= 6 ? 2 : 0));
                expect(golds.length, `seed${seed} D${d} 金币堆数 ${golds.length} 超出公式带 [${lo},${hi}]`)
                    .toBeGreaterThanOrEqual(lo);
                expect(golds.length).toBeLessThanOrEqual(hi);
                for (const gItem of golds) {
                    expect(gItem.quantity, `seed${seed} D${d} quantity ${gItem.quantity} 低于下限`)
                        .toBeGreaterThanOrEqual(50 + d * 10);
                    expect(gItem.quantity, `seed${seed} D${d} quantity ${gItem.quantity} 高于上限`)
                        .toBeLessThanOrEqual(100 + d * 15);
                }
            }
        }
    });

    it('T9 金币产量调度：整局 goldGenerated 贴 aggregate 界带（测量带 [29529,30522] ± 余量）', () => {
        const totals: number[] = [];
        for (const seed of [424242, 777, 31337]) {
            const game: any = createHeadlessGame(seed);
            for (let d = 2; d <= 26; d++) { game.depth = d; game.generateDepth(false, false); }
            totals.push(game.goldGenerated);
        }
        for (const t of totals) {
            // CE d=25 界带 [26353, 28853]；终值还含 D26 当层的注入（CE 的比较
            // 发生在进层时、当层金币之前），测量带 29.5k-30.5k，放 ±2500。
            expect(t, `goldGenerated ${t} 低于产量调度带`).toBeGreaterThanOrEqual(27000);
            expect(t, `goldGenerated ${t} 高于产量调度带`).toBeLessThanOrEqual(33000);
        }
    });

    it('T10 拾取入账 = quantity（不再是硬编码 +10）', () => {
        const game: any = createHeadlessGame(424242);
        const gold = ItemLoader.spawnGold(137, game.player.loc.x, game.player.loc.y)!;
        game.items = [gold];
        const before = game.stats.gold;
        game.handlePlayerAction('pickup', undefined, 'system');
        expect(game.player.inventory.items.some((i: any) => i.category === ItemCategory.GOLD), '金币应已入包').toBe(true);
        expect(game.stats.gold, '拾取后账面应恰增加 quantity').toBe(before + gold.quantity);
    });
});

// ── 3. 钥匙 == 锁 ───────────────────────────────────────────────────────────

describe('B-4b 钥匙由锁具驱动（P1-50 的 140-166 已灭）', () => {
    it('T11 每层：每把 LOCKED_DOOR 恰有一钥；其余 KEY 的绑定必须能认到本层的「钥匙消费点」', () => {
        // ★ V-2b-7 口径扩展（不放宽，是**补全**）★
        //
        // 原断言：「钥匙数 == LOCKED_DOOR 锁数；每把钥匙 keyLoc 指向本层一把锁」。
        // 那是 V-2b-6 之前的口径——当时 web 的 KEY 物品只有"每锁一把补偿钥匙"
        // 一种来源。V-2b-6 引入 10 号 Kennel 的 cage key（keyLoc 带**机器号**
        // 条目，多笼共享一把）、V-2b-7 又引入 12 号水晶球（keyLoc 指向
        // ALTAR_KEYHOLE），CE 的"钥匙消费点"因此不止锁门一种：
        //   TM_PROMOTES_WITH_KEY 的持有 tile（Rogue.h:1961）= 锁门 /
        //   锁闭铁笼（Globals.c:371）/ 带孔祭坛（:363）——三者都在 CE 里吃钥匙。
        // 于是本用例改成两条**更强**的判据：
        //   ① 锁门侧（补偿循环的本意，原样保留）：本层 LOCKED_DOOR 的数量
        //      必须恰等于"绑定能认到某把锁"的钥匙数，且这些钥匙的**每一条**
        //      绑定都指向本层的锁——多一把/少一把都红；
        //   ② 其余 KEY（笼钥匙/水晶球…）：**不得有悬空绑定**——至少一条
        //      绑定能认到本层的某个 TM_PROMOTES_WITH_KEY 格（坐标形态），
        //      或带非零机器号并与某个消费点格的 machineNumber 相同
        //     （SKELETON_KEY 形态，CE Architect.c:1526 addMachineNumberToKey）。
        // 对抗：把 cage key / 水晶球的绑定写坏（坐标与机器号都对不上）→
        // 判据②红；补偿循环多给一把钥匙 → 判据①红。
        const promotesWithKey = new Set<TerrainType>();
        for (const name of Object.keys(TerrainType).filter(k => Number.isNaN(Number(k)))) {
            const t = (TerrainType as unknown as Record<string, TerrainType>)[name]!;
            if ((TERRAIN_FLAGS[t].mechFlags & TM_PROMOTES_WITH_KEY) !== 0) promotesWithKey.add(t);
        }
        expect(promotesWithKey.has(TerrainType.LOCKED_DOOR), 'LOCKED_DOOR 必须带 TM_PROMOTES_WITH_KEY').toBe(true);
        expect(promotesWithKey.has(TerrainType.MONSTER_CAGE_CLOSED), '铁笼同（Globals.c:371）').toBe(true);
        expect(promotesWithKey.has(TerrainType.ALTAR_KEYHOLE), '带孔祭坛同（Globals.c:363）').toBe(true);

        for (const seed of [424242, 777, 20260913, 31337, 42, 2026]) {
            const game: any = createHeadlessGame(seed);
            for (let d = 1; d <= 26; d++) {
                if (d > 1) { game.depth = d; game.generateDepth(false, false); }
                let locks = 0;
                const lockCells = new Set<string>();
                const consumerCells = new Set<string>();
                const consumerMachines = new Set<number>();
                for (let x = 0; x < DCOLS; x++) {
                    for (let y = 0; y < DROWS; y++) {
                        const cell = game.grid.getCell(x, y);
                        if (!cell) continue;
                        if (cell.terrain === TerrainType.LOCKED_DOOR) {
                            locks++;
                            lockCells.add(`${x},${y}`);
                        }
                        if (promotesWithKey.has(cell.terrain)) {
                            consumerCells.add(`${x},${y}`);
                            if (cell.machineNumber !== 0) consumerMachines.add(cell.machineNumber);
                        }
                    }
                }
                const keys = game.items.filter((i: any) => i.category === ItemCategory.KEY);
                // ① 锁门侧
                const lockKeys = keys.filter((k: any) => k.keyLoc.some((b: any) => lockCells.has(`${b.loc.x},${b.loc.y}`)));
                expect(lockKeys.length, `seed${seed} D${d} 认锁的钥匙 ${lockKeys.length} != 锁 ${locks}`).toBe(locks);
                for (const k of lockKeys) {
                    for (const b of k.keyLoc) {
                        expect(lockCells.has(`${b.loc.x},${b.loc.y}`),
                            `seed${seed} D${d} 认锁钥匙的 keyLoc (${b.loc.x},${b.loc.y}) 不是本层的 LOCKED_DOOR`).toBe(true);
                    }
                }
                // ② 其余 KEY：绑定不得悬空
                for (const k of keys) {
                    expect(k.keyLoc.length, `seed${seed} D${d} 钥匙无绑定`).toBeGreaterThanOrEqual(1);
                    const resolvable = k.keyLoc.some((b: any) => {
                        if (b.loc.x === 0 && b.loc.y === 0) return b.machine !== 0 && consumerMachines.has(b.machine);
                        if (b.machine !== 0 && consumerMachines.has(b.machine)) return true;
                        return consumerCells.has(`${b.loc.x},${b.loc.y}`);
                    });
                    expect(resolvable,
                        `seed${seed} D${d} 钥匙 ${k.itemId ?? k.id ?? '?'} 的 keyLoc 全部悬空：` +
                        JSON.stringify(k.keyLoc) + `（本层消费点 ${[...consumerCells].join(' ')}）`).toBe(true);
                }
            }
        }
    });
});

// ── 4. 食物 / 力量药水 ──────────────────────────────────────────────────────

describe('B-4b 食物与力量药水的落位例外与保底', () => {
    it('T12 食物/力量药水不落走廊（passableArcCount ≤ 1）、不落机器格', () => {
        let seen = 0;
        for (const seed of [424242, 777, 31337]) {
            const game: any = createHeadlessGame(seed);
            for (let d = 1; d <= 26; d++) {
                if (d > 1) { game.depth = d; game.generateDepth(false, false); }
                for (const it of game.items) {
                    const isFood = it.category === ItemCategory.FOOD;
                    const isStr = it.category === ItemCategory.POTION && it.consumableId === 'potion_of_strength';
                    if (!isFood && !isStr) continue;
                    seen++;
                    const { x, y } = it.loc;
                    expect(passableArcCount(game.grid, x, y), `seed${seed} D${d} 食物/力量落走廊 (${x},${y})`).toBeLessThanOrEqual(1);
                    expect(game.machineCells.has(y * DCOLS + x), `seed${seed} D${d} 食物/力量落机器格`).toBe(false);
                }
            }
        }
        expect(seen, '样本应覆盖到足量食物').toBeGreaterThanOrEqual(20);
    });

    it('T13 randomMatchingLocation：只回 FLOOR 地基层、无液体、避开占用/机器/物品阻挡格', () => {
        // 注：CE 里「不落走廊弧」是调用方（populateItems）的 do-while 职责，
        // 不在 randomMatchingLocation 本体内——本条只钉本体语义；弧排除由 T12 覆盖。
        const g = solidGrid();
        carve(g, 10, 10, 20, 20);
        hline(g, 21, 30, 15); // 1 宽走廊（允许被本体返回，调用方负责重掷）
        carve(g, 31, 10, 40, 20);
        g.setTerrain(33, 12, TerrainType.WATER_DEEP, '~', 0);
        const occupied = new Set<string>(['35,15', '36,16']);
        const machine = new Set<number>();
        machine.add(18 * DCOLS + 18); // (18,18)
        for (let i = 0; i < 300; i++) {
            const p = randomMatchingLocation(g, {
                dungeonType: TerrainType.FLOOR,
                liquidType: TerrainType.NOTHING,
                isOccupied: (x, y) => occupied.has(`${x},${y}`),
                isMachineCell: (x, y) => machine.has(y * DCOLS + x),
            });
            expect(p).not.toBeNull();
            const cell = g.getCell(p!.x, p!.y)!;
            expect(cell.layers[0], `(${p!.x},${p!.y}) 地基层非 FLOOR`).toBe(TerrainType.FLOOR);
            expect(cell.layers[1], `(${p!.x},${p!.y}) 液体层非空`).toBe(TerrainType.NOTHING);
            expect(occupied.has(`${p!.x},${p!.y}`), '返回了占用格').toBe(false);
            expect(machine.has(p!.y * DCOLS + p!.x), '返回了机器格').toBe(false);
            expect(cell.terrain === TerrainType.WATER_DEEP || cell.terrain === TerrainType.LAVA, '返回了物品阻挡格').toBe(false);
        }
    });

    it('T14 食物保底：foodSpawned 累计曲线不跌破 POW_FOOD 下限（长局不饿死）', () => {
        for (const seed of [424242, 777]) {
            const game: any = createHeadlessGame(seed);
            for (let d = 2; d <= 26; d++) { game.depth = d; game.generateDepth(false, false); }
            // CE Items.c:685-691 的静态下限（offset 取最悲观 -2）：保底停止时
            // (fs+600)*262144 > (POW[25] - 2*65536)*810；最后一发食物可能仍
            // 未越过阈值（一份口粮 ≤1800），再放两份余量。
            const pow26 = ItemLoader.CE_POW_FOOD[25]!;
            const threshold = Math.floor((pow26 - 2 * 65536) * 1800 * 45 / 100 / (4 * 65536)) - 600;
            const floor = threshold - 3 * 1800;
            expect(game.foodSpawned, `seed${seed} foodSpawned ${game.foodSpawned} < 保底下限 ${floor}`).toBeGreaterThanOrEqual(floor);
            // 上限 sanity：保底不是无脑撒粮——不会越过最乐观阈值太多
            const ceil = Math.floor((pow26 + 2 * 65536) * 1800 * 45 / 100 / (4 * 65536)) + 3 * 1800;
            expect(game.foodSpawned, `seed${seed} foodSpawned ${game.foodSpawned} 越过保底上限 ${ceil}`).toBeLessThanOrEqual(ceil);
        }
    });
});
