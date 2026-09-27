import pathlib, json, hashlib, re
root=pathlib.Path(__file__).resolve().parents[2]
project=root/'brogue-web'
out=project/'ai_docs/reports/x-1b-evidence'
def read(n): return json.loads((out/n).read_text(encoding='utf-8'))
def write(n,v): (out/n).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
before=read('tracked-before.json')
changes=[{'file':p,'before':s,'after':sha(root/p) if (root/p).exists() else None} for p,s in before.items() if not (root/p).exists() or sha(root/p)!=s]
write('tracked-integrity.json',{'trackedFiles':len(before),'changes':changes})
first=read('targeted-results.json'); second=read('recovery-results.json')
latest={r['name'].split('/')[-1]:r for r in first['testResults']}
latest.update({r['name'].split('/')[-1]:r for r in second['testResults']})
results=[]
for n,r in sorted(latest.items()):
    statuses={}
    for a in r['assertionResults']: statuses[a['status']]=statuses.get(a['status'],0)+1
    results.append({'file':n,'status':r['status'],'assertions':statuses})
write('test-summary.json',{'firstRun':{'passedTests':first['numPassedTests'],'failedTests':first['numFailedTests'],'collectionFailures':[{'file':r['name'],'message':r.get('message')} for r in first['testResults'] if r['status']!='passed']},'recoveryPassedTests':second['numPassedTests'],'finalFileCount':len(results),'finalPassedTests':sum(r['assertions'].get('passed',0) for r in results),'finalFailedFiles':[r['file'] for r in results if r['status']!='passed'],'files':results})
guards=[]
for n in latest:
    p=project/'src/test'/n
    for i,line in enumerate(p.read_text(encoding='utf-8-sig').splitlines(),1):
        if re.search(r'\bexpect\(|\bit(?:\.each)?\(|\bdescribe\(',line): guards.append({'file':'src/test/'+n,'line':i,'text':line})
write('guard-lines.json',guards)
rows=read('natural-levels.json'); cat=read('catalog.json'); replay=read('deep-checkpoints.json')
write('observation-summary.json',{'layers':len(rows),'seeds':sorted(set(r['seed'] for r in rows)),'gemCount':sum(len(r['gems']) for r in rows),'foodCount':sum(r['itemCategories'].count('FOOD') for r in rows),'quotaMismatches':[{'seed':r['seed'],'depth':r['depth']} for r in rows if len(r['gems'])!=[3,3,3,2,2,2,2,2,1,1,1,1,1,1][r['depth']-27]],'unreachableStairs':[r for r in rows if r['stairDistance']>=30000],'invalidOrUnreachableGems':[{'seed':r['seed'],'depth':r['depth'],'gem':g} for r in rows for g in r['gems'] if g['distance']>=30000 or g['blocked'] or g['machine'] or g['originDepth']!=r['depth']],'derivedFlagMismatches':sum(len(r['derivedFlagMismatch']) for r in rows),'deepBlueprintDepthMismatches':[r for r in cat['deepEligibleBlueprints'] if any(not w['matches'] for w in r['web'])],'deepCheckpointEvents':sum(r['cursor'] for r in replay),'deepCheckpointErrors':[r for r in replay if r['error']]})
files=list((project/'scripts').glob('x1b-*'))+list(out.rglob('*'))
report=project/'ai_docs/reports/x-1b-survey.report.md'
if report.exists(): files.append(report)
texts=[p for p in files if p.is_file() and p.suffix in ['.json','.ts','.mjs','.py','.txt','.md']]
write('newline-check.json',{'filesScanned':len(texts),'filesWithCRLF':[str(p.relative_to(root)).replace('\\','/') for p in texts if b'\r\n' in p.read_bytes()]})
print(json.dumps({'trackedChanges':len(changes),'finalTestFiles':len(results),'passedTests':sum(r['assertions'].get('passed',0) for r in results),'failedFiles':[r['file'] for r in results if r['status']!='passed'],'layers':len(rows)}))
