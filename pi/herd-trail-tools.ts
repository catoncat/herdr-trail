/**
 * herd-trail pi 工具扩展 —— model-visible 的 trail_add / trail_list(docs/prd.md T4)。
 * 薄封装 bin/herd-trail:CLI 是唯一事实源,这里不做任何 store 逻辑。
 *
 * 安装:`herdr plugin action invoke agent-setup --plugin envvar.herd-trail`
 * 会把本文件复制到 ~/.pi/agent/extensions/ 并把 "__HERD_TRAIL_CLI__" 替换为
 * bin/herd-trail 的绝对路径。开发期可直接 `HERD_TRAIL_BIN=... pi -e pi/herd-trail-tools.ts`。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

// agent-setup 把占位符替换为 bin/herd-trail 绝对路径;判定用"是否为存在的绝对路径",
// 而不是与占位符字面量比较(替换会同时命中比较处,见 M2 冒烟踩坑)。
const CLI = process.env.HERD_TRAIL_BIN ?? "__HERD_TRAIL_CLI__";

function runCli(args: string[]): string {
	if (!CLI.startsWith("/") || !existsSync(CLI)) {
		return "herd-trail 未安装:请运行 herdr plugin action invoke agent-setup --plugin envvar.herd-trail(或设 HERD_TRAIL_BIN)";
	}
	const res = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
	if (res.error) return "herd-trail 调用失败: " + res.error.message;
	if (res.status !== 0) return "herd-trail 出错: " + (res.stderr || res.stdout || "").trim();
	return res.stdout.trim();
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "trail_add",
		label: "Trail Add",
		description:
			"Record a follow-up into the herd-wide shared todo list (herd-trail). Use for things the USER must handle later: cleanup, follow-ups waiting on external conditions, blockers needing human decisions, issues you noticed but are out of the current task's scope. One item per call; text must carry its own context (object + action + condition) so it makes sense outside this conversation. Provenance (which agent/pane/pi session) is captured automatically — never pass it yourself. Do NOT use for things you can finish within this session.",
		parameters: Type.Object({
			text: Type.String({ description: "Single-line item with full context, e.g. 'm1 恢复后 docker rm -f pi-fence-bundle pi-fence-kroki'" }),
		}),
		async execute(_toolCallId, params) {
			const out = runCli(["add", params.text]);
			return { content: [{ type: "text", text: out }], details: {} };
		},
	});

	pi.registerTool({
		name: "trail_list",
		label: "Trail List",
		description:
			"List the herd-wide shared todo list (herd-trail). Shows open items by default (id, status, age, source agent, project, text); pass all:true to include done. Check before adding to avoid duplicates.",
		parameters: Type.Object({
			all: Type.Optional(Type.Boolean({ description: "Include done items (default: open only)" })),
		}),
		async execute(_toolCallId, params) {
			const args = ["list"];
			if (params.all) args.push("--all");
			const out = runCli(args);
			return { content: [{ type: "text", text: out || "(empty)" }], details: {} };
		},
	});
}
