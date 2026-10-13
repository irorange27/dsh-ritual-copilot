// @local/dsh-ritual-copilot：仪式遵守统计 —— /ritual 命令 + 面板路由
// 守约系措辞：仪式/预备区/仪式单/立约/守约/失守/日结/告假/守约天数

import * as R from './src/rsip.js'
import * as S from './src/session.js'
import { CATALOG, CATEGORIES, GUIDE, guideById, catalogByTitle } from './src/catalog.js'
import { summaryStats, streakFor, heatmapDays, honorRate, ritualHealth, adjustments, breachReasons } from './src/stats.js'
import { load, save } from './src/store.js'
import { registerRoutes } from './routes.js'
import { registerToolsWithReminder } from './tools.js'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { homedir } from 'node:os'

export const name = '@local/dsh-ritual-copilot'

// 三个服务都写进 inject：cordis 会在它们齐备后才调用 apply。
//
// 曾经这里是 inject = ['commands'] + 在 apply 里 `ctx.inject(['tools'], cb)`
// 兜底——那是错的：ctx.inject 是「注册子插件」的 API，不是「等服务出现后
// 回调」。在已激活的 fiber 里调用它，apply 早已返回，回调实测不触发，
// 结果就是工具静默不注册（面板槽注册正常，所以看起来「一半生效」）。
export const inject = ['commands', 'tools', 'connection']

function fmtRitual(r, state, today, { note = true } = {}) {
  const done = R.isHonoredOn(state, r.id, today) ? '✓' : '·'
  const kind = R.KINDS[r.kind]?.label ?? r.kind
  const head = `${done} [${kind}] ${r.title}（守约${r.keptDays}天${r.strengthen ? `·强化+${r.strengthen}` : ''}）`
  if (note && r.note) return head + `\n      └ ${r.note}`
  return head
}

function todayView(state) {
  const today = R.todayStr()
  const lines = [`仪式 · ${today}`]
  // 到期告假优先
  const due = state.rituals.filter(r => r.status === 'active' && R.leaveStateFor(state, r.id, today) === 'due')
  for (const r of due) lines.push(`⚠️ 告假到期「${r.title}」：/ritual honor "${r.title}" 或 /ritual breach "${r.title}"`)
  const todo = state.rituals.filter(r => r.status === 'active' && R.leaveStateFor(state, r.id, today) === null)
  const honored = todo.filter(r => R.isHonoredOn(state, r.id, today)).length
  lines.push(`今日日结 ${honored}/${todo.length}`)
  todo.forEach((r, i) => lines.push(`  ${i + 1}. ` + fmtRitual(r, state, today)))
  const leaves = state.rituals.filter(r => r.status === 'active' && R.leaveStateFor(state, r.id, today) === 'leave')
  for (const r of leaves) lines.push(`  🍃「${r.title}」告假至 ${R.leaveEndFor(state, r.id, today)}`)
  lines.push(R.canVowToday(state, today) ? '今日可立约一条新仪式。' : '今日立约名额已用。')
  return lines.join('\n')
}

function findRitual(state, title, { activeOnly = false } = {}) {
  const t = String(title ?? '').trim()
  if (!t) return undefined
  // 纯数字：按今日待日结列表编号找（最常用）
  if (/^\d+$/.test(t)) {
    const today = R.todayStr()
    const todo = state.rituals.filter(r => r.status === 'active' && R.leaveStateFor(state, r.id, today) === null)
    const byNum = todo[Number(t) - 1]
    if (byNum) return byNum
    // 退化：按全量仪式编号（预备区列表用）
    const all = [...state.rituals.filter(r => r.status === 'active'), ...R.reserveRituals(state)]
    return all[Number(t) - 1]
  }
  const pool = activeOnly
    ? state.rituals.filter(r => r.status === 'active')
    : [
        // 优先守约中，其次预备区，最后按 id
        ...state.rituals.filter(r => r.status === 'active'),
        ...state.rituals.filter(r => r.status !== 'active'),
      ]
  return pool.find(r => r.title === t)
    ?? pool.find(r => r.title.includes(t))
    ?? (activeOnly ? undefined : state.rituals.find(r => r.id === t))
}

function splitArgs(raw) {
  // 支持引号包裹的标题："起床半小时不碰娱乐App" 或 晨跑
  const m = raw.trim().match(/^(\S+)\s*([\s\S]*)$/)
  if (!m) return []
  const out = [m[1]]
  const rest = m[2].trim()
  if (rest) {
    const q = rest.match(/^["「『'“](.+?)["」』'”]\s*([\s\S]*)$/)
    if (q) { out.push(q[1], ...q[2].trim().split(/\s+/).filter(Boolean)) }
    else out.push(...rest.split(/\s+/))
  }
  return out
}

// 路径展开：~/ → homedir；相对路径 → resolve(cwd)
function expandPath(p) {
  const s = String(p ?? '').trim().replace(/^["「『'“]|["」』'”]$/g, '')
  if (s.startsWith('~/') || s === '~') return join(homedir(), s.slice(1))
  if (s.startsWith('$HOME/')) return join(homedir(), s.slice(5))
  return resolve(s)
}

// 旧命令别名（国策树措辞）→ 新命令
const LEGACY_ALIAS = {
  keep: 'honor', light: 'start', relight: 'start', fail: 'breach',
  hand: 'reserve', tree: 'list', freeze: 'leave', stats: 'stats', catalog: 'library', seed: 'seed',
}

const HELP = [
  '仪式 · Ritual Copilot',
  '  /ritual                  今日总览（还有没日结的会直接问你要不要全达成）',
  '  /ritual done             一键全部守约（最常用）',
  '  /ritual 1 2 3            按编号批量守约',
  '  /ritual start <名字|编号> [自动|挂钩|手动|保险]   立约（每天限一条）',
  '  /ritual add <名字> [类型=…] [说明=…]   收录到预备区（不占今日名额）',
  '  /ritual honor <名字|编号>  守约：完成今日日结（单条）',
  '  /ritual breach <名字|编号> [原因=…]  失守（连带子仪式回预备区，守约天数保留）',
  '  /ritual reserve          查看预备区仪式（带编号）',
  '  /ritual list             查看仪式单（守约中）',
  '  /ritual leave <销假日期> <名字1> [名字2...]   告假',
  '  /ritual edit <名字|编号> [新名字=…] [类型=…] [说明=…] [挂靠=…|顶层]   修改仪式',
  '  /ritual rm <名字|编号>    删除仪式（日结记录一并清理，不可撤销）',
  '  /ritual stats            统计（守约率/逐条健康度/调整建议）',
  '  /ritual health           逐条详细复盘（守约率、连击、失守次数）',
  '  /ritual guide [时段|编号]  不知道挑哪条就从这里开始（按"你在哪个时段出问题"）',
  '  /ritual library [分类]   仪式库（sleep/phone/order/work/energy/mood/mech）',
  '（也可以直接跟 Agent 说你想守住什么，让它帮你写成一条仪式）',
  '（想要每天定时提醒日结？跟 Agent 说"帮我设仪式提醒"，确认后它会建）',
  '  /ritual seed             载入 9 个示例仪式到预备区',
  '  /ritual export [路径]    导出 JSON（默认 ~/.dsh/ritual-copilot-YYYY-MM-DD.json）',
  '  /ritual import <路径> [--merge]   导入 JSON（默认替换；--merge 按标题合并）',
  '示例：/ritual done ／ /ritual start 1',
].join('\n')

const KIND_ALIAS = { '自动': 'passive', '挂钩': 'semi', '手动': 'active', '保险': 'mechanism', '省心': 'passive', '省心型': 'passive', '顺手': 'semi', '借力型': 'semi', '用心': 'active', '费力型': 'active', '兜底': 'mechanism', '兜底型': 'mechanism', '被动': 'passive', '半被动': 'semi', '主动': 'active', '机制': 'mechanism', passive: 'passive', semi: 'semi', active: 'active', mechanism: 'mechanism' }

export function apply(ctx) {
  ctx.commands.register({
    name: 'ritual',
    description: '仪式遵守统计：今日日结/立约/预备区/统计/仪式库',
    input: { hint: '[done|1 2 3|guide|start|add|honor|breach|reserve|list|leave|edit|rm|stats|health|library|seed|export|import] …' },
    async handler(invocation) {
      const state = load()
      const persist = () => save(state)
      let [sub, ...rest] = splitArgs(invocation.rawInput ?? '')
      // 旧命令兼容：keep/light/relight/fail/hand/tree/freeze/catalog
      if (sub && LEGACY_ALIAS[sub]) sub = LEGACY_ALIAS[sub]
      const today = R.todayStr()
      try {
        // 今日待日结列表（当日未告假、未日结的守约中仪式）
        const pendingOf = (st, d) => st.rituals
          .filter(r => r.status === 'active' && R.leaveStateFor(st, r.id, d) === null)
        // 批量守约的共用逻辑
        const honorList = (targets, d) => {
          const rows = []
          for (const r of targets) {
            const before = r.keptDays
            R.honorRitual(st__, r.id, d)
            rows.push(`  ✓ ${r.title}${r.keptDays > before ? `　守约 ${r.keptDays} 天 · 连击 ${streakFor(st__, r.id, d)} 天` : '（今日已守约）'}`)
          }
          return rows
        }
        const st__ = state

        if (!sub) {
          // 空状态：不问"你要学会用我的命令"，而是"你描述问题，我负责翻译"
          if (!state.rituals.length) {
            return {
              kind: 'success',
              text: [
                `仪式 · ${today}（还没有仪式）`,
                '',
                '先说说：你最近最想改掉的一个习惯，或者最想守住的一件事是什么？',
                '直接在对话里告诉 Agent 就行——它会帮你写成一条仪式。',
                '',
                '想自己动手的话：',
                '  /ritual guide            从"你在哪个时段出问题"开始',
                '  /ritual library          从仪式库挑（29 条）',
                '  /ritual library sleep    只看作息类',
                '  /ritual add <名字> 类型=自动|挂钩|手动|保险  自己起一条',
                '',
                '提示：第一条挑「自动」型最容易守住（环境设好就不用管，比如晚上屏幕自动变黑白）。',
              ].join('\n'),
            }
          }
          // 有未日结的：直接给出「一键全达成」的机会
          const pending = pendingOf(state, today)
          const left = pending.filter(r => !R.isHonoredOn(state, r.id, today))
          if (left.length) {
            // 未日结项的编号 = 它在今日列表里的位置
            const nums = pending.map((r, i) => (R.isHonoredOn(state, r.id, today) ? null : i + 1)).filter(Boolean)
            return {
              kind: 'success',
              text: [
                todayView(state),
                '',
                `还有 ${left.length} 条没日结。全做到了就打：/ritual done`,
                `只做到部分：/ritual ${nums.slice(0, 3).join(' ')}${nums.length > 3 ? ' …' : ''}（按上面编号）`,
              ].join('\n'),
            }
          }
          return { kind: 'success', text: todayView(state) }
        }
        // /ritual done —— 一键全部守约
        if (sub === 'done' || sub === 'all') {
          const pending = pendingOf(state, today)
          const left = pending.filter(r => !R.isHonoredOn(state, r.id, today))
          if (!pending.length) return { kind: 'success', text: '今天没有需要日结的仪式（还没有立约，或全部告假中）。' }
          if (!left.length) return { kind: 'success', text: `今天 ${pending.length} 条已全部守约 ✓ 明天见。` }
          const rows = honorList(left, today)
          persist()
          return { kind: 'success', text: [`✓ 今日全部守约（${left.length} 条）`, ...rows].join('\n') }
        }
        // /ritual 1 2 3 —— 按今日待日结列表的编号批量守约
        if (/^[\d\s,，]+$/.test(sub)) {
          const nums = [sub, ...rest].join(' ').split(/[\s,，]+/).filter(Boolean).map(Number)
          const pending = pendingOf(state, today)
          if (!pending.length) return { kind: 'error', text: '今天没有需要日结的仪式。' }
          const targets = []
          const bad = []
          for (const n of nums) {
            const r = pending[n - 1]
            if (r) { if (!targets.includes(r)) targets.push(r) }
            else bad.push(n)
          }
          if (!targets.length) return { kind: 'error', text: `编号超出范围（今天共 ${pending.length} 条）：${bad.join(' ')}` }
          const left = targets.filter(r => !R.isHonoredOn(state, r.id, today))
          if (!left.length) return { kind: 'success', text: `${targets.map(r => r.title).join('、')} 今日已守约 ✓` }
          const rows = honorList(left, today)
          persist()
          const tail = bad.length ? `\n（编号 ${bad.join(' ')} 超出范围，今天共 ${pending.length} 条）` : ''
          return { kind: 'success', text: [`✓ 守约 ${left.length} 条`, ...rows, tail].filter(Boolean).join('\n') }
        }
        if (sub === 'start') {
          const raw = rest.join(' ')
          const title = (rest[0] ?? '').replace(/^["「『'“]|["」』'”]$/g, '')
          // 先看是不是已有点位的仪式（编号或模糊名）
          const existing = /^\d+$/.test(raw.trim()) ? findRitual(state, raw.trim()) : findRitual(state, title || raw)
          if (existing) {
            if (existing.status === 'active') return { kind: 'error', text: `「${existing.title}」已在守约中。` }
            R.activateRitual(state, existing.id, null, today); persist()
            return { kind: 'success', text: `立约「${existing.title}」（已守约 ${existing.keptDays} 天）。今日名额已用，明天再来。` }
          }
          if (!title) return { kind: 'error', text: '用法：/ritual start <名字|编号> [自动|挂钩|手动|保险]\n预备区仪式用编号最快：先 /ritual reserve 看编号。' }
          const kind = KIND_ALIAS[rest[1]] ?? 'passive'
          const r = R.vowRitual(state, { title, kind }, today); persist()
          return { kind: 'success', text: `立约「${r.title}」（${R.KINDS[kind].label}）。今日名额已用，明天再来。` }
        }
        if (sub === 'add') {
          // /ritual add <名字> [类型=自动|挂钩|手动|保险] [说明=…] —— 只收录进预备区，不占今日名额
          const kvs = []
          const nameParts = []
          for (const a of rest) {
            if (/^(类型|说明)=/.test(a)) kvs.push(a)
            else nameParts.push(a)
          }
          const title = nameParts.join(' ').replace(/^["「『'“]|["」』'”]$/g, '').trim()
          if (!title) return { kind: 'error', text: '用法：/ritual add <名字> [类型=自动|挂钩|手动|保险] [说明=…]\n例：/ritual add 睡前拉伸10分钟 类型=挂钩 说明=钩在刷牙后' }
          let kind = 'passive'
          let note = ''
          for (const kv of kvs) {
            const m = kv.match(/^(类型|说明)=([\s\S]*)$/)
            if (!m) continue
            if (m[1] === '类型') {
              const k = KIND_ALIAS[m[2]] ?? KIND_ALIAS[m[2].replace(/^["「『'“]|["」』'”]$/g, '')]
              if (!k) return { kind: 'error', text: `类型只认：自动/挂钩/手动/保险（你写的：${m[2]}）` }
              kind = k
            } else note = m[2]
          }
          try {
            const r = R.reserveRitual(state, { title, kind, note }); persist()
            return { kind: 'success', text: `已收录到预备区「${r.title}」（${R.KINDS[kind].label}${note ? `：${note}` : ''}）。不占今日名额，立约时 /ritual start "${r.title}"。` }
          } catch (e) {
            return { kind: 'error', text: e.message + `（已在单中？直接 /ritual start "${title}" 立约）` }
          }
        }
        if (sub === 'honor') {
          const r = findRitual(state, rest.join(' '), { activeOnly: true })
          if (!r) return { kind: 'error', text: `仪式单里找不到：${rest.join(' ')}（/ritual 看编号，直接 /ritual <编号> 更快）` }
          const before = r.keptDays
          R.honorRitual(state, r.id, today); persist()
          const tail = r.keptDays > before ? `　守约 ${r.keptDays} 天 · 连击 ${streakFor(state, r.id, today)} 天` : '（今日已守约）'
          return { kind: 'success', text: `✓ ${r.title}${tail}` }
        }
        if (sub === 'breach') {
          // /ritual breach <名字|编号> [原因=…] —— 原因可选，但记下来才能做归因
          const reasonArg = rest.find(a => /^原因=/.test(a))
          const nameArgs = rest.filter(a => !/^原因=/.test(a))
          const reason = reasonArg ? reasonArg.slice(3) : ''
          const r = findRitual(state, nameArgs.join(' '), { activeOnly: true })
          if (!r) return { kind: 'error', text: `仪式单里找不到：${nameArgs.join(' ')}（失守只针对守约中的仪式）` }
          const ids = R.breachRitual(state, r.id, today, reason); persist()
          const extra = ids.length > 1 ? `，连带 ${ids.length - 1} 条子仪式回预备区` : '，回到预备区'
          const tail = reason ? `　原因记下了：${reason}` : '　（想留个原因：/ritual breach <名字> 原因=起太晚）'
          return { kind: 'success', text: `✗ ${r.title} 失守${extra}　守约天数保留（${r.keptDays} 天）${tail}` }
        }
        if (sub === 'reserve') {
          const list = R.reserveRituals(state)
          if (!list.length) {
            return {
              kind: 'success',
              text: [
                '预备区是空的。',
                '  /ritual library 挑一条（或 /ritual library sleep 只看作息类）',
                '  /ritual add <名字> 类型=自动|挂钩|手动|保险  自己起一条',
                '也可以直接跟 Agent 说你想守住什么，让它帮你写。',
              ].join('\n'),
            }
          }
          return { kind: 'success', text: '预备区（/ritual start <编号> 立约）：\n' + list.map((r, i) => `  ${i + 1}. ${fmtRitual(r, state, today)}`).join('\n') }
        }
        if (sub === 'list') {
          const roots = R.activeRoots(state)
          if (!roots.length) return { kind: 'success', text: '仪式单是空的。/ritual reserve 看预备区，用 /ritual start <编号> 立约。' }
          const lines = []
          const walk = (r, depth) => {
            lines.push('  '.repeat(depth) + fmtRitual(r, state, today))
            for (const c of R.childrenOf(state, r.id)) walk(c, depth + 1)
          }
          for (const r of roots) walk(r, 0)
          return { kind: 'success', text: '仪式单（守约中）：\n' + lines.join('\n') }
        }
        if (sub === 'leave') {
          const endDate = rest[0]
          const titles = rest.slice(1)
          const ids = []
          for (const t of titles) {
            const r = findRitual(state, t.replace(/^["「『'“]|["」』'”]$/g, ''), { activeOnly: true })
            if (r) ids.push(r.id)
          }
          R.requestLeave(state, ids, endDate); persist()
          return { kind: 'success', text: `已告假 ${ids.length} 条仪式至 ${endDate}（到期当天须一次性补结算）。` }
        }
        if (sub === 'edit') {
          // /ritual edit <名字|编号> [新名字=…] [类型=自动|挂钩|手动|保险] [说明=…] [挂靠=名字|编号|顶层] [查看]
          const targetRaw = rest[0] ?? ''
          if (!targetRaw || targetRaw === '查看') return { kind: 'error', text: '用法：/ritual edit <名字|编号> [新名字=…] [类型=…] [说明=…] [挂靠=…|顶层]\n例：/ritual edit 1 类型=手动 ／ /ritual edit "起床半小时不碰娱乐App" 新名字=晨间启动 说明=起床后先喝水' }
          const r = findRitual(state, targetRaw)
          if (!r) return { kind: 'error', text: `找不到：${targetRaw}（/ritual reserve 或 /ritual 看编号）` }
          const kvs = rest.slice(1)
          if (!kvs.length || kvs[0] === '查看') {
            const parent = r.parentId ? R.ritualById(state, r.parentId) : null
            return {
              kind: 'success',
              text: [
                `「${r.title}」`,
                `  类型：${R.KINDS[r.kind]?.label ?? r.kind}  状态：${r.status === 'active' ? '守约中' : '预备区'}  守约${r.keptDays}天`,
                `  说明：${r.note || '（无）'}`,
                `  挂靠：${parent ? `「${parent.title}」下` : '顶层'}`,
                '改法：/ritual edit <编号> 新名字=… 类型=自动|挂钩|手动|保险 说明=… 挂靠=名字|编号|顶层',
              ].join('\n'),
            }
          }
          const patch = {}
          for (const kv of kvs) {
            const m = kv.match(/^(新名字|类型|说明|挂靠)=([\s\S]*)$/)
            if (!m) return { kind: 'error', text: `看不懂「${kv}」，只认 新名字=/类型=/说明=/挂靠=（挂靠=顶层 表示放到顶层）` }
            const [, k, v] = m
            if (k === '新名字') patch.title = v
            else if (k === '类型') {
              const kind = KIND_ALIAS[v] ?? KIND_ALIAS[v.replace(/^["「『'“]|["」』'”]$/g, '')]
              if (!kind) return { kind: 'error', text: `类型只认：自动/挂钩/手动/保险（你写的：${v}）` }
              patch.kind = kind
            }
            else if (k === '说明') patch.note = v
            else if (k === '挂靠') {
              const pv = v.replace(/^["「『'“]|["」』'”]$/g, '')
              if (pv === '顶层' || pv === '无' || pv === '根') patch.parentId = null
              else {
                const parent = findRitual(state, pv)
                if (!parent) return { kind: 'error', text: `挂靠找不到：${v}` }
                patch.parentId = parent.id
              }
            }
          }
          const updated = R.updateRitual(state, r.id, patch); persist()
          return { kind: 'success', text: `已修改「${updated.title}」（${R.KINDS[updated.kind]?.label}）。守约天数、日结记录不动。` }
        }
        if (sub === 'rm') {
          const r = findRitual(state, rest.join(' '))
          if (!r) return { kind: 'error', text: `找不到：${rest.join(' ')}` }
          if (R.subtreeIds(state, r.id).length > 1 && !rest.join(' ').includes('--yes')) {
            return { kind: 'error', text: `「${r.title}」下还有 ${R.subtreeIds(state, r.id).length - 1} 条子仪式，确认删除加 --yes：/ritual rm "${r.title}" --yes` }
          }
          const ids = new Set(R.subtreeIds(state, r.id))
          state.rituals = state.rituals.filter(x => !ids.has(x.id))
          for (const d of Object.keys(state.checkins)) for (const id of ids) delete state.checkins[d][id]
          for (const d of Object.keys(state.vowedOn)) if (ids.has(state.vowedOn[d])) delete state.vowedOn[d]
          for (const f of state.leaves) { f.ritualIds = f.ritualIds.filter(x => !ids.has(x)); f.resolvedIds = f.resolvedIds.filter(x => !ids.has(x)) }
          state.leaves = state.leaves.filter(f => f.ritualIds.length > 0)
          persist()
          return { kind: 'success', text: `已删除「${r.title}」（连带 ${ids.size - 1} 条子仪式，日结记录一并清理）。` }
        }
        if (sub === 'stats') {
          const s = summaryStats(state, today)
          const heat = heatmapDays(state, 14, today).map(d => d.rate === null ? '□' : d.rate >= 1 ? '■' : d.rate >= 0.5 ? '▨' : '▧').join('')
          const rate = honorRate(state)
          const lines = [
            `修行 ${s.runningDays} 天 · 守约中 ${s.activeCount} · 预备区 ${s.reserveCount}`,
            `立约 ${s.vowCount} 次 · 失守 ${s.breachCount} 次（连带 ${s.cascadedNodes} 条）· 累计守约 ${s.totalHonored} 次`,
            rate.rate === null
              ? '守约率 —（还没有日结记录）'
              : `守约率 ${Math.round(rate.rate * 100)}%（${rate.honored} 守 / ${rate.breached} 失）`,
            `近14天：${heat}`,
          ]

          // 逐条健康度：只在样本够时给比率
          const health = ritualHealth(state, { endDate: today })
          const rated = health.filter(r => r.rate !== null)
          if (rated.length) {
            lines.push('', '逐条守约率（从最容易失守的开始）：')
            for (const r of rated.slice(0, 8)) {
              const flag = r.rate < 0.5 ? '⚠' : r.rate >= 0.95 ? '★' : ' '
              lines.push(`  ${flag} ${Math.round(r.rate * 100).toString().padStart(3)}%  ${r.title}（${r.kindLabel}·${r.honored}/${r.due} 天${r.breaches ? `·失守 ${r.breaches} 次` : ''}）`)
            }
            if (rated.length > 8) lines.push(`  … 还有 ${rated.length - 8} 条`)
          }

          // 失守原因
          const reasons = breachReasons(state)
          const known = reasons.filter(x => x.reason !== '（未记录原因）')
          if (known.length) {
            lines.push('', '失守原因：' + known.map(x => `${x.reason}×${x.count}`).join('　'))
          }

          // 调整建议：只在证据明显时给
          const advice = adjustments(state, { endDate: today })
          if (advice.length) {
            lines.push('', '值得调整：')
            for (const a of advice) lines.push(`  · ${a.text}`)
          }

          return { kind: 'success', text: lines.join('\n') }
        }
        if (sub === 'health') {
          // /ritual health —— 逐条详细，专门用来做复盘
          const health = ritualHealth(state, { endDate: today })
          if (!health.length) return { kind: 'success', text: '还没有任何仪式。' }
          return {
            kind: 'success',
            text: health.map(r => {
              const pct = r.rate === null ? '样本不足' : `${Math.round(r.rate * 100)}%（${r.honored}/${r.due} 天）`
              return [
                `${r.status === 'active' ? '●' : '○'} ${r.title}　[${r.kindLabel}]`,
                `   守约率 ${pct}　当前连击 ${r.streak} 天　累计守约 ${r.keptDays} 天`,
                r.breaches ? `   失守 ${r.breaches} 次${r.lastBreach ? `，最近 ${r.lastBreach}` : ''}` : null,
              ].filter(Boolean).join('\n')
            }).join('\n'),
          }
        }
        if (sub === 'guide') {
          // /ritual guide —— 从「你在哪个时段出问题」入手，而不是让你翻 29 条
          const which = rest[0]
          if (!which) {
            return {
              kind: 'success',
              text: [
                '你在哪个时段最容易出问题？',
                '',
                ...GUIDE.map((g, i) => `  ${i + 1}. ${g.when}`),
                '',
                '用编号或名字看具体推荐：/ritual guide 1',
                '想看完整清单：/ritual library',
              ].join('\n'),
            }
          }
          let entry = /^\d+$/.test(which) ? GUIDE[Number(which) - 1] : guideById(which)
          if (!entry) entry = GUIDE.find(g => g.when.includes(which) || g.id === which)
          if (!entry) return { kind: 'error', text: `没有这个时段：${which}\n先打 /ritual guide 看列表` }
          const lines = [`${entry.when}`, '']
          entry.picks.forEach(([title, why]) => {
            const c = catalogByTitle(title)
            const label = R.KINDS[c?.kind]?.label ?? '自动'
            const easy = c && c.kind !== 'active'
            lines.push(`【${title}·${label}${easy ? '·好守' : ''}】`)
            lines.push(`   ${c?.rule ?? ''}`)
            lines.push(`   为什么：${why}`)
            lines.push(`   → /ritual add "${title}" 类型=${label}`)
            lines.push('')
          })
          lines.push('带「好守」的更容易守住——先把一条立稳，别一次加三条。')
          return { kind: 'success', text: lines.join('\n') }
        }
        if (sub === 'library') {
          const cat = rest[0]
          const list = cat ? CATALOG.filter(c => c.cat === cat) : CATALOG
          if (!list.length) return { kind: 'success', text: '分类：' + CATEGORIES.map(c => `${c.id}(${c.label})`).join('、') }
          const empty = !state.rituals.length
          const head = empty
            ? '仪式库：挑一条，它会直接进预备区（每天只能立约一条，所以先多挑几条囤着也没关系）。\n'
            : ''
          return {
            kind: 'success',
            text: head + list.map(c => `【${c.title}·${R.KINDS[c.kind]?.label}】${c.rule}\n  ${c.why}\n  → /ritual add "${c.title}" 类型=${R.KINDS[c.kind]?.label}`).join('\n\n'),
          }
        }
        if (sub === 'seed') {
          R.seedExamples(state); persist()
          return { kind: 'success', text: '已载入 9 个示例仪式到预备区（每天限立约一条）。/ritual reserve 看编号挑。' }
        }
        if (sub === 'export') {
          // 默认导出到 ~/.dsh/ritual-copilot-YYYY-MM-DD.json
          const out = rest[0]
            ? expandPath(rest[0])
            : join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), `ritual-copilot-${today}.json`)
          mkdirSync(dirname(out), { recursive: true })
          writeFileSync(out, JSON.stringify(state, null, 2) + '\n')
          return { kind: 'success', text: `已导出 ${state.rituals.length} 条仪式 → ${out}` }
        }
        if (sub === 'import') {
          const file = rest.find(a => !a.startsWith('--')) ?? ''
          if (!file) return { kind: 'error', text: '用法：/ritual import <路径> [--merge]（Ego/Ritual 导出的 JSON，v1 国策树格式自动迁移）' }
          const merge = rest.includes('--merge')
          const p = expandPath(file)
          let data
          try {
            data = JSON.parse(readFileSync(p, 'utf8'))
          } catch (e) {
            // 读不到时给一句能定位的：到底解析成了哪个绝对路径
            return { kind: 'error', text: `读取失败：${p}（${e.code ?? ''} ${e.message}）。\n提示：用绝对路径最稳，如 /Users/你的名字/Downloads/ritual.json；"~" 已支持展开。` }
          }
          if (!data || (!Array.isArray(data.rituals) && !Array.isArray(data.policies))) return { kind: 'error', text: '格式不正确：缺少 rituals/policies 数组（应为 Ego/Ritual 导出的 JSON）。' }
          if (!merge) {
            R.replaceState(state, data); persist()
            return { kind: 'success', text: `导入成功（替换）：${(data.rituals ?? data.policies).length} 条仪式。原数据已被覆盖，如需找回请从备份重新导入。\n` + todayView(state) }
          }
          // --merge：按标题合并，不存在的追加；checkins/vowedOn 按日期合并；leaves/events 追加去重
          const incoming = data.version === 2 ? data : R.migrateV1toV2(data)
          let added = 0
          for (const q of incoming.rituals) {
            if (!q || !q.title) continue
            if (state.rituals.some(x => x.title === q.title)) continue
            state.rituals.push({ id: R.uid(), status: 'reserve', vowedDate: '', keptDays: 0, strengthen: 0, parentId: null, kind: 'passive', note: '', ...q, id: R.uid() })
            added++
          }
          for (const [d, recs] of Object.entries(incoming.checkins ?? {})) {
            // 导入方优先：补上缺失日期的日结记录（现有当日记录保留）
            state.checkins[d] = { ...(recs ?? {}), ...(state.checkins[d] ?? {}) }
          }
          for (const [d, id] of Object.entries(incoming.vowedOn ?? {})) {
            state.vowedOn[d] ??= id
          }
          const seenLeave = new Set(state.leaves.map(f => f.id))
          for (const f of incoming.leaves ?? []) {
            if (f && f.id && !seenLeave.has(f.id)) { state.leaves.push({ resolvedIds: [], ...f }); seenLeave.add(f.id) }
          }
          state.events.push(...(incoming.events ?? []))
          if (state.events.length > 2000) state.events.splice(0, state.events.length - 2000)
          persist()
          return { kind: 'success', text: `导入成功（合并）：新增 ${added} 条仪式，当前共 ${state.rituals.length} 条。\n` + todayView(state) }
        }
        return { kind: 'success', text: HELP }
      } catch (err) {
        return { kind: 'error', text: err.message }
      }
    },
  })

  // 面板数据路由：connection 已在 inject 里声明，到这里必然是齐备的。
  if (ctx.connection?.fetch?.register) registerRoutes(ctx, S)

  // Agent 工具：让模型自己读写仪式，而不是只会叫用户打命令。
  registerToolsWithReminder(ctx)
}
