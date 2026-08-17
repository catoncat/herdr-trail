"use strict";
// provenance 溯源捕获测试(docs/prd.md §3 source 字段)
const test = require("node:test");
const assert = require("node:assert/strict");
const { captureSource, parseSessionId } = require("../src/provenance.js");

const PANE = {
  agent: "pi",
  agent_session: { agent: "pi", kind: "path", source: "herdr:pi", value: "/Users/x/.pi/agent/sessions/--proj--/2026-08-17T06-03-32-920Z_01a00e51-6eb8-7281-8222-0b55215858ba.jsonl" },
  cwd: "/work/proj",
  title: "Fix Startup",
  pane_id: "w2Q:pF",
  tab_id: "w2Q:t5",
  workspace_id: "w2Q",
};

test("herdr 外:kind=human-shell,字段为 null", () => {
  const s = captureSource({}, { lookup: () => null });
  assert.equal(s.kind, "human-shell");
  assert.equal(s.pane_id, null);
  assert.equal(s.agent_name, null);
  assert.equal(s.pi_session_file, null);
  assert.equal(typeof s.cwd, "string");
});

test("herdr pane 内 pi agent:全字段捕获", () => {
  const env = { HERDR_PANE_ID: "w2Q:pF", HERDR_WORKSPACE_ID: "w2Q", HERDR_TAB_ID: "w2Q:t5" };
  const s = captureSource(env, { lookup: (id) => (id === "w2Q:pF" ? PANE : null), cwd: "/work/proj" });
  assert.equal(s.kind, "pi");
  assert.equal(s.agent_name, "Fix Startup");
  assert.equal(s.pane_id, "w2Q:pF");
  assert.equal(s.workspace_id, "w2Q");
  assert.equal(s.tab_id, "w2Q:t5");
  assert.equal(s.cwd, "/work/proj");
  assert.equal(s.pi_session_id, "01a00e51-6eb8-7281-8222-0b55215858ba");
  assert.ok(s.pi_session_file.endsWith(".jsonl"));
});

test("非 pi agent(grok):kind 如实记录", () => {
  const env = { HERDR_PANE_ID: "w2K:p5" };
  const grok = { ...PANE, agent: "grok", agent_session: { kind: "id", value: "019ff981" }, title: "grok" };
  const s = captureSource(env, { lookup: () => grok });
  assert.equal(s.kind, "grok");
  assert.equal(s.pi_session_file, null);
  assert.equal(s.pi_session_id, null);
});

test("lookup 失败但 PI_CODING_AGENT=true:kind=pi(降级)", () => {
  const env = { HERDR_PANE_ID: "w2Q:pF", PI_CODING_AGENT: "true", PI_INTERCOM_SESSION_ID: "01a00e51-6eb8-7281-8222-0b55215858ba" };
  const s = captureSource(env, { lookup: () => null });
  assert.equal(s.kind, "pi");
  assert.equal(s.agent_name, null);
  assert.equal(s.pi_session_id, "01a00e51-6eb8-7281-8222-0b55215858ba");
});

test("lookup 失败且无 pi 信号:human-shell", () => {
  const s = captureSource({ HERDR_PANE_ID: "w2Q:p9" }, { lookup: () => { throw new Error("down"); } });
  assert.equal(s.kind, "human-shell");
  assert.equal(s.pane_id, "w2Q:p9");
});

test("parseSessionId: 从 session 文件名解析 uuid", () => {
  assert.equal(parseSessionId("/a/b/2026-08-17T06-03-32-920Z_01a00e51-6eb8-7281-8222-0b55215858ba.jsonl"), "01a00e51-6eb8-7281-8222-0b55215858ba");
  assert.equal(parseSessionId("/a/b/plain.jsonl"), null);
  assert.equal(parseSessionId(null), null);
});
