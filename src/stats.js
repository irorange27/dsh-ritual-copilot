// 历史统计计算层 —— 基于 rsip.js 的 checkins + events 推导
import { todayStr, leaveStateFor, isHonoredOn } from './rsip.js'

export function dateStr(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDays(dateStrVal, n) {
  const d = new Date(dateStrVal + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return dateStr(d)
}

export function diffDays(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000)
}

// 每日结算：honored 来自 checkins，breached 来自失守事件（只计失守的根节点，级联子孙不算）
export function dailyStats(state) {
  const m = {}
  for (const [date, recs] of Object.entries(state.checkins ?? {})) {
    m[date] ||= { honored: 0, breached: 0 }
    m[date].honored += Object.keys(recs).length
  }
  for (const ev of state.events ?? []) {
    // 兼容旧事件名 fail（未迁移的脏数据兜底）
    if (ev.type === 'breach' || ev.type === 'fail') (m[ev.date] ||= { honored: 0, breached: 0 }).breached += 1
  }
  return m
}

// 当前连续守约天数：今天未日结则从昨天往前数；告假日不断档也不计数
export function streakFor(state, id, fromDate = todayStr()) {
  let d = fromDate
  if (!isHonoredOn(state, id, d)) d = addDays(d, -1)
  let streak = 0
  for (let i = 0; i < 366; i++) {
    if (isHonoredOn(state, id, d)) { streak++; d = addDays(d, -1); continue }
    if (leaveStateFor(state, id, d) === 'leave') { d = addDays(d, -1); continue }
    break
  }
  return streak
}

export function summaryStats(state, date = todayStr()) {
  const events = state.events ?? []
  const breaches = events.filter(e => e.type === 'breach' || e.type === 'fail')
  const vows = events.filter(e => e.type === 'vow' || e.type === 'activate' || e.type === 'add' || e.type === 'relight')
  const totalHonored = Object.values(state.checkins ?? {})
    .reduce((n, r) => n + Object.keys(r).length, 0)
  return {
    runningDays: state.createdAt ? diffDays(state.createdAt, date) + 1 : 1,
    activeCount: state.rituals.filter(r => r.status === 'active').length,
    reserveCount: state.rituals.filter(r => r.status !== 'active').length,
    vowCount: vows.length,
    breachCount: breaches.length,
    cascadedNodes: breaches.reduce((n, e) => n + (e.cascade || 1), 0),
    totalHonored,
    totalKept: state.rituals.reduce((n, r) => n + r.keptDays, 0),
  }
}

// 近 N 天的热力图数据：rate = honored / (honored + breached)，无结算记 null
export function heatmapDays(state, n = 84, endDate = todayStr()) {
  const stats = dailyStats(state)
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    const date = addDays(endDate, -i)
    const s = stats[date]
    const total = s ? s.honored + s.breached : 0
    out.push({
      date,
      honored: s?.honored ?? 0,
      breached: s?.breached ?? 0,
      // 旧字段名兼容（调用方若还读 kept/failed）
      kept: s?.honored ?? 0,
      failed: s?.breached ?? 0,
      rate: total > 0 ? s.honored / total : null,
    })
  }
  return out
}
