// 老师的话怎么排（私人老师对话，CONTRACTS 14-17）：提示词让模型写短句、行内公式 \( \)、最多 4 条“- ”开头的要点，
// 不用标题、表格、加粗。模型偶尔还是会写，这里一律收成干净的段落和列表，公式交给 mathview.renderText。
// 负责：接线的人（v0.3 的 chat-ui agent 没交付，接线时补写）。纯函数，node 能测，不碰 document。
//
// 导出
//   blocks(text) -> [{ type: 'p', text } | { type: 'ul' | 'ol', items: [text] }]
//     每一行一段（她在 iPad 上读，短行比长段好读）；“- ”“• ”“* ”开头的连着几行是一个列表；“1. ”“1、”“(1)”开头是有序列表。
//     **加粗**、__加粗__ 去掉记号留字；“# 标题”去掉井号；表格的竖线行变成一行字；``` 围栏去掉。
//   renderMessage(text) -> HTML 字符串   每段过 renderText（它先转义），所以模型的字不会变成标签
//   plainMessage(text) -> 字符串         摘要、对话标题用：公式变成读得懂的字，去掉记号
import { renderText, plain } from './mathview.js';

const BULLET = /^\s*(?:[-•*·]|•)\s+(.*)$/;
// “3.5 是小数”不是列表：点后面紧跟数字的是小数点
const NUMBERED = /^\s*(?:\d{1,2}(?:[.．](?!\d)|[、)])|[（(]\d{1,2}[)）])\s*(.*)$/;

function tidy(line) {
  return String(line)
    .replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*\|(.*)\|\s*$/, (_, row) => row.split('|').map(s => s.trim()).filter(Boolean).join('　'))
    .replace(/\s+$/, '');
}

export function blocks(text) {
  const out = [];
  let list = null;
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  for (const raw of lines) {
    if (/^\s*```/.test(raw)) continue;                         // 代码围栏
    if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(raw)) continue;   // 表格的分隔行
    if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(raw)) continue;   // 分隔线 --- ***
    const b = BULLET.exec(raw), n = b ? null : NUMBERED.exec(raw);
    if (b || n) {
      const type = b ? 'ul' : 'ol';
      const item = tidy((b || n)[1]);
      if (!item) continue;
      if (!list || list.type !== type) { list = { type, items: [] }; out.push(list); }
      list.items.push(item);
      continue;
    }
    const t = tidy(raw);
    if (!t.trim()) { list = null; continue; }
    list = null;
    out.push({ type: 'p', text: t.trim() });
  }
  return out;
}

export function renderMessage(text) {
  return blocks(text).map(b => {
    if (b.type === 'p') return `<p>${renderText(b.text)}</p>`;
    return `<${b.type}>${b.items.map(i => `<li>${renderText(i)}</li>`).join('')}</${b.type}>`;
  }).join('');
}

export function plainMessage(text) {
  return blocks(text).map(b => (b.type === 'p' ? plain(b.text) : b.items.map(i => plain(i)).join('；'))).join(' ').replace(/\s+/g, ' ').trim();
}
