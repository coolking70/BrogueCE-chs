import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    CEBoltType as T, CEBoltEffect as E, CEBoltFlags as F,
    CE_BOLT_CATALOG as catalog, CE_ITEM_BOLT_TYPES, resolveCEBoltMagnitude,
} from './BoltCatalog';
import { BoltEffect, BOLT_EFFECT_CE_EFFECT, getBoltConfigs, getBoltForItem, MONSTER_BOLT_TABLE, KNOWN_GAP_MONSTER_BOLT_NAMES } from './Bolt';
import { rng } from '../Random';

const ce = (file: string) => readFileSync(new URL(`../../../../BrogueCE-master/src/${file}`, import.meta.url), 'utf8');
const header = ce('brogue/Rogue.h');
const globals = ce('variants/GlobalsBrogue.c');
const enumBody = (name: string) => header.match(new RegExp(`enum ${name} \\{([\\s\\S]*?)\\};`))![1]!;
const members = (value: object) => Object.keys(value).filter(key => Number.isNaN(Number(key)));

describe('W-1 CE catalog contract (source rows, not execution coverage)', () => {
    it('all 30 types and 22 effects retain CE enum values; all 10 flag bits include the bit-5 gap', () => {
        for (const [name, prefix, actual, count] of [
            ['boltType', 'BOLT_', T, 30], ['boltEffects', 'BE_', E, 22],
        ] as const) {
            const names = [...enumBody(name).matchAll(new RegExp(`\\b${prefix}([A-Z_0-9]+)`, 'g'))].map(m => m[1]!);
            expect(names).toHaveLength(count);
            expect(members(actual)).toEqual(names);
            names.forEach((key, value) => expect((actual as Record<string, unknown>)[key]).toBe(value));
        }
        const flags = [...enumBody('boltFlags').matchAll(/BF_(\w+)\s*= Fl\((\d+)\)/g)];
        expect(flags).toHaveLength(10);
        expect(members(F)).toEqual(flags.map(m => m[1]));
        flags.forEach(m => expect(F[m[1] as keyof typeof F]).toBe(1 << Number(m[2])));
        expect(Object.values(F)).not.toContain(1 << 5);
    });

    it('every CE catalog row preserves all 12 fields, including forbidden flags, glyph/color symbols and DF references', () => {
        const body = globals.match(/const bolt boltCatalog_Brogue\[\] = \{([\s\S]*?)\n\};/)![1]!;
        const rows = body.split('\n').filter(line => /^\s*\{"/.test(line));
        expect(Object.keys(catalog)).toHaveLength(30);
        expect(rows).toHaveLength(29);
        expect(catalog[T.NONE]).toEqual({ type: T.NONE, name: '', description: '', abilityDescription: '',
            theChar: null, foreColor: null, backColor: null, effect: E.NONE, magnitude: 0,
            pathDF: null, targetDF: null, forbiddenMonsterFlags: [], flags: 0 });
        rows.forEach((row, index) => {
            // Tokenize quoted strings separately, so commas in prose are not columns.
            const columns = [...row.trim().slice(1, -2).matchAll(/\s*("[^"]*"|'[^']*'|[^,]+)\s*(?:,|$)/g)].map(m => m[1]!.trim());
            expect(columns, `CE row ${index + 61}`).toHaveLength(12);
            const [name, description, ability, glyph, fore, back, effect, magnitude, pathDF, targetDF, forbidden, flags] = columns as string[];
            const symbol = (s: string) => ['0', 'NULL'].includes(s) ? null : s.replace(/^&/, '').replace(/^'|'$/g, '');
            expect(catalog[(index + 1) as T], `GlobalsBrogue.c:${index + 61}`).toEqual({
                type: index + 1, name: JSON.parse(name!), description: JSON.parse(description!), abilityDescription: JSON.parse(ability!),
                theChar: symbol(glyph!), foreColor: symbol(fore!), backColor: symbol(back!),
                effect: E[effect!.slice(3) as keyof typeof E], magnitude: Number(magnitude),
                pathDF: symbol(pathDF!), targetDF: symbol(targetDF!), forbiddenMonsterFlags: forbidden!.match(/MONST_\w+/g) ?? [],
                flags: [...flags!.matchAll(/BF_(\w+)/g)].reduce((mask, m) => mask | F[m[1] as keyof typeof F], 0),
            });
        });
        expect(catalog[T.OBSTRUCTION].targetDF).toBeNull();
        expect(catalog[T.SPIDERWEB].effect).toBe(E.NONE);
        expect(catalog[T.ANCIENT_SPIRIT_VINES].effect).toBe(E.NONE);
        expect(catalog[T.DRAGONFIRE].pathDF).toBe('DF_OBSIDIAN');
    });

    it('21 CE item identities follow the actual staff/wand power columns; inventions get no CE item identity', () => {
        const aliases: Record<string, string> = {
            firebolt: 'fire', slowness: 'slowness', polymorphism: 'polymorphism', protection: 'protection',
        };
        const expected: Record<string, T> = {};
        for (const [prefix, source, declaration] of [
            ['staff', ce('brogue/Globals.c'), 'staffTable[NUMBER_STAFF_KINDS]'],
            ['wand', globals, 'wandTable_Brogue[]'],
        ]) {
            const body = source!.slice(source!.indexOf(declaration!)).split('};')[0]!;
            for (const line of body.split('\n')) {
                const row = line.match(/^\s*\{"([^"]+)".*?\bBOLT_(\w+)/);
                if (row) expected[`${prefix}_of_${aliases[row[1]!] ?? row[1]}`] = T[row[2] as keyof typeof T];
            }
        }
        expect(Object.keys(expected)).toHaveLength(21);
        expect(CE_ITEM_BOLT_TYPES).toEqual(expected);
        expect(CE_ITEM_BOLT_TYPES.staff_of_fire).toBe(T.FIRE);
        for (const id of ['wand_of_fire', 'wand_of_lightning', 'staff_of_light']) {
            expect(CE_ITEM_BOLT_TYPES[id]).toBeUndefined();
            expect(getBoltForItem(id)!.ceType).toBeNull();
        }
        for (const id of Object.keys(expected)) {
            const bolt = getBoltForItem(id);
            expect(bolt!.ceType).toBe(expected[id]);
        }
        expect(getBoltConfigs()).toHaveLength(24);
    });

    it('web dispatch aliases preserve ATTACK versus DAMAGE and append type-only POLYMORPH/PLENTY without renumbering', () => {
        const oldNames = 'NONE FIRE LIGHTNING POISON TELEPORT SLOW HEALING HASTE TUNNELING BECKONING DISCORD CONJURATION SHIELDING NEGATION DOMINATION ENTRANCEMENT BLINKING OBSTRUCTION EMPOWERMENT INVISIBILITY SPARK DRAGONFIRE DISTANCE_ATTACK POISON_DART'.split(' ');
        oldNames.forEach((name, index) => expect(BoltEffect[name as keyof typeof BoltEffect]).toBe(index));
        expect(BoltEffect.POLYMORPH).toBe(24);
        expect(BoltEffect.PLENTY).toBe(25);
        expect(Object.keys(BOLT_EFFECT_CE_EFFECT)).toHaveLength(26);
        for (const name of members(BoltEffect)) {
            const canonical = ['FIRE', 'LIGHTNING', 'SPARK', 'DRAGONFIRE'].includes(name) ? 'DAMAGE'
                : ['DISTANCE_ATTACK', 'POISON_DART'].includes(name) ? 'ATTACK' : name;
            expect(BOLT_EFFECT_CE_EFFECT[BoltEffect[name as keyof typeof BoltEffect]]).toBe(E[canonical as keyof typeof E]);
        }
        expect(MONSTER_BOLT_TABLE.SLOW_2!.effect).toBe(BoltEffect.SLOW);
        expect(catalog[T.SLOW_2].magnitude).toBe(2);
        expect(catalog[T.SLOW].magnitude).toBe(10);
    });

    it('CE magnitude records source and consumer units, never charges, computed damage or legacy defaults', () => {
        const before = rng.randomNumbersGenerated;
        for (const enchantment of [0, 2, 8]) {
            expect(resolveCEBoltMagnitude(T.FIRE, { kind: 'staff', enchantment })).toEqual({ source: 'staff', value: enchantment, use: 'staff-damage' });
        }
        expect(resolveCEBoltMagnitude(T.SLOW, { kind: 'wand' })).toEqual({ source: 'wand', value: 10, use: 'slow-duration' });
        expect(resolveCEBoltMagnitude(T.SLOW_2, { kind: 'monster' })).toEqual({ source: 'monster', value: 2, use: 'slow-duration' });
        expect(resolveCEBoltMagnitude(T.FIRE, { kind: 'catalog' })).toEqual({ source: 'catalog', value: 4, use: 'staff-damage' });
        expect(resolveCEBoltMagnitude(T.DISTANCE_ATTACK, { kind: 'monster' }).use).toBe('unused-by-effect');
        expect(resolveCEBoltMagnitude(T.SHIELDING, { kind: 'staff', enchantment: 2 }).use).toBe('shielding-tenths-hp');
        expect(getBoltConfigs().map(b => b.magnitude)).toEqual([0, 0, 10, 10, 10, 0, 10, 0, 0, 5, 8, 10, 6, 4, 2, 2, 2, 2, 2, 3, 8, 0, 2, 0]);
        expect(rng.randomNumbersGenerated).toBe(before);
    });

    it('the 15 native entries retain their projections, plus U09 learnable identities and CE forbidden exceptions', () => {
        expect(Object.keys(MONSTER_BOLT_TABLE)).toEqual('SHIELDING HASTE SPARK DISTANCE_ATTACK HEALING BLINKING NEGATION DISCORD POISON_DART FIRE DRAGONFIRE BECKONING SLOW_2 SPIDERWEB ANCIENT_SPIRIT_VINES TELEPORT SLOW POLYMORPH DOMINATION INVISIBILITY LIGHTNING POISON ENTRANCEMENT CONJURATION TUNNELING OBSTRUCTION'.split(' '));
        expect(Object.values(MONSTER_BOLT_TABLE).map(({ targetAllies, targetEnemies, fiery, magnitude }) => [targetAllies, targetEnemies, fiery, magnitude])).toEqual([
            [true,false,false,5], [true,false,false,2], [false,true,false,1], [false,true,false,1],
            [true,false,false,5], [false,false,false,5], [false,true,false,10], [false,true,false,10],
            [false,true,false,1], [false,true,true,4], [false,true,true,18], [false,true,false,10],
            [false,true,false,2], [false,true,false,10], [false,true,false,5],
            [false,true,false,10], [false,true,false,10], [false,true,false,10], [false,true,false,10],
            [true,false,false,10], [false,true,false,10], [false,true,false,10], [false,true,false,10],
            [false,true,false,10], [false,false,false,10], [false,false,false,10],
        ]);
        expect(KNOWN_GAP_MONSTER_BOLT_NAMES).toEqual([]);
        for (const name of ['SPIDERWEB', 'ANCIENT_SPIRIT_VINES']) expect(MONSTER_BOLT_TABLE[name]!.effect).toBe(BoltEffect.NONE);
        expect(MONSTER_BOLT_TABLE.POLYMORPH!.effect).toBe(BoltEffect.POLYMORPH);
        for (const name of ['PLENTY', 'WHIP']) expect(MONSTER_BOLT_TABLE[name]).toBeUndefined();
    });
});
