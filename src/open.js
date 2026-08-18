"use strict";
// herd-trail open <id> — 跳回源对话(docs/prd.md T6)。
// --delay <ms>:延迟后执行(overlay 关闭会恢复打开前布局,布局/焦点变更必须在其后跑,
// 参考 pane-mover --exec;overlay enter 时以 detached 方式调本命令)。
// --deliver:跳源同时把备忘作为任务投递给源会话(overlay ! 键)。
const fs = require("node:fs");
const path = require("node:path");
const store = require("./store.js");
const todos = require("./todos.js");
const { planJump, execPlan, herdrRunner, resolveWorkspace } = require("./jump.js");
const { planDeliver } = require("./deliver.js");

function logLine(line, env = process.env) {
  const dir = store.resolveStoreDir(env);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, "last-open.log"), line);
}

function notifyDegraded(todo, env = process.env) {
  const herdr = env.HERDR_BIN_PATH || "herdr";
  require("node:child_process").spawnSync(herdr, [
    "notification", "show", "herd-trail: session 已丢失",
    "--body", "session 文件被清理,已在 " + (todo.source?.cwd || "默认目录") + " 起裸 pi(" + todo.id + ")",
    "--sound", "none",
  ]);
}

function openById(idOrPrefix, env = process.env, { deliver = false } = {}) {
  const file = store.storeFile(store.resolveStoreDir(env));
  const todo = todos.findTodo(store.readStore(file), idOrPrefix);
  const runner = herdrRunner(env);
  const deps = {
    runner,
    fileExists: (p) => fs.existsSync(p),
    currentWorkspace: resolveWorkspace(env),
  };
  const plan = deliver ? planDeliver(todo, deps) : planJump(todo, deps);
  const result = plan.steps.length ? execPlan(plan, runner) : null;
  if (plan.note === "resume-bare" || plan.note === "deliver-resume-bare") notifyDegraded(todo, env);
  return { todo, plan, result };
}

function noteText(plan, todo) {
  switch (plan.note) {
    case "focus": return "已聚焦源 pane " + todo.source.pane_id;
    case "deliver-focus": return "已送达并聚焦源 pane " + todo.source.pane_id;
    case "resume": return "源 pane 已关闭 —— 新 tab 用 session resume";
    case "deliver-resume": return "源 pane 已关闭 —— 新 tab resume 并送达";
    case "resume-bare": return "session 文件丢失 —— 新 tab 在 " + (todo.source.cwd || "默认目录") + " 起裸 pi";
    case "deliver-resume-bare": return "session 文件丢失 —— 新 tab 起裸 pi 并送达";
    default: return "无源可跳(该条为 herdr 外手动记录)";
  }
}

function cmdOpen(args, { fail }) {
  let delay = 0;
  let deliver = false;
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--delay") delay = Number(args[++i]) || 0;
    else if (args[i] === "--deliver") deliver = true;
    else rest.push(args[i]);
  }
  const id = rest[0];
  if (!id) fail("open 需要 <id>", 2);

  const run = () => {
    try {
      const { todo, plan, result } = openById(id, process.env, { deliver });
      const msg = noteText(plan, todo);
      if (result && !result.ok) {
        const bad = result.out.find((o) => o.status !== 0);
        fail(msg + ";但执行失败: " + bad.args.join(" ") + " — " + bad.stderr.trim());
      }
      console.log(todo.id + "  " + msg);
    } catch (e) {
      fail(e.message);
    }
  };

  if (delay > 0) {
    setTimeout(() => {
      try {
        const { todo, plan, result } = openById(id, process.env, { deliver });
        logLine(new Date().toISOString() + " " + todo.id + " " + plan.note +
          (result && !result.ok ? " FAIL " + JSON.stringify(result.out.map((o) => o.args.join(" ") + "=" + o.status)) : "") + "\n");
      } catch (e) {
        logLine(new Date().toISOString() + " " + id + " ERROR " + e.message + "\n");
      }
      process.exit(0);
    }, delay);
    return;
  }
  run();
}

module.exports = { cmdOpen, openById };
