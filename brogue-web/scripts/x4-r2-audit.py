from pathlib import Path
import hashlib
import json
import subprocess

out = Path('ai_docs/reports/x4-r2-evidence')
read = lambda p: json.loads(p.read_text(encoding='utf-8'))
git = lambda *args: subprocess.check_output(['git', *args])
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
initial = read(out/'initial-state.json')
assert git('rev-parse','HEAD').decode().strip() == initial['head']
assert not git('diff','--cached','--name-only').strip()
subprocess.run(['git','diff','--check'], check=True)
gates = read(out/'final-gates.json')
assert len(gates) == 4
assert all(g['exit'] == (1 if g['label'] == 'test' else 0) for g in gates)
known = read(out/'preexisting-reader-inventory.json')
results = read(out/'final-test.json')
failures = [{'file':t['name'],'name':a['fullName'],'message':a['failureMessages'][0]}
    for t in results['testResults'] for a in t['assertionResults'] if a['status'] == 'failed']
assert results['numTotalTests'] == 4412 and results['numFailedTests'] == len(failures) == 2
baseline = [f for f in failures if f['name'] == known['failure']['name']]
assert len(baseline) == 1 and baseline[0]['file'].endswith('c_4a_terrain_catalog.test.ts')
assert all(s in baseline[0]['message'] for s in ('MonsterSidebar.ts:27','MonsterSidebar.ts:91'))
closed = [f for f in failures if f not in baseline]
assert len(closed) == 1 and closed[0]['file'].endswith('u_19f_machines.test.ts') and 'CE52' in closed[0]['name']
assert 'length of 3 but got 4' in closed[0]['message']
closure = read(out/'closure-verification.json')
before_closure = read(out/'closure-preconditions.json')
changed = [f for f, expected in before_closure['files'].items() if sha(Path(f)) != expected]
assert changed == closure['changed'] == ['src/test/u_19f_machines.test.ts']
assert sha(Path(changed[0])) == closure['afterSha256']
focused = read(out/'closure-u19f.json')
assert focused['numPassedTests'] == 3 and focused['numFailedTests'] == 0
assert all(c['exit'] == 0 for c in closure['checks'])
assert not closure['fullSuiteRepeatedAfterClosure']
for file, expected in known['unchangedFiles'].items(): assert sha(Path(file)) == expected
drift = read(out/'final-drift.json')
assert drift['numFailedTests'] == 0 and drift['numPassedTests'] > 0
for row in read(out/'counterfactual-manifest.json'):
    assert sha(Path(row['file'])) == row['final'], row
for row in read(out/'recapture.json')['records']:
    assert sha(Path(row['file'])) == row['after'], row
for row in read(out/'natural-case-revisions.json'):
    assert sha(Path(row['file'])) == row['afterSha256'], row
for file, expected in read(out/'ce-source-hashes.json').items():
    assert sha(Path('../BrogueCE-master/src')/file) == expected

# The shared Game entry is limited to exactly the horde-generation adapter.
original = git('show','HEAD:brogue-web/src/engine/Core/Game.ts').decode('utf-8')
expected = original.replace('import { createMachineRuntime, generateDepth, placeStairs, populateLevel }',
    'import { buildHordeMachine, createMachineRuntime, generateDepth, placeStairs, populateLevel }')
expected = expected.replace('        const leaderMon = new Monster(centerPos.x, centerPos.y, leaderMData);',
    '        if (h.machine > 0) buildHordeMachine(this.makeGenerationPorts(), h.machine, centerPos, depth);\n\n'
    '        const leaderMon = new Monster(centerPos.x, centerPos.y, leaderMData);')
assert Path('src/engine/Core/Game.ts').read_text(encoding='utf-8') == expected
files = set(git('diff','--name-only','--relative').decode().splitlines())
files.update(git('ls-files','--others','--exclude-standard').decode().splitlines())
files.update(str(p).replace('\\','/') for p in out.glob('*.log'))
production = {f for f in files if f.startswith(('src/engine/','src/data/','src/entities/'))}
assert production == set(initial['productionFiles']), production
bad = []
for name in sorted(files):
    path = Path(name)
    if not path.is_file(): continue
    assert path.suffix.lower() != '.png', name
    if path.suffix in ('.ts','.mjs','.py','.json','.jsonl','.md','.txt','.log') and b'\r\n' in path.read_bytes(): bad.append(name)
assert not bad, bad
assert '执行中草稿' not in Path('ai_docs/reports/x4-r2.report.md').read_text(encoding='utf-8')
(out/'final-audit.json').write_text(json.dumps({'head':initial['head'],'indexEmpty':True,
    'diffCheck':True,'noCRLF':True,'noPNG':True,'sharedGameChanges':'import + pre-leader accompanying-machine call only',
    'fullSuiteStatus':'FAILED: two assertions; CE52 count premise subsequently corrected and the entire U19f file passed; unchanged HEAD reader-inventory defect remains',
    'fullSuiteFailedAssertions':failures,'closure':closure,'remainingFailure':baseline[0],'gates':gates,'driftPassed':True,
    'productionHashes':{f:sha(Path(f)) for f in initial['productionFiles']},'files':sorted(files)},ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
print('Scope/evidence audit passed. Full npm test completed with two failures; subsequent focused closure leaves one reproduced HEAD failure. No git commit.')
