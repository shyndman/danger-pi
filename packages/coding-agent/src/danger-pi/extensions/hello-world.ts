import type { ExtensionFactory } from "../../extensibility/extensions";

export function createHelloWorldExtension(): ExtensionFactory {
	return api => {
		api.registerCommand("hello_world", {
			description: "Send hello, then world",
			handler: async (_args, ctx) => {
				api.sendUserMessage("tell me a joke", { deliverAs: "followUp" });
				await ctx.waitForIdle();
				api.sendUserMessage("ha. ha. ha.", { deliverAs: "followUp" });
				await ctx.waitForIdle();
				api.sendUserMessage("tell me another joke", { deliverAs: "followUp" });
				await ctx.waitForIdle();
				api.sendUserMessage("ha. ha. ha.", { deliverAs: "followUp" });
			},
		});
	};
}
