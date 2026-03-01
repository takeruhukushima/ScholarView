import { defineCollection, z } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { glob } from 'astro/loaders';

export const collections = {
	docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
	blog: defineCollection({
		loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: "./src/content/blog" }),
		schema: z.object({
			title: z.string(),
			description: z.string(),
			date: z.coerce.date().optional(),
			author: z.string().default('ScholarView Team'),
		}),
	}),
};
