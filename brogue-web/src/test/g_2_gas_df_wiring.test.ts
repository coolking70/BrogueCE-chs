/**
 * src/test/g_2_gas_df_wiring.test.ts — G-2：GAS 层 DF 接线 + 蒸汽源 +
 * 燃气烧完留火的验收与对抗。
 *
 * 本轮范围 = G-1 §十一 的第 1–5 条：
 *   1. DF_POISON_GAS_CLOUD / DF_STEAM_ACCUMULATION / DF_METHANE_GAS_PUFF
 *      tile 列填上（G-1"填上即自动生效"预测的验收，对抗⑨ 游戏级复验）；
 *   2. GAS_FIRE tile 迁移 + DF_GAS_FIRE 接线——"燃气烧完地上留火
 *      （80%/回合自熄）"成形（对抗①③④）；
 *   3. 蒸汽源：水体自身被火段点燃 → DF_STEAM_ACCUMULATION 每回合 +15
 *      的持续源，web 自创"30% 冒 325"一次性分支退役（对抗②）；
 *   4. METHANE_GAS tile 迁移 → TM_EXPLOSIVE_PROMOTE 爆轰分支激活
 *      （对抗⑧，含 Promotion.ALL_DIRS8 方向修复的回归钉）；
 *   5. 无载体气体只登记（对抗⑦——"掷骰但恒缓办"的空转链防复发）。
 *
 * 哨兵（任务书 §五）：对抗⑤ 火侧曲线（seed 2026/777，与 g_1 对抗⑧ 的
 * seed42 互补）、对抗⑥ G-1 扩散/守恒算法（新气源量纲下复验）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createHeadlessGame } from './harness';
import type { Game } from '../engine/Core/Game';
import { Grid, TerrainType, DungeonLayer } from '../engine/Map/Grid';
import { TERRAIN_FLAGS, TM_GAS_DISSIPATES, TM_GAS_DISSIPATES_QUICKLY } from '../engine/Map/TerrainCatalog';
import {
    DUNGEON_FEATURE_CATALOG,
    DF_MISSING_TILES,
    DF,
} from '../engine/Map/DungeonFeatureCatalog';
import { catalogFeature, spawnDungeonFeature } from '../engine/Map/DungeonFeature';
import { exposeTileToFire, promoteTile, runPromotionUpdate, runFireUpdate } from '../engine/Map/Promotion';
import { EnvironmentManager, GasType, isGasTerrain } from '../engine/Environment/Gas';
import { rng } from '../engine/Random';

const C = TerrainType;
const L = DungeonLayer;

type Priv = { objectiveTimeBlock(): void };
const priv = (game: Game): Priv => game as unknown as Priv;

/** 手搭 9×9 石头房（同 g_1 口径）：全墙，中央 7×7 地板。 */
function roomGrid(): Grid {
    const g = new Grid(9, 9);
    for (let x = 0; x < 9; x++) {
        for (let y = 0; y < 9; y++) g.setTerrain(x, y, C.WALL, '#', 0x444444);
    }
    for (let x = 1; x <= 7; x++) {
        for (let y = 1; y <= 7; y++) g.setTerrain(x, y, C.FLOOR, '.', 0x888888);
    }
    return g;
}

/** 全图清场后搭封闭房间；全图体积观测不能混入生成关卡的其他气源。 */
function openRoom(game: Game): void {
    game.monsters.length = 0;
    game.items.length = 0;
    for (let x = 0; x < game.grid.width; x++) {
        for (let y = 0; y < game.grid.height; y++) {
            game.grid.setTerrain(x, y, C.WALL, '#', 0x444444);
            // setTerrain 清层但不清 volume；残留体积也属于全图观测。
            game.grid.getCell(x, y)!.volume = 0;
        }
    }
    game.environment.syncGasMirror();
    for (let x = 2; x <= 16; x++) {
        for (let y = 2; y <= 12; y++) {
            game.grid.setTerrain(x, y, C.FLOOR, '.', 0x888888);
            const cell = game.grid.getCell(x, y);
            if (cell) cell.isVisible = true;
        }
    }
    game.player.loc.x = 4;
    game.player.loc.y = 4;
}

function totalVolume(grid: Grid): number {
    let t = 0;
    for (let x = 0; x < grid.width; x++) {
        for (let y = 0; y < grid.height; y++) t += grid.getCell(x, y)!.volume;
    }
    return t;
}

function expectMirrorMatchesTruth(game: Game): void {
    const mgr = game.environment;
    for (let x = 0; x < game.grid.width; x++) {
        for (let y = 0; y < game.grid.height; y++) {
            const cell = game.grid.getCell(x, y)!;
            const m = mgr.gasGrid[x]?.[y];
            expect(m, `镜像缺 (${x},${y})`).toBeDefined();
            expect(m!.type, `镜像 type 脱钩 (${x},${y})`).toBe(cell.layers[L.GAS]);
            expect(m!.density, `镜像 density 脱钩 (${x},${y})`).toBe(cell.volume);
        }
    }
}

beforeEach(() => {
    rng.seedRandomGenerator(20260916);
});

// ---------------------------------------------------------------------------
// 对抗①：DF 的 tile 填错层（GAS 的填进 SURFACE 或反之）
// ---------------------------------------------------------------------------
describe('G-2 对抗①：GAS 层 DF 的 tile 填错层即翻红', () => {
    it('目录级：三条 GAS DF 的 tile 归属层必须是 GAS；DF_GAS_FIRE 的必须是 SURFACE', () => {
        // 错误实现：把 STEAM/POISON_GAS 的 tile 认成 SURFACE（生成时
        // setTerrainLayer 写错层、或 DF layer 列照 SURFACE 抄）。
        for (const df of [DF.DF_POISON_GAS_CLOUD, DF.DF_STEAM_ACCUMULATION, DF.DF_METHANE_GAS_PUFF]) {
            const e = DUNGEON_FEATURE_CATALOG[df]!;
            expect(e.layer, `${DF[df]} 本体是 GAS 层 DF`).toBe(L.GAS);
            expect(e.tile, `${DF[df]} tile 必须已填（本轮接线）`).not.toBeNull();
        }
        const gasFire = DUNGEON_FEATURE_CATALOG[DF.DF_GAS_FIRE]!;
        expect(gasFire.layer).toBe(L.SURFACE);
        expect(gasFire.tile).toBe(C.GAS_FIRE);
        // tile 归属层的跨验证：tile 与 DF layer 的归属必须一致（填错层的
        // 实现无论是改 DF.layer 还是认错 tile，两层交叉断言总有一刀命中）。
        expect(TERRAIN_HOME_OF(gasFire.tile!)).toBe(L.SURFACE);
        for (const df of [DF.DF_POISON_GAS_CLOUD, DF.DF_STEAM_ACCUMULATION, DF.DF_METHANE_GAS_PUFF]) {
            const e = DUNGEON_FEATURE_CATALOG[df]!;
            expect(TERRAIN_HOME_OF(e.tile!), `${DF[df]} tile 归属`).toBe(L.GAS);
        }
    });

    it('行为级：点燃毒气后 GAS_FIRE 落在 SURFACE 层，GAS 层绝不出现 GAS_FIRE', () => {
        const grid = roomGrid();
        const mgr = new EnvironmentManager(grid);
        expect(mgr.addGas(4, 4, GasType.POISON, 1000)).toBe(true);
        const r = exposeTileToFire(grid, 4, 4, true);
        expect(r.ignited).toBe(true);
        const cell = grid.getCell(4, 4)!;
        // GAS_FIRE（SURFACE 火地形）必须在 SURFACE 层——错误实现（把
        // DF_GAS_FIRE 按 GAS 层接线）会把 GAS_FIRE 写进 GAS 层，两断言翻红。
        expect(cell.layers[L.SURFACE], '燃气之火落 SURFACE（CE Globals.c:741）').toBe(C.GAS_FIRE);
        for (let x = 0; x < grid.width; x++) {
            for (let y = 0; y < grid.height; y++) {
                expect(grid.getCell(x, y)!.layers[L.GAS], `GAS 层在 (${x},${y}) 出现 GAS_FIRE`)
                    .not.toBe(C.GAS_FIRE);
            }
        }
        expect(cell.isBurning, 'GAS_FIRE 是 T_IS_FIRE 地形（FIRE_TERRAIN_TYPES 载体）').toBe(true);
    });
});

/** Grid.TERRAIN_HOME_LAYER 的本地镜像查询（避免跨文件 import 的重复锁）。 */
function TERRAIN_HOME_OF(t: TerrainType): DungeonLayer {
    const cell = (new Grid(1, 1)).getCell(0, 0)!;
    cell.terrain = t;
    for (let l = 0; l < DungeonLayer.COUNT; l++) {
        if (cell.layers[l] === t) return l as DungeonLayer;
    }
    throw new Error(`terrain ${t} 无归属层`);
}

// ---------------------------------------------------------------------------
// 对抗②：蒸汽源写成一次性而非持续 / 注入点错格
// ---------------------------------------------------------------------------
describe('G-2 对抗②：CE 蒸汽源是"每回合 +15 于被点燃水格"的持续源', () => {
    it('注入点在被点燃的水格：火段暴露一次即 +15 落在水格 GAS 层（updateGases 之前）', () => {
        // 单元级隔离（先于 updateGases 观测——游戏块里体积随后会被均分
        // 摊薄到邻格，水格自身未必保有体积，"注入点"必须在注入时点验证）。
        const grid = roomGrid();
        grid.setTerrain(4, 4, C.WATER_DEEP, '~', 0x1133aa);
        grid.setTerrainLayer(3, 4, L.SURFACE, C.PLAIN_FIRE);
        runFireUpdate(grid, {});
        const water = grid.getCell(4, 4)!;
        expect(water.layers[L.GAS], '蒸汽注入点 = 被点燃的水格').toBe(C.STEAM);
        expect(water.volume, 'DF_STEAM_ACCUMULATION start=15（Globals.c:666）').toBe(15);
        expect(water.layers[L.LIQUID], '水是蒸汽源不是燃料：LIQUID 层不消耗').toBe(C.WATER_DEEP);
        expect(water.isBurning, '深水不得挂火地形').toBe(false);
    });

    it('火贴水期间蒸汽总量逐回合增长（一次性实现的注入-衰减形态在此翻红）', () => {
        // 注：不走 objectiveTimeBlock——晋升驱动里 PLAIN_FIRE 的 5%/回合衰老
        // 掷骰可能（本种子路径下必然）头一回合就把火衰老掉，那是晋升子系统
        // 的合法行为；本对抗的靶子是"蒸汽源持续 vs 一次性"，用
        // updateFires + updateGases 直接驱动把火寿变量隔离掉。
        const game = createHeadlessGame(42);
        openRoom(game);
        game.grid.setTerrain(10, 6, C.WATER_DEEP, '~', 0x1133aa);
        game.grid.setTerrainLayer(9, 6, L.SURFACE, C.PLAIN_FIRE);
        const env = game.environment;
        const step = (): void => {
            env.updateFires([]);
            env.updateGases();
            env.updateGases();
        };
        step();
        const totalAt = (): number => totalVolume(game.grid);
        const v1 = totalAt();
        step(); step();
        const v3 = totalAt();
        step(); step(); step();
        const v6 = totalAt();
        expect(game.grid.getCell(10, 6)!.layers[L.LIQUID], '水层原样').toBe(C.WATER_DEEP);
        // 持续性校验：+15/回合注入压过 QUICK 档消散（期望 −1/回合/格）——
        // "注入一次后衰减"的一次性实现在这两刀翻红。
        expect(v3, `蒸汽总量必须增长：v1=${v1} v3=${v3}`).toBeGreaterThan(v1);
        expect(v6, `蒸汽总量必须继续增长：v3=${v3} v6=${v6}`).toBeGreaterThan(v3);
    });

    it('浅水不可燃（CE SHALLOW_WATER ign=0）：贴火不产蒸汽——灭火层不是蒸锅炉', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        game.grid.setTerrain(10, 6, C.WATER_SHALLOW, '~', 0x3366cc);
        game.grid.setTerrainLayer(9, 6, L.SURFACE, C.PLAIN_FIRE);
        priv(game).objectiveTimeBlock();
        expect(game.grid.getCell(10, 6)!.layers[L.GAS], '浅水不产蒸汽（CE :414 ign 0）')
            .toBe(C.NOTHING);
    });
});

// ---------------------------------------------------------------------------
// 对抗③+④：燃气烧完地上留火（GAS_FIRE 接线 + 缓办撤除）
// ---------------------------------------------------------------------------
describe('G-2 对抗③④：DF_GAS_FIRE 接线完整成形（缓办没撤除的实现翻红）', () => {
    it('点燃毒气格（exposeTileToFire 全链）：体积清零怪癖 + 燃气之火留地 + 残留层收走', () => {
        const grid = roomGrid();
        const mgr = new EnvironmentManager(grid);
        mgr.addGas(4, 4, GasType.POISON, 1000);
        const r = exposeTileToFire(grid, 4, 4, true);
        expect(r.ignited).toBe(true);
        const cell = grid.getCell(4, 4)!;
        // CE Time.c:1361-1368 怪癖："Flammable gas burns its volume away"——
        // GAS 层可燃物先清体积再 promoteTile，且不清层（类型暂留，由下一轮
        // updateVolumetricMedia 收走）。写错顺序（先 promote 后清）或漏清的
        // 实现在这组断言翻红。
        expect(cell.volume, 'CE :1362：燃气被点燃即烧掉全部体积').toBe(0);
        expect(cell.layers[L.SURFACE], '燃气之火留地（SURFACE）').toBe(C.GAS_FIRE);
        expect(cell.layers[L.GAS], '"不清层"怪癖：类型暂留').toBe(C.POISON_GAS);
        mgr.updateGases();
        expect(cell.layers[L.GAS], '体积 0 的残留层在下一轮被收走（CE :1432-1436）')
            .toBe(C.NOTHING);
        // 自熄：GAS_FIRE promoteChance 8000（80%/回合），VANISHES + promoteType
        // 空 ⇒ promoteTile 只清层不落新 DF。驱动至多 40 回合必熄。
        let turns = 0;
        while (grid.getCell(4, 4)!.layers[L.SURFACE] === C.GAS_FIRE && turns < 40) {
            runPromotionUpdate(grid, { keyOnTileAt: () => false });
            turns++;
        }
        expect(grid.getCell(4, 4)!.layers[L.SURFACE], '80%/回合自熄：40 回合内必熄')
            .not.toBe(C.GAS_FIRE);
    });

    it('promoteTile(GAS, useFireDF) 直呼：不再缓办、真实 spawn DF_GAS_FIRE', () => {
        const grid = roomGrid();
        const mgr = new EnvironmentManager(grid);
        mgr.addGas(4, 4, GasType.POISON, 1000);
        const r = promoteTile(grid, 4, 4, L.GAS, true);
        // 缓办回潮（tile 已在却仍缓办——如旧名单残留或预检没摘）在此翻红。
        // 注意 promoteTile 本体不清 GAS 层体积（那是 exposeTileToFire 的
        // 上游职责，CE 同：Time.c:1362 在 :1368 promoteTile 之前）。
        expect(r.deferred, 'tile 已迁：缺 tile 缓办必须撤除').toBeNull();
        expect(r.spawn, '必须真实 spawn DF_GAS_FIRE').not.toBeNull();
        expect(r.spawn!.succeeded).toBe(true);
        expect(r.spawn!.gasVolumeAdded, 'GAS_FIRE 的 start=0：不注体积').toBe(0);
        expect(grid.getCell(4, 4)!.layers[L.SURFACE], '燃气之火留地').toBe(C.GAS_FIRE);
    });

    it('深水点燃的完整链：水 → DF_STEAM_ACCUMULATION → GAS 分支累加（不走缓办）', () => {
        const grid = roomGrid();
        grid.setTerrain(4, 4, C.WATER_DEEP, '~', 0x1133aa);
        const r = promoteTile(grid, 4, 4, L.LIQUID, true);
        expect(r.deferred).toBeNull();
        expect(r.spawn!.gasVolumeAdded, 'DF_STEAM_ACCUMULATION start=15').toBe(15);
        expect(grid.getCell(4, 4)!.volume).toBe(15);
        expect(grid.getCell(4, 4)!.layers[L.GAS]).toBe(C.STEAM);
        // catalogue 级：同一 DF 经 catalogFeature 转换成功（旧代码在此抛错）。
        expect(() => catalogFeature(DF.DF_STEAM_ACCUMULATION)).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// 对抗⑤：火侧回归哨兵（S-1 改造：test 层合成火场——对流位移免疫）
// ---------------------------------------------------------------------------
/** S-1 合成火场公共驱动：mode='test' 层不经真实生成器，全图覆写密封地板房 +
 *  shape 指定的草地形、清怪清物、搭后重播种再点火——曲线只由火机制决定，
 *  任何改生成的轮次（C-5/C-6/后续）都不再触碰它。与 g_3 对抗⑨ 同场景同基线
 *  （等价副本，翻正时两处一起改）。 */
function syntheticFireField(game: Game, shape: (g: Game) => void, reseed: number, ignite: { x: number; y: number }, ticks: number): number[] {
    const W = game.grid.width, H = game.grid.height;
    for (let x = 0; x < W; x++) {
        for (let y = 0; y < H; y++) {
            const border = x === 0 || y === 0 || x === W - 1 || y === H - 1;
            game.grid.setTerrain(x, y, border ? C.WALL : C.FLOOR, border ? '#' : '.', border ? 0x444444 : 0x888888);
        }
    }
    shape(game);
    game.monsters.length = 0;
    game.items.length = 0;
    game.player.loc.x = 4;
    game.player.loc.y = 4;
    rng.seedRandomGenerator(reseed);
    game.environment.ignite(ignite.x, ignite.y);
    const series: number[] = [];
    for (let t = 0; t < ticks; t++) {
        if (game.isGameOver) break;
        game.handlePlayerAction('wait', undefined, 'system');
        let b = 0;
        for (let x = 0; x < game.grid.width; x++) {
            for (let y = 0; y < game.grid.height; y++) {
                if (game.grid.getCell(x, y)?.isBurning) b++;
            }
        }
        series.push(b);
    }
    return series;
}

/** 火场 B：全幅草地被十字街一分为四（象限间不蔓延，只观测单象限动力学）。 */
function fieldB(game: Game): void {
    const W = game.grid.width, H = game.grid.height;
    const mx = Math.floor(W / 2), my = Math.floor(H / 2);
    for (let x = 2; x < W - 2; x++) {
        for (let y = 2; y < H - 2; y++) {
            if (x === mx || x === mx + 1 || y === my || y === my + 1) continue;
            game.grid.setTerrain(x, y, C.GRASS, '"', 0x33aa33);
        }
    }
}

/** 火场 C：蜂窝孔草地（(x+2y)%5==0 抽掉一格）——蔓延沿碎块推进，形态与
 *  实心块完全不同的第二条独立曲线。 */
function fieldC(game: Game): void {
    for (let x = 8; x <= 30; x++) {
        for (let y = 6; y <= 20; y++) {
            if ((x + 2 * y) % 5 === 0) continue;
            game.grid.setTerrain(x, y, C.GRASS, '"', 0x33aa33);
        }
    }
}

describe('G-2 对抗⑤：火侧曲线回归哨兵（S-1 改造：test 层合成火场 B/C）', () => {
    it('火场 B（seed2026 场景流复位）十字街四象限草地：点火蔓延曲线逐位 = S-1 基线。' +
        '错误实现：本轮顺手改动火侧蔓延概率/衰老掷骰/4 邻判据——曲线形态立变。' +
        '原 FIRE-NAT seed2026 哨兵锚定真实地图取景点 + 真实怪物 AI 流位置' +
        '（C-5/C-6 两次实证漂移），S-1 起改锚全合成场景。', () => {
        const game = createHeadlessGame(2026, 'test');
        const series = syntheticFireField(game, fieldB, 2026, { x: 19, y: 7 }, 40);
        // 2026-09-17 S-1 实跑基线（火场 B）。
        expect(series).toEqual([
            2, 4, 6, 4, 4, 5, 8, 9, 8, 10, 10, 10, 12, 15, 16, 17, 21, 22, 23, 28,
            31, 36, 37, 38, 41, 44, 45, 47, 51, 54, 59, 61, 66, 70, 72, 73, 73, 72, 76, 78,
        ]);
    });

    it('火场 C（seed777 场景流复位）蜂窝孔草地：点火蔓延曲线逐位 = S-1 基线。' +
        '原 seed777 哨兵依赖玩家第 22 回合死亡截断（文件自注"更脆弱"），' +
        '合成场景下玩家与火隔离，40 回合全程可观测，脆弱点一并消除。', () => {
        const game = createHeadlessGame(777, 'test');
        const series = syntheticFireField(game, fieldC, 777, { x: 20, y: 13 }, 40);
        // 2026-09-17 S-1 实跑基线（火场 C）。
        expect(series).toEqual([
            1, 1, 1, 1, 1, 1, 1, 2, 3, 3, 3, 4, 3, 3, 3, 4, 4, 5, 5, 6,
            6, 7, 9, 11, 13, 14, 16, 12, 13, 13, 12, 12, 11, 13, 13, 13, 14, 15, 16, 16,
        ]);
    });
});

// ---------------------------------------------------------------------------
// 对抗⑥：G-1 扩散/守恒算法哨兵（新气源量纲下复验）
// ---------------------------------------------------------------------------
describe('G-2 对抗⑥：G-1 扩散算法不被本轮意外改动（经 DF 管线注入复验）', () => {
    it('毒气陷阱量纲（1000）注入：单轮体积守恒 + 对角邻参与均分', () => {
        const grid = roomGrid();
        const mgr = new EnvironmentManager(grid);
        // 经 DF 管线（catalogFeature → spawnDungeonFeature）注入——本轮接的
        // 正是这条管线；管线的"新气源初值"不许引来算法改动。
        const feat = catalogFeature(DF.DF_POISON_GAS_CLOUD);
        const spawn = spawnDungeonFeature(grid, 4, 4, feat, false);
        expect(spawn.gasVolumeAdded).toBe(1000);
        expect(grid.getCell(4, 4)!.layers[L.GAS]).toBe(C.POISON_GAS);
        // 守恒 + 对角：9000/9=1000 整除口径（把总量凑成 9000）。
        mgr.addGas(4, 4, GasType.POISON, 8000);
        mgr.updateGases();
        expect(totalVolume(grid), '单轮总量逐位守恒（算法被改即翻红）').toBe(9000);
        for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
            expect(grid.getCell(4 + dx, 4 + dy)!.volume, `对角邻 (${4 + dx},${4 + dy})`)
                .toBe(1000);
        }
    });

    it('甲烷的量纲与旗标：无消散旗标——整除注入 20 轮体积逐位不变', () => {
        const grid = roomGrid();
        const mgr = new EnvironmentManager(grid);
        // DF 管线烟囱：甲烷一缕 = 2 体积落 METHANE_GAS 层。
        const feat = catalogFeature(DF.DF_METHANE_GAS_PUFF);
        spawnDungeonFeature(grid, 4, 4, feat, false);
        expect(grid.getCell(4, 4)!.layers[L.GAS]).toBe(C.METHANE_GAS);
        // 静态守卫：CE Globals.c:507 无 TM_GAS_DISSIPATES(_QUICKLY)——
        // 给甲烷抄消散旗标的实现在此翻红。
        const mech = TERRAIN_FLAGS[C.METHANE_GAS]!.mechFlags;
        expect(mech & TM_GAS_DISSIPATES, '沼气不得带 SLOW 消散').toBe(0);
        expect(mech & TM_GAS_DISSIPATES_QUICKLY, '沼气不得带 QUICK 消散').toBe(0);
        // 动态守卫：2 体积在随机舍入下是期望守恒（CE 同——每格独立进位，
        // 总量会漂移），不适合做逐位断言；改用整除注入 9000（9000/9=1000，
        // 无进位、无消散）。只跑 2 轮、体积仍居 5×5 内部（9 格邻域、
        // numSpaces 恒 9 ⇒ 逐位精确）——任何消散旗标都会让总量 <9000。
        // （更长的 horizon 会触及房间墙界：CE 算法在 T_OBSTRUCTS_GAS 邻域
        // 有期望漂移（实测 6 轮 +17%），那是 updateVolumetricMedia 的原样
        // 性质，不是本轮可修的偏差——守恒断言因此只取内部相位。）
        grid.getCell(4, 4)!.volume = 9000;
        mgr.updateGases();
        mgr.updateGases();
        expect(totalVolume(grid), '沼气永不自散（CE 原样）').toBe(9000);
    });
});

// ---------------------------------------------------------------------------
// 对抗⑦：无载体的 tile 被接成空转链 / 未迁移气体只登记
// ---------------------------------------------------------------------------
describe('G-2 对抗⑦：未迁移气体只登记（载体盘点表的显式留痕）', () => {
    // G-3 翻转（原断言"五气体无 tile 载体"）：PARALYSIS_GAS 于 G-3 拿到
    // 真载体（potion_of_paralysis 改线，CE Items.c:6994/8118）而出列；
    // 其余四气体仍无载体，只登记的半边原样保留。原断言内容存档：
    // "ROT/STENCH/PARALYSIS/DARKNESS/HEALING 五气体无 tile 成员、
    // 无 GasType 成员、无 DF 条目"。
    it('ROT/DARKNESS/HEALING 三气体无 tile 载体、无 GasType 成员、无 DF 条目（G-3 翻转：PARALYSIS 出列）', () => {
        // "只登记"的形态（本断言即登记）：这四种气体不迁 tile——
        // 它们没有 TerrainType/GasType 成员、不在目录里。接成空转链的
        // 错误实现（tile 迁了但无生产写入点、或 DF 条目 tile=null 挂着
        // 无人触发）在这组结构性断言下无所遁形。
        const names = (TerrainType as unknown as Record<string, unknown>);
        for (const n of ['ROT_GAS', 'DARKNESS_CLOUD', 'HEALING_CLOUD']) {
            expect(names[n], `${n} 不得有 tile 成员（载体盘点：无 web 载体，只登记）`).toBeUndefined();
        }
        const gasNames = (GasType as unknown as Record<string, unknown>);
        for (const n of ['ROT', 'STENCH', 'DARKNESS', 'HEALING']) {
            expect(gasNames[n], `GasType.${n} 不得存在`).toBeUndefined();
        }
        // 值域对照：G-2/G-3 迁移的成员必须在位（防止有人把本断言连坐删掉）。
        expect(isGasTerrain(C.METHANE_GAS), 'METHANE_GAS 已迁，有载体').toBe(true);
        expect(names['GAS_FIRE']).toBeDefined();
        expect(isGasTerrain(C.PARALYSIS_GAS), 'G-3：PARALYSIS_GAS 已迁，载体 = 麻痹药水').toBe(true);
        expect(names['PARALYSIS_GAS']).toBeDefined();
        // V-2b-9d: MUD_FLOOR fire now produces a real stench gas tile.
        expect(isGasTerrain(C.STENCH_SMOKE_GAS)).toBe(true);
        expect(DUNGEON_FEATURE_CATALOG[DF.DF_STENCH_SMOLDER]!.tile).toBe(C.STENCH_SMOKE_GAS);
        expect(() => catalogFeature(DF.DF_STENCH_SMOLDER)).not.toThrow();
        // 24 条 GAS 目录里无载体的条目不入 DF 目录（登记 ≠ 抄目录）：
        // DF_ROT_GAS_*（32/41）、DF_DEWAR_*（71-74）、DF_STENCH_*（217/218）、
        // DF_DARKNESS_POTION（134）、DF_BLOODFLOWER_POD_BURST（70）等仍不在。
        // 旧注将 159 误称为 DF_PARALYSIS_GAS_CLOUD_POTION；按 Rogue.h 枚举数序，
        // 159 实为 DF_SHALLOW_WATER，本轮水扩散闭包合法使用该 id。
        // V-2b-9a：159=DF_SHALLOW_WATER 是水扩散闭包成员；218=DF_STENCH_SMOLDER
        // 由 MUD_FLOOR.fireType 引入。二者已获授权，边界守卫只移除这两项。
        for (const id of [32, 41, 70, 71, 72, 73, 74, 134, 217]) {
            expect(DUNGEON_FEATURE_CATALOG[id as DF], `DF#${id} 不得提前入目录`).toBeUndefined();
        }
    });

    // 验收方 F-2c 后翻转（原名："DF_EXPLOSION_FIRE 登记为缺 tile（爆炸归
    // F-2c）：catalogFeature 抛错点名 GAS_EXPLOSION"）。G-2 把条目备好、
    // tile 留 null 登记进 DF_MISSING_TILES 并预测"填 tile 后爆炸圈自动成形"；
    // F-2c 迁移 GAS_EXPLOSION tile（Globals.c:496）并填 tile，本留痕的前提
    // （tile 缺失）失效。守卫语义反转为新事实：条目完整接线 + 摘出名单
    // （名单守卫保留：仍恰 6 条，防"接线顺手删登记"）。
    it('F-2c 翻转：DF_EXPLOSION_FIRE 已接线（tile GAS_EXPLOSION 已迁），catalogFeature 正常转换且不在缺 tile 名单', () => {
        // B-3 顺延（验收方 2026-09-17 补授权——同样是两段 grep 的漏项）：
        // DF_MISSING_TILES 是**跨轮公共登记表**，任何新增"web 无对应 tile"的
        // DF 都会把它顶长，而它偏偏钉在一个按主题命名的气体测试里——
        // 按主题关键词 grep 永远搜不到它。6 → 7：B-3 的 DF_SHATTERING_SPELL
        // 需要 RUBBLE（CE Globals.c:679 `{RUBBLE, SURFACE, 0, 0,
        // DFF_ACTIVATE_DORMANT_MONSTER}`），web 无该地形，故照惯例 tile 留 null
        // 并登记。名单守卫的原意（防"接线顺手删登记"）保持不变。
        // V-2b-2b 再顺延（本文件不在该轮 §6 授权清单——跨轮公共登记表再次
        // 被按主题命名的本文件钉住）：23 号蓝图的 DF_SHOW_TRAPDOOR（TRAP_DOOR
        // tile web 无，CE Globals.c:628）入列，7 → 8。
        // **V-2b-3 第三次顺延**（同一机理：DF_MISSING_TILES 是跨轮公共登记表，
        // 钉它的断言按主题分散存放，本轮主题词 wired/paralysis 与本文件名
        // 完全不重合）：wired 载体 DF 链的 11 个 web 无 tile 环节入列，
        // 8 → 19。逐条见 DungeonFeatureCatalog 的 V-2b-3 块注与 c_4b E4；
        // 三链 tile 已齐的三条（DF_SHOW_PARALYSIS_GAS_TRAP / DF_VENT_SPEW_
        // METHANE / DF_PARALYSIS_VENT_SPEW）不入列。守卫原意不变。
        // **V-2b-4 第四次顺延**（同一机理再证：名单是跨轮公共登记表，钉它的
        // 断言按主题分散存放，本轮主题词 altar/cage 与本文件名 "gas" 不重合）：
        // 祭坛族轮八条新目录条目里 web 无 tile 的七条入列，19 → 26。逐条见
        // DungeonFeatureCatalog 的 V-2b-4 块注与 c_4b E4；唯一 tile 完整的
        // DF_CAGE_DISAPPEARS（tile ALTAR_INERT = web TerrainType.ALTAR）不入列。
        // 守卫仍全等钉死长度，不放宽成 contains/大于。
        // **V-2b-5 第五次顺延**：休眠唤醒轮四条新条目里 web 无 tile 的两条
        //（DF_WALL_CRACK / DF_CRACKING_STATUE）入列，26 → 28。逐条见
        // DungeonFeatureCatalog 的 V-2b-5 块注与 v_2b_5_dormant A3。
        // **V-2b-6 第六次顺延**：钥匙轮七条新条目里 web 无 tile 的两条
        //（DF_SHOW_POISON_GAS_VENT / DF_POISON_GAS_VENT_OPEN）入列、
        // DF_OPEN_PORTCULLIS 摘除（tile PORTCULLIS_DORMANT 该轮落地），
        // 净 28 → 29。逐条见 DungeonFeatureCatalog 的 V-2b-6 块注与 c_4b E4。
        expect(DF_MISSING_TILES, 'F-2c 后 DF_EXPLOSION_FIRE 已摘出缺 tile 名单').not.toContain(DF.DF_EXPLOSION_FIRE);
        // V-2b-7：29 → 31（摘 5 增 7，DF 特征系统轮——RUBBLE/LUMINESCENT_FUNGUS
        // 两条地形落地摘除四条 RUBBLE 链 DF 与 DF_LUMINESCENT_FUNGUS，新增
        // 七条 tile 无 web 载体的新条目）。
        expect(DF_MISSING_TILES).toHaveLength(20); // U17c: five more carriers restored; the other 20 stay missing.
        const f = catalogFeature(DF.DF_EXPLOSION_FIRE);
        expect(f.tile).toBe(C.GAS_EXPLOSION);
        expect(f.startProbability).toBe(60);
        expect(f.probabilityDecrement).toBe(17);
    });
});

// ---------------------------------------------------------------------------
// 对抗⑧：甲烷爆轰分支（TM_EXPLOSIVE_PROMOTE）与 ALL_DIRS8 方向
// ---------------------------------------------------------------------------
describe('G-2 对抗⑧：爆轰分支激活 + 8 邻计数逐向正确（ALL_DIRS8 回归钉）', () => {
    /** 中央甲烷格，neighbors 指定的 8 邻放 PLAIN_FIRE，其余放 FLOOR。 */
    function methaneWithFires(fires: Set<string>): Grid {
        const grid = roomGrid();
        const mgr = new EnvironmentManager(grid);
        mgr.addGas(4, 4, GasType.METHANE, 1000);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                if (fires.has(`${dx},${dy}`)) {
                    grid.setTerrainLayer(4 + dx, 4 + dy, L.SURFACE, C.PLAIN_FIRE);
                }
            }
        }
        return grid;
    }
    const ALL8 = new Set(
        [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]
            .map(([a, b]) => `${a},${b}`)
    );

    // 验收方 F-2c 后翻转（原名："…→ 因 GAS_EXPLOSION 缺 tile 缓办"）。
    // G-2 时代爆轰判定可达但落地缓办（DF_EXPLOSION_FIRE tile=null）；F-2c
    // 迁移 tile 后预测兑现——爆轰圈真实成形。守卫语义保留并加强：
    // 分支选路（promoteType 而非 fireType）由"落的是 GAS_EXPLOSION、
    // 不是 GAS_FIRE"钉死；体积先清零的 CE :1362 怪癖断言原样保留。
    it('F-2c 翻转：8 邻全火 → 爆轰路（promoteType DF_EXPLOSION_FIRE）→ GAS_EXPLOSION 爆炸圈真实落地', () => {
        const grid = methaneWithFires(ALL8);
        const r = exposeTileToFire(grid, 4, 4, true);
        expect(r.ignited).toBe(true);
        // 爆轰 = useFireDF=false → promoteType：落 GAS_EXPLOSION（爆炸圈，
        // 起码覆盖原点格），而不是普通点燃的 GAS_FIRE。
        const cell = grid.getCell(4, 4)!;
        expect(cell.volume, 'CE :1362 怪癖在爆轰路同样生效：体积先清零').toBe(0);
        expect(cell.layers[L.SURFACE], '爆轰落下的是爆炸地形 GAS_EXPLOSION').toBe(C.GAS_EXPLOSION);
        // 分支选路守卫：普通点燃的产物 GAS_FIRE 不得出现（错走 fireType 的
        // 实现在此翻红）。
        expect(cell.layers[L.SURFACE], '爆轰不走 fireType：不留燃气之火').not.toBe(C.GAS_FIRE);
        // 落格登记：爆炸格带 T_CAUSES_EXPLOSIVE_DAMAGE，进 explosiveSpawnCells
        // （调用方据此在落格瞬间结算爆炸伤害——CE fillSpawnMap refresh 分支）。
        expect(r.explosiveSpawnCells.length, '爆轰落格登记爆炸瞬时结算点').toBeGreaterThan(0);
    });

    it('唯 (1,1) 角为地板（7 火邻）→ 不爆轰、走 fireType 留燃气之火——' +
        'ALL_DIRS8 抄错（{1,-1} 重复、{1,1} 缺失）的实现把 7 邻误数成 8，翻红', () => {
        const fires = new Set([...ALL8].filter((s) => s !== '1,1'));
        const grid = methaneWithFires(fires);
        const r = exposeTileToFire(grid, 4, 4, true);
        expect(r.ignited).toBe(true);
        // 方向数组若漏查 (1,1)、重复查 (1,-1)：计数 8 → 误爆轰 → 走 promoteType
        // 缓办、GAS_FIRE 不落地——下面两断言双双翻红。
        expect(grid.getCell(4, 4)!.layers[L.SURFACE], '7 邻不构成爆轰：燃气之火必须留地')
            .toBe(C.GAS_FIRE);
        expect(grid.getCell(4, 4)!.volume, 'CE :1362：GAS 层体积清零').toBe(0);
    });
});

// ---------------------------------------------------------------------------
// 对抗⑨：G-1 预测"tile 填上即自动生效"的游戏级验收
// ---------------------------------------------------------------------------
describe('G-2 对抗⑨：MUD → DF_METHANE_GAS_PUFF 晋升链自动产气 + 镜像对账', () => {
    it('泥格晋升命中后：沼气经 GAS 分支落地、gasGrid 镜像经 Game 对账分支同步', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        // V-2b-9e-1：原场景实测只有目标泥格，增量来自 CE Time.c:1423-1426
        // 的逐格随机舍入（2→3→3），不是其他泥格产气。封闭两格气室使
        // 两轮扩散均为 2/2=1，无余数，≤2 才是不受随机舍入干扰的硬合同。
        // 玩家仍在外面的房间；四周含斜角全部封墙，气体不能漏到第三格。
        for (let x = 7; x <= 10; x++) {
            for (let y = 7; y <= 9; y++) game.grid.setTerrain(x, y, C.WALL, '#', 0x444444);
        }
        game.grid.setTerrain(9, 8, C.FLOOR, '.', 0x888888);
        game.grid.setTerrain(8, 8, C.MUD, '~', 0x664422);
        expect(totalVolume(game.grid), '晋升前全图无残留气体').toBe(0);
        // MUD 的 promoteChance=100（1%/回合）对测试太慢：临时抬到 10000
        // （确定性必中），测完还原。数据本体不动。
        const mudEntry = TERRAIN_FLAGS[C.MUD] as { promoteChance: number };
        const saved = mudEntry.promoteChance;
        mudEntry.promoteChance = 10000;
        try {
            priv(game).objectiveTimeBlock();
        } finally {
            mudEntry.promoteChance = saved;
        }
        // 晋升链真的产气（G-1 预测的前半："tile 填上即自动走 GAS 分支"）。
        // PromoteTileResult 不携带坐标，按"LIQUID 层 + 产气 spawn"定位。
        const gasPromotions = game.lastPromotionUpdate!.promotions.filter(
            (p) => p.layer === L.LIQUID && p.spawn !== null
        );
        expect(gasPromotions, '全图只能有目标泥格这一次晋升产气').toHaveLength(1);
        const promo = gasPromotions[0];
        expect(promo, 'MUD 晋升必须发生在 LIQUID 层').toBeDefined();
        expect(promo!.deferred, 'DF_METHANE_GAS_PUFF tile 已迁：不缓办').toBeNull();
        expect(promo!.spawn!.gasVolumeAdded, '沼气一缕 = 2 体积（Globals.c:667）').toBe(2);
        // Preserve the original immediate mirror obligation before another diffusion
        // could repair a missing promotion-to-mirror update.
        expectMirrorMatchesTruth(game);
        // U03b / CE Time.c:1600–1616: gas diffuses BEFORE promotions.
        // Advance to the next real environment phase, suppressing a second puff
        // so the original two-cell conservation assertions still isolate 2 units.
        mudEntry.promoteChance = 0;
        try { priv(game).objectiveTimeBlock(); } finally { mudEntry.promoteChance = saved; }
        // 体积守恒地散开（甲烷无消散旗标），镜像必须与真相逐格一致
        // （G-1 预测的后半：Game 的 gasVolumeAdded 对账分支自动成为活路径）。
        // 2 体积已由上面的同步返回值钉死。两格均分不产生舍入误差，
        // 继续用全图 ≤2 拦截真实增量；逐格 1+1 同时拒绝空跑/气体丢失。
        expect(totalVolume(game.grid), '2 体积扩散后不得凭空增加')
            .toBeLessThanOrEqual(2);
        expect([game.grid.getCell(8, 8)!.volume, game.grid.getCell(9, 8)!.volume],
            '两轮真实扩散后两格各为 1 体积').toEqual([1, 1]);
        expectMirrorMatchesTruth(game);
    });
});
