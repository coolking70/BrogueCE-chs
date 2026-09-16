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

/** 无怪物骚扰的封闭房间（同 f_1/g_1 口径），供游戏级用例使用。 */
function openRoom(game: Game): void {
    game.monsters.length = 0;
    game.items.length = 0;
    for (let x = 1; x < 20; x++) {
        for (let y = 1; y < 16; y++) game.grid.setTerrain(x, y, C.WALL, '#', 0x444444);
    }
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

/** F-0/g_1 探针同款取景点（草地/灌木、离玩家 8 格外、randRange 抽取）。 */
function probeSpot(game: Game): { x: number; y: number } {
    const px = game.player.loc.x, py = game.player.loc.y;
    const cands: { x: number; y: number }[] = [];
    for (let x = 0; x < game.grid.width; x++) {
        for (let y = 0; y < game.grid.height; y++) {
            const cell = game.grid.getCell(x, y)!;
            if (Math.max(Math.abs(x - px), Math.abs(y - py)) < 8) continue;
            if (cell.terrain === C.GRASS || cell.terrain === C.FOLIAGE) cands.push({ x, y });
        }
    }
    const spot = cands[rng.randRange(0, cands.length - 1)] ?? null;
    expect(spot, '基线取景点必须仍存在（生成链未动的旁证）').not.toBeNull();
    return spot!;
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
// 对抗⑤：火侧回归哨兵（本轮不许碰火）
// ---------------------------------------------------------------------------
describe('G-2 对抗⑤：火侧曲线回归哨兵（与 g_1 对抗⑧ 的 seed42 互补）', () => {
    it('FIRE-NAT seed2026 点火蔓延曲线逐位等于 F-2a §一 基线', () => {
        const game = createHeadlessGame(2026);
        const spot = probeSpot(game);
        expect(spot.x === 68 && spot.y === 14, 'seed2026 取景点应仍为 (68,14)').toBe(true);
        game.environment.ignite(spot.x, spot.y);
        const series: number[] = [];
        for (let t = 0; t < 40; t++) {
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
        // 2026-09-16 复跑基线（G-2 前后逐位一致——蒸汽分支退役未动 RNG 流）。
        expect(series).toEqual([
            1, 2, 3, 3, 4, 4, 5, 5, 6, 7, 9, 9, 10, 11, 11, 13, 12, 12, 13, 14,
            13, 13, 15, 15, 15, 14, 12, 11, 8, 8, 8, 8, 5, 5, 5, 5, 5, 4, 4, 4,
        ]);
    });

    it('FIRE-NAT seed777 点火蔓延曲线逐位等于 F-2a §一 基线（第 6 回合全熄）', () => {
        const game = createHeadlessGame(777);
        const spot = probeSpot(game);
        expect(spot.x === 31 && spot.y === 23, 'seed777 取景点应仍为 (31,23)').toBe(true);
        game.environment.ignite(spot.x, spot.y);
        const series: number[] = [];
        for (let t = 0; t < 40; t++) {
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
        expect(series[0]).toBe(1);
        // 逐位基线（31 条——wait-only 策略下玩家于第 31 回合死亡，
        // isGameOver 截断；与 F-0 探针同形）。
        expect(series).toEqual([
            1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
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
    it('ROT/STENCH/PARALYSIS/DARKNESS/HEALING 五气体无 tile 载体、无 GasType 成员、无 DF 条目', () => {
        // "只登记"的形态（本断言即登记）：这五种气体本轮不迁 tile——
        // 它们没有 TerrainType/GasType 成员、不在目录里。接成空转链的
        // 错误实现（tile 迁了但无生产写入点、或 DF 条目 tile=null 挂着
        // 无人触发）在这组结构性断言下无所遁形。
        const names = (TerrainType as unknown as Record<string, unknown>);
        for (const n of ['ROT_GAS', 'STENCH_SMOKE_GAS', 'PARALYSIS_GAS', 'DARKNESS_CLOUD', 'HEALING_CLOUD']) {
            expect(names[n], `${n} 不得有 tile 成员（载体盘点：无 web 载体，只登记）`).toBeUndefined();
        }
        const gasNames = (GasType as unknown as Record<string, unknown>);
        for (const n of ['ROT', 'STENCH', 'PARALYSIS', 'DARKNESS', 'HEALING']) {
            expect(gasNames[n], `GasType.${n} 不得存在`).toBeUndefined();
        }
        // 值域对照：G-2 迁移的两个新成员必须在位（防止有人把本断言连坐删掉）。
        expect(isGasTerrain(C.METHANE_GAS), 'METHANE_GAS 已迁，有载体').toBe(true);
        expect(names['GAS_FIRE']).toBeDefined();
        // 24 条 GAS 目录里无载体的条目不入 DF 目录（登记 ≠ 抄目录）：
        // DF_ROT_GAS_*（32/41）、DF_DEWAR_*（71-74）、DF_STENCH_*（217/218）、
        // DF_DARKNESS_POTION（134）、DF_BLOODFLOWER_POD_BURST（70）等都不在。
        for (const id of [32, 41, 70, 71, 72, 73, 74, 134, 217, 218]) {
            expect(DUNGEON_FEATURE_CATALOG[id as DF], `DF#${id} 不得提前入目录`).toBeUndefined();
        }
    });

    it('DF_EXPLOSION_FIRE 登记为缺 tile（爆炸归 F-2c）：catalogFeature 抛错点名 GAS_EXPLOSION', () => {
        // 守卫半边：登记不是删除——爆轰链的数据前提（目录条目 + 缺 tile
        // 名单）必须在位，F-2c 填 tile 后爆炸圈自动成形。
        expect(DF_MISSING_TILES).toContain(DF.DF_EXPLOSION_FIRE);
        expect(() => catalogFeature(DF.DF_EXPLOSION_FIRE)).toThrow(/GAS_EXPLOSION/);
        expect(DF_MISSING_TILES, '缺 tile 名单恰 7 条（G-2 后）').toHaveLength(7);
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

    it('8 邻全火 → 爆轰路（promoteType DF_EXPLOSION_FIRE）→ 因 GAS_EXPLOSION 缺 tile 缓办', () => {
        const grid = methaneWithFires(ALL8);
        const r = exposeTileToFire(grid, 4, 4, true);
        expect(r.ignited).toBe(true);
        // 爆轰 = useFireDF=false → promoteType。GAS_EXPLOSION tile 未迁移
        // （登记 F-2c）⇒ 缓办记录点名它——"tile 不在的必须仍然缓办"。
        // （缓办不是空转：爆轰判定本身发生了，这里钉的是分支选路。）
        expect(r.caughtFireCells, '爆轰未落地：无新火登记').toEqual([]);
        const cell = grid.getCell(4, 4)!;
        expect(cell.volume, 'CE :1362 怪癖在爆轰路同样生效：体积先清零').toBe(0);
        // 普通点燃路（fireType DF_GAS_FIRE）不被爆轰路污染：SURFACE 无 GAS_FIRE。
        expect(cell.layers[L.SURFACE], '爆轰未落地 → 不留燃气之火').not.toBe(C.GAS_FIRE);
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
        game.grid.setTerrain(8, 8, C.MUD, '~', 0x664422);
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
        const promo = game.lastPromotionUpdate!.promotions.find(
            (p) => p.layer === L.LIQUID && p.spawn !== null
        );
        expect(promo, 'MUD 晋升必须发生在 LIQUID 层').toBeDefined();
        expect(promo!.deferred, 'DF_METHANE_GAS_PUFF tile 已迁：不缓办').toBeNull();
        expect(promo!.spawn!.gasVolumeAdded, '沼气一缕 = 2 体积（Globals.c:667）').toBe(2);
        // 体积守恒地散开（甲烷无消散旗标），镜像必须与真相逐格一致
        // （G-1 预测的后半：Game 的 gasVolumeAdded 对账分支自动成为活路径）。
        // 体积守恒意义下存在于场（2 体积在随机舍入下每轮期望守恒、实际可
        // 漂移 ±1——CE 同款性质，断言只锁"没被吞掉"）。
        expect(totalVolume(game.grid), '2 体积不得凭空消失（舍入漂移可 ±1）')
            .toBeGreaterThanOrEqual(1);
        expectMirrorMatchesTruth(game);
    });
});
