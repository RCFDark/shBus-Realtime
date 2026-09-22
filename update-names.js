import { pinyin } from 'pinyin-pro'
import fs from 'fs'

function toPinyinName(chinese) {
  const py = pinyin(chinese, { toneType: 'none', type: 'array' })
  const name = py.join('')
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()
}

const data = JSON.parse(fs.readFileSync('line_and_stops.json', 'utf-8'))

data.lines = data.lines.map(line => ({
  linename: line.linename,
  linenameEn: line.linenameEn,
  up: {
    startpoint: line.up.startpoint,
    startpointEn: toPinyinName(line.up.startpoint),
    endpoint: line.up.endpoint,
    endpointEn: toPinyinName(line.up.endpoint)
  },
  down: {
    startpoint: line.down.startpoint,
    startpointEn: toPinyinName(line.down.startpoint),
    endpoint: line.down.endpoint,
    endpointEn: toPinyinName(line.down.endpoint)
  }
}))

data.sites = data.sites.map(site => ({
  siteName: site.siteName,
  siteNameEn: toPinyinName(site.siteName),
  longitude: site.longitude,
  latitude: site.latitude
}))

fs.writeFileSync('line_and_stops.json', JSON.stringify(data, null, 2), 'utf-8')

console.log(`完成！共 ${data.lines.length} 条线路，${data.sites.length} 个站点`)
