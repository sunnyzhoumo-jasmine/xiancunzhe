# 网页 URL 智能解析助手（独立演示版）

用于验证「输入链接/文本 → AI 分析」单点能力，验证通过后再整合进「先存着」。

## 启动

```sh
cd /Users/zhoumo/Documents/vibecoding/card/url-analyzer
./run.sh
```

浏览器打开：http://localhost:4000

## 可选：接入大模型（DeepSeek 等 OpenAI 兼容接口）

不配置也能用（走本地规则分析，演示可用），配置后质量更好：

```sh
cd /Users/zhoumo/Documents/vibecoding/card/url-analyzer
OPENAI_API_KEY=sk-你的key OPENAI_BASE_URL=https://api.deepseek.com OPENAI_MODEL=deepseek-chat ./run.sh
```

## 使用

1. 顶部输入框粘贴网页链接（如 https://xhslink.cn/xxx 或任意文章页）。**小红书等平台的完整分享文本（标题+短链接+提示语）也可以整段粘贴**，工具会自动识别出链接、把标题作为参考。
2. 选择分析模式：通用摘要 / 金融风险分析 / 结构化拆解。
3. 点「开始分析」，左侧展示抓到的正文预览，右侧展示分析结果卡片。
4. 可复制文本、导出 Markdown、保存到浏览器本地历史。

## 技术说明

- 抓正文：先解析短链接跳转（xhslink 等），再优先 Jina Reader（r.jina.ai），失败降级为本地直接抓取 + 正则清洗；小红书等需登录的页面会尝试提取页面标题/简介（meta 元数据）；仍失败返回友好提示并建议粘贴文本。
- 分析：配置 API Key 时调用大模型；未配置时用本地关键词规则（金融风险利好/隐患/中性分类、结构化拆解字段）。
- 防呆：正文超 8000 字自动截断；无输入返回提示；所有结论标注「以原文为准」。

## 自测

```sh
cd /Users/zhoumo/Documents/vibecoding/card/url-analyzer
node scripts/selfcheck.js
```

（如 `node` 不在 PATH，用 `/Users/zhoumo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/selfcheck.js`）

## 目录

- `server.js`：Node 后端（无依赖，端口 4000）
- `public/`：前端页面
- `scripts/selfcheck.js`：无网络自测（18 项断言）
- `run.sh`：启动脚本
