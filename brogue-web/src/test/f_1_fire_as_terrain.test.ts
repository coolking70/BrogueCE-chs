/**
 * src/test/f_1_fire_as_terrain.test.ts — F-1：火焰迁成地形（行为逐位不变）。
 *
 * 被测事实：燃烧格 = "SURFACE 层挂着 PLAIN_FIRE 地形 + isBurning 镜像位"，
 * 两者由 Gas.ts 状态机的写点双写维护；烧尽产物仍是 CHARRED_FLOOR（红线）；
 * A 类读者（渲染位、落位、三张寻路图）经镜像看见火；GAS 层全程恒空。
 *
 * 每条断言都在注释里写明它捕获的错误实现。反向验证（改坏→红→还原）
 * 在本轮报告中留档，不落在本文件。
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame } from './harness';
import type { Game } from '../engine/Core/Game';
import type { GameSnapshot } from '../engine/Core/Game';
import { TerrainType, DungeonLayer, DRAW_PRIORITY, TERRAIN_HOME_LAYER } from '../engine/Map/Grid';
import { blocksPathing } from '../engine/Map/LoopMap';
import { isFireTerrain } from '../engine/Map/TerrainCatalog';

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

describe('F-1 对抗①：drawPriority 双向——火压住草（10<60），门盖住火（8<10）', () => {
    it('燃烧草格的有效地形 = PLAIN_FIRE；燃烧门格的有效地形 = DOOR（CE 渲染口径）。' +
        '错误实现 a：prio 抄成 >60 → 草压住火，第一对断言红；' +
        '错误实现 b：prio 抄成 <8 → 火压住门，第二对断言红。', () => {
        expect(DRAW_PRIORITY[C.PLAIN_FIRE]).toBe(10); // CE Globals.c:492
        expect(TERRAIN_HOME_LAYER[C.PLAIN_FIRE]).toBe(L.SURFACE); // CE DF 目录 Globals.c:740

        // 草地：点火后有效地形必须是火（CE：可燃物被火消耗，同层替换）
        const g1 = createHeadlessGame(42);
        openRoom(g1);
        g1.grid.setTerrain(8, 6, C.GRASS, '"', 0x33aa33);
        g1.environment.ignite(8, 6);
        const grass = g1.grid.getCell(8, 6)!;
        expect(grass.isBurning).toBe(true);
        expect(grass.terrain, '火必须压住草（drawPriority 10 < 60）').toBe(C.PLAIN_FIRE);

        // 门：点火后有效地形必须仍是门（CE：门 prio 8 盖住火 10）
        const g2 = createHeadlessGame(42);
        openRoom(g2);
        g2.grid.setTerrain(8, 6, C.DOOR, '+', 0xaa8844);
        g2.environment.ignite(8, 6);
        const door = g2.grid.getCell(8, 6)!;
        expect(door.isBurning).toBe(true);
        expect(door.terrain, '门必须盖住火（drawPriority 8 < 10，CE 口径）').toBe(C.DOOR);
        expect(fireLayer(g2, 8, 6), '火在 SURFACE 层（门在 DUNGEON 层，共存）').toBe(L.SURFACE);
    });
});

describe('F-1 对抗②：isBurning ↔ 火地形双写镜像（只改一边即红）', () => {
    it('点燃/燃烧中/烧尽三态下 isBurning === 有火地形，逐态断言。' +
        '错误实现：ignite 只置 isBurning 不写层（无火地形）；' +
        '或 burnout 只清层不回镜像（幽灵火）。', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        game.grid.setTerrain(8, 6, C.GRASS, '"', 0x33aa33);
        const cell = game.grid.getCell(8, 6)!;

        game.environment.ignite(8, 6);
        expect(cell.isBurning).toBe(true);
        expect(hasFire(game, 8, 6), '点燃必须写火地形层').toBe(true);
        expect(cell.burnTerrain, '烧尽判据的原身=点火前的草').toBe(C.GRASS);
        expect(cell.burnDuration).toBeGreaterThanOrEqual(4);
        expect(cell.burnDuration).toBeLessThanOrEqual(7);

        tickEnv(game, cell.burnDuration + 1); // 推到烧尽
        expect(cell.isBurning, '烧尽后镜像位归 false').toBe(false);
        expect(hasFire(game, 8, 6), '烧尽后不得残留火地形（幽灵火）').toBe(false);
        expect(cell.burnTerrain, '熄灭后 burnTerrain 复位').toBe(C.NOTHING);
    });

    it('igniteForced 在非可燃地形（地板）上：火照烧、烧尽原样熄灭。' +
        '错误实现：烧尽分支仍按有效地形（已是火）分流 → 焦土/漏摘火层。', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        game.environment.igniteForced(8, 6, 3);
        const cell = game.grid.getCell(8, 6)!;
        expect(cell.isBurning).toBe(true);
        expect(hasFire(game, 8, 6)).toBe(true);
        expect(cell.burnTerrain).toBe(C.FLOOR);
        expect(cell.terrain, '有效地形=火（地板在 DUNGEON 95，被火 10 盖住）').toBe(C.PLAIN_FIRE);

        tickEnv(game, 4);
        expect(cell.isBurning).toBe(false);
        expect(hasFire(game, 8, 6), '地板烧完只摘火层').toBe(false);
        expect(cell.terrain, '地板不是可燃白名单：原样熄灭、不变焦土').toBe(C.FLOOR);
    });

    it('蔓延出的火同样是"火地形"（CE：可燃物被消耗）。' +
        '错误实现：只在 ignite 入口双写、蔓延路径绕过。', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        for (let x = 6; x <= 10; x++) game.grid.setTerrain(x, 6, C.GRASS, '"', 0x33aa33);
        game.environment.ignite(6, 6);
        // 逐回合推进；40% 蔓延下 5 连草必然烧到 (10,6)（40%^4 全不中的概率 < 13%，
        // 用 12 回合窗口进一步压低；不改判定、只要求该格最终烧过）。
        let spreadSeen = false;
        for (let i = 0; i < 12 && !spreadSeen; i++) {
            tickEnv(game, 1);
            const c = game.grid.getCell(10, 6)!;
            if (c.isBurning || c.burnTerrain !== C.NOTHING || c.terrain === C.CHARRED_FLOOR) {
                spreadSeen = true;
            }
        }
        expect(spreadSeen, '火应沿草带蔓延到远端').toBe(true);
        const far = game.grid.getCell(10, 6)!;
        // 无论断言时它正在烧还是已烧尽：必然经历过"火地形在层上"的状态——
        // 烧尽产物（焦土）本身就是"曾挂火地形"的物证（旧实现无地形痕迹）。
        if (far.isBurning) {
            expect(hasFire(game, 10, 6), '蔓延格燃烧中必须带火地形').toBe(true);
        } else {
            expect(far.terrain, '蔓延格已烧尽：必是焦土（曾为火地形的物证）').toBe(C.CHARRED_FLOOR);
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
        game.environment.igniteForced(10, 6, 5);
        expect(priv(game).canMoveTo(10, 6), '燃烧的深水格仍不可走（火不能遮住深水）').toBe(false);
        // 灭了以后（走正规熄灭路径：时长 1 → 推进烧尽）深水恢复阻挡
        game.grid.setTerrain(12, 6, C.WATER_DEEP, '~', 0x1133aa);
        game.environment.igniteForced(12, 6, 1);
        tickEnv(game, 2);
        const w = game.grid.getCell(12, 6)!;
        expect(w.isBurning).toBe(false);
        expect(w.terrain, '水上的火烧尽后原样熄灭（水重新成为有效地形）').toBe(C.WATER_DEEP);
        expect(priv(game).canMoveTo(12, 6), '熄灭后深水照旧不可走').toBe(false);
    });
});

describe('F-1 对抗④：燃烧时长参数（红线项）', () => {
    it('草 4-7 / 门 2-4 / igniteForced 显式值。' +
        '错误实现：顺手"优化"成固定值或换区间。', () => {
        // 界断言（不做单点统计断言——统计脆弱，见项目常识 §四）
        const game = createHeadlessGame(42);
        openRoom(game);
        const durs: number[] = [];
        for (let i = 0; i < 60; i++) {
            const x = 2 + (i % 14), y = 2 + Math.floor(i / 14);
            game.grid.setTerrain(x, y, C.GRASS, '"', 0x33aa33);
            game.environment.ignite(x, y);
            durs.push(game.grid.getCell(x, y)!.burnDuration);
        }
        expect(Math.min(...durs), '草的最短燃烧 ≥4（randRange(4,7) 下界）').toBeGreaterThanOrEqual(4);
        expect(Math.max(...durs), '草的最长燃烧 ≤7（randRange(4,7) 上界）').toBeLessThanOrEqual(7);
        expect(new Set(durs).size, '60 次取样必须出现多个不同值——固定值实现在此红').toBeGreaterThan(1);

        const doorDurs: number[] = [];
        for (let i = 0; i < 60; i++) {
            const x = 2 + (i % 14), y = 7 + Math.floor(i / 14); // 与草格不重叠的 fresh 格
            game.grid.setTerrain(x, y, C.DOOR, '+', 0xaa8844);
            game.environment.ignite(x, y);
            doorDurs.push(game.grid.getCell(x, y)!.burnDuration);
        }
        expect(Math.min(...doorDurs), '门的最短燃烧 ≥2').toBeGreaterThanOrEqual(2);
        expect(Math.max(...doorDurs), '门的最长燃烧 ≤4').toBeLessThanOrEqual(4);
        expect(new Set(doorDurs).size).toBeGreaterThan(1);

        // 显式时长直通
        game.grid.setTerrain(8, 8, C.GRASS, '"', 0x33aa33);
        game.environment.igniteForced(8, 8, 5);
        expect(game.grid.getCell(8, 8)!.burnDuration, '显式时长必须原样生效').toBe(5);
    });
});

describe('F-1 对抗⑤：烧尽产物 = CHARRED_FLOOR（红线）', () => {
    it('草/网烧尽变焦土而非 EMBERS；EMBERS 地形不存在。' +
        '错误实现：把"烧完变 CHARRED_FLOOR"顺手对齐成 CE 的 EMBERS。', () => {
        expect((TerrainType as unknown as Record<string, unknown>).EMBERS, '本轮不得引入 EMBERS 地形').toBeUndefined();
        const game = createHeadlessGame(42);
        openRoom(game);
        game.grid.setTerrain(8, 6, C.GRASS, '"', 0x33aa33);
        game.environment.ignite(8, 6);
        const cell = game.grid.getCell(8, 6)!;
        tickEnv(game, cell.burnDuration + 1);
        expect(cell.terrain, '草烧尽=焦土（web 现状，F-2a 才对齐 CE 产物）').toBe(C.CHARRED_FLOOR);
        expect(cell.char).toBe('.');
        expect(cell.color).toBe(0x444444);
        expect(hasFire(game, 8, 6)).toBe(false);
        // 网同样（注意：WEB 不在 ignite() 白名单——"网只能被蔓延点着"是既有
        // 行为，F-0 §3.4 登记；强制点火走 igniteForced）
        game.grid.setTerrain(10, 8, C.WEB, '\\', 0xcccccc);
        game.environment.igniteForced(10, 8, 2);
        const web = game.grid.getCell(10, 8)!;
        tickEnv(game, 3);
        expect(web.terrain).toBe(C.CHARRED_FLOOR);
        expect(web.isPassable, '网烧尽后可通行（原行为）').toBe(true);
    });
});

describe('F-1 对抗⑥：持久化往返（存一半即红）', () => {
    it('燃烧中的草+地板存档→读档：火还在、层在、时长/原身一致；读档后能烧尽。' +
        '错误实现：快照漏 burnTerrain（读档后烧尽产物错）或漏层（火消失）或漏镜像位（复活/丢火）。', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        game.grid.setTerrain(8, 6, C.GRASS, '"', 0x33aa33);
        game.environment.ignite(8, 6);
        game.environment.igniteForced(10, 8, 6);
        const g0 = game.grid.getCell(8, 6)!;
        const f0 = game.grid.getCell(10, 8)!;
        const durGrass = g0.burnDuration, durFloor = f0.burnDuration;

        const snap = game.toSnapshot();
        const reloaded = createHeadlessGame(1);
        expect(reloaded.loadSnapshot(snap)).toBe(true);

        const g1 = reloaded.grid.getCell(8, 6)!;
        const f1 = reloaded.grid.getCell(10, 8)!;
        expect(g1.isBurning, '草火存活').toBe(true);
        expect(g1.burnDuration).toBe(durGrass);
        expect(g1.burnTerrain, '烧尽判据原身必须随存档往返').toBe(C.GRASS);
        expect(g1.layers, 'SURFACE 层火地形必须随存档往返').toEqual(g0.layers);
        expect(f1.isBurning, '地板火存活').toBe(true);
        expect(f1.burnDuration).toBe(durFloor);
        expect(f1.burnTerrain).toBe(C.FLOOR);
        expect(f1.layers).toEqual(f0.layers);

        // 读档后继续烧尽，产物正确
        tickEnv(reloaded, durGrass + 1);
        expect(g1.terrain, '读档后草地照样烧成焦土').toBe(C.CHARRED_FLOOR);
        expect(g1.isBurning).toBe(false);
    });

    it('旧存档迁移：isBurning=true 而层里无火（F-1 前格式）→ 读档自动补火层；' +
        '反常组合（无火标志却有火层）→ 自动摘除。', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        game.grid.setTerrain(8, 6, C.GRASS, '"', 0x33aa33);
        const snap = JSON.parse(JSON.stringify(game.toSnapshot())) as GameSnapshot;
        // 手造旧格式燃烧格：有标志、无火层、无 burnTerrain
        const cellSnap = snap.grid.find((c) => c.x === 8 && c.y === 6)!;
        cellSnap.isBurning = true;
        cellSnap.burnDuration = 5;
        delete cellSnap.burnTerrain;
        cellSnap.layers = (cellSnap.layers ?? []).map((t) => (isFireTerrain(t) ? C.NOTHING : t));
        expect(reloadedMirror(snap), '补写后该格必须挂火地形').toBe(true);

        // 反常组合：无标志、有火层（手造层：DUNGEON=FLOOR + SURFACE 火）
        const snap2 = JSON.parse(JSON.stringify(game.toSnapshot())) as GameSnapshot;
        const cellSnap2 = snap2.grid.find((c) => c.x === 8 && c.y === 6)!;
        cellSnap2.isBurning = false;
        cellSnap2.burnDuration = 0;
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

describe('F-1 对抗⑦：GAS 层恒空（C-4a-0 留痕在 F-1 全程有效）', () => {
    it('点火/蔓延/烧尽/注气全过程中任何格的 GAS 层不得被写。' +
        '错误实现：把火写进 GAS 层（CE 火 DF 全在 SURFACE，F-0 §3.2）。', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        for (let x = 6; x <= 10; x++) game.grid.setTerrain(x, 6, C.GRASS, '"', 0x33aa33);
        game.grid.setTerrain(8, 4, C.GRASS, '"', 0x33aa33);
        game.environment.ignite(8, 4);
        game.environment.ignite(6, 6);
        game.environment.addGas(8, 8, 2 /* GasType.POISON */, 50);
        for (let i = 0; i < 16; i++) tickEnv(game, 1);
        for (let x = 0; x < game.grid.width; x++) {
            for (let y = 0; y < game.grid.height; y++) {
                expect(game.grid.getCell(x, y)!.layers[L.GAS], `GAS 层在 (${x},${y}) 被误写`).toBe(C.NOTHING);
            }
        }
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
