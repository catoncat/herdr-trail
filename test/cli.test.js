"use strict";
// CLI 行为测试(docs/prd.md T1/T2/T7,验收 1/4)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const BIN = path.join(__dirname, "..", "bin", "herd-trail");

function tmpEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "herd-trail-cli-"));
  return { dir, env: { ...process.env, HERD_TRAIL_DIR: dir, HERD_TRAIL_NO_PANE_LOOKUP: "1", HERDR_PANE_ID: "", PI_CODING_AGENT: "" } };
}
function run(env, args) {
  return spawnSync(process.execPath, [BIN, ...args], { env, encoding: "utf8" });
}

test("add 输出 id+文本;list 默认只见 open;done 后需 --all", () => {
  const { env } = tmpEnv();
  const a = run(env, ["add", "给 m1 清容器"]);
  assert.equal(a.status, 0, a.stderr);
  assert.match(a.stdout, /^t-[0-9a-z]{4}\s+给 m1 清容器/);
  const id = a.stdout.trim().split(/\s+/)[0];

  let l = run(env, ["list"]);
  assert.match(l.stdout, /给 m1 清容器/);

  const d = run(env, ["done", id]);
  assert.equal(d.status, 0, d.stderr);
  l = run(env, ["list"]);
  assert.doesNotMatch(l.stdout, /给 m1 清容器/);
  l = run(env, ["list", "--all"]);
  assert.match(l.stdout, /给 m1 清容器/);
  assert.match(l.stdout, /done/);
});

test("list --json 可解析;--agent/--project 过滤", () => {
  const { env, dir } = tmpEnv();
  run(env, ["add", "条目甲"]);
  const j = run(env, ["list", "--json"]);
  assert.equal(j.status, 0);
  const arr = JSON.parse(j.stdout);
  assert.equal(arr.length, 1);
  assert.equal(arr[0].text, "条目甲");
  assert.equal(arr[0].status, "open");
  // 过滤:无匹配 → 空
  const f = run(env, ["list", "--agent", "nobody"]);
  assert.doesNotMatch(f.stdout, /条目甲/);
});

test("show 显示溯源全字段", () => {
  const { env } = tmpEnv();
  const a = run(env, ["add", "溯源测试"]);
  const id = a.stdout.trim().split(/\s+/)[0];
  const s = run(env, ["show", id]);
  assert.equal(s.status, 0);
  for (const key of ["id", "text", "status", "created_at", "kind", "cwd"]) {
    assert.match(s.stdout, new RegExp(key));
  }
});

test("undo/rm + 未找到报错", () => {
  const { env } = tmpEnv();
  const a = run(env, ["add", "临时"]);
  const id = a.stdout.trim().split(/\s+/)[0];
  assert.equal(run(env, ["done", id]).status, 0);
  assert.equal(run(env, ["undo", id]).status, 0);
  assert.match(run(env, ["list"]).stdout, /临时/);
  assert.equal(run(env, ["rm", id]).status, 0);
  assert.doesNotMatch(run(env, ["list", "--all"]).stdout, /临时/);
  const bad = run(env, ["done", "t-zzzz"]);
  assert.notEqual(bad.status, 0);
});

test("add 空文本 → 非零退出", () => {
  const { env } = tmpEnv();
  const r = run(env, ["add", ""]);
  assert.notEqual(r.status, 0);
});

test("path 打印数据文件路径", () => {
  const { env, dir } = tmpEnv();
  const r = run(env, ["path"]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), path.join(dir, "todos.json"));
});

test("真并发:20 个并行 add 进程无丢条、id 唯一(验收 4)", async () => {
  const { env, dir } = tmpEnv();
  const procs = [];
  for (let i = 0; i < 20; i++) {
    procs.push(new Promise((resolve) => {
      const p = spawn(process.execPath, [BIN, "add", "并行-" + i], { env, encoding: "utf8" });
      let out = "", err = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (err += d));
      p.on("close", (code) => resolve({ code, out, err }));
    }));
  }
  const results = await Promise.all(procs);
  for (const r of results) assert.equal(r.code, 0, r.err);
  const data = JSON.parse(fs.readFileSync(path.join(dir, "todos.json"), "utf8"));
  assert.equal(data.todos.length, 20);
  assert.equal(new Set(data.todos.map((t) => t.id)).size, 20);
  assert.equal(new Set(data.todos.map((t) => t.text)).size, 20);
});
