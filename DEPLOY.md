# 部署到 GitHub Pages 指南

## 方法一：直接部署 dist 目录

1. 构建项目：
```bash
npm run build
```

2. 在项目根目录创建 `.nojekyll` 文件（阻止 GitHub Pages 使用 Jekyll）

3. 将 `dist` 目录的所有内容推送到你的 GitHub 仓库

4. 在 GitHub 仓库设置中：
   - 进入 Settings > Pages
   - Source 选择分支和根目录
   - 保存

## 方法二：使用 gh-pages 分支

1. 安装 gh-pages：
```bash
npm install --save-dev gh-pages
```

2. 在 package.json 中添加部署脚本：
```json
{
  "scripts": {
    "deploy": "npm run build && gh-pages -d dist"
  }
}
```

3. 运行部署：
```bash
npm run deploy
```

## 自定义域名（可选）

如果你想使用自定义域名：
1. 在 `public` 目录创建 `CNAME` 文件
2. 文件内容为你的域名（如：bus.yourdomain.com）
3. 在域名服务商处配置 DNS 指向 GitHub Pages

## 注意事项

- API token 可能会过期，需要定期更新
- 建议使用环境变量存储敏感信息
- 跨域问题：API 可能需要在服务器端代理
