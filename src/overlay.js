#!/usr/bin/env node
// Trail overlay — 全局清单 TUI(docs/prd.md T5)。
// 状态:占位。M3 实现:列表渲染(j/k/d/x/a/r/q)+ 2s mtime 轮询 + enter 跳源(--exec 延迟模式)。
// 参考:~/.config/herdr/plugins/github/osamahbeig.pane-mover-*/mover.js(零依赖裸 ANSI)。
"use strict";

const cols = process.stdout.columns || 80;
const line = (s = "") => s.slice(0, cols) + "\r\n";

process.stdout.write(
  "\x1b[2J\x1b[H" +
    line("  ╭─ Trail ─────────────────────────────╮") +
    line("  │  herd 全局 todolist(未实现,M3)  │") +
    line("  │  数据:bin/herd-trail path           │") +
    line("  │                                     │") +
    line("  │  q / esc 退出                       │") +
    line("  ╰─────────────────────────────────────╯")
);

process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on("data", (buf) => {
  const k = buf.toString("utf8");
  if (k === "q" || k === "\u001b") process.exit(0);
});
