#!/usr/bin/env node
// Action 入口:打开 trail 列表 overlay。参考 pane-mover open.js 的 spawnSync 模式。
"use strict";

const { spawnSync } = require("node:child_process");

const herdr = process.env.HERDR_BIN_PATH ?? "herdr";
const pluginId = process.env.HERDR_PLUGIN_ID ?? "envvar.herd-trail";

const res = spawnSync(
  herdr,
  ["plugin", "pane", "open", "--plugin", pluginId, "--entrypoint", "list", "--focus"],
  { encoding: "utf8" }
);
diag("spawn exit=" + res.status + " error=" + (res.error ? res.error.message : "none") + " stdout=" + (res.stdout || "").slice(0, 500));
if (res.stderr) process.stderr.write(res.stderr);
if (res.error) { process.stderr.write("herdr 调用失败: " + res.error.message + "\n"); process.exit(1); }
// 显式聚焦 overlay pane——herdr 的 overlay 放置模式可能只做视觉覆盖,键盘焦点仍在底层面板
try {
  const out = JSON.parse(res.stdout);
  const paneId = out.result?.plugin_pane?.pane?.pane_id;
  if (paneId) {
    spawnSync(herdr, ["plugin", "pane", "focus", paneId], { encoding: "utf8" });
  }
} catch { /* 解析失败不阻塞 */ }
process.exit(0); // spawn 失败时 status 为 null,不能静默成功

