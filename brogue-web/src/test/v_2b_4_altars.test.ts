/**
 * src/test/v_2b_4_altars.test.ts — V-2b-4 祭坛族轮。
 *
 * 覆盖三块交付：
 *   1. **拆除** web 自创的祭坛组子系统（取物塌陷 / MF_ALTAR_GROUP /
 *      Cell.altarGroupId / Architect.altars 死数组）——D 组是拆除的
 *      静态 + 行为留痕，不是"确认性"测试：任何一处残留读者都会翻红。
 *   2. **落地** CE 七条蓝图（1/2/6/7/15/26/28 号）所需的 7 地形 + 8 DF 条目
 *      ——A/B/C 组逐字段照抄 CE 原行（对抗：抄错任一位即红）。
 *   3. **15 号护符来源双轨（任务书 §4 必答）**——E 组给出实测数据与结论，
 *      F 组用一个单变量差分实验把"frequency=0 的蓝图永不被抽中"钉死。
 *
 * 反向验证（改坏 → 真实失败输出 → 还原）见 ai_docs/reports/v-2b-4.report.md §7。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DCOLS, DROWS, DRAW_PRIORITY, DungeonLayer, Grid, TERRAIN_HOME_LAYER, TerrainType } from '../engine/Map/Grid';
import {
    TERRAIN_FLAGS,
    T_OBSTRUCTS_EVERYTHING,
    T_OBSTRUCTS_GAS,
    T_OBSTRUCTS_ITEMS,
    T_OBSTRUCTS_PASSABILITY,
    T_OBSTRUCTS_SURFACE_EFFECTS,
    TM_IS_WIRED,
    TM_LIST_IN_SIDEBAR,
    TM_PROMOTES_ON_ITEM_PICKUP,
    TM_PROMOTES_WITHOUT_KEY,
    TM_STAND_IN_TILE,
    TM_SWAP_ENCHANTS_ACTIVATION,
    TM_VANISHES_UPON_PROMOTION,
    TM_VISUALLY_DISTINCT,
} from '../engine/Map/TerrainCatalog';
import { LightKind } from '../engine/Map/LightCatalog';
import {
    DF,
    DF_MISSING_TILES,
    DFF_ACTIVATE_DORMANT_MONSTER,
    DFF_BLOCKED_BY_OTHER_LAYERS,
    DFF_EVACUATE_CREATURES_FIRST,
    DFF_RESURRECT_ALLY,
    DFF_SUPERPRIORITY,
    DUNGEON_FEATURE_CATALOG,
} from '../engine/Map/DungeonFeatureCatalog';
import {
    BlueprintEngine,
    BP_ADOPT_ITEM,
    BP_REWARD,
    blueprintQualifies,
    resetRewardRoomsGenerated,
} from '../engine/Generator/BlueprintEngine';
import { rng } from '../engine/Random';
import { ItemCategory } from '../engine/Items/Item';
import { createHeadlessGame } from './harness';
import type { Game } from '../engine/Core/Game';
import type { BlueprintDef, FeatureDef } from '../engine/Generator/BlueprintEngine';
import blueprintData from '../data/blueprints.json';

const C = TerrainType;
const L = DungeonLayer;

const byId = (id: string): BlueprintDef =>
    (blueprintData as BlueprintDef[]).find(b => b.id === id)!;

// ════════════════════════════════════════════════════════════════════════════
// A. 七条新地形的属性表 ≡ CE tileCatalog 原行
// ════════════════════════════════════════════════════════════════════════════

describe('V-2b-4 A：七条祭坛族地形的 CE 逐字段钉死', () => {
    it('A1 ALTAR_CAGE_OPEN（Globals.c:364）：开底铁笼祭坛——无 STAND_IN_TILE、有 PROMOTES_WITHOUT_KEY', () => {
        const e = TERRAIN_FLAGS[C.ALTAR_CAGE_OPEN]!;
        expect(e.flags, 'flags 只有 T_OBSTRUCTS_SURFACE_EFFECTS').toBe(T_OBSTRUCTS_SURFACE_EFFECTS);
        // CE 第 12 列逐位：VANISHES | IS_WIRED | PROMOTES_WITHOUT_KEY |
        // LIST_IN_SIDEBAR | VISUALLY_DISTINCT。**没有 STAND_IN_TILE**——
        // 相邻的 ALTAR_CAGE_CLOSED（:365）才有（它是可站的笼体）。
        // 把两者抄混（多/少 STAND_IN_TILE）的实现在此翻红。
        expect(e.mechFlags).toBe(
            TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED | TM_PROMOTES_WITHOUT_KEY |
            TM_LIST_IN_SIDEBAR | TM_VISUALLY_DISTINCT
        );
        expect(e.mechFlags & TM_STAND_IN_TILE, 'ALTAR_CAGE_OPEN 不得带 STAND_IN_TILE').toBe(0);
        expect(e.mechFlags & TM_PROMOTES_WITHOUT_KEY, '取物触发位（无需钥匙）').not.toBe(0);
        expect(e.chanceToIgnite).toBe(0);
        expect(e.fireType).toBe('');
        expect(e.discoverType).toBe('');
        expect(e.promoteType, '取物后笼子落下').toBe('DF_ITEM_CAGE_CLOSE');
        expect(e.promoteChance).toBe(0);
        expect(e.glowLight).toBe(LightKind.CANDLE_LIGHT);
        expect(e.webOnly).toBe(false);
        expect(DRAW_PRIORITY[C.ALTAR_CAGE_OPEN]).toBe(17);
        expect(TERRAIN_HOME_LAYER[C.ALTAR_CAGE_OPEN]).toBe(L.DUNGEON);
    });

    it('A2 ALTAR_CAGE_RETRACTABLE（Globals.c:368）：可收铁笼——挡通行 + PROMOTES_ON_STEP 不在（笼子自己不动）', () => {
        const e = TERRAIN_FLAGS[C.ALTAR_CAGE_RETRACTABLE]!;
        expect(e.flags).toBe(T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_SURFACE_EFFECTS);
        expect(e.mechFlags).toBe(
            TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED |
            TM_LIST_IN_SIDEBAR | TM_VISUALLY_DISTINCT
        );
        expect(e.mechFlags & TM_PROMOTES_WITHOUT_KEY, '可收铁笼不是"取物晋升"型').toBe(0);
        expect(e.promoteType, '踏板触发 → 笼子升起').toBe('DF_CAGE_DISAPPEARS');
        expect(e.promoteChance).toBe(0);
        expect(e.glowLight).toBe(LightKind.CANDLE_LIGHT);
        expect(e.webOnly).toBe(false);
        expect(DRAW_PRIORITY[C.ALTAR_CAGE_RETRACTABLE]).toBe(17);
        expect(TERRAIN_HOME_LAYER[C.ALTAR_CAGE_RETRACTABLE]).toBe(L.DUNGEON);
    });

    it('A3 COMMUTATION_ALTAR（Globals.c:532）：置换祭坛——独有的 SWAP_ENCHANTS_ACTIVATION、无火无显形', () => {
        const e = TERRAIN_FLAGS[C.COMMUTATION_ALTAR]!;
        expect(e.flags).toBe(T_OBSTRUCTS_SURFACE_EFFECTS);
        expect(e.mechFlags).toBe(
            TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED | TM_SWAP_ENCHANTS_ACTIVATION |
            TM_LIST_IN_SIDEBAR | TM_VISUALLY_DISTINCT
        );
        expect(e.mechFlags & TM_SWAP_ENCHANTS_ACTIVATION, '置换位是本 tile 的独有语义').not.toBe(0);
        // CE 该行 fire/discover/promote 三列里只有 promoteType 非零。
        expect(e.fireType, 'CE :532 fireType 列 = 0').toBe('');
        expect(e.discoverType, 'CE :532 discoverType 列 = 0').toBe('');
        expect(e.promoteType).toBe('DF_ALTAR_COMMUTE');
        expect(e.glowLight, 'CE :532 glowLight = NO_LIGHT（置换祭坛不发光）').toBe(LightKind.NO_LIGHT);
        expect(e.webOnly).toBe(false);
        expect(DRAW_PRIORITY[C.COMMUTATION_ALTAR]).toBe(17);
        expect(TERRAIN_HOME_LAYER[C.COMMUTATION_ALTAR]).toBe(L.DUNGEON);
    });

    it('A4 RESURRECTION_ALTAR（Globals.c:538）：复活祭坛——无 VANISHES_UPON_PROMOTION（晋升后仍可再用）', () => {
        const e = TERRAIN_FLAGS[C.RESURRECTION_ALTAR]!;
        expect(e.flags).toBe(T_OBSTRUCTS_SURFACE_EFFECTS);
        // CE 该行 mechFlags = IS_WIRED | LIST_IN_SIDEBAR | VISUALLY_DISTINCT，
        // **没有 VANISHES_UPON_PROMOTION**（与置换祭坛/铁笼祭坛的差别）。
        expect(e.mechFlags).toBe(TM_IS_WIRED | TM_LIST_IN_SIDEBAR | TM_VISUALLY_DISTINCT);
        expect(e.mechFlags & TM_VANISHES_UPON_PROMOTION, '复活祭坛不消失').toBe(0);
        expect(e.fireType).toBe('');
        expect(e.discoverType).toBe('');
        expect(e.promoteType).toBe('DF_ALTAR_RESURRECT');
        expect(e.glowLight).toBe(LightKind.CANDLE_LIGHT);
        expect(e.webOnly).toBe(false);
        expect(DRAW_PRIORITY[C.RESURRECTION_ALTAR]).toBe(17);
        expect(TERRAIN_HOME_LAYER[C.RESURRECTION_ALTAR]).toBe(L.DUNGEON);
    });

    it('A5 AMULET_SWITCH（Globals.c:529）：护符触发板——G_FLOOR 伪装（零旗标 + prio 95）', () => {
        const e = TERRAIN_FLAGS[C.AMULET_SWITCH]!;
        expect(e.flags, 'CE :529 flags 列 = 0（伪装成普通地面）').toBe(0);
        expect(e.mechFlags).toBe(
            TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED | TM_PROMOTES_ON_ITEM_PICKUP
        );
        expect(e.mechFlags & TM_PROMOTES_ON_ITEM_PICKUP, '护符被拾取即晋升').not.toBe(0);
        expect(e.chanceToIgnite).toBe(0);
        expect(e.fireType).toBe('DF_PLAIN_FIRE');
        expect(e.discoverType).toBe('');
        expect(e.promoteType, 'CE :529 第三链字段为 0——按 DF_PROMOTES_ON_ITEM_PICKUP 由 mechFlags 驱动').toBe('');
        expect(e.glowLight).toBe(LightKind.NO_LIGHT);
        expect(e.webOnly).toBe(false);
        expect(DRAW_PRIORITY[C.AMULET_SWITCH], 'G_FLOOR 伪装：与 FLOOR 同档 95').toBe(95);
        expect(TERRAIN_HOME_LAYER[C.AMULET_SWITCH]).toBe(L.DUNGEON);
    });

    it('A6 STATUE_INSTACRACK（Globals.c:354）：即刻开裂雕像——promoteType 震裂、promoteChance 0（不是 STATUE_CRACKING 的 3500）【V-2b-5 反转】', () => {
        // ★ 本条断言已按 V-2b-5 的 CE 复核反转（B-1 反转范本）★
        // 原断言（V-2b-4）："discoverType=DF_STATUE_SHATTER、promoteType 空"。
        // 前提有误：按 floorTileType 字段序（Rogue.h:1905-1921）逐位对齐
        // CE :354 `… 0, 0, DF_PLAIN_FIRE,0,DF_STATUE_SHATTER, 0, NO_LIGHT …`
        // —— fireType=DF_PLAIN_FIRE、discoverType=0、promoteType=
        // DF_STATUE_SHATTER。原抄法把 discover/promote 两列对调，而 web 唯一
        // 的晋升驱动 promoteTile 只读 promoteType → "护符被取走 → 全机通电 →
        // 雕像震裂 → 唤醒 Warden of Yendor"整条链在该 tile 上断掉。
        // V-2b-5 已更正 TerrainCatalog 数据；本断言改为钉 CE 原值。
        const e = TERRAIN_FLAGS[C.STATUE_INSTACRACK]!;
        expect(e.flags).toBe(
            T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_ITEMS | T_OBSTRUCTS_GAS |
            T_OBSTRUCTS_SURFACE_EFFECTS
        );
        expect(e.mechFlags).toBe(TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED);
        expect(e.chanceToIgnite).toBe(0);
        expect(e.fireType).toBe('DF_PLAIN_FIRE');
        expect(e.discoverType, 'CE :354 discoverType 列 = 0（原断言把 promote 列抄进了这里）').toBe('');
        expect(e.promoteType, 'CE :354 promoteType = DF_STATUE_SHATTER（通电晋升链的落点）').toBe('DF_STATUE_SHATTER');
        expect(e.promoteChance, 'CE :354 是 0；:353 的 STATUE_CRACKING 才是 3500').toBe(0);
        expect(e.glowLight).toBe(LightKind.NO_LIGHT);
        expect(e.webOnly).toBe(false);
        expect(DRAW_PRIORITY[C.STATUE_INSTACRACK], '雕像墙档').toBe(0);
        expect(TERRAIN_HOME_LAYER[C.STATUE_INSTACRACK]).toBe(L.DUNGEON);
    });

    it('A7 TORCH_WALL（Globals.c:337）：墙装火把——常亮装饰（无 IS_WIRED、无晋升链）+ TORCH_LIGHT 真发光', () => {
        const e = TERRAIN_FLAGS[C.TORCH_WALL]!;
        expect(e.flags).toBe(T_OBSTRUCTS_EVERYTHING);
        expect(e.mechFlags).toBe(TM_STAND_IN_TILE);
        // 与 PILOT_LIGHT_DORMANT（:342）的差别就在这里：后者是 wired 点火嘴。
        expect(e.mechFlags & TM_IS_WIRED, 'TORCH_WALL 不在通电网络里').toBe(0);
        expect(e.mechFlags & TM_VANISHES_UPON_PROMOTION, 'TORCH_WALL 不晋升').toBe(0);
        expect(e.fireType).toBe('DF_PLAIN_FIRE');
        expect(e.promoteType).toBe('');
        expect(e.promoteChance).toBe(0);
        expect(e.glowLight, 'CE :337 原列 TORCH_LIGHT——本轮真实点亮').toBe(LightKind.TORCH_LIGHT);
        expect(e.webOnly).toBe(false);
        expect(DRAW_PRIORITY[C.TORCH_WALL], 'G_TORCH 墙档').toBe(0);
        expect(TERRAIN_HOME_LAYER[C.TORCH_WALL]).toBe(L.DUNGEON);
    });

    it('A8 越界守卫：FUNGUS_FOREST 仍走别名（不新增枚举成员），别名语义缺口登记在案', () => {
        // V-2b-2b 落的别名：CE FUNGUS_FOREST（Globals.c:475）→ web FOLIAGE。
        // 本轮复核的结论是"够用但非逐位等价"：flags/mechFlags 一致
        // （T_OBSTRUCTS_VISION|T_IS_FLAMMABLE + STAND_IN_TILE|VANISHES|PROMOTES_ON_STEP），
        // 差在 promoteType（CE DF_TRAMPLED_FUNGUS_FOREST vs web
        // DF_TRAMPLED_FOLIAGE）与 glowLight（CE FUNGUS_FOREST_LIGHT vs web 0）。
        // 本轮授权清单不含 LightCatalog，且 promote 链的**行为**归专门轮，
        // 故维持别名、缺口登记（报告 §2）。本断言防"顺手新增一个同义枚举成员"。
        expect((TerrainType as unknown as Record<string, unknown>)['FUNGUS_FOREST'],
            'FUNGUS_FOREST 不得有独立枚举成员（别名口径）').toBeUndefined();
        // 蓝图的 terrain 字符串仍写作 FUNGUS_FOREST，经 TERRAIN_MAP 落到 FOLIAGE；
        // 若有人把它改成 FOLIAGE（"看起来等价"的改法），下面这条会红。
        expect(byId('reward_statuary').features[1]!.terrain, '蓝图数据保留 CE 名字，由别名搬运').toBe('FUNGUS_FOREST');
        const web = TERRAIN_FLAGS[C.FOLIAGE]!;
        expect(web.flags, '别名两侧的 flags 一致（这是别名成立的理由）')
            .toBe(TERRAIN_FLAGS[C.FOLIAGE]!.flags);
        expect(web.promoteType, '别名承载的是 FOLIAGE 的晋升目标（缺口，非等价）').toBe('DF_TRAMPLED_FOLIAGE');
    });
});

// ════════════════════════════════════════════════════════════════════════════
// B. 八条新 DF 目录条目 ≡ CE dungeonFeatureCatalog 原行
// ════════════════════════════════════════════════════════════════════════════

describe('V-2b-4 B：八条祭坛族 DF 目录条目的 CE 逐字段钉死', () => {
    it('B1 DF_LUMINESCENT_FUNGUS（:608）：3 号蓝图 DF 列的起点，tile 缺口登记', () => {
        const e = DUNGEON_FEATURE_CATALOG[DF.DF_LUMINESCENT_FUNGUS]!;
        expect(e.ceLine).toBe(608);
        expect(e.ceTile).toBe('LUMINESCENT_FUNGUS');
        expect(e.tile, 'web 无 LUMINESCENT_FUNGUS 地形').toBeNull();
        expect(e.layer).toBe(L.SURFACE);
        expect(e.startProbability).toBe(60);
        expect(e.probabilityDecrement).toBe(8);
        expect(e.flags).toBe(DFF_BLOCKED_BY_OTHER_LAYERS);
        expect(e.subsequentDF).toBeNull();
        expect(DF_MISSING_TILES).toContain(DF.DF_LUMINESCENT_FUNGUS);
    });

    it('B2 DF_ITEM_CAGE_CLOSE（:722）：笼子落下——无 tile 时的 EVACUATE 旗标与文案', () => {
        const e = DUNGEON_FEATURE_CATALOG[DF.DF_ITEM_CAGE_CLOSE]!;
        expect(e.ceLine).toBe(722);
        expect(e.ceTile).toBe('ALTAR_CAGE_CLOSED');
        expect(e.tile).toBeNull();
        expect(e.layer).toBe(L.DUNGEON);
        expect(e.startProbability).toBe(0);
        expect(e.probabilityDecrement).toBe(0);
        expect(e.flags).toBe(DFF_EVACUATE_CREATURES_FIRST);
        expect(e.description).toBe('the cages lower to cover the altars.');
        expect(e.lightFlare).toBe('GENERIC_FLASH_LIGHT');
        expect(DF_MISSING_TILES).toContain(DF.DF_ITEM_CAGE_CLOSE);
    });

    it('B3 DF_ALTAR_COMMUTE（:793）与 DF_ALTAR_RESURRECT（:798）：两条惰性祭坛 + 各自的文案/光效', () => {
        const cm = DUNGEON_FEATURE_CATALOG[DF.DF_ALTAR_COMMUTE]!;
        expect(cm.ceLine).toBe(793);
        expect(cm.ceTile).toBe('COMMUTATION_ALTAR_INERT');
        expect(cm.tile).toBeNull();
        expect(cm.layer).toBe(L.DUNGEON);
        expect(cm.flags, '置换完成条无 DFF 旗标').toBe(0);
        expect(cm.description).toBe('the items on the two altars flash with a brilliant light!');
        expect(cm.lightFlare).toBe('SCROLL_ENCHANTMENT_LIGHT');
        expect(DF_MISSING_TILES).toContain(DF.DF_ALTAR_COMMUTE);

        const rs = DUNGEON_FEATURE_CATALOG[DF.DF_ALTAR_RESURRECT]!;
        expect(rs.ceLine).toBe(798);
        expect(rs.ceTile).toBe('RESURRECTION_ALTAR_INERT');
        expect(rs.tile).toBeNull();
        expect(rs.layer).toBe(L.DUNGEON);
        expect(rs.flags, 'DFF_RESURRECT_ALLY（Rogue.h:1820）').toBe(DFF_RESURRECT_ALLY);
        expect(rs.description).toBe('An old friend emerges from a bloom of sacred light!');
        expect(rs.lightFlare).toBe('EMPOWERMENT_LIGHT');
        expect(DF_MISSING_TILES).toContain(DF.DF_ALTAR_RESURRECT);
    });

    it('B4 DF_MAGIC_PIPING（:794）：6 号蓝图 DF 列的起点，90/60 扩散', () => {
        const e = DUNGEON_FEATURE_CATALOG[DF.DF_MAGIC_PIPING]!;
        expect(e.ceLine).toBe(794);
        expect(e.ceTile).toBe('PIPE_GLOWING');
        expect(e.tile).toBeNull();
        expect(e.layer).toBe(L.SURFACE);
        expect(e.startProbability).toBe(90);
        expect(e.probabilityDecrement).toBe(60);
        expect(e.flags).toBe(0);
        expect(e.subsequentDF).toBeNull();
        expect(DF_MISSING_TILES).toContain(DF.DF_MAGIC_PIPING);
    });

    it('B5 DF_MACHINE_FLOOR_TRIGGER_REPEATING（:799）：**唯一落 LIQUID 层**且带 propTerrain=CARPET 的条目', () => {
        const e = DUNGEON_FEATURE_CATALOG[DF.DF_MACHINE_FLOOR_TRIGGER_REPEATING]!;
        expect(e.ceLine).toBe(799);
        expect(e.ceTile).toBe('MACHINE_TRIGGER_FLOOR_REPEATING');
        expect(e.tile).toBeNull();
        expect(e.layer, 'CE 该行的 layer 列是 LIQUID（可重复触发的机器地板）').toBe(L.LIQUID);
        expect(e.startProbability).toBe(300);
        expect(e.probabilityDecrement).toBe(100);
        expect(e.flags).toBe(DFF_SUPERPRIORITY);
        expect(e.cePropagationTerrain, 'propTerrain 列 = CARPET').toBe('CARPET');
        expect(e.propagationTerrain).toBe(C.CARPET);
        expect(DF_MISSING_TILES).toContain(DF.DF_MACHINE_FLOOR_TRIGGER_REPEATING);
    });

    it('B6 DF_CAGE_DISAPPEARS（:812）：八条里**唯一带完整 tile** 的——tile = ALTAR_INERT = web TerrainType.ALTAR', () => {
        const e = DUNGEON_FEATURE_CATALOG[DF.DF_CAGE_DISAPPEARS]!;
        expect(e.ceLine).toBe(812);
        expect(e.ceTile).toBe('ALTAR_INERT');
        expect(e.tile, 'web ALTAR 就是 CE ALTAR_INERT').toBe(C.ALTAR);
        expect(e.layer).toBe(L.DUNGEON);
        expect(e.flags).toBe(0);
        expect(e.description).toBe('the cage lifts off of the altar.');
        expect(e.lightFlare).toBe('GENERIC_FLASH_LIGHT');
        // 越界守卫：能落地的条目**不得**混进"缺 tile 登记"名单
        //（登记名单守卫的原意是"防接线顺手删登记"，反向同样要防）。
        expect(DF_MISSING_TILES, 'DF_CAGE_DISAPPEARS 有 tile，不入缺 tile 名单').not.toContain(DF.DF_CAGE_DISAPPEARS);
    });

    it('B7 DF_STATUE_SHATTER（:873）：链尾 DF_RUBBLE 已在目录（无悬空引用）+ 唤醒沉睡怪旗标', () => {
        const e = DUNGEON_FEATURE_CATALOG[DF.DF_STATUE_SHATTER]!;
        expect(e.ceLine).toBe(873);
        expect(e.ceTile).toBe('RUBBLE');
        expect(e.tile).toBeNull();
        expect(e.layer).toBe(L.SURFACE);
        expect(e.startProbability).toBe(120);
        expect(e.probabilityDecrement).toBe(100);
        expect(e.flags).toBe(DFF_ACTIVATE_DORMANT_MONSTER);
        expect(e.subsequentDF, '链尾 = DF_RUBBLE（V-2b-3 已入目录）').toBe(DF.DF_RUBBLE);
        expect(DUNGEON_FEATURE_CATALOG[DF.DF_RUBBLE], '链尾必须已在目录——悬空即红').toBeDefined();
        expect(e.description).toBe('the statue shatters!');
        expect(e.flashColor).toBe('darkGray');
        expect(e.effectRadius).toBe(3);
        expect(DF_MISSING_TILES).toContain(DF.DF_STATUE_SHATTER);
    });

    it('B8 DF 枚举 id ≡ CE Rogue.h 枚举行（脚本对位 + 三条既有锚点校准）', () => {
        expect(DF.DF_LUMINESCENT_FUNGUS).toBe(3);          // Rogue.h:1472
        expect(DF.DF_ITEM_CAGE_CLOSE).toBe(85);            // :1575
        expect(DF.DF_ALTAR_COMMUTE).toBe(140);             // :1641
        expect(DF.DF_MAGIC_PIPING).toBe(141);              // :1642
        expect(DF.DF_ALTAR_RESURRECT).toBe(143);           // :1646
        expect(DF.DF_MACHINE_FLOOR_TRIGGER_REPEATING).toBe(144); // :1647
        expect(DF.DF_CAGE_DISAPPEARS).toBe(151);           // :1660
        expect(DF.DF_STATUE_SHATTER).toBe(188);            // :1721
        // 校准锚点（V-2b-3 已钉过的三条，同一解析器）：id ≠ 行号-1469 时即红。
        expect(DF.DF_CRYSTAL_WALL).toBe(2);
        expect(DF.DF_GRASS).toBe(4);
        expect(DF.DF_MEDIUM_HOLE).toBe(152);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// C. 七条蓝图 ≡ CE blueprintCatalog_Brogue 原表
// ════════════════════════════════════════════════════════════════════════════

const ALL_REWARD_FLAGS = [
    'BP_ROOM', 'BP_REWARD', 'BP_PURGE_INTERIOR',
    'BP_SURROUND_WITH_WALLS', 'BP_OPEN_INTERIOR', 'BP_IMPREGNABLE',
];

describe('V-2b-4 C：七条生产蓝图 ≡ CE GlobalsBrogue.c 原表', () => {
    it('C1 1 号 Mixed item library（:183-190）：6 feature，三条 ALTAR_CAGE_OPEN 各带物品类别', () => {
        const bp = byId('reward_mixed_library');
        expect(bp.name).toBe('Mixed item library -- can check one item out at a time');
        expect(bp.depthRange).toEqual([1, 12]);            // {1, 12}
        expect(bp.roomSize).toEqual([30, 50]);
        expect(bp.frequency).toBe(30);
        expect(bp.category).toBe('reward');
        expect(bp.flags).toEqual(ALL_REWARD_FLAGS);
        expect(bp.features).toHaveLength(6);               // featureCt = 6
        const f = (i: number): FeatureDef => bp.features[i]!;
        expect(f(0)).toMatchObject({ terrain: 'CARPET', layer: 'DUNGEON', instanceCount: [0, 0], minimumInstanceCount: 0 });
        expect(f(0)!.flags).toEqual(['MF_EVERYWHERE']);
        expect(f(0)!.personalSpace, 'CE reqSpace 列 = 0（省略即不占格）').toBeUndefined();
        expect(f(1)!.flags).toEqual(['MF_BUILD_AT_ORIGIN', 'MF_PERMIT_BLOCKING', 'MF_BUILD_VESTIBULE']);
        expect(f(1)!.instanceCount).toEqual([1, 1]);
        expect(f(1)!.minimumInstanceCount).toBe(1);
        expect(f(1)!.personalSpace).toBe(2);
        expect(f(2)).toMatchObject({ terrain: 'ALTAR_CAGE_OPEN', itemCategory: 'WAND', instanceCount: [1, 1], minimumInstanceCount: 1 });
        expect(f(2)!.flags).toEqual(['MF_GENERATE_ITEM', 'MF_TREAT_AS_BLOCKING', 'MF_IMPREGNABLE']);
        expect(f(3)).toMatchObject({ terrain: 'ALTAR_CAGE_OPEN', itemCategory: 'WEAPON|ARMOR|WAND', instanceCount: [3, 3], minimumInstanceCount: 3 });
        expect(f(3)!.flags).toEqual(['MF_GENERATE_ITEM', 'MF_NO_THROWING_WEAPONS', 'MF_TREAT_AS_BLOCKING', 'MF_IMPREGNABLE']);
        expect(f(4)).toMatchObject({ terrain: 'ALTAR_CAGE_OPEN', itemCategory: 'STAFF|RING|CHARM', instanceCount: [2, 3], minimumInstanceCount: 2 });
        expect(f(5)).toMatchObject({ terrain: 'STATUE_INERT', instanceCount: [2, 3], minimumInstanceCount: 0 });
        expect(f(5)!.flags).toEqual(['MF_TREAT_AS_BLOCKING', 'MF_BUILD_IN_WALLS', 'MF_IMPREGNABLE']);
        // CE 1 号三条 ALTAR_CAGE_OPEN 的特征位：只有第 3 条带
        // MF_NO_THROWING_WEAPONS（WAND 那条不带）——抄成"三条一样"的实现在此翻红。
        expect(bp.features.filter(x => x.terrain === 'ALTAR_CAGE_OPEN')).toHaveLength(3);
        expect(f(2)!.flags.includes('MF_NO_THROWING_WEAPONS')).toBe(false);
    });

    it('C2 2 号 Single category library（:191-197）：5 feature + ALTERNATIVE 组', () => {
        const bp = byId('reward_single_category_library');
        expect(bp.depthRange).toEqual([1, 12]);
        expect(bp.roomSize).toEqual([30, 50]);
        expect(bp.frequency).toBe(15);
        expect(bp.category).toBe('reward');
        expect(bp.flags).toEqual(ALL_REWARD_FLAGS);
        expect(bp.features).toHaveLength(5);
        const f = (i: number): FeatureDef => bp.features[i]!;
        expect(f(0)!.terrain).toBe('CARPET');
        expect(f(1)!.flags).toEqual(['MF_BUILD_AT_ORIGIN', 'MF_PERMIT_BLOCKING', 'MF_BUILD_VESTIBULE']);
        expect(f(2)).toMatchObject({ terrain: 'ALTAR_CAGE_OPEN', itemCategory: 'RING', instanceCount: [3, 4], minimumInstanceCount: 3 });
        expect(f(3)).toMatchObject({ terrain: 'ALTAR_CAGE_OPEN', itemCategory: 'STAFF', instanceCount: [4, 5], minimumInstanceCount: 4 });
        // 与 1 号的差异就在这一位：2 号两条笼中物是 MF_ALTERNATIVE 组
        //（CE :195/:196），1 号的不是。少抄/多抄此位即红。
        for (const i of [2, 3]) {
            expect(f(i)!.flags).toEqual(['MF_GENERATE_ITEM', 'MF_TREAT_AS_BLOCKING', 'MF_ALTERNATIVE', 'MF_IMPREGNABLE']);
        }
        expect(f(4)!.terrain).toBe('STATUE_INERT');
    });

    it('C3 6 号 Commutation altars（:221-226）——原地接管 web 自创的 reward_commutation', () => {
        const bp = byId('reward_commutation');
        expect(bp.name, '名称已换成 CE 原文').toBe('Commutation altars');
        expect(bp.depthRange).toEqual([13, 26]);           // {13, AMULET_LEVEL}
        expect(bp.roomSize).toEqual([10, 30]);
        expect(bp.frequency, 'CE :222 freq = 50（旧 web 值 4 已废弃）').toBe(50);
        expect(bp.category).toBe('reward');
        expect(bp.flags).toEqual(ALL_REWARD_FLAGS);
        expect(bp.features).toHaveLength(4);
        const f = (i: number): FeatureDef => bp.features[i]!;
        expect(f(0)!.terrain).toBe('CARPET');
        expect(f(1)).toMatchObject({ terrain: 'STATUE_INERT', instanceCount: [1, 3] });
        expect(f(2)).toMatchObject({ terrain: 'COMMUTATION_ALTAR', instanceCount: [2, 2], minimumInstanceCount: 2, personalSpace: 2 });
        expect(f(2)!.flags, 'CE :225 该 feature 只带 TREAT_AS_BLOCKING').toEqual(['MF_TREAT_AS_BLOCKING']);
        expect(f(2)!.itemCategory, '置换祭坛 feature 无物品列').toBeUndefined();
        expect(f(3)!.flags).toEqual(['MF_BUILD_AT_ORIGIN', 'MF_PERMIT_BLOCKING', 'MF_BUILD_VESTIBULE']);
        // 拆除守卫：自创玩法依赖的两个符号都不许回流到这条数据里。
        const raw = JSON.stringify(bp);
        expect(raw.includes('MF_ALTAR_GROUP'), 'reward_commutation 不得再带自创的 MF_ALTAR_GROUP').toBe(false);
        expect(bp.features.some(x => x.terrain === 'ALTAR'), '旧数据的 ALTAR（= ALTAR_INERT）+ 分组玩法已替换为 COMMUTATION_ALTAR').toBe(false);
    });

    it('C4 7 号 Resurrection altar（:227-232）：FAR_FROM_ORIGIN 的复活祭坛', () => {
        const bp = byId('reward_resurrection_altar');
        expect(bp.name).toBe('Resurrection altar');
        expect(bp.depthRange).toEqual([13, 26]);
        expect(bp.roomSize).toEqual([10, 30]);
        expect(bp.frequency).toBe(30);
        expect(bp.flags).toEqual(ALL_REWARD_FLAGS);
        expect(bp.features).toHaveLength(4);
        const f = (i: number): FeatureDef => bp.features[i]!;
        expect(f(1)!.terrain).toBe('STATUE_INERT');
        expect(f(2)).toMatchObject({ terrain: 'RESURRECTION_ALTAR', instanceCount: [1, 1], minimumInstanceCount: 1 });
        expect(f(2)!.flags).toEqual(['MF_TREAT_AS_BLOCKING', 'MF_FAR_FROM_ORIGIN']);
        expect(f(3)!.flags).toEqual(['MF_BUILD_AT_ORIGIN', 'MF_PERMIT_BLOCKING', 'MF_BUILD_VESTIBULE']);
    });

    it('C5 15 号 Statuary（:289-294）——护符房：freq 0、非 BP_ROOM、AMULET_SWITCH + 即刻开裂雕像 + 墙火把', () => {
        const bp = byId('reward_statuary');
        expect(bp.name).toBe('Statuary -- key on an altar, area full of statues; take key to cause statues to burst and reveal monsters');
        expect(bp.depthRange).toEqual([10, 26]);           // {10, AMULET_LEVEL}
        expect(bp.roomSize).toEqual([35, 40]);
        expect(bp.frequency, 'CE :290 freq = 0——它只由 D26 的强制机器建成，不参与配额抽签').toBe(0);
        expect(bp.category).toBe('reward');
        // CE :290 的 flags 只有这两位（没有 BP_ROOM！）——它是"区域机器"。
        expect(bp.flags).toEqual(['BP_PURGE_INTERIOR', 'BP_OPEN_INTERIOR']);
        expect(bp.features).toHaveLength(4);
        const f = (i: number): FeatureDef => bp.features[i]!;
        expect(f(0)).toMatchObject({ terrain: 'AMULET_SWITCH', layer: 'DUNGEON', itemCategory: 'AMULET', instanceCount: [1, 1], minimumInstanceCount: 1 });
        expect(f(0)!.flags).toEqual(['MF_GENERATE_ITEM', 'MF_NEAR_ORIGIN', 'MF_TREAT_AS_BLOCKING', 'MF_NOT_IN_HALLWAY']);
        expect(f(1)).toMatchObject({ terrain: 'FUNGUS_FOREST', layer: 'SURFACE', instanceCount: [2, 3] });
        expect(f(2)).toMatchObject({ terrain: 'STATUE_INSTACRACK', monsterId: 'Warden_of_Yendor', instanceCount: [1, 1], minimumInstanceCount: 1, personalSpace: 1 });
        expect(f(2)!.flags).toEqual([
            'MF_TREAT_AS_BLOCKING', 'MF_NOT_IN_HALLWAY', 'MF_MONSTERS_DORMANT',
            'MF_FAR_FROM_ORIGIN', 'MF_IN_PASSABLE_VIEW_OF_ORIGIN', 'MF_IMPREGNABLE',
        ]);
        expect(f(3)).toMatchObject({ terrain: 'TORCH_WALL', layer: 'DUNGEON', instanceCount: [3, 4], minimumInstanceCount: 0, personalSpace: 1 });
        expect(f(3)!.flags).toEqual(['MF_BUILD_IN_WALLS']);
        // 护符 feature 必须在（它是 CE 唯一的护符来源）。
        expect(bp.features.some(x => x.itemCategory === 'AMULET' && x.flags.includes('MF_GENERATE_ITEM'))).toBe(true);
    });

    it('C6 26 号 Nested item library（:347-355）：7 feature、key_guard（BP_ADOPT_ITEM 经 category 承载）', () => {
        const bp = byId('key_nested_library');
        expect(bp.depthRange).toEqual([1, 26]);
        expect(bp.roomSize).toEqual([30, 50]);
        expect(bp.frequency).toBe(35);
        expect(bp.category, 'CE :348 flags 含 BP_ADOPT_ITEM ⇒ 领养机器').toBe('key_guard');
        expect(bp.flags).toEqual(['BP_ROOM', 'BP_PURGE_INTERIOR', 'BP_SURROUND_WITH_WALLS', 'BP_OPEN_INTERIOR', 'BP_IMPREGNABLE']);
        // BP_ADOPT_ITEM 不在 flags 数组里，由 CATEGORY_TO_BP_FLAGS 注入——
        // 资格过滤必须仍认它（与既有 key_secret_room 同款编码，报告 §2 说明）。
        for (const d of [1, 13, 26]) {
            expect(blueprintQualifies(bp, d, [BP_ADOPT_ITEM]), `D${d} 应可作领养子机器`).toBe(true);
            expect(blueprintQualifies(bp, d, [BP_REWARD]), `D${d} 不应被顶层奖励抽签选中`).toBe(false);
        }
        expect(bp.features).toHaveLength(7);
        const f = (i: number): FeatureDef => bp.features[i]!;
        expect(f(0)!.terrain).toBe('CARPET');
        expect(f(1)).toMatchObject({ terrain: 'WALL', instanceCount: [0, 0], minimumInstanceCount: 0 });
        expect(f(1)!.flags).toEqual(['MF_TREAT_AS_BLOCKING', 'MF_BUILD_IN_WALLS', 'MF_IMPREGNABLE', 'MF_EVERYWHERE']);
        expect(f(2)!.flags).toEqual(['MF_BUILD_AT_ORIGIN', 'MF_PERMIT_BLOCKING', 'MF_BUILD_VESTIBULE']);
        expect(f(3)).toMatchObject({ terrain: 'ALTAR_CAGE_OPEN', itemCategory: 'WEAPON|ARMOR|WAND', instanceCount: [1, 2], minimumInstanceCount: 1 });
        expect(f(4)).toMatchObject({ terrain: 'ALTAR_CAGE_OPEN', itemCategory: 'STAFF|RING|CHARM', instanceCount: [1, 2], minimumInstanceCount: 1 });
        // 第 6 条是"一次性钥匙"的领养位（MF_ADOPT_ITEM，无 itemCategory）。
        expect(f(5)).toMatchObject({ terrain: 'ALTAR_CAGE_OPEN', instanceCount: [1, 1], minimumInstanceCount: 1 });
        expect(f(5)!.itemCategory).toBeUndefined();
        expect(f(5)!.flags).toEqual(['MF_ADOPT_ITEM', 'MF_TREAT_AS_BLOCKING', 'MF_IMPREGNABLE']);
        expect(f(6)).toMatchObject({ terrain: 'STATUE_INERT', instanceCount: [1, 3] });
        expect(bp.features.filter(x => x.terrain === 'ALTAR_CAGE_OPEN')).toHaveLength(3);
    });

    it('C7 28 号 Throwing tutorial 笼子收回版（:360-363）：ALTAR_CAGE_RETRACTABLE + 压板在 LIQUID 层', () => {
        const bp = byId('key_throwing_tutorial_cage');
        expect(bp.name).toBe('Throwing tutorial -- toss an item onto the pressure plate to retract the cage and reveal the key');
        expect(bp.depthRange).toEqual([1, 4]);
        expect(bp.roomSize).toEqual([70, 80]);
        expect(bp.frequency).toBe(8);
        expect(bp.category, 'CE :361 flags = (BP_ADOPT_ITEM) ⇒ 领养机器').toBe('key_guard');
        expect(bp.flags, 'CE 该行除 BP_ADOPT_ITEM 外无旗标（非 BP_ROOM、非 BP_VESTIBULE）').toEqual([]);
        expect(bp.features).toHaveLength(2);
        const f = (i: number): FeatureDef => bp.features[i]!;
        expect(f(0)).toMatchObject({ terrain: 'ALTAR_CAGE_RETRACTABLE', layer: 'DUNGEON', instanceCount: [1, 1], minimumInstanceCount: 1, personalSpace: 3 });
        expect(f(0)!.flags).toEqual(['MF_ADOPT_ITEM', 'MF_IMPREGNABLE', 'MF_NOT_IN_HALLWAY']);
        expect(f(1)).toMatchObject({ terrain: 'MACHINE_PRESSURE_PLATE', layer: 'LIQUID', instanceCount: [1, 1], minimumInstanceCount: 1, personalSpace: 1 });
        expect(f(1)!.flags).toEqual(['MF_TREAT_AS_BLOCKING', 'MF_NOT_IN_HALLWAY']);
        // 与 22 号（前厅版"retract the portcullis"）不得混淆：那条是
        // PORTCULLIS_CLOSED/WORM_TUNNEL_OUTER_WALL + BP_VESTIBULE。
        const ce22 = byId('vestibule_throwing_tutorial');
        expect(ce22.category).toBe('vestibule');
        expect(ce22.flags).toEqual(['BP_VESTIBULE']);
        expect(ce22.features.some(x => x.terrain === 'ALTAR_CAGE_RETRACTABLE')).toBe(false);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// D. 自创祭坛组子系统的拆除（静态扫描 + 行为留痕）
// ════════════════════════════════════════════════════════════════════════════

/** 复刻 c_4b F1 的小型状态机：注释 → 空白；字符串原样保留。 */
function stripComments(src: string): string {
    let out = '';
    let i = 0;
    let mode: 'code' | 'line' | 'block' | 'squote' | 'dquote' | 'template' = 'code';
    while (i < src.length) {
        const c = src[i]!;
        const n = src[i + 1];
        if (mode === 'code') {
            if (c === '/' && n === '/') { mode = 'line'; out += '  '; i += 2; continue; }
            if (c === '/' && n === '*') { mode = 'block'; out += '  '; i += 2; continue; }
            if (c === "'") mode = 'squote';
            else if (c === '"') mode = 'dquote';
            else if (c === '`') mode = 'template';
            out += c; i++; continue;
        }
        if (mode === 'line') {
            if (c === '\n') { mode = 'code'; out += '\n'; } else out += ' ';
            i++; continue;
        }
        if (mode === 'block') {
            if (c === '*' && n === '/') { mode = 'code'; out += '  '; i += 2; continue; }
            out += c === '\n' ? '\n' : ' '; i++; continue;
        }
        // 字符串模式：\ 转义原样跳过
        if (c === '\\') { out += c + (n ?? ''); i += 2; continue; }
        if ((mode === 'squote' && c === "'") || (mode === 'dquote' && c === '"') || (mode === 'template' && c === '`')) {
            mode = 'code';
        }
        out += c; i++;
    }
    return out;
}

function collectProdFiles(dir: string, out: string[] = [], re: RegExp = /\.(ts|tsx|vue)$/): string[] {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) collectProdFiles(p, out, re);
        else if (re.test(name)) out.push(p);
    }
    return out;
}

describe('V-2b-4 D：自创祭坛组子系统已拆除（留痕 + 越界守卫）', () => {
    it('D1 生产代码零 `altarGroupId`（点号读取与解构读取两种形态都扫）——任何残留读者翻红', () => {
        // 漏授权形态⑤（B-4b 立的规矩）：留痕扫描若只看点号形态，可被
        // `const { altarGroupId } = cell` 绕过。这里两种形态都覆盖。
        const srcDir = fileURLToPath(new URL('../', import.meta.url));
        const files = collectProdFiles(srcDir).filter(f => !f.split(sep).includes('test'));
        const dot = /\.altarGroupId\b/;
        const destructure = /\{[^}]*\baltarGroupId\b[^{]*\}\s*=/;
        const offenders: string[] = [];
        for (const f of files) {
            const rel = relative(srcDir, f).split(sep).join('/');
            const code = stripComments(readFileSync(f, 'utf8'));
            code.split('\n').forEach((line, i) => {
                if (dot.test(line) || destructure.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
            });
        }
        expect(offenders, `altarGroupId 仍有生产读者：\n${offenders.join('\n')}`).toEqual([]);
    });

    it('D2 生产代码与数据零 `MF_ALTAR_GROUP`——该旗标是 web 自创（CE Rogue.h 零命中）', () => {
        const srcDir = fileURLToPath(new URL('../', import.meta.url));
        // 代码（剥注释）与**生产数据**（src/data/*.json，原样）都要扫：自创
        // 旗标的第一落点是 blueprints.json 的 feature flags，只扫 .ts 会漏掉它
        //（RV4 反向验证实测：只扫 .ts 时注入 json 不翻红——已修）。
        // 测试树下的 json（含 fixtures/generation_baseline.json 的 note 文案）
        // **不进扫描面**——那些是文档字符串，不是生产数据。
        const files = collectProdFiles(srcDir).filter(f => !f.split(sep).includes('test'))
            .concat(collectProdFiles(join(srcDir, 'data'), [], /\.json$/));
        expect(files.some(f => f.endsWith('blueprints.json')), 'json 数据必须进入扫描面').toBe(true);
        const offenders: string[] = [];
        for (const f of files) {
            const rel = relative(srcDir, f).split(sep).join('/');
            const code = rel.endsWith('.json') ? readFileSync(f, 'utf8') : stripComments(readFileSync(f, 'utf8'));
            code.split('\n').forEach((line, i) => {
                if (line.includes('MF_ALTAR_GROUP')) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
            });
        }
        expect(offenders, `MF_ALTAR_GROUP 仍有残留：\n${offenders.join('\n')}`).toEqual([]);
    });

    it('D3 越界守卫：Architect.altars 死数组已删，但 machines 必须保留（归钥匙轮，本轮不动）', () => {
        const src = stripComments(readFileSync(
            fileURLToPath(new URL('../engine/Generator/Architect.ts', import.meta.url)), 'utf8'));
        expect(/public\s+altars\s*:/.test(src), 'Architect.altars 声明仍在').toBe(false);
        expect(/this\.altars/.test(src), 'Architect.altars 仍有写入点').toBe(false);
        // machines 不在本轮范围：删了它 = 越界（报告 §0 的显式要求）。
        expect(/public\s+machines\s*:/.test(src), 'Architect.machines 被误删——它归钥匙轮').toBe(true);
    });

    it('D4 行为：从祭坛取物只入包，**不再**塌陷同组祭坛（构造两座祭坛做判别）', () => {
        const game = createHeadlessGame(424242);
        const px = game.player.loc.x;
        const py = game.player.loc.y;
        // 玩家右侧一列：FLOOR → 祭坛A → 祭坛B（都在玩家可达的一行上）。
        for (const dx of [1, 2, 3]) {
            game.grid.setTerrain(px + dx, py, C.FLOOR, '.', 0x888888);
        }
        game.grid.setTerrain(px + 1, py, C.ALTAR, 'A', 0xccccff);
        game.grid.setTerrain(px + 2, py, C.ALTAR, 'A', 0xccccff);
        const g = game as unknown as { items: Array<{ loc: { x: number; y: number } }> };
        const spawn = (game as unknown as {
            spawnBlueprintItem: (c: string, id: string | undefined, x: number, y: number, d: number) => unknown;
        }).spawnBlueprintItem.bind(game);
        const beforeLen = g.items.length;
        const i1 = spawn('POTION', undefined, px + 1, py, game.depth);
        const i2 = spawn('POTION', undefined, px + 2, py, game.depth);
        expect(i1, '祭坛A 的物品应构造成功').not.toBeNull();
        expect(i2, '祭坛B 的物品应构造成功').not.toBeNull();
        g.items.push(i1 as { loc: { x: number; y: number } }, i2 as { loc: { x: number; y: number } });
        expect(g.items.length).toBe(beforeLen + 2);

        // 走向祭坛A（上面有物品）→ 取物。
        game.handlePlayerAction('move', { x: 1, y: 0 }, 'system');
        expect(game.player.inventory.items.length, '物品应已入包（取物分支真的跑了）').toBeGreaterThan(0);
        // 祭坛A 上的物品已消失、祭坛B 的物品仍在（无"同组塌陷销毁"）。
        expect(g.items.some(i => i.loc.x === px + 1 && i.loc.y === py), '祭坛A 上物品应已被取走').toBe(false);
        expect(g.items.some(i => i.loc.x === px + 2 && i.loc.y === py), '祭坛B 的物品不该被销毁').toBe(true);
        // 关键判据：祭坛B 的地形**仍是 ALTAR**。旧自创实现会把它改成
        // CHARRED_FLOOR——任何"同组塌陷"的残留实现在此翻红。
        expect(game.grid.getCell(px + 2, py)!.terrain, '同组祭坛不得塌成焦土').toBe(C.ALTAR);

        // 再走一次：此时祭坛A 已空（可走），玩家踩上去——空祭坛分支也必须
        // 不触碰任何别的祭坛（旧实现的塌陷扫描在两条分支里都在）。
        game.handlePlayerAction('move', { x: 1, y: 0 }, 'system');
        expect(game.player.loc.x, '空祭坛可走（CE 字面：取完是可站的祭坛）').toBe(px + 1);
        expect(game.grid.getCell(px + 2, py)!.terrain, '空祭坛分支同样不得塌陷同组').toBe(C.ALTAR);
        expect(g.items.some(i => i.loc.x === px + 2 && i.loc.y === py), '祭坛B 的物品仍在').toBe(true);
    });

    it('D5 i18n：item.altar_collapse 已从主资源移到 legacy 归档（死键门禁不留红）', () => {
        const zh = readFileSync(fileURLToPath(new URL('../locales/zh_CN.json', import.meta.url)), 'utf8');
        const legacy = readFileSync(fileURLToPath(new URL('../locales/zh_CN.legacy.json', import.meta.url)), 'utf8');
        expect(zh.includes('item.altar_collapse'), '主资源不得留死键（p1_30 死键门禁会红）').toBe(false);
        expect(legacy.includes('item.altar_collapse'), '应归档到 legacy（不是删除）').toBe(true);
        // 取物本身的文案必须还在（拆机制 ≠ 拆取物）。
        expect(zh.includes('item.pickup_altar'), '祭坛取物文案不得被连坐删除').toBe(true);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// E. 15 号护符来源双轨（任务书 §4 必答）
// ════════════════════════════════════════════════════════════════════════════

/** 完整生成 D1..D26，返回各蓝图建成台数 + 终点层的护符数。 */
function runFullGame(seed: number): { comp: Map<string, number>; amulets: number } {
    const proto = BlueprintEngine.prototype as unknown as {
        applyBlueprint: (...a: unknown[]) => { blueprintId: string } | null;
    };
    const orig = proto.applyBlueprint;
    const comp = new Map<string, number>();
    proto.applyBlueprint = function (this: unknown, ...a: unknown[]) {
        const r = orig.apply(this, a);
        if (r) comp.set(r.blueprintId, (comp.get(r.blueprintId) ?? 0) + 1);
        return r;
    };
    try {
        const game = createHeadlessGame(seed);
        const g = game as unknown as Omit<Game, 'generateDepth'> & {
            generateDepth(a: boolean, b: boolean): void;
        };
        for (let d = 1; d <= 26; d++) {
            if (d > 1) { game.depth = d; g.generateDepth(false, false); }
        }
        const amulets = game.items.filter(i => i.category === ItemCategory.AMULET).length;
        return { comp, amulets };
    } finally {
        proto.applyBlueprint = orig;
    }
}

describe('V-2b-4 E：15 号护符双轨——实测数据与结论', () => {
    const SEEDS = [70_000, 71_313, 72_626, 73_939, 75_252, 76_565];

    it('E1 实测：`reward_statuary`（15 号）在 6 seed × D1-D26 上建成 **0 台**（frequency=0 的结构性后果）', () => {
        let statuary = 0;
        let otherReward = 0;
        for (const seed of SEEDS) {
            for (const [id, n] of runFullGame(seed).comp) {
                if (id === 'reward_statuary') statuary += n;
                if (id.startsWith('reward_')) otherReward += n;
            }
        }
        expect(statuary, 'CE :290 freq=0 ⇒ 配额抽签永不可能选中它；建成即红').toBe(0);
        // 反真空：同一样本里别的 reward 蓝图确实建成了——抽签在跑，
        // "0 台"不是"整台引擎没动"造成的假绿。
        expect(otherReward, '样本里必须有其它 reward 机器（否则是空转假绿）').toBeGreaterThan(0);
    });

    it('E2 实测：每局护符数恒为 1（noAmulet=0 / multiAmulet=0）——两套来源不可能叠加', () => {
        const hist = new Map<number, number>();
        for (const seed of SEEDS) {
            const n = runFullGame(seed).amulets;
            hist.set(n, (hist.get(n) ?? 0) + 1);
        }
        expect(hist.get(0) ?? 0, '存在无护符的局（致命）').toBe(0);
        expect(hist.get(1) ?? 0, '每局应恰 1 枚护符').toBe(SEEDS.length);
        expect([...hist.keys()].filter(k => k > 1), '出现多枚护符 = 双轨叠加（本轮要排除的故障）').toEqual([]);
    });

    it('E3 直投仍是唯一来源（留痕）：spawnBlueprintItem 无 AMULET 分支 ⇒ 即便 15 号建成也发不出护符', () => {
        const game = createHeadlessGame(777);
        const priv = game as unknown as {
            spawnBlueprintItem: (c: string, id: string | undefined, x: number, y: number, d: number) => unknown;
        };
        const spawn = priv.spawnBlueprintItem.bind(game);
        const x = game.player.loc.x;
        const y = game.player.loc.y;
        // AMULET 是 CE 的合法物品类别（v_1a 的 CE_CATEGORIES 集合含它），
        // 但 web 的 spawnBlueprintItem 目前没有 AMULET 分支。
        // ★ 留痕：给 AMULET 接上生成分支的那一轮，应把本断言翻转为"返回非空"，
        //   并在同轮把 Game.populateLevel 的 D26 直投退位（见报告 §4 的缺口①）。
        expect(spawn('AMULET', undefined, x, y, 26),
            'AMULET 类别尚无生成分支——这正是"直投不能退位"的第二重原因').toBeNull();
        // 越界守卫：CE 别的类别**不能**被连坐（删分支式的"修法"在此翻红）。
        expect(spawn('POTION', undefined, x, y, 26), 'POTION 分支必须仍在').not.toBeNull();
    });

    it('E4 直投守卫：Game.populateLevel 的 D26 护符直投仍存在（未退位）', () => {
        const src = stripComments(readFileSync(
            fileURLToPath(new URL('../engine/Core/Game.ts', import.meta.url)), 'utf8'));
        expect(src.includes("spawnAmulet('amulet_of_yendor'"),
            'D26 直投被删了——在"机器接管"尚未接通前那会让玩家拿不到护符（致命）').toBe(true);
        expect(src.includes('this.depth === 26'), 'D26 门的判据必须仍在').toBe(true);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// F. 抽签规则的单变量差分实验：frequency = 0 的蓝图永不被选中
// ════════════════════════════════════════════════════════════════════════════

/** 走廊 + pocketCount 个 3×3 死 pocket（v_1c buildPocketCorridor 的同源夹具）。 */
function buildPocketCorridor(pocketCount: number): Grid {
    const grid = new Grid(DCOLS, DROWS);
    for (let x = 0; x < DCOLS; x++) {
        for (let y = 0; y < DROWS; y++) grid.setTerrain(x, y, C.GRANITE, ' ', 0x333333);
    }
    for (let x = 4; x <= 55; x++) grid.setTerrain(x, 10, C.FLOOR, '.', 0x888888);
    const centers = [8, 17, 26, 35, 44, 53];
    for (let i = 0; i < pocketCount; i++) {
        const px = centers[i]!;
        for (let x = px - 1; x <= px + 1; x++) {
            for (let y = 6; y <= 8; y++) grid.setTerrain(x, y, C.FLOOR, '.', 0x888888);
        }
        grid.setTerrain(px, 9, C.FLOOR, '.', 0x888888);
    }
    return grid;
}

const probeBp = (id: string, frequency: number): BlueprintDef => ({
    id, name: id, depthRange: [1, 26], roomSize: [8, 9],
    frequency, category: 'reward', flags: [], features: [],
} as BlueprintDef);

function runProbe(pool: BlueprintDef[], seeds: number[]): string[] {
    const built: string[] = [];
    for (const seed of seeds) {
        rng.seedRandomGenerator(seed);
        resetRewardRoomsGenerated();
        const engine = new BlueprintEngine(buildPocketCorridor(4), 10, pool);
        for (const r of engine.buildMachines()) built.push(r.blueprintId);
    }
    return built;
}

describe('V-2b-4 F：抽签规则差分实验（frequency=0 ⇒ 永不入池）', () => {
    const SEEDS = [11, 20260918, 5, 99, 12345, 777];

    it('F1 对照组（两蓝图 frequency 均 100）：探针与阳性都能建成——证明探针本身可建、引擎在跑', () => {
        const built = runProbe([probeBp('v2b4_probe_zero', 100), probeBp('v2b4_probe_pos', 100)], SEEDS);
        expect(built.filter(x => x === 'v2b4_probe_zero').length,
            '探针蓝图必须可建（否则 F2/F3 的"没被选中"无从归因）').toBeGreaterThan(0);
        expect(built.filter(x => x === 'v2b4_probe_pos').length, '阳性蓝图必须可建').toBeGreaterThan(0);
    });

    it('F2 单变量差分（探针 frequency 100 → 0，其余不变）：探针彻底从结果里消失', () => {
        // 顺序 [零, 正]：若实现退化成"直接取 eligible 最后一个"，
        // 这里取到的是"正"、看不出来——所以 F3 再做一个顺序反转。
        const control = runProbe([probeBp('v2b4_probe_zero', 100), probeBp('v2b4_probe_pos', 100)], SEEDS);
        const treated = runProbe([probeBp('v2b4_probe_zero', 0), probeBp('v2b4_probe_pos', 100)], SEEDS);
        expect(control.filter(x => x === 'v2b4_probe_zero').length).toBeGreaterThan(0);
        expect(treated.filter(x => x === 'v2b4_probe_zero').length,
            'frequency=0 的蓝图被选中了——CE chooseBP 的滚动映射被改写？').toBe(0);
        expect(treated.filter(x => x === 'v2b4_probe_pos').length, '阳性仍须建成（反真空）').toBeGreaterThan(0);
    });

    it('F3 顺序反转的差分（零在末位）：仍然选不到——排除"取末位兜底"这一类实现', () => {
        const built = runProbe([probeBp('v2b4_probe_pos', 100), probeBp('v2b4_probe_zero', 0)], SEEDS);
        expect(built.filter(x => x === 'v2b4_probe_zero').length,
            '零频蓝图排在末位时被"末位兜底"选中了').toBe(0);
        expect(built.filter(x => x === 'v2b4_probe_pos').length).toBeGreaterThan(0);
    });

    it('F4 全零池：totalFreq = 0 ⇒ 一台都不建（CE :1047-1055 的 no suitable blueprints 分支）', () => {
        const built = runProbe([probeBp('v2b4_probe_zero', 0), probeBp('v2b4_probe_also_zero', 0)], SEEDS);
        expect(built, '全零池应触发 totalFreq<=0 早退，不做任何建造').toEqual([]);
    });
});
