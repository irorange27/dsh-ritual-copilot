// Agent 工具：让模型自己读写仪式，而不是只能叫用户打命令。
//
// 这是 issue #3 的核心——用户说"我早上总是起不来"，Agent 应该能自己查库、
// 给建议、直接把仪式加进预备区，而不是回一句"你可以打 /ritual library"。
//
// 与命令层的关系：
//   * 命令是给人和脚本的（/ritual done）
//   * 工具是给 Agent 的（它可以自己决定查什么、加什么）
//   * 两边共用同一份 src/session.js，不存在第二套状态逻辑
//
// 注意：本文件不 import @deepseek-ai/dsh-tools —— 那是宿主内部包，纯 JS 插件
// 在 profile 外解析不到。defineTool 在宿主里只是个类型包装（返回 options 本身），
// 所以这里直接给普通对象，运行时等价。

import * as S from './src/session.js'
import { CATALOG, CATEGORIES, GUIDE } from './src/catalog.js'

/** 仪式类型的中文标签（工具输出用）。 */
function kindLabel(kind) {
  return S.R.KINDS[kind]?.label ?? kind
}

/** 一条仪式的精简视图（工具输出用，不含内部字段）。 */
function brief(r) {
  return {
    title: r.title,
    kind: kindLabel(r.kind),
    status: r.status === S.R.STATUS_ACTIVE ? '守约中' : '预备区',
    keptDays: r.keptDays ?? 0,
    note: r.note || undefined,
  }
}

const KINDS_ENUM = ['自动', '挂钩', '手动', '保险']
const KIND_MAP = { '自动': 'passive', '挂钩': 'semi', '手动': 'active', '保险': 'mechanism' }

/**
 * 全部工具定义。
 * @returns {object[]} 可直接交给 ctx.tools.register 的定义
 */
export function toolDefinitions() {
  return [
    {
      name: 'ritual_overview',
      description: '查看用户的仪式现状：今天待日结的有哪些、哪些守住了、预备区里囤着什么、'
        + '连续守约多少天。在用户提到"仪式""守约""打卡""习惯"或问你他最近状态如何时先读这个。'
        + '它同时返回一份「时段入口」清单（GUIDE），用于回答"我该养成什么习惯"。',
      parameters: {},
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            date: { type: 'string', required: true },
            canVowToday: { type: 'boolean', required: true },
            active: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
            reserve: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
            summary: { type: 'object', required: true, additionalProperties: true },
            guide: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: [
            `仪式 · ${value.date}　今日日结 ${value.summary.settled}/${value.summary.pending}`,
            value.active.length
              ? '守约中：\n' + value.active.map(r => `  ${r.honored ? '✓' : '·'} [${r.kind}] ${r.title}（守约 ${r.keptDays} 天）`).join('\n')
              : '守约中：无',
            value.reserve.length
              ? '预备区：\n' + value.reserve.map(r => `  [${r.kind}] ${r.title}`).join('\n')
              : '预备区：空',
            `累计守约 ${value.summary.totalHonored} 次 · 失守 ${value.summary.breachCount} 次 · 修行 ${value.summary.runningDays} 天`,
            `今日${value.canVowToday ? '可以' : '已不能'}立约。`,
          ].join('\n'),
        }],
      },
      async execute() {
        const snap = S.read(state => S.snapshot(state))
        return {
          date: snap.date,
          canVowToday: snap.canVowToday,
          active: snap.rituals.map(r => ({ title: r.title, kind: r.kindLabel, honored: r.honored, keptDays: r.keptDays, streak: r.streak, note: r.note || undefined })),
          reserve: snap.reserve.map(r => ({ title: r.title, kind: r.kindLabel, keptDays: r.keptDays, note: r.note || undefined })),
          summary: snap.totals,
          guide: GUIDE.map(g => ({ id: g.id, when: g.when, picks: g.picks.map(([t]) => t) })),
        }
      },
    },

    {
      name: 'ritual_search',
      description: '在仪式库里搜索（29 条编目）。用 query 匹配名字/规则/理由。'
        + '用户描述了一个具体烦恼（"我下午总犯困"）但你不知道对应哪条仪式时用这个。'
        + '也可以不带参数拿到全部编目，自己判断。',
      parameters: {
        query: { type: 'string', description: '关键词，例如"手机""洗碗""犯困"。留空返回全部。' },
        category: { type: 'string', enum: CATEGORIES.map(c => c.id), description: '限定分类。' },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            categories: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
            entries: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.entries.length === 0
            ? '仪式库里没有匹配项。可以自己写一条（用 ritual_add），或换个关键词。'
            : value.entries.map(e => `【${e.title}·${e.kind}·${e.category}】${e.rule}\n  为什么：${e.why}`).join('\n\n'),
        }],
      },
      async execute(args) {
        const q = String(args.query ?? '').trim()
        const cat = args.category
        let list = CATALOG
        if (cat) list = list.filter(c => c.cat === cat)
        if (q) list = list.filter(c => c.title.includes(q) || c.rule.includes(q) || c.why.includes(q))
        return {
          categories: CATEGORIES.map(c => ({ id: c.id, label: c.label })),
          entries: list.slice(0, 12).map(c => ({
            title: c.title, kind: kindLabel(c.kind), category: c.cat, rule: c.rule, why: c.why,
          })),
        }
      },
    },

    {
      name: 'ritual_add',
      description: '把一条仪式收录进预备区（不占当天立约名额）。'
        + '推荐给用户之后，直接用它落库，而不是让用户自己打命令。'
        + 'kind 按背后的行为原理选：自动（环境设好不用管）/ 挂钩（钩在每天必做的事上）/ '
        + '手动（要主动想起来做）/ 保险（出事时保住不断档）。第一条永远优先自动或挂钩。',
      parameters: {
        title: { type: 'string', required: true, description: '仪式名，用大白话的动作描述，例如"手机睡前放客厅"。' },
        kind: { type: 'string', enum: KINDS_ENUM, required: true, description: '行为原理。' },
        note: { type: 'string', description: '一句话说明触发条件和具体要求。' },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            title: { type: 'string' },
            message: { type: 'string' },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.ok
            ? `已收录到预备区：「${value.title}」。用户可随时用 /ritual start "${value.title}" 立约（每天限一条）。`
            : `收录失败：${value.message}`,
        }],
      },
      async execute(args) {
        try {
          const r = S.reserveNew({
            title: String(args.title ?? ''),
            kind: KIND_MAP[args.kind] ?? 'passive',
            note: String(args.note ?? ''),
          })
          return { ok: true, title: r.title }
        } catch (error) {
          return { ok: false, message: error?.message ?? String(error) }
        }
      },
    },

    {
      name: 'ritual_settle',
      description: '日结：把仪式记为"守约"或"失守"。'
        + '守约是用户当天做到了；失守是没做到——**不要替用户判断**，只在用户明确说了结果时调用。'
        + '失守会把该仪式及其子仪式退回预备区，但已累积的守约天数保留（这是刻意的设计，不要承诺"清零"）。',
      parameters: {
        title: { type: 'string', required: true, description: '仪式名（可以是名字的一部分）。' },
        result: { type: 'string', enum: ['守约', '失守'], required: true, description: '用户的日结结果。' },
        reason: { type: 'string', description: '失守时可选的原因（用户自己说的，例如"起太晚""出差"）。不要替用户编。' },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            message: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: value.message }],
      },
      async execute(args) {
        const wanted = String(args.title ?? '').trim()
        const hit = S.read(state => {
          const pool = state.rituals.filter(r => r.status === S.R.STATUS_ACTIVE)
          return pool.find(r => r.title === wanted)
            ?? pool.find(r => r.title.includes(wanted))
            ?? pool.find(r => r.id === wanted)
        })
        if (!hit) return { ok: false, message: `仪式单里找不到「${wanted}」。先用 ritual_overview 看现在有哪些。` }
        try {
          if (args.result === '失守') {
            const out = S.breachById(hit.id, String(args.reason ?? ''))
            const why = out.reason ? `原因记为「${out.reason}」。` : ''
            return { ok: true, message: `「${out.title}」记为失守，退回预备区${out.cascaded ? `（连带 ${out.cascaded} 条子仪式）` : ''}。${why}守约天数保留（${out.keptDays} 天）。` }
          }
          const rows = S.honorRituals([hit.id])
          const row = rows[0]
          return { ok: true, message: `「${row.title}」记为守约。累计 ${row.keptDays} 天，连击 ${row.streak} 天。` }
        } catch (error) {
          return { ok: false, message: error?.message ?? String(error) }
        }
      },
    },
  ]
}

/**
 * 挂载工具（只在 tools 服务存在时）。
 * @param {object} ctx cordis 上下文
 * @returns {boolean} 是否挂上
 */
export function registerTools(ctx) {
  // ctx.get() 而不是 ctx.tools：cordis 里属性访问在服务缺失时抛错，
  // ctx.get() 才返回 undefined。（?? 右侧也必须惰性——否则求值即抛。）
  const registry = ctx.get?.('tools')
  if (!registry?.register) return false
  for (const definition of toolDefinitions()) {
    ctx.effect(() => registry.register(definition), `ritual-copilot: tool ${definition.name}`)
  }
  return true
}

// ---------- 主动提醒（#2）----------
//
// 通道：DSH 内置 schedule 服务（daily + IANA 时区）。到期时它把一条 user
// message 注入绑定的 Session，prompt 全部归插件写——所以「只在有未日结
// 仪式时提醒」这一策略不是靠定时器做条件判断，而是把判断交给收到消息
// 的 Agent：prompt 让它先查 ritual_overview，没有未日结就完全不出声。
//
// 用户选择的三项决策（见 issue #2）：
//   1. 触发时间 21:30（Asia/Shanghai，可用 remindAt 覆盖）
//   2. 只在有未日结仪式时提醒（策略写进 prompt，由 Agent 执行）
//   3. Agent 建议、用户确认后才创建（本插件绝不在安装时自动建任务）

/** 提醒任务的固定标题——用它在 schedule 里认出自己，避免重复建。 */
export const REMINDER_TITLE = '仪式日结提醒'

/** 触发时 Agent 收到的 prompt（策略的唯一权威表述）。 */
export function reminderPrompt() {
  return [
    '这是仪式日结提醒（每天 21:30）。',
    '先用 ritual_overview 查一下今天的日结状态，然后按下面的规则行事：',
    '- 如果还有未日结的仪式：用一两句话告诉用户哪几条还没结，'
    + '问一句"今天这几条做到了吗"。不要长篇大论，不要重复仪式的说明。',
    '- 如果今天全部日结完成，或者根本没有守约中的仪式：什么都不用说，'
    + '直接简短确认即可（比如只回一个"今天都结了，没别的事"或等价短句）。'
    + '宁可安静也不要制造每天必看的噪音。',
    '- 用户回答后，用 ritual_settle 记录结果。守约/失守都由用户亲口说，'
    + '不要替用户判断；失守时如果用户顺口说了原因，记到 reason 里。',
  ].join('\n')
}

/**
 * 建议的创建参数（Agent 拿去调 schedule_create）。
 * @param {object} [options]
 * @param {string} [options.time] HH:mm:ss，默认 21:30:00
 * @param {string} [options.zone] IANA 时区，默认 Asia/Shanghai
 */
export function reminderSpec({ time = '21:30:00', zone = 'Asia/Shanghai' } = {}) {
  return {
    title: REMINDER_TITLE,
    prompt: reminderPrompt(),
    daily: { time, time_zone: zone },
  }
}

/**
 * 注册「仪式提醒」相关的 Agent 能力：一个 ritual_reminder 工具，
 * 让 Agent 在用户同意后创建/查看/删除日结提醒。
 *
 * 刻意不做成自动创建：用户选了「Agent 建议、我确认后才建」，
 * 所以工具描述里写明了这个流程。
 */
export function reminderToolDefinition() {
  return {
    name: 'ritual_reminder',
    description: '管理仪式日结提醒（每天定时提醒用户做 /ritual 日结）。'
      + '动作：setup（创建，需要用户先明确同意）、status（查看）、teardown（删除）。'
      + 'setup 前必须先问用户"要不要我每天 21:30 提醒你日结"并得到肯定答复——'
      + '绝不能未经确认就创建。创建用 schedule_create，参数从这个工具的返回里拿。',
    parameters: {
      action: { type: 'string', required: true, enum: ['setup', 'status', 'teardown'], description: '要执行的动作。' },
      time: { type: 'string', description: '可选，HH:mm 格式（默认 21:30）。改时间只影响新建，已建的任务要用 schedule 的更新工具改。' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          action: { type: 'string', required: true },
          needsConfirmation: { type: 'boolean' },
          spec: { type: 'object', additionalProperties: true },
          message: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args) {
      const action = String(args.action ?? '')
      if (action === 'setup') {
        const time = /^\d{2}:\d{2}$/.test(String(args.time ?? '')) ? `${args.time}:00` : '21:30:00'
        const spec = reminderSpec({ time })
        return {
          action,
          needsConfirmation: true,
          spec,
          message: [
            '创建前必须先得到用户的明确同意。用户同意后，调 schedule_create，参数：',
            `  title: "${spec.title}"`,
            `  daily.time: "${spec.daily.time}"`,
            `  daily.time_zone: "${spec.daily.time_zone}"`,
            `  prompt: （见下，原文传入）`,
            '---',
            spec.prompt,
          ].join('\n'),
        }
      }
      if (action === 'status') {
        return {
          action,
          message: '用 schedule_list 查看当前 Session 的任务；标题为「' + REMINDER_TITLE + '」的就是仪式日结提醒。'
            + '（提醒绑定在创建它的 Session 上，换 Session 看不到，但任务仍在原 Session 里生效。）',
        }
      }
      if (action === 'teardown') {
        return {
          action,
          message: '先用 schedule_list 找到标题为「' + REMINDER_TITLE + '」的任务拿到 id，再用 schedule_delete 删除。删除前跟用户确认一句。',
        }
      }
      return { action, message: `未知动作：${action}（支持 setup / status / teardown）` }
    },
  }
}

/** 连同提醒工具一起挂载。 */
export function registerToolsWithReminder(ctx) {
  const mounted = registerTools(ctx)
  if (!mounted) return false
  const registry = ctx.get?.('tools')
  ctx.effect(() => registry.register(reminderToolDefinition()), 'ritual-copilot: tool ritual_reminder')
  return true
}
