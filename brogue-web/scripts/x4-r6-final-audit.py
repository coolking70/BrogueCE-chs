from pathlib import Path
import hashlib,json,subprocess
out=Path('ai_docs/reports/x4-r6-evidence')
def git(*args):return subprocess.check_output(['git',*args],text=True).strip()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def path(p):return Path(p.removeprefix('brogue-web/'))
changed=[path(p) for p in git('diff','--name-only','HEAD','--','.').splitlines()]
added=[path(p) for p in git('ls-files','--others','--exclude-standard','--','.').splitlines()]
files=sorted(set(changed+added));crlf=[]
for p in files:
 if not p.is_file():continue
 try:s=p.read_text()
 except UnicodeDecodeError:continue
 if b'\r\n' in p.read_bytes():crlf.append(str(p))
large=[{'file':str(p),'bytes':p.stat().st_size} for p in added if p.is_file() and str(p).startswith('ai_docs/reports/') and p.stat().st_size>1_000_000]
ce=json.loads((out/'ce-source-hashes.json').read_text())
gates=json.loads((out/'final-gates.json').read_text())
a=json.loads((out/'final-inputs-before.json').read_text());b=json.loads((out/'final-inputs-after.json').read_text())
suite=json.loads(Path('output/x4-r6/final-test.json').read_text());drift=json.loads(Path('output/x4-r6/final-drift.json').read_text())
result={'head':git('rev-parse','HEAD'),'index':git('diff','--cached','--name-only'),
 'diffCheckExit':subprocess.run(['git','diff','--check']).returncode,'crlf':crlf,
 'addedPNGs':[str(p) for p in added if p.suffix.lower()=='.png'],'addedLargeReportEvidence':large,
 'ceUnchanged':all(sha(Path(p))==h for p,h in ce.items()),'inputCount':len(a),'inputsUnchanged':a==b,
 'inputsStillMatch':all(Path(p).exists() and sha(Path(p))==h for p,h in b.items()),
 'gates':[{k:v for k,v in r.items() if k!='args'} for r in gates],
 'suite':{k:suite[k] for k in ['numTotalTests','numPassedTests','numFailedTests','numPendingTests','numTodoTests','success']},
 'testFiles':len(suite['testResults']),'driftSuccess':drift['success'],
 'originalGoldenTraceBytes':{str(p):p.stat().st_size for p in changed if p.name=='u-r4-trace.json.gz'},
 'files':[str(p) for p in files]}
(out/'final-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
assert result['head']=='06f90063f4ab05ae573d1d27178fa6df766011a6'
assert not result['index'] and result['diffCheckExit']==0 and not crlf and not large and not result['addedPNGs']
assert result['ceUnchanged'] and result['inputsUnchanged'] and result['inputsStillMatch']
assert all(r['exit']==0 for r in gates) and suite['success'] and drift['success']
print(json.dumps({k:v for k,v in result.items() if k not in ['files','gates']},ensure_ascii=False))
