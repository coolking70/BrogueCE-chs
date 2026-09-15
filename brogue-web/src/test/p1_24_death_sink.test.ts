/**
 * src/test/p1_24_death_sink.test.ts — P1-24：环境/战斗杀死的怪物必须真的死了
 *
 * 病灶：Creature.die() 此前只改尸体外观（'%' + 深红），不归零 hp。
 * Game.applyEnvironmentalEffects 的熔岩分支把 die() 当唯一致死手段，
 * 结果怪物满血留在 this.monsters 里：继续行动、继续攻击、死亡消息每回合重播，
 * playerTurnEnded 的 filter(m => m.hp > 0) 永远清不掉。
 *
 * P1-27 补做（2026-09-15，验收打回后授权改写本文件）：web 自创的"深水淹死"
 * 已按决策 D2 移除（WEB_ONLY_DEEP_WATER_DROWNING=false，见
 * ai_docs/p1_27_remove_drowning_report.md），原以"淹死"为载体的 7 条测试
 * 随之改写——机制覆盖不变，载体换成 CE 真实存在的即死地形熔岩，或改断言
 * "深水不致死"这一新事实；逐条映射见该报告的补做章节。
 *
 * CE 对照（见 ai_docs/p1_24_death_sink_report.md）：
 *   - killCreature 最后 currentHP = 0          Combat.c:2042
 *   - MB_IS_DYING|MB_HAS_DIED 幂等守卫          Combat.c:1938-1941
 *   - 死亡 DF 只被 administrativeDeath/MB_IS_FALLING 抑制，无水/岩浆否决
 *                                              Combat.c:1963-1967
 *   - DF_BLOAT_DEATH = GAS 层毒气，spawnDungeonFeature 无条件加体积
 *                                              Globals.c:651（DF 表 34 号）
 *   - DF_BLOAT_EXPLOSION = 表层 GAS_EXPLOSION 火格，爆炸伤害只豁免
 *     STATUS_EXPLOSION_IMMUNITY 与 MB_SUBMERGED，没有"站在水里"豁免
 *                                              Time.c:343-345
 * 结论：水中/岩浆中死亡的膨胀怪照常触发死亡地形——本文件把该结论锁死。
 *
 * 对抗性测试与"能捕获的具体错误实现"逐条标注在每个 it() 前的注释里；
 * 反向验证（真实改坏代码、跑出失败、贴输出、再还原）见报告。
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { Monster, type MonsterData } from '../entities/Monster';
import { TerrainType } from '../engine/Map/Grid';
import { GasType } from '../engine/Environment/Gas';
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

/** 把 (x,y) 铺成指定地形（深水/熔岩），保持可见。 */
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

// ---------------------------------------------------------------------------
// 验收 1：die() 是真正的致死收口
// ---------------------------------------------------------------------------
describe('P1-24 验收 1：die() 归零 hp，怪物真的被移出列表', () => {
    it('对抗性①：熔岩烧死后 hp 必须精确为 0（CE Combat.c:2042 currentHP=0）。' +
        '捕获的错误实现：die() 保持旧版只改外观不归零——6 HP 的老鼠被烧死后 hp 仍是 6，' +
        '断言 hp===0 直接失败。（P1-27 补做：载体由"深水淹死"换成 CE 唯一即死地形熔岩，' +
        '同一 die() 收口；rat 无悬浮/火焰免疫/MONST_INVULNERABLE，三条熔岩豁免均不适用。）', () => {
        const game = createHeadlessGame(21);
        clearToOpenRoom(game);
        setTile(game, 7, 6, TerrainType.LAVA);

        const rat = new Monster(7, 6, monsterDataById('rat'));
        expect(rat.hp).toBe(6); // 前置：满血踏上熔岩
        game.monsters.push(rat);

        priv(game).applyEnvironmentalEffects();

        expect(rat.hp).toBe(0);
        expect(rat.char).toBe('%');
    });

    it('对抗性①（续）：熔岩烧死的怪物必须在下一次回合清扫中被移出 this.monsters。' +
        '捕获的错误实现：同上——旧实现 hp>0，filter(m => m.hp > 0) 永远清不掉，' +
        '怪物赖在列表里。（P1-27 补做：载体由淹死换成熔岩，清扫路径同一。）', () => {
        const game = createHeadlessGame(22);
        clearToOpenRoom(game);
        setTile(game, 7, 6, TerrainType.LAVA);

        const rat = new Monster(7, 6, monsterDataById('rat'));
        game.monsters.push(rat);

        priv(game).applyEnvironmentalEffects();
        priv(game).playerTurnEnded();

        expect(game.monsters.find(m => m === rat)).toBeUndefined();
    });

    it('对抗性①（续）：熔岩烧死的尸体不再苏醒/不再行动——沉睡老鼠被烧死后 takeTurn 必须是空转。' +
        '捕获的错误实现：die() 不归零（旧版）时，takeTurn 会照常走"沉睡→惊醒"分支，' +
        '在玩家头顶弹 \'!\' 漂浮字并进入追击。（P1-27 补做：载体由淹死换成熔岩。）', () => {
        const game = createHeadlessGame(23);
        clearToOpenRoom(game);
        setTile(game, 7, 6, TerrainType.LAVA);

        const rat = new Monster(7, 6, monsterDataById('rat'));
        rat.state = 0; // ASLEEP：若 die() 没归零，相邻玩家会把它惊醒（弹 '!'）
        game.monsters.push(rat);
        const player = game.player;
        player.loc.x = 6; player.loc.y = 6; // 与熔岩格相邻

        priv(game).applyEnvironmentalEffects();
        const floatsBefore = game.floatingTexts.length;
        const playerHpBefore = player.hp;
        rat.takeTurn(game, 3);

        expect(rat.hp).toBe(0);
        expect(game.floatingTexts.length).toBe(floatsBefore); // 没有 '!' 惊醒字
        expect(player.hp).toBe(playerHpBefore);               // 也没有攻击
    });

    it('对抗性②（P1-27 重写为断言新事实）：移除自创淹死后，深水里的怪物不产生任何死亡消息——' +
        '连续两轮环境结算，"drown" 必须零出现，Logger 里必须根本不存在这条合并条目。' +
        '捕获的错误实现：①WEB_ONLY_DEEP_WATER_DROWNING 被改回 true（或任何深水致死' +
        '实现复活）——第一轮就冒出 "drowns"；②只删致死逻辑、却把消息日志留在' +
        '标志之外的"半吊子移除"重排。与 p1_27 文件对抗性①（seed 71）的区别：' +
        '那条从 hp/在场通道断言"活着"，本条专门盯消息通道（Logger 合并条目本身' +
        '必须不存在——原"count===1"断言在新事实下的对应物）。', () => {
        const game = createHeadlessGame(24);
        clearToOpenRoom(game);
        setTile(game, 7, 6, TerrainType.WATER_DEEP);

        const rat = new Monster(7, 6, monsterDataById('rat'));
        game.monsters.push(rat);

        const { calls, restore } = wrapLog();
        try {
            priv(game).applyEnvironmentalEffects();
            priv(game).applyEnvironmentalEffects(); // 第二轮：同样必须安静
        } finally {
            restore();
        }

        expect(rat.hp).toBe(6); // 前置事实：它根本没死，自然不该有任何死亡消息
        expect(calls.filter(t => t.includes('drown')).length).toBe(0);
        const entry = logger.messages.find(m => m.text.includes('drown'));
        expect(entry).toBeUndefined(); // 连合并条目都不许存在
    });

    it('对抗性②（续）：熔岩烧死同理，"incinerated" 只播一次。', () => {
        const game = createHeadlessGame(25);
        clearToOpenRoom(game);
        setTile(game, 7, 6, TerrainType.LAVA);

        const rat = new Monster(7, 6, monsterDataById('rat'));
        game.monsters.push(rat);

        const { calls, restore } = wrapLog();
        try {
            priv(game).applyEnvironmentalEffects();
            priv(game).applyEnvironmentalEffects();
        } finally {
            restore();
        }

        expect(calls.filter(t => t.includes('incinerated')).length).toBe(1);
        const entry = logger.messages.find(m => m.text.includes('incinerated'));
        expect(entry!.count).toBe(1);
    });

    it('对抗性③：hp -= N 之后才调用 die() 的既有路径不得被改成重复结算——' +
        '火焰致死的尸体 hp 必须精确停在 0（CE 口径），不能是负数。' +
        '捕获的错误实现：把 die() 写成"再补一刀"（如 hp -= maxHp 确保死亡），' +
        '2 HP 的受害者被火焰扣到 0 后又被补刀扣成负数，=== 0 断言失败。', () => {
        const game = createHeadlessGame(26);
        clearToOpenRoom(game);
        const cell = game.grid.getCell(7, 6)!;
        cell.isBurning = true; // 燃烧格：每轮对格上生物 -2
        cell.burnDuration = 5;

        const victim = new Monster(7, 6, monsterDataById('rat'));
        victim.hp = 2; // 恰好一烧即死
        game.monsters.push(victim);

        const { calls, restore } = wrapLog();
        try {
            priv(game).applyEnvironmentalEffects();
        } finally {
            restore();
        }

        expect(victim.hp).toBe(0); // 精确 0：既不是 -4（重复结算），也没被漏杀
        expect(victim.char).toBe('%');
        expect(calls.filter(t => t.includes('burns to death')).length).toBe(1);
    });

    it('对抗性③（续）：蒸汽致死同样精确归零——1 HP 受害者被蒸汽扣 1 后死透，' +
        '不残留负 hp（重复结算实现会把它扣成 -1 或更低）。', () => {
        const game = createHeadlessGame(27);
        clearToOpenRoom(game);
        game.environment.addGas(7, 6, GasType.STEAM, 50); // density>20 才结算

        const victim = new Monster(7, 6, monsterDataById('rat'));
        victim.hp = 1;
        game.monsters.push(victim);

        priv(game).applyEnvironmentalEffects();

        expect(victim.hp).toBe(0);
        expect(victim.char).toBe('%');
    });
});

// ---------------------------------------------------------------------------
// 验收 2：与 P4-4 的交互——水中/岩浆中死亡照常触发死亡地形（CE 行为）
// CE 依据：killCreature 传 administrativeDeath=false，MA_DF_ON_DEATH 分支只看
// MB_IS_FALLING（Combat.c:1963-1965）；spawnDungeonFeature 对 GAS 层无条件加
// 体积、对表层格 killCreature 传 abortIfBlocking=false（Architect.c:3359 起），
// 全链路没有"脚下是水/岩浆就不触发"的判断；爆炸伤害豁免里也没有水
// （Time.c:343-345 只豁免爆炸免疫与 MB_SUBMERGED）。
//
// P1-27 补做：原"深水里的 bloat 淹死后放毒气"一条的载体（淹死）已移除，且其
// 结论与本 describe 底部"被砍死在水里的 bloat 一样放毒气"对照组走同一条代码
// 路径（triggerDeathFeatures 不读地形），仅地形标签不同、无独立判别力——按
// 任务书授权合并进该对照组（浅水角保留）；"深水不抑制死亡地形"这一角由下方
// 深水爆燃条接管（深水格上点火，比毒气更贴近水真正可能抑制的对象——火）。
// ---------------------------------------------------------------------------
describe('P1-24 验收 2：水中/岩浆中死亡的死亡地形照常触发', () => {
    it('对抗性④（续）：岩浆里的 explosive bloat 烧死后照样爆燃——死亡格与四邻点燃。' +
        'CE 岩浆致死走 killCreature(monst, false)（Time.c:218），DF 不被抑制。' +
        '"岩浆里就不用点火"的错误实现会在 isBurning 断言上失败。', () => {
        const game = createHeadlessGame(29);
        clearToOpenRoom(game);
        setTile(game, 7, 6, TerrainType.LAVA); // 邻格保持 FLOOR，观察四邻点火

        const bloat = new Monster(7, 6, monsterDataById('explosive_bloat'));
        game.monsters.push(bloat);

        priv(game).applyEnvironmentalEffects();
        expect(bloat.hp).toBe(0);
        priv(game).triggerDeathFeatures();

        expect(game.grid.getCell(7, 6)?.isBurning).toBe(true);
        expect(game.grid.getCell(7, 5)?.isBurning).toBe(true);
        expect(game.grid.getCell(7, 7)?.isBurning).toBe(true);
        expect(game.grid.getCell(6, 6)?.isBurning).toBe(true);
        expect(game.grid.getCell(8, 6)?.isBurning).toBe(true);
        expect(bloat.deathEffectTriggered).toBe(true);
    });

    it('对抗性④（续，P1-27 载体重写）：深水里的 explosive bloat 被玩家砍死后照样爆燃——' +
        '"水里燃起大火"是 CE 行为：GAS_EXPLOSION 火格铺在表层、覆盖在水上；' +
        'killCreature 的死亡 DF 分支只认 MB_IS_FALLING（Combat.c:1963-1965），' +
        '爆炸伤害只豁免爆炸免疫与 MB_SUBMERGED（Time.c:343-345），站水里的生物' +
        '没有豁免。原载体"淹死后触发 DF"已随淹死移除；本条同时接管原"深水毒气"' +
        '条的深水角——上一轮还是 web 自创即死地形的深水，不抑制死亡地形。' +
        '捕获的错误实现：①"水中死亡抑制死亡地形"被实现成水中跳过 DF——' +
        'isBurning 恒 false；②给深水补 CE 的 TM_EXTINGUISHES_FIRE 语义时把死亡' +
        '点燃一并掐掉——同样在此失败。', () => {
        const game = createHeadlessGame(30);
        clearToOpenRoom(game);
        setTile(game, 7, 6, TerrainType.WATER_DEEP);

        const bloat = new Monster(7, 6, monsterDataById('explosive_bloat'));
        bloat.hp = 1;            // 保证必死：不依赖玩家伤害掷骰的最小值
        bloat.defense = -999;    // 保证必定命中
        game.monsters.push(bloat);
        const player = game.player;
        player.loc.x = 6; player.loc.y = 6; // 与深水格相邻

        // 玩家近战：攻击分支只看格上有没有怪、不看地形（Game.ts move 分支
        // getMonsterAt 先于 canMoveTo），站深水格的怪照常被砍。
        game.handlePlayerAction('move', { x: 1, y: 0 }, 'system');

        expect(game.stats.kills).toBe(1);       // 前置确认：确实死于玩家这刀
        expect(bloat.hp).toBe(0);               // die() 收口
        expect(game.monsters.find(m => m === bloat)).toBeUndefined(); // 同回合已清扫
        expect(game.grid.getCell(7, 6)?.isBurning).toBe(true);  // 深水格本体在烧
        expect(game.grid.getCell(8, 6)?.isBurning).toBe(true);  // 邻格在烧
        expect(bloat.deathEffectTriggered).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 验收 3：对照组——正常战斗致死行为不变
// ---------------------------------------------------------------------------
describe('P1-24 验收 3：对照组——正常战斗致死不受影响', () => {
    it('玩家近战击杀 bloat：仍被清扫、仍掉落、死亡地形照常触发、hp 精确归零。' +
        '捕获的错误实现：die() 归零被写成"在 die() 里额外扣一次伤害/改动 takeDamage' +
        '语义"——hp 会偏离 0，或掉落/清扫路径被误伤。', () => {
        const game = createHeadlessGame(31);
        clearToOpenRoom(game);

        const bloat = new Monster(5, 5, monsterDataById('bloat'));
        bloat.hp = 2;            // 保证一刀必死（玩家命中即 ≥1 伤害）
        bloat.defense = -999;    // 保证必定命中
        bloat.goldDropChance = 1;  // randPercent(100) 恒真 → 必掉金
        bloat.itemDropChance = 1;  // 必掉物品
        game.monsters.push(bloat);
        const player = game.player;
        player.loc.x = 4; player.loc.y = 5;

        game.handlePlayerAction('move', { x: 1, y: 0 }, 'system');

        // 击杀落账
        expect(game.stats.kills).toBe(1);
        // die() 收口：hp 精确归零（takeDamage 扣到 <=0 后由 die() 钳到 0）
        expect(bloat.hp).toBe(0);
        // 清扫：本回合内被移出列表
        expect(game.monsters.find(m => m === bloat)).toBeUndefined();
        // 掉落：金 + 物品各一（randPercent(100) 恒真）
        expect(game.items.length).toBe(2);
        expect(game.items.some(i => i.char === '$')).toBe(true);
        // 死亡地形：MA_DF_ON_DEATH 照常（与修复前一致的既有行为）
        expect(game.environment.gasGrid[5]![5]!.type).toBe(GasType.POISON);
        expect(game.environment.gasGrid[5]![5]!.density).toBeGreaterThan(0);
    });

    it('对照组：战斗致死与水淹致死走同一条收口——被玩家砍死在水里的 bloat 一样放毒气' +
        '（CE：killCreature 不区分伤害来源，只看 administrativeDeath/MB_IS_FALLING）。', () => {
        const game = createHeadlessGame(32);
        clearToOpenRoom(game);
        setTile(game, 5, 5, TerrainType.WATER_SHALLOW); // 浅水不淹死，怪站在水里挨打

        const bloat = new Monster(5, 5, monsterDataById('bloat'));
        bloat.hp = 2;
        bloat.defense = -999;
        game.monsters.push(bloat);
        const player = game.player;
        player.loc.x = 4; player.loc.y = 5;

        game.handlePlayerAction('move', { x: 1, y: 0 }, 'system');

        expect(bloat.hp).toBe(0);
        expect(game.monsters.find(m => m === bloat)).toBeUndefined();
        expect(game.environment.gasGrid[5]![5]!.type).toBe(GasType.POISON);
        expect(game.environment.gasGrid[5]![5]!.density).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// 验收 4：玩家路径——熔岩仍走 triggerGameOver；深水已按 P1-27/D2 不再致死
// ---------------------------------------------------------------------------
describe('P1-24 验收 4：玩家落熔岩仍走 triggerGameOver，落深水不再 game over', () => {
    it('玩家泡在深水里（P1-27 重写为断言新事实）：不 game over，hp 与外观都不受影响——' +
        '连续两轮环境结算也是同样结果。CE 深水零伤害（Time.c:1146-1150 "You fall ' +
        'into deep water, unharmed."），web 自创的玩家淹死分支已被 ' +
        'WEB_ONLY_DEEP_WATER_DROWNING=false 退出生效路径。捕获的错误实现：' +
        '①标志被改回 true（或玩家分支被复活）——第一轮 isGameOver 就翻 true；' +
        '②"半吊子移除"——不 game over 了却把玩家 hp 清 0 或 char 变 %（误走了 die()）。' +
        '任一都在本条失败。', () => {
        const game = createHeadlessGame(33);
        clearToOpenRoom(game);
        setTile(game, 4, 5, TerrainType.WATER_DEEP); // 玩家脚下

        const player = game.player;
        player.hp = 30; // 满血入水：深水与 hp 无关
        expect(player.char).toBe('@');

        priv(game).applyEnvironmentalEffects();
        priv(game).applyEnvironmentalEffects(); // 第二轮：同样不许有任何后果

        expect(game.isGameOver).toBe(false);
        expect(player.hp).toBe(30);     // 未走 takeDamage/die()
        expect(player.char).toBe('@');  // 未走 die()
    });

    it('玩家在熔岩中：同样走 triggerGameOver，hp 与外观不被 die() 触碰。', () => {
        const game = createHeadlessGame(34);
        clearToOpenRoom(game);
        setTile(game, 4, 5, TerrainType.LAVA);

        const player = game.player;
        player.hp = 30;

        priv(game).applyEnvironmentalEffects();

        expect(game.isGameOver).toBe(true);
        expect(player.hp).toBe(30);
        expect(player.char).toBe('@');
    });
});
