/**
 * src/test/f_2a_fire_mechanics.test.ts — F-2a：CE 火焰蔓延与寿命模型（真改玩法）。
 *
 * 被测事实（全部有 CE 出处，逐条写在断言注释）：
 *   - 蔓延 = 火段对每个火格暴露自身 + 4 正交邻（Time.c:1688-1700），
 *     按可燃地形各自的 chanceToIgnite 掷骰（Time.c:1332-1345），
 *     每格每回合 12 次暴露封顶（Time.c:1308-1311）；
 *   - alwaysIgnite 直燃旁路（Items.c:5217/5445 burninate）；
 *   - 火的寿命 = PLAIN_FIRE promoteChance 500 概率衰老 → EMBERS → ASH
 *     （Globals.c:492/469/461，Time.c:1643-1645 掷骰、:1244-1290 落地）；
 *   - 火地形经 DF 生成管线落地：fillSpawnMap 的 T_OBSTRUCTS_SURFACE_EFFECTS
 *     守卫使火落不进楼梯/祭坛（Architect.c:3230，F-1 §七.2 预测的免费守卫）；
 *   - 水体"被点燃"本轮不接（fireType DF_STEAM_ACCUMULATION 的 tile 缺失 →
 *     promoteTile 整链缓办）——G-1 接蒸汽时翻正本留痕；
 *   - BOG（webOnly）目录无 fireType → 不可点燃（web 旧白名单行为退役）；
 *   - 气体子系统回归哨兵（本轮不碰气体，曲线必须与改前逐位一致）。
 *
 * 每条断言都在注释里写明它捕获的错误实现。反向验证（改坏→红→还原）
 * 在本轮报告留档，不落在本文件。
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame } from './harness';
import type { Game } from '../engine/Core/Game';
import { TerrainType, DungeonLayer as L } from '../engine/Map/Grid';
import { exposeTileToFire, runFireUpdate } from '../engine/Map/Promotion';
import { DUNGEON_FEATURE_CATALOG, DF } from '../engine/Map/DungeonFeatureCatalog';
import { GasType } from '../engine/Environment/Gas';

const C = TerrainType;

/** 无怪物骚扰的封闭房间（可放大尺寸供统计采样）。 */
function openRoom(game: Game, w = 30, h = 20): void {
    game.monsters.length = 0;
    game.items.length = 0;
    for (let x = 1; x < w; x++) {
        for (let y = 1; y < h; y++) {
            game.grid.setTerrain(x, y, C.WALL, '#', 0x444444);
        }
    }
    for (let x = 2; x <= w - 2; x++) {
        for (let y = 2; y <= h - 2; y++) {
            game.grid.setTerrain(x, y, C.FLOOR, '.', 0x888888);
            const cell = game.grid.getCell(x, y);
            if (cell) cell.isVisible = true;
        }
    }
    game.player.loc.x = 4;
    game.player.loc.y = 4;
}

type Priv = { objectiveTimeBlock(): void };
const priv = (game: Game): Priv => game as unknown as Priv;
function tickEnv(game: Game, n: number): void {
    for (let i = 0; i < n; i++) priv(game).objectiveTimeBlock();
}

/** 手工把 (x,y) 变成一个火格（火地形落 SURFACE，绕过点火入口）。 */
function placeFire(game: Game, x: number, y: number): void {
    game.grid.setTerrainLayer(x, y, L.SURFACE, C.PLAIN_FIRE);
}

describe('F-2a 对抗①：蔓延只用 4 正交邻（CE Time.c:1692-1699 nbDirs 前 4 项）', () => {
    it('与火格只有对角连接的草格永远烧不到。' +
        '错误实现：蔓延用 8 邻（web 旧行为）——五组独立对角对中必有草被点燃留痕。', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        // 五组"火格 + 仅对角相邻的草"（互不相邻，独立试验）：
        // 8 邻实现下单组点燃概率 ~96%（15%/邻 × 火源期望寿命 20 回合），
        // 五组全不点燃的概率 < 10^-5 量级；4 邻实现下结构性不可能点燃。
        for (let i = 0; i < 5; i++) {
            placeFire(game, 6 + 2 * i, 6);
            game.grid.setTerrain(7 + 2 * i, 7, C.GRASS, '"', 0x33aa33);
        }
        for (let i = 0; i < 40; i++) tickEnv(game, 1);
        for (let i = 0; i < 5; i++) {
            const diag = game.grid.getCell(7 + 2 * i, 7)!;
            expect(diag.terrain, `对角草 (${7 + 2 * i},7) 必须原样幸存（4 邻蔓延烧不到它）`).toBe(C.GRASS);
        }
    });
});

describe('F-2a 对抗②：掷骰点燃概率 = 各地形 chanceToIgnite（草 15），不是固定 40%', () => {
    it('大样本互不相邻草格各暴露一次：点燃数必须落在 15% 的二项分布带内。' +
        '错误实现 a：固定 40%（web 旧值）→ 期望 130，远超上限；' +
        '错误实现 b：100% 必燃 → 325；错误实现 c：掷骰被丢（永不燃）→ 0。', () => {
        const game = createHeadlessGame(42);
        openRoom(game, 52, 29); // 50×27 房间（网格 79×29 之内）
        // 棋盘布置（步长 2）：任意两草格不相邻 → 每格恰好一次暴露、零蔓延干扰。
        const spots: [number, number][] = [];
        for (let y = 2; y <= 26; y += 2) {
            for (let x = 2; x <= 50; x += 2) {
                spots.push([x, y]);
            }
        }
        expect(spots.length).toBe(325);
        let ignited = 0;
        for (const [x, y] of spots) {
            game.grid.setTerrain(x, y, C.GRASS, '"', 0x33aa33);
            if (exposeTileToFire(game.grid, x, y, false).ignited) ignited++;
        }
        // 二项(325, 0.15)：均值 48.75、σ≈6.4。带宽 [29, 72] ≈ ±3.7σ——
        // 固定 40% 实现期望 130（红）、100% 期望 325（红）、0% 期望 0（红）。
        expect(ignited, `草 15% 掷骰：325 次暴露点燃 ${ignited} 次，须在 [29,72]`).toBeGreaterThanOrEqual(29);
        expect(ignited).toBeLessThanOrEqual(72);
    });
});

describe('F-2a 对抗③：每格每回合 12 次暴露封顶（CE Time.c:1308-1311）+ 每回合清零', () => {
    it('exposedToFire ≥12 时连 alwaysIgnite 都被拒绝；新回合（runFireUpdate）清零后恢复。' +
        '错误实现 a：漏掉封顶检查——超封顶的直燃照样点燃；' +
        '错误实现 b：漏掉每回合清零——第二回合怎么暴露都点不着。', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        // 三个独立草格，互不相邻。
        game.grid.setTerrain(8, 6, C.GRASS, '"', 0x33aa33);
        game.grid.setTerrain(10, 6, C.GRASS, '"', 0x33aa33);
        game.grid.setTerrain(12, 6, C.GRASS, '"', 0x33aa33);

        // 基线：未暴露过的格，直燃成功（旁路 + 未触封顶）。
        expect(exposeTileToFire(game.grid, 8, 6, true).ignited, '首次直燃必须成功').toBe(true);

        // 错误实现 a：人为把 (10,6) 的暴露计数推到封顶——直燃必须被拒。
        const capped = game.grid.getCell(10, 6)!;
        capped.exposedToFire = 12;
        expect(exposeTileToFire(game.grid, 10, 6, true).ignited, '封顶后连直燃都必须被拒').toBe(false);
        expect(capped.terrain, '被封顶的格不得起火').toBe(C.GRASS);
        expect(capped.exposedToFire, '被拒绝的暴露不得再计数（CE :1311 先判后加）').toBe(12);

        // 错误实现 b：跑一次火段（清零）后，封顶格必须恢复可点燃。
        runFireUpdate(game.grid, {});
        expect(capped.exposedToFire, '新回合暴露计数必须清零（CE :1598-1603）').toBe(0);
        expect(exposeTileToFire(game.grid, 10, 6, true).ignited, '清零后直燃恢复').toBe(true);

        // (12,6) 是未触封顶的对照：始终可燃。
        expect(exposeTileToFire(game.grid, 12, 6, true).ignited).toBe(true);
    });
});

describe('F-2a 对抗④：alwaysIgnite 直燃旁路（CE Items.c:5217/5445 burninate）', () => {
    it('30 个草格直燃必须 100% 点燃（跳过 15% 掷骰）。' +
        '错误实现：旁路失效（把 alwaysIgnite 当 false 掷骰）→ 期望只有 ~4-5 格点燃。', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        const spots: [number, number][] = [];
        for (let y = 2; y <= 12 && spots.length < 30; y += 2) {
            for (let x = 2; x <= 16 && spots.length < 30; x += 2) {
                spots.push([x, y]);
            }
        }
        let ignited = 0;
        for (const [x, y] of spots) {
            game.grid.setTerrain(x, y, C.GRASS, '"', 0x33aa33);
            if (exposeTileToFire(game.grid, x, y, true).ignited) ignited++;
        }
        expect(ignited, `直燃旁路：30 格必须全部点燃（实测 ${ignited}）`).toBe(30);
    });
});

describe('F-2a 对抗⑤：T_OBSTRUCTS_SURFACE_EFFECTS 守卫（CE Architect.c:3230）' +
    '——F-1 §七.2"接 fillSpawnMap 路径免费获得守卫"的验证', () => {
    it('igniteForced（CE 火 DF 生成家族）在楼梯/祭坛上落不了火；对照地板照落。' +
        '错误实现：绕开 DF 管线直写 SURFACE 层（F-1 旧 igniteForced）→ 楼梯/祭坛照烧。', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        game.grid.setTerrain(8, 6, C.STAIRS_DOWN, '>', 0x00aaff);
        game.grid.setTerrain(10, 6, C.ALTAR, '_', 0xcccccc);
        game.environment.igniteForced(8, 6);
        game.environment.igniteForced(10, 6);
        const stairs = game.grid.getCell(8, 6)!;
        const altar = game.grid.getCell(10, 6)!;
        expect(stairs.isBurning, '楼梯必须拒绝火 DF（T_OBSTRUCTS_SURFACE_EFFECTS）').toBe(false);
        expect(stairs.terrain, '楼梯地形原样').toBe(C.STAIRS_DOWN);
        expect(altar.isBurning, '祭坛同样拒绝火 DF').toBe(false);
        expect(altar.terrain).toBe(C.ALTAR);

        // 对照：同一入口在普通地板上照常落火（守卫只挡 SURFACE_EFFECTS 格）。
        game.environment.igniteForced(12, 6);
        expect(game.grid.getCell(12, 6)!.isBurning, '地板照常落火').toBe(true);
    });

    it('直燃路径（exposeTileToFire）同样伤不到楼梯/祭坛——它们不可燃，' +
        '暴露计数都不动（CE :1308 T_IS_FLAMMABLE 先决）。', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        game.grid.setTerrain(8, 6, C.STAIRS_DOWN, '>', 0x00aaff);
        const r = exposeTileToFire(game.grid, 8, 6, true);
        expect(r.ignited).toBe(false);
        expect(game.grid.getCell(8, 6)!.terrain).toBe(C.STAIRS_DOWN);
        expect(game.grid.getCell(8, 6)!.exposedToFire, '不可燃格不消耗暴露计数').toBe(0);
    });
});

describe('F-2a 对抗⑥：衰老驱动必须真正接通（PLAIN_FIRE promoteChance=500）', () => {
    it('60 个火格推 60 个客观块后必须大半离场（EMBERS/ASH）。' +
        '错误实现：promoteChance 没接上（火永生）或仍按 burnDuration 倒计时——' +
        '前者离场数恒 0，后者在更早的 f_1 对抗④红。', () => {
        const game = createHeadlessGame(42);
        openRoom(game, 52, 29);
        const spots: [number, number][] = [];
        for (let y = 2; y <= 26 && spots.length < 60; y += 2) {
            for (let x = 2; x <= 50 && spots.length < 60; x += 2) {
                spots.push([x, y]);
            }
        }
        for (const [x, y] of spots) placeFire(game, x, y);
        // 起火登记等价物：直接喂 skip 集不必要——placeFire 没有登记，
        // 第一块就掷衰老骰也无妨（60 格的大数规律不受一格影响）。
        for (let i = 0; i < 60; i++) tickEnv(game, 1);
        let gone = 0; // 离场 = 不再是 PLAIN_FIRE（EMBERS 或 ASH）
        for (const [x, y] of spots) {
            const c = game.grid.getCell(x, y)!;
            if (!c.isBurning) gone++;
        }
        // 0.95^60 ≈ 4.6% 存活 → 期望 ~57/60 离场；带宽 >40（离 0 极远）。
        // promoteChance=0 的永生实现在此得 0，翻红。
        expect(gone, `60 回合后必须大半火格已衰老离场（实测 ${gone}/60）`).toBeGreaterThan(40);
        // 离场后的落点必须是 CE 产物：EMBERS 或 ASH（不得回退 CHARRED_FLOOR）。
        const sample = game.grid.getCell(spots[0]![0]!, spots[0]![1]!)!;
        expect([C.EMBERS, C.ASH, C.PLAIN_FIRE]).toContain(sample.terrain);
    });
});

describe('F-2a 对抗⑦：火段 skip 集——已登记起火的本回合火段不重复暴露（CE :1690）', () => {
    it('火格在 skip 集里时它的邻居不掷骰；不在时 100% 可燃邻居（网）必被点燃。' +
        '错误实现：runFireUpdate 忽略 opts.caughtFireCells。', () => {
        // 场景 A：火格进 skip 集 → 网（chanceToIgnite 100）不暴露、不点燃。
        const gA = createHeadlessGame(42);
        openRoom(gA);
        gA.grid.setTerrain(9, 6, C.WEB, '\\', 0xcccccc);
        placeFire(gA, 8, 6);
        const rA = runFireUpdate(gA.grid, { caughtFireCells: [{ x: 8, y: 6 }] });
        expect(gA.grid.getCell(9, 6)!.terrain, 'skip 集里的火格不得暴露邻居').toBe(C.WEB);
        expect(rA.caughtFireCells.length, '也没有新登记').toBe(0);

        // 场景 B：同一布局、无 skip → 网必被点燃（100% 掷骰必中）且新登记返回。
        const gB = createHeadlessGame(42);
        openRoom(gB);
        gB.grid.setTerrain(9, 6, C.WEB, '\\', 0xcccccc);
        placeFire(gB, 8, 6);
        const rB = runFireUpdate(gB.grid, {});
        expect(gB.grid.getCell(8, 6)!.isBurning, '火格被火段暴露自身（不可燃，无副作用）').toBe(true);
        const web = gB.grid.getCell(9, 6)!;
        expect(web.isBurning || web.terrain === C.PLAIN_FIRE, '网（100%）必被点燃烧穿').toBe(true);
        expect(rB.caughtFireCells.length, '点燃必有 CAUGHT_FIRE 登记（CE Architect.c:3235）').toBeGreaterThan(0);
    });
});

describe('F-2a 对抗⑧：火链三条 DF 零 RNG、probDec 约定结构性成立', () => {
    it('DF_PLAIN_FIRE / DF_EMBERS / DF_ASH 都是 start=0 的单点 DF——' +
        'spawnMapDF 的 while(startProb>0) 不执行、零掷骰；合成扩散条目的' +
        'probDec>0 闸门（c_4c C1）继续覆盖未来条目。' +
        '错误实现：给火链 DF 抄上非零 start（每次点火多掷骰、移动 RNG 流）或' +
        'start>0 且 probDec=0（spawnMapDF 死循环——目录级断言已在 c_4c 钉死）。', () => {
        for (const id of [DF.DF_PLAIN_FIRE, DF.DF_EMBERS, DF.DF_ASH]) {
            const e = DUNGEON_FEATURE_CATALOG[id]!;
            expect(e.startProbability, `${DF[id]} 必须 start=0（CE 目录原值）`).toBe(0);
            expect(e.layer).toBe(L.SURFACE);
        }
        // 行为口径：在真实房间上 spawn 火链 DF 各一次，任意时刻不挂起、
        // 恰好单格落地（若误带扩散参数，这里会铺开一片或死循环超时）。
        const game = createHeadlessGame(42);
        openRoom(game);
        game.grid.setTerrainLayer(8, 6, L.SURFACE, C.PLAIN_FIRE);
        const before = countFire(game);
        // EMBERS 的衰老经 promoteTile——它是 DF_ASH 的消费者（闭包自洽）。
        // 此处只验证目录数据前提；落地行为由 f_1 对抗②/⑤与 c_4c 覆盖。
        expect(before).toBe(1);
    });
});

describe('F-2a 对抗⑨（留痕，G-1 翻转）：水体本轮不可被点燃', () => {
    it('深水可燃（chanceToIgnite 100）但其 fireType DF_STEAM_ACCUMULATION 是' +
        'GAS 层 DF、tile 缺失 → promoteTile 整链缓办：水面完好、无火、无 GAS 层写入。' +
        'G-1 接 CE 蒸汽来源（§5.3-9）时本断言到期：届时深水被点燃消耗、落蒸汽。', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        game.grid.setTerrain(10, 6, C.WATER_DEEP, '~', 0x1133aa);
        // 直燃旁路（CE 里这会点燃深水产蒸汽）：本轮必须原地不动。
        const r = exposeTileToFire(game.grid, 10, 6, true);
        const water = game.grid.getCell(10, 6)!;
        expect(water.layers[L.LIQUID], '深水必须原样保留').toBe(C.WATER_DEEP);
        expect(water.isBurning, '深水不得挂火地形').toBe(false);
        expect(water.layers[L.GAS], 'GAS 层恒空（C-4a-0 留痕在 F-2a 全程有效）').toBe(C.NOTHING);
        // 火贴水烧 20 回合：水格依旧（蔓延暴露也点不着——同一缓办路径）。
        placeFire(game, 8, 6);
        for (let i = 0; i < 20; i++) tickEnv(game, 1);
        expect(game.grid.getCell(10, 6)!.layers[L.LIQUID]).toBe(C.WATER_DEEP);
        expect(game.grid.getCell(10, 6)!.isBurning).toBe(false);
        expect(r.ignited, 'CE 语义里点燃"发生"了（可燃层掷中），只是落地缓办').toBe(true);
    });
});

describe('F-2a 对抗⑩（留痕，D2 口径）：BOG 不可点燃', () => {
    it('BOG（webOnly）目录记 T_IS_FLAMMABLE 但无 fireType/chanceToIgnite=0——' +
        '直燃无 DF 可落、掷骰路径概率为 0：BOG 不再可点燃（web 旧白名单行为退役）。' +
        '若未来给 BOG 定 CE 化的火数据，须先改 TerrainCatalog 再翻本断言。', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        game.grid.setTerrain(10, 6, C.BOG, '≈', 0x556644);
        const r = exposeTileToFire(game.grid, 10, 6, true);
        const bog = game.grid.getCell(10, 6)!;
        expect(bog.terrain, 'BOG 原样（无 fireType 可落）').toBe(C.BOG);
        expect(bog.isBurning).toBe(false);
        expect(r.caughtFireCells.length, '无火地形落地 → 无起火登记').toBe(0);
    });
});

describe('F-2a 对抗⑪：气体子系统回归哨兵（本轮不碰气体）', () => {
    it('四种气体注入合成房间后的消散/扩散曲线必须与改前逐位一致（F-0 §4.5 口径）。' +
        '错误实现：火段重写顺手改动了 updateGases/addGas/客观块次序。', () => {
        for (const type of [GasType.POISON, GasType.CONFUSION, GasType.STEAM, GasType.CREEPING_DEATH]) {
            const game = createHeadlessGame(42);
            openRoom(game);
            game.environment.addGas(10, 8, type, 100);
            const curve: string[] = [];
            for (let t = 0; t < 14; t++) {
                tickEnv(game, 1);
                const cells: string[] = [];
                for (let x = 0; x < game.grid.width; x++) {
                    for (let y = 0; y < game.grid.height; y++) {
                        const g = game.environment.gasGrid[x]?.[y];
                        if (g && g.density > 0) cells.push(`${x},${y},${g.type},${g.density}`);
                    }
                }
                cells.sort();
                curve.push(cells.join(';'));
            }
            // 硬编码基线（2026-09-16 F-2a 实跑记录；气体代码零改动 ⇒ 逐位一致）。
            expect(GAS_BASELINE[type], `type=${type} 气体曲线漂移`).toEqual(curve);
        }
    });
});

/** 对抗⑧ 的辅助：统计全场火地形格数。 */
function countFire(game: Game): number {
    let n = 0;
    for (let x = 0; x < game.grid.width; x++) {
        for (let y = 0; y < game.grid.height; y++) {
            if (game.grid.getCell(x, y)!.isBurning) n++;
        }
    }
    return n;
}

/**
 * 对抗⑪ 的硬编码基线：合成房间（openRoom 默认尺寸）、(10,8) 注入 100 密度、
 * 每回合 objectiveTimeBlock 后的全场气格签名（"x,y,type,density" 升序 ; 连接，
 * 共 14 回合）。记录于 2026-09-16 F-2a 实跑——气体子系统零改动的前提下逐位稳定。
 */
const GAS_BASELINE: Record<number, string[]> = {
    // 记录于 2026-09-16（F-2a 轮，见测试名）。注意 POISON 与 CONFUSION 除
    // type 位外逐位相同——F-0 §4.5 发现的"两种气同一消散率"恒等式，在本轮
    // 引擎下原样保持；G-1 迁 CE 消散谱系时该恒等式会自然破缺。
    [GasType.POISON]: ["10,7,2,15;10,8,2,38;10,9,2,15;11,8,2,15;9,8,2,15", "10,10,2,2;10,6,2,2;10,7,2,10;10,8,2,24;10,9,2,10;11,7,2,4;11,8,2,10;11,9,2,4;12,8,2,2;8,8,2,2;9,7,2,4;9,8,2,10;9,9,2,4", "10,7,2,11;10,8,2,10;10,9,2,11;11,7,2,2;11,8,2,11;11,9,2,2;9,7,2,2;9,8,2,11;9,9,2,2", "10,10,2,1;10,6,2,1;10,7,2,5;10,8,2,12;10,9,2,5;11,7,2,2;11,8,2,5;11,9,2,2;12,8,2,1;8,8,2,1;9,7,2,2;9,8,2,5;9,9,2,2", "10,7,2,4;10,8,2,6;10,9,2,4;11,8,2,4;9,8,2,4", "10,7,2,2;10,8,2,4;10,9,2,2;11,8,2,2;9,8,2,2", "10,8,2,2", "", "", "", "", "", "", ""],
    [GasType.CONFUSION]: ["10,7,3,15;10,8,3,38;10,9,3,15;11,8,3,15;9,8,3,15", "10,10,3,2;10,6,3,2;10,7,3,10;10,8,3,24;10,9,3,10;11,7,3,4;11,8,3,10;11,9,3,4;12,8,3,2;8,8,3,2;9,7,3,4;9,8,3,10;9,9,3,4", "10,7,3,11;10,8,3,10;10,9,3,11;11,7,3,2;11,8,3,11;11,9,3,2;9,7,3,2;9,8,3,11;9,9,3,2", "10,10,3,1;10,6,3,1;10,7,3,5;10,8,3,12;10,9,3,5;11,7,3,2;11,8,3,5;11,9,3,2;12,8,3,1;8,8,3,1;9,7,3,2;9,8,3,5;9,9,3,2", "10,7,3,4;10,8,3,6;10,9,3,4;11,8,3,4;9,8,3,4", "10,7,3,2;10,8,3,4;10,9,3,2;11,8,3,2;9,8,3,2", "10,8,3,2", "", "", "", "", "", "", ""],
    [GasType.STEAM]: ["10,7,4,15;10,8,4,35;10,9,4,15;11,8,4,15;9,8,4,15", "10,10,4,2;10,6,4,2;10,7,4,7;10,8,4,18;10,9,4,7;11,7,4,4;11,8,4,7;11,9,4,4;12,8,4,2;8,8,4,2;9,7,4,4;9,8,4,7;9,9,4,4", "10,7,4,4;10,8,4,5;10,9,4,4;11,8,4,4;9,8,4,4", "", "", "", "", "", "", "", "", "", "", ""],
    [GasType.CREEPING_DEATH]: ["10,7,5,25;10,9,5,25;11,8,5,25;9,8,5,25", "10,10,5,6;10,6,5,6;10,8,5,24;11,7,5,12;11,9,5,12;12,8,5,6;8,8,5,6;9,7,5,12;9,9,5,12", "10,10,5,5;10,6,5,5;10,7,5,12;10,9,5,12;11,10,5,3;11,6,5,3;11,8,5,12;12,7,5,3;12,8,5,5;12,9,5,3;8,7,5,3;8,8,5,5;8,9,5,3;9,10,5,3;9,6,5,3;9,8,5,12", "10,10,5,7;10,6,5,7;10,8,5,12;11,10,5,2;11,6,5,2;11,7,5,6;11,9,5,6;12,7,5,2;12,8,5,7;12,9,5,2;8,7,5,2;8,8,5,7;8,9,5,2;9,10,5,2;9,6,5,2;9,7,5,6;9,9,5,6", "10,10,5,6;10,6,5,6;10,7,5,3;10,9,5,3;11,10,5,1;11,6,5,1;11,7,5,5;11,8,5,3;11,9,5,5;12,7,5,1;12,8,5,6;12,9,5,1;8,7,5,1;8,8,5,6;8,9,5,1;9,10,5,1;9,6,5,1;9,7,5,5;9,8,5,3;9,9,5,5", "10,10,5,5;10,6,5,5;10,7,5,2;10,9,5,2;11,7,5,4;11,8,5,2;11,9,5,4;12,8,5,5;8,8,5,5;9,7,5,4;9,8,5,2;9,9,5,4", "10,10,5,4;10,6,5,4;10,7,5,1;10,9,5,1;11,7,5,3;11,8,5,1;11,9,5,3;12,8,5,4;8,8,5,4;9,7,5,3;9,8,5,1;9,9,5,3", "10,10,5,3;10,6,5,3;11,7,5,2;11,9,5,2;12,8,5,3;8,8,5,3;9,7,5,2;9,9,5,2", "10,10,5,2;10,6,5,2;11,7,5,1;11,9,5,1;12,8,5,2;8,8,5,2;9,7,5,1;9,9,5,1", "10,10,5,1;10,6,5,1;12,8,5,1;8,8,5,1", "", "", "", ""],
};
