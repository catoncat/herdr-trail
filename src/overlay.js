#!/usr/bin/env node
// Trail overlay — 全局清单 TUI(docs/prd.md T5)。
// 零依赖裸 ANSI(参考 pane-mover):alt screen + raw 键控 + 2s mtime 轮询。
// 读写经 src/store.js + src/todos.js(mkdir 锁+原子写),与 CLI 同一事实源。
// enter 跳源:计划是只读探测,可以在 overlay 开着时做;执行走
//   `herd-trail open <id> --delay 400` detached —— 等 overlay 关闭、布局恢复后再跑。
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const store = require("./store.js");
const todos = require("./todos.js");
const view = require("./overlay-view.js");
const { KeyParser, LineEditor } = require("./lineedit.js");

const { planJump, herdrRunner, resolveWorkspace } = require("./jump.js");

const herdr = process.env.HERDR_BIN_PATH ?? "herdr";
const BIN = path.join(__dirname, "..", "bin", "herd-trail");
const FILE = store.storeFile(store.resolveStoreDir());

// ---------- state ----------
// 上下文优先(P1):打开时用户所在 pane 的 cwd → 当前项目名;同状态层内该项目条目置顶。
// ctx.focused_pane_cwd 字段名经 herdr 0.8.0 二进制 strings 确认。
let currentProject = null;
try {
  const ctx = JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON ?? "{}");
  currentProject = todos.projectNameForCwd(ctx.focused_pane_cwd ?? ctx.workspace_cwd ?? null);
} catch { /* 非 herdr 环境(调试直跑)→ 无上下文 */ }
let rows = [];          // 当前可见(过滤+排序后)的 todo
let counts = { open: 0, done: 0 };
let cursor = 0;
let mode = "normal";    // normal | detail | add | edit | confirm-del | filter
let editor = new LineEditor();
let filter = "";        // 已生效的过滤串
let groupMode = "none"; // none | project | age —— g 循环
let status = "";        // 底部状态行
let editReturn = "normal";   // edit 提交/取消后回到哪(normal|detail)
let confirmReturn = "normal";
let pollTimer = null;
let lastMtime = 0;
const keyParser = new KeyParser();

// ---------- data ----------
function reload() {
  const data = store.readStore(FILE);
  const all = todos.listTodos(data, { all: true, prioritize: currentProject });
  counts = { open: all.filter((t) => t.status === "open").length, done: all.filter((t) => t.status === "done").length };
  let list = all;
  if (filter) {
    const f = filter.toLowerCase();
    list = list.filter((t) =>
      [t.id, t.text, t.source?.agent_name ?? "", view.projectOf(t) ?? ""]
        .join("\n").toLowerCase().includes(f));
  }
  rows = list;
  if (cursor >= rows.length) cursor = Math.max(0, rows.length - 1);
  try { lastMtime = fs.statSync(FILE).mtimeMs; } catch { lastMtime = 0; }
}

// 人从 overlay 新建:kind=human-shell;cwd 取 workspace 上下文,拿不到就空
// (overlay 进程 cwd=plugin_root,记它没有意义)。
function humanSource() {
  let cwd = null;
  try {
    const ctx = JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON ?? "{}");
    cwd = ctx.workspace_cwd ?? ctx.focused_pane_cwd ?? null;
  } catch { /* fall */ }
  return { kind: "human-shell", agent_name: null, pane_id: null, workspace_id: null, tab_id: null, cwd, pi_session_id: null, pi_session_file: null };
}

// ---------- ui ----------
const out = process.stdout;
const BOLD = "\x1b[1m", DIM = "\x1b[2m", INVERT = "\x1b[7m", RESET = "\x1b[0m";
const GREEN = "\x1b[32m", CYAN = "\x1b[36m", YELLOW = "\x1b[33m";

function enterUi() {
  out.write("\x1b[?1049h\x1b[?25l");
  process.stdin.setRawMode(true);
  process.stdin.resume();
}
function leaveUi() {
  out.write("\x1b[?25h\x1b[?1049l");
  try { process.stdin.setRawMode(false); } catch { /* gone */ }
}
function closeOverlayPane() {
  // herdr 0.8.0:plugin pane close 接收 pane_id 位置参数(--plugin/--entrypoint 是旧写法,
  // 实测 0.8.0 报错 → popup 槽位卡住 "popup already open")
  const self = process.env.HERDR_PANE_ID;
  if (self) spawnSync(herdr, ["plugin", "pane", "close", self]);
}
function quit(code) {
  clearInterval(pollTimer);
  leaveUi();
  closeOverlayPane();
  process.exit(code);
}

const HELP = {
  normal: " j/k 移动 · enter 跳源 · ! 送达 · o 详情 · g 分组 · a 新建 · e 编辑 · d done · x 删除 · / 过滤 · c 清过滤 · q 退出",
  detail: " enter 跳源 · ! 送达 · e 编辑 · d done · x 删除 · ←/q 返回列表",
  input:  " enter 确认 · esc 取消 · ←/→ 移动 · ctrl+u 清空",
};

function render() {
  const cols = out.columns || 80;
  const lines = out.rows || 24;
  out.write("\x1b[2J\x1b[H");
  let rowNo = 0, inputRow = 0, inputCol = 1;
  const w = (s) => { out.write(s + "\r\n"); rowNo += 1; };

  const inDetail = mode === "detail" || (mode === "edit" && editReturn === "detail") || (mode === "confirm-del" && confirmReturn === "detail");
  const groupHint = groupMode === "project" ? " · 按项目" : groupMode === "age" ? " · 按时间" : "";
  w(BOLD + CYAN + " Trail" + RESET + DIM + "  " + counts.open + " 备忘 · " + counts.done + " 完成" + (currentProject ? " · 当前:" + currentProject : "") + groupHint + (filter ? "  /" + filter + "/" : "") + RESET);
  const showHelp = lines >= 6;
  if (showHelp) {
    const helpKey = (mode === "add" || mode === "edit" || mode === "filter") ? "input" : inDetail ? "detail" : "normal";
    w(DIM + view.truncate(HELP[helpKey], cols) + RESET);
  }

  if (inDetail) {
    const sel = rows[cursor];
    if (sel) {
      const capacity = Math.max(1, lines - rowNo - 2);
      const body = view.formatDetail(sel, cols).slice(0, capacity);
      for (const ln of body) {
        if (ln.kind === "head") w(" " + (sel.status === "done" ? GREEN : YELLOW) + ln.text + RESET);
        else if (ln.kind === "text") w(" " + ln.text);
        else if (ln.kind === "field") w(" " + DIM + ln.label + RESET + "  " + ln.value);
        else w("");
      }
    } else {
      mode = "normal"; // 条目被外部删了,退回列表
    }
  } else {
    const capacity = Math.max(1, lines - rowNo - 2);
    const sections = view.groupRows(rows, groupMode);
    const display = view.flattenGroups(sections, rows);
    const cursorPos = Math.max(0, display.findIndex((d) => d.kind === "row" && d.idx === cursor));
    const [start, end] = view.visibleWindow(display.length, cursorPos, capacity);
    for (let i = start; i < end; i++) {
      const d = display[i];
      if (d.kind === "header") {
        w(DIM + CYAN + "── " + d.text + RESET);
        continue;
      }
      const t = rows[d.idx];
      const { text, meta } = view.formatRow(t, cols);
      const gap = Math.max(1, cols - view.displayWidth(text) - view.displayWidth(meta));
      if (d.idx === cursor) {
        w(INVERT + text + " ".repeat(gap) + meta + RESET);
      } else if (t.status === "done") {
        w(DIM + text + " ".repeat(gap) + meta + RESET);
      } else {
        w(text + " ".repeat(gap) + (meta ? DIM + meta + RESET : ""));
      }
    }
    if (!rows.length) w(DIM + "  (空 — 按 a 新建)" + RESET);
  }

  if (mode === "add" || mode === "edit" || mode === "filter") {
    const label = mode === "add" ? " add> " : mode === "edit" ? " edit> " : " filter> ";
    w(label + editor.text);
    inputRow = rowNo;
    inputCol = view.displayWidth(label + editor.beforeCursor) + 1;
  } else if (mode === "confirm-del" && rows[cursor]) {
    const sel = rows[cursor];
    w(" 确认删除 " + sel.id + " 「" + view.truncate(sel.text, Math.max(1, cols - 20)) + "」?(y/n)");
  }
  if (status) w(DIM + view.truncate(" " + status, cols) + RESET);

  // 输入模式显示并定位光标;其余模式隐藏
  if (inputRow) out.write("\x1b[?25h\x1b[" + inputRow + ";" + inputCol + "H");
  else out.write("\x1b[?25l");
}

// ---------- jump ----------
function jumpSelected({ deliver = false } = {}) {
  const sel = rows[cursor];
  if (!sel) return;
  try {
    const plan = planJump(sel, {
      runner: herdrRunner(),
      fileExists: (p) => fs.existsSync(p),
      currentWorkspace: resolveWorkspace(),
    });
    if (plan.note === "none") { status = "该条无源可跳(herdr 外手动记录)"; return render(); }
    const args = [BIN, "open", sel.id, "--delay", "400"];
    if (deliver) args.push("--deliver");
    spawn(process.execPath, args, {
      detached: true, stdio: "ignore", env: process.env,
    }).unref();
    quit(0);
  } catch (e) { status = (deliver ? "送达失败: " : "跳源失败: ") + e.message; render(); }
}

// ---------- input ----------

process.stdin.on("data", (buf) => {
  for (const k of keyParser.feed(buf)) dispatchKey(k);
});

function submitInput() {
  const val = editor.text; editor = new LineEditor();
  if (mode === "add" && val.trim()) {
    try { todos.addTodo(FILE, val, humanSource()); status = "已记录"; }
    catch (e) { status = e.message; }
  } else if (mode === "edit" && val.trim()) {
    try { todos.updateTodo(FILE, rows[cursor].id, val); status = "已更新"; }
    catch (e) { status = e.message; }
  }
  if (mode === "filter") filter = val;
  mode = mode === "edit" ? editReturn : "normal";
  reload(); render();
}

function cancelInput() {
  editor = new LineEditor();
  mode = mode === "edit" ? editReturn : "normal";
  render();
}

function dispatchKey(k) {
  if (mode === "add" || mode === "edit" || mode === "filter") {
    if (k.t === "enter") return submitInput();
    if (k.t === "esc") return cancelInput();
    if (k.t === "up" || k.t === "down") return; // 行编辑无历史,忽略
    if (editor.apply(k)) render();
    return;
  }
  if (mode === "confirm-del") {
    if (k.t === "char" && (k.ch === "y" || k.ch === "Y")) {
      try { todos.removeTodo(FILE, rows[cursor].id); status = "已删除"; }
      catch (e) { status = e.message; }
      mode = "normal"; reload(); return render();
    }
    mode = confirmReturn; status = ""; return render();
  }
  // normal / detail 共用操作键
  if (k.t === "ctrl" && k.key === "c") return quit(0);
  if (mode === "detail") {
    if (k.t === "esc" || k.t === "left" || (k.t === "char" && (k.ch === "q" || k.ch === "h"))) { mode = "normal"; return render(); }
  } else {
    if (k.t === "char" && k.ch === "q") return quit(0);
    if (k.t === "esc") {
      if (filter) { filter = ""; status = "已清除过滤"; reload(); return render(); }
      return quit(0);
    }
    if ((k.t === "char" && (k.ch === "o" || k.ch === "l" || k.ch === " ")) || k.t === "right") {
      if (!rows[cursor]) return;
      mode = "detail"; status = ""; return render();
    }
  }
  if (k.t === "up" || (k.t === "char" && (k.ch === "k" || k.ch === "K"))) {
    if (mode === "detail") return; cursor = Math.max(0, cursor - 1); return render();
  }
  if (k.t === "down" || (k.t === "char" && (k.ch === "j" || k.ch === "J"))) {
    if (mode === "detail") return; cursor = Math.min(rows.length - 1, cursor + 1); return render();
  }
  if (k.t === "enter") return jumpSelected();
  if (k.t === "char" && k.ch === "!") return jumpSelected({ deliver: true });
  if (k.t === "char" && k.ch === "d" && rows[cursor]) {
    const t = rows[cursor];
    try { todos.setStatus(FILE, t.id, t.status === "done" ? "open" : "done"); }
    catch (e) { status = e.message; }
    reload(); return render();
  }
  if (k.t === "char" && k.ch === "x" && rows[cursor]) {
    confirmReturn = mode; mode = "confirm-del"; return render();
  }
  if (k.t === "char" && k.ch === "e" && rows[cursor]) {
    editReturn = mode; mode = "edit"; editor = new LineEditor(rows[cursor].text); status = ""; return render();
  }
  if (k.t === "char" && k.ch === "a" && mode === "normal") {
    mode = "add"; editor = new LineEditor(); status = ""; return render();
  }
  if (k.t === "char" && k.ch === "/" && mode === "normal") {
    mode = "filter"; editor = new LineEditor(filter); status = ""; return render();
  }
  if (k.t === "char" && k.ch === "g" && mode === "normal") {
    groupMode = groupMode === "none" ? "project" : groupMode === "project" ? "age" : "none";
    return render();
  }
  if (k.t === "char" && k.ch === "c" && mode === "normal" && filter) {
    filter = ""; status = "已清除过滤"; reload(); return render();
  }
  if (k.t === "char" && k.ch === "r") { reload(); status = "已刷新"; return render(); }
}

// ---------- poll + main ----------
pollTimer = setInterval(() => {
  let m = 0;
  try { m = fs.statSync(FILE).mtimeMs; } catch { /* 文件可能尚未创建 */ }
  if (m !== lastMtime) { reload(); if (mode === "normal" || mode === "detail") render(); }
}, 2000);

reload();
enterUi();
render();
process.on("SIGWINCH", () => render()); // 终端 resize 即时重绘
process.on("SIGTERM", () => quit(0));
process.on("SIGINT", () => quit(0));
