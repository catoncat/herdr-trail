"use strict";
// store/todos 数据层测试(docs/prd.md §3,验收 1/4)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const store = require("../src/store.js");
const todos = require("../src/todos.js");

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "herd-trail-test-"));
}
function storeFile(dir) {
  return path.join(dir, "todos.json");
}

test("readStore: 文件不存在返回空表", () => {
  const dir = tmpdir();
  const data = store.readStore(storeFile(dir));
  assert.deepEqual(data, { version: 1, todos: [] });
});

test("addTodo: 生成 t-xxxx 短 id,落库可读回", () => {
  const dir = tmpdir();
  const file = storeFile(dir);
  const src = { kind: "pi", agent_name: "a", pane_id: "w:p", workspace_id: "w", tab_id: "w:t", cwd: "/x", pi_session_id: "u", pi_session_file: "/f.jsonl" };
  const t = todos.addTodo(file, "  测试条目  ", src);
  assert.match(t.id, /^t-[0-9a-z]{4}$/);
  assert.equal(t.text, "测试条目");
  assert.equal(t.status, "open");
  assert.equal(t.done_at, null);
  assert.ok(t.created_at);
  assert.deepEqual(t.source, src);
  const back = store.readStore(file);
  assert.equal(back.todos.length, 1);
  assert.equal(back.todos[0].text, "测试条目");
});

test("addTodo: 多行/空白文本折叠为单行;空文本报错", () => {
  const dir = tmpdir();
  const file = storeFile(dir);
  const t = todos.addTodo(file, "a\nb\n   c", null);
  assert.equal(t.text, "a b c");
  assert.throws(() => todos.addTodo(file, "   ", null), /empty/i);
});

test("addTodo: source 可为空(外部来源)", () => {
  const dir = tmpdir();
  const t = todos.addTodo(storeFile(dir), "x", null);
  assert.equal(t.source.kind, "human-shell");
  assert.equal(t.source.pane_id, null);
});

test("readStore: 损坏文件自动备份并从空表重建", () => {
  const dir = tmpdir();
  const file = storeFile(dir);
  fs.writeFileSync(file, "{not json");
  const data = store.readStore(file);
  assert.deepEqual(data, { version: 1, todos: [] });
  const backups = fs.readdirSync(dir).filter((f) => f.startsWith("todos.json.corrupt-"));
  assert.equal(backups.length, 1);
  // 重建后可以继续写
  todos.addTodo(file, "恢复后", null);
  assert.equal(store.readStore(file).todos.length, 1);
});

test("done/undo/rm: 状态机流转", () => {
  const dir = tmpdir();
  const file = storeFile(dir);
  const t = todos.addTodo(file, "闭环", null);
  const d = todos.setStatus(file, t.id, "done");
  assert.equal(d.status, "done");
  assert.ok(d.done_at);
  const u = todos.setStatus(file, t.id, "open");
  assert.equal(u.status, "open");
  assert.equal(u.done_at, null);
  todos.removeTodo(file, t.id);
  assert.equal(store.readStore(file).todos.length, 0);
  assert.throws(() => todos.setStatus(file, "t-zzzz", "done"), /not found/i);
  assert.throws(() => todos.removeTodo(file, "t-zzzz"), /not found/i);
});

test("findTodo: 支持唯一前缀;歧义前缀报错", () => {
  const dir = tmpdir();
  const file = storeFile(dir);
  const a = todos.addTodo(file, "甲", null);
  const b = todos.addTodo(file, "乙", null);
  assert.equal(todos.findTodo(store.readStore(file), a.id).id, a.id);
  // 构造同前缀:直接改库
  store.withMutation(file, (data) => {
    data.todos[1].id = a.id.slice(0, 3) + "zz";
  });
  assert.throws(() => todos.findTodo(store.readStore(file), a.id.slice(0, 3)), /ambiguous/i);
  assert.equal(todos.findTodo(store.readStore(file), a.id).id, a.id);
});

test("锁:持锁期间 mutate 超时报错;stale 锁 30s 后回收", () => {
  const dir = tmpdir();
  const file = storeFile(dir);
  const lockDir = file + ".lock";
  fs.mkdirSync(lockDir);
  // 新鲜锁 → 超时
  assert.throws(
    () => store.withMutation(file, () => {}, { lockTimeoutMs: 300, lockRetryMs: 50 }),
    /lock/i
  );
  // 回拨 mtime 到 31 秒前 → stale 回收,写入成功
  const old = new Date(Date.now() - 31_000);
  fs.utimesSync(lockDir, old, old);
  todos.addTodo(file, "stale 后写入", null, { lockTimeoutMs: 1000 });
  assert.equal(store.readStore(file).todos.length, 1);
});

test("批量:20 条 add 无丢条、id 唯一(真并行见 cli.test.js)", () => {
  const dir = tmpdir();
  const file = storeFile(dir);
  const bin = path.join(__dirname, "..", "bin", "herd-trail");
  const env = { ...process.env, HERD_TRAIL_DIR: dir, HERD_TRAIL_NO_PANE_LOOKUP: "1" };
  const runs = [];
  for (let p = 0; p < 2; p++) {
    for (let i = 0; i < 10; i++) {
      runs.push(spawnSync(process.execPath, [bin, "add", "并发-" + p + "-" + i], { env, encoding: "utf8" }));
    }
  }
  for (const r of runs) assert.equal(r.status, 0, r.stderr);
  const data = store.readStore(file);
  assert.equal(data.todos.length, 20);
  assert.equal(new Set(data.todos.map((t) => t.id)).size, 20);
});
