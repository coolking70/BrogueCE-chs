/**
 * src/test/i18n_scan.ts — i18n 键引用扫描器（纯静态分析，无 vitest / i18next 依赖）。
 *
 * P1-30 引入，见 ai_docs/p1_30_i18n_gate_report.md。职责：
 *  1. 找出 src/ 下所有 i18next.t(...) / $t(...) 调用点，解析第一个实参；
 *  2. 与 zh_CN.json 比对，产出「缺失键」（红灯依据）与「从未被引用的键」（归档依据）。
 *
 * 动态键的处理（防漏报与误报的核心设计）：
 *  - 静态字面量：t('combat.hit', …) → 精确键，必须存在于资源文件；
 *  - 拼接 / 模板插值：t('name.' + name)、t(`menu.mode.${mode}`) → 只能确定
 *    静态前缀（'name.' / 'menu.mode.'），登记为前缀引用：该前缀下的资源键
 *    一律视为「被引用」（归档时保留），且断言前缀下至少存在 1 个键（防前缀
 *    打错字导致整组静默落空）；
 *  - 首参不是可解析的字符串表达式（变量、函数调用等）→ 记入 unresolved，
 *    测试对它亮红灯：新增调用点必须写成可扫描的形式，或扩展本扫描器。
 *  - 拼接结果若解析出空前缀（插值在开头且无静态文本）同样按 unresolved 处理：
 *    空前缀等于"全部键都被引用"，会让归档与缺失检查双双失明，绝不接受。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export interface KeyLocation {
    file: string;
    line: number;
    /** 调用点单行截断片段，报告用 */
    snippet: string;
}

export type ArgResolution =
    | { kind: 'literal'; key: string }
    | { kind: 'prefix'; prefix: string }
    | { kind: 'unresolved'; reason: string };

/** 解析成功的一个候选键（三元两分支、多调用点实参会产出多个候选）。 */
type KeyCandidate = { kind: 'literal'; key: string } | { kind: 'prefix'; prefix: string };

/** 解析结果：一个实参可对应多个候选键。 */
type Candidates = { candidates: KeyCandidate[] } | { unresolved: string };

export interface ScanResult {
    /** 参与扫描的文件（相对 srcDir，POSIX 分隔符） */
    filesScanned: string[];
    /** 静态字面量键 → 出现位置 */
    literals: Map<string, KeyLocation[]>;
    /** 动态键的静态前缀 → 出现位置 */
    prefixes: Map<string, KeyLocation[]>;
    /** 无法解析首参的调用点（测试视为红灯） */
    unresolved: (KeyLocation & { reason: string })[];
    /** 被代码引用但资源文件里不存在的键 */
    missing: { key: string; locs: KeyLocation[] }[];
    /** 资源文件里从未被引用的键（含点号前缀都不命中的） */
    unreferenced: string[];
    /** 前缀在资源文件里一个键都盖不到（前缀打错字的信号） */
    emptyPrefixes: { prefix: string; locs: KeyLocation[] }[];
}

const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.vue']);
/** 测试文件自身不参与扫描（测试里会出现故意的坏键）；界面 .vue 文件必须扫。 */
const TEST_FILE_PATTERN = /\.(test|spec)\.[cm]?[jt]sx?$/;

// ---------------------------------------------------------------------------
// 词法层：一个迷你状态机，跳过注释/字符串/正则字面量，只认「代码位」上的调用。
// ---------------------------------------------------------------------------

const CALL_START = /(?:\bi18next\s*\.\s*t|\$t)\s*\(/y;

/** 从 pos 起判定是否是 t( 调用，是则返回 '(' 之后的下标，否则返回 -1。 */
function matchCallStart(code: string, pos: number): number {
    CALL_START.lastIndex = pos;
    const m = CALL_START.exec(code);
    return m ? CALL_START.lastIndex : -1;
}

/**
 * 跳过一个正则字面量（除法歧义的保守启发：仅当前一个有效字符表明正处于
 * 「表达式位置」时才尝试）。返回跳过后的下标；不是正则则返回 -1。
 */
function skipRegexLiteral(code: string, pos: number): number {
    let i = pos + 1; // 越过开头的 /
    let inClass = false;
    while (i < code.length) {
        const c = code[i];
        if (c === '\\') { i += 2; continue; }
        if (c === '[') { inClass = true; i++; continue; }
        if (c === ']') { inClass = false; i++; continue; }
        if (c === '/' && !inClass) {
            i++;
            while (i < code.length && /[a-z]/i.test(code[i]!)) i++; // flags
            return i;
        }
        if (c === '\n') return -1; // 正则不跨行
        i++;
    }
    return -1;
}

/**
 * 跳过模板字符串中 ${ … } 的表达式体（含嵌套括号/字符串/模板）。
 * pos 指向 '{'。返回 '}' 之后的下标。
 */
function skipTemplateHole(code: string, pos: number): number {
    let depth = 1;
    let i = pos + 1;
    while (i < code.length && depth > 0) {
        const c = code[i];
        if (c === '{') { depth++; i++; continue; }
        if (c === '}') { depth--; i++; continue; }
        if (c === '\'' || c === '"') { i = skipQuoted(code, i, c); continue; }
        if (c === '`') { i = skipTemplate(code, i); continue; }
        if (c === '/' && code[i + 1] === '/') { i = code.indexOf('\n', i); if (i < 0) break; continue; }
        if (c === '/' && code[i + 1] === '*') { i = code.indexOf('*/', i); i = i < 0 ? code.length : i + 2; continue; }
        i++;
    }
    return i;
}

/** 跳过整个模板字符串（含嵌套 ${}）。pos 指向 `。返回结束 ` 之后的下标。 */
function skipTemplate(code: string, pos: number): number {
    let i = pos + 1;
    while (i < code.length) {
        const c = code[i];
        if (c === '\\') { i += 2; continue; }
        if (c === '`') return i + 1;
        if (c === '$' && code[i + 1] === '{') { i = skipTemplateHole(code, i + 1); continue; }
        i++;
    }
    return i;
}

/** 跳过引号字符串。pos 指向引号。返回结束引号之后的下标（找不到为 length）。 */
function skipQuoted(code: string, pos: number, quote: string): number {
    let i = pos + 1;
    while (i < code.length) {
        const c = code[i];
        if (c === '\\') { i += 2; continue; }
        if (c === quote) return i + 1;
        if (c === '\n') return i + 1; // 容错：未闭合的行内串
        i++;
    }
    return i;
}

/**
 * 主扫描：返回代码中所有 t( 调用点的 '(' 位置。
 * 只在代码态（非注释、非字符串/模板/正则内部）识别。
 */
function findCallSites(code: string): number[] {
    const hits: number[] = [];
    let i = 0;
    let prevMeaningful = ''; // 上一个非空白字符（判断正则/除法歧义用）
    while (i < code.length) {
        const c = code[i]!;
        const two = code.slice(i, i + 2);
        if (two === '//') { const nl = code.indexOf('\n', i); i = nl < 0 ? code.length : nl + 1; continue; }
        if (two === '/*') { const end = code.indexOf('*/', i + 2); i = end < 0 ? code.length : end + 2; continue; }
        if (c === '\'' || c === '"') { i = skipQuoted(code, i, c); prevMeaningful = c; continue; }
        if (c === '`') { i = skipTemplate(code, i); prevMeaningful = c; continue; }
        if (c === '/') {
            // 表达式位置上的 / 视为正则开头（含 = ( , : [ ! & | ? { ; return 等）
            const regexContext = prevMeaningful === '' || '=(,:[!&|?{};+-*%~^<>'.includes(prevMeaningful);
            if (regexContext) {
                const skipped = skipRegexLiteral(code, i);
                if (skipped > 0) { i = skipped; prevMeaningful = 'x'; continue; }
            }
            i++; prevMeaningful = '/'; continue;
        }
        if (c === 'i' || c === '$') {
            const afterParen = matchCallStart(code, i);
            if (afterParen > 0) {
                // 排除标识符尾巴（如 foo$i18next / x$i18next.t：词边界已由 \b 与 \$t
                // 前置条件保证，这里再确认前一个字符不是标识符成分）
                const prev = i > 0 ? code[i - 1]! : '';
                if (!/[\w$]/.test(prev)) {
                    hits.push(afterParen);
                }
            }
        }
        if (!/\s/.test(c)) prevMeaningful = c;
        i++;
    }
    return hits;
}

// ---------------------------------------------------------------------------
// 语法层：解析第一个实参为「字符串字面量表达式」（字面量 / 模板 / + 拼接）。
// ---------------------------------------------------------------------------

function decodeEscapes(raw: string): string {
    return raw.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (m, g1: string) => {
        if (g1.startsWith('u{') || g1.startsWith('u') || g1.startsWith('x')) {
            const hex = g1.replace(/[ux{}]/g, '');
            const cp = parseInt(hex, 16);
            return Number.isNaN(cp) ? m : String.fromCodePoint(cp);
        }
        switch (g1) {
            case 'n': return '\n';
            case 't': return '\t';
            case 'r': return '\r';
            case 'b': return '\b';
            case 'f': return '\f';
            case 'v': return '\v';
            case '0': return '\0';
            default: return g1; // \' \" \\ \` \$ 等
        }
    });
}

/**
 * 解析实参为候选键集合。支持的形态（按项目实际出现的模式）：
 *  - 字面量 / 模板 / + 拼接：t('a' + 'b', …)、t('name.' + name, …)
 *  - 三元：t(kind === 'weapon' ? 'a' : 'b', …)，条件任意、两支必须可解析
 *  - 裸标识符：交由 resolveIdentifier 在同文件内追踪（局部 const 赋值 /
 *    函数参数的调用点实参），追踪不到才算 unresolved。
 * 返回 endIndex = 实参结束位置（指向 terminator 字符）。
 */
function parseStringExpr(code: string, start: number, terminators: string[]): Candidates & { endIndex: number } {
    // —— 先探测三元：深度感知地找第一个顶层 '?'（排除 ?? 与 ?.）——
    const questionAt = findTopLevelChar(code, start, '?', terminators);
    if (questionAt > 0) {
        const branch1 = parseStringExpr(code, skipWs(code, questionAt + 1), [':']);
        if ('unresolved' in branch1) return { ...branch1, endIndex: questionAt };
        let i = skipWs(code, branch1.endIndex);
        if (code[i] !== ':') {
            return { unresolved: '三元表达式缺少 ":" 分支', endIndex: i };
        }
        const branch2 = parseStringExpr(code, skipWs(code, i + 1), terminators);
        if ('unresolved' in branch2) return { ...branch2, endIndex: i };
        return { candidates: [...branch1.candidates, ...branch2.candidates], endIndex: branch2.endIndex };
    }

    // —— 普通拼接：part := '…' | "…" | `…`，part 间用 + 连接 ——
    type Part = { text: string; hasHole: boolean };
    const parts: Part[] = [];
    let i = start;
    const skipWsLocal = () => { i = skipWs(code, i); };

    for (;;) {
        skipWsLocal();
        const c = code[i];
        if (c === '\'' || c === '"') {
            const end = skipQuoted(code, i, c);
            parts.push({ text: decodeEscapes(code.slice(i + 1, end - 1)), hasHole: false });
            i = end;
        } else if (c === '`') {
            let j = i + 1;
            let chunk = '';
            let hole = false;
            while (j < code.length) {
                const ch = code[j]!;
                if (ch === '\\') { chunk += decodeEscapes(code.slice(j, j + 2)); j += 2; continue; }
                if (ch === '`') { j++; break; }
                if (ch === '$' && code[j + 1] === '{') {
                    hole = true;
                    j = skipTemplateHole(code, j + 1);
                    continue;
                }
                chunk += ch;
                j++;
            }
            parts.push({ text: chunk, hasHole: hole });
            i = j;
        } else {
            break;
        }
        skipWsLocal();
        if (code[i] === '+') { i++; continue; }
        break;
    }

    if (parts.length === 0) {
        return { unresolved: '首参不是字符串字面量/模板/三元（可能是变量，需追踪）', endIndex: i };
    }
    skipWsLocal();
    const terminated = terminators.includes(code[i] ?? '');

    if (!terminated) {
        // 形如 t('name.' + dynamicRest)：静态部分是前缀，动态尾巴不必解析
        const staticText = parts.map(p => p.text).join('');
        if (staticText !== '' && staticText.endsWith('.')) {
            return { candidates: [{ kind: 'prefix', prefix: staticText }], endIndex: i };
        }
        return { unresolved: '首参混合了不可解析的表达式', endIndex: i };
    }

    const anyHole = parts.some(p => p.hasHole);
    if (!anyHole) {
        return {
            candidates: [{ kind: 'literal', key: parts.map(p => p.text).join('') }],
            endIndex: i,
        };
    }
    // 有插值/拼接尾巴：静态文本是「前缀」，其下所有键视为被引用（宁多勿漏——
    // 前缀多圈键只会让归档保守，绝不会让缺失检查漏报）。
    const prefix = parts.map(p => p.text).join('');
    if (prefix === '' || !prefix.endsWith('.')) {
        return {
            unresolved: `动态键的静态前缀为${prefix === '' ? '空' : '不以点号结尾'}（"${prefix}"），无法安全圈定键集合`,
            endIndex: i,
        };
    }
    return { candidates: [{ kind: 'prefix', prefix }], endIndex: i };
}

function skipWs(code: string, i: number): number {
    while (i < code.length && /\s/.test(code[i]!)) i++;
    return i;
}

/** 深度感知地找 start 之后第一个顶层字符 target（跳过字符串/模板/注释/嵌套；排除 ?? 与 ?.）。遇到 terminators 先于 target 则返回 -1。 */
function findTopLevelChar(code: string, start: number, target: string, terminators: string[]): number {
    let depth = 0;
    let i = start;
    while (i < code.length) {
        const c = code[i]!;
        if (c === '\'' || c === '"') { i = skipQuoted(code, i, c); continue; }
        if (c === '`') { i = skipTemplate(code, i); continue; }
        if (c === '/' && code[i + 1] === '/') { const nl = code.indexOf('\n', i); i = nl < 0 ? code.length : nl + 1; continue; }
        if (c === '/' && code[i + 1] === '*') { const end = code.indexOf('*/', i); i = end < 0 ? code.length : end + 2; continue; }
        if ('([{'.includes(c)) { depth++; i++; continue; }
        if (')]}'.includes(c)) { if (depth === 0) return -1; depth--; i++; continue; }
        if (depth === 0 && terminators.includes(c)) return -1;
        if (depth === 0 && c === target) {
            if (code[i + 1] === '?' || code[i + 1] === '.') { i += 2; continue; } // ?? / ?.
            if (code[i - 1] === '?') { i++; continue; } // ?? 的后半
            return i;
        }
        i++;
    }
    return -1;
}

/**
 * 标识符追踪（同文件，启发式，宁多勿漏）：
 *  A. 局部赋值：const|let|var <ident> = <字符串表达式/三元>；
 *  B. 函数参数：<ident> 出现在某参数表中（形如 "ident: 类型"）→ 向左找参数表
 *     的 '(' 与函数名，再在文件里找该函数的所有调用点，取对应位置的实参解析。
 * 两路候选取并集；非「点号键」形状的候选丢弃（本项目所有 i18n 键都是点号键，
 * 参数追踪是启发式，混入的杂音字符串可能是任何东西）。
 */
function resolveIdentifierCandidates(code: string, ident: string): KeyCandidate[] {
    const out: KeyCandidate[] = [];
    const KEY_SHAPE = /^[a-z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/;

    // A. 局部赋值
    const assignRe = new RegExp(`\\b(?:const|let|var)\\s+${ident}\\s*=`, 'g');
    for (let m = assignRe.exec(code); m; m = assignRe.exec(code)) {
        const r = parseStringExpr(code, skipWs(code, m.index + m[0].length), [';', ')', ',', '}']);
        if ('candidates' in r) out.push(...r.candidates.filter(c => c.kind === 'literal' && KEY_SHAPE.test(c.key)));
    }

    // B. 参数表：找 "<ident>[?]:"，向左回溯参数表的 '('
    const paramRe = new RegExp(`[(,]\\s*${ident}\\s*[?:]`, 'g');
    for (let m = paramRe.exec(code); m; m = paramRe.exec(code)) {
        // m.index 指向 '(' 或 ','——回溯到所属参数表开头的 '('
        let depth = 0;
        let p = m.index;
        let openParen = -1;
        while (p >= 0) {
            const ch = code[p];
            if (ch === ')') depth++;
            else if (ch === '(') {
                if (depth === 0) { openParen = p; break; }
                depth--;
            } else if (ch === ';' || ch === '{' || ch === '}') { break; } // 穿过函数体说明不是参数表
            p--;
        }
        if (openParen < 0) continue;
        // '(' 与 ident 之间必须是参数表内容（无语句成分）
        const between = code.slice(openParen + 1, m.index);
        if (/[;{}]/.test(between)) continue;
        // 函数名 = '(' 前面的标识符（允许 const f = (…) => 的 '=' 缝隙）
        let e = openParen;
        while (e > 0 && /\s/.test(code[e - 1]!)) e--;
        if (code[e - 1] === '=') { e--; while (e > 0 && /\s/.test(code[e - 1]!)) e--; }
        let s = e;
        while (s > 0 && /[\w$]/.test(code[s - 1]!)) s--;
        const callee = code.slice(s, e);
        if (!callee || !/^[\w$]+$/.test(callee)) continue;
        // 参数序号 = ident 之前的参数个数（between 恰好截止到 ident 前的逗号，
        // 其顶层逗号数 + 1 即序号；between 为空说明 ident 是第一个参数）
        const paramIndex = between === '' ? 0 : splitTopLevel(between, ',').length;
        // 找调用点
        const callRe = new RegExp(`\\b${callee}\\s*\\(`, 'g');
        for (let c = callRe.exec(code); c; c = callRe.exec(code)) {
            const open = c.index + c[0].length - 1;
            const args = splitCallArgs(code, open);
            const arg = args[paramIndex];
            if (!arg) continue;
            const r = parseStringExpr(code, skipWs(code, arg.start), [',', ')']);
            if ('candidates' in r) out.push(...r.candidates.filter(cand => cand.kind === 'literal' && KEY_SHAPE.test(cand.key)));
        }
    }
    return dedupe(out);
}

function dedupe(cands: KeyCandidate[]): KeyCandidate[] {
    const seen = new Set<string>();
    return cands.filter(c => {
        const k = c.kind + ':' + (c.kind === 'literal' ? c.key : c.prefix);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

/** 按 top-level 分隔符切分字符串（深度感知，用于参数列表）。 */
function splitTopLevel(text: string, sep: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let cur = '';
    for (let i = 0; i < text.length; i++) {
        const c = text[i]!;
        if (c === '\'' || c === '"') { const end = skipQuoted(text, i, c); cur += text.slice(i, end); i = end - 1; continue; }
        if (c === '`') { const end = skipTemplate(text, i); cur += text.slice(i, end); i = end - 1; continue; }
        if ('([{<'.includes(c)) depth++;
        if (')]}'.includes(c)) depth--;
        if (c === sep && depth === 0) { parts.push(cur); cur = ''; continue; }
        cur += c;
    }
    parts.push(cur);
    return parts;
}

/** 给定调用点的 '(' 下标，切出各实参的 [start, end) 区间。 */
function splitCallArgs(code: string, openParen: number): { start: number; end: number }[] {
    let depth = 0;
    const args: { start: number; end: number }[] = [];
    let curStart = openParen + 1;
    let i = openParen + 1;
    while (i < code.length) {
        const c = code[i]!;
        if (c === '\'' || c === '"') { i = skipQuoted(code, i, c); continue; }
        if (c === '`') { i = skipTemplate(code, i); continue; }
        if (c === '/' && code[i + 1] === '/') { const nl = code.indexOf('\n', i); i = nl < 0 ? code.length : nl + 1; continue; }
        if (c === '/' && code[i + 1] === '*') { const end = code.indexOf('*/', i); i = end < 0 ? code.length : end + 2; continue; }
        if ('([{'.includes(c)) depth++;
        else if (')]}'.includes(c)) {
            if (c === ')' && depth === 0) { args.push({ start: curStart, end: i }); break; }
            depth--;
        } else if (c === ',' && depth === 0) {
            args.push({ start: curStart, end: i });
            curStart = i + 1;
        }
        i++;
    }
    return args.filter(a => code.slice(a.start, a.end).trim() !== '');
}

// ---------------------------------------------------------------------------
// 文件遍历与结果汇总
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[]): void {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
            if (entry === 'test') continue; // src/test/ 整目录排除（扫描器与测试自身）
            walk(full, out);
        } else if (SCAN_EXTENSIONS.has(full.slice(full.lastIndexOf('.')))) {
            if (TEST_FILE_PATTERN.test(entry) || entry.endsWith('.d.ts')) continue;
            out.push(full);
        }
    }
}

export function scanI18nUsage(srcDir: string, resource: Record<string, string>): ScanResult {
    const files: string[] = [];
    walk(srcDir, files);
    files.sort();

    const literals = new Map<string, KeyLocation[]>();
    const prefixes = new Map<string, KeyLocation[]>();
    const unresolved: (KeyLocation & { reason: string })[] = [];

    for (const file of files) {
        const rel = relative(srcDir, file).split(sep).join('/');
        const code = readFileSync(file, 'utf-8');
        for (const paren of findCallSites(code)) {
            const line = code.slice(0, paren).split('\n').length;
            const snippet = code.slice(Math.max(0, paren - 60), paren + 40).replace(/\s+/g, ' ').trim();
            const loc: KeyLocation = { file: rel, line, snippet };
            let parsed = parseStringExpr(code, paren, [',', ')']);
            if ('unresolved' in parsed) {
                // 首参若以裸标识符开头，尝试同文件追踪（局部 const / 函数参数实参）
                const ident = /^\s*([A-Za-z_$][\w$]*)/.exec(code.slice(paren, paren + 200))?.[1];
                if (ident) {
                    const traced = resolveIdentifierCandidates(code, ident);
                    if (traced.length > 0) {
                        parsed = { candidates: traced, endIndex: paren };
                    } else {
                        unresolved.push({
                            ...loc,
                            reason: `首参变量 "${ident}" 追踪不到字面量候选（既无同文件 const 赋值，参数实参也解析不出）`,
                        });
                        continue;
                    }
                } else {
                    unresolved.push({ ...loc, reason: parsed.unresolved });
                    continue;
                }
            }
            for (const cand of parsed.candidates) {
                if (cand.kind === 'literal') {
                    const arr = literals.get(cand.key) ?? [];
                    arr.push(loc);
                    literals.set(cand.key, arr);
                } else {
                    const arr = prefixes.get(cand.prefix) ?? [];
                    arr.push(loc);
                    prefixes.set(cand.prefix, arr);
                }
            }
        }
    }

    const resourceKeys = Object.keys(resource);
    const isReferenced = (k: string) =>
        literals.has(k) || [...prefixes.keys()].some(p => k.startsWith(p));

    const missing = [...literals.keys()].filter(k => !(k in resource))
        .map(key => ({ key, locs: literals.get(key)! }));
    const unreferenced = resourceKeys.filter(k => !isReferenced(k)).sort();
    const emptyPrefixes = [...prefixes.entries()]
        .filter(([p]) => !resourceKeys.some(k => k.startsWith(p)))
        .map(([prefix, locs]) => ({ prefix, locs }));

    return {
        filesScanned: files.map(f => relative(srcDir, f).split(sep).join('/')),
        literals, prefixes, unresolved, missing, unreferenced, emptyPrefixes,
    };
}
