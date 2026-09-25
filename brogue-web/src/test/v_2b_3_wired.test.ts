/**
 * src/test/v_2b_3_wired.test.ts — V-2b-3：wired 触发网络（CE Time.c:1173-1287）
 *
 * 分组：
 *   A. 九个载体地形 ≡ CE Globals.c 原列（逐字段对抗——抄错任一位即红）；
 *   B. activateMachine（CE :1173-1228）——机器号过滤、洗牌 RNG 无条件性、
 *      相互递归闸、逐层晋升；
 *   C. circuitBreakersPreventActivation（CE :1230-1242）——阻断与机器号过滤；
 *   D. promoteTile wired 分支端到端——67/68 号麻痹机（电通、payoff 按缓办
 *      口径响亮登记）、24 号符文机（DF 缺 tile 不挡通电）、嵌套晋升不带电；
 *   E. BlueprintEngine——REPEAT failsafe（§1.5）、CE :1244-1250 的机器标记
 *      块 wired 地形清除、monsterId 条件（CE :1601 字面）、生产蓝图数据与
 *      22 号蓝图行使。
 *
 * 对抗性设计原则：每条断言都能在一个具体的、合理的错误实现下失败
 * （错误形态写在各用例注释里）。运行时注入 TERRAIN_FLAGS 表项的用例一律
 * finally 还原。TM_IS_CIRCUIT_BREAKER 当前目录无载体（CE 目录同样零载体：
 * 全 tileCatalog 无带该旗标的条目——留痕），注入用 withEntry。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Grid, TerrainType, DungeonLayer, DCOLS, DROWS } from '../engine/Map/Grid';
import {
    TERRAIN_FLAGS,
    T_OBSTRUCTS_EVERYTHING,
    T_OBSTRUCTS_PASSABILITY,
    T_OBSTRUCTS_ITEMS,
    T_IS_DF_TRAP,
    TM_IS_SECRET,
    TM_IS_WIRED,
    TM_IS_CIRCUIT_BREAKER,
    TM_VANISHES_UPON_PROMOTION,
    TM_PROMOTES_ON_PLAYER_ENTRY,
    TM_LIST_IN_SIDEBAR,
    TM_VISUALLY_DISTINCT,
    TM_CONNECTS_LEVEL,
    TM_STAND_IN_TILE,
} from '../engine/Map/TerrainCatalog';
import {
    DF,
    DUNGEON_FEATURE_CATALOG,
    DF_MISSING_TILES,
} from '../engine/Map/DungeonFeatureCatalog';
import { catalogFeature } from '../engine/Map/DungeonFeature';
import {
    promoteTile,
    activateMachine,
    circuitBreakersPreventActivation,
} from '../engine/Map/Promotion';
import { rng } from '../engine/Random';
import { BlueprintEngine } from '../engine/Generator/BlueprintEngine';
import type { BlueprintDef, FeatureDef, MachineResult } from '../engine/Generator/BlueprintEngine';
import blueprintData from '../data/blueprints.json';

const C = TerrainType;
const L = DungeonLayer;

/** 测试可变视图（生产表 readonly，只为注入场景）。 */
type MutableEntry = {
    flags: number; mechFlags: number; chanceToIgnite: number;
    fireType: string; discoverType: string; promoteType: string;
    promoteChance: number; webOnly: boolean;
};

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

/** 全墙小图：默认全 WALL，点名改写。 */
function wallGrid(w = 24, h = 20): Grid {
    const g = new Grid(w, h);
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
            g.setTerrain(x, y, C.WALL, '#', 0x666666);
        }
    }
    return g;
}

/** 全地板小图（气体波前/机器排布用）。 */
function floorGrid(w = 24, h = 20): Grid {
    const g = new Grid(w, h);
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
            g.setTerrain(x, y, C.FLOOR, '.', 0x888888);
        }
    }
    return g;
}

/** 把一片格标成机器号（web 的 IS_IN_MACHINE 等价物）。 */
function markMachine(g: Grid, cells: Array<[number, number]>, num: number): void {
    for (const [x, y] of cells) {
        const c = g.getCell(x, y)!;
        c.machineNumber = num;
    }
}

afterEach(() => {
    rng.seedRandomGenerator(20260920); // 每用例后重置种子，防用例间流串味
});

// ══════════════════════════════════════════════════════════════════════════

// ── A：九个载体地形 ≡ CE Globals.c 原列 ─────────────────────────────────────

describe('V-2b-3 A：载体地形逐字段 ≡ CE Globals.c（对抗：抄错任一位即红）', () => {
    // 逐条转录自 CE tileCatalog（flags, mechFlags, ign, fireType,
    // discoverType, promoteType, promoteChance），行号在各断言消息里。
    it('MACHINE_GLYPH（Globals.c:404）', () => {
        const t = TERRAIN_FLAGS[C.MACHINE_GLYPH]!;
        expect(t.flags).toBe(0);
        expect(t.mechFlags).toBe(
            TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED | TM_PROMOTES_ON_PLAYER_ENTRY |
            TM_VISUALLY_DISTINCT
        );
        expect(t.chanceToIgnite).toBe(0);
        expect(t.fireType).toBe('');
        expect(t.promoteType).toBe('DF_INACTIVE_GLYPH');
        expect(t.promoteChance).toBe(0);
    });

    it('PORTCULLIS_CLOSED（Globals.c:339）', () => {
        const t = TERRAIN_FLAGS[C.PORTCULLIS_CLOSED]!;
        expect(t.flags).toBe(T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_ITEMS);
        expect(t.mechFlags).toBe(
            TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED |
            TM_LIST_IN_SIDEBAR | TM_VISUALLY_DISTINCT | TM_CONNECTS_LEVEL
        );
        expect(t.fireType).toBe('DF_PLAIN_FIRE');
        expect(t.promoteType).toBe('DF_OPEN_PORTCULLIS');
        expect(t.promoteChance).toBe(0);
    });

    it('WORM_TUNNEL_OUTER_WALL（Globals.c:570）', () => {
        const t = TERRAIN_FLAGS[C.WORM_TUNNEL_OUTER_WALL]!;
        expect(t.flags).toBe(T_OBSTRUCTS_EVERYTHING);
        expect(t.mechFlags).toBe(
            TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED | TM_CONNECTS_LEVEL
        );
        expect(t.fireType).toBe('DF_PLAIN_FIRE');
        expect(t.promoteType).toBe('DF_WALL_SHATTER');
        expect(t.promoteChance).toBe(0);
    });

    it('WALL_LEVER_HIDDEN（Globals.c:347）——CE 原样不带 TM_IS_WIRED', () => {
        // 对抗：想当然给隐藏杆补线（"反正它该通电"）即红——带线的是显形后
        // 的 WALL_LEVER（:348），web 无该 tile，激活链留形（激活轮需重核）。
        const t = TERRAIN_FLAGS[C.WALL_LEVER_HIDDEN]!;
        expect(t.flags).toBe(T_OBSTRUCTS_EVERYTHING);
        expect(t.mechFlags).toBe(
            TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_IS_SECRET
        );
        expect(t.mechFlags & TM_IS_WIRED).toBe(0);
        expect(t.discoverType).toBe('DF_REVEAL_LEVER');
    });

    it('GAS_TRAP_PARALYSIS / _HIDDEN（Globals.c:382/381）', () => {
        const v = TERRAIN_FLAGS[C.GAS_TRAP_PARALYSIS]!;
        expect(v.flags).toBe(T_IS_DF_TRAP);
        expect(v.mechFlags).toBe(TM_IS_WIRED | TM_LIST_IN_SIDEBAR | TM_VISUALLY_DISTINCT);
        expect(v.fireType).toBe('');
        expect(v.promoteType).toBe('');
        const h = TERRAIN_FLAGS[C.GAS_TRAP_PARALYSIS_HIDDEN]!;
        expect(h.flags).toBe(T_IS_DF_TRAP);
        expect(h.mechFlags).toBe(TM_IS_SECRET | TM_IS_WIRED);
        expect(h.discoverType).toBe('DF_SHOW_PARALYSIS_GAS_TRAP');
    });

    it('MACHINE_PARALYSIS_VENT_HIDDEN（Globals.c:383）与 MACHINE_METHANE_VENT_HIDDEN（:398）', () => {
        const pv = TERRAIN_FLAGS[C.MACHINE_PARALYSIS_VENT_HIDDEN]!;
        expect(pv.flags).toBe(0);
        expect(pv.mechFlags).toBe(
            TM_VANISHES_UPON_PROMOTION | TM_IS_SECRET | TM_IS_WIRED
        );
        expect(pv.fireType).toBe('DF_PLAIN_FIRE');
        expect(pv.discoverType).toBe('DF_DISCOVER_PARALYSIS_VENT');
        expect(pv.promoteType).toBe('DF_PARALYSIS_VENT_SPEW');
        const mv = TERRAIN_FLAGS[C.MACHINE_METHANE_VENT_HIDDEN]!;
        expect(mv.mechFlags).toBe(
            TM_VANISHES_UPON_PROMOTION | TM_IS_SECRET | TM_IS_WIRED
        );
        expect(mv.discoverType).toBe('DF_SHOW_METHANE_VENT');
        expect(mv.promoteType).toBe('DF_METHANE_VENT_OPEN');
    });

    it('PILOT_LIGHT_DORMANT（Globals.c:342）', () => {
        const t = TERRAIN_FLAGS[C.PILOT_LIGHT_DORMANT]!;
        expect(t.flags).toBe(T_OBSTRUCTS_EVERYTHING);
        expect(t.mechFlags).toBe(TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED);
        expect(t.fireType).toBe('DF_PLAIN_FIRE');
        expect(t.promoteType).toBe('DF_PILOT_LIGHT');
    });

    it('14 条新 DF 枚举 id ≡ CE Rogue.h 数序（对抗：抄错枚举位即错目录行）', () => {
        expect(DF.DF_RUBBLE).toBe(7);
        expect(DF.DF_SHOW_PARALYSIS_GAS_TRAP).toBe(15);
        expect(DF.DF_INACTIVE_GLYPH).toBe(89);
        expect(DF.DF_REVEAL_LEVER).toBe(95);
        expect(DF.DF_MEDIUM_HOLE).toBe(152);
        expect(DF.DF_OPEN_PORTCULLIS).toBe(177);
        expect(DF.DF_SHOW_METHANE_VENT).toBe(179);
        expect(DF.DF_METHANE_VENT_OPEN).toBe(180);
        expect(DF.DF_VENT_SPEW_METHANE).toBe(181);
        expect(DF.DF_PILOT_LIGHT).toBe(182);
        expect(DF.DF_DISCOVER_PARALYSIS_VENT).toBe(183);
        expect(DF.DF_PARALYSIS_VENT_SPEW).toBe(184);
        expect(DF.DF_REVEAL_PARALYSIS_VENT_SILENTLY).toBe(185);
        expect(DF.DF_WALL_SHATTER).toBe(215);
    });

    it('有载体的链环 tile 对位（气体 payoff 的三条线）+ DF_MISSING_TILES 顺延 8 → 19', () => {
        expect(DUNGEON_FEATURE_CATALOG[DF.DF_PARALYSIS_VENT_SPEW]!.tile).toBe(C.PARALYSIS_GAS);
        expect(DUNGEON_FEATURE_CATALOG[DF.DF_VENT_SPEW_METHANE]!.tile).toBe(C.METHANE_GAS);
        expect(DUNGEON_FEATURE_CATALOG[DF.DF_SHOW_PARALYSIS_GAS_TRAP]!.tile).toBe(C.GAS_TRAP_PARALYSIS);
        // DF_MEDIUM_HOLE：CE :813 {TRAP_DOOR, LIQUID, 225, 100, CLEAR_OTHER|
        // SUBSEQ_EVERYWHERE, subseq DF_SHOW_TRAPDOOR_HALO}
        const mh = DUNGEON_FEATURE_CATALOG[DF.DF_MEDIUM_HOLE]!;
        expect(mh.ceTile).toBe('TRAP_DOOR');
        expect(mh.layer).toBe(L.LIQUID);
        expect(mh.startProbability).toBe(225);
        expect(mh.probabilityDecrement).toBe(100);
        expect(mh.subsequentDF).toBe(DF.DF_SHOW_TRAPDOOR_HALO);
        // V-2b-4 顺延（本文件在 V-2b-4 任务书 §4 授权清单内）：祭坛族轮八条
        // 新目录条目里 web 无 tile 的七条入列，19 → 26。守卫仍全等钉死长度
        //（不放宽成包含关系）；DF_CAGE_DISAPPEARS 是八条里唯一带完整 tile
        //（ALTAR_INERT = web TerrainType.ALTAR）的，不入列。
        // V-2b-5 第五次顺延：休眠唤醒轮四条新条目里 web 无 tile 的两条
        //（DF_WALL_CRACK / DF_CRACKING_STATUE）入列，26 → 28；另两条
        //（DF_ALTAR_INERT / DF_TURRET_EMERGE）tile 完整，不入列。
        // V-2b-6 第六次顺延：钥匙轮七条新条目里 web 无 tile 的两条
        //（DF_SHOW_POISON_GAS_VENT / DF_POISON_GAS_VENT_OPEN）入列、
        // DF_OPEN_PORTCULLIS 摘除（tile PORTCULLIS_DORMANT 该轮落地），
        // 净 28 → 29。
        // V-2b-7 第七次顺延：DF 特征系统轮摘 5 增 7，29 → 31——
        // RUBBLE 与 LUMINESCENT_FUNGUS 两个地形随 47/55 号蓝图与 12 号 DF 列
        // 落地，DF_WALL_SHATTER / DF_SHATTERING_SPELL / DF_RUBBLE /
        // DF_STATUE_SHATTER / DF_LUMINESCENT_FUNGUS 五条接上真 tile 摘出；
        // 22 条新条目里 web 无 tile 的七条入列。逐条见 DungeonFeatureCatalog
        // 的 V-2b-7 块注。
        expect(DF_MISSING_TILES).toHaveLength(11); // U17d: exactly nine closures; the other eleven stay missing.
        expect(DF_MISSING_TILES).not.toContain(DF.DF_REVEAL_LEVER); // U17c closure
        for (const d of [DF.DF_REVEAL_PARALYSIS_VENT_SILENTLY]) {
            expect(DF_MISSING_TILES, `U17d DF[${d}] 已恢复载体`).not.toContain(d);
            expect(() => catalogFeature(d)).not.toThrow();
        }
        // ★ V-2b-7 反转（与下方 DF_OPEN_PORTCULLIS 同款）：DF_WALL_SHATTER 的
        // tile 是 RUBBLE，而 RUBBLE 地形本轮随 55 号 DF_TUNNELIZE 落地——
        // 该条摘出名单、接上完整 tile。守卫变强：钉它必须离开名单。
        expect(DF_MISSING_TILES, 'V-2b-7 后 DF_WALL_SHATTER 已摘出缺 tile 名单').not.toContain(DF.DF_WALL_SHATTER);
        {
            const ws = DUNGEON_FEATURE_CATALOG[DF.DF_WALL_SHATTER]!;
            expect(ws.tile).toBe(C.RUBBLE);
            expect(() => catalogFeature(DF.DF_WALL_SHATTER)).not.toThrow();
        }
        // V-2b-6 反转：DF_OPEN_PORTCULLIS 的 tile PORTCULLIS_DORMANT 已随
        // 钥匙轮落地（TerrainType.PORTCULLIS_DORMANT），该条**摘出**名单、
        // 接上完整 tile——留痕前提失效，断言翻转为新事实（F-2c 同款）。
        expect(DF_MISSING_TILES, 'V-2b-6 后 DF_OPEN_PORTCULLIS 已摘出缺 tile 名单').not.toContain(DF.DF_OPEN_PORTCULLIS);
        {
            const op = DUNGEON_FEATURE_CATALOG[DF.DF_OPEN_PORTCULLIS]!;
            expect(op.tile).toBe(C.PORTCULLIS_DORMANT);
            expect(() => catalogFeature(DF.DF_OPEN_PORTCULLIS)).not.toThrow();
        }
        // V-2b-6 新登记的两条（越界守卫：一条都不能漏抄）。
        for (const d of [DF.DF_SHOW_POISON_GAS_VENT, DF.DF_POISON_GAS_VENT_OPEN]) {
            expect(DF_MISSING_TILES, `U17d DF[${d}] 已恢复载体`).not.toContain(d);
            expect(() => catalogFeature(d)).not.toThrow();
        }
        // V-2b-4 新登记的七条（越界守卫：一条都不能漏抄）。
        // ★ V-2b-7：其中 DF_LUMINESCENT_FUNGUS 与 DF_STATUE_SHATTER 两条的
        // tile（LUMINESCENT_FUNGUS / RUBBLE）本轮落地 → 从本清单摘出。
        for (const d of [DF.DF_ITEM_CAGE_CLOSE,
            DF.DF_ALTAR_COMMUTE, DF.DF_MAGIC_PIPING, DF.DF_ALTAR_RESURRECT]) {
            expect(DF_MISSING_TILES, `DF[${d}] 应在缺 tile 登记`).toContain(d);
        }
        for (const d of [DF.DF_LUMINESCENT_FUNGUS, DF.DF_STATUE_SHATTER, DF.DF_MACHINE_FLOOR_TRIGGER_REPEATING]) {
            expect(DF_MISSING_TILES, `DF[${d}] 的 tile 已落地，不得留在名单里`).not.toContain(d);
        }
    });
});

// ── B：activateMachine（CE Time.c:1173-1228）────────────────────────────────

describe('V-2b-3 B：activateMachine（CE :1173-1228）', () => {
    it('B1 对抗：机器号过滤——machine 1 的激活不通电 machine 2（漏掉 machineNumber 判据即红）', () => {
        const g = wallGrid();
        g.setTerrain(3, 3, C.GAS_TRAP_PARALYSIS, '◊', 0xdd66aa);
        g.setTerrain(5, 5, C.GAS_TRAP_PARALYSIS, '◊', 0xdd66aa);
        g.setTerrain(9, 9, C.GAS_TRAP_PARALYSIS, '◊', 0xdd66aa);
        markMachine(g, [[3, 3], [5, 5]], 1);
        markMachine(g, [[9, 9]], 2);
        rng.seedRandomGenerator(20260920);
        const r = activateMachine(g, 1);
        expect(r.machineNumber).toBe(1);
        expect(r.poweredCells).toHaveLength(2);
        expect(r.poweredCells.map(p => `${p.x},${p.y}`).sort())
            .toEqual(['3,3', '5,5']);
        const m2 = g.getCell(9, 9)!;
        expect(m2.isPowered).toBe(false);
        expect(m2.machineNumber).toBe(2);
    });

    it('B2 对抗：两次洗牌无条件先掷（CE :1177-1180）——空机器/机器号 0 也掷 (W-1)+(H-1) 次', () => {
        const g = wallGrid();
        rng.seedRandomGenerator(20260920);
        const before = rng.randomNumbersGenerated;
        const r = activateMachine(g, 7); // 机器 7 不存在：扫描空转
        expect(r.poweredCells).toEqual([]);
        expect(rng.randomNumbersGenerated - before).toBe((g.width - 1) + (g.height - 1));
        const before0 = rng.randomNumbersGenerated;
        activateMachine(g, 0); // CE 语义：IS_IN_MACHINE 恒假，但洗牌照掷
        expect(rng.randomNumbersGenerated - before0).toBe((g.width - 1) + (g.height - 1));
    });

    it('B3 对抗：相互递归只进闸一次——双 wired 格机器的激活 RNG 恰为一次洗牌对（:1177-1180 + :1277）', () => {
        // 错误实现一：activateMachine 内不清 IS_POWERED（或 promoteTile 分支
        // 不看它）→ 相互递归无终止/二次洗牌 → RNG 翻倍，红。
        // 错误实现二：promoteTile 先激活后置位（CE :1277 顺序写反）→ 无限递归
        // （栈溢出/超时），红。
        const g = wallGrid();
        g.setTerrain(3, 3, C.MACHINE_GLYPH, '∷', 0x330d0d);
        g.setTerrain(7, 7, C.MACHINE_GLYPH, '∷', 0x330d0d);
        markMachine(g, [[3, 3], [7, 7]], 1);
        rng.seedRandomGenerator(20260920);
        const before = rng.randomNumbersGenerated;
        const r = promoteTile(g, 3, 3, L.DUNGEON, false);
        // V-2b-9d: glyph DF 已接线；单格 startProbability=0 不掷骰，
        // 洗牌对是唯一的 RNG 消耗源。
        expect(r.wired).not.toBeNull();
        // 触发格 (3,3) 的电由 promoteTile :1277 置位，activateMachine :1188
        // 的"未通电"条件跳过它——poweredCells 只含另一格（CE 字面）。
        expect(r.wired!.poweredCells).toEqual([{ x: 7, y: 7 }]);
        expect(rng.randomNumbersGenerated - before).toBe((g.width - 1) + (g.height - 1));
    });

    it('B4 对抗：逐层晋升（CE :1192-1196）——同格两个 wired 层都晋升（只晋升有效地形即红）', () => {
        const g = wallGrid();
        // 用 setTerrainLayer 绕过"每格一层"的 setter 约定，构造双 wired 层：
        // DUNGEON 层符文 + SURFACE 层已揭示触发板（均为 TM_IS_WIRED 载体）。
        g.setTerrainLayer(4, 4, L.DUNGEON, C.MACHINE_GLYPH);
        g.setTerrainLayer(4, 4, L.SURFACE, C.GAS_TRAP_PARALYSIS);
        markMachine(g, [[4, 4]], 1);
        rng.seedRandomGenerator(20260920);
        const r = activateMachine(g, 1);
        expect(r.poweredCells).toEqual([{ x: 4, y: 4 }]);
        expect(r.promotions).toHaveLength(2); // 两层各一次 promoteTile
        expect(r.promotions.map(p => p.layer).sort((a, b) => a - b))
            .toEqual([L.DUNGEON, L.SURFACE]);
        // V-2b-9d: 符文层（DUNGEON）成功晋升到 MACHINE_GLYPH_INACTIVE；
        // 触发板层（SURFACE）：promoteType '' → 无 DF、无缓办、地形不动
        //（板无 VANISHES，CE :382 原样）。
        const glyphLayer = r.promotions.find(p => p.layer === L.DUNGEON)!;
        const plateLayer = r.promotions.find(p => p.layer === L.SURFACE)!;
        expect(glyphLayer.deferred).toBeNull();
        expect(g.getCell(4, 4)!.layers[L.DUNGEON]).toBe(C.MACHINE_GLYPH_INACTIVE);
        expect(plateLayer.deferred).toBeNull();
        expect(plateLayer.df).toBeNull();
        expect(g.getCell(4, 4)!.layers[L.SURFACE]).toBe(C.GAS_TRAP_PARALYSIS);
    });
});

// ── C：circuitBreakersPreventActivation（CE Time.c:1230-1242）───────────────

describe('V-2b-3 C：circuitBreakersPreventActivation（CE :1230-1242）', () => {
    it('C1 对抗：断路器阻断激活——不洗牌、不耗 RNG、不置电（在洗牌后才查断路器即红）', () => {
        const g = wallGrid();
        g.setTerrain(3, 3, C.GAS_TRAP_PARALYSIS, '◊', 0xdd66aa);
        g.setTerrain(5, 5, C.FLOOR, '.', 0x888888);
        markMachine(g, [[3, 3], [5, 5]], 1);
        withEntry(C.FLOOR, { mechFlags: TM_IS_CIRCUIT_BREAKER }, () => {
            rng.seedRandomGenerator(20260920);
            const before = rng.randomNumbersGenerated;
            expect(circuitBreakersPreventActivation(g, 1)).toBe(true);
            const r = promoteTile(g, 3, 3, L.DUNGEON, false);
            // CE :1271-1273：断路器检查在分支条件里、先于 activateMachine 的
            // 洗牌——被阻断时零 RNG 消耗是可观测锚。
            expect(rng.randomNumbersGenerated - before).toBe(0);
            expect(r.wiredBranchHit).toBe(false);
            expect(r.wired).toBeNull();
            expect(g.getCell(3, 3)!.isPowered).toBe(false);
        });
    });

    it('C2 对抗：断路器只按机器号过滤——别的机器带断路器不阻断本机', () => {
        const g = wallGrid();
        g.setTerrain(3, 3, C.GAS_TRAP_PARALYSIS, '◊', 0xdd66aa);
        g.setTerrain(15, 15, C.FLOOR, '.', 0x888888);
        markMachine(g, [[3, 3]], 1);
        markMachine(g, [[15, 15]], 2);
        withEntry(C.FLOOR, { mechFlags: TM_IS_CIRCUIT_BREAKER }, () => {
            expect(circuitBreakersPreventActivation(g, 1)).toBe(false);
            rng.seedRandomGenerator(20260920);
            const r = promoteTile(g, 3, 3, L.DUNGEON, false);
            expect(r.wiredBranchHit).toBe(true);
            expect(r.wired!.machineNumber).toBe(1);
            expect(g.getCell(3, 3)!.machineNumber).toBe(1);
        });
    });
});

// ── D：wired 分支端到端 ──────────────────────────────────────────────────────

describe('V-2b-3 D：promoteTile wired 分支端到端（67/68 与 24 号的机器形态）', () => {
    it('D1 端到端 67/68：踩触发板 → 全机通电 → 两喷口逐层晋升、payoff 按 CE :865 链尾缺 tile 缓办响亮登记', () => {
        // U17d: preserve the original deferred-chain contract by explicitly injecting
        // its former missing-tail premise. Positive CE67/68 payoff is in u_17d_vents.
        const entry = DUNGEON_FEATURE_CATALOG[DF.DF_REVEAL_PARALYSIS_VENT_SILENTLY]!;
        const savedTile = entry.tile;
        Object.assign(entry, {tile: null});
        try {
        const g = floorGrid();
        g.setTerrain(4, 4, C.GAS_TRAP_PARALYSIS_HIDDEN, '.', 0x888888);
        g.setTerrain(9, 9, C.MACHINE_PARALYSIS_VENT_HIDDEN, '.', 0x888888);
        g.setTerrain(13, 7, C.MACHINE_PARALYSIS_VENT_HIDDEN, '.', 0x888888);
        markMachine(g, [[4, 4], [9, 9], [13, 7]], 5);
        rng.seedRandomGenerator(20260920);
        const r = promoteTile(g, 4, 4, L.DUNGEON, false);
        expect(r.wiredBranchHit).toBe(true);
        expect(r.wired!.machineNumber).toBe(5);
        // 触发板无 VANISHES（CE :381 原样）——板不消失，机器可反复触发。
        expect(g.getCell(4, 4)!.layers[L.DUNGEON]).toBe(C.GAS_TRAP_PARALYSIS_HIDDEN);
        expect(r.wired!.poweredCells.map(p => `${p.x},${p.y}`).sort())
            .toEqual(['13,7', '9,9']);
        expect(r.wired!.promotions).toHaveLength(2);
        // 缓办口径：喷口 promoteType 链 DF_PARALYSIS_VENT_SPEW（tile 齐备）→
        // 链尾 DF_REVEAL_PARALYSIS_VENT_SILENTLY（tile MACHINE_PARALYSIS_VENT
        // web 无）→ 整次缓办、missing 落在链尾环。CE 的 payoff（麻痹气 + 喷口
        // 显形）在 tile 落地的轮次自动成形——登记表见 DF_MISSING_TILES。
        for (const p of r.wired!.promotions) {
            expect(p.deferred).not.toBeNull();
            expect(p.deferred!.missingDf).toBe(DF.DF_REVEAL_PARALYSIS_VENT_SILENTLY);
            expect(p.deferred!.missingCeTile).toBe('MACHINE_PARALYSIS_VENT');
            expect(g.getCell(p.x, p.y)!.layers[L.DUNGEON]).toBe(C.MACHINE_PARALYSIS_VENT_HIDDEN);
            expect(g.getCell(p.x, p.y)!.volume).toBe(0);
        }
        // 电散尽（CE :1281-1285）。
        expect(g.getCell(4, 4)!.isPowered).toBe(false);
        expect(g.getCell(9, 9)!.isPowered).toBe(false);
        } finally { Object.assign(entry, {tile: savedTile}); }
    });

    it('D1b 对抗：T_IS_DF_TRAP 载体踩上触发的 CE 形态——promoteTile 即通电，与是否先 spawn fireType 无关', () => {
        // CE Time.c:253-267：T_IS_DF_TRAP 分支对 fireType=0 的板 spawn 目录 {0}
        // 空条目后照样 promoteTile(layer)——wired 分支照常命中。错误实现
        // "fireType 为 0 就跳过整段"会让 67/68 的板永远不通电，红。
        const g = floorGrid();
        g.setTerrain(6, 6, C.GAS_TRAP_PARALYSIS, '◊', 0xdd66aa);
        markMachine(g, [[6, 6]], 3);
        rng.seedRandomGenerator(20260920);
        const r = promoteTile(g, 6, 6, L.DUNGEON, false);
        expect(r.wiredBranchHit).toBe(true);
        // 单格机器：触发格的电由 :1277 置位、:1281 清除——activateMachine 的
        // 扫描（:1188 未通电条件）无可命中格，poweredCells 为空（CE 字面）。
        expect(r.wired!.machineNumber).toBe(3);
        expect(r.wired!.poweredCells).toEqual([]);
    });

    it('D2 端到端 24 号：符文落地与同机通电都成功（V-2b-9d 闭合载体）', () => {
        const g = floorGrid();
        g.setTerrain(5, 5, C.MACHINE_GLYPH, '∷', 0x330d0d);
        g.setTerrain(8, 8, C.MACHINE_GLYPH, '∷', 0x330d0d);
        markMachine(g, [[5, 5], [8, 8]], 2);
        rng.seedRandomGenerator(20260920);
        const r = promoteTile(g, 5, 5, L.DUNGEON, false);
        // V-2b-9d: DF_INACTIVE_GLYPH 成功落地，同时保留独立 wired 分支。
        expect(r.deferred).toBeNull();
        expect(r.wiredBranchHit).toBe(true);
        // 触发格 (5,5) 不在 poweredCells（:1277 先置电、:1188 跳过）；另一符文
        // (8,8) 被通电并晋升——通电与 DF 结果互不阻塞（CE :1271 无前置守卫）。
        expect(r.wired!.poweredCells).toEqual([{ x: 8, y: 8 }]);
        const nested = r.wired!.promotions.find(p => p.x === 8 && p.y === 8)!;
        expect(nested.deferred).toBeNull();
        expect(g.getCell(8, 8)!.layers[L.DUNGEON]).toBe(C.MACHINE_GLYPH_INACTIVE);
        expect(g.getCell(5, 5)!.layers[L.DUNGEON]).toBe(C.MACHINE_GLYPH_INACTIVE);
    });

    it('D3 对抗：嵌套晋升不带电——activateMachine 内的 promoteTile 不再反向激活（wiredBranchHit=false）', () => {
        const g = floorGrid();
        g.setTerrain(4, 4, C.MACHINE_GLYPH, '∷', 0x330d0d);
        g.setTerrain(10, 10, C.MACHINE_GLYPH, '∷', 0x330d0d);
        markMachine(g, [[4, 4], [10, 10]], 2);
        rng.seedRandomGenerator(20260920);
        const r = promoteTile(g, 4, 4, L.DUNGEON, false);
        expect(r.wiredBranchHit).toBe(true);
        // (10,10) 的嵌套晋升由 activateMachine 发起，IS_POWERED 已置位 →
        // 分支不进（CE :1272）。若错误实现让嵌套再触发一次激活，B3 的 RNG
        // 断言已红；本条直接钉结果对象形状。
        const nested = r.wired!.promotions.find(p => p.x === 10 && p.y === 10)!;
        expect(nested.wiredBranchHit).toBe(false);
        expect(nested.wired).toBeNull();
    });
});

// ── E：BlueprintEngine（failsafe / wired 清除 / monsterId 条件 / 生产数据）───

const GRANITE_STYLE = { char: ' ', color: 0x333333 } as const;

function blankGrid(): Grid {
    const grid = new Grid(DCOLS, DROWS);
    for (let x = 0; x < DCOLS; x++) {
        for (let y = 0; y < DROWS; y++) {
            grid.setTerrain(x, y, C.GRANITE, GRANITE_STYLE.char, GRANITE_STYLE.color);
        }
    }
    return grid;
}

function rect(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
    const cells: Array<[number, number]> = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) cells.push([x, y]);
    return cells;
}

type Room = { cells: { x: number; y: number }[]; center: { x: number; y: number }; door: { x: number; y: number } | null };

function getApplyBp(engine: BlueprintEngine) {
    return (engine as unknown as {
        applyBlueprint(bp: BlueprintDef, r: Room): MachineResult | null;
    }).applyBlueprint;
}

const byId = (id: string): BlueprintDef =>
    (blueprintData as BlueprintDef[]).find(b => b.id === id)!;

describe('V-2b-3 E1：MF_REPEAT_UNTIL_NO_PROGRESS failsafe（§1.5，纯防御）', () => {
    function repeatBp(): BlueprintDef {
        return {
            id: 'test_repeat_loop',
            name: 'REPEAT+reqSpace0 死循环样本',
            depthRange: [1, 26],
            roomSize: [4, 8],
            frequency: 1,
            category: 'reward',
            flags: ['BP_ROOM', 'BP_REWARD'],
            features: [{
                terrain: 'BLOOD',
                instanceCount: [1, 1],
                minimumInstanceCount: 1,
                personalSpace: 0, // 不占格 → 候选域不缩减 → 理论不终止
                flags: ['MF_REPEAT_UNTIL_NO_PROGRESS'],
            }],
        };
    }
    it('对抗：reqSpace=0 的 REPEAT 轮次超限必须显式抛错，消息带蓝图 id/feature 序号/轮数', () => {
        rng.seedRandomGenerator(20260920);
        const grid = blankGrid();
        for (const [x, y] of rect(5, 5, 12, 10)) {
            grid.setTerrain(x, y, C.FLOOR, '.', 0x888888);
        }
        const engine = new BlueprintEngine(grid, 5, [repeatBp()]);
        const room: Room = {
            cells: rect(5, 5, 12, 10).map(([x, y]) => ({ x, y })),
            center: { x: 8, y: 7 },
            door: { x: 5, y: 7 },
        };
        let caught: unknown = null;
        try {
            getApplyBp(engine).call(engine, repeatBp(), room);
        } catch (e) {
            caught = e;
        }
        expect(caught, 'REPEAT+reqSpace0 必须被 failsafe 拦下（否则静默挂死）').toBeInstanceOf(Error);
        const msg = (caught as Error).message;
        expect(msg).toContain('test_repeat_loop');
        expect(msg).toContain('#0');
        expect(msg).toContain('1001'); // 上界 1000：第 1001 轮显式抛错
    });
});

describe('V-2b-3 E2：机器标记块的 wired 地形清除（CE Architect.c:1244-1250）', () => {
    it('对抗：机器吞并前就在格上的 PRESSURE_PLATE（带电）必须剪线清层；feature 自带的载体不受影响', () => {
        rng.seedRandomGenerator(20260920);
        const grid = blankGrid();
        const room = rect(6, 6, 15, 12);
        for (const [x, y] of room) grid.setTerrain(x, y, C.FLOOR, '.', 0x888888);
        // 内部预置两块"被吞并的旧板"（CE 注释：in case we stole them）。
        grid.setTerrain(7, 7, C.PRESSURE_PLATE, '_', 0x446644);
        grid.setTerrain(14, 11, C.PRESSURE_PLATE, '_', 0x446644);
        const bp: BlueprintDef = {
            id: 'test_plate_clear',
            name: 'plate clearing sample',
            depthRange: [1, 26],
            roomSize: [4, 40],
            frequency: 1,
            category: 'reward',
            flags: ['BP_ROOM', 'BP_REWARD'],
            features: [{
                terrain: 'BLOOD',
                instanceCount: [1, 1],
                minimumInstanceCount: 1,
                personalSpace: 1,
                flags: [],
            }],
        };
        const engine = new BlueprintEngine(grid, 5, [bp]);
        const r: Room = {
            cells: room.map(([x, y]) => ({ x, y })),
            center: { x: 10, y: 9 },
            door: { x: 6, y: 9 },
        };
        const result = getApplyBp(engine).call(engine, bp, r);
        expect(result).not.toBeNull();
        for (const [x, y] of [[7, 7], [14, 11]] as Array<[number, number]>) {
            expect(grid.getCell(x, y)!.layers[L.DUNGEON],
                `机器内部旧板 (${x},${y}) 必须被 CE :1244-1250 剪线`).toBe(C.FLOOR);
            expect(grid.getCell(x, y)!.machineNumber).toBe(result!.machineNumber);
        }
    });
});

describe('V-2b-3 E3：monster 生成条件 = CE Architect.c:1601 字面（monsterID 列非零）', () => {
    it('对抗：不带 MF_GENERATE_MONSTER 的 monsterId feature 也要生成（24/25 号图腾/守卫的判定）', () => {
        rng.seedRandomGenerator(20260920);
        const grid = blankGrid();
        const room = rect(6, 6, 15, 12);
        for (const [x, y] of room) grid.setTerrain(x, y, C.FLOOR, '.', 0x888888);
        const bp: BlueprintDef = {
            id: 'test_monster_id_only',
            name: 'monsterID column sample',
            depthRange: [1, 26],
            roomSize: [4, 40],
            frequency: 1,
            category: 'reward',
            flags: ['BP_ROOM', 'BP_REWARD'],
            features: [{
                monsterId: 'mirrored_totem',
                instanceCount: [1, 1],
                minimumInstanceCount: 1,
                personalSpace: 1,
                flags: [], // 刻意不带 MF_GENERATE_MONSTER（CE 数据如此）
            }],
        };
        const engine = new BlueprintEngine(grid, 5, [bp]);
        const r: Room = {
            cells: room.map(([x, y]) => ({ x, y })),
            center: { x: 10, y: 9 },
            door: { x: 6, y: 9 },
        };
        const result = getApplyBp(engine).call(engine, bp, r);
        expect(result).not.toBeNull();
        expect(result!.monsterSpawns).toHaveLength(1);
        expect(result!.monsterSpawns[0]!.monsterId).toBe('mirrored_totem');
    });
});

describe('V-2b-3 E4：六条生产蓝图 ≡ CE GlobalsBrogue.c 原表（:304-331/:445-451/:600-607）', () => {
    it('18 号 lever：深度/房径/频率/旗标/三 feature 全等（featureCt=3，含 ALTERNATIVE 组）', () => {
        const bp = byId('vestibule_secret_lever');
        expect(bp.depthRange).toEqual([4, 26]);
        expect(bp.roomSize).toEqual([1, 1]);
        expect(bp.frequency).toBe(8);
        expect(bp.category).toBe('vestibule');
        expect(bp.flags).toEqual(['BP_VESTIBULE']);
        expect(bp.features).toHaveLength(3);
        const f = (i: number): FeatureDef => bp.features[i]!;
        expect(f(0).terrain).toBe('WORM_TUNNEL_OUTER_WALL');
        expect(f(0).instanceCount).toEqual([1, 1]);
        expect(f(0).minimumInstanceCount).toBe(1);
        expect(f(0).personalSpace).toBe(1);
        expect(f(0).flags).toEqual(['MF_BUILD_AT_ORIGIN', 'MF_PERMIT_BLOCKING', 'MF_IMPREGNABLE', 'MF_ALTERNATIVE']);
        expect(f(1).terrain).toBe('PORTCULLIS_CLOSED');
        expect(f(1).personalSpace).toBe(3);
        expect(f(1).flags).toEqual(['MF_BUILD_AT_ORIGIN', 'MF_PERMIT_BLOCKING', 'MF_IMPREGNABLE', 'MF_ALTERNATIVE']);
        expect(f(2).terrain).toBe('WALL_LEVER_HIDDEN');
        expect(f(2).flags).toEqual(['MF_BUILD_IN_WALLS', 'MF_IN_PASSABLE_VIEW_OF_ORIGIN', 'MF_BUILD_ANYWHERE_ON_LEVEL', 'MF_IMPREGNABLE']);
    });

    it('22 号 throwing tutorial：plate 走 MACHINE_PRESSURE_PLATE 别名 + LIQUID 层 + DF 列缺口登记', () => {
        const bp = byId('vestibule_throwing_tutorial');
        expect(bp.depthRange).toEqual([1, 4]);
        expect(bp.roomSize).toEqual([70, 70]);
        expect(bp.frequency).toBe(8);
        expect(bp.flags).toEqual(['BP_VESTIBULE']);
        const f = bp.features[0]!;
        expect(f.terrain).toBe('MACHINE_PRESSURE_PLATE'); // web 无此地形名——别名经 TERRAIN_MAP
        expect(f.layer).toBe('LIQUID');
        expect(f.flags).toEqual(['MF_TREAT_AS_BLOCKING', 'MF_NOT_IN_HALLWAY']);
        // CE feature 的 DF 列 = DF_MEDIUM_HOLE（GlobalsBrogue.c:324）——web
        // FeatureDef 无 df 载体（V-2b-7），数据在 DungeonFeatureCatalog。
        expect(DUNGEON_FEATURE_CATALOG[DF.DF_MEDIUM_HOLE]).toBeDefined();
        expect(bp.features[1]!.terrain).toBe('PORTCULLIS_CLOSED');
        expect(bp.features[2]!.terrain).toBe('WORM_TUNNEL_OUTER_WALL');
    });

    it('24 号 beckoning：featureCt=3——CE 第 4 行 feature 是 featureCount 界外的死数据，不入表', () => {
        // CE GlobalsBrogue.c:332-337：featureCount=3 但 initializer 有 4 行；
        // Architect.c:1327 的循环只走前 3 行——第 4 行（MACHINE_GLYPH {3,5}）
        // 是 CE 死数据。错误实现"照抄 4 行"会多建一种 glyph，红。
        const bp = byId('vestibule_beckoning_obstacle');
        expect(bp.depthRange).toEqual([5, 26]);
        expect(bp.roomSize).toEqual([15, 30]);
        expect(bp.frequency).toBe(8);
        expect(bp.flags).toEqual(['BP_VESTIBULE', 'BP_PURGE_INTERIOR', 'BP_OPEN_INTERIOR']);
        expect(bp.features).toHaveLength(3);
        expect(bp.features[0]!.terrain).toBe('DOOR');
        expect(bp.features[1]!.terrain).toBe('MACHINE_GLYPH');
        expect(bp.features[1]!.minimumInstanceCount).toBe(0); // CE minInsts 0
        expect(bp.features[1]!.flags).toEqual(['MF_NEAR_ORIGIN', 'MF_EVERYWHERE']);
        expect(bp.features[2]!.monsterId).toBe('mirrored_totem');
        expect(bp.features[2]!.personalSpace).toBe(3);
        expect(bp.features[2]!.flags).toEqual([
            'MF_TREAT_AS_BLOCKING', 'MF_NOT_IN_HALLWAY',
            'MF_IN_VIEW_OF_ORIGIN', 'MF_BUILD_ANYWHERE_ON_LEVEL',
        ]);
    });

    it('25 号 guardian：双 DOOR+守卫（ALTERNATIVE 组）+ 两批符文；minInsts=3 的 {10,10} 批次', () => {
        const bp = byId('vestibule_guardian_obstacle');
        expect(bp.depthRange).toEqual([6, 26]);
        expect(bp.roomSize).toEqual([25, 25]);
        expect(bp.flags).toEqual(['BP_VESTIBULE', 'BP_OPEN_INTERIOR']);
        expect(bp.features).toHaveLength(4);
        const f = (i: number): FeatureDef => bp.features[i]!;
        expect(f(0).terrain).toBe('DOOR');
        expect(f(0).monsterId).toBe('stone_guardian');
        expect(f(0).flags).toEqual(['MF_BUILD_AT_ORIGIN', 'MF_PERMIT_BLOCKING', 'MF_ALTERNATIVE']);
        expect(f(1).monsterId).toBe('winged_guardian');
        expect(f(2).terrain).toBe('MACHINE_GLYPH');
        expect(f(2).instanceCount).toEqual([10, 10]);
        expect(f(2).minimumInstanceCount).toBe(3);
        expect(f(3).flags).toEqual(['MF_EVERYWHERE', 'MF_PERMIT_BLOCKING', 'MF_NOT_IN_HALLWAY']);
    });

    it('67/68 号麻痹陷阱：freq 0 + BP_NO_INTERIOR_FLAG + 显/隐两版载体对位', () => {
        const r67 = byId('trap_paralysis_revealed');
        expect(r67.depthRange).toEqual([1, 40]); // {1, DEEPEST_LEVEL}
        expect(r67.roomSize).toEqual([35, 40]);
        expect(r67.frequency).toBe(0);
        expect(r67.flags).toEqual(['BP_NO_INTERIOR_FLAG']);
        expect(r67.features[0]!.terrain).toBe('GAS_TRAP_PARALYSIS');
        expect(r67.features[0]!.instanceCount).toEqual([1, 2]);
        expect(r67.features[1]!.terrain).toBe('MACHINE_PARALYSIS_VENT_HIDDEN');
        expect(r67.features[1]!.instanceCount).toEqual([3, 4]);
        expect(r67.features[1]!.minimumInstanceCount).toBe(2);
        const r68 = byId('trap_paralysis_hidden');
        expect(r68.features[0]!.terrain).toBe('GAS_TRAP_PARALYSIS_HIDDEN');
        expect(r68.features[1]!.terrain).toBe('MACHINE_PARALYSIS_VENT_HIDDEN');
    });

    it('22 号蓝图行使：MACHINE_PRESSURE_PLATE 别名 + 闸门族载体真实落格（vestibule 递归形态）', () => {
        rng.seedRandomGenerator(20260920);
        const grid = blankGrid();
        const room = rect(6, 6, 20, 13);
        for (const [x, y] of room) grid.setTerrain(x, y, C.FLOOR, '.', 0x888888);
        const bp = byId('vestibule_throwing_tutorial');
        const engine = new BlueprintEngine(grid, 2, [bp]);
        const r: Room = {
            cells: room.map(([x, y]) => ({ x, y })),
            center: { x: 13, y: 9 },
            door: { x: 6, y: 9 },
        };
        const result = getApplyBp(engine).call(engine, bp, r);
        expect(result, 'plate+闸门/蠕虫墙三个 minInsts=1 的 feature 应可落位').not.toBeNull();
        const all = room.map(([x, y]) => ({ x, y }));
        const countOf = (t: TerrainType): number =>
            all.filter(p => {
                const c = grid.getCell(p.x, p.y)!;
                return c.layers[L.DUNGEON] === t || c.layers[L.LIQUID] === t;
            }).length;
        expect(countOf(C.PRESSURE_PLATE)).toBe(1); // MF_TREAT_AS_BLOCKING 板，恰一实例
        expect(countOf(C.PORTCULLIS_CLOSED) + countOf(C.WORM_TUNNEL_OUTER_WALL)).toBe(1);
    });
});
