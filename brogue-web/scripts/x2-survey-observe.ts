// In-memory fixtures only. No production replacement, spy, transform or baseline capture.
// Imports are resolved relative to the verified temporary project by the runner.
import { createHeadlessGame } from './src/test/harness.ts';
import { Monster, MonsterState } from './src/entities/Monster.ts';
import { updateMonsterState, monsterFleesFrom } from './src/engine/Combat/MonsterAI.ts';
import { TerrainType as T } from './src/engine/Map/Grid.ts';
import { ItemLoader } from './src/engine/Items/ItemLoader.ts';
import { generateItemDetail } from './src/engine/UI/DetailGenerator.ts';
import { damageFraction, netEnchant } from './src/engine/Combat/CombatFormulas.ts';
import { rng } from './src/engine/Random.ts';
import monsters from './src/data/monsters.json';

const output: any = { scope: 'Unmodified current implementation; synthetic scenes do not establish natural occurrence rates.' };
function scene(game = createHeadlessGame(22013, 'test')): any {
    const g: any = game;
    g.monsters = []; g.dormantMonsters = []; g.items = [];
    for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
        g.grid.setTerrain(x, y, !x || !y || x === g.grid.width - 1 || y === g.grid.height - 1 ? T.WALL : T.FLOOR);
    }
    g.player.loc = { x: 10, y: 10 };
    g.updateVision();
    return g;
}
function mob(g: any, id: string, x: number, y: number) {
    const m = new Monster(x, y, monsters.find(row => row.id === id)! as any);
    m.state = MonsterState.HUNTING;
    g.monsters.push(m);
    return m;
}
{
    const g = scene();
    const rat = mob(g, 'rat', 12, 10), revenant = mob(g, 'revenant', 13, 10);
    revenant.isAlly = true;
    g.updateVision();
    revenant.takeDamage(revenant.hp, true, g.grid);
    const corpse = { hp: revenant.hp, processed: revenant.deathProcessed, listed: g.monsters.includes(revenant), occupies: !!g.getMonsterAt(13, 10) };
    const feared = monsterFleesFrom(rat, revenant);
    updateMonsterState(g, rat, 10);
    const beforeSweep = rat.state;
    g.removeDeadMonsters();
    rat.state = MonsterState.HUNTING;
    updateMonsterState(g, rat, 10);
    output.corpseFear = { corpse, feared, beforeSweep, afterSweep: rat.state };
}
{
    // Exercise the real wait -> time loop -> takeTurn path, with and without an
    // explicit original cleanup before the command. This is a fixture control.
    output.corpseFearTurn = [false, true].map(sweep => {
        const g = scene();
        const rat = mob(g, 'rat', 12, 10), revenant = mob(g, 'revenant', 13, 10);
        revenant.isAlly = true; rat.ticksUntilTurn = 0;
        g.updateVision(); revenant.takeDamage(revenant.hp, true, g.grid);
        if (sweep) g.removeDeadMonsters();
        g.executeCommand('wait');
        return { sweep, rat: { loc: rat.loc, state: rat.state, hp: rat.hp }, corpseListed: g.monsters.includes(revenant), rng: rng.getState() };
    });
}
function lightFixture(game?: any) {
    const g = scene(game);
    g.player.setStatusDuration('darkness', 100); g.player.maxStatus.darkness = 100;
    const rat = mob(g, 'rat', 14, 10); rat.ticksUntilTurn = 100000;
    const potion = ItemLoader.spawnPotion('potion_of_strength', -1, -1)!;
    const wand = ItemLoader.spawnWand('wand_of_slowness', -1, -1)!;
    wand.identified = true; wand.charges = 10;
    g.player.inventory.addItem(potion); g.player.inventory.addItem(wand);
    g.updateVision();
    return { g, rat, potion, wand };
}
{
    const { g, rat, potion, wand } = lightFixture();
    g.executeItemCommand('quaff', potion);
    g.tickFlareAnimation(10);
    const flashed = g.grid.getCell(rat.x, rat.y).isVisible;
    g.executeItemCommand('use', wand);
    const recordedTarget = { ...g.pendingArcana.cursor };
    g.executeCommand('confirm_target');
    const record = g.exportRecording();
    const run = (render: boolean) => {
        g.loadReplay(record); const f = lightFixture(g);
        g.replayStep();
        if (render) g.tickFlareAnimation(10);
        const visibleBeforeItem = g.grid.getCell(f.rat.x, f.rat.y).isVisible;
        g.replayStep();
        const target = g.pendingArcana && { ...g.pendingArcana.cursor };
        g.replayStep();
        return { render, visibleBeforeItem, target, cursor: g.replayCursor, error: g.replayError, charges: f.wand.charges, slowed: f.rat.getStatusDuration('slowed') };
    };
    output.flareItemReplay = { flashed, recordedTarget, events: record.events.map((e: any) => ({ action: e.action, data: e.data, tick: e.tick, turn: e.turn })), replay: [run(false), run(true)] };
}
{
    const g = scene();
    const item = ItemLoader.spawnWeapon('dagger', -1, -1)!;
    item.enchantment = 12; item.strengthRequired = 0; item.identified = true;
    output.zeroStrengthDetail = { strength: g.player.effectiveStrength, requirement: item.strengthRequired,
        combatNetEnchant: netEnchant(item.enchantment, g.player.effectiveStrength, item.strengthRequired),
        detailNetEnchant: netEnchant(item.enchantment, g.player.effectiveStrength, item.strengthRequired || 12),
        combatFraction: damageFraction(netEnchant(item.enchantment, g.player.effectiveStrength, item.strengthRequired)),
        lines: generateItemDetail(item, g.player.effectiveStrength).sections.flatMap(s => s.lines.map(l => l.text)) };
}
export default output;
