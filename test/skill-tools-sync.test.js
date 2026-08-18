"use strict";
// 规则同义测试:skill 与 trail_* 工具描述是两个都常驻 agent 上下文的 surface,
// 记法规则必须同义——改任一处必须同步另一处,此处逐句钉死,漂移即红。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const skill = fs.readFileSync(path.join(root, "skills", "herd-trail", "SKILL.md"), "utf8");
const tools = fs.readFileSync(path.join(root, "pi", "herd-trail-tools.ts"), "utf8");

const PAIRS = [
  ["一条一事", "One item per call"],
  ["对象 + 动作 + 条件", "carry its own context"],
  ["docker rm -f pi-fence-bundle pi-fence-kroki", "docker rm -f pi-fence-bundle pi-fence-kroki"], // 好例
  ["先 `herd-trail list` 查重", "Check before adding"],
  ["不要自己传", "never pass it yourself"],
  ["仅当用户在本对话明确表示", "ONLY when the user explicitly says"],
];

for (const [skillNeedle, toolNeedle] of PAIRS) {
  test(`规则同义: ${skillNeedle} ⇄ ${toolNeedle}`, () => {
    assert.ok(skill.includes(skillNeedle), "SKILL.md 缺少: " + skillNeedle);
    assert.ok(tools.includes(toolNeedle), "工具描述缺少: " + toolNeedle);
  });
}
