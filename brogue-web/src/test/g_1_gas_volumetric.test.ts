/**
 * src/test/g_1_gas_volumetric.test.ts — G-1：气体迁入 GAS 层 + CE 体积模型的验收与对抗。
 *
 * 断言口径（每条都能在一个具体的、合理的错误实现下失败，见各用例注释）：
 *   - 单元级：手搭 Grid + EnvironmentManager，rng.seedRandomGenerator 固定种子，
 *     直接驱动 updateGases()（= CE updateVolumetricMedia 单轮）；
 *   - 游戏级：createHeadlessGame + objectiveTimeBlock（每回合两轮的生产节奏）。
 *
 * 覆盖任务书 §六.2 点名的八类错误实现（4 邻 / 15% / 单轮 / 不守恒 /
 * 抹掉随机舍入 / 定值消散 / 混合判据写反 / 火侧哨兵 / 层与镜像脱钩），
 * 外加：chasm 逃逸、被困气散逸、D2 无载体类型拒绝、无气回合零 RNG 守卫、
 * 存档往返、POISON≢CONFUSION 破缺哨兵。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createHeadlessGame } from './harness';
import type { Game } from '../engine/Core/Game';
import { Grid, TerrainType, DungeonLayer } from '../engine/Map/Grid';
import { EnvironmentManager, GasType, isGasTerrain } from '../engine/Environment/Gas';
import { rng } from '../engine/Random';
import { cellTerrainFlags } from '../engine/Map/DungeonFeature';
import { T_OBSTRUCTS_GAS } from '../engine/Map/TerrainCatalog';
import { spawnDungeonFeature } from '../engine/Map/DungeonFeature';

const C = TerrainType;
const L = DungeonLayer;

/** 手搭 9×9 石头房：全墙，中央 7×7 地板，(4,4) 为中心。 */
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

function managerOver(grid: Grid): EnvironmentManager {
    return new EnvironmentManager(grid);
}

/** 全场 volume 总量（守恒口径）。 */
function totalVolume(grid: Grid): number {
    let t = 0;
    for (let x = 0; x < grid.width; x++) {
        for (let y = 0; y < grid.height; y++) t += grid.getCell(x, y)!.volume;
    }
    return t;
}

/** 镜像 ≡ 事实来源（layers[GAS]/volume）的全场扫描。 */
function expectMirrorMatchesTruth(grid: Grid, mgr: EnvironmentManager): void {
    for (let x = 0; x < grid.width; x++) {
        for (let y = 0; y < grid.height; y++) {
            const cell = grid.getCell(x, y)!;
            const m = mgr.gasGrid[x]?.[y];
            expect(m, `镜像缺 (${x},${y})`).toBeDefined();
            expect(m!.type, `镜像 type 脱钩 (${x},${y})`).toBe(cell.layers[L.GAS]);
            expect(m!.density, `镜像 density 脱钩 (${x},${y})`).toBe(cell.volume);
        }
    }
}

type Priv = { objectiveTimeBlock(): void };
const priv = (game: Game): Priv => game as unknown as Priv;

/** 无怪物骚扰的封闭房间（同 f_1/p1_24 口径），供游戏级用例使用。 */
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

beforeEach(() => {
    rng.seedRandomGenerator(20260916);
});

// ---------------------------------------------------------------------------
// 对抗①：扩散仍用 4 邻（漏对角）
// ---------------------------------------------------------------------------
describe('G-1 对抗①：8 邻扩散（4 邻实现在此翻红）', () => {
    it('单轮均分后对角邻格必须拿到体积（CE nbDirs 8 向，GlobalsBase.c:38）', () => {
        const grid = roomGrid();
        const mgr = managerOver(grid);
        // 不可见体积（layers[GAS]=NOTHING，无消散旗标）：隔离消散因素。
        grid.getCell(4, 4)!.volume = 9000;
        mgr.updateGases();
        // 9000/9 = 1000 整除：8 个邻居全部拿到体积——对角邻 (3,3) 为 0
        // 即是"扩散仍用 4 邻"的错误实现。
        for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
            const v = grid.getCell(4 + dx, 4 + dy)!.volume;
            expect(v, `对角邻 (${4 + dx},${4 + dy}) 必须参与均分`).toBeGreaterThan(0);
        }
        expect(grid.getCell(3, 4)!.volume, '正交邻同样拿到体积').toBe(1000);
    });
});

// ---------------------------------------------------------------------------
// 对抗②：仍用 15%/邻 固定比例（非守恒均分）
// ---------------------------------------------------------------------------
describe('G-1 对抗②：体积守恒均分（15% 固定比例实现在此翻红）', () => {
    it('单轮后中心份额 ≈ 1/9（15%×4 邻的中心会保留 40%），且总量精确守恒', () => {
        const grid = roomGrid();
        const mgr = managerOver(grid);
        grid.getCell(4, 4)!.volume = 9000; // 9000%9=0：连随机舍入都不触发
        mgr.updateGases();
        const center = grid.getCell(4, 4)!.volume;
        const total = totalVolume(grid);
        expect(total, '不可见残气无消散旗标：总量必须精确守恒').toBe(9000);
        // CE 均分：中心 = 9000/9 = 1000（份额 11%）。15%/邻实现：中心保留
        // 9000×(1−4×0.15)=5400（60%）——以 20% 为界双向捕获。
        expect(center, '中心份额必须接近 1/9（守恒均分，不是 15%/邻）')
            .toBeLessThanOrEqual(1800);
        expect(center).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// 对抗③：每回合只跑一轮（漏 CE 的两轮）
// ---------------------------------------------------------------------------
describe('G-1 对抗③：每玩家回合两轮 updateVolumetricMedia（Time.c:1606）', () => {
    it('一次 wait 后气体必须到达切比雪夫距离 2（单轮实现只到 1，在此翻红）', () => {
        const game = createHeadlessGame(7);
        openRoom(game);
        expect(game.environment.addGas(9, 7, GasType.POISON, 1000)).toBe(true);
        game.handlePlayerAction('wait', undefined, 'system');
        let far = 0;
        for (let x = 0; x < game.grid.width; x++) {
            for (let y = 0; y < game.grid.height; y++) {
                if (Math.max(Math.abs(x - 9), Math.abs(y - 7)) === 2
                    && game.grid.getCell(x, y)!.volume > 0) far++;
            }
        }
        expect(far, '两轮均分：距离 2 的格当回合就该有气（漏掉第二轮的实现到不了）')
            .toBeGreaterThan(0);
    });

    it('Game.objectiveTimeBlock 的探测守卫：无气体回合跳过两轮（CE Time.c:1600-1613）', () => {
        const game = createHeadlessGame(7);
        openRoom(game);
        const cumBase = rng.randomNumbersGenerated; // create 后的累计抽取数
        priv(game).objectiveTimeBlock();
        const cum1 = rng.randomNumbersGenerated;
        priv(game).objectiveTimeBlock();
        expect(cum1 - cumBase, '连续无气回合的每回合抽取数应恒定')
            .toBe(rng.randomNumbersGenerated - cum1);
        // 注气 → 推一轮 → 清气（clearGasAt 清真相）→ 再推一轮：
        // 清气后的回合必须回到无气回合的抽取水位（探测守卫没被拆掉）。
        game.environment.addGas(9, 7, GasType.POISON, 1000);
        priv(game).objectiveTimeBlock();
        const withGasDraws = rng.randomNumbersGenerated - cum1;
        for (let x = 2; x <= 16; x++) {
            for (let y = 2; y <= 12; y++) game.environment.clearGasAt(x, y);
        }
        priv(game).objectiveTimeBlock();
        const afterClear = rng.randomNumbersGenerated - cum1 - withGasDraws;
        expect(afterClear, '清气后回合的抽取数应与注气前同水位（探测守卫生效）')
            .toBeLessThan(withGasDraws / 4);
    });
});

// ---------------------------------------------------------------------------
// 对抗④：体积不守恒
// ---------------------------------------------------------------------------
describe('G-1 对抗④：体积守恒（Time.c:1408-1410 均分语义）', () => {
    it('整除注入下单轮总量逐位不变（丢失/克隆体积的实现在此翻红）', () => {
        const grid = roomGrid();
        const mgr = managerOver(grid);
        grid.getCell(4, 4)!.volume = 7200; // 7200/9 = 800 整除
        mgr.updateGases();
        expect(totalVolume(grid), '单轮均分必须逐位守恒（不可见气不消散）').toBe(7200);
    });
});

// ---------------------------------------------------------------------------
// 对抗⑤：随机舍入被抹成确定性取整
// ---------------------------------------------------------------------------
describe('G-1 对抗⑤：随机舍入（stochastic rounding，Time.c:1409-1410）', () => {
    it('非整除注入后 9 格必须出现两种余数结果（全 floor / 全 ceil 实现都翻红）', () => {
        // 种子 1 实测产生混合分布（8/9 进位概率下 ~35% 的种子会全进位——
        // 换种子前先确认混合仍在，否则断言对 CE 忠实实现假红）。
        rng.seedRandomGenerator(1);
        const grid = roomGrid();
        const mgr = managerOver(grid);
        // 9044 = 9×1004 + 8：sum%numSpaces=8，每格以 8/9 概率 +1。
        grid.getCell(4, 4)!.volume = 9044;
        mgr.updateGases();
        const shares = new Set<number>();
        for (let x = 3; x <= 5; x++) {
            for (let y = 3; y <= 5; y++) shares.add(grid.getCell(x, y)!.volume);
        }
        // 消散不触发（不可见气）；份额集合必须同时含 1004 与 1005——
        // Math.floor 抹平实现给全 1004，Math.ceil 实现给全 1005。
        expect(shares.has(1004), '必须存在未进位的 1004（抹平成 ceil 的实现翻红）').toBe(true);
        expect(shares.has(1005), '必须存在随机进位的 1005（抹平成 floor 的实现翻红）').toBe(true);
        // 舍入守恒的是期望：单次总量 = 9×floor(9044/9) + 进位格数 ∈ [9036, 9045]。
        // 克隆体积的实现会 >9045，丢失体积（如 15% 钳制）会 <9036。
        expect(totalVolume(grid), '舍入总量必须落在 [9×floor, 9×floor+9] 带内')
            .toBeGreaterThanOrEqual(9036);
        expect(totalVolume(grid)).toBeLessThanOrEqual(9045);
    });
});

// ---------------------------------------------------------------------------
// 对抗⑥：消散用定值而非百分比档位（含 POISON≢CONFUSION 哨兵）
// ---------------------------------------------------------------------------
describe('G-1 对抗⑥：消散二档来自 tile 旗标（Time.c:1437-1444）', () => {
    function burnDown(type: GasType): number {
        const grid = roomGrid();
        const mgr = managerOver(grid);
        expect(mgr.addGas(4, 4, type, 2000)).toBe(true);
        for (let t = 0; t < 20; t++) {
            mgr.updateGases();
            mgr.updateGases(); // 生产节奏：每回合两轮
        }
        return totalVolume(grid);
    }
    it('同种子同场景：QUICK 档（CONFUSION 50%/轮）损耗必须严大于 SLOW 档（POISON 20%/轮）', () => {
        const poison = burnDown(GasType.POISON);
        const confusion = burnDown(GasType.CONFUSION);
        expect(confusion, 'QUICK 档损耗必须更多（定值消散实现两者相同，翻红）')
            .toBeLessThan(poison);
    });
    it('POISON ≢ CONFUSION 恒等式已在体积模型下破缺（F-0 §4.5 恒等式的退役哨兵）', () => {
        // 旧模型两者的气格曲线逐位相同；新模型消散档位不同——
        // 若有人把旗标抄错（POISON 抄 QUICK 或反之），上一条已红；
        // 这里再钉一层：20 回合后两者的存活体积不得相同。
        const poison = burnDown(GasType.POISON);
        const confusion = burnDown(GasType.CONFUSION);
        expect(poison).not.toBe(confusion);
    });
});

// ---------------------------------------------------------------------------
// 对抗⑦：混合判据写反 / 漏 3 体积压制
// ---------------------------------------------------------------------------
describe('G-1 对抗⑦：类型竞争与 3 体积压制（Time.c:1427-1431）', () => {
    it('邻域更大体积者换型占格：弱气格整体换成强气类型且体积压到 3', () => {
        const grid = roomGrid();
        const mgr = managerOver(grid);
        expect(mgr.addGas(4, 4, GasType.POISON, 5000)).toBe(true);   // 强气
        expect(mgr.addGas(4, 5, GasType.CONFUSION, 100)).toBe(true); // 弱气（正下方）
        mgr.updateGases();
        const weak = grid.getCell(4, 5)!;
        expect(weak.layers[L.GAS], '弱气格必须被邻域最大的强气换型（判据写反即翻红）')
            .toBe(C.POISON_GAS);
        expect(weak.volume, '换型前已有别的气：新体积必须压到 3（漏压制的实现 ≈566）')
            .toBeLessThanOrEqual(3);
        expect(weak.volume).toBeGreaterThan(0);
        const strong = grid.getCell(4, 4)!;
        expect(strong.layers[L.GAS], '强气格保持自身类型（邻域最大者是自己）').toBe(C.POISON_GAS);
    });
});

// ---------------------------------------------------------------------------
// 对抗⑧：火侧回归哨兵（任务书 §六.2 点名）
// ---------------------------------------------------------------------------
describe('G-1 对抗⑧：火侧曲线回归哨兵（本轮不许碰火）', () => {
    it('FIRE-NAT seed42 点火蔓延曲线逐位等于 F-2a §一 基线', () => {
        const game = createHeadlessGame(42);
        // 找一块玩家 8 格外的可燃草地（F-0 探针同款判定）。
        let spot: { x: number; y: number } | null = null;
        const px = game.player.loc.x, py = game.player.loc.y;
        const cands: { x: number; y: number }[] = [];
        for (let x = 0; x < game.grid.width; x++) {
            for (let y = 0; y < game.grid.height; y++) {
                const cell = game.grid.getCell(x, y)!;
                if (Math.max(Math.abs(x - px), Math.abs(y - py)) < 8) continue;
                if (cell.terrain === C.GRASS || cell.terrain === C.FOLIAGE) cands.push({ x, y });
            }
        }
        spot = cands[rng.randRange(0, cands.length - 1)] ?? null;
        expect(spot, 'F-0 基线的取景点必须仍存在').not.toBeNull();
        expect(spot!.x === 5 && spot!.y === 20, 'seed42 取景点应仍为 (5,20)（生成链未动）').toBe(true);
        game.environment.ignite(spot!.x, spot!.y);
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
        // 2026-09-16 F-2a 实跑基线（f_2a 报告 §一；本轮复跑逐位一致）。
        expect(series).toEqual([
            1, 1, 1, 2, 3, 5, 6, 6, 6, 6, 7, 6, 6, 7, 7, 7, 7, 7, 6, 6,
            6, 6, 6, 5, 6, 6, 5, 5, 5, 5, 5, 5, 5, 5, 5, 6, 6, 6, 5, 5,
        ]);
    });
});

// ---------------------------------------------------------------------------
// 对抗⑨：GAS 层写入与 gasGrid 镜像脱钩（只改一边）
// ---------------------------------------------------------------------------
describe('G-1 对抗⑨：层真相与 gasGrid 镜像同步（只改一边的实现在此翻红）', () => {
    it('addGas / updateGases / GAS 层 DF 特例后，镜像都必须与 layers[GAS]+volume 全场一致', () => {
        const grid = roomGrid();
        const mgr = managerOver(grid);

        // (a) addGas 写入后：真相与镜像同时可见（只写镜像的实现：truth 扫描红）。
        expect(mgr.addGas(4, 4, GasType.POISON, 1500)).toBe(true);
        expectMirrorMatchesTruth(grid, mgr);

        // (b) updateGases 演化后：镜像随真相重建（只在镜像上演化的旧架构：truth 恒 0，红）。
        mgr.updateGases();
        expectMirrorMatchesTruth(grid, mgr);
        expect(totalVolume(grid), '演化必须发生在真相上，不是只发生在镜像里').toBeGreaterThan(0);

        // (c) 外部直写 GAS 层的合法路径（spawnDungeonFeature 的 GAS 特例，
        //     CE Architect.c:3384-3386 volume 累加）→ syncGasMirror 对账。
        //     （合成 DF：DF_POISON_GAS_CLOUD 的 tile 登记仍为 null——24 条
        //     GAS 层 DF 的接线归 G-2，c_4b C1 同款合成手法。）
        const feat = {
            tile: C.POISON_GAS,
            layer: L.GAS,
            startProbability: 1000,
            probabilityDecrement: 0,
            flags: 0,
            propagationTerrain: C.NOTHING,
            subsequentDF: null,
            description: '',
            lightFlare: '',
            flashColor: '',
            effectRadius: 0,
        };
        const before = grid.getCell(3, 3)!.volume; // (a) 的毒气已摊到邻格
        const res = spawnDungeonFeature(grid, 3, 3, feat, false);
        expect(res.gasVolumeAdded).toBe(1000);
        expect(grid.getCell(3, 3)!.layers[L.GAS]).toBe(C.POISON_GAS);
        // CE 是 volume +=（累加）：DF 落在已有毒气的格上时体积相加。
        expect(grid.getCell(3, 3)!.volume).toBe(before + 1000);
        mgr.syncGasMirror();
        expectMirrorMatchesTruth(grid, mgr);
    });
});

// ---------------------------------------------------------------------------
// 对抗⑩（D2 留痕）：无层载体的气体类型被 addGas 拒绝
// ---------------------------------------------------------------------------
describe('G-1 对抗⑩：addGas 载体校验（P1-45 幽灵气的结构性防复发）', () => {
    it('CREEPING_DEATH / NONE / 非气体地形值一律拒绝写入并返回 false', () => {
        const grid = roomGrid();
        const mgr = managerOver(grid);
        expect(mgr.addGas(4, 4, GasType.CREEPING_DEATH, 100), 'D2：web 自创气体无 CE tile 载体，拒绝')
            .toBe(false);
        expect(mgr.addGas(4, 4, GasType.NONE, 100), 'NONE 不是气体').toBe(false);
        expect(mgr.addGas(4, 4, 1 as GasType, 100), '1 = GRANITE（旧档幽灵气 type=1 在此被挡）').toBe(false);
        expect(grid.getCell(4, 4)!.volume).toBe(0);
        expect(grid.getCell(4, 4)!.layers[L.GAS]).toBe(C.NOTHING);
        expectMirrorMatchesTruth(grid, mgr);
        // 载体集合自洽：枚举成员里只有三个气体地形 + NONE + CREEPING_DEATH 哨兵。
        expect(isGasTerrain(GasType.POISON)).toBe(true);
        expect(isGasTerrain(GasType.CONFUSION)).toBe(true);
        expect(isGasTerrain(GasType.STEAM)).toBe(true);
        expect(isGasTerrain(GasType.CREEPING_DEATH)).toBe(false);
        expect(GasType.CREEPING_DEATH, '哨兵值必须在 TerrainType 值域之外（当前最大 36）')
            .toBeGreaterThan(36);
    });
});

// ---------------------------------------------------------------------------
// 对抗⑪：chasm 逃逸（Time.c:1404-1406）
// ---------------------------------------------------------------------------
describe('G-1 对抗⑪：T_AUTO_DESCENT 格 numSpaces++（气体逃出层外）', () => {
    it('注在深渊格上的气：单轮总量必须减少（逃逸分支被删的实现总量不变，翻红）', () => {
        const grid = roomGrid();
        grid.setTerrain(4, 4, C.CHASM, '^', 0x888888);
        const mgr = managerOver(grid);
        expect(mgr.addGas(4, 4, GasType.POISON, 900)).toBe(true);
        mgr.updateGases();
        const total = totalVolume(grid);
        // numSpaces = 1+8+1 = 10：中心份额 900/10=90，9 个邻居合计 810，
        // 90 体积坠入深渊——守恒被 chasm 有意打破。
        expect(total, 'chasm 逃逸必须让总量减少（≈1/numSpaces）').toBeLessThan(900);
        expect(total).toBeGreaterThan(700);
    });
});

// ---------------------------------------------------------------------------
// 对抗⑫：被困气散逸（Time.c:1446-1474）
// ---------------------------------------------------------------------------
describe('G-1 对抗⑫：T_OBSTRUCTS_GAS 格里的气瞬时散给可存气邻居', () => {
    it('门格（挡气）上的体积单轮内清空并整除分给邻居（被困分支被删的实现翻红）', () => {
        const grid = roomGrid();
        grid.setTerrain(4, 4, C.DOOR, '+', 0x996633);
        expect((cellTerrainFlags(grid, 4, 4) & T_OBSTRUCTS_GAS) !== 0, 'web 的 DOOR 应带 T_OBSTRUCTS_GAS（CE Globals.c:328）').toBe(true);
        const mgr = managerOver(grid);
        expect(mgr.addGas(4, 4, GasType.POISON, 900)).toBe(true);
        mgr.updateGases();
        const door = grid.getCell(4, 4)!;
        expect(door.volume, '挡气格存不住气：自身清零').toBe(0);
        expect(door.layers[L.GAS]).toBe(C.NOTHING);
        // 900/8 = 112.5 → 每个可存气邻居 112，余数按 CE 语义舍弃。
        expect(grid.getCell(4, 3)!.volume, '上邻拿到整除份额').toBe(112);
        expect(grid.getCell(3, 4)!.volume, '左邻拿到整除份额').toBe(112);
    });
});

// ---------------------------------------------------------------------------
// 游戏级：存档往返与房间基线清气
// ---------------------------------------------------------------------------
describe('G-1 游戏级：存档往返 / 房间基线还原清气', () => {
    it('toSnapshot → loadSnapshot：GAS 层与体积逐格还原', () => {
        const game = createHeadlessGame(9);
        openRoom(game);
        game.environment.addGas(8, 7, GasType.POISON, 2000);
        game.environment.addGas(10, 7, GasType.CONFUSION, 700);
        const snap = game.toSnapshot();
        const reloaded = createHeadlessGame(1);
        expect(reloaded.loadSnapshot(snap)).toBe(true);
        for (const [x, y] of [[8, 7], [10, 7]] as const) {
            expect(reloaded.grid.getCell(x, y)!.layers[L.GAS])
                .toBe(game.grid.getCell(x, y)!.layers[L.GAS]);
            expect(reloaded.grid.getCell(x, y)!.volume)
                .toBe(game.grid.getCell(x, y)!.volume);
        }
        expect(reloaded.environment.hasVolumetricGas()).toBe(true);
    });

    it('clearGasAt（房间基线还原路径）清的是真相：重建镜像后气不复活', () => {
        const game = createHeadlessGame(9);
        openRoom(game);
        game.environment.addGas(8, 7, GasType.POISON, 2000);
        game.environment.clearGasAt(8, 7);
        expect(game.grid.getCell(8, 7)!.volume).toBe(0);
        expect(game.grid.getCell(8, 7)!.layers[L.GAS]).toBe(C.NOTHING);
        expectMirrorMatchesTruth(game.grid, game.environment);
        game.environment.updateGases();
        expectMirrorMatchesTruth(game.grid, game.environment);
    });
});
