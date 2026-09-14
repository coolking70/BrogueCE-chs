/**
 * src/test/p4_5_melee_specials.test.ts — P4-5：抓取（MA_SEIZES）/ 吸血
 * （MA_TRANSFERENCE）/ 击退（MA_ATTACKS_STAGGER）
 *
 * 对照 CE 源码（见 ai_docs/p4_5_melee_specials_report.md）：
 *   - MA_SEIZES              Combat.c:1212-1237（attack() 内，早于 attackHit 命中掷骰）
 *   - 玩家挣脱/移动阻塞        Movement.c:1267-1297
 *   - MB_SEIZED/MB_SEIZING    grep 全部引用点核对
 *   - MA_TRANSFERENCE         Combat.c:1849-1871（inflictDamage() 内）
 *   - MA_ATTACKS_STAGGER      processStaggerHit，Combat.c:1118-1136；
 *                             调用点 specialHit()，Combat.c:534（仅在
 *                             "命中且未被杀死"的 else-survive 分支执行）
 *
 * 对抗性测试与"能捕获的具体错误实现"逐条标注在每个 it() 前的注释里；
 * 反向验证（真实改坏代码、跑出失败、贴输出、再还原）见报告。
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import { TerrainType } from '../engine/Map/Grid';
import { CombatSystem } from '../engine/Combat/Combat';
import { timeSystem } from '../engine/Systems/Time';
import monsterDataJson from '../data/monsters.json';
import mutationDataJson from '../data/mutations.json';
import type { MutationData } from '../entities/Monster';

const MONSTER_DATA = monsterDataJson as MonsterData[];
const MUTATION_DATA = mutationDataJson as MutationData[];

function monsterDataById(id: string): MonsterData {
    const row = MONSTER_DATA.find(m => m.id === id);
    if (!row) throw new Error(`monsters.json 中找不到 ${id}`);
    return row;
}

function mutationById(id: string): MutationData {
    const row = MUTATION_DATA.find(m => m.id === id);
    if (!row) throw new Error(`mutations.json 中找不到 ${id}`);
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
    // 开局自带皮甲会产生非零防御值，让"高 accuracy 怪物必中"的测试前提失真
    // （hitProbability 会因 defenderDefense>0 跌破 100）。本轮测试统一按无甲
    // 玩家设计命中率，脱下装备以保证确定性。
    game.player.equippedArmor = null;
}

// 私有方法访问（与 p4_4 同一思路）：processStaggerHit/findLiveSeizer 刻意保持
// private，测试用 as any 拿到引用，不代表这是公开 API。
function priv(game: Game): any {
    return game as any;
}

// ---------------------------------------------------------------------------
// 验收 1：MA_SEIZES — 抓取
// ---------------------------------------------------------------------------
describe('P4-5 验收 1：MA_SEIZES 抓取', () => {
    it('对抗性①：抓取那一下必须是 0 伤害、hit=false —— 错误实现（漏掉 return false，' +
        '继续走正常攻击流程）会让这一下打出真实伤害，玩家 HP 会下降。', () => {
        const game = createHeadlessGame(10);
        clearToOpenRoom(game);
        const bog = new Monster(6, 5, monsterDataById('bog_monster'));
        game.monsters.push(bog);
        const player = game.player;
        player.loc.x = 5; player.loc.y = 5;
        player.hp = player.maxHp = 50;

        const hpBefore = player.hp;
        const res = CombatSystem.attack(bog, player);

        expect(res.seized).toBe(true);
        expect(res.hit).toBe(false);
        expect(res.damage).toBe(0);
        expect(player.hp).toBe(hpBefore); // 关键断言：没有掉血
        expect(bog.seizing).toBe(true);
        expect(player.seized).toBe(true);
    });

    it('kraken（另一只原生 MA_SEIZES 怪物）同样在第一下抓住而不是造成伤害', () => {
        const game = createHeadlessGame(11);
        clearToOpenRoom(game);
        const kraken = new Monster(6, 5, monsterDataById('kraken'));
        game.monsters.push(kraken);
        const player = game.player;
        player.loc.x = 5; player.loc.y = 5;
        player.hp = player.maxHp = 200;
        const hpBefore = player.hp;

        const res = CombatSystem.attack(kraken, player);
        expect(res.seized).toBe(true);
        expect(player.hp).toBe(hpBefore);
    });

    it('变异途径：goblin 携带 grappling 变异（注入 MA_SEIZES）同样触发抓取，' +
        '验证 abilityFlags 走 hasAbility 而非写死怪物种类白名单', () => {
        const game = createHeadlessGame(12);
        clearToOpenRoom(game);
        const goblin = new Monster(6, 5, monsterDataById('goblin'));
        goblin.mutate(mutationById('grappling'));
        game.monsters.push(goblin);
        const player = game.player;
        player.loc.x = 5; player.loc.y = 5;
        player.hp = player.maxHp = 50;
        const hpBefore = player.hp;

        const res = CombatSystem.attack(goblin, player);
        expect(res.seized).toBe(true);
        expect(player.hp).toBe(hpBefore);
        expect(goblin.seizing).toBe(true);
        expect(player.seized).toBe(true);
    });

    it('两个标记都置位后，第二次 attack() 不再抓取，而是走正常命中判定/伤害流程', () => {
        const game = createHeadlessGame(13);
        clearToOpenRoom(game);
        const bog = new Monster(6, 5, monsterDataById('bog_monster'));
        bog.accuracy = 125; // 命中率 100%（defense=0 玩家），让"命中与否"不成为本用例变量
        game.monsters.push(bog);
        const player = game.player;
        player.loc.x = 5; player.loc.y = 5;
        player.hp = player.maxHp = 200;

        CombatSystem.attack(bog, player); // 第一下：抓取
        expect(player.seized).toBe(true);
        expect(bog.seizing).toBe(true);

        const hpBefore = player.hp;
        const res2 = CombatSystem.attack(bog, player); // 第二下：应为正常攻击
        expect(res2.seized).toBeUndefined();
        expect(res2.hit).toBe(true); // accuracy=125 vs defense=0 必中；写成 if(res2.hit) 会放过恒 miss 的错误实现
        expect(player.hp).toBeLessThan(hpBefore);
    });

    it('对抗性⑥：抓取不参与命中掷骰（CE return false 早于 attackHit）—— accuracy=0 的 ' +
        'bog_monster 在正常公式下命中率恒为 0%，第一次贴身仍必须抓住；' +
        '错误实现（把抓取放在命中掷骰之后）永远抓不住。', () => {
        const game = createHeadlessGame(17);
        clearToOpenRoom(game);
        const bog = new Monster(6, 5, monsterDataById('bog_monster'));
        bog.accuracy = 0; // hitProbability(0, 0) = 0 → 正常攻击恒 miss
        game.monsters.push(bog);
        const player = game.player;
        player.loc.x = 5; player.loc.y = 5;
        player.hp = player.maxHp = 50;

        const res = CombatSystem.attack(bog, player);
        expect(res.seized).toBe(true); // 关键断言：0% 命中率下依然抓住
        expect(player.seized).toBe(true);
    });

    it('对抗性⑦：被抓者面对抓着自己的攻击者必中（CE Combat.c:125-130：defender SEIZED && ' +
        'attacker SEIZING → hitProbability 直接返回 100）—— accuracy=0 的抓取者抓住后' +
        '第二击必须命中并造成伤害；漏掉这条规则的错误实现会继续按 0% 公式恒 miss。', () => {
        const game = createHeadlessGame(18);
        clearToOpenRoom(game);
        const bog = new Monster(6, 5, monsterDataById('bog_monster'));
        bog.accuracy = 0; // 正常公式恒 miss
        game.monsters.push(bog);
        const player = game.player;
        player.loc.x = 5; player.loc.y = 5;
        player.hp = player.maxHp = 200;

        CombatSystem.attack(bog, player); // 第一下：抓住
        expect(player.seized).toBe(true);

        const hpBefore = player.hp;
        const res2 = CombatSystem.attack(bog, player); // 第二下：必中
        expect(res2.hit).toBe(true); // 关键断言：0% 公式下依然命中（必中规则生效）
        expect(player.hp).toBeLessThan(hpBefore);
    });

    it('对照组：goblin（不带 MA_SEIZES）攻击玩家不会触发抓取，玩家不会被标记为 seized', () => {
        const game = createHeadlessGame(14);
        clearToOpenRoom(game);
        const goblin = new Monster(6, 5, monsterDataById('goblin'));
        game.monsters.push(goblin);
        const player = game.player;
        player.loc.x = 5; player.loc.y = 5;
        player.hp = player.maxHp = 50;

        const res = CombatSystem.attack(goblin, player);
        expect(res.seized).toBeUndefined();
        expect(player.seized).toBe(false);
        expect(goblin.seizing).toBe(false);
    });

    it('对抗性②：被抓住后尝试移动到空地必须被阻挡（不消耗位移）—— 错误实现（移动' +
        '处理完全不检查 player.seized）会让玩家自由移开。挣扎要消耗回合' +
        '（CE "you struggle"分支走 playerTurnEnded）；不耗回合的错误实现会被 tick 断言抓住。', () => {
        const game = createHeadlessGame(15);
        clearToOpenRoom(game);
        const bog = new Monster(6, 5, monsterDataById('bog_monster'));
        // 冻结怪物自己的回合，避免 advancementLoop 顺带跑一次它的 AI 干扰断言。
        bog.ticksUntilTurn = 1_000_000_000;
        game.monsters.push(bog);
        const player = game.player;
        player.loc.x = 5; player.loc.y = 5;
        player.hp = player.maxHp = 200;

        CombatSystem.attack(bog, player); // 抓住玩家
        expect(player.seized).toBe(true);

        // (4,5) 是空地（clearToOpenRoom 铺的开阔房间），正常情况下应该能走过去。
        const tickBefore = timeSystem.currentTick;
        const hpBefore = player.hp;
        game.handlePlayerAction('move', { x: -1, y: 0 });

        expect(player.loc.x).toBe(5); // 关键断言：没有移动
        expect(player.loc.y).toBe(5);
        expect(player.seized).toBe(true); // 仍然被抓着（挣扎本身不会挣脱）
        expect(player.hp).toBe(hpBefore); // 挣扎不是挨打：这一回合不受伤
        expect(timeSystem.currentTick).toBeGreaterThan(tickBefore); // 关键断言：挣扎消耗了回合
    });

    it('撞向抓着自己的怪物仍然是正常攻击（CE playerMoves 的攻击分支先于 MB_SEIZED ' +
        '检查，Movement.c:1267 的挣扎只拦"移动进空地"）—— 错误实现（把 seized 检查' +
        '放在攻击判断之前）会让玩家永远无法反击抓取者。', () => {
        const game = createHeadlessGame(19);
        clearToOpenRoom(game);
        const bog = new Monster(6, 5, monsterDataById('bog_monster'));
        bog.defense = 0; // 玩家徒手 100% 命中，命中与否不成为本用例变量
        bog.ticksUntilTurn = 1_000_000_000; // 冻结 bog 的回合
        game.monsters.push(bog);
        const player = game.player;
        player.loc.x = 5; player.loc.y = 5;
        player.hp = player.maxHp = 200;

        CombatSystem.attack(bog, player); // 抓住玩家
        expect(player.seized).toBe(true);

        const bogHpBefore = bog.hp;
        game.handlePlayerAction('move', { x: 1, y: 0 }); // 朝 bog 所在格 (6,5) 移动 = 攻击

        expect(bog.hp).toBeLessThan(bogHpBefore); // 关键断言：发生了攻击（掉血），不是挣扎
        expect(player.loc.x).toBe(5); // 攻击不位移
        expect(player.seized).toBe(true); // 没杀死就不解除抓取（CE 无"攻击抓取者即松手"规则）
    });

    it('failsafe 解除还要检查相邻：抓取者仍然活着但已不在玩家旁边时，玩家移动不再被阻拦 ' +
        '（CE Movement.c:1267-1296 的搜索条件含 distanceBetween==1；只检查抓取者是否' +
        '存活的错误实现会继续拦人）。', () => {
        const game = createHeadlessGame(110);
        clearToOpenRoom(game);
        const bog = new Monster(6, 5, monsterDataById('bog_monster'));
        bog.ticksUntilTurn = 1_000_000_000;
        game.monsters.push(bog);
        const player = game.player;
        player.loc.x = 5; player.loc.y = 5;
        player.hp = player.maxHp = 200;

        CombatSystem.attack(bog, player); // 抓住玩家
        expect(player.seized).toBe(true);

        // 抓取者活着，但被挪到远处（模拟 CE 中抓取者脱离相邻的所有情形）。
        bog.loc.x = 14; bog.loc.y = 10;

        game.handlePlayerAction('move', { x: -1, y: 0 });
        expect(player.loc.x).toBe(4); // 关键断言：能正常移动
        expect(player.seized).toBe(false); // failsafe 清掉了陈旧标记
    });

    it('必做：抓取者死亡后被抓者能正常移动（杀死 bog_monster 后玩家立刻能走开）', () => {
        const game = createHeadlessGame(16);
        clearToOpenRoom(game);
        const bog = new Monster(6, 5, monsterDataById('bog_monster'));
        bog.ticksUntilTurn = 1_000_000_000;
        game.monsters.push(bog);
        const player = game.player;
        player.loc.x = 5; player.loc.y = 5;
        player.hp = player.maxHp = 200;

        CombatSystem.attack(bog, player); // 抓住玩家
        expect(player.seized).toBe(true);

        // 先确认真的被挡住一次。
        game.handlePlayerAction('move', { x: -1, y: 0 });
        expect(player.loc.x).toBe(5);

        // 杀死抓取者：直接攻击它所在格 (6,5)（player 在 (5,5)，dx=1 撞上 bog）。
        bog.hp = 1;
        bog.defense = 0; // 保证玩家这一下命中
        game.handlePlayerAction('move', { x: 1, y: 0 }); // 攻击，不是移动
        expect(bog.hp).toBeLessThanOrEqual(0);
        expect(game.monsters.includes(bog)).toBe(false); // playerTurnEnded 已过滤死怪

        // 现在再次尝试移开：应当成功，且 seized 标记应被清除。
        game.handlePlayerAction('move', { x: -1, y: 0 });
        expect(player.loc.x).toBe(4);
        expect(player.seized).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// 验收 2：MA_TRANSFERENCE — 吸血
// ---------------------------------------------------------------------------
describe('P4-5 验收 2：MA_TRANSFERENCE 吸血', () => {
    it('敌方 90%：vampire bat 攻击玩家命中后，攻击者回血 = floor(min(damage,防御方HP)*9/10)', () => {
        const game = createHeadlessGame(20);
        clearToOpenRoom(game);
        const bat = new Monster(6, 5, monsterDataById('vampire_bat'));
        bat.hp = 1; // 留出充足的回血空间用于观察
        game.monsters.push(bat);
        const player = game.player;
        player.loc.x = 5; player.loc.y = 5;
        player.hp = player.maxHp = 200; // 足够厚，不会被打死，伤害可以完整观察

        const hpBefore = player.hp;
        const batHpBefore = bat.hp;
        const res = CombatSystem.attack(bat, player);
        expect(res.hit).toBe(true); // accuracy=100 对 defense=0 玩家，稳定命中
        const damageDealt = hpBefore - player.hp;
        expect(damageDealt).toBeGreaterThan(0);
        expect(bat.hp - batHpBefore).toBe(Math.trunc(damageDealt * 9 / 10));
    });

    it('盟友 40%：isAlly=true 的 vampire bat 攻击敌方怪物，回血比例必须是 4/10 而不是 9/10', () => {
        const game = createHeadlessGame(21);
        clearToOpenRoom(game);
        const bat = new Monster(6, 5, monsterDataById('vampire_bat'));
        bat.isAlly = true;
        bat.hp = 1;
        const target = new Monster(5, 5, monsterDataById('goblin'));
        target.defense = 0; // 保证命中
        target.hp = target.maxHp = 200;
        game.monsters.push(bat, target);

        const targetHpBefore = target.hp;
        const batHpBefore = bat.hp;
        const res = CombatSystem.attack(bat, target);
        expect(res.hit).toBe(true);
        const damageDealt = targetHpBefore - target.hp;
        expect(damageDealt).toBeGreaterThan(0);
        expect(bat.hp - batHpBefore).toBe(Math.trunc(damageDealt * 4 / 10));
    });

    it('变异途径：goblin 携带 vampiric 变异攻击玩家，同样按敌方 90% 回血', () => {
        const game = createHeadlessGame(22);
        clearToOpenRoom(game);
        const goblin = new Monster(6, 5, monsterDataById('goblin'));
        goblin.mutate(mutationById('vampiric'));
        goblin.hp = 1;
        game.monsters.push(goblin);
        const player = game.player;
        player.loc.x = 5; player.loc.y = 5;
        player.hp = player.maxHp = 200;
        // goblin 变异后 accuracy 不变（mutate 不改 accuracy），原始 accuracy=70，
        // defense=0 玩家：defenseFraction(0)=1，hitProb=70%，用高命中怪测更省事，
        // 这里改用固定 accuracy 保证命中，不依赖 RNG 种子巧合。
        goblin.accuracy = 100;

        const hpBefore = player.hp;
        const goblinHpBefore = goblin.hp;
        const res = CombatSystem.attack(goblin, player);
        expect(res.hit).toBe(true);
        const damageDealt = hpBefore - player.hp;
        expect(damageDealt).toBeGreaterThan(0);
        expect(goblin.hp - goblinHpBefore).toBe(Math.trunc(damageDealt * 9 / 10));
    });

    it('对抗性①：吸血量不能超过目标剩余血量 —— 漏掉 min(damage, currentHP) 的错误实现会' +
        '按完整伤害骰值回血（目标只剩 1 HP 时，vampire bat 最小伤害是 2，' +
        '正确实现 floor(min(2..6,1)*9/10)=floor(0.9)=0，没有 min() 的实现永远 >0）。', () => {
        const game = createHeadlessGame(23);
        clearToOpenRoom(game);
        const bat = new Monster(6, 5, monsterDataById('vampire_bat'));
        bat.hp = 5;
        const player = game.player;
        player.loc.x = 5; player.loc.y = 5;
        player.hp = player.maxHp = 1; // 关键：目标只剩 1 点血
        game.monsters.push(bat);

        const batHpBefore = bat.hp;
        const res = CombatSystem.attack(bat, player);
        expect(res.hit).toBe(true);
        // 伤害骰 1d5+1 最小值是 2，clamp 到剩余 1 HP 后 floor(1*0.9)=0。
        expect(bat.hp).toBe(batHpBefore); // 关键断言：没有多余回血
    });

    it('对抗性②：吸血没有 maxHP 上限 —— 复核确认 CE inflictDamage（Combat.c:1871）' +
        '在 attacker->currentHP += transferenceAmount 之后紧接着只有玩家血量归零判断，' +
        '没有任何 clamp 到 maxHP 的代码；错误的"好心" clamp 实现会把这里摁回 maxHp。', () => {
        const game = createHeadlessGame(24);
        clearToOpenRoom(game);
        const bat = new Monster(6, 5, monsterDataById('vampire_bat'));
        bat.hp = bat.maxHp; // 攻击前已满血
        const player = game.player;
        player.loc.x = 5; player.loc.y = 5;
        player.hp = player.maxHp = 200;
        game.monsters.push(bat);

        const res = CombatSystem.attack(bat, player);
        expect(res.hit).toBe(true);
        expect(bat.hp).toBeGreaterThan(bat.maxHp); // 关键断言：血量冲破上限
    });

    it('对照组：非吸血怪（ogre）攻击玩家命中后自身 HP 不变', () => {
        const game = createHeadlessGame(25);
        clearToOpenRoom(game);
        const ogre = new Monster(6, 5, monsterDataById('ogre'));
        const player = game.player;
        player.loc.x = 5; player.loc.y = 5;
        player.hp = player.maxHp = 200;
        game.monsters.push(ogre);

        const ogreHpBefore = ogre.hp;
        const res = CombatSystem.attack(ogre, player);
        expect(res.hit).toBe(true); // ogre accuracy=125 对 0 防御玩家稳定命中
        expect(res.damage).toBeGreaterThan(0);
        expect(ogre.hp).toBe(ogreHpBefore); // 没有 MA_TRANSFERENCE，不回血
    });

    it('MONST_INANIMATE 目标不触发吸血（Combat.c:1849-1851 的排除条件）', () => {
        const game = createHeadlessGame(26);
        clearToOpenRoom(game);
        const bat = new Monster(6, 5, monsterDataById('vampire_bat'));
        bat.hp = 1;
        const target = new Monster(5, 5, monsterDataById('goblin'));
        target.behaviorFlags.add('MONST_INANIMATE');
        target.defense = 0;
        target.hp = target.maxHp = 200;
        game.monsters.push(bat, target);

        const batHpBefore = bat.hp;
        const res = CombatSystem.attack(bat, target);
        expect(res.hit).toBe(true);
        expect(res.damage).toBeGreaterThan(0);
        expect(bat.hp).toBe(batHpBefore);
    });
});

// ---------------------------------------------------------------------------
// 验收 3：MA_ATTACKS_STAGGER — 击退
// ---------------------------------------------------------------------------
describe('P4-5 验收 3：MA_ATTACKS_STAGGER 击退', () => {
    it('ogre 命中玩家后，把玩家沿"攻击者→玩家"方向推开一格', () => {
        const game = createHeadlessGame(30);
        clearToOpenRoom(game);
        const ogre = new Monster(6, 5, monsterDataById('ogre'));
        ogre.state = MonsterState.HUNTING;
        const player = game.player;
        player.loc.x = 5; player.loc.y = 5; // ogre 在玩家右侧，推力方向 -x
        player.hp = player.maxHp = 200;
        game.monsters.push(ogre);

        ogre.takeTurn(game, 10);

        expect(player.loc.x).toBe(4); // 5 + clamp(5-6,-1,1) = 5-1 = 4
        expect(player.loc.y).toBe(5);
    });

    it('变异途径：goblin 携带 juggernaut 变异同样能推动目标', () => {
        const game = createHeadlessGame(31);
        clearToOpenRoom(game);
        const goblin = new Monster(6, 5, monsterDataById('goblin'));
        goblin.mutate(mutationById('juggernaut'));
        goblin.accuracy = 100;
        goblin.state = MonsterState.HUNTING;
        const player = game.player;
        player.loc.x = 5; player.loc.y = 5;
        player.hp = player.maxHp = 200;
        game.monsters.push(goblin);

        goblin.takeTurn(game, 10);

        expect(player.loc.x).toBe(4);
    });

    it('对抗性①：击退不能有 damage>0 的门槛 —— 照邻居 MA_POISONS/MA_CAUSES_WEAKNESS' +
        '抄错的实现（在 Monster.ts 调用点加一个 `&& result.damage > 0`）会在 0 伤害' +
        '命中时跳过推挤；这里用 MONST_IMMUNE_TO_WEAPONS 目标强制近战伤害为 0（但 hit' +
        '仍为 true），走真实的 ally-vs-monster 集成路径（Monster.takeTurn 调用点，' +
        '不是直接调用 processStaggerHit），验证调用点本身没有加这个门槛。', () => {
        const game = createHeadlessGame(32);
        clearToOpenRoom(game);
        game.player.loc.x = 12; game.player.loc.y = 10; // 挪开，避免占用推挤终点 (4,5)
        const ogre = new Monster(6, 5, monsterDataById('ogre'));
        ogre.isAlly = true; // 走 ally-vs-monster 集成路径的真实调用点
        const target = new Monster(5, 5, monsterDataById('goblin'));
        target.defense = 0; // 保证命中
        target.behaviorFlags.add('MONST_IMMUNE_TO_WEAPONS');
        target.hp = target.maxHp = 200;
        game.monsters.push(ogre, target);

        ogre.takeTurn(game, 10);

        expect(target.loc.x).toBe(4); // 依然被推开——证明调用点没有 damage>0 门槛
    });

    it('对抗性②：终点是墙/已被占用时不应该发生推挤（目标原地不动）', () => {
        const game = createHeadlessGame(33);
        clearToOpenRoom(game);
        const ogre = new Monster(6, 5, monsterDataById('ogre'));
        const player = game.player;
        player.loc.x = 5; player.loc.y = 5;
        game.monsters.push(ogre);
        // 推挤终点 (4,5) 改成墙。
        game.grid.setTerrain(4, 5, TerrainType.WALL, '#', 0x444444);

        priv(game).processStaggerHit(ogre, player);
        expect(player.loc.x).toBe(5); // 撞墙推不动

        // 恢复终点为地板，但塞一个怪物占位。
        game.grid.setTerrain(4, 5, TerrainType.FLOOR, '.', 0x888888);
        const blocker = new Monster(4, 5, monsterDataById('goblin'));
        game.monsters.push(blocker);

        priv(game).processStaggerHit(ogre, player);
        expect(player.loc.x).toBe(5); // 终点被占用，同样推不动
    });

    it('对抗性③：目标被打死的那一下不触发击退（CE specialHit 只在 Combat.c:1385 起的' +
        'else-survive 分支调用，inflictDamage 杀死目标时走的是 if-killed 分支，走不到' +
        'specialHit）—— 调用点忘记检查 target.hp>0 的错误实现，会把已经死亡的目标' +
        '"死后诈尸挪一格"，用 ally 分支的真实集成路径（Monster.takeTurn）验证。', () => {
        const game = createHeadlessGame(34);
        clearToOpenRoom(game);
        const ogre = new Monster(6, 5, monsterDataById('ogre'));
        ogre.isAlly = true; // 走 ally-vs-monster 集成路径（真实调用点，非直接调用私有方法）
        const target = new Monster(5, 5, monsterDataById('goblin'));
        target.defense = 0;
        target.hp = 1; // ogre 伤害 1d5+8，最小 9，必杀
        game.monsters.push(ogre, target);

        ogre.takeTurn(game, 10);

        expect(target.hp).toBeLessThanOrEqual(0);
        expect(target.loc.x).toBe(5); // 关键断言：已死目标没有被"击退"挪位
        expect(target.loc.y).toBe(5);
    });

    it('对照组：goblin（不带 MA_ATTACKS_STAGGER）命中玩家不会推动玩家', () => {
        const game = createHeadlessGame(35);
        clearToOpenRoom(game);
        const goblin = new Monster(6, 5, monsterDataById('goblin'));
        goblin.accuracy = 100;
        goblin.state = MonsterState.HUNTING;
        const player = game.player;
        player.loc.x = 5; player.loc.y = 5;
        player.hp = player.maxHp = 200;
        game.monsters.push(goblin);

        goblin.takeTurn(game, 10);

        expect(player.loc.x).toBe(5); // 没有被推
        expect(player.loc.y).toBe(5);
    });
});
