"use strict";
// 跳源决策(docs/prd.md T6,§5)。
// planJump 只做只读探测(pane get),产出命令计划;execPlan 顺序执行,
// resume 时把 tab create 返回的 root_pane.pane_id 注入后续 "$NEW_PANE" 占位。
// 布局变更实际执行点在 overlay 关闭之后(open.js --exec 延迟 400ms),
// 否则 overlay 关闭会恢复布局把跳转撤销(参考 pane-mover)。

// runner(args) → {status, stdout, stderr};fileExists(path) → bool。注入便于测试。
function planJump(todo, { runner, fileExists = () => false, currentWorkspace = null }) {
  const src = todo.source ?? {};
  const none = { note: "none", steps: [], fallback: [] };

  // 活 pane 判定:pane get 成功且 agent 仍在跑(PRD §5)。
  if (src.pane_id) {
    const res = runner(["pane", "get", src.pane_id]);
    if (res.status === 0) {
      let pane = null;
      try { pane = JSON.parse(res.stdout).result?.pane ?? null; } catch { /* fall */ }
      if (pane?.agent) {
        return {
          note: "focus",
          steps: [["agent", "focus", src.pane_id]],
          // shell 化竞态等 agent_not_found 时退化:聚焦所在 tab
          fallback: src.tab_id ? [["tab", "focus", src.tab_id]] : [],
        };
      }
      // pane 活着但 agent 已退(回到 shell)→ 视同已死,走 resume
    }
    // pane 已死 → 往下走 resume
  }

  // resume:仅 pi 会话可 resume;session 文件丢失退化裸 pi(PRD §5)。
  if (src.kind === "pi" && src.pi_session_file) {
    const hasSession = fileExists(src.pi_session_file);
    const create = ["tab", "create"];
    if (currentWorkspace) create.push("--workspace", currentWorkspace);
    if (src.cwd) create.push("--cwd", src.cwd);
    create.push("--label", "trail:" + todo.id, "--focus");
    const start = ["agent", "start", "trail-" + todo.id, "--kind", "pi", "--pane", "$NEW_PANE", "--timeout", "60000"];
    if (hasSession) start.push("--", "--session", src.pi_session_file);
    return { note: hasSession ? "resume" : "resume-bare", steps: [create, start], fallback: [] };
  }

  return none;
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function execPlan(plan, runner, { retries = 3, retryDelayMs = 1500 } = {}) {
  let newPane = null;
  const out = [];
  // agent start 依赖新 tab 的 shell 就绪,就绪窗口不可控 → 失败重试
  const retryable = (args) => args[0] === "agent" && args[1] === "start";
  const runSteps = (steps) => {
    for (const step of steps) {
      const args = step.map((a) => (a === "$NEW_PANE" ? newPane : a));
      let res = runner(args);
      for (let n = 1; res.status !== 0 && retryable(args) && n < retries; n++) {
        sleepSync(retryDelayMs);
        res = runner(args);
      }
      out.push({ args, status: res.status, stderr: res.stderr ?? "" });
      if (res.status !== 0) return false;
      if (args[0] === "tab" && args[1] === "create") {
        try { newPane = JSON.parse(res.stdout).result?.root_pane?.pane_id ?? null; } catch { /* fall */ }
        if (!newPane) return false;
      }
    }
    return true;
  };
  if (runSteps(plan.steps)) return { ok: true, out };
  if (plan.fallback?.length && runSteps(plan.fallback)) return { ok: true, out };
  return { ok: false, out };
}

// 目标 workspace 解析:HERDR_PLUGIN_CONTEXT_JSON.workspace_id 是"打开 overlay/触发 action 时
// 用户所在 workspace"(插件进程自己的 HERDR_WORKSPACE_ID 是 overlay 宿主 workspace,不能用作落点)。
function resolveWorkspace(env = process.env) {
  try {
    const ctx = JSON.parse(env.HERDR_PLUGIN_CONTEXT_JSON ?? "{}");
    if (ctx.workspace_id) return ctx.workspace_id;
  } catch { /* fall */ }
  return env.HERDR_WORKSPACE_ID || null;
}

// 真实 herdr runner(CLI/overlay 共用)。
function herdrRunner(env = process.env) {
  const herdr = env.HERDR_BIN_PATH || "herdr";
  return (args) => {
    const r = require("node:child_process").spawnSync(herdr, args, { encoding: "utf8" });
    return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: (r.stderr ?? "") + (r.error ? String(r.error) : "") };
  };
}

module.exports = { planJump, execPlan, herdrRunner, resolveWorkspace };
