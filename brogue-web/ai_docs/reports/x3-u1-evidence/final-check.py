from pathlib import Path
import hashlib,json,subprocess
out=Path('ai_docs/reports/x3-u1-evidence')
manifest=json.loads((out/'gate-inputs.json').read_text())
changed=[p for p,h in manifest.items() if hashlib.sha256(Path(p).read_bytes()).hexdigest()!=h]
results=json.loads((out/'gate-results.json').read_text())
expected=set((out/'gate-files.txt').read_text().splitlines())
actual={str(Path(t['name']).relative_to(Path.cwd())) for t in results['testResults']}
refs=set(subprocess.check_output(['rg','-l','requestConfirm|confirm|performPlayerAction|App\\.vue','src','scripts','-g','*test.ts','-g','*spec.ts'],text=True).splitlines())
baselines=['ai_docs/reports/u-r2-trace.json','ai_docs/reports/u-r3-trace.json.gz','ai_docs/reports/u-r4-trace.json.gz','src/test/fixtures/generation_baseline.json']
protected={p: {'sha256':hashlib.sha256(Path(p).read_bytes()).hexdigest(),'matchesHead':Path(p).read_bytes()==subprocess.check_output(['git','show','HEAD:brogue-web/'+p])} for p in baselines}
paths=subprocess.check_output(['git','ls-files','--modified','--others','--exclude-standard','--','.'],text=True).splitlines()
crlf=[p for p in paths if Path(p).is_file() and b'\r\n' in Path(p).read_bytes()]
pngs=list(out.glob('*.png'))
ignored=all(subprocess.run(['git','check-ignore','-q',str(p)]).returncode==0 for p in pngs)
staged=subprocess.check_output(['git','diff','--cached','--name-only'],text=True).splitlines()
diff=subprocess.run(['git','diff','--check'],capture_output=True,text=True)
summary={'inputCount':len(manifest),'changedInputs':changed,'expectedFiles':len(expected),'actualFiles':len(actual),'missingFiles':sorted(expected-actual),'unexpectedFiles':sorted(actual-expected),'referenceFiles':len(refs),'missingReferences':sorted(refs-expected),'tests':{k:results[k] for k in ['numPassedTests','numFailedTests','numPendingTests','numTodoTests']},'protected':protected,'CRLF':crlf,'PNGCount':len(pngs),'allPNGIgnored':ignored,'stagedFiles':staged,'diffCheckExit':diff.returncode,'diffCheckOutput':diff.stdout+diff.stderr}
(out/'final-check.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
assert not changed and expected==actual and refs<=expected and not crlf and not staged and ignored and diff.returncode==0
assert results['numFailedTests']==0 and all(v['matchesHead'] for v in protected.values())
print(json.dumps(summary,ensure_ascii=False,indent=2))
