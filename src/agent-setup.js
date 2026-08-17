#!/usr/bin/env node
// agent-setup:把 pi 工具扩展 + agent skill 装进 ~/.pi/agent(docs/prd.md T3/T4)。
// 幂等;扩展中的 "__HERD_TRAIL_CLI__" 占位符替换为本仓库 bin/herd-trail 绝对路径。
// 作为 herdr action 运行时 cwd=plugin_root;此处用 __dirname 定位,与 cwd 无关。
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const cliPath = path.join(pluginRoot, "bin", "herd-trail");
const home = process.env.HOME;

const targets = [
  {
    src: path.join(pluginRoot, "pi", "herd-trail-tools.ts"),
    dst: path.join(home, ".pi", "agent", "extensions", "herd-trail-tools.ts"),
    substitute: true,
  },
  {
    src: path.join(pluginRoot, "skills", "herd-trail", "SKILL.md"),
    dst: path.join(home, ".pi", "agent", "skills", "herd-trail", "SKILL.md"),
    substitute: false,
  },
];

for (const t of targets) {
  let content = fs.readFileSync(t.src, "utf8");
  if (t.substitute) content = content.replaceAll('"__HERD_TRAIL_CLI__"', JSON.stringify(cliPath));
  fs.mkdirSync(path.dirname(t.dst), { recursive: true });
  const prev = fs.existsSync(t.dst) ? fs.readFileSync(t.dst, "utf8") : null;
  if (prev === content) {
    console.log("unchanged  " + t.dst);
  } else {
    fs.writeFileSync(t.dst, content);
    console.log((prev === null ? "installed  " : "updated    ") + t.dst);
  }
}
console.log("cli        " + cliPath);
console.log("完成。pi 里 /reload 后 trail_add / trail_list 可用;skill herd-trail 自动发现。");
