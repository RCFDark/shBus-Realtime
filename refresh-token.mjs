#!/usr/bin/env node
/**
 * 通利行 / 四会公交 —— 半自动获取 ticket-token
 *
 * 用法：
 *   node refresh-token.mjs              # 交互式输入手机号 / 密码
 *   node refresh-token.mjs 138xxxxxxxx 密码
 *
 * 流程（逆向自 通利行 App v150）：
 *   1. POST base/user/kaptcha   header: ticket-token=""  -> 响应头返回一个「验证码会话 token」+ 验证码图片
 *   2. POST app/user/sendSMS    {token, phone, type:"4", kaptchaCode}  -> 手机收到短信验证码
 *   3. POST app/user/login      {loginName, password, code}            -> datas.token / datas.id
 *
 * 说明：登录必须要有「图形验证码 + 手机短信验证码」，两者都要人工输入，
 *       所以无法做到无人值守的完全自动登录；本脚本把能自动的部分全部自动化。
 */

import fs from 'node:fs'
import readline from 'node:readline'
import { execSync } from 'node:child_process'

const BASE = 'https://oa.sfc0758.com/sihui/'
// 注意：文件名必须是 .env.development.local —— Vite 只在 dev 模式加载它，
// 生产构建不会读取，避免把 token 打进公开的前端产物。
const ENV_FILE = '.env.development.local'
const CAPTCHA_FILE = 'captcha.jpg'

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const ask = (q) => new Promise((res) => rl.question(q, res))

async function postJSON(path, headers = {}, body = {}) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  })
  return { token: res.headers.get('ticket-token'), data: await res.json().catch(() => null) }
}

async function fetchCaptcha() {
  const res = await fetch(BASE + 'base/user/kaptcha', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'ticket-token': '', userId: '' },
    body: '{}'
  })
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(CAPTCHA_FILE, buf)
  return res.headers.get('ticket-token')
}

/**
 * 把新凭证写进 .env.local（gitignore 忽略，不会进公开仓库）。
 * 若已存在则只替换对应两行，保留其他自定义配置。
 */
function patchEnv(token, userId) {
  try {
    let s = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : ''
    if (s.includes('VITE_TICKET_TOKEN=')) {
      s = s.replace(/^VITE_TICKET_TOKEN=.*$/m, `VITE_TICKET_TOKEN=${token}`)
    } else {
      s += (s && !s.endsWith('\n') ? '\n' : '') + `VITE_TICKET_TOKEN=${token}\n`
    }
    if (s.includes('VITE_USER_ID=')) {
      s = s.replace(/^VITE_USER_ID=.*$/m, `VITE_USER_ID=${userId}`)
    } else {
      s += `VITE_USER_ID=${userId}\n`
    }
    fs.writeFileSync(ENV_FILE, s)
    return true
  } catch (e) {
    console.warn(`写入 ${ENV_FILE} 失败：`, e.message)
    return false
  }
}

;(async () => {
  let phone = process.argv[2]
  let pwd = process.argv[3]
  if (!phone) phone = await ask('手机号（登录账号）：')
  if (!pwd) pwd = await ask('密码：')

  console.log('\n[1/4] 拉取图形验证码…')
  let kToken = await fetchCaptcha()
  console.log(`      已保存验证码图片：${CAPTCHA_FILE}`)
  try {
    execSync(`start "" "${CAPTCHA_FILE}"`, { stdio: 'ignore' })   // Windows：自动打开图片
  } catch { /* 忽略 */ }

  const kaptchaCode = await ask('请输入图形验证码（图片上的字符）：')

  console.log('\n[2/4] 请求短信验证码…')
  const sms = await postJSON('app/user/sendSMS', { 'ticket-token': kToken, userId: '' },
    { token: kToken, phone, type: '4', kaptchaCode })
  console.log('      ', sms.data?.msg || sms.data)
  if (sms.data?.status && sms.data.status !== 200) {
    console.log('      短信发送失败，图形验证码可能输错了，重跑一次即可。')
    rl.close(); process.exit(1)
  }
  if (sms.token) kToken = sms.token

  const smsCode = await ask('请输入手机收到的短信验证码：')

  console.log('\n[3/4] 登录…')
  const login = await postJSON('app/user/login', { 'ticket-token': kToken },
    { loginName: phone, password: pwd, code: smsCode })

  if (login.data?.status !== 200) {
    console.log('      登录失败：', login.data?.msg || login.data)
    rl.close(); process.exit(1)
  }

  const token = login.data.datas.token
  const userId = login.data.datas.id
  console.log('\n[4/4] 成功！')
  console.log('  ticket-token :', token)
  console.log('  userId       :', userId)
  console.log('  有效期       : 实测可用数月，失效时重跑本脚本即可')

  const ok = patchEnv(token, userId)
  console.log(ok ? `\n已自动写入 ${ENV_FILE}（该文件已被 gitignore，不会进代码库）`
                 : `\n请手动把上面两个值写进 ${ENV_FILE}`)
  console.log('dev server 会自动加载，若未生效重启一次即可。')

  console.log('\n若已部署 Cloudflare Worker，还需执行（二选一）：')
  console.log(`  wrangler secret put TICKET_TOKEN   # 粘贴 ${token}`)
  console.log('  或在 Cloudflare 控制台 → Workers → 设置 → 变量，修改 TICKET_TOKEN')

  rl.close()
})()
