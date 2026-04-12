#!/usr/bin/env node
/**
 * Sync the version from `package.json` to:
 *   - `src/version.json`     (consumed by renderer + Rust build.rs)
 *   - `src-tauri/tauri.conf.json`  (consumed by Tauri bundler)
 *
 * Called in two contexts:
 *   1. `npm run postversion` — after `npm version X.Y.Z` bumps
 *      package.json, this script propagates the new value.
 *   2. `npm run build:renderer:tauri` — the `beforeBuildCommand` in
 *      tauri.conf.json, ensures the build always picks up the latest
 *      version even if postversion was skipped (e.g. --no-git-tag-version).
 */

import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

// Source of truth
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))
const version = pkg.version

// 1. src/version.json
const versionJsonPath = join(root, 'src/version.json')
const oldVersionJson = readFileSync(versionJsonPath, 'utf-8').trim()
const newVersionJson = JSON.stringify(version)
if (oldVersionJson !== newVersionJson) {
  writeFileSync(versionJsonPath, newVersionJson + '\n', 'utf-8')
  console.log(`[sync-version] src/version.json → ${version}`)
} else {
  console.log(`[sync-version] src/version.json already ${version}`)
}

// 2. src-tauri/tauri.conf.json
const confPath = join(root, 'src-tauri/tauri.conf.json')
const conf = JSON.parse(readFileSync(confPath, 'utf-8'))
if (conf.version !== version) {
  conf.version = version
  writeFileSync(confPath, JSON.stringify(conf, null, 2) + '\n', 'utf-8')
  console.log(`[sync-version] tauri.conf.json → ${version}`)
} else {
  console.log(`[sync-version] tauri.conf.json already ${version}`)
}
