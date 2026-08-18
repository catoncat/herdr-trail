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

const { planJump, herdrRunner, resolveWorkspace } = require("./jump.js");

const herdr = process.env.HERDR_BIN_PATH ?? "herdr";
const BIN = path.join(__dirname, "..", "bin", "herd-trail");
const FILE = store.storeFile(store.resolveStoreDir());

// ---------- state ----------
let rows = [];          // 当前可见(过滤+排序后)的 todo
let cursor = 0;
let mode = "normal";    // normal | add | confirm-del | filter
let input = "";         // add/filter 的行缓冲
let filter = "";        // 已生效的过滤串
let status = "";        // 底部状态行
let pollTimer = null;
let lastMtime = 0;

// ---------- data ----------
function reload() {
  const data = store.readStore(FILE);
  let list = todos.listTodos(data, { all: true });
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

function render() {
  const cols = out.columns || 80;
  const lines = out.rows || 24;
  out.write("\x1b[2J\x1b[H");
  const head = " Trail — herd 全局 todolist" + (filter ? "  /" + filter + "/" : "");
  out.write(BOLD + view.truncate(head, cols) + RESET + "\r\n");
  // 高度自适应:矮 pane 依次砍 help、详情行,保 header+列表+状态(窄屏适配,PRD §8)
  const showHelp = lines >= 6;
  const showDetail = lines >= 8 && mode === "normal" && rows.length > 0;
  if (showHelp) {
    out.write(DIM + view.truncate(" j/k 移动 · enter 跳源 · d done切换 · x 删除 · a 新建 · / 过滤 · r 刷新 · q 退出", cols) + RESET + "\r\n");
  }

  const capacity = Math.max(1, lines - 2 - (showHelp ? 1 : 0) - (showDetail ? 1 : 0));
  const [start, end] = view.visibleWindow(rows.length, cursor, capacity);
  for (let i = start; i < end; i++) {
    const row = view.formatRow(rows[i], cols);
    const dim = rows[i].status === "done" ? DIM : "";
    out.write((i === cursor ? INVERT + view.truncate(row, cols) + RESET : dim + view.truncate(row, cols) + RESET) + "\r\n");
  }
  if (!rows.length) out.write(DIM + "  (空 — 按 a 新建)" + RESET + "\r\n");

  // 选中条详情(全文+溯源),窄屏兜底
  const sel = rows[cursor];
  if (sel && showDetail) {
    const src = sel.source ?? {};
    const detail = " " + sel.id + " " + sel.text + "  [" + src.kind + (src.agent_name ? " · " + src.agent_name : "") + (src.pi_session_id ? " · session " + src.pi_session_id.slice(0, 8) : "") + "]";
    out.write(DIM + view.truncate(detail, cols) + RESET + "\r\n");
  }

  if (mode === "add") out.write(" add> " + input + "\r\n");
  else if (mode === "filter") out.write(" filter> " + input + "\r\n");
  else if (mode === "confirm-del" && sel) out.write(" 确认删除 " + sel.id + " 「" + view.truncate(sel.text, Math.max(1, cols - 20)) + "」?(y/n)\r\n");
  if (status) out.write(DIM + view.truncate(" " + status, cols) + RESET + "\r\n");
}

// ---------- jump ----------
function jumpSelected() {
  const sel = rows[cursor];
  if (!sel) return;
  try {
    const plan = planJump(sel, {
      runner: herdrRunner(),
      fileExists: (p) => fs.existsSync(p),
      currentWorkspace: resolveWorkspace(),
    });
    if (plan.note === "none") { status = "该条无源可跳(herdr 外手动记录)"; return render(); }
    spawn(process.execPath, [BIN, "open", sel.id, "--delay", "400"], {
      detached: true, stdio: "ignore", env: process.env,
    }).unref();
    quit(0);
  } catch (e) { status = "跳源失败: " + e.message; render(); }
}

// ---------- input ----------
const decoder = new (require("node:string_decoder").StringDecoder)("utf8");
process.stdin.on("data", (buf) => {
  if (_firstData) { _firstData = false; process.stderr.write("HERD_TRAIL: stdin alive, first byte 0x" + buf[0]?.toString(16) + "\n"); }
  const s = decoder.write(buf);
  if (mode === "add" || mode === "filter") {
    for (const ch of s) {
      if (ch === "\r" || ch === "\n") {
        const val = input; input = "";
        if (mode === "add" && val.trim()) {
          try { todos.addTodo(FILE, val, humanSource()); status = "已记录"; }
          catch (e) { status = e.message; }
        }
        if (mode === "filter") filter = val;
        mode = "normal"; reload(); return render();
      }
      if (ch === "\x1b") { input = ""; mode = "normal"; return render(); }
      if (ch === "\x7f" || ch === "\b") { input = [...input].slice(0, -1).join(""); render(); continue; }
      if (ch >= " " || ch > "\u007f") { input += ch; render(); }
    }
    return;
  }
  // 按键可能在一个 data 事件里成批到达("jj"、j 紧跟 enter),逐字符解析;
  // 方向键是 \x1b[A/\x1b[B 序列,先匹配序列再落单字符。
  for (let i = 0; i < s.length;) {
    if (s.startsWith("\x1b[A", i) || s.startsWith("\x1bOA", i)) { i += 3; handleKey("up"); continue; }
    if (s.startsWith("\x1b[B", i) || s.startsWith("\x1bOB", i)) { i += 3; handleKey("down"); continue; }
    const ch = s[i++];
    if (ch === "\x1b" && i < s.length && s[i] === "[") continue; // 未知序列开头,跳过
    handleKey(ch);
  }
});

function handleKey(ch) {
  if (mode === "confirm-del") {
    if (ch === "y" || ch === "Y") {
      try { todos.removeTodo(FILE, rows[cursor].id); status = "已删除"; }
      catch (e) { status = e.message; }
      mode = "normal"; reload(); return render();
    }
    mode = "normal"; status = ""; return render();
  }
  if (ch === "q" || ch === "\x1b" || ch === "\x03") return quit(0);
  if (ch === "up" || ch === "k" || ch === "K") { cursor = Math.max(0, cursor - 1); return render(); }
  if (ch === "down" || ch === "j" || ch === "J") { cursor = Math.min(rows.length - 1, cursor + 1); return render(); }
  if (ch === "\r" || ch === "\n") return jumpSelected();
  if (ch === "d" && rows[cursor]) {
    const t = rows[cursor];
    try { todos.setStatus(FILE, t.id, t.status === "done" ? "open" : "done"); }
    catch (e) { status = e.message; }
    reload(); return render();
  }
  if (ch === "x" && rows[cursor]) { mode = "confirm-del"; return render(); }
  if (ch === "a") { mode = "add"; input = ""; status = ""; return render(); }
  if (ch === "/") { mode = "filter"; input = filter; status = ""; return render(); }
  if (ch === "r") { reload(); status = "已刷新"; return render(); }
}

// ---------- poll + main ----------
pollTimer = setInterval(() => {
  let m = 0;
  try { m = fs.statSync(FILE).mtimeMs; } catch { /* 文件可能尚未创建 */ }
  if (m !== lastMtime) { reload(); if (mode === "normal") render(); }
}, 2000);

reload();
enterUi();
render();
process.on("SIGWINCH", () => render()); // 终端 resize 即时重绘
process.on("SIGTERM", () => quit(0));
process.on("SIGINT", () => quit(0));
