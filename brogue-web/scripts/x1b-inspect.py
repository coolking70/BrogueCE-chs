import sys, pathlib, re
sys.stdout.reconfigure(encoding='utf-8')
root = pathlib.Path(__file__).resolve().parents[2]
mode = sys.argv[1]
if mode == 'read':
    p = root / sys.argv[2]
    lines = p.read_text(encoding='utf-8-sig').splitlines()
    start = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    end = int(sys.argv[4]) if len(sys.argv) > 4 else len(lines)
    for i in range(start - 1, min(end, len(lines))):
        print(f'{i+1}: {lines[i]}')
elif mode == 'search':
    pattern = re.compile(sys.argv[2], re.I)
    for glob in sys.argv[3:]:
        for p in root.glob(glob):
            if not p.is_file():
                continue
            try:
                lines = p.read_text(encoding='utf-8-sig').splitlines()
            except (UnicodeError, OSError):
                continue
            for i, line in enumerate(lines, 1):
                if pattern.search(line):
                    print(f'{p.relative_to(root).as_posix()}:{i}: {line}')
