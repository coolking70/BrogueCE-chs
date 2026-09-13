#!/usr/bin/env node
/**
 * scripts/merge_monster_stats.cjs — 把 CE 真实战斗数值合并进运行时怪物表，
 * 并可对照 BrogueCE 的 monsterCatalog（Globals.c）逐条校验。
 *
 * 背景：src/data/monsters.json（运行时唯一被 import 的怪物表）缺
 * accuracy/defense/regen/moveSpeed/attackSpeed 五个字段，Monster 构造函数
 * 全部落默认值（acc=100/def=0/regen=0/双速=100），导致 CombatFormulas 的
 * 0.987^defense 防御项恒等于 1。本脚本以 id 为键，把
 * src/data/monsters_ce2.json 的上述五个字段合并进 monsters.json。
 *
 * 冲突规则：monsters.json 的既有字段一律保留，绝不覆盖；只新增缺失的
 * 五个数值字段。ce2 的 color（字符串）等其他字段一律不带过来。
 *
 * 用法：
 *   node scripts/merge_monster_stats.cjs
 *       执行合并（幂等：已存在的五字段保持原值，仅补缺失）。
 *
 *   node scripts/merge_monster_stats.cjs --check-ce <path/to/Globals.c>
 *       只读校验：解析 monsterCatalog（表体含玩家行，已跳过），把
 *       monsters.json 的五字段 + hp/damage 逐条与 CE 对比，打印差异清单。
 *       五字段差异以 CE 为准修正（人工/脚本均可）；hp/damage 只报告不修改。
 *
 *   node scripts/merge_monster_stats.cjs --dump-ce <path/to/Globals.c>
 *       打印 monsters.json 67 条 × 五字段与 CE 逐条对照的 Markdown 表
 *       （附 Globals.c 行号），用于审计/报告附录。
 *
 * CE 权威来源：BrogueCE-master/src/brogue/Globals.c 的
 *   creatureType monsterCatalog[NUMBER_MONSTER_KINDS]（列序见 Rogue.h:2172
 *   的 creatureType 定义：HP, defense, accuracy, damage{min,max,clump},
 *   turnsBetweenRegen(=web 的 regen), movementSpeed, attackSpeed）。
 * CE 怪物名中的空格对应 web id 中的下划线（如 "pit bloat" → pit_bloat）。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MONSTERS_PATH = path.join(ROOT, 'src', 'data', 'monsters.json');
const CE2_PATH = path.join(ROOT, 'src', 'data', 'monsters_ce2.json');

const STAT_FIELDS = ['accuracy', 'defense', 'regen', 'moveSpeed', 'attackSpeed'];
// 五字段在对象中的插入位置：紧跟 damage 之后（无 damage 则追加到末尾）
const ANCHOR_FIELD = 'damage';

function readJson(p) {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** 在对象副本中把五字段插到 damage 之后，保持其余键的原有顺序与取值。 */
function withStatsInserted(monster, stats) {
    const out = {};
    let inserted = false;
    for (const [k, v] of Object.entries(monster)) {
        out[k] = v;
        if (k === ANCHOR_FIELD) {
            for (const f of STAT_FIELDS) out[f] = stats[f];
            inserted = true;
        }
    }
    if (!inserted) for (const f of STAT_FIELDS) out[f] = stats[f];
    return out;
}

function merge() {
    if (!fs.existsSync(CE2_PATH)) {
        // monsters_ce2.json 已按任务要求从仓库删除（五字段已于 2026-09 并入
        // monsters.json）。本脚本保留作为审计记录；后续校验直接用：
        //   node scripts/merge_monster_stats.cjs --check-ce <path/to/Globals.c>
        console.error('找不到 ' + CE2_PATH);
        console.error('monsters_ce2.json 已删除，五字段此前已并入 monsters.json，无需再合并。');
        console.error('如需复核数据是否仍与 CE 一致，使用 --check-ce <Globals.c 路径>。');
        process.exit(2);
    }
    const monsters = readJson(MONSTERS_PATH);
    const ce2 = readJson(CE2_PATH);
    const ce2ById = new Map(ce2.map((m) => [m.id, m]));

    let added = 0;
    let kept = 0;
    let unmatched = [];

    const merged = monsters.map((mon) => {
        const src = ce2ById.get(mon.id);
        if (!src) {
            unmatched.push(mon.id);
            return mon;
        }
        const missing = STAT_FIELDS.filter((f) => !(f in mon));
        if (missing.length === 0) {
            kept++;
            return mon;
        }
        const stats = {};
        for (const f of STAT_FIELDS) {
            const v = src[f];
            if (typeof v !== 'number' || !Number.isFinite(v)) {
                throw new Error(`ce2 的 ${mon.id}.${f} 不是有限数值: ${v}`);
            }
            stats[f] = v;
        }
        added++;
        return withStatsInserted(mon, stats);
    });

    fs.writeFileSync(MONSTERS_PATH, JSON.stringify(merged, null, 4) + '\n');

    console.log(`monsters.json: ${monsters.length} 条`);
    console.log(`  新增五字段: ${added} 条`);
    console.log(`  已有五字段(未动): ${kept} 条`);
    if (unmatched.length) {
        console.log(`  在 ce2 中找不到对应条目(未修改): ${unmatched.join(', ')}`);
    }
    console.log('已写回 ' + MONSTERS_PATH);
}

// ---- --check-ce：解析 Globals.c 的 monsterCatalog 并逐条对比 ----

/** monsterCatalog 表体一行的数值前缀：
 *  {0, "name", G_X, &color|0, HP, def, acc, {min,max,clump}, regen, move, attack, ... */
const ROW_RE = /\{\s*0\s*,\s*"([^"]+)"\s*,\s*G_[A-Z0-9_]+\s*,\s*(?:&[A-Za-z0-9_]+|0|NULL)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*\{\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\}\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,/g;

function parseCeCatalog(globalsCPath) {
    const text = fs.readFileSync(globalsCPath, 'utf8');
    const startMarker = 'creatureType monsterCatalog[';
    const start = text.indexOf(startMarker);
    if (start < 0) throw new Error('Globals.c 中找不到 monsterCatalog');
    const endMarker = 'const monsterWords monsterText[';
    const end = text.indexOf(endMarker, start);
    const body = text.slice(start, end > 0 ? end : undefined);

    const lineNoOf = (idx) => text.slice(0, start + idx).split('\n').length;

    const rows = [];
    let m;
    while ((m = ROW_RE.exec(body)) !== null) {
        const name = m[1];
        if (name === 'you') continue; // 玩家行不是怪物
        rows.push({
            name,
            id: name.replace(/ /g, '_'),
            line: lineNoOf(m.index),
            hp: Number(m[2]),
            defense: Number(m[3]),
            accuracy: Number(m[4]),
            damageMin: Number(m[5]),
            damageMax: Number(m[6]),
            damageClump: Number(m[7]),
            regen: Number(m[8]),        // CE turnsBetweenRegen
            moveSpeed: Number(m[9]),    // CE movementSpeed
            attackSpeed: Number(m[10]),
        });
    }
    return rows;
}

function checkCe(globalsCPath) {
    const monsters = readJson(MONSTERS_PATH);
    const ceRows = parseCeCatalog(globalsCPath);
    const ceById = new Map(ceRows.map((r) => [r.id, r]));
    console.log(`CE monsterCatalog 解析到 ${ceRows.length} 条怪物（不含玩家行）`);
    console.log(`monsters.json 共 ${monsters.length} 条\n`);

    const statDiff = [];
    const hpDiff = [];
    const dmgDiff = [];
    let matched = 0;
    const webOnly = [];

    for (const mon of monsters) {
        const ce = ceById.get(mon.id);
        if (!ce) {
            webOnly.push(mon.id);
            continue;
        }
        matched++;
        for (const f of STAT_FIELDS) {
            if (mon[f] !== ce[f]) {
                statDiff.push(`${mon.id} | ${f} | json=${mon[f]} | CE=${ce[f]} | Globals.c:${ce.line}`);
            }
        }
        if (mon.hp !== ce.hp) {
            hpDiff.push(`${mon.id} | hp | json=${mon.hp} | CE=${ce.hp} | Globals.c:${ce.line}`);
        }
        // web damage "XdY" vs CE damage{min,max,clump}：比对 min/max（clump web 侧不存）
        const dm = /^(\d+)d(\d+)$/.exec(String(mon.damage));
        if (!dm) {
            dmgDiff.push(`${mon.id} | damage | json="${mon.damage}"(无法解析) | CE={${ce.damageMin},${ce.damageMax},${ce.damageClump}} | Globals.c:${ce.line}`);
        } else if (Number(dm[1]) !== ce.damageMin || Number(dm[2]) !== ce.damageMax) {
            dmgDiff.push(`${mon.id} | damage | json="${mon.damage}" | CE={${ce.damageMin},${ce.damageMax},${ce.damageClump}} | Globals.c:${ce.line}`);
        }
    }

    const ceOnly = ceRows.filter((r) => !monsters.some((mo) => mo.id === r.id)).map((r) => r.name);

    console.log(`== 五字段差异（json vs CE，应全部消除）: ${statDiff.length} 处`);
    statDiff.forEach((l) => console.log('  ' + l));
    console.log(`\n== hp 差异（只列不修）: ${hpDiff.length} 处`);
    hpDiff.forEach((l) => console.log('  ' + l));
    console.log(`\n== damage 差异（只列不修）: ${dmgDiff.length} 处`);
    dmgDiff.forEach((l) => console.log('  ' + l));
    console.log(`\n逐条匹配 ${matched}/${monsters.length} 条；web 自创(CE 无对应,数值未核): ${webOnly.length ? webOnly.join(', ') : '无'}`);
    if (ceOnly.length) console.log(`CE 有而 web 表没有: ${ceOnly.join(', ')}`);
    console.log(`\n结论: ${statDiff.length === 0 ? '五字段与 CE 完全一致 ✅' : '存在与 CE 不一致的五字段 ❌'}`);
    return statDiff.length === 0 && hpDiff.length === 0 ? 0 : 1;
}

function dumpCe(globalsCPath) {
    const monsters = readJson(MONSTERS_PATH);
    const jsonById = new Map(monsters.map((m) => [m.id, m]));
    const ceRows = parseCeCatalog(globalsCPath);
    console.log('| # | id | acc | def | regen | move | atk | Globals.c | 一致 |');
    console.log('|---|----|-----|-----|-------|------|-----|-----------|------|');
    let allOk = true;
    ceRows.forEach((ce, i) => {
        const mon = jsonById.get(ce.id);
        if (!mon) {
            allOk = false;
            console.log(`| ${i + 1} | ${ce.id} | - | - | - | - | - | L${ce.line} | ❌ json 表无此 id |`);
            return;
        }
        const ok = STAT_FIELDS.every((f) => mon[f] === ce[f]);
        if (!ok) allOk = false;
        console.log(`| ${i + 1} | ${ce.id} | ${mon.accuracy}=${ce.accuracy} | ${mon.defense}=${ce.defense} | ${mon.regen}=${ce.regen} | ${mon.moveSpeed}=${ce.moveSpeed} | ${mon.attackSpeed}=${ce.attackSpeed} | L${ce.line} | ${ok ? '✅' : '❌'} |`);
    });
    console.log(`\n共 ${ceRows.length} 条；${allOk ? '全部与 CE 一致 ✅' : '存在不一致 ❌'}`);
}

function main() {
    const args = process.argv.slice(2);
    if (args[0] === '--check-ce') {
        const globalsC = args[1];
        if (!globalsC || !fs.existsSync(globalsC)) {
            console.error('用法: node scripts/merge_monster_stats.cjs --check-ce <path/to/Globals.c>');
            process.exit(2);
        }
        process.exit(checkCe(globalsC));
    } else if (args[0] === '--dump-ce') {
        const globalsC = args[1];
        if (!globalsC || !fs.existsSync(globalsC)) {
            console.error('用法: node scripts/merge_monster_stats.cjs --dump-ce <path/to/Globals.c>');
            process.exit(2);
        }
        dumpCe(globalsC);
    } else if (args.length === 0) {
        merge();
    } else {
        console.error('用法: node scripts/merge_monster_stats.cjs [--check-ce <Globals.c> | --dump-ce <Globals.c>]');
        process.exit(2);
    }
}

main();
