// herd-trail pi 工具扩展 —— model-visible 的 trail_add / trail_list(docs/prd.md T4)。
// 状态:骨架,M2 实现。
//
// TODO(M2):
//  1. pi 工具注册 API 未验证 —— 先读:
//     - 本机已装 npm 扩展源码:~/.pi/agent/npm/node_modules/@juicesharp/rpiv-todo/
//     - GitHub:leset0ng/pi-todo-herdr(同范式)
//     - pi 官方文档:docs/extensions.md(见 AGENTS.md §pi 事实)
//  2. 工具实现 = 薄封装:spawn bin/herd-trail add|list,文本即文本。
//     CLI 是唯一事实源,这里不做任何 store 逻辑。
//  3. 安装方式:复制/软链本文件到 ~/.pi/agent/extensions/(自动发现),
//     由插件 action "agent-setup" 完成(连同 skills/herd-trail/ 一起)。
export default function register(pi) {
  void pi;
  // registerTool 待填
}
