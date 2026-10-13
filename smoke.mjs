// ritual-copilot 本地冒烟：不启动 dsh，直接调命令 handler
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const tmp = mkdtempSync(join(tmpdir(), 'ritual-copilot-'))
process.env.DSH_HOME = tmp

const indexModule = await import('./index.js')
const { apply } = indexModule

const regs = []
const mountedRoutes = []
const mountedTools = []
apply({
  commands: { register: (d) => regs.push(d) },
  // Agent 工具（ctx.tools）也一并挂载并验证
  tools: { register: (d) => { mountedTools.push(d); return () => {} } },
  // 面板路由（/api/ritual.*）也一并挂载并验证
  connection: { fetch: { register: (route) => route } },
  effect: (fn) => { const made = fn(); if (typeof made !== 'function') mountedRoutes.push(made) },
})
const ritual = regs.find(r => r.name === 'ritual')
const ctl = new AbortController()
const run = (rawInput) => ritual.handler({ rawInput, commandId: 't', agent: {}, attachments: [], signal: ctl.signal })
const expect = (cond, msg) => { if (!cond) throw new Error('SMOKE FAIL: ' + msg) }

// inject 必须覆盖命令、工具、路由三个服务。
// 曾经的 bug：只声明 ['commands']，用 ctx.inject 兜底等 tools——
// 那是「注册子插件」的 API，不是「等服务后回调」，回调实测不触发，
// 结果是工具与路由静默不注册（面板槽却正常，看起来"一半生效"）。
expect(
  ['commands', 'tools', 'connection'].every(service => indexModule.inject.includes(service)),
  `inject 应声明 commands/tools/connection，实际 ${JSON.stringify(indexModule.inject)}`,
)

let r = await run('')
console.log(`\n$ /ritual\n[${r.kind}] ${r.text}`)
expect(r.kind === 'success' && r.text.includes('还没有仪式') && r.text.includes('/ritual library'), '空状态引导')
expect(r.text.includes('最想改掉的一个习惯'), '空状态从"描述问题"入口起')

r = await run('seed')
console.log(`\n$ /ritual seed\n[${r.kind}] ${r.text}`)
expect(r.kind === 'success', 'seed')

// 新流程：reserve 看编号 → start 编号立约
r = await run('reserve')
console.log(`\n$ /ritual reserve\n[${r.kind}] ${r.text.slice(0, 300)}`)
expect(r.kind === 'success' && r.text.includes('1.'), 'reserve 编号')

r = await run('start 1')
console.log(`\n$ /ritual start 1\n[${r.kind}] ${r.text}`)
expect(r.kind === 'success' && r.text.includes('立约'), 'start 编号立约')

r = await run('start 第二个')
console.log(`\n$ /ritual start 第二个\n[${r.kind}] ${r.text}`)
expect(r.kind === 'error' && r.text.includes('名额'), '每日限一条')

r = await run('honor 1')
console.log(`\n$ /ritual honor 1\n[${r.kind}] ${r.text.slice(0, 300)}`)
expect(r.kind === 'success' && r.text.includes('守约'), 'honor 编号')

r = await run('list')
console.log(`\n$ /ritual list\n[${r.kind}] ${r.text}`)
expect(r.kind === 'success' && r.text.includes('仪式单'), 'list')

r = await run('stats')
console.log(`\n$ /ritual stats\n[${r.kind}] ${r.text}`)
expect(r.kind === 'success' && r.text.includes('守约中'), 'stats')

// 旧命令别名
r = await run('keep 1')
console.log(`\n$ /ritual keep 1（别名）\n[${r.kind}] ${r.text.slice(0, 120)}`)
expect(r.kind === 'success', 'keep 别名')

r = await run('hand')
console.log(`\n$ /ritual hand（别名→reserve）\n[${r.kind}] ${r.text.slice(0, 120)}`)
expect(r.kind === 'success' && r.text.includes('预备区'), 'hand 别名')

r = await run('tree')
expect(r.kind === 'success' && r.text.includes('仪式单'), 'tree 别名')
r = await run('catalog sleep')
expect(r.kind === 'success' || r.text.includes('仪式库') || r.text.includes('起床半小时'), 'catalog 别名')
// guide：从时段入口给推荐，且推荐项都能被 add 走通
r = await run('guide')
console.log(`\n$ /ritual guide\n[${r.kind}] ${r.text.slice(0, 240)}`)
expect(r.kind === 'success' && r.text.includes('你在哪个时段最容易出问题'), 'guide 列表')
r = await run('guide 1')
expect(r.kind === 'success' && r.text.includes('好守') && r.text.includes('/ritual add'), 'guide 编号给推荐')
r = await run('guide 早上')
expect(r.kind === 'success' && r.text.includes('起床'), 'guide 关键词')
r = await run('guide 99')
expect(r.kind === 'error', 'guide 越界')
// 推荐里给的第一条 add 命令必须真能跑
const addLine = (await run('guide 1')).text.match(/→ (\/ritual add "[^"]+" 类型=\S+)/)
expect(addLine !== null, 'guide 输出含可执行的 add 命令')
r = await run(addLine[1].replace('^/ritual ', ''))
expect(r.kind === 'success' && r.text.includes('预备区'), 'guide 给的 add 命令可执行')

r = await run('library sleep')
console.log(`\n$ /ritual library sleep\n[${r.kind}] ${r.text.slice(0, 320)}`)
expect(r.kind === 'success' && r.text.includes('/ritual add'), 'library 指向 add（先进预备区）')

r = await run('export')
console.log(`\n$ /ritual export\n[${r.kind}] ${r.text}`)
expect(r.kind === 'success', 'export')
r = await run('import')
expect(r.kind === 'error', 'import 缺路径应失败')

// import/export 回环
const today = new Date()
const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
const exported = join(tmp, `ritual-copilot-${stamp}.json`)
const cur = JSON.parse(readFileSync(exported, 'utf8'))
expect(Array.isArray(cur.rituals) && cur.version === 2, '导出 v2 格式')

// 伪造 v1 国策树导出，走 --merge（测迁移）
const v1 = { version: 1, createdAt: '2026-09-01', policies: [{ id: 'v1-1', title: 'V1老仪式', note: '', kind: 'passive', parentId: null, status: 'lit', litDate: '2026-09-01', totalHeldDays: 7, strengthen: 0 }], settlements: { '2026-09-01': { 'v1-1': 'kept' } }, addedOn: {}, freezes: [], events: [{ date: '2026-09-01', type: 'add', policyId: 'v1-1', title: 'V1老仪式' }] }
const v1Path = join(tmp, 'v1-export.json')
writeFileSync(v1Path, JSON.stringify(v1, null, 2))
r = await run(`import "${v1Path}" --merge`)
console.log(`\n$ /ritual import v1 --merge\n[${r.kind}] ${r.text.slice(0, 300)}`)
expect(r.kind === 'success' && r.text.includes('新增 1 条仪式'), 'v1 merge 迁移')

// 替换导入 v1
r = await run(`import "${v1Path}"`)
console.log(`\n$ /ritual import v1（替换）\n[${r.kind}] ${r.text.slice(0, 200)}`)
expect(r.kind === 'success' && r.text.includes('1 条仪式'), 'v1 replace 迁移')

// 失守 + 告假
r = await run('breach V1老仪式')
console.log(`\n$ /ritual breach\n[${r.kind}] ${r.text.slice(0, 200)}`)
expect(r.kind === 'success' && r.text.includes('失守'), 'breach')
r = await run('fail V1老仪式')
expect(r.kind === 'error', '失守后不在单中')

// edit：查看 → 改类型/名字/说明/挂靠
r = await run('start 晨跑半小时 手动')
console.log(`\n$ /ritual start 晨跑半小时\n[${r.kind}] ${r.text}`)
expect(r.kind === 'success' && r.text.includes('晨跑半小时'), 'start 新仪式')
r = await run('edit 晨跑半小时')
console.log(`\n$ /ritual edit 查看\n[${r.kind}] ${r.text.slice(0, 200)}`)
expect(r.kind === 'success' && r.text.includes('手动'), 'edit 查看')
r = await run('edit 晨跑半小时 类型=自动')
expect(r.kind === 'success', 'edit 类型')
r = await run('edit 晨跑半小时')
expect(r.text.includes('自动'), 'edit 类型生效')
r = await run('edit 晨跑半小时 新名字=晨跑 说明=起床先喝水再跑')
expect(r.kind === 'success' && r.text.includes('晨跑'), 'edit 名字+说明')
r = await run('edit 晨跑 类型=不对')
expect(r.kind === 'error', 'edit 非法类型应失败')
// rm：删改名后的
r = await run('rm 晨跑')
console.log(`\n$ /ritual rm\n[${r.kind}] ${r.text}`)
expect(r.kind === 'success', 'rm')

// 坏文件
const badPath = join(tmp, 'bad.json')
writeFileSync(badPath, '{not json')
r = await run(`import "${badPath}"`)
expect(r.kind === 'error', 'bad import should fail')

// ===== 第三优先止血（放在最后，避免影响前面的编号断言）=====
// 第三优先止血：done 一键 / 批量编号 / 单条单行回显
r = await run('seed')
expect(r.kind === 'success', 'seed again')
r = await run('start 1')
expect(r.kind === 'success', 'start 1')
// 无参时应提示 done
r = await run('')
console.log(`\n$ /ritual（有1条待日结）\n[${r.kind}] ${r.text.slice(0, 200)}`)
expect(r.kind === 'success', '空参提示')
// 只有1条时不强推 done，直接给 done 也能用
r = await run('done')
console.log(`\n$ /ritual done（只1条）\n[${r.kind}] ${r.text}`)
expect(r.kind === 'success' && r.text.includes('全部守约'), 'done 单条')
// 再 done 应幂等
r = await run('done')
expect(r.kind === 'success' && r.text.includes('已全部守约'), 'done 幂等')
// honor 单条应只回一行，不刷整屏
r = await run('start 2')
expect(r.kind === 'error', '名额已用')
r = await run('reserve')
expect(r.kind === 'success', 'reserve')
// breach 单行
r = await run('breach 1')
console.log(`\n$ /ritual breach\n[${r.kind}] ${r.text}`)
expect(r.kind === 'success' && r.text.split('\n').length === 1, 'breach 单行')
// 批量编号：先重置成干净状态
const batchPath = join(tmp, 'batch.json')
writeFileSync(batchPath, JSON.stringify({ version: 2, createdAt: stamp, rituals: [
  { id: 'b1', title: 'A仪式', note: '', kind: 'passive', parentId: null, status: 'active', vowedDate: stamp, keptDays: 0, strengthen: 0 },
  { id: 'b2', title: 'B仪式', note: '', kind: 'passive', parentId: null, status: 'active', vowedDate: stamp, keptDays: 0, strengthen: 0 },
  { id: 'b3', title: 'C仪式', note: '', kind: 'passive', parentId: null, status: 'active', vowedDate: stamp, keptDays: 0, strengthen: 0 },
], checkins: {}, vowedOn: {}, leaves: [], events: [] }))
r = await run(`import "${batchPath}"`)
expect(r.kind === 'success', 'batch 重置')
r = await run('1 3')
console.log(`\n$ /ritual 1 3\n[${r.kind}] ${r.text}`)
expect(r.kind === 'success' && r.text.includes('守约 2 条'), '批量编号')
r = await run('')
console.log(`\n$ /ritual（还剩B未日结）\n${r.text}`)
expect(r.text.includes('还有 1 条没日结') && r.text.includes('/ritual done'), '无参提示 done')
r = await run('9')
console.log(`\n$ /ritual 9（越界）\n[${r.kind}] ${r.text}`)
expect(r.kind === 'error', '编号越界')

// add：收录进预备区（不占名额）
r = await run('add 睡前拉伸10分钟 类型=挂钩 说明=钩在刷牙后')
console.log(`\n$ /ritual add\n[${r.kind}] ${r.text}`)
expect(r.kind === 'success' && r.text.includes('预备区'), 'add 收录')
r = await run('reserve')
expect(r.text.includes('睡前拉伸10分钟') && r.text.includes('钩在刷牙后'), 'add 说明可见')
r = await run('add 睡前拉伸10分钟')
expect(r.kind === 'error', 'add 重名应失败')

// ===== 旧数据自动迁移（真实 v1 文件 → v2）=====
// 用独立的 DSH_HOME，避免污染上面的用例
const legacyHome = mkdtempSync(join(tmpdir(), 'ritual-legacy-'))
writeFileSync(join(legacyHome, 'ego-rsip.json'), JSON.stringify({
  version: 1,
  createdAt: '2026-08-01',
  policies: [
    { id: 'p1', title: '起床半小时不碰娱乐App', note: '起床后 30 分钟内严禁娱乐 App', kind: 'semi', parentId: null, status: 'lit', litDate: '2026-08-01', totalHeldDays: 12, strengthen: 1 },
    { id: 'p2', title: '饭后立刻洗碗', note: '饭后立即洗碗', kind: 'semi', parentId: 'p1', status: 'lit', litDate: '2026-08-02', totalHeldDays: 5, strengthen: 0 },
    { id: 'p3', title: '半夜不刷短视频', note: '', kind: 'passive', parentId: null, status: 'extinguished', litDate: '2026-08-03', totalHeldDays: 3, strengthen: 0 },
  ],
  settlements: { '2026-08-01': { p1: 'kept', p2: 'kept' }, '2026-08-02': { p1: 'kept' } },
  addedOn: { '2026-08-01': 'p1', '2026-08-02': 'p2' },
  freezes: [{ id: 'f1', policyIds: ['p2'], startDate: '2026-08-05', endDate: '2026-08-10', resolvedIds: [] }],
  events: [{ date: '2026-08-01', type: 'add', policyId: 'p1', title: '起床半小时不碰娱乐App' }],
}, null, 2))

const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = legacyHome
// store.js 在模块加载时读 DSH_HOME，所以用查询串绕开 ESM 缓存再导一次
const legacyStore = await import(`./src/store.js?legacy=${Date.now()}`)
const migrated = legacyStore.load()
expect(migrated.version === 2, `迁移后 version 应为 2，实际 ${migrated.version}`)
expect(migrated.rituals.length === 3, '迁移保留全部仪式')
const lit = migrated.rituals.find(r => r.id === 'p1')
expect(lit.status === 'active' && lit.keptDays === 12 && lit.vowedDate === '2026-08-01', 'lit/extinguished → active/reserve，天数保留')
expect(lit.strengthen === 1, '强化等级保留')
expect(migrated.rituals.find(r => r.id === 'p3').status === 'reserve', 'extinguished → reserve')
expect(migrated.rituals.find(r => r.id === 'p2').parentId === 'p1', '树形挂靠保留')
expect(migrated.checkins['2026-08-01'].p1 === 'honored', 'settlements.kept → checkins.honored')
expect(migrated.vowedOn['2026-08-01'] === 'p1', 'addedOn 保留')
expect(migrated.leaves[0].ritualIds[0] === 'p2' && migrated.leaves[0].endDate === '2026-08-10', 'freezes.policyIds → leaves.ritualIds')
expect(migrated.events[0].type === 'vow', "事件 add → vow")
expect(existsSync(join(legacyHome, 'ritual-copilot.json')), '迁移后自动写新文件')
console.log('✓ 旧数据迁移：v1 文件 → v2（含子树/告假/日结/天数/事件名）')
process.env.DSH_HOME = previousHome


// ===== Agent 工具（#3）：模型自己读写仪式 =====

expect(mountedTools.length === 5, `应挂 5 个工具，实际 ${mountedTools.length}`)
const toolOf = name => mountedTools.find(t => t.name === name)
expect(toolOf('ritual_overview') !== undefined && toolOf('ritual_search') !== undefined
  && toolOf('ritual_add') !== undefined && toolOf('ritual_settle') !== undefined
  && toolOf('ritual_reminder') !== undefined, '五个工具都在')

for (const tool of mountedTools) {
  expect(typeof tool.execute === 'function', `${tool.name} 有 execute`)
  expect(typeof tool.description === 'string' && tool.description.length > 20, `${tool.name} 有可读描述`)
  // 输出 schema 必填字段与 render 都对得上
  for (const [key, spec] of Object.entries(tool.output?.schema?.properties ?? {})) {
    expect(typeof spec.type === 'string', `${tool.name}.${key} 有类型`)
  }
}

// overview：结构完整，且把 GUIDE 一并交给模型（回答"我该养成什么"用）
let value = await toolOf('ritual_overview').execute({}, {})
expect(typeof value.date === 'string' && Array.isArray(value.guide) && value.guide.length === 8, 'overview 带 8 个时段入口')
expect(typeof value.summary.pending === 'number', 'overview 带统计')

// search：关键词命中，空结果时给可行动的话
value = await toolOf('ritual_search').execute({ query: '困' }, {})
const searchText = toolOf('ritual_search').output.render({}, value)[0].text
expect(value.entries.length > 0, '在 29 条仪式库里命中')
expect(searchText.includes('为什么：'), '搜索结果带原理说明')
value = await toolOf('ritual_search').execute({ query: '不存在的关键词xyz' }, {})
expect(toolOf('ritual_search').output.render({}, value)[0].text.includes('ritual_add'), '空结果给出路')

// add → 进预备区；重名给可读错误
value = await toolOf('ritual_add').execute({ title: '工具加的仪式', kind: '自动', note: '说明' }, {})
expect(value.ok === true, 'add 成功')
value = await toolOf('ritual_add').execute({ title: '工具加的仪式', kind: '自动' }, {})
expect(value.ok === false && value.message.includes('已在单中'), 'add 重名被拒')
value = await toolOf('ritual_add').execute({ title: '   ', kind: '自动' }, {})
expect(value.ok === false, 'add 空名字被拒')

// settle 只针对守约中的仪式（没立约时应拒绝，而不是误记）
value = await toolOf('ritual_settle').execute({ title: '工具加的仪式', result: '守约' }, {})
expect(value.ok === false && value.message.includes('找不到'), 'settle 拒绝未立约的仪式')


// ===== Agent 工具 · settle 的完整路径（放在最后，避免占用前面的立约名额）=====
const settleFile = join(tmp, 'ritual-copilot.json')
const settleState = JSON.parse(readFileSync(settleFile, 'utf8'))
settleState.vowedOn = {}          // 等价于"换一天"，让立约名额空出来
writeFileSync(settleFile, JSON.stringify(settleState, null, 2) + '\n')
const toolRitualId = settleState.rituals.find(r => r.title === '工具加的仪式').id
const settleSession = await import('./src/session.js')
settleSession.activateById(toolRitualId)

value = await toolOf('ritual_settle').execute({ title: '工具加的仪式', result: '守约' }, {})
expect(value.ok === true && value.message.includes('记为守约') && value.message.includes('连击'), 'settle 守约')
value = await toolOf('ritual_settle').execute({ title: '工具加的仪式', result: '失守' }, {})
expect(value.ok === true && value.message.includes('守约天数保留'), 'settle 失守且说明天数保留')
const afterBreach = JSON.parse(readFileSync(settleFile, 'utf8')).rituals.find(r => r.id === toolRitualId)
expect(afterBreach.status === 'reserve' && afterBreach.keptDays === 1, '失守回预备区但守约天数保留')

console.log('✓ Agent 工具：overview / search / add / settle 全部走通（含重名、空名、未立约、失守保留天数）')


// ===== 数据检验（#4）：失守归因 + 逐条健康度 + 调整建议 =====
const statsMod = await import('./src/stats.js')

// breach 带原因：命令与工具两条路都要能记下来
const reasonFile = join(tmp, 'ritual-copilot.json')
const reasonState = JSON.parse(readFileSync(reasonFile, 'utf8'))
reasonState.vowedOn = {}
writeFileSync(reasonFile, JSON.stringify(reasonState, null, 2) + '\n')
const reasonRitualId = reasonState.rituals.find(r => r.title === '工具加的仪式').id
const sessionMod = await import('./src/session.js')
sessionMod.activateById(reasonRitualId)

value = await toolOf('ritual_settle').execute({ title: '工具加的仪式', result: '失守', reason: '起太晚' }, {})
expect(value.ok === true && value.message.includes('原因记为「起太晚」'), 'settle 记下失守原因')
const storedReason = JSON.parse(readFileSync(reasonFile, 'utf8')).events.filter(e => e.type === 'breach').at(-1).reason
expect(storedReason === '起太晚', '原因落盘')

// 命令层：/ritual breach <名字> 原因=…
// 先腾出当天的立约名额（等价于"换一天"）
const reopen = JSON.parse(readFileSync(reasonFile, 'utf8'))
reopen.vowedOn = {}
writeFileSync(reasonFile, JSON.stringify(reopen, null, 2) + '\n')
sessionMod.activateById(reasonRitualId)
r = await run('breach 工具加的仪式 原因=出差')
expect(r.kind === 'success' && r.text.includes('原因记下了：出差'), '命令层记失守原因')
expect(r.text.includes('守约天数保留'), '命令层失守同样保留天数')

// 手工造样本，验证守约率/健康度/建议
const sample = {
  version: 2, createdAt: '2026-09-01',
  rituals: [
    { id: 'h1', title: '晨跑半小时', note: '', kind: 'active', parentId: null, status: 'active', vowedDate: '2026-09-01', keptDays: 4, strengthen: 0 },
    { id: 'h2', title: '晚上屏幕自动变黑白', note: '', kind: 'passive', parentId: null, status: 'active', vowedDate: '2026-09-01', keptDays: 28, strengthen: 0 },
  ],
  checkins: {}, vowedOn: {}, leaves: [],
  events: [
    { type: 'breach', ritualId: 'h1', date: '2026-09-10', title: '晨跑半小时' },
    { type: 'breach', ritualId: 'h1', date: '2026-09-18', title: '晨跑半小时' },
    { type: 'breach', ritualId: 'h1', date: '2026-09-25', title: '晨跑半小时', reason: '起太晚' },
  ],
}
for (let i = 0; i < 28; i++) {
  const d = new Date('2026-09-01T00:00:00'); d.setDate(d.getDate() + i)
  ;(sample.checkins[d.toISOString().slice(0, 10)] ||= {})['h2'] = 'honored'
}
for (const k of ['2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05']) (sample.checkins[k] ||= {})['h1'] = 'honored'

const health = statsMod.ritualHealth(sample, { endDate: '2026-10-01' })
expect(health.length === 2, '健康度覆盖每条仪式')
const worst = health.find(x => x.id === 'h1')
const best = health.find(x => x.id === 'h2')
expect(worst.rate !== null && worst.rate < 0.25, '守不住的那条算得出低守约率')
expect(best.rate !== null && best.rate > 0.85, '稳住的那条算得出高守约率')
expect(health[0].id === 'h1', '健康度按守约率升序（最容易失守的在前）')

// 样本不足时不给比率——两天的数据不能下结论
const tiny = { ...sample, rituals: [{ ...sample.rituals[0], vowedDate: '2026-09-30' }], checkins: {}, events: [] }
expect(statsMod.ritualHealth(tiny, { endDate: '2026-10-01' })[0].rate === null, '样本不足不给比率')

const advice = statsMod.adjustments(sample, { endDate: '2026-10-01' })
expect(advice.some(a => a.kind === 'downgrade' && a.ritual === '晨跑半小时'), '手动型守不住 → 建议降级')
expect(!advice.some(a => a.ritual === '晚上屏幕自动变黑白'), '稳住的那条不给"该改"的建议')

const overall = statsMod.honorRate(sample)
expect(overall.rate !== null && overall.settled === overall.honored + overall.breached, '总守约率分母=有结论的天数')
const reasons = statsMod.breachReasons(sample)
expect(reasons.some(x => x.reason === '起太晚' && x.count === 1), '失守原因分布')

// 命令层输出：health 与 stats 都要能跑
console.log(`\n$ /ritual stats\n${(await run('stats')).text.slice(0, 200)}`)
console.log(`\n$ /ritual health\n${(await run('health')).text.slice(0, 160)}`)
expect((await run('stats')).kind === 'success', 'stats 扩展后仍可用')
expect((await run('health')).kind === 'success', 'health 子命令可用')
console.log('✓ 数据检验：失守原因可记录、健康度按样本给比率、调整建议只在证据明显时给')

// ===== 主动提醒（#2）：ritual_reminder 工具 =====
const reminderTool = toolOf('ritual_reminder')
value = await reminderTool.execute({ action: 'setup' }, {})
expect(value.needsConfirmation === true, 'setup 必须先确认')
expect(value.spec.daily.time === '21:30:00' && value.spec.daily.time_zone === 'Asia/Shanghai', '默认 21:30 Asia/Shanghai')
expect(value.spec.prompt.includes('ritual_overview'), 'prompt 指示先查状态')
expect(value.spec.prompt.includes('不要替用户判断'), 'prompt 把日结策略写死')
expect(value.message.includes('schedule_create'), '给出创建路径')
value = await reminderTool.execute({ action: 'setup', time: '22:00' }, {})
expect(value.spec.daily.time === '22:00:00', '自定义时间生效')
value = await reminderTool.execute({ action: 'status' }, {})
expect(value.message.includes('schedule_list'), 'status 给查看路径')
value = await reminderTool.execute({ action: 'teardown' }, {})
expect(value.message.includes('schedule_delete'), 'teardown 给删除路径')
expect(reminderTool.description.includes('绝不能未经确认'), '工具描述写死确认流程')
console.log('✓ 主动提醒：ritual_reminder 工具（setup 需确认 / 默认 21:30 / 策略在 prompt 里）')

console.log('\nSMOKE OK — store:', join(tmp, 'ritual-copilot.json'))

// ===== 面板（Roadmap #1）：路由 + client 半 =====

// 1) 路由挂上了
expect(mountedRoutes.length === 7, `应挂 7 条路由，实际 ${mountedRoutes.length}`)
const routeOf = path => mountedRoutes.find(x => x.path === path)
expect(routeOf('/api/ritual.snapshot') !== undefined, 'snapshot 路由')

/** 走一遍真实的面板调用路径：Request → Response → JSON。 */
const api = async (path, body) => {
  const route = routeOf(path)
  const request = new Request('http://local' + path, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return (await route.fetch(request)).json()
}

let payload = await api('/api/ritual.snapshot')
expect(payload.ok === true && payload.value.date, 'snapshot 返回今日')
console.log(`\n$ POST /api/ritual.snapshot -> ok=${payload.ok} pending=${payload.value.totals.pending}`)

// 立约 → 守约 → 失守，全程走 HTTP 面（面板就是这样调的）
// 命令层用例已经用完今天的立约名额（每天限一条），这里先清掉 vowedOn 腾出来
const httpFile = join(tmp, 'ritual-copilot.json')
const httpState = JSON.parse(readFileSync(httpFile, 'utf8'))
httpState.vowedOn = {}
writeFileSync(httpFile, JSON.stringify(httpState, null, 2) + '\n')
payload = await api('/api/ritual.add', { title: '面板冒烟仪式', kind: 'semi', note: '钩在刷牙后' })
expect(payload.ok === true, 'add 路由')
const panelId = payload.value.id
payload = await api('/api/ritual.activate', { id: panelId })
expect(payload.ok === true && payload.value.title === '面板冒烟仪式', 'activate 路由')
payload = await api('/api/ritual.honor', { ids: [panelId] })
expect(payload.ok === true && payload.value.rows[0].keptDays === 1, 'honor 路由')
payload = await api('/api/ritual.snapshot')
const mine = payload.value.rituals.find(r => r.id === panelId)
expect(mine !== undefined && mine.honored === true && mine.keptDays === 1, 'snapshot 反映落盘')
payload = await api('/api/ritual.honor-all', {})
expect(payload.ok === true, 'honor-all 路由')
payload = await api('/api/ritual.breach', { id: panelId })
expect(payload.ok === true && payload.value.keptDays === 1, 'breach 路由保留天数')
payload = await api('/api/ritual.remove', { id: panelId })
expect(payload.ok === true, 'remove 路由')

// 业务错误必须是 200 + ok:false（面板要显示原因，不是当网络错）
payload = await api('/api/ritual.breach', { id: '不存在' })
expect(payload.ok === false && typeof payload.message === 'string', '业务错误形状')
payload = await api('/api/ritual.add', {})
expect(payload.ok === false, '空名字应被拒')

// snapshot 带 advice（面板的「值得调整」块靠它）
payload = await api('/api/ritual.snapshot')
expect(Array.isArray(payload.value.advice), 'snapshot 带 advice 数组')
expect(payload.value.advice.length <= 3, '面板最多显示三条建议')

console.log('✓ 面板路由：snapshot/add/activate/honor/honor-all/breach/remove 全部走通')

// 2) client 半：在模拟的 __ModuleLoader__ 里加载，验证导出与注册
const clientSource = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
let registration = null
const styleEl = { setAttribute() {}, remove() {}, textContent: '' }
const fakeDocument = { createElement: () => styleEl, head: { appendChild() {} } }
const fakeWindow = { __ModuleLoader__: { load: r => { registration = r } } }
// client 半只用 react 的 hooks + primitives 的图标
const fakeReact = {
  createElement: () => null,
  Fragment: Symbol('Fragment'),
  useState: () => [null, () => {}],
  useEffect: () => {},
  useCallback: f => f,
  useMemo: f => f(),
}
const icons = new Proxy({}, { get: () => () => null })
new Function('window', 'document', 'React', clientSource)(fakeWindow, fakeDocument, fakeReact)
expect(registration !== null, 'client 半调用 __ModuleLoader__.load')
expect(registration.id === '@local/dsh-ritual-copilot', 'client bundle id')
const client = registration.factory(spec => {
  if (spec === 'react') return fakeReact
  if (spec === '@deepseek-ai/dsh-client-ui-primitives') return icons
  throw new Error('client 半请求了未声明的包：' + spec)
})
expect(typeof client.apply === 'function', 'client 半导出 apply')
expect(Array.isArray(client.inject) && client.inject.includes('slots'), 'client 半 inject slots')

const slotCalls = []
client.apply({
  slots: { inject: (name, cb) => { slotCalls.push(name); cb(); return null }, register: () => () => {} },
  effect: (fn) => fn(),
})
expect(slotCalls.includes('main') && slotCalls.includes('sidebar.panellist'), '注册 main + sidebar 图标')
console.log('✓ client 半：bundle 可加载、导出正确、注册了 main + sidebar.panellist')
