# 部署指南

本项目是纯前端（Vue 3 + Vite），部署到 GitHub Pages。

但有一个绕不开的问题：**接口需要 `ticket-token` 凭证**。GitHub Pages 是纯静态托管，没有服务端，
如果直接把 token 写进前端代码，它会以明文形式出现在公开仓库和浏览器 Network 面板里，任何人都能拿走。

所以推荐架构是：

```
浏览器(GitHub Pages)  ──►  你的 Cloudflare Worker  ──►  oa.sfc0758.com/sihui
                             （持有 token）
```

---

## 一、部署 Cloudflare Worker（只需做一次）

1. 安装并登录 wrangler：

```bash
npm i -D wrangler
npx wrangler login
```

2. 部署：

```bash
npm run worker:deploy      # 等价于 npx wrangler deploy
```

部署完会得到一个地址，形如 `https://shbus-api.<你的子域>.workers.dev`。

3. 写入 token（加密存储，不进代码库）：

```bash
npx wrangler secret put TICKET_TOKEN
# 粘贴当前有效的 ticket-token 回车
```

4. 建议设置 `ADMIN_KEY`（在 `wrangler.toml` 的 `[vars]` 里改，然后重新 deploy）。
   否则 `/admin` 页面任何人都能打开，可能被拿去刷短信验证码。

5. 可选但推荐：绑定 KV，这样以后刷新 token 可以自动生效，不用重新部署。

```bash
npx wrangler kv:namespace create TOKEN_KV
# 把返回的 id 填进 wrangler.toml 里 [[kv_namespaces]] 的 id，取消注释后重新 deploy
```

验证：`curl -X POST https://<你的worker>/api/gj/line/findList -H "Content-Type: application/json" -d '{"direction":1,"type":1}'`
能返回线路列表即正常。

### Worker 路由

| 路径 | 作用 |
| --- | --- |
| `/api/*` | 业务代理，自动注入 token，转发到官方接口 |
| `/admin` | 网页版「刷新 token」向导（需 `?key=ADMIN_KEY`，若已设置） |
| `/_captcha` `/_sendsms` `/_login` | `/admin` 内部使用的接口 |

---

## ⚠️ 重要：国内网络不要用 workers.dev（2026-09-22 实测）

对 `https://shbus-api.rcfdark.workers.dev` 的实测结果：

| 路径 | 结果 |
| --- | --- |
| `*.workers.dev` 直连 | 3 次全部超时（>10s 后失败） |
| `*.workers.dev` 走代理 | 首次 3.8s，之后 0.85s |
| 官方接口直连 | **0.24 ~ 0.44s** |

结论：`workers.dev` 在国内网络基本不可达，浏览器直连必然卡到超时，
页面表现就是「半天加载不出来 → 无法加载线路」。而官方接口本身会回显 Origin、允许跨域，
浏览器直连只要 0.3 秒 —— **这一步其实可以整个跳过，Worker 不是必需的。**

`src/api/config.js` 里已加两道保险，所以旧的 `API_BASE` 变量不清掉也不会再坑你：

1. 生产环境若 `VITE_API_BASE` 指向 `*.workers.dev`，**自动忽略并回退直连官方接口**；
2. 未配置仓库 Secret `TICKET_TOKEN` 时用内置兜底 token（控制台会告警），避免整站 601。

若仍想用自有代理：把 Worker 绑到**自己的域名**（不要用 workers.dev），
再把变量 `API_BASE` 改成该域名即可。

---

## 二、把 Worker 地址告诉前端构建

在 GitHub 仓库 → **Settings → Secrets and variables → Actions → Variables** 里新建变量：

```
名称：API_BASE
值  ：https://shbus-api.<你的子域>.workers.dev/api
```

`.github/workflows/deploy.yml` 已经会在构建时把它作为 `VITE_API_BASE` 注入。
设置好后 push 到 `master` 触发一次构建即可（也可在 Actions 页面手动 Run workflow）。

本地要验证生产构建：

```bash
VITE_API_BASE=https://shbus-api.<你的子域>.workers.dev/api npm run build
npm run preview
```

---

## 三、Token 续期

### 为什么不能全自动

逆向「通利行」App 后确认的登录链路：

```
1. POST /sihui/base/user/kaptcha   header ticket-token:""  → 响应头返回「验证码会话 token」+ 验证码图片
2. POST /sihui/app/user/sendSMS    {token, phone, type:"4", kaptchaCode}  → 手机收到短信验证码
3. POST /sihui/app/user/login      {loginName, password, code}            → datas.token / datas.id
```

登录强制要求**图形验证码 + 手机短信验证码**，两步都要人工参与，所以：
**给账号密码也做不到无人值守的自动续期**（除非额外接一个能收短信的通道）。

好消息是 token 有效期很长（实测数月），且**不校验 userId**，拿到一个有效 token 就够。

### 本地开发续期

```bash
npm run token          # 即 node refresh-token.mjs
```

按提示输入手机号、密码、图形验证码（脚本会自动保存并打开 `captcha.jpg`）、短信验证码，
成功后写入 `.env.development.local`（已被 gitignore，**不会进公开仓库**），dev server 自动加载。

文件名里带 `.development.` 是故意的：Vite 只在 dev 模式加载它，
`npm run build` 不会读取，因此 token 不会被打进公开的前端产物。

### 线上续期（推荐，手机上也能操作）

浏览器打开：

```
https://<你的worker>/admin?key=<你的ADMIN_KEY>
```

在同一个页面里：看验证码 → 输手机号密码 → 收短信 → 登录。

- 绑定了 KV：token 自动写入，**线上立即生效**，不用重新部署
- 没绑 KV：页面会显示新 token，手动执行 `npx wrangler secret put TICKET_TOKEN` 更新后再 deploy

---

## 四、注意事项

- **不要再用 corsproxy.io**：早期版本走公共 CORS 代理，token 会经过第三方服务器，已改用自有 Worker。
- **代码里不存凭证**：`src/api/config.js` 和 `worker.js` 都不含 token，一律从环境变量读取
  （本地 `.env.local`，线上 Worker Secret）。提交前可用 `git grep -E '[0-9a-f]{8}-[0-9a-f]{4}-'` 自查。
- 生产构建设置了 `VITE_API_BASE` 后，前端不再带 token，由 Worker 注入。
- `apis_and_token.txt`、`fetch-lines.cjs`、`line_and_stops.json`、`上传/` 已在 `.gitignore` 中，不会推到公开仓库。
- 自定义域名：在 `public/CNAME` 写域名，并在域名服务商处解析到 GitHub Pages。
- 构建产物需 `.nojekyll`，否则 GitHub Pages 会忽略 `_` 开头的目录。
