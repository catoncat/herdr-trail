"use strict";
// herd-trail 数据层(docs/prd.md §3)。
// 单 JSON 文件;写路径 = mkdir 锁(50ms 退避/5s 超时/30s stale 回收)→ 重读 → mutate → tmp+rename 原子落盘。
// 损坏自动备份(todos.json.corrupt-<ts>)并从空表重建。
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const PLUGIN_ID = "envvar.herd-trail";
const FALLBACK_DIR = path.join(process.env.HOME || "~", ".local", "share", "herd-trail");

// 数据目录:HERD_TRAIL_DIR(测试/调试优先)→ herdr plugin config-dir → fallback。
// herdr 调用结果按进程缓存(CLI 单进程多次调用只 spawn 一次)。
let cachedDir = null;
function resolveStoreDir(env = process.env) {
  if (env.HERD_TRAIL_DIR) return env.HERD_TRAIL_DIR;
  if (cachedDir) return cachedDir;
  const herdr = env.HERDR_BIN_PATH || "herdr";
  const res = spawnSync(herdr, ["plugin", "config-dir", PLUGIN_ID], { encoding: "utf8" });
  cachedDir = res.status === 0 && res.stdout.trim() ? res.stdout.trim() : FALLBACK_DIR;
  return cachedDir;
}

function storeFile(dir) {
  return path.join(dir, "todos.json");
}

const EMPTY = () => ({ version: 1, todos: [] });

function readStore(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return EMPTY();
    throw e;
  }
  try {
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.todos)) throw new Error("bad shape");
    return data;
  } catch {
    const backup = file + ".corrupt-" + Date.now();
    try {
      fs.renameSync(file, backup);
    } catch {
      /* 备份失败不阻塞重建 */
    }
    return EMPTY();
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireLock(lockDir, { lockTimeoutMs = 5000, lockRetryMs = 50, lockStaleMs = 30000 } = {}) {
  const start = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      return;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      try {
        if (Date.now() - fs.statSync(lockDir).mtimeMs > lockStaleMs) {
          fs.rmSync(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch {
        /* stat 竞态:锁刚被释放,直接重试 */
      }
      if (Date.now() - start > lockTimeoutMs) {
        throw new Error("herd-trail: acquire lock timeout: " + lockDir);
      }
      sleepSync(lockRetryMs);
    }
  }
}

// fn(data) 原地修改 data.todos 并返回任意值;落盘成功后才把返回值交给调用方。
function withMutation(file, fn, opts = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lockDir = file + ".lock";
  acquireLock(lockDir, opts);
  try {
    const data = readStore(file);
    const result = fn(data);
    const tmp = file + ".tmp-" + process.pid + "-" + crypto.randomBytes(3).toString("hex");
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
    fs.renameSync(tmp, file);
    return result;
  } finally {
    try {
      fs.rmdirSync(lockDir);
    } catch {
      /* 锁目录被 stale 回收竞态拿走,忽略 */
    }
  }
}

const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";
function newId(existingIds) {
  for (;;) {
    const bytes = crypto.randomBytes(4);
    let id = "t-";
    for (const b of bytes) id += BASE36[b % 36];
    if (!existingIds.has(id)) return id;
  }
}

module.exports = { PLUGIN_ID, FALLBACK_DIR, resolveStoreDir, storeFile, readStore, withMutation, newId };
