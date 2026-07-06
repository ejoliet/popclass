```markdown
# popclass Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill provides guidance for contributing to the `popclass` JavaScript codebase. It documents the repository's coding conventions, commit patterns, and testing approaches, and offers step-by-step workflows and helpful commands for common development tasks. The codebase does not use a framework and follows a consistent style for file naming, imports, and exports.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `myComponent.js`, `userService.js`

### Import Style
- Use **absolute imports** (not relative).
  - Example:
    ```javascript
    import { fetchData } from 'services/apiService';
    ```

### Export Style
- Use **named exports**.
  - Example:
    ```javascript
    // In utils/mathUtils.js
    export function add(a, b) {
      return a + b;
    }
    ```

    ```javascript
    // In another file
    import { add } from 'utils/mathUtils';
    ```

### Commit Patterns
- Commit messages are **freeform**, sometimes prefixed with `spike` or `fix`.
  - Example: `fix: handle null values in popClass`
  - Example: `spike: initial implementation of popClass core logic`
- Typical commit message length: ~66 characters.

## Workflows

### Creating a New Feature
**Trigger:** When adding a new feature or module.
**Command:** `/new-feature`

1. Create a new file using camelCase naming.
2. Use absolute imports for dependencies.
3. Export your functions or classes using named exports.
4. Write or update corresponding test files (`*.test.*`).
5. Commit changes, optionally prefixing with `spike` if experimental.

### Fixing a Bug
**Trigger:** When resolving a bug or issue.
**Command:** `/fix-bug`

1. Locate the relevant file(s) using camelCase naming.
2. Apply the fix, maintaining code style conventions.
3. Update or add tests to cover the bug fix.
4. Commit with a message prefixed by `fix:`, describing the change.

### Writing Tests
**Trigger:** When adding or updating tests.
**Command:** `/write-test`

1. Create or update a test file matching the pattern `*.test.*`.
2. Follow the codebase's import/export conventions in your tests.
3. Run the test suite to ensure correctness.

## Testing Patterns

- Test files follow the pattern: `*.test.*` (e.g., `popClass.test.js`).
- The testing framework is **unknown**; inspect existing tests for structure.
- Tests should import code using absolute paths and named imports.
- Example:
  ```javascript
  import { popClass } from 'utils/popClass';

  test('popClass returns correct class name', () => {
    expect(popClass('active')).toBe('active');
  });
  ```

## Commands
| Command        | Purpose                                   |
|----------------|-------------------------------------------|
| /new-feature   | Start a new feature or module             |
| /fix-bug       | Begin a bug fix workflow                  |
| /write-test    | Add or update a test file                 |
```
