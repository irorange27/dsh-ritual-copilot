// @local/dsh-ritual-copilot 文件存储：~/.dsh/ritual-copilot.json（$DSH_HOME 优先）
// 数据版本 v2（rituals/checkins/vowedOn/leaves/events）。
// 迁移链：v1 国策树文件（ego-rsip.json，policies/lit|extinguished...）
//   → v2；Vue localStorage 旧导出（version 1）经 /ritual import 同样走迁移。

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { createState, migrateV1toV2 } from './rsip.js'

export function storePath() {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'ritual-copilot.json')
}

function legacyPath() {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'ego-rsip.json')
}

function normalize(s) {
  if (!s) return null
  if (s.version === 2) {
    s.events ||= []
    s.leaves = (s.leaves ?? []).map(f => ({ resolvedIds: [], ...f }))
    s.rituals ??= []
    s.checkins ??= {}
    s.vowedOn ??= {}
    return s
  }
  if (s.version === 1) return migrateV1toV2(s)
  return null
}

export function load() {
  const p = storePath()
  try {
    if (!existsSync(p)) {
      // 自动迁移旧文件
      const legacy = legacyPath()
      if (existsSync(legacy)) {
        const s = JSON.parse(readFileSync(legacy, 'utf8'))
        const n = normalize(s)
        if (n) { save(n); return n }
      }
      return createState()
    }
    const s = JSON.parse(readFileSync(p, 'utf8'))
    return normalize(s) ?? createState()
  } catch {
    return createState()
  }
}

export function save(state) {
  const p = storePath()
  mkdirSync(dirname(p), { recursive: true })
  // 原子写：先写 tmp 再 rename，避免结算中途崩溃损坏
  const tmp = p + '.tmp'
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n')
  renameSync(tmp, p)
}
