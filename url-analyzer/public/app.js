const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MODE_NAMES = { summary: '通用摘要', risk: '金融风险分析', structure: '结构化拆解' };
const HISTORY_KEY = 'url_analyzer_history';

let current = null; // 当前分析结果 {url,text,mode,wordCount,truncated,ai,result}
let pastedTitle = ''; // 从分享文本中识别出的标题参考

function extractUrlFromText(input) {
  const m = String(input || '').match(/https?:\/\/[^\s，。；、（）()【】\[\]'"<>]+/i);
  return m ? m[0].replace(/[，。；、）】"'>]+$/g, '') : '';
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}
function saveHistoryItem(item) {
  const list = loadHistory();
  list.unshift({ ...item, at: new Date().toISOString() });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 30)));
}

// ---------- 渲染分析结果 ----------

function renderResult(data) {
  current = data;
  const r = data.result || {};
  const truncated = data.truncated;
  $('src-info').textContent =
    (data.source === 'jina' ? '来源：Jina Reader' : data.source === 'direct' ? '来源：本地抓取' : data.source === 'meta' ? '来源：页面元数据（部分网站需登录）' : '来源：手动粘贴') +
    ` · ${data.wordCount} 字` + (truncated ? ' · 已截取前 8000 字' : '');
  $('content-preview').textContent = (data.content || data.raw || '') + (truncated ? '\n\n……（内容较长，已截取前 8000 字）' : '');
  $('ai-badge').textContent = data.ai ? '大模型分析' : '本地规则分析（演示）';
  $('ai-badge').className = 'badge-ai ' + (data.ai ? 'on' : '');

  if (data.partial) {
    $('result-body').innerHTML = `<div class="card warn"><h3>仅拿到标题 / 简介</h3><p>${esc(data.reason || '该平台需要登录，未能抓取正文。')}</p></div>`;
    $('result').style.display = '';
    return;
  }

  let html = '';
  html += `<div class="card"><h3 class="card-title">${esc(r.title || data.title || '未命名内容')}</h3>${data.mode ? `<span class="chip">${MODE_NAMES[data.mode] || data.mode}</span>` : ''}</div>`;
  if (r.summary) html += `<div class="card"><h3>核心摘要</h3><p>${esc(r.summary)}</p></div>`;
  if (r.keyPoints && r.keyPoints.length) {
    html += `<div class="card"><h3>关键信息</h3><ul class="pts">${r.keyPoints.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>`;
  }
  if (r.dataPoints && r.dataPoints.length) {
    html += `<div class="card"><h3>关键数据</h3><table class="tbl"><tbody>${r.dataPoints.map((d) => `<tr><td>${esc(d.text)}</td><td class="val">${esc(d.value)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  if (r.risks && r.risks.length) {
    const cls = (l) => (l === '隐患' ? 'risk-bad' : l === '利好' ? 'risk-good' : 'risk-neutral');
    html += `<div class="card"><h3>风险清单</h3><ul class="risks">${r.risks.map((x) => `<li class="${cls(x.level)}"><span class="lv">${esc(x.level)}</span>${esc(x.text)}</li>`).join('')}</ul></div>`;
  }
  if (r.structure && Object.keys(r.structure).length) {
    const s = r.structure;
    const rows = [];
    if (s.purpose) rows.push(['写作目的', s.purpose]);
    if (s.audience) rows.push(['目标人群', s.audience]);
    if (s.solution) rows.push(['核心方案', s.solution]);
    if (s.pros && s.pros.length) rows.push(['优点', s.pros.join('；')]);
    if (s.cons && s.cons.length) rows.push(['缺点', s.cons.join('；')]);
    if (s.limits && s.limits.length) rows.push(['落地约束', s.limits.join('；')]);
    html += `<div class="card"><h3>结构化拆解</h3><table class="tbl"><tbody>${rows.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  html += `<p class="muted">⚠️ 分析结果由 AI 生成，可能存在错误；所有结论请以原文为准。</p>`;
  $('result-body').innerHTML = html;
  $('result').style.display = '';
}

// ---------- 导出 ----------

function exportMarkdown() {
  if (!current) return;
  const r = current.result || {};
  const lines = [`# ${r.title || current.title || '分析结果'}`, '', `- 模式：${MODE_NAMES[current.mode] || current.mode}`, `- 来源：${current.url || '手动粘贴'}`, ''];
  if (r.summary) lines.push('## 核心摘要', '', r.summary, '');
  if (r.keyPoints && r.keyPoints.length) { lines.push('## 关键信息', ''); r.keyPoints.forEach((p) => lines.push(`- ${p}`)); lines.push(''); }
  if (r.dataPoints && r.dataPoints.length) { lines.push('## 关键数据', ''); r.dataPoints.forEach((d) => lines.push(`- ${d.text}（${d.value}）`)); lines.push(''); }
  if (r.risks && r.risks.length) { lines.push('## 风险清单', ''); r.risks.forEach((x) => lines.push(`- [${x.level}] ${x.text}`)); lines.push(''); }
  if (r.structure) {
    const s = r.structure;
    lines.push('## 结构化拆解', '');
    if (s.purpose) lines.push(`- 写作目的：${s.purpose}`);
    if (s.audience) lines.push(`- 目标人群：${s.audience}`);
    if (s.solution) lines.push(`- 核心方案：${s.solution}`);
    if (s.pros && s.pros.length) lines.push(`- 优点：${s.pros.join('；')}`);
    if (s.cons && s.cons.length) lines.push(`- 缺点：${s.cons.join('；')}`);
    if (s.limits && s.limits.length) lines.push(`- 落地约束：${s.limits.join('；')}`);
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `解析结果-${Date.now()}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- 提交分析 ----------

async function submit() {
  const url = $('url-input').value.trim();
  const text = $('text-input').value.trim();
  const mode = $('mode-select').value;
  if (!url && !text) { $('error-msg').textContent = '请先输入网页链接，或粘贴一段文本。'; $('error').style.display = ''; return; }
  $('error').style.display = 'none';
  $('result').style.display = 'none';
  $('loading').style.display = '';
  $('step1').style.display = '';
  $('step2').style.display = 'none';
  $('submit-btn').disabled = true;
  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, text, mode, title: pastedTitle }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '分析失败');
    $('step1').style.display = 'none';
    $('step2').style.display = '';
    // 模拟第二步耗时，展示加载状态
    await new Promise((r) => setTimeout(r, 400));
    $('loading').style.display = 'none';
    renderResult({ ...data, url });
  } catch (e) {
    $('loading').style.display = 'none';
    $('error-msg').textContent = e.message;
    $('error').style.display = '';
  } finally {
    $('submit-btn').disabled = false;
  }
}

// ---------- 历史记录 ----------

function renderHistory() {
  const list = loadHistory();
  $('history-list').innerHTML = list.length
    ? list.map((h, i) => `
      <div class="hist-item">
        <div class="hist-main">
          <b>${esc(h.title || h.url || '未命名')}</b>
          <div class="muted">${esc(h.url || '手动粘贴')} · ${MODE_NAMES[h.mode] || h.mode} · ${new Date(h.at).toLocaleString('zh-CN')}</div>
          ${h.summary ? `<div class="muted" style="margin-top:4px">${esc(h.summary.slice(0, 80))}${h.summary.length > 80 ? '…' : ''}</div>` : ''}
        </div>
        <div class="hist-ops">
          <button class="btn-ghost" data-open="${i}">打开</button>
          <button class="btn-ghost" data-del="${i}">删除</button>
        </div>
      </div>`).join('')
    : '<div class="muted" style="padding:24px;text-align:center">暂无历史记录</div>';
}

function bindHistory() {
  $('history-btn').addEventListener('click', () => { renderHistory(); $('history-modal').style.display = 'flex'; });
  $('modal-close').addEventListener('click', () => { $('history-modal').style.display = 'none'; });
  $('history-modal').addEventListener('click', (e) => { if (e.target === $('history-modal')) $('history-modal').style.display = 'none'; });
  $('history-list').addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    const del = e.target.closest('[data-del]');
    const list = loadHistory();
    if (del) { list.splice(Number(del.dataset.del), 1); localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); renderHistory(); return; }
    if (open) {
      const h = list[Number(open.dataset.open)];
      $('history-modal').style.display = 'none';
      if (h.url) $('url-input').value = h.url; else $('text-input').value = h.text || '';
      $('mode-select').value = h.mode || 'summary';
      renderResult({ ...h, content: h.content || h.text || '', url: h.url, mode: h.mode, wordCount: h.wordCount, truncated: h.truncated, ai: h.ai, result: h.result });
    }
  });
}

// ---------- 事件绑定 ----------

function bind() {
  $('submit-btn').addEventListener('click', submit);
  $('clear-btn').addEventListener('click', () => { $('url-input').value = ''; $('text-input').value = ''; $('hint').textContent = ''; $('error').style.display = 'none'; $('result').style.display = 'none'; current = null; pastedTitle = ''; });
  $('url-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  $('url-input').addEventListener('input', () => {
    const v = $('url-input').value.trim();
    if (!v) { pastedTitle = ''; $('hint').textContent = ''; return; }
    if (!/^https?:\/\//i.test(v)) {
      const extracted = extractUrlFromText(v);
      if (extracted && v.length > extracted.length) {
        const idx = v.indexOf(extracted);
        pastedTitle = (idx > 0 ? v.slice(0, idx) : '').replace(/[\s|:：，。;；\-—_]+$/g, '').slice(0, 60);
        $('url-input').value = extracted;
        $('hint').textContent = `已自动识别链接：${extracted}${pastedTitle ? `；标题「${pastedTitle}」将作为参考` : ''}`;
        return;
      }
    }
    pastedTitle = '';
    $('hint').textContent = '';
  });
  $('copy-btn').addEventListener('click', async () => {
    if (!current) return;
    const r = current.result || {};
    const txt = `${r.title || ''}\n\n${r.summary || ''}\n\n关键信息：\n${(r.keyPoints || []).join('\n')}`;
    try { await navigator.clipboard.writeText(txt); toast('已复制'); } catch { toast('复制失败，请手动选择'); }
  });
  $('md-btn').addEventListener('click', exportMarkdown);
  $('save-btn').addEventListener('click', () => {
    if (!current) return;
    const r = current.result || {};
    saveHistoryItem({ url: current.url, text: current.text || '', mode: current.mode, title: r.title || current.title, summary: r.summary, wordCount: current.wordCount, truncated: current.truncated, ai: current.ai, content: current.content || '', result: r });
    toast('已保存到历史');
  });
  $('text-input').addEventListener('input', () => {
    const n = $('text-input').value.length;
    $('hint').textContent = n ? `已粘贴 ${n} 字（粘贴文本优先于链接）` : '';
  });
  bindHistory();
}

function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2000);
}

bind();
