"use strict";
// 送达(docs 施工单 P3):跳源 + 把备忘作为任务投递给源会话。
// 活 pane → herdr agent prompt + focus;死 pane → 复用 planJump 的 resume 再 wait+prompt。
const { planJump } = require("./jump.js");

function deliverMessage(todo) {
  const hint = String(todo.text ?? "").slice(0, 40);
  return "[trail " + todo.id + "] 请处理这条备忘:" + todo.text +
    "(原始上下文可用 recall 搜 '" + hint + "' 找回)";
}

function planDeliver(todo, deps) {
  const jump = planJump(todo, deps);
  if (jump.note === "none") return jump;
  const msg = deliverMessage(todo);
  if (jump.note === "focus") {
    return {
      note: "deliver-focus",
      steps: [
        ["agent", "prompt", todo.source.pane_id, msg],
        ["agent", "focus", todo.source.pane_id],
      ],
      fallback: jump.fallback,
    };
  }
  return {
    note: jump.note === "resume-bare" ? "deliver-resume-bare" : "deliver-resume",
    steps: [
      ...jump.steps,
      ["agent", "wait", "$NEW_PANE", "--until", "idle", "--timeout", "30000"],
      ["agent", "prompt", "$NEW_PANE", msg],
    ],
    fallback: jump.fallback,
  };
}

module.exports = { planDeliver, deliverMessage };
