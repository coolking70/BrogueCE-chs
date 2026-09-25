import fs from 'node:fs';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../engine/Core/Game';
import { Grid, TerrainType as T, DCOLS, DROWS } from '../engine/Map/Grid';
import { EnvironmentManager } from '../engine/Environment/Gas';
import { FOVSys } from '../engine/Lighting/FOV';
import { LightMap } from '../engine/Lighting/LightMap';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { WAND_INITIAL_RANGES } from '../engine/Items/ArcanaInstance';
import { enchantArcana } from '../engine/Items/ArcanaEnchantment';
import { ItemCategory } from '../engine/Items/Item';
import { getBoltForItem, BOLT_EFFECT_CE_EFFECT } from '../engine/Combat/Bolt';
import { CEBoltType, CE_BOLT_CATALOG } from '../engine/Combat/BoltCatalog';
import { rng } from '../engine/Random';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import arcana from '../data/arcana.json';
import { createHeadlessGame } from './harness';
const ids = 'teleportation slowness polymorphism negation domination beckoning plenty invisibility empowerment'.split(' ').map(s => 'wand_of_' + s);
const added = ['wand_of_polymorphism', 'wand_of_negation', 'wand_of_domination', 'wand_of_plenty'];
const oldIds = ['wand_of_fire', 'wand_of_lightning', 'wand_of_teleportation', 'wand_of_slowness', 'wand_of_invisibility', 'wand_of_empowerment', 'wand_of_beckoning'];
const weights = [3, 3, 3, 3, 1, 3, 2, 3, 1];
const ranges = [[3,5], [2,5], [3,5], [4,6], [1,2], [2,4], [1,2], [3,5], [1,1]];
beforeEach(() => { if (!i18next.isInitialized) i18next.init({ lng: 'en', resources: {}, initImmediate: false }); rng.seedRandomGenerator(2424); rng.resetCounters(); ItemLoader.initConsumables(); });
afterEach(() => vi.restoreAllMocks());
function scene(id = 'rat') {
    const g = createHeadlessGame(2424, 'test');
    g.grid = new Grid(DCOLS, DROWS);
    for (let x = 0; x < DCOLS; x++) for (let y = 0; y < DROWS; y++) {
        g.grid.setTerrain(x,y, x > 0 && x < DCOLS - 1 && y > 0 && y < DROWS - 1 ? T.FLOOR : T.WALL);
        Object.assign(g.grid.getCell(x,y)!, { isVisible: true, hasMemory: true, isDiscovered: true });
    }
    g.player.loc = { x: 4, y: 5 }; g.player.hp = g.player.maxHp = 100;
    g.monsters = []; g.items = []; g.dormantMonsters = []; g.player.inventory.items = [];
    g.player.equippedWeapon = g.player.equippedArmor = g.player.ringLeft = g.player.ringRight = null;
    g.environment = new EnvironmentManager(g.grid); g.fov = new FOVSys(g.grid); g.lightMap = new LightMap(g.grid);
    const m = new Monster(9, 5, (monsters as MonsterData[]).find(d => d.id === id)!);
    m.state = MonsterState.HUNTING; m.ticksUntilTurn = 100000; g.monsters.push(m);
    return { g, m };
}

describe('W-24 CE nine-row catalog and ordinary entry', () => {
    it('parses the actual CE rows: order, frequency, market value, charge range, polarity, power and flavor slots', () => {
        const ce = fs.readFileSync('../BrogueCE-master/src/variants/GlobalsBrogue.c', 'utf8');
        const body = ce.split('itemTable wandTable_Brogue[] = {')[1]!.split('\n};')[0]!;
        const rows = [...body.matchAll(/\{"([^"]+)",\s*itemMetals\[(\d+)\], "",\s*(\d+),\s*(\d+),\s*0,\s*BOLT_(\w+),\s*\{(\d+),(\d+),(\d+)\}, false, false, (-?1),/g)];
        expect(rows).toHaveLength(9);
        expect(ItemLoader.genWands.map(w => w.id)).toEqual(ids);
        expect(ItemLoader.wands.map(w => w.id)).toEqual([...ids, 'wand_of_fire', 'wand_of_lightning']);
        expect(ItemLoader.genWands.map(w => w.frequency)).toEqual(weights);
        expect(weights.reduce((a,b) => a+b, 0)).toBe(22);
        rows.forEach((r, i) => {
            const id = 'wand_of_' + r[1], cfg = ItemLoader.genWands[i]!;
            expect(cfg.id).toBe(id); expect(Number(r[2])).toBe(i);
            expect([cfg.frequency, cfg.marketValue]).toEqual([Number(r[3]), Number(r[4])]);
            expect(WAND_INITIAL_RANGES[id]).toEqual(r.slice(6,9).map(Number));
            expect(ItemLoader.kindPolarity(id)).toBe(Number(r[9]));
            const bolt = getBoltForItem(id)!;
            expect(bolt.ceType).toBe(CEBoltType[r[5] as keyof typeof CEBoltType]);
            expect(BOLT_EFFECT_CE_EFFECT[bolt.effect]).toBe(CE_BOLT_CATALOG[bolt.ceType!].effect);
        });
        expect(arcana.staffs).toHaveLength(13);
        expect(ItemLoader.genStaffs.reduce((s,w) => s + w.frequency!, 0)).toBe(110);
        for (const id of ['wand_of_fire','wand_of_lightning']) {
            expect(ItemLoader.wands.find(w => w.id === id)!.excludeFromGeneration).toBe(true);
            expect(ItemLoader.spawnWand(id,0,0)).not.toBeNull();
        }
    });
    it('all 22 tickets follow the CE intervals through the actual Game kind selection', () => {
        const g: any = Object.create(Game.prototype), draw = vi.spyOn(rng, 'randRange');
        const expected = ids.flatMap((id,i) => Array(weights[i]).fill(id));
        for (let ticket = 1; ticket <= 22; ticket++) {
            draw.mockReturnValueOnce(ticket);
            expect(g.chooseKindFromPool(ItemLoader.genWands.map(w => w.id), ItemLoader.genWands.map(w => w.frequency), new Map())).toBe(expected[ticket-1]);
        }
        expect(draw.mock.calls).toEqual(Array.from({length:22}, () => [1,22]));
    });
    it('64 seeds × 1000 real kind+instance draws: all nine kinds, weighted frequencies, uniform charges, exact RNG calls', () => {
        const g: any = Object.create(Game.prototype), counts = ids.map(() => 0), charges = ids.map(() => ({} as Record<number, number>));
        let calls = 0;
        for (let seed = 1; seed <= 64; seed++) {
            rng.seedRandomGenerator(seed * 7919); rng.resetCounters();
            for (let n = 0; n < 1000; n++) {
                const before = rng.randomNumbersGenerated;
                const id = g.chooseKindFromPool(ItemLoader.genWands.map(w => w.id), ItemLoader.genWands.map(w => w.frequency), new Map());
                const item = g.spawnKindById(ItemCategory.WAND, id, {x:3,y:4}, 1), i = ids.indexOf(id);
                expect(i).toBeGreaterThanOrEqual(0); counts[i]!++;
                charges[i]![item.charges] = (charges[i]![item.charges] ?? 0) + 1;
                expect(item.charges).toBe(item.maxCharges); expect(item.arcanaInstanceVersion).toBe(1);
                expect(rng.randomNumbersGenerated-before).toBe(id === 'wand_of_empowerment' ? 1 : 2);
            }
            calls += rng.randomNumbersGenerated;
        }
        ids.forEach((id, i) => {
            const p = weights[i]!/22, expected = 64000*p;
            expect(Math.abs(counts[i]!-expected), id).toBeLessThan(6*Math.sqrt(64000*p*(1-p)));
            const [lo,hi] = ranges[i]!, options = hi! - lo! + 1;
            expect(Object.keys(charges[i]!).map(Number).sort((a,b)=>a-b)).toEqual(Array.from({length:options}, (_,j) => lo!+j));
            for (const c of Object.values(charges[i]!)) expect(Math.abs(c-counts[i]!/options), id).toBeLessThanOrEqual(Math.max(1,6*Math.sqrt(counts[i]!/options*(1-1/options))));
        });
        expect(calls).toBe(128000-counts[8]!);
        if (process.env.W24_EVIDENCE) fs.writeFileSync('ai_docs/reports/w-24-evidence/distribution.json', JSON.stringify({ seeds:64, samples:64000, calls, kinds:ids.map((id,i)=>({id,weight:weights[i],count:counts[i],charges:charges[i]})) }, null, 2)+'\n');
    });
    it.each(ids)('%s: unknown flavor, polarity detection, discovery suffix and full identification', id => {
        const wand = ItemLoader.spawnWand(id,-1,-1)!;
        expect(wand.displayName).not.toContain(wand.name);
        expect(ItemLoader.arcanaFlavorMap.get(id)).toBeTruthy();
        const polarity = ids.indexOf(id) >= 6 ? -1 : 1;
        expect(ItemLoader.itemMagicPolarity(wand)).toBe(polarity);
        expect(ItemLoader.magicCharDiscoverySuffix(wand)).toBe(polarity);
        ItemLoader.detectMagicOnItem(wand);
        expect(ItemLoader.isPolarityRevealed(id)).toBe(true);
        expect(ItemLoader.identifiedItems.has(id)).toBe(false);
        ItemLoader.identifyInstance(wand);
        expect(wand.displayName).toContain(wand.name); expect(wand.identified).toBe(true);
        wand.charges = 0;
        expect(ItemLoader.itemMagicPolarity(wand)).toBe(0);
        expect(ItemLoader.magicCharDiscoverySuffix(wand)).toBe(polarity);
    });
    it.each(added)('%s: normal use/cancel/confirm runs the existing effect with no substitute config', id => {
        const {g,m} = scene(id === 'wand_of_negation' ? 'dar_priestess' : 'rat');
        if (id === 'wand_of_domination') m.hp = 1;
        if (id === 'wand_of_plenty') { m.isAlly = true; m.hp = 5; }
        const wand = ItemLoader.spawnWand(id,-1,-1)!, before = wand.charges!, turns = g.stats.turns, oldType = m.typeId;
        g.player.inventory.addItem(wand); const calls = rng.randomNumbersGenerated;
        g.useArcanaItem(wand); expect(g.pendingArcana?.item).toBe(wand); g.cancelArcanaSelection();
        expect([wand.charges,g.stats.turns,rng.randomNumbersGenerated]).toEqual([before,turns,calls]);
        g.useArcanaItem(wand); g.setArcanaTarget(m.x,m.y); const result = g.confirmArcanaTarget();
        expect(result).not.toBeNull(); expect(wand.charges).toBe(before-1); expect(wand.timesUsed).toBe(1); expect(g.stats.turns).toBe(turns+1);
        // CE Items.c:5256-5261: polymorph autoID depends on the NEW invisibility state, even under telepathy.
        expect(ItemLoader.identifiedItems.has(id)).toBe(id !== 'wand_of_polymorphism' || !m.hasStatus('invisible'));
        if (id === 'wand_of_polymorphism') { expect(m.typeId).not.toBe(oldType); expect(g.monsters).toContain(m); }
        if (id === 'wand_of_negation') { expect(m.bolts).toEqual([]); expect(m.wasNegated).toBe(true); }
        if (id === 'wand_of_domination') expect(m.isAlly && m.dominated).toBe(true);
        if (id === 'wand_of_plenty') { expect(g.monsters).toHaveLength(2); expect(g.monsters.map(v=>v.hp)).toEqual([3,3]); }
    });
    it('machine WAND/STAFF requests materialize CE identity/resources through U05', () => {
        const g:any=Object.create(Game.prototype);
        for(const id of ids){
            const before=rng.randomNumbersGenerated;
            const item=g.spawnBlueprintItem('WAND',id,3,4,1);
            const [lo,hi]=WAND_INITIAL_RANGES[id]!;
            expect(item).not.toBeNull();expect(item.identityId).toBe(id);expect(item.category).toBe(ItemCategory.WAND);
            expect(item.charges).toBeGreaterThanOrEqual(lo);expect(item.charges).toBeLessThanOrEqual(hi);
            expect(item.maxCharges).toBe(item.charges);
            expect(rng.randomNumbersGenerated-before).toBe(1+(lo===hi?0:1));
        }
        for(const category of ['WAND','STAFF']){
            const before=rng.randomNumbersGenerated;
            const item=g.spawnBlueprintItem(category,undefined,3,4,1);
            expect(item).not.toBeNull();expect(ItemCategory[item.category]).toBe(category);
            const pool=category==='WAND'?ItemLoader.genWands:ItemLoader.genStaffs;
            expect(pool.map(c=>c.id)).toContain(item.identityId);
            const range=WAND_INITIAL_RANGES[item.identityId];
            expect(rng.randomNumbersGenerated-before).toBe(category==='STAFF'?item.enchantment+1:2+(range![0]===range![1]?0:1));
        }
    });
    it('new kinds participate in both polarity elimination groups and enchant by their CE lower bound', () => {
        for (const last of added) {
            ItemLoader.identifiedItems.clear(); ItemLoader.magicPolarityRevealed.clear();
            const same = ids.filter(id => id !== last && ItemLoader.kindPolarity(id) === ItemLoader.kindPolarity(last));
            same.forEach(id => ItemLoader.identifiedItems.add(id));
            ItemLoader.tryIdentifyLastItemKindsAllPolarityCategories();
            expect(ItemLoader.identifiedItems.has(last)).toBe(false);
            ItemLoader.magicPolarityRevealed.add(last);
            ItemLoader.tryIdentifyLastItemKindsAllPolarityCategories();
            expect(ItemLoader.identifiedItems.has(last)).toBe(true);
            const wand = ItemLoader.spawnWand(last,-1,-1)!; wand.charges = 0;
            const before = JSON.stringify(rng);
            expect(enchantArcana(wand)).toBe(true); expect(wand.charges).toBe(WAND_INITIAL_RANGES[last]![0]);
            expect(JSON.stringify(rng)).toBe(before);
        }
    });
});

describe('W-24 snapshot appearance and identity persistence', () => {
    it('current mapping, identity sets, calls and depleted instances survive real load; legacy flavor saves are rejected', () => {
        const {g} = scene(), current = ItemLoader.wands;
        // 用户验收裁决/U03：保留当前完整外观往返，不再用旧七行目录重建缺失外观。
        const flavors = Object.fromEntries(ItemLoader.arcanaFlavorMap);
        const wand = ItemLoader.spawnWand('wand_of_slowness',-1,-1)!; wand.charges = 0;
        ItemLoader.identifiedItems.add('wand_of_teleportation'); ItemLoader.callKind('wand_of_slowness','legacy slow');
        ItemLoader.magicPolarityRevealed.add('wand_of_slowness'); g.player.inventory.addItem(wand);
        const saved = JSON.parse(JSON.stringify(g.toSnapshot()));
        const spawn = vi.spyOn(ItemLoader,'spawnWand'); const roll = vi.spyOn(rng,'randClumpedRange');
        expect(g.loadSnapshot(saved)).toBe(true); expect(spawn).not.toHaveBeenCalled(); expect(roll).not.toHaveBeenCalled();
        expect(Object.fromEntries(ItemLoader.arcanaFlavorMap)).toEqual(flavors);
        expect(new Set(current.map(w=>ItemLoader.arcanaFlavorMap.get(w.id))).size).toBe(11);
        for (const id of added) { expect(ItemLoader.identifiedItems.has(id)).toBe(false); expect(ItemLoader.arcanaFlavorMap.get(id)).toBeTruthy(); }
        expect(ItemLoader.identifiedItems.has('wand_of_teleportation')).toBe(true);
        expect(ItemLoader.callTitles.get('wand_of_slowness')).toBe('legacy slow'); expect(ItemLoader.isPolarityRevealed('wand_of_slowness')).toBe(true);
        expect(g.player.inventory.items[0]!.charges).toBe(0);
        expect(g.toSnapshot().wandFlavors).toEqual(saved.wandFlavors);
        expect(g.toSnapshot().flavors).toEqual(saved.flavors);
        const roundTrip = JSON.parse(JSON.stringify(g.toSnapshot())); expect(roundTrip.wandFlavors).toBeDefined();
        expect(g.loadSnapshot(roundTrip)).toBe(true); expect(g.toSnapshot().wandFlavors).toEqual(roundTrip.wandFlavors);

        // 旧档只有七行外观投影（或依赖种子重建），没有 U03 必需的完整 flavors 状态。
        const legacy = JSON.parse(JSON.stringify(saved)); delete legacy.flavors;
        legacy.wandFlavors = Object.fromEntries(oldIds.map(id=>[id, saved.wandFlavors[id]]));
        expect(g.loadSnapshot(legacy)).toBe(false);
        delete legacy.wandFlavors;
        expect(g.loadSnapshot(legacy)).toBe(false);
        expect(g.toSnapshot().flavors).toEqual(saved.flavors);
        expect(g.player.inventory.items[0]!.charges).toBe(0);
        expect(spawn).not.toHaveBeenCalled(); expect(roll).not.toHaveBeenCalled();
    });
    it('new save preserves all eleven flavors; partial maps fill new identities uniquely without RNG', () => {
        const {g} = scene(); const saved = JSON.parse(JSON.stringify(g.toSnapshot()));
        expect(g.loadSnapshot(saved)).toBe(true); expect(g.toSnapshot().wandFlavors).toEqual(saved.wandFlavors);
        const before = JSON.stringify(rng);
        const partial = {wand_of_plenty:saved.wandFlavors.wand_of_plenty}; ItemLoader.restoreWandFlavors(partial);
        expect(ItemLoader.arcanaFlavorMap.get('wand_of_plenty')).toBe(partial.wand_of_plenty);
        expect(new Set(ItemLoader.wands.map(w=>ItemLoader.arcanaFlavorMap.get(w.id))).size).toBe(11);
        expect(JSON.stringify(rng)).toBe(before);
    });
});
