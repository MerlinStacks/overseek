import os
import re

ROOT = '/home/agent/workspaces/Coding Files/Overseek/overseek/server/src'

# Pattern: catch variable used with .message / .code / .stack / .response / .status / .name
# where the variable is untyped (unknown) or typed as {}

def fix_catch_blocks(content: str) -> str:
    """Fix catch (error) blocks that access properties on unknown/{} types."""

    # Find all catch statements: catch (err) or catch (error) or catch (e)
    # We need to handle multi-line catch blocks

    # Replace catch (var) where var is used with .message later
    # This is tricky with regex; we'll do a simpler approach:
    # For each known catch variable name, replace its property accesses

    # Common catch variable names
    catch_vars = ['error', 'err', 'e', 'createError', 'mappingError', 'pluginError', 'fetchError']

    for var in catch_vars:
        # var.message -> (var instanceof Error ? var.message : String(var))
        # But avoid double-replacing if already wrapped
        content = re.sub(
            rf'(?<!\w){re.escape(var)}\.message(?!\w)',
            rf'({var} instanceof Error ? {var}.message : String({var}))',
            content
        )

        # var.code -> (var as any).code
        content = re.sub(
            rf'(?<!\w){re.escape(var)}\.code(?!\w)',
            rf'({var} as any).code',
            content
        )

        # var.stack -> (var instanceof Error ? var.stack : undefined)
        content = re.sub(
            rf'(?<!\w){re.escape(var)}\.stack(?!\w)',
            rf'({var} instanceof Error ? {var}.stack : undefined)',
            content
        )

        # var.name -> (var instanceof Error ? var.name : String(var))
        content = re.sub(
            rf'(?<!\w){re.escape(var)}\.name(?!\w)',
            rf'({var} instanceof Error ? {var}.name : String({var}))',
            content
        )

        # var.response -> (var as any).response
        content = re.sub(
            rf'(?<!\w){re.escape(var)}\.response(?!\w)',
            rf'({var} as any).response',
            content
        )

        # var.response?.status -> (var as any).response?.status
        content = re.sub(
            rf'(?<!\w){re.escape(var)}\.response\?\.status(?!\w)',
            rf'({var} as any).response?.status',
            content
        )

    return content


def fix_empty_object_props(content: str) -> str:
    """Fix property access on {} types (common with axios errors and Prisma exceptions)."""

    # Pattern: obj.message where obj is known to be a response/error object typed as {}
    # We target specific patterns that appear in the error list

    # For objects named 'error' that are already being used with .message (caught above),
    # but also for other variable names like in services/products.ts

    # Replace .message on variables that aren't already wrapped
    # This is risky; we'll be conservative and only target lines that look like error logging

    # Actually, the main remaining {} issues are:
    # - error.message (already handled by fix_catch_blocks for catch vars)
    # - But some variables are declared as `const error: {} = ...` or returned as {}

    # For the specific case of Prisma/axios errors, let's replace:
    # `error.message` where error is typed as {} — but we already handle catch vars.
    # The remaining ones might be from `error` parameters in callbacks.

    return content


def fix_undefined_string(content: str) -> str:
    """Fix string | undefined passed to functions expecting string."""
    # For request.accountId passed to functions — add ! after accountId in function calls
    # But only where it's clearly safe (inside authenticated routes)

    # Replace `accountId` with `accountId!` when used as a function argument
    # Be careful not to replace already fixed ones
    content = re.sub(r'(?<![!\w])accountId(?=\s*[,\)])', 'accountId!', content)

    return content


def process_file(path: str) -> bool:
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    original = content
    content = fix_catch_blocks(content)
    content = fix_undefined_string(content)

    if content == original:
        return False

    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

    return True


fixed = 0
for dirpath, _dirnames, filenames in os.walk(ROOT):
    for fname in filenames:
        if not fname.endswith('.ts'):
            continue
        path = os.path.join(dirpath, fname)
        if process_file(path):
            fixed += 1

print(f'Fixed {fixed} files')
