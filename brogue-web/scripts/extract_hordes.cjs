#!/usr/bin/env node
/**
 * scripts/extract_hordes.cjs — 从 BrogueCE 源码完整提取 hordeCatalog_Brogue，
 * 生成 src/data/hordes.json。
 *
 * 权威来源：
 *   - BrogueCE-master/src/variants/GlobalsBrogue.c  hordeCatalog_Brogue[]（L744 起，
 *     至其后第一个 `};`），以及同文件 L43-44 的 AMULET_LEVEL / DEEPEST_LEVEL
 *   - BrogueCE-master/src/brogue/Rogue.h            hordeFlags / machineTypes /
 *     tileType / monsterTypes 枚举（数值一律从枚举解析，不硬编码）
 *   - BrogueCE-master/src/brogue/Globals.c          monsterCatalog（creatureType
 *     数组，条目顺序与 monsterTypes 枚举一一对应）——用于把 horde 表里的
 *     MK_* 枚举名映射为 CE 目录显示名的规范形式（大写、空格转下划线）。
 *     枚举名与目录名存在历史不一致（如 MK_GOBLIN_CHIEFTAN → "goblin warlord"），
 *     而 web 侧 monsters.json 的 id 正是目录显示名的小写下划线形式，
 *     故 horde 表必须存映射后的名字，否则 Game.ts 按 id 查表会静默失配。
 *
 * C 结构体是位置初始化，尾部字段可省略，省略即 0：
 *   spawnsIn=0 -> null、machine=0 -> 0、flags=0 -> []（与旧 hordes.json 的
 *   null/"空数组" 惯例一致）。maxLevel 一律输出数字（DEEPEST_LEVEL=40、
 *   AMULET_LEVEL=26、DEEPEST_LEVEL-1=39，数值可直接代入 CE 语义）。
 *
 * 用法：node scripts/extract_hordes.cjs
 * CE 源码目录默认取 <repo>/../BrogueCE-master，可用环境变量 BROGUE_CE_DIR 覆盖。
 * 全部自检通过才会写文件；任何一条失败即非零退出且不落盘。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.join(REPO_ROOT, 'src', 'data', 'hordes.json');

function locateCeDir() {
    const candidates = [
        process.env.BROGUE_CE_DIR,
        path.join(REPO_ROOT, '..', 'BrogueCE-master'),
        path.join(REPO_ROOT, 'BrogueCE-master'),
    ].filter(Boolean);
    for (const dir of candidates) {
        if (
            fs.existsSync(path.join(dir, 'src', 'variants', 'GlobalsBrogue.c')) &&
            fs.existsSync(path.join(dir, 'src', 'brogue', 'Rogue.h')) &&
            fs.existsSync(path.join(dir, 'src', 'brogue', 'Globals.c'))
        ) {
            return dir;
        }
    }
    throw new Error(
        `找不到 BrogueCE 源码目录，尝试过：${candidates.join(', ')}（可用 BROGUE_CE_DIR 指定）`
    );
}

// ---------- 通用小工具 ----------

/** 去掉 // 行注释（本数据表中没有字符串字面量，安全）。 */
function stripComment(line) {
    const idx = line.indexOf('//');
    return idx === -1 ? line : line.slice(0, idx);
}

/**
 * 按顶层逗号切分（尊重 {} 与 () 嵌套）。
 * "A, {B, C}, {{1,2},{3,4}}" -> ["A", "{B, C}", "{{1,2},{3,4}}"]
 */
function splitTopLevel(text) {
    const parts = [];
    let depth = 0;
    let cur = '';
    for (const ch of text) {
        if (ch === '{' || ch === '(') depth++;
        else if (ch === '}' || ch === ')') depth--;
        if (ch === ',' && depth === 0) {
            parts.push(cur.trim());
            cur = '';
        } else {
            cur += ch;
        }
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts;
}

/** 取大括号包裹的内层文本，如 "{{1,2},{3}}" -> "{1,2},{3}"。 */
function innerBraces(text) {
    const open = text.indexOf('{');
    const close = text.lastIndexOf('}');
    if (open === -1 || close === -1 || close < open) {
        throw new Error(`括号不匹配: ${text}`);
    }
    return text.slice(open + 1, close);
}

/** 求值：纯数字、Fl(N)、已知枚举名、A|B 位或、以及 +/- 链（如 DEEPEST_LEVEL-1）。 */
function makeEvaluator(defines, nameToValue) {
    const resolveToken = (tok) => {
        tok = tok.trim();
        if (/^-?\d+$/.test(tok)) return parseInt(tok, 10);
        const fl = tok.match(/^Fl\(\s*(\d+)\s*\)$/);
        if (fl) return 1 << parseInt(fl[1], 10);
        if (defines.has(tok)) return defines.get(tok);
        if (nameToValue.has(tok)) return nameToValue.get(tok);
        throw new Error(`无法求值的符号: ${tok}`);
    };
    return (expr) => {
        expr = expr.trim();
        try {
            return resolveToken(expr); // 纯数字 / Fl(N) / #define / 枚举名
        } catch (_) {
            /* 复合表达式，走下方解析 */
        }
        if (expr.includes('|')) {
            // 形如 (A | B | C) 的位或，先去括号再逐项求值
            return expr
                .replace(/[()]/g, '')
                .split('|')
                .reduce((acc, part) => acc | resolveToken(part), 0);
        }
        const tokens = expr.match(/[A-Za-z_]\w*|\d+|[+\-]/g);
        if (!tokens) throw new Error(`无法求值的表达式: ${expr}`);
        let acc = 0;
        let sign = 1;
        let pending = null;
        for (const t of tokens) {
            if (t === '+') { if (pending !== null) { acc += sign * pending; pending = null; } sign = 1; continue; }
            if (t === '-') { if (pending !== null) { acc += sign * pending; pending = null; } sign = -1; continue; }
            const v = resolveToken(t);
            if (pending === null) pending = v;
            else pending = pending * v; // 仅支持乘法紧邻（本表未用到，防御性）
        }
        if (pending !== null) acc += sign * pending;
        return acc;
    };
}

// ---------- Rogue.h 枚举解析 ----------

/** 提取 `enum <name> { ... };` 的内层文本。 */
function extractEnumBody(header, enumName) {
    const start = header.indexOf(`enum ${enumName} {`);
    if (start === -1) throw new Error(`Rogue.h 中找不到 enum ${enumName}`);
    let depth = 0;
    let i = header.indexOf('{', start);
    const bodyStart = i + 1;
    for (; i < header.length; i++) {
        if (header[i] === '{') depth++;
        else if (header[i] === '}') {
            depth--;
            if (depth === 0) break;
        }
    }
    return header.slice(bodyStart, i);
}

/** 枚举体 -> 有序 [名字, 数值表达式]；支持 `= N` 重置与 `= 表达式`。 */
function parseEnumPairs(body) {
    // 先去块注释、再逐行去行注释，最后合并切分（注释里的逗号不能参与切分）
    const cleaned = body
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .split('\n')
        .map(stripComment)
        .join(' ');
    const pairs = [];
    for (const item of splitTopLevel(cleaned)) {
        const clean = item.trim();
        if (!clean) continue;
        const eq = clean.indexOf('=');
        if (eq === -1) pairs.push([clean, null]);
        else pairs.push([clean.slice(0, eq).trim(), clean.slice(eq + 1).trim()]);
    }
    return pairs;
}

/** 解析为 name -> 数值 映射（自动递增；Fl(N)/枚举名/数字均可）。 */
function parseEnum(header, enumName, defines, extraValues) {
    const nameToValue = new Map(extraValues);
    const evaluate = makeEvaluator(defines, nameToValue);
    let next = 0;
    for (const [name, expr] of parseEnumPairs(extractEnumBody(header, enumName))) {
        if (expr !== null) {
            nameToValue.set(name, evaluate(expr));
            // C 的自动递增从「上一个显式值 +1」继续
            next = nameToValue.get(name) + 1;
        } else {
            nameToValue.set(name, next++);
        }
    }
    return nameToValue;
}

// ---------- GlobalsBrogue.c 解析 ----------

function parseDefines(source) {
    const defines = new Map();
    for (const m of source.matchAll(/^#define\s+(\w+)\s+(\d+)\s*(?:\/\/.*)?$/gm)) {
        defines.set(m[1], parseInt(m[2], 10));
    }
    return defines;
}

function extractCatalogEntries(source) {
    const marker = 'const hordeType hordeCatalog_Brogue[] = {';
    const start = source.indexOf(marker);
    if (start === -1) throw new Error('GlobalsBrogue.c 中找不到 hordeCatalog_Brogue');
    const startLine = source.slice(0, start).split('\n').length; // 1-based
    const end = source.indexOf('};', start);
    if (end === -1) throw new Error('hordeCatalog_Brogue 找不到结束的 };');
    const body = source.slice(start + marker.length, end);
    const entries = [];
    let lineNo = startLine - 1; // body 首段是标记行行尾，首次迭代即回到 startLine
    for (const rawLine of body.split('\n')) {
        lineNo++;
        const line = stripComment(rawLine).trim();
        if (!line) continue;
        // 剥掉本条初始化式的外层 { }（形如 {MK_RAT, 0, ..., 150},）
        const m = line.match(/^\{(.*)\},?$/);
        if (!m) continue; // 跳过孤立的 "}" 等
        entries.push({ line: m[1].trim(), lineNo });
    }
    return { entries, startLine };
}

// ---------- monsterCatalog 名字映射（Globals.c） ----------

/**
 * 从 Globals.c 的 creatureType monsterCatalog[] 按顺序提取目录显示名。
 * 条目形如 `{0, "rat", G_RAT, ...}`（首个字段为占位 0，第二个字段是名字字符串），
 * 条目顺序与 Rogue.h monsterTypes 枚举一一对应。
 */
function extractCatalogDisplayNames(globalsC) {
    const marker = 'creatureType monsterCatalog[NUMBER_MONSTER_KINDS] = {';
    const start = globalsC.indexOf(marker);
    if (start === -1) throw new Error('Globals.c 中找不到 monsterCatalog');
    let depth = 0;
    let i = globalsC.indexOf('{', start);
    const bodyStart = i + 1;
    for (; i < globalsC.length; i++) {
        if (globalsC[i] === '{') depth++;
        else if (globalsC[i] === '}') {
            depth--;
            if (depth === 0) break;
        }
    }
    const body = globalsC
        .slice(bodyStart, i)
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .split('\n')
        .map(stripComment)
        .join(' ');
    const names = [];
    for (const m of body.matchAll(/\{\s*0\s*,\s*"([^"]+)"/g)) {
        names.push(m[1]);
    }
    return names;
}

/**
 * MK_* 枚举名 -> 目录显示名的规范形式（大写、空格转下划线）。
 * monsterCatalog 的索引与 monsterTypes 枚举一一对应，据此自动建全表映射，
 * 不逐条硬编码；绝大多数物种映射是恒等（RAT -> RAT），仅名字漂移的物种
 * （如 MK_GOBLIN_CHIEFTAN -> GOBLIN_WARLORD）会被改写。
 */
function buildEnumToCatalogName(monsterTypes, displayNames) {
    const enumNames = [...monsterTypes.keys()].filter((n) => n !== 'NUMBER_MONSTER_KINDS');
    if (enumNames.length !== displayNames.length) {
        throw new Error(
            `monsterTypes 枚举数(${enumNames.length}) 与 monsterCatalog 条目数(${displayNames.length}) 不一致`
        );
    }
    if (displayNames[0] !== 'you') {
        throw new Error(`monsterCatalog 首条应为 "you"，实际为 "${displayNames[0]}"`);
    }
    const map = new Map();
    const renamed = [];
    for (let i = 0; i < enumNames.length; i++) {
        const enumShort = enumNames[i].replace(/^MK_/, '');
        const canonical = displayNames[i].toUpperCase().replace(/ /g, '_');
        map.set(enumShort, canonical);
        if (canonical !== enumShort) renamed.push(`${enumNames[i]} -> ${canonical}`);
    }
    return { map, renamed };
}

// ---------- 单条 horde 解析 ----------

const EXPECTED_MAX_TOKENS = 10; // leader, n, {members}, {{counts}}, minL, maxL, freq, spawnsIn, machine, flags

function parseHordeEntry(entry, ctx) {
    const { evaluate, tileTypes, machineTypes, monsterTypes, flagNames, enumToCatalogName } = ctx;
    const tokens = splitTopLevel(entry.line);
    if (tokens.length < 7 || tokens.length > EXPECTED_MAX_TOKENS) {
        throw new Error(`L${entry.lineNo}: 字段数异常(${tokens.length}): ${entry.line}`);
    }

    const leaderMatch = tokens[0].match(/^MK_(\w+)$/);
    if (!leaderMatch) throw new Error(`L${entry.lineNo}: leader 不是 MK_* 形式: ${tokens[0]}`);
    if (!monsterTypes.has(tokens[0])) {
        throw new Error(`L${entry.lineNo}: leader ${tokens[0]} 不在 monsterTypes 枚举中`);
    }
    // 枚举名 -> 目录显示名规范形式（修复枚举名与目录名漂移导致的查表失配）
    const leader = enumToCatalogName.get(leaderMatch[1]);

    const numberOfMemberTypes = parseInt(tokens[1], 10);
    if (!Number.isInteger(numberOfMemberTypes) || numberOfMemberTypes < 0 || numberOfMemberTypes > 5) {
        throw new Error(`L${entry.lineNo}: numberOfMemberTypes 越界: ${tokens[1]}`);
    }

    const memberNames = splitTopLevel(innerBraces(tokens[2])).map((s) => {
        if (s === '0') return null;
        if (!/^MK_\w+$/.test(s)) throw new Error(`L${entry.lineNo}: member 非法: ${s}`);
        if (!monsterTypes.has(s)) throw new Error(`L${entry.lineNo}: member ${s} 不在 monsterTypes 枚举中`);
        return enumToCatalogName.get(s.replace(/^MK_/, ''));
    });

    // numberOfMemberTypes=0 时 member list / memberCount 均为 {0} 占位，直接跳过
    const countGroups =
        numberOfMemberTypes === 0
            ? []
            : splitTopLevel(innerBraces(tokens[3])).map((g) => {
                  const nums = splitTopLevel(innerBraces(g)).map((v) => parseInt(v, 10));
                  if (nums.length !== 3 || nums.some((n) => !Number.isInteger(n))) {
                      throw new Error(`L${entry.lineNo}: memberCount 非法: ${g}`);
                  }
                  return { min: nums[0], max: nums[1], clump: nums[2] };
              });

    if (countGroups.length !== numberOfMemberTypes) {
        throw new Error(
            `L${entry.lineNo}: memberCount 组数(${countGroups.length}) != numberOfMemberTypes(${numberOfMemberTypes})`
        );
    }

    const members = [];
    for (let i = 0; i < numberOfMemberTypes; i++) {
        if (memberNames[i] === null) {
            throw new Error(`L${entry.lineNo}: 第 ${i} 个 memberType 为 0 但 numberOfMemberTypes>0`);
        }
        members.push({
            type: memberNames[i],
            minCount: countGroups[i].min,
            maxCount: countGroups[i].max,
        });
    }

    const minLevel = evaluate(tokens[4]);
    const maxLevel = evaluate(tokens[5]);
    const frequency = evaluate(tokens[6]);

    // 尾部可省略字段：缺省即 0（C 位置初始化语义）
    const spawnsInTok = tokens[7] || '0';
    const machineTok = tokens[8] || '0';
    const flagsTok = tokens[9] || '0';

    let spawnsIn = null;
    if (spawnsInTok !== '0') {
        if (!tileTypes.has(spawnsInTok)) {
            throw new Error(`L${entry.lineNo}: spawnsIn ${spawnsInTok} 不在 tileType 枚举中`);
        }
        spawnsIn = spawnsInTok;
    }

    let machine = 0;
    if (machineTok !== '0') {
        if (!machineTypes.has(machineTok)) {
            throw new Error(`L${entry.lineNo}: machine ${machineTok} 不在 machineTypes 枚举中`);
        }
        machine = machineTypes.get(machineTok);
    }

    const flags = [];
    if (flagsTok !== '0') {
        for (const f of splitTopLevel(flagsTok.replace(/\|/g, ','))) {
            const name = f.replace(/[()]/g, '').trim();
            if (!flagNames.has(name)) {
                throw new Error(`L${entry.lineNo}: flag ${name} 不在 hordeFlags 枚举中`);
            }
            flags.push(name);
        }
    }

    return {
        leader,
        members,
        minLevel,
        maxLevel,
        frequency,
        spawnsIn,
        machine,
        flags,
        // 备查字段，不写入 JSON
        _lineNo: entry.lineNo,
        _clumpFactors: countGroups.map((c) => c.clump),
    };
}

// ---------- 过滤与统计（CE 两套口径，Monsters.c） ----------

// HORDE_MACHINE_ONLY 复合标志覆盖的成员（Rogue.h hordeFlags 枚举）
const HORDE_MACHINE_ONLY_FLAGS = new Set([
    'HORDE_MACHINE_BOSS',
    'HORDE_MACHINE_WATER_MONSTER',
    'HORDE_MACHINE_CAPTIVE',
    'HORDE_MACHINE_STATUE',
    'HORDE_MACHINE_TURRET',
    'HORDE_MACHINE_MUD',
    'HORDE_MACHINE_KENNEL',
    'HORDE_VAMPIRE_FODDER',
    'HORDE_MACHINE_LEGENDARY_ALLY',
    'HORDE_MACHINE_THIEF',
    'HORDE_MACHINE_GOBLIN_WARREN',
    'HORDE_SACRIFICE_TARGET',
]);

// 开局铺怪禁用集（Monsters.c:1090 populateMonsters -> spawnHorde）
const POPULATE_FORBIDDEN = new Set(['HORDE_IS_SUMMONED', ...HORDE_MACHINE_ONLY_FLAGS]);

// 周期刷怪禁用集（Monsters.c:1133 spawnPeriodicHorde -> spawnHorde）；
// VAMPIRE_FODDER / SACRIFICE_TARGET 已含于 MACHINE_ONLY，不单列
const PERIODIC_FORBIDDEN = new Set([
    'HORDE_IS_SUMMONED',
    'HORDE_LEADER_CAPTIVE',
    'HORDE_NO_PERIODIC_SPAWN',
    ...HORDE_MACHINE_ONLY_FLAGS,
]);

function isPopulateHorde(h) {
    return h.frequency > 0 && !h.flags.some((f) => POPULATE_FORBIDDEN.has(f));
}

function isPeriodicHorde(h) {
    return h.frequency > 0 && !h.flags.some((f) => PERIODIC_FORBIDDEN.has(f));
}

// ---------- 主流程 ----------

function main() {
    const ceDir = locateCeDir();
    const globalsC = fs.readFileSync(path.join(ceDir, 'src', 'variants', 'GlobalsBrogue.c'), 'utf8');
    const rogueH = fs.readFileSync(path.join(ceDir, 'src', 'brogue', 'Rogue.h'), 'utf8');
    const brogueGlobalsC = fs.readFileSync(path.join(ceDir, 'src', 'brogue', 'Globals.c'), 'utf8');

    const defines = parseDefines(globalsC);
    for (const key of ['AMULET_LEVEL', 'DEEPEST_LEVEL']) {
        if (!defines.has(key)) throw new Error(`GlobalsBrogue.c 缺少 #define ${key}`);
    }

    const tileTypes = new Set(parseEnum(rogueH, 'tileType', defines, new Map()).keys());
    const monsterTypes = parseEnum(rogueH, 'monsterTypes', defines, new Map());
    const machineTypes = parseEnum(rogueH, 'machineTypes', defines, new Map());
    const hordeFlags = parseEnum(rogueH, 'hordeFlags', defines, new Map());
    const flagNames = new Set(hordeFlags.keys());

    // MK_* 枚举名 -> 目录显示名规范形式（monsterCatalog 与 monsterTypes 按索引对齐）
    const { map: enumToCatalogName, renamed } = buildEnumToCatalogName(
        monsterTypes,
        extractCatalogDisplayNames(brogueGlobalsC)
    );

    const evaluate = makeEvaluator(defines, new Map());
    const { entries, startLine } = extractCatalogEntries(globalsC);

    const hordes = entries.map((e) =>
        parseHordeEntry(e, { evaluate, tileTypes, machineTypes, monsterTypes, flagNames, enumToCatalogName })
    );

    // ---- 自检 ----
    const problems = [];
    const check = (label, actual, expected) => {
        const ok = actual === expected;
        if (!ok) problems.push(`${label}: 实际 ${actual} != 预期 ${expected}`);
        return ok;
    };

    const total = hordes.length;
    const populatePool = hordes.filter(isPopulateHorde);
    const periodicPool = hordes.filter(isPeriodicHorde);
    const captives = hordes.filter((h) => h.flags.includes('HORDE_LEADER_CAPTIVE'));

    check('总条数', total, 175);
    check('开局铺怪池条数（Monsters.c:1090 口径）', populatePool.length, 85);
    check('周期刷怪池条数（Monsters.c:1133 口径）', periodicPool.length, 58);
    check('HORDE_LEADER_CAPTIVE 条数', captives.length, 56);

    // 开局池物种覆盖（领袖 + 全部成员）
    const populateSpecies = new Set();
    for (const h of populatePool) {
        populateSpecies.add(h.leader);
        for (const m of h.members) populateSpecies.add(m.type);
    }

    // 各深度可用开局 horde 数（CE pickHordeType 的硬窗口口径：minLevel <= d <= maxLevel）
    const perDepth = {};
    for (let d = 1; d <= defines.get('DEEPEST_LEVEL'); d++) {
        perDepth[d] = populatePool.filter((h) => h.minLevel <= d && d <= h.maxLevel).length;
    }

    // clumpFactor 备查清单（!= 1 的条目）
    const clumpNotes = [];
    for (const h of hordes) {
        h._clumpFactors.forEach((c, i) => {
            if (c !== 1) clumpNotes.push(`L${h._lineNo} ${h.leader} member[${i}] clumpFactor=${c}`);
        });
    }

    console.log('--- 提取自检 ---');
    console.log(`CE 源: ${ceDir}`);
    console.log(`hordeCatalog_Brogue 起始行: ${startLine}`);
    console.log(`总条数: ${total}（锚点 175）`);
    console.log(`开局铺怪池条数: ${populatePool.length}（锚点 85）`);
    console.log(`周期刷怪池条数: ${periodicPool.length}（锚点 58）`);
    console.log(`HORDE_LEADER_CAPTIVE 条数: ${captives.length}（锚点 56）`);
    console.log(`开局池中 LEADER_CAPTIVE 条数: ${populatePool.filter((h) => h.flags.includes('HORDE_LEADER_CAPTIVE')).length}`);
    console.log(`枚举名 -> 目录名 改写条目: ${renamed.length ? renamed.join(', ') : '（无）'}`);
    console.log(`开局池物种数: ${populateSpecies.size}`);
    console.log(`AMULET_LEVEL=${defines.get('AMULET_LEVEL')}  DEEPEST_LEVEL=${defines.get('DEEPEST_LEVEL')}`);
    console.log('各深度开局 horde 数:', JSON.stringify(perDepth));
    console.log('clumpFactor != 1:', clumpNotes.length ? clumpNotes : '（无）');
    // 零失配核验：全表 leader + member 的映射名必须能在 monsters.json 按 id 找到
    const webMonsters = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'src', 'data', 'monsters.json'), 'utf8'));
    const webIds = new Set(webMonsters.map((m) => m.id.toUpperCase()));
    const allSpecies = new Set();
    for (const h of hordes) {
        allSpecies.add(h.leader);
        for (const m of h.members) allSpecies.add(m.type);
    }
    const missingInWeb = [...allSpecies].filter((s) => !webIds.has(s));
    console.log(`全表物种中 web monsters.json 缺失（映射后）: ${missingInWeb.length ? missingInWeb.join(', ') : '（无，零失配）'}`);
    if (missingInWeb.length) {
        problems.push(`monsters.json 缺失物种（映射后）: ${missingInWeb.join(', ')}`);
    }

    if (problems.length) {
        console.error('\n自检失败，不写文件：');
        for (const p of problems) console.error(`  - ${p}`);
        process.exit(1);
    }

    // ---- 写 JSON（字段顺序与旧文件一致，spawnsIn/machine 插在 frequency 之后）----
    const out = hordes.map((h) => ({
        leader: h.leader,
        members: h.members.map((m) => ({ type: m.type, minCount: m.minCount, maxCount: m.maxCount })),
        minLevel: h.minLevel,
        maxLevel: h.maxLevel,
        frequency: h.frequency,
        spawnsIn: h.spawnsIn,
        machine: h.machine,
        flags: h.flags,
    }));
    fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n', 'utf8');
    console.log(`\n已写出 ${out.length} 条 -> ${path.relative(REPO_ROOT, OUT_FILE)}`);
}

main();
