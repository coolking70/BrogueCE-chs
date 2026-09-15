/**
 * src/test/p1_30_i18n_gate.test.ts — i18n 键存在性红灯 + 变异名拼接 + 实跑冒烟。
 *
 * 背景（ai_docs/i18n_risk_assessment.md §5.1–5.2 / P1-30 任务书）：
 * i18next 的 defaultValue 让缺翻译完全静默——缺键时直接渲染英文，不报错不告警。
 * 本文件把这条无声通道变成红灯：
 *  1. 静态扫描 src/ 全部 i18next.t() / $t() 调用，断言每个键都存在于
 *     zh_CN.json（扫描器见 i18n_scan.ts；动态键用前缀白名单与同文件追踪处理）；
 *  2. 数据驱动的 name.* 键全覆盖检查（归档误删 name.* 会让怪物/物品名集体
 *     变英文，这里按数据文件逐名核对）；
 *  3. 变异名拼接：中文下必须是"爆裂的老鼠"，不得含英文字母或多余空格；
 *  4. 实跑若干回合：包装 i18next.t，任何一次命中缺失键（exists=false）都算红。
 *
 * 本文件刻意用**真实 zh_CN 资源**初始化 i18next（与 harness 的空资源约定相反）：
 * 拼接与冒烟检查要验证的就是真实文案。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import i18next, { type TOptions } from 'i18next';

import zhCN from '../locales/zh_CN.json';
import { scanI18nUsage } from './i18n_scan';
import monstersJson from '../data/monsters.json';
import weaponsJson from '../data/weapons.json';
import armorsJson from '../data/armors.json';
import consumablesJson from '../data/consumables.json';
import arcanaJson from '../data/arcana.json';
import mutationsJson from '../data/mutations.json';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { logger } from '../engine/Systems/Logger';
import { Monster, type MonsterData, type MutationData } from '../entities/Monster';
import { createHeadlessGame, runTurns } from './harness';

const REPO_SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const RESOURCE = zhCN as Record<string, string>;

// 本文件所有用例都用真实 zh_CN 资源。i18next 未初始化时（其他 test 文件的
// 模块图与本文件隔离，vitest 默认 isolate）这里就是第一次也是唯一一次 init。
if (!i18next.isInitialized) {
    i18next.init({
        lng: 'zh_CN',
        fallbackLng: 'zh_CN',
        resources: { zh_CN: { translation: zhCN } },
        initImmediate: false, // 同步初始化
    });
}

describe('P1-30 键存在性红灯：源码引用的每个 i18n 键必须存在于 zh_CN.json', () => {
    const result = scanI18nUsage(REPO_SRC, RESOURCE);

    it('扫描覆盖了引擎、实体与界面（不含测试文件自身）', () => {
        expect(result.filesScanned.length).toBeGreaterThan(30);
        expect(result.filesScanned.some(f => f.endsWith('.vue'))).toBe(true);
        expect(result.filesScanned.some(f => f.startsWith('engine/'))).toBe(true);
        expect(result.filesScanned.some(f => f.startsWith('test/'))).toBe(false);
        // 静态字面量键的量级护栏：若扫描器退化（正则失配、文件遍历坏了），
        // 这里的下限会先红，而不是让"零缺失"假绿。
        expect(result.literals.size).toBeGreaterThan(250);
    });

    it('每个静态字面量键都存在（缺失即红）', () => {
        const missing = result.missing.map(m => {
            const locs = m.locs.map(l => `${l.file}:${l.line}`).join(', ');
            return `  ${m.key}  ←  ${locs}`;
        });
        expect(missing, `缺失翻译键 ${missing.length} 个（缺键会静默渲染英文defaultValue）：\n${missing.join('\n')}`)
            .toEqual([]);
    });

    it('每个动态键前缀下至少有一个真实键（防前缀打错字整组落空）', () => {
        const empty = result.emptyPrefixes.map(e => {
            const locs = e.locs.map(l => `${l.file}:${l.line}`).join(', ');
            return `  "${e.prefix}*"  ←  ${locs}`;
        });
        expect(empty, `前缀在 zh_CN.json 里一个键都盖不到：\n${empty.join('\n')}`).toEqual([]);
    });

    it('所有 t() 调用的首参都可静态解析（新调用点必须写成可扫描形式）', () => {
        const bad = result.unresolved.map(u => `  ${u.file}:${u.line}  ${u.reason}\n    ${u.snippet}`);
        expect(bad, `无法解析的 t() 调用 ${bad.length} 个：\n${bad.join('\n')}`).toEqual([]);
    });

    it('zh_CN.json 没有从未被引用的死键（发现死键应移入 zh_CN.legacy.json 归档）', () => {
        expect(result.unreferenced, `未被引用的键 ${result.unreferenced.length} 个，应归档到 zh_CN.legacy.json（前 20 个）：\n  ${result.unreferenced.slice(0, 20).join('\n  ')}`)
            .toEqual([]);
    });
});

describe('P1-30 数据驱动的 name.* 键覆盖（防归档误删：误删 = 怪物/物品名集体变英文）', () => {
    interface Named { name?: string; trueName?: string }

    const names: string[] = [];
    for (const m of monstersJson as Named[]) if (m.name) names.push(m.name);
    for (const w of weaponsJson as Named[]) if (w.name) names.push(w.name);
    for (const a of armorsJson as Named[]) if (a.name) names.push(a.name);
    const cons = consumablesJson as Record<string, Named[]>;
    for (const pool of ['potions', 'scrolls', 'food']) {
        for (const c of cons[pool] ?? []) if (c.trueName) names.push(c.trueName);
    }
    const arc = arcanaJson as Record<string, Named[]>;
    for (const pool of ['wands', 'staffs', 'rings', 'charms', 'keys', 'amulets']) {
        for (const a of arc[pool] ?? []) if (a.name) names.push(a.name);
    }
    // 随机外观名（药水颜色 / 魔杖金属 / 法杖木材 / 戒指宝石 / 护符材质）
    names.push(...ItemLoader.potionColors.map(p => p.name));
    names.push(...ItemLoader.wandFlavorNames, ...ItemLoader.staffFlavorNames);
    names.push(...ItemLoader.ringFlavorNames, ...ItemLoader.charmFlavorNames);

    it('英文形式的名字必须有 name.* 键且译文含中文（中文名原样返回，无需键）', () => {
        // ItemLoader 约定：外观池新词条直接存中文显示名，tn() 对无键字符串原样
        // 返回——所以只对含 ASCII 字母的英文名强制要求键；中文名反而不应被
        // 误加键（tn 会命中 name.中文 无意义键）。
        const needKey = names.filter(n => /[A-Za-z]/.test(n));
        const missing = needKey.filter(n => !RESOURCE['name.' + n]);
        const noCjk = needKey.filter(n => {
            const v = RESOURCE['name.' + n];
            return v !== undefined && !/[\u4e00-\u9fff]/.test(v);
        });
        expect(missing, `缺 name.* 键 ${missing.length} 个：\n  ${missing.map(n => 'name.' + n).join('\n  ')}`).toEqual([]);
        expect(noCjk, `name.* 译文不含中文 ${noCjk.length} 个：\n  ${noCjk.map(n => `name.${n} => ${RESOURCE['name.' + n]}`).join('\n  ')}`).toEqual([]);
    });
});

describe('P1-30 变异名拼接：中文语序，无英文残留、无多余空格', () => {
    const mutations = mutationsJson as unknown as MutationData[];
    // 覆盖浅中深各层的若干怪物（含双字/多字中文名）
    const guineaPigIds = ['rat', 'kobold', 'jackal', 'goblin', 'pink_jelly', 'troll', 'wraith', 'dragon'];
    const allMonsters = monstersJson as unknown as MonsterData[];

    it.each(guineaPigIds)('8 个变异 × %s：拼接结果 = 资源键插值，无英文/无空格', (id) => {
        const data = allMonsters.find(m => m.id === id);
        expect(data, `monsters.json 里找不到 id=${id}`).toBeTruthy();
        for (const mut of mutations) {
            const mon = new Monster(0, 0, data!);
            const baseName = mon.name; // 构造时已经过 translateName
            expect(baseName, `${id} 的基础名应已翻译为中文`).toMatch(/^[^A-Za-z]+$/);

            mon.mutate(mut);
            const expected = (RESOURCE['mutation.' + mut.id] ?? '').replace('{{name}}', baseName);
            expect(mon.name).toBe(expected);
            expect(mon.name, '不得含英文字母').not.toMatch(/[A-Za-z]/);
            expect(mon.name, '不得含任何空白字符').not.toMatch(/\s/);
        }
    });

    it('8 个变异名资源键全部存在（缺失时拼接会回退英文）', () => {
        for (const mut of mutations) {
            expect(RESOURCE['mutation.' + mut.id], `缺 mutation.${mut.id}`).toBeTruthy();
        }
    });
});

describe('P1-30 实跑冒烟：真实资源下推进回合，任何 t() 命中缺失键即红', () => {
    let origT: typeof i18next.t;
    const violations: string[] = [];
    const rawKeyLogs: string[] = [];
    // t() 整串返回键名的形状（缺键且无 defaultValue 时 i18next 的行为）
    const KEY_SHAPE = /^[a-z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/;

    beforeAll(() => {
        origT = i18next.t.bind(i18next);
        (i18next as { t: unknown }).t = (key: string | string[], opts?: TOptions) => {
            const res = origT(key, opts);
            const first = Array.isArray(key) ? key[0] : key;
            if (typeof first === 'string' && !i18next.exists(first, opts)) {
                // ItemLoader.tn() 的既有契约：name.<X> 无键时以 defaultValue=X
                // 原样返回（外观池的中文名就是这么透传的，渲染仍是中文）。
                // 只有"缺键且 defaultValue 是英文"才是真漏键（会渲染英文）。
                const passthrough = (opts as { defaultValue?: string } | undefined)?.defaultValue;
                const isCjkNamePassthrough =
                    first.startsWith('name.') &&
                    passthrough === first.slice('name.'.length) &&
                    !/[A-Za-z]/.test(passthrough ?? '');
                if (!isCjkNamePassthrough) violations.push(first);
            }
            return res;
        };
    });

    afterAll(() => {
        (i18next as { t: unknown }).t = origT;
    });

    it('3 个 seed × 400 回合：无漏键、日志无裸键串', () => {
        let logCount = 0;
        const capture = (text: string) => {
            logCount++;
            if (KEY_SHAPE.test(text.trim())) rawKeyLogs.push(text);
        };
        for (const seed of [20260915, 42, 777]) {
            const game = createHeadlessGame(seed);
            // 包装 logger 单例的实例方法捕获全部消息（runTurns 内部还有一层
            // 计数包装，链式叠加：它的 originalLog 绑定的正是这里的包装）
            const prev = logger.log.bind(logger);
            logger.log = (text: string, color?: string) => { capture(text); prev(text, color); };
            try {
                const result = runTurns(game, 400);
                expect(result.turnsRun).toBeGreaterThan(0);
            } finally {
                delete (logger as { log?: unknown }).log;
            }
        }
        expect(logCount, '冒烟应产生足量日志以覆盖文案路径').toBeGreaterThan(20);
        expect(violations, `实跑中命中缺失键 ${violations.length} 次：\n  ${[...new Set(violations)].join('\n  ')}`)
            .toEqual([]);
        expect(rawKeyLogs, `日志出现裸键串（缺键且无 defaultValue）：\n  ${[...new Set(rawKeyLogs)].join('\n  ')}`)
            .toEqual([]);
    });
});
