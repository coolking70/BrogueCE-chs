from pathlib import Path
import subprocess,json,hashlib,time
out=Path('ai_docs/reports/x3-u1-evidence')
files=sorted([p for p in Path('src').rglob('*') if p.is_file()]+[Path(n) for n in ['package.json','package-lock.json','vite.config.ts','tsconfig.app.json','tsconfig.node.json','tsconfig.json']])
manifest={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
(out/'gate-inputs.json').write_text(json.dumps(manifest,indent=2)+'\n')
steps=[('types',['npx','vue-tsc','-b']),('build',['npm','run','build']),('gate',['npx','vitest','run',* (out/'gate-files.txt').read_text().splitlines(),'--maxWorkers=4','--reporter=default','--reporter=json','--outputFile.json='+str(out/'gate-results.json')]),('drift',['npm','run','test:drift'])]
results=[]
for name,cmd in steps:
 started=time.time()
 with (out/(name+'.txt')).open('w') as log:
  result=subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT)
 row={'name':name,'command':cmd,'exit':result.returncode,'seconds':round(time.time()-started,3)}
 results.append(row);(out/'gate-summary.json').write_text(json.dumps(results,indent=2)+'\n');print(name,row['exit'],row['seconds'],flush=True)
 if result.returncode and name in ['types','build']:break
changed=[str(p) for p in files if hashlib.sha256(p.read_bytes()).hexdigest()!=manifest[str(p)]]
(out/'input-check.json').write_text(json.dumps({'count':len(files),'changed':changed},indent=2)+'\n')
