"use strict";
// herd-trail 领域操作(docs/prd.md §3/§4)。所有写操作经 store.withMutation(锁+重读+原子落盘)。
const path = require("node:path");
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

function removeTodo(file, idOrPrefix, opts) {
  return withMutation(file, (data) => {
    const todo = findTodo(data, idOrPrefix);
    data.todos = data.todos.filter((t) => t.id !== todo.id);
    return todo;
  }, opts);
}

// 纯函数:open 在前按 created 倒序,done 沉底按 done_at 倒序;可选 agent/project 过滤。
function listTodos(data, { all = false, agent = null, project = null } = {}) {
  let rows = data.todos.slice();
  if (!all) rows = rows.filter((t) => t.status === "open");
  if (agent) rows = rows.filter((t) => (t.source?.agent_name ?? "") === agent);
  if (project) rows = rows.filter((t) => projectOf(t) === project);
  const rank = (t) => (t.status === "open" ? 0 : 1);
  const key = (t) => (t.status === "open" ? t.created_at : t.done_at ?? t.created_at);
  rows.sort((a, b) => rank(a) - rank(b) || (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0));
  return rows;
}

function projectOf(todo) {
  const cwd = todo.source?.cwd;
  return cwd ? path.basename(cwd) : null;
}

module.exports = { addTodo, findTodo, setStatus, removeTodo, listTodos, normalizeText, emptySource, projectOf };
