// 凭证一律从环境变量读取，不要写死在代码里（仓库是公开的）
//   本地开发：.env.development.local（已被 gitignore）
//   线上构建：GitHub Actions 用仓库 Secret TICKET_TOKEN 注入（见 .github/workflows/deploy.yml）
const TOKEN = import.meta.env?.VITE_TICKET_TOKEN || ''
const USER_ID = import.meta.env?.VITE_USER_ID || ''

// 官方接口会回显请求方的 Origin（Access-Control-Allow-Origin 等于你的站点域名），
// 并且放行 ticket-token / userId 自定义头，所以线上页面可以直接调用，不需要任何代理或 Worker。
// 本地开发仍走 vite dev server 的 /api 代理（vite.config.js）。
const DIRECT_API = 'https://oa.sfc0758.com/sihui'

export const API_CONFIG = {
  // VITE_API_BASE 可手动覆盖（例如改用自有 Worker 代理）
  baseURL: import.meta.env?.VITE_API_BASE || (import.meta.env?.PROD ? DIRECT_API : '/api'),
  headers: {
    'Content-Type': 'application/json',
    'Accept': '*/*',
    'ticket-token': TOKEN,
    'userId': USER_ID
  }
}
