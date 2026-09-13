const fs = require('fs');
const path = require('path');

const globalsPath = '/Users/coolking70/Documents/同步空间/brogue/BrogueCE-master/src/brogue/Globals.c';
const content = fs.readFileSync(globalsPath, 'utf8');

// 1. Extract monsterCatalog
const catalogMatch = content.match(/creatureType monsterCatalog\[.*?\] = \{([\s\S]*?)\};\n/);
if (!catalogMatch) {
    console.error("Could not find monsterCatalog");
    process.exit(1);
}

const catalogStr = catalogMatch[1];
const monsters = [];

// Match everything inside {} that starts with 0 for the ID
const regex = /\{0,\s*"([^"]+)",\s*([^,]+),\s*([^,]+),\s*(\d+),\s*(\d+),\s*(\d+),\s*\{(\d+),\s*(\d+),\s*(\d+)\},\s*(\d+),\s*(\d+),\s*(\d+),\s*([^,]+),\s*([^,]+),\s*(false|true),\s*([^,]+),\s*([^,]+),\s*\{([^}]+)\}(?:,\s*([^,]+))?(?:,\s*([^}]+))?/g;

// A more robust regex might be better, or just splitting by lines. We split by '{0,'
const entries = catalogStr.split(/\{0,\s*/).filter(x => x.trim().length > 0);

for (let entry of entries) {
    try {
        // Simple manual parsing since it's C struct init
        // E.g. "rat", G_RAT, &gray, 6, 0, 80, {1, 3, 1}, 20, 100, 100, DF_RED_BLOOD, 0, false, 1, DF_URINE, {0}},
        let clean = entry.replace(/\n/g, ' ').replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/gm, '').trim();
        // remove trailing },
        if (clean.endsWith('},')) clean = clean.slice(0, -2);
        else if (clean.endsWith('}')) clean = clean.slice(0, -1);

        let inString = false;
        let inArray = false;
        let tokens = [];
        let currentToken = '';
        for (let i = 0; i < clean.length; i++) {
            const c = clean[i];
            if (c === '"') inString = !inString;
            else if (c === '{') inArray = true;
            else if (c === '}') inArray = false;

            if (c === ',' && !inArray && !inString) {
                tokens.push(currentToken.trim());
                currentToken = '';
            } else {
                currentToken += c;
            }
        }
        tokens.push(currentToken.trim());

        const name = tokens[0].replace(/"/g, '');
        const id = name.replace(/\s+/g, '_');

        const hp = parseInt(tokens[3]);
        const defense = parseInt(tokens[4]);
        const accuracy = parseInt(tokens[5]);

        // damage {min, max, x}
        const dmgStr = tokens[6].replace(/[{}]/g, '').split(',').map(s => parseInt(s.trim()));
        const damage = `${dmgStr[0]}d${dmgStr[1]}`;

        const regen = parseInt(tokens[7]);
        const moveSpeed = parseInt(tokens[8]);
        const attackSpeed = parseInt(tokens[9]);
        const blood = tokens[10];
        const hasLight = tokens[11] !== '0';
        const isLarge = tokens[12] === 'true';

        let flags = tokens[16] || "";
        let abilities = tokens[17] || "";

        // process flags looking for MONST_xxx
        const monsterObj = {
            id,
            name: name.charAt(0).toUpperCase() + name.slice(1),
            char: tokens[1].replace('G_', '').substring(0, 1).toLowerCase(), // fallback char
            color: tokens[2].replace('&', '') + 'Color', // placeholder 
            hp,
            defense,
            accuracy,
            damage,
            regen,
            moveSpeed,
            attackSpeed,
            behaviorFlags: flags.split('|').map(s => s.trim().replace(/\(/g, '').replace(/\)/g, '')).filter(s => s && s !== '0'),
            abilityFlags: abilities.split('|').map(s => s.trim().replace(/\(/g, '').replace(/\)/g, '')).filter(s => s && s !== '0'),
        };

        monsters.push(monsterObj);
    } catch (e) {
        console.error("Error parsing one entry", e);
    }
}

fs.writeFileSync('/Users/coolking70/Documents/同步空间/brogue/brogue-web/src/data/monsters_ce.json', JSON.stringify(monsters, null, 2));
console.log(`Parsed ${monsters.length} monsters`);
