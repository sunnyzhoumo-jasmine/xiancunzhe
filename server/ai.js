// AI 增强：可选。未配置 OPENAI_API_KEY 时所有函数返回 null，业务层自动降级。
const API_KEY = process.env.OPENAI_API_KEY || '';
const BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

export function aiEnabled() {
  return Boolean(API_KEY);
}

async function chat(system, user, { json = false } = {}) {
  if (!API_KEY) return null;
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.2,
  };
  if (json) body.response_format = { type: 'json_object' };
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`AI API ${res.status}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI 空响应');
  return content;
}

function parseJson(text) {
  try { return JSON.parse(text); } catch {}
  const m = String(text).match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

// 结构化为 JSON：标题、类型、标签、面向知识卡片的核心总结、要点
export async function enrichContent({ title, text, platform, url }) {
  const system = '你是知识卡片整理助手。根据提供的内容提取结构化信息，只依据来源中存在的文字，禁止编造。summary 必须服务于后续知识卡片回顾：用一段 80-120 字总结这条内容最值得记住的核心知识点、判断或方法，去掉背景铺垫、例子和重复表述，不能照抄原文，不要写“本文介绍了”。以 JSON 返回：{"title":"标题","type":"内容类型（知识、教程/工具、软件/商品、消费/地点、旅行/美食、菜谱/书影音/灵感、创意/新闻、行业/待办内容/未分类）","tags":["标签1","标签2"],"summary":"面向知识卡片的核心知识点总结","keyPoints":["可用于出题的核心知识点1","可用于出题的核心知识点2"]}';
  const user = JSON.stringify({ title, text: (text || '').slice(0, 4000), platform, url });
  const out = parseJson(await chat(system, user, { json: true }));
  if (!out) return null;
  return {
    title: String(out.title || title || '').slice(0, 200),
    type: String(out.type || '未分类'),
    tags: Array.isArray(out.tags) ? out.tags.map(String).slice(0, 8) : [],
    summary: String(out.summary || '').slice(0, 300),
    keyPoints: Array.isArray(out.keyPoints) ? out.keyPoints.map(String).slice(0, 8) : [],
  };
}

// 自然语言搜索：只允许基于提供的收藏回答
export async function answerSearch(question, hits) {
  const docs = hits.map((h, i) => `[${i + 1}] ${h.title}\n${h.summary || h.parsed_text || ''}`.slice(0, 500)).join('\n\n');
  const system = '你是收藏夹检索助手。只能根据用户提供的收藏内容回答，引用编号来源；找不到答案时明确说未找到，不得编造。回答控制在150字内。';
  const user = `用户问题：${question}\n\n可用收藏：\n${docs || '（无）'}`;
  return (await chat(system, user))?.trim() || null;
}

// 知识卡片生成：返回 1-3 张带问题的候选卡片
export async function generateCardsAI({ title, summary, text }) {
  const system = '你是知识卡片生成器。基于给定内容生成 1 到 3 张候选回顾卡，只使用来源中的信息，禁止编造。每张卡都必须有一个可以主动回忆的问题和对应答案，不能生成只有要点列表的卡片。以 JSON 返回：{"cards":[{"kind":"问答/概念/填空","question":"清晰、具体、可独立回答的问题","answer":"简洁准确的答案","points":["答案中的补充要点"],"sourceSnippet":"来源片段"}]}。';
  const user = JSON.stringify({ title, summary, text: (text || '').slice(0, 3000) });
  const out = parseJson(await chat(system, user, { json: true }));
  if (!out || !Array.isArray(out.cards)) return [];
  return out.cards
    .map((c) => ({
      kind: ['问答', '概念', '填空'].includes(c.kind) ? c.kind : '问答',
      question: String(c.question || `${title}的核心知识点是什么？`).slice(0, 200),
      answer: String(c.answer || '').slice(0, 500),
      points: Array.isArray(c.points) ? c.points.map(String).slice(0, 8) : [],
      sourceSnippet: String(c.sourceSnippet || '').slice(0, 300),
    }))
    .filter((c) => c.question || c.answer || c.points.length)
    .slice(0, 3);
}
