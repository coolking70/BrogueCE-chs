const fs = require('fs');

const globalsStr = fs.readFileSync('/Users/coolking70/Documents/同步空间/brogue/BrogueCE-master/src/brogue/Globals.c', 'utf8');

// Extract monsterCatalog array body
const catalogMatch = globalsStr.match(/creatureType monsterCatalog\[.*?\] = \{([\s\S]*?)\};\n/);
if (!catalogMatch) process.exit(1);

const lines = catalogMatch[1].split('\n');
const monsters = [];

let currentMonsterStr = "";

for (let line of lines) {
    line = line.trim();
    if (line.startsWith('//') || line === '') continue;

    currentMonsterStr += line + " ";

    // Check if the current string contains a complete struct initialization
    // It should start with {0, "name" and end with some } or },
    // A complete definition might span 1 or 2 lines. 
    // Usually ends with }} or },

    // Count { and }
    let openCount = 0;
    for (const c of currentMonsterStr) {
        if (c === '{') openCount++;
        else if (c === '}') openCount--;
    }

    if (openCount === 0 && currentMonsterStr.includes('{0,') && currentMonsterStr.includes('"')) {
        // Parse currentMonsterStr
        let clean = currentMonsterStr.trim();
        if (clean.endsWith(',')) clean = clean.slice(0, -1);
        if (clean.startsWith('{')) clean = clean.slice(1);
        if (clean.endsWith('}')) clean = clean.slice(0, -1);

        let inString = false;
        let inArray = 0;
        let tokens = [];
        let currentToken = '';
        for (let i = 0; i < clean.length; i++) {
            const c = clean[i];
            if (c === '"') inString = !inString;
            else if (c === '{') inArray++;
            else if (c === '}') inArray--;

            if (c === ',' && inArray === 0 && !inString) {
                tokens.push(currentToken.trim());
                currentToken = '';
            } else {
                currentToken += c;
            }
        }
        tokens.push(currentToken.trim());

        if (tokens.length >= 10) {
            const nameMatch = tokens[1].match(/"([^"]+)"/);
            if (nameMatch) {
                const name = nameMatch[1];
                if (name !== 'you') {
                    // Extract fields
                    const id = name.replace(/\s+/g, '_');
                    const char = tokens[2].replace('G_', '');
                    const color = tokens[3].replace('&', '');
                    const hp = parseInt(tokens[4]) || 0;
                    const defense = parseInt(tokens[5]) || 0;
                    const accuracy = parseInt(tokens[6]) || 0;

                    const dmgStr = tokens[7].replace(/[{}]/g, '').split(',').map(s => parseInt(s.trim()));
                    const damage = `${dmgStr[0] || 0}d${dmgStr[1] || 0}`;

                    const regen = parseInt(tokens[8]) || 0;
                    const moveSpeed = parseInt(tokens[9]) || 0;
                    const attackSpeed = parseInt(tokens[10]) || 0;

                    let behaviorFlags = [];
                    let abilityFlags = [];

                    // Flags are usually at the end of the line or the next line.
                    // tokens[17] behavior, tokens[18] abilities
                    if (tokens.length > 17 && tokens[17]) {
                        behaviorFlags = tokens[17].split('|').map(s => s.trim().replace(/[()]/g, '')).filter(s => s && s !== '0');
                    }
                    if (tokens.length > 18 && tokens[18]) {
                        abilityFlags = tokens[18].split('|').map(s => s.trim().replace(/[()]/g, '')).filter(s => s && s !== '0');
                    }

                    monsters.push({
                        id,
                        name: name.charAt(0).toUpperCase() + name.slice(1),
                        char: char.charAt(0).toLowerCase(),
                        color,
                        hp,
                        defense,
                        accuracy,
                        damage,
                        regen,
                        moveSpeed,
                        attackSpeed,
                        behaviorFlags,
                        abilityFlags,
                        minDepth: 1, // Will assign mapping
                        maxDepth: 26
                    });
                }
            }
        }
        currentMonsterStr = "";
    }
}

// Write the parsed JSON
fs.writeFileSync('/Users/coolking70/Documents/同步空间/brogue/brogue-web/src/data/monsters_ce2.json', JSON.stringify(monsters, null, 4));
console.log(`Parsed ${monsters.length} monsters to monsters_ce2.json`);
