// 凭证优先从环境变量读取（本地：.env.development.local；线上：仓库 Secret TICKET_TOKEN）。
// 未配置时回退到内置值 —— 保证线上不至于因为缺少 Secret 而完全不可用。
// 注意：该 token 是「通利行」App 的公共会话凭证（服务端不校验 userId，只能查公交数据），
// 若介意它出现在公开仓库里，请配置仓库 Secret TICKET_TOKEN 后把 FALLBACK_TOKEN 置空。
const FALLBACK_TOKEN = 'da8d05b7-6241-4c2e-b4b4-699ae9ed1ed9'
const FALLBACK_USER = 'ec359ef577b846be91a41d7ca17f9353'

const TOKEN = import.meta.env?.VITE_TICKET_TOKEN || FALLBACK_TOKEN
const USER_ID = import.meta.env?.VITE_USER_ID || FALLBACK_USER
if (!import.meta.env?.VITE_TICKET_TOKEN && import.meta.env?.PROD) {
  console.warn('[bus] 未注入 VITE_TICKET_TOKEN，正在使用内置兜底 token，建议配置仓库 Secret TICKET_TOKEN')
}

// 官方接口会回显请求方的 Origin（Access-Control-Allow-Origin 等于你的站点域名），
// 并放行 ticket-token / userId 自定义头，所以线上页面可直接调用，不需要代理。
// 实测：直连 0.2~0.4s；而 *.workers.dev 在国内网络普遍不可达（直连必超时），
// 因此线上若被指到 workers.dev，一律回退直连，避免页面卡死。
const DIRECT_API = 'https://oa.sfc0758.com/sihui'

const RAW_BASE = import.meta.env?.VITE_API_BASE || ''

function resolveBaseURL() {
  if (!import.meta.env?.PROD) return RAW_BASE || '/api'   // 本地走 vite 代理
  if (!RAW_BASE) return DIRECT_API
  if (/workers\.dev/.test(RAW_BASE)) return DIRECT_API     // 已知不可达，强制直连
  return RAW_BASE
}

export const API_CONFIG = {
  baseURL: resolveBaseURL(),
  headers: {
    'Content-Type': 'application/json',
    'Accept': '*/*',
    'ticket-token': TOKEN,
    'userId': USER_ID
  }
}
