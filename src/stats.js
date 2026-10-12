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

/**
 * 总体守约率：所有仪式、所有日期的 honored / (honored + 失守次数)。
 *
 * 分母是"有结论的天数"——没日结的天既不算守也不算失，因为那通常是
 * 忘了记，把它当失守算会让人放弃（失守不归零的同一个理由）。
 */
export function honorRate(state) {
  const honored = Object.values(state.checkins ?? {})
    .reduce((n, recs) => n + Object.keys(recs).length, 0)
  const breached = (state.events ?? []).filter(e => e.type === 'breach' || e.type === 'fail').length
  const settled = honored + breached
  return { honored, breached, settled, rate: settled ? honored / settled : null }
}

/**
 * 最容易失守的那条（样本足够时）。
 * @returns {{ title: string, rate: number, due: number, honored: number } | null}
 */
export function weakestRitual(state, options = {}) {
  const ranked = ritualHealth(state, options).filter(r => r.rate !== null)
  if (!ranked.length) return null
  return ranked[0]
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

// ---------- 逐条仪式的健康度（#4：用真实数据检验规则本身）----------

/** 一条仪式的全部失守事件（含历史，因为它可能已回预备区）。 */
function breachesOf(state, ritualId) {
  return (state.events ?? []).filter(e => (e.type === 'breach' || e.type === 'fail') && e.ritualId === ritualId)
}

/** 一条仪式在某个日期是否本该日结（守约中且不在告假中）。 */
function wasDueOn(state, ritual, date) {
  if (ritual.vowedDate && date < ritual.vowedDate) return false
  for (const f of state.leaves ?? []) {
    if (!f.ritualIds.includes(ritual.id)) continue
    if (date >= f.startDate && date <= f.endDate) return false
  }
  return true
}

/**
 * 逐条仪式统计：守约率、失守次数、当前连击。
 *
 * 守约率 = 守约天数 / 应日结天数（按 vow 日期起算，扣掉告假日）。
 * 只在应日结天数 ≥ `minDue` 时才给 rate——样本太少的百分比是噪音，
 * 会误导"这条仪式不行"的判断。
 *
 * @param {object} state
 * @param {object} [options]
 * @param {number} [options.minDue] 给出 rate 所需的最少应日结天数（默认 5）
 * @param {string} [options.endDate]
 * @returns {object[]} 按守约率升序（最容易失守的在前）
 */
export function ritualHealth(state, { minDue = 5, endDate = todayStr() } = {}) {
  const rows = []
  for (const r of state.rituals) {
    // 应日结天数：vow 当天到 endDate（或失守当天，取较早者）
    const breaches = breachesOf(state, r.id)
    const lastBreach = breaches.length ? breaches[breaches.length - 1].date : null
    const until = lastBreach && lastBreach < endDate ? lastBreach : endDate
    let due = 0
    if (r.vowedDate && r.vowedDate <= until) {
      const span = diffDays(r.vowedDate, until) + 1
      for (let i = 0; i < span; i++) {
        if (wasDueOn(state, r, addDays(r.vowedDate, i))) due++
      }
    }
    const honored = Object.entries(state.checkins ?? {})
      .filter(([, recs]) => recs[r.id] === 'honored').length
    rows.push({
      id: r.id,
      title: r.title,
      kind: r.kind,
      kindLabel: KIND_LABELS[r.kind] ?? r.kind,
      status: r.status,
      keptDays: r.keptDays ?? 0,
      due,
      honored,
      missed: Math.max(0, due - honored),
      breaches: breaches.length,
      lastBreach,
      streak: streakFor(state, r.id, endDate),
      // 样本不足时不给比率，避免用两天的数据下结论
      rate: due >= minDue ? honored / due : null,
    })
  }
  return rows.sort((a, b) => {
    // 有比率的排前面，按比率升序；没比率的按失守次数降序
    if (a.rate === null && b.rate === null) return b.breaches - a.breaches
    if (a.rate === null) return 1
    if (b.rate === null) return -1
    return a.rate - b.rate
  })
}

const KIND_LABELS = { passive: '自动', semi: '挂钩', active: '手动', mechanism: '保险' }

/** 失守原因分布。 */
export function breachReasons(state) {
  const counts = new Map()
  for (const e of state.events ?? []) {
    if (e.type !== 'breach' && e.type !== 'fail') continue
    const key = e.reason?.trim() || '（未记录原因）'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
}

/**
 * 从数据里得出「这条规则该不该改」的候选结论。
 *
 * 每条都是一句可执行的建议 + 支撑它的数字。故意保守：只在证据明显时给，
 * 说不清就不说——错误的自律建议比没有建议更糟。
 *
 * @param {object} state
 * @param {object} [options]
 * @returns {{ kind: string, ritual?: string, text: string }[]}
 */
export function adjustments(state, options = {}) {
  const health = ritualHealth(state, options)
  const out = []

  for (const r of health) {
    if (r.rate === null) continue
    // 手动型且明显守不住 → 建议换成自动/挂钩，或拆小
    if (r.rate < 0.5 && r.kind === 'active') {
      out.push({
        kind: 'downgrade',
        ritual: r.title,
        text: `「${r.title}」是手动型，守约率只有 ${Math.round(r.rate * 100)}%（${r.honored}/${r.due} 天）。`
          + '手动型最费心力，建议：① 改成挂靠某个必然事件（挂钩型），或 ② 拆到小得不可能失败。',
      })
    } else if (r.rate < 0.6 && r.breaches >= 3) {
      out.push({
        kind: 'shrink',
        ritual: r.title,
        text: `「${r.title}」失守 ${r.breaches} 次，守约率 ${Math.round(r.rate * 100)}%。`
          + '标准定得太高了——把门槛降到现在能做到的程度，先让"守住"这件事发生。',
      })
    }
    // 守约率极高且已经很久 → 可以强化了
    if (r.rate >= 0.95 && r.due >= 21 && r.status === 'active') {
      out.push({
        kind: 'strengthen',
        ritual: r.title,
        text: `「${r.title}」守约率 ${Math.round(r.rate * 100)}%（${r.honored}/${r.due} 天），已经稳了。`
          + '可以强化一档（比如把时间提前 15 分钟），或者把它当父仪式、往上挂一条新的。',
      })
    }
  }

  // 结构性观察：有没有立太多条
  const active = state.rituals.filter(r => r.status === 'active')
  if (active.length >= 5) {
    out.push({
      kind: 'too-many',
      text: `现在同时守约 ${active.length} 条。维护成本随条数线性上升，而守约率通常不会——`
        + '考虑先失守两条最不重要的（失守只回预备区，天数保留，不丢东西）。',
    })
  }

  const reasons = breachReasons(state)
  const repeated = reasons.find(x => x.count >= 3 && x.reason !== '（未记录原因）')
  if (repeated) {
    out.push({
      kind: 'reason',
      text: `失守原因里「${repeated.reason}」出现了 ${repeated.count} 次。`
        + '同一个原因反复出现，通常说明规则与环境冲突，而不是意志力问题。',
    })
  }

  return out
}

