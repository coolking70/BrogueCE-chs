from pathlib import Path
import hashlib,json,subprocess
out=Path('ai_docs/reports/x3-u2-evidence')
manifest=json.loads((out/'gate-inputs.json').read_text())
changed=[p for p,h in manifest.items() if hashlib.sha256(Path(p).read_bytes()).hexdigest()!=h]
full=json.loads((out/'full-results.json').read_text())
drift=json.loads((out/'drift-results.json').read_text())
actual={str(Path(t['name']).relative_to(Path.cwd())) for t in full['testResults']+drift['testResults']}
expected={line.strip() for line in (out/'discovered-files.txt').read_text().splitlines() if line.strip().endswith(('.test.ts','.spec.ts'))}
protected=['ai_docs/reports/u-r2-trace.json','ai_docs/reports/u-r3-trace.json.gz','ai_docs/reports/u-r4-trace.json.gz','src/test/fixtures/generation_baseline.json','src/test/fixtures/deep_generation_baseline.json','package-lock.json']
checks={p:{'sha256':hashlib.sha256(Path(p).read_bytes()).hexdigest(),'matchesHead':Path(p).read_bytes()==subprocess.check_output(['git','show','HEAD:brogue-web/'+p])} for p in protected}
paths=subprocess.check_output(['git','ls-files','--modified','--others','--exclude-standard','--','.'],text=True).splitlines()
crlf=[p for p in paths if Path(p).is_file() and b'\r\n' in Path(p).read_bytes()]
pngs=list(out.glob('*.png'))
ignored=all(subprocess.run(['git','check-ignore','-q',str(p)]).returncode==0 for p in pngs)
staged=subprocess.check_output(['git','diff','--cached','--name-only'],text=True).splitlines()
changedTests=[p for p in subprocess.check_output(['git','diff','--name-only'],text=True).splitlines() if p.endswith(('.test.ts','.spec.ts'))]
diff=subprocess.run(['git','diff','--check'],capture_output=True,text=True)
suiteFailures=[{'name':t['name'],'message':t.get('message'),'status':t['status']} for t in full['testResults']+drift['testResults'] if t['status']!='passed']
retries=json.loads((out/'timeout-retry-summary.json').read_text()) if (out/'timeout-retry-summary.json').exists() else []
retryFiles={r['file'] for r in retries}
failedFiles={str(Path(r['name']).relative_to(Path.cwd())) for r in suiteFailures}
summary={'timeoutRetries':retries,'originalFullExit':next(r['exit'] for r in json.loads((out/'gate-summary.json').read_text()) if r['name']=='full'),'inputCount':len(manifest),'changedInputs':changed,'expectedFiles':len(expected),'actualFiles':len(actual),'missingFiles':sorted(expected-actual),'unexpectedFiles':sorted(actual-expected),'fullFiles':len(full['testResults']),'driftFiles':len(drift['testResults']),'tests':{k:full[k] for k in ['numPassedTests','numFailedTests','numPendingTests','numTodoTests']},'driftTests':{k:drift[k] for k in ['numPassedTests','numFailedTests']},'suiteFailures':suiteFailures,'protected':checks,'modifiedExistingTests':changedTests,'CRLF':crlf,'PNGCount':len(pngs),'allPNGIgnored':ignored,'stagedFiles':staged,'diffCheckExit':diff.returncode,'diffCheckOutput':diff.stdout+diff.stderr}
(out/'final-check.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
assert not changed and expected==actual and not crlf and not staged and not changedTests and ignored and diff.returncode==0
assert drift['numFailedTests']==0 and all(v['matchesHead'] for v in checks.values())
if suiteFailures:
 assert failedFiles==retryFiles and full['numFailedTests']==sum(len(r['originalFailures']) for r in retries)
 assert all(r['exit']==0 and r['failedTests']==0 and not r['changedInputs'] and r['originalError'].startswith('Test timed out in 900000ms.') for r in retries)
else:
 assert full['numFailedTests']==0 and not retries
assert all(r['exit']==0 or (r['name']=='full' and r['exit']==1 and bool(retries)) for r in json.loads((out/'gate-summary.json').read_text()))
print(json.dumps(summary,ensure_ascii=False,indent=2))
