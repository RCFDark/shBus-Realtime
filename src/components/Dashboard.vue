<script setup>
import { ref, onMounted, onUnmounted, computed, nextTick, watch } from 'vue'
import { busAPI } from '../api/bus.js'
import { mockData } from '../api/mock.js'
import translations from '../../line_and_stops.json'

// 拼音库体积较大（~280KB），不进主包：等首屏渲染完再后台预取，
// 取到之前搜索降级为「中文包含匹配」，取到后自动切换成拼音/首字母搜索。
let matchSiteFn = null
let pinyinOfFn = null
const pinyinReady = ref(false)

// 线路名里的数字，用于「按号线排序」（水口线这类没有数字的排最后）
function lineNumber(linename) {
  const m = String(linename || '').match(/\d+/)
  return m ? parseInt(m[0], 10) : 9999
}

function compareLineName(a, b) {
  const na = lineNumber(a)
  const nb = lineNumber(b)
  if (na !== nb) return na - nb
  return String(a).localeCompare(String(b), 'zh-CN')
}

// 平铺的站点列表也按「号线 → 站序」排（用于默认选中等场景）
function compareByLine(a, b) {
  const la = (a.lineNames || [])[0] || ''
  const lb = (b.lineNames || [])[0] || ''
  const c = compareLineName(la, lb)
  if (c !== 0) return c
  return (a.lines?.get(la) ?? 9999) - (b.lines?.get(lb) ?? 9999)
}

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
// 站点选择器的列表：按线路分组，[{ linename, linenameEn, endpoint, sites: [...] }]
const siteGroups = ref([])
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

const nextBusDestRef = ref(null)
const thirdBusDestRef = ref(null)
const nextBusScrollDistance = ref(0)
const thirdBusScrollDistance = ref(0)

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

// 命中相关度：完全相同 > 以输入开头 > 中间包含。
// 用它排序，保证搜「lc」时「龙城」排在「白沙岭村(bslc)」前面
function relevance(site, q) {
  const name = site.siteName || ''
  if (name === q) return 4
  if (name.startsWith(q)) return 3
  if (pinyinOfFn) {
    const { full, first } = pinyinOfFn(name)
    if (full === q || first === q) return 3
    if (full.startsWith(q) || first.startsWith(q)) return 2
  }
  return 1
}

// 支持中文、全拼（longcheng / long）、首字母（lc）三种搜法。
// 结果仍按线路分组返回，组内按相关度排序；没搜索时直接返回全部分组。
const filteredSiteGroups = computed(() => {
  const query = siteSearchQuery.value.trim()
  if (!query) return siteGroups.value

  const q = query.toLowerCase()
  const usePinyin = pinyinReady.value && matchSiteFn
  const groups = []

  for (const group of siteGroups.value) {
    let hits = group.sites.filter(site => site.siteName.includes(query))
    if (usePinyin) {
      hits = group.sites
        .filter(site => matchSiteFn(site.siteName, query))
        .sort((a, b) => relevance(b, q) - relevance(a, q))
    }
    if (hits.length > 0) {
      groups.push({ ...group, sites: hits })
    }
  }
  return groups
})

const hasSiteResult = computed(() =>
  filteredSiteGroups.value.some(group => group.sites.length > 0)
)

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
    siteGroups.value = [{
      linename: '全部站点',
      linenameEn: 'All Stops',
      endpoint: '',
      sites: mockData.sites
    }]
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
    
    line.siteList?.forEach((site, idx) => {
      if (!siteMap.has(site.siteName)) {
        siteMap.set(site.siteName, { ...site, lines: new Map() })
      }
      const entry = siteMap.get(site.siteName)
      // 同一条线路的上下行都会经过这个站，记下最靠前的站序，排序时用
      const prev = entry.lines.get(line.linename)
      if (prev === undefined || idx < prev) entry.lines.set(line.linename, idx)
    })
  })
  
  allLines.value = Array.from(lineMap.entries()).map(([linename, data]) => ({
    linename,
    linenameEn: lineEnMap.get(linename) || linename,
    ...data
  }))
  
  allSites.value = Array.from(siteMap.values()).map(site => ({
    ...site,
    siteNameEn: siteEnMap.get(site.siteName) || site.siteName,
    lineNames: Array.from(site.lines.keys()).sort(compareLineName)
  })).sort((a, b) => compareByLine(a, b))

  // 按「1号线 → 2号线 → …」的顺序分组，组内就是该线路上行的站序。
  // 同一个站在它所属的每条线路下都会出现一次（龙城这种枢纽站会重复），
  // 这样乘客从线路出发找站时不会漏。
  const siteLines = new Map()
  Array.from(siteMap.entries()).forEach(([name, site]) => {
    siteLines.set(name, Array.from(site.lines.keys()).sort(compareLineName))
  })

  const lineOrder = Array.from(lineMap.keys()).sort(compareLineName)
  siteGroups.value = lineOrder.map(linename => {
    const data = lineMap.get(linename)
    // 优先用上行站序展示，没有上行就退回下行
    const source = data.up?.siteList?.length ? data.up : (data.down || {})
    const seen = new Set()
    const sites = []
    ;(source.siteList || []).forEach(site => {
      if (seen.has(site.siteName)) return
      seen.add(site.siteName)
      sites.push({
        ...site,
        siteNameEn: siteEnMap.get(site.siteName) || site.siteName,
        lineNames: siteLines.get(site.siteName) || [linename]
      })
    })
    // 副标题用列表真实的首末站：部分线路（如 1B 线）官方 startpoint/endpoint
    // 与 siteList 的顺序是对不上的，照抄会误导乘客
    const endpoint = sites.length > 1
      ? `${sites[0].siteName} ⇋ ${sites[sites.length - 1].siteName}`
      : (sites[0]?.siteName || '')
    return {
      linename,
      linenameEn: lineEnMap.get(linename) || linename,
      endpoint,
      sites
    }
  }).filter(group => group.sites.length > 0)
  
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
    updateMarqueeDistance()
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
    updateMarqueeDistance()
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

function shouldMarquee(text) {
  if (!text) return false
  return (text.length + 3) > 20
}

function calculateScrollDistance(el, text) {
  if (!el || !text) {
    console.log('calculateScrollDistance: el or text is null')
    return 0
  }
  const container = el
  const scrollEl = el.querySelector('.dest-scroll')
  if (!scrollEl) {
    console.log('calculateScrollDistance: scrollEl not found')
    return 0
  }
  
  const textWidth = scrollEl.scrollWidth
  const containerWidth = container.clientWidth
  
  console.log(`calculateScrollDistance: textWidth=${textWidth}, containerWidth=${containerWidth}, distance=${textWidth - containerWidth}`)
  
  if (textWidth <= containerWidth) return 0
  return textWidth - containerWidth
}

function updateMarqueeDistance() {
  nextTick(() => {
    console.log('updateMarqueeDistance called')
    console.log('nextBus:', nextBus.value?.endpointEn, 'shouldMarquee:', shouldMarquee(nextBus.value?.endpointEn))
    console.log('thirdBus:', thirdBus.value?.endpointEn, 'shouldMarquee:', shouldMarquee(thirdBus.value?.endpointEn))
    console.log('nextBusDestRef:', nextBusDestRef.value)
    console.log('thirdBusDestRef:', thirdBusDestRef.value)
    
    if (nextBusDestRef.value && shouldMarquee(nextBus.value?.endpointEn)) {
      nextBusScrollDistance.value = calculateScrollDistance(nextBusDestRef.value, nextBus.value?.endpointEn)
      console.log('nextBusScrollDistance:', nextBusScrollDistance.value)
    }
    if (thirdBusDestRef.value && shouldMarquee(thirdBus.value?.endpointEn)) {
      thirdBusScrollDistance.value = calculateScrollDistance(thirdBusDestRef.value, thirdBus.value?.endpointEn)
      console.log('thirdBusScrollDistance:', thirdBusScrollDistance.value)
    }
  })
}

watch([nextBus, thirdBus], () => {
  updateMarqueeDistance()
})

onMounted(async () => {
  updateTime()
  await Promise.all([loadTips(), loadMedia()])
  await loadAllLines()
  
  setTimeout(() => {
    updateMarqueeDistance()
  }, 500)
  
  timeTimer = setInterval(updateTime, 1000)
  dataTimer = setInterval(loadBusData, 30000)
  if (mediaList.value.length > 1) {
    mediaTimer = setInterval(nextMedia, 8000)
  }

  // 后台预取拼音库，不阻塞大屏首屏
  import('../utils/pinyin.js')
    .then(mod => {
      matchSiteFn = mod.matchSite
      pinyinOfFn = mod.pinyinOf
      pinyinReady.value = true
    })
    .catch(err => console.error('拼音库加载失败，站点搜索将只支持中文:', err))
})

onUnmounted(() => {
  if (timeTimer) clearInterval(timeTimer)
  if (dataTimer) clearInterval(dataTimer)
  if (mediaTimer) clearInterval(mediaTimer)
})
</script>

<template>
  <div class="dashboard-screen">
    <div class="dashboard-body">
      <div class="left-panel">
        <div class="bus-module main-bus">
          <div class="bus-header">
            <div class="cn">本趟公交开往</div>
            <div class="en">This Bus</div>
          </div>
          <template v-if="currentBus">
            <div class="bus-line">{{ currentBus?.linename }} / {{ currentBus?.linenameEn }}</div>
            <div class="bus-destination">
              <div class="cn">{{ currentBus?.endpoint }}</div>
              <div class="en">{{ currentBus?.endpointEn }}</div>
            </div>
            <div class="bus-time">
              <div class="cn">{{ currentBus?.time }}分钟</div>
              <div class="en">{{ currentBus?.time }}Min</div>
            </div>
          </template>
        </div>
        
        <div class="bus-module next-bus">
          <div class="bus-row">
            <div class="left">
              <div class="label">下一趟</div>
              <template v-if="nextBus">
                <div class="line-name">{{ nextBus?.linename }}</div>
                <div class="dest">开往 {{ nextBus?.endpoint }}</div>
                <div class="time">{{ nextBus?.time }}分钟</div>
              </template>
            </div>
            <div class="right">
              <div class="label">The Next Bus</div>
              <template v-if="nextBus">
                <div class="line-name">{{ nextBus?.linenameEn }}</div>
                <div 
                  ref="nextBusDestRef"
                  class="dest dest-en" 
                  :class="{ marquee: shouldMarquee(nextBus?.endpointEn) }"
                  :style="{ '--scroll-distance': nextBusScrollDistance + 'px' }"
                ><span class="dest-scroll">To {{ nextBus?.endpointEn }}</span></div>
                <div class="time">{{ nextBus?.time }}Min</div>
              </template>
            </div>
          </div>
        </div>
        
        <div class="bus-module third-bus">
          <div class="bus-row">
            <div class="left">
              <div class="label">第三趟</div>
              <template v-if="thirdBus">
                <div class="line-name">{{ thirdBus?.linename }}</div>
                <div class="dest">开往 {{ thirdBus?.endpoint }}</div>
                <div class="time">{{ thirdBus?.time }}分钟</div>
              </template>
            </div>
            <div class="right">
              <div class="label">The Third Bus</div>
              <template v-if="thirdBus">
                <div class="line-name">{{ thirdBus?.linenameEn }}</div>
                <div 
                  ref="thirdBusDestRef"
                  class="dest dest-en" 
                  :class="{ marquee: shouldMarquee(thirdBus?.endpointEn) }"
                  :style="{ '--scroll-distance': thirdBusScrollDistance + 'px' }"
                ><span class="dest-scroll">To {{ thirdBus?.endpointEn }}</span></div>
                <div class="time">{{ thirdBus?.time }}Min</div>
              </template>
            </div>
          </div>
        </div>
        
        <div class="footer-info">
          <div class="left">
            <div class="date">{{ formattedDate }}</div>
            <div class="time">{{ formattedTime }}</div>
          </div>
          <div class="right">
            <div class="cn">本站：{{ selectedSiteName || '请选择站点' }}</div>
            <div class="en">This Stop: {{ selectedSite?.siteNameEn || 'Select Stop' }}</div>
          </div>
        </div>
      </div>
      
      <div class="right-panel">
        <div class="right-top-bar">
          <div class="plate-info">本趟：{{ currentBus?.plate || '粤HXXXXX' }}</div>
          <button @click="showSiteSelector = true" class="ctrl-btn">切换站点</button>
          <button @click="$emit('back')" class="ctrl-btn">返回</button>
        </div>
        <div class="right-content">
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
        <div class="bottom-bar">
          <div class="scroll-container" :style="{ animationDuration: Math.max(10, tipsWidth / 50) + 's' }">
            <span class="scroll-text">{{ tips }}</span>
            <span class="scroll-text">{{ tips }}</span>
          </div>
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
          placeholder="搜索站点：龙城 / longcheng / lc" 
          class="site-search"
        />
        <div class="site-list">
          <div v-for="group in filteredSiteGroups" :key="group.linename" class="site-group">
            <div class="site-group-title">
              <span class="group-line">{{ group.linename }}</span>
              <span class="group-route">{{ group.endpoint }}</span>
            </div>
            <div 
              v-for="site in group.sites" 
              :key="group.linename + '-' + site.siteName" 
              class="site-option"
              :class="{ active: selectedSiteName === site.siteName }"
              @click="selectSite(site)"
            >
              <span class="site-opt-name">{{ site.siteName }}</span>
              <span class="site-opt-en">{{ site.siteNameEn }}</span>
            </div>
          </div>
          <div v-if="!hasSiteResult" class="site-empty">没有匹配的站点</div>
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
  display: flex;
  flex-direction: column;
  border: 8px solid #4A89DC;
  box-sizing: border-box;
  position: relative;
}

.dashboard-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.left-panel {
  width: 40%;
  background: #fff;
  display: flex;
  flex-direction: column;
  border-right: 4px solid #4A89DC;
  overflow: hidden;
}

.bus-module {
  background: #fff;
  padding: 20px;
  border-bottom: 2px solid #eee;
}

.bus-module.main-bus {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: center;
  min-height: 280px;
  padding: 15px 20px;
  flex: 2;
}

.bus-module.next-bus,
.bus-module.third-bus {
  padding: 15px 20px;
  flex: 1;
}

.bus-header {
  text-align: center;
  margin-bottom: 2px;
  margin-top: -10px;
}

.bus-header .cn {
  font-size: 32px;
  color: #000;
  font-weight: 500;
}

.bus-header .en {
  font-size: 20px;
  color: #000;
  margin-top: -7px;
}

.bus-line {
  font-size: 28px;
  color: #4A89DC;
  font-weight: 700;
  margin-bottom: 2px;
}

.bus-destination {
  text-align: center;
  margin-bottom: 4px;
}

.bus-destination .cn {
  font-size: 52px;
  color: #000;
  font-weight: 700;
}

.bus-destination .en {
  font-size: 24px;
  color: #000;
  margin-top: -7px;
}

.bus-time {
  text-align: center;
}

.bus-time .cn {
  font-size: 42px;
  color: #000;
  font-weight: 600;
}

.bus-time .en {
  font-size: 24px;
  color: #000;
  margin-top: -7px;
}

.bus-module.next-bus,
.bus-module.third-bus {
  padding: 15px 20px;
}

.bus-row {
  display: flex;
  justify-content: space-between;
}

.bus-row .left,
.bus-row .right {
  flex: 1;
  min-width: 0;
}

.bus-row .right {
  text-align: right;
  overflow: hidden;
}

.bus-row .label {
  font-size: 16px;
  color: #000;
  margin-bottom: 6px;
}

.bus-row .line-name {
  font-size: 18px;
  color: #4A89DC;
  font-weight: 700;
  margin-bottom: 6px;
}

.bus-row .dest {
  font-size: 22px;
  color: #000;
  font-weight: 700;
  margin-bottom: 6px;
}

.bus-row .dest-en {
  overflow: hidden;
  white-space: nowrap;
  position: relative;
}

.bus-row .dest-scroll {
  display: inline-block;
}

.bus-row .dest-en.marquee .dest-scroll {
  animation: dest-marquee 20s ease-in-out infinite;
}

@keyframes dest-marquee {
  0%, 15% { transform: translateX(0); }
  30%, 70% { transform: translateX(calc(-1 * var(--scroll-distance))); }
  85%, 100% { transform: translateX(0); }
}

.bus-row .time {
  font-size: 20px;
  color: #000;
  font-weight: 600;
}

.footer-info {
  background: #fff;
  padding: 15px 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-top: 2px solid #eee;
}

.footer-info .left .date {
  font-size: 16px;
  color: #000;
}

.footer-info .left .time {
  font-size: 22px;
  color: #000;
  font-weight: 600;
  margin-top: 4px;
}

.footer-info .right {
  text-align: right;
}

.footer-info .right .cn {
  font-size: 24px;
  color: #000;
  font-weight: 700;
}

.footer-info .right .en {
  font-size: 16px;
  color: #000;
  margin-top: 4px;
}

.right-panel {
  width: 60%;
  background: #000;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.right-top-bar {
  height: 70px;
  background: #1a3a6e;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 20px;
  flex-shrink: 0;
}

.plate-info {
  color: #fff;
  font-size: 28px;
  font-weight: 600;
  margin-right: auto;
}

.right-content {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  min-height: 0;
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
  max-height: 100%;
  object-fit: contain;
}

.media-content.video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.media-placeholder {
  color: #fff;
  font-size: 48px;
  font-weight: 700;
}

.bottom-bar {
  height: 50px;
  background: #4A89DC;
  display: flex;
  align-items: center;
  overflow: hidden;
  flex-shrink: 0;
}

.scroll-container {
  display: flex;
  white-space: nowrap;
  animation: scroll 20s linear infinite;
}

.scroll-text {
  color: rgba(255, 255, 255, 0.95);
  font-size: 26px;
  font-weight: 500;
  padding-right: 150px;
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

.ctrl-btn {
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: #fff;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.ctrl-btn:hover {
  background: rgba(255, 255, 255, 0.3);
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
  border-radius: 8px;
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
  padding: 15px 20px;
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
  font-size: 24px;
  color: #999;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.site-search {
  margin: 15px 20px;
  padding: 10px 15px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
}

.site-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 20px 20px;
  max-height: 400px;
}

.site-option {
  padding: 12px 15px;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 5px;
  background: #f5f8fc;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.site-group {
  margin-bottom: 14px;
}

.site-group-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 2px 8px;
  position: sticky;
  top: 0;
  background: #fff;
  z-index: 1;
  border-bottom: 1px solid #e6ecf5;
}

.group-line {
  flex-shrink: 0;
  font-size: 15px;
  font-weight: 700;
  color: #2c5fa8;
}

.group-route {
  font-size: 12px;
  color: #9aa5b5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 同一条线内部的站点缩进，视觉上归到线路标题下面 */
.site-group .site-option {
  margin-bottom: 4px;
  margin-left: 10px;
}

/* 站点的英文/拼音名 */
.site-opt-en {
  flex-shrink: 0;
  font-size: 12px;
  color: #8a94a6;
}

.site-option.active .site-opt-en {
  color: rgba(255, 255, 255, 0.85);
}

.site-empty {
  padding: 20px;
  text-align: center;
  color: #999;
  font-size: 14px;
}

.site-option:hover {
  background: #e8f4fc;
}

.site-option.active {
  background: #4A89DC;
  color: #fff;
}

@media (max-width: 768px) {
  .dashboard-screen {
    border-width: 3px;
    overflow-y: auto;
    overflow-x: hidden;
  }
  
  .dashboard-body {
    flex-direction: column;
    overflow: visible;
    min-height: auto;
  }
  
  .left-panel {
    width: 100%;
    border-right: none;
    border-bottom: 3px solid #4A89DC;
    overflow: visible;
  }
  
  .bus-module.main-bus {
    min-height: auto;
    padding: 20px 15px;
    flex: none;
  }
  
  .bus-module.next-bus,
  .bus-module.third-bus {
    padding: 15px;
    flex: none;
    min-height: 90px;
  }
  
  .bus-header .cn {
    font-size: 20px;
  }
  
  .bus-header .en {
    font-size: 13px;
    margin-top: 0px;
  }
  
  .bus-line {
    font-size: 18px;
  }
  
  .bus-destination .cn {
    font-size: 32px;
  }
  
  .bus-destination .en {
    font-size: 16px;
    margin-top: 0px;
  }
  
  .bus-time .cn {
    font-size: 26px;
  }
  
  .bus-time .en {
    font-size: 16px;
    margin-top: 0px;
  }
  
  .bus-row .label {
    font-size: 13px;
    margin-bottom: 4px;
  }
  
  .bus-row .line-name {
    font-size: 15px;
    margin-bottom: 4px;
  }
  
  .bus-row .dest {
    font-size: 16px;
    margin-bottom: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .bus-row .time {
    font-size: 15px;
  }
  
  .footer-info {
    padding: 12px 15px;
  }
  
  .footer-info .left .date {
    font-size: 13px;
  }
  
  .footer-info .left .time {
    font-size: 17px;
    margin-top: 2px;
  }
  
  .footer-info .right .cn {
    font-size: 18px;
  }
  
  .footer-info .right .en {
    font-size: 13px;
    margin-top: 2px;
  }
  
  .right-panel {
    width: 100%;
    min-height: 300px;
  }
  
  .right-top-bar {
    height: 50px;
    padding: 0 15px;
  }
  
  .plate-info {
    font-size: 18px;
  }
  
  .ctrl-btn {
    padding: 6px 12px;
    font-size: 12px;
  }
  
  .media-placeholder {
    font-size: 32px;
  }
  
  .bottom-bar {
    height: 40px;
  }
  
  .scroll-text {
    font-size: 18px;
    padding-right: 80px;
  }
}

@media (max-width: 480px) {
  .bus-header .cn {
    font-size: 18px;
  }
  
  .bus-header .en {
    font-size: 12px;
  }
  
  .bus-line {
    font-size: 16px;
  }
  
  .bus-destination .cn {
    font-size: 28px;
  }
  
  .bus-destination .en {
    font-size: 14px;
  }
  
  .bus-time .cn {
    font-size: 22px;
  }
  
  .bus-time .en {
    font-size: 14px;
  }
  
  .bus-module.next-bus,
  .bus-module.third-bus {
    min-height: 80px;
  }
  
  .bus-row {
    flex-direction: row;
    gap: 8px;
  }
  
  .bus-row .left,
  .bus-row .right {
    text-align: left;
    flex: 1;
    min-width: 0;
  }
  
  .bus-row .right {
    text-align: right;
  }
  
  .bus-row .dest {
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .footer-info {
    flex-direction: column;
    gap: 10px;
    text-align: center;
  }
  
  .footer-info .left,
  .footer-info .right {
    text-align: center;
  }
  
  .plate-info {
    font-size: 16px;
  }
  
  .ctrl-btn {
    padding: 5px 10px;
    font-size: 11px;
  }
  
  .media-placeholder {
    font-size: 24px;
  }
  
  .scroll-text {
    font-size: 15px;
    padding-right: 60px;
  }
}
</style>
