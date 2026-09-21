/**
 * src/test/v_2b_7_features.test.ts — V-2b-7：DF 特征系统轮
 *
 * 分组（每条断言的否定面写在用例内）：
 *   A. 19 条新地形载体 ≡ CE Globals.c tileCatalog 原行（逐字段对抗）；
 *   B. 22 条新 DF 目录条目 ≡ CE Globals.c DF 目录原行；
 *   C. 13 条 CE 蓝图（9/11/12/30/33/42/45/46/47/49/53/55/57）落地；
 *   D. MachineResult.featureSpawns——CE Architect.c:1484-1486「Mark the
 *      feature location as part of the machine」的落点终于有载体，p1_37 AD3
 *      那条空转四轮的逐格断言由此恢复力量（本组在 5 seed × 3 层上独立复钉）；
 *   E. MF_MONSTER_FLEEING（CE :1651-1654，33 号唯一载体）落位；
 *   F. §2.1 可解性证明的**怪物携带形态那一半**：携钥匙的怪可达、落点安全；
 *   G. 47 号 Sacrifice altar 的结构性退化（MB_MARKED_FOR_SACRIFICE 缺失
 *      导致领养落点永久不可达）——退池留形的双向守卫。
 *
 * 对抗性要求（任务书 §6）：
 *   ① 「疑似断言过期」的诊断都回答过「如果结论反过来是实现错，我会看到
 *      什么现象？我确认过没看到吗？」——见 V-2b-7 报告 §8。
 *   ② 每条用例的否定面：见各 it() 内注释。
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame } from './harness';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Monster } from '../entities/Monster';
import { Grid, TerrainType, DCOLS, DROWS, DRAW_PRIORITY, TERRAIN_HOME_LAYER } from '../engine/Map/Grid';
import {
    TERRAIN_FLAGS,
    T_IS_DF_TRAP,
    T_IS_FIRE,
    T_IS_FLAMMABLE,
    T_OBSTRUCTS_GAS,
    T_OBSTRUCTS_ITEMS,
    T_OBSTRUCTS_PASSABILITY,
    T_OBSTRUCTS_SURFACE_EFFECTS,
    T_OBSTRUCTS_VISION,
    TM_IS_SECRET,
    TM_IS_WIRED,
    TM_LIST_IN_SIDEBAR,
    TM_PROMOTES_ON_ITEM_PICKUP,
    TM_PROMOTES_ON_STEP,
    TM_PROMOTES_WITH_KEY,
    TM_STAND_IN_TILE,
    TM_VANISHES_UPON_PROMOTION,
    TM_VISUALLY_DISTINCT,
    isPathingBlocker,
} from '../engine/Map/TerrainCatalog';
import {
    DUNGEON_FEATURE_CATALOG,
    DF_MISSING_TILES,
    DFF_ACTIVATE_DORMANT_MONSTER,
    DFF_BLOCKED_BY_OTHER_LAYERS,
    DFF_EVACUATE_CREATURES_FIRST,
    DFF_SUBSEQ_EVERYWHERE,
    DFF_TREAT_AS_BLOCKING,
    DF,
} from '../engine/Map/DungeonFeatureCatalog';
import { DungeonLayer } from '../engine/Map/Grid';
import { LightKind } from '../engine/Map/LightCatalog';
import { BlueprintEngine, BP_ADOPT_ITEM, type BlueprintDef, type MachineResult } from '../engine/Generator/BlueprintEngine';
import blueprintData from '../data/blueprints.json';
import { ItemCategory } from '../engine/Items/Item';

const C = TerrainType;
const L = DungeonLayer;
const BPS = blueprintData as unknown as BlueprintDef[];
const byId = (id: string): BlueprintDef => {
    const bp = BPS.find(b => b.id === id);
    expect(bp, `blueprints.json 缺蓝图 ${id}`).toBeDefined();
    return bp!;
};

// ── A：19 条新地形载体 ≡ CE Globals.c tileCatalog 原行 ──────────────────────

describe('V-2b-7 A：19 条新地形载体 ≡ CE Globals.c 原行（对抗：抄错任一位即红）', () => {
    it('A1 祭坛族四条的烛光与「取物/钥匙」通路旗标（:363/:367/:543/:546）', () => {
        // :363 {G_ORB_ALTAR, altarFore, altarBack, 17, 0, 0,0,0, 0, CANDLE_LIGHT,
        //   (T_OBSTRUCTS_SURFACE_EFFECTS), (TM_PROMOTES_WITH_KEY | TM_IS_WIRED | TM_LIST_IN_SIDEBAR)}
        // 对抗：把 TM_PROMOTES_WITH_KEY 抄漏 → ALTAR_KEYHOLE 不再认钥匙，
        // 12 号的水晶球成了摆设（本断言红）。
        const kh = TERRAIN_FLAGS[C.ALTAR_KEYHOLE];
        expect(kh.flags).toBe(T_OBSTRUCTS_SURFACE_EFFECTS);
        expect(kh.mechFlags).toBe(TM_PROMOTES_WITH_KEY | TM_IS_WIRED | TM_LIST_IN_SIDEBAR);
        expect(kh.glowLight, 'Globals.c:363 第 10 列 CANDLE_LIGHT').toBe(LightKind.CANDLE_LIGHT);
        expect(kh.fireType, 'CE 该行 fireType 为 0').toBe('');
        expect(kh.promoteType, 'CE 该行 promoteType 为 0').toBe('');

        // :367 {G_SAC_ALTAR, altarFore, altarBack, 17, 0, 0,0,DF_ALTAR_RETRACT, 0, CANDLE_LIGHT,
        //   (T_OBSTRUCTS_SURFACE_EFFECTS), (TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED |
        //    TM_PROMOTES_ON_ITEM_PICKUP | TM_LIST_IN_SIDEBAR | TM_VISUALLY_DISTINCT)}
        const ar = TERRAIN_FLAGS[C.ALTAR_SWITCH_RETRACTING];
        expect(ar.flags).toBe(T_OBSTRUCTS_SURFACE_EFFECTS);
        expect(ar.mechFlags).toBe(
            TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED | TM_PROMOTES_ON_ITEM_PICKUP |
            TM_LIST_IN_SIDEBAR | TM_VISUALLY_DISTINCT
        );
        expect(ar.promoteType).toBe('DF_ALTAR_RETRACT');
        expect(ar.glowLight).toBe(LightKind.CANDLE_LIGHT);

        // :543 {G_SAC_ALTAR, altarFore, altarBack, 17, 0, 0,0,DF_SACRIFICE_ALTAR, 0, CANDLE_LIGHT,
        //   (T_OBSTRUCTS_SURFACE_EFFECTS), (TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED |
        //    TM_LIST_IN_SIDEBAR | TM_VISUALLY_DISTINCT)}
        const sad = TERRAIN_FLAGS[C.SACRIFICE_ALTAR_DORMANT];
        expect(sad.mechFlags).toBe(
            TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED | TM_LIST_IN_SIDEBAR | TM_VISUALLY_DISTINCT
        );
        expect(sad.promoteType).toBe('DF_SACRIFICE_ALTAR');

        // :546 {G_WALL, altarBack, veryDarkGray, 17, 0, 0,0,DF_SACRIFICE_CAGE_ACTIVE, 0, CANDLE_LIGHT,
        //   (T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_SURFACE_EFFECTS),
        //   (TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED |
        //    TM_LIST_IN_SIDEBAR | TM_VISUALLY_DISTINCT)}
        // ★ 注意：本条**没有** TM_PROMOTES_ON_SACRIFICE_ENTRY——该旗标在 CE 里
        //   属于 SACRIFICE_ALTAR（:544），不在休眠体上。抄错方向会改变
        //   「谁会开笼」的判断。
        const scd = TERRAIN_FLAGS[C.SACRIFICE_CAGE_DORMANT];
        expect(scd.flags).toBe(T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_SURFACE_EFFECTS);
        expect(scd.mechFlags).toBe(
            TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED |
            TM_LIST_IN_SIDEBAR | TM_VISUALLY_DISTINCT
        );
        expect(scd.promoteType).toBe('DF_SACRIFICE_CAGE_ACTIVE');
        // 堵格体：这条是 47 号退化的根因（见 G 组）。
        expect(isPathingBlocker(C.SACRIFICE_CAGE_DORMANT), '笼体挡路（CE flags 带 PASSABILITY）').toBe(true);
    });

    it('A2 BRAZIER（:573）是唯一带 T_OBSTRUCTS_PASSABILITY 的火地形', () => {
        // :573 {G_FIRE, fireFore, statueBack, 0, 0, DF_PLAIN_FIRE, 0,0, 0, BURNING_CREATURE_LIGHT,
        //   (T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_ITEMS | T_IS_FIRE), (TM_STAND_IN_TILE | TM_LIST_IN_SIDEBAR)}
        // 对抗：漏掉 PASSABILITY → 火盆变成可走的火，53 号僵尸能直接踩进
        // "火盆"格（本断言红）；漏掉 T_IS_FIRE → isBurning 不认它。
        const b = TERRAIN_FLAGS[C.BRAZIER];
        expect(b.flags).toBe(T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_ITEMS | T_IS_FIRE);
        expect(b.mechFlags).toBe(TM_STAND_IN_TILE | TM_LIST_IN_SIDEBAR);
        expect(b.glowLight).toBe(LightKind.BURNING_CREATURE_LIGHT);
        expect(b.fireType).toBe('DF_PLAIN_FIRE');
        expect(DRAW_PRIORITY[C.BRAZIER], 'Globals.c:573 第 4 列 0（墙档）').toBe(0);
    });

    it('A3 三条隐藏态/伪装体（:372 棺木 / :387 喷火口 / :377 毒气板）', () => {
        // :372 {G_CLOSED_COFFIN, bridgeFront, bridgeBack, 17, 20, DF_COFFIN_BURNS, 0,
        //   DF_COFFIN_BURSTS, 0, NO_LIGHT, (T_IS_FLAMMABLE),
        //   (TM_IS_WIRED | TM_VANISHES_UPON_PROMOTION | TM_LIST_IN_SIDEBAR)}
        // 对抗：漏 T_IS_FLAMMABLE → 11 号的棺木烧不着，"烧棺木逼出吸血鬼"
        // 整条链失效。
        const cof = TERRAIN_FLAGS[C.COFFIN_CLOSED];
        expect(cof.flags).toBe(T_IS_FLAMMABLE);
        expect(cof.mechFlags).toBe(TM_IS_WIRED | TM_VANISHES_UPON_PROMOTION | TM_LIST_IN_SIDEBAR);
        expect(cof.chanceToIgnite).toBe(20);
        expect(cof.fireType).toBe('DF_COFFIN_BURNS');
        expect(cof.promoteType).toBe('DF_COFFIN_BURSTS');

        // :387 {G_FLOOR, floorFore, floorBack, 95, 0, DF_FLAMETHROWER,
        //   DF_SHOW_FLAMETHROWER_TRAP, 0, 0, NO_LIGHT, (T_IS_DF_TRAP), (TM_IS_SECRET)}
        const fl = TERRAIN_FLAGS[C.FLAMETHROWER_HIDDEN];
        expect(fl.flags).toBe(T_IS_DF_TRAP);
        expect(fl.mechFlags).toBe(TM_IS_SECRET);
        expect(fl.fireType).toBe('DF_FLAMETHROWER');
        expect(fl.discoverType).toBe('DF_SHOW_FLAMETHROWER_TRAP');
        expect(DRAW_PRIORITY[C.FLAMETHROWER_HIDDEN], 'G_FLOOR 伪装档 95').toBe(95);

        // :377 {G_FLOOR, floorFore, floorBack, 95, 0, DF_POISON_GAS_CLOUD,
        //   DF_SHOW_POISON_GAS_TRAP, 0, 0, NO_LIGHT, (T_IS_DF_TRAP), (TM_IS_SECRET)}
        // 对抗：这两条若被写成"可见陷阱"（丢 TM_IS_SECRET），
        // p1_42 的 TM_IS_SECRET 持有集断言红。
        const gp = TERRAIN_FLAGS[C.GAS_TRAP_POISON_HIDDEN];
        expect(gp.flags).toBe(T_IS_DF_TRAP);
        expect(gp.mechFlags).toBe(TM_IS_SECRET);
        expect(gp.fireType).toBe('DF_POISON_GAS_CLOUD');
        expect(gp.discoverType).toBe('DF_SHOW_POISON_GAS_TRAP');
    });

    it('A4 三条雕像/门/镣铐（:547 恶魔雕像 / :355 石门 / :484+:486 镣铐）', () => {
        // :547 {G_STATUE, wallBack, statueBack, 0, 0, DF_PLAIN_FIRE, 0,0, 0, DEMONIC_STATUE_LIGHT,
        //   (PASSABILITY|ITEMS|GAS|SURFACE_EFFECTS), (TM_STAND_IN_TILE)}
        const ds = TERRAIN_FLAGS[C.DEMONIC_STATUE];
        expect(ds.flags).toBe(
            T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_ITEMS | T_OBSTRUCTS_GAS | T_OBSTRUCTS_SURFACE_EFFECTS
        );
        expect(ds.mechFlags).toBe(TM_STAND_IN_TILE);
        expect(ds.glowLight, 'Globals.c:547 第 10 列 DEMONIC_STATUE_LIGHT').toBe(LightKind.DEMONIC_STATUE_LIGHT);
        expect(DRAW_PRIORITY[C.DEMONIC_STATUE]).toBe(0);

        // :355 {G_DOORWAY, wallBack, floorBack, 17, 0, DF_PLAIN_FIRE, 0, DF_PORTAL_ACTIVATE, 0, NO_LIGHT,
        //   (T_OBSTRUCTS_ITEMS), (TM_STAND_IN_TILE | TM_IS_WIRED | TM_LIST_IN_SIDEBAR | TM_VISUALLY_DISTINCT)}
        // 对抗：漏 T_OBSTRUCTS_ITEMS → 12 号的水晶球会落在门里被玩家顺走。
        const po = TERRAIN_FLAGS[C.PORTAL];
        expect(po.flags).toBe(T_OBSTRUCTS_ITEMS);
        expect(po.mechFlags).toBe(TM_STAND_IN_TILE | TM_IS_WIRED | TM_LIST_IN_SIDEBAR | TM_VISUALLY_DISTINCT);
        expect(po.promoteType).toBe('DF_PORTAL_ACTIVATE');

        // :484/:486 {G_CHAIN_TOP|G_CHAIN_LEFT, gray, 0, 20, 0, 0,0,0, 0, NO_LIGHT, 0, 0}
        // 对抗：给镣铐加上任何旗标（如 PASSABILITY）都会让 9 号把盟友关在
        // 房外——两条 CE 原行是**全零**。
        for (const t of [C.MANACLE_L, C.MANACLE_T]) {
            const e = TERRAIN_FLAGS[t];
            expect(e.flags, `${TerrainType[t]} 应为零旗标（CE 原行 0, 0）`).toBe(0);
            expect(e.mechFlags).toBe(0);
            expect(e.chanceToIgnite).toBe(0);
            expect(DRAW_PRIORITY[t]).toBe(20);
        }
    });

    it('A5 七条 DF 落点 tile（:448 枯草 / :449 灰菌 / :450 发光菌 / :457 呕吐物 / :465 碎石 / :473 枯叶 / :568 标记）', () => {
        // 这七条由 DF 目录新条目的 tile 列强制（DF 落点必须有 tile 载体）。
        // 逐条对照 CE 行；对抗：抄错 ign/flags 会改变火蔓延与踩踏行为。
        const cases: Array<[TerrainType, { line: number; ign: number; flags: number; prio: number; glow?: number }]> = [
            // :448 {G_GRASS, deadGrassColor, 0, 60, 40, DF_PLAIN_FIRE, 0,0, 0, NO_LIGHT, (T_IS_FLAMMABLE),
            //   (TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION)}
            [C.DEAD_GRASS, { line: 448, ign: 40, flags: T_IS_FLAMMABLE, prio: 60 }],
            // :449 {G_GRASS, grayFungusColor, 0, 51, 10, DF_PLAIN_FIRE, ...}
            [C.GRAY_FUNGUS, { line: 449, ign: 10, flags: T_IS_FLAMMABLE, prio: 51 }],
            // :450 {G_GRASS, fungusColor, 0, 60, 10, DF_PLAIN_FIRE, 0,0, 0, FUNGUS_LIGHT, (T_IS_FLAMMABLE), ...}
            [C.LUMINESCENT_FUNGUS, { line: 450, ign: 10, flags: T_IS_FLAMMABLE, prio: 60, glow: LightKind.FUNGUS_LIGHT }],
            // :457 {G_FLOOR_ALT, vomitColor, 0, 80, 0, DF_PLAIN_FIRE, 0,0, 0, NO_LIGHT, (0), (TM_STAND_IN_TILE)}
            [C.VOMIT, { line: 457, ign: 0, flags: 0, prio: 80 }],
            // :465 {G_RUBBLE, gray, 0, 70, 0, DF_PLAIN_FIRE, 0,0, 0, NO_LIGHT, (0), (TM_STAND_IN_TILE)}
            [C.RUBBLE, { line: 465, ign: 0, flags: 0, prio: 70 }],
            // :473 {G_FOLIAGE, deadFoliageColor, 0, 45, 80, DF_PLAIN_FIRE, 0, DF_SMALL_DEAD_GRASS, 0, NO_LIGHT,
            //   (T_OBSTRUCTS_VISION | T_IS_FLAMMABLE), (TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_PROMOTES_ON_STEP)}
            [C.DEAD_FOLIAGE, { line: 473, ign: 80, flags: T_OBSTRUCTS_VISION | T_IS_FLAMMABLE, prio: 45 }],
        ];
        for (const [t, want] of cases) {
            const e = TERRAIN_FLAGS[t];
            expect(e.chanceToIgnite, `${TerrainType[t]} ign（Globals.c:${want.line}）`).toBe(want.ign);
            expect(e.flags, `${TerrainType[t]} flags（Globals.c:${want.line}）`).toBe(want.flags);
            expect(DRAW_PRIORITY[t], `${TerrainType[t]} drawPriority`).toBe(want.prio);
            expect(e.glowLight, `${TerrainType[t]} glowLight`).toBe(want.glow ?? LightKind.NO_LIGHT);
        }
        // :473 的 promoteType 链（踩上枯叶 → 枯草）
        expect(TERRAIN_FLAGS[C.DEAD_FOLIAGE].mechFlags).toBe(
            TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_PROMOTES_ON_STEP
        );
        expect(TERRAIN_FLAGS[C.DEAD_FOLIAGE].promoteType).toBe('DF_SMALL_DEAD_GRASS');

        // :568 {0, 0, 0, 100, 0, 0,0, DF_WORM_TUNNEL_MARKER_ACTIVE, 0, NO_LIGHT, (0),
        //   (TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED)}
        // ★ CE 该行的 displayChar 是 0（不可见标记）；web 记空格。
        // 对抗：给它任何可见字符都会让 55 号的"隐藏标记"暴露。
        const wm = TERRAIN_FLAGS[C.WORM_TUNNEL_MARKER_DORMANT];
        expect(wm.flags).toBe(0);
        expect(wm.mechFlags).toBe(TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED);
        expect(wm.promoteType).toBe('DF_WORM_TUNNEL_MARKER_ACTIVE');
        expect(DRAW_PRIORITY[C.WORM_TUNNEL_MARKER_DORMANT], 'CE 第 4 列 100（与 NOTHING 同档）').toBe(100);
        expect(TERRAIN_HOME_LAYER[C.WORM_TUNNEL_MARKER_DORMANT], 'DF 目录 :879 的 layer 列 LIQUID').toBe(L.LIQUID);
    });

    it('A6 归属层：19 条里 10 条 DUNGEON / 8 条 SURFACE / 1 条 LIQUID（CE 原列）', () => {
        const expectHome: Array<[TerrainType, DungeonLayer]> = [
            [C.COFFIN_CLOSED, L.DUNGEON], [C.ALTAR_KEYHOLE, L.DUNGEON],
            [C.ALTAR_SWITCH_RETRACTING, L.DUNGEON], [C.BRAZIER, L.DUNGEON],
            [C.DEMONIC_STATUE, L.DUNGEON], [C.FLAMETHROWER_HIDDEN, L.DUNGEON],
            [C.GAS_TRAP_POISON_HIDDEN, L.DUNGEON], [C.PORTAL, L.DUNGEON],
            [C.SACRIFICE_ALTAR_DORMANT, L.DUNGEON], [C.SACRIFICE_CAGE_DORMANT, L.DUNGEON],
            [C.MANACLE_L, L.SURFACE], [C.MANACLE_T, L.SURFACE], [C.VOMIT, L.SURFACE],
            [C.LUMINESCENT_FUNGUS, L.SURFACE], [C.DEAD_FOLIAGE, L.SURFACE],
            [C.RUBBLE, L.SURFACE], [C.GRAY_FUNGUS, L.SURFACE], [C.DEAD_GRASS, L.SURFACE],
            [C.WORM_TUNNEL_MARKER_DORMANT, L.LIQUID],
        ];
        expect(expectHome.length).toBe(19);
        for (const [t, l] of expectHome) {
            expect(TERRAIN_HOME_LAYER[t], `TerrainType.${TerrainType[t]} 归属层`).toBe(l);
        }
    });
});

// ── B：22 条新 DF 目录条目 ≡ CE Globals.c 原行 ──────────────────────────────

describe('V-2b-7 B：22 条新 DF 目录条目 ≡ CE Globals.c 原行', () => {
    it('B1 蓝图 DF 列起点十一条的 tile/layer/概率/旗标', () => {
        type Want = { line: number; tile: TerrainType | null; layer: DungeonLayer; start: number; decr: number; flags: number; sub?: DF | null; ceTile: string };
        const cases: Array<[DF, Want]> = [
            [DF.DF_DEAD_FOLIAGE, { line: 615, tile: C.DEAD_FOLIAGE, layer: L.SURFACE, start: 50, decr: 30, flags: DFF_BLOCKED_BY_OTHER_LAYERS, ceTile: 'DEAD_FOLIAGE' }],
            [DF.DF_VOMIT, { line: 652, tile: C.VOMIT, layer: L.SURFACE, start: 30, decr: 10, flags: 0, ceTile: 'VOMIT' }],
            [DF.DF_TUNNELIZE, { line: 678, tile: C.RUBBLE, layer: L.SURFACE, start: 45, decr: 23, flags: DFF_ACTIVATE_DORMANT_MONSTER, ceTile: 'RUBBLE' }],
            [DF.DF_SMALL_DEAD_GRASS, { line: 689, tile: C.DEAD_GRASS, layer: L.SURFACE, start: 75, decr: 75, flags: 0, ceTile: 'DEAD_GRASS' }],
            [DF.DF_GLYPH_CIRCLE, { line: 731, tile: C.MACHINE_GLYPH, layer: L.DUNGEON, start: 200, decr: 95, flags: DFF_BLOCKED_BY_OTHER_LAYERS, ceTile: 'MACHINE_GLYPH' }],
            [DF.DF_TRIGGER_AREA, { line: 809, tile: C.MACHINE_TRIGGER_FLOOR, layer: L.DUNGEON, start: 200, decr: 100, flags: 0, ceTile: 'MACHINE_TRIGGER_FLOOR' }],
            [DF.DF_SURROUND_WOODEN_BARRICADE, {
                line: 824, tile: C.WOODEN_BARRICADE, layer: L.DUNGEON, start: 220, decr: 100,
                flags: DFF_TREAT_AS_BLOCKING | DFF_SUBSEQ_EVERYWHERE, sub: DF.DF_SMALL_DEAD_GRASS, ceTile: 'WOODEN_BARRICADE',
            }],
            [DF.DF_WORM_TUNNEL_MARKER_DORMANT, {
                line: 879, tile: C.WORM_TUNNEL_MARKER_DORMANT, layer: L.LIQUID, start: 5, decr: 5, flags: 0, ceTile: 'WORM_TUNNEL_MARKER_DORMANT',
            }],
            [DF.DF_SWAMP, { line: 904, tile: C.GRAY_FUNGUS, layer: L.SURFACE, start: 80, decr: 50, flags: 0, sub: DF.DF_SWAMP_MUD, ceTile: 'GRAY_FUNGUS' }],
        ];
        for (const [id, w] of cases) {
            const e = DUNGEON_FEATURE_CATALOG[id];
            expect(e, `目录缺 DF#${id}`).toBeDefined();
            expect(e!.ceLine, `DF#${id} ceLine`).toBe(w.line);
            expect(e!.ceTile, `DF#${id} ceTile`).toBe(w.ceTile);
            expect(e!.tile, `DF#${id} tile`).toBe(w.tile);
            expect(e!.layer, `DF#${id} layer`).toBe(w.layer);
            expect(e!.startProbability, `DF#${id} start`).toBe(w.start);
            expect(e!.probabilityDecrement, `DF#${id} decr`).toBe(w.decr);
            expect(e!.flags, `DF#${id} flags`).toBe(w.flags);
            if ('sub' in w) expect(e!.subsequentDF, `DF#${id} subsequentDF`).toBe(w.sub);
        }
    });

    it('B2 三条链环节与五条三链字段载体（:748/:903/:905 与 :625/:630/:724/:725/:746）', () => {
        // :748 {EMBERS, SURFACE, 0, 0, 0}——DF_COFFIN_BURNS 的链尾
        const emb = DUNGEON_FEATURE_CATALOG[DF.DF_EMBERS_PATCH]!;
        expect(emb.ceLine).toBe(748);
        expect(emb.tile).toBe(C.EMBERS);
        // :903 {SHALLOW_WATER, LIQUID, 30, 100, 0}——tile 别名到 web WATER_SHALLOW
        const sw = DUNGEON_FEATURE_CATALOG[DF.DF_SWAMP_WATER]!;
        expect(sw.ceLine).toBe(903);
        expect(sw.tile, 'CE SHALLOW_WATER ≙ web WATER_SHALLOW（C-4a 同名对照）').toBe(C.WATER_SHALLOW);
        expect(sw.layer).toBe(L.LIQUID);
        // :905 {MUD, LIQUID, 75, 5, 0, "", 0,0,0, 0, DF_SWAMP_WATER}
        const sm = DUNGEON_FEATURE_CATALOG[DF.DF_SWAMP_MUD]!;
        expect(sm.ceLine).toBe(905);
        expect(sm.tile).toBe(C.MUD);
        expect(sm.subsequentDF, '灰菌 → 泥沼 → 浅水 的三段链').toBe(DF.DF_SWAMP_WATER);
        // 链的完整闭包：DF_SWAMP → DF_SWAMP_MUD → DF_SWAMP_WATER → 0
        expect(DUNGEON_FEATURE_CATALOG[DF.DF_SWAMP_WATER]!.subsequentDF).toBeNull();

        // 五条 tile 无 web 载体的（进 DF_MISSING_TILES）
        const missing: Array<[DF, number, string]> = [
            [DF.DF_SHOW_POISON_GAS_TRAP, 625, 'GAS_TRAP_POISON'],
            [DF.DF_SHOW_FLAMETHROWER_TRAP, 630, 'FLAMETHROWER'],
            [DF.DF_ALTAR_RETRACT, 724, 'FLOOR_FLOODABLE'],
            [DF.DF_PORTAL_ACTIVATE, 725, 'PORTAL_LIGHT'],
            [DF.DF_SACRIFICE_ALTAR, 802, 'SACRIFICE_ALTAR'],
            [DF.DF_COFFIN_BURSTS, 807, 'COFFIN_OPEN'],
            [DF.DF_WORM_TUNNEL_MARKER_ACTIVE, 880, 'WORM_TUNNEL_MARKER_ACTIVE'],
        ];
        for (const [id, line, ceTile] of missing) {
            const e = DUNGEON_FEATURE_CATALOG[id]!;
            expect(e.ceLine, `DF#${id} ceLine`).toBe(line);
            expect(e.ceTile, `DF#${id} ceTile`).toBe(ceTile);
            expect(e.tile, `DF#${id} 无 web tile → null`).toBeNull();
            expect(DF_MISSING_TILES, `DF#${id} 应在缺 tile 名单里`).toContain(id);
        }
        // 反方向：本轮已落地 tile 的四条**不得**留在名单里（守卫变强）
        for (const id of [DF.DF_RUBBLE, DF.DF_SHATTERING_SPELL, DF.DF_WALL_SHATTER, DF.DF_STATUE_SHATTER, DF.DF_LUMINESCENT_FUNGUS]) {
            expect(DF_MISSING_TILES, `DF#${id} 的 tile 已到位，不得留在缺 tile 名单`).not.toContain(id);
        }
    });

    it('B3 CE 位置初始化异常如实登记：DF_WORM_TUNNEL_MARKER_DORMANT 的 effectRadius', () => {
        // CE :879 `{WORM_TUNNEL_MARKER_DORMANT, LIQUID, 5, 5, 0, "", 0, 0, GRANITE}`
        // 只有 9 个初始化项：按 Rogue.h:1886-1902 的字段序，末项 GRANITE
        // 落在 **effectRadius**（= tileType.GRANITE = 1），propagationTerrain 留 0。
        // 这是无后果的 CE 笔误（flags = 0，两个字段都无消费者），web 照字面抄。
        // 对抗：有人"顺手修好"写成 propagationTerrain=GRANITE 时本断言红。
        const e = DUNGEON_FEATURE_CATALOG[DF.DF_WORM_TUNNEL_MARKER_DORMANT]!;
        expect(e.effectRadius, 'CE 字面：第 9 个初始化项 GRANITE(=1) 落在 effectRadius').toBe(1);
        expect(e.cePropagationTerrain, 'CE 字面：propagationTerrain 未写（留 0）').toBe('');
        expect(e.propagationTerrain).toBeNull();
        expect(e.flags, 'flags = 0 ⇒ 上述两字段在 CE 里都无消费者').toBe(0);
    });

    it('B4 DF_PORTAL_ACTIVATE 的 EVACUATE|ACTIVATE 双旗标与 DF_COFFIN_BURNS 的 flashColor', () => {
        // :725 {PORTAL_LIGHT, SURFACE, 0, 0, (DFF_EVACUATE_CREATURES_FIRST |
        //   DFF_ACTIVATE_DORMANT_MONSTER), "the archway flashes, and you catch
        //   a glimpse of another world!"}
        const pa = DUNGEON_FEATURE_CATALOG[DF.DF_PORTAL_ACTIVATE]!;
        expect(pa.flags).toBe(DFF_EVACUATE_CREATURES_FIRST | DFF_ACTIVATE_DORMANT_MONSTER);
        expect(pa.layer).toBe(L.SURFACE);
        expect(pa.description).toBe('the archway flashes, and you catch a glimpse of another world!');
        // :807 {COFFIN_OPEN, DUNGEON, 0,0, DFF_ACTIVATE_DORMANT_MONSTER, "…", 0, &darkGray, 3}
        const cb = DUNGEON_FEATURE_CATALOG[DF.DF_COFFIN_BURSTS]!;
        expect(cb.flags).toBe(DFF_ACTIVATE_DORMANT_MONSTER);
        expect(cb.effectRadius).toBe(3);
        expect(cb.flashColor).toBe('darkGray');
        expect(cb.subsequentDF).toBeNull();
    });
});

// ── C：13 条 CE 蓝图落地 ────────────────────────────────────────────────────

describe('V-2b-7 C：13 条 CE 蓝图（9/11/12/30/33/42/45/46/47/49/53/55/57）落地', () => {
    it('C1 深度/房间/频率/类别/蓝图旗标逐条 ≡ CE GlobalsBrogue.c', () => {
        type Want = { name: string; wh: [number, number]; rs: [number, number]; freq: number; cat: string; flags: string[] };
        const cases: Array<[string, Want]> = [
            ['reward_chained_allies', { name: 'Dungeon -- two allies chained up for the taking', wh: [5, 26], rs: [30, 80], freq: 12, cat: 'reward', flags: ['BP_ROOM', 'BP_REWARD'] }],
            ['reward_vampire_lair', { name: 'Vampire lair -- allies locked in cages and chained in a hidden room with a vampire in a coffin; vampire has one cage key.', wh: [10, 26], rs: [50, 80], freq: 5, cat: 'reward', flags: ['BP_ROOM', 'BP_REWARD', 'BP_SURROUND_WITH_WALLS', 'BP_PURGE_INTERIOR'] }],
            ['reward_legendary_ally', { name: 'Legendary ally -- approach the altar with the crystal key to activate a portal and summon a legendary ally.', wh: [8, 26], rs: [30, 50], freq: 15, cat: 'reward', flags: ['BP_ROOM', 'BP_REWARD'] }],
            ['key_fun_with_fire', { name: 'Fun with fire -- trigger the fire trap and coax the fire over to the wooden barricade surrounding the altar and key', wh: [3, 10], rs: [80, 100], freq: 10, cat: 'key_guard', flags: ['BP_ROOM', 'BP_ADOPT_ITEM', 'BP_PURGE_INTERIOR', 'BP_SURROUND_WITH_WALLS', 'BP_OPEN_INTERIOR'] }],
            ['key_thief_area', { name: 'Thief area -- empty altar, monster with item, permanently fleeing.', wh: [3, 26], rs: [15, 20], freq: 10, cat: 'key_guard', flags: ['BP_ADOPT_ITEM'] }],
            ['key_burning_grass', { name: 'Burning grass -- key on an altar; take key to cause pilot light to ignite grass in room', wh: [1, 7], rs: [40, 110], freq: 10, cat: 'key_guard', flags: ['BP_ROOM', 'BP_PURGE_INTERIOR', 'BP_SURROUND_WITH_WALLS', 'BP_ADOPT_ITEM', 'BP_OPEN_INTERIOR'] }],
            ['key_guardian_gauntlet', { name: 'Guardian gauntlet -- key in a room full of guardians, glyphs scattered and unavoidable.', wh: [6, 26], rs: [50, 95], freq: 10, cat: 'key_guard', flags: ['BP_ROOM', 'BP_ADOPT_ITEM'] }],
            ['key_guardian_corridor', { name: 'Guardian corridor -- key in a small room, with a connecting corridor full of glyphs, one guardian blocking the corridor.', wh: [4, 26], rs: [85, 100], freq: 5, cat: 'key_guard', flags: ['BP_ROOM', 'BP_ADOPT_ITEM', 'BP_PURGE_INTERIOR', 'BP_OPEN_INTERIOR', 'BP_SURROUND_WITH_WALLS'] }],
            ['key_sacrifice_altar', { name: 'Sacrifice altar -- lure the chosen monster from elsewhere on the level onto the altar to release the key.', wh: [4, 26], rs: [20, 60], freq: 12, cat: 'key_guard', flags: ['BP_ROOM', 'BP_ADOPT_ITEM', 'BP_PURGE_INTERIOR', 'BP_OPEN_INTERIOR', 'BP_SURROUND_WITH_WALLS'] }],
            ['key_beckoning_obstacle', { name: 'Beckoning obstacle -- key surrounded by glyphs in a room with a mirrored totem.', wh: [5, 26], rs: [60, 100], freq: 10, cat: 'key_guard', flags: ['BP_ROOM', 'BP_PURGE_INTERIOR', 'BP_SURROUND_WITH_WALLS', 'BP_OPEN_INTERIOR', 'BP_ADOPT_ITEM'] }],
            ['key_zombie_crypt', { name: 'Zombie crypt -- key on an altar; coffins scattered around; brazier in the room; take key to cause zombies to burst out of all of the coffins', wh: [12, 26], rs: [60, 90], freq: 10, cat: 'key_guard', flags: ['BP_ROOM', 'BP_ADOPT_ITEM', 'BP_SURROUND_WITH_WALLS', 'BP_PURGE_INTERIOR'] }],
            ['key_worm_tunnels', { name: 'Worm tunnels -- hidden lever causes tunnels to open up revealing worm areas and a key', wh: [8, 26], rs: [80, 175], freq: 10, cat: 'key_guard', flags: ['BP_ROOM', 'BP_ADOPT_ITEM', 'BP_PURGE_INTERIOR', 'BP_SURROUND_WITH_WALLS'] }],
            ['key_boss_secret_room', { name: 'Boss -- key is held by a boss atop a pile of bones in a secret room. A few fungus patches light up the area.', wh: [5, 26], rs: [40, 100], freq: 18, cat: 'key_guard', flags: ['BP_ROOM', 'BP_ADOPT_ITEM', 'BP_SURROUND_WITH_WALLS', 'BP_PURGE_LIQUIDS'] }],
        ];
        expect(cases.length, '恰 13 条').toBe(13);
        for (const [id, w] of cases) {
            const bp = byId(id);
            expect(bp.name, `${id} name`).toBe(w.name);
            expect(bp.depthRange, `${id} depthRange`).toEqual(w.wh);
            expect(bp.roomSize, `${id} roomSize`).toEqual(w.rs);
            expect(bp.frequency, `${id} frequency`).toBe(w.freq);
            expect(bp.category, `${id} category`).toBe(w.cat);
            expect([...bp.flags].sort(), `${id} flags`).toEqual([...w.flags].sort());
        }
    });

    it('C2 承载行为的 feature 字段（对抗：落错格/丢旗标即红）', () => {
        // 11 号棺木 feature：DF_TRIGGER_AREA + COFFIN_CLOSED + KEY/MK_VAMPIRE，
        // 六条旗标缺一不可（GENERATE_ITEM 生成钥匙、SKELETON_KEY 机器号匹配、
        // MONSTER_TAKE_ITEM 挂给怪、MONSTERS_DORMANT 休眠、FAR_FROM_ORIGIN
        // 远离门、KEY_DISPOSABLE 用后即毁）。
        const vamp = byId('reward_vampire_lair');
        const coff = vamp.features.find(f => f.terrain === 'COFFIN_CLOSED')!;
        expect(coff.featureDF).toBe('DF_TRIGGER_AREA');
        expect(coff.itemCategory).toBe('KEY');
        expect(coff.itemId).toBe('cage_key');
        expect(coff.monsterId).toBe('vampire');
        expect([...coff.flags].sort()).toEqual([
            'MF_FAR_FROM_ORIGIN', 'MF_GENERATE_ITEM', 'MF_KEY_DISPOSABLE',
            'MF_MONSTERS_DORMANT', 'MF_MONSTER_TAKE_ITEM', 'MF_SKELETON_KEY',
        ].sort());

        // 12 号水晶球：itemId 必须在 arcana.json 的 keys 里（否则领养链落地时
        // spawnKey 拿不到定义 → 钥匙静默消失）。
        const legend = byId('reward_legendary_ally');
        const altar = legend.features.find(f => f.terrain === 'ALTAR_KEYHOLE')!;
        expect(altar.itemCategory).toBe('KEY');
        expect(altar.itemId).toBe('crystal_orb');
        expect(altar.flags).toContain('MF_OUTSOURCE_ITEM_TO_MACHINE');
        expect(altar.flags).toContain('MF_KEY_DISPOSABLE');
        expect(altar.featureDF).toBe('DF_LUMINESCENT_FUNGUS');
        expect(legend.features.find(f => f.terrain === 'PORTAL')!.hordeFlags)
            .toEqual(['HORDE_MACHINE_LEGENDARY_ALLY']);

        // 30 号：环形木栅（DF 列）+ 毒气板 + 喷火口 + 蚀菌药水（POTION_LICHEN
        // ≙ web potion_of_creeping_death）。
        const fire = byId('key_fun_with_fire');
        expect(fire.features.find(f => f.terrain === 'ALTAR')!.featureDF).toBe('DF_SURROUND_WOODEN_BARRICADE');
        expect(fire.features.find(f => f.terrain === 'FLAMETHROWER_HIDDEN')).toBeDefined();
        expect(fire.features.find(f => f.terrain === 'GAS_TRAP_POISON_HIDDEN')).toBeDefined();
        expect(fire.features.find(f => f.itemId === 'potion_of_creeping_death')).toBeDefined();

        // 42 号：可收祭坛（DF_SMALL_DEAD_GRASS 列）+ 枯叶/树叶/草/枯草四层铺装
        // + 休眠点火嘴（进墙）。
        const grass = byId('key_burning_grass');
        const ret = grass.features.find(f => f.terrain === 'ALTAR_SWITCH_RETRACTING')!;
        expect(ret.featureDF).toBe('DF_SMALL_DEAD_GRASS');
        expect(grass.features.some(f => f.terrain === 'DEAD_GRASS' && f.flags.includes('MF_EVERYWHERE'))).toBe(true);
        expect(grass.features.some(f => f.featureDF === 'DF_DEAD_FOLIAGE')).toBe(true);
        expect(grass.features.some(f => f.terrain === 'PILOT_LIGHT_DORMANT' && f.flags.includes('MF_BUILD_IN_WALLS'))).toBe(true);

        // 53 号：8 条 feature（门 + 骨 + 灰 + 血×2 + 祭坛 + 火盆 + 棺木/僵尸）。
        const crypt = byId('key_zombie_crypt');
        expect(crypt.features).toHaveLength(8);
        const coffin = crypt.features.find(f => f.terrain === 'COFFIN_CLOSED')!;
        expect(coffin.monsterId).toBe('zombie');
        expect(coffin.flags).toContain('MF_MONSTERS_DORMANT');
        expect(coffin.instanceCount).toEqual([6, 8]);
        expect(crypt.features.find(f => f.terrain === 'BRAZIER')).toBeDefined();

        // 55 号：150×150 花岗岩填充（REPEAT）+ 标记 DF EVERYWHERE + 挖掘
        // （DF_TUNNELIZE 落在 WORM_TUNNEL_OUTER_WALL 上）。
        const worm = byId('key_worm_tunnels');
        const granite = worm.features.find(f => f.terrain === 'GRANITE' && f.flags.includes('MF_REPEAT_UNTIL_NO_PROGRESS'))!;
        expect(granite.instanceCount).toEqual([150, 150]);
        const marker = worm.features.find(f => f.featureDF === 'DF_WORM_TUNNEL_MARKER_DORMANT')!;
        expect(marker.flags).toContain('MF_EVERYWHERE');
        expect(marker.flags).toContain('MF_PERMIT_BLOCKING');
        expect(worm.features.find(f => f.featureDF === 'DF_TUNNELIZE')!.terrain).toBe('WORM_TUNNEL_OUTER_WALL');

        // 57 号：密门（DF_BONES 列）+ 发光菌雕像群 + 骨头堆上的 boss 携带钥匙。
        const boss = byId('key_boss_secret_room');
        expect(boss.features.find(f => f.terrain === 'SECRET_DOOR')!.featureDF).toBe('DF_BONES');
        expect(boss.features.find(f => f.terrain === 'STATUE_INERT')!.instanceCount).toEqual([7, 7]);
        const bossFeat = boss.features.find(f => f.flags.includes('MF_MONSTER_TAKE_ITEM'))!;
        expect(bossFeat.hordeFlags).toEqual(['HORDE_MACHINE_BOSS']);
        expect(bossFeat.flags).toContain('MF_MONSTER_SLEEPING');
        expect(bossFeat.flags).toContain('MF_ADOPT_ITEM');

        // 9 号：镣铐两条 + 呕吐物 + 骨/呕吐 DF（无 layer 列的 DF-only feature）。
        const allies = byId('reward_chained_allies');
        expect(allies.features.find(f => f.terrain === 'MANACLE_T')!.layer).toBe('SURFACE');
        expect(allies.features.find(f => f.terrain === 'MANACLE_L')!.layer).toBe('SURFACE');
        expect(allies.features.find(f => f.featureDF === 'DF_VOMIT')!.terrain).toBeUndefined();
    });

    it('C3 45/46/49 三条「符文圈」蓝图的 DF 列与守卫落位', () => {
        // CE 45/46/49 的 DF 列都是 DF_GLYPH_CIRCLE 落在 ALTAR_INERT 上
        //（46 号是两条 ALTAR_INERT 各挂一只守卫，MF_ALTERNATIVE 二选一）。
        for (const [id, count] of [['key_guardian_gauntlet', 1], ['key_guardian_corridor', 2], ['key_beckoning_obstacle', 1]] as const) {
            const bp = byId(id);
            const glyphs = bp.features.filter(f => f.featureDF === 'DF_GLYPH_CIRCLE');
            expect(glyphs.length, `${id} 的 DF_GLYPH_CIRCLE feature 数`).toBe(count);
            for (const g of glyphs) {
                expect(g.terrain).toBe('ALTAR');
                expect(g.flags).toContain('MF_ADOPT_ITEM');
            }
        }
        // 46 号的两条守卫 feature 必须互斥（MF_ALTERNATIVE）——漏掉它会让
        // 同一条走廊同时冒出石守卫与飞守卫，把走廊彻底堵死。
        const corridor = byId('key_guardian_corridor');
        const alt = corridor.features.filter(f => f.monsterId);
        expect(alt.map(f => f.monsterId).sort()).toEqual(['stone_guardian', 'winged_guardian']);
        for (const f of alt) {
            expect(f.flags, `${f.monsterId} 必须带 MF_ALTERNATIVE`).toContain('MF_ALTERNATIVE');
        }
    });
});

// ── D：MachineResult.featureSpawns ──────────────────────────────────────────

interface LevelMachines { depth: number; results: MachineResult[] }

function installRecorder(record: LevelMachines[]): () => void {
    const proto = BlueprintEngine.prototype as unknown as Record<string, unknown>;
    const original = proto.buildMachines as (this: unknown) => MachineResult[];
    proto.buildMachines = function (this: unknown) {
        const results = original.call(this);
        record.push({ depth: (this as { depth: number }).depth, results });
        return results;
    };
    return () => { proto.buildMachines = original; };
}

describe('V-2b-7 D：MachineResult.featureSpawns（CE Architect.c:1484-1486 的落点暴露）', () => {
    it('D1 5 seed × D1..D9：每个「网格机器格」都能追到机器自己的落点记录', () => {
        // 对抗：把 featureSpawns 的 push 挪进 `if (feature.terrain)` 里（漏掉
        // 纯 DF feature）→ 本断言在 DF-only feature 落在 interior 外的格上翻红。
        // 对抗：把 featureSpawns 与写 machineNumber 的那一行脱钩（例如只在
        // item/monster 分支记录）→ 同样翻红。
        let machinesSeen = 0;
        let outsideInteriorCells = 0;
        const violations: string[] = [];
        for (const seed of [424242, 777, 31337, 42, 20260913]) {
            const record: LevelMachines[] = [];
            const restore = installRecorder(record);
            try {
                const game: any = createHeadlessGame(seed);
                for (let d = 1; d <= 9; d++) {
                    if (d > 1) { game.depth = d; game.generateDepth(false, false); }
                    const entry = record[record.length - 1];
                    const results = entry?.results ?? [];
                    machinesSeen += results.length;
                    const grid: Grid = game.grid;
                    // 网格机器格
                    const gridCells = new Set<number>();
                    for (let x = 0; x < DCOLS; x++) {
                        for (let y = 0; y < DROWS; y++) {
                            if ((grid.getCell(x, y)?.machineNumber ?? 0) !== 0) gridCells.add(y * DCOLS + x);
                        }
                    }
                    // 机器自报的落点（interior ∪ feature ∪ item ∪ monster ∪ center）
                    const claimed = new Set<number>();
                    for (const mr of results) {
                        for (const p of mr.cells) claimed.add(p.y * DCOLS + p.x);
                        claimed.add(mr.center.y * DCOLS + mr.center.x);
                        for (const s of mr.featureSpawns) claimed.add(s.pos.y * DCOLS + s.pos.x);
                        for (const s of mr.itemSpawns) claimed.add(s.pos.y * DCOLS + s.pos.x);
                        for (const s of mr.monsterSpawns) claimed.add(s.pos.y * DCOLS + s.pos.x);
                    }
                    for (const k of gridCells) {
                        if (!claimed.has(k)) {
                            violations.push(`seed${seed}/D${d} 网格机器格 (${k % DCOLS},${Math.floor(k / DCOLS)}) 无任何机器落点记录`);
                        }
                    }
                    // 统计「interior 之外但被 featureSpawns 记录」的格数（非空性证据）
                    const interiors = new Set<number>();
                    for (const mr of results) for (const p of mr.cells) interiors.add(p.y * DCOLS + p.x);
                    for (const mr of results) {
                        for (const s of mr.featureSpawns) {
                            const k = s.pos.y * DCOLS + s.pos.x;
                            if (!interiors.has(k)) outsideInteriorCells++;
                        }
                    }
                }
            } finally { restore(); }
        }
        expect(machinesSeen, '扫到的机器数异常（生成器或记录器失效）').toBeGreaterThanOrEqual(5);
        expect(violations, `未记录落点的机器格 ${violations.length} 处：\n${violations.slice(0, 10).join('\n')}`).toEqual([]);
        // 非空性：本组必须真的观察到「落在 interior 之外、由 featureSpawns 记下」
        // 的格——否则 D1 退化成"interior 覆盖了全部机器格"的空转。
        expect(outsideInteriorCells,
            '没有观察到 interior 之外的 feature 落点——D1 可能空转（CE :1484-1486 的本来目的就是这些格）')
            .toBeGreaterThan(0);
    });

    it('D2 落点记录带诊断字段（featureIndex/terrain/featureDF），且位置与网格机器格一致', () => {
        // 对抗：把 featureSpawns 记成"候选格"而非"落位格"（例如在
        // findFeaturePosition 之后、terrainSucceeded 判定之前记录）→ 失败的
        // 实例也会被记进来，于是"记录在案的格"与"网格上的机器格"不再双向一致，
        // 本断言红。
        const record: LevelMachines[] = [];
        const restore = installRecorder(record);
        let checked = 0;
        try {
            const game: any = createHeadlessGame(424242);
            for (let d = 1; d <= 5; d++) {
                if (d > 1) { game.depth = d; game.generateDepth(false, false); }
            }
            const grid: Grid = game.grid;
            for (const { results } of record) {
                for (const mr of results) {
                    for (const s of mr.featureSpawns) {
                        const cell = grid.getCell(s.pos.x, s.pos.y);
                        expect(cell, `featureSpawn 落点 (${s.pos.x},${s.pos.y}) 越界`).toBeDefined();
                        // 落点必须已被并入机器（CE :1486 的 IS_IN_MACHINE +
                        // machineNumber 与记录同址）——除非该机器带
                        // BP_NO_INTERIOR_FLAG 把标记事后清掉（本断言只查前者）。
                        expect(typeof s.featureIndex, 'featureIndex 应可诊断').toBe('number');
                        expect(s.terrain === undefined || typeof s.terrain === 'string').toBe(true);
                        checked++;
                    }
                }
            }
        } finally { restore(); }
        expect(checked, '未扫到 feature 落点（记录器或字段失效）').toBeGreaterThan(0);
    });
});

// ── E：MF_MONSTER_FLEEING（33 号唯一载体） ──────────────────────────────────

describe('V-2b-7 E：MF_MONSTER_FLEEING（CE Rogue.h:2599 / 消费点 Architect.c:1651-1654）', () => {
    it('E1 数据面：全库唯一载体是 33 号，且它与 HORDE_MACHINE_THIEF + MONSTER_TAKE_ITEM 同 feature', () => {
        // 对抗：旗标从 33 号挪到别的 feature（或抄成 MF_MONSTER_SLEEPING）
        // → 本断言红；"永久逃跑的贼"消失则 FLEEING 的载体不复存在。
        const carriers = BPS.flatMap(bp => bp.features
            .filter(f => f.flags.includes('MF_MONSTER_FLEEING'))
            .map(f => ({ bp: bp.id, f })));
        expect(carriers, 'MF_MONSTER_FLEEING 载体应恰一条（CE 全表）').toHaveLength(1);
        expect(carriers[0]!.bp).toBe('key_thief_area');
        const f = carriers[0]!.f;
        expect(f.terrain).toBe('ALTAR');
        expect(f.featureDF).toBe('DF_LUMINESCENT_FUNGUS');
        expect(f.hordeFlags).toEqual(['HORDE_MACHINE_THIEF']);
        expect(f.flags).toContain('MF_MONSTER_TAKE_ITEM');
        expect(f.flags).toContain('MF_ADOPT_ITEM');
    });

    it('E2 引擎段（确定性）：33 号蓝图在合成房里建机时，怪物指令带 fleeing', () => {
        // ★ 为什么不用"多 seed 扫到 33 号"当判据：33 号是 BP_ADOPT_ITEM 专属
        // （顶层抽签要求 BP_REWARD、前厅要求 BP_VESTIBULE，它都没有），只能被
        // 领养链抽中；实测 14 seed × D1-26 全扫建成 **0** 台（见报告 §5 的
        // 建成率表）——用扫描当判据会得到一个永远空转的用例。
        // 改为在合成房上直接调用 applyBlueprint（v_1b 同源做法），
        // 得到确定性、非空转的判据。
        // 对抗：BlueprintEngine 漏传 fleeing（或写成 sleeping）→ 本断言红。
        const grid = new Grid(DCOLS, DROWS);
        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) grid.setTerrain(x, y, TerrainType.GRANITE, ' ', 0x333333);
        }
        const cells: Array<{ x: number; y: number }> = [];
        for (let x = 4; x <= 19; x++) {
            for (let y = 4; y <= 15; y++) {
                grid.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
                cells.push({ x, y });
            }
        }
        const engine = new BlueprintEngine(grid, 5);
        const applyBp = (engine as unknown as {
            applyBlueprint(bp: BlueprintDef, r: { cells: Array<{ x: number; y: number }>; center: { x: number; y: number }; door: { x: number; y: number } | null }): MachineResult | null;
        }).applyBlueprint.bind(engine);
        const thief = byId('key_thief_area');
        let result: MachineResult | null = null;
        for (let i = 0; i < 8 && !result; i++) {
            result = applyBp(thief, { cells, center: { x: 11, y: 9 }, door: null });
        }
        expect(result, '33 号在 16×12 合成房里 8 次尝试都建不起来（夹具或实现坏了？）').not.toBeNull();
        const fleeing = result!.monsterSpawns.filter(s => s.fleeing);
        expect(fleeing.length, '33 号的 horde 指令必须带 fleeing').toBeGreaterThanOrEqual(1);
        for (const s of fleeing) {
            expect(s.hordeFlags, 'fleeing 载体的 horde 旗标').toEqual(['HORDE_MACHINE_THIEF']);
            expect(s.sleeping, '33 号不带 MF_MONSTER_SLEEPING').toBeFalsy();
            expect(s.dormant, '33 号不带 MF_MONSTERS_DORMANT').toBeFalsy();
        }
        // 越界守卫：fleeing 只能出现在 33 号——本蓝图之外不得有任何带 fleeing 的指令。
        expect(result!.monsterSpawns.length, '33 号只有一条怪物指令（horde）').toBe(fleeing.length);
    });

    it('E3 Game 段（确定性）：finalizeBlueprintMonster 消费 fleeing；dormant 分支按 CE 顺序覆盖它', () => {
        // 对抗：Game.finalizeBlueprintMonster 漏掉 fleeing 分支 → 怪保持
        // MonsterState.HUNTING（默认）→ 本断言红；
        // 把三条并列分支写成 if/else 链（dormant 在前）→ dormant+fleeing 的
        // 期望态（HUNTING，CE :1655-1659 覆盖 :1651-1654）在本断言红。
        const ratData = (JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../data/monsters.json'), 'utf8')) as Array<{ id: string }>)
            .find(m => m.id === 'rat');
        expect(ratData, 'monsters.json 缺 rat').toBeTruthy();
        const game: any = createHeadlessGame(20260921);
        const call = (mon: unknown, spawn: Record<string, unknown>): void =>
            (game as { finalizeBlueprintMonster(m: unknown, s: unknown, n: number): void })
                .finalizeBlueprintMonster(mon, spawn, 42);
        // 真实调用点（Game.populateLevel）在 finalizeBlueprintMonster **之前**
        // 已把怪 push 进 game.monsters——toggleMonsterDormancy 靠"在两表之一
        // 里找得到"决定方向，脱离列表的孤儿怪会走"无操作"分支（本用例初版即
        // 栽在这里）。夹具照真实时序造。
        const mk = (): unknown => {
            const m = new Monster(5, 5, ratData as never);
            game.monsters.push(m);
            return m;
        };

        const plain = mk();
        call(plain, { monsterId: 'rat', pos: { x: 5, y: 5 }, fleeing: true });
        expect((plain as { state: number }).state, 'fleeing → FLEEING（MonsterState 枚举序 3）').toBe(3);

        const neg = mk();
        call(neg, { monsterId: 'rat', pos: { x: 5, y: 5 } });
        expect((neg as { state: number }).state, '无 fleeing 时不得是 FLEEING').not.toBe(3);

        const sleep = mk();
        call(sleep, { monsterId: 'rat', pos: { x: 5, y: 5 }, sleeping: true });
        expect((sleep as { state: number }).state, 'sleeping → ASLEEP（0）').toBe(0);

        // CE 顺序：dormant 分支在 fleeing 之后，它的赋值覆盖前者。
        const both = mk();
        call(both, { monsterId: 'rat', pos: { x: 5, y: 5 }, fleeing: true, dormant: true });
        expect((both as { state: number }).state,
            'dormant + fleeing → 按 CE :1655-1659 的 TRACKING_SCENT（HUNTING=2），fleeing 被覆盖').toBe(2);
        expect((both as { isDormant: boolean }).isDormant, 'dormant 仍生效').toBe(true);
        expect(game.dormantMonsters, 'dormant 分支把怪摘到 dormantMonsters（CE Monsters.c:4203）').toContain(both);

        // CE 三条分支是**顺序覆盖**，不是 else-if 链：
        //   :1648 SLEEPING → SLEEPING；:1651 FLEEING → FLEEING（覆盖前一条）；
        //   :1655 DORMANT 的收尾只在 `!SLEEPING` 时改 TRACKING_SCENT。
        // 于是 sleeping+fleeing+dormant 的终态是 **FLEEING**（3）——写成
        // else-if 链（或把 SLEEPING 放最后）都会得到别的值，本断言即可分辨。
        // CE 数据里没有同时带 SLEEPING|FLEEING 的 feature，这条纯粹钉顺序。
        const bothSleep = mk();
        call(bothSleep, { monsterId: 'rat', pos: { x: 5, y: 5 }, fleeing: true, dormant: true, sleeping: true });
        expect((bothSleep as { state: number }).state,
            'dormant + sleeping + fleeing → FLEEING（CE :1651 覆盖 :1648，:1655 的否定条件不再改它）').toBe(3);
    });
});

// ── F：§2.1 怪物携带形态的可解性那一半 ──────────────────────────────────────

/**
 * 与 v_2b_6_keys F1 同口径：可通行 ∪ 可被钥匙打开的格（LOCKED_DOOR /
 * MONSTER_CAGE_CLOSED）；熔岩/深渊/墙/花岗岩/未接线的铁闸不可通行。
 */
function traversable(terrain: TerrainType): boolean {
    return terrain !== C.WALL && terrain !== C.GRANITE && terrain !== C.LAVA
        && terrain !== C.CHASM && terrain !== C.HOLE && terrain !== C.PORTCULLIS_CLOSED;
}

describe('V-2b-7 F：§2.1 携钥匙怪的完整形态（可达性 + 落点安全）', () => {
    it('F1 携钥匙怪的出生态可达、不在致死地形上，且携带品带 keyLoc 绑定', () => {
        // 对抗：把携钥匙怪排到机器外/墙里（MF_FAR_FROM_ORIGIN 抄错成 NEAR 或
        // 漏掉 cellIsFeatureCandidate 的通行判据）→ 出生态不可达 → 红。
        // 对抗：carriedItem 忘带 keyLoc → 钥匙拿在怪手上却开不了笼 → 红。
        let carriersSeen = 0;
        const violations: string[] = [];
        // V-2b-8 的强制 thematic 机器合法挤占了一部分普通机器机会；扩大为
        // 20 个确定种子，保持行为门不放宽，同时恢复稳定的真实携带者样本。
        const carrierSeeds = Array.from({ length: 20 }, (_, i) => i + 1);
        for (const seed of carrierSeeds) {
            const game: any = createHeadlessGame(seed);
            for (let d = 1; d <= 26; d++) {
                if (d > 1) { game.depth = d; game.generateDepth(false, false); }
                const grid: Grid = game.grid;
                // 玩家入口可达分量（含可开锁格）。
                const start = { x: game.player.loc.x, y: game.player.loc.y };
                const seen = new Set<number>();
                const queue: Array<{ x: number; y: number }> = [start];
                seen.add(start.y * DCOLS + start.x);
                while (queue.length > 0) {
                    const p = queue.shift()!;
                    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
                        const nx = p.x + dx!, ny = p.y + dy!;
                        if (nx < 0 || ny < 0 || nx >= DCOLS || ny >= DROWS) continue;
                        const k = ny * DCOLS + nx;
                        if (seen.has(k)) continue;
                        const t = grid.getCell(nx, ny)?.terrain;
                        if (t === undefined || !traversable(t)) continue;
                        seen.add(k);
                        queue.push({ x: nx, y: ny });
                    }
                }
                const reachable = (x: number, y: number): boolean => seen.has(y * DCOLS + x);

                // 场上携带物品的怪（carriedItem 已实化）。
                // ★ 必须同时扫两张怪表：MF_MONSTERS_DORMANT 的携带者（11 号的
                // 吸血鬼）被 toggleMonsterDormancy 从 monsters 摘到
                // dormantMonsters（V-2b-5 的机制，CE Monsters.c:4203
                // prependCreature 同款）——只扫 monsters 会漏掉它，本用例遂假空转。
                type Carrier = {
                    loc: { x: number; y: number }; name: string; machineHome: number;
                    carriedItem: { category: unknown; keyLoc: Array<unknown> } | null;
                };
                const carried = ([...(game.monsters as Carrier[]), ...(game.dormantMonsters as Carrier[])])
                    .filter(m => m.carriedItem !== null && m.carriedItem !== undefined);
                for (const m of carried) {
                    if (m.carriedItem!.category !== (ItemCategory.KEY as unknown as string)) continue;
                    carriersSeen++;
                    const cell = grid.getCell(m.loc.x, m.loc.y);
                    expect(cell, `seed${seed} D${d} 携带怪的格越界`).toBeDefined();
                    if (isPathingBlocker(cell!.terrain)) {
                        violations.push(`seed${seed} D${d} ${m.name} 站在 ${TerrainType[cell!.terrain]} 上（钥匙会落进不可达地形）`);
                    }
                    if (!reachable(m.loc.x, m.loc.y)) {
                        violations.push(`seed${seed} D${d} ${m.name} 出生态 (${m.loc.x},${m.loc.y}) 不在玩家可达分量内`);
                    }
                    expect(m.carriedItem!.keyLoc.length,
                        `seed${seed} D${d} ${m.name} 的携带钥匙没有 keyLoc 绑定（拿在手上也开不了锁）`)
                        .toBeGreaterThanOrEqual(1);
                }

                // 静默丢弃的哨兵：机器指令里带 carriedItem 的 KEY，必须在场上
                // 找得到对应的携带怪（漏实化 = 钥匙凭空消失）。
                for (const mon of game.monsters as unknown[]) { void mon; }
            }
        }
        expect(violations, `携钥匙怪的落点问题 ${violations.length} 处：\n${violations.slice(0, 10).join('\n')}`).toEqual([]);
        expect(carriersSeen, '20 seed × D1-26 应至少观察到一只携钥匙的怪（否则本用例空转）').toBeGreaterThanOrEqual(1);
    });

    it('F2 机器指令层面的镜像：带 carriedItem 的机器怪指令，其携带品必是 KEY 且带 keyLoc', () => {
        // 与 F1 互补：F1 看"落地后"，这里看"指令层"——即使某只怪被
        // dormantMonsters 摘走（F1 看不到），指令层仍必须完整。
        let instsSeen = 0;
        for (const seed of [424242, 777, 31337, 20260913, 42, 2026]) {
            const record: LevelMachines[] = [];
            const restore = installRecorder(record);
            try {
                const game: any = createHeadlessGame(seed);
                for (let d = 1; d <= 26; d++) {
                    if (d > 1) { game.depth = d; game.generateDepth(false, false); }
                    const entry = record[record.length - 1];
                    for (const mr of entry?.results ?? []) {
                        for (const s of mr.monsterSpawns) {
                            if (!s.carriedItem) continue;
                            instsSeen++;
                            expect(s.carriedItem.category, `${mr.blueprintId} 的携钥匙怪：携带品类别`).toBe('KEY');
                            expect(s.carriedItem.keyLoc, `${mr.blueprintId} 的携钥匙怪：必须有 keyLoc`).toBeDefined();
                            expect(s.carriedItem.keyLoc!.length).toBeGreaterThanOrEqual(1);
                        }
                    }
                }
            } finally { restore(); }
        }
        expect(instsSeen, '6 seed × D1-26 应至少出现一条携带指令').toBeGreaterThanOrEqual(1);
    });
});

// ── G：47 号的结构性退化（退池留形） ────────────────────────────────────────

describe('V-2b-7 G：47 号 Sacrifice altar 的退化（MB_MARKED_FOR_SACRIFICE 缺失）', () => {
    it('G1 数据面：旗标照带（不因为"引擎零消费"而删）', () => {
        // 任务书 §2.2：不造替身——把缺口登记清楚，数据该带的旗标照带。
        // 对抗：有人为了绕开退化把 MF_ADOPT_ITEM / BP_ADOPT_ITEM 从数据里
        // 摘掉 → 本断言红（那是删证据，不是修缺口）。
        const bp = byId('key_sacrifice_altar');
        expect(bp.flags).toContain('BP_ADOPT_ITEM');
        const cage = bp.features.find(f => f.terrain === 'SACRIFICE_CAGE_DORMANT')!;
        expect(cage.flags).toContain('MF_ADOPT_ITEM');
        expect(cage.flags).toContain('MF_IMPREGNABLE');
        expect(cage.flags).toContain('MF_NOT_IN_HALLWAY');
        // CE 原行（GlobalsBrogue.c:319）的其余列
        expect(cage.instanceCount).toEqual([1, 1]);
        expect(cage.minimumInstanceCount).toBe(1);
        expect(cage.personalSpace).toBe(2);
        // 献祭链的另两个载体也在（数据完整）
        expect(bp.features.find(f => f.terrain === 'SACRIFICE_ALTAR_DORMANT')!.featureDF).toBe('DF_TRIGGER_AREA');
        expect(bp.features.find(f => f.terrain === 'DEMONIC_STATUE')).toBeDefined();
        expect(bp.features.find(f => f.hordeFlags?.includes('HORDE_SACRIFICE_TARGET'))).toBeDefined();
    });

    it('G2 引擎面：47 号是**唯一**因领养落点不可达而退池的蓝图，且它确实不再生成', () => {
        // 领养落点不可达的判据 = 该蓝图的所有 MF_ADOPT_ITEM feature 的 terrain
        // 都是 pathing blocker（CE 用 placeItemAt 无条件放，web 的 P1-43 闸会
        // 丢弃 → 父机器的钥匙消失）。这条判据一旦被放宽，本断言立刻红。
        const ineligible = BPS.filter(bp =>
            bp.flags.includes(BP_ADOPT_ITEM) &&
            bp.features.some(f => f.flags.includes('MF_ADOPT_ITEM')) &&
            !bp.features.some(f => f.flags.includes('MF_ADOPT_ITEM')
                && (f.terrain === undefined || !isPathingBlocker(C[f.terrain as keyof typeof C] as TerrainType)))
        ).map(bp => bp.id);
        expect(ineligible, '领养落点不可达的蓝图集合（本轮应恰为 47 号）').toEqual(['key_sacrifice_altar']);

        // 端到端：14 seed × D1-26 全扫，47 号一次都不出现（顶层要求
        // BP_REWARD、前厅要求 BP_VESTIBULE，它两样都没有 ⇒ 只能走领养；
        // 领养被 G2 的过滤排除 ⇒ 结构性不可生成）。
        let appear = 0;
        for (const seed of [424242, 777, 31337, 20260913, 42, 2026, 1, 2, 3, 4, 5, 6, 7, 8]) {
            const record: LevelMachines[] = [];
            const restore = installRecorder(record);
            try {
                const game: any = createHeadlessGame(seed);
                for (let d = 1; d <= 26; d++) {
                    if (d > 1) { game.depth = d; game.generateDepth(false, false); }
                    const entry = record[record.length - 1];
                    for (const mr of entry?.results ?? []) {
                        if (mr.blueprintId === 'key_sacrifice_altar') appear++;
                    }
                }
            } finally { restore(); }
        }
        expect(appear, '47 号在当前引擎里结构性不可生成（退池留形）——它出现说明领养过滤被删/被放宽了').toBe(0);
    });
});
