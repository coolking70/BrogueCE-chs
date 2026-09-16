/**
 * src/test/g_3_gas_effects.test.ts — G-3：气体效果与生物侧（F-0 §5.3 第 10、
 * 11 条）的验收与对抗。
 *
 * 本轮范围：
 *   1. 效果判定口径重裁：CE 无阈值（站进即判，Time.c:421-497），状态每回合
 *      max() 刷新；web 旧 CONFUSION/STEAM 密度 >20 阈值（0-100 时代自创）
 *      退役（对抗①）。
 *   2. 伤害/回复改比例：max(1, ⌊maxHP/15⌋)（applyGradualTileEffectsToCreature，
 *      Time.c:596-598，ticks=100）；POISON_GAS 按 CE 是 T_CAUSES_DAMAGE 直接
 *      伤害、不上 'poisoned' 状态（对抗②③⑥）。
 *   3. PARALYSIS_GAS tile 迁移（CE Globals.c:506，第七种气体）+ 麻痹药水
 *      改线（CE 喝麻痹药水 = 原地爆 1000 体积麻痹气云，Items.c:8117-8120 →
 *      DF_PARALYSIS_GAS_CLOUD_POTION {PARALYSIS_GAS, GAS, 1000}，
 *      Globals.c:778）+ respiration 符文护甲的 T_RESPIRATION_IMMUNITIES
 *      豁免（Time.c:411-424 / :614-624）（对抗④⑤⑦）。
 *   4. 无载体的四气体（ROT/STENCH/DARKNESS/HEALING）只登记——留痕断言在
 *      g_2 对抗⑦（本轮已按授权翻转），本轮另以守卫⑧锁 respiration 豁免
 *      不越界。
 *
 * 哨兵（任务书 §六.1/2）：对抗⑨ 火侧曲线（FIRE-NAT seed2026/777 逐位）、
 * 对抗⑩ G-1 扩散守恒 + G-2 蒸汽气源（+15/回合）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createHeadlessGame } from './harness';
import type { Game } from '../engine/Core/Game';
import { Grid, TerrainType, DungeonLayer } from '../engine/Map/Grid';
import { TERRAIN_FLAGS, T_CAUSES_DAMAGE, T_CAUSES_CONFUSION, T_CAUSES_PARALYSIS, T_IS_FLAMMABLE, TM_GAS_DISSIPATES_QUICKLY, TM_STAND_IN_TILE } from '../engine/Map/TerrainCatalog';
import { EnvironmentManager, GasType, isGasTerrain } from '../engine/Environment/Gas';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { rng } from '../engine/Random';
import { Monster, type MonsterData } from '../entities/Monster';
import monsterDataJson from '../data/monsters.json';

const C = TerrainType;
const L = DungeonLayer;

type Priv = { applyEnvironmentalEffects(): void; objectiveTimeBlock(): void };
const priv = (game: Game): Priv => game as unknown as Priv;

const MONSTER_DATA = monsterDataJson as MonsterData[];
function monsterDataById(id: string): MonsterData {
    const row = MONSTER_DATA.find(m => m.id === id);
    if (!row) throw new Error(`monsters.json 中找不到 ${id}`);
    return row;
}

/** 手搭 9×9 石头房（同 g_1/g_2 口径）：全墙，中央 7×7 地板。 */
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

/** 无怪物的封闭房间（同 f_2b 口径），玩家在 (4,4)。 */
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
    rng.seedRandomGenerator(20260917);
});

// ---------------------------------------------------------------------------
// 对抗①：阈值没取消（低密度气体不生效）——旧 >20 阈值复发在此翻红
// ---------------------------------------------------------------------------
describe('G-3 对抗①：效果判定无阈值（CE Time.c:421-497 站进即判）', () => {
    it('体积 1 的蒸汽也结算：max(1,⌊30/15⌋)=2 伤害（阈值 >20 的实现 → 0 伤害翻红）', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        game.environment.addGas(4, 4, GasType.STEAM, 1); // 远低于旧阈值 20
        const hp0 = game.player.hp;
        priv(game).applyEnvironmentalEffects();
        expect(game.player.hp, '密度 1 的蒸汽必须造成 max(1,⌊30/15⌋)=2 伤害（CE 无阈值）')
            .toBe(hp0 - 2);
    });

    it('体积 1 的麻痹气体也上状态（旧阈值实现 → 状态缺失翻红）', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        game.environment.addGas(4, 4, GasType.PARALYSIS, 1);
        priv(game).applyEnvironmentalEffects();
        expect(game.player.getStatusDuration('paralyzed'), '密度 1 也必须上麻痹（max(…,20)）').toBe(20);
    });

    it('GAS 层 tile 在、体积为 0 的收层前窗口（Time.c:1361-1368 怪癖）同样命中', () => {
        // CE cellHasTerrainFlag 只看 tile 不看体积：燃气点燃后 volume=0 而
        // GAS 层 tile 暂留的那一轮，效果判定照常（web addGas(…,0) 不产生
        // 该状态，直接手工铺层复刻窗口）。
        const game = createHeadlessGame(42);
        openRoom(game);
        const cell = game.grid.getCell(4, 4)!;
        cell.volume = 0;
        cell.layers[L.GAS] = C.STEAM as never;
        game.environment.syncGasMirror();
        const hp0 = game.player.hp;
        priv(game).applyEnvironmentalEffects();
        expect(game.player.hp, 'tile 在 + volume 0：CE 旗标判定命中，伤害照结算').toBe(hp0 - 2);
    });
});

// ---------------------------------------------------------------------------
// 对抗②：伤害定值不改比例 / 对抗③：下限 1 漏掉
// ---------------------------------------------------------------------------
describe('G-3 对抗②③：比例伤害 max(1, ⌊maxHP/15⌋)（Time.c:596-598）', () => {
    it('蒸汽对玩家（maxHp 30）= 2/回合，不是旧定值 1（定值实现翻红）', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        game.environment.addGas(4, 4, GasType.STEAM, 1000);
        const hp0 = game.player.hp;
        priv(game).applyEnvironmentalEffects();
        expect(game.player.hp).toBe(hp0 - 2);
    });

    it('毒气对 zombie（maxHp 80）= 5/回合，不是 1（CE"大怪更怕毒气"）', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        const z = new Monster(6, 6, monsterDataById('zombie'));
        z.hp = z.maxHp;
        game.monsters.push(z);
        game.environment.addGas(6, 6, GasType.POISON, 1000);
        priv(game).applyEnvironmentalEffects();
        expect(z.maxHp - z.hp, '⌊80/15⌋=5；旧定值 1 或上状态 0 都翻红').toBe(5);
    });

    it('毒气对 troll（maxHp 65）= 4/回合', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        const t = new Monster(6, 6, monsterDataById('troll'));
        t.hp = t.maxHp;
        game.monsters.push(t);
        game.environment.addGas(6, 6, GasType.POISON, 1000);
        priv(game).applyEnvironmentalEffects();
        expect(t.maxHp - t.hp, '⌊65/15⌋=4').toBe(4);
    });

    it('下限 1：rat（maxHp 6）受 1 点而不是 ⌊6/15⌋=0（漏钳制 → 0 伤害翻红）', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        const r = new Monster(6, 6, monsterDataById('rat'));
        r.hp = r.maxHp;
        game.monsters.push(r);
        game.environment.addGas(6, 6, GasType.STEAM, 1000);
        priv(game).applyEnvironmentalEffects();
        expect(r.maxHp - r.hp, 'max(1, 0)=1——小怪保底 1 点（Time.c:598 damage = max(1, damage)）').toBe(1);
    });
});

// ---------------------------------------------------------------------------
// 对抗④：max() 刷新写成叠加或覆盖
// ---------------------------------------------------------------------------
describe('G-3 对抗④：每回合 max() 刷新（CE status = max(status, N)）', () => {
    it('连站两回合混乱不叠加：时长恒 25（stack 实现 → 50 翻红）', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        game.environment.addGas(4, 4, GasType.CONFUSION, 1000);
        priv(game).applyEnvironmentalEffects();
        expect(game.player.getStatusDuration('confused')).toBe(25);
        priv(game).applyEnvironmentalEffects(); // 体积还在（本次调用不跑扩散）
        expect(game.player.getStatusDuration('confused'), '第二回合刷新后仍 25，不得叠到 50').toBe(25);
    });

    it('更强的既有状态不被气体覆盖：先 confused 40，气体刷新后仍 40（覆盖实现 → 25 翻红）', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        game.player.applyStatus('confused', 40);
        game.environment.addGas(4, 4, GasType.CONFUSION, 1000);
        priv(game).applyEnvironmentalEffects();
        expect(game.player.getStatusDuration('confused'), 'max(40,25)=40——覆盖成 25 的实现翻红').toBe(40);
    });

    it('麻痹同式：先 paralyzed 30，气体刷新后仍 30；无状态时上 20', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        game.player.applyStatus('paralyzed', 30);
        game.environment.addGas(4, 4, GasType.PARALYSIS, 1000);
        priv(game).applyEnvironmentalEffects();
        expect(game.player.getStatusDuration('paralyzed')).toBe(30);

        const game2 = createHeadlessGame(42);
        openRoom(game2);
        game2.environment.addGas(4, 4, GasType.PARALYSIS, 1000);
        priv(game2).applyEnvironmentalEffects();
        expect(game2.player.getStatusDuration('paralyzed')).toBe(20);
    });
});

// ---------------------------------------------------------------------------
// 对抗⑤：麻痹药水改线（CE Items.c:8117-8120，云而非直上状态）
// ---------------------------------------------------------------------------
describe('G-3 对抗⑤：potion_of_paralysis 改产 PARALYSIS_GAS 云', () => {
    it('喝麻痹药水：脚下 GAS 层 = PARALYSIS_GAS、云真实铺开（直上状态的旧实现翻红）', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        const potion = ItemLoader.spawnPotion('potion_of_paralysis', -1, -1)!;
        game.player.inventory.addItem(potion);
        game.quaffItem(potion);
        const cell = game.grid.getCell(4, 4)!;
        expect(cell.layers[L.GAS], 'CE DF_PARALYSIS_GAS_CLOUD_POTION：麻痹气云落在脚下').toBe(C.PARALYSIS_GAS);
        // 注：quaff 是完整回合（CE Items.c:7633 → playerTurnEnded），回合末
        // updateGases 跑了两轮——QUICK 档消散 + 8 邻均分后中心格体积必然
        // 小于注入值 1000（种子 42 实测 110），这里锁"体积已扩散但真实在场"
        // 的窗口，体积 1000 的注入断言放在验收组（不走完整回合）。
        expect(cell.volume, '扩散后中心格仍有真实体积（G-1 量纲）').toBeGreaterThan(0);
        expect(game.environment.gasGrid[4]![4]!.type).toBe(GasType.PARALYSIS);
    });

    it('玩家喝下后自食其果：经效果判定上麻痹 20（旧直上 8 的实现翻红）', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        const potion = ItemLoader.spawnPotion('potion_of_paralysis', -1, -1)!;
        game.player.inventory.addItem(potion);
        game.quaffItem(potion);
        // quaff 是完整回合（CE Items.c:7633 → playerTurnEnded）：客观块里的
        // applyEnvironmentalEffects 命中脚下云。时长必须是效果判定的 20，
        // 不是旧直上路径的 8（递减后 7/19 都算旧路径残留）。
        expect([19, 20]).toContain(game.player.getStatusDuration('paralyzed'));
        expect(game.player.getStatusDuration('paralyzed'), '旧直上 8 的实现在此翻红（8−1=7 ∉ {19,20}）')
            .not.toBe(7);
    });
});

// ---------------------------------------------------------------------------
// 对抗⑥：毒气按 CE 是 T_CAUSES_DAMAGE 直接伤害，不上 'poisoned' 状态
// ---------------------------------------------------------------------------
describe('G-3 对抗⑥：POISON_GAS = 直接比例伤害（旧"上中毒状态"实现翻红）', () => {
    it('玩家站毒气：hp −2 且无 poisoned 状态（CE 的毒状态走 addPoison，与气体无关）', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        game.environment.addGas(4, 4, GasType.POISON, 1000);
        const hp0 = game.player.hp;
        priv(game).applyEnvironmentalEffects();
        expect(game.player.hp).toBe(hp0 - 2);
        expect(game.player.hasStatus('poisoned'), '旧实现 applyStatus(poisoned,5) 在此翻红').toBe(false);
    });

    it('毒气致死玩家的死因归 tile description：lastDamageSource = caustic gas（Time.c:622-625）', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        game.player.hp = 2;
        game.environment.addGas(4, 4, GasType.POISON, 1000);
        priv(game).applyEnvironmentalEffects();
        expect(game.player.hp).toBe(0);
        expect((game as unknown as { lastDamageSource: string }).lastDamageSource)
            .toBe('caustic gas');
    });
});

// ---------------------------------------------------------------------------
// 对抗⑦：respiration 符文护甲的 T_RESPIRATION_IMMUNITIES 豁免
// ---------------------------------------------------------------------------
describe('G-3 对抗⑦：A_RESPIRATION 护甲豁免伤害/混乱/麻痹（Time.c:411-424/:614-624）', () => {
    function wearRespiration(game: Game): void {
        const armor = ItemLoader.spawnArmor('leather_armor', -1, -1)!;
        armor.runicType = 'respiration';
        armor.runicKnown = false;
        game.player.inventory.addItem(armor);
        game.player.equippedArmor = armor;
    }

    it('穿 respiration 符文甲站毒气：不掉血、符文自动鉴定（Time.c:617-622）', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        wearRespiration(game);
        game.environment.addGas(4, 4, GasType.POISON, 1000);
        const hp0 = game.player.hp;
        priv(game).applyEnvironmentalEffects();
        expect(game.player.hp).toBe(hp0);
        expect(game.player.equippedArmor!.runicKnown, 'CE :618-621 autoIdentify').toBe(true);
    });

    it('同甲对混乱/麻痹也豁免（T_RESPIRATION_IMMUNITIES 全组，Rogue.h:1956）', () => {
        for (const type of [GasType.CONFUSION, GasType.PARALYSIS]) {
            const game = createHeadlessGame(42);
            openRoom(game);
            wearRespiration(game);
            game.environment.addGas(4, 4, type, 1000);
            priv(game).applyEnvironmentalEffects();
            expect(game.player.hasStatus('confused') || game.player.hasStatus('paralyzed'),)
                .toBe(false);
        }
    });

    it('无甲对照：同样的毒气掉 2 点（豁免分支误伤所有人的实现翻红）', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        game.player.equippedArmor = null;
        game.environment.addGas(4, 4, GasType.POISON, 1000);
        const hp0 = game.player.hp;
        priv(game).applyEnvironmentalEffects();
        expect(game.player.hp).toBe(hp0 - 2);
    });

    it('豁免前置是 T_RESPIRATION_IMMUNITIES 组旗标：甲烷（组外）不触发自动鉴定' +
        '（CE Time.c:409-412 cellHasTerrainFlag 前置；越界鉴定在此翻红）', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        wearRespiration(game); // runicKnown = false
        game.environment.addGas(4, 4, GasType.METHANE, 1000); // 甲烷只有 T_IS_FLAMMABLE，组外
        priv(game).applyEnvironmentalEffects();
        expect(game.player.equippedArmor!.runicKnown, '组外气体不得触发 respiration 鉴定').toBe(false);
        expect(game.player.hp).toBe(game.player.maxHp); // 甲烷本就无效果
    });
});

// ---------------------------------------------------------------------------
// 对抗⑧：无载体气体不被偷接 + PARALYSIS_GAS 目录字段守卫
// ---------------------------------------------------------------------------
describe('G-3 对抗⑧：结构守卫（空转链防复发 + 新 tile 字段）', () => {
    it('PARALYSIS_GAS 携带 T_CAUSES_PARALYSIS 且效果可观测；无 T_CAUSES_DAMAGE/CONFUSION', () => {
        // 字段抄错的可观测形态：漏 T_CAUSES_PARALYSIS → 不上麻痹；
        // 多抄 T_CAUSES_DAMAGE → 麻痹气还烧血（CE 无此行为）。
        const flags = TERRAIN_FLAGS[C.PARALYSIS_GAS].flags;
        expect(flags & T_CAUSES_PARALYSIS).toBeTruthy();
        expect(flags & T_CAUSES_DAMAGE).toBeFalsy();
        expect(flags & T_CAUSES_CONFUSION).toBeFalsy();
        expect(flags & T_IS_FLAMMABLE, '可燃气体（ign 100 → DF_GAS_FIRE）').toBeTruthy();
        expect(TERRAIN_FLAGS[C.PARALYSIS_GAS].mechFlags & TM_GAS_DISSIPATES_QUICKLY).toBeTruthy();
        expect(TERRAIN_FLAGS[C.PARALYSIS_GAS].mechFlags & TM_STAND_IN_TILE).toBeTruthy();

        const game = createHeadlessGame(42);
        openRoom(game);
        game.environment.addGas(4, 4, GasType.PARALYSIS, 1000);
        const hp0 = game.player.hp;
        priv(game).applyEnvironmentalEffects();
        expect(game.player.hp).toBe(hp0);
        expect(game.player.getStatusDuration('paralyzed')).toBe(20);
    });

    it('MONST_INANIMATE 怪不沾混乱/麻痹/伤害（CE Time.c:444/:474/:594 豁免）', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        // web 数据里没有 inanimate 怪，构造性复刻：行为旗标直加（与
        // Game.ts 豁免读同一通道 hasBehavior）。
        const dummy = new Monster(6, 6, monsterDataById('zombie'));
        dummy.hp = dummy.maxHp;
        (dummy as unknown as { behaviorFlags: Set<string> }).behaviorFlags = new Set(['MONST_INANIMATE']);
        game.monsters.push(dummy);
        game.environment.addGas(6, 6, GasType.PARALYSIS, 1000);
        priv(game).applyEnvironmentalEffects();
        expect(dummy.hasStatus('paralyzed'), 'inanimate 免麻痹').toBe(false);
        expect(dummy.hp).toBe(dummy.maxHp);
    });
});

// ---------------------------------------------------------------------------
// 对抗⑨：火侧回归哨兵（任务书 §六.1：FIRE-NAT 逐位一致）
// ---------------------------------------------------------------------------
describe('G-3 对抗⑨：火侧哨兵（G-2 对抗⑤ 同基线复跑）', () => {
    function burnCurve(game: Game, spot: { x: number; y: number }): number[] {
        game.environment.ignite(spot.x, spot.y);
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
        return series;
    }

    function probeSpot(game: Game): { x: number; y: number } {
        const px = game.player.loc.x, py = game.player.loc.y;
        const cands: { x: number; y: number }[] = [];
        for (let x = 0; x < game.grid.width; x++) {
            for (let y = 0; y < game.grid.height; y++) {
                const cell = game.grid.getCell(x, y)!;
                if (Math.max(Math.abs(x - px), Math.abs(y - py)) < 8) continue;
                if (cell.terrain === C.GRASS || cell.terrain === C.FOLIAGE) cands.push({ x, y });
            }
        }
        const spot = cands[rng.randRange(0, cands.length - 1)] ?? null;
        expect(spot, '基线取景点必须仍存在').not.toBeNull();
        return spot!;
    }

    it('FIRE-NAT seed2026 逐位 = F-2a §一 基线（效果重裁不烧火侧 RNG 流）', () => {
        const game = createHeadlessGame(2026);
        const spot = probeSpot(game);
        expect(spot.x === 68 && spot.y === 14).toBe(true);
        expect(burnCurve(game, spot)).toEqual([
            1, 2, 3, 3, 4, 4, 5, 5, 6, 7, 9, 9, 10, 11, 11, 13, 12, 12, 13, 14,
            13, 13, 15, 15, 15, 14, 12, 11, 8, 8, 8, 8, 5, 5, 5, 5, 5, 4, 4, 4,
        ]);
    });

    it('FIRE-NAT seed777 逐位 = F-2a §一 基线（第 6 回合全熄）', () => {
        const game = createHeadlessGame(777);
        const spot = probeSpot(game);
        expect(spot.x === 31 && spot.y === 23).toBe(true);
        expect(burnCurve(game, spot)).toEqual([
            1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ]);
    });
});

// ---------------------------------------------------------------------------
// 对抗⑩：G-1 扩散算法 + G-2 气源回归哨兵（任务书 §六.2）
// ---------------------------------------------------------------------------
describe('G-3 对抗⑩：G-1 扩散守恒 + G-2 蒸汽源哨兵', () => {
    it('9000 整除注入单轮 updateGases 逐位守恒（扩散算法未被本轮改动）', () => {
        // 甲烷（无消散旗标）+ 9000/9=1000 整除：单轮后恰为 3×3 块各 1000、
        // 总量 9000——**种子无关**（第 2 轮起出现 randRange 进位余数，总量
        // 变成种子相关的 ±漂移，g_2 对抗⑥ 的"2 轮 9000"是其种子
        // 20260916 下的特例；本断言取 1 轮相位，任何种子都逐位精确）。
        // 消散旗标误抄（每格 20%/50% 损耗）或均分算法被改都立即翻红。
        const grid = roomGrid();
        const mgr = new EnvironmentManager(grid);
        mgr.addGas(4, 4, GasType.METHANE, 9000);
        mgr.updateGases();
        let total = 0;
        for (let x = 0; x < grid.width; x++) {
            for (let y = 0; y < grid.height; y++) total += grid.getCell(x, y)!.volume;
        }
        expect(total, '单轮总量逐位守恒').toBe(9000);
        for (let x = 3; x <= 5; x++) {
            for (let y = 3; y <= 5; y++) {
                expect(grid.getCell(x, y)!.volume, `3×3 块 (${x},${y}) 恰 1000`).toBe(1000);
            }
        }
        expect(grid.getCell(2, 4)!.volume, '块外对齐邻格恰 0（均分方向守卫）').toBe(0);
    });

    it('G-2 蒸汽源未被改动：深水被火段点燃 → GAS 层 +15（DF_STEAM_ACCUMULATION）', () => {
        const grid = roomGrid();
        grid.setTerrainLayer(3, 3, L.LIQUID, C.WATER_DEEP);
        const mgr = new EnvironmentManager(grid);
        // F-2a 接口：exposeTileToFire 直燃深水（chanceToIgnite 100）
        mgr.ignite(3, 3);
        const cell = grid.getCell(3, 3)!;
        expect(cell.layers[L.GAS], '蒸汽落被点燃水格的 GAS 层').toBe(C.STEAM);
        expect(cell.volume, 'DF_STEAM_ACCUMULATION startProbability = 15').toBe(15);
    });

    it('效果结算零 RNG 消耗：站气回合前后实质抽取计数不动（同 seed 可复现旁证）', () => {
        // CE 的气体效果无掷骰；web 若在效果里加了 roll（抗性掷骰/闪避等），
        // 后续生成/战斗的流位置会分岔——这是"阈值取消引入随机性"的防复发钉。
        const game = createHeadlessGame(42);
        openRoom(game);
        rng.seedRandomGenerator(777);
        const drawsBefore = rng.randomNumbersGenerated;
        game.environment.addGas(4, 4, GasType.POISON, 1000);
        priv(game).applyEnvironmentalEffects();
        expect(rng.randomNumbersGenerated, 'applyEnvironmentalEffects 不得消耗任何 RNG 抽取')
            .toBe(drawsBefore);
    });
});

// ---------------------------------------------------------------------------
// 验收：PARALYSIS_GAS 载体链（tile ↔ GasType ↔ 层归属 ↔ addGas 通路）
// ---------------------------------------------------------------------------
describe('G-3 验收：PARALYSIS_GAS 迁移链完整', () => {
    it('GasType.PARALYSIS 数值 = GAS 层 TerrainType 值；addGas 通路真实行走', () => {
        expect(GasType.PARALYSIS).toBe(C.PARALYSIS_GAS);
        expect(isGasTerrain(C.PARALYSIS_GAS)).toBe(true);
        const grid = roomGrid();
        const mgr = new EnvironmentManager(grid);
        expect(mgr.addGas(4, 4, GasType.PARALYSIS, 1000)).toBe(true);
        expect(grid.getCell(4, 4)!.layers[L.GAS]).toBe(C.PARALYSIS_GAS);
        expect(grid.getCell(4, 4)!.volume).toBe(1000);
        expect(mgr.gasGrid[4]![4]).toEqual({ type: GasType.PARALYSIS, density: 1000 });
    });
});
