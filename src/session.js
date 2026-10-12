// 会话层：命令层与 Remote 层共用的状态操作
//
// 这一层只做两件事：
//   1. 把「加载 → 改 → 存」收敛成一次操作（避免两边各自 load/save 漂移）
//   2. 把常用查询（今日待日结、快照）做成结构化数据，供命令渲染或 Remote 传输
//
// 它不含任何展示逻辑——文案、编号、emoji 都留在 index.js / client.js。

import * as R from './rsip.js'
import { streakFor, summaryStats, heatmapDays } from './stats.js'
import { load, save } from './store.js'

/**
 * 读状态、跑一次改动、落盘。改动抛错时不落盘。
 * @param {(state: object, today: string) => T} mutate
 * @returns {T}
 * @template T
 */
export function transact(mutate) {
  const state = load()
  const today = R.todayStr()
  const result = mutate(state, today)
  if (result instanceof Error) throw result
  save(state)
  return result
}

/** 只读：读状态并跑一次查询，不落盘。 */
export function read(query) {
  const state = load()
  return query(state, R.todayStr())
}

// ---------- 查询 ----------

/** 今日待日结列表（守约中 + 今日未告假）。 */
export function pendingToday(state, date = R.todayStr()) {
  return state.rituals.filter(r => r.status === R.STATUS_ACTIVE && R.leaveStateFor(state, r.id, date) === null)
}

/** 今日待日结里还没守约的那些。 */
export function unsettledToday(state, date = R.todayStr()) {
  return pendingToday(state, date).filter(r => !R.isHonoredOn(state, r.id, date))
}

/** 告假中（含到期）的仪式。 */
export function onLeaveToday(state, date = R.todayStr()) {
  return state.rituals
    .filter(r => r.status === R.STATUS_ACTIVE && R.leaveStateFor(state, r.id, date) !== null)
    .map(r => ({ ritual: r, until: R.leaveEndFor(state, r.id, date), due: R.leaveStateFor(state, r.id, date) === 'due' }))
}

/**
 * 一条仪式的可序列化视图（给 client 半用，不含内部字段噪声）。
 * @param {object} r
 * @param {object} state
 * @param {string} date
 */
export function ritualView(r, state, date = R.todayStr()) {
  const leaveState = R.leaveStateFor(state, r.id, date)
  return {
    id: r.id,
    title: r.title,
    note: r.note ?? '',
    kind: r.kind,
    kindLabel: R.KINDS[r.kind]?.label ?? r.kind,
    status: r.status,
    keptDays: r.keptDays ?? 0,
    strengthen: r.strengthen ?? 0,
    parentId: r.parentId ?? null,
    honored: R.isHonoredOn(state, r.id, date),
    streak: r.status === R.STATUS_ACTIVE ? streakFor(state, r.id, date) : 0,
    leave: leaveState === null ? null : { state: leaveState, until: R.leaveEndFor(state, r.id, date) },
  }
}

/**
 * 今日快照：面板一次拿全，避免多次往返。
 * @param {object} state
 * @param {string} date
 */
export function snapshot(state, date = R.todayStr()) {
  const pending = pendingToday(state, date)
  const unsettled = pending.filter(r => !R.isHonoredOn(state, r.id, date))
  const summary = summaryStats(state, date)
  const best = pending.reduce((n, r) => Math.max(n, streakFor(state, r.id, date)), 0)
  return {
    date,
    rituals: pending.map(r => ritualView(r, state, date)),
    leaves: onLeaveToday(state, date).map(x => ({
      id: x.ritual.id,
      title: x.ritual.title,
      kindLabel: R.KINDS[x.ritual.kind]?.label ?? x.ritual.kind,
      until: x.until,
      due: x.due,
      honored: R.isHonoredOn(state, x.ritual.id, date),
    })),
    reserve: R.reserveRituals(state).map(r => ritualView(r, state, date)),
    totals: {
      pending: pending.length,
      settled: pending.length - unsettled.length,
      unsettled: unsettled.length,
      activeCount: summary.activeCount,
      reserveCount: summary.reserveCount,
      runningDays: summary.runningDays,
      breachCount: summary.breachCount,
      totalHonored: summary.totalHonored,
      bestStreak: best,
    },
    canVowToday: R.canVowToday(state, date),
    heat: heatmapDays(state, 14, date).map(d => ({ date: d.date, rate: d.rate, honored: d.honored, breached: d.breached })),
  }
}

// ---------- 动作（全部经 transact，改完即落盘）----------

/** 守约一批仪式，返回逐条结果。 */
export function honorRituals(ids) {
  return transact((state, today) => {
    const rows = []
    for (const id of ids) {
      const r = R.ritualById(state, id)
      if (!r) { rows.push({ id, ok: false, reason: '仪式不存在' }); continue }
      const before = r.keptDays
      R.honorRitual(state, r.id, today)
      rows.push({
        id,
        ok: true,
        title: r.title,
        counted: r.keptDays > before,
        keptDays: r.keptDays,
        streak: streakFor(state, r.id, today),
      })
    }
    return rows
  })
}

/** 一键守约今日全部待日结。 */
export function honorAllPending() {
  return transact((state, today) => {
    const left = unsettledToday(state, today)
    const rows = []
    for (const r of left) {
      R.honorRitual(state, r.id, today)
      rows.push({ id: r.id, ok: true, title: r.title, keptDays: r.keptDays, streak: streakFor(state, r.id, today) })
    }
    return { count: rows.length, rows }
  })
}

/** 失守（连带子树回预备区）。 */
export function breachById(id) {
  return transact((state, today) => {
    const r = R.ritualById(state, id)
    if (!r) throw new Error('仪式不存在')
    if (r.status !== R.STATUS_ACTIVE) throw new Error(`「${r.title}」不在仪式单上`)
    const ids = R.breachRitual(state, r.id, today)
    return { title: r.title, keptDays: r.keptDays, cascaded: ids.length - 1 }
  })
}

/** 从预备区立约。 */
export function activateById(id) {
  return transact((state, today) => {
    const r = R.activateRitual(state, id, null, today)
    return { id: r.id, title: r.title, keptDays: r.keptDays }
  })
}

/** 收录到预备区（不占今日名额）。 */
export function reserveNew({ title, kind, note }) {
  return transact(state => {
    const r = R.reserveRitual(state, { title, kind, note })
    return { id: r.id, title: r.title }
  })
}

/** 删除仪式（连带子树）。 */
export function removeById(id) {
  return transact(state => {
    const r = R.ritualById(state, id)
    if (!r) throw new Error('仪式不存在')
    const ids = new Set(R.subtreeIds(state, r.id))
    const cascaded = ids.size - 1
    state.rituals = state.rituals.filter(x => !ids.has(x.id))
    for (const d of Object.keys(state.checkins)) for (const x of ids) delete state.checkins[d][x]
    for (const d of Object.keys(state.vowedOn)) if (ids.has(state.vowedOn[d])) delete state.vowedOn[d]
    for (const f of state.leaves) {
      f.ritualIds = f.ritualIds.filter(x => !ids.has(x))
      f.resolvedIds = f.resolvedIds.filter(x => !ids.has(x))
    }
    state.leaves = state.leaves.filter(f => f.ritualIds.length > 0)
    return { title: r.title, cascaded }
  })
}

/** 告假。 */
export function requestLeaveByIds(ids, endDate) {
  return transact(state => {
    R.requestLeave(state, ids, endDate)
    return { count: ids.length, endDate }
  })
}

export { R }
