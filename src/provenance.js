"use strict";
// 溯源捕获(docs/prd.md §3 source 字段,add 时零参数自动捕获)。
// 事实(2026-08-17 实测,herdr 0.8.0 / pi 0.84.2):
//   agent pane 内有 HERDR_PANE_ID/HERDR_TAB_ID/HERDR_WORKSPACE_ID/HERDR_SOCKET_PATH;
//   **没有** PI_SESSION_ID/PI_SESSION_FILE —— session 信息走 herdr pane get:
//   pane.agent_session(kind=path).value 即 session 文件,id 从文件名 `_<uuid>.jsonl` 解析。
//   PI_CODING_AGENT=true 是 pi 进程信号;PI_INTERCOM_SESSION_ID 可作 session id 兜底。
const { spawnSync } = require("node:child_process");

function parseSessionId(file) {
  if (!file) return null;
  const m = /_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/.exec(file);
  return m ? m[1] : null;
}

// 真实 lookup:herdr pane get <id> → pane 对象;任何失败(herdr 不在/pane 已关)返回 null。
function herdrLookup(env = process.env) {
  const herdr = env.HERDR_BIN_PATH || "herdr";
  return (paneId) => {
    const res = spawnSync(herdr, ["pane", "get", paneId], { encoding: "utf8" });
    if (res.status !== 0 || !res.stdout) return null;
    try {
      return JSON.parse(res.stdout).result?.pane ?? null;
    } catch {
      return null;
    }
  };
}

// opts.lookup 注入便于测试;opts.cwd 默认 process.cwd()。
// 任何单字段失败都不阻塞 add —— 溯源是尽力而为,记录本身才是主职责。
function captureSource(env = process.env, opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  const paneId = env.HERDR_PANE_ID || null;
  const base = {
    kind: "human-shell",
    agent_name: null,
    pane_id: paneId,
    workspace_id: env.HERDR_WORKSPACE_ID || null,
    tab_id: env.HERDR_TAB_ID || null,
    cwd,
    pi_session_id: null,
    pi_session_file: null,
  };
  if (!paneId) return base;

  let pane = null;
  if (!env.HERD_TRAIL_NO_PANE_LOOKUP) {
    const lookup = opts.lookup ?? herdrLookup(env);
    try {
      pane = lookup(paneId);
    } catch {
      pane = null;
    }
  } else if (opts.lookup) {
    try {
      pane = opts.lookup(paneId);
    } catch {
      pane = null;
    }
  }

  if (pane) {
    // pane 在但无 agent(shell pane)→ human-shell;有 agent 如实记 kind(pi/grok/...)。
    base.kind = pane.agent || "human-shell";
    base.agent_name = pane.title ?? pane.display_agent ?? pane.agent ?? null;
    if (pane.agent === "pi" && pane.agent_session?.kind === "path") {
      base.pi_session_file = pane.agent_session.value ?? null;
      base.pi_session_id = parseSessionId(base.pi_session_file);
    }
  } else if (env.PI_CODING_AGENT) {
    base.kind = "pi";
  }
  if (!base.pi_session_id && env.PI_INTERCOM_SESSION_ID) {
    base.pi_session_id = env.PI_INTERCOM_SESSION_ID;
  }
  return base;
}

module.exports = { captureSource, parseSessionId, herdrLookup };
