"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { planDeliver, deliverMessage } = require("../src/deliver.js");

const TODO = (source, text = "检查插件上架效果") => ({
  id: "t-a3f9", text, status: "open", created_at: "x", done_at: null, source,
});
const PI_SRC = {
  kind: "pi", agent_name: "Fix Startup", pane_id: "w2Q:pF", workspace_id: "w2Q", tab_id: "w2Q:t5",
  cwd: "/work/proj", pi_session_id: "u", pi_session_file: "/sess/abc_01a00e51-6eb8-7281-8222-0b55215858ba.jsonl",
};
function fakeRunner(handlers) {
  return (args) => {
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

test("deliverMessage:含 id/正文/recall 线索", () => {
  const m = deliverMessage(TODO(PI_SRC, "检查插件上架效果"));
  assert.match(m, /\[trail t-a3f9\]/);
  assert.match(m, /请处理这条备忘:检查插件上架效果/);
  assert.match(m, /recall 搜 '检查插件上架效果'/);
});

test("活 pane → prompt 再 focus", () => {
  const todo = TODO(PI_SRC);
  const plan = planDeliver(todo, { runner: fakeRunner([["pane get", paneAlivePi]]) });
  assert.equal(plan.note, "deliver-focus");
  assert.equal(plan.steps[0][0], "agent");
  assert.equal(plan.steps[0][1], "prompt");
  assert.equal(plan.steps[0][2], "w2Q:pF");
  assert.equal(plan.steps[0][3], deliverMessage(todo));
  assert.deepEqual(plan.steps[1], ["agent", "focus", "w2Q:pF"]);
});

test("死 pane + session → resume 后 wait idle 再 prompt", () => {
  const todo = TODO(PI_SRC);
  const plan = planDeliver(todo, {
    runner: fakeRunner([["pane get", { status: 1 }]]),
    fileExists: () => true,
    currentWorkspace: "w2Q",
  });
  assert.equal(plan.note, "deliver-resume");
  const joined = plan.steps.map((s) => s.join(" "));
  assert.ok(joined.some((s) => s.startsWith("tab create")));
  assert.ok(joined.some((s) => s.startsWith("agent start")));
  assert.ok(joined.some((s) => s.startsWith("agent wait $NEW_PANE")));
  const prompt = plan.steps.find((s) => s[0] === "agent" && s[1] === "prompt");
  assert.deepEqual(prompt.slice(0, 3), ["agent", "prompt", "$NEW_PANE"]);
  assert.equal(prompt[3], deliverMessage(todo));
});

test("无源 → none,不投递", () => {
  const src = { kind: "human-shell", pane_id: null, pi_session_file: null };
  const plan = planDeliver(TODO(src), { runner: fakeRunner([]) });
  assert.equal(plan.note, "none");
  assert.equal(plan.steps.length, 0);
});
