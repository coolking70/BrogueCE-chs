/**
 * src/test/p4_3_special_monster_flags.test.ts — P4-3：特殊怪物旗标真正生效
 *
 * 对照 CE 源码（见 ai_docs/p4_3_special_monster_flags_report.md）：
 *   - MONST_INVULNERABLE      Combat.c:1806 inflictDamage：一切伤害归零
 *   - MONST_IMMUNE_TO_WEAPONS Combat.c:1243-1245 attack()：只把"武器伤害"算成 0，
 *                             法术/环境等其它伤害源不检查这个标志
 *   - MA_REFLECT_100/         Items.c:4978-4983 projectileReflects +
 *     MONST_REFLECT_50        Items.c:5677-5702 reflectBolt：弹道折返给施法者
 *   - MONST_INVISIBLE         Monsters.c:200-203 monsterIsHidden：对非队友恒定隐藏
 *   - MONST_DIES_IF_NEGATED   Items.c:4483-4491 negate()：被 negation 命中直接死亡
 *
 * 反向验证（项目规范 §5.2）：见本文件末尾单独一段，把 isInvulnerable() 判定
 * 改坏后贴出失败输出，再还原（详细贴在报告里，这里只保留正向测试）。
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { Monster, type MonsterData } from '../entities/Monster';
import { Item, ItemCategory } from '../engine/Items/Item';
import { TerrainType } from '../engine/Map/Grid';
import { rng } from '../engine/Random';
import { CombatSystem } from '../engine/Combat/Combat';
import { getBoltForItem } from '../engine/Combat/Bolt';
import { reflectionChance } from '../engine/Combat/CombatFormulas';
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
    for (let x = 2; x <= 16; x++) {
        for (let y = 2; y <= 12; y++) {
            game.grid.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
        }
    }
    game.player.loc.x = 4;
    game.player.loc.y = 5;
    game.player.hp = game.player.maxHp;
}

// ---------------------------------------------------------------------------
// 验收 1：Warden of Yendor 打不死（MONST_INVULNERABLE）
// ---------------------------------------------------------------------------
describe('P4-3 验收 1：MONST_INVULNERABLE — Warden of Yendor 打不死', () => {
    it('玩家近战攻击 50 次，Warden 血量不变，也不会死亡', () => {
        const game = createHeadlessGame(1);
        clearToOpenRoom(game);
        rng.seedRandomGenerator(11);

        const warden = new Monster(5, 5, monsterDataById('Warden_of_Yendor'));
        game.monsters.push(warden);
        const hpBefore = warden.hp;

        for (let i = 0; i < 50; i++) {
            const res = CombatSystem.attack(game.player, warden);
            expect(res.damage).toBe(0);
        }

        expect(warden.hp).toBe(hpBefore);
        expect(warden.hp).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// 验收 2：MONST_IMMUNE_TO_WEAPONS — 免疫武器伤害，但法术伤害仍然生效
// ---------------------------------------------------------------------------
describe('P4-3 验收 2：MONST_IMMUNE_TO_WEAPONS', () => {
    it('revenant 受近战武器攻击 50 次，血量不变', () => {
        const game = createHeadlessGame(2);
        clearToOpenRoom(game);
        rng.seedRandomGenerator(21);

        const revenant = new Monster(5, 5, monsterDataById('revenant'));
        game.monsters.push(revenant);
        const hpBefore = revenant.hp;

        for (let i = 0; i < 50; i++) {
            const res = CombatSystem.attack(game.player, revenant);
            expect(res.damage).toBe(0);
        }
        expect(revenant.hp).toBe(hpBefore);
    });

    it('revenant 受怪物法术伤害（FIRE bolt，isWeaponAttack:false 出口）仍会掉血', () => {
        const game = createHeadlessGame(3);
        clearToOpenRoom(game);
        rng.seedRandomGenerator(22);

        const revenant = new Monster(6, 5, monsterDataById('revenant'));
        const dragon = new Monster(5, 5, monsterDataById('dragon')); // 借用其高伤害/高命中率
        game.monsters.push(revenant, dragon);
        const hpBefore = revenant.hp;

        let damaged = false;
        for (let i = 0; i < 30 && !damaged; i++) {
            game.castMonsterBolt(dragon, revenant, 'FIRE');
            if (revenant.hp < hpBefore) damaged = true;
        }
        expect(damaged).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 验收 3：MA_REFLECT_100 — 反射远程法术（怪物侧 + 玩家侧各一例）
// ---------------------------------------------------------------------------
describe('P4-3 验收 3：MA_REFLECT_100 反射', () => {
    it('怪物侧：另一只怪物对 stone guardian 施放 SPARK，伤害反弹到施法者身上，guardian 血量不变', () => {
        const game = createHeadlessGame(4);
        clearToOpenRoom(game);
        rng.seedRandomGenerator(31);

        const guardian = new Monster(6, 5, monsterDataById('stone_guardian'));
        const caster = new Monster(5, 5, monsterDataById('spark_turret'));
        game.monsters.push(guardian, caster);
        const guardianHpBefore = guardian.hp;
        const casterHpBefore = caster.hp;

        let casterDamaged = false;
        for (let i = 0; i < 30 && !casterDamaged; i++) {
            game.castMonsterBolt(caster, guardian, 'SPARK');
            if (caster.hp < casterHpBefore) casterDamaged = true;
        }

        expect(casterDamaged).toBe(true);
        expect(guardian.hp).toBe(guardianHpBefore);
    });

    it('玩家侧：玩家对 stone guardian 施放 FIRE，伤害反弹到玩家自己身上，guardian 血量不变', () => {
        const game = createHeadlessGame(5);
        clearToOpenRoom(game);
        rng.seedRandomGenerator(32);

        const guardian = new Monster(6, 5, monsterDataById('stone_guardian'));
        game.monsters.push(guardian);
        const guardianHpBefore = guardian.hp;
        const playerHpBefore = game.player.hp;

        const staff = new Item('staff of firebolt', '/', 0xff6600, ItemCategory.STAFF);
        // W-3: use the real player exit/contact contract instead of a manually
        // incomplete result and the private effect switch. Damage expectations
        // stay unchanged: reflected travel itself remains W-4.
        game.zapBoltFromPlayer({ ...getBoltForItem('staff_of_fire')!, magnitude: 20 }, staff, guardian.loc);

        expect(guardian.hp).toBe(guardianHpBefore);
        expect(game.player.hp).toBe(playerHpBefore - 20);
    });

    it('golem（MONST_REFLECT_50）的反射概率与 CE PowerTables reflectionChance(4) 一致', () => {
        const golem = new Monster(5, 5, monsterDataById('golem'));
        expect(golem.reflectChance()).toBe(reflectionChance(4));
        expect(golem.reflectChance()).toBeGreaterThan(0);
        expect(golem.reflectChance()).toBeLessThanOrEqual(100);
    });
});

// ---------------------------------------------------------------------------
// 验收 4：MONST_INVISIBLE — phantom 不可见/不渲染
// ---------------------------------------------------------------------------
describe('P4-3 验收 4：MONST_INVISIBLE', () => {
    it('phantom 站在玩家视野内也不会进入 visibleMonsters（无 telepathy 时）', () => {
        const game = createHeadlessGame(6);
        clearToOpenRoom(game);

        const phantom = new Monster(6, 5, monsterDataById('phantom'));
        game.monsters.push(phantom);
        game.onRenderRequested = () => {};
        game.update();

        expect(game.visibleMonsters.has(phantom)).toBe(false);
    });

    it('玩家有 telepathy 时，phantom 会出现在 visibleMonsters 中', () => {
        const game = createHeadlessGame(7);
        clearToOpenRoom(game);

        const phantom = new Monster(6, 5, monsterDataById('phantom'));
        game.monsters.push(phantom);
        game.player.setStatusDuration('telepathy', 50);
        game.onRenderRequested = () => {};
        game.update();

        expect(game.visibleMonsters.has(phantom)).toBe(true);
    });

    it('对照组：非隐形怪物（goblin）在同样视野条件下正常出现', () => {
        const game = createHeadlessGame(8);
        clearToOpenRoom(game);

        const goblin = new Monster(6, 5, monsterDataById('goblin'));
        game.monsters.push(goblin);
        game.onRenderRequested = () => {};
        game.update();

        expect(game.visibleMonsters.has(goblin)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 验收 5：MONST_DIES_IF_NEGATED — 被 negation 命中直接死亡
// ---------------------------------------------------------------------------
describe('P4-3 验收 5：MONST_DIES_IF_NEGATED', () => {
    it('wisp（DIES_IF_NEGATED）被敌对怪物的 NEGATION bolt 命中后直接死亡，而不是只清状态', () => {
        const game = createHeadlessGame(9);
        clearToOpenRoom(game);

        const wisp = new Monster(6, 5, monsterDataById('wisp'));
        wisp.isAlly = true; // 作为玩家的召唤物/盟友，才会被敌对怪物的 NEGATION 当作"敌人"目标
        const hostile = new Monster(5, 5, monsterDataById('goblin'));
        game.monsters.push(wisp, hostile);

        expect(wisp.hp).toBeGreaterThan(0);
        game.castMonsterBolt(hostile, wisp, 'NEGATION');

        expect(wisp.hp).toBeLessThanOrEqual(0);
    });

    it('对照组：没有 DIES_IF_NEGATED 的 goblin 被 NEGATION 命中只清状态，不会死', () => {
        const game = createHeadlessGame(10);
        clearToOpenRoom(game);

        const goblin = new Monster(6, 5, monsterDataById('goblin'));
        goblin.isAlly = true;
        const hostile = new Monster(5, 5, monsterDataById('goblin'));
        hostile.isAlly = false;
        game.monsters.push(goblin, hostile);
        const hpBefore = goblin.hp;

        game.castMonsterBolt(hostile, goblin, 'NEGATION');

        expect(goblin.hp).toBe(hpBefore);
    });
});

// ---------------------------------------------------------------------------
// 验收 6：未实现项——MONST_GETS_TURN_ON_ACTIVATION 显式声明本轮未实现
// ---------------------------------------------------------------------------
describe('P4-3 验收 6：MONST_GETS_TURN_ON_ACTIVATION（本轮未实现，显式断言现状）', () => {
    it('stone guardian 带有该标志，但 web 没有 CE 的"机关/激活"子系统，因此它目前仍会像普通怪物一样每回合自主行动', () => {
        const game = createHeadlessGame(12);
        clearToOpenRoom(game);

        const guardian = new Monster(5, 5, monsterDataById('stone_guardian'));
        // MONST_ALWAYS_HUNTING 已在构造器里把它置为非 ASLEEP 状态，
        // 说明它当前是"会自己找目标行动"的普通怪物，而不是"只在机关触发时才获得回合"。
        expect(guardian.hasBehavior('MONST_GETS_TURN_ON_ACTIVATION')).toBe(true);
        expect(guardian.hasBehavior('MONST_ALWAYS_HUNTING')).toBe(true);
        // 本轮未实现"机关激活"子系统（Architect.ts/BlueprintEngine.ts 禁改，且 web
        // 没有 CE 的 vault/pressure-plate 机关概念），因此不对"它应该不动"做任何断言，
        // 只如实记录现状——不静默跳过。详见报告。
    });
});
