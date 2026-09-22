/**
 * 四会公交 API 代理（Cloudflare Worker）
 *
 * 职责：
 *   1. /api/*         —— 转发到 https://oa.sfc0758.com/sihui/*，自动注入 ticket-token / userId
 *   2. /admin         —— 网页版「刷新 token」向导（图形验证码 + 短信验证码需人工输入）
 *   3. /_captcha      —— 取图形验证码（JSON：token + base64 图片）
 *   4. /_sendsms      —— 发送短信验证码
 *   5. /_login        —— 完成登录，返回 token（若绑定了 KV 会自动保存）
 *
 * 环境变量（在 Cloudflare 控制台 → Workers → 设置 → 变量 中配置）：
 *   TICKET_TOKEN  必填：当前有效的 ticket-token（加密变量用 Secret 类型）
 *   USER_ID       可选，默认 ec359ef577b846be91a41d7ca17f9353（实测 token 不校验 userId，可留空）
 *   ADMIN_KEY     可选：设置后 /admin 需要携带 ?key=xxx 才能访问，防止被陌生人滥用
 *   TOKEN_KV      可选：KV 命名空间绑定，用于保存刷新后的 token（免去每次改环境变量）
 */

const API_BASE = 'https://oa.sfc0758.com/sihui/'
// 不要在这里写死 token —— 本文件会进公开仓库。
// 用 `npx wrangler secret put TICKET_TOKEN` 配置；未配置时 /api 会返回明确提示。
const FALLBACK_USER = 'ec359ef577b846be91a41d7ca17f9353'
const KV_TOKEN_KEY = 'ticket_token'
const KV_USER_KEY = 'user_id'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'x-requested-with, ticket-token, yyj-unify-token, userId, X-Auth-Token, withCredentials, Content-Type',
  'Access-Control-Expose-Headers': 'ticket-token, userId'
}

const json = (obj, init = {}) =>
  new Response(JSON.stringify(obj), {
    ...init,
    headers: { 'Content-Type': 'application/json;charset=UTF-8', ...CORS, ...(init.headers || {}) }
  })

async function readToken(env) {
  if (env.TOKEN_KV) {
    const kvToken = await env.TOKEN_KV.get(KV_TOKEN_KEY)
    if (kvToken) return { token: kvToken, userId: (await env.TOKEN_KV.get(KV_USER_KEY)) || env.USER_ID || FALLBACK_USER }
  }
  return { token: env.TICKET_TOKEN || '', userId: env.USER_ID || FALLBACK_USER }
}

function noToken() {
  return json({
    status: 601,
    msg: 'Worker 未配置 TICKET_TOKEN，请执行 npx wrangler secret put TICKET_TOKEN，或访问 /admin 刷新'
  }, { status: 503 })
}

/** 业务代理：/api/gj/line/findList -> https://oa.sfc0758.com/sihui/gj/line/findList */
async function proxy(request, env, pathname) {
  const { token, userId } = await readToken(env)
  if (!token) return noToken()
  const target = API_BASE + pathname.replace(/^\/?api\/?/, '')
  const body = request.method !== 'GET' ? await request.text() : null

  const upstream = await fetch(target, {
    method: request.method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': '*/*',
      'ticket-token': token,
      'userId': userId
    },
    body
  })

  const text = await upstream.text()
  // token 失效时给前端一个明确信号（业务状态码 601）
  return new Response(text, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json;charset=UTF-8', ...CORS, 'X-Upstream-Token-Status': token ? 'set' : 'missing' }
  })
}

async function captcha() {
  const res = await fetch(API_BASE + 'base/user/kaptcha', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'ticket-token': '', userId: '' },
    body: '{}'
  })
  const token = res.headers.get('ticket-token') || ''
  const buf = await res.arrayBuffer()
  let b64 = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) b64 += String.fromCharCode(bytes[i])
  return json({ token, image: 'data:image/jpeg;base64,' + btoa(b64) })
}

async function sendSMS(payload) {
  const res = await fetch(API_BASE + 'app/user/sendSMS', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'ticket-token': payload.token || '', userId: '' },
    body: JSON.stringify({ token: payload.token, phone: payload.phone, type: '4', kaptchaCode: payload.kaptchaCode })
  })
  const token = res.headers.get('ticket-token')
  const data = await res.json().catch(() => null)
  return json({ data, token: token || payload.token })
}

async function login(payload, env) {
  const res = await fetch(API_BASE + 'app/user/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'ticket-token': payload.token || '' },
    body: JSON.stringify({ loginName: payload.phone, password: payload.password, code: payload.code })
  })
  const data = await res.json().catch(() => null)

  if (data?.status === 200 && env.TOKEN_KV) {
    await env.TOKEN_KV.put(KV_TOKEN_KEY, data.datas.token)
    await env.TOKEN_KV.put(KV_USER_KEY, String(data.datas.id))
    return json({ ok: true, token: data.datas.token, userId: String(data.datas.id), saved: 'kv' })
  }
  return json({ ok: data?.status === 200, data })
}

const ADMIN_HTML = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>刷新公交 Token</title>
<style>
body{font-family:system-ui,-apple-system,"Microsoft YaHei",sans-serif;background:#12151c;color:#e8eaed;margin:0;padding:24px;line-height:1.7}
.box{max-width:460px;margin:0 auto;background:#1b1f28;border:1px solid #2a3040;border-radius:12px;padding:20px}
h2{margin:0 0 16px;font-size:18px}
label{display:block;margin:12px 0 4px;font-size:13px;color:#9aa4b8}
input{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid #333b4d;border-radius:8px;background:#0f131a;color:#e8eaed}
button{margin-top:14px;width:100%;padding:10px;border:0;border-radius:8px;background:#3b7cff;color:#fff;font-size:15px;cursor:pointer}
button:disabled{background:#3a4256;cursor:not-allowed}
img{display:block;margin:8px 0;border-radius:8px;background:#fff}
#msg{margin-top:14px;font-size:13px;color:#8fd18f;white-space:pre-wrap;word-break:break-all}
.err{color:#ff8a8a}
</style>
<div class="box">
  <h2>刷新公交 Token</h2>
  <div id="step1">
    <label>图形验证码</label>
    <img id="cap" width="140" height="56" alt="点击刷新">
    <input id="kaptchaCode" placeholder="输入图中的字符" autocomplete="off">
  </div>
  <label>手机号</label><input id="phone" placeholder="通利行登录手机号" autocomplete="off">
  <label>密码</label><input id="pwd" type="password" placeholder="登录密码">
  <div id="step2" style="display:none">
    <label>短信验证码</label><input id="code" placeholder="手机收到的验证码" autocomplete="off">
  </div>
  <button id="go">获取短信验证码</button>
  <div id="msg"></div>
</div>
<script>
const S = location.search;
const q = (id) => document.getElementById(id);
let kToken = '', stage = 1;
const post = async (p, b) => (await fetch(p + S, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)})).json();

async function loadCaptcha(){
  const r = await post('/_captcha', {});
  kToken = r.token; q('cap').src = r.image;
}
q('cap').onclick = loadCaptcha; loadCaptcha();

q('go').onclick = async () => {
  const btn = q('go'), msg = q('msg');
  btn.disabled = true; msg.className=''; msg.textContent = '处理中…';
  const phone = q('phone').value.trim(), pwd = q('pwd').value, kaptchaCode = q('kaptchaCode').value.trim(), code = q('code').value.trim();
  try {
    if (stage === 1) {
      const r = await post('/_sendsms', {token:kToken, phone, kaptchaCode});
      if (r.data && r.data.status && r.data.status !== 200) { msg.className='err'; msg.textContent = r.data.msg || JSON.stringify(r.data); await loadCaptcha(); btn.disabled=false; return; }
      kToken = r.token || kToken;
      stage = 2; q('step2').style.display='block'; btn.textContent='登录并刷新 Token'; msg.textContent='短信已发送，请查收';
    } else {
      const r = await post('/_login', {token:kToken, phone, password:pwd, code});
      if (r.ok) {
        msg.textContent = '成功！\\nticket-token: ' + r.token + (r.saved ? '\\n已写入 KV，线上立即生效' : '\\n请到 Cloudflare 控制台把 TICKET_TOKEN 改成这个值');
      } else { msg.className='err'; msg.textContent = (r.data && r.data.msg) || JSON.stringify(r.data); await loadCaptcha(); }
    }
  } catch(e){ msg.className='err'; msg.textContent = '请求失败：' + e.message; }
  btn.disabled = false;
};
</script>`

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })

    const url = new URL(request.url)
    const p = url.pathname

    if (p === '/admin' || p === '/admin/') {
      if (env.ADMIN_KEY && url.searchParams.get('key') !== env.ADMIN_KEY) {
        return new Response('Forbidden', { status: 403 })
      }
      return new Response(ADMIN_HTML, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } })
    }

    if (request.method === 'POST' && p.startsWith('/_')) {
      const body = await request.json().catch(() => ({}))
      if (env.ADMIN_KEY && url.searchParams.get('key') !== env.ADMIN_KEY) return json({ error: 'forbidden' }, { status: 403 })
      if (p === '/_captcha') return captcha()
      if (p === '/_sendsms') return sendSMS(body)
      if (p === '/_login') return login(body, env)
      return json({ error: 'not found' }, { status: 404 })
    }

    if (p.startsWith('/api/') || p === '/api') return proxy(request, env, p)

    // 兼容旧调用方式：直接以 /gj/... 访问
    if (p.startsWith('/gj/')) return proxy(request, env, '/api' + p)

    return json({ error: 'not found', usage: '/api/gj/line/findList, /admin' }, { status: 404 })
  }
}
