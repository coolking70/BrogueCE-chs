/**
 * src/test/f_2c_explosion.test.ts — F-2c：爆炸 GAS_EXPLOSION（F/G 链收口轮）
 *
 * 被测事实（CE 出处逐条写在断言注释；行号本轮逐条打开复核）：
 *   - GAS_EXPLOSION tile（Globals.c:496）：T_IS_FIRE | T_CAUSES_EXPLOSIVE_DAMAGE、
 *     promoteChance 10000 + VANISHES_UPON_PROMOTION + promoteType 0 ⇒ 瞬时地形；
 *   - 爆炸结算（Time.c:343-353，applyInstantTileEffectsToCreature 爆炸段）：
 *     damage = max(rand_range(15,20), maxHP/2)——**最大生命**的一半（任务书
 *     "当前血量 50%" 是转述错误，按 CE 翻正）；免疫窗 = STATUS_EXPLOSION_
 *     IMMUNITY = 5，**生物身上的状态**（任务书"按格记账"同样是转述错误：
 *     CE Time.c:347 是 monst->status[...]，玩家递减 Time.c:2298、怪物走
 *     Monsters.c updateMonsterStatus 的 default 分支）；
 *   - 瞬时路径：爆炸 tile 落到生物脚下当场结算（fillSpawnMap refresh 分支
 *     Architect.c:3255；bloat 死亡 DF 经 Combat.c:1965-1967）——与后续
 *     燃烧（火点燃生物，Time.c:527 → :2581）是**两笔**伤害；
 *   - DF_BLOAT_EXPLOSION（Globals.c:654，{GAS_EXPLOSION, SURFACE, 350, 100}）
 *     与 DF_EXPLOSION_FIRE（甲烷爆轰圈，Globals.c:742，{…60, 17}）。
 *
 * 每条断言在注释里写明它捕获的错误实现。反向验证（真实改坏→红→还原）
 * 见 ai_docs/f_2c_explosion_report.md，不落在本文件。
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame } from './harness';
import type { Game } from '../engine/Core/Game';
import { TerrainType, DungeonLayer as L } from '../engine/Map/Grid';
import { runPromotionUpdate } from '../engine/Map/Promotion';
import { Monster, type MonsterData } from '../entities/Monster';
import { GasType } from '../engine/Environment/Gas';
import { rng } from '../engine/Random';
import type { StatusId } from '../entities/Creature';
import monsterDataJson from '../data/monsters.json';

const C = TerrainType;
const MONSTER_DATA = monsterDataJson as MonsterData[];

function monsterDataById(id: string): MonsterData {
    const row = MONSTER_DATA.find(m => m.id === id);
    if (!row) throw new Error(`monsters.json 中找不到 ${id}`);
    return row;
}

/** 无怪物骚扰的封闭房间（f_2a/f_2b openRoom 同款，FLOOR 地面）。 */
function openRoom(game: Game, w = 30, h = 20): void {
    game.monsters.length = 0;
    game.items.length = 0;
    for (let x = 1; x < w; x++) {
        for (let y = 1; y < h; y++) {
            game.grid.setTerrain(x, y, C.WALL, '#', 0x444444);
        }
    }
    for (let x = 2; x <= w - 2; x++) {
        for (let y = 2; y <= h - 2; y++) {
            game.grid.setTerrain(x, y, C.FLOOR, '.', 0x888888);
            const cell = game.grid.getCell(x, y);
            if (cell) cell.isVisible = true;
        }
    }
    game.player.loc.x = 4;
    game.player.loc.y = 4;
    game.player.hp = game.player.maxHp;
}

/** 在 (x,y) 铺一格 GAS_EXPLOSION（SURFACE 层——writeTerrainHome 归属）。 */
function setExplosive(game: Game, x: number, y: number): void {
    game.grid.setTerrain(x, y, C.GAS_EXPLOSION, '*', 0xffaa00);
    const cell = game.grid.getCell(x, y);
    if (cell) cell.isVisible = true;
}

type Priv = {
    objectiveTimeBlock(): void;
    tickCreatureStatuses(): void;
    applyEnvironmentalEffects(): void;
    triggerDeathFeatures(): void;
    burningDuration(entity: unknown): number;
    explosionImmunityDuration(entity: unknown): number;
};
const priv = (game: Game): Priv => game as unknown as Priv;

function makeVictim(game: Game, x: number, y: number, maxHp: number): Monster {
    const v = new Monster(x, y, monsterDataById('rat'));
    v.maxHp = maxHp;
    v.hp = maxHp;
    game.monsters.push(v);
    return v;
}

// ---------------------------------------------------------------------------
// 对抗①②：伤害公式与免疫窗
// ---------------------------------------------------------------------------
describe('F-2c 对抗①②：爆炸伤害公式与免疫窗（Time.c:343-353）', () => {
    it('对抗①：伤害必须取 max(15-20, maxHP/2)——取小者、只掷 15-20、或按当前血量' +
        '折算的实现全部翻红。maxHp=200 已损到 hp=60 的怪：maxHP/2=100 > 15-20 → ' +
        '伤害恰 100 → 当场死亡；按当前血量 50%（30）或按 15-20 的实现它都活。', () => {
        const game = createHeadlessGame(201);
        openRoom(game);
        setExplosive(game, 7, 7);
        const victim = makeVictim(game, 7, 7, 200);
        victim.hp = 60; // 当前血量远低于 maxHP/2——"当前血量 50%" 误读在此暴露

        priv(game).applyEnvironmentalEffects();

        expect(victim.hp, 'max(rand_range(15,20), maxHP/2)=100 ≥ hp=60：应当场死亡。' +
            '存活说明实现取了 15-20、或按当前血量折算（两者都是错误实现）').toBeLessThanOrEqual(0);
    });

    it('对抗②：免疫窗缺失——同一生物站在爆炸格上连续两个客观块，第二块不得重复扣血。' +
        '没上 STATUS_EXPLOSION_IMMUNITY 的实现第二块再扣 100 → hp 归零（翻红）。', () => {
        const game = createHeadlessGame(202);
        openRoom(game);
        setExplosive(game, 7, 7);
        const victim = makeVictim(game, 7, 7, 200);

        priv(game).applyEnvironmentalEffects();
        expect(victim.hp, '第一块：max(15-20, 100) = 100').toBe(100);

        priv(game).applyEnvironmentalEffects();
        expect(victim.hp, '免疫窗内第二块不得重复扣血').toBe(100);
    });
});

// ---------------------------------------------------------------------------
// 对抗③：免疫窗按生物记账（CE 语义）且时长恰 5
// ---------------------------------------------------------------------------
describe('F-2c 对抗③：免疫窗的记账主体与时长', () => {
    it('对抗③a：免疫跟着生物走，不跟格走——挨炸后**移动到另一格爆炸地形**上' +
        '仍免疫。按格记账的实现（Set<格>）在新格查不到记录 → 再扣一次（翻红）。' +
        'CE 依据：Time.c:347 是 monst->status[STATUS_EXPLOSION_IMMUNITY] = 5——' +
        '生物身上的状态（任务书"按格记账"为转述错误，按 CE 翻正）。', () => {
        const game = createHeadlessGame(203);
        openRoom(game);
        setExplosive(game, 7, 7);
        setExplosive(game, 12, 7);
        const victim = makeVictim(game, 7, 7, 200);
        victim.applyStatus('immune_fire' as StatusId, 100); // 隔离燃烧噪音：只测爆炸机制

        priv(game).applyEnvironmentalEffects();
        expect(victim.hp).toBe(100);

        victim.loc.x = 12; // 移到另一个爆炸格——免疫必须仍然生效
        priv(game).applyEnvironmentalEffects();
        expect(victim.hp, '免疫是生物状态：换格不得重置/失效（按格记账的实现在此翻红）').toBe(100);
    });

    it('对抗③b：免疫窗时长恰 5 回合（Time.c:347 字面 5）——第 2~5 块被挡、' +
        '第 6 块恢复受击。记 3（太短：第 5 块就掉血）或 10/无限（第 6 块不掉血）' +
        '的实现都翻红。递减走 tickStatuses 全键遍历（玩家 Time.c:2298 / 怪 ' +
        'Monsters.c default 分支的同轨等价）。', () => {
        const game = createHeadlessGame(204);
        openRoom(game);
        setExplosive(game, 7, 7);
        const victim = makeVictim(game, 7, 7, 200);
        victim.applyStatus('immune_fire' as StatusId, 100); // 隔离燃烧噪音：只测爆炸机制

        // 块 1：受击 + 上免疫 5（随后同块递减到 4）。
        priv(game).applyEnvironmentalEffects();
        priv(game).tickCreatureStatuses();
        expect(victim.hp).toBe(100);

        // 块 2~5：免疫 4→1，全部被挡。
        for (let i = 2; i <= 5; i++) {
            priv(game).applyEnvironmentalEffects();
            priv(game).tickCreatureStatuses();
            expect(victim.hp, `第 ${i} 块仍在免疫窗内（时长记短了的实现在此翻红）`).toBe(100);
        }

        // 块 6：免疫归零，恢复受击 → max(15-20, 100) = 100 → 死亡。
        priv(game).applyEnvironmentalEffects();
        expect(victim.hp, '免疫窗满 5 回合后必须恢复受击（记长/记无限的实现在此翻红）').toBeLessThanOrEqual(0);
    });
});

// ---------------------------------------------------------------------------
// 对抗④：promoteChance 10000 写错（爆炸地形不消失）
// ---------------------------------------------------------------------------
describe('F-2c 对抗④：GAS_EXPLOSION 是瞬时地形（promoteChance 10000 + VANISHES）', () => {
    it('对抗④：爆炸格在下一个晋升趟必须清层消失（promoteType 0：清层不落新 DF）。' +
        'promoteChance 记 0（永不衰老）或漏抄 VANISHES_UPON_PROMOTION（晋升了但' +
        '地形留着）的实现都翻红。CE：Globals.c:496 第 8 列 10000 + mechFlags ' +
        'VANISHES；Time.c:1644 掷骰必中、:1254-1266 清层。', () => {
        const grid = createHeadlessGame(205).grid;
        grid.setTerrainLayer(4, 4, L.SURFACE, C.GAS_EXPLOSION);

        const r = runPromotionUpdate(grid, { keyOnTileAt: () => false });

        expect(r.promotions.length, '10000 = 100%/回合：本趟必晋升').toBe(1);
        expect(r.promotions[0]!.vanished, 'VANISHES_UPON_PROMOTION：晋升即清层').toBe(true);
        expect(r.promotions[0]!.df, 'promoteType 0：晋升不落任何新 DF（不是衰老成 EMBERS）').toBeNull();
        expect(grid.getCell(4, 4)!.layers[L.SURFACE], '爆炸地形必须消失（瞬时地形）').toBe(C.NOTHING);
    });

    it('对抗④b：当回合刚落地的爆炸格被 CAUGHT_FIRE_THIS_TURN 豁免（跳过衰老' +
        '掷骰，Time.c:1625）——下一个晋升趟才消失。实测寿命 = 落地块 + 1。' +
        '漏掉豁免的实现当场把爆炸格收走（爆炸圈闪现一帧，翻红）。', () => {
        const grid = createHeadlessGame(206).grid;
        grid.setTerrainLayer(4, 4, L.SURFACE, C.GAS_EXPLOSION);

        const r1 = runPromotionUpdate(grid, {
            keyOnTileAt: () => false,
            caughtFireCells: [{ x: 4, y: 4 }],
        });
        // 生成图上可能另有可晋升格；只检查探针坐标，避免 thematic 机器
        // 新增的无关晋升把全局计数污染。
        expect(r1.promotions.some(p => p.x === 4 && p.y === 4),
            '起火登记豁免：探针格本趟不掷衰老骰').toBe(false);
        expect(grid.getCell(4, 4)!.layers[L.SURFACE]).toBe(C.GAS_EXPLOSION);

        const r2 = runPromotionUpdate(grid, { keyOnTileAt: () => false });
        expect(r2.promotions.some(p => p.x === 4 && p.y === 4),
            '下一趟（登记已被记账趟清掉）：探针格必晋升消失').toBe(true);
        expect(grid.getCell(4, 4)!.layers[L.SURFACE]).toBe(C.NOTHING);
    });
});

// ---------------------------------------------------------------------------
// 对抗⑤：瞬时伤害与燃烧伤害两笔分离（bloat 载体）
// ---------------------------------------------------------------------------
describe('F-2c 对抗⑤：两笔伤害分离（爆炸瞬时 + 燃烧后续）', () => {
    it('对抗⑤：bloat 爆炸的第 1 笔是瞬时的 max(15-20, maxHP/2)（不经燃烧状态、' +
        '不等客观块），第 2 笔是爆炸铺的火点燃生物后的燃烧结算 1-3。把两笔' +
        '合并成一笔（只点燃烧不瞬伤 / 燃烧段再爆一次 50）的实现都翻红。' +
        'CE 依据：fillSpawnMap refresh 分支（Architect.c:3255）当场结算 + ' +
        'Time.c:527 火点燃生物 → :2581 燃烧 1-3。', () => {
        const game = createHeadlessGame(207);
        openRoom(game);
        const victim = makeVictim(game, 8, 6, 100); // maxHP/2 = 50 > 20：伤害恒 50

        const bloat = new Monster(7, 6, monsterDataById('explosive_bloat'));
        bloat.hp = 0;
        game.monsters.push(bloat);

        // 第 1 笔：死亡 DF 落格瞬时（(8,6) 在第一波 350%≥100 必中圈内）。
        priv(game).triggerDeathFeatures();
        expect(victim.hp, '第 1 笔瞬时爆炸伤害恰 50（不瞬伤的合并实现在此翻红）').toBe(50);
        // U17a: 同一次 instant 调用在爆炸段之后也执行 Time.c:527 点火；伤害仍分两笔。
        expect(priv(game).burningDuration(victim), '即时点火只挂状态，尚未结算燃烧伤害').toBe(7);

        // 环境段：爆炸铺的火点燃受害者（第 2 笔载体）；爆炸本身被免疫窗挡住。
        priv(game).applyEnvironmentalEffects();
        expect(priv(game).burningDuration(victim), '爆炸的火必须点燃生物（第 2 笔载体）').toBeGreaterThan(0);
        expect(victim.hp, '免疫窗内不得重复扣爆炸伤害').toBe(50);

        // 状态段：燃烧结算 1-3（第 2 笔）——不是再来一次 50。
        priv(game).tickCreatureStatuses();
        expect(victim.hp, '第 2 笔是燃烧 1-3：合并实现（再爆 50）在此翻红').toBeGreaterThanOrEqual(47);
        expect(victim.hp, '第 2 笔必须发生（燃烧挂上了不结算的实现在此翻红）').toBeLessThan(50);
    });
});

// ---------------------------------------------------------------------------
// 对抗⑥：bloat 死亡圈形态（350/100 波前——igniteForced 回退 / 参数写错的对抗）
// ---------------------------------------------------------------------------
describe('F-2c 对抗⑥：bloat 死亡圈是 DF_BLOAT_EXPLOSION 的 350/100 波前', () => {
    it('对抗⑥：石地板上死亡格必落 GAS_EXPLOSION（种子格无条件标记），且 BFS ' +
        '距离 2/3 的格必中（第 2/3 波 250%/150% ≥ 100 恒真）——退回 igniteForced' +
        '×5（落 PLAIN_FIRE、只到距离 1）或参数错记 60/17（距离 2 只有 43%）的' +
        '实现都翻红。CE：Globals.c:654 {GAS_EXPLOSION, SURFACE, 350, 100}。', () => {
        const game = createHeadlessGame(208);
        openRoom(game); // FLOOR 地面——DF 管线不看可燃性
        const bloat = new Monster(7, 6, monsterDataById('explosive_bloat'));
        bloat.hp = 0;
        game.monsters.push(bloat);

        priv(game).triggerDeathFeatures();

        const hasBoom = (x: number, y: number) =>
            game.grid.getCell(x, y)!.layers.includes(C.GAS_EXPLOSION);
        expect(hasBoom(7, 6), '死亡格（种子格无条件）').toBe(true);
        expect(hasBoom(7, 5), '距离 1（第一波 350%≥100）').toBe(true);
        expect(hasBoom(8, 5), '距离 2 的对角（第二波 250%≥100——四方向形状的回退实现翻红）').toBe(true);
        expect(hasBoom(10, 6), '距离 3（第三波 150%≥100——参数错记 60/17 的实现翻红：那里只有 26%）').toBe(true);
        // tile 归属：落的是爆炸地形，不是旧 igniteForced 的 PLAIN_FIRE。
        expect(game.grid.getCell(7, 6)!.layers[L.SURFACE], '死亡格 SURFACE 层是 GAS_EXPLOSION').toBe(C.GAS_EXPLOSION);
    });
});

// ---------------------------------------------------------------------------
// 对抗⑦：甲烷爆轰端到端（G-2 预测验收：填 tile 后爆炸圈自动成形）
// ---------------------------------------------------------------------------
describe('F-2c 对抗⑦：甲烷爆轰端到端——真实客观块内瞬时结算', () => {
    /** 3×3 花岗岩口袋中央的甲烷：8 邻全 T_OBSTRUCTS_GAS → 点燃必爆轰
     *  （CE Time.c:1348-1356 的计数把 T_OBSTRUCTS_GAS 也算进 8 邻）。
     *  石壁不会衰老——完全确定性的爆轰台。 */
    function methanePocket(game: Game, cx: number, cy: number): void {
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                game.grid.setTerrain(cx + dx, cy + dy, C.GRANITE, '#', 0x444444);
            }
        }
        expect(game.environment.addGas(cx, cy, GasType.METHANE, 1000)).toBe(true);
    }

    it('对抗⑦：点燃 8 邻全挡格的甲烷 → 走 promoteType DF_EXPLOSION_FIRE → ' +
        'GAS_EXPLOSION 落到原点格、站上面的生物在客观块内吃到爆炸伤害并上' +
        '免疫。G-2 的预测（"填 tile 后爆炸圈自动成形"）经真实 objectiveTimeBlock ' +
        '验收；走 fireType（GAS_FIRE）的错误选路实现翻红。', () => {
        const game = createHeadlessGame(209);
        openRoom(game);
        methanePocket(game, 6, 6);
        const victim = makeVictim(game, 6, 6, 100);

        game.environment.ignite(6, 6); // 药水/火弹直燃路径（alwaysIgnite）
        priv(game).objectiveTimeBlock();

        const cell = game.grid.getCell(6, 6)!;
        expect(cell.layers[L.SURFACE], '爆轰圈落的是 GAS_EXPLOSION（G-2 预测成立）').toBe(C.GAS_EXPLOSION);
        expect(priv(game).explosionImmunityDuration(victim) > 0,
            '受害者吃过爆炸伤害（上了免疫）——没有瞬时结算的实现翻红').toBe(true);
        // 爆炸 50（env 段经 checkEntity 钩子）；同块燃烧 1-3（站在爆炸火上）
        // → hp ∈ [47,49]。两笔分离的精确口径见对抗⑤。
        expect(victim.hp, '爆炸 50 − 燃烧 1~3').toBeGreaterThanOrEqual(47);
        expect(victim.hp).toBeLessThanOrEqual(50);
        expect(victim.hp, '受击过（未受伤说明爆轰没走到/没结算）').toBeLessThan(100);
    });
});

// ---------------------------------------------------------------------------
// 对抗⑧：悬浮生物照吃爆炸伤害（CE 无悬浮豁免）
// ---------------------------------------------------------------------------
describe('F-2c 对抗⑧：悬浮不豁免爆炸（Time.c:343-344 只查免疫与潜水）', () => {
    it('对抗⑧：悬浮生物站在爆炸格上照常受击。把熔岩/深水的悬浮豁免' +
        '（Time.c:183-190）错误地复制到爆炸段的实现翻红——CE 爆炸段没有' +
        'STATUS_LEVITATING 守卫（只查 STATUS_EXPLOSION_IMMUNITY 与 ' +
        'MB_SUBMERGED，web 无潜水簿记已登记）。', () => {
        const game = createHeadlessGame(210);
        openRoom(game);
        setExplosive(game, 7, 7);
        const victim = makeVictim(game, 7, 7, 200);
        victim.applyStatus('levitating' as StatusId, 10);
        expect(victim.hasStatus('levitating')).toBe(true);

        priv(game).applyEnvironmentalEffects();

        expect(victim.hp, '悬浮生物照吃 max(15-20, 100) = 100（悬浮豁免是错误实现）').toBe(100);
    });
});

// ---------------------------------------------------------------------------
// 对抗⑨：玩家路径与 dampening 符文（Time.c:349-366）
// ---------------------------------------------------------------------------
describe('F-2c 对抗⑨：玩家受击铭牌与 dampening 符文吸收', () => {
    it('对抗⑨a：玩家站在爆炸格 → 掉 max(15-20, maxHP/2) 血且 lastDamageSource ' +
        '= violent explosion（CE gameOver "Killed by a violent explosion" 的' +
        'web 等价铭牌链）。', () => {
        const game = createHeadlessGame(211);
        openRoom(game);
        game.player.maxHp = 200;
        game.player.hp = 200;
        game.player.loc.x = 7;
        game.player.loc.y = 7;
        setExplosive(game, 7, 7);

        priv(game).applyEnvironmentalEffects();

        expect(game.player.hp, '玩家伤害同公式：max(15-20, 100) = 100').toBe(100);
        expect((game as unknown as { lastDamageSource: string }).lastDamageSource,
            '死亡铭牌链（finishTurnEpilogue → killed_by）').toBe('violent explosion');
    });

    it('对抗⑨b：dampening 护甲符文完全吸收爆炸伤害并自动鉴定（Time.c:352-359：' +
        '"Your %s pulses and absorbs the damage." + autoIdentify）——扣血的' +
        '实现（漏掉该分支）翻红。', () => {
        const game = createHeadlessGame(212);
        openRoom(game);
        game.player.maxHp = 200;
        game.player.hp = 200;
        game.player.loc.x = 7;
        game.player.loc.y = 7;
        setExplosive(game, 7, 7);
        (game.player as unknown as { equippedArmor: unknown }).equippedArmor = {
            name: 'dampening armor', runicType: 'dampening', runicKnown: false,
        };

        priv(game).applyEnvironmentalEffects();

        expect(game.player.hp, 'dampening 完全吸收：不掉血').toBe(200);
        expect((game.player as unknown as { equippedArmor: { runicKnown: boolean } }).equippedArmor.runicKnown,
            '自动鉴定（autoIdentify 等价）').toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 对抗⑩⑪：双向回归哨兵（本轮不许碰火侧/气体侧）
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 对抗⑩：火侧回归哨兵（S-1 改造：test 层合成火场——对流位移免疫）
// ---------------------------------------------------------------------------
/** S-1 火场 A（16×12 实心草块）：mode='test' 层不经真实生成器，全图覆写
 *  密封地板房、草块内点火。场景内无怪无物无共享流系统，搭后重播种——
 *  蔓延/衰老曲线只由火机制决定，任何改生成的轮次（C-5/C-6/后续）都不再
 *  触碰它。与 g_1 对抗⑧ 同场景同基线（等价副本，翻正时两处一起改）。 */
function fireFieldA(game: Game): void {
    const W = game.grid.width, H = game.grid.height;
    for (let x = 0; x < W; x++) {
        for (let y = 0; y < H; y++) {
            const border = x === 0 || y === 0 || x === W - 1 || y === H - 1;
            game.grid.setTerrain(x, y, border ? C.WALL : C.FLOOR, border ? '#' : '.', border ? 0x444444 : 0x888888);
        }
    }
    for (let x = 10; x <= 25; x++) {
        for (let y = 8; y <= 19; y++) game.grid.setTerrain(x, y, C.GRASS, '"', 0x33aa33);
    }
    game.monsters.length = 0;
    game.items.length = 0;
    game.player.loc.x = 4;
    game.player.loc.y = 4;
}

function countBurning(game: Game): number {
    let b = 0;
    for (let x = 0; x < game.grid.width; x++) {
        for (let y = 0; y < game.grid.height; y++) {
            if (game.grid.getCell(x, y)?.isBurning) b++;
        }
    }
    return b;
}

describe('F-2c 对抗⑩：火侧回归哨兵（S-1 改造：test 层合成火场 A）', () => {
    it('草块点火蔓延-衰老曲线逐位等于 S-1 基线（seed42 场景流复位）。' +
        '错误实现：本轮顺手改动火蔓延概率/衰老掷骰/4 邻判据——曲线形态立变。' +
        '原 FIRE-NAT 哨兵锚定真实地图 + 真实怪物 AI 的流位置（C-5/C-6 两次实证' +
        '漂移），S-1 起改锚全合成场景。', () => {
        const game = createHeadlessGame(42, 'test');
        fireFieldA(game);
        rng.seedRandomGenerator(42); // 场景搭好后显式重播种
        game.environment.ignite(17, 13);
        const series: number[] = [];
        for (let t = 0; t < 40; t++) {
            if (game.isGameOver) break;
            game.handlePlayerAction('wait', undefined, 'system');
            series.push(countBurning(game));
        }
        // 2026-09-17 S-1 实跑基线（火场 A，前段蔓延、后段蔓延-衰老平衡）。
        // 衰老被拆（火永生）→ 曲线持续上涨翻红；蔓延被拆 → 恒 1-2 翻红；
        // 任何新增掷骰 → 流位移 → 逐位翻红。
        expect(series).toEqual([
            2, 3, 6, 11, 13, 14, 16, 19, 20, 23, 23, 25, 27, 28, 28, 31, 32, 34, 36, 39,
            42, 47, 53, 57, 61, 63, 64, 67, 71, 70, 69, 66, 64, 64, 65, 65, 64, 62, 63, 64,
        ]);
    });
});

describe('F-2c 对抗⑪：气体侧回归哨兵（S-1 改造：test 层全隔离场景）', () => {
    it('POISON 100 体积注入 (10,8) 后前 5 个客观块的中心格体积 + 全场总体积签名' +
        '逐位一致（完整 14 回合全格基线仍在 f_2b 对抗⑦/f_2a 对抗⑪）——' +
        'updateGases/addGas/客观块次序被顺手改动的实现在此翻红', () => {
        const game = createHeadlessGame(42, 'test');
        fireFieldAFloor(game);
        rng.seedRandomGenerator(20260917); // 场景搭好后显式重播种
        game.environment.addGas(10, 8, GasType.POISON, 100);
        const center: number[] = [];
        const total: number[] = [];
        for (let t = 0; t < 5; t++) {
            priv(game).objectiveTimeBlock();
            let c = 0, sum = 0;
            for (let x = 0; x < game.grid.width; x++) {
                for (let y = 0; y < game.grid.height; y++) {
                    const g = game.environment.gasGrid[x]?.[y];
                    if (g && g.density > 0) sum += g.density;
                    if (x === 10 && y === 8) c = g?.density ?? 0;
                }
            }
            center.push(c);
            total.push(sum);
        }
        // 2026-09-17 S-1 实跑基线（test 层全隔离场景；原 2026-09-17 F-2c 基线
        // 锚定真实地图流位置，C-6 实证漂移）。
        expect(center).toEqual([11, 6, 4, 2, 2]);
        expect(total).toEqual([102, 101, 94, 91, 80]);
    });
});

/** 对抗⑪ 的场景：与火场 A 同款密封地板房（不铺草——气体用例无火）。 */
function fireFieldAFloor(game: Game): void {
    const W = game.grid.width, H = game.grid.height;
    for (let x = 0; x < W; x++) {
        for (let y = 0; y < H; y++) {
            const border = x === 0 || y === 0 || x === W - 1 || y === H - 1;
            game.grid.setTerrain(x, y, border ? C.WALL : C.FLOOR, border ? '#' : '.', border ? 0x444444 : 0x888888);
        }
    }
    game.monsters.length = 0;
    game.items.length = 0;
    game.player.loc.x = 4;
    game.player.loc.y = 4;
}
