"use strict";
// agent-setup 测试(docs/prd.md T3/T4 安装路径)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SETUP = path.join(__dirname, "..", "src", "agent-setup.js");

function runSetup(home) {
  return spawnSync(process.execPath, [SETUP], {
    env: { ...process.env, HOME: home },
    encoding: "utf8",
  });
}

test("agent-setup: 安装扩展+skill,烧入 CLI 绝对路径,幂等", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "herd-trail-home-"));
  const r1 = runSetup(home);
  assert.equal(r1.status, 0, r1.stderr);
  const ext = path.join(home, ".pi", "agent", "extensions", "herd-trail-tools.ts");
  const skill = path.join(home, ".pi", "agent", "skills", "herd-trail", "SKILL.md");
  assert.ok(fs.existsSync(ext));
  assert.ok(fs.existsSync(skill));
  const content = fs.readFileSync(ext, "utf8");
  assert.ok(!content.includes('"__HERD_TRAIL_CLI__"'), "占位符应已替换");
  const repoCli = path.join(__dirname, "..", "bin", "herd-trail");
  assert.ok(content.includes(JSON.stringify(repoCli)), "应烧入仓库 CLI 绝对路径");
  // skill 原样复制
  assert.equal(fs.readFileSync(skill, "utf8"), fs.readFileSync(path.join(__dirname, "..", "skills", "herd-trail", "SKILL.md"), "utf8"));
  // 幂等:第二次 unchanged
  const r2 = runSetup(home);
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(r2.stdout, /unchanged/);
});
