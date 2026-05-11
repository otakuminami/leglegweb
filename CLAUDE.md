# 腿腿 Leggy — AI 腿长测量网页版

## 项目概要

用户上传照片 → AI 分析参照物 → 估算腿长（髋到脚踝，cm）→ 结果页 + 保存卡片图片。

## 技术架构

```
前端: React + Vite → dist/ 静态文件
后端(国内): Express (server/index.js) → Bailian API (qwen3-vl-flash) + OSS 归档
后端(国际): Vercel Serverless (api/analyze.js) → 同 Bailian API
```

- **AI 模型**: `qwen3-vl-flash`（百炼视觉模型，不支持 text-only 模型）
- **API 端点**: `dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`
- **图片压缩**: 前端 Canvas 压缩到 1024px 宽，quality 0.6，输出 JPEG base64
- **流式响应**: SSE (Server-Sent Events)，Nginx 需 `proxy_buffering off`
- **卡片生成**: html2canvas + iframe（1080px 宽隔离 viewport，避免移动端渲染错位）

## 双环境部署

### 国内服务器（主用）
| 项目 | 值 |
|------|-----|
| IP | 139.224.163.62 |
| 类型 | 阿里云轻量应用服务器 2核/512MB Ubuntu 22.04 |
| SSH | `ssh admin@139.224.163.62` 或 `ssh root@139.224.163.62` |
| 前端 | Nginx 直接 serve `/var/www/leglegweb/dist/` |
| 后端 | Express + PM2，端口 3000，Nginx proxy `/api/analyze` → `127.0.0.1:3000` |
| 目录 | `/var/www/leglegweb/` |
| PM2 | `pm2 status` / `pm2 logs leglegweb` / `pm2 restart leglegweb` |
| OSS | Bucket: `leglegweb`, Region: `oss-cn-shanghai`, 私有 |

### Vercel（国际备用）
- 项目: `leglegweb`
- 域名: `leglegweb.vercel.app`
- Serverless function: `api/analyze.js`

### 域名
- `uatom.info` — 已购买，**ICP 备案中**，备案下来后配 DNS A 记录指向 139.224.163.62

## 环境变量（服务器 `/var/www/leglegweb/server/.env`）

```
BAILIAN_API_KEY=<见服务器 /var/www/leglegweb/server/.env>
OSS_REGION=oss-cn-shanghai
OSS_ACCESS_KEY_ID=<见服务器 .env>
OSS_ACCESS_KEY_SECRET=<见服务器 .env>
OSS_BUCKET=leglegweb
```

## 关键文件

| 文件 | 用途 |
|------|------|
| `src/App.jsx` | 主组件：5 状态切换 + 图片压缩 + API 调用 + 卡片生成 |
| `src/index.css` | Apple 设计系统，所有 UI 样式 |
| `src/locales.js` | 中/英文全部文案 |
| `server/index.js` | 国内 API 后端（Express + 原生 https 调百炼 + OSS） |
| `api/analyze.js` | Vercel serverless 版 API |
| `deploy/nginx.conf` | 国内服务器 Nginx 配置 |
| `deploy/ecosystem.config.cjs` | PM2 配置（`.cjs` 因为根 package.json `"type": "module"`） |
| `legleg.md` | 微信小程序版原始项目总结 |

## 开发工作流

```bash
npm run dev          # 本地开发（Vite HMR，proxy /api → localhost:3000）
npm run build        # 构建前端到 dist/
node server/index.js # 启动本地后端（需 server/.env）
```

## 部署流程（国内服务器）

```bash
# 1. 本地 build + 提交 dist
npm run build
git add . && git commit -m "..." && git push

# 2. 服务器拉取（需先解决权限问题）
cd /var/www/leglegweb
sudo git pull                          # 如果 Permission denied，先 sudo git stash && sudo git pull
sudo env PATH="$PATH" pm2 restart leglegweb  # 仅 server 变更时需要
```

## 踩坑记录

1. **服务器 npm install 卡死**: 512MB 内存不够，开 1GB swap 缓解，或预构建 dist 提交 git 免装依赖
2. **百炼文本模型不支持视觉**: `qwen3.6-flash` 是 text-only，必须用 `qwen3-vl-flash`
3. **PM2 配置文件命名**: 根 package.json 有 `"type": "module"`，PM2 配置必须 `.cjs` 后缀
4. **OSS 上传 403**: Content-Type 必须签入 StringToSign；OSS 直接用原生 `https` 调 REST API，不用 `ali-oss` npm 包（服务器安装不动）
5. **网页终端 heredoc 卡死**: 阿里云网页终端对多行 heredoc 支持差，用单行 `echo '...' | sudo tee -a` 替代
6. **git pull Permission denied**: 需 `sudo git config --global --add safe.directory /var/www/leglegweb`，用 `sudo git pull`
7. **重启后 PM2 丢失**: 需配 `pm2 startup systemd` + `pm2 save`
8. **GitHub push 被拒**: 偶发 GitHub Internal Server Error，等一会重试即可

## 下次恢复工作

1. 打开本文件回顾上下文
2. 检查 ICP 备案状态（uatom.info）
3. 服务器仍可访问 139.224.163.62，SSH 不稳就多用网页终端
4. 查看 OSS 控制台确认图片归档正常: https://oss.console.aliyun.com/bucket/oss-cn-shanghai/leglegweb
5. 查看 GitHub 最新提交: https://github.com/otakuminami/leglegweb
