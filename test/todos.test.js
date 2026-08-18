"use strict";
// todos.js 纯函数层:项目识别(git root 注入)+ prioritize 排序。
const test = require("node:test");
const assert = require("node:assert/strict");
const { projectOf, projectNameForCwd, listTodos } = require("../src/todos.js");

const todo = (id, cwd, { status = "open", created = "2026-08-18T00:00:00Z" } = {}) => ({
  id, text: id, status, created_at: created, done_at: null,
  source: { kind: "pi", agent_name: null, pane_id: null, workspace_id: null, tab_id: null, cwd, pi_session_id: null, pi_session_file: null },
});

test("projectOf:git root 的 basename,子目录归属仓库", () => {
  const t = todo("t-1", "/repo/libs/util");
  const gitRoot = (cwd) => (cwd.startsWith("/repo") ? "/repo" : null);
  assert.equal(projectOf(t, gitRoot), "repo");
});

test("projectOf:非仓库回退 cwd basename;无 cwd 为 null", () => {
  const noGit = () => null;
  assert.equal(projectOf(todo("t-2", "/tmp/0ghk"), noGit), "0ghk");
  assert.equal(projectOf(todo("t-3", null), noGit), null);
  assert.equal(projectNameForCwd("/a/b", () => "/a"), "a");
  assert.equal(projectNameForCwd(null), null);
});

test("listTodos prioritize:同状态层内当前项目置顶,其余保持时间序", () => {
  const data = { version: 1, todos: [
    todo("a-old", "/repo/x", { created: "2026-08-17T01:00:00Z" }),
    todo("b-new", "/other/y", { created: "2026-08-18T01:00:00Z" }),
    todo("c-mid", "/repo/z", { created: "2026-08-17T12:00:00Z" }),
    todo("d-done", "/repo/w", { status: "done", created: "2026-08-18T02:00:00Z" }),
  ]};
  const gitRoot = (cwd) => (cwd && cwd.startsWith("/repo") ? "/repo" : cwd && cwd.startsWith("/other") ? "/other" : null);
  const rows = listTodos(data, { all: true, prioritize: "repo", gitRoot });
  // open 层:repo 的两条按时间倒序在前,other 在后;done 沉底不受 prioritize 越层
  assert.deepEqual(rows.map((t) => t.id), ["c-mid", "a-old", "b-new", "d-done"]);
});
