"""Minimal old-premise updates, gated by unchanged original guards passing
under R3-production-only rollback. The patch is retained for adjudication.
"""
from pathlib import Path
import hashlib
import json
import subprocess

out = Path('ai_docs/reports/x4-r3-evidence')
raw = Path('output/x4-r3')
proof = json.loads((raw / 'counterfactual-old-tests.json').read_text(encoding='utf-8'))
assert proof['success'] and proof['numFailedTests'] == 0
manifest = json.loads((out / 'counterfactual-manifest.json').read_text(encoding='utf-8'))
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
for path, digest in manifest['tests'].items():
    assert sha(path) == digest, f'Old guard changed before proof: {path}'
for row in manifest['sources'] + manifest['added']:
    assert sha(row['file']) == row['final'], row['file']
assert not (out / 'premise-updates.json').exists(), 'Do not apply twice'
records = []


def update(file, replacements, reason):
    path = Path(file) if file.startswith('src/') else Path('src/test') / file
    before = path.read_text(encoding='utf-8')
    text = before
    for old, new in replacements:
        assert text.count(old) == 1, (file, old[:100], text.count(old))
        text = text.replace(old, new)
    path.write_text(text, encoding='utf-8', newline='\n')
    records.append({'file': path.as_posix(), 'reason': reason,
                    'before': hashlib.sha256(before.encode()).hexdigest(), 'after': sha(path)})


update('c_4b_dungeon_feature.test.ts', [
    ("            'entities/Monster.ts', // X2g: CE Combat.c:1827-1837 zombie blood DF after shield absorption.",
     "            'entities/Monster.ts', // Existing monster consumer remains allowed.\n"
     "            'engine/Combat/CreatureFeatures.ts', // X4-R3: species blood and objective/activation DF.\n"
     "            'engine/Items/IncendiaryDart.ts', // X4-R3: CE Items.c:7049 impact DF."),
    ("expect(readFileSync(join(srcDir, 'entities/Monster.ts'), 'utf8')).toContain('catalogFeature(DF.DF_ROT_GAS_BLOOD)');",
     "expect(readFileSync(join(srcDir, 'entities/Monster.ts'), 'utf8')).toContain('spawnCreatureBlood(grid, this.loc, this.bloodType, damage, this.hp)');\n"
     "        expect(readFileSync(join(srcDir, 'engine/Combat/CreatureFeatures.ts'), 'utf8')).toContain('catalogFeature(bloodType as DF)');"),
], 'Register exactly two new consumers; the zombie source assertion follows the shared emitter. Whole-source scanner and all behavioral assertions retained.')

update('b_1c_detect_magic.test.ts', [
    ('''        // ★ 例外且**符合 CE**：web 卷轴表里恶意类只有 summon monsters 一种
        //   （CE 还有 aggravate monsters，web 目录缺口，B-0 §5.1-9）。恶意类
        //   "只剩 1 种未识别 + 该种极性已揭示" 恰好满足 CE :6648 的升格条件，
        //   于是它被连带识别。这是目录缺口的真实后果，不是实现错——B-4 补上
        //   aggravate monsters 后本条会自动变回"未识别"，届时改这条断言。
        expect(ItemLoader.identifiedItems.has('scroll_of_summon_monsters'),
            'web 恶意卷轴仅此一种 → 极性一揭示就触发 CE 的最后一种类升格').toBe(true);''',
     '''        // X4-R3: CE now has both malevolent scrolls. Polarity revelation
        // cannot identify summon while aggravation is also still unknown.
        expect(ItemLoader.identifiedItems.has('scroll_of_summon_monsters'),
            'two unknown malevolent scroll kinds do not satisfy the last-kind rule').toBe(false);'''),
], 'The old guard explicitly anticipated this flip when aggravation was restored. Keep pack/floor detection, global polarity and consumed-potion assertions.')

update('t_1_tail.test.ts', [
    ("it('AD-A2 对抗：identify 占比贴 CE 加权值 30/133（等概率 1/13 在此翻红）'",
     "it('AD-A2 对抗：identify 占比贴 CE 完整卷轴表 30/158（等概率 1/14 在此翻红）'"),
    ('''        // 二项 σ≈0.0054；带 [0.19, 0.26] ≈ 期望 0.2256 ± 6σ。
        expect(p, `identify 占比 ${p.toFixed(4)}，期望 30/133≈0.2256`).toBeGreaterThan(0.19);
        expect(p, `identify 占比 ${p.toFixed(4)}，期望 30/133≈0.2256`).toBeLessThan(0.26);''',
     '''        // GlobalsBrogue.c:684-699: complete CE base mass is 158 (aggravate=15).
        // Retain 6000 samples and the original six-sigma intent; this window
        // is narrower than the old 0.07-wide band and still rejects uniform draw.
        const expected = 30 / 158;
        const sixSigma = 6 * Math.sqrt(expected * (1 - expected) / 6000);
        expect(p, `identify proportion ${p.toFixed(4)}, CE expectation 30/158`).toBeGreaterThan(expected - sixSigma);
        expect(p, `identify proportion ${p.toFixed(4)}, CE expectation 30/158`).toBeLessThan(expected + sixSigma);'''),
], 'The full CE scroll table has total weight 158, not the old missing-kind normalization (old comment 133 was already stale; old actual pool total 143). Recenter six-sigma interval without increasing width/sample tolerance; keep uniform counterexample, potion checks and all RNG/zero-frequency checks.')

update('x4_r4_item_details.test.ts', [
    ('covers all 99 existing CE identities, with effect assertions and forbidden information',
     'covers all 100 CE identities, with effect assertions and forbidden information'),
    ('expect(identities).toBe(99);', 'expect(identities).toBe(100);'),
    ('uses catalogue descriptions for restored instances and reserves the R3 aggravation branch',
     'uses catalogue descriptions for restored instances and the restored R3 aggravation item'),
    ("expect(L.scrolls.some(s => s.id === 'scroll_of_aggravate_monsters')).toBe(false);",
     "expect(L.scrolls.some(s => s.id === 'scroll_of_aggravate_monsters')).toBe(true);"),
], 'The matrix automatically exercises the new real item and all its knowledge states. Update only the identity total and explicit old absence assumption; preserve every detail/hidden-information/RNG assertion.')

update('src/engine/UI/Discoveries.test.ts', [
    ("['scrolls', 13], ['rings', 8]", "['scrolls', 14], ['rings', 8]"),
    ("expect(initial[0]!.rows[1]!.percentage).toBe(20); // 30 / 143, truncated",
     "expect(initial[0]!.rows[1]!.percentage).toBe(18); // CE full table: 30 / 158, truncated"),
], 'Restore the fourteenth scroll and its real denominator; keep integer truncation, all other tables, naming and hidden-knowledge guards.')

probe = json.loads((raw / 'replay-stack-probe.json').read_text(encoding='utf-8'))
assert probe['success'] and probe['numFailedTests'] == 0
update('x3b_display_recording.test.ts', [
    ('''        expect(item, id).toBeDefined(); walk(g, item.loc, act);
        if (!g.player.inventory.items.includes(item)) act('pickup');
        expect(g.player.inventory.items).toContain(item); return item;''',
     (raw / 'replay-stack-fix.txt').read_text(encoding='utf-8')),
], 'Same natural seed, items, route and commands. New generation causes the target enchantment scroll #16 to merge into already collected stack #17 (quantity 2). Replace the unique-object premise with exact quantity gain at the actual pickup command and floor removal; return the surviving pack object. All replay/frame/seek/OOS assertions remain unchanged.')

(out / 'premise-updates.json').write_text(json.dumps(records, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
patch = subprocess.check_output(['git', 'diff', '--'] + [row['file'] for row in records])
(out / 'guard-premises.patch').write_bytes(patch.replace(b'\r\n', b'\n'))
print(f'Updated {len(records)} proven stale guard premises; patch retained for review')
