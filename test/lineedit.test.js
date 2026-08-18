"use strict";
// lineedit:UTF-8 按键解析 + 行编辑器(中文乱码/方向键退出编辑的回归测试)
const test = require("node:test");
const assert = require("node:assert/strict");
const { KeyParser, LineEditor } = require("../src/lineedit.js");

test("KeyParser: 中文按 UTF-8 解码为单字符(曾 latin1 乱码)", () => {
  const p = new KeyParser();
  const keys = p.feed(Buffer.from("体验测试", "utf8"));
  assert.deepEqual(keys.map((k) => k.ch), ["体", "验", "测", "试"]);
});

test("KeyParser: 多字节字符跨 chunk 拼接", () => {
  const p = new KeyParser();
  const b = Buffer.from("体", "utf8"); // 3 字节
  assert.deepEqual(p.feed(b.subarray(0, 1)), []);
  assert.deepEqual(p.feed(b.subarray(1, 2)), []);
  const keys = p.feed(b.subarray(2));
  assert.equal(keys.length, 1);
  assert.equal(keys[0].ch, "体");
});

test("KeyParser: 方向键是完整序列,不产生 esc(曾按 ← 退出编辑)", () => {
  const p = new KeyParser();
  for (const [seq, t] of [["\x1b[D", "left"], ["\x1b[C", "right"], ["\x1b[A", "up"], ["\x1b[B", "down"], ["\x1bOD", "left"], ["\x1b[H", "home"], ["\x1b[F", "end"], ["\x1b[3~", "delete"]]) {
    const keys = p.feed(Buffer.from(seq, "latin1"));
    assert.equal(keys.length, 1, seq);
    assert.equal(keys[0].t, t, seq);
  }
});

test("KeyParser: 裸 Esc 单字节即 esc;半截序列缓存待续", () => {
  const p = new KeyParser();
  assert.deepEqual(p.feed(Buffer.from("\x1b", "latin1")), [{ t: "esc" }]);
  const p2 = new KeyParser();
  assert.deepEqual(p2.feed(Buffer.from("\x1b[", "latin1")), []); // 半截,等下一字节
  assert.deepEqual(p2.feed(Buffer.from("D", "latin1")), [{ t: "left" }]);
});

test("KeyParser: tab is its own key, not ctrl+i", () => {
  const p = new KeyParser();
  assert.deepEqual(p.feed(Buffer.from("\t")), [{ t: "tab" }]);
});

test("KeyParser: 混合输入逐键分发(成批到达)", () => {
  const p = new KeyParser();
  const keys = p.feed(Buffer.from("ab\x1b[D\r", "latin1"));
  assert.deepEqual(keys.map((k) => k.t), ["char", "char", "left", "enter"]);
});

test("LineEditor: 光标移动/插入/删除", () => {
  const e = new LineEditor("hello");
  assert.equal(e.cur, 5);
  e.apply({ t: "left" }); e.apply({ t: "left" });
  e.apply({ t: "char", ch: "X" });
  assert.equal(e.text, "helXlo");
  e.apply({ t: "backspace" });
  assert.equal(e.text, "hello");
  e.apply({ t: "delete" });
  assert.equal(e.text, "helo");
  e.apply({ t: "home" }); e.apply({ t: "char", ch: ">" });
  assert.equal(e.text, ">helo");
  e.apply({ t: "end" });
  assert.equal(e.cur, 5);
});

test("LineEditor: 中文按码点移动(不按字节)", () => {
  const e = new LineEditor("清理容器");
  assert.equal(e.cur, 4);
  e.apply({ t: "left" }); e.apply({ t: "left" });
  e.apply({ t: "char", ch: "X" });
  assert.equal(e.text, "清理X容器");
  e.apply({ t: "backspace" });
  assert.equal(e.text, "清理容器");
});

test("LineEditor: ctrl 组合(a/e/u/k/w)", () => {
  const e = new LineEditor("foo bar baz");
  e.apply({ t: "ctrl", key: "w" });
  assert.equal(e.text, "foo bar ");
  e.apply({ t: "ctrl", key: "a" });
  e.apply({ t: "ctrl", key: "k" });
  assert.equal(e.text, "");
  e.apply({ t: "char", ch: "x" });
  e.apply({ t: "ctrl", key: "u" });
  assert.equal(e.text, "");
  // 非编辑键不吞
  assert.equal(e.apply({ t: "esc" }), false);
  assert.equal(e.apply({ t: "up" }), false);
});

test("LineEditor: beforeCursor 供光标定位(含 CJK 宽度)", () => {
  const e = new LineEditor("ab清理");
  e.apply({ t: "left" });
  assert.equal(e.beforeCursor, "ab清");
});
