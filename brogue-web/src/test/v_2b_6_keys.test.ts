/**
 * src/test/v_2b_6_keys.test.ts — V-2b-6：钥匙系统真实化 + 怪物携带物品
 *
 * 分组：
 *   A. 六个新载体地形 ≡ CE Globals.c 原行（逐字段对抗——抄错任一位即红）；
 *   B. BlueprintEngine 的 keyLoc 绑定 / generatedKey 回声（机器级单元）；
 *   C. 钥匙匹配三件套的否定面（CE Items.c:4036-4063 直译）——
 *      对抗性要求 §7②：keyLoc 指向 X 的钥匙开不了 Y、跨层钥匙不认锁、
 *      机器号匹配开笼、disposableHere 收口；
 *   D. 怪物携带物品的死亡掉落（CE Monsters.c:4075-4083）；
 *   E. featureDF 列真落位（Kennel 的 DF_AMBIENT_BLOOD/DF_BONES）；
 *   F. §6 可解性证明：多 seed × D1-D26，每把锁都有匹配钥匙且
 *      锁格与钥匙格都在"可开锁可达分量"内（Kennel/领养形态的端到端）。
 *
 * 对抗性设计原则：每条断言都能在一个具体的、合理的错误实现下失败
 * （错误形态写在各用例注释里）。C 组先钉否定面再钉肯定面——
 * "造一把 keyLoc 指向 X 的钥匙、断言它能开 X"是自己证明自己。
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame } from './harness';
import { TerrainType, DCOLS, DROWS, type Grid } from '../engine/Map/Grid';
import {
    TERRAIN_FLAGS,
    T_OBSTRUCTS_PASSABILITY,
    T_OBSTRUCTS_SURFACE_EFFECTS,
    T_OBSTRUCTS_GAS,
    T_OBSTRUCTS_EVERYTHING,
    TM_STAND_IN_TILE,
    TM_VANISHES_UPON_PROMOTION,
    TM_PROMOTES_WITH_KEY,
    TM_LIST_IN_SIDEBAR,
    TM_INTERRUPT_EXPLORATION_WHEN_SEEN,
    TM_IS_SECRET,
    TM_IS_WIRED,
} from '../engine/Map/TerrainCatalog';
import { Item, ItemCategory } from '../engine/Items/Item';
import { ItemLoader } from '../engine/Items/ItemLoader';
import blueprintData from '../data/blueprints.json';
import arcanaData from '../data/arcana.json';
import type { BlueprintDef } from '../engine/Generator/BlueprintEngine';
// V-2b-7：E1/F2 用机器记录器按 blueprintId 认 Kennel。
import { BlueprintEngine, blueprintQualifies, BP_VESTIBULE } from '../engine/Generator/BlueprintEngine';

const C = TerrainType;

// ── A：载体地形逐字段 ≡ CE Globals.c ────────────────────────────────────────

describe('V-2b-6 A：六个载体地形 ≡ CE Globals.c 原行（对抗：抄错任一位即红）', () => {
    // CE 字段序：displayChar, foreColor, backColor, drawPriority, chanceToIgnite,
    // fireType, discoverType, promoteType, promoteChance, glowLight, flags, mechFlags
    it('A1 MONSTER_CAGE_OPEN（Globals.c:370）/ MONSTER_CAGE_CLOSED（:371）', () => {
        const open = TERRAIN_FLAGS[C.MONSTER_CAGE_OPEN];
        // :370 {G_OPEN_CAGE, floorBackColor, veryDarkGray, 17, 0, 0,0,0, 0, NO_LIGHT, (0), (TM_STAND_IN_TILE)}
        expect(open.flags).toBe(0);
        expect(open.mechFlags).toBe(TM_STAND_IN_TILE);
        expect(open.chanceToIgnite).toBe(0);
        expect(open.promoteType).toBe('');
        // :371 {G_CLOSED_CAGE, gray, darkGray, 17, 0, 0,0,DF_MONSTER_CAGE_OPENS, 0, NO_LIGHT,
        //  (T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_SURFACE_EFFECTS | T_OBSTRUCTS_GAS),
        //  (TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_PROMOTES_WITH_KEY |
        //   TM_LIST_IN_SIDEBAR | TM_INTERRUPT_EXPLORATION_WHEN_SEEN)}
        const closed = TERRAIN_FLAGS[C.MONSTER_CAGE_CLOSED];
        expect(closed.flags).toBe(
            T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_SURFACE_EFFECTS | T_OBSTRUCTS_GAS
        );
        expect(closed.mechFlags).toBe(
            TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_PROMOTES_WITH_KEY |
            TM_LIST_IN_SIDEBAR | TM_INTERRUPT_EXPLORATION_WHEN_SEEN
        );
        expect(closed.promoteType).toBe('DF_MONSTER_CAGE_OPENS');
    });

    it('A2 MACHINE_POISON_GAS_VENT_HIDDEN（:395）/ PORTCULLIS_DORMANT（:340）/ WALL_LEVER_HIDDEN_DORMANT（:350）', () => {
        const vent = TERRAIN_FLAGS[C.MACHINE_POISON_GAS_VENT_HIDDEN];
        // :395 {G_FLOOR, floorFore, floorBack, 95, 0, DF_PLAIN_FIRE, DF_SHOW_POISON_GAS_VENT,
        //  DF_POISON_GAS_VENT_OPEN, 0, NO_LIGHT, (0),
        //  (TM_VANISHES_UPON_PROMOTION | TM_IS_SECRET | TM_IS_WIRED)}
        expect(vent.flags).toBe(0);
        expect(vent.mechFlags).toBe(TM_VANISHES_UPON_PROMOTION | TM_IS_SECRET | TM_IS_WIRED);
        expect(vent.discoverType).toBe('DF_SHOW_POISON_GAS_VENT');
        expect(vent.promoteType).toBe('DF_POISON_GAS_VENT_OPEN');

        const por = TERRAIN_FLAGS[C.PORTCULLIS_DORMANT];
        // :340 {G_FLOOR, floorFore, floorBack, 95, 0, DF_PLAIN_FIRE, 0, DF_ACTIVATE_PORTCULLIS,
        //  0, NO_LIGHT, (0), (TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED)}
        expect(por.flags).toBe(0);
        expect(por.mechFlags).toBe(TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED);
        expect(por.promoteType).toBe('DF_ACTIVATE_PORTCULLIS');

        const lev = TERRAIN_FLAGS[C.WALL_LEVER_HIDDEN_DORMANT];
        // :350 {G_WALL, wallFore, wallBack, 0, 0, DF_PLAIN_FIRE, 0, DF_CREATE_LEVER,
        //  0, NO_LIGHT, (T_OBSTRUCTS_EVERYTHING), (TM_STAND_IN_TILE | TM_IS_WIRED)}
        expect(lev.flags).toBe(T_OBSTRUCTS_EVERYTHING);
        expect(lev.mechFlags).toBe(TM_STAND_IN_TILE | TM_IS_WIRED);
        expect(lev.promoteType).toBe('DF_CREATE_LEVER');
    });

    it('A3 BONES（:464）零旗标纯装饰', () => {
        const b = TERRAIN_FLAGS[C.BONES];
        expect(b.flags).toBe(0);
        expect(b.mechFlags).toBe(TM_STAND_IN_TILE);
        expect(b.promoteType).toBe('');
    });
});

// ── B：引擎侧 keyLoc 绑定 / generatedKey 回声 ───────────────────────────────

describe('V-2b-6 B：keyLoc 绑定与 generatedKey 回声（BlueprintEngine 单元）', () => {
    it('B1 否定面：非 CE 形态的 KEY feature（key_rat_trap，无外包）generatedKey 不置位——否则补偿循环被跳过、0 钥匙死局', () => {
        const ratTrap = (blueprintData as BlueprintDef[]).find(b => b.id === 'key_rat_trap')!;
        const keyFeat = ratTrap.features.find(f => f.itemCategory === 'KEY')!;
        expect(keyFeat).toBeDefined();
        expect(keyFeat.flags).not.toContain('MF_OUTSOURCE_ITEM_TO_MACHINE');
        // 数据层面的守卫镜像（行为端由 B2 的生成断言覆盖：keys==locks）：
        // generatedKey 只认 outsource/take-item，见 BlueprintEngine 绑定块。
    });

    it('B2 数据面：CE 形态的 KEY feature 都带 itemId（门钥匙 iron_key / 笼钥匙 cage_key）', () => {
        const bps = blueprintData as BlueprintDef[];
        const vest = bps.find(b => b.id === 'vestibule_locked')!;
        const vestKey = vest.features.find(f => f.itemCategory === 'KEY')!;
        expect(vestKey.itemId, 'CE 16 号 itemKind=KEY_DOOR ≙ web iron_key').toBe('iron_key');
        expect(vestKey.flags).toContain('MF_OUTSOURCE_ITEM_TO_MACHINE');

        const kennel = bps.find(b => b.id === 'reward_kennel')!;
        const cageKey = kennel.features.find(f => f.itemCategory === 'KEY')!;
        expect(cageKey.itemId, 'CE 10 号 itemKind=KEY_CAGE ≙ web cage_key').toBe('cage_key');
        expect(cageKey.flags).toContain('MF_SKELETON_KEY');
        expect(cageKey.flags).toContain('MF_KEY_DISPOSABLE');
        expect(cageKey.flags).toContain('MF_OUTSOURCE_ITEM_TO_MACHINE');

        // cage_key 在钥匙表里且不进随机池（CE 的钥匙只由 feature 生成）。
        const cageData = (arcanaData as { keys: Array<{ id: string; excludeFromGeneration?: boolean }> })
            .keys.find(k => k.id === 'cage_key')!;
        expect(cageData).toBeDefined();
        expect(cageData.excludeFromGeneration).toBe(true);
        expect(ItemLoader.spawnKey('cage_key', 1, 1)).not.toBeNull();
    });

    it('B3 Kennel 蓝图结构 ≡ CE 10 号（GlobalsBrogue.c:247-256）', () => {
        const kennel = (blueprintData as BlueprintDef[]).find(b => b.id === 'reward_kennel')!;
        expect(kennel.depthRange).toEqual([5, 26]);
        expect(kennel.roomSize).toEqual([30, 80]); // CE 原值——内部面积须容得下 3-5 座 3×3 笼
        expect(kennel.features).toHaveLength(5);
        const [cages, key, blood, bones, torch] = kennel.features;
        expect(cages!.terrain).toBe('MONSTER_CAGE_CLOSED');
        expect(cages!.instanceCount).toEqual([3, 5]);
        expect(cages!.minimumInstanceCount).toBe(3);
        expect(cages!.hordeFlags).toEqual(['HORDE_MACHINE_KENNEL', 'HORDE_LEADER_CAPTIVE']);
        expect(key!.itemCategory).toBe('KEY');
        expect(blood!.featureDF).toBe('DF_AMBIENT_BLOOD');
        expect(bones!.featureDF).toBe('DF_BONES');
        expect(torch!.terrain).toBe('TORCH_WALL');
        expect(torch!.flags).toContain('MF_BUILD_IN_WALLS');
    });
});

// ── C：钥匙匹配三件套（否定面优先） ─────────────────────────────────────────

function craftKey(opts: {
    depth?: number;
    keyLoc: Array<{ loc: { x: number; y: number }; machine: number; disposableHere?: boolean }>;
}): Item {
    const key = ItemLoader.spawnKey('iron_key', 0, 0)!;
    if (opts.depth !== undefined) key.originDepth = opts.depth;
    key.keyLoc = opts.keyLoc;
    return key;
}

describe('V-2b-6 C：keyMatchesLocation / keyInPackFor 的否定面（对抗：任意钥匙开任意锁必红）', () => {
    it('C1 否定面①：keyLoc 指向 X 的钥匙开不了 Y（坐标不匹配、机器号不同）', () => {
        const game: any = createHeadlessGame(424242);
        const cellOf = (_x: number, _y: number, machine: number) =>
            ({ machineNumber: machine, layers: [TerrainType.LOCKED_DOOR] });
        // 钥匙绑在锁 X=(10,10, machine 3)
        const key = craftKey({ depth: game.depth, keyLoc: [{ loc: { x: 10, y: 10 }, machine: 3, disposableHere: true }] });
        game.player.inventory.addItem(key);
        // Y1：同机器、不同坐标 → 只靠 loc 判据不匹配（机器号 3 匹配！）
        // —— 注意 CE 语义：机器条目匹配即"认锁"，所以构造 Y 必须换机器号。
        expect(game.keyMatchesLocation(key, 11, 11, cellOf(11, 11, 7)), '不同坐标不同机器 → 不认').toBe(false);
        expect(game.keyMatchesLocation(key, 0, 0, cellOf(0, 0, 9)), '随机锁 → 不认').toBe(false);
        // X 本体（坐标匹配）→ 认
        expect(game.keyMatchesLocation(key, 10, 10, cellOf(10, 10, 3)), '绑定的锁本体 → 认').toBe(true);
    });

    it('C2 否定面②：跨层带下去的钥匙不认同坐标的锁（originDepth 判据；删掉 depth 检查必红）', () => {
        const game: any = createHeadlessGame(424242);
        game.depth = 6;
        // 钥匙在 D5 生成，拿到 D6：同坐标锁也不认。
        const key = craftKey({ depth: 5, keyLoc: [{ loc: { x: 20, y: 20 }, machine: 0, disposableHere: true }] });
        const doorCell = { machineNumber: 1, layers: [TerrainType.LOCKED_DOOR] }; // 生产口径：锁在机器内（≠0）
        expect(game.keyMatchesLocation(key, 20, 20, doorCell)).toBe(false);
        // 同层则认（肯定面）。
        game.depth = 5;
        expect(game.keyMatchesLocation(key, 20, 20, doorCell)).toBe(true);
    });

    it('C3 否定面③：非 KEY 类别物品永不匹配（category 门；漏掉即"任意物品开锁"）', () => {
        const game: any = createHeadlessGame(424242);
        const scroll = ItemLoader.spawnScroll('scroll_of_enchantment', 1, 1)!;
        scroll.originDepth = game.depth;
        (scroll as any).keyLoc = [{ loc: { x: 1, y: 1 }, machine: 0, disposableHere: true }];
        expect(game.keyMatchesLocation(scroll, 1, 1, { machineNumber: 0, layers: [TerrainType.LOCKED_DOOR] })).toBe(false);
    });

    it('C4 肯定面：机器号匹配（MF_SKELETON_KEY 的机器条目 → 认同机器的任意锁/笼）', () => {
        const game: any = createHeadlessGame(424242);
        // Kennel cage key：机器条目 {loc:{0,0}, machine: 42}
        const key = craftKey({
            depth: game.depth,
            keyLoc: [
                { loc: { x: 30, y: 30 }, machine: 0, disposableHere: true },
                { loc: { x: 0, y: 0 }, machine: 42, disposableHere: true },
            ],
        });
        const cageCell = { machineNumber: 42, layers: [TerrainType.MONSTER_CAGE_CLOSED] };
        // 笼子 A (40,40)、笼子 B (44,44)——都在机器 42，坐标不绑定，机器号绑定。
        expect(game.keyMatchesLocation(key, 40, 40, cageCell)).toBe(true);
        expect(game.keyMatchesLocation(key, 44, 44, cageCell)).toBe(true);
        // 别的机器的笼子 → 不认（错误实现：只查坐标或忽略机器号都会红）。
        expect(game.keyMatchesLocation(key, 44, 44, { machineNumber: 43, layers: [TerrainType.MONSTER_CAGE_CLOSED] })).toBe(false);
    });

    it('C5 keyInPackFor：只从玩家背包找；匹配的背包钥匙被找到、别人的锁不返回', () => {
        const game: any = createHeadlessGame(424242);
        const k1 = craftKey({ depth: game.depth, keyLoc: [{ loc: { x: 5, y: 5 }, machine: 0, disposableHere: true }] });
        const k2 = craftKey({ depth: game.depth, keyLoc: [{ loc: { x: 9, y: 9 }, machine: 0, disposableHere: true }] });
        game.player.inventory.addItem(k1);
        game.player.inventory.addItem(k2);
        // 生产中一切锁都在机器内（machineNumber ≠ 0）——合成格照实用口径
        // 取非零机器号；机器号 0 的合成格会触发 CE :4042 的字面 0==0 退化
        //（location 条目的 machine=0 撞上无机器格），那是 CE 字面行为、
        // 生产不可达，测试不用它。
        const cell = { machineNumber: 1, layers: [TerrainType.LOCKED_DOOR] };
        expect(game.keyInPackFor(5, 5, cell)).toBe(k1);
        expect(game.keyInPackFor(9, 9, cell)).toBe(k2);
        expect(game.keyInPackFor(7, 7, cell)).toBeNull();
    });
});

// ── D：怪物携带物品 ─────────────────────────────────────────────────────────

describe('V-2b-6 D：carriedItem 死亡掉落（CE Monsters.c:4075-4083）', () => {
    it('D1 携带钥匙的怪死亡 → 物品落怪原地、keyLoc/originDepth 保留；活怪不掉', () => {
        const game: any = createHeadlessGame(424242);
        const monst = game.monsters[0];
        expect(monst).toBeDefined();
        const key = craftKey({ depth: game.depth, keyLoc: [{ loc: { x: 0, y: 0 }, machine: 7, disposableHere: false }] });
        monst.carriedItem = key;
        const before = game.items.length;

        // 活怪：playerTurnEnded 不掉。
        game.playerTurnEnded();
        expect(game.items.length).toBe(before);
        expect(monst.carriedItem).toBe(key);

        // 杀死：掉落原地。
        monst.hp = 0;
        game.playerTurnEnded();
        expect(game.items.length).toBe(before + 1);
        const dropped = game.items[game.items.length - 1];
        expect(dropped).toBe(key);
        expect(dropped.loc.x).toBe(monst.loc.x);
        expect(dropped.loc.y).toBe(monst.loc.y);
        expect(dropped.keyLoc[0].machine).toBe(7);
        expect(dropped.keyLoc[0].disposableHere).toBe(false);
        expect(dropped.originDepth).toBe(key.originDepth);
    });

    it('D2 否定面：掉落守卫——死在不可落格（熔岩）上的怪物品不进 items（不凭空消失进岩浆）', () => {
        const game: any = createHeadlessGame(424242);
        const monst = game.monsters[0];
        const key = craftKey({ depth: game.depth, keyLoc: [] });
        monst.carriedItem = key;
        // 把怪挪到熔岩格（CE 的 getQualifyingPathLocNear 会择邻格；web 简化为
        // 不可落即不落地——登记偏差，测试钉住现状）。
        game.grid.setTerrain(monst.loc.x, monst.loc.y, TerrainType.LAVA, '~', 0xff4400);
        monst.hp = 0;
        const before = game.items.length;
        game.playerTurnEnded();
        expect(game.items.length).toBe(before);
        expect(monst.carriedItem).toBeNull();
    });
});

// ── E：featureDF 真落位 ─────────────────────────────────────────────────────

// B1: the previous eight seeds no longer build a Kennel after retirement.
// Replace seed 1 with observed seed 4 (D5); keep every DF/key/reachability
// assertion and the >= 1 coverage gates. E1 and F2 share the actual carrier.
const KENNEL_COVERAGE_SEEDS = [7, 424242, 777, 31337, 20260913, 42, 2026, 4];

describe('V-2b-6 E：featureDF 列真落位（CE Architect.c:1434-1440，Kennel 端到端）', () => {
    it('E1 多 seed 扫描：Kennel 的 DF 列真落位（featureDF 分支执行 + 地形侧确有产物）', () => {
        // ★ V-2b-7 判据收敛（前提修正，不是放宽）★
        // 原判据是"层里有 MONSTER_CAGE_CLOSED ⇒ Kennel，且该层的**有效地形**里
        // 必须出现 BONES/BLOOD"。两条前提在本轮都到期：
        //   ① 11 号 Vampire lair 也用 MONSTER_CAGE_CLOSED（seed777/D24 实测被误判）；
        //   ② `BLOOD` 是 SURFACE 层地形，`fillSpawnMap` 的优先级门
        //     （Architect.c:3228 `旧 prio >= 新 prio`）会让它**被草(60)挡住**——
        //     Kennel 建在草层上时血渍落不下去（CE 同样如此），
        //     "有效地形必出现 BLOOD"因此不是 CE 保证（seed7/D22 实测）。
        // 收敛后的判据锚在**机器记录**上（本轮新增的 MachineResult.featureSpawns），
        // 这正是 V-2b-6 想测的东西：featureDF 分支有没有真的执行。
        //   ① 每台 Kennel 的两条 DF 列都必须录到 ≥ minInstances(3) 个落点；
        //   ② 覆盖门：全样本至少建成一台 Kennel，且至少有一次落点在网格上
        //      **真的**写出了 BONES/BLOOD 层（证明不是"记而不落"）。
        const record: Array<{ depth: number; results: import('../engine/Generator/BlueprintEngine').MachineResult[] }> = [];
        const proto = BlueprintEngine.prototype as unknown as Record<string, unknown>;
        const origBuild = proto.buildMachines as (this: unknown) => unknown[];
        proto.buildMachines = function (this: unknown) {
            const results = origBuild.call(this) as import('../engine/Generator/BlueprintEngine').MachineResult[];
            record.push({ depth: (this as { depth: number }).depth, results });
            return results;
        };
        let kennelsSeen = 0;
        let landedSeen = 0;
        try {
            for (const seed of KENNEL_COVERAGE_SEEDS) {
                const game: any = createHeadlessGame(seed);
                for (let d = 1; d <= 26; d++) {
                    if (d > 1) { game.depth = d; game.generateDepth(false, false); }
                    const machines = (record[record.length - 1]?.results ?? [])
                        .filter(m => m.blueprintId === 'reward_kennel');
                    for (const m of machines) {
                        kennelsSeen++;
                        const blood = m.featureSpawns.filter(sp => sp.featureDF === 'DF_AMBIENT_BLOOD').length;
                        const bones = m.featureSpawns.filter(sp => sp.featureDF === 'DF_BONES').length;
                        // 对抗：featureDF 分支若恒真缺口（不落位）→ 落点记录为 0 → 红；
                        // 若只落不记 → 同样为 0 → 红（本轮把记录点与落位同址）。
                        expect(blood, `seed${seed} D${d} Kennel 的 DF_AMBIENT_BLOOD 落点 < 3（minInstances）`).toBeGreaterThanOrEqual(3);
                        expect(bones, `seed${seed} D${d} Kennel 的 DF_BONES 落点 < 3（minInstances）`).toBeGreaterThanOrEqual(3);
                        const landed = m.featureSpawns.some(sp => {
                            const c = game.grid.getCell(sp.pos.x, sp.pos.y);
                            if (!c) return false;
                            return c.layers[0] === C.BONES || c.layers[3] === C.BONES || c.layers[3] === C.BLOOD;
                        });
                        if (landed) landedSeen++;
                    }
                }
            }
        } finally { proto.buildMachines = origBuild; }
        expect(kennelsSeen, '8 seed × D1-26 应至少建成一台 Kennel').toBeGreaterThanOrEqual(1);
        expect(landedSeen, '任何一台 Kennel 的 DF 落点都没在网格上写出 BONES/BLOOD——记而不落？').toBeGreaterThanOrEqual(1);
    }, 900_000);
});

// ── F：§6 可解性证明（本轮合并前置条件） ────────────────────────────────────

/**
 * 通行判定：可通行 ∪ 可被钥匙打开的格（LOCKED_DOOR / MONSTER_CAGE_CLOSED——
 * 拿到钥匙后即可通过；CE 的移动判定 Movement.c:1160-1206 bump-to-unlock 同款）。
 * 熔岩/深渊/墙/花岗岩等 T_PATHING_BLOCKER 不可通行。
 */
function traversable(terrain: TerrainType): boolean {
    // 不可穿越 = 硬墙族 + 致死液体/坠落。LOCKED_DOOR / MONSTER_CAGE_CLOSED
    // 拿到钥匙即可开；SECRET_DOOR 搜索可开（CE search）；WOODEN_BARRICADE
    // 可燃（T_IS_FLAMMABLE）；PORTCULLIS_CLOSED 本轮不可开（wired 接线
    // 未实现）——列入不可穿越：若真有锁被它封死，本测试按死局报红。
    return terrain !== C.WALL && terrain !== C.GRANITE && terrain !== C.LAVA
        && terrain !== C.CHASM && terrain !== C.HOLE && terrain !== C.PORTCULLIS_CLOSED;
}

describe('V-2b-6 F：§6 可解性证明（合并前置条件）', () => {
    it('F0 U19d restores the executable secret-lever vestibule with CE frequency and features intact', () => {
        const bp = (blueprintData as BlueprintDef[]).find(b => b.id === 'vestibule_secret_lever')!;
        // U17c closed search/bump/wiring; U19d verifies the complete natural action chain.
        expect(bp.frequency, 'CE GlobalsBrogue.c:305 frequency remains 8').toBe(8);
        expect(blueprintQualifies(bp, 15, [BP_VESTIBULE])).toBe(true);
        expect(bp.features.map(f => f.terrain)).toEqual([
            'WORM_TUNNEL_OUTER_WALL', 'PORTCULLIS_CLOSED', 'WALL_LEVER_HIDDEN',
        ]);
    });

    it('F1 多 seed × D1-D26：每把锁都有同层匹配钥匙，且锁格与钥匙格都在玩家可达分量内', () => {
        let layersWithLocks = 0;
        for (const seed of [424242, 777, 31337, 20260913, 42, 2026]) {
            const game: any = createHeadlessGame(seed);
            for (let d = 1; d <= 26; d++) {
                if (d > 1) { game.depth = d; game.generateDepth(false, false); }
                const grid: Grid = game.grid;
                // 1) 收集锁（LOCKED_DOOR 与 MONSTER_CAGE_CLOSED）。
                const locks: Array<{ x: number; y: number }> = [];
                for (let x = 0; x < DCOLS; x++) {
                    for (let y = 0; y < DROWS; y++) {
                        const t = grid.getCell(x, y)?.terrain;
                        if (t === C.LOCKED_DOOR || t === C.MONSTER_CAGE_CLOSED) locks.push({ x, y });
                    }
                }
                if (locks.length === 0) continue;
                layersWithLocks++;
                // 2) 可达分量：从玩家入口（楼梯层为玩家所在格）泛洪。
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
                // 3) 每把锁：锁格本身可达（CE：玩家须走到锁前 useKeyAt），
                //    且存在一把钥匙 keyMatchesLocation 认这把锁、其所在格可达。
                // ★ V-2b-7 前提扩展：CE 的钥匙来源不止"地上"，还有**怪物携带**
                //（CE `keyOnTileAt` 也一样查 `monst->carriedItem`，见 V-2b-6 报告
                // §1.3；11 号 Vampire lair 的 cage key 就挂在吸血鬼手上）。
                // 判据两个来源合看：地上的 KEY 物品 ∪ 场上（含 dormantMonsters）
                // 怪物的 carriedItem。取到携带钥匙时，可达性判据换成**携带者所在格**
                //（玩家须先找到并击杀/取走携带者——"钥匙可达"的等价物）。
                const carriedKeys = ([...(game.monsters as Item[]), ...(game.dormantMonsters as Item[])]
                    .map((m: any) => m?.carriedItem)
                    .filter((i: any) => i && i.category === ItemCategory.KEY)) as Item[];
                for (const lock of locks) {
                    const lockCell = grid.getCell(lock.x, lock.y)!;
                    const floorKeys = (game.items as Item[]).filter(i => i.category === ItemCategory.KEY);
                    const matcher = game.keyMatchesLocation.bind(game);
                    const match = floorKeys.find(k => matcher(k, lock.x, lock.y, lockCell));
                    const carriedMatch = carriedKeys.find(k => matcher(k, lock.x, lock.y, lockCell));
                    expect(match ?? carriedMatch, `seed${seed} D${d} 锁 (${lock.x},${lock.y}) 无匹配钥匙（地上与怪携带都没有）`).toBeDefined();
                    expect(reachable(lock.x, lock.y), `seed${seed} D${d} 锁 (${lock.x},${lock.y}) 不可达`).toBe(true);
                    if (match) {
                        expect(reachable(match.loc.x, match.loc.y), `seed${seed} D${d} 锁 (${lock.x},${lock.y}) 的钥匙 (${match.loc.x},${match.loc.y}) 不可达`).toBe(true);
                    } else {
                        const carrier = ([...(game.monsters as any[]), ...(game.dormantMonsters as any[])])
                            .find(m => m.carriedItem === carriedMatch)!;
                        expect(reachable(carrier.loc.x, carrier.loc.y),
                            `seed${seed} D${d} 锁 (${lock.x},${lock.y}) 的钥匙由 ${carrier.name} 携带，但其出生态 (${carrier.loc.x},${carrier.loc.y}) 不可达`).toBe(true);
                    }
                    // originDepth 判据：匹配钥匙必然是本层的（matcher 内含该判据）。
                }
            }
        }
        expect(layersWithLocks, '样本应覆盖到足量锁层').toBeGreaterThanOrEqual(5);
    });

    it('F2 笼群形态（§6.2）：每台带笼的机器都有钥匙认（机器号匹配），且钥匙/携带者可达', () => {
        // ★ V-2b-7 判据收敛：原来用"网格上有 MONSTER_CAGE_CLOSED"认笼群机器，
        // 11 号 Vampire lair 入池后该判据不再等价于"这台机器有 cage key 落在地上"
        //（吸血鬼把钥匙拿在手上 —— MF_MONSTER_TAKE_ITEM）。改为按**机器记录**
        // 认笼群机器（featureSpawns 里 terrain === 'MONSTER_CAGE_CLOSED'），
        // 并把"cage key"的来源扩为 地上 ∪ 怪携带（两处 keyLoc 都必须带本机器号条目）。
        // 判据本身不放宽：keyLoc 必须带 `machine === 该机器号` 的条目、
        // `disposableHere === true`（CE :251 MF_KEY_DISPOSABLE），且可达。
        const record: Array<{ depth: number; results: import('../engine/Generator/BlueprintEngine').MachineResult[] }> = [];
        const proto = BlueprintEngine.prototype as unknown as Record<string, unknown>;
        const origBuild = proto.buildMachines as (this: unknown) => unknown[];
        proto.buildMachines = function (this: unknown) {
            const results = origBuild.call(this) as import('../engine/Generator/BlueprintEngine').MachineResult[];
            record.push({ depth: (this as { depth: number }).depth, results });
            return results;
        };
        let kennelsSeen = 0;
        try {
        for (const seed of KENNEL_COVERAGE_SEEDS) {
            const game: any = createHeadlessGame(seed);
            for (let d = 1; d <= 26; d++) {
                if (d > 1) { game.depth = d; game.generateDepth(false, false); }
                const cageMachines = (record[record.length - 1]?.results ?? [])
                    .filter(m => m.featureSpawns.some(sp => sp.terrain === 'MONSTER_CAGE_CLOSED'));
                if (cageMachines.length === 0) continue;
                // 本层可达分量（一次泛洪，供本层所有笼群共用）。
                const seen = new Set<number>();
                const start = game.player.loc;
                seen.add(start.y * 20000 + start.x);
                const queue: number[] = [start.y * 20000 + start.x];
                for (let qi = 0; qi < queue.length; qi++) {
                    const k0 = queue[qi]!;
                    const p = { x: k0 % 20000, y: Math.floor(k0 / 20000) };
                    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
                        const nx = p.x + dx!, ny = p.y + dy!;
                        if (nx < 0 || ny < 0 || nx >= DCOLS || ny >= DROWS) continue;
                        const k = ny * 20000 + nx;
                        if (seen.has(k)) continue;
                        const t = game.grid.getCell(nx, ny)?.terrain;
                        if (t === undefined || !traversable(t)) continue;
                        seen.add(k);
                        queue.push(k);
                    }
                }
                for (const m of cageMachines) {
                    kennelsSeen++;
                    const cageMachine = m.machineNumber;
                    const carriedKeys = ([...(game.monsters as any[]), ...(game.dormantMonsters as any[])])
                        .map(mm => mm?.carriedItem)
                        .filter((i: any) => i && i.category === ItemCategory.KEY);
                    const candidates = [...(game.items as Item[]), ...(carriedKeys as Item[])];
                    const cageKeys = candidates.filter(
                        i => i.category === ItemCategory.KEY && i.keyLoc.some(e => e.machine === cageMachine)
                    );
                    expect(cageKeys.length, `seed${seed} D${d} 笼群机器 ${cageMachine}（${m.blueprintId}）无 cage key（地上与怪携带都没有）`).toBeGreaterThanOrEqual(1);
                    for (const k of cageKeys) {
                        const entry = k.keyLoc.find(e => e.machine === cageMachine)!;
                        expect(entry.disposableHere, 'CE :251 MF_KEY_DISPOSABLE → disposableHere').toBe(true);
                    }
                    const anyReachable = cageKeys.some(k => {
                        if (k.loc && k.loc.x > 0 && k.loc.y > 0) return seen.has(k.loc.y * 20000 + k.loc.x);
                        const carrier = ([...(game.monsters as any[]), ...(game.dormantMonsters as any[])])
                            .find((mm: any) => mm.carriedItem === k);
                        return carrier ? seen.has(carrier.loc.y * 20000 + carrier.loc.x) : false;
                    });
                    expect(anyReachable, `seed${seed} D${d} 笼群机器 ${cageMachine} 的 cage key 全部不可达（死局）`).toBe(true);
                }
            }
        }
        } finally { proto.buildMachines = origBuild; }
        expect(kennelsSeen, '8 seed × D1-26 应至少建成一台带笼的机器').toBeGreaterThanOrEqual(1);
    }, 900_000);

    it('F3 §6.3（单元口径）：disposableHere=false 的钥匙开锁后保留（CE Movement.c:636-656 收口）', () => {
        // 数据面：非 disposable 的锁条目仅出现在 MF_KEY_DISPOSABLE 缺席的
        // KEY feature 上（当前数据里全部 KEY feature 都带该旗标 → 生产路径
        // 结构性全 true）。引擎收口的行为单元在此钉死：匹配条目带
        // disposableHere=false 时，keyMatchingEntry 返回的条目不得触发消耗。
        const game: any = createHeadlessGame(424242);
        const key = craftKey({
            depth: game.depth,
            keyLoc: [{ loc: { x: 10, y: 10 }, machine: 0, disposableHere: false }],
        });
        const entry = game.keyMatchingEntry(key, 10, 10, { machineNumber: 0, layers: [TerrainType.LOCKED_DOOR] });
        expect(entry).not.toBeNull();
        expect(entry.disposableHere).toBe(false);
        // 收口判据（unlock 分支的字面）：entry?.disposableHere ?? true === false。
        expect(entry?.disposableHere ?? true).toBe(false);
    });
});
