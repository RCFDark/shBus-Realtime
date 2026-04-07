# 四会公交实时查询

一个基于 Vue 3 + Vite 的四会市公交实时查询 Web 应用，可部署到 GitHub Pages。

## 功能特性

- 查看所有公交线路列表
- 查看实时公交位置
- 查看即将发车的班次信息
- 查看最近站点信息

## 技术栈

- Vue 3 (Composition API)
- Vite
- 原生 JavaScript Fetch API

## 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 预览生产构建
npm run preview
```

## 部署到 GitHub Pages

1. 构建项目：
```bash
npm run build
```

2. 将 `dist` 目录的内容推送到 GitHub 仓库的 `gh-pages` 分支或主分支

3. 在 GitHub 仓库设置中启用 GitHub Pages，选择分支和目录

## API 说明

应用使用四会公交官方 API：

- `/gj/vehicle/findList` - 获取所有车辆列表
- `/gj/line/findList` - 获取线路详情
- `/gj/vehicle/findBusReal` - 获取实时公交信息

## License

MIT
