// 抓取「通利行」接口的真实返回，按时间戳存到 api访问/<时间>/ 目录。
// 用法：
//   node api-snapshot.mjs                 抓全部（线路表 + 每条线路实时公交 + 车辆表）
//   node api-snapshot.mjs --line=1号线     只抓这条线路
//   node api-snapshot.mjs --site=龙城      用「龙城」这个站查途经它的每条线路
//   node api-snapshot.mjs --quick          只抓线路表，跳过 16 次 findBusReal
//   node api-snapshot.mjs --all-sites      每条线路的每个站点都查一次（请求量大，慎用）

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const OUT_ROOT = path.join(ROOT, 'api访问')
const BASE = 'https://oa.sfc0758.com/sihui'

// ---------------------------------------------------------------- 参数
const argv = process.argv.slice(2)
const arg = (name, def = null) => {
  const hit = argv.find(a => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : def
}
const HAS = name => argv.includes(`--${name}`)
const ONLY_LINE = arg('line')
const ONLY_SITE = arg('site')
const QUICK = HAS('quick')
const ALL_SITES = HAS('all-sites')

// ---------------------------------------------------------------- 凭证
// 优先 .env.development.local，其次 src/api/config.js 的内置兜底值
function loadCredentials() {
  const fallback = {}
  try {
    const cfg = fs.readFileSync(path.join(ROOT, 'src/api/config.js'), 'utf8')
    fallback.token = cfg.match(/FALLBACK_TOKEN\s*=\s*'([^']+)'/)?.[1]
    fallback.userId = cfg.match(/FALLBACK_USER\s*=\s*'([^']+)'/)?.[1]
  } catch {}
  try {
    const env = fs.readFileSync(path.join(ROOT, '.env.development.local'), 'utf8')
    const token = env.match(/VITE_TICKET_TOKEN\s*=\s*["']?([^"'\r\n]+)/)?.[1]
    const userId = env.match(/VITE_USER_ID\s*=\s*["']?([^"'\r\n]+)/)?.[1]
    return { token: token || fallback.token, userId: userId || fallback.userId, from: token ? '.env.development.local' : 'config.js 内置' }
  } catch {}
  return { ...fallback, from: 'config.js 内置' }
}

const CRED = loadCredentials()
const HEADERS = {
  'Content-Type': 'application/json',
  'Accept': '*/*',
  'ticket-token': CRED.token || '',
  'userId': CRED.userId || ''
}

let expired = false

// ---------------------------------------------------------------- 请求
async function call(apiPath, body) {
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  let raw = null
  let httpStatus = 0
  let error = null
  try {
    const res = await fetch(BASE + apiPath, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(body),
      signal: controller.signal
    })
    httpStatus = res.status
    raw = await res.text()
  } catch (e) {
    error = e.name === 'AbortError' ? '请求超时（15s）' : e.message
  } finally {
    clearTimeout(timer)
  }

  const elapsedMs = Date.now() - started
  let json = null
  let parseError = null
  if (raw !== null) {
    try { json = JSON.parse(raw) } catch (e) { parseError = `JSON 解析失败：${raw.slice(0, 120)}` }
  }

  if (json && json.status === 601) expired = true

  return {
    api: apiPath,
    requestBody: body,
    httpStatus,
    elapsedMs,
    bytes: raw ? Buffer.byteLength(raw, 'utf8') : 0,
    status: json?.status ?? null,
    msg: json?.msg ?? null,
    error: error || parseError,
    datas: json?.datas ?? null,
    rawText: json ? undefined : raw   // 非 JSON（比如网关返回 HTML）时保留原文，方便排查
  }
}

function sizeOf(v) {
  return Buffer.byteLength(JSON.stringify(v ?? null), 'utf8')
}

function write(file, data) {
  const full = path.join(OUT_DIR, file)
  fs.writeFileSync(full, JSON.stringify(data, null, 2), 'utf8')
  return { file, bytes: fs.statSync(full).size }
}

function safeName(name) {
  return String(name || '').replace(/[\\/:*?"<>|]/g, '_')
}

// ---------------------------------------------------------------- 主流程
// 输出目录：api访问/2026-09-29_1007/
const now = new Date()
const pad = n => String(n).padStart(2, '0')
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`
const OUT_DIR = path.join(OUT_ROOT, stamp)
fs.mkdirSync(OUT_DIR, { recursive: true })

const index = {
  capturedAt: now.toISOString(),
  baseURL: BASE,
  credentialFrom: CRED.from,
  // 只保留脱敏信息，token 本身不落盘
  requestHeaders: { 'Content-Type': HEADERS['Content-Type'], 'ticket-token': '***', 'userId': '***' },
  options: { line: ONLY_LINE, site: ONLY_SITE, quick: QUICK, allSites: ALL_SITES },
  files: [],
  requests: [],
  summary: {}
}

console.log('===========================================')
console.log(' 四会公交接口快照  api-snapshot')
console.log(` 输出目录: ${OUT_DIR}`)
console.log(` 凭证来源: ${CRED.from}`)
console.log('===========================================\n')

function record(label, result, saved) {
  index.requests.push({
    label,
    api: result.api,
    requestBody: result.requestBody,
    httpStatus: result.httpStatus,
    status: result.status,
    msg: result.msg,
    elapsedMs: result.elapsedMs,
    bytes: result.bytes,
    error: result.error,
    savedAs: saved?.file
  })
  const ok = !result.error && result.status === 200
  console.log(
    `  ${ok ? '[OK]  ' : '[WARN]'} ${label.padEnd(28)} ${String(result.elapsedMs).padStart(5)}ms  ` +
    `HTTP ${result.httpStatus}  status=${result.status}${result.msg ? ' (' + result.msg + ')' : ''}` +
    `${result.error ? '  ' + result.error : ''}` +
    (saved ? `  -> ${saved.file} (${(saved.bytes / 1024).toFixed(1)}KB)` : '')
  )
}

// 1) 线路表（上行 / 下行）
console.log('[1/3] 线路列表 /gj/line/findList')
const upRes = await call('/gj/line/findList', { direction: 1, type: 1 })
const upLines = Array.isArray(upRes.datas) ? upRes.datas : []
record('line/findList 上行', upRes, write('01-line-findList-up.json', upRes))

let downLines = []
if (!ONLY_LINE && !ONLY_SITE) {
  const downRes = await call('/gj/line/findList', { direction: 2, type: 1 })
  downLines = Array.isArray(downRes.datas) ? downRes.datas : []
  record('line/findList 下行', downRes, write('02-line-findList-down.json', downRes))
}

if (expired) {
  console.log('\n[!] 上游返回 601 登录超时 —— token 已失效，后面的数据大概率是空的。')
  console.log('    请运行 node refresh-token.mjs 重新获取 token（需要图形码 + 短信码）。')
}

// 2) 实时公交 /gj/vehicle/findBusReal
const busReal = []
if (!QUICK && !expired) {
  let targets = []
  const lineNames = ONLY_LINE ? [ONLY_LINE] : [...new Set(upLines.map(l => l.linename))]

  for (const name of lineNames) {
    const line = upLines.find(l => l.linename === name) || downLines.find(l => l.linename === name)
    if (!line?.siteList?.length) continue
    // 默认查首站；--site 时只查含该站的线路并命中那个站；--all-sites 时每站都查
    let sites = [line.siteList[0]]
    if (ALL_SITES) sites = line.siteList
    else if (ONLY_SITE) {
      const hit = line.siteList.find(s => s.siteName === ONLY_SITE)
      if (!hit) continue
      sites = [hit]
    }
    for (const site of sites) {
      targets.push({
        linename: name,
        sitename: site.siteName,
        body: { linename: name, bizType: '1', longitude: site.longitude, latitude: site.latitude, sitename: site.siteName }
      })
    }
  }

  console.log(`\n[2/3] 实时公交 /gj/vehicle/findBusReal  (${targets.length} 次请求)`)
  for (const t of targets) {
    const res = await call('/gj/vehicle/findBusReal', t.body)
    const sList = res.datas?.sList || []
    busReal.push({
      linename: t.linename,
      sitename: t.sitename,
      api: res.api,
      requestBody: res.requestBody,
      httpStatus: res.httpStatus,
      status: res.status,
      msg: res.msg,
      elapsedMs: res.elapsedMs,
      error: res.error,
      counts: {
        sList: sList.length,
        vList: (res.datas?.vList || []).length,
        nList: (res.datas?.nList || []).length
      },
      datas: res.datas
    })
    record(`findBusReal ${t.linename}@${t.sitename}`, res, null)
  }
  if (busReal.length) {
    const saved = write('03-busReal.json', busReal)
    index.files.push(saved)
    console.log(`  -> 合并写入 ${saved.file} (${(saved.bytes / 1024).toFixed(1)}KB)`)
  }
} else {
  console.log('\n[2/3] 实时公交：跳过')
}

// 3) 车辆表 /gj/vehicle/findList（车牌用）
console.log('\n[3/3] 车辆列表 /gj/vehicle/findList')
const vehRes = await call('/gj/vehicle/findList', { line: ONLY_LINE || '', page: 1, limit: 500 })
const vehicles = Array.isArray(vehRes.datas) ? vehRes.datas : (vehRes.datas?.list || [])
record('vehicle/findList', vehRes, write('04-vehicle-findList.json', vehRes))

// ---------------------------------------------------------------- 汇总
const withBus = busReal.filter(b => b.counts.sList > 0)
index.summary = {
  线路数: upLines.length,
  下行线路数: downLines.length,
  实时公交请求数: busReal.length,
  有车的查询数: withBus.length,
  在线车辆总数: busReal.reduce((n, b) => n + b.counts.sList, 0),
  车辆表条数: vehicles.length,
  有车的线路: withBus.map(b => `${b.linename}@${b.sitename}(${b.counts.sList}辆)`),
  总耗时ms: index.requests.reduce((n, r) => n + r.elapsedMs, 0)
}
index.files.push(...index.requests.filter(r => r.savedAs).map(r => ({ file: r.savedAs })))
write('00-index.json', index)

console.log('\n===========================================')
console.log(' 汇总')
console.log('===========================================')
console.log(`  线路            : ${index.summary.线路数} 条`)
console.log(`  实时公交请求    : ${index.summary.实时公交请求数} 次，其中 ${index.summary.有车的查询数} 次有车`)
console.log(`  在线车辆        : ${index.summary.在线车辆总数} 辆`)
console.log(`  车辆表          : ${index.summary.车辆表条数} 辆`)
if (withBus.length) {
  console.log('  有车的线路      :')
  withBus.forEach(b => {
    const names = (b.datas?.sList || []).map(v => `${v.vehicleid}(sno=${v.sno},${v.fromTime}分钟)`).join(' ')
    console.log(`     ${b.linename} @ ${b.sitename}: ${names}`)
  })
} else {
  console.log('  有车的线路      : 无（可能已收班，或 token 失效）')
}
const savedList = ['00-index.json（总览）', '01/02 线路表']
if (busReal.length) savedList.push('03-busReal.json')
savedList.push('04-vehicle-findList.json')
console.log(`\n 已保存到: ${OUT_DIR}`)
console.log(` 文件: ${savedList.join(', ')}\n`)

// 供 bat 打开文件夹用（写在 api访问/.last-dir.txt，避免中文路径在命令行里被转码）
try {
  fs.writeFileSync(path.join(OUT_ROOT, '.last-dir.txt'), OUT_DIR, 'utf8')
} catch {}
