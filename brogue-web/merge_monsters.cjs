const fs = require('fs');

const webMonstersPath = '/Users/coolking70/Documents/同步空间/brogue/brogue-web/src/data/monsters.json';
const ceMonstersPath = '/Users/coolking70/Documents/同步空间/brogue/brogue-web/src/data/monsters_ce2.json';
const destPath = '/Users/coolking70/Documents/同步空间/brogue/brogue-web/src/data/monsters.json';

const webMonsters = JSON.parse(fs.readFileSync(webMonstersPath, 'utf8'));
const ceMonsters = JSON.parse(fs.readFileSync(ceMonstersPath, 'utf8'));

// Map existing data by ID
const webMonstersMap = {};
for (const m of webMonsters) {
    webMonstersMap[m.id] = m;
}

// Some color name approximations (standard hex integers)
const colorMap = {
    grayColor: 0x888888,
    goblinColorColor: 0x4aa02c,
    jackalColorColor: 0xb97a57,
    eelColorColor: 0x008080,
    ogreColorColor: 0x906050,
    poisonGasColorColor: 0x800080,
    goblinConjurerColorColor: 0x3cb371,
    goblinMysticColorColor: 0x20b2aa,
    orangeColor: 0xffa500,
    pinkJellyColorColor: 0xff69b4,
    toadColorColor: 0x8fbc8f,
    blackColor: 0x333333,
    acidBackColorColor: 0x32cd32,
    centipedeColorColor: 0xd9ba55,
    krakenColorColor: 0x2f4f4f,
    greenColor: 0x008000,
    whiteColor: 0xffffff,
    lightningColorColor: 0xadd8e6,
    wispLightColorColor: 0x87cefa,
    wraithColorColor: 0x778899,
    vomitColorColor: 0x808000,
    trollColorColor: 0x556b2f,
    salamanderColorColor: 0xff4500,
    purpleColor: 0x800080,
    darPriestessColorColor: 0xda70d6,
    darMageColorColor: 0x9370db,
    tanColorColor: 0xd2b48c,
    wormColorColor: 0xdeb887,
    sentinelColorColor: 0xa9a9a9,
    lichLightColorColor: 0x483d8b,
    pixieColorColor: 0xffb6c1,
    ectoplasmColorColor: 0x00fa9a,
    lavaForeColorColor: 0xff0000,
    pinkColor: 0xffc0cb,
    darkRedColor: 0x8b0000,
    dragonColorColor: 0xb22222,
    blueColor: 0x0000ff,
    flamedancerColorColor: 0xff4500,
    spectralBladeColorColor: 0xe0ffff,
    spectralImageColorColor: 0xadd8e6,
    yendorLightColorColor: 0xdcdcdc,
    glyphColorColor: 0x9932cc,
    beckonColorColor: 0xff1493,
    ifritColorColor: 0xff6347,
    phoenixColorColor: 0xffd700
};

// Generate final array
const finalMonsters = [];

for (const cem of ceMonsters) {
    if (cem.id === "0" || !cem.name) continue;

    // Attempt to parse out min/max depth based on base stats loosely if not existing
    let webm = webMonstersMap[cem.id] || {};

    let color = colorMap[cem.color] || 0xcccccc;
    if (webm.color) color = webm.color;

    // Use Web stats where available, otherwise use CE
    const m = {
        id: cem.id,
        name: cem.name,
        char: cem.char,
        color: color,
        hp: cem.hp,
        damage: cem.damage !== "0d0" && !cem.damage.includes('NaN') ? cem.damage : "1d1",
        minDepth: webm.minDepth || 1,
        maxDepth: webm.maxDepth || 26,
        goldDropChance: webm.goldDropChance !== undefined ? webm.goldDropChance : 0.05,
        itemDropChance: webm.itemDropChance !== undefined ? webm.itemDropChance : 0.05,
        behaviorFlags: cem.behaviorFlags || [],
        abilityFlags: cem.abilityFlags || [],
    };

    // Copy specific web extensions
    if (webm.onHitStatus) m.onHitStatus = webm.onHitStatus;
    if (webm.onHitChance) m.onHitChance = webm.onHitChance;
    if (webm.onHitDuration) m.onHitDuration = webm.onHitDuration;
    if (webm.statusImmunities) m.statusImmunities = webm.statusImmunities;
    if (webm.statusResistTurns) m.statusResistTurns = webm.statusResistTurns;
    if (webm.abilities) m.abilities = webm.abilities;

    finalMonsters.push(m);
}

fs.writeFileSync(destPath, JSON.stringify(finalMonsters, null, 4));
console.log(`Merged ${finalMonsters.length} monsters and wrote to ${destPath}`);
