import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parse as parseSfc } from '@vue/compiler-sfc';
import { parse as parseTemplate } from '@vue/compiler-dom';
import i18next from 'i18next';
import zhCN from '../locales/zh_CN.json';
import { Item, ItemCategory } from '../engine/Items/Item';
import { generateItemDetail } from '../engine/UI/DetailGenerator';
import { getDiscoveries } from '../engine/UI/Discoveries';
import { ItemLoader } from '../engine/Items/ItemLoader';

if (!i18next.isInitialized) i18next.init({
  lng: 'zh_CN', fallbackLng: 'zh_CN', resources: { zh_CN: { translation: zhCN } }, initImmediate: false,
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files: string[] = [];
function walk(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'test') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if ((extname(path) === '.ts' || extname(path) === '.vue') && !path.endsWith('.test.ts')) files.push(path);
  }
}
walk(root);

// Developer-only controls deliberately retain their compact English field labels.
const templateAllowlist: Record<string, string[]> = {
  'components/AgentControls.vue': ['Depth:', 'HP:', 'Max HP:', 'X:', 'Y:', 'Statuses:', '(HP:', ') at', '(Dist:'],
  'components/Sidebar.vue': ['BROGUE', 'JS', 'x'], // brand and repetition marker
};
// These glyphs and numeric deltas convey data, not language-specific prose.
const floatingAllowlist = new Set(['!', '?']);

function literalText(node: ts.Expression): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map(s => s.literal.text).join('');
  return null;
}

describe('U24 free-text guard', () => {
  it('renders discovery names and identified runes in Chinese without internal IDs', () => {
    const discoveries = getDiscoveries().flatMap(group => group.rows);
    expect(discoveries.length).toBeGreaterThan(30);
    expect(discoveries.filter(row => /[A-Za-z]/.test(row.name))).toEqual([]);

    const item = new Item('匕首', ')', 0xffffff, ItemCategory.WEAPON);
    item.runicType = 'paralyzing';
    item.runicKnown = true;
    expect(item.displayName).toContain('{麻痹}');
    expect(item.displayName).not.toContain('paralyzing');
    const headers = generateItemDetail(item, 12).sections.map(section => section.header ?? '');
    expect(headers).toContain('附魔: 麻痹');
    for (const id of [...ItemLoader.ALL_WEAPON_RUNICS, ...ItemLoader.ALL_ARMOR_RUNICS]) {
      expect(zhCN[`runic.name.${id}` as keyof typeof zhCN]).toMatch(/[\u4e00-\u9fff]/);
    }
  });

  it('requires translated floating labels and logger messages', () => {
    const bad: string[] = [];
    let checked = 0;
    for (const file of files) {
      const raw = readFileSync(file, 'utf8');
      const script = extname(file) === '.vue' ? parseSfc(raw).descriptor.scriptSetup?.content ?? parseSfc(raw).descriptor.script?.content ?? '' : raw;
      const source = ts.createSourceFile(file, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const rel = relative(root, file).replace(/\\/g, '/');
      function visit(node: ts.Node) {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.arguments.length) {
          const name = node.expression.name.text;
          const isFloat = name === 'spawnFloatingText';
          const isLog = name === 'log' && node.expression.expression.getText(source) === 'logger';
          if (isFloat || isLog) {
            checked++;
            const value = literalText(node.arguments[0] as ts.Expression);
            if (value !== null && /[A-Za-z\u4e00-\u9fff]/.test(value) && !(isFloat && floatingAllowlist.has(value))) {
              bad.push(`${rel}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${value}`);
            }
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    expect(checked).toBeGreaterThan(200);
    expect(bad).toEqual([]);
  });

  it('requires translated Vue template text', () => {
    const bad: string[] = [];
    let checked = 0;
    for (const file of files.filter(f => f.endsWith('.vue'))) {
      const rel = relative(root, file).replace(/\\/g, '/');
      const template = parseSfc(readFileSync(file, 'utf8')).descriptor.template?.content;
      if (!template) continue;
      function visit(node: { type: number; content?: string; children?: unknown[] }) {
        if (node.type === 2) {
          const value = (node.content ?? '').trim();
          if (value && /[A-Za-z\u4e00-\u9fff]/.test(value)) {
            checked++;
            if (!templateAllowlist[rel]?.includes(value)) bad.push(`${rel}: ${value}`);
          }
        }
        for (const child of node.children ?? []) visit(child as typeof node);
      }
      visit(parseTemplate(template));
    }
    expect(checked).toBeGreaterThan(10);
    expect(bad).toEqual([]);
  });
});
