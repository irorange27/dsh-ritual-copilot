// ritual-copilot 本地冒烟：不启动 dsh，直接调命令 handler
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const tmp = mkdtempSync(join(tmpdir(), 'ritual-copilot-'))
process.env.DSH_HOME = tmp

const { apply } = await import('./index.js')
const regs = []
apply({ commands: { register: (d) => regs.push(d) } })
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

console.log('\nSMOKE OK — store:', join(tmp, 'ritual-copilot.json'))
