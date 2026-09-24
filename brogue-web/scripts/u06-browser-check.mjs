import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir = 'ai_docs/reports/u-06-evidence';
const browser = await chromium.launch({ headless: false });
const errors = [], states = [];
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://127.0.0.1:5196');
    await page.locator('.menu-card input[type=text]').fill('6006');
    await page.locator('.menu-card .actions').first().locator('button').first().click();
    await page.waitForFunction(() => !!window.render_game_to_text && !!window.activeGame.onRenderRequested);
    await page.evaluate(async () => {
        const [{ Monster, MonsterState, generallyValidBoltTarget, specificallyValidBoltTarget }, md, { TerrainType: T }, { Item, ItemCategory }, { rng }, { logger }] = await Promise.all([
            import('/src/entities/Monster.ts'), import('/src/data/monsters.json'), import('/src/engine/Map/Grid.ts'),
            import('/src/engine/Items/Item.ts'), import('/src/engine/Random.ts'), import('/src/engine/Systems/Logger.ts'),
        ]);
        const g = window.activeGame;
        window.u06Setup = id => {
            g.startNewGame({ seed: 6006, mode: 'test' }); g.mode = 'normal';
            g.monsters = []; g.dormantMonsters = []; g.items = []; g.animationEnabled = false;
            for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
                g.grid.setTerrain(x, y, T.FLOOR); Object.assign(g.grid.getCell(x, y), { machineNumber: 0, hasDormantMonster: false });
            }
            g.player.loc = { x: 8, y: 8 }; g.player.hp = g.player.maxHp = 100;
            const armor = new Item('armor', ']', 0xffffff, ItemCategory.ARMOR); armor.armor = 99999; g.player.equippedArmor = armor;
            const caster = new Monster(12, 8, md.default.find(m => m.id === id));
            caster.state = MonsterState.WANDERING; // Explicit awake fixture; turret composite expansion is outside U06.
            caster.hp = caster.maxHp = 100; caster.accuracy = 0; caster.damageString = '0';
            g.monsters.push(caster); window.u06Caster = caster; rng.seedRandomGenerator(6);
            g.updateVision(); g.needsRender = true; g.update();
        };
        window.u06Read = () => ({ debug: { state: window.u06Caster.state, general: generallyValidBoltTarget(window.u06Caster, g.player, g), specific: specificallyValidBoltTarget(window.u06Caster, g.player, 'SPARK', g), rolls: rng.randomNumbersGenerated }, hp: g.player.hp, shield: g.player.getStatusDuration('shielded'), burning: g.player.statusDurations.burning ?? 0,
            turns: g.stats.turns, source: g.lastDamageSource, over: g.isGameOver, reason: g.gameOverReason,
            caster: { name: window.u06Caster.name, hp: window.u06Caster.hp },
            messages: logger.messages.map(m => m.text), text: JSON.parse(window.render_game_to_text()) });
        window.u06Reflect = () => {
            window.u06Setup('rat'); g.player.loc = { x: 4, y: 8 }; g.player.hp = 1;
            const caster = window.u06Caster; caster.loc = { x: 8, y: 8 }; caster.hp = 1;
            const guardian = new Monster(12, 8, md.default.find(m => m.id === 'stone_guardian')); g.monsters.push(guardian);
            const r = g.castMonsterBolt(caster, guardian, 'SPARK'); g.finishTurnEpilogue();
            g.updateVision(); g.needsRender = true; g.update();
            return { hits: r.hits.map(h => h.creature.name), path: r.path, guardianHP: guardian.hp };
        };
    });
    const shot = async name => {
        await page.waitForTimeout(350); const state = await page.evaluate(() => window.u06Read());
        states.push({ name, state }); await page.screenshot({ path: `${dir}/browser-${name}.png` }); return state;
    };
    await page.evaluate(() => window.u06Setup('spark_turret'));
    // Real input -> player action -> monster AI -> fixed-magnitude spell.
    for (let n = 0; n < 12; n++) {
        await page.keyboard.press('.'); await page.waitForTimeout(80);
        if ((await page.evaluate(() => window.u06Read())).hp < 100) break;
    }
    const spark = await shot('spark-turn');
    assert(spark.hp >= 94 && spark.hp <= 98); assert(spark.turns > 0); assert.equal(spark.source, spark.caster.name);
    await page.evaluate(() => {
        window.u06Setup('flame_turret'); const g = window.activeGame; g.player.applyShield(500);
        g.castMonsterBolt(window.u06Caster, g.player, 'FIRE'); g.needsRender = true; g.update();
    });
    const shield = await shot('fire-shield');
    assert.equal(shield.hp, 100); assert(shield.shield >= 360 && shield.shield <= 460); assert.equal(shield.burning, 7);
    await page.evaluate(() => {
        window.u06Setup('dragon'); const g = window.activeGame; g.player.setStatusDuration('immune_fire', 20);
        g.castMonsterBolt(window.u06Caster, g.player, 'DRAGONFIRE'); g.needsRender = true; g.update();
    });
    const immune = await shot('dragon-immunity'); assert.equal(immune.hp, 100); assert.equal(immune.burning, 0);
    assert(immune.messages.some(s => s.includes('毫发无伤')));
    const reflection = await page.evaluate(() => window.u06Reflect());
    const death = await shot('reflected-death');
    assert.equal(death.hp, 0); assert.equal(death.caster.hp, 0); assert(death.over);
    assert.equal(death.source, death.caster.name); assert(death.reason.includes(death.caster.name));
    assert.equal(reflection.hits.length, 2); states.push({ reflection });
    assert.deepEqual(errors, []);
} finally {
    fs.writeFileSync(`${dir}/browser.json`, JSON.stringify({ states, errors }, null, 2) + '\n');
    await browser.close();
}
