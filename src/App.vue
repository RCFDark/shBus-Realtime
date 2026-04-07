<script setup>
import { ref, onMounted, computed } from 'vue'
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
  await loadLines()
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
    
    updateBusLocations()
  } catch (error) {
    console.error('获取实时数据失败:', error)
  } finally {
    refreshing.value = false
  }
}

function shouldShowVehicle(vehicle) {
  if (!selectedLine.value?.siteList) return true
  
  const sites = selectedLine.value.siteList
  const selectedSiteIndex = sites.findIndex(s => s.id === selectedSite.value?.id)
  const lastSiteIndex = sites.length - 1
  
  const sno = Number(vehicle.sno) || 0
  const siteIndex = sno - 1
  const fromTime = Number(vehicle.fromTime) || 0
  const isPassed = fromTime === 0
  const isTerminal = siteIndex === lastSiteIndex
  
  if (isTerminal && isPassed) return false
  
  if (selectedSiteIndex !== -1) {
    if (siteIndex > selectedSiteIndex + 1) return false
    if (siteIndex === selectedSiteIndex + 1 && isPassed) return false
  }
  
  return true
}

const filteredVehicleList = computed(() => {
  if (!realTimeData.value?.sList) return []
  return realTimeData.value.sList.filter(shouldShowVehicle)
})

function updateBusLocations() {
  if (!realTimeData.value?.sList || !selectedLine.value?.siteList || !sitesContainerRef.value) {
    busLocations.value = []
    return
  }
  
  const sites = selectedLine.value.siteList
  const siteElements = sitesContainerRef.value.querySelectorAll('.site-item')
  const locations = []
  
  realTimeData.value.sList.forEach((vehicle, index) => {
    const sno = Number(vehicle.sno) || 0
    const siteIndex = sno - 1
    
    if (siteIndex >= 0 && siteIndex < sites.length && siteElements[siteIndex]) {
      const siteElement = siteElements[siteIndex]
      const containerLeft = sitesContainerRef.value.getBoundingClientRect().left
      const siteLeft = siteElement.getBoundingClientRect().left
      const siteWidth = siteElement.offsetWidth
      
      const busLeft = siteLeft - containerLeft + siteWidth / 2
      const fromTime = Number(vehicle.fromTime) || 0
      
      locations.push({
        left: busLeft,
        time: fromTime,
        vehicleIndex: index
      })
    }
  })
  
  busLocations.value = locations
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
          
          for (const bus of data.sList) {
            const v = vehicleList?.find(item => Number(item.vehicleid) === Number(bus.vehicleid))
            const plate = v?.vehiclelicense || '未知'
            if (!vehiclesMap.has(line.linename)) {
              vehiclesMap.set(line.linename, { linename: line.linename, startpoint, endpoint, vehicles: [] })
            }
            vehiclesMap.get(line.linename).vehicles.push({
              plate,
              direction,
              directionText
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
        <div v-if="currentView === 'list'" class="header-buttons">
          <button @click="openRunningVehicles" class="header-btn vehicles-btn">
            运行车辆
          </button>
          <button @click="openDashboard" class="header-btn dashboard-btn">
            公交大屏
          </button>
        </div>
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
            <div class="line-route">{{ selectedLine?.startpoint }} ⇋ {{ selectedLine?.endpoint }}</div>
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
                <div v-for="vehicle in filteredVehicleList" :key="vehicle.vehicleid" class="vehicle-card">
                  <div class="vehicle-plate" v-if="getVehiclePlate(vehicle.vehicleid)">{{ getVehiclePlate(vehicle.vehicleid) }}</div>
                  <div class="vehicle-info">
                    <span class="vehicle-distance" v-if="vehicle.currentDistance !== '0' && vehicle.currentDistance !== 0">{{ vehicle.currentDistance }}米</span>
                    <span v-if="vehicle.fromTime <= 0" class="vehicle-time passed">已过站</span>
                    <span v-else class="vehicle-time">{{ vehicle.fromTime }}分钟</span>
                  </div>
                  <div class="vehicle-update">更新: {{ vehicle.timeStr }}</div>
                </div>
              </div>
              <div v-else-if="isOperationEnded(selectedLine, direction)" class="no-bus ended">今天该线路运营已结束</div>
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
                    <div 
                      v-for="site in selectedLine?.siteList" 
                      :key="site.id"
                      class="site-item"
                      :class="{ active: selectedSite?.id === site.id }"
                      @click="selectSite(site)"
                    >
                      <div class="site-dot"></div>
                      <div class="site-name">{{ site.siteName }}</div>
                    </div>
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
    flex-direction: column;
    align-items: stretch;
  }
  
  .header h1 {
    font-size: 16px;
    text-align: center;
    order: 1;
  }
  
  .header-buttons {
    position: static;
    justify-content: center;
    order: 2;
    width: 100%;
  }
  
  .header-btn {
    flex: 1;
    padding: 8px 10px;
    font-size: 12px;
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
  margin-bottom: 15px;
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

.vehicle-plate {
  font-weight: 600;
  color: #333;
  margin-bottom: 8px;
}

.vehicle-info {
  display: flex;
  gap: 15px;
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

.header-buttons {
  position: absolute;
  right: 15px;
  display: flex;
  gap: 8px;
}

.header-btn {
  background: rgba(255,255,255,0.2);
  border: 1px solid rgba(255,255,255,0.3);
  color: white;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}

.header-btn:hover {
  background: rgba(255,255,255,0.3);
}

.vehicles-btn {
  background: rgba(255,255,255,0.25);
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
</style>
