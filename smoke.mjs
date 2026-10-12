// ritual-copilot 本地冒烟：不启动 dsh，直接调命令 handler
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const tmp = mkdtempSync(join(tmpdir(), 'ritual-copilot-'))
process.env.DSH_HOME = tmp

const { apply } = await import('./index.js')
const regs = []
const mountedRoutes = []
apply({
  commands: { register: (d) => regs.push(d) },
  // 面板路由（/api/ritual.*）也一并挂载并验证
  connection: { fetch: { register: (route) => route } },
  effect: (fn) => { const made = fn(); if (typeof made !== 'function') mountedRoutes.push(made) },
})
const ritual = regs.find(r => r.name === 'ritual')
const ctl = new AbortController()
const run = (rawInput) => ritual.handler({ rawInput, commandId: 't', agent: {}, attachments: [], signal: ctl.signal })
const expect = (cond, msg) => { if (!cond) throw new Error('SMOKE FAIL: ' + msg) }

let r = await run('')
console.log(`\n$ /ritual\n[${r.kind}] ${r.text}`)
expect(r.kind === 'success' && r.text.includes('还没有仪式') && r.text.includes('/ritual seed'), '空状态引导')

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
r = await run('library sleep')
console.log(`\n$ /ritual library sleep\n[${r.kind}] ${r.text.slice(0, 200)}`)
expect(r.kind === 'success' && r.text.includes('/ritual start'), 'library')

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
