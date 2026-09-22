import { API_CONFIG } from './config'

async function request(url, data = {}) {
  try {
    const response = await fetch(`${API_CONFIG.baseURL}${url}?_t=${Date.now()}`, {
      method: 'POST',
      headers: API_CONFIG.headers,
      body: JSON.stringify(data)
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
    console.error('API Error:', error)
    throw error
  }
}

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
    return request('/gj/vehicle/findList', { line })
  }
}
