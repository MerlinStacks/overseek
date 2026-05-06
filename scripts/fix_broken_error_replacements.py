import os
import re

ROOT = '/home/agent/workspaces/Coding Files/Overseek/overseek/server/src'

def fix_file(path: str) -> bool:
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Pattern: identifier.(error instanceof Error ? error.message : String(error))
    # This happens when the script matched `error.message` inside `data.error.message`
    # and replaced it incorrectly.
    broken_pattern = r'([a-zA-Z_][a-zA-Z0-9_]*)\.\(error instanceof Error \? error\.message : String\(error\)\)'

    if not re.search(broken_pattern, content):
        return False

    content = re.sub(broken_pattern, r'\1.error.message', content)

    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

    return True

fixed = 0
for dirpath, _dirnames, filenames in os.walk(ROOT):
    for fname in filenames:
        if not fname.endswith('.ts'):
            continue
        path = os.path.join(dirpath, fname)
        if fix_file(path):
            fixed += 1
            print(f'Fixed: {path}')

print(f'\nTotal files fixed: {fixed}')
