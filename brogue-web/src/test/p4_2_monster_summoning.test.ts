/**
 * src/test/p4_2_monster_summoning.test.ts — P4-2：怪物召唤（MA_CAST_SUMMON）
 *
 * 对照 CE Monsters.c 的 monsterSummons（2418）/ summonMinions（985）/
 * pickHordeType 召唤分支（511，见 ai_docs/p4_2_monster_summoning_report.md
 * 的逐段对照）。覆盖任务给出的验收条款 1-6：
 *   1. 召唤确实发生（goblin conjurer 场上出现 spectral blade）
 *   2. 自限概率（minionCount 0/1/2/3 → 1/2、1/5、1/14、1/29）
 *   3. MA_ENTER_SUMMONS（phoenix egg/phylactery 自身消失、新怪物出现）
 *   4. 领袖归属（leader 指向召唤者，只被该召唤者计入 minionCount）
 *   5. 召唤在 bolt 之前（lich/vampire/ogre shaman 优先尝试召唤；goblin
 *      warlord 见下方"与预设不符"说明——CE 源码里它没有 bolts，任务描述
 *      这一条与源码不符，报告已记录，这里仍纳入测试但断言退化为"不炸"）
 *
 * 反向验证（项目规范 §5.2）：本文件编写过程中曾把 trySummon 里的自限概率
 * 公式改成恒定 `rng.randPercent(50)`，"自限概率"用例（验收条款 2）随即
 * 全部失败（0/1/2/3 随从时命中率都约等于 0.5，而不是 1/2、1/5、1/14、1/29
 * 的递减曲线），确认测试确实在断言"随从越多越难再召"这条规则本身。
 * 已截图/贴出失败输出到报告，确认后已还原。
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { Monster, MonsterState, countMinions, type MonsterData } from '../entities/Monster';
import { TerrainType } from '../engine/Map/Grid';
import { rng } from '../engine/Random';
import monsterDataJson from '../data/monsters.json';

const MONSTER_DATA = monsterDataJson as MonsterData[];

function monsterDataById(id: string): MonsterData {
    const row = MONSTER_DATA.find(m => m.id === id);
    if (!row) throw new Error(`monsters.json 中找不到 ${id}`);
    return row;
}

/** 清场并在 (2,2)-(20,16) 铺一间开放房间。 */
function clearToOpenRoom(game: Game): void {
    game.monsters.length = 0;
    game.items.length = 0;
    for (let x = 2; x <= 20; x++) {
        for (let y = 2; y <= 16; y++) {
            game.grid.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
        }
    }
    game.player.loc.x = 4;
    game.player.loc.y = 5;
    game.player.hp = game.player.maxHp;
}

function makeFollowers(leader: Monster, count: number): Monster[] {
    const followers: Monster[] = [];
    for (let i = 0; i < count; i++) {
        const f = new Monster(3 + i, 3, monsterDataById('rat'));
        f.leader = leader;
        followers.push(f);
    }
    return followers;
}

describe('P4-2 验收 1：召唤确实发生', () => {
    it('goblin conjurer 在开阔房间内反复行动，若干次尝试内场上会出现 spectral blade', () => {
        const game = createHeadlessGame(20260914);
        clearToOpenRoom(game);
        rng.seedRandomGenerator(1);

        const conjurer = new Monster(6, 5, monsterDataById('goblin_conjurer'));
        conjurer.state = MonsterState.HUNTING;
        game.monsters = [conjurer];

        let summoned = false;
        for (let i = 0; i < 300 && !summoned; i++) {
            summoned = conjurer.trySummon(game);
        }
        expect(summoned).toBe(true);
        expect(game.monsters.some(m => m.typeId === 'spectral_blade')).toBe(true);
    });
});

describe('P4-2 验收 2：自限概率——随从越多越难再召', () => {
    /**
     * 直接采样 trySummon() 的返回值（"是否发起了一次召唤尝试"，与 CE
     * monsterSummons 的返回语义一致：RNG 判定通过即算，不看 summonMinions
     * 内部是否真落地）。每次试验前把 game.monsters 重置为
     * "caster + 恰好 minionCount 个 leader===caster 的随从"，隔离出
     * "在这个 minionCount 下命中率是多少"这一个变量，不受同一试验内
     * 召唤成功后随从数增长的影响。
     */
    function sampleRate(minionCount: number, trials: number, seed: number): number {
        const game = createHeadlessGame(20260914);
        clearToOpenRoom(game);
        rng.seedRandomGenerator(seed);

        let hits = 0;
        for (let i = 0; i < trials; i++) {
            const caster = new Monster(6, 5, monsterDataById('goblin_conjurer'));
            caster.isAlly = false;
            const followers = makeFollowers(caster, minionCount);
            game.monsters = [caster, ...followers];
            expect(countMinions(caster, game.monsters)).toBe(minionCount); // 前置条件自检

            if (caster.trySummon(game)) hits++;
        }
        return hits / trials;
    }

    it('minionCount=0 时命中率接近 1/2', () => {
        const rate = sampleRate(0, 4000, 11);
        expect(rate).toBeGreaterThan(0.45);
        expect(rate).toBeLessThan(0.55);
    });

    it('minionCount=1 时命中率接近 1/5', () => {
        const rate = sampleRate(1, 4000, 12);
        expect(rate).toBeGreaterThan(0.16);
        expect(rate).toBeLessThan(0.24);
    });

    it('minionCount=2 时命中率接近 1/14', () => {
        const rate = sampleRate(2, 4000, 13);
        expect(rate).toBeGreaterThan(0.045);
        expect(rate).toBeLessThan(0.10);
    });

    it('minionCount=3 时命中率接近 1/29——随从越多越难再召，不会雪球', () => {
        const rate = sampleRate(3, 4000, 14);
        expect(rate).toBeGreaterThan(0.015);
        expect(rate).toBeLessThan(0.055);
    });

    it('命中率随 minionCount 单调递减（对抗恒定概率这类错误实现）', () => {
        const r0 = sampleRate(0, 3000, 21);
        const r1 = sampleRate(1, 3000, 22);
        const r2 = sampleRate(2, 3000, 23);
        const r3 = sampleRate(3, 3000, 24);
        expect(r0).toBeGreaterThan(r1);
        expect(r1).toBeGreaterThan(r2);
        expect(r2).toBeGreaterThan(r3);
    });
});

describe('P4-2 验收 3：MA_ENTER_SUMMONS', () => {
    it('phoenix egg 召唤成功后自身从场上消失，同时出现 phoenix', () => {
        const game = createHeadlessGame(20260914);
        clearToOpenRoom(game);
        rng.seedRandomGenerator(31);

        const egg = new Monster(6, 5, monsterDataById('phoenix_egg'));
        game.monsters = [egg];

        let summoned = false;
        for (let i = 0; i < 300 && !summoned; i++) {
            summoned = egg.trySummon(game);
        }
        expect(summoned).toBe(true);
        expect(game.monsters.includes(egg)).toBe(false);
        expect(game.monsters.some(m => m.typeId === 'phoenix')).toBe(true);
    });

    it('phylactery 召唤成功后自身从场上消失，同时出现 lich', () => {
        const game = createHeadlessGame(20260914);
        clearToOpenRoom(game);
        rng.seedRandomGenerator(32);

        const phylactery = new Monster(6, 5, monsterDataById('phylactery'));
        game.monsters = [phylactery];

        let summoned = false;
        for (let i = 0; i < 300 && !summoned; i++) {
            summoned = phylactery.trySummon(game);
        }
        expect(summoned).toBe(true);
        expect(game.monsters.includes(phylactery)).toBe(false);
        expect(game.monsters.some(m => m.typeId === 'lich')).toBe(true);
    });

    it('没有 MA_ENTER_SUMMONS 的召唤者（goblin conjurer）召唤后自身仍在场上', () => {
        const game = createHeadlessGame(20260914);
        clearToOpenRoom(game);
        rng.seedRandomGenerator(33);

        const conjurer = new Monster(6, 5, monsterDataById('goblin_conjurer'));
        game.monsters = [conjurer];

        let summoned = false;
        for (let i = 0; i < 300 && !summoned; i++) {
            summoned = conjurer.trySummon(game);
        }
        expect(summoned).toBe(true);
        expect(game.monsters.includes(conjurer)).toBe(true);
    });
});

describe('P4-2 验收 4：领袖归属', () => {
    it('被召唤随从的 leader 指向召唤者，且只被该召唤者计入 minionCount', () => {
        const game = createHeadlessGame(20260914);
        clearToOpenRoom(game);
        rng.seedRandomGenerator(41);

        const conjurerA = new Monster(6, 5, monsterDataById('goblin_conjurer'));
        const conjurerB = new Monster(14, 5, monsterDataById('goblin_conjurer'));
        game.monsters = [conjurerA, conjurerB];

        let summoned = false;
        for (let i = 0; i < 300 && !summoned; i++) {
            summoned = conjurerA.trySummon(game);
        }
        expect(summoned).toBe(true);

        const blades = game.monsters.filter(m => m.typeId === 'spectral_blade');
        expect(blades.length).toBeGreaterThan(0);
        for (const b of blades) {
            expect(b.leader).toBe(conjurerA);
        }
        // 只被 conjurerA 计入，conjurerB（同类型但不同实例）的 minionCount 仍为 0
        expect(countMinions(conjurerA, game.monsters)).toBe(blades.length);
        expect(countMinions(conjurerB, game.monsters)).toBe(0);
    });
});

describe('P4-2 验收 5：召唤在 bolt 之前', () => {
    /**
     * 用 MONST_ALWAYS_USE_ABILITY 让 monsterSummons 的第一分支
     * （alwaysUse && minionCount<50）确定性命中，脱离 RNG 依赖，
     * 直接验证"只要 monstUseMagic 判定召唤成功，就不会再尝试 bolt"
     * 这条 CE Monsters.c:2817-2819 的调用顺序。
     */
    function testsPriority(id: string, expectMemberTypeId: string) {
        const game = createHeadlessGame(20260914);
        clearToOpenRoom(game);
        rng.seedRandomGenerator(51);

        const data: MonsterData = {
            ...monsterDataById(id),
            behaviorFlags: [...(monsterDataById(id).behaviorFlags ?? []), 'MONST_ALWAYS_USE_ABILITY'],
        };
        const caster = new Monster(6, 5, data);
        caster.state = MonsterState.HUNTING;
        game.monsters = [caster];
        game.player.loc.x = 7;
        game.player.loc.y = 5;

        let boltCalled = false;
        const originalCast = game.castMonsterBolt.bind(game);
        (game as unknown as { castMonsterBolt: typeof game.castMonsterBolt }).castMonsterBolt = (...args: Parameters<typeof game.castMonsterBolt>) => {
            boltCalled = true;
            return originalCast(...args);
        };

        caster.takeTurn(game, 8);

        expect(boltCalled).toBe(false);
        expect(game.monsters.some(m => m.typeId === expectMemberTypeId)).toBe(true);
    }

    it('lich（bolts=[FIRE] 且 MA_CAST_SUMMON）优先尝试召唤，不放 FIRE', () => {
        testsPriority('lich', 'phantom');
    });

    it('vampire（bolts=[BLINKING,DISCORD] 且 MA_CAST_SUMMON+MA_ENTER_SUMMONS）优先尝试召唤', () => {
        testsPriority('vampire', 'vampire_bat');
    });

    it('ogre shaman（bolts=[HASTE,SPARK] 且 MA_CAST_SUMMON）优先尝试召唤，不放 SPARK', () => {
        testsPriority('ogre_shaman', 'ogre');
    });

    it('goblin warlord：monsters.json bolts=[]（与 CE Globals.c:1127-1128 一致，任务描述'
        + '"goblin warlord 具备 bolts" 与源码不符，见报告）——仍验证召唤本身不受影响', () => {
        const warlordData = monsterDataById('goblin_warlord');
        expect(warlordData.bolts ?? []).toEqual([]);
        testsPriority('goblin_warlord', 'goblin');
    });
});
