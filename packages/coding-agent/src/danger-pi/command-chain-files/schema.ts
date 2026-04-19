import { z } from "zod/v4";

export const CommandChainFileSchema = z.object({
	description: z.string(),
	steps: z.array(z.string()),
});

export type CommandChainFile = z.infer<typeof CommandChainFileSchema>;
