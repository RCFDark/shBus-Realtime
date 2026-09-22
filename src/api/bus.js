import { API_CONFIG } from './config'

const TIMEOUT_MS = 8000

async function request(url, data = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(`${API_CONFIG.baseURL}${url}?_t=${Date.now()}`, {
      method: 'POST',
      headers: API_CONFIG.headers,
      body: JSON.stringify(data),
      signal: controller.signal
    })

    const result = await response.json()

    if (result.status === 200) {
      return result.datas
    }
    // 601 = 服务端判定登录超时，说明 ticket-token 已失效，需要续期
    if (result.status === 601) {
      throw new Error('登录凭证已失效（601），请重新获取 token：node refresh-token.mjs')
    }
    throw new Error(result.msg || '请求失败')
  } catch (error) {
    // 超时给出更明确的提示，避免页面一直转圈
    if (error?.name === 'AbortError') {
      throw new Error(`请求超时（>${TIMEOUT_MS / 1000}s）：${API_CONFIG.baseURL}${url}`)
    }
    console.error('API Error:', error)
    throw error
  } finally {
    clearTimeout(timer)
  }
}

// 车辆列表按线路缓存 5 分钟：同一线路在上行/下行各会请求一次，缓存后请求量直接减半
const vehicleCache = new Map()
const VEHICLE_TTL = 5 * 60 * 1000

export const busAPI = {
  async getLineList(direction = 1, type = 1) {
    return request('/gj/line/findList', { direction, type })
  },

  async getBusRealTime(linename, longitude, latitude, sitename, direction = 1) {
    const data = await request('/gj/vehicle/findBusReal', {
      linename,
      bizType: String(direction),
      longitude,
      latitude,
      sitename
    })
    // 服务端 sList 偶尔会把同一辆车返回多条（数据完全相同），按 vehicleid 去重，保留最新记录
    if (Array.isArray(data?.sList)) {
      const seen = new Map()
      for (const v of data.sList) {
        const key = String(v.vehicleid)
        const prev = seen.get(key)
        if (!prev || (Number(v.time) || 0) > (Number(prev.time) || 0)) {
          seen.set(key, v)
        }
      }
      data.sList = Array.from(seen.values())
    }
    return data
  },

  async getVehicleList(line) {
    const now = Date.now()
    const cached = vehicleCache.get(line)
    if (cached && now - cached.at < VEHICLE_TTL) return cached.data

    const data = await request('/gj/vehicle/findList', { line })
    vehicleCache.set(line, { at: now, data })
    return data
  }
}
