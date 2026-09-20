/**
 * src/test/c_7_lighting.test.ts — C-7：光照目录 + 矿灯深度衰减
 *
 * CE 出处（BrogueCE-master/src/brogue/，只读）：
 * - lightCatalog 60 条：Globals.c:955-1020；struct lightSource：Rogue.h:1794-1799；
 *   enum lightType：Rogue.h:677-742。
 * - updateMinersLightRadius：Light.c:120-154；深度衰减基础半径：RogueMain.c:666-670
 *   （Brogue 变体 depthAccelerator=1，GlobalsBrogue.c:1019）。
 * - VISIBLE 阈值：Rogue.h:184（>50）；潜行消费：Time.c:798/802；
 *   playerInDarkness：Light.c:283-287；minersLightColor 动态插值：
 *   RogueMain.c:538-544 + IO.c:1529-1540 + Globals.c:120/121。
 *
 * 期望值的来源：本文件所有硬编码数字都由 CE 的 C 代码独立手工执行推导
 * （C 整除逐次 85%、fixpt 立方、整数截断），与被测实现零共享代码——
 * 实现抄错任何一步，这里的字面值就会翻红。
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    LIGHT_CATALOG,
    LightKind,
    CE_DCOLS,
    FP_FACTOR,
    VISIBILITY_THRESHOLD,
    minersLightColorAtDepth,
    minersLightBaseRadiusFixpt,
    updateMinersLightRadius,
} from '../engine/Map/LightCatalog';
import { TERRAIN_FLAGS } from '../engine/Map/TerrainCatalog';
import { Grid, TerrainType, DCOLS, DROWS } from '../engine/Map/Grid';
import { LightMap } from '../engine/Lighting/LightMap';
import { createHeadlessGame } from './harness';
import type { Game } from '../engine/Core/Game';

// ---------------------------------------------------------------------------
// 一、光照目录：结构与 CE 逐值对照
// ---------------------------------------------------------------------------

describe('C-7 光照目录（CE Globals.c:955-1020 逐值）', () => {
    it('恰好 60 条，且 LightKind 枚举成员与下标一一对位（esbuild 剥类型，缺条目运行时才暴露）', () => {
        expect(LIGHT_CATALOG).toHaveLength(60);
        // Rogue.h:677-742 的枚举锚点（首/中/尾 + 任务书点名的关键位）
        expect(LightKind.NO_LIGHT).toBe(0);
        expect(LightKind.MINERS_LIGHT).toBe(1);
        expect(LightKind.BURNING_CREATURE_LIGHT).toBe(2);
        expect(LightKind.TORCH_LIGHT).toBe(33);
        expect(LightKind.LAVA_LIGHT).toBe(34);
        expect(LightKind.SUN_LIGHT).toBe(35);
        expect(LightKind.FUNGUS_LIGHT).toBe(37);
        expect(LightKind.EMBER_LIGHT).toBe(43);
        expect(LightKind.FIRE_LIGHT).toBe(44);
        expect(LightKind.EXPLOSION_LIGHT).toBe(46);
        expect(LightKind.CONFUSION_GAS_LIGHT).toBe(49);
        expect(LightKind.CANDLE_LIGHT).toBe(53);
        expect(LightKind.DESCENT_LIGHT).toBe(58);
        expect(LightKind.DEMONIC_STATUE_LIGHT).toBe(59);
        // 每个枚举成员都能取到目录条目（防"枚举有、目录缺"的错位）
        for (const key of Object.keys(LightKind).filter((k) => isNaN(Number(k)))) {
            const idx = (LightKind as unknown as Record<string, number>)[key]!;
            expect(LIGHT_CATALOG[idx], `LIGHT_CATALOG[${key}] 缺条目`).toBeDefined();
        }
    });

    it('NO_LIGHT 是 CE {0} 原样（含 clumpFactor=0）', () => {
        const e = LIGHT_CATALOG[LightKind.NO_LIGHT]!;
        expect(e.color).toEqual({ red: 0, green: 0, blue: 0, redRand: 0, greenRand: 0, blueRand: 0, rand: 0 });
        expect(e.radius).toEqual({ lowerBound: 0, upperBound: 0, clumpFactor: 0 });
        expect(e.radialFadeToPercent).toBe(0);
        expect(e.passThroughCreatures).toBe(false);
    });

    it('对抗③：矿灯条目 passThroughCreatures = true（Globals.c:958 原列；写成 false 即红）', () => {
        expect(LIGHT_CATALOG[LightKind.MINERS_LIGHT]!.passThroughCreatures).toBe(true);
        // CE 注释原文 "generally no, but miner light does"——其余 true 的是
        // 例外族（imp/telepathy/darkness patch/…），逐条对位：
        expect(LIGHT_CATALOG[LightKind.IMP_LIGHT]!.passThroughCreatures).toBe(true);           // :962
        expect(LIGHT_CATALOG[LightKind.EXPLOSIVE_BLOAT_LIGHT]!.passThroughCreatures).toBe(true);// :975
        expect(LIGHT_CATALOG[LightKind.TELEPATHY_LIGHT]!.passThroughCreatures).toBe(true);      // :977
        expect(LIGHT_CATALOG[LightKind.SUN_LIGHT]!.passThroughCreatures).toBe(true);            // :996
        expect(LIGHT_CATALOG[LightKind.TORCH_LIGHT]!.passThroughCreatures).toBe(false);         // :994
        expect(LIGHT_CATALOG[LightKind.LAVA_LIGHT]!.passThroughCreatures).toBe(false);          // :995
    });

    it('关键地形光条目逐字段等于 CE 原值（含 randomRange 型半径——抄成定值即红）', () => {
        const r = (i: number) => LIGHT_CATALOG[i]!.radius;
        const c = (i: number) => LIGHT_CATALOG[i]!.color;

        // torch :994 {torchLightColor{75,38,15,0,15,7}, {1000,1000,1}, 50, false}
        expect(c(LightKind.TORCH_LIGHT)).toEqual({ red: 75, green: 38, blue: 15, redRand: 0, greenRand: 15, blueRand: 7, rand: 0 });
        expect(r(LightKind.TORCH_LIGHT)).toEqual({ lowerBound: 1000, upperBound: 1000, clumpFactor: 1 });
        expect(LIGHT_CATALOG[LightKind.TORCH_LIGHT]!.radialFadeToPercent).toBe(50);

        // lava :995 {lavaLightColor{47,13,0,10,7,0}, {300,300,1}, 50, false}
        expect(c(LightKind.LAVA_LIGHT)).toEqual({ red: 47, green: 13, blue: 0, redRand: 10, greenRand: 7, blueRand: 0, rand: 0 });
        expect(r(LightKind.LAVA_LIGHT).lowerBound).toBe(300);

        // fire :1005 {lavaLightColor, {500,1000,1}, 0, false}——区间半径
        expect(r(LightKind.FIRE_LIGHT)).toEqual({ lowerBound: 500, upperBound: 1000, clumpFactor: 1 });

        // embers :1004 {lavaLightColor, {200,200,1}, 50, false}
        expect(r(LightKind.EMBER_LIGHT).lowerBound).toBe(200);
        expect(LIGHT_CATALOG[LightKind.EMBER_LIGHT]!.radialFadeToPercent).toBe(50);

        // gas explosion :1007 {explosionColor{10,8,2,0,2,2}, {DCOLS*100,...}, 100, false}
        expect(r(LightKind.EXPLOSION_LIGHT).lowerBound).toBe(CE_DCOLS * 100);
        expect(LIGHT_CATALOG[LightKind.EXPLOSION_LIGHT]!.radialFadeToPercent).toBe(100);

        // confusion gas :1010 {confusionLightColor{10×3+rand6×3}, {300,300,1}, 100, false}
        expect(c(LightKind.CONFUSION_GAS_LIGHT)).toEqual({ red: 10, green: 10, blue: 10, redRand: 10, greenRand: 10, blueRand: 10, rand: 0 });
        expect(LIGHT_CATALOG[LightKind.CONFUSION_GAS_LIGHT]!.radialFadeToPercent).toBe(100);

        // candle :1014 {torchLightColor, {200,400,1}, 0, false}——区间半径
        expect(r(LightKind.CANDLE_LIGHT)).toEqual({ lowerBound: 200, upperBound: 400, clumpFactor: 1 });

        // imp :962 用 GlobalsBase.c:100 的 pink {100,60,66}（非 Globals.c 主表）
        expect(c(LightKind.IMP_LIGHT)).toEqual({ red: 100, green: 60, blue: 66, redRand: 0, greenRand: 0, blueRand: 0, rand: 0 });

        // darkness patch :997 负色（负分量是 CE 黑暗光的机制本体）
        expect(c(LightKind.DARKNESS_PATCH_LIGHT)).toEqual({ red: -10, green: -10, blue: -10, redRand: 0, greenRand: 0, blueRand: 0, rand: 0 });

        // incendiary darts :1008 {15*100, 15*100} = 1500
        expect(r(LightKind.INCENDIARY_DART_LIGHT).lowerBound).toBe(1500);

        // teleport/portal :1009 DCOLS*100
        expect(r(LightKind.PORTAL_ACTIVATE_LIGHT).lowerBound).toBe(6400);
        expect(CE_DCOLS).toBe(64); // 目录数据引用的是 CE 的 64，不是 web 的 79
    });
});

// ---------------------------------------------------------------------------
// 二、TerrainCatalog glowLight 列（对抗⑤数据面：glowLight 没接上→列消失即红）
// ---------------------------------------------------------------------------

describe('C-7 TerrainCatalog.glowLight 列（CE tileCatalog 第 10 列）', () => {
    /** web 全部 43 tile 的 CE glowLight 期望值（逐条核过 CE Globals.c:321-744）。 */
    const EXPECTED_GLOW: Record<TerrainType, number> = {
        [TerrainType.NOTHING]: 0,
        [TerrainType.GRANITE]: 0,
        [TerrainType.FLOOR]: 0,
        [TerrainType.WALL]: 0,
        [TerrainType.DOOR]: 0,
        [TerrainType.OPEN_DOOR]: 0,
        [TerrainType.WATER_SHALLOW]: 0,
        [TerrainType.WATER_DEEP]: 0,
        [TerrainType.CHASM]: 0,
        [TerrainType.LAVA]: LightKind.LAVA_LIGHT,                    // Globals.c:420
        [TerrainType.GRASS]: 0,
        [TerrainType.FOLIAGE]: 0,
        [TerrainType.BOG]: 0,                                        // webOnly，CE 无条目
        [TerrainType.STAIRS_UP]: 0,
        [TerrainType.STAIRS_DOWN]: 0,
        [TerrainType.CHARRED_FLOOR]: 0,                              // webOnly
        [TerrainType.SIGN]: 0,                                       // webOnly（借用 SACRED_GLYPH 的显示位；B-3 起真 SACRED_GLYPH 地形另列）
        [TerrainType.RESET_PLATE]: 0,
        [TerrainType.TRAP]: 0,
        [TerrainType.SECRET_DOOR]: 0,
        [TerrainType.PRESSURE_PLATE]: 0,
        [TerrainType.LOCKED_DOOR]: 0,
        [TerrainType.ALTAR]: LightKind.CANDLE_LIGHT,                 // Globals.c:362 ALTAR_INERT
        [TerrainType.WEB]: 0,
        [TerrainType.BLOOD]: 0,
        [TerrainType.MUD]: 0,
        [TerrainType.CHASM_EDGE]: 0,
        [TerrainType.OBSIDIAN]: 0,
        [TerrainType.BRIDGE]: 0,
        [TerrainType.BRIDGE_EDGE]: 0,
        [TerrainType.INERT_BRIMSTONE]: 0,                            // Globals.c:426 NO_LIGHT
        [TerrainType.PLAIN_FIRE]: LightKind.FIRE_LIGHT,              // Globals.c:492
        [TerrainType.EMBERS]: LightKind.EMBER_LIGHT,                 // Globals.c:469
        [TerrainType.ASH]: 0,                                        // Globals.c:461 NO_LIGHT
        [TerrainType.POISON_GAS]: 0,                                 // Globals.c:502 NO_LIGHT
        [TerrainType.CONFUSION_GAS]: LightKind.CONFUSION_GAS_LIGHT,  // Globals.c:503
        [TerrainType.STEAM]: 0,                                      // Globals.c:508 NO_LIGHT
        [TerrainType.GAS_FIRE]: LightKind.FIRE_LIGHT,                // Globals.c:495
        [TerrainType.METHANE_GAS]: 0,                                // Globals.c:507 NO_LIGHT
        [TerrainType.PARALYSIS_GAS]: 0,                              // Globals.c:506 NO_LIGHT
        [TerrainType.GAS_EXPLOSION]: LightKind.EXPLOSION_LIGHT,      // Globals.c:496
        [TerrainType.HOLE]: 0,                                       // Globals.c:442 NO_LIGHT（发光洞是 HOLE_GLOW）
        [TerrainType.HOLE_EDGE]: 0,                                  // Globals.c:444 NO_LIGHT
        // B-3 四条（CE 原列）：
        [TerrainType.FORCEFIELD]: LightKind.FORCEFIELD_LIGHT,        // Globals.c:477
        [TerrainType.FORCEFIELD_MELT]: LightKind.FORCEFIELD_LIGHT,   // Globals.c:478
        [TerrainType.CRYSTAL_WALL]: LightKind.CRYSTAL_WALL_LIGHT,    // Globals.c:338
        [TerrainType.SACRED_GLYPH]: LightKind.SACRED_GLYPH_LIGHT,    // Globals.c:479
        // V-2b-2b 六条（CE 原列）。本文件不在 V-2b-2b 任务书 §6 授权清单——
        // 但本表是 Record<TerrainType> 结构性穷尽表，新增地形不加成员连
        // npm run build（vue-tsc 编译 src 全部 .ts）都无法通过，按 c_4a B 组
        // 同类口径机械补齐；边界扩展在 v-2b-2b 报告 prominent 申报。
        [TerrainType.CARPET]: 0,                        // Globals.c:325 NO_LIGHT
        [TerrainType.STATUE_INERT]: 0,                  // Globals.c:351 NO_LIGHT
        [TerrainType.PEDESTAL]: LightKind.CANDLE_LIGHT, // Globals.c:369 原列（与 ALTAR_INERT 同一烛光）
        [TerrainType.STATUE_INERT_DOORWAY]: 0,          // Globals.c:550 NO_LIGHT
        [TerrainType.WOODEN_BARRICADE]: 0,              // Globals.c:341 NO_LIGHT
        [TerrainType.TRAP_DOOR_HIDDEN]: 0,              // Globals.c:379 NO_LIGHT
        // V-2b-3 九条（wired 载体）：CE 原列 MACHINE_GLYPH=GLYPH_LIGHT_DIM
        //（Globals.c:404）、PILOT_LIGHT_DORMANT=TORCH_LIGHT（:342）——两枚
        // LightKind 光照目录无成员且 LightCatalog 不在 V-2b-3 授权清单，登记
        // 不迁移（web glowLight 取 NO_LIGHT=0）；其余七条 CE 原列即 NO_LIGHT。
        [TerrainType.MACHINE_GLYPH]: 0,                 // Globals.c:404 原列 GLYPH_LIGHT_DIM，登记不迁移
        [TerrainType.PORTCULLIS_CLOSED]: 0,             // Globals.c:339 NO_LIGHT
        [TerrainType.WORM_TUNNEL_OUTER_WALL]: 0,        // Globals.c:570 NO_LIGHT
        [TerrainType.WALL_LEVER_HIDDEN]: 0,             // Globals.c:347 NO_LIGHT
        [TerrainType.GAS_TRAP_PARALYSIS]: 0,            // Globals.c:382 NO_LIGHT
        [TerrainType.GAS_TRAP_PARALYSIS_HIDDEN]: 0,     // Globals.c:381 NO_LIGHT
        [TerrainType.MACHINE_PARALYSIS_VENT_HIDDEN]: 0, // Globals.c:383 NO_LIGHT
        [TerrainType.MACHINE_METHANE_VENT_HIDDEN]: 0,   // Globals.c:398 NO_LIGHT
        [TerrainType.PILOT_LIGHT_DORMANT]: 0,           // Globals.c:342 原列 TORCH_LIGHT，登记不迁移
        // V-2b-4 七条（祭坛族轮，CE 原列）：ALTAR_CAGE_OPEN/RETRACTABLE 与
        // RESURRECTION_ALTAR 都是 CANDLE_LIGHT（Globals.c:364/368/538 第 10 列）；
        // TORCH_WALL 是 TORCH_LIGHT（:337）——三枚 LightKind 目录里都有成员
        // （CANDLE_LIGHT=53、TORCH_LIGHT=33），故本轮**真实点亮**（与
        // PILOT_LIGHT_DORMANT 的"登记不迁移"不同，载体的光照语义本轮生效）。
        // AMULET_SWITCH（:529）、STATUE_INSTACRACK（:354）为 NO_LIGHT。
        // COMMUTATION_ALTAR 的 CE 原列即 NO_LIGHT（:532，注释块首列的
        // "// commutation device" 段没有烛光——置换祭坛不发光是 CE 原样）。
        [TerrainType.ALTAR_CAGE_OPEN]: LightKind.CANDLE_LIGHT,
        [TerrainType.ALTAR_CAGE_RETRACTABLE]: LightKind.CANDLE_LIGHT,
        [TerrainType.COMMUTATION_ALTAR]: 0,             // Globals.c:532 NO_LIGHT
        [TerrainType.RESURRECTION_ALTAR]: LightKind.CANDLE_LIGHT,
        [TerrainType.AMULET_SWITCH]: 0,                 // Globals.c:529 NO_LIGHT
        [TerrainType.STATUE_INSTACRACK]: 0,             // Globals.c:354 NO_LIGHT
        [TerrainType.TORCH_WALL]: LightKind.TORCH_LIGHT,
    };

    it('全 tile 的 glowLight 逐值等于 CE 原列（结构性穷尽）', () => {
        for (const t of Object.keys(TERRAIN_FLAGS).map((k) => Number(k) as TerrainType)) {
            const expected = EXPECTED_GLOW[t];
            expect(expected, `TerrainType.${t} 缺期望值（表没跟上新 tile？）`).toBeDefined();
            expect(TERRAIN_FLAGS[t].glowLight, `TerrainType.${t} glowLight 不符`).toBe(expected);
        }
    });

    it('非零恰 16 个（V-2b-4 前为 12，与旧标题的"11"本就不符——标题顺延为 16），且都指向有载体的目录条目', () => {
        const nonzero = Object.entries(TERRAIN_FLAGS)
            .filter(([, v]) => v.glowLight !== LightKind.NO_LIGHT)
            .map(([k]) => Number(k) as TerrainType)
            .sort((a, b) => a - b);
        expect(nonzero).toEqual([
            TerrainType.LAVA, TerrainType.ALTAR, TerrainType.EMBERS,
            TerrainType.CONFUSION_GAS, TerrainType.GAS_FIRE,
            TerrainType.GAS_EXPLOSION, TerrainType.PLAIN_FIRE,
            // B-3：三张卷轴的水晶/圣徽 tile（FORCEFIELD_MELT 与 FORCEFIELD
            // 共用 FORCEFIELD_LIGHT）。
            TerrainType.FORCEFIELD, TerrainType.FORCEFIELD_MELT,
            TerrainType.CRYSTAL_WALL, TerrainType.SACRED_GLYPH,
            // V-2b-2b：PEDESTAL（CE Globals.c:369 原列 = CANDLE_LIGHT）。
            TerrainType.PEDESTAL,
            // V-2b-4：两个铁笼祭坛与复活祭坛的烛光（CANDLE_LIGHT，CE 原列），
            // 以及墙装火把的 TORCH_LIGHT（Globals.c:337）。
            TerrainType.ALTAR_CAGE_OPEN, TerrainType.ALTAR_CAGE_RETRACTABLE,
            TerrainType.RESURRECTION_ALTAR, TerrainType.TORCH_WALL,
        ].sort((a, b) => a - b));
        for (const t of nonzero) {
            expect(LIGHT_CATALOG[TERRAIN_FLAGS[t].glowLight]).toBeDefined();
        }
    });
});

// ---------------------------------------------------------------------------
// 三、矿灯深度衰减（对抗④数据面：方向/数值写反即红）
// ---------------------------------------------------------------------------

describe('C-7 矿灯半径（RogueMain.c:666-670 + Light.c:120-154 逐行）', () => {
    it('深度衰减方向与精确值：随深度单调收缩（写反/改公式即红）', () => {
        // 期望值由 CE C 代码独立执行推导（逐次 *85/100 整除，非浮点 pow）：
        const EXPECTED: Array<[number, number, number]> = [
            // depth, radiusHundredths, radialFadeToPercent
            [1, 5579, 40],
            [2, 4776, 40],
            [5, 3020, 40],
            [10, 1465, 40],
            [20, 469, 40],
            [26, 317, 40],   // amulet 层：约 3.2 格
            [40, 234, 40],   // 最深层：约 2.3 格
        ];
        let prev = Infinity;
        for (const [depth, rad, fade] of EXPECTED) {
            const st = updateMinersLightRadius(minersLightBaseRadiusFixpt(depth));
            expect(st.radiusHundredths, `depth ${depth} 半径`).toBe(rad);
            expect(st.radialFadeToPercent, `depth ${depth} 衰减`).toBe(fade);
            expect(st.radiusHundredths).toBeLessThan(prev); // 越深越暗（方向哨兵）
            prev = st.radiusHundredths;
        }
        // d=0 锚（RogueMain.c:666 的 (DCOLS-1)*FP 起点 + :670 的 +2.25 格，
        // 零轮衰减）：以 FP_FACTOR 标度表达——fixpt 标度或补偿值写错即红
        expect(minersLightBaseRadiusFixpt(0)).toBe(63 * FP_FACTOR + (FP_FACTOR * 225) / 100);
        expect(minersLightBaseRadiusFixpt(1)).toBe(3656908); // 63*FP 逐次 85% 一轮 + 2.25 格
    });

    it('光明戒指倍率分支（Light.c:125-131）：正倍率放大有下限、负倍率除法收缩', () => {
        // LM=3：×3 放大，fade = 35 + min(65, 15) = 50
        expect(updateMinersLightRadius(minersLightBaseRadiusFixpt(1), { lightMultiplier: 3 }))
            .toEqual({ radiusHundredths: 16739, radialFadeToPercent: 50 });
        // LM=-2：除以 3 收缩，fade 钳在 35
        expect(updateMinersLightRadius(minersLightBaseRadiusFixpt(1), { lightMultiplier: -2 }))
            .toEqual({ radiusHundredths: 1859, radialFadeToPercent: 35 });
        // LM=-1：除以 2
        expect(updateMinersLightRadius(minersLightBaseRadiusFixpt(1), { lightMultiplier: -1 }))
            .toEqual({ radiusHundredths: 2789, radialFadeToPercent: 35 });
    });

    it('黑暗状态立方衰减 + 1/20 下限 + 2*FP 退化托底（Light.c:134-148）', () => {
        // STATUS_DARKNESS 满（15/15）：fraction → 0 → 下限 1/20
        expect(updateMinersLightRadius(minersLightBaseRadiusFixpt(1), { darknessStatus: 15, darknessMax: 15 }))
            .toEqual({ radiusHundredths: 278, radialFadeToPercent: 35 });
        // 半程（5/15）：fraction = (2/3)^3 = 8/27
        expect(updateMinersLightRadius(minersLightBaseRadiusFixpt(1), { darknessStatus: 5, darknessMax: 15 }))
            .toEqual({ radiusHundredths: 1653, radialFadeToPercent: 36 });
        // 深层 + 满黑暗：由 fraction 决定（11 个百分之一格 ≈ 0.11 格）
        expect(updateMinersLightRadius(minersLightBaseRadiusFixpt(40), { darknessStatus: 15, darknessMax: 15 }).radiusHundredths)
            .toBe(11);
        // 退化下限（Light.c:146-148 的 2*FP，量纲是"百分之一格"）：零基础半径
        // + 正倍率分支的地板 (LM*2+2)*FP → 4；负倍率压到 0 后被 2*FP 托底 → 2
        expect(updateMinersLightRadius(0).radiusHundredths).toBe(4);
        expect(updateMinersLightRadius(0, { lightMultiplier: -10 }).radiusHundredths).toBe(2);
    });

    it('水中减半（Light.c:150-152，同量纲 3*FP 退化下限）——载体缺口登记，公式分支保留', () => {
        expect(updateMinersLightRadius(minersLightBaseRadiusFixpt(1), { inWater: 1 }))
            .toEqual({ radiusHundredths: 2789, radialFadeToPercent: 40 });
        expect(updateMinersLightRadius(minersLightBaseRadiusFixpt(40), { inWater: 1 }).radiusHundredths).toBe(117);
        // 退化下限路径：零基础 + 正倍率地板 4*FP → 水中砍半 2*FP < 3*FP → 托到 3
        expect(updateMinersLightRadius(0, { inWater: 1 }).radiusHundredths).toBe(3);
    });

    it('矿灯颜色随深度插值（updateColors + applyColorAverage 的 C 整除口径）', () => {
        expect(minersLightColorAtDepth(0)).toEqual({ red: 180, green: 180, blue: 180, redRand: 0, greenRand: 0, blueRand: 0, rand: 0 });
        const d13 = minersLightColorAtDepth(13);
        expect([d13.red, d13.green, d13.blue]).toEqual([135, 135, 150]); // percent=50
        expect(minersLightColorAtDepth(26)).toMatchObject({ red: 90, green: 90, blue: 120 });
        expect(minersLightColorAtDepth(40)).toMatchObject({ red: 90, green: 90, blue: 120 }); // 钳到 100%
        expect(minersLightColorAtDepth(1)).toMatchObject({ red: 177, green: 177, blue: 178 });
    });

    it('VISIBILITY_THRESHOLD = 50（Rogue.h:184）', () => {
        expect(VISIBILITY_THRESHOLD).toBe(50);
    });
});

// ---------------------------------------------------------------------------
// 四、paintLight 行为（对抗①②③的行为面）
// ---------------------------------------------------------------------------

/** 构造全开放（非遮挡）网格。 */
function openGrid(w = 21, h = 21): Grid {
    return new Grid(w, h);
}

describe('C-7 paintLight（CE Light.c:54-116 的确定性复刻）', () => {
    it('对抗①：径向衰减方向——中心最亮、随距离单调变暗（写反即红）', () => {
        const lm = new LightMap(openGrid());
        lm.clearLighting();
        const light = {
            color: { red: 60, green: 60, blue: 60, redRand: 0, greenRand: 0, blueRand: 0, rand: 0 },
            radius: { lowerBound: 600, upperBound: 600, clumpFactor: 1 },
            radialFadeToPercent: 50, // 边缘衰减到 50%
            passThroughCreatures: false,
        };
        lm.paintLight({ light, x: 10, y: 10 });
        const center = lm.lightSumAt(10, 10);
        const mid = lm.lightSumAt(13, 10); // d=3：mult 100−trunc(50×3/6)=75
        const edge = lm.lightSumAt(15, 10); // d=5：mult 100−trunc(50×5/6)=59
        expect(center).toBeGreaterThan(0);
        expect(mid).toBeGreaterThan(0);
        expect(edge).toBeGreaterThan(0);
        expect(center).toBeGreaterThan(mid);
        expect(mid).toBeGreaterThan(edge);
        // 衰减百分比的精确语义：原点双份（掩码 100% + Light.c:116 无条件加法）
        // = 2×180=360；d=3 → 45×3=135；d=5 → trunc(60×59/100)=35×3=105
        expect(center).toBe(360);
        expect(mid).toBe(135);
        expect(edge).toBe(105);
    });

    it('对抗②：区间半径 {500,1000} 的确定性取中点 750（取 lowerBound/upperBound 定值即红）', () => {
        const lm = new LightMap(openGrid());
        lm.clearLighting();
        lm.paintLight({ light: LIGHT_CATALOG[LightKind.FIRE_LIGHT]!, x: 10, y: 10 });
        // 中点半径 7.5 格：距离 6 在光内（lowerBound 5 会漏）、距离 9 在光外（upperBound 10 会多照）
        expect(lm.lightSumAt(16, 10)).toBeGreaterThan(0); // d=6
        expect(lm.lightSumAt(19, 10)).toBe(0);            // d=9
    });

    it('对抗③行为面：passThroughCreatures=false 时生物截断光路，=true 时穿透', () => {
        const mkLight = (pass: boolean) => ({
            color: { red: 100, green: 100, blue: 100, redRand: 0, greenRand: 0, blueRand: 0, rand: 0 },
            radius: { lowerBound: 600, upperBound: 600, clumpFactor: 1 },
            radialFadeToPercent: 0,
            passThroughCreatures: pass,
        });
        // 不穿透：生物在 (12,10)，探测点 (14,10) 应在生物阴影里
        const blocked = new LightMap(openGrid());
        blocked.clearLighting();
        blocked.paintLight({ light: mkLight(false), x: 10, y: 10, hasCreatureAt: (x, y) => x === 12 && y === 10 });
        expect(blocked.lightSumAt(12, 10)).toBeGreaterThan(0); // 遮挡格自身被照亮
        expect(blocked.lightSumAt(14, 10)).toBe(0);            // 影内无光

        // 穿透（矿灯语义）：同一探测点亮着
        const pass = new LightMap(openGrid());
        pass.clearLighting();
        pass.paintLight({ light: mkLight(true), x: 10, y: 10, hasCreatureAt: (x, y) => x === 12 && y === 10 });
        expect(pass.lightSumAt(14, 10)).toBeGreaterThan(0);
    });

    it('IS_IN_SHADOW 语义：矿灯（maintainShadows）不驱散阴影，地形正色光驱散（Light.c:70-71/97-99）', () => {
        const shadowed = new LightMap(openGrid());
        shadowed.clearLighting(); // 全图 IS_IN_SHADOW
        shadowed.paintLight({
            light: {
                color: { red: 90, green: 90, blue: 120, redRand: 0, greenRand: 0, blueRand: 0, rand: 0 },
                radius: { lowerBound: 800, upperBound: 800, clumpFactor: 1 },
                radialFadeToPercent: 40,
                passThroughCreatures: true,
            },
            x: 10, y: 10, isMinersLight: true, maintainShadows: true,
        });
        expect(shadowed.lightSumAt(10, 10)).toBeGreaterThan(0); // 有光
        expect(shadowed.inShadowAt(10, 10)).toBe(true);         // 但阴影不被驱散

        const lit = new LightMap(openGrid());
        lit.clearLighting();
        lit.paintLight({ light: LIGHT_CATALOG[LightKind.CANDLE_LIGHT]!, x: 10, y: 10 });
        expect(lit.inShadowAt(10, 10)).toBe(false);             // 地形正色光驱散阴影
    });
});

// ---------------------------------------------------------------------------
// 五、updateVision 集成（对抗⑤消费面 + 对抗④集成面）
// ---------------------------------------------------------------------------

/** 把整图雕刻成无遮挡平原并清空生物/气体， isolates 光照变量。 */
function carvePlain(game: Game): void {
    (game as unknown as { monsters: unknown[] }).monsters = [];
    for (let x = 0; x < DCOLS; x++) {
        for (let y = 0; y < DROWS; y++) {
            const cell = game.grid.getCell(x, y);
            if (!cell) continue;
            cell.layers = [TerrainType.FLOOR, TerrainType.NOTHING, TerrainType.NOTHING, TerrainType.NOTHING];
            cell.isOpaque = false;
            cell.isPassable = true;
            cell.volume = 0;
        }
    }
}

describe('C-7 updateVision 集成（CE Time.c:859 → Light.c:208 → Movement.c:2582）', () => {
    it('对抗⑤消费面：深层岩浆自发光——glowLight 列没接上/不被消费即红', () => {
        const game = createHeadlessGame(77031);
        carvePlain(game);
        const px = game.player.loc.x;
        const py = game.player.loc.y;
        const dir = px <= 60 ? 1 : -1; // 探针方向保护：贴边生成也不越界
        // 岩浆放在玩家侧向 6 格（矿灯在 depth40 半径只有 ~2.3 格，照不到）
        const lavaCell = game.grid.getCell(px + 6 * dir, py)!;
        lavaCell.layers = [TerrainType.NOTHING, TerrainType.LAVA, TerrainType.NOTHING, TerrainType.NOTHING];

        game.depth = 40;
        (game as unknown as { updateVision(): void }).updateVision();

        const sum = game.lightMap.lightSumAt(px + 6 * dir, py);
        expect(sum).toBeGreaterThan(VISIBILITY_THRESHOLD); // 岩浆光让它自己亮过阈值
        expect(game.lightMap.lightSumAt(px + 12 * dir, py)).toBe(0); // 12 格外无光（LAVA_LIGHT 半径 3）
        // 可见性随之成立（有 LOS + 光 > 50）
        expect(game.grid.getCell(px + 6 * dir, py)!.isVisible).toBe(true);
        // 未放光的远处地面仍不可见（深层矿灯照不到）
        expect(game.grid.getCell(px + 6 * dir, py + 8 <= DROWS - 1 ? py + 8 : py - 8)!.isVisible).toBe(false);
    });

    it('对抗④集成面：矿灯深度衰减在视野上可观测——深层可见格骤减', () => {
        const game = createHeadlessGame(77032);
        carvePlain(game);
        const updateVision = (game as unknown as { updateVision(): void }).updateVision.bind(game);

        game.depth = 1;
        updateVision();
        let visibleAtD1 = 0;
        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                if (game.grid.getCell(x, y)?.isVisible) visibleAtD1++;
            }
        }

        game.depth = 40;
        updateVision();
        let visibleAtD40 = 0;
        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                if (game.grid.getCell(x, y)?.isVisible) visibleAtD40++;
            }
        }

        // 开阔平原上 depth1 矿灯（55.8 格）几乎照 full-map，depth40（2.3 格）只剩身边一小圈
        expect(visibleAtD1).toBeGreaterThan(1500);
        expect(visibleAtD40).toBeLessThan(40);
        // 方向哨兵
        expect(visibleAtD40).toBeLessThan(visibleAtD1);
    });

    it('VISIBLE = 掩码 ∧ 光强>50：玩家格恒可见，墙后格不因光而可见', () => {
        const game = createHeadlessGame(77033);
        carvePlain(game);
        const px = game.player.loc.x;
        const py = game.player.loc.y;
        const dir = px <= 66 ? 1 : -1;
        // 玩家侧向 3 格立一堵墙，墙后再放岩浆：有光、无 LOS → 不可见
        const wall = game.grid.getCell(px + 3 * dir, py)!;
        wall.layers = [TerrainType.WALL, TerrainType.NOTHING, TerrainType.NOTHING, TerrainType.NOTHING];
        wall.isOpaque = true;
        const behind = game.grid.getCell(px + 5 * dir, py)!;
        behind.layers = [TerrainType.NOTHING, TerrainType.LAVA, TerrainType.NOTHING, TerrainType.NOTHING];

        game.depth = 40;
        (game as unknown as { updateVision(): void }).updateVision();

        expect(game.grid.getCell(px, py)!.isVisible).toBe(true);
        expect(game.lightMap.lightSumAt(px + 5 * dir, py)).toBeGreaterThan(VISIBILITY_THRESHOLD); // 光确实在
        expect(game.grid.getCell(px + 5 * dir, py)!.isVisible).toBe(false);                      // 但墙挡了 LOS
    });

    it('渲染馈送：getLight 接口拿到矿灯光（UI-1 起渲染改走 lightAt 三通道，本接口保留为兼容面）', () => {
        const game = createHeadlessGame(77034);
        carvePlain(game);
        game.depth = 1;
        (game as unknown as { updateVision(): void }).updateVision();
        const feed = game.lightMap.getLight(game.player.loc.x, game.player.loc.y)!;
        expect(feed.intensity).toBeGreaterThan(0);
        expect(feed.color.r).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// 六、潜行接线（CE Time.c:798/802 的两处减半）
// ---------------------------------------------------------------------------

describe('C-7 光照 → 潜行判定（calculateStealthRange）', () => {
    function stealthOf(game: Game): { range: number; darkness: boolean } {
        const g = game as unknown as {
            calculateStealthRange(): number;
            playerInDarkness(): boolean;
        };
        return { range: g.calculateStealthRange(), darkness: g.playerInDarkness() };
    }

    it('无地形光：矿灯不驱散阴影 → 减半一次；playerInDarkness 为 false（矿灯中心恒亮）', () => {
        const game = createHeadlessGame(77035);
        carvePlain(game);
        const { range, darkness } = stealthOf(game);
        const armor = game.player.equippedArmor;
        const adj = armor ? Math.max(0, (armor.strengthRequired || 0) - 12) : 0;
        expect(darkness).toBe(false); // CE Light.c:283-287：自己矿灯的中心不会低于矿灯色
        expect(range).toBe(Math.floor((14 + adj) / 2)); // IS_IN_SHADOW 减半
    });

    it('站进祭坛烛光（CANDLE_LIGHT 载体）：阴影被驱散 → 潜行范围恢复 14+adj', () => {
        const game = createHeadlessGame(77036);
        carvePlain(game);
        const px = game.player.loc.x;
        const py = game.player.loc.y;
        const altar = game.grid.getCell(px + 1, py)!;
        altar.layers = [TerrainType.ALTAR, TerrainType.NOTHING, TerrainType.NOTHING, TerrainType.NOTHING];

        (game as unknown as { updateVision(): void }).updateVision();
        const { range } = stealthOf(game);
        const armor = game.player.equippedArmor;
        const adj = armor ? Math.max(0, (armor.strengthRequired || 0) - 12) : 0;
        expect(game.lightMap.inShadowAt(px, py)).toBe(false); // 烛光驱散了玩家格阴影
        expect(range).toBe(14 + adj);
    });

    it('playerInDarkness 判据：负色光压过矿灯时翻真（Light.c:283-287 的 −10 余量口径）', () => {
        // 直接在 LightMap 上构造：矿灯中心光 {90,90,120}×2 之上泼黑暗云 {−20,−20,−20}
        // 多份累积，验证"全通道 light+10 < 矿灯色"的判定逻辑本身。
        const g = new Grid(21, 21);
        const lm = new LightMap(g);
        lm.clearLighting();
        // 模拟 8 份 DARKNESS_CLOUD（500=5 格，无衰减）压在这一格
        for (let i = 0; i < 8; i++) {
            lm.paintLight({
                light: {
                    color: { red: -20, green: -20, blue: -20, redRand: 0, greenRand: 0, blueRand: 0, rand: 0 },
                    radius: { lowerBound: 500, upperBound: 500, clumpFactor: 1 },
                    radialFadeToPercent: 0,
                    passThroughCreatures: true,
                },
                x: 10, y: 10, maintainShadows: true,
            });
        }
        const ch = lm.lightAt(10, 10)!;
        // 8×(−20)×2（掩码+原点双份）= −320 → 全通道远低于矿灯色−10
        expect(ch.r + 10).toBeLessThan(90);
        expect(ch.g + 10).toBeLessThan(90);
        expect(ch.b + 10).toBeLessThan(120);
        // VISIBLE 口径把负通道钳成 0：光和为 0 → 不可见（黑暗吞噬视野）
        expect(lm.lightSumAt(10, 10)).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// 七、载体边界留痕（对抗⑥：无载体条目被接成空转链）
// ---------------------------------------------------------------------------

describe('C-7 载体边界留痕', () => {
    const CARRIER_KINDS = new Set([
        'NO_LIGHT',            // 哨兵值，目录默认列
        'MINERS_LIGHT',        // 载体：玩家（本轮接线）
        'BURNING_CREATURE_LIGHT', // 载体：STATUS_BURNING（F-2b 状态机）
        'LAVA_LIGHT', 'EMBER_LIGHT', 'FIRE_LIGHT',
        'EXPLOSION_LIGHT', 'CONFUSION_GAS_LIGHT', 'CANDLE_LIGHT', // 载体：web 既有 tile
        // B-3 反转（按本留痕自带指示）：三张卷轴落地 FORCEFIELD /
        // FORCEFIELD_MELT / CRYSTAL_WALL / SACRED_GLYPH 四种 tile
        // （Globals.c:477/478/338/479），glowLight 列即这三种光——载体就是
        // tile 本身，updateVision 的发光地形扫描（Game.ts 逐层读
        // TERRAIN_FLAGS.glowLight → paintLight）会真实点亮它们。
        'FORCEFIELD_LIGHT', 'CRYSTAL_WALL_LIGHT', 'SACRED_GLYPH_LIGHT',
        // V-2b-4（祭坛族轮）反转：TORCH_WALL（Globals.c:337）落地——它在 CE
        // 的 glowLight 列就是 TORCH_LIGHT，载体就是 tile 本身，与上面 B-3 的
        // 四种同款（updateVision 会真实点亮，"无载体空转链"的留痕前提失效）。
        // 注意：PILOT_LIGHT_DORMANT（:342）的 TORCH_LIGHT 仍**不迁移**
        // （登记在 EXPECTED_GLOW 里为 0）——载体与光名是两件事，本清单只登记
        // "光名现在有真实载体"。
        'TORCH_LIGHT',
    ]);

    function* prodTsFiles(dir: string): Generator<string> {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'test' || entry.name === 'node_modules') continue;
                yield* prodTsFiles(p);
            } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.vue')) {
                yield p;
            }
        }
    }

    it('留痕（对抗⑥）：除载体清单外，任何 LightKind 名不得出现在生产代码（接了无载体条目=空转链）', () => {
        const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
        // 扫描口径：剥掉注释与字符串字面量后只看**代码**——读者是代码，
        // 不是注释散文或数据表。DF 目录把 CE flare 光名以字符串存档
        // （c_6 报告 §十四.2"数据已登记未实现"），剥离后放行；若有人写出
        // 真正的标识符读者（点号/解构/裸名），照样翻红。
        const violations: string[] = [];
        for (const file of prodTsFiles(srcDir)) {
            const rel = path.relative(srcDir, file);
            if (rel === path.join('engine', 'Map', 'LightCatalog.ts')) continue; // 定义处
            let text = fs.readFileSync(file, 'utf8');
            text = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
            text = text.replace(/(["'])(?:\\.|(?!\1)[^\\\n])*\1/g, '""');
            for (const kind of Object.keys(LightKind).filter((k) => isNaN(Number(k)))) {
                if (CARRIER_KINDS.has(kind)) continue;
                // \b 词边界：同时命中 LightKind.X 点号读取与解构/裸名两种形态；
                // 不匹配 BRIMSTONE_FIRE_LIGHT 内部的 FIRE_LIGHT 子串
                if (new RegExp(`\\b${kind}\\b`).test(text)) {
                    violations.push(`${rel} 引用了无载体光 ${kind}`);
                }
            }
        }
        expect(violations, violations.join('\n')).toEqual([]);
        // 留痕说明：SUNLIGHT_POOL/DARKNESS_PATCH/LUMINESCENT_FUNGUS
        // 等 tile 与对应光（SUN/DARKNESS_PATCH/FUNGUS×2/ALGAE×2）属
        // c_6 报告 §十四.1 的"先落 tile 再接光"清单；TELEPATHY_LIGHT 的揭示
        // 走 updateTelepathy 的 2 格 LOS 掩码、不经光照阈值（Time.c:1046-1080），
        // 接光无引擎侧可观测效果——全部登记不接。哪一轮来反转我：落
        // 上述 tile 的地形轮把对应光名加入 CARRIER_KINDS 并在 TerrainCatalog
        // 补列值；渲染轮接入 flare 族时同理发落。
        // ★ V-2b-4 已按此指示反转 **TORCH_WALL/TORCH_LIGHT** 一项（本留痕的
        //   自预告动作，载体现已在 CARRIER_KINDS 内）。其余仍待落 tile。
    });

    it('留痕（UI-1 第 7 条已反转，2026-09-18）：渲染层消费 lightAt 三通道做 CE 乘法，仍不得直接 import 光照目录/paintLight', () => {
        const compDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'components');
        if (!fs.existsSync(compDir)) return;
        for (const file of prodTsFiles(compDir)) {
            const text = fs.readFileSync(file, 'utf8');
            expect(text).not.toMatch(/LightCatalog|LIGHT_CATALOG|paintLight/);
        }
        // 原留痕断言"仍消费 getLight 旧接口、渲染表现归 UI 轮"——UI-1 就是那轮，
        // 按留痕反转为新事实：GameCanvas 经 LightMap.lightAt 取 CE tmap.light
        // 三通道（乘法决策在 Appearance.ts，组件内仍是纯接线）。
        const canvas = fs.readFileSync(path.join(compDir, 'GameCanvas.vue'), 'utf8');
        expect(canvas).toMatch(/lightMap\.lightAt\(/);
    });
});
