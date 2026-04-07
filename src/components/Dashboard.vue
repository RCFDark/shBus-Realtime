<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { busAPI } from '../api/bus.js'
import { mockData } from '../api/mock.js'
import translations from '../../line_and_stops.json'

const USE_MOCK = false

const lineEnMap = new Map()
const endpointEnMap = new Map()
const siteEnMap = new Map()

translations.lines.forEach(line => {
  lineEnMap.set(line.linename, line.linenameEn)
  if (line.up) {
    endpointEnMap.set(line.up.startpoint, line.up.startpointEn)
    endpointEnMap.set(line.up.endpoint, line.up.endpointEn)
  }
  if (line.down) {
    endpointEnMap.set(line.down.startpoint, line.down.startpointEn)
    endpointEnMap.set(line.down.endpoint, line.down.endpointEn)
  }
})
translations.sites.forEach(site => {
  siteEnMap.set(site.siteName, site.siteNameEn)
})

const emit = defineEmits(['back'])

const allLines = ref([])
const allSites = ref([])
const selectedSiteName = ref('')
const selectedSite = ref(null)
const busData = ref([])
const currentTime = ref('')
const tips = ref('')
const tipsWidth = ref(0)
const mediaList = ref([])
const currentMediaIndex = ref(0)
const showSiteSelector = ref(false)
const siteSearchQuery = ref('')
const showRunningVehicles = ref(false)
const runningVehicles = ref([])
const loadingVehicles = ref(false)

let timeTimer = null
let dataTimer = null
let mediaTimer = null

const sortedBuses = computed(() => {
  const all = []
  busData.value.forEach(line => {
    line.buses.forEach(bus => {
      all.push({
        ...bus,
        linename: line.linename,
        linenameEn: line.linenameEn
      })
    })
  })
  return all.sort((a, b) => a.time - b.time)
})

const currentBus = computed(() => sortedBuses.value[0] || null)
const nextBus = computed(() => sortedBuses.value[1] || null)
const thirdBus = computed(() => sortedBuses.value[2] || null)

const formattedDate = computed(() => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}年${month}月${day}日`
})

const formattedTime = computed(() => {
  const now = new Date()
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  return `${hours}：${minutes}`
})

const filteredSites = computed(() => {
  if (!siteSearchQuery.value) return allSites.value
  const query = siteSearchQuery.value.toLowerCase()
  return allSites.value.filter(site => 
    site.siteName.toLowerCase().includes(query)
  )
})

async function loadTips() {
  try {
    const tipFiles = import.meta.glob('../assets/media/tips.txt', { eager: true, as: 'raw' })
    const tipContent = tipFiles['../assets/media/tips.txt']
    const separator = '\u3000\u3000\u3000\u3000\u3000\u3000'
    const combined = (tipContent || '提示信息提示信息提示信息提示信息提示信息')
      .split('\n')
      .filter(t => t.trim())
      .join(separator)
    tips.value = combined
    const fontSize = 26
    const textWidth = tips.value.length * fontSize
    tipsWidth.value = textWidth
  } catch (e) {
    tips.value = '提示信息提示信息提示信息提示信息提示信息'
    tipsWidth.value = 500
  }
}

async function loadMedia() {
  const mediaGlobs = import.meta.glob('../assets/media/*.(jpg|jpeg|png|webp|mp4|webm)', { eager: true, as: 'url' })
  const files = Object.keys(mediaGlobs).map(path => {
    const ext = path.split('.').pop().toLowerCase()
    return {
      type: ['mp4', 'webm'].includes(ext) ? 'video' : 'image',
      url: mediaGlobs[path]
    }
  })
  mediaList.value = files
}

async function loadAllLines() {
  if (USE_MOCK) {
    allSites.value = mockData.sites
    if (allSites.value.length > 0 && !selectedSiteName.value) {
      selectSite(allSites.value.find(s => s.siteName === '龙城') || allSites.value[0])
    }
    return
  }
  
  const [upLines, downLines] = await Promise.all([
    busAPI.getLineList(1),
    busAPI.getLineList(2)
  ])
  
  const lineMap = new Map()
  const siteMap = new Map()
  
  ;[...upLines, ...downLines].forEach(line => {
    const key = line.linename
    if (!lineMap.has(key)) {
      lineMap.set(key, { up: null, down: null })
    }
    if (line.direction === 1 || !line.direction) {
      lineMap.get(key).up = line
    } else {
      lineMap.get(key).down = line
    }
    
    line.siteList?.forEach(site => {
      if (!siteMap.has(site.siteName)) {
        siteMap.set(site.siteName, site)
      }
    })
  })
  
  allLines.value = Array.from(lineMap.entries()).map(([linename, data]) => ({
    linename,
    linenameEn: lineEnMap.get(linename) || linename,
    ...data
  }))
  
  allSites.value = Array.from(siteMap.values()).map(site => ({
    ...site,
    siteNameEn: siteEnMap.get(site.siteName) || site.siteName
  })).sort((a, b) => 
    a.siteName.localeCompare(b.siteName, 'zh-CN')
  )
  
  if (allSites.value.length > 0 && !selectedSiteName.value) {
    selectSite(allSites.value.find(s => s.siteName === '龙城') || allSites.value[0])
  }
}

function selectSite(site) {
  selectedSiteName.value = site.siteName
  selectedSite.value = site
  showSiteSelector.value = false
  siteSearchQuery.value = ''
  loadBusData()
}

async function loadBusData() {
  if (!selectedSite.value) return
  
  if (USE_MOCK) {
    busData.value = mockData.lines
    return
  }
  
  try {
    const results = await Promise.all(
      allLines.value.map(async ({ linename, up, down }) => {
        const buses = []
        
        if (up?.siteList?.length) {
          const site = up.siteList.find(s => s.siteName === selectedSiteName.value)
          if (site) {
            const data = await busAPI.getBusRealTime(linename, site.longitude, site.latitude, site.siteName, 1)
            if (data?.sList?.length) {
              const vehicleList = await busAPI.getVehicleList(linename)
              data.sList.forEach(v => {
                const plate = vehicleList?.find(vl => Number(vl.vehicleid) === Number(v.vehicleid))?.vehiclelicense
                if (v.fromTime > 0) {
                  const endStop = up.endpoint
                  buses.push({
                    time: v.fromTime,
                    endpoint: endStop,
                    endpointEn: endpointEnMap.get(endStop) || endStop,
                    plate: plate || ''
                  })
                }
              })
            }
          }
        }
        
        if (down?.siteList?.length) {
          const site = down.siteList.find(s => s.siteName === selectedSiteName.value)
          if (site) {
            const data = await busAPI.getBusRealTime(linename, site.longitude, site.latitude, site.siteName, 2)
            if (data?.sList?.length) {
              const vehicleList = await busAPI.getVehicleList(linename)
              data.sList.forEach(v => {
                const plate = vehicleList?.find(vl => Number(vl.vehicleid) === Number(v.vehicleid))?.vehiclelicense
                if (v.fromTime > 0) {
                  const endStop = down.startpoint
                  buses.push({
                    time: v.fromTime,
                    endpoint: endStop,
                    endpointEn: endpointEnMap.get(endStop) || endStop,
                    plate: plate || ''
                  })
                }
              })
            }
          }
        }
        
        buses.sort((a, b) => a.time - b.time)
        
        return {
          linename,
          linenameEn: lineEnMap.get(linename) || linename,
          buses: buses.slice(0, 3)
        }
      })
    )
    
    busData.value = results.filter(item => item.buses.length > 0)
  } catch (error) {
    console.error('加载数据失败:', error)
  }
}

function updateTime() {
  currentTime.value = formattedTime.value
}

function nextMedia() {
  if (mediaList.value.length > 1) {
    currentMediaIndex.value = (currentMediaIndex.value + 1) % mediaList.value.length
  }
}

onMounted(async () => {
  updateTime()
  await Promise.all([loadTips(), loadMedia()])
  await loadAllLines()
  
  timeTimer = setInterval(updateTime, 1000)
  dataTimer = setInterval(loadBusData, 30000)
  if (mediaList.value.length > 1) {
    mediaTimer = setInterval(nextMedia, 8000)
  }
})

onUnmounted(() => {
  if (timeTimer) clearInterval(timeTimer)
  if (dataTimer) clearInterval(dataTimer)
  if (mediaTimer) clearInterval(mediaTimer)
})
</script>

<template>
  <div class="dashboard-screen">
    <div class="rotate-hint">
      <div class="rotate-icon">📱</div>
      <div class="rotate-text">请横屏查看公交大屏</div>
      <div class="rotate-text-en">Please rotate your device</div>
    </div>
    
    <div class="dashboard-scroll">
      <div class="top-bar">
        <div class="left-info">
          <div class="date">{{ formattedDate }}</div>
          <div class="time">{{ formattedTime }}</div>
        </div>
        <div class="center-info">
          <div class="station-cn">本站：{{ selectedSiteName || '请选择站点' }}</div>
          <div class="station-en">This Stop: {{ selectedSite?.siteNameEn || 'Select Stop' }}</div>
        </div>
        <div class="right-actions">
          <button @click="showSiteSelector = true" class="ctrl-btn">切换站点</button>
          <button @click="$emit('back')" class="ctrl-btn">返回</button>
        </div>
      </div>
      
      <div class="main-content">
        <div class="bus-card main-bus">
          <div class="card-header">
            <div class="header-left">
              <div class="cn">本趟公交开往</div>
              <div class="en">This Bus</div>
            </div>
            <div class="header-right">
              <div class="plate">车牌：{{ currentBus?.plate || '粤HXXXXX' }}</div>
            </div>
          </div>
          <div class="card-body">
            <div class="line-info">{{ currentBus?.linename }} / {{ currentBus?.linenameEn }}</div>
            <div class="destination">
              <div class="cn">{{ currentBus?.endpoint || '--' }}</div>
              <div class="en">{{ currentBus?.endpointEn || '--' }}</div>
            </div>
            <div class="arrival-time">
              <div class="cn">{{ currentBus?.time || '--' }}分钟</div>
              <div class="en">{{ currentBus?.time || '--' }}Min</div>
            </div>
          </div>
        </div>
        
        <div class="media-section">
          <div v-if="mediaList.length > 0" class="media-container">
            <img 
              v-if="mediaList[currentMediaIndex]?.type === 'image'" 
              :src="mediaList[currentMediaIndex].url" 
              class="media-content"
            />
            <video 
              v-else-if="mediaList[currentMediaIndex]?.type === 'video'"
              :src="mediaList[currentMediaIndex].url"
              class="media-content video"
              autoplay
              loop
              muted
              playsinline
            ></video>
          </div>
          <div v-else class="media-placeholder">
            宣传图
          </div>
        </div>
        
        <div class="bus-list">
          <div class="bus-card other-bus">
            <div class="card-header">
              <div class="label">下一趟 / The Next Bus</div>
            </div>
            <div class="card-row">
              <div class="col-left">
                <div class="line-name">{{ nextBus?.linename }}</div>
                <div class="dest">开往 {{ nextBus?.endpoint || '--' }}</div>
              </div>
              <div class="col-right">
                <div class="line-name">{{ nextBus?.linenameEn }}</div>
                <div class="dest">To {{ nextBus?.endpointEn || '--' }}</div>
              </div>
              <div class="col-time">
                <div class="time">{{ nextBus?.time || '--' }}分钟</div>
                <div class="time-en">{{ nextBus?.time || '--' }}Min</div>
              </div>
            </div>
          </div>
          
          <div class="bus-card other-bus">
            <div class="card-header">
              <div class="label">第三趟 / The Third Bus</div>
            </div>
            <div class="card-row">
              <div class="col-left">
                <div class="line-name">{{ thirdBus?.linename }}</div>
                <div class="dest">开往 {{ thirdBus?.endpoint || '--' }}</div>
              </div>
              <div class="col-right">
                <div class="line-name">{{ thirdBus?.linenameEn }}</div>
                <div class="dest">To {{ thirdBus?.endpointEn || '--' }}</div>
              </div>
              <div class="col-time">
                <div class="time">{{ thirdBus?.time || '--' }}分钟</div>
                <div class="time-en">{{ thirdBus?.time || '--' }}Min</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div class="bottom-bar">
        <div class="scroll-container" :style="{ animationDuration: Math.max(10, tipsWidth / 50) + 's' }">
          <span class="scroll-text">{{ tips }}</span>
          <span class="scroll-text">{{ tips }}</span>
        </div>
      </div>
    </div>
    
    <div v-if="showSiteSelector" class="site-selector-overlay" @click.self="showSiteSelector = false">
      <div class="site-selector-modal">
        <div class="selector-header">
          <h3>选择站点</h3>
          <button @click="showSiteSelector = false" class="close-btn">×</button>
        </div>
        <input 
          v-model="siteSearchQuery" 
          type="text" 
          placeholder="搜索站点..." 
          class="site-search"
        />
        <div class="site-list">
          <div 
            v-for="site in filteredSites" 
            :key="site.id" 
            class="site-option"
            :class="{ active: selectedSiteName === site.siteName }"
            @click="selectSite(site)"
          >
            {{ site.siteName }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dashboard-screen {
  width: 100vw;
  height: 100vh;
  background: #fff;
  position: relative;
  overflow: hidden;
}

.rotate-hint {
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.rotate-icon {
  font-size: 80px;
  animation: rotate-phone 2s ease-in-out infinite;
  margin-bottom: 30px;
}

.rotate-text {
  color: white;
  font-size: 24px;
  font-weight: 600;
  margin-bottom: 10px;
}

.rotate-text-en {
  color: rgba(255,255,255,0.8);
  font-size: 18px;
}

@keyframes rotate-phone {
  0%, 100% {
    transform: rotate(0deg);
  }
  50% {
    transform: rotate(90deg);
  }
}

.dashboard-scroll {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
}

.top-bar {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 20px 30px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  position: sticky;
  top: 0;
  z-index: 100;
  flex-shrink: 0;
}

.left-info .date {
  font-size: 16px;
  opacity: 0.9;
  margin-bottom: 4px;
}

.left-info .time {
  font-size: 28px;
  font-weight: 700;
}

.center-info {
  text-align: center;
  flex: 1;
}

.center-info .station-cn {
  font-size: 24px;
  font-weight: 600;
  margin-bottom: 4px;
}

.center-info .station-en {
  font-size: 16px;
  opacity: 0.85;
}

.right-actions {
  display: flex;
  gap: 10px;
}

.ctrl-btn {
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: #fff;
  padding: 10px 20px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s;
}

.ctrl-btn:hover {
  background: rgba(255, 255, 255, 0.3);
}

.main-content {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.bus-card {
  background: white;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 2px 12px rgba(0,0,0,0.08);
}

.bus-card.main-bus {
  border: 3px solid #667eea;
}

.bus-card .card-header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 15px 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-header .header-left .cn {
  font-size: 20px;
  font-weight: 600;
}

.card-header .header-left .en {
  font-size: 13px;
  opacity: 0.85;
  margin-top: 2px;
}

.card-header .header-right .plate {
  font-size: 16px;
  font-weight: 500;
}

.card-body {
  padding: 30px 20px;
  text-align: center;
}

.card-body .line-info {
  font-size: 24px;
  color: #667eea;
  font-weight: 700;
  margin-bottom: 15px;
}

.card-body .destination .cn {
  font-size: 48px;
  color: #000;
  font-weight: 700;
  margin-bottom: 5px;
}

.card-body .destination .en {
  font-size: 22px;
  color: #666;
  margin-bottom: 15px;
}

.card-body .arrival-time .cn {
  font-size: 36px;
  color: #667eea;
  font-weight: 700;
}

.card-body .arrival-time .en {
  font-size: 18px;
  color: #999;
  margin-top: 5px;
}

.media-section {
  background: #000;
  border-radius: 12px;
  overflow: hidden;
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.media-container {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.media-content {
  max-width: 100%;
  max-height: 300px;
  object-fit: contain;
}

.media-content.video {
  width: 100%;
  height: auto;
  max-height: 300px;
  object-fit: cover;
}

.media-placeholder {
  color: #fff;
  font-size: 32px;
  font-weight: 700;
  padding: 40px;
}

.bus-list {
  display: flex;
  gap: 20px;
}

.bus-card.other-bus {
  flex: 1;
}

.bus-card.other-bus .card-header {
  background: #f5f7fa;
  color: #333;
  padding: 12px 20px;
}

.bus-card.other-bus .card-header .label {
  font-size: 16px;
  font-weight: 600;
}

.card-row {
  padding: 20px;
  display: flex;
  gap: 20px;
  align-items: center;
}

.card-row .col-left,
.card-row .col-right {
  flex: 1;
}

.card-row .col-left .line-name,
.card-row .col-right .line-name {
  font-size: 18px;
  color: #667eea;
  font-weight: 700;
  margin-bottom: 5px;
}

.card-row .col-left .dest,
.card-row .col-right .dest {
  font-size: 16px;
  color: #666;
}

.card-row .col-time {
  text-align: center;
  padding: 10px 20px;
  background: #f5f7fa;
  border-radius: 8px;
}

.card-row .col-time .time {
  font-size: 24px;
  color: #667eea;
  font-weight: 700;
}

.card-row .col-time .time-en {
  font-size: 14px;
  color: #999;
  margin-top: 2px;
}

.bottom-bar {
  background: #667eea;
  padding: 15px 0;
  margin-top: auto;
  flex-shrink: 0;
  position: sticky;
  bottom: 0;
}

.scroll-container {
  display: flex;
  white-space: nowrap;
  animation: scroll 20s linear infinite;
}

.scroll-text {
  color: rgba(255, 255, 255, 0.95);
  font-size: 18px;
  font-weight: 500;
  padding-right: 100px;
  white-space: nowrap;
}

@keyframes scroll {
  0% {
    transform: translateX(0);
  }
  100% {
    transform: translateX(-50%);
  }
}

.site-selector-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.site-selector-modal {
  background: #fff;
  border-radius: 12px;
  width: 90%;
  max-width: 500px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

.selector-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid #eee;
}

.selector-header h3 {
  margin: 0;
  font-size: 18px;
  color: #000;
}

.close-btn {
  background: none;
  border: none;
  font-size: 28px;
  color: #999;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.site-search {
  margin: 15px 20px;
  padding: 12px 16px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 15px;
}

.site-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 20px 20px;
  max-height: 400px;
}

.site-option {
  padding: 12px 16px;
  border-radius: 8px;
  cursor: pointer;
  margin-bottom: 5px;
  background: #f5f8fc;
  transition: all 0.2s;
}

.site-option:hover {
  background: #e8f4fc;
}

.site-option.active {
  background: #667eea;
  color: #fff;
}

@media (max-width: 768px) and (orientation: portrait) {
  .dashboard-scroll {
    display: none !important;
  }
  
  .rotate-hint {
    display: flex !important;
  }
}

@media (max-width: 768px) and (orientation: landscape) {
  .dashboard-scroll {
    display: flex !important;
  }
  
  .rotate-hint {
    display: none !important;
  }
  
  .top-bar {
    padding: 12px 20px;
    gap: 15px;
  }
  
  .left-info .time {
    font-size: 22px;
  }
  
  .center-info .station-cn {
    font-size: 18px;
  }
  
  .center-info .station-en {
    font-size: 13px;
  }
  
  .ctrl-btn {
    padding: 8px 14px;
    font-size: 13px;
  }
  
  .main-content {
    padding: 15px;
    gap: 15px;
  }
  
  .bus-card .card-header {
    padding: 10px 15px;
  }
  
  .card-header .header-left .cn {
    font-size: 16px;
  }
  
  .card-header .header-left .en {
    font-size: 11px;
  }
  
  .card-header .header-right .plate {
    font-size: 13px;
  }
  
  .card-body {
    padding: 20px 15px;
  }
  
  .card-body .line-info {
    font-size: 18px;
    margin-bottom: 10px;
  }
  
  .card-body .destination .cn {
    font-size: 32px;
    margin-bottom: 3px;
  }
  
  .card-body .destination .en {
    font-size: 16px;
    margin-bottom: 10px;
  }
  
  .card-body .arrival-time .cn {
    font-size: 26px;
  }
  
  .card-body .arrival-time .en {
    font-size: 14px;
  }
  
  .media-section {
    min-height: 150px;
  }
  
  .media-content {
    max-height: 200px;
  }
  
  .media-content.video {
    max-height: 200px;
  }
  
  .media-placeholder {
    font-size: 24px;
    padding: 30px;
  }
  
  .bus-list {
    gap: 15px;
  }
  
  .bus-card.other-bus .card-header {
    padding: 10px 15px;
  }
  
  .bus-card.other-bus .card-header .label {
    font-size: 14px;
  }
  
  .card-row {
    padding: 15px;
    gap: 15px;
  }
  
  .card-row .col-left .line-name,
  .card-row .col-right .line-name {
    font-size: 15px;
    margin-bottom: 3px;
  }
  
  .card-row .col-left .dest,
  .card-row .col-right .dest {
    font-size: 13px;
  }
  
  .card-row .col-time {
    padding: 8px 15px;
  }
  
  .card-row .col-time .time {
    font-size: 20px;
  }
  
  .card-row .col-time .time-en {
    font-size: 12px;
  }
  
  .bottom-bar {
    padding: 10px 0;
  }
  
  .scroll-text {
    font-size: 14px;
    padding-right: 60px;
  }
}

@media (max-width: 568px) and (orientation: landscape) {
  .top-bar {
    padding: 10px 15px;
  }
  
  .left-info .date {
    font-size: 13px;
  }
  
  .left-info .time {
    font-size: 18px;
  }
  
  .center-info .station-cn {
    font-size: 15px;
  }
  
  .center-info .station-en {
    font-size: 11px;
  }
  
  .ctrl-btn {
    padding: 6px 12px;
    font-size: 12px;
  }
  
  .main-content {
    padding: 12px;
    gap: 12px;
  }
  
  .card-header .header-left .cn {
    font-size: 14px;
  }
  
  .card-header .header-left .en {
    font-size: 10px;
  }
  
  .card-header .header-right .plate {
    font-size: 12px;
  }
  
  .card-body {
    padding: 15px 12px;
  }
  
  .card-body .line-info {
    font-size: 15px;
    margin-bottom: 8px;
  }
  
  .card-body .destination .cn {
    font-size: 26px;
  }
  
  .card-body .destination .en {
    font-size: 14px;
  }
  
  .card-body .arrival-time .cn {
    font-size: 22px;
  }
  
  .card-body .arrival-time .en {
    font-size: 12px;
  }
  
  .media-section {
    min-height: 120px;
  }
  
  .media-content {
    max-height: 160px;
  }
  
  .media-content.video {
    max-height: 160px;
  }
  
  .media-placeholder {
    font-size: 20px;
    padding: 25px;
  }
  
  .bus-list {
    gap: 12px;
  }
  
  .card-row {
    padding: 12px;
    gap: 12px;
  }
  
  .card-row .col-left .line-name,
  .card-row .col-right .line-name {
    font-size: 13px;
  }
  
  .card-row .col-left .dest,
  .card-row .col-right .dest {
    font-size: 12px;
  }
  
  .card-row .col-time {
    padding: 6px 12px;
  }
  
  .card-row .col-time .time {
    font-size: 16px;
  }
  
  .card-row .col-time .time-en {
    font-size: 11px;
  }
  
  .bottom-bar {
    padding: 8px 0;
  }
  
  .scroll-text {
    font-size: 12px;
    padding-right: 50px;
  }
}
</style>
