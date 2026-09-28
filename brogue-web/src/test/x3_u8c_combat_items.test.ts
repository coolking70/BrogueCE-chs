import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import zh from '../locales/zh_CN.json';
import { ATTACK_VERBS, attackVerb } from '../engine/Combat/AttackVerbs';
import { formatCombatText, type CombatTextEvent } from '../engine/Combat/CombatText';
import { MONSTER_CLASS_MEMBERS, monsterIsInClass } from '../engine/Combat/MonsterClass';
import { CombatSystem } from '../engine/Combat/Combat';
import { Logger, logger, foldCombatMessages } from '../engine/Systems/Logger';
import { displaySettings, loadDisplaySettings } from '../engine/Settings';
import { createHeadlessGame } from './harness';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { Item, ItemCategory as C } from '../engine/Items/Item';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import data from '../data/monsters.json';
import { TerrainType as T } from '../engine/Map/Grid';
import { rng } from '../engine/Random';

const en = { translate: (_key: string, english: string) => english };
const event: CombatTextEvent = { attacker: { player: false, visible: true, name: 'rat', typeId: 'rat' },
    defender: { player: true, visible: true, name: '', typeId: 'player' },
    damage: 2, hit: true, lethal: false, percentile: 99 };
const alias = (id: string) => ({ you: 'player', goblin_chieftan: 'goblin_warlord', acid_jelly: 'acidic_jelly', will_o_the_wisp: 'wisp' }[id] ?? id);
afterEach(() => { displaySettings.showDamageNumbers = false; logger.presentAcknowledgments(null); vi.restoreAllMocks(); });
function scene() {
    const g = createHeadlessGame(33083, 'test');
    g.monsters = []; g.dormantMonsters = []; g.items = [];
    g.player.loc = { x: 10, y: 10 }; g.player.hp = g.player.maxHp = 100;
    g.player.inventory.items = []; g.player.equippedWeapon = null; g.player.equippedArmor = null;
    for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
        g.grid.setTerrain(x, y, x >= 4 && x <= 30 && y >= 4 && y <= 20 ? T.FLOOR : T.GRANITE);
        Object.assign(g.grid.getCell(x, y)!, { isVisible: true, isExplored: true, isClairvoyantVisible: false });
    }
    logger.reset(); g.disturbed = false;
    return g;
}
function monster(g: ReturnType<typeof scene>, id = 'rat', x = 11, y = 10) {
    const m = new Monster(x, y, (data as MonsterData[]).find(m => m.id === id)!);
    m.state = MonsterState.HUNTING; g.monsters.push(m); return m;
}
function weapon(g: ReturnType<typeof scene>) {
    const w = ItemLoader.spawnWeapon('sword', -1, -1)!;
    g.player.inventory.addItem(w); g.player.equippedWeapon = w; return w;
}

describe('X3-U8c CE catalog and pure combat text', () => {
    it('all 68 attack tables and all 15 overlapping classes match the local CE source', () => {
        const globals = readFileSync('../BrogueCE-master/src/brogue/Globals.c', 'utf8');
        const header = readFileSync('../BrogueCE-master/src/brogue/Rogue.h', 'utf8');
        const ids = header.slice(header.indexOf('    MK_YOU,'), header.indexOf('    NUMBER_MONSTER_KINDS')).match(/MK_\w+/g)!;
        const words = globals.slice(globals.indexOf('const monsterWords monsterText'), globals.indexOf('// ITEMS'));
        const rows = [...words.matchAll(/^\s*\{"[^\n]*",\s*\n\s*"[^\n]*",\s*"[^\n]*",\s*\n\s*\{([^\n]*)/gm)];
        expect(rows).toHaveLength(68);
        expect(Object.keys(ATTACK_VERBS)).toHaveLength(68);
        rows.forEach((row, n) => expect(ATTACK_VERBS[alias(ids[n]!.slice(3).toLowerCase())]).toEqual([...row[1]!.matchAll(/"([^"]+)"/g)].map(m => m[1])));
        const classes = globals.slice(globals.indexOf('const monsterClass monsterClassCatalog'), globals.indexOf('// ITEMS'));
        const classRows = [...classes.matchAll(/\{"(\w+)",\s+\d+,\s+-?\d+,\s+\{([^}]+)}/g)];
        expect(classRows).toHaveLength(15);
        for (const row of classRows) expect(MONSTER_CLASS_MEMBERS[row[1]!]).toEqual(row[2]!.match(/MK_\w+/g)!.map(id => alias(id.slice(3).toLowerCase())));
        expect(monsterIsInClass('phantom', 'infernal')).toBe(true);
        expect(monsterIsInClass('phantom', 'undead')).toBe(true);
        expect(monsterIsInClass('rat', 'dragon')).toBe(false);
    });
    it('CE integer thresholds clamp 2/3/4/5 verb grades, fists and concealed/hallucinated attackers', () => {
        expect([0, 49, 50, 100].map(n => attackVerb('rat', n))).toEqual(['scratches', 'scratches', 'bites', 'bites']);
        expect([0, 32, 33, 65, 66, 99].map(n => attackVerb('jackal', n))).toEqual(['claws', 'claws', 'bites', 'bites', 'mauls', 'mauls']);
        expect([0, 25, 50, 75, 100].map(n => attackVerb('goblin_warlord', n))).toEqual(['slashes', 'cuts', 'stabs', 'skewers', 'skewers']);
        expect([0, 20, 40, 60, 80].map(n => attackVerb('troll', n))).toEqual(['cudgels', 'clubs', 'bludgeons', 'pummels', 'batters']);
        expect(attackVerb('player', 99, true)).toBe('punch');
        expect(attackVerb('dragon', 99, false, true)).toBe('hits');
        expect(formatCombatText({ ...event, hallucinating: true }, en)).toBe('the rat hits you');
    });
    it('every grade has a Chinese translation; no numbers/weapon names by default, optional suffix only', () => {
        for (const verb of [...Object.values(ATTACK_VERBS).flat(), 'punch']) expect(zh[`combat.ce.verb.${verb}` as keyof typeof zh]).toMatch(/[\u4e00-\u9fff]/);
        expect(formatCombatText(event, en)).toBe('the rat bites you');
        expect(formatCombatText(event, { ...en, showDamage: true })).toBe('the rat bites you (2 damage)');
        const translate = (key: string, english: string) => (zh as Record<string, string>)['combat.ce.' + key] ?? english;
        expect(formatCombatText(event, { translate, showDamage: true })).toBe('rat咬伤你（2 点伤害）');
        expect(formatCombatText({ ...event, damage: 0, circumstance: 'zero' }, en)).toContain('but does no damage');
        expect(formatCombatText({ ...event, lethal: true }, en)).toBe('the rat defeated you');
        expect(formatCombatText({ ...event, lethal: true, circumstance: 'lunge' }, en)).toContain('dispatched you with a vicious lunge attack');
    });
    it('unseen combat conceals both names and optional damage, including death/destruction', () => {
        const unseen = { ...event, attacker: { ...event.attacker, visible: false }, defender: { ...event.defender, visible: false, player: false } };
        expect(formatCombatText(unseen, { ...en, showDamage: true })).toBe('you hear combat in the distance');
        expect(formatCombatText({ ...unseen, lethal: true }, en)).toBe('you hear something die in combat');
        expect(formatCombatText({ ...unseen, lethal: true, defender: { ...unseen.defender, inanimate: true } }, en)).toBe('you hear something get destroyed in combat');
    });
    it('keeps English text usable before the translation service initializes', () => {
        const pending = { translate: () => undefined, showDamage: true };
        expect(formatCombatText(event, pending)).toBe('the rat bites you (2 damage)');
        expect(formatCombatText({ ...event, hit: false }, pending)).toBe('the rat misses you');
    });
});

describe('X3-U8c combat archive and real attack paths', () => {
    it('buffers in attack order, flushes before normal messages and folds only display copies', () => {
        const log = new Logger(); log.combat('one'); log.combat('two'); expect(log.messages).toEqual([]);
        log.log('normal'); expect(log.messages.map(m => m.text)).toEqual(['one', 'two', 'normal']);
        expect(foldCombatMessages(log.messages).map(m => m.text)).toEqual(['one; two', 'normal']);
        expect(log.messages.map(m => m.text)).toEqual(['one', 'two', 'normal']);
        log.combat('pending'); log.reset(); log.flushCombat(); expect(log.messages).toEqual([]);
    });
    it('startFighting suppresses nonlethal hits/misses, still reports lethal hits; distant sound once per turn', () => {
        const g = scene(), rat = monster(g); logger.blockCombatText = true;
        g.reportAttack(rat, g.player, { damage: 2, hit: true, backstab: false }); logger.flushCombat(); expect(logger.messages).toEqual([]);
        g.player.hp = 0; g.reportAttack(rat, g.player, { damage: 2, hit: true, backstab: false }); logger.flushCombat(); expect(logger.messages[0]!.text).toContain('defeated');
        logger.reset(); const other = monster(g, 'kobold', 12, 10);
        g.grid.getCell(rat.x, rat.y)!.isVisible = false; g.grid.getCell(other.x, other.y)!.isVisible = false;
        for (let n = 0; n < 3; n++) g.reportAttack(rat, other, { damage: 1, hit: true, backstab: false });
        logger.endCombatTurn(); expect(logger.messages).toHaveLength(1); expect(logger.messages[0]!.count).toBe(1);
        g.reportAttack(rat, other, { damage: 0, hit: false, backstab: false }); logger.endCombatTurn(); expect(logger.messages[0]!.count).toBe(2);
    });
    it('weapon damage range and all circumstances are captured before waking the target, without text RNG', () => {
        const g = scene(), w = weapon(g), rat = monster(g); w.damage = '4-8'; w.enchantment = 0; w.strengthRequired = 0;
        rat.hp = rat.maxHp = 1000; rat.state = MonsterState.ASLEEP;
        const result = CombatSystem.attack(g.player, rat, { grid: g.grid });
        expect(result.text?.circumstance).toBe('asleep'); expect(result.backstab).toBe(true);
        const random = rng.getState(); g.reportAttack(g.player, rat, result); logger.flushCombat(); expect(rng.getState()).toEqual(random);
        expect(logger.messages[0]!.text).toContain('in its sleep'); expect(logger.messages[0]!.text).not.toMatch(/damage|Sword/);
    });
    it('real move/turn flushes melee text and the display setting leaves all non-log snapshot fields/RNG identical', () => {
        const g = scene(), rat = monster(g); weapon(g); rat.hp = rat.maxHp = 500; rat.ticksUntilTurn = 10000;
        const before = g.toSnapshot();
        const run = (show: boolean) => { g.loadSnapshot(before); displaySettings.showDamageNumbers = show;
            g.executeCommand('move', { x: 1, y: 0 });
            const snapshot = g.toSnapshot(); snapshot.savedAt = 0;
            const messages = snapshot.run.logger; delete (snapshot.run as any).logger;
            return { snapshot, messages, random: rng.getState() }; };
        const off = run(false), on = run(true);
        expect(off.snapshot).toEqual(on.snapshot); expect(off.random).toEqual(on.random);
        expect(off.messages.messages.some(m => /damage\)/.test(m.text))).toBe(false);
        expect(on.messages.messages.some(m => /damage\)/.test(m.text))).toBe(true);
        expect(JSON.stringify(on.snapshot)).not.toContain('showDamageNumbers');
        expect(loadDisplaySettings().showDamageNumbers).toBe(false);
    });
});

describe('X3-U8c runic sightings and per-item names', () => {
    it('requires direct sight (not telepathy, clairvoyance, invisibility, dormancy or submerged location)', () => {
        for (const hidden of ['telepathy', 'clairvoyance', 'invisible', 'dormant', 'submerged']) {
            const g = scene(), w = weapon(g), rat = monster(g); w.runicType = 'slaying'; w.vorpalEnemy = 'animal'; w.runicKnown = false;
            if (hidden === 'telepathy') { g.player.setStatusDuration('telepathy', 20); g.grid.getCell(rat.x, rat.y)!.isVisible = false; }
            if (hidden === 'clairvoyance') g.grid.getCell(rat.x, rat.y)!.isClairvoyantVisible = true;
            if (hidden === 'invisible') rat.setStatusDuration('invisible', 20);
            if (hidden === 'dormant') rat.isDormant = true;
            if (hidden === 'submerged') { rat.submerged = true; g.grid.setTerrain(rat.x, rat.y, T.WATER_DEEP); }
            (g as any).refreshVisibleEntities(); expect(w.flags).not.toContain('ITEM_RUNIC_HINTED');
        }
    });
    it('hints each matching equipped item once, acknowledges, persists without revealing the rune or drawing RNG', () => {
        const g = scene(), w = weapon(g); monster(g); w.runicType = 'slaying'; w.vorpalEnemy = 'animal'; w.runicKnown = false; w.identified = false;
        const armor = ItemLoader.spawnArmor('leather_armor', -1, -1)!;
        armor.runicType = 'immunity'; armor.vorpalEnemy = 'animal'; armor.runicKnown = false;
        g.player.inventory.addItem(armor); g.player.equippedArmor = armor;
        const random = rng.getState(); (g as any).refreshVisibleEntities();
        expect(rng.getState()).toEqual(random); expect(logger.messages.filter(m => m.acknowledge)).toHaveLength(2);
        expect(w.flags).toContain('ITEM_RUNIC_HINTED'); expect(armor.flags).toContain('ITEM_RUNIC_HINTED'); expect(w.runicKnown).toBe(false);
        expect(w.displayName).toContain('unknown runic');
        (g as any).refreshVisibleEntities(); expect(logger.messages).toHaveLength(2);
        const saved = g.toSnapshot(); g.loadSnapshot(saved); (g as any).refreshVisibleEntities(); expect(logger.messages).toHaveLength(2);
    });
    it('call dispatch distinguishes a whole unidentified kind from one inscribed instance', () => {
        const g = scene(), a = ItemLoader.spawnWand('wand_of_slowness', -1, -1)!, b = ItemLoader.spawnWand('wand_of_slowness', -1, -1)!;
        g.player.inventory.addItem(a); g.player.inventory.addItem(b);
        expect(g.itemCallMode(a)).toBe('choice'); expect(g.callItem(a, 'shared')).toBe(true);
        expect(a.displayName).toContain('shared'); expect(b.displayName).toContain('shared');
        expect(g.inscribeItem(a, 'personal')).toBe(true); expect(a.displayName).toContain('"personal"'); expect(b.displayName).not.toContain('personal');
        ItemLoader.identifyItemKind(a); expect(g.itemCallMode(a)).toBe('inscribe'); expect(a.displayName).toContain('personal');
        expect(g.itemCallMode(new Item('food', ':', 0, C.FOOD))).toBeNull();
    });
    it('inscription/relabel are zero-turn/zero-RNG, swap occupied letters, validate labels and survive reload', () => {
        const g = scene(), a = weapon(g), b = ItemLoader.spawnArmor('leather_armor', -1, -1)!; g.player.inventory.addItem(b);
        const random = rng.getState(), turn = g.absoluteTurnNumber, old = a.inventoryLetter;
        g.executeItemCommand('inscribe', a, '名字|特殊字符'); g.executeItemCommand('relabel', a, b.inventoryLetter!.toUpperCase());
        expect(b.inventoryLetter).toBe(old); expect(a.inventoryLetter).not.toBe(old);
        expect(g.relabelItem(a, '!')).toBe(false); expect(g.relabelItem(a, 'ab')).toBe(false);
        expect(g.absoluteTurnNumber).toBe(turn); expect(rng.getState()).toEqual(random);
        const saved = g.toSnapshot(); g.loadSnapshot(saved); expect(g.player.equippedWeapon?.inscription).toBe('名字|特殊字符');
        expect(g.player.equippedWeapon?.inventoryLetter).toBe(a.inventoryLetter);
        g.inscribeItem(g.player.equippedWeapon!, '\n' + '字'.repeat(40)); expect(g.player.equippedWeapon!.inscription).toBe('字'.repeat(29));
        g.inscribeItem(g.player.equippedWeapon!, ''); expect(g.player.equippedWeapon!.displayName).not.toContain('"');
    });
    it('new-game inscription and relabel recordings replay and seek with zero OOS', () => {
        const g = createHeadlessGame(33083), a = g.player.equippedWeapon!, b = g.player.inventory.items.find(i => i !== a)!;
        g.executeItemCommand('inscribe', a, 'remember me'); g.executeItemCommand('relabel', a, b.inventoryLetter);
        const recording = g.exportRecording(), expected = g.player.inventory.items.map(i => [i.id, i.inventoryLetter, i.inscription]);
        expect(g.loadReplay(recording)).toBe(true); g.replaySeek(recording.events.length);
        expect(g.replayError).toBeNull(); expect(g.player.inventory.items.map(i => [i.id, i.inventoryLetter, i.inscription])).toEqual(expected);
        g.replaySeek(0); g.replaySeek(recording.events.length); expect(g.replayError).toBeNull();
    });
});
