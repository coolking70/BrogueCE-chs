/**
 * src/test/c_4c_promotion.test.ts — C-4c：promoteTile + 每回合两趟驱动
 *
 * 分组：
 *   A. promoteTile 本体（CE Time.c:1244-1287）——vanish 目标、fire/promote
 *      选择、缺 tile 整链缓办、接线分支留痕；
 *   B. 两趟驱动（CE Time.c:1619-1684）——一趟/两趟可判别场景、起火守卫、
 *      扩散型邻居累加、WITHOUT_KEY 记账、RNG 消耗口径；
 *   C. 目录级防线——非 GAS 扩散条目 probDec>0（死循环闸门）；
 *   D. Game 集成——踩门开门/下回合自动关门、踩楼梯 DF_REPEL_CREATURES、
 *      同种子同操作序列决定性复验；
 *   E. §五实测测量（console.log，只测量不断言规模）。
 *
 * 对抗性设计原则：每条断言都能在某个具体的、合理的错误实现下失败
 * （错误形态写在各用例注释里）。运行时改 TERRAIN_FLAGS 表项注入场景的
 * 用例一律 finally 还原。
 * 场景网格一律用 wallGrid（全墙、点名挖格）：防止网格里其它同注入地形格
 * 也获得注入属性而污染断言与 RNG 计数。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Grid, TerrainType, DungeonLayer } from '../engine/Map/Grid';
import { TERRAIN_FLAGS, TM_PROMOTES_WITHOUT_KEY } from '../engine/Map/TerrainCatalog';
import {
    promoteTile,
    promoteOnStep,
    runPromotionUpdate,
    resolveDFName,
} from '../engine/Map/Promotion';
import {
    DF,
    DUNGEON_FEATURE_CATALOG,
} from '../engine/Map/DungeonFeatureCatalog';
import { rng } from '../engine/Random';
import { createHeadlessGame, runTurns } from './harness';

const C = TerrainType;
const L = DungeonLayer;

/** 测试可变视图（生产表是 readonly，这里只为注入场景）。 */
type MutableEntry = {
    flags: number; mechFlags: number; chanceToIgnite: number;
    fireType: string; discoverType: string; promoteType: string;
    promoteChance: number; webOnly: boolean;
};

/** 运行时注入表项（finally 还原）。 */
function withEntry<T>(t: TerrainType, patch: Partial<MutableEntry>, fn: () => T): T {
    const entry = TERRAIN_FLAGS[t] as unknown as MutableEntry;
    const saved = { ...entry };
    Object.assign(entry, patch);
    try {
        return fn();
    } finally {
        Object.assign(entry, saved);
    }
}

/** 全墙小图：默认全 WALL，点名改写。隔离注入场景用。 */
function wallGrid(w = 16, h = 16): Grid {
    const g = new Grid(w, h);
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
            g.setTerrain(x, y, C.WALL, '#', 0x666666);
        }
    }
    return g;
}

afterEach(() => {
    rng.seedRandomGenerator(20260916); // 每用例后重置种子，防用例间流串味
});

// ══════════════════════════════════════════════════════════════════════════

describe('C-4c A：promoteTile 本体（CE Time.c:1244-1287）', () => {
    it('A1 对抗：DOOR→OPEN_DOOR 端到端——先清层再 spawn（跳过 vanish 或清层目标写反都翻红）', () => {
        // 错误实现一：不做 vanish 直接 spawn → fillSpawnMap 优先级判据
        //   DOOR(8) >= OPEN_DOOR(25) 不成立 → 拒绝写入 → 门永远开不了（红）。
        // 错误实现二：vanish 把 DUNGEON 层清成 NOTHING 且 DF spawn 被吞 →
        //   最终 DUNGEON=NOTHING 而非 OPEN_DOOR（红）。
        const g = wallGrid();
        g.setTerrain(5, 5, C.DOOR, '+', 0xaa8844);
        const r = promoteTile(g, 5, 5, L.DUNGEON, false);
        expect(r.deferred, 'DF_OPEN_DOOR 在 C-4b 目录里 tile 齐备，不应缓办').toBeNull();
        expect(r.vanished).toBe(true);
        expect(r.spawn?.succeeded).toBe(true);
        expect(r.mutated).toBe(true);
        expect(g.getCell(5, 5)!.layers[L.DUNGEON]).toBe(C.OPEN_DOOR);
    });

    it('A2 对抗：vanish 清层目标——DUNGEON 层清成 FLOOR、非 DUNGEON 层清成 NOTHING（写反即红）', () => {
        // 注入 promoteType=''（纯 vanish 无 DF），隔离 vanish 本身的落点。
        // CE :1258-1261：layer==DUNGEON → FLOOR（"implicitly has floor
        // underneath it"），否则 NOTHING。
        withEntry(C.DOOR, { promoteType: '' }, () => {
            const g = wallGrid();
            g.setTerrain(5, 5, C.DOOR, '+', 0xaa8844);
            promoteTile(g, 5, 5, L.DUNGEON, false);
            expect(g.getCell(5, 5)!.layers[L.DUNGEON]).toBe(C.FLOOR);
        });
        withEntry(C.GRASS, { promoteType: '' }, () => {
            const g = wallGrid();
            g.setTerrain(6, 5, C.GRASS, '"', 0x33aa33); // SURFACE 层
            expect(g.getCell(6, 5)!.layers[L.SURFACE]).toBe(C.GRASS);
            promoteTile(g, 6, 5, L.SURFACE, false);
            expect(g.getCell(6, 5)!.layers[L.SURFACE]).toBe(C.NOTHING);
        });
    });

    it('A3 对抗：fireType / promoteType 选择——useFireDF 选错路时缓办记录互换即翻红', () => {
        // INERT_BRIMSTONE：promoteType=DF_ACTIVE_BRIMSTONE（tile 缺失，链断在
        // 第一环）；fireType=DF_INERT_BRIMSTONE（tile 在，但 subsequentDF
        // DF_BRIMSTONE_FIRE 缺失——链断在**中段**）。两路缓办记录不同：
        // 选错 DF 的实现（两路取反/写死一路）必在此翻红。
        const g = wallGrid();
        g.setTerrain(5, 5, C.INERT_BRIMSTONE, '"', 0xccaa33);
        const rPromote = promoteTile(g, 5, 5, L.LIQUID, false);
        expect(rPromote.deferred).not.toBeNull();
        expect(rPromote.deferred!.df).toBe(DF.DF_ACTIVE_BRIMSTONE);
        expect(rPromote.deferred!.missingDf).toBe(DF.DF_ACTIVE_BRIMSTONE);
        expect(rPromote.deferred!.missingCeTile).toBe('ACTIVE_BRIMSTONE');
        // 地形原封不动（缓办 = 无半晋升态）。
        expect(g.getCell(5, 5)!.layers[L.LIQUID]).toBe(C.INERT_BRIMSTONE);

        const rFire = promoteTile(g, 5, 5, L.LIQUID, true);
        expect(rFire.deferred).not.toBeNull();
        expect(rFire.deferred!.df).toBe(DF.DF_INERT_BRIMSTONE);
        expect(rFire.deferred!.missingDf).toBe(DF.DF_BRIMSTONE_FIRE);
        expect(rFire.deferred!.missingCeTile).toBe('BRIMSTONE_FIRE');
        expect(g.getCell(5, 5)!.layers[L.LIQUID]).toBe(C.INERT_BRIMSTONE);
    });

    it('A4 缓办不改地形：缺 tile DF 的 vanish 先行会造成 CE 不存在的半晋升态——不允许', () => {
        // LOCKED_DOOR：vanish 旗标在、promoteType=DF_OPEN_IRON_DOOR_INERT
        // （tile 缺失）。错误实现"先 vanish 再发现缺 tile"→ 门被吃成 FLOOR
        // （CE 不会出现的状态）。正确行为：整次缓办，门还在。
        const g = wallGrid();
        g.setTerrain(5, 5, C.LOCKED_DOOR, '+', 0xaa8844);
        const r = promoteTile(g, 5, 5, L.DUNGEON, false);
        expect(r.deferred).not.toBeNull();
        expect(r.vanished).toBe(false);
        expect(g.getCell(5, 5)!.layers[L.DUNGEON]).toBe(C.LOCKED_DOOR);
    });

    it('A5 对抗：接线机器分支必须显式未实现（误实现 activateMachine 即翻红）', () => {
        // PRESSURE_PLATE 带 TM_IS_WIRED（C-4a 表）。注 promoteType='' 让晋升
        // 完成（板无 DF 可缓），wiredBranchHit 必须置位且不产生任何机器效果；
        // 静态守卫在 A6（CE 接线符号不得出现在生产代码）。
        withEntry(C.PRESSURE_PLATE, { promoteType: '' }, () => {
            const g = wallGrid();
            g.setTerrain(7, 7, C.PRESSURE_PLATE, '_', 0x446644);
            const r = promoteTile(g, 7, 7, L.DUNGEON, false);
            expect(r.wiredBranchHit, 'TM_IS_WIRED 命中必须留痕').toBe(true);
            expect(g.getCell(7, 7)!.layers[L.DUNGEON]).toBe(C.FLOOR);
        });
        // useFireDF=true 不进接线分支（CE :1271 `!useFireDF &&`）。
        const g2 = wallGrid();
        g2.setTerrain(7, 7, C.PRESSURE_PLATE, '_', 0x446644);
        expect(promoteTile(g2, 7, 7, L.DUNGEON, true).wiredBranchHit).toBe(false);
    });

    it('A6 留痕：接线机器是 C-4d——activateMachine/circuitBreakers/IS_POWERED 不得出现在生产代码', () => {
        // 静态扫描：这些 CE 符号若被"顺手实现"，在此翻红（越界守卫）。
        const srcDir = fileURLToPath(new URL('../', import.meta.url));
        const collect = (dir: string, out: string[] = []): string[] => {
            for (const name of readdirSync(dir)) {
                const p = join(dir, name);
                if (statSync(p).isDirectory()) collect(p, out);
                else if (/\.(ts|tsx|vue)$/.test(name)) out.push(p);
            }
            return out;
        };
        const pattern = /\bactivateMachine\b|\bcircuitBreakersPreventActivation\b|\bIS_POWERED\b/;
        const offenders: string[] = [];
        for (const f of collect(srcDir).filter((p) => !p.split(sep).includes('test'))) {
            const rel = relative(srcDir, f).split(sep).join('/');
            readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
                const codeOnly = line.replace(/\/\/.*$/, '');
                // 跳过块注释行：文档里提名字不是实现（TM_IS_CIRCUIT_BREAKER
                // 常量定义属 C-4a 数据抄录，不在本模式内）。
                if (/^\s*(\*|\/\*)/.test(codeOnly)) return;
                if (pattern.test(codeOnly)) {
                    offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
                }
            });
        }
        expect(offenders, `接线机器符号越轮出现（归 C-4d）：\n${offenders.join('\n')}`).toEqual([]);
    });

    it('A7 DF 名解析：TerrainCatalog 引用未知目录名必须响亮失败（不许静默当 0）', () => {
        expect(resolveDFName('')).toBeNull();
        expect(resolveDFName('DF_OPEN_DOOR')).toBe(DF.DF_OPEN_DOOR);
        expect(() => resolveDFName('DF_NOT_IN_CATALOG')).toThrow(/目录闭包缺口/);
    });
});

// ══════════════════════════════════════════════════════════════════════════

describe('C-4c B：两趟驱动（CE Time.c:1619-1684）', () => {
    it('B1 对抗：一趟会连锁、两趟不会——OPEN_DOOR 关门不得改变同回合相邻格的晋升判定', () => {
        // 场景（全墙底）：A(6,8)=OPEN_DOOR（promoteChance 10000，晋升→DOOR），
        // B(7,8)=DOOR 注入 promoteChance=-20000（扩散型）；B 其余三邻是 WALL
        // （挡通行 → 不计入合格邻居，CE :1633）。
        //   两趟（正确）：第一趟 B 判定时 A 仍是 OPEN_DOOR（≠DOOR、可走）→
        //     合格 1 → chance 20000 → 必中 → 第二趟 B 也晋升（vanish→DF_OPEN_DOOR
        //     → OPEN_DOOR）。
        //   一趟（错误）：扫描先到 A（x 更小），A 先变 DOOR → B 判定时 A==B
        //     不再合格 → chance 0 → B 不晋升（红）。
        //   累加方向写反（+promoteChance）：chance=-20000 → 永不中（红）。
        withEntry(C.DOOR, { promoteChance: -20000 }, () => {
            const g = wallGrid();
            g.setTerrain(6, 8, C.OPEN_DOOR, "'", 0xaa8844);
            g.setTerrain(7, 8, C.DOOR, '+', 0xaa8844);

            const r = runPromotionUpdate(g, { keyOnTileAt: () => false });

            expect(g.getCell(6, 8)!.layers[L.DUNGEON], 'A：OPEN_DOOR 晋升关闭').toBe(C.DOOR);
            expect(g.getCell(7, 8)!.layers[L.DUNGEON],
                '两趟语义：B 的判定用的是回合初快照（A 关门前它已中签），B 应晋升为 OPEN_DOOR')
                .toBe(C.OPEN_DOOR);
            expect(r.promotions.map((p) => p.sourceTerrain).sort()).toEqual(
                [C.DOOR, C.OPEN_DOOR].sort()
            );
        });
    });

    it('B2 对抗：CAUGHT_FIRE_THIS_TURN 守卫——本回合已起火的格不掷骰不晋升，守卫漏掉即红', () => {
        const g = wallGrid();
        g.setTerrain(7, 7, C.OPEN_DOOR, "'", 0xaa8844); // 唯一 promoteChance≠0 的格
        const before = rng.randomNumbersGenerated;
        const r1 = runPromotionUpdate(g, { keyOnTileAt: () => false, caughtFireCells: [{ x: 7, y: 7 }] });
        expect(r1.promotions.length, '起火格本回合不得晋升').toBe(0);
        expect(rng.randomNumbersGenerated - before, 'CE :1644 守卫在掷骰之前——不得消耗 RNG').toBe(0);
        expect(g.getCell(7, 7)!.layers[L.DUNGEON]).toBe(C.OPEN_DOOR);
        // 下一回合（无起火输入）：正常晋升关闭。CE 语义：上一回合记账趟已清。
        const r2 = runPromotionUpdate(g, { keyOnTileAt: () => false });
        expect(r2.promotions.length).toBe(1);
        expect(g.getCell(7, 7)!.layers[L.DUNGEON]).toBe(C.DOOR);
        // 记账趟清对外部输入的起火集（CE :1668；本回合无新起火 → 无存活）。
        const r3 = runPromotionUpdate(g, { keyOnTileAt: () => false, caughtFireCells: [{ x: 3, y: 3 }, { x: 4, y: 4 }] });
        expect(r3.caughtFireCleared).toBe(2);
        expect(r3.caughtFireRemaining.length).toBe(0);
    });

    it('B3 对抗：扩散型 promoteChance 邻居累加——合格邻居数 × |值|，写反/不累加即红', () => {
        // 注 FLOOR promoteChance=-10000、promoteType=DF_OPEN_DOOR（可观察落地：
        // FLOOR(95) → OPEN_DOOR(25) 过优先级判据）。挡通行/同层同地形都不合格
        // （CE :1631-1636）。全墙底，只有目标格及其四邻被点名。
        const setup = (neighbors: TerrainType[]) => {
            const g = wallGrid();
            const slots: [number, number][] = [[10, 7], [10, 9], [9, 8], [11, 8]]; // 上/下/左/右
            g.setTerrain(10, 8, C.FLOOR, '.', 0x888888); // 目标格
            slots.forEach(([x, y], i) => g.setTerrain(x, y, neighbors[i]!, '.', 0x888888));
            return g;
        };
        withEntry(C.FLOOR, { promoteChance: -10000, promoteType: 'DF_OPEN_DOOR' }, () => {
            // 0 合格：四邻全 FLOOR（同层同地形）→ 不掷骰、不晋升。
            {
                const g = setup([C.FLOOR, C.FLOOR, C.FLOOR, C.FLOOR]);
                const before = rng.randomNumbersGenerated;
                const r = runPromotionUpdate(g, { keyOnTileAt: () => false });
                expect(g.getCell(10, 8)!.layers[L.DUNGEON]).toBe(C.FLOOR);
                expect(r.rngDraws, '0 合格邻居 → promoteChance=0 → 不掷骰（CE :1644 短路）').toBe(0);
                expect(rng.randomNumbersGenerated - before).toBe(0);
            }
            // 1 合格（浅水：DUNGEON 层为 NOTHING ≠ FLOOR 且不挡通行）→ 10000 → 必中。
            {
                const g = setup([C.WATER_SHALLOW, C.FLOOR, C.FLOOR, C.FLOOR]);
                const r = runPromotionUpdate(g, { keyOnTileAt: () => false });
                expect(g.getCell(10, 8)!.layers[L.DUNGEON], '1 合格邻居 ×10000 → 必晋升').toBe(C.OPEN_DOOR);
                expect(r.rngDraws).toBe(1);
            }
            // 2 合格 + 挡通行的墙（不合格）→ 20000 → 必中。若实现不累加
            // （直接用负值原样掷）→ draw < -10000 永假 → 翻红。
            {
                const g = setup([C.WATER_SHALLOW, C.WATER_SHALLOW, C.WALL, C.WALL]);
                runPromotionUpdate(g, { keyOnTileAt: () => false });
                expect(g.getCell(10, 8)!.layers[L.DUNGEON], '2 合格邻居 ×2×10000 → 必晋升').toBe(C.OPEN_DOOR);
            }
        });
    });

    it('B4 TM_PROMOTES_WITHOUT_KEY 记账趟：格上有钥匙不晋升、无钥匙晋升（keyOnTileAt 接反即红）', () => {
        // web 31 地形零载体——注入 GRASS mechFlags 做载体，驱动循环本身是
        // CE :1674-1682 的忠实移植，测试钉其语义。
        withEntry(C.GRASS, { mechFlags: TERRAIN_FLAGS[C.GRASS]!.mechFlags | TM_PROMOTES_WITHOUT_KEY }, () => {
            withEntry(C.GRASS, { promoteType: '' }, () => {
                const g = wallGrid();
                g.setTerrain(8, 8, C.GRASS, '"', 0x33aa33);
                const rNoKey = runPromotionUpdate(g, { keyOnTileAt: () => false });
                expect(rNoKey.withoutKeyPromotions.length, '无钥匙 → 晋升').toBe(1);
                expect(g.getCell(8, 8)!.layers[L.SURFACE]).toBe(C.NOTHING);
            });
            withEntry(C.GRASS, { promoteType: '' }, () => {
                const g = wallGrid();
                g.setTerrain(8, 8, C.GRASS, '"', 0x33aa33);
                const rKey = runPromotionUpdate(g, { keyOnTileAt: (x, y) => x === 8 && y === 8 });
                expect(rKey.withoutKeyPromotions.length, '格上有钥匙 → 不晋升').toBe(0);
                expect(g.getCell(8, 8)!.layers[L.SURFACE]).toBe(C.GRASS);
            });
        });
    });

    it('B5 对抗：RNG 消耗口径——掷骰数 = promoteChance≠0 且未起火的层次数（多掷/漏掷即红）', () => {
        const g = wallGrid();
        g.setTerrain(4, 4, C.OPEN_DOOR, "'", 0xaa8844);
        g.setTerrain(6, 6, C.OPEN_DOOR, "'", 0xaa8844);
        g.setTerrain(8, 8, C.MUD, '~', 0x664422); // promoteChance 100（非扩散）
        const before = rng.randomNumbersGenerated;
        const r = runPromotionUpdate(g, { keyOnTileAt: () => false });
        expect(r.rngDraws, '2 门 + 1 泥 = 3 次掷骰').toBe(3);
        expect(rng.randomNumbersGenerated - before, 'randRange 恰好调 3 次（RNG 流审计）').toBe(3);
        // 门已关（chance 0）；泥的晋升目标 DF_METHANE_GAS_PUFF 自 G-2 起
        // tile 齐备：掷中（1%）会真冒 2 体积沼气，泥本身不消耗（无 VANISHES）
        // ——无论中签与否格仍是 MUD，下一趟仍掷 1 次（CE 语义：泥是长期源）。
        const r2 = runPromotionUpdate(g, { keyOnTileAt: () => false });
        expect(r2.rngDraws, '只剩 MUD 的 1 次').toBe(1);
    });

    it('B6 普通型 promoteChance：掷骰在第一趟、落地在第二趟；缓办也照记（明细不丢）', () => {
        const g = wallGrid();
        g.setTerrain(5, 5, C.INERT_BRIMSTONE, '"', 0xccaa33); // chance 800，链缺 tile
        const r = runPromotionUpdate(g, { keyOnTileAt: () => false });
        // 8% 中签与否都不该崩；若中签，promotions 里有缓办明细。
        expect(r.rngDraws).toBe(1);
        if (r.promotions.length === 1) {
            expect(r.deferred.length).toBe(1);
            expect(r.deferred[0]!.missingCeTile).toBe('ACTIVE_BRIMSTONE');
            expect(g.getCell(5, 5)!.layers[L.LIQUID]).toBe(C.INERT_BRIMSTONE);
        } else {
            expect(r.promotions.length).toBe(0);
        }
    });
});

// ══════════════════════════════════════════════════════════════════════════

describe('C-4c C：目录级防线（合成 DF 条目的隐含约定）', () => {
    it('C1 对抗：非 GAS 扩散条目必须 probDec>0——spawnMapDF 的死循环闸门（违例条目即红）', () => {
        // C-4b 查明：probDec=0 的非 GAS 扩散条目会让 spawnMapDF 的
        // while(madeChange && startProb>0) 永不衰减 → 死循环。
        // 当前 19 条闭包里 start>0 的非 GAS 条目只有 DF_BRIDGE_FALL_PREP
        // （200/100）；GAS 条目不走 spawnMapDF（volume 特例）不受此约束。
        const entries = Object.values(DUNGEON_FEATURE_CATALOG);
        expect(entries.length).toBeGreaterThan(0);
        const bad = entries.filter((e) =>
            e.layer !== DungeonLayer.GAS
            && e.startProbability > 0
            && e.probabilityDecrement <= 0
        );
        expect(bad.map((e) => `${DF[e.id]}（${e.ceTile}）`),
            '非 GAS 扩散条目 probDec 必须 > 0').toEqual([]);
    });

    it('C2 GAS 扩散条目（POISON_GAS 1000/0）不进 spawnMapDF——volume 特例豁免本闸门', () => {
        const e = DUNGEON_FEATURE_CATALOG[DF.DF_POISON_GAS_CLOUD]!;
        expect(e.layer).toBe(DungeonLayer.GAS);
        expect(e.startProbability).toBeGreaterThan(0);
        expect(e.probabilityDecrement).toBe(0);
    });
});

// ══════════════════════════════════════════════════════════════════════════

describe('D：Game 集成（真实事件链）', () => {
    it('D1 踩门开门 + 同回合客观块自动关门（CE：OPEN_DOOR promoteChance=10000）', () => {
        const game = createHeadlessGame(424242);
        const px = game.player.loc.x;
        const py = game.player.loc.y;
        // 右侧铺一格 FLOOR、再右侧放门（门可走——C-4a 判据）。
        game.grid.setTerrain(px + 1, py, C.FLOOR, '.', 0x888888);
        game.grid.setTerrain(px + 2, py, C.DOOR, '+', 0xaa8844);
        game.handlePlayerAction('move', { x: 1, y: 0 }, 'system'); // 踩上 FLOOR
        game.handlePlayerAction('move', { x: 1, y: 0 }, 'system'); // 踩上门格
        expect(game.player.loc.x, '玩家应已踩上门格').toBe(px + 2);
        // handleSpecialTileEntry 里 promoteOnStep 开门；随后同动作的客观块
        // 驱动里 OPEN_DOOR 晋升关闭。关门晋升出现在 lastPromotionUpdate 里
        // 是"开门确实发生过"的端到端证据（没有开门就没有关门可记）。
        const promos = game.lastPromotionUpdate?.promotions ?? [];
        expect(
            promos.some((p) => p.sourceTerrain === C.OPEN_DOOR),
            '本回合客观块应记录一次 OPEN_DOOR→DOOR 的自动关门（说明踩踏开门已生效）'
        ).toBe(true);
        expect(game.grid.getCell(px + 2, py)!.layers[L.DUNGEON], '回合结束时门已自动关上').toBe(C.DOOR);
    });

    it('D2 踩楼梯触发 DF_REPEL_CREATURES（tile=NOTHING 的合法无地形 DF；驱离登记未实现）', () => {
        const game = createHeadlessGame(424242);
        const px = game.player.loc.x;
        const py = game.player.loc.y;
        game.grid.setTerrain(px + 1, py, C.FLOOR, '.', 0x888888);
        game.grid.setTerrain(px + 2, py, C.STAIRS_DOWN, '>', 0x00aaff);
        game.handlePlayerAction('move', { x: 1, y: 0 }, 'system');
        game.handlePlayerAction('move', { x: 1, y: 0 }, 'system');
        expect(game.player.loc).toEqual({ x: px + 2, y: py });
        // 踩上楼梯的那次 handleSpecialTileEntry 已走过 promoteOnStep（CE 允许
        // 每次踏入重复触发，Time.c:278-285 注释自认）；这里再触发一次做单元
        // 口径断言：楼梯不消失、DF 成功、驱离登记置位、地形不动。
        const results = promoteOnStep(game.grid, px + 2, py);
        expect(results.length).toBe(1);
        expect(results[0]!.df).toBe(DF.DF_REPEL_CREATURES);
        expect(results[0]!.spawn?.succeeded).toBe(true);
        expect(results[0]!.spawn?.evacuationRequired, 'DFF_EVACUATE_CREATURES_FIRST 登记').toBe(true);
        expect(results[0]!.mutated, '无地形 DF + 楼梯无 vanish → 地形不动').toBe(false);
        expect(game.grid.getCell(px + 2, py)!.layers[L.DUNGEON]).toBe(C.STAIRS_DOWN);
    });

    it('D3 决定性复验（§五.5）：同种子同操作序列跑两遍，逐回合四层快照全等', () => {
        const snapshot = (game: ReturnType<typeof createHeadlessGame>): string => {
            const parts: string[] = [];
            for (let x = 0; x < game.grid.width; x++) {
                for (let y = 0; y < game.grid.height; y++) {
                    const c = game.grid.getCell(x, y)!;
                    parts.push(`${c.layers[0]},${c.layers[1]},${c.layers[2]},${c.layers[3]},${c.isBurning ? 1 : 0}`);
                }
            }
            return parts.join('|');
        };
        const play = (): string[] => {
            const game = createHeadlessGame(20260916);
            const snaps: string[] = [];
            for (let t = 0; t < 30; t++) {
                // 确定性策略：固定来回走（不用 rng 的默认策略）。
                const dir = t % 2 === 0 ? { x: 1, y: 0 } : { x: -1, y: 0 };
                game.handlePlayerAction('move', dir, 'system');
                if (game.isGameOver) break;
                snaps.push(snapshot(game));
            }
            return snaps;
        };
        const a = play();
        const b = play();
        expect(a.length).toBe(b.length);
        expect(a, '同种子同操作逐回合状态必须全等（两趟驱动的决定性地基）').toEqual(b);
    });
});

// ══════════════════════════════════════════════════════════════════════════

describe('C-4c E：§五 实测测量（真实关卡、多种子；只测量不断言规模）', () => {
    const SEEDS = [424242, 777, 20260913, 31337, 20260916, 1, 42];
    const TURNS = 40;

    it('E1 每回合晋升频谱 + 缓办分类 + 硫矿实测（wait 站桩，逐回合采样）', () => {
        for (const depth of [1, 20]) {
            const total = {
                blocks: 0, rngDraws: 0,
                bySource: new Map<string, number>(),
                byMissing: new Map<string, number>(),
                doorClosed: 0,
                brimstoneStart: 0, brimstoneEnd: 0, brimstoneDeferred: 0,
            };
            for (const seed of SEEDS) {
                const game = createHeadlessGame(seed);
                if (depth > 1) {
                    game.depth = depth;
                    (game as unknown as { generateDepth(f: boolean, s: boolean): void }).generateDepth(false, false);
                }
                const countTerrain = (t: TerrainType): number => {
                    let n = 0;
                    for (let x = 0; x < game.grid.width; x++) {
                        for (let y = 0; y < game.grid.height; y++) {
                            if (game.grid.getCell(x, y)!.terrain === t) n++;
                        }
                    }
                    return n;
                };
                total.brimstoneStart += countTerrain(C.INERT_BRIMSTONE);
                for (let t = 0; t < TURNS; t++) {
                    if (game.isGameOver || game.player.hp <= 0) break;
                    game.handlePlayerAction('wait', undefined, 'system'); // 站桩：隔离环境演化
                    const u = game.lastPromotionUpdate;
                    if (!u) continue;
                    total.blocks++;
                    total.rngDraws += u.rngDraws;
                    for (const p of u.promotions) {
                        const name = TerrainType[p.sourceTerrain];
                        total.bySource.set(name, (total.bySource.get(name) ?? 0) + 1);
                        if (p.sourceTerrain === C.OPEN_DOOR) total.doorClosed++;
                    }
                    for (const d of u.deferred) {
                        total.byMissing.set(d.missingCeTile, (total.byMissing.get(d.missingCeTile) ?? 0) + 1);
                        if (d.missingCeTile === 'ACTIVE_BRIMSTONE') total.brimstoneDeferred++;
                    }
                }
                total.brimstoneEnd += countTerrain(C.INERT_BRIMSTONE);
            }
            const fmt = (m: Map<string, number>) =>
                [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('，') || '（无）';
            console.log(
                `[C-4c 实测 D${depth}] ${SEEDS.length} 种子 × ${TURNS} 回合（wait 站桩）\n` +
                `  客观块总数=${total.blocks}，晋升掷骰总数=${total.rngDraws}` +
                `（平均 ${(total.rngDraws / Math.max(1, total.blocks)).toFixed(2)} 次/块）\n` +
                `  晋升按源地形：${fmt(total.bySource)}\n` +
                `  缓办按缺失 tile：${fmt(total.byMissing)}\n` +
                `  OPEN_DOOR 自动关门次数=${total.doorClosed}\n` +
                `  硫矿：起点 ${total.brimstoneStart} 格 → 终点 ${total.brimstoneEnd} 格；` +
                `ACTIVE_BRIMSTONE 缓办 ${total.brimstoneDeferred} 次（期望 ≈ 0.08×格数×块数）`
            );
            // 弱不变量（防测量口径失效，不钉规模）：
            expect(total.blocks).toBeGreaterThan(0);
            if (depth === 20) {
                // C-5 注：CHASM 解禁后 D20 液体候选从 {0,1,3} 扩为 {0,1,2,3}，
                // 原"固定 7 种子 D20 必有硫矿湖"的采样前提失效（本轮实测这 7
                // 个种子恰好全抽中岩浆/深水/深渊）。不变量本身不变（≥17 层有
                // 硫矿候选），采样面扩为 40 种子的生成期盘点（不含 40 回合
                // 演化——该不变量只关乎出现率，与晋升驱动无关）。
                let brimSeeds = 0;
                for (let s = 1; s <= 40; s++) {
                    const g2 = createHeadlessGame(900 + s);
                    g2.depth = 20;
                    (g2 as unknown as { generateDepth(f: boolean, s: boolean): void }).generateDepth(false, false);
                    let n = 0;
                    for (let x = 0; x < g2.grid.width; x++) {
                        for (let y = 0; y < g2.grid.height; y++) {
                            if (g2.grid.getCell(x, y)!.terrain === TerrainType.INERT_BRIMSTONE) n++;
                        }
                    }
                    if (n > 0) brimSeeds++;
                }
                expect(brimSeeds, 'D20 × 40 种子全无硫矿湖——minimumBrimstoneLevel 起的硫矿候选丢失').toBeGreaterThan(0);
            }
        }
    });

    it('E2 玩家行走 60 回合：踩踏开门→自动关门链在真实行走里的触发计数', () => {
        for (const seed of [424242, 777, 31337]) {
            const game = createHeadlessGame(seed);
            let doorCloses = 0;
            let turns = 0;
            while (turns < 60 && !game.isGameOver) {
                runTurns(game, 1); // 默认策略：邻近敌人攻击、否则随机合法移动
                turns++;
                const u = game.lastPromotionUpdate;
                if (u) {
                    doorCloses += u.promotions.filter((p) => p.sourceTerrain === C.OPEN_DOOR).length;
                }
            }
            console.log(
                `[C-4c 行走实测 seed=${seed}] ${turns} 回合内 OPEN_DOOR 自动关门 ${doorCloses} 次` +
                `（每次关门对应一次踩踏开门）`
            );
        }
    });

    it('E3 静态盘点：31 地形中 promoteChance≠0 的活数据、负值死数据', () => {
        const names = Object.keys(TerrainType).filter((k) => Number.isNaN(Number(k)));
        const active: string[] = [];
        const negative: string[] = [];
        for (const name of names) {
            const t = (TerrainType as unknown as Record<string, TerrainType>)[name]!;
            const e = TERRAIN_FLAGS[t]!;
            if (e.promoteChance > 0) active.push(`${name}:${e.promoteChance}→${e.promoteType || '（无 DF）'}`);
            else if (e.promoteChance < 0) negative.push(`${name}:${e.promoteChance}`);
        }
        console.log(
            `[C-4c 静态盘点]\n` +
            `  活 promoteChance：${active.join('；')}\n` +
            `  负值（扩散型）载体：${negative.join('；') || '（无——负值分支在 web 当前内容下是死数据）'}`
        );
        expect(active.length, '活数据必须有（否则驱动纯空转，测量口径错）').toBeGreaterThan(0);
        // C-5 反转（原留痕：'CE 11 种负值地形全不在 web 31 地形内（C-4a 抄录
        // 范围使然）'，expected 0）：HOLE/HOLE_EDGE（洞族，CE Globals.c:442/444
        // 原值 -1000/-500）随坠落子系统入列——负值扩散分支从死数据变为活数据。
        // 越界守卫（不放宽）：负值地形必须是且仅是 CE 洞族这两条、取 CE 原值。
        // B-3 再扩（验收方 2026-09-17 补授权——本条不在 B-3 任务书清单内，
        // 是验收方两段 grep 的漏项，由执行方如实登记后验收方补修）：
        // 力场族随「碎裂」卷轴入列。CE 原值 Globals.c:477 FORCEFIELD = -200、
        // :478 FORCEFIELD_MELT = -10000，两者都走 TM_VANISHES_UPON_PROMOTION
        // 的消融链。守卫**不放宽**：仍要求负值载体是且仅是这四条、取 CE 原值，
        // 目的一如既往是挡住"随手塞个非 CE 负值进来"。
        expect(negative.sort(), 'B-3 后负值载体必须是且仅是 CE 洞族两条 + 力场族两条，且取 CE 原值')
            .toEqual(['FORCEFIELD:-200', 'FORCEFIELD_MELT:-10000', 'HOLE:-1000', 'HOLE_EDGE:-500'].sort());
    });
});
