// 站点搜索用的拼音工具，基于已安装的 pinyin-pro。
// 支持三种输入：中文「龙城」、全拼「longcheng」（或片段「long」）、首字母「lc」。
import { pinyin } from 'pinyin-pro'

// 站点名 → { full: 'longcheng', first: 'lc' }，算过一次就缓存
const cache = new Map()

function meta(name) {
  const key = String(name || '')
  if (!key) return { full: '', first: '' }
  if (cache.has(key)) return cache.get(key)

  const full = pinyin(key, { toneType: 'none', type: 'array' }).join('').toLowerCase()
  const first = pinyin(key, { pattern: 'first', toneType: 'none', type: 'array' }).join('').toLowerCase()
  const value = { full, first }
  cache.set(key, value)
  return value
}

/** 取某个站点名的拼音信息（供 UI 显示提示用） */
export function pinyinOf(name) {
  return meta(name)
}

/** 判断站点名是否命中搜索词 */
export function matchSite(name, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return true

  const raw = String(name || '')
  if (raw.toLowerCase().includes(q)) return true      // 中文直接命中

  const { full, first } = meta(raw)
  if (full && full.includes(q)) return true           // 全拼（含片段）
  if (first && first.includes(q)) return true         // 首字母，如 lc → 龙城

  return false
}
