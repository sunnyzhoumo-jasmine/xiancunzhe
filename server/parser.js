const PLATFORMS = [
  { host: 'xiaohongshu.com', name: '小红书' },
  { host: 'xhslink.com', name: '小红书' },
  { host: 'xhslink.cn', name: '小红书' },
  { host: 'douyin.com', name: '抖音' },
  { host: 'bilibili.com', name: 'B站' },
  { host: 'zhihu.com', name: '知乎' },
  { host: 'weixin.qq.com', name: '公众号' },
  { host: 'weibo.com', name: '微博' },
  { host: 'youtube.com', name: 'YouTube' },
  { host: 'youtu.be', name: 'YouTube' },
  { host: 'github.com', name: 'GitHub' },
  { host: 'b23.tv', name: 'B站' },
  { host: 'jianshu.com', name: '简书' },
  { host: 'taobao.com', name: '淘宝' },
  { host: 'tmall.com', name: '天猫' },
  { host: 'jd.com', name: '京东' },
  { host: 'dianping.com', name: '大众点评' },
  { host: 'meituan.com', name: '美团' },
  { host: 'reddit.com', name: 'Reddit' },
  { host: 'medium.com', name: 'Medium' },
  { host: 'notion.so', name: 'Notion' },
  { host: 'csdn.net', name: 'CSDN' },
  { host: 'segmentfault.com', name: 'SegmentFault' },
  { host: 'juejin.cn', name: '掘金' },
  { host: '36kr.com', name: '36氪' },
  { host: 'huxiu.com', name: '虎嗅' },
];

export function detectPlatform(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    for (const p of PLATFORMS) if (host.includes(p.host)) return p.name;
    return host.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function normalizeUrl(input) {
  let t = String(input || '').trim();
  if (!t) return null;
  if (!/^https?:\/\//i.test(t)) t = 'https://' + t;
  try {
    const u = new URL(t);
    if (!u.hostname || !(u.hostname.includes('.') || u.hostname === 'localhost')) return null;
    return u.href;
  } catch { return null; }
}

// 从「分享文案 + 链接」的混合文本中提取网址，例如小红书复制分享的内容
export function extractUrl(input) {
  const t = String(input || '').trim();
  if (!t) return null;
  const direct = normalizeUrl(t);
  if (direct) return direct;
  const m = t.match(/https?:\/\/[^\s"'<>，。！？!?；;、]+/i);
  if (m) {
    const u = normalizeUrl(m[0].replace(/[)）\]】]+$/g, ''));
    if (u) return u;
  }
  const dm = t.match(/(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\/[^\s"'<>，。！？!?；;、]*/i);
  if (dm) {
    const u = normalizeUrl(dm[0].replace(/[)）\]】]+$/g, ''));
    if (u) return u;
  }
  return null;
}

export async function fetchDocument(url, timeoutMs = 12000, depth = 0) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'accept': 'text/html,application/xhtml+xml',
        'accept-language': 'zh-CN,zh;q=0.9',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get('content-type') || '';
    const finalUrl = res.url || url;
    const buf = await res.arrayBuffer();
    const body = Buffer.from(buf).toString('utf8');
    // 部分短链服务用 meta refresh 而不是 HTTP 302，手动跟随（最多 5 跳）
    if (depth < 5) {
      const mr = body.match(/<meta[^>]*http-equiv=["']?refresh["']?[^>]*content=["'][^"']*?url\s*=\s*["']?([^"'>\s]+)/i);
      if (mr) {
        try {
          const target = new URL(mr[1], finalUrl).href;
          if (target && target !== url) return fetchDocument(target, timeoutMs, depth + 1);
        } catch {}
      }
    }
    // 部分站点 content-type 缺失或写错，但内容确实是 HTML，按内容特征兜底判断
    const looksHtml = /^<!doctype html|^<html|^<[a-z][^>]*>/i.test(body.trimStart().slice(0, 200));
    const isHtml = contentType.includes('text/html') || contentType.includes('application/xhtml') || looksHtml;
    if (!isHtml) return { finalUrl, html: null, notHtml: true };
    return { finalUrl, html: body, notHtml: false };
  } finally {
    clearTimeout(timer);
  }
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

export function parseHtml(html, finalUrl) {
  const getMeta = (props) => {
    for (const p of props) {
      const re = new RegExp(`<meta[^>]*\\s(?:property|name)=["']${p}["'][^>]*>`, 'i');
      const m = html.match(re);
      if (m) {
        const cm = m[0].match(/content=["']([^"']*)["']/i);
        if (cm) return decodeEntities(cm[1]);
      }
    }
    return null;
  };
  const collectMeta = (props) => {
    const out = [];
    for (const p of props) {
      const re = new RegExp(`<meta[^>]*\\s(?:property|name)=["']${p}["'][^>]*>`, 'gi');
      let m;
      while ((m = re.exec(html))) {
        const cm = m[0].match(/content=["']([^"']*)["']/i);
        if (cm) out.push(decodeEntities(cm[1]));
      }
    }
    return [...new Set(out)].filter(Boolean);
  };
  const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = decodeEntities((getMeta(['og:title', 'twitter:title']) || (titleTag && titleTag[1]) || '').trim()).slice(0, 200);
  const description = decodeEntities((getMeta(['og:description', 'twitter:description', 'description']) || '').trim()).slice(0, 600);
  const image = (getMeta(['og:image', 'twitter:image']) || '').trim().slice(0, 1000);
  const images = collectMeta(['og:image', 'twitter:image']).map((s) => s.slice(0, 1000)).slice(0, 12);
  const video = (collectMeta(['og:video', 'og:video:url', 'og:video:secure_url', 'twitter:player:stream'])[0] || '').trim().slice(0, 1000) || null;
  const author = decodeEntities((getMeta(['article:author', 'author', 'og:site_name']) || '').trim()).slice(0, 100);
  let bodyText = '';
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    bodyText = bodyMatch[1]
      .replace(/<(script|style|noscript|svg|iframe|nav|header|footer|form)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 6000);
  }
  return {
    title: title || (finalUrl ? new URL(finalUrl).hostname : null),
    description: description || bodyText.slice(0, 300),
    image: image || null,
    images,
    video,
    author: author || null,
    platform: detectPlatform(finalUrl),
    text: bodyText,
    finalUrl,
  };
}

// 提取 window.__INITIAL_STATE__ 的完整 JSON（按花括号配对，不依赖 </script> 紧邻）
function extractInitialState(html) {
  const start = html.indexOf('__INITIAL_STATE__');
  if (start < 0) return null;
  const eq = html.indexOf('=', start);
  if (eq < 0) return null;
  const open = html.indexOf('{', eq);
  if (open < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = open; i < html.length; i++) {
    const ch = html[i];
    if (esc) { esc = false; continue; }
    if (inStr) {
      if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return html.slice(open, i + 1);
    }
  }
  return null;
}

// 小红书网页把笔记数据内嵌在 window.__INITIAL_STATE__ 中
export function parseXiaohongshu(html) {
  const raw = extractInitialState(String(html || ''));
  if (!raw) return null;
  // 真实页面里偶有 undefined / NaN 等非 JSON 字面量，先替换为 null 再解析
  const cleaned = raw
    .replace(/:\s*undefined\b/gi, ':null')
    .replace(/,\s*undefined\b/gi, ',null')
    .replace(/\[\s*undefined\b/gi, '[null')
    .replace(/\bundefined\b/g, 'null')
    .replace(/\bNaN\b/gi, 'null')
    .replace(/\bInfinity\b/gi, 'null');
  let state = null;
  try { state = JSON.parse(cleaned); } catch { return null; }
  const map = state?.note?.noteDetailMap || state?.noteDetailMap || {};
  const note = Object.values(map)[0]?.note;
  if (!note) return null;
  const images = (note.imageList || [])
    .map((im) => im.urlDefault || im.url || (im.infoList && im.infoList[0] && im.infoList[0].url))
    .filter(Boolean);
  return {
    title: String(note.title || '').trim() || null,
    desc: String(note.desc || '').trim() || null,
    author: note.user?.nickname || null,
    cover: images[0] || null,
    images,
    video: (() => {
      const v = note.video;
      if (!v) return null;
      const url = v.urlDefault || (v.media?.stream?.h264 && v.media.stream.h264[0] && v.media.stream.h264[0].url) || null;
      return url ? String(url).slice(0, 1000) : null;
    })(),
    tags: (note.tagList || []).map((t) => t.name).filter(Boolean),
  };
}

// 提取式智能摘要：按句子重要度挑选，而不是直接截取开头
export function summarizeText(text, maxLen = 140) {
  const src = String(text || '').replace(/\s+/g, ' ').trim();
  if (!src) return '';
  if (src.length <= maxLen) return src;
  const sentences = src.split(/(?<=[。！？!?；;])/).map((s) => s.trim()).filter((s) => s.length >= 6);
  if (sentences.length <= 1) return src.slice(0, maxLen - 1) + '…';
  const keywords = TYPE_RULES.flatMap((r) => r.words);
  const score = (s, idx) => {
    let sc = idx < 3 ? 3 - idx : 0;
    if (/\d/.test(s)) sc += 1;
    sc += Math.min(keywords.filter((w) => s.includes(w)).length, 3);
    if (s.length > 10 && s.length < 70) sc += 1;
    return sc;
  };
  const ranked = sentences.map((s, i) => ({ s, sc: score(s, i) })).sort((a, b) => b.sc - a.sc);
  const picked = new Set();
  let len = 0;
  for (const { s } of ranked) {
    if (len + s.length > maxLen && picked.size) break;
    picked.add(s);
    len += s.length;
  }
  if (!picked.size) return src.slice(0, maxLen - 1) + '…';
  return sentences.filter((s) => picked.has(s)).join('').slice(0, maxLen);
}

const PLATFORM_NAMES = ['小红书', '抖音', '微博', '知乎', 'B站', '公众号', 'YouTube', 'GitHub', '淘宝', '天猫', '京东', '美团', '大众点评', 'Reddit', 'Medium', 'Notion', 'CSDN', '掘金', '36氪', '虎嗅'];

// 判断标题是否没有信息量（平台名、太短、占位符）
export function isGenericTitle(title) {
  const t = String(title || '').trim();
  if (!t || t.length < 4) return true;
  if (t === '无标题' || t === '首页' || t === '登录') return true;
  return PLATFORM_NAMES.some((p) => t === p || t.startsWith(p + ' ') || t.includes(`|${p}`) || t.includes(`${p}|`));
}

// 根据内容生成简洁标题：取第一句，控制在 maxLen 字内
export function generateTitle(text, maxLen = 28) {
  const src = String(text || '').replace(/\s+/g, ' ').trim();
  if (!src) return '';
  const first = src.split(/(?<=[。！？!?；;])/)[0].trim().replace(/[。！？!?；;]+$/g, '');
  const base = first && first.length >= 4 ? first : src;
  return base.length > maxLen ? base.slice(0, maxLen - 1) + '…' : base;
}

const TYPE_RULES = [
  { type: '概念', words: ['定义', '是指', '指的是', '是一种', '概念', '本质', '什么是', '原理', '定理', '定律', '含义', '范式'] },
  { type: '方法', words: ['方法', '步骤', '流程', '怎么', '如何', '技巧', '工作法', '框架', '策略', '指南', '教程', '模板', '清单', 'checklist', 'sop', 'how to', 'tutorial', '原则'] },
  { type: '事实', words: ['事实', '数据', '统计', '报告', '新闻', '历史', '事件', '背景', '趋势', '案例', '数字', '同比', '占比'] },
  { type: '工作经验', words: ['经验', '心得', '复盘', '教训', '踩坑', '职场', '工作', '项目', '面试', '沟通', '管理', '晋升'] },
  { type: '课程笔记', words: ['课程', '笔记', '课堂', '教材', '章节', '考点', '考试', 'lecture', 'lesson'] },
];

export function inferType(text) {
  const hay = String(text || '').toLowerCase();
  for (const rule of TYPE_RULES) {
    for (const w of rule.words) {
      if (hay.includes(w.toLowerCase())) return rule.type;
    }
  }
  return '其他';
}

export const PARSE_STATUS = {
  PENDING: '待解析',
  RUNNING: '解析中',
  FULL: '完整解析',
  PARTIAL: '部分解析',
  MANUAL: '已保存正文',
  LINK_ONLY: '仅保存链接',
  FAILED: '解析失败',
};
