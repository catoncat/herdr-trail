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

const { projectOf } = require("./todos.js"); // 单一实现,勿再复制

function pad(s, w) {
  const d = w - displayWidth(s);
  return d > 0 ? s + " ".repeat(d) : s;
}

// 按显示宽度贪心折行;优先在空格断行(西文),CJK 任意处可断。
function wrapText(s, width) {
  const lines = [];
  for (const raw of String(s).split("\n")) {
    let line = "", w = 0, lastSpace = -1; // lastSpace: line 中最后一个空格的码点下标
    for (const ch of raw) {
      const cw = charWidth(ch.codePointAt(0));
      if (w + cw > width) {
        if (ch === " ") { lines.push(line); line = ""; w = 0; lastSpace = -1; continue; } // 空格恰在边界→此处断行
        if (lastSpace >= 0) {
          lines.push(line.slice(0, lastSpace));
          line = line.slice(lastSpace + 1) + ch;
          w = displayWidth(line);
        } else {
          lines.push(line);
          line = ch; w = cw;
        }
        lastSpace = -1;
      } else {
        if (ch === " ") lastSpace = [...line].length;
        line += ch; w += cw;
      }
    }
    lines.push(line);
  }
  return lines;
}

// 列表来源列:用 kind(pi/grok/human),不用 pane 名。
// pane 名常是会话标题截断(多条长得一样),详情页里仍保留完整 agent_name。
function sourceLabel(src) {
  const kind = src?.kind;
  if (!kind || kind === "human-shell") return "human";
  return kind;
}

// Inbox is two tabs: open | done. Counts sit after the label so they
// never look like keybindings. Overlay always groups by project.
function filterByStatus(rows, statusFilter) {
  return rows.filter((t) => t.status === statusFilter);
}
function statusTabs(statusFilter, counts) {
  return [
    { id: "open", label: "open", count: counts.open, on: statusFilter === "open" },
    { id: "done", label: "done", count: counts.done, on: statusFilter === "done" },
  ];
}

// 列表行:状态符 + 文本(主,可扫读) + 右侧元信息(来源 · 项目 · 年龄)。
// 按项目分组时 hideProject:项目名已在 section header,行内不再重复。
// 编号(id)不进列表——不可扫读;详情页和 CLI 里有。
// 文本列 cap 80:宽屏不再把一行拉到 200 列。年龄永远用 created_at,
// 避免 done 的瞬间从 20h 跳成 0s。
// 返回 { text, meta } —— 由调用方决定拼接/配色(meta 右对齐,中间补空格)。
const TEXT_CAP = 80;
function formatRow(todo, cols, opts = {}) {
  const glyph = todo.status === "done" ? "●" : "○";
  const parts = [];
  const src = sourceLabel(todo.source);
  if (src) parts.push(src);
  if (!opts.hideProject) {
    const proj = projectOf(todo);
    if (proj) parts.push(truncate(proj, 12));
  }
  parts.push(ageLabel(todo.created_at));
  // 极窄(<24)只保 状态+文本
  if (cols < 24) {
    return { text: glyph + " " + truncate(todo.text, Math.max(1, cols - 2)), meta: "" };
  }
  // meta 分级收缩:全量 → 去来源 → 只留年龄 → 全去(保证文本至少 ~12 列)
  const candidates = [parts.join(" · "), parts.slice(1).join(" · "), parts.at(-1), ""];
  const meta = candidates.find((m) => m !== undefined && cols - 2 - (m ? displayWidth(m) + 2 : 0) >= 12) ?? "";
  const avail = Math.max(1, cols - 2 - (meta ? displayWidth(meta) + 2 : 0));
  const textW = Math.min(TEXT_CAP, avail);
  return { text: glyph + " " + truncate(todo.text, textW), meta };
}

// 详情页正文:返回 [{ kind, text }],kind ∈ head|text|field|blank。
// 样式(颜色/加粗)由 overlay.js 决定,这里只管内容与折行。
function localTime(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

function formatDetail(todo, cols) {
  const out = [];
  const w = Math.max(10, cols - 2);
  out.push({ kind: "head", text: (todo.status === "done" ? "● done" : "○ open") + " · " + todo.id });
  out.push({ kind: "blank", text: "" });
  for (const l of wrapText(todo.text, w)) out.push({ kind: "text", text: l });
  out.push({ kind: "blank", text: "" });
  const src = todo.source ?? {};
  const fields = [];
  fields.push(["from", src.kind + (src.agent_name ? " · " + src.agent_name : "")]);
  const proj = projectOf(todo);
  if (proj) fields.push(["proj", proj]);
  const loc = [src.pane_id, src.workspace_id, src.tab_id].filter(Boolean).join(" · ");
  if (loc) fields.push(["pane", loc]);
  if (src.pi_session_id) fields.push(["sess", src.pi_session_id]);
  if (src.pi_session_file) fields.push(["file", truncate(src.pi_session_file, w - 6)]);
  if (src.cwd) fields.push(["cwd", src.cwd]);
  fields.push(["added", localTime(todo.created_at) + " (" + ageLabel(todo.created_at) + " ago)"]);
  if (todo.updated_at) fields.push(["edit", localTime(todo.updated_at) + " (" + ageLabel(todo.updated_at) + " ago)"]);
  if (todo.done_at) fields.push(["done", localTime(todo.done_at) + " (" + ageLabel(todo.done_at) + " ago)"]);
  for (const [label, value] of fields) out.push({ kind: "field", label, value, text: pad(label, 4) + " " + value });
  return out;
}

// 游标居中窗口:返回 [start, end)。
function visibleWindow(total, cursor, capacity) {
  if (total <= capacity) return [0, total];
  let start = Math.min(Math.max(0, cursor - Math.floor(capacity / 2)), total - capacity);
  return [start, start + capacity];
}

// Two views: project (sectioned) or time (flat, newest-first already in rows).
// Project group order: current project first, then others by newest item.
function newestCreated(items) {
  let m = 0;
  for (const t of items) {
    const ts = Date.parse(t.created_at) || 0;
    if (ts > m) m = ts;
  }
  return m;
}
function groupRows(rows, mode, opts = {}) {
  const projOf = opts.projectOf ?? projectOf;
  if (mode === "time" || mode === "none" || !rows.length) {
    return [{ header: null, items: rows.slice() }];
  }
  const map = new Map();
  for (const t of rows) {
    const k = projOf(t) || "(no project)";
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(t);
  }
  const current = opts.currentProject;
  const keys = [...map.keys()].sort((a, b) => {
    if (current) {
      if (a === current && b !== current) return -1;
      if (b === current && a !== current) return 1;
    }
    return newestCreated(map.get(b)) - newestCreated(map.get(a));
  });
  return keys.map((header) => ({ header, items: map.get(header) }));
}

// 把分组展开成可渲染行:{kind:'header',text} | {kind:'row',idx}。idx 指向 rows 下标。
function flattenGroups(sections, rows) {
  const out = [];
  for (const sec of sections) {
    if (sec.header) out.push({ kind: "header", text: sec.header });
    for (const t of sec.items) out.push({ kind: "row", idx: rows.indexOf(t) });
  }
  return out;
}

module.exports = {
  displayWidth, truncate, formatRow, formatDetail, wrapText, visibleWindow, ageLabel,
  projectOf, groupRows, flattenGroups, sourceLabel, TEXT_CAP,
  filterByStatus, statusTabs,
};
