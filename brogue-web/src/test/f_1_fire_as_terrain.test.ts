/**
 * src/test/f_1_fire_as_terrain.test.ts — F-1：火焰迁成地形。
 *
 * ★ F-2a 已反转本文件的红线断言（反转范本：B-1/P1-29 式"断言新事实 +
 *   保留越界守卫"，非删除）。逐条翻转记录：
 *   - 对抗②/②b/④：burnDuration 倒计时模型（草 4-7 / 门 2-4 / 显式时长）
 *     随 F-2a 概率衰老退役 → 改为断言"火经晋升驱动衰老、寿命远长于 7 回合"；
 *   - 对抗⑤："EMBERS === undefined / 烧尽 = CHARRED_FLOOR（红线）"反转 →
 *     CE 产物链 EMBERS → ASH 成为本轮断言（CHARRED_FLOOR 不再由火烧尽生产）；
 *   - 对抗①门半边："门盖住火"的活体场景消失（门被火烧穿成 EMBERS，
 *     CE Globals.c:328 fireType=DF_EMBERS）→ 改经 igniteForced（火 DF 落门上，
 *     门 prio 8 仍盖住火 10）钉 drawPriority 双向；
 *   - 对抗③后半：燃烧的深水不再"时长 1 → 两回合后原样熄灭"（火寿命改为
 *     概率衰老）→ 熄灭改为手动摘火层（测试口径），守卫语义不变。
 *   继续锁定的 F-1 事实：isBurning ≡ 跨层有火地形（F-2a 起为派生 getter）、
 *   A 类读者经 isBurning 看见火、持久化往返、旧存档迁移。
 *   （"GAS 层恒空"留痕已由 G-1 反转：气体迁入 GAS 层；火侧不写 GAS 层的
 *   守卫半边保留在对抗⑦。）
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame } from './harness';
import { GasType } from '../engine/Environment/Gas';
import type { Game } from '../engine/Core/Game';
import type { GameSnapshot } from '../engine/Core/Game';
import { TerrainType, DungeonLayer, DRAW_PRIORITY, TERRAIN_HOME_LAYER } from '../engine/Map/Grid';
import { blocksPathing } from '../engine/Map/LoopMap';
import { isFireTerrain, blocksPassability } from '../engine/Map/TerrainCatalog';
import { promoteTile } from '../engine/Map/Promotion';
import { DF } from '../engine/Map/DungeonFeatureCatalog';

const C = TerrainType;
const L = DungeonLayer;

/** 无怪物骚扰的封闭房间（同 p1_24 的 clearToOpenRoom 形态）。 */
function openRoom(game: Game): void {
    game.monsters.length = 0;
    game.items.length = 0;
    for (let x = 1; x < 30; x++) {
        for (let y = 1; y < 20; y++) {
            game.grid.setTerrain(x, y, C.WALL, '#', 0x444444);
        }
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

type Priv = { objectiveTimeBlock(): void; canMoveTo(x: number, y: number): boolean; entryQualifiesForPlacement(x: number, y: number): boolean };
const priv = (game: Game): Priv => game as unknown as Priv;

/** 推 n 次客观块（每次 = 一回合的环境推进，无玩家动作噪声）。 */
function tickEnv(game: Game, n: number): void {
    for (let i = 0; i < n; i++) priv(game).objectiveTimeBlock();
}

const hasFire = (game: Game, x: number, y: number): boolean => {
    const cell = game.grid.getCell(x, y)!;
    return cell.layers.some((t) => isFireTerrain(t));
};
const fireLayer = (game: Game, x: number, y: number): number => {
    const cell = game.grid.getCell(x, y)!;
    for (let l = 0; l < L.COUNT; l++) if (isFireTerrain(cell.layers[l]!)) return l;
    return -1;
};

describe('F-1 对抗①（F-2a 翻正门半边）：drawPriority 双向——火压住草（10<60）', () => {
    it('燃烧草格的有效地形 = PLAIN_FIRE（CE：可燃物被火消耗，同层替换）；' +
        '火 DF 落在门上时有效地形仍是门（prio 8 < 10）。' +
        '错误实现 a：prio 抄成 >60 → 草压住火，第一对断言红；' +
        '错误实现 b：prio 抄成 <8 → 火压住门，第二对断言红。', () => {
        expect(DRAW_PRIORITY[C.PLAIN_FIRE]).toBe(10); // CE Globals.c:492
        expect(TERRAIN_HOME_LAYER[C.PLAIN_FIRE]).toBe(L.SURFACE); // CE DF 目录 Globals.c:740

        // 草地：直燃后有效地形必须是火。
        const g1 = createHeadlessGame(42);
        openRoom(g1);
        g1.grid.setTerrain(8, 6, C.GRASS, '"', 0x33aa33);
        g1.environment.ignite(8, 6);
        const grass = g1.grid.getCell(8, 6)!;
        expect(grass.isBurning).toBe(true);
        expect(grass.terrain, '火必须压住草（drawPriority 10 < 60）').toBe(C.PLAIN_FIRE);

        // 门：F-1 时代"ignite 门"会让门继续盖住火；F-2a 起 CE 语义生效——
        // 门可燃（chanceToIgnite 50），直燃 = 烧穿：门被消耗（DUNGEON→FLOOR）、
        // 落 EMBERS（CE fireType=DF_EMBERS）。drawPriority 双向改由
        // igniteForced（火 DF 落门上、门不被消耗）钉死。
        const g2 = createHeadlessGame(42);
        openRoom(g2);
        g2.grid.setTerrain(8, 6, C.DOOR, '+', 0xaa8844);
        g2.environment.igniteForced(8, 6);
        const door = g2.grid.getCell(8, 6)!;
        expect(door.isBurning).toBe(true);
        expect(door.terrain, '门必须盖住火（drawPriority 8 < 10，CE 口径）').toBe(C.DOOR);
        expect(fireLayer(g2, 8, 6), '火在 SURFACE 层（门在 DUNGEON 层，共存）').toBe(L.SURFACE);

        // CE Globals.c:328：门的 fireType=DF_EMBERS——直燃烧穿门：
        // DUNGEON 层回 FLOOR、SURFACE 层落 EMBERS（可通行、不挡视线）。
        const g3 = createHeadlessGame(42);
        openRoom(g3);
        g3.grid.setTerrain(8, 6, C.DOOR, '+', 0xaa8844);
        g3.environment.ignite(8, 6);
        const burned = g3.grid.getCell(8, 6)!;
        expect(burned.isBurning, '余烬不是火（CE EMBERS 零旗标）').toBe(false);
        expect(burned.layers[L.DUNGEON], '门被烧穿：DUNGEON 层回 FLOOR').toBe(C.FLOOR);
        expect(burned.layers[L.SURFACE], '烧穿处落余烬（DF_EMBERS）').toBe(C.EMBERS);
    });
});

describe('F-1 对抗②（F-2a 翻转寿命模型）：isBurning ≡ 跨层有火地形（派生）', () => {
    it('点燃后 isBurning === 有火地形；经晋升驱动衰老成 EMBERS 后镜像同步消失。' +
        '错误实现：火地形与 isBurning 出现两个事实来源（脱钩/幽灵火）。', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        game.grid.setTerrain(8, 6, C.GRASS, '"', 0x33aa33);
        const cell = game.grid.getCell(8, 6)!;

        game.environment.ignite(8, 6);
        expect(cell.isBurning).toBe(true);
        expect(hasFire(game, 8, 6), '点燃必须落火地形').toBe(true);
        expect(cell.terrain).toBe(C.PLAIN_FIRE);

        // 衰老：PLAIN_FIRE promoteChance=500（CE Globals.c:492）——用晋升驱动
        // 的单位入口 promoteTile（useFireDF=false → promoteType DF_EMBERS），
        // 与 runPromotionUpdate 每回合掷骰落地是同一条代码路径。
        const r = promoteTile(game.grid, 8, 6, L.SURFACE, false);
        expect(r.df, 'PLAIN_FIRE 衰老目标必须是 DF_EMBERS').toBe(DF.DF_EMBERS);
        expect(r.mutated, '衰老必须真实落地').toBe(true);
        const embers = game.grid.getCell(8, 6)!;
        expect(embers.isBurning, '余烬不是火：isBurning 镜像同步归 false').toBe(false);
        expect(hasFire(game, 8, 6), '不得残留火地形（幽灵火）').toBe(false);
        expect(embers.layers[L.SURFACE], '衰老落点 = EMBERS（CE Globals.c:469）').toBe(C.EMBERS);
    });

    it('igniteForced 在非可燃地形（地板）上：火 DF 照落、烧的是火地形本身，' +
        '衰老后落 EMBERS/ASH（CE：火 DF 铺在任何地表上，石地板不参与燃烧）。' +
        '错误实现：地板火"原样熄灭不留痕"（F-1 行为）——F-2a 产物是 CE 的。', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        game.environment.igniteForced(8, 6);
        const cell = game.grid.getCell(8, 6)!;
        expect(cell.isBurning).toBe(true);
        expect(hasFire(game, 8, 6)).toBe(true);
        expect(cell.terrain, '有效地形=火（地板在 DUNGEON 95，被火 10 盖住）').toBe(C.PLAIN_FIRE);
        expect(cell.layers[L.DUNGEON], '火不消耗地板（CE：地板不可燃，层不动）').toBe(C.FLOOR);

        // 衰老两步（同上，走 promoteTile 单位入口）：PLAIN_FIRE → EMBERS → ASH。
        promoteTile(game.grid, 8, 6, L.SURFACE, false);
        expect(game.grid.getCell(8, 6)!.layers[L.SURFACE], '第一步落 EMBERS').toBe(C.EMBERS);
        promoteTile(game.grid, 8, 6, L.SURFACE, false);
        expect(game.grid.getCell(8, 6)!.layers[L.SURFACE], '第二步落 ASH（CE Globals.c:461）').toBe(C.ASH);
        expect(game.grid.getCell(8, 6)!.isBurning).toBe(false);
    });

    it('蔓延出的火同样是"火地形"（CE：可燃物被消耗）。' +
        '错误实现：只在 ignite 入口落火地形、火段蔓延路径绕过。', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        // 5×3 草块：单列草带的波前会被几何衰老停在半途（15%/邻/回合 × 5%/回合
        // 衰老下，孤波前烧尽是 CE 忠实行为）——3 行宽的波前给远端列多路暴露。
        for (let x = 6; x <= 10; x++) {
            for (let y = 5; y <= 7; y++) {
                game.grid.setTerrain(x, y, C.GRASS, '"', 0x33aa33);
            }
        }
        game.environment.ignite(6, 6);
        let spreadSeen = false;
        for (let i = 0; i < 40 && !spreadSeen; i++) {
            tickEnv(game, 1);
            for (let y = 5; y <= 7 && !spreadSeen; y++) {
                const c = game.grid.getCell(10, y)!;
                if (c.isBurning || c.terrain === C.EMBERS || c.terrain === C.ASH) {
                    spreadSeen = true;
                }
            }
        }
        expect(spreadSeen, '火应沿草块蔓延到远端列（烧过即留下 EMBERS/ASH 物证）').toBe(true);
        // 无论断言时它在烧还是已衰老：必然经历过"火地形在层上"的状态——
        // EMBERS/ASH 本身就是"曾挂火地形"的物证（且只能来自蔓延出的火：
        // 远端列距点火点 4 格，直燃从未触及）。
        for (let y = 5; y <= 7; y++) {
            const far = game.grid.getCell(10, y)!;
            if (far.isBurning) {
                expect(hasFire(game, 10, y), '蔓延格燃烧中必须带火地形').toBe(true);
            }
        }
    });
});

describe('F-1 对抗③：A 类读者看得见火（镜像脱钩即红）', () => {
    it('落位/寻路图在燃烧格上的判定与迁移前一致。' +
        '错误实现：火写进读者不看的层、或漏更新镜像位。', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        game.grid.setTerrain(8, 6, C.GRASS, '"', 0x33aa33);
        game.environment.ignite(8, 6);

        // 落位拒绝（Game.entryQualifiesForPlacement，CE T_PATHING_BLOCKER ⊃ T_IS_FIRE）
        expect(priv(game).entryQualifiesForPlacement(8, 6), '燃烧格不得作为落点').toBe(false);
        // 环分析阻挡（LoopMap.blocksPathing，T_IS_FIRE 位）
        expect(blocksPathing(game.grid.getCell(8, 6)!), '燃烧格必须阻挡环分析').toBe(true);
        // canMoveTo：火盖在深水上（CE 全层 OR 的运动判据）——
        // 迁移前 effectively WATER_DEEP → 不可走；迁移后深水在 LIQUID 层，
        // 跨层读才保得住这个答案。
        game.grid.setTerrain(10, 6, C.WATER_DEEP, '~', 0x1133aa);
        game.environment.igniteForced(10, 6);
        expect(priv(game).canMoveTo(10, 6), '燃烧的深水格仍不可走（火不能遮住深水）').toBe(false);
        // F-2a：火不再按 burnDuration 硬熄灭（概率衰老，均值约 20 回合）——
        // "熄灭后恢复"改用测试口径手动摘火层；被测语义（水重新成为有效地形、
        // 恢复阻挡）不变。
        game.grid.setTerrain(12, 6, C.WATER_DEEP, '~', 0x1133aa);
        game.environment.igniteForced(12, 6);
        const w = game.grid.getCell(12, 6)!;
        expect(w.isBurning).toBe(true);
        w.layers[L.SURFACE] = C.NOTHING; // 手动摘火（模拟衰老离场后的层状态）
        expect(w.isBurning, '摘火层后镜像同步（派生读数）').toBe(false);
        expect(w.terrain, '水上的火离场后水重新成为有效地形').toBe(C.WATER_DEEP);
        expect(priv(game).canMoveTo(12, 6), '熄灭后深水照旧不可走').toBe(false);
    });
});

describe('F-1 对抗④（F-2a 反转：burnDuration 红线 → 概率衰老红线）', () => {
    it('火的寿命必须由 promoteChance 概率衰老承担（几何分布，PLAIN_FIRE 均值约 20 回合），' +
        '不得回退成 4-7 硬倒计时。错误实现：任何形式的固定倒计时——' +
        '60 个燃烧格推 8 个客观块后必须仍大半在烧（旧模型 0% 存活到第 8 回合）。', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        let ignited = 0;
        for (let i = 0; i < 60; i++) {
            const x = 2 + (i % 14), y = 2 + Math.floor(i / 14);
            game.grid.setTerrain(x, y, C.GRASS, '"', 0x33aa33);
            game.environment.ignite(x, y);
            ignited++;
        }
        expect(ignited, '60 格全部应点燃（可燃物直燃无掷骰）').toBe(60);
        // 推 8 个客观块：衰老掷骰自第 2 块开始（起火回合登记 CAUGHT_FIRE 一回
        // 合豁免），单格存活率 0.95^7 ≈ 70%，60 格的均值波动 < ±6%——
        // 旧 4-7 倒计时模型下存活数为 0，任何倒计时复活都在此翻红。
        for (let i = 0; i < 8; i++) tickEnv(game, 1);
        let stillBurning = 0;
        for (let i = 0; i < 60; i++) {
            const x = 2 + (i % 14), y = 2 + Math.floor(i / 14);
            if (game.grid.getCell(x, y)!.isBurning) stillBurning++;
        }
        expect(stillBurning, '8 回合后大半火格必须仍存活（概率衰老，非 4-7 倒计时）').toBeGreaterThan(20);
    });
});

describe('F-1 对抗⑤（F-2a 反转：烧尽产物 = CE 链 EMBERS → ASH）', () => {
    it('草烧尽不再是 CHARRED_FLOOR（F-1 红线已反转）：衰老产物 EMBERS → ASH，' +
        'CHARRED_FLOOR 不再由火烧尽生产。' +
        '错误实现：把产物改回 CHARRED_FLOOR（旧 web 行为）或跳过 EMBERS 直落 ASH。', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        game.grid.setTerrain(8, 6, C.GRASS, '"', 0x33aa33);
        game.environment.ignite(8, 6);
        const cell = game.grid.getCell(8, 6)!;
        // 衰老链（promoteTile 单位入口，同 runPromotionUpdate 落地路径）：
        promoteTile(game.grid, 8, 6, L.SURFACE, false);
        expect(cell.terrain, '草火第一步衰老 = EMBERS（CE Globals.c:469）').toBe(C.EMBERS);
        promoteTile(game.grid, 8, 6, L.SURFACE, false);
        expect(cell.terrain, '第二步 = ASH（CE Globals.c:461）').toBe(C.ASH);
        expect(cell.terrain, '绝不能是 CHARRED_FLOOR（web 旧产物，已退役）').not.toBe(C.CHARRED_FLOOR);
        // ASH 是零旗标装饰：可走、可视、不参与燃烧。
        expect(isFireTerrain(C.ASH)).toBe(false);
        expect(blocksPassability(C.ASH)).toBe(false);
    });
});

describe('F-1 对抗⑥：持久化往返（存一半即红）', () => {
    it('燃烧中的草+地板存档→读档：火还在、层一致；读档后能继续衰老成 EMBERS。' +
        '错误实现：快照漏层（火消失）或漏镜像位（复活/丢火）。' +
        '（F-2a：burnDuration/burnTerrain 随倒计时模型退役，不再往返。）', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        game.grid.setTerrain(8, 6, C.GRASS, '"', 0x33aa33);
        game.environment.ignite(8, 6);
        game.environment.igniteForced(10, 8);
        const g0 = game.grid.getCell(8, 6)!;
        const f0 = game.grid.getCell(10, 8)!;

        const snap = game.toSnapshot();
        const reloaded = createHeadlessGame(1);
        expect(reloaded.loadSnapshot(snap)).toBe(true);

        const g1 = reloaded.grid.getCell(8, 6)!;
        const f1 = reloaded.grid.getCell(10, 8)!;
        expect(g1.isBurning, '草火存活').toBe(true);
        expect(g1.layers, 'SURFACE 层火地形必须随存档往返').toEqual(g0.layers);
        expect(f1.isBurning, '地板火存活').toBe(true);
        expect(f1.layers).toEqual(f0.layers);

        // 读档后继续衰老，产物正确
        promoteTile(reloaded.grid, 8, 6, L.SURFACE, false);
        expect(g1.terrain, '读档后草地照样衰老成 EMBERS').toBe(C.EMBERS);
        expect(g1.isBurning).toBe(false);
    });

    it('旧存档迁移：isBurning=true 而层里无火（F-1 前格式）→ 读档自动补火层；' +
        '反常组合（无火标志却有火层）→ 自动摘除。', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        game.grid.setTerrain(8, 6, C.GRASS, '"', 0x33aa33);
        const snap = JSON.parse(JSON.stringify(game.toSnapshot())) as GameSnapshot;
        // 手造旧格式燃烧格：有标志、无火层
        const cellSnap = snap.grid.find((c) => c.x === 8 && c.y === 6)!;
        cellSnap.isBurning = true;
        cellSnap.layers = (cellSnap.layers ?? []).map((t) => (isFireTerrain(t) ? C.NOTHING : t));
        expect(reloadedMirror(snap), '补写后该格必须挂火地形').toBe(true);

        // 反常组合：无标志、有火层（手造层：DUNGEON=FLOOR + SURFACE 火）
        const snap2 = JSON.parse(JSON.stringify(game.toSnapshot())) as GameSnapshot;
        const cellSnap2 = snap2.grid.find((c) => c.x === 8 && c.y === 6)!;
        cellSnap2.isBurning = false;
        cellSnap2.layers = [C.FLOOR, C.NOTHING, C.NOTHING, C.PLAIN_FIRE];
        const g2 = createHeadlessGame(1);
        expect(g2.loadSnapshot(snap2)).toBe(true);
        const c2 = g2.grid.getCell(8, 6)!;
        expect(c2.isBurning).toBe(false);
        expect(c2.layers.some((t) => isFireTerrain(t)), '幽灵火必须被对账摘除').toBe(false);
        expect(c2.terrain, '摘火后露出手造的 DUNGEON 层地板').toBe(C.FLOOR);
    });

    /** 读旧格式快照并回答"该格是否挂上火地形"。 */
    function reloadedMirror(snap: GameSnapshot): boolean {
        const g = createHeadlessGame(1);
        expect(g.loadSnapshot(snap)).toBe(true);
        const c = g.grid.getCell(8, 6)!;
        expect(c.isBurning).toBe(true);
        return c.layers.some((t) => isFireTerrain(t));
    }
});

describe('F-1 对抗⑦（G-1 反转）：火不写 GAS 层；气体住进 GAS 层', () => {
    // 原断言（C-4a-0 留痕，F-1/F-2a 全程有效）："点火/蔓延/衰老/注气全过程
    // 中任何格的 GAS 层不得被写"。G-1 把气体迁入 GAS 层，"注气不写层"的
    // 前提到期；按 B-1 范本翻转为"断言新事实 + 保留越界守卫"：
    //   新事实：注气后 GAS 层持有点名格的气体地形（气体真的住在层里）；
    //   守卫保留：火系全流程（点火/蔓延/衰老）依旧不得在 GAS 层留下任何
    //   内容——CE 火 DF 全在 SURFACE（F-0 §3.2），把火写进 GAS 层的错误
    //   实现依旧在此翻红。
    it('注气写入 GAS 层（POISON_GAS 落在注入格）；点火/蔓延/衰老全程 GAS 层', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        for (let x = 6; x <= 10; x++) game.grid.setTerrain(x, 6, C.GRASS, '"', 0x33aa33);
        game.grid.setTerrain(8, 4, C.GRASS, '"', 0x33aa33);
        game.environment.ignite(8, 4);
        game.environment.ignite(6, 6);
        // G-1：注入 50 体积毒气（旧 0-100 密度口径的字面量 2/50 退役）。
        expect(game.environment.addGas(8, 8, GasType.POISON, 50)).toBe(true);
        // 新事实（即时）：注入格的 GAS 层即刻持有 POISON_GAS + 50 体积
        // ——气体真的住在层里，且 addGas 不再钳制到 100。
        const injected = game.grid.getCell(8, 8)!;
        expect(injected.layers[L.GAS]).toBe(C.POISON_GAS);
        expect(injected.volume).toBe(50);
        for (let i = 0; i < 16; i++) tickEnv(game, 1);
        for (let x = 0; x < game.grid.width; x++) {
            for (let y = 0; y < game.grid.height; y++) {
                const gasTile = game.grid.getCell(x, y)!.layers[L.GAS]!;
                // 守卫（原断言的火侧半边）：GAS 层只允许气体地形。
                // G-2 扩集合：METHANE_GAS 入列（第六种气体 tile 已迁移）。
                // G-3 扩集合：PARALYSIS_GAS 入列（第七种气体 tile 已迁移，
                // 载体 = 麻痹药水改线）。
                if (gasTile !== C.NOTHING) {
                    expect(
                        gasTile === C.POISON_GAS || gasTile === C.CONFUSION_GAS || gasTile === C.STEAM
                            || gasTile === C.METHANE_GAS || gasTile === C.PARALYSIS_GAS,
                        `GAS 层在 (${x},${y}) 出现非气体地形 ${TerrainType[gasTile]}`
                    ).toBe(true);
                }
                expect(gasTile, `火被误写进 GAS 层 (${x},${y})`).not.toBe(C.PLAIN_FIRE);
            }
        }
        // 新事实（持续）：16 回合后毒气仍以某种形态存于 GAS 层——CE 的
        // SLOW 档消散每轮期望 −0.4，50 体积损失 ≈ 6；扩散摊薄后部分体积
        // 会以"不可见残气"（layers[GAS]=NOTHING、volume>0，随机舍入的
        // CE 语义）存在，所以按体积总量断言而不是按可见类型。
        let totalVolume = 0;
        for (let x = 0; x < game.grid.width; x++) {
            for (let y = 0; y < game.grid.height; y++) {
                totalVolume += game.grid.getCell(x, y)!.volume;
            }
        }
        expect(totalVolume, '毒气体积必须仍在（消散 + chasm 逃逸之外体积守恒）').toBeGreaterThan(0);
    });
});

describe('F-1 对抗⑧：镜像不随外部地形写点脱钩——spawnBlood 不碰燃烧格', () => {
    it('燃烧格（有效地形=火）不吃血迹；CE：血 DF 的优先级判定弹开火（10<80）。' +
        '错误实现：把 spawnBlood 改成跨层读 → 血的 terrain setter 会清掉火层，制造脱钩。', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        game.grid.setTerrain(8, 6, C.GRASS, '"', 0x33aa33);
        game.environment.ignite(8, 6);
        (game as unknown as { spawnBlood(x: number, y: number): void }).spawnBlood(8, 6);
        const cell = game.grid.getCell(8, 6)!;
        expect(cell.isBurning).toBe(true);
        expect(hasFire(game, 8, 6), '燃烧格上的火不得被血迹覆盖').toBe(true);
        expect(cell.terrain).toBe(C.PLAIN_FIRE);
        expect(cell.layers[L.SURFACE] === C.BLOOD, '血不得落进 SURFACE（火在那里）').toBe(false);
    });
});
