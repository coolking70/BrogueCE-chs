from pathlib import Path
import json

out = Path('ai_docs/reports/x4-r2-evidence')
read = lambda p: json.loads(p.read_text(encoding='utf-8'))
before, after = [read(out / f'census-{p}.json') for p in ('before', 'after')]
assert before['seeds'] == after['seeds'] and len(after['seeds']) >= 50
assert before['floors'] == after['floors'] == len(after['seeds']) * 40
assert not before['errors'] and not after['errors']
levels = {p: [json.loads(line) for line in (out / f'census-{p}-levels.jsonl').read_text(encoding='utf-8').splitlines()] for p in ('before', 'after')}
for rows in levels.values():
    assert len({(r['seed'], r['depth']) for r in rows}) == len(after['seeds']) * 40
    assert all(sum(r['depth'] == d for r in rows) == len(after['seeds']) for d in range(1, 41))
for phase, total in [('before', before), ('after', after)]:
    for row in [total, *levels[phase]]:
        row['content'] = {
            'CE19_INCENDIARY_DART': 0 if phase == 'before' else row['machineFeatures'].get('19:1', 0),
            'CE19_INCINERATION': row['machineFeatures'].get('19:1' if phase == 'before' else '19:2', 0),
        }
    for row in levels[phase]:
        if row['depth'] == 26:
            assert row['items'].get('AMULET:amulet_of_yendor', 0) == 1, row
            if phase == 'after':
                assert row['blueprints'].get('15', 0) == row['monsters'].get('Warden_of_Yendor', 0) == 1, row
                assert row['terrain'].get('AMULET_SWITCH', 0) == 1, row
assert after['blueprints'].get('62', 0) > 0
assert all(after['terrain'].get(t, 0) > 0 for t in ['DEEP_WATER_ALGAE_WELL','DEEP_WATER_ALGAE_1','DEEP_WATER_ALGAE_2'])
assert all(after['content'][k] > 0 for k in after['content'])
assert not after['machineFeatures'].get('9:5', 0) and not after['machineFeatures'].get('10:4', 0)

targets = [
    ('藻井 AG10 建成', 'autogen', '10'),
    *[(name, 'terrain', name) for name in ('DEEP_WATER_ALGAE_WELL', 'DEEP_WATER_ALGAE_1', 'DEEP_WATER_ALGAE_2')],
    ('CE15 护符房', 'blueprints', '15'), ('AMULET_SWITCH', 'terrain', 'AMULET_SWITCH'),
    ('Warden', 'monsters', 'Warden_of_Yendor'), ('护符', 'items', 'AMULET:amulet_of_yendor'),
    ('CE62 营地', 'blueprints', '62'),
    *[(name, 'terrain', name) for name in ('HAY', 'JUNK', 'URINE', 'VOMIT')],
    ('CE19 总数', 'blueprints', '19'),
    ('CE19 燃烧飞镖', 'content', 'CE19_INCENDIARY_DART'), ('CE19 焚化药水', 'content', 'CE19_INCINERATION'),
    ('CE9 总数', 'blueprints', '9'), ('CE9 已停用 feature5', 'machineFeatures', '9:5'),
    ('CE10 总数', 'blueprints', '10'), ('CE10 已停用 feature4', 'machineFeatures', '10:4'),
]
def value(row, kind, key):
    if kind == 'autogen':
        if isinstance(row[kind], list): return sum(a['built'] for a in row[kind] if str(a['index']) == key)
        return row[kind].get(key, {}).get('built', 0)
    return row[kind].get(key, 0)
metrics = []
for name, kind, key in targets:
    result = dict(name=name, kind=kind, key=key)
    for phase, total in [('before', before), ('after', after)]:
        selected = [r for r in levels[phase] if value(r, kind, key)]
        result[phase] = {'count': value(total, kind, key), 'floors': len(selected), 'seeds': len({r['seed'] for r in selected})}
    result['depths'] = [{'depth': d, **{p: sum(value(r, kind, key) for r in levels[p] if r['depth'] == d) for p in levels}} for d in range(1, 41)]
    metrics.append(result)
(out / 'content-counts.json').write_text(json.dumps(metrics, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
table = ['| 内容 | 修复前次数 / 层数 | 修复后次数 / 层数 |', '|---|---:|---:|']
table += [f"| {r['name']} | {r['before']['count']} / {r['before']['floors']} | {r['after']['count']} / {r['after']['floors']} |" for r in metrics]
(out / 'content-counts.md').write_text('\n'.join(table)+'\n', encoding='utf-8', newline='\n')

# Every zero terrain from X-0 §3, including upstream inactive content and runtime
# states. No catalog absence is treated as evidence that it should spawn cold.
zeros = read(Path('ai_docs/reports/x-4-evidence/zero-terrain-inventory.txt'))
inactive = set('ICE_DEEP ICE_DEEP_MELT ICE_SHALLOW ICE_SHALLOW_MELT HOLE_GLOW MANACLE_TL MANACLE_BR MANACLE_TR MANACLE_BL MANACLE_B MANACLE_R'.split())
creatures = set('GREEN_BLOOD PURPLE_BLOOD ACID_SPLATTER WORM_BLOOD UNICORN_POOP GUARDIAN_GLOW FLAMEDANCER_FIRE DART_EXPLOSION CREATURE_FIRE'.split())
generated = set('HAY JUNK URINE BLOODFLOWER_POD DEEP_WATER_ALGAE_WELL DEEP_WATER_ALGAE_1 DEEP_WATER_ALGAE_2 AMULET_SWITCH'.split())
reasons = {
    'BURNED_CARPET': '燃烧后残毯；R1 已恢复实体，无需另设自然生成根。',
    'PUDDLE': '娜迦周期水迹/涉水等运行态；物种周期接线归 R3/R6。',
    'ECTOPLASM': '幻影周期/血迹及闹鬼机关运行态；物种接线归 R3/R6。',
    'LICHEN': '蔓延药水或孢子突变触发，非初始供给。',
    'ANCIENT_SPIRIT_VINES': '远古之灵法术运行态，不要求入层快照为正。',
    'ANCIENT_SPIRIT_GRASS': '远古之灵法术后继态，不要求入层快照为正。',
    'HEALING_CLOUD': '果荚踩爆/燃烧释放；R1 已恢复目录，Game 治疗集成归 R6。',
}
ledger = []
for entry in zeros:
    name = entry['ce']; web = entry.get('web') or name
    if name in inactive: reason = '本 Brogue 变体无正常生成根；R1 缺位账本保留，不激活。'
    elif name in creatures: reason = '实体/DF 已由 R1 提供；受击、周期、激活或投掷接线归 R3/R6，非本轮自然生成根。'
    elif name in generated: reason = '应有自然生成；R1 实体恢复或本轮 B01/B02/B03 接线，按实际次数验收。'
    else: reason = reasons.get(name, '机关触发、开门/开笼、燃烧、药水、法术或气体后继态；未操作的入层普查不要求为正。')
    ledger.append({'ce': name, 'web': web, 'before': before['terrain'].get(web, 0), 'after': after['terrain'].get(web, 0),
        'reason': reason, 'ceLine': entry['ceLine'], 'dfWriters': entry['dfWriters'], 'sourceReferences': entry['sourceReferences']})
assert len(ledger) == 85
(out / 'zero-terrain-review.json').write_text(json.dumps(ledger, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
table = ['| X-0 零地形 | 修复前格数 | 修复后格数 | 逐项判定 |', '|---|---:|---:|---|']
table += [f"| {r['ce']} | {r['before']} | {r['after']} | {r['reason']} |" for r in ledger]
(out / 'zero-terrain-review.md').write_text('\n'.join(table)+'\n', encoding='utf-8', newline='\n')
rare = [15, 17, 27, 30, 31, 38, 41, 46, 49, 50, 53, 54, 58, 62, 71]
(out / 'rare-blueprints.json').write_text(json.dumps([{ 'ce': k, 'before': before['blueprints'].get(str(k), 0), 'after': after['blueprints'].get(str(k), 0)} for k in rare], indent=2)+'\n', encoding='utf-8', newline='\n')
print('\n'.join((out / 'content-counts.md').read_text(encoding='utf-8').splitlines()))

if (out / 'counterfactual-old-tests.json').exists():
    initial = read(out / 'initial-test.json')
    old = read(out / 'counterfactual-old-tests.json')
    lookup = {a['fullName']: a for t in old['testResults'] for a in t['assertionResults']}
    matrix = []
    for test in initial['testResults']:
        for assertion in test['assertionResults']:
            if assertion['status'] != 'failed': continue
            prior = lookup[assertion['fullName']]
            matrix.append({'file': test['name'].split('/')[-1], 'assertion': assertion['fullName'],
                'initial': assertion['status'], 'headOnly': prior['status'],
                'initialDurationMs': assertion.get('duration'), 'headDurationMs': prior.get('duration'),
                'initialMessages': assertion['failureMessages'], 'headMessages': prior['failureMessages']})
    (out / 'premise-counterfactual.json').write_text(json.dumps(matrix, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
