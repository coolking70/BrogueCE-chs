/**
 * src/test/t_1_tail.test.ts — T-1 尾账合并轮的验收测试（四件事的行为终点）
 *
 * 对应关系（任务书 §5）：
 *   A  spawnBlueprintItem 无 id 分支改走 chooseKind 基表频率加权
 *      （CE Architect.c:1504 generateItem(cat, -1) → Items.c:171 makeItemInto
 *      → Items.c:409-420 chooseKind；全表加权、无深度门、不带计量覆盖）
 *      → A 组：大样本种类分布 + 整局附魔卷轴带。
 *   B  DF_CRYSTAL_WALL 入 DF 目录 + AutoGenerator index 1 / 33 接线
 *      （CE Globals.c:607 DF 条目；GlobalsBrogue.c:115/151 表行）→ B 组。
 *   C  CE_POW_FOOD 头注订正（40 → 50 项）→ C 组（表钉死，防回退）。
 *   D  c_4b F1 扫描器块注释剥离 → 断言在 c_4b F1 的合成探针里（本文件不重复）。
 *
 * 对抗性设计（每条都能在具体错误实现下翻红）：
 *   AD-A1 enchant/life/strength/dart === 0——等概率实现给出 1/13~1/15 → 红
 *   AD-A2 identify 占比带 [0.19, 0.26]——等概率实现 1/13≈0.077 → 红
 *   AD-A3 单次蓝图抽取恰消耗 1 个随机数（漏斗式多掷/少掷 → 红）
 *   AD-B1 index 1/33 表行与 DF 条目字段逐值钉死（抄错 CE 原值 → 红）
 *   AD-B2 DFF_CLEAR_OTHER_TERRAIN 语义：水晶格其它层必须被清、
 *         未落格必须保留（漏清/全局清 → 红）
 *   AD-B3 index 33 terrain 分支真实行使（carrier 忘改 → 600 次 built 全 0 → 红）
 *
 * 哨兵纪律：①增量口径（AD-A3）+ ③性质断言（分布/存在性/带），
 * 不锚定 RNG 流绝对位置。整局带为固定 seed 的确定性测量带（非流位置）。
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame } from './harness';
import { Architect } from '../engine/Generator/Architect';
import { AUTO_GENERATOR_CATALOG, runAutogenerators } from '../engine/Map/AutoGenerator';
import { DUNGEON_FEATURE_CATALOG, DFF_CLEAR_OTHER_TERRAIN, DF } from '../engine/Map/DungeonFeatureCatalog';
import { DungeonLayer, Grid, TerrainType } from '../engine/Map/Grid';
import { TERRAIN_FLAGS, T_PATHING_BLOCKER } from '../engine/Map/TerrainCatalog';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { rng } from '../engine/Random';
import type { Game } from '../engine/Core/Game';
import type { Item } from '../engine/Items/Item';

type GameWithGen = Omit<Game, 'generateDepth'> & {
    generateDepth(isGoingUp: boolean, isFirstLevel: boolean): void;
};

type BlueprintSpawn = {
    spawnBlueprintItem(category: string, id: string | undefined, x: number, y: number, depth: number): Item | null;
};

const kindIdOf = (item: Item | null): string =>
    ((item as unknown as { consumableId?: string; identityId?: string }) ?? {}).consumableId
    ?? (item as unknown as { identityId?: string }).identityId
    ?? '';

/** 武器/护甲无 consumableId/identityId，落显示名——归一成 json id（b_4a 同款）。 */
const NAME_TO_ID: Record<string, string> = {
    'Dagger': 'dagger', 'Sword': 'sword', 'Broadsword': 'broadsword', 'Whip': 'whip',
    'Rapier': 'rapier', 'Flail': 'flail', 'Mace': 'mace', 'War Hammer': 'war_hammer',
    'Spear': 'spear', 'War Pike': 'war_pike', 'Axe': 'axe', 'Halberd': 'halberd',
    'Dart': 'dart', 'War Axe': 'war_axe', 'Incendiary Dart': 'incendiary_dart', 'Javelin': 'javelin',
    'Leather Armor': 'leather_armor', 'Scale Mail': 'scale_mail', 'Chain Mail': 'chain_mail',
    'Banded Mail': 'banded_mail', 'Splint Mail': 'splint_mail', 'Plate Mail': 'plate_mail',
};
const anyKindIdOf = (item: Item | null): string => {
    const raw = kindIdOf(item) || (item?.name ?? '');
    return NAME_TO_ID[raw] ?? raw;
};

// ─────────────────────────────────────────────────────────────────────────────
// A 组：蓝图路径的频率加权（P1-53）
// ─────────────────────────────────────────────────────────────────────────────

describe('T-1 A：spawnBlueprintItem 无 id 分支 = chooseKind 基表加权（CE Architect.c:1504 → Items.c:409-420）', () => {
    /** 大样本抽取：每次独立重播种批内连续抽取，返回种类计数。 */
    function tally(category: string, n: number, seed: number, depth = 10): Record<string, number> {
        const game = createHeadlessGame(20260918);
        const spawn = (game as unknown as BlueprintSpawn).spawnBlueprintItem.bind(game);
        rng.seedRandomGenerator(seed);
        const out: Record<string, number> = {};
        for (let i = 0; i < n; i++) {
            const id = anyKindIdOf(spawn(category, undefined, 0, 0, depth));
            expect(id, `第 ${i} 次抽取必须产出物品`).not.toBe('');
            out[id] = (out[id] ?? 0) + 1;
        }
        return out;
    }

    it('AD-A1 对抗：frequency=0 的种类（enchant/life/strength/dart）从蓝图路径恰为 0（等概率实现 1/13~1/15 → 红）', () => {
        // CE 基表：enchanting/life/strength 频率 0（GlobalsBrogue.c:665-699 的
        // 动态调整条目）、dart 0（Globals.c:1596）。chooseKind 的
        // max(0,f) 钳制使它们永不被抽中；等概率实现必然抽出 → 在此翻红。
        const scrolls = tally('SCROLL', 6000, 4242);
        expect(scrolls['scroll_of_enchantment'] ?? 0, '附魔卷轴基频 0，蓝图路径不得出现').toBe(0);
        const potions = tally('POTION', 6000, 4243);
        expect(potions['potion_of_life'] ?? 0, 'life 药水基频 0').toBe(0);
        expect(potions['potion_of_strength'] ?? 0, 'strength 药水基频 0').toBe(0);
        expect(potions['potion_of_creeping_death'] ?? 0, 'D2 退池条目不得出现（登记偏差：web 先剔除再加权）').toBe(0);
        const weapons = tally('WEAPON', 6000, 4244);
        expect(weapons['dart'] ?? 0, 'dart 基频 0').toBe(0);
    });

    it('AD-A2 对抗：identify 占比贴 CE 加权值 30/133（等概率 1/13 在此翻红）', () => {
        const scrolls = tally('SCROLL', 6000, 4242);
        const p = (scrolls['scroll_of_identify'] ?? 0) / 6000;
        // 二项 σ≈0.0054；带 [0.19, 0.26] ≈ 期望 0.2256 ± 6σ。
        expect(p, `identify 占比 ${p.toFixed(4)}，期望 30/133≈0.2256`).toBeGreaterThan(0.19);
        expect(p, `identify 占比 ${p.toFixed(4)}，期望 30/133≈0.2256`).toBeLessThan(0.26);
        // 药水侧同理：telepathy 权重 20/175≈0.1143（D2 剔除 creeping_death 后归一）。
        const potions = tally('POTION', 6000, 4243);
        const pp = (potions['potion_of_telepathy'] ?? 0) / 6000;
        expect(pp, `telepathy 占比 ${pp.toFixed(4)}，期望 20/175≈0.1143`).toBeGreaterThan(0.085);
        expect(pp, `telepathy 占比 ${pp.toFixed(4)}，期望 20/175≈0.1143`).toBeLessThan(0.145);
    });

    it('AD-A3：类别抽取本身的 RNG 消耗——卷轴/药水恰 1（CE chooseKind 恰 1 次 rand_range；武器/护甲 ≥1，其附魔/符文模型另有 CE 原生掷骰）', () => {
        const game = createHeadlessGame(20260918);
        const spawn = (game as unknown as BlueprintSpawn).spawnBlueprintItem.bind(game);
        for (const category of ['SCROLL', 'POTION'] as const) {
            rng.seedRandomGenerator(99);
            const before = rng.randomNumbersGenerated;
            expect(spawn(category, undefined, 0, 0, 10)).not.toBeNull();
            expect(rng.randomNumbersGenerated - before,
                `${category} 蓝图抽取的 RNG 消耗必须恰为 1（多掷/少掷在此翻红）`).toBe(1);
        }
        for (const category of ['WEAPON', 'ARMOR'] as const) {
            rng.seedRandomGenerator(99);
            const before = rng.randomNumbersGenerated;
            expect(spawn(category, undefined, 0, 0, 10)).not.toBeNull();
            expect(rng.randomNumbersGenerated - before,
                `${category} 蓝图抽取至少消耗类别抽的 1 次（B-4a 附魔模型的额外掷骰为 CE 原生）`).toBeGreaterThanOrEqual(1);
        }
    });

    it('整局附魔卷轴/life/strength 总数：测量带（4 seed × D1-D26，与改造前同口径对比见报告）', () => {
        // 与 b_4a 的 collectFullRun 同一协议（10 seed 的子集，控制门禁时长）。
        // 附带仪表：统计各类别无 id 蓝图抽取的每局调用次数——B-4b/P1-53 的
        // 「附魔卷轴超标主因」归因复核用（T-1 实测：SCROLL/POTION 类别抽取
        // 每局仅个位数，对整局总数贡献 ≈ 0-1.5；超标余量主要来自
        // `_random_good_`（web 自创类别：roll4=附魔卷轴/roll5=life），见报告）。
        const SEEDS = [1, 42, 123456, 654321];
        const identityOf = (item: Item): string => {
            const raw = kindIdOf(item) || item.name;
            return raw;
        };
        const perSeed: Array<{ seed: number; ench: number; life: number; str: number; bp: Record<string, number> }> = [];
        for (const seed of SEEDS) {
            const game = createHeadlessGame(seed);
            const g = game as unknown as GameWithGen;
            // 原型级包装（spawnBlueprintItem 是 TS private——运行时可触达），
            // 只计数不改变行为；测试侧仪表，不触生产代码。
            const proto = Object.getPrototypeOf(game) as {
                spawnBlueprintItem: (this: Game, category: string, id: string | undefined, x: number, y: number, depth: number) => Item | null;
            };
            const orig = proto.spawnBlueprintItem;
            const bp: Record<string, number> = {};
            proto.spawnBlueprintItem = function (this: Game, category: string, id: string | undefined, x: number, y: number, depth: number) {
                if (!id) bp[category] = (bp[category] ?? 0) + 1;
                return orig.call(this, category, id, x, y, depth);
            };
            const all: Item[] = [];
            for (let d = 1; d <= 26; d++) {
                if (d > 1) { game.depth = d; g.generateDepth(false, false); }
                all.push(...game.items);
            }
            proto.spawnBlueprintItem = orig;
            const count = (id: string) => all.filter(i => identityOf(i) === id).length;
            perSeed.push({ seed, ench: count('scroll_of_enchantment'), life: count('potion_of_life'), str: count('potion_of_strength'), bp });
        }
        const rows = perSeed.map(r => `seed${r.seed}\tenchant=${r.ench}\tlife=${r.life}\tstrength=${r.str}\t蓝图无id抽取=${JSON.stringify(r.bp)}`).join('\n');
        console.log(`[t_1] 整局产出（T-1 加权后，4 seed）:\n${rows}`);

        // 实测带。下限挡「计量 increment/decrement 接反跌穿」，
        // 上限挡「结构性投放点被加回」。
        // 注意：等概率回退**不会**破本带（类别抽取每局个位数，见仪表行）——
        // 它由 AD-A1/AD-A2 的分布断言拦住。
        //
        // ── V-1a 顺延（验收方 2026-09-18 补授权：本文件不在 V-1a 清单内，
        //    是验收方的漏项；而 V-0 §6 其实**预告过**本文件会撞红，我没读到）──
        // T-1 当时的带捕获自 ench 24-31 / life 16-23，那时 `_random_good_` 还在。
        // V-1a 删掉了它（web 自创、CE 全源码无此概念，roll4 直投附魔卷轴、
        // roll5 直投生命药水），实测降到 **ench 13-16 / life 6-7**，
        // 双双落进 CE 量级（CE 附魔卷轴约 12-15/局）。
        // 带随之跟随实测平移为 ench [8,20] / life [2,12]——**不是放宽，是跟着事实走**：
        // 上限 20 仍能挡住「直投被加回」（加回即 24-31，必破），
        // 下限 8 仍能挡住「计量接反跌穿」。
        for (const r of perSeed) {
            expect(r.ench, `seed${r.seed} 附魔卷轴 ${r.ench}/局`).toBeGreaterThanOrEqual(8);
            expect(r.ench, `seed${r.seed} 附魔卷轴 ${r.ench}/局`).toBeLessThanOrEqual(20);
            expect(r.life, `seed${r.seed} life ${r.life}/局`).toBeGreaterThanOrEqual(2);
            expect(r.life, `seed${r.seed} life ${r.life}/局`).toBeLessThanOrEqual(12);
            expect(r.str, `seed${r.seed} strength ${r.str}/局`).toBeGreaterThanOrEqual(5);
            expect(r.str, `seed${r.seed} strength ${r.str}/局`).toBeLessThanOrEqual(14);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// B 组：DF_CRYSTAL_WALL 与自动生成器接线（C-6 缺口激活）
// ─────────────────────────────────────────────────────────────────────────────

/** 40×24 合成网格：FLOOR 外圈房间 + 大块 WALL 腹地（水晶墙的落点原料）。 */
function mkWallField(): Grid {
    const g = new Grid(40, 24);
    for (let x = 0; x < 40; x++) {
        for (let y = 0; y < 24; y++) {
            const border = x === 0 || y === 0 || x === 39 || y === 23;
            const interior = x >= 8 && x < 32 && y >= 6 && y < 18;
            g.setTerrain(x, y, border || interior ? TerrainType.WALL : TerrainType.FLOOR, '.', 0x888888);
        }
    }
    return g;
}

function crystalCells(g: Grid): Array<{ x: number; y: number }> {
    const out: Array<{ x: number; y: number }> = [];
    for (let x = 0; x < g.width; x++) {
        for (let y = 0; y < g.height; y++) {
            if (g.getCell(x, y)!.layers[DungeonLayer.DUNGEON] === TerrainType.CRYSTAL_WALL) {
                out.push({ x, y });
            }
        }
    }
    return out;
}

describe('T-1 B：DF_CRYSTAL_WALL 接线（CE Globals.c:607 + GlobalsBrogue.c:115/151）', () => {
    it('AD-B1 表行与 DF 条目逐值钉死（抄错 CE 原值 → 红）', () => {
        // DF 条目（Globals.c:607 {CRYSTAL_WALL, DUNGEON, 200, 50, DFF_CLEAR_OTHER_TERRAIN}）。
        const e = DUNGEON_FEATURE_CATALOG[DF.DF_CRYSTAL_WALL]!;
        expect(e.ceLine).toBe(607);
        expect(e.ceTile).toBe('CRYSTAL_WALL');
        expect(e.tile, 'CRYSTAL_WALL 地形 B-3 已迁，必须带完整 tile（不得登记 null）').toBe(TerrainType.CRYSTAL_WALL);
        expect(e.layer).toBe(DungeonLayer.DUNGEON);
        expect(e.startProbability).toBe(200);
        expect(e.probabilityDecrement).toBe(50);
        expect(e.flags).toBe(DFF_CLEAR_OTHER_TERRAIN);
        expect(e.propagationTerrain).toBeNull();
        expect(e.subsequentDF).toBeNull();

        // 表行（GlobalsBrogue.c:115/151 的数值列）。
        const a1 = AUTO_GENERATOR_CATALOG[1]!;
        expect([a1.minDepth, a1.maxDepth, a1.frequency, a1.minNumberIntercept, a1.minNumberSlope, a1.maxNumber])
            .toEqual([14, 40, 15, -325, 25, 5]);
        expect(a1.requiredDungeonFoundationType).toBe(TerrainType.WALL);
        const a33 = AUTO_GENERATOR_CATALOG[33]!;
        expect([a33.minDepth, a33.maxDepth, a33.frequency, a33.minNumberIntercept, a33.minNumberSlope, a33.maxNumber])
            .toEqual([40, 40, 100, 0, 0, 600]);
        expect(a33.terrain).toBe(TerrainType.CRYSTAL_WALL);

        // CRYSTAL_WALL 是 pathing blocker（连通性否决对两条接线都必须在位）。
        expect(TERRAIN_FLAGS[TerrainType.CRYSTAL_WALL].flags & T_PATHING_BLOCKER).toBeTruthy();
    });

    it('AD-B2 对抗：index 1 真实产出水晶墙 + DFF_CLEAR_OTHER_TERRAIN 语义（漏清/全局清 → 红）', () => {
        const g = mkWallField();
        // 腹地墙格预铺 SURFACE=GRASS / LIQUID=WATER_SHALLOW：
        // 落成的水晶格必须被清空这两层（CE Architect.c:3423-3440），未落格必须保留。
        for (let x = 8; x < 32; x++) {
            for (let y = 6; y < 18; y++) {
                g.setTerrainLayer(x, y, DungeonLayer.SURFACE, TerrainType.GRASS);
                g.setTerrainLayer(x, y, DungeonLayer.LIQUID, TerrainType.WATER_SHALLOW);
            }
        }
        // 真实目录条目（index 0 死条目 + index 1），深度 17：count = trunc((−325+425)/100)=1。
        const SYN = [AUTO_GENERATOR_CATALOG[0]!, AUTO_GENERATOR_CATALOG[1]!];
        rng.seedRandomGenerator(1717);
        const s = runAutogenerators(g, 17, false, SYN);
        // 统计键是表位置（runAutogenerators 用 ag）；位置 1 = 真实 index 1 条目。
        const stat = s.entries[0]!;
        expect(stat, 'index 1 未产生统计——carrier/df 未接线').toBeDefined();
        expect(stat!.built, 'index 1 在 WALL 基座腹地必须真实落格').toBeGreaterThanOrEqual(1);

        const cells = crystalCells(g);
        expect(cells.length, '水晶墙格数').toBeGreaterThanOrEqual(1);
        for (const p of cells) {
            const c = g.getCell(p.x, p.y)!;
            expect(c.layers[DungeonLayer.LIQUID], `水晶格 (${p.x},${p.y}) 的 LIQUID 必须被 DFF_CLEAR_OTHER_TERRAIN 清空`).toBe(TerrainType.NOTHING);
            expect(c.layers[DungeonLayer.SURFACE], `水晶格 (${p.x},${p.y}) 的 SURFACE 必须被清空`).toBe(TerrainType.NOTHING);
            expect(c.layers[DungeonLayer.GAS], 'GAS 层豁免于清理（CE :3429 layer != GAS）').toBe(TerrainType.NOTHING);
        }
        // 清理只作用于落格（fill 后 blockingMap）——腹地里未被波及的墙格保留 GRASS。
        let keptGrass = 0;
        for (let x = 8; x < 32; x++) {
            for (let y = 6; y < 18; y++) {
                if (g.getCell(x, y)!.layers[DungeonLayer.DUNGEON] === TerrainType.WALL
                    && g.getCell(x, y)!.layers[DungeonLayer.SURFACE] === TerrainType.GRASS) {
                    keptGrass++;
                }
            }
        }
        expect(keptGrass, '未落格的 GRASS 必须保留（全局清在此翻红）').toBeGreaterThan(0);
    });

    it('AD-B3 对抗：index 33 terrain 分支真实行使——D40 直接铺 600 次（carrier 忘改 → built 0 → 红）', () => {
        const g = mkWallField();
        // 合成目录 = [死条目, 真实 index 33 条目]：循环从位置 1 起，统计键是
        // **表位置**（runAutogenerators 用 ag 而非 gen.index）——恰为 entries[0]。
        const SYN = [AUTO_GENERATOR_CATALOG[0]!, AUTO_GENERATOR_CATALOG[33]!];
        rng.seedRandomGenerator(4040);
        const s = runAutogenerators(g, 40, false, SYN);
        expect(s.entries, 'index 33 未产生统计——carrier 未接线').toHaveLength(1);
        const stat = s.entries[0]!;
        expect(stat.count, 'frequency 100 追加到 maxNumber=600').toBe(600);
        // 合成网格墙格总数 = 内区 288 + 边界 124 = 412：600 次全量饱和覆盖
        //（已变水晶的格不再满足 WALL 基座，天然去重）——CE D40「水晶层」的
        // 忠实形态。墙少于此数时 built = 墙数，故下界用宽松的 300。
        expect(stat.built, '600 次落点在墙腹地必须大量落格').toBeGreaterThanOrEqual(300);
        expect(crystalCells(g).length, '水晶墙格数').toBeGreaterThan(0);
    });

    it('行为终点：真实目录 × 真实管线，水晶墙在其深度带内真实出现（多 seed × D14-D26 + D40）', () => {
        const SEEDS = [424242, 777, 31337];
        let levelsWithCrystal = 0;
        let totalCells = 0;
        const lines: string[] = [];
        for (const seed of SEEDS) {
            for (let d = 14; d <= 26; d++) {
                rng.seedRandomGenerator(seed);
                const arch = new Architect();
                arch.generateTerrain(d);
                const n = crystalCells(arch.grid).length;
                totalCells += n;
                if (n > 0) levelsWithCrystal++;
                lines.push(`seed${seed} D${d}\tcrystal=${n}`);
                // CE 语义（同 AD-B2）：真实管线里水晶格的 LIQUID 必须被清空。
                for (const p of crystalCells(arch.grid)) {
                    expect(arch.grid.getCell(p.x, p.y)!.layers[DungeonLayer.LIQUID],
                        `seed${seed} D${d} (${p.x},${p.y}) 水晶格 LIQUID 未清`).toBe(TerrainType.NOTHING);
                }
            }
            // D40：index 33 的专属深度（index 1 也在带内，但 D40 的量级由 600 次
            // 直接铺主导；接线证明在 AD-B3 的合成行使，这里验证管线真实放行）。
            rng.seedRandomGenerator(seed);
            const arch = new Architect();
            arch.generateTerrain(40);
            const n40 = crystalCells(arch.grid).length;
            totalCells += n40;
            if (n40 > 0) levelsWithCrystal++;
            lines.push(`seed${seed} D40\tcrystal=${n40}`);
            expect(n40, `seed${seed} D40 必须出现水晶墙（index 1+33 合力）`).toBeGreaterThan(0);
        }
        console.log(`[t_1] 水晶墙分布（${SEEDS.length} seed × D14-D26+D40）:\n${lines.join('\n')}\n合计 ${totalCells} 格 / ${levelsWithCrystal} 层有水晶`);
        expect(levelsWithCrystal, '深度带内必须有多层真实出现水晶墙').toBeGreaterThanOrEqual(10);
        expect(totalCells, '水晶墙总格数').toBeGreaterThan(40);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// C 组：CE_POW_FOOD 表钉死（头注 40→50 订正的防回退锚）
// ─────────────────────────────────────────────────────────────────────────────

describe('T-1 C：CE_POW_FOOD = CE Items.c:551-560 全 50 项（防「再抄缺」回退）', () => {
    it('恰 50 项，边界值与抽查位与 CE 一致', () => {
        // CE 原表（Items.c:551-560，b^1.35 定点 ×65536，b = 1..50）首尾与抽查位。
        expect(ItemLoader.CE_POW_FOOD).toHaveLength(50);
        expect(ItemLoader.CE_POW_FOOD[0]).toBe(65536);          // b=1
        expect(ItemLoader.CE_POW_FOOD[1]).toBe(167059);         // b=2
        expect(ItemLoader.CE_POW_FOOD[24]).toBe(5054741);       // b=25
        expect(ItemLoader.CE_POW_FOOD[25]).toBe(5329591);       // b=26（换行边界位）
        expect(ItemLoader.CE_POW_FOOD[48]).toBe(12538472);      // b=49
        expect(ItemLoader.CE_POW_FOOD[49]).toBe(12885148);      // b=50
    });
});
