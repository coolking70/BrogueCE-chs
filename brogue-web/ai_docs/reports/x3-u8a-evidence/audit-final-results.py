from pathlib import Path
from collections import Counter
import json

root = Path('/Users/coolking70/.codex/worktrees/7976/brogue/brogue-web')
out = Path('/tmp/x3-u8a-evidence')
expected = json.loads((out / 'expected-test-files.json').read_text())
result = {}
for name in ('full', 'drift'):
    data = json.loads((out / f'{name}-results.json').read_text())
    actual = sorted(str(Path(s['name']).relative_to(root)) for s in data['testResults'])
    cases = [case for suite in data['testResults'] for case in suite['assertionResults']]
    result[name] = {
        'success': data['success'],
        'fileCount': len(actual),
        'expectedFileCount': len(expected[name]),
        'missingFiles': sorted(set(expected[name]) - set(actual)),
        'extraFiles': sorted(set(actual) - set(expected[name])),
        'duplicateFiles': sorted(k for k, v in Counter(actual).items() if v > 1),
        'assertionStatusCounts': dict(Counter(c['status'] for c in cases)),
        'reportedTotals': {key: value for key, value in data.items() if key.startswith('num')},
        'failedSuites': [s['name'] for s in data['testResults'] if s['status'] != 'passed'],
        'failedCases': [c for c in cases if c['status'] == 'failed'],
        'unhandledErrors': data.get('unhandledErrors', []),
    }
result['gates'] = json.loads((out / 'final-gates.json').read_text())
result['inputCheck'] = json.loads((out / 'final-input-check.json').read_text())
(out / 'final-results-audit.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(result, ensure_ascii=False, indent=2))
