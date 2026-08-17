"use strict";
// 跳源决策测试(docs/prd.md T6,§5)
const test = require("node:test");
const assert = require("node:assert/strict");
const { planJump } = require("../src/jump.js");

const TODO = (source) => ({
  id: "t-a3f9", text: "测试条目", status: "open", created_at: "x", done_at: null, source,
});
const PI_SRC = {
  kind: "pi", agent_name: "Fix Startup", pane_id: "w2Q:pF", workspace_id: "w2Q", tab_id: "w2Q:t5",
  cwd: "/work/proj", pi_session_id: "u", pi_session_file: "/sess/abc_01a00e51-6eb8-7281-8222-0b55215858ba.jsonl",
};

// runner(args) 仿真 herdr;handlers: [matchPrefix, {status, stdout}|fn]
function fakeRunner(handlers, calls = []) {
  return (args) => {
    calls.push(args);
    for (const [prefix, res] of handlers) {
      if (args.join(" ").startsWith(prefix)) {
        let r = typeof res === "function" ? res(args) : res;
        if (typeof r === "string") r = { stdout: r };
        return { status: r.status ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
      }
    }
    return { status: 1, stdout: "", stderr: "unexpected: " + args.join(" ") };
  };
}
const paneAlivePi = JSON.stringify({ result: { pane: { pane_id: "w2Q:pF", agent: "pi", agent_status: "idle", tab_id: "w2Q:t5" } } });
const paneAliveShell = JSON.stringify({ result: { pane: { pane_id: "w2Q:p9", agent: null, agent_status: "unknown", tab_id: "w2Q:t9" } } });

test("活 pane(agent 在跑)→ agent focus", () => {
  const calls = [];
  const plan = planJump(TODO(PI_SRC), { runner: fakeRunner([["pane get", paneAlivePi]], calls) });
  assert.deepEqual(plan.steps, [["agent", "focus", "w2Q:pF"]]);
  assert.equal(plan.note, "focus");
});

test("活 pane 但 agent 已退(shell)→ resume 而不是 focus", () => {
  const src = { ...PI_SRC, pane_id: "w2Q:p9" };
  const calls = [];
  const runner = fakeRunner([
    ["pane get", paneAliveShell],
    ["tab create", { stdout: JSON.stringify({ result: { root_pane: { pane_id: "w2Q:pN" } } }) }],
    ["agent start", {}],
  ], calls);
  const plan = planJump(TODO(src), { runner, fileExists: () => true, currentWorkspace: "w2Q" });
  assert.equal(plan.note, "resume");
  assert.deepEqual(calls[0], ["pane", "get", "w2Q:p9"]);
  // resume 步骤:tab create(带回 cwd/workspace)→ agent start -- --session file
  const joined = plan.steps.map((s) => s.join(" "));
  assert.ok(joined.some((s) => /^tab create /.test(s) && s.includes("--cwd /work/proj") && s.includes("--workspace w2Q")));
  const start = plan.steps.find((s) => s[0] === "agent" && s[1] === "start");
  assert.ok(start, "应有 agent start 步骤");
  assert.deepEqual(start.slice(start.indexOf("--") ), ["--", "--session", src.pi_session_file]);
});

test("死 pane + session 在 → 新 tab resume", () => {
  const runner = fakeRunner([["pane get", { status: 1, stderr: "pane not found" }]]);
  const plan = planJump(TODO(PI_SRC), { runner, fileExists: () => true, currentWorkspace: "w2Q" });
  assert.equal(plan.note, "resume");
});

test("死 pane + session 文件丢失 → 退化:该 cwd 起裸 pi(PRD §5)", () => {
  const runner = fakeRunner([["pane get", { status: 1 }]]);
  const plan = planJump(TODO(PI_SRC), { runner, fileExists: () => false, currentWorkspace: "w2Q" });
  assert.equal(plan.note, "resume-bare");
  const start = plan.steps.find((s) => s[0] === "agent" && s[1] === "start");
  assert.ok(!start.includes("--session"), "裸 pi 不带 --session");
});

test("human-shell 无 pane 无 session → 不可跳", () => {
  const src = { kind: "human-shell", agent_name: null, pane_id: null, workspace_id: null, tab_id: null, cwd: "/x", pi_session_id: null, pi_session_file: null };
  const plan = planJump(TODO(src), { runner: fakeRunner([]) });
  assert.equal(plan.note, "none");
  assert.equal(plan.steps.length, 0);
});

test("focus 计划带 tab focus 兜底;执行时 agent focus 失败自动退化", () => {
  const { planJump, execPlan } = require("../src/jump.js");
  const calls = [];
  const plan = planJump(TODO(PI_SRC), { runner: fakeRunner([["pane get", paneAlivePi]]) });
  assert.deepEqual(plan.steps, [["agent", "focus", "w2Q:pF"]]);
  assert.deepEqual(plan.fallback, [["tab", "focus", "w2Q:t5"]]);
  const runner = fakeRunner([["agent focus", { status: 1, stderr: "agent_not_found" }], ["tab focus", {}]], calls);
  const r = execPlan(plan, runner);
  assert.ok(r.ok);
  assert.deepEqual(calls, [["agent", "focus", "w2Q:pF"], ["tab", "focus", "w2Q:t5"]]);
});

test("execPlan: resume 时 tab create 的 pane id 注入 agent start", () => {
  const { execPlan } = require("../src/jump.js");
  const calls = [];
  const runner = fakeRunner([
    ["pane get", { status: 1 }],
    ["tab create", { stdout: JSON.stringify({ result: { root_pane: { pane_id: "w2Q:pN" } } }) }],
    ["agent start", {}],
  ], calls);
  const plan = planJump(TODO(PI_SRC), { runner: fakeRunner([["pane get", { status: 1 }]]), fileExists: () => true, currentWorkspace: "w2Q" });
  const r = execPlan(plan, runner);
  assert.ok(r.ok);
  const start = calls.find((c) => c[0] === "agent" && c[1] === "start");
  assert.ok(start.includes("w2Q:pN"), "agent start 应用新 pane id: " + start.join(" "));
});

test("execPlan: agent start 失败按 1.5s 间隔重试至多 3 次", () => {
  const { execPlan } = require("../src/jump.js");
  const calls = [];
  let attempts = 0;
  const runner = fakeRunner([
    ["pane get", { status: 1 }],
    ["tab create", { stdout: JSON.stringify({ result: { root_pane: { pane_id: "w2Q:pN" } } }) }],
    ["agent start", () => (++attempts < 3 ? { status: 1, stderr: "not ready" } : { status: 0 })],
  ], calls);
  const plan = planJump(TODO(PI_SRC), { runner: fakeRunner([["pane get", { status: 1 }]]), fileExists: () => true, currentWorkspace: "w2Q" });
  const r = execPlan(plan, runner, { retryDelayMs: 1 });
  assert.ok(r.ok);
  assert.equal(attempts, 3);
});

test("无 workspace env 时 resume 不带 --workspace", () => {
  const runner = fakeRunner([["pane get", { status: 1 }]]);
  const plan = planJump(TODO(PI_SRC), { runner, fileExists: () => true, currentWorkspace: null });
  const create = plan.steps.find((s) => s[0] === "tab");
  assert.ok(!create.includes("--workspace"));
});
