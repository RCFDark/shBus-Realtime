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
    } else {
      throw new Error(result.msg || '请求失败')
    }
  } catch (error) {
    console.error('API Error:', error)
    throw error
  }
}

export const busAPI = {
  async getLineList(direction = 1) {
    return request('/gj/line/findList', { direction })
  },
  
  async getBusRealTime(linename, longitude, latitude, sitename, direction = 1) {
    return request('/gj/vehicle/findBusReal', {
      linename,
      bizType: String(direction),
      longitude,
      latitude,
      sitename
    })
  },
  
  async getVehicleList(line) {
    return request('/gj/vehicle/findList', { line })
  }
}
