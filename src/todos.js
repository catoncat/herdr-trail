"use strict";
// herd-trail 领域操作(docs/prd.md §3/§4)。所有写操作经 store.withMutation(锁+重读+原子落盘)。
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { readStore, withMutation, newId } = require("./store.js");

function normalizeText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function emptySource() {
  return {
    kind: "human-shell",
    agent_name: null,
    pane_id: null,
    workspace_id: null,
    tab_id: null,
    cwd: process.cwd(),
    pi_session_id: null,
    pi_session_file: null,
  };
}

function addTodo(file, text, source, opts) {
  const clean = normalizeText(text);
  if (!clean) throw new Error("herd-trail: text must not be empty");
  return withMutation(file, (data) => {
    const todo = {
      id: newId(new Set(data.todos.map((t) => t.id))),
      text: clean,
      status: "open",
      created_at: new Date().toISOString(),
      done_at: null,
      source: source ?? emptySource(),
    };
    data.todos.push(todo);
    return todo;
  }, opts);
}

// 精确 id 或唯一前缀;不存在/歧义都报错(信息里带前缀,方便 CLI 透传)。
function findTodo(data, idOrPrefix) {
  const exact = data.todos.find((t) => t.id === idOrPrefix);
  if (exact) return exact;
  const hits = data.todos.filter((t) => t.id.startsWith(idOrPrefix));
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) throw new Error("herd-trail: ambiguous id prefix '" + idOrPrefix + "' (" + hits.length + " matches)");
  throw new Error("herd-trail: todo not found: " + idOrPrefix);
}

function setStatus(file, idOrPrefix, status, opts) {
  if (status !== "done" && status !== "open") throw new Error("herd-trail: bad status " + status);
  return withMutation(file, (data) => {
    const todo = findTodo(data, idOrPrefix);
    todo.status = status;
    todo.done_at = status === "done" ? new Date().toISOString() : null;
    return todo;
  }, opts);
}

function updateTodo(file, idOrPrefix, text, opts) {
  const clean = normalizeText(text);
  if (!clean) throw new Error("herd-trail: text must not be empty");
  return withMutation(file, (data) => {
    const todo = findTodo(data, idOrPrefix);
    todo.text = clean;
    todo.updated_at = new Date().toISOString();
    return todo;
  }, opts);
}

function removeTodo(file, idOrPrefix, opts) {
  return withMutation(file, (data) => {
    const todo = findTodo(data, idOrPrefix);
    data.todos = data.todos.filter((t) => t.id !== todo.id);
    return todo;
  }, opts);
}

// 纯函数:open 在前按 created 倒序,done 沉底按 done_at 倒序;可选 agent/project 过滤。
// prioritize:当前项目名(overlay 打开时从上下文 cwd 解析)——同状态层内该项目条目置顶,不过滤。
function listTodos(data, { all = false, agent = null, project = null, prioritize = null, gitRoot = gitRootOf } = {}) {
  let rows = data.todos.slice();
  if (!all) rows = rows.filter((t) => t.status === "open");
  if (agent) rows = rows.filter((t) => (t.source?.agent_name ?? "") === agent);
  if (project) rows = rows.filter((t) => projectOf(t, gitRoot) === project);
  const rank = (t) => (t.status === "open" ? 0 : 1);
  const pri = (t) => (prioritize && projectOf(t, gitRoot) === prioritize ? 0 : 1);
  const key = (t) => (t.status === "open" ? t.created_at : t.done_at ?? t.created_at);
  rows.sort((a, b) => rank(a) - rank(b) || pri(a) - pri(b) || (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0));
  return rows;
}

// 项目识别:git 仓库根目录名(子目录归属所属仓库);不是仓库/命令失败回退 cwd basename。
// gitRootOf 结果进程内缓存(overlay 2s 轮询渲染,不能每行都 spawn git)。
const gitRootCache = new Map();
function gitRootOf(cwd) {
  if (gitRootCache.has(cwd)) return gitRootCache.get(cwd);
  let root = null;
  try {
    const r = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8", timeout: 1500 });
    if (r.status === 0 && r.stdout.trim()) root = r.stdout.trim();
  } catch { /* git 不在/超时 → 回退 */ }
  gitRootCache.set(cwd, root);
  return root;
}

function projectNameForCwd(cwd, gitRoot = gitRootOf) {
  if (!cwd) return null;
  return path.basename(gitRoot(cwd) ?? cwd);
}

function projectOf(todo, gitRoot = gitRootOf) {
  return projectNameForCwd(todo.source?.cwd, gitRoot);
}

module.exports = { addTodo, findTodo, setStatus, updateTodo, removeTodo, listTodos, normalizeText, emptySource, projectOf, projectNameForCwd };
