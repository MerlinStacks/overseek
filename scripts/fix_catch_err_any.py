import os
import re

ROOT = '/home/agent/workspaces/Coding Files/Overseek/overseek/server/src'

def fix_file(path: str) -> bool:
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Find all catch variable names
    catches = re.findall(r'catch \((\w+): any\)', content)
    if not catches:
        return False

    # Remove : any from all catch clauses
    content = re.sub(r'catch \((\w+): any\)', r'catch (\1)', content)

    # For each unique variable name, replace .message safely
    for var in set(catches):
        # var.message -> (var instanceof Error ? var.message : String(var))
        # Support optional chaining: var.message?.includes -> (var instanceof Error ? var.message : String(var))?.includes
        pattern = rf'\b{re.escape(var)}\.message(\?)?\b'

        def repl(m):
            optional_q = m.group(1) or ''
            return f'({var} instanceof Error ? {var}.message : String({var})){optional_q}'

        content = re.sub(pattern, repl, content)

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
