// 自测脚本：不绑定端口，直接调用路由与处理逻辑
process.env.DATA_DIR = '/tmp/xc_selfcheck';
process.env.OPENAI_API_KEY = '';

const assert = (cond, msg) => {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else console.log('ok -', msg);
};

function fakeReq(method, body) {
  return {
    method,
    headers: {},
    destroy() {},
    on(ev, cb) {
      if (ev === 'data' && body !== undefined) cb(JSON.stringify(body));
      if (ev === 'end') cb();
    },
  };
}

function fakeRes() {
  const r = { status: 0, headers: {}, body: '' };
  r.writeHead = (s, h) => { r.status = s; Object.assign(r.headers, h || {}); };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.end = (b) => { r.body = b || ''; };
  return r;
}

async function call(handle, method, path, body, cookie) {
  const req = fakeReq(method, body);
  if (cookie) req.headers.cookie = cookie;
  const res = fakeRes();
  const [p, qs] = path.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  await handle(req, res, p, query);
  let json = null;
  try { json = JSON.parse(res.body); } catch {}
  return { status: res.status, json, res };
}

const { rmSync } = await import('node:fs');
rmSync('/tmp/xc_selfcheck', { recursive: true, force: true });

const { handleApi, processCollection } = await import('../server/routes.js');
const { parseHtml, parseXiaohongshu, fetchDocument } = await import('../server/parser.js');
const { normalizeUrl, detectPlatform, summarizeText, extractUrl, generateTitle, isGenericTitle } = await import('../server/parser.js');
const { generateCardsRules, isKnowledgeType } = await import('../server/cards.js');
assert(isKnowledgeType('知识') && isKnowledgeType('教程/工具') && isKnowledgeType('其他'), '兼容模型知识类型可生成卡片');
assert(!isKnowledgeType('软件/商品') && !isKnowledgeType('消费/地点'), '非知识类型不自动生成卡片');

// 1. 注册
let r = await call(handleApi, 'POST', '/api/auth/register', { account: 'tester', password: 'test123' });
assert(r.status === 200 && r.json.user.account === 'tester', '注册成功');
const cookie = r.res.headers['set-cookie'] ? r.res.headers['set-cookie'].split(';')[0] : '';
assert(Boolean(cookie), '登录态已建立');

// 2. 重复注册
r = await call(handleApi, 'POST', '/api/auth/register', { account: 'tester', password: 'test123' });
assert(r.status === 409, '重复账号被拒绝');

// 3. 添加文本收藏
r = await call(handleApi, 'POST', '/api/collections', { text: '番茄工作法：把工作拆成25分钟专注和5分钟休息的循环。每完成4个番茄钟休息15到30分钟。核心是减少切换成本，提升专注力。' }, cookie);
assert(r.status === 200 && r.json.saved, '文本收藏已保存');
const cid = r.json.collection.id;

// 4. 异步解析完成
await processCollection(cid);
r = await call(handleApi, 'GET', `/api/collections/${cid}`, undefined, cookie);
assert(r.json.item.parseStatus === '已保存正文', '文本输入标记为已保存正文');
assert(r.json.item.type !== '未分类', `类型已推断：${r.json.item.type}`);

// 5. 候选卡片已生成
r = await call(handleApi, 'GET', '/api/cards', undefined, cookie);
assert(r.json.items.length >= 1, `知识类内容生成候选卡片 ${r.json.items.length} 张`);
const card = r.json.items[0];

// 6. 确认卡片 → 回顾会话
r = await call(handleApi, 'POST', `/api/cards/${card.id}/status`, { status: '已确认' }, cookie);
assert(r.status === 200, '卡片已确认');
r = await call(handleApi, 'GET', '/api/review/session', undefined, cookie);
assert(r.json.items.length >= 1, '确认后可进入回顾');
const reviewCard = r.json.items[0];
assert(reviewCard.reviewCount === 0 && reviewCard.lastFeedback === null, '首次回顾返回空记忆历史');

// 7. 回顾反馈
r = await call(handleApi, 'POST', `/api/review/${reviewCard.id}`, { feedback: '记得' }, cookie);
assert(r.status === 200 && r.json.interval === 7, '回顾反馈记录 7 天间隔');

// 8. 关键词搜索
r = await call(handleApi, 'GET', '/api/search?q=番茄', undefined, cookie);
assert(r.json.items.length >= 1, '关键词搜索命中');

// 9. 发现页
r = await call(handleApi, 'GET', '/api/discover', undefined, cookie);
assert(r.json.week.length >= 1 && r.json.neverOpened.length >= 1, '发现页分区返回');

// 10. 收藏集
r = await call(handleApi, 'POST', '/api/sets', { name: '效率方法' }, cookie);
assert(r.status === 200 && r.json.id, '创建收藏集');
const sid = r.json.id;
r = await call(handleApi, 'POST', `/api/sets/${sid}/members`, { collectionId: cid }, cookie);
assert(r.status === 200, '收藏加入收藏集');

// 11. 编辑收藏
r = await call(handleApi, 'PATCH', `/api/collections/${cid}`, { use_status: '稍后处理', tags: ['专注', '效率'] }, cookie);
assert(r.json.item.useStatus === '稍后处理' && r.json.item.tags.length === 2, '编辑收藏成功');

// 12. 重复链接检测（不可达 URL）
const dupUrl = 'http://127.0.0.1:9/nope';
r = await call(handleApi, 'POST', '/api/collections', { url: dupUrl }, cookie);
assert(r.json.saved, 'URL 收藏已保存（先保存再处理）');
const urlId = r.json.collection.id;
await processCollection(urlId);
r = await call(handleApi, 'GET', `/api/collections/${urlId}`, undefined, cookie);
assert(r.json.item.parseStatus === '解析失败', '不可达链接标记解析失败且已兜底保存');
r = await call(handleApi, 'POST', '/api/collections', { url: dupUrl }, cookie);
assert(r.json.duplicate === true, '重复链接提示');
r = await call(handleApi, 'POST', '/api/collections', { url: dupUrl, force: true }, cookie);
assert(r.json.saved && r.json.duplicate === false, '强制继续保存');

// 13. 统计与导出
r = await call(handleApi, 'GET', '/api/stats', undefined, cookie);
assert(r.json.total >= 3 && r.json.confirmed >= 1, '统计数据正确');
r = await call(handleApi, 'GET', '/api/export', undefined, cookie);
assert(r.res.headers['content-disposition'] && r.res.body.includes('collections'), '导出成功');

// 14. 删除
r = await call(handleApi, 'DELETE', `/api/collections/${cid}`, undefined, cookie);
assert(r.status === 200, '删除收藏');

// 15. 解析器单元测试
const html = `<html><head>
<meta property="og:title" content="测试文章标题">
<meta property="og:description" content="这是一段用于测试的描述文字。">
<meta property="og:image" content="https://example.com/a.jpg">
<meta name="author" content="作者甲">
<title>备用标题</title></head>
<body><p>正文第一段：讲解一个核心概念，长度超过四十个字符确保可以正常提取为正文文本内容。</p><p>第二段补充说明。</p></body></html>`;
const parsed = parseHtml(html, 'https://example.com/post/1');
assert(parsed.title === '测试文章标题', 'og:title 提取');
assert(parsed.author === '作者甲', 'author 提取');
assert(parsed.image === 'https://example.com/a.jpg', 'og:image 提取');
assert(parsed.platform === 'example.com', '平台识别');
assert(parsed.text.includes('正文第一段'), '正文文本提取');

// 16. 链接规范化
assert(normalizeUrl('example.com/post/1') === 'https://example.com/post/1', '无协议链接自动补 https://');
assert(normalizeUrl('http://example.com/x') === 'http://example.com/x', '已有协议链接保留');
assert(normalizeUrl('不是链接') === null, '非法链接返回 null');

// 17. meta 属性顺序（content 在前）
const html2 = '<html><head><meta content="顺序测试标题" property="og:title"><meta content="顺序描述" name="description"></head><body><p>正文内容用于测试。</p></body></html>';
const parsed2 = parseHtml(html2, 'https://example.com/a');
assert(parsed2.title === '顺序测试标题', 'content 在前也能提取 og:title');
assert(parsed2.description === '顺序描述', 'content 在前也能提取 description');

// 18. 小红书页面解析（__INITIAL_STATE__ 内嵌数据）
const xhsHtml = `<!doctype html><html><head><title>小红书</title></head><body><script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"x123":{"note":{"title":"东京五天四夜旅行攻略","desc":"这篇笔记分享五天四夜的东京行程：新宿购物、涩谷打卡、浅草寺和镰仓一日游，还有平价餐厅与交通卡攻略，第一次去东京的朋友可以直接参考。","user":{"nickname":"旅行博主小鹿"},"imageList":[{"urlDefault":"https://img.example.com/cover.jpg"},{"urlDefault":"https://img.example.com/p2.jpg"}],"tagList":[{"name":"旅行攻略"},{"name":"东京"}]}}}}}</script></body></html>`;
const xhs = parseXiaohongshu(xhsHtml);
assert(xhs && xhs.title === '东京五天四夜旅行攻略', '小红书标题提取');
assert(xhs && xhs.desc.includes('镰仓'), '小红书正文提取');
assert(xhs && xhs.author === '旅行博主小鹿', '小红书作者提取');
assert(xhs && xhs.cover === 'https://img.example.com/cover.jpg', '小红书封面提取');
assert(xhs && xhs.tags.length === 2, '小红书标签提取');

// 19. processCollection 集成小红书解析（stub 网络请求）
const realFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(xhsHtml, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
try {
  r = await call(handleApi, 'POST', '/api/collections', { url: 'https://www.xiaohongshu.com/explore/x123' }, cookie);
  assert(r.json.saved, '小红书链接已保存');
  const xhsId = r.json.collection.id;
  await processCollection(xhsId);
  await new Promise((resolve) => setTimeout(resolve, 20));
  r = await call(handleApi, 'GET', `/api/collections/${xhsId}`, undefined, cookie);
  assert(r.json.item.platform === '小红书', '小红书平台识别');
  assert(r.json.item.title === '东京五天四夜旅行攻略', '小红书标题已填充');
  assert(r.json.item.author === '旅行博主小鹿', '小红书作者已填充');
  assert(r.json.item.cover === 'https://img.example.com/cover.jpg', '小红书封面已填充');
  assert(r.json.item.parseStatus === '完整解析', '小红书正文足够时标记完整解析');
  assert(r.json.item.parsedText && r.json.item.parsedText.includes('镰仓'), '小红书正文已保存');
  assert(r.json.item.tags.includes('旅行攻略'), '小红书标签已保存');
  assert(['概念', '方法', '事实', '工作经验', '课程笔记', '其他'].includes(r.json.item.type), '小红书内容类型按新分类推断');
} finally {
  globalThis.fetch = realFetch;
}

// 20. 小红书真实页面容错：内嵌数据含 undefined，且状态后有其他脚本
const xhsMessy = `<script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"y1":{"note":{"title":"防脱发护发经验","desc":"分享三年护发经验总结：减少烫染频率、坚持头皮按摩、使用温和氨基酸洗发水，配合护发精油，头发状态明显改善。","user":{"nickname":"护发阿然"},"imageList":[{"urlDefault":"https://img.example.com/h.jpg"}],"tagList":undefined,"extra":undefined}}}}};</script><script>window.__NEXT_DATA__={};</script>`;
const xhs2 = parseXiaohongshu(xhsMessy);
assert(xhs2 && xhs2.title === '防脱发护发经验', '含 undefined 的内嵌数据仍能解析标题');
assert(xhs2 && xhs2.desc.includes('氨基酸'), '含 undefined 的内嵌数据仍能解析正文');
assert(xhs2 && xhs2.author === '护发阿然', '含 undefined 的内嵌数据仍能解析作者');
assert(xhs2 && xhs2.tags.length === 0, 'tagList 为 undefined 时标签为空数组');

// 21. 小红书分享短链识别（xhslink.cn）
assert(detectPlatform('http://xhslink.cn/o/4mb9IBjFkWe') === '小红书', 'xhslink.cn 识别为小红书');
assert(detectPlatform('https://xhslink.com/o/abc') === '小红书', 'xhslink.com 识别为小红书');

// 22. 短链 meta refresh 跳转跟随
const hopHtml = '<html><head><meta http-equiv="refresh" content="0; url=https://www.xiaohongshu.com/explore/x999"></head><body>跳转中…</body></html>';
const realFetch2 = globalThis.fetch;
let hopCount = 0;
globalThis.fetch = async (url) => {
  hopCount++;
  if (url.includes('xhslink.cn')) return new Response(hopHtml, { status: 200, headers: { 'content-type': 'text/html' } });
  return new Response(xhsHtml, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
};
try {
  const f = await fetchDocument('http://xhslink.cn/o/4mb9IBjFkWe');
  const x = parseXiaohongshu(f.html);
  assert(hopCount >= 2, 'meta refresh 跳转被跟随');
  assert(x && x.title === '东京五天四夜旅行攻略', '短链跳转后能解析小红书正文');
} finally {
  globalThis.fetch = realFetch2;
}

// 23. 纯文本收藏完整保存正文（不截断）
const longText = 'AI 广告时代正式开始：ChatGPT 商业化新模式。这篇内容讲的是大模型如何进入广告投放、素材生成和效果归因，核心是把 LLM 的商业能力拆成三个环节，以及各环节对从业者的影响。'.repeat(3);
assert(longText.length > 200, '长文本超过 200 字');
r = await call(handleApi, 'POST', '/api/collections', { text: longText }, cookie);
assert(r.json.saved, '长文本收藏已保存');
const textId = r.json.collection.id;
await processCollection(textId);
r = await call(handleApi, 'GET', `/api/collections/${textId}`, undefined, cookie);
assert(r.json.item.parsedText === longText, '纯文本正文完整保存不截断');
assert(r.json.item.title.length <= 60, '标题仍是摘要形式（60 字内）');
assert(r.json.item.parseStatus === '已保存正文', '长文本标记为已保存正文');

// 24. 手动创建卡片
r = await call(handleApi, 'POST', '/api/cards', { collectionId: textId, kind: '问答', question: 'LLM 商业化分哪三个环节？', answer: '广告投放、素材生成和效果归因。' }, cookie);
assert(r.status === 200 && r.json.card.status === '候选中', '手动创建候选卡片成功');
const manualCardId = r.json.card.id;
r = await call(handleApi, 'POST', '/api/cards', { collectionId: textId, kind: '问答', question: '', answer: '' }, cookie);
assert(r.status === 400, '空问题空答案被拒绝');

// 25. 重新生成卡片（force 替换候选卡片）
r = await call(handleApi, 'GET', '/api/cards', undefined, cookie);
const before = r.json.items.filter((k) => k.collectionId === textId && k.status === '候选中');
assert(before.length >= 1, '重新生成前存在候选卡片');
r = await call(handleApi, 'POST', `/api/collections/${textId}/cards/generate`, { force: true }, cookie);
assert(r.json.created >= 1, 'force 重新生成成功');
r = await call(handleApi, 'GET', '/api/cards', undefined, cookie);
const after = r.json.items.filter((k) => k.collectionId === textId && k.status === '候选中');
assert(after.length >= 1 && after.some((k) => k.id === manualCardId), '旧候选被替换，手动卡片保留');

// 26. 重启接口需要登录
r = await call(handleApi, 'POST', '/api/admin/restart', {}, '');
assert(r.status === 401, '未登录时重启接口被拒绝');

// 27. 智能摘要：挑选重点句子，而不是截取开头
const sumSrc = '这是一段很长的开场白描述，内容比较啰嗦，没有什么实质信息，只是在不断重复凑字数，好让第一句本身就超过长度限制，用于验证摘要不会直接截取开头。番茄工作法是指把工作拆成25分钟专注和5分钟休息的循环。结尾再补一句普通说明。';
const sm = summarizeText(sumSrc, 60);
assert(sm.length <= 60 && sm.includes('番茄'), '智能摘要挑选重点句子而非截取开头');
assert(summarizeText('短文本') === '短文本', '短文本原样返回');

// 26. 添加校验：链接或文字必填，仅备注不允许
r = await call(handleApi, 'POST', '/api/collections', { note: '只有备注' }, cookie);
assert(r.status === 400, '仅备注不允许保存（链接或文字必填）');

// 27. 自定义标题：解析不会覆盖
const realFetch4 = globalThis.fetch;
globalThis.fetch = async () => new Response(xhsHtml, { status: 200, headers: { 'content-type': 'text/html' } });
try {
  r = await call(handleApi, 'POST', '/api/collections', { url: 'https://www.xiaohongshu.com/explore/zt', title: '我的收藏标题' }, cookie);
  assert(r.json.saved, '带自定义标题的收藏已保存');
  const ztId = r.json.collection.id;
  await processCollection(ztId);
  await new Promise((resolve) => setTimeout(resolve, 20));
  r = await call(handleApi, 'GET', `/api/collections/${ztId}`, undefined, cookie);
  assert(r.json.item.title === '我的收藏标题', '用户自定义标题不被解析结果覆盖');
  assert(r.json.item.images.length >= 2, '小红书多图已保存到详情');
} finally {
  globalThis.fetch = realFetch4;
}

// 28. 网页图片与视频提取
const htmlImg = `<html><head>
<meta property="og:image" content="https://example.com/1.jpg">
<meta property="og:image" content="https://example.com/2.jpg">
<meta property="og:video" content="https://example.com/v.mp4">
<title>带图视频页</title></head><body><p>这是一段足够长的正文内容，用于验证智能摘要和图片视频的解析结果是否正确返回。</p></body></html>`;
const pv = parseHtml(htmlImg, 'https://example.com/v');
assert(pv.images.length === 2, '多张 og:image 提取');
assert(pv.video === 'https://example.com/v.mp4', 'og:video 提取');

const realFetch5 = globalThis.fetch;
globalThis.fetch = async () => new Response(htmlImg, { status: 200, headers: { 'content-type': 'text/html' } });
try {
  r = await call(handleApi, 'POST', '/api/collections', { url: 'https://example.com/v' }, cookie);
  assert(r.json.saved, '带图视频链接已保存');
  const imgId = r.json.collection.id;
  await processCollection(imgId);
  await new Promise((resolve) => setTimeout(resolve, 20));
  r = await call(handleApi, 'GET', `/api/collections/${imgId}`, undefined, cookie);
  assert(r.json.item.images.length === 2, '详情返回图片列表');
  assert(r.json.item.video === 'https://example.com/v.mp4', '详情返回视频地址');
} finally {
  globalThis.fetch = realFetch5;
}

// 29. 知识卡片依据摘要内容出题
const ruleCards = generateCardsRules({ title: '番茄工作法', summary: '番茄工作法是一种时间管理方法，是指把工作拆成25分钟专注和5分钟休息的循环。每完成4个番茄钟休息15到30分钟。' });
assert(ruleCards.some((k) => k.kind === '概念'), '定义句式生成概念卡');
assert(ruleCards.some((k) => k.kind === '填空'), '数字关键词生成填空卡');
assert(ruleCards.every((k) => k.kind !== '要点' && k.question), '所有候选卡片都有问题且不再生成要点卡');
assert(ruleCards.length <= 3, '候选卡片不超过 3 张');

// 30. 分享文案中自动提取链接
const shareText = 'AI广告时代正式开始：ChatGPT商业化新模式 LLM的商业... http://xhslink.cn/o/4mb9IBjFkWe';
assert(extractUrl(shareText) === 'http://xhslink.cn/o/4mb9IBjFkWe', '从分享文案中提取链接');
assert(extractUrl('https://www.xiaohongshu.com/explore/abc') === 'https://www.xiaohongshu.com/explore/abc', '纯链接原样识别');
r = await call(handleApi, 'POST', '/api/collections', { url: shareText }, cookie);
assert(r.json.saved, '粘贴分享文案也能保存（自动提取链接）');
assert(r.json.collection.platform === '小红书', '分享文案提取的链接识别平台');
r = await call(handleApi, 'POST', '/api/collections', { url: '这不是链接' }, cookie);
assert(r.status === 400 && r.json.error.includes('格式'), '无效链接提示格式错误');

// 31. 标题生成规则
assert(isGenericTitle('小红书') === true, '平台名识别为无效标题');
assert(isGenericTitle('东京五天四夜旅行攻略') === false, '有效标题不被误判');
const gt = generateTitle('这是一段很长的开场白描述，内容比较啰嗦，没有什么信息量。核心内容是番茄工作法。');
assert(gt.length <= 28 && gt.includes('开场白'), '标题取第一句且限制长度');
const gt2 = generateTitle('东京旅行攻略：新宿涩谷浅草寺镰仓一日游。');
assert(gt2 === '东京旅行攻略：新宿涩谷浅草寺镰仓一日游', '短标题完整保留');

// 32. 平台名标题被内容标题替换
const genHtml = '<html><head><title>小红书</title><meta property="og:title" content="小红书"></head><body><p>这篇笔记分享五天四夜的东京行程安排，涵盖新宿、涩谷、浅草寺和镰仓一日游，还有平价餐厅推荐和交通卡攻略。</p></body></html>';
const realFetch6 = globalThis.fetch;
globalThis.fetch = async () => new Response(genHtml, { status: 200, headers: { 'content-type': 'text/html' } });
try {
  r = await call(handleApi, 'POST', '/api/collections', { url: 'https://www.xiaohongshu.com/explore/gt' }, cookie);
  const gtId = r.json.collection.id;
  await processCollection(gtId);
  await new Promise((resolve) => setTimeout(resolve, 20));
  r = await call(handleApi, 'GET', `/api/collections/${gtId}`, undefined, cookie);
  assert(r.json.item.title !== '小红书' && r.json.item.title.length >= 4, '平台名标题被内容标题替换');
} finally {
  globalThis.fetch = realFetch6;
}

// 33. 清空个人数据
r = await call(handleApi, 'POST', '/api/auth/register', { account: 'clearer', password: 'test123' });
const clearCookie = r.res.headers['set-cookie'] ? r.res.headers['set-cookie'].split(';')[0] : '';
r = await call(handleApi, 'POST', '/api/collections', { text: '这是一条用于清空测试的个人收藏，正文内容足够长，用于验证清空接口会删除用户自己的全部数据。' }, clearCookie);
assert(r.json.saved, '清空测试用户收藏已保存');
r = await call(handleApi, 'DELETE', '/api/me', undefined, clearCookie);
assert(r.status === 200 && r.json.ok, '清空接口成功');
r = await call(handleApi, 'GET', '/api/collections', undefined, clearCookie);
assert(r.json.items.length === 0, '清空后收藏为 0');
r = await call(handleApi, 'GET', '/api/cards', undefined, clearCookie);
assert(r.json.items.length === 0, '清空后卡片为 0');

// 34. 统计扩展字段
r = await call(handleApi, 'GET', '/api/cards?status=候选中', undefined, cookie);
const candForStats = r.json.items.find((k) => k.collectionId === textId);
assert(Boolean(candForStats), '统计前存在可确认的候选卡片');
if (candForStats) {
  await call(handleApi, 'POST', `/api/cards/${candForStats.id}/status`, { status: '已确认' }, cookie);
  await call(handleApi, 'POST', `/api/review/${candForStats.id}`, { feedback: '记得' }, cookie);
}
r = await call(handleApi, 'GET', '/api/stats', undefined, cookie);
assert(typeof r.json.reviewedCount === 'number' && r.json.reviewedCount >= 1, '统计返回已完成回顾数');
assert(Array.isArray(r.json.reviewTrend), '统计返回近 7 天趋势');
assert(Array.isArray(r.json.weakCards), '统计返回薄弱知识点');
assert(Array.isArray(r.json.recentlyConfirmed) && r.json.recentlyConfirmed.length >= 1, '统计返回最近确认卡片');
assert(Array.isArray(r.json.recentReviews) && r.json.recentReviews.length >= 1, '统计返回最近回顾记录');
assert(Array.isArray(r.json.recentContent), '统计返回最近内容');

// 35. 回顾偏好
r = await call(handleApi, 'POST', '/api/me/prefs', { reviewCount: 8 }, cookie);
assert(r.status === 200 && r.json.prefs.reviewCount === 8, '保存回顾偏好');
r = await call(handleApi, 'GET', '/api/me', undefined, cookie);
assert(r.json.prefs.reviewCount === 8, '我的信息返回偏好');
r = await call(handleApi, 'POST', '/api/me/prefs', { reviewCount: 3 }, cookie);
assert(r.json.prefs.reviewCount === 3, '更新回顾偏好');

// 36. 账号注销
r = await call(handleApi, 'POST', '/api/auth/register', { account: 'deluser', password: 'test123' });
const delCookie = r.res.headers['set-cookie'] ? r.res.headers['set-cookie'].split(';')[0] : '';
r = await call(handleApi, 'POST', '/api/collections', { text: '账号注销测试用的一条内容，用于验证注销会删除用户及全部数据。' }, delCookie);
assert(r.json.saved, '注销用户已添加内容');
r = await call(handleApi, 'DELETE', '/api/me/account', undefined, delCookie);
assert(r.status === 200 && r.json.ok, '账号注销成功');
r = await call(handleApi, 'GET', '/api/collections', undefined, delCookie);
assert(r.status === 401, '注销后旧登录态失效');
r = await call(handleApi, 'POST', '/api/auth/login', { account: 'deluser', password: 'test123' }, delCookie);
assert(r.status === 401 || r.status === 400, '注销后账号不可再登录');

console.log(process.exitCode ? '\n有失败项' : '\n全部通过 ✓');
