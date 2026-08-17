// 自测：无网络、无 API Key 环境下验证三种分析模式 + 长文本截断 + 入参校验
import { analyzeRules, handleAnalyze, MAX_CHARS, extractUrl, extractMeta } from '../server.js';

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  →  ' + extra : '')); }
}

const TEXT = [
  '某银行今日发布2025年第三季度报告，营收同比增长12%，净利润突破100亿元。',
  '公告显示公司因信息披露违规被监管部门立案调查，股价下跌8%。',
  '公司同时宣布与三家大型企业签署战略合作协议，共同建设数字风控平台。',
  '新系统采用AI技术实现贷前审核自动化，显著提升效率，降低人工成本。',
  '业内专家指出，该方案仍存在数据合规风险，政策落地存在不确定性。',
  '目标用户主要为中小企业和金融机构客户，产品上线后需要满足监管要求。',
].join('\n');

const SHARE_BLOB = 'Howto | 10分钟速通Codex搞定VibeCoding 因为最开始Vi... http://xhslink.cn/o/4iNRuYUrNPg 把这段复制好，然后去【小红书】就能看笔记。';
check('分享文本中识别短链接', extractUrl(SHARE_BLOB) === 'http://xhslink.cn/o/4iNRuYUrNPg', 'got=' + extractUrl(SHARE_BLOB));
check('无链接文本返回空', extractUrl('这是一段没有链接的纯文本。') === '');

const metaHtml = '<html><head><meta property="og:title" content="测试标题"><meta name="description" content="这是简介内容"></head></html>';
const meta = extractMeta(metaHtml);
check('meta：提取标题', meta.title === '测试标题', 'got=' + meta.title);
check('meta：提取简介', meta.desc === '这是简介内容', 'got=' + meta.desc);
check('meta：拼接正文', meta.text.includes('测试标题') && meta.text.includes('这是简介内容'));

const xhsHtml = '<html><head><script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"x":{"note":{"title":"小红书笔记标题","desc":"这里是笔记正文内容"}}}}}</script></head></html>';
const xhsMeta = extractMeta(xhsHtml);
check('meta：小红书 INITIAL_STATE 标题', xhsMeta.title === '小红书笔记标题', 'got=' + xhsMeta.title);
check('meta：小红书 INITIAL_STATE 正文', xhsMeta.desc === '这里是笔记正文内容', 'got=' + xhsMeta.desc);

const ldHtml = '<html><head><script type="application/ld+json">{"headline":"JSONLD标题","description":"这是结构化数据里的简介"}</script></head></html>';
const ldMeta = extractMeta(ldHtml);
check('meta：JSON-LD 标题', ldMeta.title === 'JSONLD标题', 'got=' + ldMeta.title);
check('meta：JSON-LD 简介', ldMeta.desc === '这是结构化数据里的简介', 'got=' + ldMeta.desc);

const s = analyzeRules(TEXT, 'summary');
check('summary：生成标题', !!s.title);
check('summary：生成摘要', s.summary.length > 0);
check('summary：有关键信息', Array.isArray(s.keyPoints) && s.keyPoints.length > 0);
check('summary：有数据点', Array.isArray(s.dataPoints) && s.dataPoints.length > 0);

const r = analyzeRules(TEXT, 'risk');
check('risk：生成风险清单', Array.isArray(r.risks) && r.risks.length > 0);
check('risk：识别到隐患', r.risks.some((x) => x.level === '隐患'));
check('risk：识别到利好', r.risks.some((x) => x.level === '利好'));
check('risk：风险项带原文', r.risks.every((x) => typeof x.text === 'string' && x.text.length > 0));

const st = analyzeRules(TEXT, 'structure');
check('structure：有写作目的', typeof st.structure.purpose === 'string' && st.structure.purpose.length > 0);
check('structure：有目标人群', typeof st.structure.audience === 'string' && st.structure.audience.length > 0);
check('structure：有核心方案', typeof st.structure.solution === 'string' && st.structure.solution.length > 0);
check('structure：优点/缺点/约束为数组', Array.isArray(st.structure.pros) && Array.isArray(st.structure.cons) && Array.isArray(st.structure.limits));

function fakeReq(body) {
  const req = {
    destroy() {},
    on(ev, cb) {
      if (ev === 'data' && body !== undefined) cb(JSON.stringify(body));
      else if (ev === 'end') cb();
    },
  };
  return req;
}
function fakeRes() {
  const state = { status: 0, body: null };
  return {
    writeHead(st) { state.status = st; },
    end(b) { state.body = JSON.parse(b); },
    get state() { return state; },
  };
}

await (async () => {
  const res = fakeRes();
  await handleAnalyze(fakeReq({}), res);
  check('无输入返回 400', res.state.status === 400, 'status=' + res.state.status);
  check('无输入有中文提示', /链接|文本/.test(res.state.body?.error || ''));
})();

await (async () => {
  const res = fakeRes();
  const long = '这是一段用于测试截断功能的文本内容。'.repeat(2000);
  await handleAnalyze(fakeReq({ text: long, mode: 'summary' }), res);
  check('长文本返回 200', res.state.status === 200, 'status=' + res.state.status);
  check('长文本标记截断', res.state.body?.truncated === true);
  check('截断长度正确', res.state.body?.content?.length === MAX_CHARS, 'len=' + (res.state.body?.content?.length));
  check('截断后仍可分析', !!res.state.body?.result?.summary);
})();

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
