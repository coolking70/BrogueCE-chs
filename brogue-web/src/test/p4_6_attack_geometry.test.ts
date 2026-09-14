/**
 * src/test/p4_6_attack_geometry.test.ts — P4-6：三种攻击几何（怪物侧）
 *   矛（MA_ATTACKS_PENETRATE，直线穿透 2 格）／斧（MA_ATTACKS_ALL_ADJACENT，
 *   横扫全部相邻敌人）／鞭（MA_ATTACKS_EXTEND，直线远距离单体、射程 5）
 *
 * 对照 CE 源码（见 ai_docs/p4_6_attack_geometry_report.md）：
 *   - handleSpearAttacks   Movement.c:917-1023（门控 MA_ATTACKS_PENETRATE，
 *                          :934；倒序攻击 :1005-1009；穿墙 break :976-979）
 *   - buildHitList(sweep)  Combat.c:2049-2090（sweep 分支 :2068-2086）
 *   - 怪物侧入口           Monsters.c:3877-3889（sweep 参数 :3879、攻击循环复查 :3881-3888）
 *   - handleWhipAttacks    Movement.c:855-912（门控 MA_ATTACKS_EXTEND :873；
 *                          getImpactLoc 射程 5，Items.c:4300-4332）
 *   - 远程几何触发路径     Monsters.c:3817-3822（moveMonster 内，追击移动途中先出手）
 *
 * ★ Rogue.h:2120-2122 的前两条注释写反（PENETRATE 标着 "like an axe"、
 *   ALL_ADJACENT 标着 "like a spear"），本文件的所有断言以代码行为为准：
 *   矛=PENETRATE=直线穿透、斧=ALL_ADJACENT=横扫相邻。头号对抗性测试
 *   （矛和斧做反）各有专门一条，把照错误注释实现的情况双向锁死。
 *
 * 对抗性测试与"能捕获的具体错误实现"逐条标注在每个 it() 前的注释里；
 * 反向验证（真实改坏代码、跑出失败、贴输出、再还原）见报告 §5。
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import { TerrainType } from '../engine/Map/Grid';
import { logger } from '../engine/Systems/Logger';
import monsterDataJson from '../data/monsters.json';
import weaponsDataJson from '../data/weapons.json';

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
    // 同 p4_5：脱甲保证防御为 0，让高 accuracy 怪物必中，不引入命中率变量
    game.player.equippedArmor = null;
}

/** 放置一只 HUNTING 状态的怪物（patch 可覆写 accuracy/damage 等保证确定性）。 */
function spawn(game: Game, id: string, x: number, y: number, patch: Partial<MonsterData> = {}): Monster {
    const m = new Monster(x, y, { ...monsterDataById(id), ...patch });
    m.state = MonsterState.HUNTING;
    game.monsters.push(m);
    return m;
}

/** 放置一只玩家阵营的盟友怪（对几何怪物而言是"可被误伤面"的探测探针）。 */
function allyOf(game: Game, id: string, x: number, y: number, patch: Partial<MonsterData> = {}): Monster {
    const m = spawn(game, id, x, y, patch);
    m.isAlly = true;
    return m;
}

// ---------------------------------------------------------------------------
// 矛：MA_ATTACKS_PENETRATE —— 直线穿透至多 2 格，先打远的后打近的
// ---------------------------------------------------------------------------
describe('P4-6 矛（MA_ATTACKS_PENETRATE）', () => {
    it('对抗性【头号风险·矛≠斧】：照 Rogue.h:2120 反了的注释实现成横扫会翻车 —— ' +
        'goblin 贴脸玩家、玩家身后直线上有盟友、斜角上另有盟友：正确的矛打' +
        '玩家+身后线上目标、绝不碰斜角；做反成斧的实现必然扫到斜角探针。', () => {
        const game = createHeadlessGame(601);
        clearToOpenRoom(game);
        // damage '1d1+4' → parseDamageString = 5~5，命中伤害确定性 5；
        // accuracy 200 对 0 防御目标必中（命中率不成为变量）
        const goblin = spawn(game, 'goblin', 4, 5, { accuracy: 200, damage: '1d1+4' });
        game.player.loc.x = 5; game.player.loc.y = 5;
        game.player.hp = 200;
        const behind = allyOf(game, 'rat', 6, 5);   // 矛线上第 2 格：必须被打
        const diagonal = allyOf(game, 'rat', 4, 4); // 斜角：只有斧才打得到
        const pBefore = game.player.hp;
        const bBefore = behind.hp;
        const dBefore = diagonal.hp;

        goblin.takeTurn(game, 10);

        expect(game.player.hp).toBe(pBefore - 5);
        expect(behind.hp).toBe(bBefore - 5);    // 身后线上目标被顺带穿透
        expect(diagonal.hp).toBe(dBefore);      // 关键断言：斜角探针一滴不掉
    });

    it('对抗性【射程只有相邻】：CE 的矛是"直线穿透至多 2 格"（handleSpearAttacks ' +
        'range=2，Movement.c:923）——goblin 在 2 格直线外就应该隔空刺到玩家且' +
        '原地不出手；只会相邻近战的实现会让 goblin 走进中间格、玩家不掉血。', () => {
        const game = createHeadlessGame(602);
        clearToOpenRoom(game);
        const goblin = spawn(game, 'goblin', 4, 5, { accuracy: 200, damage: '1d1+4' });
        game.player.loc.x = 6; game.player.loc.y = 5;
        game.player.hp = 200;

        goblin.takeTurn(game, 10);

        expect(game.player.hp).toBe(195);   // 精确断言：被隔空刺中恰好 5 点
        expect(goblin.loc.x).toBe(4);       // 出手耗回合，没有走进中间格
        expect(goblin.loc.y).toBe(5);
    });

    it('对抗性【攻击顺序写成正序】：CE Movement.c:1005-1009 人为倒序攻击' +
        '（"so that spears of force can send both monsters flying"，先远后近）' +
        '—— 2 格外的远处目标必须先于贴脸玩家挨打；正序实现的日志顺序相反。' +
        '同时断言矛循环两个目标都挨打（CE 的矛攻击循环没有 dying 复查，' +
        '远处目标死后贴脸的照样挨打）。', () => {
        const game = createHeadlessGame(603);
        clearToOpenRoom(game);
        const goblin = spawn(game, 'goblin', 4, 5, { accuracy: 200, damage: '1d1+4' });
        game.player.loc.x = 5; game.player.loc.y = 5;
        game.player.hp = 200;
        const far = allyOf(game, 'rat', 6, 5, { hp: 1 }); // 远处目标 1 HP，第一下即死
        const baseline = logger.messages.length;

        goblin.takeTurn(game, 10);

        expect(far.hp).toBeLessThanOrEqual(0);      // 远处目标被打死
        expect(game.player.hp).toBe(195);            // 近处玩家照样挨打（5 点）
        const msgs = logger.messages.slice(baseline);
        // 用消息格式而非怪物名匹配（translateName 可能改变大小写）：
        // 打怪物的消息是 "hits the <name>"，打玩家的是 "hits you"
        const farIdx = msgs.findIndex(m => m.text.includes('hits the'));
        const youIdx = msgs.findIndex(m => m.text.includes('hits you'));
        expect(farIdx).toBeGreaterThanOrEqual(0);
        expect(youIdx).toBeGreaterThan(farIdx);      // 关键断言：远端消息在前
    });

    it('对抗性【矛穿过了墙】：CE Movement.c:976-979 遇到阻挡通行/视线的格子' +
        '立即 break —— goblin 与玩家之间隔一格墙时绝不能隔着墙刺到玩家；' +
        '漏掉 break 的实现会把 2 格外的玩家隔墙刺穿。', () => {
        const game = createHeadlessGame(604);
        clearToOpenRoom(game);
        const goblin = spawn(game, 'goblin', 4, 5, { accuracy: 200, damage: '1d1+4' });
        game.grid.setTerrain(5, 5, TerrainType.WALL, '#', 0x444444);
        game.player.loc.x = 6; game.player.loc.y = 5;
        game.player.hp = 200;

        goblin.takeTurn(game, 10);

        expect(game.player.hp).toBe(200);    // 关键断言：隔墙不出手（绕路不影响玩家）
    });
});

// ---------------------------------------------------------------------------
// 斧：MA_ATTACKS_ALL_ADJACENT —— 横扫全部相邻敌人
// ---------------------------------------------------------------------------
describe('P4-6 斧（MA_ATTACKS_ALL_ADJACENT）', () => {
    it('对抗性【头号风险·斧≠矛】：照 Rogue.h:2121 反了的注释实现成直线穿透会翻车 ' +
        '—— naga 贴脸玩家、斜角上有盟友、直线上 2 格外另有盟友：正确的斧扫到' +
        '玩家+斜角、绝不碰 2 格外的目标；做反成矛的实现打不到斜角、反而会打到 ' +
        '2 格外的探针。两个探针双向锁死。', () => {
        const game = createHeadlessGame(605);
        clearToOpenRoom(game);
        const naga = spawn(game, 'naga', 4, 5);   // acc 150 → 对 0 防御必中
        game.player.loc.x = 5; game.player.loc.y = 5;
        game.player.hp = 500;
        const diagonal = allyOf(game, 'rat', 4, 4); // 斜角：斧必须扫到
        const farLine = allyOf(game, 'rat', 6, 5);  // 直线 2 格：斧打不到
        const dBefore = diagonal.hp;
        const fBefore = farLine.hp;

        naga.takeTurn(game, 10);

        expect(game.player.hp).toBeLessThan(500);
        expect(diagonal.hp).toBeLessThan(dBefore);  // 关键断言①：斜角被扫到
        expect(farLine.hp).toBe(fBefore);           // 关键断言②：2 格外的没挨打
    });

    it('横扫要扫满 8 个邻格里的多个敌人（CE buildHitList sweep 分支 i 走满 ' +
        '0..7，Combat.c:2072-2086）—— naga 被玩家 + 4 个盟友团团围住时 5 个 ' +
        '全部挨打；只打主目标或漏掉斜角的实现在这里翻车。', () => {
        const game = createHeadlessGame(606);
        clearToOpenRoom(game);
        const naga = spawn(game, 'naga', 4, 5);
        game.player.loc.x = 5; game.player.loc.y = 5;
        game.player.hp = 500;
        const allies = [
            allyOf(game, 'rat', 3, 5),
            allyOf(game, 'rat', 4, 4),
            allyOf(game, 'rat', 3, 4),
            allyOf(game, 'rat', 4, 6),
        ];
        const before = allies.map(a => a.hp);

        naga.takeTurn(game, 10);

        expect(game.player.hp).toBeLessThan(500);
        allies.forEach((a, i) => expect(a.hp, `盟友#${i} 必须被扫到`).toBeLessThan(before[i]!));
    });

    it('对抗性【横扫误伤同阵营】：CE buildHitList sweep 分支的 monsterWillAttackTarget ' +
        '复查（Combat.c:2079）+ 攻击循环复查（Monsters.c:3883）—— naga 旁边站着 ' +
        '同阵营同类时绝不扫它；漏掉 willAttackTarget 的实现会把同类一起砍了。', () => {
        const game = createHeadlessGame(607);
        clearToOpenRoom(game);
        const nagaA = spawn(game, 'naga', 4, 5);
        const friend = spawn(game, 'naga', 3, 5);   // 同阵营（都敌对玩家），非盟友
        game.player.loc.x = 5; game.player.loc.y = 5;
        game.player.hp = 500;
        const fBefore = friend.hp;

        nagaA.takeTurn(game, 10);

        expect(game.player.hp).toBeLessThan(500);   // 玩家被扫到
        expect(friend.hp).toBe(fBefore);            // 关键断言：同类毫发无损
    });
});

// ---------------------------------------------------------------------------
// 鞭：MA_ATTACKS_EXTEND —— 直线远距离单体，射程 5，打沿途第一个受阻点
// ---------------------------------------------------------------------------
describe('P4-6 鞭（MA_ATTACKS_EXTEND）', () => {
    it('射程边界：距玩家 5 格甩得到（getImpactLoc maxDistance=5，Items.c:4307），' +
        '距 6 格甩不到只走近 —— 把射程写成无限的实现在 6 格翻车。', () => {
        // 距离 5：甩到且不移动
        const game1 = createHeadlessGame(608);
        clearToOpenRoom(game1);
        const sala1 = spawn(game1, 'salamander', 4, 5);   // acc 150、dmg 1d7+4（5~11）
        game1.player.loc.x = 9; game1.player.loc.y = 5;
        game1.player.hp = 500;

        sala1.takeTurn(game1, 10);

        expect(game1.player.hp).toBeLessThan(500);
        expect(sala1.loc.x).toBe(4);    // 出手耗回合，原地不动
        expect(sala1.loc.y).toBe(5);

        // 距离 6：甩不到，走近一格
        const game2 = createHeadlessGame(609);
        clearToOpenRoom(game2);
        const sala2 = spawn(game2, 'salamander', 4, 5);
        game2.player.loc.x = 10; game2.player.loc.y = 5;
        game2.player.hp = 500;

        sala2.takeTurn(game2, 10);

        expect(game2.player.hp).toBe(500);   // 关键断言：射程外不掉血
        expect(sala2.loc.x).toBe(5);         // 改为走近
    });

    it('对抗性【射程写成 2】：距离 4 也必须甩得到（4 ≤ 射程 5）—— 只会 2 格内' +
        '出手的实现（把鞭当相邻近战延伸一格）会让 salamander 走近而玩家满血。', () => {
        const game = createHeadlessGame(610);
        clearToOpenRoom(game);
        const sala = spawn(game, 'salamander', 4, 5);
        game.player.loc.x = 8; game.player.loc.y = 5;
        game.player.hp = 500;

        sala.takeTurn(game, 10);

        expect(game.player.hp).toBeLessThan(500);   // 关键断言：4 格外照样甩到
        expect(sala.loc.x).toBe(4);                 // 原地出手
    });

    it('对抗性【不打第一个受阻点/打多个目标】：CE 的鞭只打 getImpactLoc 停下的' +
        '那一个目标（Movement.c:888-894）—— 前方 2 格站着盟友、玩家在 4 格时，' +
        '被抽的是挡弹的盟友、玩家毫发无损；跳过盟友直取玩家或双目标齐打的实现都会翻车。', () => {
        const game = createHeadlessGame(611);
        clearToOpenRoom(game);
        const sala = spawn(game, 'salamander', 4, 5);
        const blocker = allyOf(game, 'rat', 6, 5);  // 挡弹的第一个活物
        game.player.loc.x = 8; game.player.loc.y = 5;
        game.player.hp = 500;
        const bBefore = blocker.hp;

        sala.takeTurn(game, 10);

        expect(blocker.hp).toBeLessThan(bBefore);   // 挡弹者被抽
        expect(game.player.hp).toBe(500);           // 关键断言：玩家不掉血（单目标）
        expect(sala.loc.x).toBe(4);                 // 出手了，没有绕路
    });
});

// ---------------------------------------------------------------------------
// 对照组与分发
// ---------------------------------------------------------------------------
describe('P4-6 对照组与旗标分发', () => {
    it('对照组：三旗标皆无的 rat 在矛的标志性站位下只打贴脸那一个目标 —— ' +
        '身后线上与斜角的探针都毫发无损（任何几何"传染"都会在这里翻车）。', () => {
        const game = createHeadlessGame(612);
        clearToOpenRoom(game);
        const rat = spawn(game, 'rat', 4, 5, { accuracy: 200 });
        game.player.loc.x = 5; game.player.loc.y = 5;
        game.player.hp = 500;
        const behind = allyOf(game, 'rat', 6, 5);
        const diagonal = allyOf(game, 'rat', 4, 4);
        const bBefore = behind.hp;
        const dBefore = diagonal.hp;

        rat.takeTurn(game, 10);

        expect(game.player.hp).toBeLessThan(500);   // 只打了贴脸的玩家
        expect(behind.hp).toBe(bBefore);
        expect(diagonal.hp).toBe(dBefore);
        expect(rat.loc.x).toBe(4);                  // 就地攻击，没有移动
    });

    it('对照组：rat 在 2 格直线外只走近、不攻击（普通怪没有远程几何）—— ' +
        '把几何检查挂错到所有怪物身上的实现在这里翻车。', () => {
        const game = createHeadlessGame(613);
        clearToOpenRoom(game);
        const rat = spawn(game, 'rat', 4, 5, { accuracy: 200 });
        game.player.loc.x = 6; game.player.loc.y = 5;
        game.player.hp = 500;

        rat.takeTurn(game, 10);

        expect(game.player.hp).toBe(500);   // 没有攻击
        expect(rat.loc.x).toBe(5);          // 走进了中间格
    });

    it('旗标分发走 abilityFlags 而非种类白名单：注入 MA_ATTACKS_EXTEND 的 rat ' +
        '在 4 格外甩鞭；注入 MA_ATTACKS_ALL_ADJACENT 的 rat 贴脸时扫掉斜角。' +
        '（mutations.json 现无携带这三个旗标的变异，按 P4-5 的变异测试意图改为 ' +
        '直接注入 abilityFlags，验证的是同一条 hasAbility 分发路径。）', () => {
        // 注入鞭：4 格外出手
        const game1 = createHeadlessGame(614);
        clearToOpenRoom(game1);
        const rat1 = spawn(game1, 'rat', 4, 5, { accuracy: 200 });
        rat1.abilityFlags.add('MA_ATTACKS_EXTEND');
        game1.player.loc.x = 8; game1.player.loc.y = 5;
        game1.player.hp = 500;

        rat1.takeTurn(game1, 10);

        expect(game1.player.hp).toBeLessThan(500);
        expect(rat1.loc.x).toBe(4);

        // 注入斧：贴脸扫斜角
        const game2 = createHeadlessGame(615);
        clearToOpenRoom(game2);
        const rat2 = spawn(game2, 'rat', 4, 5, { accuracy: 200 });
        rat2.abilityFlags.add('MA_ATTACKS_ALL_ADJACENT');
        game2.player.loc.x = 5; game2.player.loc.y = 5;
        game2.player.hp = 500;
        const diag = allyOf(game2, 'rat', 4, 4);
        const dBefore = diag.hp;

        rat2.takeTurn(game2, 10);

        expect(game2.player.hp).toBeLessThan(500);
        expect(diag.hp).toBeLessThan(dBefore);
    });

    it('留痕（P4-7 已反转）：weapons.json 的 Whip/Spear/Axe/War Pike 现已携带 ' +
        'CE Items.c:209-236 按种类赋予的物品旗标（EXTEND / PENETRATE / ' +
        'ALL_ADJACENT）。本断言是 P4-6 §7.1 留痕测试的预埋反转（原断言：flags ' +
        '全空，"P4-7 实现时应反转"）；玩家侧几何行为见 ' +
        'p4_7_player_weapon_geometry.test.ts。', () => {
        const weapons = weaponsDataJson as Array<{ id: string; flags?: string[] }>;
        const expectFlags = (id: string, ...flags: string[]) => {
            const w = weapons.find(x => x.id === id);
            expect(w, `weapons.json 应存在 ${id}`).toBeDefined();
            expect(w!.flags ?? [], `${id} 的 flags 应为 ${flags.join('/')}`)
                .toEqual(flags);
        };
        expectFlags('whip', 'ITEM_ATTACKS_EXTEND');
        expectFlags('spear', 'ITEM_ATTACKS_PENETRATE');
        expectFlags('war_pike', 'ITEM_ATTACKS_PENETRATE');
        expectFlags('axe', 'ITEM_ATTACKS_ALL_ADJACENT');
    });
});
