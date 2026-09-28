"""Read the checked-in CE catalog, preserving C initializer boundaries and line numbers."""
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[2]


def clean(source):
    return re.sub(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|//[^\n]*|/\*[\s\S]*?\*/',
                  lambda m: '\n' * m[0].count('\n') if m[0].startswith(('//', '/*')) else m[0], source)


def parts(source):
    result, start, depth, quote, escaped = [], 0, 0, None, False
    for i, char in enumerate(source):
        if quote:
            if escaped: escaped = False
            elif char == '\\': escaped = True
            elif char == quote: quote = None
        elif char in '\"\'': quote = char
        elif char in '{[(': depth += 1
        elif char in '}])': depth -= 1
        elif char == ',' and depth == 0:
            result.append(source[start:i].strip())
            start = i + 1
    if source[start:].strip(): result.append(source[start:].strip())
    return result


def read_catalog():
    ce = ROOT / 'BrogueCE-master/src'
    header = clean((ce / 'brogue/Rogue.h').read_text(encoding='utf-8'))
    enums = {}
    for name in ['tileType', 'dungeonFeatureTypes', 'machineTypes']:
        body = re.search(r'enum\s+' + name + r'\s*{(.*?)}', header, re.S)[1]
        values, value = {}, -1
        for entry in parts(body):
            tokens = entry.split('=', 1)
            value = int(tokens[1], 0) if len(tokens) > 1 else value + 1
            values[tokens[0].strip()] = value
        enums[name] = values
    arrays = {}
    for name, file in [('tileCatalog', 'brogue/Globals.c'), ('dungeonFeatureCatalog', 'brogue/Globals.c')]:
        source = clean((ce / file).read_text(encoding='utf-8'))
        start = re.search(r'\b' + name + r'\s*\[[^]]*\]\s*=\s*\{', source).end()
        depth, quote, escaped, row_start, rows = 1, None, False, None, []
        for i in range(start, len(source)):
            char = source[i]
            if quote:
                if escaped: escaped = False
                elif char == '\\': escaped = True
                elif char == quote: quote = None
            elif char in '\"\'': quote = char
            elif char == '{':
                if depth == 1: row_start = i
                depth += 1
            elif char == '}':
                depth -= 1
                if depth == 1 and row_start is not None:
                    rows.append({'index': len(rows), 'line': source[:row_start].count('\n') + 1,
                                 'fields': parts(source[row_start + 1:i])})
                if depth == 0: break
        arrays[name] = rows
    return {'enums': enums, 'arrays': arrays}


if __name__ == '__main__':
    print(json.dumps(read_catalog(), ensure_ascii=False))
