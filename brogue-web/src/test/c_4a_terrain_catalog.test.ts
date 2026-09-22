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
import { TerrainType, Grid, DungeonLayer as L, DRAW_PRIORITY, TERRAIN_HOME_LAYER, FIRE_TERRAIN_TYPES } from '../engine/Map/Grid';
import {
    TERRAIN_FLAGS,
    T_OBSTRUCTS_PASSABILITY, T_OBSTRUCTS_VISION, T_OBSTRUCTS_ITEMS,
    T_OBSTRUCTS_SURFACE_EFFECTS, T_OBSTRUCTS_GAS, T_OBSTRUCTS_DIAGONAL_MOVEMENT,
    T_SPONTANEOUSLY_IGNITES, T_AUTO_DESCENT, T_LAVA_INSTA_DEATH, T_IS_DF_TRAP,
    T_IS_FLAMMABLE, T_IS_FIRE, T_IS_DEEP_WATER, T_ENTANGLES,
    T_PATHING_BLOCKER, T_DIVIDES_LEVEL, T_LAKE_PATHING_BLOCKER,
    T_WAYPOINT_BLOCKER, T_OBSTRUCTS_SCENT, T_MOVES_ITEMS,
    T_OBSTRUCTS_EVERYTHING,
    T_SACRED,
    T_CAUSES_DAMAGE, T_CAUSES_CONFUSION, T_CAUSES_PARALYSIS,
    TM_ALLOWS_SUBMERGING, TM_EXTINGUISHES_FIRE, TM_PROMOTES_WITH_KEY,
    TM_IS_SECRET, TM_VANISHES_UPON_PROMOTION, TM_STAND_IN_TILE, TM_VISUALLY_DISTINCT,
    TM_GAS_DISSIPATES, TM_GAS_DISSIPATES_QUICKLY,
    TM_EXPLOSIVE_PROMOTE,
    TM_PROMOTES_ON_CREATURE, TM_REFLECTS_BOLTS,
    TM_CONNECTS_LEVEL,
    blocksPassability, isPathingBlocker, blocksVision,
    obstructsItems, obstructsDiagonalMovement, isDeepWater, isFlammable,
    isFireTerrain,
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
    C.FLOOD_WATER_DEEP,
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
        // F-1：PLAIN_FIRE 入列（CE Globals.c:492），31 → 32。
        // F-2a：EMBERS/ASH 入列（CE Globals.c:469/461，火寿命链载体），32 → 34。
        // G-1：POISON_GAS/CONFUSION_GAS/STEAM 入列（CE Globals.c:502/503/508，
        // 气体迁层的三种可产气体载体），34 → 37。
        // G-2：GAS_FIRE/METHANE_GAS 入列（CE Globals.c:495/507，燃气之火 +
        // 第六种气体 tile），37 → 39。
        // G-3：PARALYSIS_GAS 入列（CE Globals.c:506，麻痹气体——载体 =
        // potion_of_paralysis 改线），39 → 40。
        // F-2c：GAS_EXPLOSION 入列（CE Globals.c:496，爆炸之火——载体 =
        // DF_EXPLOSION_FIRE / DF_BLOAT_EXPLOSION），40 → 41。
        // C-5：HOLE/HOLE_EDGE 入列（CE Globals.c:442/444，洞族——载体 =
        // DF_HOLE_POTION / DF_HOLE_2，下坠药水与 pit bloat 的坠落载体），41 → 43。
        // B-3：FORCEFIELD/FORCEFIELD_MELT/CRYSTAL_WALL/SACRED_GLYPH 入列
        //（CE Globals.c:477/478/338/479，三张卷轴 negation/sanctuary/shattering
        // 的载体地形），43 → 47。
        // V-2b-2b：CARPET/STATUE_INERT/PEDESTAL/STATUE_INERT_DOORWAY/
        // WOODEN_BARRICADE/TRAP_DOOR_HIDDEN 入列（CE Globals.c:325/351/369/
        // 550/341/379，机器蓝图 3/4/5/19/20/23 号的地形载体；
        // FUNGUS_FOREST 以 FOLIAGE 别名承载，不加成员），47 → 53。
        // V-2b-3：wired 触发网络的九个载体入列（CE Globals.c:339/342/347/381/
        // 382/383/398/404/570，蓝图 18/22/24/25/67/68 号的机器通货：
        // MACHINE_GLYPH / PORTCULLIS_CLOSED / WORM_TUNNEL_OUTER_WALL /
        // WALL_LEVER_HIDDEN / GAS_TRAP_PARALYSIS / GAS_TRAP_PARALYSIS_HIDDEN /
        // MACHINE_PARALYSIS_VENT_HIDDEN / MACHINE_METHANE_VENT_HIDDEN /
        // PILOT_LIGHT_DORMANT），53 → 62。逐字段钉死在下方 V-2b-3 块与
        // v_2b_3_wired A 组（对抗：抄错任一位即红）。
        // V-2b-4：祭坛族轮七条入列（CE Globals.c:364/368/532/538/529/354/337，
        // 蓝图 1/2/6/7/15/26/28 号的地形载体：ALTAR_CAGE_OPEN /
        // ALTAR_CAGE_RETRACTABLE / COMMUTATION_ALTAR / RESURRECTION_ALTAR /
        // AMULET_SWITCH / STATUE_INSTACRACK / TORCH_WALL），62 → 69。逐字段
        // 钉死在 v_2b_4_altars 的 A 组（对抗：抄错任一位即红）。
        // V-2b-5：休眠唤醒轮七条入列（CE Globals.c:352/356/357/361/366/551/559，
        // 蓝图 21/29/41/43/50/56/69/70 号的地形载体），69 → 76。逐字段
        // 钉死在 v_2b_5_dormant 的 A1 组（对抗：抄错任一位即红）。
        // V-2b-6：钥匙轮六条入列（CE Globals.c:340/350/370/371/395/464，
        // 蓝图 10/35/40 号的地形载体），76 → 82。逐字段钉死在
        // v_2b_6_keys 的 A 组（对抗：抄错任一位即红）。
        // V-2b-7：DF 特征系统轮 19 条入列（CE Globals.c:355/363/367/372/377/
        // 387/448/449/450/457/465/473/484/486/543/546/547/568/573，13 条新
        // 蓝图 9/11/12/30/33/42/45/46/47/49/53/55/57 号的地形载体 + 其 DF 链
        // 落点 tile），82 → 101。逐字段钉死在 v_2b_7_features 的 A 组。
        // V-2b-8：BLOODFLOWER_STALK / HAVEN_BEDROLL 两条新成员，101 → 103；
        // BONES 与 SACRED_GLYPH 均复用既有成员。
        // V-2b-9a：FLOOR_FLOODABLE / CHASM_WITH_HIDDEN_BRIDGE / LAVA_RETRACTABLE /
        // MUD_FLOOR / MUD_WALL / MUD_DOORWAY / MARBLE_FLOOR / FLOOD_TRAP /
        // ELECTRIC_CRYSTAL_OFF / TURRET_LEVER / HAUNTED_TORCH_DORMANT /
        // 9b 再补九个环境效果活动态/落点，115 → 124；补完轮闭合
        // MACHINE_CHASM_EDGE 与 DF_PUDDLE 的载体，124 → 126。
        expect(names.length).toBe(126);
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

    it('F-1 新增条目：PLAIN_FIRE（CE Globals.c:492）逐字段钉死', () => {
        // F-2a 翻正：promoteChance 0 → 500（CE 原值）。F-1 曾记 0 保
        // burnDuration 倒计时模型；F-2a 起火寿命 = 概率衰老（5%/回合 →
        // EMBERS，几何分布均值约 20 回合），由 runPromotionUpdate 驱动。
        // 本断言的注释与反向（照抄成别的值）都以 CE 行为准。
        // glowLight（FIRE_LIGHT）web 无对应列，登记不迁移。
        expect(TERRAIN_FLAGS[C.PLAIN_FIRE]!.flags).toBe(T_IS_FIRE);
        expect(TERRAIN_FLAGS[C.PLAIN_FIRE]!.mechFlags).toBe(
            TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_VISUALLY_DISTINCT
        );
        expect(TERRAIN_FLAGS[C.PLAIN_FIRE]!.chanceToIgnite).toBe(0);
        expect(TERRAIN_FLAGS[C.PLAIN_FIRE]!.fireType).toBe('');
        expect(TERRAIN_FLAGS[C.PLAIN_FIRE]!.discoverType).toBe('');
        expect(TERRAIN_FLAGS[C.PLAIN_FIRE]!.promoteType).toBe('DF_EMBERS');
        expect(TERRAIN_FLAGS[C.PLAIN_FIRE]!.promoteChance, 'F-2a 翻正：CE 原值 500（5%/回合衰老）').toBe(500);
        expect(TERRAIN_FLAGS[C.PLAIN_FIRE]!.webOnly).toBe(false);
        // 派生判据：是火、不可燃（火地形自身 chanceToIgnite=0——点火概率
        // 住在可燃地形一侧，CE 十种火地形无一例外）、不挡通行/视线。
        expect(isFireTerrain(C.PLAIN_FIRE)).toBe(true);
        expect(isFlammable(C.PLAIN_FIRE)).toBe(false);
        expect(blocksPassability(C.PLAIN_FIRE)).toBe(false);
        expect(blocksVision(C.PLAIN_FIRE)).toBe(false);
        // drawPriority 与归属层（CE：prio 10 压草 60、输门 8；DF 落 SURFACE）。
        expect(DRAW_PRIORITY[C.PLAIN_FIRE]).toBe(10);
        expect(TERRAIN_HOME_LAYER[C.PLAIN_FIRE]).toBe(L.SURFACE);
    });

    it('F-2a 新增条目：EMBERS（CE Globals.c:469）与 ASH（:461）逐字段钉死', () => {
        // EMBERS：余烬——零旗标是 CE 的关键事实（flags 列字面为 (0)）：
        // 余烬不是火（不点燃邻格、不可燃），只是 PLAIN_FIRE 衰老的落点、
        // 自己再以 3%/回合衰老成 ASH。捕获的错误实现：给 EMBERS 抄上
        // T_IS_FIRE（它会重新参与火段）或漏掉 promoteChance=300（灰烬链断）。
        expect(TERRAIN_FLAGS[C.EMBERS]!.flags).toBe(0);
        expect(TERRAIN_FLAGS[C.EMBERS]!.mechFlags).toBe(TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION);
        expect(TERRAIN_FLAGS[C.EMBERS]!.chanceToIgnite).toBe(0);
        expect(TERRAIN_FLAGS[C.EMBERS]!.fireType).toBe('DF_PLAIN_FIRE');
        expect(TERRAIN_FLAGS[C.EMBERS]!.promoteType).toBe('DF_ASH');
        expect(TERRAIN_FLAGS[C.EMBERS]!.promoteChance).toBe(300);
        expect(isFireTerrain(C.EMBERS), '余烬不是火（CE flags=(0)）').toBe(false);
        expect(isFlammable(C.EMBERS)).toBe(false);
        expect(DRAW_PRIORITY[C.EMBERS]).toBe(70);
        expect(TERRAIN_HOME_LAYER[C.EMBERS]).toBe(L.SURFACE);

        // ASH：终点载体——零旗标、零衰老（CE 里永久留存）。
        expect(TERRAIN_FLAGS[C.ASH]!.flags).toBe(0);
        expect(TERRAIN_FLAGS[C.ASH]!.mechFlags).toBe(TM_STAND_IN_TILE);
        expect(TERRAIN_FLAGS[C.ASH]!.promoteType).toBe('');
        expect(TERRAIN_FLAGS[C.ASH]!.promoteChance).toBe(0);
        expect(DRAW_PRIORITY[C.ASH]).toBe(80);
        expect(TERRAIN_HOME_LAYER[C.ASH]).toBe(L.SURFACE);
    });

    it('G-1 新增条目：POISON_GAS（Globals.c:502）/ CONFUSION_GAS（:503）/ STEAM（:508）逐字段钉死', () => {
        // 气体 tile 的关键事实：
        //   - 消散档位是机械旗标（updateVolumetricMedia 每轮读）：POISON
        //     SLOW（20%）、CONFUSION/STEAM QUICK（50%）——web 旧"定值消散"
        //     下 POISON≡CONFUSION 的恒等式在此破缺；
        //   - POISON/CONFUSION 可燃（ign 100，fireType DF_GAS_FIRE），
        //     STEAM 不可燃（flags 无 T_IS_FLAMMABLE）；
        //   - drawPriority 全 35；归属层全 GAS。
        // 捕获的错误实现：给 STEAM 抄 T_IS_FLAMMABLE、给 POISON 抄 QUICK
        // 档、把 drawPriority 写成别的值。
        expect(TERRAIN_FLAGS[C.POISON_GAS]!.flags).toBe(T_IS_FLAMMABLE | T_CAUSES_DAMAGE);
        expect(TERRAIN_FLAGS[C.POISON_GAS]!.mechFlags).toBe(TM_STAND_IN_TILE | TM_GAS_DISSIPATES);
        expect(TERRAIN_FLAGS[C.POISON_GAS]!.chanceToIgnite).toBe(100);
        expect(TERRAIN_FLAGS[C.POISON_GAS]!.fireType).toBe('DF_GAS_FIRE');
        expect(TERRAIN_FLAGS[C.POISON_GAS]!.promoteChance).toBe(0);
        expect(TERRAIN_FLAGS[C.CONFUSION_GAS]!.flags).toBe(T_IS_FLAMMABLE | T_CAUSES_CONFUSION);
        expect(TERRAIN_FLAGS[C.CONFUSION_GAS]!.mechFlags).toBe(TM_STAND_IN_TILE | TM_GAS_DISSIPATES_QUICKLY);
        expect(TERRAIN_FLAGS[C.CONFUSION_GAS]!.chanceToIgnite).toBe(100);
        expect(TERRAIN_FLAGS[C.CONFUSION_GAS]!.fireType).toBe('DF_GAS_FIRE');
        expect(TERRAIN_FLAGS[C.STEAM]!.flags).toBe(T_CAUSES_DAMAGE);
        expect(TERRAIN_FLAGS[C.STEAM]!.mechFlags).toBe(TM_STAND_IN_TILE | TM_GAS_DISSIPATES_QUICKLY);
        expect(TERRAIN_FLAGS[C.STEAM]!.chanceToIgnite).toBe(0);
        expect(isFlammable(C.STEAM), 'STEAM 不可燃（CE flags 无 T_IS_FLAMMABLE）').toBe(false);
        for (const t of [C.POISON_GAS, C.CONFUSION_GAS, C.STEAM]) {
            expect(DRAW_PRIORITY[t], `${TerrainType[t]} prio`).toBe(35);
            expect(TERRAIN_HOME_LAYER[t], `${TerrainType[t]} 归属`).toBe(L.GAS);
        }
    });

    it('G-2 新增条目：GAS_FIRE（Globals.c:495）/ METHANE_GAS（:507）逐字段钉死', () => {
        // 捕获的错误实现：
        //   - 给 GAS_FIRE 抄上 T_IS_FLAMMABLE（CE ign 列为 0——火地形不是
        //     可燃物，给它可燃会让火段点燃它自己）；
        //   - GAS_FIRE 的 promoteChance 抄成 PLAIN_FIRE 的 500（CE 原值
        //     8000——燃气之火 80%/回合自熄，比明火衰老快 16 倍）；
        //   - 给 METHANE_GAS 抄任何消散旗标（CE 沼气永不自散）或漏抄
        //     TM_EXPLOSIVE_PROMOTE（爆轰分支的载体，漏了爆轰永远不可达）。
        expect(TERRAIN_FLAGS[C.GAS_FIRE]!.flags).toBe(T_IS_FIRE);
        expect(TERRAIN_FLAGS[C.GAS_FIRE]!.mechFlags).toBe(
            TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_VISUALLY_DISTINCT
        );
        expect(TERRAIN_FLAGS[C.GAS_FIRE]!.chanceToIgnite).toBe(0);
        expect(TERRAIN_FLAGS[C.GAS_FIRE]!.fireType).toBe('');
        expect(TERRAIN_FLAGS[C.GAS_FIRE]!.promoteType).toBe('');
        expect(TERRAIN_FLAGS[C.GAS_FIRE]!.promoteChance, 'CE 原值 8000（80%/回合自熄）').toBe(8000);
        expect(TERRAIN_FLAGS[C.METHANE_GAS]!.flags).toBe(T_IS_FLAMMABLE);
        expect(TERRAIN_FLAGS[C.METHANE_GAS]!.mechFlags).toBe(
            TM_STAND_IN_TILE | TM_EXPLOSIVE_PROMOTE
        );
        expect(TERRAIN_FLAGS[C.METHANE_GAS]!.chanceToIgnite).toBe(100);
        expect(TERRAIN_FLAGS[C.METHANE_GAS]!.fireType).toBe('DF_GAS_FIRE');
        expect(TERRAIN_FLAGS[C.METHANE_GAS]!.promoteType).toBe('DF_EXPLOSION_FIRE');
        expect(TERRAIN_FLAGS[C.METHANE_GAS]!.promoteChance).toBe(0);
        expect(DRAW_PRIORITY[C.GAS_FIRE]).toBe(10);
        expect(DRAW_PRIORITY[C.METHANE_GAS]).toBe(35);
        expect(TERRAIN_HOME_LAYER[C.GAS_FIRE], '燃气之火是 SURFACE 火地形（G-1 §八.1）').toBe(L.SURFACE);
        expect(TERRAIN_HOME_LAYER[C.METHANE_GAS]).toBe(L.GAS);
    });

    it('G-3 新增条目：PARALYSIS_GAS（CE Globals.c:506）逐字段钉死', () => {
        // 捕获的错误实现：
        //   - 漏抄 T_CAUSES_PARALYSIS（效果判定失效——站进麻痹气不上状态）；
        //   - 消散档抄 SLOW（CE 是 QUICK，Globals.c:506 第 12 列
        //     TM_GAS_DISSIPATES_QUICKLY）；
        //   - 漏抄 T_IS_FLAMMABLE / fireType（CE 与 POISON/CONFUSION 同链：
        //     ign 100、被点燃 → DF_GAS_FIRE）；
        //   - drawPriority / 归属层写错。
        expect(TERRAIN_FLAGS[C.PARALYSIS_GAS]!.flags).toBe(T_IS_FLAMMABLE | T_CAUSES_PARALYSIS);
        expect(TERRAIN_FLAGS[C.PARALYSIS_GAS]!.mechFlags).toBe(TM_STAND_IN_TILE | TM_GAS_DISSIPATES_QUICKLY);
        expect(TERRAIN_FLAGS[C.PARALYSIS_GAS]!.chanceToIgnite).toBe(100);
        expect(TERRAIN_FLAGS[C.PARALYSIS_GAS]!.fireType).toBe('DF_GAS_FIRE');
        expect(TERRAIN_FLAGS[C.PARALYSIS_GAS]!.promoteType).toBe('');
        expect(TERRAIN_FLAGS[C.PARALYSIS_GAS]!.promoteChance).toBe(0);
        expect(DRAW_PRIORITY[C.PARALYSIS_GAS]).toBe(35);
        expect(TERRAIN_HOME_LAYER[C.PARALYSIS_GAS]).toBe(L.GAS);
    });

    it('B-3 新增条目：FORCEFIELD（Globals.c:477）/ FORCEFIELD_MELT（:478）逐字段钉死', () => {
        // 捕获的错误实现：
        //   - FORCEFIELD 的 promoteChance 写成正数 200（CE 是 **-200**，负值 =
        //     扩散型晋升：Promotion.ts 每个合格 4 向开敞邻居 +200/回合）；
        //   - promoteType 漏 DF_FORCEFIELD_MELT（消融链断——水晶永不融化）；
        //   - 漏 TM_PROMOTES_ON_CREATURE 或 TM_VANISHES_UPON_PROMOTION；
        //   - 旗标漏 T_OBSTRUCTS_GAS / T_OBSTRUCTS_DIAGONAL_MOVEMENT；
        //   - glowLight 漏 FORCEFIELD_LIGHT。
        for (const t of [C.FORCEFIELD, C.FORCEFIELD_MELT]) {
            expect(TERRAIN_FLAGS[t]!.flags).toBe(
                T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_GAS | T_OBSTRUCTS_DIAGONAL_MOVEMENT);
            expect(TERRAIN_FLAGS[t]!.mechFlags).toBe(
                TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_PROMOTES_ON_CREATURE);
            expect(TERRAIN_FLAGS[t]!.chanceToIgnite).toBe(0);
            expect(TERRAIN_FLAGS[t]!.glowLight).toBeDefined();
        }
        expect(TERRAIN_FLAGS[C.FORCEFIELD]!.promoteType).toBe('DF_FORCEFIELD_MELT');
        expect(TERRAIN_FLAGS[C.FORCEFIELD]!.promoteChance).toBe(-200);
        expect(TERRAIN_FLAGS[C.FORCEFIELD_MELT]!.promoteType).toBe('');
        expect(TERRAIN_FLAGS[C.FORCEFIELD_MELT]!.promoteChance).toBe(-10000);
        expect(DRAW_PRIORITY[C.FORCEFIELD]).toBe(0);
        expect(DRAW_PRIORITY[C.FORCEFIELD_MELT]).toBe(0);
        expect(TERRAIN_HOME_LAYER[C.FORCEFIELD]).toBe(L.SURFACE);
        expect(TERRAIN_HOME_LAYER[C.FORCEFIELD_MELT]).toBe(L.SURFACE);
    });

    it('B-3 新增条目：CRYSTAL_WALL（Globals.c:338）与 SACRED_GLYPH（:479）逐字段钉死', () => {
        // CRYSTAL_WALL 捕获的错误实现：
        //   - 抄成挡视线（CE flags 无 T_OBSTRUCTS_VISION——水晶墙后看得见，
        //     这正是 crystalize 打通视野断言的地形面前提）；
        //   - 漏 TM_REFLECTS_BOLTS；fireType 漏 DF_PLAIN_FIRE（CE 数据如此）；
        //   - glowLight 漏 CRYSTAL_WALL_LIGHT；drawPriority 写非 0。
        expect(TERRAIN_FLAGS[C.CRYSTAL_WALL]!.flags).toBe(
            T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_ITEMS | T_OBSTRUCTS_GAS |
            T_OBSTRUCTS_SURFACE_EFFECTS | T_OBSTRUCTS_DIAGONAL_MOVEMENT);
        expect(TERRAIN_FLAGS[C.CRYSTAL_WALL]!.mechFlags).toBe(TM_STAND_IN_TILE | TM_REFLECTS_BOLTS);
        expect(TERRAIN_FLAGS[C.CRYSTAL_WALL]!.fireType).toBe('DF_PLAIN_FIRE');
        expect(TERRAIN_FLAGS[C.CRYSTAL_WALL]!.promoteType).toBe('');
        expect(TERRAIN_FLAGS[C.CRYSTAL_WALL]!.promoteChance).toBe(0);
        expect(DRAW_PRIORITY[C.CRYSTAL_WALL]).toBe(0);
        expect(TERRAIN_HOME_LAYER[C.CRYSTAL_WALL]).toBe(L.DUNGEON);
        // SACRED_GLYPH：T_SACRED 的 web 唯一载体（SafetyMap.isSacred 的判据位）；
        // 零机械旗标、零晋升、prio 7、SURFACE 层。
        expect(TERRAIN_FLAGS[C.SACRED_GLYPH]!.flags).toBe(T_SACRED);
        expect(TERRAIN_FLAGS[C.SACRED_GLYPH]!.mechFlags).toBe(0);
        expect(TERRAIN_FLAGS[C.SACRED_GLYPH]!.promoteType).toBe('');
        expect(TERRAIN_FLAGS[C.SACRED_GLYPH]!.fireType).toBe('');
        expect(DRAW_PRIORITY[C.SACRED_GLYPH]).toBe(7);
        expect(TERRAIN_HOME_LAYER[C.SACRED_GLYPH]).toBe(L.SURFACE);
    });

    it('V-2b-2b 新增条目：机器蓝图地形载体六条逐字段钉死（CE Globals.c 原列）', () => {
        // CARPET（:325）：可燃地毯。捕获的错误实现：漏 T_IS_FLAMMABLE
        //（火点不着地毯——宝库铺装被火原样穿过）；漏 VANISHES（烧后残骸不消失）。
        expect(TERRAIN_FLAGS[C.CARPET]!.flags).toBe(T_IS_FLAMMABLE);
        expect(TERRAIN_FLAGS[C.CARPET]!.mechFlags).toBe(TM_VANISHES_UPON_PROMOTION);
        expect(TERRAIN_FLAGS[C.CARPET]!.chanceToIgnite).toBe(0);
        expect(TERRAIN_FLAGS[C.CARPET]!.fireType).toBe('DF_EMBERS');
        expect(TERRAIN_FLAGS[C.CARPET]!.promoteType).toBe('');
        expect(TERRAIN_FLAGS[C.CARPET]!.promoteChance).toBe(0);
        expect(DRAW_PRIORITY[C.CARPET]).toBe(85);
        expect(TERRAIN_HOME_LAYER[C.CARPET]).toBe(L.DUNGEON);

        // STATUE_INERT（:351）与 STATUE_INERT_DOORWAY（:550）：挡通行/物品/
        // 气/表面效果，但不挡视线与对角；DOORWAY 变体多 TM_CONNECTS_LEVEL
        //（堵门体语义）。fireType DF_PLAIN_FIRE 照抄（零可燃性下不触发）。
        for (const t of [C.STATUE_INERT, C.STATUE_INERT_DOORWAY]) {
            expect(TERRAIN_FLAGS[t]!.flags, `${TerrainType[t]}.flags`).toBe(
                T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_ITEMS | T_OBSTRUCTS_GAS |
                T_OBSTRUCTS_SURFACE_EFFECTS);
            expect(TERRAIN_FLAGS[t]!.chanceToIgnite).toBe(0);
            expect(TERRAIN_FLAGS[t]!.fireType).toBe('DF_PLAIN_FIRE');
            expect(DRAW_PRIORITY[t]).toBe(0);
            expect(TERRAIN_HOME_LAYER[t]).toBe(L.DUNGEON);
            expect(blocksVision(t), `${TerrainType[t]} 不挡视线（CE 无 VISION 位）`).toBe(false);
        }
        expect(TERRAIN_FLAGS[C.STATUE_INERT]!.mechFlags).toBe(TM_STAND_IN_TILE);
        expect(TERRAIN_FLAGS[C.STATUE_INERT_DOORWAY]!.mechFlags).toBe(
            TM_STAND_IN_TILE | TM_CONNECTS_LEVEL);

        // PEDESTAL（:369）：只挡表面效果（物品可放——基座大奖正落同格）；
        // glowLight = CANDLE_LIGHT（:369 原列）。
        expect(TERRAIN_FLAGS[C.PEDESTAL]!.flags).toBe(T_OBSTRUCTS_SURFACE_EFFECTS);
        expect(TERRAIN_FLAGS[C.PEDESTAL]!.mechFlags).toBe(0);
        expect(TERRAIN_FLAGS[C.PEDESTAL]!.fireType).toBe('');
        expect(DRAW_PRIORITY[C.PEDESTAL]).toBe(17);
        expect(TERRAIN_HOME_LAYER[C.PEDESTAL]).toBe(L.DUNGEON);
        expect(blocksPassability(C.PEDESTAL), '基座可通行（CE 无 PASSABILITY 位）').toBe(false);

        // WOODEN_BARRICADE（:341）：挡通行/挡物品 + 可燃（ign 100、
        // DF_WOODEN_BARRICADE_BURN——19 号的解法本体）；CONNECTS_LEVEL。
        expect(TERRAIN_FLAGS[C.WOODEN_BARRICADE]!.flags).toBe(
            T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_ITEMS | T_IS_FLAMMABLE);
        expect(TERRAIN_FLAGS[C.WOODEN_BARRICADE]!.mechFlags).toBe(
            TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_VISUALLY_DISTINCT | TM_CONNECTS_LEVEL);
        expect(TERRAIN_FLAGS[C.WOODEN_BARRICADE]!.chanceToIgnite).toBe(100);
        expect(TERRAIN_FLAGS[C.WOODEN_BARRICADE]!.fireType).toBe('DF_WOODEN_BARRICADE_BURN');
        expect(DRAW_PRIORITY[C.WOODEN_BARRICADE]).toBe(8);
        expect(TERRAIN_HOME_LAYER[C.WOODEN_BARRICADE]).toBe(L.DUNGEON);

        // TRAP_DOOR_HIDDEN（:379）：T_AUTO_DESCENT（踩上坠层）+ TM_IS_SECRET
        //（隐藏位）；外观伪装 = G_FLOOR（drawPriority 95 与 FLOOR 同档）；
        // discoverType DF_SHOW_TRAPDOOR 照抄（显形链归 2b-7）。捕获的错误
        // 实现：抄上 T_OBSTRUCTS_PASSABILITY（陷阱门可走上去才会坠落）。
        expect(TERRAIN_FLAGS[C.TRAP_DOOR_HIDDEN]!.flags).toBe(T_AUTO_DESCENT);
        expect(TERRAIN_FLAGS[C.TRAP_DOOR_HIDDEN]!.mechFlags).toBe(TM_IS_SECRET);
        expect(TERRAIN_FLAGS[C.TRAP_DOOR_HIDDEN]!.fireType).toBe('DF_POISON_GAS_CLOUD');
        expect(TERRAIN_FLAGS[C.TRAP_DOOR_HIDDEN]!.discoverType).toBe('DF_SHOW_TRAPDOOR');
        expect(DRAW_PRIORITY[C.TRAP_DOOR_HIDDEN]).toBe(95);
        expect(TERRAIN_HOME_LAYER[C.TRAP_DOOR_HIDDEN]).toBe(L.DUNGEON);
        expect(blocksPassability(C.TRAP_DOOR_HIDDEN), '陷阱门可走（坠落 ≠ 挡路）').toBe(false);
        expect(isPathingBlocker(C.TRAP_DOOR_HIDDEN), '但它是寻路阻断体（T_AUTO_DESCENT）').toBe(true);
    });

    it('F-2a 守卫：Grid.FIRE_TERRAIN_TYPES（isBurning 派生集）≡ T_IS_FIRE 旗标载体集', () => {
        // Cell.isBurning 的 getter 用本集合判火（Grid.ts 不能反向 import
        // TerrainCatalog，数据登记了两份）。本断言把两份双向锁死：
        // 新火地形（G 链的 GAS_FIRE 等）落地时漏改 Grid.ts 在此翻红，
        // 失败信息指向 Grid.ts 的 FIRE_TERRAIN_TYPES 注释。
        const flagCarriers = (Object.keys(TerrainType) as unknown as string[])
            .filter((k) => Number.isNaN(Number(k)))
            .map((k) => (TerrainType as unknown as Record<string, TerrainType>)[k]!)
            .filter((t) => (TERRAIN_FLAGS[t].flags & T_IS_FIRE) !== 0);
        expect(flagCarriers, '本断言失败 = 目录里的火地形集合变了').toEqual([...FIRE_TERRAIN_TYPES]);
        for (const t of FIRE_TERRAIN_TYPES) {
            expect(isFireTerrain(t), `${TerrainType[t]} 应带 T_IS_FIRE 旗标`).toBe(true);
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
            if (t !== C.WATER_DEEP && t !== C.FLOOD_WATER_DEEP) {
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

describe('C-4a D：迁移安全性——查表实现 ≡ 旧硬编码（C-4a 时点的枚举全集逐位）', () => {
    // B-3 注：本组等价断言的论域是 **C-4a 迁移时点存在的地形**——那之后
    // 落地的 CE 墙族 tile（B-3 的 FORCEFIELD/FORCEFIELD_MELT/CRYSTAL_WALL，
    // CE Globals.c:477/478/338，T_OBSTRUCTS_PASSABILITY 挡通行）没有"旧
    // 硬编码判据"可言（旧清单诞生时它们不存在），等价比较对它们无定义，
    // 按 B-1 反转范本列入 POST_LEGACY_TILES 跳过，其 CE 正确判定由 B-3
    // 的逐字段块（flags 断言）钉死。SACRED_GLYPH 不挡通行，两边同为 true，
    // 留在等价论域内。
    // V-2b-2b 注：机器蓝图墙族三件（STATUE_INERT :351 / STATUE_INERT_DOORWAY
    // :550 / WOODEN_BARRICADE :341）同为迁移后新增的挡通行 tile，按同一
    // 范本列入跳过，CE 判定由下方 V-2b-2b 逐字段块钉死。
    // V-2b-3 注：wired 载体里的四条挡通行 tile（PORTCULLIS_CLOSED :339 /
    // WORM_TUNNEL_OUTER_WALL :570 / WALL_LEVER_HIDDEN :347 /
    // PILOT_LIGHT_DORMANT :342）同理列入跳过——CE 判定由下方 V-2b-3 块正向钉死。
    // 其余五条（MACHINE_GLYPH :404 零旗标、GAS_TRAP_PARALYSIS(_HIDDEN) :382/381
    // 仅 T_IS_DF_TRAP、MACHINE_PARALYSIS/METHANE_VENT_HIDDEN :383/398 零旗标）
    // 的 terrainAllowsMove 与旧清单同为 true，**留在等价论域内**——不跳过，
    // 由本组逐位继续把关（它们若被误加 PASSABILITY 会在此翻红）。
    // V-2b-4 注：祭坛族轮七条里只有 ALTAR_CAGE_RETRACTABLE（:368，铁笼体）
    // 与 STATUE_INSTACRACK（:354，雕像墙族）、TORCH_WALL（:337，墙装火把）
    // 挡通行，按同一范本列入跳过（CE 判定由下方 V-2b-4 块正向钉死）；
    // 其余四条（ALTAR_CAGE_OPEN :364 / COMMUTATION_ALTAR :532 /
    // RESURRECTION_ALTAR :538 / AMULET_SWITCH :529 均不带 PASSABILITY，
    // AMULET_SWITCH 更是零旗标）**留在等价论域内**——不跳过，由本组逐位
    // 继续把关（它们若被误加 PASSABILITY 会在此翻红）。
    const POST_LEGACY_TILES = new Set<TerrainType>([
        C.FORCEFIELD, C.FORCEFIELD_MELT, C.CRYSTAL_WALL,
        C.STATUE_INERT, C.STATUE_INERT_DOORWAY, C.WOODEN_BARRICADE,
        C.PORTCULLIS_CLOSED, C.WORM_TUNNEL_OUTER_WALL, C.WALL_LEVER_HIDDEN,
        C.PILOT_LIGHT_DORMANT,
        C.ALTAR_CAGE_RETRACTABLE, C.STATUE_INSTACRACK, C.TORCH_WALL,
        // V-2b-5：休眠唤醒轮七条里，五条是墙族（STATUE_DORMANT :352 /
        // STATUE_DORMANT_DOORWAY :551 / WALL_MONSTER_DORMANT :357 /
        // RAT_TRAP_WALL_DORMANT :559 / TURRET_DORMANT :356，全带 PASSABILITY）
        // ——列入跳过，CE 判定由下方 V-2b-5 块正向钉死；其余两条
        //（ALTAR_SWITCH :366 仅 SURFACE_EFFECTS、MACHINE_TRIGGER_FLOOR :361
        // 零旗标）**留在等价论域内**——不跳过，由本组逐位继续把关。
        C.STATUE_DORMANT, C.STATUE_DORMANT_DOORWAY, C.WALL_MONSTER_DORMANT,
        C.RAT_TRAP_WALL_DORMANT, C.TURRET_DORMANT,
        // V-2b-6：钥匙轮六条里，两条挡通行（MONSTER_CAGE_CLOSED :371 铁笼体、
        // WALL_LEVER_HIDDEN_DORMANT :350 G_WALL 墙族）——列入跳过，CE 判定
        // 由下方 V-2b-6 块正向钉死；其余四条（MONSTER_CAGE_OPEN :370 零旗标、
        // MACHINE_POISON_GAS_VENT_HIDDEN :395 零旗标、PORTCULLIS_DORMANT :340
        // 零旗标、BONES :464 零旗标）**留在等价论域内**——不跳过，由本组
        // 逐位继续把关。
        C.MONSTER_CAGE_CLOSED, C.WALL_LEVER_HIDDEN_DORMANT,
        // V-2b-7：19 条新 tile 里三条挡通行（BRAZIER :573 火盆、
        // DEMONIC_STATUE :547 雕像墙族、SACRIFICE_CAGE_DORMANT :546 铁笼体，
        // 全带 T_OBSTRUCTS_PASSABILITY）——列入跳过，CE 判定由下方 V-2b-7 块
        // 正向钉死；其余 16 条（COFFIN_CLOSED/ALTAR_KEYHOLE/ALTAR_SWITCH_
        // RETRACTING/FLAMETHROWER_HIDDEN/GAS_TRAP_POISON_HIDDEN/MANACLE_L/
        // MANACLE_T/PORTAL/SACRIFICE_ALTAR_DORMANT/DEAD_GRASS/VOMIT/
        // LUMINESCENT_FUNGUS/DEAD_FOLIAGE/RUBBLE/GRAY_FUNGUS/WORM_TUNNEL_
        // MARKER_DORMANT）**留在等价论域内**——不跳过，由本组逐位继续把关。
        C.BRAZIER, C.DEMONIC_STATUE, C.SACRIFICE_CAGE_DORMANT,
        // V-2b-8：CE Globals.c:513 的 BLOODFLOWER_STALK 明确带
        // T_OBSTRUCTS_PASSABILITY；这是迁移后新增成员，不属于旧硬编码清单。
        C.BLOODFLOWER_STALK,
        // V-2b-9a：CE Globals.c:577/565/563/344 明确带 PASSABILITY 的四条。
        C.MUD_WALL, C.ELECTRIC_CRYSTAL_OFF, C.TURRET_LEVER, C.HAUNTED_TORCH_DORMANT,
    ]);
    it('terrainAllowsMove（查表）≡ 旧排除清单 {GRANITE,WALL,SECRET_DOOR,LOCKED_DOOR,WATER_DEEP}', () => {
        const names = Object.keys(TerrainType).filter((k) => Number.isNaN(Number(k)));
        for (const name of names) {
            const t = (TerrainType as unknown as Record<string, TerrainType>)[name]!;
            if (POST_LEGACY_TILES.has(t)) continue; // 迁移后新增，无旧判据（见组注）
            expect(terrainAllowsMove(t), `${TerrainType[t]}`).toBe(legacyAllowsMove(t));
        }
    });

    it('Game.canMoveTo（查表）≡ 旧清单：合成格逐地形实测（含生成中出现不了的地形）', () => {
        const game = createHeadlessGame(424242);
        const canMoveTo = (game as unknown as { canMoveTo(x: number, y: number): boolean }).canMoveTo.bind(game);
        const names = Object.keys(TerrainType).filter((k) => Number.isNaN(Number(k)));
        for (const name of names) {
            const t = (TerrainType as unknown as Record<string, TerrainType>)[name]!;
            if (POST_LEGACY_TILES.has(t)) continue; // 迁移后新增，无旧判据（见组注）
            game.grid.setTerrain(20, 20, t);
            expect(canMoveTo(20, 20), `${TerrainType[t]}`).toBe(legacyAllowsMove(t));
        }
    });

    it('B-3：迁移后新增的墙族 tile 的通行判定 = CE 查表口径（挡通行、不进旧清单）', () => {
        // 上面两条跳过的三张 tile 在这里按 CE 语义正向钉死：
        // T_OBSTRUCTS_PASSABILITY ⇒ terrainAllowsMove/canMoveTo 均为 false
        //（水晶/力场墙是墙）；SACRED_GLYPH 不挡通行 ⇒ true。
        for (const t of [C.FORCEFIELD, C.FORCEFIELD_MELT, C.CRYSTAL_WALL]) {
            expect(terrainAllowsMove(t), `terrainAllowsMove(${TerrainType[t]})`).toBe(false);
        }
        expect(terrainAllowsMove(C.SACRED_GLYPH), 'terrainAllowsMove(SACRED_GLYPH)').toBe(true);
        const game = createHeadlessGame(424242);
        const canMoveTo = (game as unknown as { canMoveTo(x: number, y: number): boolean }).canMoveTo.bind(game);
        for (const t of [C.FORCEFIELD, C.FORCEFIELD_MELT, C.CRYSTAL_WALL]) {
            game.grid.setTerrain(20, 20, t);
            expect(canMoveTo(20, 20), `canMoveTo(${TerrainType[t]})`).toBe(false);
        }
    });

    it('V-2b-3：wired 载体九条的通行判定 = CE 查表口径（四条墙族挡通行、五条可走）', () => {
        // 上方两条等价断言跳过的四条挡通行 tile 在这里正向钉死，五条可走 tile
        // 反向钉死（它们若被误加 T_OBSTRUCTS_PASSABILITY，机器入口会被自己堵死，
        // 且 terrainAllowsMove/canMoveTo 的等价断言同点翻红）。
        //
        // CE 出处（Globals.c 第 11 列 flags）：
        //   PORTCULLIS_CLOSED :339       (T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_ITEMS)
        //   WORM_TUNNEL_OUTER_WALL :570  (T_OBSTRUCTS_EVERYTHING)
        //   WALL_LEVER_HIDDEN :347       (T_OBSTRUCTS_EVERYTHING)
        //   PILOT_LIGHT_DORMANT :342     (T_OBSTRUCTS_EVERYTHING)
        // 这四条是 18/22 号蓝图的堵门体（堵门体必须真的挡住玩家，否则蓝图
        // 无解）与 41 号的墙装火把，CE 全部带 PASSABILITY 位——它不是"关闭的
        // 闸门该不该可通行"的判断题：CE 用 PORTCULLIS_DORMANT（flags=(0)，
        // :340）表示升起的闸门，web 尚未迁移该 tile，故"升起"由 DF_OPEN_
        // PORTCULLIS 的 tile 缺口登记（DF_MISSING_TILES）承载。
        for (const t of [C.PORTCULLIS_CLOSED, C.WORM_TUNNEL_OUTER_WALL, C.WALL_LEVER_HIDDEN, C.PILOT_LIGHT_DORMANT]) {
            expect(terrainAllowsMove(t), `terrainAllowsMove(${TerrainType[t]}) 应挡通行`).toBe(false);
        }
        for (const t of [C.MACHINE_GLYPH, C.GAS_TRAP_PARALYSIS, C.GAS_TRAP_PARALYSIS_HIDDEN,
            C.MACHINE_PARALYSIS_VENT_HIDDEN, C.MACHINE_METHANE_VENT_HIDDEN]) {
            expect(terrainAllowsMove(t), `terrainAllowsMove(${TerrainType[t]}) 应可走`).toBe(true);
        }
        const game = createHeadlessGame(424242);
        const canMoveTo = (game as unknown as { canMoveTo(x: number, y: number): boolean }).canMoveTo.bind(game);
        for (const t of [C.PORTCULLIS_CLOSED, C.WORM_TUNNEL_OUTER_WALL, C.WALL_LEVER_HIDDEN, C.PILOT_LIGHT_DORMANT]) {
            game.grid.setTerrain(20, 20, t);
            expect(canMoveTo(20, 20), `canMoveTo(${TerrainType[t]})`).toBe(false);
        }
        for (const t of [C.MACHINE_GLYPH, C.GAS_TRAP_PARALYSIS,
            C.GAS_TRAP_PARALYSIS_HIDDEN, C.MACHINE_PARALYSIS_VENT_HIDDEN,
            C.MACHINE_METHANE_VENT_HIDDEN]) {
            game.grid.setTerrain(20, 20, t);
            expect(canMoveTo(20, 20), `canMoveTo(${TerrainType[t]})`).toBe(true);
        }
    });

    it('V-2b-4：祭坛族七条的通行判定 = CE 查表口径（三条墙族挡通行、四条可走）', () => {
        // 上方两条等价断言跳过的三条挡通行 tile 在这里正向钉死（CE Globals.c
        // 第 11 列 flags 出处）：
        //   ALTAR_CAGE_RETRACTABLE :368 (T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_SURFACE_EFFECTS)
        //   STATUE_INSTACRACK      :354 (四旗标，含 PASSABILITY——雕像挡路)
        //   TORCH_WALL             :337 (T_OBSTRUCTS_EVERYTHING)
        // 反方向同样钉死：四条可走 tile 若被误加 PASSABILITY，1/2/26 号的
        // 铁笼祭坛与 6/7 号的祭坛房会被自己堵死。
        for (const t of [C.ALTAR_CAGE_RETRACTABLE, C.STATUE_INSTACRACK, C.TORCH_WALL]) {
            expect(terrainAllowsMove(t), `terrainAllowsMove(${TerrainType[t]}) 应挡通行`).toBe(false);
        }
        for (const t of [C.ALTAR_CAGE_OPEN, C.COMMUTATION_ALTAR, C.RESURRECTION_ALTAR, C.AMULET_SWITCH]) {
            expect(terrainAllowsMove(t), `terrainAllowsMove(${TerrainType[t]}) 应可走`).toBe(true);
        }
        const game = createHeadlessGame(424242);
        const canMoveTo = (game as unknown as { canMoveTo(x: number, y: number): boolean }).canMoveTo.bind(game);
        for (const t of [C.ALTAR_CAGE_RETRACTABLE, C.STATUE_INSTACRACK, C.TORCH_WALL]) {
            game.grid.setTerrain(20, 20, t);
            expect(canMoveTo(20, 20), `canMoveTo(${TerrainType[t]})`).toBe(false);
        }
        for (const t of [C.ALTAR_CAGE_OPEN, C.COMMUTATION_ALTAR, C.RESURRECTION_ALTAR, C.AMULET_SWITCH]) {
            game.grid.setTerrain(20, 20, t);
            expect(canMoveTo(20, 20), `canMoveTo(${TerrainType[t]})`).toBe(true);
        }
    });
    it('V-2b-5：休眠载体七条的通行判定 = CE 查表口径（五条墙族挡通行、两条可走）', () => {
        // 上方两条等价断言跳过的五条挡通行 tile 在这里正向钉死（CE Globals.c
        // 第 11 列 flags 出处）：STATUE_DORMANT :352 / STATUE_DORMANT_DOORWAY
        // :551（四旗标，含 PASSABILITY——雕像挡路）、WALL_MONSTER_DORMANT
        // :357 / RAT_TRAP_WALL_DORMANT :559 / TURRET_DORMANT :356（三者
        // T_OBSTRUCTS_EVERYTHING）。反方向同样钉死：ALTAR_SWITCH :366（仅
        // SURFACE_EFFECTS——祭坛触发板不挡路，钥匙放上面玩家要走过去拿）与
        // MACHINE_TRIGGER_FLOOR :361（零旗标——触发地板就是地板）若被误加
        // PASSABILITY，29/43/50/56 号的取物与 21/69/70 号的踩踏触发会被堵死。
        for (const t of [C.STATUE_DORMANT, C.STATUE_DORMANT_DOORWAY, C.WALL_MONSTER_DORMANT,
            C.RAT_TRAP_WALL_DORMANT, C.TURRET_DORMANT]) {
            expect(terrainAllowsMove(t), `terrainAllowsMove(${TerrainType[t]}) 应挡通行`).toBe(false);
        }
        for (const t of [C.ALTAR_SWITCH, C.MACHINE_TRIGGER_FLOOR]) {
            expect(terrainAllowsMove(t), `terrainAllowsMove(${TerrainType[t]}) 应可走`).toBe(true);
        }
        const game = createHeadlessGame(424242);
        const canMoveTo = (game as unknown as { canMoveTo(x: number, y: number): boolean }).canMoveTo.bind(game);
        for (const t of [C.STATUE_DORMANT, C.STATUE_DORMANT_DOORWAY, C.WALL_MONSTER_DORMANT,
            C.RAT_TRAP_WALL_DORMANT, C.TURRET_DORMANT]) {
            game.grid.setTerrain(20, 20, t);
            expect(canMoveTo(20, 20), `canMoveTo(${TerrainType[t]})`).toBe(false);
        }
        for (const t of [C.ALTAR_SWITCH, C.MACHINE_TRIGGER_FLOOR]) {
            game.grid.setTerrain(20, 20, t);
            expect(canMoveTo(20, 20), `canMoveTo(${TerrainType[t]})`).toBe(true);
        }
    });

    it('V-2b-6：钥匙轮载体的通行判定 = CE 查表口径（两条挡通行、四条可走）', () => {
        // 上面两条等价断言跳过的两条挡通行 tile 在这里正向钉死（CE Globals.c
        // 第 11 列 flags 出处）：MONSTER_CAGE_CLOSED :371（T_OBSTRUCTS_
        // PASSABILITY | T_OBSTRUCTS_SURFACE_EFFECTS | T_OBSTRUCTS_GAS——锁闭
        // 铁笼挡路，玩家须用钥匙开笼）、WALL_LEVER_HIDDEN_DORMANT :350
        //（T_OBSTRUCTS_EVERYTHING——G_WALL 伪装的墙族）。反方向同样钉死：
        // MONSTER_CAGE_OPEN :370 / MACHINE_POISON_GAS_VENT_HIDDEN :395 /
        // PORTCULLIS_DORMANT :340 / BONES :464 均零旗标可走——开笼后的
        // 落点 tile 若误加 PASSABILITY，10 号的盟友会被关死在"开着的笼子"里。
        for (const t of [C.MONSTER_CAGE_CLOSED, C.WALL_LEVER_HIDDEN_DORMANT]) {
            expect(terrainAllowsMove(t), `terrainAllowsMove(${TerrainType[t]}) 应挡通行`).toBe(false);
        }
        for (const t of [C.MONSTER_CAGE_OPEN, C.MACHINE_POISON_GAS_VENT_HIDDEN, C.PORTCULLIS_DORMANT, C.BONES]) {
            expect(terrainAllowsMove(t), `terrainAllowsMove(${TerrainType[t]}) 应可走`).toBe(true);
        }
        const game = createHeadlessGame(424242);
        const canMoveTo = (game as unknown as { canMoveTo(x: number, y: number): boolean }).canMoveTo.bind(game);
        for (const t of [C.MONSTER_CAGE_CLOSED, C.WALL_LEVER_HIDDEN_DORMANT]) {
            game.grid.setTerrain(20, 20, t);
            expect(canMoveTo(20, 20), `canMoveTo(${TerrainType[t]})`).toBe(false);
        }
        for (const t of [C.MONSTER_CAGE_OPEN, C.BONES]) {
            game.grid.setTerrain(20, 20, t);
            expect(canMoveTo(20, 20), `canMoveTo(${TerrainType[t]})`).toBe(true);
        }
    });

    it('V-2b-7：DF 特征系统轮载体的通行判定 = CE 查表口径（三条挡通行、十六条可走）', () => {
        // 上面两条等价断言跳过的三条挡通行 tile 在这里正向钉死（CE Globals.c
        // 第 11 列 flags 出处）：BRAZIER :573（T_OBSTRUCTS_PASSABILITY |
        // T_OBSTRUCTS_ITEMS | T_IS_FIRE——烧着的火盆是堵格体）、
        // DEMONIC_STATUE :547（PASSABILITY|ITEMS|GAS|SURFACE_EFFECTS 墙族）、
        // SACRIFICE_CAGE_DORMANT :546（PASSABILITY|SURFACE_EFFECTS，休眠铁笼）。
        // 反方向同样钉死：其余 16 条全可走（它们若被误加 PASSABILITY，
        // 9 号盟友会被镣铐挡在房外、42 号枯草/55 号碎石会让机器内部不可达）。
        for (const t of [C.BRAZIER, C.DEMONIC_STATUE, C.SACRIFICE_CAGE_DORMANT]) {
            expect(terrainAllowsMove(t), `terrainAllowsMove(${TerrainType[t]}) 应挡通行`).toBe(false);
        }
        const walkable = [
            C.COFFIN_CLOSED, C.ALTAR_KEYHOLE, C.ALTAR_SWITCH_RETRACTING,
            C.FLAMETHROWER_HIDDEN, C.GAS_TRAP_POISON_HIDDEN,
            C.MANACLE_L, C.MANACLE_T, C.PORTAL, C.SACRIFICE_ALTAR_DORMANT,
            C.DEAD_GRASS, C.VOMIT, C.LUMINESCENT_FUNGUS, C.DEAD_FOLIAGE,
            C.RUBBLE, C.GRAY_FUNGUS, C.WORM_TUNNEL_MARKER_DORMANT,
        ];
        for (const t of walkable) {
            expect(terrainAllowsMove(t), `terrainAllowsMove(${TerrainType[t]}) 应可走`).toBe(true);
        }
        const game = createHeadlessGame(424242);
        const canMoveTo = (game as unknown as { canMoveTo(x: number, y: number): boolean }).canMoveTo.bind(game);
        for (const t of [C.BRAZIER, C.DEMONIC_STATUE, C.SACRIFICE_CAGE_DORMANT]) {
            game.grid.setTerrain(20, 20, t);
            expect(canMoveTo(20, 20), `canMoveTo(${TerrainType[t]})`).toBe(false);
        }
        for (const t of [C.COFFIN_CLOSED, C.RUBBLE, C.WORM_TUNNEL_MARKER_DORMANT]) {
            game.grid.setTerrain(20, 20, t);
            expect(canMoveTo(20, 20), `canMoveTo(${TerrainType[t]})`).toBe(true);
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
        'engine/Environment/Gas.ts',      // G-1：updateVolumetricMedia 读 GAS 层 tile 的 mechFlags
                                          // （TM_GAS_DISSIPATES / TM_GAS_DISSIPATES_QUICKLY，
                                          //  CE Time.c:1437-1444）——消散档位住在目录里
        'engine/Items/ItemSpawnHeatMap.ts', // B-4b：物品落位热力图。读 mechFlags 是为了
                                          // 逐字实现 CE 的两个通行谓词——
                                          // isPassableOrSecretDoor（TM_IS_SECRET，密门算可通行，
                                          // 泛洪要穿过它才能给密室加 +3000 热度）与
                                          // cellIsPassableOrDoor（CE Architect.c:48：
                                          // TM_IS_SECRET | TM_PROMOTES_WITH_KEY | TM_CONNECTS_LEVEL，
                                          // passableArcCount 的邻格判据）。属合法首读者。
        'engine/Generator/BlueprintEngine.ts', // V-2b-3：CE Architect.c:1238-1243
                                          // 「Clear wired tiles in case we stole them from
                                          // another machine」的直译——机器标记块对每层查
                                          // mechFlags & (TM_IS_WIRED | TM_IS_CIRCUIT_BREAKER)
                                          // 决定是否剪线清层（:926）。该分支在 V-2b-3 之前
                                          // 结构性不可达（web 无 wired 载体）；本轮九条 wired
                                          // 地形入列后真实可达，属本扫描器头注预告的
                                          // **扩清单时刻**（B-3 / ItemSpawnHeatMap 同款先例）。
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
