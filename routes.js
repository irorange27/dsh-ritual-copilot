// Host 半给 client 面板的 HTTP 路由。
//
// 为什么不是 Remote（@Remote / ctx.remote.<ns>）：
//   DSH 的 Client→Host Remote 通道是白名单的——`api-remotes` 的 client 面里
//   硬编码了 25 个官方包，第三方静态插件无法把自己插进去（详见 issue #1）。
//   而 `host.call` 只对 cordis-client-runner 现场求值的动态插件开放。
//
//   所以走第三条：`ctx.connection.fetch.register`。它与 Remote 共用同一条
//   已认证的 `/api` 通道（物理载体先过 trust + auth 围栏），client 半直接
//   `fetch('/api/ritual.<x>')` 即可。

/** 路由路径常量（client 半也用同一份字面量）。 */
export const ROUTES = {
  snapshot: '/api/ritual.snapshot',
  honor: '/api/ritual.honor',
  honorAll: '/api/ritual.honor-all',
  breach: '/api/ritual.breach',
  activate: '/api/ritual.activate',
  add: '/api/ritual.add',
  remove: '/api/ritual.remove',
}

/** JSON 响应；不缓存，避免面板看到过期快照。 */
function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

/** 业务失败 → 200 + { ok:false }，让面板能把原因显示出来而不是当成网络错误。 */
function ok(value) {
  return json({ ok: true, value: value ?? null })
}

function fail(message) {
  return json({ ok: false, message: String(message ?? '未知错误') })
}

/** 读一个 JSON 请求体；空体或坏 JSON 都按空对象处理。 */
async function body(request) {
  try {
    const text = await request.text()
    if (!text.trim()) return {}
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * 把 session 层的动作包成「业务错误不外抛」的处理器。
 * @param {(input: object) => unknown} run
 */
function guard(run) {
  return async (request) => {
    try {
      return ok(await run(await body(request)))
    } catch (error) {
      return fail(error?.message ?? error)
    }
  }
}

/**
 * 注册全部路由。返回解绑函数由 ctx.effect 托管。
 * @param {object} ctx cordis 上下文（需 inject: ['connection']）
 * @param {typeof import('./src/session.js')} S session 层
 */
export function registerRoutes(ctx, S) {
  // ctx.get() 而不是 ctx.connection：cordis 里属性访问在服务缺失时抛错，
  // ctx.get() 才返回 undefined。整个注册过程只解一次引用。
  const fetch = ctx.get?.('connection').fetch
  const register = route => ctx.effect(
    () => fetch.register({ requestBody: 'buffered', methods: ['GET', 'POST'], ...route }),
    `ritual-copilot: ${route.path}`,
  )

  register({
    path: ROUTES.snapshot,
    fetch: async () => {
      try {
        return ok(S.read(state => S.snapshot(state)))
      } catch (error) {
        return fail(error?.message ?? error)
      }
    },
  })

  register({
    path: ROUTES.honor,
    fetch: guard(input => ({ rows: S.honorRituals(toStringArray(input.ids)) })),
  })

  register({
    path: ROUTES.honorAll,
    fetch: guard(() => S.honorAllPending()),
  })

  register({
    path: ROUTES.breach,
    fetch: guard(input => S.breachById(requireId(input.id), String(input.reason ?? ''))),
  })

  register({
    path: ROUTES.activate,
    fetch: guard(input => S.activateById(requireId(input.id))),
  })

  register({
    path: ROUTES.add,
    fetch: guard(input => S.reserveNew({
      title: String(input.title ?? ''),
      kind: typeof input.kind === 'string' && input.kind ? input.kind : 'passive',
      note: String(input.note ?? ''),
    })),
  })

  register({
    path: ROUTES.remove,
    fetch: guard(input => S.removeById(requireId(input.id))),
  })
}

function requireId(value) {
  const id = String(value ?? '')
  if (!id) throw new Error('缺少仪式 id')
  return id
}

function toStringArray(value) {
  return Array.isArray(value) ? value.map(v => String(v)) : []
}
