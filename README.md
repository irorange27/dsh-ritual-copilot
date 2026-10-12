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

```sh
/ritual seed       # 载入 9 个示例仪式到预备区
/ritual reserve    # 看编号
/ritual start 1    # 立约
/ritual done       # 今天都做到了
```

## 命令

| 命令 | 说明 |
|---|---|
| `/ritual` | 今日总览；有未日结会提示 `/ritual done` |
| `/ritual done` | 一键全部守约 |
| `/ritual 1 2 3` | 按今日列表编号批量守约 |
| `/ritual honor <名字\|编号>` | 单条守约 |
| `/ritual breach <名字\|编号>` | 失守（连带子仪式回预备区） |
| `/ritual start <名字\|编号> [自动\|挂钩\|手动\|保险]` | 立约（每天限一条） |
| `/ritual add <名字> [类型=…] [说明=…]` | 收录到预备区（不占今日名额） |
| `/ritual reserve` | 查看预备区（带编号） |
| `/ritual list` | 查看仪式单（树形） |
| `/ritual leave <日期> <名字…>` | 告假 |
| `/ritual edit <名字\|编号> [新名字=…] [类型=…] [说明=…] [挂靠=…\|顶层]` | 修改仪式 |
| `/ritual rm <名字\|编号>` | 删除仪式 |
| `/ritual stats` | 统计 |
| `/ritual library [分类]` | 仪式库 |
| `/ritual seed` | 载入示例 |
| `/ritual export [路径]` / `/ritual import <路径> [--merge]` | 导出 / 导入 JSON |

旧命令（`keep` / `light` / `relight` / `fail` / `hand` / `tree` / `freeze` / `catalog`）保留为别名。

## 数据

存储 `~/.dsh/ritual-copilot.json`（`$DSH_HOME` 优先）。

数据版本 v2：`rituals` / `checkins` / `vowedOn` / `leaves` / `events`。
v1（国策树格式，`ego-rsip.json` 或浏览器 `localStorage` 导出的 JSON）读取时**自动迁移**。

## 结构

```
index.js              Cordis 插件入口（/ritual 命令）
src/rsip.js           领域模型与规则引擎（立约/守约/失守/告假 + v1→v2 迁移）
src/catalog.js        仪式库（29 条，7 个分类）
src/stats.js          统计层（连续守约天数、日结率）
src/store.js          文件存储（原子写 + 旧文件自动迁移）
smoke.mjs             端到端冒烟（不启动 dsh）
```

## 设计取向

- **失守不归零**：失守只退回预备区，`keptDays` 永不丢。单次失败不该变成全盘放弃。
- **每天限一条**：立约速度是自律工具最常见的死因，硬限制一天一条。
- **省心优先**：能做成"自动"就别做成"手动"，能挂靠就别靠自己记。
- **告假是规则的一部分**，不是规则的例外。

## Roadmap

**[→ Roadmap 总览（Issue #6）](https://github.com/irorange27/dsh-ritual-copilot/issues/6)** — 顺序、依赖关系、设计原则、明确不做的事。

| # | 主题 | 依赖 |
|---|---|---|
| [#1](https://github.com/irorange27/dsh-ritual-copilot/issues/1) | **极简面板**（纯 JS，无需构建链）— P0 地基 | — |
| [#2](https://github.com/irorange27/dsh-ritual-copilot/issues/2) | 主动提醒（一天最多一次） | #1 |
| [#3](https://github.com/irorange27/dsh-ritual-copilot/issues/3) | 从「我的问题」出发推荐仪式 | — |
| [#4](https://github.com/irorange27/dsh-ritual-copilot/issues/4) | 用真实数据检验规则本身 | #1 + 1 个月数据 |
| [#5](https://github.com/irorange27/dsh-ritual-copilot/issues/5) | 冷启动体验（3 分钟拥有第一条仪式） | #5-B 依赖 #3 |

### 为什么命令层不是终点

人的日常操作（每天两次日结）必须「打开就看见、点一下就落盘」；
命令层留给 Agent 和脚本（批量录入、修改、迁移、查询）。

**一个帮人养习惯的工具，自身使用成本不该高于习惯本身。**

## License

MIT
