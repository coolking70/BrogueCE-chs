from pathlib import Path
import json, subprocess

repo = Path('/Users/coolking70/.codex/worktrees/7976/brogue')
out = Path('/tmp/x3-u8a-evidence')
def git(*args):
    return subprocess.check_output(['git', *args], cwd=repo).decode()
tracked = git('diff', '--name-only', '-z').split('\0')
untracked = git('ls-files', '--others', '--exclude-standard', '-z').split('\0')
paths = sorted(set(p for p in tracked + untracked if p))
files = [repo / p for p in paths if (repo / p).is_file()]
result = {
    'head': git('rev-parse', 'HEAD').strip(),
    'stagedFiles': [p for p in git('diff', '--cached', '--name-only', '-z').split('\0') if p],
    'crlfFiles': [str(p.relative_to(repo)) for p in files if b'\r\n' in p.read_bytes()],
    'pngFiles': [str(p.relative_to(repo)) for p in files if p.suffix.lower() == '.png'],
    'changedFiles': paths,
    'methodScope': json.loads((out / 'method-scope.json').read_text()),
    'trackedDiffStat': git('diff', '--stat'),
    'untrackedLineCounts': {p: len((repo / p).read_bytes().splitlines()) for p in untracked if p and (repo / p).is_file() and not p.endswith('/final-file-audit.json')},
}
(out / 'final-file-audit.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(result, ensure_ascii=False, indent=2))
