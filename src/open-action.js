#!/usr/bin/env node
// Action 入口:打开 trail 列表 overlay。参考 pane-mover open.js 的 spawnSync 模式。
"use strict";

const { spawnSync } = require("node:child_process");

const herdr = process.env.HERDR_BIN_PATH ?? "herdr";
const pluginId = process.env.HERDR_PLUGIN_ID ?? "envvar.herd-trail";

const res = spawnSync(
  herdr,
  ["plugin", "pane", "open", "--plugin", pluginId, "--entrypoint", "list"],
  { encoding: "utf8" }
);
if (res.stderr) process.stderr.write(res.stderr);
if (res.error) process.stderr.write("herdr 调用失败: " + res.error.message + "\n");
process.exit(res.status ?? 1); // spawn 失败时 status 为 null,不能静默成功

