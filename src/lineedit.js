"use strict";
// 行编辑器 + 按键解析(纯函数/纯状态,便于单测)。
// 修两个同根问题:
//   1. stdin 曾按 latin1 解码 → 中文输入落库乱码(改用 StringDecoder 按 UTF-8,
//      多字节字符跨 chunk 也能正确拼接)。
//   2. 输入模式把方向键序列的首字节 \x1b 当 Esc → 按左右直接退出编辑
//      (转义序列完整解析后再分发)。

// key 形态:
//   { t:"char", ch }     可打印字符(含 CJK,按码点)
//   { t:"enter" } { t:"esc" } { t:"backspace" } { t:"delete" }
//   { t:"up" | "down" | "left" | "right" | "home" | "end" }
//   { t:"ctrl", key }    如 ctrl+a/e/u/k/w

const { StringDecoder } = require("node:string_decoder");

class KeyParser {
  constructor() {
    this.dec = new StringDecoder("utf8");
    this.pending = ""; // 半截转义序列(不含任何完整序列的前缀)
  }
  feed(buf) {
    const s = this.pending + this.dec.write(buf);
    this.pending = "";
    const keys = [];
    for (let i = 0; i < s.length;) {
      const ch = s[i];
      if (ch === "\x1b") {
        const rest = s.slice(i);
        const m = rest.match(/^\x1b\[[0-9;]*[A-Za-z~]/) || rest.match(/^\x1bO[A-Za-z]/);
        if (m) { keys.push(csiKey(m[0])); i += m[0].length; continue; }
        if (rest.length > 1 && (rest[1] === "[" || rest[1] === "O")) {
          // 序列在末尾被截断 → 留到下轮;序列在中间损坏 → 跳过 ESC[,余下逐字符
          if (rest.length < 8) { this.pending = rest; i = s.length; continue; }
          i += 2; continue;
        }
        keys.push({ t: "esc" }); i += 1; continue; // 裸 Esc(单字节 chunk)
      }
      if (ch === "\r" || ch === "\n") { keys.push({ t: "enter" }); i += 1; continue; }
      if (ch === "\x7f" || ch === "\b") { keys.push({ t: "backspace" }); i += 1; continue; }
      const cp = ch.codePointAt(0);
      if (cp >= 1 && cp <= 26) { keys.push({ t: "ctrl", key: String.fromCodePoint(cp + 96) }); i += 1; continue; }
      if (ch >= " ") { keys.push({ t: "char", ch }); i += 1; continue; }
      i += 1; // 其余控制字符丢弃
    }
    return keys;
  }
  end() { // 进程退出前冲刷;正常用不到
    this.dec.end();
    this.pending = "";
  }
}

function csiKey(seq) {
  const final = seq[seq.length - 1];
  switch (final) {
    case "A": return { t: "up" };
    case "B": return { t: "down" };
    case "C": return { t: "right" };
    case "D": return { t: "left" };
    case "H": return { t: "home" };
    case "F": return { t: "end" };
    case "~": {
      const n = seq.replace(/[^0-9]/g, "");
      if (n === "3") return { t: "delete" };
      if (n === "1" || n === "7") return { t: "home" };
      if (n === "4" || n === "8") return { t: "end" };
      return { t: "unknown" };
    }
    default: return { t: "unknown" };
  }
}

// ---------- 行编辑器 ----------
// chars: 码点数组;cur: 插入点下标 0..chars.length。
class LineEditor {
  constructor(text = "") {
    this.chars = [...String(text)];
    this.cur = this.chars.length;
  }
  get text() { return this.chars.join(""); }
  get beforeCursor() { return this.chars.slice(0, this.cur).join(""); }

  apply(k) {
    switch (k.t) {
      case "char":
        this.chars.splice(this.cur, 0, k.ch);
        this.cur += 1;
        return true;
      case "left": this.cur = Math.max(0, this.cur - 1); return true;
      case "right": this.cur = Math.min(this.chars.length, this.cur + 1); return true;
      case "home": this.cur = 0; return true;
      case "end": this.cur = this.chars.length; return true;
      case "backspace":
        if (this.cur > 0) { this.chars.splice(this.cur - 1, 1); this.cur -= 1; }
        return true;
      case "delete":
        if (this.cur < this.chars.length) this.chars.splice(this.cur, 1);
        return true;
      case "ctrl":
        if (k.key === "a") { this.cur = 0; return true; }
        if (k.key === "e") { this.cur = this.chars.length; return true; }
        if (k.key === "u") { this.chars.splice(0, this.cur); this.cur = 0; return true; }
        if (k.key === "k") { this.chars.splice(this.cur); return true; }
        if (k.key === "w") { // 删到前一个词首
          let i = this.cur;
          while (i > 0 && this.chars[i - 1] === " ") i--;
          while (i > 0 && this.chars[i - 1] !== " ") i--;
          this.chars.splice(i, this.cur - i);
          this.cur = i;
          return true;
        }
        return false;
      default: return false; // up/down/esc/enter 等由调用方处理
    }
  }
}

module.exports = { KeyParser, LineEditor };
