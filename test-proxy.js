async function testProxy() {
  try {
    const response = await fetch('/api/gj/vehicle/findBusReal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ticket-token': 'a1c115f0-3d26-49e0-9b70-e05b85181eab',
        'userId': 'ec359ef577b846be91a41d7ca17f9353'
      },
      body: JSON.stringify({
        linename: '1号线',
        bizType: '1',
        longitude: 112.687592,
        latitude: 23.343782,
        sitename: '龙城'
      })
    })
    
    const data = await response.json()
    console.log('Proxy test result:')
    console.log('sList:', data.datas?.sList)
    console.log('nList:', data.datas?.nList)
  } catch (e) {
    console.error('Proxy test error:', e)
  }
}

testProxy()
