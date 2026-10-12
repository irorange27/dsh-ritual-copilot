// Ritual Copilot —— 仪式遵守统计的领域模型与规则引擎
// 规则（源自 RSIP §21 与实战攻略，用守约系重述）：
//  1. 每天最多立约一条（新建或从预备区启用）
//  2. 仪式失守 → 该节点及其所有子孙仪式失守，回到预备区
//  3. 预备区的仪式保留"守约进度"（keptDays 永不丢失）
//  4. 告假：暂停一段时期的日结，到期当天须一次性补结算，守约则销假，未守约按规则失守

export const KINDS = {
  // 四类原理：环境替你做 / 钩子带你做 / 自己主动做 / 出事保你
  passive:   { label: '自动', desc: '环境设好就行：不用动脑，不用记，失败了都不知道怎么失败的' },
  semi:      { label: '挂钩', desc: '钩在每天必做的事上：如果A就B，不用额外下决心' },
  active:    { label: '手动', desc: '每天要主动想起来去做：最费心，一次只立一条这种' },
  mechanism: { label: '保险', desc: '出事时保住不断档：告假、低配执行、复盘都算这类' },
}

export const KIND_BADGE_CLASS = {
  passive: 'border-green-500/40 text-green-400',
  semi: 'border-blue-500/40 text-blue-400',
  active: 'border-amber-500/40 text-amber-400',
  mechanism: 'border-purple-500/40 text-purple-400',
}

// 守约习惯养成的参考天数（Lally et al. 平均 66 天）
export const HABIT_TARGET = 66

// 状态值：'active'=守约中，'reserve'=预备区
export const STATUS_ACTIVE = 'active'
export const STATUS_RESERVE = 'reserve'

export function todayStr(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function uid() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4)
}

export function createState() {
  return {
    version: 2,
    createdAt: todayStr(),
    rituals: [],       // Ritual[]
    checkins: {},      // { [date]: { [ritualId]: 'honored' } }
    vowedOn: {},       // { [date]: ritualId }  每日新立约限一条
    leaves: [],        // { id, ritualIds, startDate, endDate, resolvedIds }[]
    events: [],        // 事件流：立约/启用/失守/告假/销假，用于历史统计
  }
}

// ---------- v1 → v2 迁移 ----------
// v1（旧国策树措辞）：policies/status lit|extinguished/litDate/totalHeldDays,
// settlements{kept}/addedOn/freezes{policyIds}/events{add,relight,fail,freeze,thaw}

const V1_STATUS = { lit: STATUS_ACTIVE, extinguished: STATUS_RESERVE }
const V1_EVENT = { add: 'vow', relight: 'activate', fail: 'breach', freeze: 'leave', thaw: 'back' }

export function migrateV1toV2(old) {
  const s = createState()
  s.createdAt = old.createdAt ?? todayStr()
  s.rituals = (old.policies ?? []).map(p => ({
    id: p.id ?? uid(),
    title: p.title ?? '',
    note: p.note ?? '',
    kind: p.kind ?? 'passive',
    parentId: p.parentId ?? null,
    status: V1_STATUS[p.status] ?? STATUS_RESERVE,
    vowedDate: p.litDate ?? '',
    keptDays: p.totalHeldDays ?? 0,
    strengthen: p.strengthen ?? 0,
  }))
  s.checkins = {}
  for (const [date, recs] of Object.entries(old.settlements ?? {})) {
    s.checkins[date] = {}
    for (const [rid, v] of Object.entries(recs ?? {})) {
      s.checkins[date][rid] = 'honored'
    }
  }
  s.vowedOn = { ...(old.addedOn ?? {}) }
  s.leaves = (old.freezes ?? []).map(f => ({
    id: f.id ?? uid(),
    ritualIds: [...(f.policyIds ?? [])],
    startDate: f.startDate ?? todayStr(),
    endDate: f.endDate ?? todayStr(),
    resolvedIds: [...(f.resolvedIds ?? [])],
  }))
  s.events = (old.events ?? []).map(ev => ({ ...ev, type: V1_EVENT[ev.type] ?? ev.type }))
  return s
}

// ---------- 查询 ----------

export function ritualById(state, id) {
  return state.rituals.find(r => r.id === id)
}

export function childrenOf(state, id) {
  return state.rituals.filter(r => r.parentId === id && r.status === STATUS_ACTIVE)
}

export function subtreeIds(state, id) {
  const out = []
  const walk = (pid) => {
    out.push(pid)
    for (const c of childrenOf(state, pid)) walk(c.id)
  }
  walk(id)
  return out
}

// 守约中的根节点：状态为 active，且父节点不在守约中（防御脏数据）
export function activeRoots(state) {
  return state.rituals.filter(r =>
    r.status === STATUS_ACTIVE &&
    (!r.parentId || !state.rituals.some(q => q.id === r.parentId && q.status === STATUS_ACTIVE))
  )
}

// 预备区仪式，按守约天数倒序
export function reserveRituals(state) {
  return state.rituals
    .filter(r => r.status === STATUS_RESERVE)
    .sort((a, b) => b.keptDays - a.keptDays)
}

// 仪式的告假状态：null=正常守约, 'leave'=告假中, 'due'=到期待销假结算
export function leaveStateFor(state, id, date) {
  for (const f of state.leaves) {
    if (!f.ritualIds.includes(id) || f.resolvedIds.includes(id)) continue
    return date < f.endDate ? 'leave' : 'due'
  }
  return null
}

export function leaveEndFor(state, id, date) {
  for (const f of state.leaves) {
    if (f.ritualIds.includes(id) && !f.resolvedIds.includes(id)) return f.endDate
  }
  return null
}

export function isHonoredOn(state, id, date) {
  return state.checkins[date]?.[id] === 'honored'
}

export function canVowToday(state, date = todayStr()) {
  return !state.vowedOn[date]
}

function logEvent(state, ev) {
  state.events ||= []
  state.events.push({ date: todayStr(), ...ev })
  if (state.events.length > 2000) state.events.splice(0, state.events.length - 2000)
}

// ---------- 动作 ----------

export function vowRitual(state, { title, note = '', kind = 'passive', parentId = null }, date = todayStr()) {
  if (!title?.trim()) throw new Error('仪式需要一个名字')
  if (!canVowToday(state, date)) throw new Error('今日立约名额已用完（每天最多立约一条）')
  const r = {
    id: uid(),
    title: title.trim(),
    note,
    kind,
    parentId,
    status: STATUS_ACTIVE,
    vowedDate: date,
    keptDays: 0,
    strengthen: 0,
  }
  state.rituals.push(r)
  state.vowedOn[date] = r.id
  logEvent(state, { type: 'vow', ritualId: r.id, title: r.title })
  return r
}

// 收录到预备区（从仪式库挑选）：不消耗每日立约名额
export function reserveRitual(state, { title, note = '', kind = 'passive' }) {
  const name = String(title ?? '').trim()
  if (!name) throw new Error('仪式需要一个名字')
  if (!KINDS[kind]) throw new Error(`未知的类型：${kind}`)
  if (state.rituals.some(r => r.title === name)) throw new Error(`「${name}」已在单中`)
  const r = {
    id: uid(), title: name, note, kind, parentId: null,
    status: STATUS_RESERVE, vowedDate: '', keptDays: 0, strengthen: 0,
  }
  state.rituals.push(r)
  return r
}

export function activateRitual(state, id, parentId = null, date = todayStr()) {
  if (!canVowToday(state, date)) throw new Error('今日立约名额已用完（每天最多立约一条）')
  const r = ritualById(state, id)
  if (!r || r.status !== STATUS_RESERVE) throw new Error('该仪式不在预备区')
  r.status = STATUS_ACTIVE
  r.parentId = parentId
  r.vowedDate = date
  state.vowedOn[date] = id
  logEvent(state, { type: 'activate', ritualId: id, title: r.title })
  return r
}

export function honorRitual(state, id, date = todayStr()) {
  const r = ritualById(state, id)
  if (!r) return
  const day = (state.checkins[date] ||= {})
  if (day[id] === 'honored') return
  day[id] = 'honored'
  r.keptDays += 1
  resolveLeaveFor(state, id)
}

// 失守 = 递归整棵子树回到预备区（守约进度保留）
export function breachRitual(state, id, date = todayStr()) {
  const ids = subtreeIds(state, id)
  for (const rid of ids) {
    const r = ritualById(state, rid)
    if (r && r.status !== STATUS_RESERVE) r.status = STATUS_RESERVE
    for (const f of state.leaves) {
      f.ritualIds = f.ritualIds.filter(x => x !== rid)
      f.resolvedIds = f.resolvedIds.filter(x => x !== rid)
    }
  }
  state.leaves = state.leaves.filter(f => f.ritualIds.length > 0)
  const day = state.checkins[date]
  if (day) for (const rid of ids) delete day[rid]
  logEvent(state, { type: 'breach', ritualId: id, title: ritualById(state, id)?.title ?? '', cascade: ids.length })
  return ids
}

// 告假：暂停一组仪式的日结直到 endDate（含当天结算）
export function requestLeave(state, ritualIds, endDate) {
  if (!ritualIds.length) throw new Error('请选择要告假的仪式')
  if (!endDate || endDate <= todayStr()) throw new Error('销假日期必须在今天之后')
  state.leaves.push({ id: uid(), ritualIds: [...ritualIds], startDate: todayStr(), endDate, resolvedIds: [] })
  logEvent(state, { type: 'leave', cascade: ritualIds.length, note: endDate })
}

function resolveLeaveFor(state, id) {
  for (const f of state.leaves) {
    if (f.ritualIds.includes(id) && !f.resolvedIds.includes(id)) {
      f.resolvedIds.push(id)
      logEvent(state, { type: 'back', ritualId: id, title: ritualById(state, id)?.title ?? '' })
    }
  }
  state.leaves = state.leaves.filter(f => f.resolvedIds.length < f.ritualIds.length)
}

export function strengthenRitual(state, id) {
  const r = ritualById(state, id)
  if (r) r.strengthen += 1
}

// 修改仪式：名字/类型/说明/挂靠（守约天数、日结记录不动）
export function updateRitual(state, id, patch) {
  const r = ritualById(state, id)
  if (!r) throw new Error('仪式不存在')
  if (patch.title !== undefined) {
    const t = String(patch.title).trim()
    if (!t) throw new Error('仪式需要一个名字')
    if (state.rituals.some(x => x.id !== id && x.title === t)) throw new Error(`「${t}」已存在，换个名字`)
    r.title = t
  }
  if (patch.kind !== undefined) {
    if (!KINDS[patch.kind]) throw new Error(`未知的类型：${patch.kind}（省心型/借力型/费力型/兜底）`)
    r.kind = patch.kind
  }
  if (patch.note !== undefined) r.note = String(patch.note)
  if (patch.parentId !== undefined) {
    const pid = patch.parentId
    if (pid === null) { r.parentId = null }
    else {
      const parent = ritualById(state, pid)
      if (!parent) throw new Error('挂靠的仪式不存在')
      if (pid === id) throw new Error('不能挂在自己下')
      if (subtreeIds(state, id).includes(pid)) throw new Error('不能挂在自己的子仪式下')
      if (parent.status !== STATUS_ACTIVE) throw new Error('只能挂在守约中的仪式下')
      r.parentId = pid
    }
  }
  return r
}

// ---------- 持久化 ----------
// 注意：Node/DSH Host 端没有 localStorage。
// loadState/saveState 保留为"纯内存"兼容壳，真正在文件持久化见 store.js。

export function loadState() {
  return createState()
}

export function saveState(_state) {
  // no-op：Host 端由 store.js 负责落盘
}

export function replaceState(state, imported) {
  const src = imported.version === 2 ? imported : migrateV1toV2(imported)
  state.version = 2
  state.createdAt = src.createdAt ?? todayStr()
  state.rituals = src.rituals ?? []
  state.checkins = src.checkins ?? {}
  state.vowedOn = src.vowedOn ?? {}
  state.leaves = (src.leaves ?? []).map(f => ({ resolvedIds: [], ...f }))
  state.events = src.events ?? []
}

// 示例仪式（进入预备区，按"每日限立约一条"的节奏逐个上场）
export function seedExamples(state) {
  const seeds = [
    ['起床半小时不碰娱乐App', 'semi', '起床后 30 分钟内严禁使用娱乐 App，只允许做正事。'],
    ['晚上屏幕自动变黑白', 'passive', '手机自动化：23:00 - 次日 7:00 屏幕自动调为黑白模式。纯省心，维护成本为零。'],
    ['深夜只能站着玩手机', 'semi', '23:00 后可以玩手机，但只能站着玩。'],
    ['半夜不刷短视频', 'passive', '23:30 后不得使用小红书、抖音等限制组 App。'],
    ['每天8点半起床', 'semi', '每天 8:30 起床。可强化升级：每升一级，起床时间提前 15 分钟。'],
    ['生病出差可告假', 'mechanism', '出现影响生活一天以上的不可抗力时，可为受影响仪式告假；到期当天须一次性重新满足。'],
    ['饭后立刻洗碗', 'semi', '在家吃完饭后立即洗碗。'],
    ['回家先洗澡再休息', 'semi', '回家进门开启 15 分钟倒计时，期间把换洗衣物放入浴室。'],
    ['不在沙发上玩手机', 'passive', '禁止在沙发上使用手机。'],
  ]
  for (const [title, kind, note] of seeds) {
    state.rituals.push({
      id: uid(), title, note, kind, parentId: null,
      status: STATUS_RESERVE, vowedDate: '', keptDays: 0, strengthen: 0,
    })
  }
}
