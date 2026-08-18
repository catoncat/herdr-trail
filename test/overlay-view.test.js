"use strict";
// overlay 视图纯函数测试(docs/prd.md T5;窄 pane 截断见 §8)
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  displayWidth, truncate, formatRow, formatDetail, wrapText, visibleWindow,
  groupRows, flattenGroups, sourceLabel, TEXT_CAP,
  filterByStatus, statusTabs,
} = require("../src/overlay-view.js");

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

test("formatRow: 状态符+文本为主体,来源 kind/项目/年龄在 meta;编号不进列表", () => {
  const { text, meta } = formatRow(T, 80);
  assert.ok(displayWidth(text) + displayWidth(meta) <= 80);
  assert.match(text, /○/);
  assert.match(text, /m1 恢复后清理容器/);
  assert.doesNotMatch(text + meta, /t-a3f9/); // 编号不展示
  assert.doesNotMatch(text + meta, /Fix Startup/); // pane 名不进列表
  assert.match(meta, /pi/);
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

test("formatRow: done 条目用 ●;年龄用 created_at 不跳成 0s", () => {
  const done = { ...T, status: "done", done_at: new Date().toISOString(), source: { kind: "human-shell", agent_name: null, cwd: null } };
  const { text, meta } = formatRow(done, 80);
  assert.match(text, /●/);
  assert.match(meta, /human/);
  assert.match(meta, /2h/);
  assert.doesNotMatch(meta, /0s/);
});

test("formatRow: 宽屏文本列 cap,不拉满整行", () => {
  const long = { ...T, text: "x".repeat(200) };
  const { text, meta } = formatRow(long, 160);
  assert.ok(displayWidth(text) <= TEXT_CAP + 2, "text=" + displayWidth(text)); // glyph+space
  assert.ok(displayWidth(text) + displayWidth(meta) <= 160);
});

test("formatRow: hideProject 时 meta 不再重复项目名", () => {
  const { meta } = formatRow(T, 80, { hideProject: true });
  assert.doesNotMatch(meta, /herdr-trail/);
  assert.match(meta, /pi/);
  assert.match(meta, /2h/);
});

test("filterByStatus: open or done, not mixed", () => {
  const open = { ...T, status: "open" };
  const done = { ...T, id: "t-done", status: "done" };
  assert.deepEqual(filterByStatus([open, done], "open").map((t) => t.id), ["t-a3f9"]);
  assert.deepEqual(filterByStatus([open, done], "done").map((t) => t.id), ["t-done"]);
});

test("statusTabs: label then count; only one tab on", () => {
  const tabs = statusTabs("open", { open: 1, done: 2 });
  assert.deepEqual(tabs.map((t) => [t.id, t.label, t.count, t.on]), [
    ["open", "open", 1, true],
    ["done", "done", 2, false],
  ]);
});

test("sourceLabel: kind 映射,human-shell → human", () => {
  assert.equal(sourceLabel({ kind: "pi" }), "pi");
  assert.equal(sourceLabel({ kind: "grok" }), "grok");
  assert.equal(sourceLabel({ kind: "human-shell" }), "human");
  assert.equal(sourceLabel({}), "human");
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
  assert.match(joined, /from\s+pi · Fix Startup/);
  assert.match(joined, /proj\s+herdr-trail/);
  assert.match(joined, /added.*2h ago/);
  // 长文本折行:每一行都不超宽
  const long = { ...T, text: "一段".repeat(40) + "的长文本" };
  for (const l of formatDetail(long, 40)) assert.ok(displayWidth(l.text) <= 42, "超宽: " + l.text);
});

test("groupRows: time is flat; project = current first, then newest group", () => {
  const mk = (id, created, cwd) => ({
    id, text: id, status: "open", created_at: created, done_at: null,
    source: { cwd },
  });
  const herdrNew = mk("a", "2026-08-18T10:00:00Z", "/p/herdr");
  const apiOld = mk("b", "2026-08-12T10:00:00Z", "/p/api");
  const herdrOld = mk("c", "2026-07-01T10:00:00Z", "/p/herdr");
  const otherMid = mk("d", "2026-08-17T10:00:00Z", "/p/other");
  const byName = (t) => t.source.cwd.split("/").pop();
  const rows = [herdrNew, apiOld, herdrOld, otherMid];

  const flat = groupRows(rows, "time");
  assert.equal(flat.length, 1);
  assert.equal(flat[0].header, null);
  assert.deepEqual(flat[0].items.map((t) => t.id), ["a", "b", "c", "d"]);

  const byP = groupRows(rows, "project", { projectOf: byName });
  assert.deepEqual(byP.map((s) => s.header), ["herdr", "other", "api"]);

  const pinned = groupRows(rows, "project", { projectOf: byName, currentProject: "api" });
  assert.deepEqual(pinned.map((s) => s.header), ["api", "herdr", "other"]);
  assert.deepEqual(pinned[0].items.map((t) => t.id), ["b"]);
});

test("flattenGroups: header 不进 idx,row.idx 指向原 rows", () => {
  const rows = [{ id: "a" }, { id: "b" }];
  const display = flattenGroups([{ header: "P", items: [rows[1], rows[0]] }], rows);
  assert.deepEqual(display, [
    { kind: "header", text: "P" },
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
