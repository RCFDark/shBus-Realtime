<script setup>
import { ref, onMounted, onUnmounted, computed, nextTick } from 'vue'
import { busAPI } from './api/bus.js'
import Dashboard from './components/Dashboard.vue'

const lines = ref([])
const loading = ref(true)
const currentView = ref('list')
const selectedLine = ref(null)
const selectedSite = ref(null)
const realTimeData = ref(null)
const searchQuery = ref('')
const direction = ref(1)
const refreshing = ref(false)
const runningVehicles = ref([])
const loadingVehicles = ref(false)
const busLocations = ref([])
const sitesContainerRef = ref(null)

// 车辆最后上报位置的时间超过这个秒数，就认为它可能已经退出服务（掉线/收车/GPS 异常）
const STALE_SECONDS = 5 * 60

// 定时推进的「当前时间」（秒级时间戳），让"数据陈旧"提示不用刷新页面也会自己更新
const nowTs = ref(Math.floor(Date.now() / 1000))
let nowTimer = null

function extractLineNumber(name) {
  const match = name.match(/(\d+)/)
  return match ? parseInt(match[1], 10) : 999
}

const suspendedLines = ['1B', '9B', '21号']

function isLineSuspended(linename) {
  if (!linename) return false
  const name = linename.trim()
  return suspendedLines.some(suspended => name.includes(suspended))
}

const filteredLines = computed(() => {
  let result = lines.value
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    result = result.filter(line => 
      line.linename.toLowerCase().includes(query)
    )
  }
  return result.sort((a, b) => {
    const aSuspended = isLineSuspended(a.linename)
    const bSuspended = isLineSuspended(b.linename)
    if (aSuspended && !bSuspended) return 1
    if (!aSuspended && bSuspended) return -1
    const numA = extractLineNumber(a.linename)
    const numB = extractLineNumber(b.linename)
    if (numA !== numB) return numA - numB
    return a.linename.localeCompare(b.linename, 'zh-CN')
  })
})

function isOperationEnded(line, dir) {
  if (!line) return false
  const now = new Date()
  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  const lastBus = dir === 1 ? line.lastbus : line.downlastbus
  if (!lastBus) return false
  const [hours, minutes] = lastBus.split(':').map(Number)
  const lastBusMinutes = hours * 60 + minutes
  return currentMinutes > lastBusMinutes
}

onMounted(async () => {
  nowTimer = setInterval(() => { nowTs.value = Math.floor(Date.now() / 1000) }, 30000)
  await loadLines()
})

onUnmounted(() => {
  if (nowTimer) clearInterval(nowTimer)
})

async function loadLines() {
  loading.value = true
  try {
    const data = await busAPI.getLineList(direction.value)
    lines.value = data
  } catch (error) {
    console.error('加载线路失败:', error)
    alert('加载线路失败，请稍后重试')
  } finally {
    loading.value = false
  }
}

async function viewLine(line) {
  selectedLine.value = line
  currentView.value = 'detail'
  const site = line.siteList?.[0]
  if (site) {
    selectedSite.value = site
    await loadRealTimeData()
  }
}

async function loadRealTimeData() {
  if (!selectedLine.value || !selectedSite.value) return
  
  refreshing.value = true
  try {
    const data = await busAPI.getBusRealTime(
      selectedLine.value.linename,
      selectedSite.value.longitude,
      selectedSite.value.latitude,
      selectedSite.value.siteName,
      direction.value
    )
    console.log('实时数据:', data)
    
    const vehicleList = await busAPI.getVehicleList(selectedLine.value.linename)
    console.log('车辆列表:', vehicleList)
    
    realTimeData.value = { ...data, vehicleList }
    
    await nextTick()
    updateBusLocations()
  } catch (error) {
    console.error('获取实时数据失败:', error)
  } finally {
    refreshing.value = false
  }
}

// 当前选中站点在站点列表里的下标（-1 = 取不到）
function selectedSiteIndex() {
  const sites = selectedLine.value?.siteList || []
  return sites.findIndex(s => s.id === selectedSite.value?.id)
}

// 把上游原始车辆数据补成「带派生信息」的对象：
//   gap   —— 车辆所在站相对当前站的站距：>0 已过站、0 就在本站、<0 还没到本站
//   passed—— 上游用 fromTime<=0 表示已过站/已到站
//   stale —— 最后上报时间距今超过 5 分钟
const vehicleStates = computed(() => {
  const list = realTimeData.value?.sList || []
  const sites = selectedLine.value?.siteList || []
  const selIdx = selectedSiteIndex()
  return list.map(v => {
    const sno = Number(v.sno) || 0
    const siteIndex = sno - 1
    const fromTime = Number(v.fromTime) || 0
    const updatedAt = Number(v.time) || 0
    const lagSec = updatedAt ? Math.max(0, nowTs.value - updatedAt) : 0
    return {
      ...v,
      sno,
      siteIndex,
      fromTime,
      passed: fromTime <= 0,
      gap: selIdx === -1 ? 0 : siteIndex - selIdx,
      siteName: sites[siteIndex]?.siteName || '',
      stale: lagSec > STALE_SECONDS,
      lagMinutes: Math.round(lagSec / 60)
    }
  })
})

// 只保留「还会到达当前站点」的车：已经开过本站的、以及到终点收车的都不要
function shouldShowVehicle(vehicle) {
  if (!selectedLine.value?.siteList) return true

  const sites = selectedLine.value.siteList
  const selIdx = selectedSiteIndex()
  const lastSiteIndex = sites.length - 1
  const siteIndex = vehicle.siteIndex
  const isPassed = vehicle.passed
  const isTerminal = siteIndex === lastSiteIndex

  if (isTerminal && isPassed) return false

  if (selIdx !== -1) {
    if (siteIndex > selIdx + 1) return false
    if (siteIndex === selIdx + 1 && isPassed) return false
  }

  return true
}

// 按剩余到站时间升序：3 分钟的在第一行，9 分钟第二行……
// 已过站/已到站（fromTime<=0）没有到站时间，统一沉到最后
const filteredVehicleList = computed(() => {
  return vehicleStates.value
    .filter(shouldShowVehicle)
    .sort((a, b) => {
      const ta = a.fromTime > 0 ? a.fromTime : Number.POSITIVE_INFINITY
      const tb = b.fromTime > 0 ? b.fromTime : Number.POSITIVE_INFINITY
      if (ta !== tb) return ta - tb
      return a.siteIndex - b.siteIndex
    })
})

// 已经被过滤掉的车 = 已经开过本站（或已到终点）的车
const passedVehicles = computed(() => {
  const shown = new Set(filteredVehicleList.value.map(v => String(v.vehicleid)))
  return vehicleStates.value.filter(v => !shown.has(String(v.vehicleid)))
})

// 一辆都没等到时的过站提示：拿离本站最近的那辆已过站的车来算"已过站几站"
const passedHint = computed(() => {
  if (filteredVehicleList.value.length > 0) return null
  if (vehicleStates.value.length === 0) return null

  const nearest = [...passedVehicles.value].sort((a, b) => a.gap - b.gap)[0]
  if (!nearest) return null

  const sites = selectedLine.value?.siteList || []
  const atTerminal = nearest.siteIndex === sites.length - 1 && sites.length > 0
  const siteName = nearest.siteName || `第 ${nearest.sno} 站`
  const atFirstSite = selectedSiteIndex() === 0

  let detail
  if (atTerminal) {
    detail = `上一班车已到达终点站「${siteName}」`
  } else if (nearest.gap > 0) {
    detail = `上一班车已过站 ${nearest.gap} 站，现到达「${siteName}」`
  } else {
    detail = '上一班车刚刚离站'
  }

  return {
    title: atFirstSite ? '等待首站发车' : '等待下一班发车',
    detail
  }
})

// 服务端在上行/下行返回的 startpoint / endpoint 是同一组值（都以上行为准），
// 但站点列表会按方向整体倒序。所以这里手动按方向决定箭头的指向：
// 上行 = 下㘵 → 五马岗，下行 = 五马岗 → 下㘵
const directionRoute = computed(() => {
  const start = selectedLine.value?.startpoint
  const end = selectedLine.value?.endpoint
  if (!start || !end) return ''
  return direction.value === 2 ? `${end} → ${start}` : `${start} → ${end}`
})

function updateBusLocations() {
  if (!realTimeData.value?.sList || !selectedLine.value?.siteList || !sitesContainerRef.value) {
    busLocations.value = []
    return
  }
  
  const sites = selectedLine.value.siteList
  const siteElements = sitesContainerRef.value.querySelectorAll('.site-item')
  const locations = []
  
  console.log('===== updateBusLocations =====')
  console.log('sites length:', sites.length)
  console.log('siteElements length:', siteElements.length)
  
  realTimeData.value.sList.forEach((vehicle, index) => {
    const sno = Number(vehicle.sno) || 0
    const siteIndex = sno - 1
    
    console.log(`vehicle ${index}: sno=${sno}, siteIndex=${siteIndex}`)
    
    if (siteIndex >= 0 && siteIndex < sites.length && siteElements[siteIndex]) {
      const siteElement = siteElements[siteIndex]
      const containerLeft = sitesContainerRef.value.getBoundingClientRect().left
      const siteLeft = siteElement.getBoundingClientRect().left
      const siteWidth = siteElement.offsetWidth
      
      const busLeft = siteLeft - containerLeft + siteWidth / 2
      const fromTime = Number(vehicle.fromTime) || 0
      
      console.log(`  containerLeft=${containerLeft}, siteLeft=${siteLeft}, siteWidth=${siteWidth}, busLeft=${busLeft}`)
      
      locations.push({
        left: busLeft,
        time: fromTime,
        vehicleIndex: index
      })
    }
  })
  
  busLocations.value = locations
  console.log('locations:', locations)
}

async function selectSite(site) {
  selectedSite.value = site
  await loadRealTimeData()
}

function getVehiclePlate(vehicleid) {
  const v = realTimeData.value?.vehicleList?.find(item => Number(item.vehicleid) === Number(vehicleid))
  return v?.vehiclelicense || ''
}

async function toggleDirection() {
  direction.value = direction.value === 1 ? 2 : 1
  await loadLines()
  if (currentView.value === 'detail') {
    const newLine = lines.value.find(l => l.linename === selectedLine.value?.linename)
    if (newLine) {
      selectedLine.value = newLine
      const site = newLine.siteList?.[0]
      if (site) {
        selectedSite.value = site
        await loadRealTimeData()
      }
    }
  }
}

function goBack() {
  currentView.value = 'list'
  selectedLine.value = null
  selectedSite.value = null
  realTimeData.value = null
}

function openDashboard() {
  currentView.value = 'dashboard'
}

async function openRunningVehicles() {
  currentView.value = 'running'
  await loadRunningVehicles()
}

// 两坐标点球面距离（米），用于根据车辆 GPS 判断它在哪个站附近
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const rad = d => (d * Math.PI) / 180
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

async function loadRunningVehicles() {
  loadingVehicles.value = true
  try {
    const upLines = await busAPI.getLineList(1)
    const vehiclesMap = new Map()
    
    await Promise.all(upLines.map(async (line) => {
      try {
        const firstSite = line.siteList?.[0]
        if (!firstSite) return
        
        const vehicleList = await busAPI.getVehicleList(line.linename)
        
        const [upData, downData] = await Promise.all([
          busAPI.getBusRealTime(line.linename, firstSite.longitude, firstSite.latitude, firstSite.siteName, 1),
          line.downfirstbus ? busAPI.getBusRealTime(line.linename, firstSite.longitude, firstSite.latitude, firstSite.siteName, 2) : Promise.resolve(null)
        ])
        
        const addVehicles = (data, direction, directionText, startpoint, endpoint) => {
          if (!data?.sList) return

          // sno 是车辆在其行车方向站点列表中的序号：上行用原列表，下行用反转后的列表
          // （已用车辆 GPS 反查验证：下行车的 sno 对应下行列表，误差 < 100m）
          const dirSites = direction === 2 ? [...(line.siteList || [])].reverse() : (line.siteList || [])

          for (const bus of data.sList) {
            const v = vehicleList?.find(item => Number(item.vehicleid) === Number(bus.vehicleid))
            const plate = v?.vehiclelicense || '未知'

            // 车辆当前位置：sno 站 + GPS 距离判断是“已到达”还是“即将到达”
            const sno = Number(bus.sno) || 0
            const site = sno >= 1 ? dirSites[sno - 1] : null
            const lat = Number(bus.gpslat) / 1e6
            const lng = Number(bus.gpslnt) / 1e6

            let status = ''
            let distanceText = ''
            if (site && lat && lng) {
              const d = distanceMeters(lat, lng, Number(site.latitude), Number(site.longitude))
              if (d <= 150) {
                status = 'arrived'
              } else {
                status = 'approaching'
                distanceText = d >= 1000 ? `≈${(d / 1000).toFixed(1)}km` : `≈${Math.round(d / 50) * 50}m`
              }
            }

            if (!vehiclesMap.has(line.linename)) {
              vehiclesMap.set(line.linename, { linename: line.linename, startpoint, endpoint, vehicles: [] })
            }
            vehiclesMap.get(line.linename).vehicles.push({
              plate,
              direction,
              directionText,
              siteName: site?.siteName || '',
              status,
              distanceText
            })
          }
        }
        
        addVehicles(upData, 1, '上行', line.startpoint, line.endpoint)
        addVehicles(downData, 2, '下行', line.endpoint, line.startpoint)
      } catch (e) {
        console.error(`获取线路 ${line.linename} 失败:`, e)
      }
    }))
    
    runningVehicles.value = Array.from(vehiclesMap.values()).sort((a, b) => {
      const numA = extractLineNumber(a.linename)
      const numB = extractLineNumber(b.linename)
      return numA - numB
    })
  } catch (error) {
    console.error('加载运行车辆失败:', error)
  } finally {
    loadingVehicles.value = false
  }
}
</script>

<template>
  <div class="app">
    <Dashboard 
      v-if="currentView === 'dashboard'"
      @back="goBack"
    />
    
    <template v-else>
      <header class="header">
        <button v-if="currentView === 'detail' || currentView === 'running'" @click="goBack" class="back-btn">
          ← 返回
        </button>
        <h1>四会公交实时查询</h1>
      </header>
    
    <main class="main">
      <div v-if="loading" class="loading">
        <div class="spinner"></div>
        <p>加载中...</p>
      </div>
      
      <div v-else-if="currentView === 'list'" class="list-view">
        <div class="search-box">
          <input 
            v-model="searchQuery"
            type="text" 
            placeholder="搜索线路..."
            class="search-input"
          />
        </div>
        
        <div class="direction-toggle">
          <button :class="{ active: direction === 1 }" @click="toggleDirection">
            上行
          </button>
          <button :class="{ active: direction === 2 }" @click="toggleDirection">
            下行
          </button>
        </div>
        
        <div class="quick-actions">
          <button @click="openRunningVehicles" class="action-btn">
            运行车辆
          </button>
          <button @click="openDashboard" class="action-btn">
            公交大屏
          </button>
        </div>
        
        <div class="line-count">
          共 {{ filteredLines.length }} 条线路
        </div>
        
        <div class="line-list">
          <div 
            v-for="line in filteredLines" 
            :key="line.id"
            class="line-card"
            :class="{ suspended: isLineSuspended(line.linename) }"
            @click="viewLine(line)"
          >
            <div class="line-info">
              <div class="line-name">{{ line.linename }}</div>
              <div class="line-route">{{ line.startpoint }} ⇋ {{ line.endpoint }}</div>
              <div class="line-meta">
                <span>票价 {{ line.startingfare }}-{{ line.fullfare }}元</span>
                <span>{{ line.firstbus }}-{{ line.lastbus }}</span>
              </div>
            </div>
            <div class="line-arrow">›</div>
          </div>
        </div>
      </div>
      
        <div v-else-if="currentView === 'detail'" class="detail-view">
          <div class="line-header">
            <h2>{{ selectedLine?.linename }}</h2>
            <div class="line-direction">
              <span class="dir-tag" :class="{ down: direction === 2 }">{{ direction === 2 ? '下行' : '上行' }}</span>
              <span class="dir-route">{{ directionRoute }}</span>
            </div>
            <div class="line-meta">
              <span>票价 {{ selectedLine?.startingfare }}-{{ selectedLine?.fullfare }}元</span>
            </div>
            <div class="line-time">
              <span>上行 {{ selectedLine?.firstbus }}-{{ selectedLine?.lastbus }}</span>
              <span>下行 {{ selectedLine?.downfirstbus }}-{{ selectedLine?.downlastbus }}</span>
            </div>
          </div>
          
          <div v-if="isLineSuspended(selectedLine?.linename)" class="suspended-notice">
            线路已停运
          </div>
          
          <template v-else>
            <div class="realtime-section" v-if="realTimeData">
              <div class="realtime-header">
                <h3>实时公交</h3>
                <div class="realtime-actions">
                  <button @click="toggleDirection" class="toggle-direction-btn">切换方向</button>
                  <button @click="loadRealTimeData" :disabled="refreshing" class="refresh-btn">
                    {{ refreshing ? '刷新中...' : '刷新' }}
                  </button>
                </div>
              </div>
              <div class="current-site">当前站点: {{ selectedSite?.siteName }}</div>
              
              <div v-if="filteredVehicleList.length > 0" class="vehicle-list">
                <div
                  v-for="vehicle in filteredVehicleList"
                  :key="vehicle.vehicleid"
                  class="vehicle-card"
                  :class="{ 'is-stale': vehicle.stale }"
                >
                  <div class="vehicle-top">
                    <span class="vehicle-plate" v-if="getVehiclePlate(vehicle.vehicleid)">{{ getVehiclePlate(vehicle.vehicleid) }}</span>
                    <span v-if="vehicle.passed" class="vehicle-time passed">已过站</span>
                    <span v-else class="vehicle-time">{{ vehicle.fromTime }}分钟</span>
                  </div>
                  <div class="vehicle-info">
                    <span class="vehicle-distance" v-if="vehicle.currentDistance !== '0' && vehicle.currentDistance !== 0">{{ vehicle.currentDistance }}米</span>
                    <span class="vehicle-gap" v-if="vehicle.gap < 0">还有 {{ -vehicle.gap }} 站</span>
                    <span class="vehicle-gap" v-else-if="vehicle.gap === 0">已在本站</span>
                    <span class="vehicle-pos" v-if="vehicle.siteName">车辆位置：{{ vehicle.siteName }}</span>
                  </div>
                  <div class="vehicle-update">更新: {{ vehicle.timeStr }}</div>
                  <div v-if="vehicle.stale" class="vehicle-warn">
                    ⚠ 公交车可能退出服务或异常（已 {{ vehicle.lagMinutes }} 分钟未更新位置）
                  </div>
                </div>
              </div>
              <div v-else-if="isOperationEnded(selectedLine, direction)" class="no-bus ended">今天该线路运营已结束</div>
              <div v-else-if="passedHint" class="passed-hint">
                <div class="passed-title">🕒 {{ passedHint.title }}</div>
                <div class="passed-detail">{{ passedHint.detail }}</div>
              </div>
              <div v-else class="no-bus">暂无运营车辆</div>
            </div>
            
            <div class="sites-section">
              <h3>站点列表</h3>
              
              <div class="sites-scroll">
                <div class="scroll-content">
              <div class="bus-layer">
                <div 
                  v-for="(bus, idx) in busLocations" 
                  :key="idx"
                  class="bus-icon"
                  :style="{ left: bus.left + 'px' }"
                >
                  🚌
                </div>
              </div>
              
              <div class="sites-track" ref="sitesContainerRef">
                    <template v-for="(site, siteIdx) in selectedLine?.siteList" :key="site.id">
                      <div
                        class="site-item"
                        :class="{ active: selectedSite?.id === site.id }"
                        @click="selectSite(site)"
                      >
                        <div class="site-dot"></div>
                        <div class="site-name">{{ site.siteName }}</div>
                      </div>
                      <!-- 站间方向箭头：列表顺序 = 行车方向，恒指向右。
                           注意不要给这个元素加 site-item 类，updateBusLocations 靠该类名取站点索引 -->
                      <div
                        v-if="siteIdx < (selectedLine?.siteList?.length || 0) - 1"
                        class="site-arrow"
                        aria-hidden="true"
                      ></div>
                    </template>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>
        
        <div v-else-if="currentView === 'running'" class="running-view">
          <div v-if="loadingVehicles" class="loading">
            <div class="spinner"></div>
            <p>加载运行车辆中...</p>
          </div>
          
          <div v-else class="vehicles-container">
            <div class="vehicles-header">
              <h3>当前运行线路 ({{ runningVehicles.length }} 条)</h3>
              <button @click="loadRunningVehicles" class="refresh-btn">刷新</button>
            </div>
            
            <div v-if="runningVehicles.length === 0" class="no-vehicles">
              暂无运行车辆
            </div>
            
            <div v-else class="lines-list">
              <div v-for="line in runningVehicles" :key="line.linename" class="line-group">
                <div class="line-group-header">
                  <span class="line-name">{{ line.linename }}</span>
                  <span class="line-route">{{ line.startpoint }} ⇋ {{ line.endpoint }}</span>
                  <span class="vehicle-count">{{ line.vehicles.length }} 辆</span>
                </div>
                <div class="line-vehicles">
                  <div v-for="(vehicle, idx) in line.vehicles" :key="idx" class="vehicle-row">
                    <span class="v-plate">{{ vehicle.plate }}</span>
                    <span class="v-direction" :class="{ up: vehicle.direction === 1, down: vehicle.direction === 2 }">{{ vehicle.directionText }}</span>
                    <span v-if="vehicle.siteName" class="v-position">
                      <span v-if="vehicle.status === 'arrived'" class="v-state arrived">已到达：{{ vehicle.siteName }}</span>
                      <span v-else-if="vehicle.status === 'approaching'" class="v-state approaching">即将到达：{{ vehicle.siteName }}</span>
                      <span v-else>位置：{{ vehicle.siteName }}</span>
                      <span v-if="vehicle.distanceText" class="v-dist">{{ vehicle.distanceText }}</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
    </main>
    </template>
  </div>
</template>

<style scoped>
.app {
  max-width: 100%;
  min-height: 100vh;
  background: #f5f7fa;
}

.header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 15px 20px;
  position: sticky;
  top: 0;
  z-index: 100;
  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 50px;
  flex-wrap: wrap;
  gap: 10px;
}

.header h1 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

@media (max-width: 480px) {
  .header {
    padding: 12px 15px;
  }
  
  .header h1 {
    font-size: 16px;
    text-align: center;
  }
  
  .quick-actions {
    flex-direction: column;
    gap: 8px;
  }
  
  .action-btn {
    padding: 12px;
  }
}

.back-btn {
  position: absolute;
  left: 15px;
  background: rgba(255,255,255,0.2);
  border: none;
  color: white;
  padding: 8px 16px;
  border-radius: 20px;
  cursor: pointer;
  font-size: 14px;
}

.main {
  padding: 15px;
  max-width: 600px;
  margin: 0 auto;
  min-height: calc(100vh - 60px);
}

.loading {
  text-align: center;
  padding: 80px 20px;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #e0e0e0;
  border-top: 4px solid #667eea;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 15px;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.search-box {
  margin-bottom: 15px;
}

.search-input {
  width: 100%;
  padding: 12px 15px;
  border: none;
  border-radius: 10px;
  font-size: 16px;
  background: white;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}

.direction-toggle {
  display: flex;
  gap: 10px;
  margin-bottom: 10px;
}

.direction-toggle button {
  flex: 1;
  padding: 10px;
  border: 2px solid #667eea;
  background: white;
  color: #667eea;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
}

.direction-toggle button.active {
  background: #667eea;
  color: white;
}

.quick-actions {
  display: flex;
  gap: 10px;
  margin-bottom: 15px;
}

.action-btn {
  flex: 1;
  padding: 10px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
}

.action-btn:hover {
  opacity: 0.9;
}

.line-count {
  font-size: 14px;
  color: #999;
  margin-bottom: 10px;
  padding: 0 5px;
}

.line-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.line-card {
  background: white;
  padding: 15px 20px;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.line-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}

.line-card.suspended {
  opacity: 0.5;
  background: #f0f0f0;
}

.line-card.suspended:hover {
  transform: none;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}

.line-card.suspended .line-name,
.line-card.suspended .line-route,
.line-card.suspended .line-meta {
  color: #999;
}

.line-name {
  font-size: 18px;
  font-weight: 600;
  color: #333;
  margin-bottom: 5px;
}

.line-route {
  font-size: 14px;
  color: #666;
  margin-bottom: 5px;
}

.line-meta {
  display: flex;
  gap: 15px;
  font-size: 12px;
  color: #999;
}

.line-arrow {
  font-size: 24px;
  color: #ccc;
}

.detail-view {
  animation: fadeIn 0.3s;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.line-header {
  background: white;
  padding: 20px;
  border-radius: 12px;
  margin-bottom: 15px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}

.suspended-notice {
  background: #fff3f3;
  border: 1px solid #ffccc7;
  color: #ff4d4f;
  padding: 20px;
  border-radius: 12px;
  text-align: center;
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 15px;
}

.line-header h2 {
  margin: 0 0 5px 0;
  color: #333;
}

.line-header .line-route {
  color: #666;
  margin-bottom: 10px;
}

.line-header .line-meta {
  color: #667eea;
  font-weight: 500;
  margin-bottom: 5px;
}

/* 运行方向：上行/下行 箭头指向跟着方向走 */
.line-direction {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.dir-tag {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  background: #e6f7ff;
  color: #1890ff;
}

.dir-tag.down {
  background: #fff0e6;
  color: #fa8c16;
}

.dir-route {
  font-size: 15px;
  font-weight: 600;
  color: #333;
}

/* 站点轨道：站与站之间叠加一个方向箭头（见 .site-arrow） */

.line-time {
  display: flex;
  gap: 20px;
  font-size: 13px;
  color: #999;
}

.realtime-section {
  background: white;
  padding: 15px;
  border-radius: 12px;
  margin-bottom: 15px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}

.realtime-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.realtime-header h3 {
  margin: 0;
  font-size: 16px;
}

.realtime-actions {
  display: flex;
  gap: 8px;
}

.toggle-direction-btn {
  background: #667eea;
  color: white;
  border: none;
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}

.refresh-btn {
  background: #667eea;
  color: white;
  border: none;
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}

.refresh-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.current-site {
  font-size: 14px;
  color: #667eea;
  margin-bottom: 10px;
}

.vehicle-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.vehicle-card {
  background: #f8f9fa;
  padding: 12px;
  border-radius: 8px;
}

/* 数据超过 5 分钟没更新：整张卡片标红，提示车辆可能已退出服务 */
.vehicle-card.is-stale {
  background: #fff7f7;
  box-shadow: inset 0 0 0 1px #ffccc7;
}

.vehicle-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}

.vehicle-plate {
  font-weight: 600;
  color: #333;
  margin-bottom: 0;
}

.vehicle-warn {
  margin-top: 6px;
  font-size: 12px;
  color: #ff4d4f;
}

.vehicle-gap {
  color: #fa8c16;
}

.vehicle-pos {
  color: #999;
}

.vehicle-info {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 15px;
  margin-bottom: 5px;
}

.vehicle-distance {
  font-weight: 600;
  color: #667eea;
}

.vehicle-time {
  font-weight: 600;
  color: #52c41a;
}

.vehicle-time.passed {
  color: #999;
}

.vehicle-update {
  font-size: 12px;
  color: #999;
}

.no-bus {
  text-align: center;
  color: #999;
  padding: 20px;
}

.no-bus.ended {
  color: #ff6b6b;
  font-weight: 500;
}

/* 过站提示：等不到车，但线路上其实有车（只是都开过本站了） */
.passed-hint {
  background: #fffbe6;
  box-shadow: inset 0 0 0 1px #ffe58f;
  border-radius: 8px;
  padding: 16px;
  text-align: center;
}

.passed-title {
  font-size: 15px;
  font-weight: 600;
  color: #d48806;
  margin-bottom: 6px;
}

.passed-detail {
  font-size: 13px;
  color: #8c6d1f;
}

.sites-section {
  background: white;
  padding: 15px;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}

.sites-section h3 {
  margin: 0 0 10px 0;
  font-size: 16px;
}

.sites-scroll {
  display: flex;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.scroll-content {
  display: flex;
  flex-direction: column;
  min-width: max-content;
}

.bus-layer {
  height: 40px;
  position: relative;
  margin-bottom: 10px;
}

.bus-icon {
  position: absolute;
  font-size: 28px;
  top: 20px;
  transform: translateX(-50%);
}

.sites-track {
  display: flex;
  padding: 20px 0 10px 0;
  position: relative;
}

.sites-track {
  display: flex;
  padding: 20px 0 10px 0;
  position: relative;
}

.sites-track::before {
  content: '';
  position: absolute;
  top: 26px;
  left: 22px;
  right: 22px;
  height: 2px;
  background: #e0e0e0;
}

.sites-scroll::-webkit-scrollbar {
  height: 4px;
}

.sites-scroll::-webkit-scrollbar-thumb {
  background: #ddd;
  border-radius: 2px;
}

.site-item {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 16px;
  cursor: pointer;
  position: relative;
  z-index: 1;
}

.site-dot {
  width: 12px;
  height: 12px;
  background: #e0e0e0;
  border-radius: 50%;
  margin-bottom: 8px;
  border: 2px solid white;
  box-shadow: 0 0 0 2px #e0e0e0;
  transition: all 0.2s;
}

.site-item.active .site-dot {
  background: #667eea;
  box-shadow: 0 0 0 2px #667eea;
  transform: scale(1.3);
}

.site-name {
  font-size: 12px;
  color: #666;
  white-space: nowrap;
  text-align: center;
}

.site-item.active .site-name {
  color: #667eea;
  font-weight: 600;
}

.sites-track::before {
  content: '';
  position: absolute;
  top: 26px;
  left: 8px;
  right: 8px;
  height: 2px;
  background: #e0e0e0;
}

.site-item.first {
  margin-left: 8px;
}

.site-item.last {
  margin-right: 8px;
}

.sites-scroll::-webkit-scrollbar {
  height: 4px;
}

.sites-scroll::-webkit-scrollbar-thumb {
  background: #ddd;
  border-radius: 2px;
}

.site-item {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 16px;
  cursor: pointer;
  position: relative;
  z-index: 1;
}

.site-dot {
  width: 12px;
  height: 12px;
  background: #e0e0e0;
  border-radius: 50%;
  margin-bottom: 8px;
  border: 2px solid white;
  box-shadow: 0 0 0 2px #e0e0e0;
  transition: all 0.2s;
}

.site-item.active .site-dot {
  background: #667eea;
  box-shadow: 0 0 0 2px #667eea;
  transform: scale(1.3);
}

.site-name {
  font-size: 12px;
  color: #666;
  white-space: nowrap;
  text-align: center;
}

.site-item.active .site-name {
  color: #667eea;
  font-weight: 600;
}

.running-view {
  animation: fadeIn 0.3s;
}

.vehicles-container {
  background: white;
  border-radius: 12px;
  padding: 15px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}

.vehicles-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
  padding-bottom: 10px;
  border-bottom: 1px solid #f0f0f0;
}

.vehicles-header h3 {
  margin: 0;
  font-size: 16px;
  color: #333;
}

.no-vehicles {
  text-align: center;
  color: #999;
  padding: 40px 20px;
  font-size: 14px;
}

.vehicles-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.line-group {
  background: #f8f9fa;
  border-radius: 8px;
  margin-bottom: 12px;
  overflow: hidden;
}

.line-group-header {
  background: #667eea;
  color: white;
  padding: 10px 15px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.line-group-header .line-name {
  font-size: 18px;
  font-weight: 700;
}

.line-group-header .line-route {
  flex: 1;
  font-size: 13px;
  opacity: 0.9;
}

.line-group-header .vehicle-count {
  font-size: 14px;
  background: rgba(255,255,255,0.2);
  padding: 2px 10px;
  border-radius: 10px;
}

.line-vehicles {
  padding: 8px 15px;
}

.vehicle-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid #eee;
}

.vehicle-row:last-child {
  border-bottom: none;
}

.v-plate {
  font-weight: 600;
  color: #333;
  min-width: 100px;
}

.v-direction {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 600;
}

.v-direction.up {
  background: #e6f7ff;
  color: #1890ff;
}

.v-direction.down {
  background: #fff0e6;
  color: #fa8c16;
}

.v-time {
  margin-left: auto;
  font-weight: 600;
  color: #667eea;
}

/* ===== 站间方向箭头 =====
   白底圆形垫片压在轨道线上，内嵌向右箭头（列表顺序 = 行车方向，恒指向右）。
   圆点中心在 track 顶部下方 28px（padding-top 20 + 圆点半径 8），
   箭头垫片 18px，故 margin-top = 28 - 9 - 20 = -1px。 */
.site-arrow {
  flex-shrink: 0;
  position: relative;
  z-index: 1;
  width: 18px;
  height: 18px;
  margin-top: -1px;
  pointer-events: none;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 18 18'%3E%3Ccircle cx='9' cy='9' r='9' fill='%23ffffff'/%3E%3Cpath d='M6.2 5.2 L12 9 L6.2 12.8' fill='none' stroke='%23a9b4c4' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / 100% 100% no-repeat;
}

.site-arrow.next-active {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 18 18'%3E%3Ccircle cx='9' cy='9' r='9' fill='%23ffffff'/%3E%3Cpath d='M6.2 5.2 L12 9 L6.2 12.8' fill='none' stroke='%23667eea' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
}

/* ===== 运行车辆面板：车辆位置 ===== */
.vehicle-row .v-position {
  margin-left: auto;
  font-size: 13px;
  text-align: right;
  color: #666;
}

.v-position .v-state {
  font-weight: 600;
}

.v-position .v-state.arrived {
  color: #389e0d;
}

.v-position .v-state.approaching {
  color: #d46b08;
}

.v-position .v-dist {
  color: #999;
  font-size: 12px;
}
</style>
