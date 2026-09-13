const fs = require('fs');

const data = fs.readFileSync('/Users/coolking70/Documents/同步空间/brogue/BrogueCE-master/src/variants/GlobalsBrogue.c', 'utf8');

const regex = /const hordeType hordeCatalog_Brogue\[\] = \{([\s\S]*?)\};/;
const match = data.match(regex);
if (!match) process.exit(1);

const block = match[1];
const lines = block.split('\n');

const hordes = [];
let current = "";

for (let line of lines) {
    line = line.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    current += line + " ";

    // counting brackets
    let openCount = 0;
    for (const c of current) {
        if (c === '{') openCount++;
        else if (c === '}') openCount--;
    }

    if (openCount === 0 && current.includes('{') && current.includes('}')) {
        let clean = current.trim();
        if (clean.endsWith(',')) clean = clean.slice(0, -1);
        if (clean.startsWith('{')) clean = clean.slice(1);
        if (clean.endsWith('}')) clean = clean.slice(0, -1);

        // Match top level commas except inside brackets
        const tokens = [];
        let inArray = 0;
        let tok = "";
        for (const c of clean) {
            if (c === '{') inArray++;
            else if (c === '}') inArray--;
            if (c === ',' && inArray === 0) {
                tokens.push(tok.trim());
                tok = "";
            } else {
                tok += c;
            }
        }
        tokens.push(tok.trim());

        if (tokens.length >= 8) {
            const leader = tokens[0].replace('MK_', '');

            const numMembers = parseInt(tokens[1]);
            const mTypes = tokens[2].replace(/[{}]/g, '').split(',').map(s => s.trim().replace('MK_', '')).filter(s => s && s !== '0');

            // Extract counts correctly
            const mCountsText = tokens[3];
            const countArr = [];
            const countRegex = /\{([\d\s,]+)\}/g;
            let m;
            while ((m = countRegex.exec(mCountsText)) !== null) {
                const nums = m[1].split(',').map(n => parseInt(n.trim()));
                countArr.push({
                    min: nums[0] !== undefined && !isNaN(nums[0]) ? nums[0] : 1,
                    max: nums[1] !== undefined && !isNaN(nums[1]) ? nums[1] : (nums[0] || 1)
                });
            }

            const minLevel = parseInt(tokens[4]);
            const maxLevel = parseInt(tokens[5]);
            const frequency = parseInt(tokens[6]);
            const spawnsIn = tokens[7];
            const machine = tokens[8];
            const flags = tokens.length > 9 ? tokens[9].split('|').map(x => x.trim()) : [];

            hordes.push({
                leader,
                members: mTypes.map((type, i) => ({
                    type,
                    minCount: countArr[i] ? countArr[i].min : 1,
                    maxCount: countArr[i] ? countArr[i].max : 1
                })),
                minLevel: isNaN(minLevel) ? null : minLevel,
                maxLevel: isNaN(maxLevel) ? null : maxLevel,
                frequency: isNaN(frequency) ? null : frequency,
                flags: flags.filter(f => f && f !== '0')
            });
        }
        current = "";
    }
}

fs.writeFileSync('/Users/coolking70/Documents/同步空间/brogue/brogue-web/src/data/hordes.json', JSON.stringify(hordes, null, 2));
console.log(`Parsed ${hordes.length} hordes`);
