"use strict";
// overlay 视图纯函数测试(docs/prd.md T5;窄 pane 截断见 §8)
const test = require("node:test");
const assert = require("node:assert/strict");
const { displayWidth, truncate, formatRow, visibleWindow } = require("../src/overlay-view.js");

test("displayWidth: ASCII=1,CJK=2", () => {
  assert.equal(displayWidth("abc"), 3);
  assert.equal(displayWidth("清理容器"), 8);
  assert.equal(displayWidth("a清b"), 4);
});

test("truncate: 按显示宽度截断加省略号", () => {
  assert.equal(truncate("abcdef", 10), "abcdef");
  assert.equal(truncate("abcdef", 4), "abc…");
  assert.equal(truncate("清理容器xx", 5), "清理…"); // 清理=4 + … =5
  assert.equal(truncate("abc", 3), "abc");
});

const T = {
  id: "t-a3f9", text: "m1 恢复后清理容器", status: "open",
  created_at: new Date(Date.now() - 2 * 3600e3).toISOString(), done_at: null,
  source: { kind: "pi", agent_name: "Fix Startup", cwd: "/Users/x/herdr-trail" },
};

test("formatRow: 列含 id/状态/agent/项目/年龄/文本;超宽截断", () => {
  const row = formatRow(T, 80);
  assert.ok(displayWidth(row) <= 80);
  assert.match(row, /t-a3f9/);
  assert.match(row, /○/);
  assert.match(row, /Fix Startup/);
  assert.match(row, /herdr-trail/);
  assert.match(row, /2h/);
  assert.match(row, /m1 恢复后清理容器/);
  const narrow = formatRow(T, 30);
  assert.ok(displayWidth(narrow) <= 30);
});

test("formatRow: 超窄(24/20 列)总宽仍不溢出(窄屏适配)", () => {
  for (const cols of [40, 30, 24, 20, 16]) {
    const row = formatRow(T, cols);
    assert.ok(displayWidth(row) <= cols, "cols=" + cols + " 实际宽 " + displayWidth(row) + ": " + row);
  }
  // 极窄时 id/状态/文本仍在(项目/agent 列可收缩让位)
  const r24 = formatRow(T, 24);
  assert.match(r24, /t-a3f9/);
  assert.match(r24, /○/);
});

test("formatRow: done 条目用 ●;无 agent 显示 -", () => {
  const done = { ...T, status: "done", done_at: new Date().toISOString(), source: { ...T.source, agent_name: null } };
  const row = formatRow(done, 80);
  assert.match(row, /●/);
  assert.match(row, /-/);
});

test("visibleWindow: 游标保持在窗口内", () => {
  assert.deepEqual(visibleWindow(100, 0, 10), [0, 10]);
  assert.deepEqual(visibleWindow(100, 50, 10), [45, 55]); // 游标居中
  assert.deepEqual(visibleWindow(100, 99, 10), [90, 100]);
  assert.deepEqual(visibleWindow(5, 3, 10), [0, 5]);
});
