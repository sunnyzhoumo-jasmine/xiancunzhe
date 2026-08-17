import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');
const PORT = Number(process.env.PORT || 4000);
const API_KEY = process.env.OPENAI_API_KEY || '';
const BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
const MODEL = process.env.OPENAI_MODEL || 'deepseek-chat';
const JINA = 'https://r.jina.ai/';
const MAX_CHARS = 8000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function json(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readJson(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; if (data.length > 3_000_000) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

// ---------- 网页正文抓取 ----------

function extractText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

function extractUrl(input) {
  const m = String(input || '').match(/https?:\/\/[^\s，。；、（）()【】\[\]'"<>]+/i);
  if (!m) return '';
  return m[0].replace(/[，。；、）】"'>]+$/g, '');
}

function extractMeta(html) {
  const htmlStr = String(html || '');
  const pick = (re) => { const m = htmlStr.match(re); return m ? m[1].trim() : ''; };
  const og = (key) => pick(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']*)["']`, 'i'))
    || pick(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${key}["']`, 'i'));
  let title = og('og:title') || og('twitter:title') || pick(/<title[^>]*>([^<]+)<\/title>/i);
  let desc = og('og:description') || og('twitter:description') || pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
  if (!desc) {
    const ld = htmlStr.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
    if (ld) {
      try {
        const arr = Array.isArray(JSON.parse(ld[1])) ? JSON.parse(ld[1]) : [JSON.parse(ld[1])];
        for (const item of arr) {
          if (!desc && item.description) desc = item.description;
          if (!title && item.headline) title = item.headline;
        }
      } catch {}
    }
  }
  const init = htmlStr.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?})<\/script>/i);
  if (init) {
    try {
      const state = JSON.parse(init[1]);
      const note = state.note?.noteDetailMap && Object.values(state.note.noteDetailMap)[0]?.note;
      if (note) {
        if (note.title) title = note.title;
        if (note.desc) desc = note.desc;
      }
    } catch {}
  }
  title = (title || '').trim().slice(0, 120);
  desc = (desc || '').trim().slice(0, 2000);
  return { title, desc, text: [title, desc].filter(Boolean).join('\n') };
}

async function resolveUrl(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
    const final = res.url || '';
    if (/^https?:\/\//i.test(final) && final !== url) return final;
    const html = await res.clone().text().catch(() => '');
    const mr = html.match(/http-equiv=["']?refresh["']?[^>]*content=["']?\d+;\s*url=([^"' >]+)/i);
    if (mr && /^https?:\/\//i.test(mr[1])) return mr[1];
  } catch {}
  return url;
}

async function fetchContent(url) {
  const finalUrl = await resolveUrl(url);
  // 1) Jina Reader：返回清洗后的 markdown 正文
  try {
    const res = await fetch(JINA + finalUrl, {
      headers: { 'user-agent': UA, 'x-respond-with': 'markdown' },
      signal: AbortSignal.timeout(25000),
    });
    if (res.ok) {
      const text = await res.text();
      if (text && text.trim().length > 50) return { source: 'jina', url: finalUrl, title: '', text: text.trim() };
    }
  } catch {}
  // 2) 直接抓取 + 本地清洗
  try {
    const res = await fetch(finalUrl, {
      redirect: 'follow',
      headers: { 'user-agent': UA, 'accept': 'text/html,application/xhtml+xml', 'accept-language': 'zh-CN,zh;q=0.9' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const text = extractText(html);
    const meta = extractMeta(html);
    const isXhs = /xiaohongshu\.com/i.test(finalUrl);
    if (meta && meta.title && (isXhs || text.length < 50)) {
      return { source: 'meta', url: finalUrl, title: meta.title, text: meta.text || text };
    }
    if (text.length > 30) return { source: 'direct', url: finalUrl, title: meta?.title || '', text };
  } catch {}
  return null;
}

// ---------- 本地规则分析（无 API Key 时降级，保证演示可用） ----------

function splitSentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[。！？!?；;])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8 && s.length <= 160);
}

function topSentences(text, n, keywords = []) {
  const sentences = splitSentences(text);
  const score = (s, i) => {
    let sc = i < 3 ? 3 - i : 0;
    if (/\d/.test(s)) sc += 1;
    sc += Math.min(keywords.filter((w) => s.includes(w)).length, 3);
    if (s.length > 12 && s.length < 90) sc += 1;
    return sc;
  };
  const ranked = sentences.map((s, i) => ({ s, sc: score(s, i) })).sort((a, b) => b.sc - a.sc);
  const picked = ranked.slice(0, n).map((x) => x.s);
  return sentences.filter((s) => picked.includes(s)).slice(0, n);
}

const RISK_BAD = ['风险', '处罚', '亏损', '下降', '下滑', '诉讼', '违规', '被罚', '监管', '立案', '退市', '质押', '冻结', '坏账', '逾期', '警示', '调查', '减持', '债务', '违约'];
const RISK_GOOD = ['增长', '盈利', '签约', '中标', '获批', '上涨', '突破', '落地', '合作', '创新高', '扭亏', '回购', '分红'];
const STRUCT_KEYS = {
  purpose: ['为了', '旨在', '目的是', '解决', '针对', '面向'],
  audience: ['用户', '人群', '适合', '面向', '目标用户', '客户', '读者'],
  solution: ['方案', '通过', '采用', '提供', '实现', '构建', '平台', '系统'],
  pros: ['优势', '好处', '提升', '效率', '节省', '加速', '改善'],
  cons: ['不足', '局限', '风险', '成本', '短板', '劣势', '问题'],
  limits: ['限制', '要求', '合规', '政策', '依赖', '约束', '注意', '前提'],
};

function findByKeywords(text, keywords, limit = 3) {
  const hits = splitSentences(text).filter((s) => keywords.some((w) => s.includes(w)));
  return hits.slice(0, limit).map((s) => (s.length > 80 ? s.slice(0, 80) + '…' : s));
}

function analyzeRules(content, mode, titleHint = '') {
  const title = titleHint || content.split('\n')[0].trim().slice(0, 40) || content.slice(0, 40);
  const result = { title, summary: '', keyPoints: [], dataPoints: [], risks: [], structure: {} };
  const sentences = splitSentences(content);

  // 通用能力：3 句摘要 + 关键信息 + 数据点
  result.summary = sentences.slice(0, 3).join('') || content.slice(0, 80);
  const kw = ['数据', '增长', '发布', '报告', '同比', '占比', '市场', '用户', '营收', '利润'];
  result.keyPoints = topSentences(content, 5, kw);
  result.dataPoints = sentences
    .filter((s) => /\d/.test(s))
    .slice(0, 5)
    .map((s) => {
      const nums = s.match(/\d+(?:\.\d+)?%?/g) || [];
      return { text: s.length > 70 ? s.slice(0, 70) + '…' : s, value: nums.slice(0, 3).join(' / ') };
    });

  if (mode === 'risk') {
    const good = new Set(findByKeywords(content, RISK_GOOD, 4));
    const bad = new Set(findByKeywords(content, RISK_BAD, 5));
    const neutral = new Set(sentences.slice(0, 6).filter((s) => !good.has(s) && !bad.has(s)));
    result.risks = [
      ...[...bad].map((text) => ({ text, level: '隐患' })),
      ...[...good].map((text) => ({ text, level: '利好' })),
      ...[...neutral].map((text) => ({ text, level: '中性' })),
    ].slice(0, 8);
  }

  if (mode === 'structure') {
    result.structure = {
      purpose: findByKeywords(content, STRUCT_KEYS.purpose, 2).join('；') || '文中无明确表述',
      audience: findByKeywords(content, STRUCT_KEYS.audience, 2).join('；') || '文中无明确表述',
      solution: findByKeywords(content, STRUCT_KEYS.solution, 3).join('；') || '文中无明确表述',
      pros: findByKeywords(content, STRUCT_KEYS.pros, 2),
      cons: findByKeywords(content, STRUCT_KEYS.cons, 2),
      limits: findByKeywords(content, STRUCT_KEYS.limits, 2),
    };
  }
  return result;
}

// ---------- LLM 分析（OpenAI 兼容接口，如 DeepSeek） ----------

async function llmAnalyze(content, mode, title) {
  const MODE_PROMPT = {
    summary: '你是网页内容分析师。基于给定网页正文，输出 JSON：{"title":"标题","summary":"3句话极简核心摘要","keyPoints":["5条关键信息"],"dataPoints":[{"text":"含数据原文片段","value":"提取的数据"}]}。所有结论必须来自正文，不得编造；正文没有的信息不要写。',
    risk: '你是金融风控分析师。基于给定网页资讯/公告正文，输出 JSON：{"title":"标题","summary":"3句话摘要","keyPoints":["关键信息"],"dataPoints":[{"text":"原文片段","value":"数据"}],"risks":[{"text":"原文片段","level":"利好/隐患/中性"}]}。识别企业、经营、投融资、司法、监管处罚相关信息，负面风险点标记为"隐患"。只依据正文，不得编造。',
    structure: '你是文章结构分析师。基于给定正文，输出 JSON：{"title":"标题","summary":"3句话摘要","keyPoints":["关键信息"],"structure":{"purpose":"写作目的","audience":"目标人群","solution":"核心解决方案","pros":["优点"],"cons":["缺点"],"limits":["落地约束"]}}。只依据正文，不得编造。',
  };
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: MODE_PROMPT[mode] },
        { role: 'user', content: `网页标题：${title || '未知'}\n\n网页正文：\n${content.slice(0, 4000)}` },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
  const data = await res.json();
  const out = JSON.parse(data.choices?.[0]?.message?.content || 'null');
  if (!out) return null;
  return {
    title: String(out.title || title || '').slice(0, 80),
    summary: String(out.summary || '').slice(0, 500),
    keyPoints: Array.isArray(out.keyPoints) ? out.keyPoints.map(String).slice(0, 6) : [],
    dataPoints: Array.isArray(out.dataPoints) ? out.dataPoints.slice(0, 6) : [],
    risks: Array.isArray(out.risks) ? out.risks.map((r) => ({ text: String(r.text || ''), level: ['利好', '隐患', '中性'].includes(r.level) ? r.level : '中性' })).slice(0, 8) : [],
    structure: out.structure && typeof out.structure === 'object' ? out.structure : {},
  };
}

// ---------- API ----------

async function handleAnalyze(req, res) {
  const body = await readJson(req);
  let url = String(body.url || '').trim();
  const text = String(body.text || '').trim();
  const mode = ['summary', 'risk', 'structure'].includes(body.mode) ? body.mode : 'summary';

  let titleHint = String(body.title || '').trim();
  if (url && !/^https?:\/\//i.test(url)) {
    const extracted = extractUrl(url);
    if (extracted) {
      const idx = url.indexOf(extracted);
      const before = idx > 0 ? url.slice(0, idx) : '';
      titleHint = titleHint || before.replace(/[\s|:：，。;；\-—_]+$/g, '').slice(0, 60);
      url = extracted;
    }
  }
  if (!url && !text) return json(res, 400, { error: '请输入网页链接，或粘贴文本内容' });

  let content = text;
  let source = 'manual';
  let finalUrl = '';
  if (!content) {
    const norm = /^https?:\/\//i.test(url) ? url : 'https://' + url;
    const fetched = await fetchContent(norm);
    if (!fetched) {
      return json(res, 502, { error: '网页抓取失败：链接无法访问、需要登录或网站反爬（小红书等平台常需登录）。你可以改为「粘贴文本」方式分析。' });
    }
    content = fetched.text;
    source = fetched.source;
    finalUrl = fetched.url || norm;
    if (!titleHint) titleHint = fetched.title || '';
  }

  if (source === 'meta' && content.length < 300) {
    return json(res, 200, {
      source, mode, url: finalUrl, title: titleHint,
      wordCount: content.length, truncated: false, ai: false, partial: true, content,
      result: null,
      reason: '该平台需要登录，只公开了标题和简介，无法抓取正文（视频内容需要登录后才能拿到字幕或口播文字）。请打开笔记复制正文，粘贴到下方文本框再分析。',
    });
  }

  const truncated = content.length > MAX_CHARS;
  const used = truncated ? content.slice(0, MAX_CHARS) : content;
  let result = null;
  let ai = false;
  if (API_KEY) {
    try { result = await llmAnalyze(used, mode, titleHint); if (result) ai = true; } catch {}
  }
  if (!result) result = analyzeRules(used, mode, titleHint);

  return json(res, 200, { source, mode, url: finalUrl || url, title: result.title || titleHint, wordCount: used.length, truncated, ai, content: used, result });
}

// ---------- 静态服务 ----------

async function serveStatic(res, pathname) {
  let rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  let filePath = normalize(join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, 'index.html');
    const body = await readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}

export async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  try {
    if (pathname === '/api/analyze' && req.method === 'POST') return handleAnalyze(req, res);
    if (pathname === '/api/health') return json(res, 200, { ok: true, ai: Boolean(API_KEY) });
    await serveStatic(res, pathname);
  } catch (err) {
    console.error('[server]', err);
    try { json(res, 500, { error: '服务器内部错误' }); } catch {}
  }
}

export { analyzeRules, handleAnalyze, MAX_CHARS, extractUrl, extractMeta };

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const server = createServer(handleRequest);
  let attempts = 12;
  const tryListen = () => {
    server.listen(PORT, () => {
      console.log('\n  网页 URL 智能解析助手 已启动');
      console.log(`  本机访问：http://localhost:${PORT}`);
      console.log(`  AI 模式：${API_KEY ? '已接入 ' + MODEL : '未配置 API Key，使用本地规则分析（演示模式）'}\n`);
    });
  };
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempts > 0) { attempts--; console.log(`端口 ${PORT} 被占用，稍后重试…`); setTimeout(tryListen, 700); }
    else { console.error('启动失败：', err.message); process.exit(1); }
  });
  tryListen();
}
