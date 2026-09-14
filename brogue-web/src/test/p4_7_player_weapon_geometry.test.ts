/**
 * src/test/p4_7_player_weapon_geometry.test.ts — P4-7：玩家武器的攻击几何 + 钝器口径
 *   鞭（ITEM_ATTACKS_EXTEND，射程 5）／矛（ITEM_ATTACKS_PENETRATE，直线穿透 2 格、
 *   先远后近）／斧（ITEM_ATTACKS_ALL_ADJACENT，横扫全部相邻敌人）／
 *   钝器（ITEM_ATTACKS_STAGGER，命中击退一格 + 额外恢复一回合）
 *
 * 对照 CE 源码（见 ai_docs/p4_7_player_weapon_geometry_report.md）：
 *   - 玩家攻击入口    Movement.c:1140-1256（先鞭 :1175 后矛 :1176，命中即耗回合
 *                     playerRecoversFromAttacking(true)；普通近战 buildHitList
 *                     :1225-1230 + 攻击循环 :1238-1247（带 dying 复查））
 *   - handleWhipAttacks 玩家分支 Movement.c:869-871 + getImpactLoc 射程 5
 *   - handleSpearAttacks 玩家分支 Movement.c:930-932 + 倒序攻击 :1005-1009
 *   - buildHitList(sweep) Combat.c:2049-2090
 *   - 钝器击退        Combat.c:1398-1401（attack() 内、命中且目标存活）
 *                     → 复用 P4-5 Game.processStaggerHit
 *   - 额外恢复回合    Time.c:2442-2444（命中时 += 2×attackSpeed）
 *   - 旗标赋予        Items.c:209-236（按武器种类，不在 weaponTable 里）
 *
 * 对抗性测试与"能捕获的具体错误实现"逐条标注在每个 it() 前的注释里；
 * 反向验证（真实改坏代码、跑出失败、贴输出、再还原）见报告。
 *
 * 确定性口径：测试把玩家力量设为武器需求值（netEnchant=0），目标 defense=0
 * （玩家 100 accuracy 必中）；敌人 accuracy=200 / damage='1d1'（对 0 防御的玩家
 * 每次命中恰好 1 点）。钝器测试给敌人 moveSpeed=150 做行动相位偏移：玩家攻击
 * 后敌人首次行动落在 t=150，从而 mace 的 200-tick 窗口与剑的 100-tick 窗口内
 * 敌人行动次数完全确定（见各测试注释的推演）。
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import { TerrainType } from '../engine/Map/Grid';
import { logger } from '../engine/Systems/Logger';
import { timeSystem } from '../engine/Systems/Time';
import { ItemLoader } from '../engine/Items/ItemLoader';
import weaponsDataJson from '../data/weapons.json';
import monsterDataJson from '../data/monsters.json';

const WEAPONS = weaponsDataJson as Array<{
    id: string;
    flags?: string[];
    strengthRequired: number;
}>;

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
    game.player.maxHp = 500;
    game.player.hp = 500;   // 高血量吸收反击伤害，让"挨打次数"可精确断言
    // 同 p4_6：脱甲保证玩家防御为 0，敌人 accuracy=200 必中
    game.player.equippedArmor = null;
}

/** 经真实装载链路（spawnWeapon：flags 从 weapons.json 流入 Item）装备武器，
 *  并清掉随机附魔/符文；玩家力量=需求值 → netEnchant=0 → 对 0 防御必中。 */
function equip(game: Game, id: string): void {
    const row = WEAPONS.find(w => w.id === id);
    if (!row) throw new Error(`weapons.json 中找不到 ${id}`);
    const item = ItemLoader.spawnWeapon(id, -1, -1);
    if (!item) throw new Error(`spawnWeapon(${id}) 失败`);
    item.enchantment = 0;
    item.isCursed = false;
    item.runicType = undefined;
    game.player.equippedWeapon = item;
    game.player.strength = row.strengthRequired;
}

/** 放置一只 HUNTING 状态的敌人（patch 覆写 accuracy/damage/hp/defense/speed 保证确定性）。 */
function spawnEnemy(game: Game, id: string, x: number, y: number, patch: Partial<MonsterData> = {}): Monster {
    const det = { accuracy: 200, damage: '1d1', hp: 500, defense: 0 } as Partial<MonsterData>;
    const m = new Monster(x, y, { ...monsterDataById(id), ...det, ...patch } as MonsterData);
    m.state = MonsterState.HUNTING;
    game.monsters.push(m);
    return m;
}

/** 放置一只玩家阵营的盟友（accuracy=0：它的任何攻击都必落空，不污染断言）。 */
function spawnAlly(game: Game, id: string, x: number, y: number, patch: Partial<MonsterData> = {}): Monster {
    const m = spawnEnemy(game, id, x, y, { accuracy: 0, ...patch });
    m.isAlly = true;
    return m;
}

/** 数一段日志里"敌人命中玩家"的消息条数（combat.monster_hits_you）。
 *  用消息计数而不是玩家 HP 算术：maxHp=500 时回血速率 500/300 ≈ 1.67/回合，
 *  1 点反击伤害会被回血立即抹平，HP 断言失真（实测踩过）。 */
function countHitsYou(baseline: number): number {
    return logger.messages.slice(baseline).filter(m => m.text.includes('hits you')).length;
}

function move(game: Game, dx: number, dy: number): void {
    game.handlePlayerAction('move', { x: dx, y: dy }, 'system');
}

// ---------------------------------------------------------------------------
// 鞭：ITEM_ATTACKS_EXTEND —— 射程 5、打沿途第一个受阻点、单目标
// ---------------------------------------------------------------------------
describe('P4-7 玩家鞭（ITEM_ATTACKS_EXTEND）', () => {
    it('对抗性【射程写成 2 或无限】：距离 4 必须甩得到且原地不出手；距离 6 必须' +
        '甩不到、走近一格 —— 把射程写成 2 的实现在距离 4 翻车，写成无限/6 的' +
        '实现在距离 6 翻车（CE getImpactLoc maxDistance=5，Movement.c:888）。', () => {
        // 距离 4：甩到且玩家不移动
        const game1 = createHeadlessGame(701);
        clearToOpenRoom(game1);
        equip(game1, 'whip');
        const foe1 = spawnEnemy(game1, 'rat', 8, 5);   // 4 格外
        const fBefore1 = foe1.hp;
        move(game1, 1, 0);
        expect(foe1.hp).toBeLessThan(fBefore1);        // 关键断言①：距离 4 甩得到
        expect(game1.player.loc.x).toBe(4);            // 原地出手，没有走近
        expect(game1.player.loc.y).toBe(5);
        expect(game1.player.hp).toBe(500);             // 敌人从未贴脸，反伤为零

        // 距离 6：甩不到，走近一格
        const game2 = createHeadlessGame(702);
        clearToOpenRoom(game2);
        equip(game2, 'whip');
        const foe2 = spawnEnemy(game2, 'rat', 10, 5);  // 6 格外
        const fBefore2 = foe2.hp;
        move(game2, 1, 0);
        expect(foe2.hp).toBe(fBefore2);                // 关键断言②：距离 6 甩不到
        expect(game2.player.loc.x).toBe(5);            // 回落为普通移动
    });

    it('对抗性【不打第一个受阻点/多目标齐打】：CE 的鞭只打 getImpactLoc 停下的' +
        '那一个目标（Movement.c:888-894），而挡弹者若不可攻击（盟友）则整鞭落空' +
        '—— 前方 2 格站着盟友、敌人 4 格时：移动过去、两人都毫发无损；' +
        '跳过盟友直取敌人或双目标齐打的实现都会翻车。', () => {
        const game = createHeadlessGame(703);
        clearToOpenRoom(game);
        equip(game, 'whip');
        const blocker = spawnAlly(game, 'rat', 6, 5);  // 2 格外的挡弹盟友
        const foe = spawnEnemy(game, 'rat', 8, 5);     // 4 格外的敌人
        const bBefore = blocker.hp;
        const fBefore = foe.hp;
        move(game, 1, 0);
        expect(blocker.hp).toBe(bBefore);              // 盟友绝不被自己的鞭抽中
        expect(foe.hp).toBe(fBefore);                  // 关键断言：敌人也没被打到
        expect(game.player.loc.x).toBe(5);             // 整鞭落空 → 普通移动一格
    });

    it('鞭击杀走完整结算：1 HP 敌人在 3 格外被抽死 —— 击杀计数 +1（几何出口' +
        '与贴脸近战共用 resolvePlayerMeleeAttackOn 的击杀/掉落路径）。', () => {
        const game = createHeadlessGame(704);
        clearToOpenRoom(game);
        equip(game, 'whip');
        const foe = spawnEnemy(game, 'rat', 7, 5, { hp: 1 });  // 3 格外，必死
        const killsBefore = (game as any).stats.kills as number;
        move(game, 1, 0);
        expect(foe.hp).toBeLessThanOrEqual(0);
        expect((game as any).stats.kills).toBe(killsBefore + 1); // 关键断言：完整结算
        expect(game.player.loc.x).toBe(4);             // 远程击杀，原地不动
    });
});

// ---------------------------------------------------------------------------
// 矛：ITEM_ATTACKS_PENETRATE —— 直线穿透 2 格、先打远的后打近的
// ---------------------------------------------------------------------------
describe('P4-7 玩家矛（ITEM_ATTACKS_PENETRATE）', () => {
    it('对抗性【攻击顺序写成正序】：CE Movement.c:1005-1009 人为倒序攻击（先远' +
        '后近）—— 两个 1 HP 敌人（贴脸 + 2 格外）都被刺死，但日志里远处目标' +
        '的命中消息必须在前；正序实现的消息顺序相反。', () => {
        const game = createHeadlessGame(705);
        clearToOpenRoom(game);
        equip(game, 'spear');
        const near = spawnEnemy(game, 'rat', 5, 5, { hp: 1 });    // 贴脸
        const far = spawnEnemy(game, 'goblin', 6, 5, { hp: 1 });  // 2 格外
        const baseline = logger.messages.length;
        move(game, 1, 0);
        expect(near.hp).toBeLessThanOrEqual(0);        // 两个目标都挨打
        expect(far.hp).toBeLessThanOrEqual(0);
        const msgs = logger.messages.slice(baseline);
        const farIdx = msgs.findIndex(m => m.text.includes(`hit the ${far.name}`));
        const nearIdx = msgs.findIndex(m => m.text.includes(`hit the ${near.name}`));
        expect(farIdx).toBeGreaterThanOrEqual(0);
        expect(nearIdx).toBeGreaterThanOrEqual(0);
        expect(farIdx).toBeLessThan(nearIdx);          // 关键断言：远端消息在前
        expect(game.player.loc.x).toBe(4);             // 原地出手
    });

    it('对抗性【把矛当普通近战】：贴脸与 2 格外的两个敌人必须同时掉血 —— 只打' +
        '贴脸一个的实现（漏掉穿透收集）在这里翻车。', () => {
        const game = createHeadlessGame(706);
        clearToOpenRoom(game);
        equip(game, 'spear');
        const near = spawnEnemy(game, 'rat', 5, 5);
        const far = spawnEnemy(game, 'rat', 6, 5);
        const nBefore = near.hp;
        const fBefore = far.hp;
        move(game, 1, 0);
        expect(near.hp).toBeLessThan(nBefore);
        expect(far.hp).toBeLessThan(fBefore);          // 关键断言：远端也掉血
        expect(game.player.loc.x).toBe(4);
    });

    it('对抗性【几何伸进墙里】：CE Movement.c:1173-1186 的几何检查在"移动未被' +
        '阻挡"分支内 —— 贴脸是墙、敌人 2 格外时，朝墙移动不出手也不耗回合；' +
        '漏掉该门控（或漏掉 :976-979 穿墙 break）的实现会把 2 格外的敌人隔墙刺穿。', () => {
        const game = createHeadlessGame(707);
        clearToOpenRoom(game);
        equip(game, 'spear');
        game.grid.setTerrain(5, 5, TerrainType.WALL, '#', 0x444444); // 贴脸墙
        const foe = spawnEnemy(game, 'rat', 6, 5);
        const fBefore = foe.hp;
        const tickBefore = timeSystem.currentTick;
        move(game, 1, 0);
        expect(foe.hp).toBe(fBefore);                  // 关键断言：隔墙不出手
        expect(game.player.loc.x).toBe(4);             // 撞墙不移动
        expect(timeSystem.currentTick).toBe(tickBefore); // 撞墙不耗回合
    });
});

// ---------------------------------------------------------------------------
// 斧：ITEM_ATTACKS_ALL_ADJACENT —— 横扫全部相邻敌人
// ---------------------------------------------------------------------------
describe('P4-7 玩家斧（ITEM_ATTACKS_ALL_ADJACENT）', () => {
    it('对抗性【横扫误伤盟友】：CE buildHitList 的 monsterWillAttackTarget 复查' +
        '（Combat.c:2079）—— 主目标与另一斜角敌人（1 HP，必死）被扫掉，斜角' +
        '盟友必须毫发无损；漏掉敌我过滤的实现会把盟友一起砍了。', () => {
        const game = createHeadlessGame(708);
        clearToOpenRoom(game);
        equip(game, 'axe');
        const foeE = spawnEnemy(game, 'rat', 5, 5, { hp: 1 });    // 主目标（东）
        const foeNE = spawnEnemy(game, 'rat', 5, 4, { hp: 1 });   // 东北斜角敌人
        const ally = spawnAlly(game, 'rat', 4, 4);                // 西北斜角盟友
        const aBefore = ally.hp;
        const killsBefore = (game as any).stats.kills as number;
        move(game, 1, 0);
        expect(foeE.hp).toBeLessThanOrEqual(0);        // 主目标被扫掉
        expect(foeNE.hp).toBeLessThanOrEqual(0);       // 斜角敌人也被扫掉
        expect((game as any).stats.kills).toBe(killsBefore + 2);
        expect(ally.hp).toBe(aBefore);                 // 关键断言：盟友一滴不掉
        expect(game.player.loc.x).toBe(4);
    });

    it('横扫要扫满 8 个邻格里的多个敌人（CE buildHitList sweep 分支 i 走满 0..7，' +
        'Combat.c:2072-2086）—— 5 个方向围上来的 1 HP 敌人全部被扫死；只打主' +
        '目标或漏掉斜角的实现在这里翻车。', () => {
        const game = createHeadlessGame(709);
        clearToOpenRoom(game);
        equip(game, 'axe');
        const foes = [
            spawnEnemy(game, 'rat', 5, 5, { hp: 1 }),  // 东（主目标）
            spawnEnemy(game, 'rat', 5, 4, { hp: 1 }),  // 东北
            spawnEnemy(game, 'rat', 4, 4, { hp: 1 }),  // 北
            spawnEnemy(game, 'rat', 3, 5, { hp: 1 }),  // 西
            spawnEnemy(game, 'rat', 4, 6, { hp: 1 }),  // 南
        ];
        move(game, 1, 0);
        foes.forEach((f, i) => expect(f.hp, `敌人#${i} 必须被扫死`).toBeLessThanOrEqual(0));
        expect((game as any).stats.kills).toBe(5);
    });
});

// ---------------------------------------------------------------------------
// 钝器：ITEM_ATTACKS_STAGGER —— 命中击退一格 + 额外恢复一回合
// ---------------------------------------------------------------------------
describe('P4-7 玩家钝器（ITEM_ATTACKS_STAGGER）', () => {
    // 行动时序推演（敌人 patch moveSpeed=150 → 初始 ticksUntilTurn=150、
    // 移动耗时 150、攻击耗时 attackSpeed=100）：
    //   mace 命中 → 玩家 ticksUntilTurn = 200（Time.c:2442-2444 的 2×attackSpeed）：
    //     敌人首次行动在 t=150 —— 身后有墙（无处可推）时为一次攻击（玩家 -1 HP）；
    //   剑（无钝器口径）→ 玩家 ticksUntilTurn = 100：t=100 时循环结束，
    //     敌人 t=150 的首次行动落空（玩家 0 次挨打）。
    it('对抗性【只做击退、漏了额外恢复回合】：钝器命中且目标身后是墙（无空间击退' +
        '，CE "if there is room"）时，额外恢复的一回合让敌人的攻击落进玩家窗口 —— ' +
        'mace 命中后玩家恰好掉 1 点（200-tick 窗口内敌人 t=150 攻击一次）；漏掉' +
        '额外恢复的实现只给 100 tick，敌人 t=150 的攻击落空（玩家满血）→ 在' +
        '这里翻车。', () => {
        const game = createHeadlessGame(710);
        clearToOpenRoom(game);
        equip(game, 'mace');
        const foe = spawnEnemy(game, 'rat', 5, 5, { moveSpeed: 150 });
        game.grid.setTerrain(6, 5, TerrainType.WALL, '#', 0x444444); // 身后墙：无处可推
        const fBefore = foe.hp;
        const baseline = logger.messages.length;
        move(game, 1, 0);
        expect(foe.hp).toBeLessThan(fBefore);          // 命中了
        expect(foe.loc.x).toBe(5);                     // 无空间，没被推
        expect(countHitsYou(baseline)).toBe(1);  // 关键断言：额外恢复回合成立
    });

    it('对抗性【只做额外恢复、漏了击退】：有空间时命中必须把目标推开一格 —— ' +
        '被推开的敌人当回合离场，腾出的 t=150 行动用于"走回来"（耗时 150）' +
        '而非攻击，玩家满血；漏掉击退的实现里敌人原地连击……原地攻击一下' +
        '（玩家 -1 HP）→ 在这里翻车。', () => {
        const game = createHeadlessGame(711);
        clearToOpenRoom(game);
        equip(game, 'mace');
        const foe = spawnEnemy(game, 'rat', 5, 5, { moveSpeed: 150 }); // 身后空地
        const fBefore = foe.hp;
        const baseline = logger.messages.length;
        move(game, 1, 0);
        expect(foe.hp).toBeLessThan(fBefore);          // 命中了
        expect(countHitsYou(baseline)).toBe(0);  // 关键断言：被推走 → 无反击
        expect(foe.loc.x).toBe(5);                     // 回合末已走回贴脸格
        expect(foe.loc.y).toBe(5);
    });

    it('对照组【普通剑不得有钝器口径】：同样的站位与速度参数换剑（身后墙）：' +
        '100-tick 窗口内敌人 t=150 的攻击落空，玩家满血；钝器旗标泄漏到普通' +
        '武器的实现会变成 200-tick 窗口（玩家 -1 HP）→ 在这里翻车。', () => {
        const game = createHeadlessGame(712);
        clearToOpenRoom(game);
        equip(game, 'sword');
        const foe = spawnEnemy(game, 'rat', 5, 5, { moveSpeed: 150 });
        game.grid.setTerrain(6, 5, TerrainType.WALL, '#', 0x444444);
        const fBefore = foe.hp;
        const baseline = logger.messages.length;
        move(game, 1, 0);
        expect(foe.hp).toBeLessThan(fBefore);          // 普通命中
        expect(foe.loc.x).toBe(5);                     // 没有击退
        expect(countHitsYou(baseline)).toBe(0);  // 关键断言：无额外恢复回合
    });
});

// ---------------------------------------------------------------------------
// 对照组：普通武器不得触发任何几何效果
// ---------------------------------------------------------------------------
describe('P4-7 对照组（dagger / sword / broadsword）', () => {
    const PLAIN = ['dagger', 'sword', 'broadsword'] as const;

    for (const weaponId of PLAIN) {
        it(`${weaponId}：贴脸只打贴脸那一个目标 —— 身后直线上与斜角的探针都` +
            '毫发无损（"全武器都横扫/穿透"的错误实现在这里翻车）。', () => {
            const game = createHeadlessGame(713, 'normal');
            clearToOpenRoom(game);
            equip(game, weaponId);
            const foe = spawnEnemy(game, 'rat', 5, 5, { hp: 1 });     // 贴脸
            const behind = spawnEnemy(game, 'rat', 6, 5);             // 身后直线 2 格
            const diagonal = spawnEnemy(game, 'rat', 5, 4);           // 东北斜角
            const bBefore = behind.hp;
            const dBefore = diagonal.hp;
            move(game, 1, 0);
            expect(foe.hp).toBeLessThanOrEqual(0);     // 打死了贴脸目标
            expect(behind.hp).toBe(bBefore);           // 身后没被穿透
            expect(diagonal.hp).toBe(dBefore);         // 斜角没被横扫
            expect(game.player.loc.x).toBe(4);         // 原地攻击
        });
    }

    it('对抗性【普通剑隔空够不到】：距离 3 的敌人对普通剑不可达 —— 朝它移动' +
        '一格只走不打；任何"普通武器也有射程"的实现（鞭化/矛化传染）在这里翻车。', () => {
        const game = createHeadlessGame(714);
        clearToOpenRoom(game);
        equip(game, 'sword');
        const foe = spawnEnemy(game, 'rat', 7, 5);     // 3 格外
        const fBefore = foe.hp;
        move(game, 1, 0);
        expect(foe.hp).toBe(fBefore);                  // 关键断言：没被打到
        expect(game.player.loc.x).toBe(5);             // 就是普通移动了一格
        expect(game.player.hp).toBe(500);              // 也没进近战范围
    });
});

// ---------------------------------------------------------------------------
// 数据留痕：weapons.json 旗标与明确不做项
// ---------------------------------------------------------------------------
describe('P4-7 数据留痕', () => {
    it('weapons.json 旗标对照 CE Items.c:209-236：六件武器各有其旗标，且经' +
        'spawnWeapon 装载进 Item；halberd（web 自创、已退出生成池）与普通武器' +
        '不带任何几何/钝器旗标。', () => {
        const expectFlags = (id: string, ...flags: string[]) => {
            const w = WEAPONS.find(x => x.id === id);
            expect(w, `weapons.json 应存在 ${id}`).toBeDefined();
            expect(w!.flags ?? [], `${id} 的 flags`).toEqual(flags);
        };
        expectFlags('whip', 'ITEM_ATTACKS_EXTEND');
        expectFlags('spear', 'ITEM_ATTACKS_PENETRATE');
        expectFlags('war_pike', 'ITEM_ATTACKS_PENETRATE');
        expectFlags('axe', 'ITEM_ATTACKS_ALL_ADJACENT');
        expectFlags('mace', 'ITEM_ATTACKS_STAGGER');
        expectFlags('war_hammer', 'ITEM_ATTACKS_STAGGER');
        expectFlags('halberd');   // 自创条目：不持有 CE 旗标
        expectFlags('dagger');
        expectFlags('rapier');
        expectFlags('flail');
        expectFlags('sword');
        expectFlags('broadsword');
        expectFlags('dart');

        // 真实装载链路：flags 从 json 流入 Item
        const hammer = ItemLoader.spawnWeapon('war_hammer', -1, -1);
        expect(hammer?.flags).toEqual(['ITEM_ATTACKS_STAGGER']);
    });

    it('留痕（本轮明确不做项）：dagger 的 ITEM_SNEAK_ATTACK_BONUS、rapier 的 ' +
        'ITEM_ATTACKS_QUICKLY|ITEM_LUNGE_ATTACKS、flail 的 ITEM_PASS_ATTACKS ' +
        '均未实现 —— 数据里没有、行为上也断言普通武器无几何（对照组已覆盖）。', () => {
        const CE_FLAGS = ['ITEM_SNEAK_ATTACK_BONUS', 'ITEM_ATTACKS_QUICKLY',
            'ITEM_LUNGE_ATTACKS', 'ITEM_PASS_ATTACKS'] as const;
        for (const w of WEAPONS) {
            for (const f of CE_FLAGS) {
                expect(w.flags ?? [], `${w.id} 不应携带 ${f}（本轮明确不做）`)
                    .not.toContain(f);
            }
        }
    });
});
