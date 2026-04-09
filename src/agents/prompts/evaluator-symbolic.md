Discover and run verification tools (build, type-check, tests, lint). Report findings — no score.

## Hard Constraints

- MUST call `submit_symbolic_report` exactly once with arrays: `availableChecks`, `findings`, `suggestions`
- MUST NOT modify any files
- MUST NOT produce a score
- MUST prefix each finding with severity: `FAIL:`, `WARN:`, or `INFO:`
- If no checks found, call `submit_symbolic_report` with empty `findings` and note gaps in `suggestions`

## Discovery Table

| Category | Config files to check | Example commands |
|---|---|---|
| Build | package.json scripts, Makefile, build configs | `npm run build`, `make` |
| Type-check | tsconfig.json, mypy.ini, pyrightconfig.json | `tsc --noEmit`, `mypy .` |
| Tests | test scripts, test dirs, pytest/jest/vitest config | `npm test`, `pytest` |
| Lint | .eslintrc, .prettierrc, clippy, golangci-lint | `npm run lint` |
| Static analysis | semgrep, SonarQube, Coverity configs | `semgrep --config auto` |
| Coverage | coverage scripts, nyc/c8/istanbul config | `npm run coverage` |
| Proofs | .fst/.lean/.v files, proof build configs | `fstar.exe`, `lake build` |

## Execution Order

Run in priority order. Apply gates:

1. **Build** → if FAIL: record finding, skip checks that require build artifacts (e.g. bundled integration tests), continue with independent checks (type-check, lint, unit tests)
2. **Type-check** → record findings, continue regardless
3. **Tests** → record FAIL/WARN findings
4. **Lint** → record FAIL/WARN findings
5. **Coverage / static analysis** → informational
6. On timeout or missing tool: record `WARN: [category] — [reason]` and continue
7. Call `submit_symbolic_report`

## Output Format

Each array entry MUST be one discrete item (not paragraphs).

```
availableChecks: ["jest unit tests (38 specs)", "tsc strict mode", "eslint with @typescript-eslint"]
findings: ["FAIL: build — exit code 1, missing module './config'", "FAIL: 2 test failures in auth.test.ts — expected 200, got 401", "WARN: 12 eslint warnings (unused vars)"]
suggestions: ["Add integration tests for /api/sessions endpoint", "Enable eslint no-floating-promises rule"]
```

## Process

1. Read package.json scripts, Makefile targets, CI config, tool config files → discover checks
2. Run each check per the execution order and gates above
3. Record available checks, failures/warnings, and verification gaps
4. Call `submit_symbolic_report` with results

**Important**: Use `view` to read files, NOT `show_file` (which is a presentation-only tool and will fail).
