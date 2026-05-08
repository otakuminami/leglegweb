# LegLeg 腿长测量 — 项目总结

## 项目概述

用户拍照/上传含人物的照片，AI 通过寻找图中参照物估算人物腿长（髋关节到脚踝），返回 cm 数值和推理过程。

## 架构

```
用户拍照/选图 → 前端压缩图片 → base64 上传 → 后端 → OpenRouter → Qwen/GPT-4o Vision
                                                               ↓
用户看到结果 ← 前端展示结果卡片 ← JSON 响应 ← 后端解析
```

- **前端**：微信小程序（单页应用，pages/index）
- **后端**：Node.js + Express，`POST /api/analyze`
- **AI**：OpenRouter → `qwen/qwen3.6-plus`（中文视觉模型）

## 项目结构

```
legleg/
├── app.js              # 小程序入口，globalData.serverUrl
├── app.json            # 页面路由 + 窗口配置
├── app.wxss            # 全局样式
├── project.config.json # 微信开发者工具配置
├── pages/index/
│   ├── index.wxml      # 页面模板
│   ├── index.js        # 页面逻辑
│   ├── index.wxss      # 页面样式
│   └── index.json      # 页面配置
└── server/
    ├── package.json    # express
    └── index.js        # 后端 API（代理 OpenRouter）
```

## 前端状态机

页面有 5 种视觉状态，互斥切换：

| 状态 | 条件 | 展示内容 |
|------|------|----------|
| **空状态** | `!imagePath && !loading && !error && !result` | 虚线占位框 + 拍照/相册按钮 |
| **图片已选** | `imagePath && !loading && !result` | 图片预览 + 「开始分析」按钮 |
| **加载中** | `loading` | 旋转动画 + "AI 正在分析中..." |
| **错误** | `error` | 红色错误卡片 + 重试按钮 |
| **结果** | `result && !loading` | 腿长数字 + 参照物 + 推理过程 + 重新测量按钮 |

## 图片处理流程

1. **选择**：`wx.chooseMedia` 支持 camera/album 两种 sourceType
2. **压缩**：`wx.compressImage({ quality: 60, compressedWidth: 1024 })` — 将 3-10MB 照片压到约 50-100KB
3. **转 base64**：`wx.getFileSystemManager().readFileSync(path, 'base64')`
4. **上传**：`wx.request({ timeout: 120000 })` — 2 分钟超时
5. **失败容错**：如果压缩失败，用原图兜底

## 后端 API

**`POST /api/analyze`**

请求：
```json
{ "imageBase64": "..." }
```

响应成功：
```json
{
  "success": true,
  "data": {
    "hasPerson": true,
    "legLengthCm": 93.0,
    "referenceObject": "过膝长靴约65-70cm",
    "reasoning": "基于参照物和人体比例的推理过程...",
    "confidence": "medium"
  }
}
```

响应失败：
```json
{ "success": false, "error": "错误描述" }
```

## AI 调用细节

### OpenRouter 配置
```js
model: 'qwen/qwen3.6-plus'  // 中文好、视觉强、便宜
hostname: 'openrouter.ai'
path: '/api/v1/chat/completions'
headers:
  Authorization: Bearer sk-or-v1-...
  HTTP-Referer: https://legleg.weixin.com
  X-Title: LegLeg
```

### Prompt 设计要点
- **角色设定**：专业人体测量分析师
- **分步指令**：确认人物 → 找参照物 → 估算身高 → 测量腿长 → 输出结果
- **参照物字典**：门≈200cm、A4纸≈29.7cm、地砖≈60cm、台阶≈15cm、易拉罐≈12cm
- **严格 JSON 输出**：要求只返回 JSON，不要其他文字
- **温度为 0.1**：减少随机性，提高测量一致性

### 返回解析
AI 返回的 JSON 可能被 markdown 代码块包裹（\`\`\`json ... \`\`\`），需先清理再 parse：
```js
const jsonMatch = content.match(/\{[\s\S]*\}/)
const cleanJson = jsonMatch[0]
  .replace(/```json\s*/g, '')
  .replace(/```\s*/g, '')
JSON.parse(cleanJson)
```

## 经验教训

### AI 选型过程
| 尝试 | 问题 |
|------|------|
| DeepSeek Chat | **不支持图片输入**（纯文本模型） |
| OpenAI GPT-4o / Claude / Gemini | OpenRouter 上被**地区限制**（中国账单地址不可用） |
| **Qwen3.6-Plus** ✅ | 可用，中文好，视觉强，约 $0.0003/token |

> 如果从头做网页版，直接用 Qwen 或 Moonshot Kimi 等国产视觉模型，避免踩区域限制的坑。

### 超时问题
- 微信小程序默认请求超时较短，大图 base64 传输 + AI 推理可能需要 30-60 秒
- 解决：压缩图片至 1024px 宽 + `timeout: 120000` (2 分钟)
- 网页版建议：服务端也做图片压缩（Sharp 库），或者改为上传文件而非 base64

### JSON 解析
- AI 经常把 JSON 包在 ` ```json ``` ` 里，不要假定它返回纯 JSON
- 用正则 `/{[\s\S]*}/` 提取后再清理 markdown 标记

### 腾讯云 人体分析（未采用但可考虑）
- 每月 1000 次免费调用
- 接口：人体检测、人体关键点识别
- 优点：精准关键点坐标，不止 AI 视觉估算
- 缺点：需要自己根据关键点计算腿长比例，无法做"参照物推理"
- 网页版可以考虑 AI + 关键点检测的混合方案

## 网页版复刻要点

### 可复用的部分
- **Prompt**：完整复用，已验证有效
- **AI 调用逻辑**：OpenRouter 的请求格式、JSON 解析逻辑直接搬
- **UI 状态机**：空状态 → 图片已选 → 加载中 → 错误 → 结果，5 状态结构不变
- **色彩和间距**：`#007aff`、`#f5f7fa`、24rpx 圆角等设计 token

### 需要改的部分
| 小程序 | 网页版 |
|--------|--------|
| `wx.chooseMedia` | `<input type="file" accept="image/*" capture>` |
| `wx.compressImage` | Canvas API 或服务端 Sharp 压缩 |
| `wx.getFileSystemManager().readFileSync` | `FileReader.readAsDataURL()` |
| `wx.request` | `fetch()` |
| `wx:if` `wx:else` 条件渲染 | React `{condition && ...}` / Vue `v-if` |
| rpx 单位 | px/rem/vw |
| scroll-view | `overflow-y: auto` |

### 推荐技术栈
- **框架**：React + Vite 或 Vue + Vite（小项目，任选）
- **后端**：同一套 Express 服务器，几乎不用改
- **样式**：Tailwind CSS 快速复刻 rpx→px 的视觉
- **部署**：前端 Vercel，后端 Railway/Render（都支持免费额度）

### 最小可行实现步骤
1. 复制 `server/` 到新项目，保持不变
2. 建一个 HTML 页面（或 React 组件），实现 5 状态 UI
3. 用 `fetch('http://localhost:3000/api/analyze')` 替代 `wx.request`
4. 图片用 `FileReader` 读成 base64，canvas 压缩到 1024px
5. 搞定，共计不到 200 行代码
