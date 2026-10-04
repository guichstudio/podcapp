#!/usr/bin/env node
// Why this file exists instead of a glob in package.json's "test" script:
//
// `pnpm test` runs the "test" script via `sh -c` (POSIX sh), not the
// interactive login shell (zsh) a developer types commands in. POSIX sh's
// `**` is NOT a recursive glob — it behaves like a single `*`, so
// `src/**/*.test.ts` only ever matched files exactly ONE directory below
// `src/`. That silently dropped `src/config.test.ts` (depth 0) with `pnpm
// test` still exiting 0 and reporting a full, green run — see
// .superpowers/sdd/2026-09-09-freemium-abonnements/task-2-report.md for how
// that was found. Patching the glob to `src/**/*.test.ts src/*.test.ts`
// covers today's files but re-creates the same trap for the next
// contributor: a test file two-or-more directories deep under `src/` (e.g.
// `src/jobs/sub/foo.test.ts`) would again be silently skipped, because
// package.json cannot carry a comment warning them.
//
// This script walks `src/` itself with plain recursive filesystem calls
// (no shell glob involved at any depth) and hands the resulting file list
// straight to `tsx --test`. It also refuses to report success if that walk
// finds zero test files: a test command that matches nothing and exits 0 is
// exactly the "no silent failures" hazard this file exists to close.
//
// Adding a test file at any depth under src/ (src/x.test.ts,
// src/a/b/c.test.ts, ...) needs no change here or in package.json.

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = path.join(root, 'src')

function findTestFiles(dir) {
  const found = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = path.join(dir, entry)
    const info = statSync(full)
    if (info.isDirectory()) {
      found.push(...findTestFiles(full))
    } else if (entry.endsWith('.test.ts')) {
      found.push(full)
    }
  }
  return found
}

const files = findTestFiles(srcDir).sort()

if (files.length === 0) {
  console.error(
    'run-tests: found zero *.test.ts files under src/ — refusing to exit 0. ' +
      'This almost certainly means test discovery is broken (wrong path, ' +
      'moved directory, ...), not that there are no tests.'
  )
  process.exit(1)
}

const localTsx = path.join(root, 'node_modules', '.bin', 'tsx')
const tsxCmd = existsSync(localTsx) ? localTsx : 'tsx'

const result = spawnSync(tsxCmd, ['--test', ...files], { stdio: 'inherit' })
if (result.error) {
  console.error(`run-tests: failed to run ${tsxCmd}: ${result.error.message}`)
  process.exit(1)
}
process.exit(result.status ?? 1)
