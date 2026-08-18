"use strict";
// overlay 视图纯函数测试(docs/prd.md T5;窄 pane 截断见 §8)
const test = require("node:test");
const assert = require("node:assert/strict");
const { displayWidth, truncate, formatRow, formatDetail, wrapText, visibleWindow, groupRows, flattenGroups } = require("../src/overlay-view.js");

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

test("formatRow: 状态符+文本为主体,agent/项目/年龄在 meta;编号不进列表", () => {
  const { text, meta } = formatRow(T, 80);
  assert.ok(displayWidth(text) + displayWidth(meta) <= 80);
  assert.match(text, /○/);
  assert.match(text, /m1 恢复后清理容器/);
  assert.doesNotMatch(text + meta, /t-a3f9/); // 编号不展示
  assert.match(meta, /Fix Startup/);
  assert.match(meta, /herdr-trail/);
  assert.match(meta, /2h/);
});

test("formatRow: 窄屏只保 状态+文本,总宽不溢出(窄屏适配)", () => {
  for (const cols of [80, 40, 30, 24, 20, 16]) {
    const { text, meta } = formatRow(T, cols);
    assert.ok(displayWidth(text) + displayWidth(meta) <= cols, "cols=" + cols);
  }
  const r = formatRow(T, 20);
  assert.equal(r.meta, "");
  assert.match(r.text, /○/);
});

test("formatRow: done 条目用 ●;无 agent/项目时 meta 只有年龄", () => {
  const done = { ...T, status: "done", done_at: new Date().toISOString(), source: { kind: "human-shell", agent_name: null, cwd: null } };
  const { text, meta } = formatRow(done, 80);
  assert.match(text, /●/);
  assert.equal(meta, "0s");
});

test("wrapText: 按显示宽度折行,西文优先空格断行", () => {
  assert.deepEqual(wrapText("hello world foo", 11), ["hello world", "foo"]);
  assert.deepEqual(wrapText("清理容器镜像缓存", 5), ["清理", "容器", "镜像", "缓存"]);
  assert.deepEqual(wrapText("abc", 10), ["abc"]);
  assert.deepEqual(wrapText("", 10), [""]);
});

test("formatDetail: 含状态头/全文/溯源字段/时间", () => {
  const lines = formatDetail(T, 60);
  const joined = lines.map((l) => l.text).join("\n");
  assert.match(joined, /○ open · t-a3f9/);
  assert.match(joined, /m1 恢复后清理容器/);
  assert.match(joined, /来源\s+pi · Fix Startup/);
  assert.match(joined, /项目\s+herdr-trail/);
  assert.match(joined, /记录.*2h前/);
  // 长文本折行:每一行都不超宽
  const long = { ...T, text: "一段".repeat(40) + "的长文本" };
  for (const l of formatDetail(long, 40)) assert.ok(displayWidth(l.text) <= 42, "超宽: " + l.text);
});

test("groupRows: none 一段无 header;project 按首次出现序;age 按今天/本周/更早", () => {
  const now = Date.parse("2026-08-18T12:00:00Z");
  const mk = (id, created, cwd) => ({
    id, text: id, status: "open", created_at: created, done_at: null,
    source: { cwd },
  });
  const a = mk("a", "2026-08-18T10:00:00Z", "/p/herdr");
  const b = mk("b", "2026-08-12T10:00:00Z", "/p/api");
  const c = mk("c", "2026-07-01T10:00:00Z", "/p/herdr");
  const none = groupRows([a, b, c], "none");
  assert.equal(none.length, 1);
  assert.equal(none[0].header, null);
  assert.deepEqual(none[0].items.map((t) => t.id), ["a", "b", "c"]);

  const byP = groupRows([a, b, c], "project", { projectOf: (t) => t.source.cwd.split("/").pop() });
  assert.deepEqual(byP.map((s) => s.header), ["herdr", "api"]);
  assert.deepEqual(byP[0].items.map((t) => t.id), ["a", "c"]);
  assert.deepEqual(byP[1].items.map((t) => t.id), ["b"]);

  const byA = groupRows([a, b, c], "age", { now });
  assert.deepEqual(byA.map((s) => s.header), ["今天", "本周", "更早"]);
  assert.deepEqual(byA[0].items.map((t) => t.id), ["a"]);
  assert.deepEqual(byA[1].items.map((t) => t.id), ["b"]);
  assert.deepEqual(byA[2].items.map((t) => t.id), ["c"]);
});

test("flattenGroups: header 不进 idx,row.idx 指向原 rows", () => {
  const rows = [{ id: "a" }, { id: "b" }];
  const display = flattenGroups([{ header: "P", items: [rows[1], rows[0]] }], rows);
  assert.deepEqual(display, [
    { kind: "header", text: "P  (2)" },
    { kind: "row", idx: 1 },
    { kind: "row", idx: 0 },
  ]);
});

test("visibleWindow: 游标保持在窗口内", () => {
  assert.deepEqual(visibleWindow(100, 0, 10), [0, 10]);
  assert.deepEqual(visibleWindow(100, 50, 10), [45, 55]); // 游标居中
  assert.deepEqual(visibleWindow(100, 99, 10), [90, 100]);
  assert.deepEqual(visibleWindow(5, 3, 10), [0, 5]);
});
