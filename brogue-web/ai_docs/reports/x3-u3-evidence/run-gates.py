from pathlib import Path
import subprocess,json,hashlib,time,datetime
out=Path('ai_docs/reports/x3-u3-evidence')
files=sorted([p for root in ['src','scripts'] for p in Path(root).rglob('*') if p.is_file()]+[Path(n) for n in ['package.json','package-lock.json','vite.config.ts','tsconfig.app.json','tsconfig.node.json','tsconfig.json']])
manifest={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
(out/'gate-inputs.json').write_text(json.dumps(manifest,indent=2)+'\n')
steps=[('types',['npx','vue-tsc','-b']),('build',['npm','run','build']),('full',['npm','test','--','--maxWorkers=3','--reporter=default','--reporter=json','--outputFile.json='+str(out/'full-results.json')]),('drift',['npm','run','test:drift','--','--maxWorkers=1','--reporter=default','--reporter=json','--outputFile.json='+str(out/'drift-results.json')])]
results=[]
for name,cmd in steps:
 started=time.time()
 with (out/(name+'.txt')).open('w') as log:
  result=subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT)
 row={'name':name,'command':cmd,'exit':result.returncode,'seconds':round(time.time()-started,3),'started':datetime.datetime.fromtimestamp(started).astimezone().isoformat(),'finished':datetime.datetime.now().astimezone().isoformat()}
 results.append(row);(out/'gate-summary.json').write_text(json.dumps(results,indent=2)+'\n');print(name,row['exit'],row['seconds'],flush=True)
 if result.returncode and name in ['types','build']:break
changed=[str(p) for p in files if hashlib.sha256(p.read_bytes()).hexdigest()!=manifest[str(p)]]
(out/'input-check.json').write_text(json.dumps({'count':len(files),'changed':changed},indent=2)+'\n')
