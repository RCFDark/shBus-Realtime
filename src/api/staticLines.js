// 线路、票价、首末班时间、站点这些基础数据基本不会变，直接从本地快照读，
// 不再每次开页面都去请求 /gj/line/findList（原来详情页、大屏、运行车辆面板各拉一次，最耗时的一次 400ms+）
//
// 数据来源：src/data/lines-static.json
//   抓自 `api-snapshot.bat` 生成的 api访问/<时间戳>/01-line-findList-up.json 与 02-line-findList-down.json
//   上行 / 下行分开存的 —— 下行站点不是上行的简单反转（5号线、9号线、13号线等都对不上），所以必须各自留一份
//
// 以后万一线路真有调整：重新跑一次 api-snapshot.bat 抓取，再重新生成这个 JSON 即可。
import raw from '../data/lines-static.json'

const clone = typeof structuredClone === 'function'
  ? structuredClone
  : obj => JSON.parse(JSON.stringify(obj))

// 每次返回深拷贝，避免调用方改了对象污染到其它视图用的同一份数据
export function staticLineList(direction = 1, _type = 1) {
  const source = Number(direction) === 2 ? raw.down : raw.up
  return clone(source)
}

export const staticLinesMeta = {
  generatedAt: raw.generatedAt,
  generatedFrom: raw.generatedFrom,
  lineCount: raw.up?.length || 0
}
