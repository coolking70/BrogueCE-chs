/**
 * src/test/c_4a_terrain_catalog.test.ts — C-4a：地形属性表 + 统一通行判据。
 *
 * 结构：src/engine/Map/TerrainCatalog.ts（CE tileCatalog 的 web 投影，
 * 每条含 CE 出处行号）+ 七个 CE 名字的派生判据。行为判据：本轮迁移
 * **只动答案不变的调用点**（terrainAllowsMove / Game.canMoveTo → 查表），
 * 全量测试必须不刷新 baseline 而绿。
 *
 * 用例分组：
 *   A. 旗标常量位级正确性（T_PATHING_BLOCKER 并集成员漏一员即红）；
 *   B. 表完整性（esbuild 只剥类型，缺键/拼写错在运行时钉死）；
 *   C. 派生判据语义（混用别名化 / flags 抄错的可观测后果）；
 *   D. 迁移安全性：查表实现 ≡ 旧硬编码清单，全 31 枚举逐位比对；
 *   E. 留痕：本轮明确不做的事（promote 字段零读者、setTerrain 启发式
 *      现状、Pathfinding cost 现状）——断言现状，注明由哪一轮反转；
 *   F. 干跑测量：Pathfinding.calculateMap 若改用 isPathingBlocker，
 *      15 种子 × D1-D26 的 cost 分歧表（只测量不修复，下一轮的输入）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TerrainType, Grid } from '../engine/Map/Grid';
import {
    TERRAIN_FLAGS,
    T_OBSTRUCTS_PASSABILITY, T_OBSTRUCTS_VISION, T_OBSTRUCTS_ITEMS,
    T_OBSTRUCTS_SURFACE_EFFECTS, T_OBSTRUCTS_GAS, T_OBSTRUCTS_DIAGONAL_MOVEMENT,
    T_SPONTANEOUSLY_IGNITES, T_AUTO_DESCENT, T_LAVA_INSTA_DEATH, T_IS_DF_TRAP,
    T_IS_FLAMMABLE, T_IS_FIRE, T_IS_DEEP_WATER, T_ENTANGLES,
    T_PATHING_BLOCKER, T_DIVIDES_LEVEL, T_LAKE_PATHING_BLOCKER,
    T_WAYPOINT_BLOCKER, T_OBSTRUCTS_SCENT, T_MOVES_ITEMS,
    T_OBSTRUCTS_EVERYTHING,
    TM_ALLOWS_SUBMERGING, TM_EXTINGUISHES_FIRE, TM_PROMOTES_WITH_KEY,
    TM_IS_SECRET, TM_VANISHES_UPON_PROMOTION, TM_STAND_IN_TILE,
    blocksPassability, isPathingBlocker, blocksVision,
    obstructsItems, obstructsDiagonalMovement, isDeepWater, isFlammable,
} from '../engine/Map/TerrainCatalog';
import { DijkstraMap, PDS_OBSTRUCTION, PDS_FORBIDDEN } from '../engine/Map/Pathfinding';
import { terrainAllowsMove } from '../engine/Map/Connectivity';
import { createHeadlessGame } from './harness';

const C = TerrainType;

/** 既有扫盲用的 15 种子清单（与 c_4a_0 / c_2_lakes_e2e / p1_29 / p1_33 同一口径）。 */
const SWEEP_SEEDS = [424242, 777, 20260913, 31337, 20260916, 1, 42, 999, 20260915, 55555, 2, 3, 5, 7, 11];

function collectFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) collectFiles(p, out);
        else if (/\.(ts|tsx|vue)$/.test(name)) out.push(p);
    }
    return out;
}

/** 旧硬编码清单（迁移前 Game.canMoveTo / Connectivity.terrainAllowsMove 的
 *  排除集，P1-38 口径）。迁移安全性的对抗锚点：判据或表任一方被改坏，
 *  describe D 即红。 */
const LEGACY_IMPASSABLE = new Set<TerrainType>([
    C.GRANITE, C.WALL, C.SECRET_DOOR, C.LOCKED_DOOR, C.WATER_DEEP,
]);

const legacyAllowsMove = (t: TerrainType): boolean => !LEGACY_IMPASSABLE.has(t);

describe('C-4a A：旗标常量位级正确性（CE Rogue.h 抄录）', () => {
    it('T_PATHING_BLOCKER 恰为七旗标并集：漏一员（popcount=6）或混入外员（≥8）都翻红', () => {
        // CE Rogue.h:1948 成员（逐个独立抄录，不引用 T_PATHING_BLOCKER 自身）：
        // PASSABILITY | AUTO_DESCENT | IS_DF_TRAP | LAVA_INSTA_DEATH |
        // IS_DEEP_WATER | IS_FIRE | SPONTANEOUSLY_IGNITES
        const members = [
            T_OBSTRUCTS_PASSABILITY,   // :1924 Fl(0)
            T_AUTO_DESCENT,            // :1931 Fl(7)
            T_IS_DF_TRAP,              // :1943 Fl(19)
            T_LAVA_INSTA_DEATH,        // :1932 Fl(8)
            T_IS_DEEP_WATER,           // :1937 Fl(13)
            T_IS_FIRE,                 // :1935 Fl(11)
            T_SPONTANEOUSLY_IGNITES,   // :1930 Fl(6)
        ];
        const union = members.reduce((a, b) => a | b, 0);
        expect(T_PATHING_BLOCKER).toBe(union);
        // 恰七位：任何成员漏抄/重复/混入都会改变 popcount。
        const popcount = (v: number) => {
            let n = 0;
            while (v) { n += v & 1; v >>>= 1; }
            return n;
        };
        expect(popcount(T_PATHING_BLOCKER), 'T_PATHING_BLOCKER 应恰置 7 位').toBe(7);
    });

    it('其余复合旗标逐个对位（Rogue.h:1947-1954）', () => {
        expect(T_OBSTRUCTS_SCENT).toBe(
            T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_VISION | T_AUTO_DESCENT |
            T_LAVA_INSTA_DEATH | T_IS_DEEP_WATER | T_SPONTANEOUSLY_IGNITES);
        expect(T_DIVIDES_LEVEL).toBe(
            T_OBSTRUCTS_PASSABILITY | T_AUTO_DESCENT | T_IS_DF_TRAP |
            T_LAVA_INSTA_DEATH | T_IS_DEEP_WATER);
        expect(T_LAKE_PATHING_BLOCKER).toBe(
            T_AUTO_DESCENT | T_LAVA_INSTA_DEATH | T_IS_DEEP_WATER |
            T_SPONTANEOUSLY_IGNITES);
        expect(T_WAYPOINT_BLOCKER).toBe(
            T_OBSTRUCTS_PASSABILITY | T_AUTO_DESCENT | T_IS_DF_TRAP |
            T_LAVA_INSTA_DEATH | T_IS_DEEP_WATER | T_SPONTANEOUSLY_IGNITES);
        expect(T_MOVES_ITEMS).toBe(T_IS_DEEP_WATER | T_LAVA_INSTA_DEATH);
        expect(T_OBSTRUCTS_EVERYTHING).toBe(
            T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_VISION | T_OBSTRUCTS_ITEMS |
            T_OBSTRUCTS_GAS | T_OBSTRUCTS_SURFACE_EFFECTS |
            T_OBSTRUCTS_DIAGONAL_MOVEMENT);
        // T_PATHING_BLOCKER ⊃ T_DIVIDES_LEVEL，且恰多 IS_FIRE 与
        // SPONTANEOUSLY_IGNITES 两位（CE 两定义的精确差）。
        expect(T_PATHING_BLOCKER & ~T_DIVIDES_LEVEL).toBe(T_IS_FIRE | T_SPONTANEOUSLY_IGNITES);
    });
});

describe('C-4a B：表完整性（esbuild 只剥类型，运行时钉死）', () => {
    it('全 TerrainType 键覆盖且字段结构齐全——拼写错/缺键在此翻红而非得 undefined', () => {
        const names = Object.keys(TerrainType).filter((k) => Number.isNaN(Number(k)));
        expect(names.length).toBe(31);
        for (const name of names) {
            const t = (TerrainType as unknown as Record<string, TerrainType>)[name]!;
            const entry = TERRAIN_FLAGS[t];
            expect(entry, `TERRAIN_FLAGS 缺 ${name}`).toBeDefined();
            expect(typeof entry!.flags, `${name}.flags`).toBe('number');
            expect(typeof entry!.mechFlags, `${name}.mechFlags`).toBe('number');
            expect(typeof entry!.chanceToIgnite, `${name}.chanceToIgnite`).toBe('number');
            expect(typeof entry!.fireType, `${name}.fireType`).toBe('string');
            expect(typeof entry!.discoverType, `${name}.discoverType`).toBe('string');
            expect(typeof entry!.promoteType, `${name}.promoteType`).toBe('string');
            expect(typeof entry!.promoteChance, `${name}.promoteChance`).toBe('number');
            expect(typeof entry!.webOnly, `${name}.webOnly`).toBe('boolean');
        }
    });

    it('webOnly 标记恰为 4 条：BOG / SIGN / RESET_PLATE / CHARRED_FLOOR，其余全 false', () => {
        const webOnly = Object.keys(TERRAIN_FLAGS)
            .map(Number)
            .filter((t) => TERRAIN_FLAGS[t as TerrainType]!.webOnly)
            .sort((a, b) => a - b);
        expect(webOnly).toEqual([C.BOG, C.SIGN, C.RESET_PLATE, C.CHARRED_FLOOR].sort((a, b) => a - b));
        // CE 对应地形的兜底值抽查：webOnly 写错（比如把 MUD 也标成 webOnly）
        // 或漏标都会在这里翻红。
        for (const t of [C.MUD, C.WATER_DEEP, C.CHASM, C.TRAP, C.LOCKED_DOOR, C.INERT_BRIMSTONE]) {
            expect(TERRAIN_FLAGS[t]!.webOnly, `${TerrainType[t]} 不应标 webOnly`).toBe(false);
        }
    });

    it('webOnly 地形的兜底旗标（写错即红）：BOG 可燃，SIGN/RESET_PLATE/CHARRED_FLOOR 零旗标', () => {
        // BOG：web 现行行为可燃（Gas.ts:59/142 与 GRASS/FOLIAGE 同列点火），
        // flags = T_IS_FLAMMABLE 是对现状的忠实记录。
        expect(TERRAIN_FLAGS[C.BOG]!.flags).toBe(T_IS_FLAMMABLE);
        expect(isFlammable(C.BOG)).toBe(true);
        // 三条零旗标 webOnly：若有人给 SIGN 抄了 SACRED_GLYPH 的 T_SACRED、
        // 或给 RESET_PLATE 抄了 MACHINE_PRESSURE_PLATE 的 T_IS_DF_TRAP，
        // 都会改变派生判据的答案——这里钉死零旗标。
        for (const t of [C.SIGN, C.RESET_PLATE, C.CHARRED_FLOOR]) {
            expect(TERRAIN_FLAGS[t]!.flags, `${TerrainType[t]} 应为零旗标`).toBe(0);
            expect(TERRAIN_FLAGS[t]!.mechFlags).toBe(0);
        }
    });
});

describe('C-4a C：派生判据语义（混用别名化 / 抄错的可观测后果）', () => {
    it('blocksPassability ≠ isPathingBlocker：CHASM/TRAP/LAVA/WATER_DEEP/INERT_BRIMSTONE 只被后者挡', () => {
        // 错误实现示例：把 isPathingBlocker 写成 blocksPassability 的别名
        // → CHASM/TRAP 断言翻红；反之把 blocksPassability 写成
        // isPathingBlocker 的别名 → DOOR/GRASS 断言翻红。
        const onlyPathing: TerrainType[] = [C.CHASM, C.TRAP, C.LAVA, C.WATER_DEEP, C.INERT_BRIMSTONE, C.PRESSURE_PLATE];
        for (const t of onlyPathing) {
            expect(isPathingBlocker(t), `${TerrainType[t]} 应是 pathing blocker`).toBe(true);
            expect(blocksPassability(t), `${TerrainType[t]} 不应挡通行（CE 不设 T_OBSTRUCTS_PASSABILITY）`).toBe(false);
        }
        // 两者一致的格子：EVERYTHING 系两个谓词都 true；普通地面两个都 false。
        for (const t of [C.GRANITE, C.WALL, C.SECRET_DOOR, C.LOCKED_DOOR]) {
            expect(blocksPassability(t) && isPathingBlocker(t), `${TerrainType[t]}`).toBe(true);
        }
        for (const t of [C.FLOOR, C.DOOR, C.GRASS, C.STAIRS_UP, C.OPEN_DOOR, C.WEB, C.BLOOD]) {
            expect(blocksPassability(t) || isPathingBlocker(t), `${TerrainType[t]} 两者皆 false`).toBe(false);
        }
    });

    it('blocksVision ≠ blocksPassability：FOLIAGE/DOOR 挡视线不挡路', () => {
        for (const t of [C.FOLIAGE, C.DOOR]) {
            expect(blocksVision(t), `${TerrainType[t]} 应挡视线`).toBe(true);
            expect(blocksPassability(t), `${TerrainType[t]} 不应挡通行`).toBe(false);
        }
        // EVERYTHING 系挡视线；普通地面不挡。
        for (const t of [C.GRANITE, C.WALL, C.SECRET_DOOR, C.LOCKED_DOOR]) {
            expect(blocksVision(t)).toBe(true);
        }
        for (const t of [C.FLOOR, C.GRASS, C.CHASM, C.WATER_DEEP, C.STAIRS_DOWN]) {
            expect(blocksVision(t), `${TerrainType[t]} 不应挡视线`).toBe(false);
        }
    });

    it('flags 抄错的可观测后果：T_IS_DEEP_WATER 只在深水；楼梯挡物品；蛛网缠绕', () => {
        // 示例错误实现：DEEP_WATER 漏抄 T_IS_DEEP_WATER（只留 T_IS_FLAMMABLE）
        // → isDeepWater(WATER_DEEP)=false → canMoveTo 放行深水 → D1 翻红。
        expect(isDeepWater(C.WATER_DEEP)).toBe(true);
        // 只迭代名字键（数字键是枚举的反向映射，取到的是名字字符串，
        // 传进查表函数会得 undefined——恰是任务书警告的 esbuild 陷阱）。
        const allNames = Object.keys(TerrainType).filter((k) => Number.isNaN(Number(k)));
        for (const name of allNames) {
            const t = (TerrainType as unknown as Record<string, TerrainType>)[name]!;
            if (t !== C.WATER_DEEP) {
                expect(isDeepWater(t), `${TerrainType[t]} 不应带 T_IS_DEEP_WATER`).toBe(false);
            }
        }
        // 楼梯：T_OBSTRUCTS_ITEMS | T_OBSTRUCTS_SURFACE_EFFECTS（Globals.c:333-334）
        expect(obstructsItems(C.STAIRS_DOWN)).toBe(true);
        expect(obstructsItems(C.STAIRS_UP)).toBe(true);
        expect(obstructsItems(C.FLOOR)).toBe(false);
        // 挡对角：EVERYTHING 系（含 DIAGONAL 位）；DOOR/FOLIAGE 不挡对角。
        for (const t of [C.GRANITE, C.WALL, C.SECRET_DOOR, C.LOCKED_DOOR]) {
            expect(obstructsDiagonalMovement(t), `${TerrainType[t]}`).toBe(true);
        }
        expect(obstructsDiagonalMovement(C.DOOR)).toBe(false);
        expect(obstructsDiagonalMovement(C.FOLIAGE)).toBe(false);
        // 蛛网：T_ENTANGLES（无派生判据暴露，直查表）。
        expect(TERRAIN_FLAGS[C.WEB]!.flags & T_ENTANGLES).toBeTruthy();
        expect(TERRAIN_FLAGS[C.GRASS]!.flags & T_ENTANGLES, 'GRASS 不应带 T_ENTANGLES').toBeFalsy();
    });

    it('mechFlags 抄录抽查：深水灭火/可潜、锁门要钥匙、密门 IS_SECRET', () => {
        expect(TERRAIN_FLAGS[C.WATER_DEEP]!.mechFlags &
            (TM_ALLOWS_SUBMERGING | TM_EXTINGUISHES_FIRE | TM_STAND_IN_TILE)).toBeTruthy();
        expect(TERRAIN_FLAGS[C.LOCKED_DOOR]!.mechFlags & TM_PROMOTES_WITH_KEY).toBeTruthy();
        expect(TERRAIN_FLAGS[C.SECRET_DOOR]!.mechFlags & TM_IS_SECRET).toBeTruthy();
        expect(TERRAIN_FLAGS[C.DOOR]!.mechFlags & TM_VANISHES_UPON_PROMOTION).toBeTruthy();
        expect(TERRAIN_FLAGS[C.CHASM]!.mechFlags).toBe(TM_STAND_IN_TILE);
    });
});

describe('C-4a D：迁移安全性——查表实现 ≡ 旧硬编码（全 31 枚举逐位）', () => {
    it('terrainAllowsMove（查表）≡ 旧排除清单 {GRANITE,WALL,SECRET_DOOR,LOCKED_DOOR,WATER_DEEP}', () => {
        const names = Object.keys(TerrainType).filter((k) => Number.isNaN(Number(k)));
        for (const name of names) {
            const t = (TerrainType as unknown as Record<string, TerrainType>)[name]!;
            expect(terrainAllowsMove(t), `${TerrainType[t]}`).toBe(legacyAllowsMove(t));
        }
    });

    it('Game.canMoveTo（查表）≡ 旧清单：合成格逐地形实测（含生成中出现不了的地形）', () => {
        const game = createHeadlessGame(424242);
        const canMoveTo = (game as unknown as { canMoveTo(x: number, y: number): boolean }).canMoveTo.bind(game);
        const names = Object.keys(TerrainType).filter((k) => Number.isNaN(Number(k)));
        for (const name of names) {
            const t = (TerrainType as unknown as Record<string, TerrainType>)[name]!;
            game.grid.setTerrain(20, 20, t);
            expect(canMoveTo(20, 20), `${TerrainType[t]}`).toBe(legacyAllowsMove(t));
        }
    });
});

describe('C-4a E：留痕（本轮明确不做的事，断言现状）', () => {
    // 验收方 C-4b 后翻转（原断言："生产代码零读取点"）。
    // C-4b 的 DungeonFeature.ts 合法地成为了 mechFlags 的第一个读者。
    //
    // ★ 同时加固了扫描正则 ★
    // 执行方当时为了让这条断言继续绿，把 `entry.mechFlags` 写成了
    // `const { mechFlags } = entry`——**语义不变、正则不匹配**。
    // 它如实申报了，但那样做会让留痕断言说谎：读者确实存在，断言仍报零读者，
    // 是一次自造的假绿。留痕测试若能被改写形态绕过，就不是门禁而是装饰。
    // 现在正则同时捕获点号读取与解构读取两种形态。
    const PROMOTE_FIELD_READERS = new Set([
        'engine/Map/DungeonFeature.ts',   // C-4b：mechFlags（cellIsPassableOrDoor 的密门/锁门豁免）
        'engine/Map/Promotion.ts',        // C-4c：promoteTile/两趟驱动读 promoteType/promoteChance/fireType/mechFlags（本文件 C 组同样钉其取值）
    ]);
    it('留痕（已按自带指示扩清单，C-4c）：promote/fire 类字段的生产读者只出现在白名单文件', () => {
        const srcDir = fileURLToPath(new URL('../', import.meta.url));
        const prodFiles = collectFiles(srcDir).filter((f) => !f.split(sep).includes('test'));
        const offenders: string[] = [];
        const FIELDS = 'fireType|discoverType|promoteType|promoteChance|chanceToIgnite|mechFlags';
        // 形态一：点号成员访问。形态二：解构（含重命名 { mechFlags: mf }）。
        const dotPattern = new RegExp(`\\.(${FIELDS})\\b`);
        const destructurePattern = new RegExp(`\\{[^}]*\\b(${FIELDS})\\b[^{]*\\}\\s*=`);
        for (const f of prodFiles) {
            const rel = relative(srcDir, f).split(sep).join('/');
            if (PROMOTE_FIELD_READERS.has(rel)) continue;
            readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
                const codeOnly = line.replace(/\/\/.*$/, '');
                if (dotPattern.test(codeOnly) || destructurePattern.test(codeOnly)) {
                    offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
                }
            });
        }
        expect(offenders, `promote/fire 类字段出现了白名单之外的生产读者：\n${offenders.join('\n')}`).toEqual([]);
    });

    it('留痕：setTerrain 启发式现状 = P1-38 分歧表（接 CE 判据的轮次须先更新测量报告再翻转本断言）', () => {
        // 现状（旧硬编码启发式，本轮不迁移因为答案会变）：
        //   isPassable = !(WALL|GRANITE|CHASM|SECRET_DOOR)
        //   isOpaque   =  WALL|GRANITE|DOOR|SECRET_DOOR
        // 与 CE 查表判据的两处分歧（P1-38 病灶）：LOCKED_DOOR 的 isPassable
        // 现状 true（CE blocksPassability=true）；CHASM 现状 false（CE false
        // ——但 isPathingBlocker=true）；isOpaque 对 LOCKED_DOOR 现状 false
        // （CE blocksVision=true）、对 FOLIAGE 现状 false（CE true）。
        const g = new Grid(40, 40);
        const names = Object.keys(TerrainType).filter((k) => Number.isNaN(Number(k)));
        for (const name of names) {
            const t = (TerrainType as unknown as Record<string, TerrainType>)[name]!;
            g.setTerrain(20, 20, t);
            const cell = g.getCell(20, 20)!;
            const wantPassable = !(t === C.WALL || t === C.GRANITE || t === C.CHASM || t === C.SECRET_DOOR);
            const wantOpaque = t === C.WALL || t === C.GRANITE || t === C.DOOR || t === C.SECRET_DOOR;
            expect(cell.isPassable, `${TerrainType[t]}.isPassable（现状启发式）`).toBe(wantPassable);
            expect(cell.isOpaque, `${TerrainType[t]}.isOpaque（现状启发式）`).toBe(wantOpaque);
        }
        // 病灶行单独点名（翻转变更时不可能漏看）：
        g.setTerrain(10, 10, C.LOCKED_DOOR);
        expect(g.getCell(10, 10)!.isPassable, 'LOCKED_DOOR 现状可通行（CE 为不可）').toBe(true);
        g.setTerrain(11, 10, C.CHASM);
        expect(g.getCell(11, 10)!.isPassable, 'CHASM 现状不可通行（CE 可走、坠层）').toBe(false);
    });

    it('留痕：Pathfinding.calculateMap cost 现状——深水/锁门/岩浆/陷阱 cost=1（C-4b 接 isPathingBlocker 后翻转为 PDS_OBSTRUCTION）', () => {
        // 现状口径：isPassable=false 的格按地形分流（WALL/GRANITE →
        // PDS_OBSTRUCTION，其余 → PDS_FORBIDDEN）；isPassable=true → cost=1。
        // 若改用 isPathingBlocker：blocker 全系 → PDS_OBSTRUCTION，
        // WATER_DEEP/LOCKED_DOOR/LAVA/TRAP/PRESSURE_PLATE/INERT_BRIMSTONE
        // 的 cost 将从 1 变 30000（距离图真变），CHASM/SECRET_DOOR 从
        // 29999 变 30000（仅数值）。影响规模见下方干跑测量用例。
        const buildCostOf = (t: TerrainType): number => {
            const g = new Grid(12, 12);
            g.setTerrain(6, 6, C.FLOOR); // 目标格必须可走，Dijkstra 才会启动
            g.setTerrain(5, 5, t);
            const dm = new DijkstraMap(12, 12);
            dm.calculateMap(g, 6, 6);
            return dm.links[5]![5]!.cost;
        };
        expect(buildCostOf(C.WALL)).toBe(PDS_OBSTRUCTION);
        expect(buildCostOf(C.GRANITE)).toBe(PDS_OBSTRUCTION);
        expect(buildCostOf(C.CHASM)).toBe(PDS_FORBIDDEN);
        expect(buildCostOf(C.SECRET_DOOR)).toBe(PDS_FORBIDDEN);
        for (const t of [C.WATER_DEEP, C.LOCKED_DOOR, C.LAVA, C.TRAP, C.PRESSURE_PLATE, C.INERT_BRIMSTONE, C.FLOOR]) {
            expect(buildCostOf(t), `${TerrainType[t]} 现状 cost`).toBe(1);
        }
    });
});

describe('C-4a F：干跑测量——calculateMap 改用 isPathingBlocker 的影响（只测量不修复）', () => {
    it('15 种子 × D1-D26：cost 图逐格分歧表（下一轮 C-4b 的输入）', () => {
        // 旧规则（现状 Pathfinding.calculateMap）与新规则（假想改查
        // isPathingBlocker）逐格比对。分歧分两类：
        //   - becomeBlocked：旧 cost=1（可走）→ 新 PDS_OBSTRUCTION，
        //     距离图/安全图/气味图的语义真变；
        //   - numericOnly：旧 PDS_FORBIDDEN → 新 PDS_OBSTRUCTION，
        //     两者都不进入传播，仅 cost 数值变（更新 map 时被
        //     `cost >= PDS_FORBIDDEN` 跳过，语义等价）。
        const nameT = (t: TerrainType) => TerrainType[t];
        const becomeBlocked = new Map<string, number>();
        const numericOnly = new Map<string, number>();
        let totalBlocked = 0;
        let totalNumeric = 0;
        const other: string[] = [];

        for (const seed of SWEEP_SEEDS) {
            const g: any = createHeadlessGame(seed);
            for (let d = 1; d <= 26; d++) {
                if (d > 1) { g.depth = d; g.generateDepth(false, false); }
                const grid: Grid = g.grid;
                for (let x = 1; x < grid.width - 1; x++) {
                    for (let y = 1; y < grid.height - 1; y++) {
                        const cell = grid.getCell(x, y)!;
                        const t = cell.terrain;
                        const oldCost = cell.isPassable
                            ? 1
                            : (t === C.WALL || t === C.GRANITE ? PDS_OBSTRUCTION : PDS_FORBIDDEN);
                        const newCost = isPathingBlocker(t) ? PDS_OBSTRUCTION : 1;
                        if (oldCost === newCost) continue;
                        if (oldCost === 1 && newCost === PDS_OBSTRUCTION) {
                            totalBlocked++;
                            becomeBlocked.set(nameT(t), (becomeBlocked.get(nameT(t)) ?? 0) + 1);
                        } else if (oldCost === PDS_FORBIDDEN && newCost === PDS_OBSTRUCTION) {
                            totalNumeric++;
                            numericOnly.set(nameT(t), (numericOnly.get(nameT(t)) ?? 0) + 1);
                        } else {
                            other.push(`seed=${seed} D${d} (${x},${y}) ${nameT(t)}: ${oldCost} → ${newCost}`);
                        }
                    }
                }
            }
        }

        // 弱不变量：分歧必须真实存在（若为 0，说明测量口径写错或表抄错）。
        expect(totalBlocked + totalNumeric, '新旧 cost 分歧总数应 > 0').toBeGreaterThan(0);
        expect(other, `未分类分歧（测量口径漏洞）：\n${other.slice(0, 20).join('\n')}`).toEqual([]);

        const fmt = (m: Map<string, number>) =>
            [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('，') || '（无）';
        console.log(
            `[C-4a 干跑测量] ${SWEEP_SEEDS.length} 种子 × D1-D26（每层内部格全扫）\n` +
            `  语义分歧（cost 1 → OBSTRUCTION，距离图将改变）：${totalBlocked} 格\n` +
            `    按地形：${fmt(becomeBlocked)}\n` +
            `  数值分歧（FORBIDDEN → OBSTRUCTION，均不可走，仅 cost 数值变）：${totalNumeric} 格\n` +
            `    按地形：${fmt(numericOnly)}`
        );
    });
});
