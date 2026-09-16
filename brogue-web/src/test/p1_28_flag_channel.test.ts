/**
 * src/test/p1_28_flag_channel.test.ts — P1-28：behaviorFlags 与 abilities 两套数据通道打通
 *
 * 病灶：Monster 上 behaviorFlags（monsters.json 的 MONST_* 旗标）与 abilities
 * （小写 id）互不相通；Game.applyEnvironmentalEffects 的悬浮/火免判定读的是
 * abilities 通道，而全库没有任何 abilities 写入者、monsters.json 的 abilities
 * 字段对飞行/火免恒空——旗标怪（wisp 等 20 种）的 MONST_IMMUNE_TO_FIRE /
 * MONST_FLIES 完全不起作用，趟岩浆的火系生物被岩浆烧死。
 *
 * 方案（复刻 CE initializeStatus，Monsters.c:3904-3928）：Monster 构造/突变时
 * 把 MONST_FLIES → 永久 'levitating'（1000）、MONST_IMMUNE_TO_FIRE → 永久
 * 'immune_fire'（1000）；CE updateMonsterStatus（Monsters.c:1852-1856 /
 * 1963-1967）对带旗标者不递减这两个状态，由 Creature.isStatusPermanent 钩子
 * 复刻。CE 的下游消费点全部只读 status 通道，web 的三处读取点（Game.ts
 * applyEnvironmentalEffects 的 isFlying / 熔岩 / 火焰分支）由此自然生效，
 * Monster.specificallyValidBoltTarget 的 fiery 分支（CE Monsters.c:2624 读
 * status）同样被修复。
 *
 * 火焰分支同时对齐 CE exposeCreatureToFire（Time.c:28-35）：移除 CE 不存在的
 * !hasStatus('levitating') 豁免（CE 火焰地形照烧悬浮生物，Time.c:527 无悬浮
 * 条款；且它会让旗标飞行怪经派生悬浮获得 CE 没有的火免），补 MONST_INVULNERABLE
 * 豁免（原实现缺，Warden 站火里会被烧）。
 *
 * 每条测试前的注释写明它能捕获的具体错误实现；反向验证（真实改坏、真实失败
 * 输出、还原）见 ai_docs/p1_28_flag_channel_report.md。
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { Monster, type MonsterData, specificallyValidBoltTarget } from '../entities/Monster';
import { TerrainType } from '../engine/Map/Grid';
import { logger } from '../engine/Systems/Logger';
import monsterDataJson from '../data/monsters.json';

const MONSTER_DATA = monsterDataJson as MonsterData[];

function monsterDataById(id: string): MonsterData {
    const row = MONSTER_DATA.find(m => m.id === id);
    if (!row) throw new Error(`monsters.json 中找不到 ${id}`);
    return row;
}

function clearToOpenRoom(game: Game): void {
    game.monsters.length = 0;
    game.items.length = 0;
    for (let x = 1; x < 30; x++) {
        for (let y = 1; y < 20; y++) {
            game.grid.setTerrain(x, y, TerrainType.WALL, '#', 0x444444);
        }
    }
    for (let x = 2; x <= 16; x++) {
        for (let y = 2; y <= 12; y++) {
            game.grid.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
            const cell = game.grid.getCell(x, y);
            if (cell) cell.isVisible = true;
        }
    }
    game.player.loc.x = 4;
    game.player.loc.y = 5;
    game.player.hp = game.player.maxHp;
}

function setTile(game: Game, x: number, y: number, terrain: TerrainType): void {
    game.grid.setTerrain(x, y, terrain, '~', 0x3366cc);
    const cell = game.grid.getCell(x, y);
    if (cell) cell.isVisible = true;
}

/** 包装 logger.log 统计真实调用次数（Logger 会合并连续同文，不能靠 messages 数）。 */
function wrapLog(): { calls: string[]; restore: () => void } {
    const calls: string[] = [];
    const original = logger.log.bind(logger);
    logger.log = (text: string, color?: string) => {
        calls.push(text);
        original(text, color);
    };
    return { calls, restore: () => { delete (logger as { log?: unknown }).log; } };
}

function priv(game: Game): any {
    return game as any;
}

function tickEnvironment(game: Game, turns: number): void {
    for (let i = 0; i < turns; i++) {
        priv(game).applyEnvironmentalEffects();
    }
}

// ---------------------------------------------------------------------------
// 验收核心：behaviorFlags 里的 MONST_IMMUNE_TO_FIRE / MONST_FLIES 在熔岩处生效
// （CE applyInstantTileEffectsToCreature Time.c:183-190 的豁免：悬浮/火免/无敌）
// ---------------------------------------------------------------------------
describe('P1-28：熔岩豁免经旗标通道生效', () => {
    it('对抗性①（验收核心）：火焰免疫的 Wisp 站在熔岩里连续多回合必须存活。' +
        'Wisp 同时带 MONST_IMMUNE_TO_FIRE 与 MONST_FLIES，CE 里两道豁免齐备' +
        '（Monsters.c:3917/3915 派生永久状态）。捕获的错误实现：改动前的 web——' +
        '熔岩分支只查 abilities.has(\'immune_fire\')（全库无写入者，恒 false），' +
        'wisp 第一轮就被烧死（hp=0、char=\'%\'）。', () => {
        const game = createHeadlessGame(20260916);
        clearToOpenRoom(game);
        setTile(game, 7, 6, TerrainType.LAVA);

        const wispData = monsterDataById('wisp');
        // 前置：数据带双旗标（防数据漂移让本条退化成平凡通过）
        expect(wispData.behaviorFlags).toContain('MONST_IMMUNE_TO_FIRE');
        expect(wispData.behaviorFlags).toContain('MONST_FLIES');
        const wisp = new Monster(7, 6, wispData);
        // 前置：翻译层已把旗标落成状态
        expect(wisp.hasStatus('immune_fire')).toBe(true);
        expect(wisp.hasStatus('levitating')).toBe(true);
        game.monsters.push(wisp);

        const { calls, restore } = wrapLog();
        try {
            tickEnvironment(game, 5);
        } finally {
            restore();
        }

        expect(wisp.hp).toBe(wisp.maxHp);       // 满血：任何被烧都至少扣到 <maxHp
        expect(wisp.char).not.toBe('%');        // 没有被当成尸体
        expect(game.monsters.find(m => m === wisp)).toBeDefined();
        expect(calls.filter(t => t.includes('incinerated')).length).toBe(0);
    });

    it('对抗性②：只有 MONST_FLIES（无火免）的 vampire_bat 站熔岩也必须存活——' +
        'CE 里 MONST_FLIES 派生永久 STATUS_LEVITATING（Monsters.c:3915-3916），' +
        '熔岩条款的第一豁免就是悬浮。捕获的错误实现：只把 MONST_IMMUNE_TO_FIRE ' +
        '接进判定、漏掉飞行豁免（或反向），bat 被烧死。', () => {
        const game = createHeadlessGame(20260916);
        clearToOpenRoom(game);
        setTile(game, 7, 6, TerrainType.LAVA);

        const bat = new Monster(7, 6, monsterDataById('vampire_bat'));
        expect(bat.hasBehavior('MONST_FLIES')).toBe(true);
        expect(bat.hasStatus('immune_fire')).toBe(false); // 前置：无火免，豁免只能来自飞行
        game.monsters.push(bat);

        tickEnvironment(game, 5);

        expect(bat.hp).toBe(bat.maxHp);
        expect(bat.char).not.toBe('%');
        expect(game.monsters.find(m => m === bat)).toBeDefined();
    });

    it('对照组：既不免疫也不飞的 rat 站熔岩照样烧死——防止"把熔岩分支整体关掉"' +
        '或"翻译层误把所有怪都派生豁免"的错误实现。', () => {
        const game = createHeadlessGame(20260916);
        clearToOpenRoom(game);
        setTile(game, 7, 6, TerrainType.LAVA);

        const rat = new Monster(7, 6, monsterDataById('rat'));
        expect(rat.hasStatus('immune_fire')).toBe(false);
        expect(rat.hasStatus('levitating')).toBe(false);
        game.monsters.push(rat);

        const { calls, restore } = wrapLog();
        try {
            tickEnvironment(game, 3);
        } finally {
            restore();
        }

        expect(rat.hp).toBe(0);
        expect(rat.char).toBe('%');
        expect(calls.filter(t => t.includes('incinerated')).length).toBe(1);
    });

    it('对照组（P1-27 回归守卫）：MONST_INVULNERABLE 的 Warden of Yendor 站熔岩' +
        '继续存活——本轮不得改坏 P1-27 补齐的第三条豁免。捕获的错误实现：重构' +
        '熔岩分支时丢掉 isInvulnerable 条款。', () => {
        const game = createHeadlessGame(20260916);
        clearToOpenRoom(game);
        setTile(game, 7, 6, TerrainType.LAVA);

        const warden = new Monster(7, 6, monsterDataById('Warden_of_Yendor'));
        expect(warden.hasBehavior('MONST_INVULNERABLE')).toBe(true);
        game.monsters.push(warden);

        tickEnvironment(game, 3);

        expect(warden.hp).toBe(warden.maxHp);
        expect(warden.char).not.toBe('%');
    });
});

// ---------------------------------------------------------------------------
// 派生状态的"不衰减"条款（CE updateMonsterStatus Monsters.c:1852-1856/1963-1967）
// ---------------------------------------------------------------------------
describe('P1-28：旗标派生的永久状态不随回合衰减', () => {
    it('对抗性③：wisp 的 levitating/immune_fire 连续 tick 50 次后必须原封不动' +
        '（CE 字面 1000，源码注释：不衰减）。捕获的错误实现：只做旗标→状态翻译、' +
        '漏掉 updateMonsterStatus 的不递减守卫——每回合 -1，50 轮后 <1000。', () => {
        const wisp = new Monster(5, 5, monsterDataById('wisp'));
        expect(wisp.getStatusDuration('levitating')).toBe(1000);
        expect(wisp.getStatusDuration('immune_fire')).toBe(1000);
        for (let i = 0; i < 50; i++) wisp.tickStatuses();
        expect(wisp.getStatusDuration('levitating')).toBe(1000);
        expect(wisp.getStatusDuration('immune_fire')).toBe(1000);
    });

    it('对照组：临时（非旗标派生）状态必须照常衰减——防止 isStatusPermanent ' +
        '守卫被写成"所有 levitating 永久"，把药水悬浮也变成永动机。', () => {
        const rat = new Monster(5, 5, monsterDataById('rat'));
        rat.applyStatus('levitating', 3);
        expect(rat.getStatusDuration('levitating')).toBe(3);
        rat.tickStatuses();
        rat.tickStatuses();
        expect(rat.getStatusDuration('levitating')).toBe(1);
        const expired = rat.tickStatuses();
        expect(expired).toContain('levitating');
        expect(rat.hasStatus('levitating')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// 火焰地形分支的 CE 形状（exposeCreatureToFire，Time.c:28-35/527-530）
// ---------------------------------------------------------------------------
describe('P1-28：火焰地形分支对齐 exposeCreatureToFire', () => {
    it('对抗性④：Wisp 站在燃烧格上不受伤——火免旗标在火焰地形处同样生效' +
        '（CE：T_IS_FIRE → exposeCreatureToFire，STATUS_IMMUNE_TO_FIRE 直接' +
        'return）。捕获的错误实现：改动前的 web——火焰分支的火免通道同样是死的' +
        'abilities 查询，wisp 每轮被平扣 2 点。', () => {
        const game = createHeadlessGame(20260916);
        clearToOpenRoom(game);
        // F-1 改写（经公共入口点火）：原直写 cell.isBurning/burnDuration，
        // 火成地形后由 igniteForced 双写承载。五处同型，逐一替换。
        game.environment.igniteForced(7, 6, 5);

        const wisp = new Monster(7, 6, monsterDataById('wisp'));
        game.monsters.push(wisp);

        tickEnvironment(game, 4);

        expect(wisp.hp).toBe(wisp.maxHp);
        expect(wisp.char).not.toBe('%');
    });

    it('对照组：rat 站燃烧格每轮平扣 2 点且不死透——锁定火焰分支本身仍然工作' +
        '（防止"顺手把火焰分支关掉"），同时锁定伤害额（多扣/少扣都红）。', () => {
        const game = createHeadlessGame(20260916);
        clearToOpenRoom(game);
        // F-1 改写（经公共入口点火），见上。
        game.environment.igniteForced(7, 6, 5);

        const rat = new Monster(7, 6, monsterDataById('rat'));
        rat.hp = 10;
        game.monsters.push(rat);

        tickEnvironment(game, 2);

        expect(rat.hp).toBe(6); // 10 - 2×2：恰好两轮平扣
    });

    it('对抗性⑤：MONST_INVULNERABLE 的 Warden 站燃烧格不受伤——CE ' +
        'exposeCreatureToFire 的 MONST_INVULNERABLE 豁免（Time.c:31），' +
        '原 web 火焰分支没有这条。捕获的错误实现：只修旗标通道、漏补无敌豁免。', () => {
        const game = createHeadlessGame(20260916);
        clearToOpenRoom(game);
        // F-1 改写（经公共入口点火），见上。
        game.environment.igniteForced(7, 6, 5);

        const warden = new Monster(7, 6, monsterDataById('Warden_of_Yendor'));
        game.monsters.push(warden);

        tickEnvironment(game, 4);

        expect(warden.hp).toBe(warden.maxHp);
    });

    it('对抗性⑥：旗标飞行的 vampire_bat 站燃烧格照样受伤——CE 火焰地形不豁免' +
        '悬浮生物（Time.c:527 无悬浮条款），原 web 的 !hasStatus(\'levitating\') ' +
        '豁免会让 bat 经派生悬浮状态获得 CE 没有的火免（本轮移除该豁免）。' +
        '捕获的错误实现：保留悬浮豁免只补旗标翻译。', () => {
        const game = createHeadlessGame(20260916);
        clearToOpenRoom(game);
        // F-1 改写（经公共入口点火），见上。
        game.environment.igniteForced(7, 6, 5);

        const bat = new Monster(7, 6, monsterDataById('vampire_bat'));
        expect(bat.hasStatus('levitating')).toBe(true); // 派生悬浮确实在位
        bat.hp = 10;
        game.monsters.push(bat);

        tickEnvironment(game, 1);

        expect(bat.hp).toBe(8); // 悬浮不豁免火焰地形：照样平扣 2
    });

    it('对抗性⑥（玩家侧）：悬浮药水状态下的玩家站燃烧格照样受伤——CE 玩家' +
        '悬浮踩火同样被 exposeCreatureToFire 点燃（Time.c:8085 玩家同条款）。' +
        '捕获的错误实现：怪物侧移除了悬浮豁免、玩家侧残留（分支拆成两半）。', () => {
        const game = createHeadlessGame(20260916);
        clearToOpenRoom(game);
        // F-1 改写（经公共入口点火），见上。
        game.environment.igniteForced(4, 5, 5);
        game.player.applyStatus('levitating', 10);
        expect(game.player.hasStatus('levitating')).toBe(true);

        tickEnvironment(game, 1);

        expect(game.player.hp).toBe(game.player.maxHp - 2);
        expect(game.isGameOver).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// 翻译层的两个下游接线：fiery bolt 目标筛选 / negate 后重推导 / 快照往返
// ---------------------------------------------------------------------------
describe('P1-28：旗标→状态翻译层的下游接线', () => {
    it('对抗性⑦：fiery bolt 的目标筛选必须把火免旗标怪排除在外——CE ' +
        'specificallyValidBoltTarget 读 target->status[STATUS_IMMUNE_TO_FIRE] ' +
        '（Monsters.c:2624），旗标怪恒有该状态。捕获的错误实现：改动前的 web——' +
        'wisp 没有状态，FIRE bolt 视其为合法目标。', () => {
        const game = createHeadlessGame(20260916);
        clearToOpenRoom(game);

        const caster = new Monster(6, 5, monsterDataById('goblin'));
        const wisp = new Monster(8, 5, monsterDataById('wisp'));
        wisp.isAlly = true;
        const rat = new Monster(10, 5, monsterDataById('rat'));
        rat.isAlly = true;

        expect(specificallyValidBoltTarget(caster, wisp, 'FIRE', game)).toBe(false);
        expect(specificallyValidBoltTarget(caster, rat, 'FIRE', game)).toBe(true); // 无火免者仍合法
    });

    it('对抗性⑧：negation 命中飞行怪后，临时状态被清、旗标派生状态必须重推导' +
        '（web 的 negate 不剥离 behaviorFlags，清空后不回填会让 bat 永久失去' +
        '飞行，CE 语义只是临时剥离）。捕获的错误实现：negate 清状态后漏调 ' +
        'syncFlagDerivedStatuses——hasted 清零 ✔ 但 levitating 归 0，bat 随后' +
        '在熔岩里被烧死。', () => {
        const game = createHeadlessGame(20260916);
        clearToOpenRoom(game);

        const caster = new Monster(6, 5, monsterDataById('goblin'));
        const bat = new Monster(8, 5, monsterDataById('vampire_bat'));
        bat.isAlly = true;
        bat.applyStatus('hasted', 5); // 可被 negate 清掉的临时状态（对照组半边）
        game.monsters.push(bat, caster);

        game.castMonsterBolt(caster, bat, 'NEGATION');

        expect(bat.getStatusDuration('hasted')).toBe(0);      // 临时状态：真的被清
        expect(bat.getStatusDuration('levitating')).toBe(1000); // 派生状态：重推导回填

        // 被消除魔法后的 bat 随后站熔岩：仍然飞行、仍然不死
        setTile(game, 8, 5, TerrainType.LAVA);
        tickEnvironment(game, 3);
        expect(bat.hp).toBe(bat.maxHp);
        expect(bat.char).not.toBe('%');
    });

    it('对抗性⑨：快照往返后 wisp 的派生免疫必须存活、且在熔岩里继续存活——' +
        'serializeMonster 不持久化 behaviorFlags（读档怪没有旗标），本条锁定' +
        '"翻译成 statusDurations"方案对存档的存活属性。捕获的错误实现：改为' +
        '"读取处直接查 behaviorFlags"的方案——读档重建的怪没有旗标，往返后熔岩死。', () => {
        const game = createHeadlessGame(20260916);
        clearToOpenRoom(game);
        const wisp = new Monster(7, 6, monsterDataById('wisp'));
        game.monsters.push(wisp);

        const snap = game.toSnapshot();
        const reloaded = createHeadlessGame(1);
        expect(reloaded.loadSnapshot(snap)).toBe(true);

        const restored = reloaded.monsters.find(m => m.typeId === 'wisp');
        expect(restored).toBeDefined();
        expect(restored!.getStatusDuration('immune_fire')).toBe(1000);
        expect(restored!.getStatusDuration('levitating')).toBe(1000);

        setTile(reloaded, restored!.loc.x, restored!.loc.y, TerrainType.LAVA);
        for (let i = 0; i < 3; i++) priv(reloaded).applyEnvironmentalEffects();
        expect(restored!.hp).toBe(restored!.maxHp);
        expect(restored!.char).not.toBe('%');
    });
});
