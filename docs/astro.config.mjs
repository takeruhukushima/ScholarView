// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import svelte from '@astrojs/svelte';
import tailwind from '@astrojs/tailwind';

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: 'ScholarView',
			customCss: ['./src/styles/global.css'],
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/takeruhukushima/ScholarView' }],
			sidebar: [
				{ label: 'Introduction', slug: 'introduction' },
				{ label: 'Architecture', slug: 'architecture' },
				{ label: 'Features', slug: 'features' },
				{ label: 'Getting Started', slug: 'getting-started' },
			],
		}),
		svelte(),
		tailwind(),
	],
});
