// @local/dsh-ritual-copilot —— Client 半
//
// 一个侧边栏面板：今日日结（点一下就落盘）、连击反馈、预备区。
//
// 设计要点（对应 issue #1）：
//   * 三块，不做更多。仪式树可视化 / 仪式库浏览 / 统计图表留在命令层。
//   * 数据走 `fetch('/api/ritual.*')`——DSH 的 Remote 通道对第三方静态插件是
//     白名单封闭的（见 routes.js 顶部注释），HTTP 路由是唯一可用通道。
//   * 只用静态表里的包（react / primitives / ui-slots），无构建链。

window.__ModuleLoader__.load({
  id: '@local/dsh-ritual-copilot',
  factory: (require) => {
    const React = require('react')
    const { useCallback, useEffect, useMemo, useState } = React
    const { IconCheckOutlineRegular, IconClockOutlineRegular, IconSparkleRegular } = require('@deepseek-ai/dsh-client-ui-primitives')

    const h = React.createElement
    const PANEL_ID = 'ritual'
    const API = {
      snapshot: '/api/ritual.snapshot',
      honor: '/api/ritual.honor',
      honorAll: '/api/ritual.honor-all',
      breach: '/api/ritual.breach',
      activate: '/api/ritual.activate',
      add: '/api/ritual.add',
    }
    const KIND_LABEL = { passive: '自动', semi: '挂钩', active: '手动', mechanism: '保险' }

    // ---------- 数据 ----------

    async function call(path, body) {
      const response = await fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      })
      const payload = await response.json()
      if (!payload || payload.ok !== true) throw new Error(payload?.message ?? `请求失败（${response.status}）`)
      return payload.value
    }

    /** 面板状态：快照 + 载入/错误 + 乐观更新的忙碌集合。 */
    function useRitual() {
      const [snap, setSnap] = useState(null)
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(() => new Set())

      const reload = useCallback(async () => {
        try {
          setSnap(await call(API.snapshot))
          setError(null)
        } catch (cause) {
          setError(cause.message)
        }
      }, [])

      useEffect(() => { void reload() }, [reload])

      const run = useCallback(async (key, path, body) => {
        setBusy(current => new Set(current).add(key))
        try {
          await call(path, body)
          await reload()
          setError(null)
        } catch (cause) {
          setError(cause.message)
        } finally {
          setBusy(current => {
            const next = new Set(current)
            next.delete(key)
            return next
          })
        }
      }, [reload])

      return { snap, error, busy, reload, run }
    }

    // ---------- 样式 ----------
    // 颜色一律走主题变量，否则另一套配色下会瞎。

    const CSS = `
.rc-root { height: 100%; overflow-y: auto; padding: 20px 24px 40px; font-size: 13px; color: var(--dsw-alias-label-primary); }
.rc-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 4px; }
.rc-title { font-size: 16px; font-weight: 600; }
.rc-date { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.rc-section { margin-top: 22px; }
.rc-section-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 8px; }
.rc-section-title { font-size: 12px; font-weight: 600; letter-spacing: .04em; color: var(--dsw-alias-label-secondary); text-transform: uppercase; }
.rc-count { font-size: 12px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.rc-row { display: flex; align-items: flex-start; gap: 10px; padding: 9px 10px; border-radius: 8px; }
.rc-row:hover { background: var(--dsw-alias-bg-layer-2); }
.rc-row-done { opacity: .55; }
.rc-row-main { flex: 1; min-width: 0; }
.rc-row-title { font-weight: 500; line-height: 1.5; }
.rc-row-done .rc-row-title { text-decoration: line-through; }
.rc-row-sub { margin-top: 2px; font-size: 12px; color: var(--dsw-alias-label-tertiary); line-height: 1.5; }
.rc-tag { flex: none; font-size: 11px; padding: 1px 6px; border-radius: 4px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); margin-top: 1px; }
.rc-btn { flex: none; font: inherit; font-size: 12px; padding: 3px 10px; border-radius: 6px; cursor: pointer; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l2); }
.rc-btn:hover { background: var(--dsw-alias-bg-layer-3); }
.rc-btn:disabled { opacity: .45; cursor: default; }
.rc-btn-primary { background: var(--dsw-alias-bg-accent); color: var(--dsw-alias-label-inverse); border-color: transparent; }
.rc-btn-primary:hover { background: var(--dsw-alias-bg-accent-hover, var(--dsw-alias-bg-accent)); }
.rc-done { color: var(--dsw-alias-label-tertiary); font-size: 12px; flex: none; margin-top: 3px; }
.rc-streak { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2); }
.rc-streak-num { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
.rc-empty { color: var(--dsw-alias-label-tertiary); padding: 10px 0; line-height: 1.7; }
.rc-error { margin-top: 12px; padding: 8px 10px; border-radius: 8px; color: var(--dsw-alias-label-danger, #c33); background: var(--dsw-alias-bg-layer-2); }
.rc-loading { color: var(--dsw-alias-label-tertiary); padding: 20px 0; }
.rc-heat { display: flex; gap: 3px; margin-top: 10px; }
.rc-cell { width: 12px; height: 12px; border-radius: 3px; background: var(--dsw-alias-bg-layer-2); }
.rc-cell-on { background: var(--dsw-alias-bg-accent); }
.rc-cell-half { background: var(--dsw-alias-bg-accent); opacity: .45; }
`

    // ---------- 组件 ----------

    function Row(props) {
      const { ritual: r, busy, onHonor, onBreach } = props
      const done = r.honored
      return h('div', { className: `rc-row${done ? ' rc-row-done' : ''}` },
        h('div', { className: 'rc-row-main' },
          h('div', { className: 'rc-row-title' }, r.title),
          h('div', { className: 'rc-row-sub' },
            [KIND_LABEL[r.kind] ?? r.kindLabel, r.keptDays > 0 ? `守约 ${r.keptDays} 天` : null, r.streak > 1 ? `连击 ${r.streak} 天` : null].filter(Boolean).join(' · '),
            r.note ? ` — ${r.note}` : '',
          ),
        ),
        done
          ? h('span', { className: 'rc-done' }, '已守约')
          : h(React.Fragment, null,
            h('button', { className: 'rc-btn rc-btn-primary', disabled: busy, onClick: onHonor }, '守约'),
            h('button', { className: 'rc-btn', disabled: busy, onClick: onBreach, title: '退回预备区，守约天数保留' }, '失守'),
          ),
      )
    }

    function Section(props) {
      const { title, count, children } = props
      return h('div', { className: 'rc-section' },
        h('div', { className: 'rc-section-head' },
          h('span', { className: 'rc-section-title' }, title),
          count === undefined ? null : h('span', { className: 'rc-count' }, count),
        ),
        children,
      )
    }

    function RitualPanel() {
      const { snap, error, busy, run } = useRitual()

      if (snap === null) {
        return h('div', { className: 'rc-root' }, h('div', { className: 'rc-loading' }, error ?? '载入中…'))
      }

      const totals = snap.totals
      const left = totals.unsettled
      const allDone = totals.pending > 0 && left === 0
      const heat = snap.heat ?? []

      return h('div', { className: 'rc-root' },
        h('div', { className: 'rc-head' },
          h('span', { className: 'rc-title' }, '仪式'),
          h('span', { className: 'rc-date' }, snap.date),
        ),

        error ? h('div', { className: 'rc-error' }, error) : null,

        // 今日日结
        h(Section, {
          title: '今日日结',
          count: `${totals.settled}/${totals.pending}`,
        },
          totals.pending === 0
            ? h('div', { className: 'rc-empty' },
              snap.canVowToday
                ? '今天还没有守约中的仪式。从下面的预备区挑一条立约，或让 Agent 帮你加一条。'
                : '今天还没有守约中的仪式（今日的立约名额也已用完）。')
            : h(React.Fragment, null,
              allDone
                ? h('div', { className: 'rc-empty' }, '今天全部守住了。明天见。')
                : h('div', { style: { marginBottom: 6 } },
                  h('button', {
                    className: 'rc-btn rc-btn-primary',
                    disabled: busy.size > 0,
                    onClick: () => run('all', API.honorAll, {}),
                  }, `全部守约（${left}）`),
                ),
              ...snap.rituals.map(r => h(Row, {
                key: r.id,
                ritual: r,
                busy: busy.has(r.id),
                onHonor: () => run(r.id, API.honor, { ids: [r.id] }),
                onBreach: () => run(r.id, API.breach, { id: r.id }),
              })),
            ),

          // 告假
          ...(snap.leaves ?? []).map(l => h('div', { className: 'rc-row' , key: l.id },
            h('div', { className: 'rc-row-main' },
              h('div', { className: 'rc-row-title' }, l.title),
              h('div', { className: 'rc-row-sub' },
                l.due ? `告假到期，须一次性补结算` : `告假至 ${l.until}`),
            ),
            l.due && !l.honored
              ? h('button', { className: 'rc-btn rc-btn-primary', disabled: busy.has(l.id), onClick: () => run(l.id, API.honor, { ids: [l.id] }) }, '守约')
              : null,
          )),
        ),

        // 连击
        totals.pending > 0
          ? h('div', { className: 'rc-streak', style: { marginTop: 10 } },
            h(IconSparkleRegular, { size: 16 }),
            h('span', { className: 'rc-streak-num' }, String(totals.bestStreak)),
            h('span', { className: 'rc-row-sub', style: { marginTop: 0 } }, '天连续守约（最长的一条）'),
          )
          : null,

        // 近 14 天
        heat.length
          ? h('div', { className: 'rc-heat' }, ...heat.map(d => h('div', {
            key: d.date,
            className: `rc-cell${d.rate === null ? '' : d.rate >= 1 ? ' rc-cell-on' : ' rc-cell-half'}`,
            title: `${d.date} ${d.rate === null ? '未日结' : d.rate >= 1 ? '全部守住' : `${d.honored} 守 / ${d.breached} 失`}`,
          })))
          : null,

        // 预备区
        h(Section, {
          title: '预备区',
          count: `${snap.reserve.length}`,
        },
          snap.reserve.length === 0
            ? h('div', { className: 'rc-empty' }, '预备区是空的。让 Agent 用 `/ritual add` 加一条，或用 `/ritual library` 从仪式库挑。')
            : h(React.Fragment, null,
              snap.canVowToday
                ? null
                : h('div', { className: 'rc-empty', style: { marginBottom: 4 } }, '今日立约名额已用，明天可以再立一条。'),
              ...snap.reserve.map(r => h('div', { className: 'rc-row', key: r.id },
                h('div', { className: 'rc-row-main' },
                  h('div', { className: 'rc-row-title' }, r.title),
                  h('div', { className: 'rc-row-sub' },
                    [KIND_LABEL[r.kind] ?? r.kindLabel, r.keptDays > 0 ? `守约 ${r.keptDays} 天` : null].filter(Boolean).join(' · '),
                    r.note ? ` — ${r.note}` : '',
                  ),
                ),
                h('button', {
                  className: 'rc-btn',
                  disabled: !snap.canVowToday || busy.has(r.id),
                  title: snap.canVowToday ? '立约' : '今天已经立过一条了',
                  onClick: () => run(r.id, API.activate, { id: r.id }),
                }, '立约'),
              )),
            ),
        ),

        // 统计尾巴
        h('div', { className: 'rc-row-sub', style: { marginTop: 26 } },
          `修行 ${totals.runningDays} 天 · 守约中 ${totals.activeCount} · 累计守约 ${totals.totalHonored} 次 · 失守 ${totals.breachCount} 次`,
        ),
      )
    }

    /** 侧边栏图标：一把打卡用的对勾 + 时钟。 */
    function RitualPanelIcon(props) {
      return h(IconClockOutlineRegular, { size: props?.size })
    }

    // ---------- 插件 ----------

    const inject = ['slots']

    function apply(ctx) {
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
      }, RitualPanel))

      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 30,
        label: () => '仪式',
      }, RitualPanelIcon))

      ctx.effect(() => {
        const style = document.createElement('style')
        style.setAttribute('data-dsh-ritual-copilot', '')
        style.textContent = CSS
        document.head.appendChild(style)
        return () => { style.remove() }
      }, 'ritual-copilot: panel styles')
    }

    return { name: '@local/dsh-ritual-copilot', inject, apply }
  },
})
