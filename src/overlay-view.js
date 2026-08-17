"use strict";
// overlay 视图纯函数(docs/prd.md T5)。与进程/终端无关,便于单测。

// 显示宽度:ASCII 1;CJK/全角 2(覆盖常用区间,零依赖近似 wcwidth)。
function charWidth(cp) {
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||           // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0xa4cf) ||           // CJK  radicals..Yi
    (cp >= 0xac00 && cp <= 0xd7a3) ||           // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) ||           // CJK compat
    (cp >= 0xfe30 && cp <= 0xfe6f) ||           // CJK compat forms
    (cp >= 0xff00 && cp <= 0xff60) ||           // fullwidth forms
    (cp >= 0x20000 && cp <= 0x3fffd)            // CJK ext B+
  ) return 2;
  return 1;
}
function displayWidth(s) {
  let w = 0;
  for (const ch of String(s)) w += charWidth(ch.codePointAt(0));
  return w;
}

// 按显示宽度截断;超宽时末尾加 …(本身宽 1)。
function truncate(s, max) {
  s = String(s);
  if (displayWidth(s) <= max) return s;
  if (max <= 1) return "…".slice(0, max);
  let out = "", w = 0;
  for (const ch of s) {
    const cw = charWidth(ch.codePointAt(0));
    if (w + cw > max - 1) break;
    out += ch; w += cw;
  }
  return out + "…";
}

function ageLabel(iso) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return Math.floor(s) + "s";
  if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h";
  return Math.floor(s / 86400) + "d";
}

function projectOf(todo) {
  const cwd = todo.source?.cwd;
  return cwd ? cwd.split("/").filter(Boolean).pop() : null;
}

function pad(s, w) {
  const d = w - displayWidth(s);
  return d > 0 ? s + " ".repeat(d) : s;
}

// 列:id 6 | 状态 1 | agent ≤16 | 项目 ≤12 | 年龄 4 | 文本剩余。
// agent/项目列宽随总宽弹性收缩(窄 pane 见 PRD §8),文本至少 1 列。总宽 <= cols。
const OVERHEAD = 6 + 1 + 1 + 1 + 1 + 1 + 4 + 1; // id sp glyph sp sp age sp
function formatRow(todo, cols) {
  const glyph = todo.status === "done" ? "●" : "○";
  const agent = todo.source?.agent_name || "-";
  const project = projectOf(todo) || "-";
  const when = todo.status === "done" && todo.done_at ? todo.done_at : todo.created_at;
  const avail = Math.max(3, cols - OVERHEAD);
  const agentW = Math.min(16, Math.max(4, Math.floor(avail * 0.28)));
  const projW = Math.min(12, Math.max(4, Math.floor(avail * 0.22)));
  const textW = Math.max(1, avail - agentW - projW);
  return pad(truncate(todo.id, 6), 6) + " " + glyph + " " +
    pad(truncate(agent, agentW), agentW) + " " + pad(truncate(project, projW), projW) + " " +
    pad(ageLabel(when), 4) + " " + truncate(todo.text, textW);
}

// 游标居中窗口:返回 [start, end)。
function visibleWindow(total, cursor, capacity) {
  if (total <= capacity) return [0, total];
  let start = Math.min(Math.max(0, cursor - Math.floor(capacity / 2)), total - capacity);
  return [start, start + capacity];
}

module.exports = { displayWidth, truncate, formatRow, visibleWindow, ageLabel, projectOf };
