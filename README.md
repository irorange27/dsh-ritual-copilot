# dsh-ritual-copilot

**Ritual Copilot** — 统计自己有没有遵守自己设下的仪式。

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件。核心不是"打卡"，而是**让失守变便宜、让守约被看见**：每天最多立约一条，失守只退回预备区（守约天数永不丢），告假机制兜住生病出差的断档。

```
/ritual          今日总览（还有没日结的会直接提示 /ritual done）
/ritual done     一键全部守约
/ritual 1 2 3    按编号批量守约
/ritual start 1  立约（预备区启用或新建，每天限一条）
```

## 核心概念

| 词 | 含义 |
|---|---|
| **仪式** | 一条你想长期守住的行为约定 |
| **预备区** | 还没立约的仪式（不占名额，随时可加） |
| **仪式单** | 守约中的仪式（树形，可挂靠） |
| **立约** | 把一条仪式放上仪式单（每天限一条） |
| **守约 / 失守** | 当日做到 / 没做到（失守只退回预备区，守约天数保留） |
| **告假** | 生病出差时冻结日结，到期一次性补结算 |

### 四种类型

按**背后的行为原理**分，不是按难度分：

| 类型 | 原理 | 例 |
|---|---|---|
| **自动** | 环境设好就行，不用动脑不用记 | 晚上屏幕自动变黑白 |
| **挂钩** | 钩在每天必做的事上（如果A就B），不用额外下决心 | 起床半小时不碰娱乐App |
| **手动** | 每天要主动想起来去做 | 晨跑半小时 |
| **保险** | 出事时保住不断档 | 生病出差可告假 |

## 安装

```sh
# 1. 本地冒烟（不启动 dsh）
node smoke.mjs

# 2. 装进 DSH profile
dsh plugin --profile <name> add /path/to/dsh-ritual-copilot
```

或从 DSH 图形界面：**Plugins** 页 → Add plugin → 填本仓库绝对路径。

装完重启 DSH 生效。

## 上手

**最省事的路径**：直接跟 Agent 说「我最近最想改掉的习惯是……」，它会帮你写成一条仪式。

想自己动手：

```sh
/ritual guide     # 不知道挑哪条：按"你在哪个时段出问题"给推荐
/ritual library   # 想自己翻：仪式库 29 条
/ritual start 1   # 挑好后立约
/ritual done      # 今天都做到了
```

## 命令

| 命令 | 说明 |
|---|---|
| `/ritual` | 今日总览；有未日结会提示 `/ritual done` |
| `/ritual done` | 一键全部守约 |
| `/ritual 1 2 3` | 按今日列表编号批量守约 |
| `/ritual honor <名字\|编号>` | 单条守约 |
| `/ritual breach <名字\|编号> [原因=…]` | 失守（连带子仪式回预备区，守约天数保留；原因可选，用于归因） |
| `/ritual start <名字\|编号> [自动\|挂钩\|手动\|保险]` | 立约（每天限一条） |
| `/ritual add <名字> [类型=…] [说明=…]` | 收录到预备区（不占今日名额） |
| `/ritual guide [时段\|编号]` | 从「你在哪个时段出问题」给推荐（每条带原理说明） |
| `/ritual reserve` | 查看预备区（带编号） |
| `/ritual list` | 查看仪式单（树形） |
| `/ritual leave <日期> <名字…>` | 告假 |
| `/ritual edit <名字\|编号> [新名字=…] [类型=…] [说明=…] [挂靠=…\|顶层]` | 修改仪式 |
| `/ritual rm <名字\|编号>` | 删除仪式 |
| `/ritual stats` | 统计（守约率、逐条健康度、失守原因、值得调整） |
| `/ritual health` | 逐条详细复盘 |
| `/ritual library [分类]` | 仪式库 |
| `/ritual seed` | 载入示例 |
| `/ritual export [路径]` / `/ritual import <路径> [--merge]` | 导出 / 导入 JSON |

旧命令（`keep` / `light` / `relight` / `fail` / `hand` / `tree` / `freeze` / `catalog`）保留为别名。

## Agent 工具

跟 Agent 对话就能完成全部日常操作，不用打命令：

| 工具 | 作用 |
|---|---|
| `ritual_overview` | 今日待日结 / 预备区 / 统计 / 时段入口 |
| `ritual_search` | 在仪式库里搜（含原理说明） |
| `ritual_add` | 收录进预备区 |
| `ritual_settle` | 日结守约/失守（可带原因；不替用户判断） |
| `ritual_reminder` | 管理每天 21:30 的日结提醒（**经你确认后**才创建） |

想设提醒就说「帮我设仪式提醒」；想删就说「把仪式提醒删了」。

## 数据

存储 `~/.dsh/ritual-copilot.json`（`$DSH_HOME` 优先）。

数据版本 v2：`rituals` / `checkins` / `vowedOn` / `leaves` / `events`。
v1（国策树格式，`ego-rsip.json` 或浏览器 `localStorage` 导出的 JSON）读取时**自动迁移**。

## 结构

```
index.js              Cordis 插件入口（/ritual 命令 + 面板路由 + Agent 工具挂载）
routes.js             面板数据路由 /api/ritual.*（client 半的唯一通道）
client.js             Client 半：侧边栏图标 + 面板（纯 JS bundle，无构建链）
tools.js              Agent 工具（overview / search / add / settle / reminder）
src/rsip.js           领域模型与规则引擎（立约/守约/失守/告假 + v1→v2 迁移）
src/session.js        命令层、面板与工具共用的状态操作（transact / snapshot / 动作）
src/catalog.js        仪式库（29 条，7 分类）+ 时段入口 GUIDE（8 个时段）
src/stats.js          统计层（连击、守约率、逐条健康度、调整建议）
src/store.js          文件存储（原子写 + 旧文件自动迁移）
smoke.mjs             端到端冒烟（命令 + 工具 + 路由 + client 半 + 迁移，不启动 dsh）
```

## 面板

侧边栏出现「仪式」入口，面板四块：

1. **今日日结** —— 每条一个「守约」按钮，点一下直接落盘；还有「全部守约」
2. **连击** —— 最长连续守约天数 + 近 14 天热力格
3. **预备区** —— 一键「立约」（受每天一条的额度限制）
4. **值得调整** —— 最多三条来自数据的建议（手动型守不住→改挂钩；同一原因反复→规则与环境冲突）

## 为什么面板不用 DSH 的 Remote

DSH 的 Client→Host Remote 通道是**白名单**的：`api-remotes` 的 client 面里硬编码了
25 个官方包，第三方静态插件无法把自己插进去；而 `host.call` 只对 cordis-client-runner
现场求值的动态插件开放。

所以面板走第三条路：`ctx.connection.fetch.register` 注册 `/api/ritual.*`，
与 Remote 共用同一条**已认证**的 `/api` 通道（物理载体先过 trust + auth 围栏）。
client 半直接 `fetch()` 即可。

详见 [Issue #1](https://github.com/irorange27/dsh-ritual-copilot/issues/1) 的验证记录。

## 设计取向

- **失守不归零**：失守只退回预备区，`keptDays` 永不丢。单次失败不该变成全盘放弃。
- **每天限一条**：立约速度是自律工具最常见的死因，硬限制一天一条。
- **省心优先**：能做成"自动"就别做成"手动"，能挂靠就别靠自己记。
- **告假是规则的一部分**，不是规则的例外。

## Roadmap

**[→ Roadmap 总览（Issue #6）](https://github.com/irorange27/dsh-ritual-copilot/issues/6)** — 顺序、依赖关系、设计原则、明确不做的事。

| # | 主题 | 状态 |
|---|---|---|
| [#1](https://github.com/irorange27/dsh-ritual-copilot/issues/1) | **极简面板**（纯 JS，无需构建链） | ✅ 代码完成，待真实 DSH 验证 |
| [#2](https://github.com/irorange27/dsh-ritual-copilot/issues/2) | 主动提醒（21:30，只在有未日结时出声） | ✅ 代码完成（经确认的决策） |
| [#3](https://github.com/irorange27/dsh-ritual-copilot/issues/3) | 从「我的问题」出发推荐仪式 | ✅ Agent 工具 + guide |
| [#4](https://github.com/irorange27/dsh-ritual-copilot/issues/4) | 用真实数据检验规则本身 | ✅ 机制完成；结论需 1 个月真实数据 |
| [#5](https://github.com/irorange27/dsh-ritual-copilot/issues/5) | 冷启动体验 | ✅ 空状态改造 + guide |

### 为什么命令层不是终点

人的日常操作（每天两次日结）必须「打开就看见、点一下就落盘」；
命令层留给 Agent 和脚本（批量录入、修改、迁移、查询）。

**一个帮人养习惯的工具，自身使用成本不该高于习惯本身。**

## License

MIT
