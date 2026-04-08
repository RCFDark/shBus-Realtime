export const mockData = {
  lines: [
    {
      linename: '1号线',
      linenameEn: 'Line 1',
      buses: [
        { time: 3, endpoint: '下㘵', endpointEn: 'Xiabu', plate: '粤H12345' },
        { time: 12, endpoint: '下㘵', endpointEn: 'Xiabu', plate: '粤H23456' },
        { time: 25, endpoint: '下㘵', endpointEn: 'Xiabu', plate: '粤H34567' }
      ]
    },
    {
      linename: '2号线',
      linenameEn: 'Line 2',
      buses: [
        { time: 5, endpoint: '营脚', endpointEn: 'Yingjiao Long English Station Name Test', plate: '粤H45678' },
        { time: 18, endpoint: '营脚', endpointEn: 'Yingjiao', plate: '粤H56789' },
        { time: 32, endpoint: '营脚', endpointEn: 'Yingjiao', plate: '粤H67890' }
      ]
    },
    {
      linename: '19号线',
      linenameEn: 'Line 19',
      buses: [
        { time: 8, endpoint: '四会轻轨站', endpointEn: 'Sihui Railway Station Test Long Name', plate: '粤H11111' },
        { time: 20, endpoint: '四会轻轨站', endpointEn: 'Sihui Railway Station', plate: '粤H22222' },
        { time: 35, endpoint: '四会轻轨站', endpointEn: 'Sihui Railway Station', plate: '粤H33333' }
      ]
    }
  ],
  
  sites: [
    { id: 1, siteName: '龙城', siteNameEn: 'Longcheng', longitude: 112.123456, latitude: 23.456789 },
    { id: 2, siteName: '火车站', siteNameEn: 'Railway Station', longitude: 112.234567, latitude: 23.567890 },
    { id: 3, siteName: '汽车总站', siteNameEn: 'Bus Terminal', longitude: 112.345678, latitude: 23.678901 }
  ]
}

export function useMockData() {
  return mockData
}
