#!/usr/bin/env node
/**
 * P4-1a：从 CE 源码 (monsterCatalog, Globals.c) 提取每只怪物的 bolts 数组，
 * 合并进 src/data/monsters.json 的 "bolts" 字段。
 *
 * 本脚本只做数据合并，不涉及任何游戏逻辑改动。
 *
 * 用法：
 *   node scripts/extract_monster_bolts.cjs [--ce-root <path-to-BrogueCE-master>] [--check]
 *
 *   --ce-root  CE 源码根目录，默认 ../BrogueCE-master（相对本仓库根目录，
 *              即 brogue-web 与 BrogueCE-master 为同级目录的本地开发布局）。
 *   --check    只提取并打印结果，不写回 monsters.json（用于核对）。
 *
 * 字段形式说明见 ai_docs/p4_1a_monster_bolts_data_report.md。
 * 摘要：
 *   - "bolts" 存 CE 的 boltType 名去掉 "BOLT_" 前缀的字符串数组，
 *     保持 CE 源码中的原始顺序（不排序）。
 *   - 没有 bolts 的怪物也写 "bolts": []（而不是省略字段），
 *     与本文件里 behaviorFlags / abilityFlags 一律存在（空数组兜底）的既有约定一致，
 *     避免 Monster.ts 未来读取时要多做一次 undefined 判断。
 */

'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
    const args = { ceRoot: path.resolve(__dirname, '..', '..', 'BrogueCE-master'), check: false };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--ce-root') {
            args.ceRoot = path.resolve(argv[++i]);
        } else if (argv[i] === '--check') {
            args.check = true;
        }
    }
    return args;
}

/**
 * 从 Globals.c 全文中截出 monsterCatalog[] 初始化数组的原始文本
 * （从 "creatureType monsterCatalog[" 声明行开始，到匹配的结尾 "};" 为止）。
 */
function extractMonsterCatalogBlock(source) {
    const startMarker = 'creatureType monsterCatalog[';
    const startIdx = source.indexOf(startMarker);
    if (startIdx === -1) {
        throw new Error('未找到 "creatureType monsterCatalog[" —— Globals.c 结构可能已变化');
    }
    const braceOpenIdx = source.indexOf('{', startIdx);
    if (braceOpenIdx === -1) {
        throw new Error('monsterCatalog 声明后未找到起始 "{"');
    }
    // 数组字面量后面直接跟 "};" 结束整个声明（不是嵌套在别的语句里），
    // 所以从数组第一层左花括号往后找同级配平的右花括号即可。
    let depth = 0;
    for (let i = braceOpenIdx; i < source.length; i++) {
        const ch = source[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) {
                return source.slice(braceOpenIdx + 1, i);
            }
        }
    }
    throw new Error('monsterCatalog 数组花括号未配平');
}

/**
 * 把 monsterCatalog 数组体切分成一条条顶层怪物条目的原始文本
 * （每条形如 "{0, "name", ..., {damage}, ..., {bolts}, (flags), (abilityFlags)}"）。
 * 用花括号深度计数，天然跳过 // 行注释里的花括号（行注释里不会出现花括号，
 * 本文件核对过 monsterCatalog 块内注释均为整行注释，不与条目同行）。
 */
function splitTopLevelEntries(blockText) {
    // 先去掉整行 // 注释，避免干扰花括号计数（monsterCatalog 块头部的字段名注释行）。
    const noLineComments = blockText
        .split('\n')
        .map((line) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('//')) return '';
            return line;
        })
        .join('\n');

    const entries = [];
    let depth = 0;
    let entryStart = -1;
    for (let i = 0; i < noLineComments.length; i++) {
        const ch = noLineComments[i];
        if (ch === '{') {
            if (depth === 0) entryStart = i;
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0 && entryStart !== -1) {
                entries.push(noLineComments.slice(entryStart, i + 1));
                entryStart = -1;
            }
        }
    }
    return entries;
}

/**
 * 从单条怪物条目文本中提取 { name, bolts[] }。
 *
 * creatureType 字段顺序（Rogue.h:2172 起）：
 *   monsterID, monsterName, displayChar, foreColor, maxHP, defense, accuracy,
 *   damage{min,max,clump}, turnsBetweenRegen, movementSpeed, attackSpeed,
 *   bloodType, intrinsicLightType, isLarge, DFChance, DFType, bolts[20], flags, abilityFlags
 *
 * 条目里唯二的花括号子分组就是 damage（第一个）和 bolts（第二个）——
 * flags / abilityFlags 用圆括号包裹，不会跟花括号子分组混淆。
 */
function parseEntry(entryText) {
    const nameMatch = entryText.match(/"((?:[^"\\]|\\.)*)"/);
    if (!nameMatch) {
        throw new Error(`条目缺少名字字符串：${entryText.slice(0, 80)}...`);
    }
    const name = nameMatch[1];

    const braceGroups = [];
    {
        let depth = 0;
        let start = -1;
        // 条目本身最外层就是一对花括号，从下标 1 开始找内部子分组，跳过最外层本身。
        for (let i = 1; i < entryText.length - 1; i++) {
            const ch = entryText[i];
            if (ch === '{') {
                if (depth === 0) start = i;
                depth++;
            } else if (ch === '}') {
                depth--;
                if (depth === 0 && start !== -1) {
                    braceGroups.push(entryText.slice(start + 1, i));
                    start = -1;
                }
            }
        }
    }

    if (braceGroups.length < 2) {
        throw new Error(`"${name}" 条目花括号子分组不足 2 个（damage + bolts），实际 ${braceGroups.length} 个`);
    }
    const boltsGroupText = braceGroups[1].trim();

    let bolts = [];
    if (boltsGroupText !== '0' && boltsGroupText !== '') {
        bolts = boltsGroupText
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
            .map((tok) => {
                if (!tok.startsWith('BOLT_')) {
                    throw new Error(`"${name}" 的 bolts 子分组里出现非 BOLT_ 前缀的 token："${tok}"（原文：${boltsGroupText}）`);
                }
                return tok.slice('BOLT_'.length);
            });
    }

    return { name, bolts };
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const globalsPath = path.join(args.ceRoot, 'src', 'brogue', 'Globals.c');
    if (!fs.existsSync(globalsPath)) {
        console.error(`找不到 CE 源码：${globalsPath}`);
        console.error('请用 --ce-root <path> 指定 BrogueCE-master 目录。');
        process.exit(1);
    }

    const source = fs.readFileSync(globalsPath, 'utf8');
    const block = extractMonsterCatalogBlock(source);
    const entryTexts = splitTopLevelEntries(block);

    const parsed = entryTexts.map(parseEntry);

    // "you"（玩家）是 monsterCatalog 里的第 0 项，但不是怪物，web 的 monsters.json 里没有它。
    const monsterEntries = parsed.filter((e) => e.name !== 'you');

    const withBolts = monsterEntries.filter((e) => e.bolts.length > 0);

    console.log(`CE monsterCatalog 共 ${parsed.length} 条（含玩家），怪物 ${monsterEntries.length} 只，带 bolts 的 ${withBolts.length} 只。`);
    const boltNameSet = new Set();
    for (const e of withBolts) {
        for (const b of e.bolts) boltNameSet.add(b);
    }
    console.log(`涉及 bolt 种类 ${boltNameSet.size} 种：${[...boltNameSet].sort().join(', ')}`);
    console.log('');
    console.log('带 bolts 的怪物（保持 CE 源码原始顺序，未排序）：');
    for (const e of withBolts) {
        console.log(`  ${e.name.padEnd(20)} -> [${e.bolts.join(', ')}]`);
    }

    if (args.check) {
        return;
    }

    const monstersJsonPath = path.resolve(__dirname, '..', 'src', 'data', 'monsters.json');
    const monsters = JSON.parse(fs.readFileSync(monstersJsonPath, 'utf8'));

    // 用小写名字做索引；web 的 "name" 字段就是 CE monsterName 的首字母大写版本
    // （例如 CE "goblin mystic" -> web "Goblin mystic"），大小写不敏感匹配足够稳妥。
    const byLowerName = new Map();
    for (const e of monsterEntries) {
        byLowerName.set(e.name.toLowerCase(), e);
    }

    let matched = 0;
    let unmatchedWebMonsters = [];
    let unmatchedCeMonsters = new Set(byLowerName.keys());

    for (const m of monsters) {
        const key = String(m.name || '').toLowerCase();
        const ceEntry = byLowerName.get(key);
        if (ceEntry) {
            m.bolts = ceEntry.bolts;
            matched++;
            unmatchedCeMonsters.delete(key);
        } else {
            m.bolts = [];
            unmatchedWebMonsters.push(m.id);
        }
    }

    if (unmatchedWebMonsters.length > 0) {
        console.log('');
        console.log(`警告：以下 web 怪物在 CE monsterCatalog 里未找到同名条目（已写入 bolts: []）：${unmatchedWebMonsters.join(', ')}`);
    }
    if (unmatchedCeMonsters.size > 0) {
        console.log('');
        console.log(`警告：以下 CE 怪物在 web monsters.json 里未找到对应条目（未写入任何数据）：${[...unmatchedCeMonsters].join(', ')}`);
    }

    console.log('');
    console.log(`匹配 ${matched}/${monsters.length} 个 web 怪物条目。`);

    const output = JSON.stringify(monsters, null, 4) + '\n';
    fs.writeFileSync(monstersJsonPath, output, 'utf8');
    console.log(`已写回 ${monstersJsonPath}`);
}

main();
