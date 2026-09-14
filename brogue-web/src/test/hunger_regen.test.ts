/**
 * src/test/hunger_regen.test.ts — 饥饿与回血机制对齐 Brogue CE 的验收测试
 *
 * CE 出处：
 * - Rogue.h:1123-1127  TURNS_FOR_FULL_REGEN=300 / STOMACH_SIZE=2150 / HUNGER_THRESHOLD=350
 *                      / WEAK_THRESHOLD=150 / FAINT_THRESHOLD=50
 * - Items.c:8735-8750  updatePlayerRegenerationDelay：300 回合回满整个 HP 池
 * - Time.c:927-968     checkNutrition：350/150/50 三档仅触发一次提示消息
 * - Time.c:2524-2541   nutrition<=0 每回合扣 1 HP；回血前提 hp<maxHp 且未中毒
 * - Items.c:7491       进食：nutrition = min(power + nutrition, STOMACH_SIZE)
 * - Globals.c:1577-1580 foodTable：ration 1800 / mango 1550
 */
import { describe, it, expect } from 'vitest';
import {
    Player,
    TURNS_FOR_FULL_REGEN,
    STOMACH_SIZE,
    HUNGER_THRESHOLD,
    WEAK_THRESHOLD,
    FAINT_THRESHOLD,
} from '../entities/Player';
import { createHeadlessGame } from './harness';
import { ItemLoader } from '../engine/Items/ItemLoader';

/** 静止回满：返回实际回满所用回合数（不超过 maxTurns 时）。 */
function ticksToFullHeal(p: Player, maxTurns: number): number {
    for (let t = 1; t <= maxTurns; t++) {
        p.updateNutrition();
        if (p.hp >= p.maxHp) return t;
    }
    return -1;
}

describe('偏差1：回血随 maxHp 缩放（300 回合回满）', () => {
    it('maxHp=30 从 1 HP 起 300 回合内回满', () => {
        const p = new Player(0, 0);
        p.maxHp = 30;
        p.hp = 1;
        expect(ticksToFullHeal(p, TURNS_FOR_FULL_REGEN)).toBeLessThanOrEqual(TURNS_FOR_FULL_REGEN);
        expect(p.hp).toBe(30);
    });

    it('maxHp=100 从 1 HP 起同样 300 回合内回满（证明随上限缩放）', () => {
        const p = new Player(0, 0);
        p.maxHp = 100;
        p.hp = 1;
        expect(ticksToFullHeal(p, TURNS_FOR_FULL_REGEN)).toBeLessThanOrEqual(TURNS_FOR_FULL_REGEN);
        expect(p.hp).toBe(100);
    });

    it('maxHp=60 从 1 HP 起 300 回合内回满（小数速率由累加器保精度）', () => {
        const p = new Player(0, 0);
        p.maxHp = 60;
        p.hp = 1;
        expect(ticksToFullHeal(p, TURNS_FOR_FULL_REGEN)).toBeLessThanOrEqual(TURNS_FOR_FULL_REGEN);
        expect(p.hp).toBe(60);
    });

    it('regenerating 光环保持原有 0.6 倍回满时间（web 既有语义）', () => {
        const p = new Player(0, 0);
        p.maxHp = 30;
        p.hp = 1;
        p.setStatusDuration('regenerating', 500);
        expect(ticksToFullHeal(p, TURNS_FOR_FULL_REGEN)).toBeLessThanOrEqual(Math.round(TURNS_FOR_FULL_REGEN * 0.6));
    });
});

describe('偏差2：饥饿阈值 2150/350/150/50，与回血解耦', () => {
    it('常量与 CE Rogue.h:1124-1127 一致', () => {
        expect(STOMACH_SIZE).toBe(2150);
        expect(HUNGER_THRESHOLD).toBe(350);
        expect(WEAK_THRESHOLD).toBe(150);
        expect(FAINT_THRESHOLD).toBe(50);
        expect(TURNS_FOR_FULL_REGEN).toBe(300);
    });

    it('开局饱食度为满胃（CE Monsters.c:3923）', () => {
        const p = new Player(0, 0);
        expect(p.nutrition).toBe(STOMACH_SIZE);
        expect(p.maxNutrition).toBe(STOMACH_SIZE);
    });

    it('350/150/50/0 四点各触发一次状态变更，且不重复', () => {
        const p = new Player(0, 0);
        const transitions: Array<{ turn: number; state: string }> = [];
        for (let t = 1; t <= 2160; t++) {
            p.updateNutrition();
            const transition = p.consumeHungerTransition();
            if (transition) transitions.push({ turn: t, state: transition });
        }
        expect(transitions).toEqual([
            { turn: 1800, state: 'hungry' },   // nutrition 350
            { turn: 2000, state: 'weak' },     // nutrition 150
            { turn: 2100, state: 'faint' },    // nutrition 50
            { turn: 2150, state: 'starving' }, // nutrition 0
        ]);
        expect(p.hungerState).toBe('starving');
    });

    it('nutrition 归零后每回合扣 1 HP（CE Time.c:2525-2530）', () => {
        const p = new Player(0, 0);
        p.nutrition = 1;
        p.updateNutrition(); // nutrition → 0，本回合即开始饿死扣血
        expect(p.hungerState).toBe('starving');
        expect(p.hp).toBe(p.maxHp - 1);
        p.updateNutrition();
        expect(p.hp).toBe(p.maxHp - 2);
    });

    it('weak 档位回血速率不变（阈值不耦合回血）', () => {
        const weak = new Player(0, 0);
        weak.maxHp = 30;
        weak.hp = 1;
        weak.nutrition = 350; // 足够撑过回满所需回合，期间进入 hungry/weak 档
        const full = new Player(0, 0);
        full.maxHp = 30;
        full.hp = 1;
        full.nutrition = STOMACH_SIZE;
        const turnsAtWeak = ticksToFullHeal(weak, TURNS_FOR_FULL_REGEN);
        const turnsAtFull = ticksToFullHeal(full, TURNS_FOR_FULL_REGEN);
        expect(turnsAtWeak).toBe(turnsAtFull); // 与饱食档完全同速
        expect(turnsAtWeak).toBeLessThanOrEqual(TURNS_FOR_FULL_REGEN);
        expect(weak.hungerState).not.toBe('normal'); // 确实经过了低档位
        expect(weak.hp).toBe(30);
    });
});

describe('偏差3：中毒期间回血归零', () => {
    it('poisoned 状态下 300 回合 HP 不增长', () => {
        const p = new Player(0, 0);
        p.maxHp = 30;
        p.hp = 1;
        p.applyStatus('poisoned', 400);
        for (let t = 0; t < TURNS_FOR_FULL_REGEN; t++) {
            p.tickStatuses(); // 模拟 Game 每回合的状态倒计时
            p.updateNutrition();
        }
        expect(p.hp).toBe(1);
    });

    it('中毒结束后回血恢复', () => {
        const p = new Player(0, 0);
        p.maxHp = 30;
        p.hp = 1;
        p.applyStatus('poisoned', 10);
        for (let t = 0; t < 10; t++) {
            p.tickStatuses();
            p.updateNutrition();
        }
        expect(p.hasStatus('poisoned')).toBe(false);
        const hpAfterPoison = p.hp;
        for (let t = 0; t < TURNS_FOR_FULL_REGEN; t++) {
            p.updateNutrition();
        }
        expect(p.hp).toBe(30);
        expect(p.hp).toBeGreaterThan(hpAfterPoison);
    });
});

describe('偏差4：食物恢复量 ration 1800 / mango 1550', () => {
    it('consumables.json 与 CE foodTable 数值一致（Globals.c:1577-1580）', () => {
        const ration = ItemLoader.food.find(f => f.id === 'ration_of_food') as unknown as { nutrition?: number };
        const mango = ItemLoader.food.find(f => f.id === 'mango') as unknown as { nutrition?: number };
        expect(ration?.nutrition).toBe(1800);
        expect(mango?.nutrition).toBe(1550);
    });

    it('吃一份 ration 恢复 1800 nutrition', () => {
        const game = createHeadlessGame(20260914);
        const p = game.player;
        const ration = ItemLoader.spawnFood('ration_of_food', p.x, p.y);
        expect(ration).not.toBeNull();
        expect(p.inventory.addItem(ration!)).toBe(true);
        p.nutrition = 100;
        game.eatItem(ration!);
        expect(p.nutrition).toBe(1899)  // P2-3 起 eatItem/readItem 为完整回合：施加效果后同一动作的客观块随即递减 1（CE 同构）。;
    });

    it('恢复量不超过 maxNutrition 上限（CE Items.c:7491 的 min）', () => {
        const game = createHeadlessGame(20260914);
        const p = game.player;
        const ration = ItemLoader.spawnFood('ration_of_food', p.x, p.y)!;
        p.inventory.addItem(ration);
        p.nutrition = 2100;
        game.eatItem(ration);
        // P2-3 起 eatItem 为完整回合：先 min(2100+1800, STOMACH_SIZE)=2150 封顶，
        // 随后同一动作的客观块递减 1（CE 同构：eat() → playerTurnEnded() → decrementPlayerStatus）。
        expect(p.nutrition).toBe(STOMACH_SIZE - 1);
        expect(p.nutrition).toBeLessThanOrEqual(p.maxNutrition);
    });

    it('吃一个 mango 恢复 1550 nutrition', () => {
        const game = createHeadlessGame(20260914);
        const p = game.player;
        const mango = ItemLoader.spawnFood('mango', p.x, p.y)!;
        p.inventory.addItem(mango);
        p.nutrition = 100;
        game.eatItem(mango);
        expect(p.nutrition).toBe(1649)  // P2-3 起 eatItem/readItem 为完整回合：施加效果后同一动作的客观块随即递减 1（CE 同构）。;
    });
});
