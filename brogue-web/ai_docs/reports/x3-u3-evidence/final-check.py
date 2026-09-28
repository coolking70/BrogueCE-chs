from pathlib import Path
import subprocess,json,hashlib,datetime
out=Path('ai_docs/reports/x3-u3-evidence')
manifest=json.loads((out/'gate-inputs.json').read_text())
finalManifest={p:hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in manifest}
changed=[p for p,h in manifest.items() if finalManifest[p]!=h]
fixture='src/test/w_6_arcana_recharge.test.ts'
insert='        a.isCursed = false; // Wisdom removal fixture must be removable.\n'
current=Path(fixture).read_text()
fixtureOnly=current.count(insert)==1 and hashlib.sha256(current.replace(insert,'').encode()).hexdigest()==manifest[fixture]
full=json.loads((out/'full-results.json').read_text())
drift=json.loads((out/'drift-results.json').read_text())
focused=json.loads((out/'focused-final.json').read_text())
gates=json.loads((out/'gate-summary.json').read_text())
finalGates=json.loads((out/'final-gate-summary.json').read_text())
proof=json.loads((out/'w6-counterfactual-summary.json').read_text())
subprocess.run(['node',str(out/'check-scope.mjs')],check=True)
subprocess.run(['git','diff','--check'],check=True)
paths=subprocess.check_output(['git','ls-files','--modified','--others','--exclude-standard','-z'],text=True).split('\0')
paths=[p for p in paths if p and Path(p).is_file()]
crlf=[p for p in paths if b'\r\n' in Path(p).read_bytes()]
png=[p for p in paths if p.endswith('.png')]
retries=json.loads((out/'timeout-retry-summary.json').read_text())
expectedFiles={str(p.resolve()) for p in Path('src').rglob('*.test.ts') if p.name!='generation_baseline.test.ts'}
actualFiles={r['name'] for r in full['testResults']}
missingFiles=sorted(expectedFiles-actualFiles)
failedFiles=[r['name'] for r in full['testResults'] if r['status']=='failed']
recovered=[str(Path(r['file']).resolve()) for r in retries if r['exit']==0 and r['failedTests']==0 and not r['changedInputs']]
fixtureVerified=fixtureOnly and focused['success'] and any(r['name']==str(Path(fixture).resolve()) and r['status']=='passed' for r in focused['testResults'])
resolved=set(recovered)|({str(Path(fixture).resolve())} if fixtureVerified else set())
result={
 'checkedAt':datetime.datetime.now().astimezone().isoformat(),
 'frozenInputs':len(manifest),'changedInputsAfterFullGate':changed,
 'productOrOtherTestInputsChanged':[p for p in changed if p!=fixture],
 'fixtureOnlyCorrection':{'file':fixture,'onlyChange':insert.strip(),'exactlyOnePremiseLine':fixtureOnly,'counterfactualResults':[(r['variant'],r['failedTests']) for r in proof],'finalFileVerified':fixtureVerified,'adjudication':'Submitted with counterfactual evidence under task exception; assertions unchanged.'},
 'expectedDefaultGateFiles':len(expectedFiles),'missingDefaultGateFiles':missingFiles,
 'full':{'success':full['success'],'files':len(full['testResults']),'passedTests':full['numPassedTests'],'failedTests':full['numFailedTests'],'pendingTests':full['numPendingTests'],'todoTests':full['numTodoTests'],'failedFiles':failedFiles},
 'drift':{'success':drift['success'],'files':len(drift['testResults']),'passedTests':drift['numPassedTests'],'failedTests':drift['numFailedTests']},
 'finalFocused':{'success':focused['success'],'files':len(focused['testResults']),'passedTests':focused['numPassedTests'],'failedTests':focused['numFailedTests']},
 'fullRerunAfterFixtureCorrection':False,
 'recoveredTimeoutFiles':recovered,'unresolvedFiles':sorted(set(failedFiles)-resolved),'crlfFiles':crlf,'unignoredPng':png,
 'stagedFiles':subprocess.check_output(['git','diff','--cached','--name-only'],text=True).splitlines(),
 'baselineChanged':subprocess.check_output(['git','diff','--name-only','--','src/test/fixtures'],text=True).splitlines(),
 'initialGateExits':{r['name']:r['exit'] for r in gates},'finalGateExits':{r['name']:r['exit'] for r in finalGates},
}
(out/'final-inputs.json').write_text(json.dumps(finalManifest,indent=2)+'\n')
(out/'final-check.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False,indent=2))
assert not missingFiles and changed==[fixture] and fixtureOnly and not crlf and not png and not result['stagedFiles'] and not result['baselineChanged']
assert [(r['variant'],r['failedTests']) for r in proof]==[('current',1),('old-removal',0),('explicit-removable',0)]
assert not result['unresolvedFiles'] and len(recovered)==7
assert drift['success'] and not drift['numFailedTests']
assert focused['success'] and focused['numPassedTests']==93 and len(focused['testResults'])==2
assert all(r['exit']==0 for r in finalGates)
