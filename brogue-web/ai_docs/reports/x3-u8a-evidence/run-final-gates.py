from pathlib import Path
import datetime, hashlib, json, subprocess, time

root = Path('/Users/coolking70/.codex/worktrees/7976/brogue/brogue-web')
out = Path('/tmp/x3-u8a-evidence')
files = [p for p in (root / 'src').rglob('*') if p.is_file()]
files += [root / 'package.json', root / 'package-lock.json', root / 'vite.config.ts', *root.glob('tsconfig*.json')]
before = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(files)}
(out / 'final-input-hashes.json').write_text(json.dumps(before, indent=2) + '\n')
commands = [
    ('types', ['npx', 'vue-tsc', '-b']),
    ('build', ['npm', 'run', 'build']),
    ('npm-test', ['npm', 'test', '--', '--maxWorkers=2', '--reporter=default', '--reporter=json',
                  '--outputFile.json=' + str(out / 'full-results.json')]),
    ('drift', ['npm', 'run', 'test:drift', '--', '--maxWorkers=1', '--reporter=default', '--reporter=json',
              '--outputFile.json=' + str(out / 'drift-results.json')]),
]
results = []
for name, command in commands:
    started = datetime.datetime.now().astimezone().isoformat()
    start = time.monotonic()
    with (out / (name + '.log')).open('w') as log:
        code = subprocess.run(command, cwd=root, stdout=log, stderr=subprocess.STDOUT).returncode
    result = {'name': name, 'command': command, 'started': started,
              'finished': datetime.datetime.now().astimezone().isoformat(),
              'exitCode': code, 'seconds': round(time.monotonic() - start, 3)}
    results.append(result)
    (out / 'final-gates.json').write_text(json.dumps(results, indent=2) + '\n')
    print(json.dumps(result), flush=True)
    if code and name in ('types', 'build'):
        break

changed = [p for p, digest in before.items() if hashlib.sha256((root / p).read_bytes()).hexdigest() != digest]
(out / 'final-input-check.json').write_text(json.dumps({'count': len(before), 'changed': changed}, indent=2) + '\n')
