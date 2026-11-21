// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import svelte from '@astrojs/svelte';
import tailwind from '@astrojs/tailwind';
import { autoLangScript } from './src/i18n/auto-lang.mjs';

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: 'ScholarView',
			customCss: ['./src/styles/starlight-custom.css'],
			head: [{ tag: 'script', content: autoLangScript }],
			// Japanese stays at the root (existing URLs unchanged); English lives under /en/.
			defaultLocale: 'root',
			locales: {
				root: { label: '日本語', lang: 'ja' },
				en: { label: 'English', lang: 'en' },
			},
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/takeruhukushima/ScholarView' }],
			sidebar: [
				{ label: 'はじめに', translations: { en: 'Introduction' }, slug: 'introduction' },
				{ label: 'アーキテクチャ', translations: { en: 'Architecture' }, slug: 'architecture' },
				{ label: '機能', translations: { en: 'Features' }, slug: 'features' },
				{ label: 'はじめかた', translations: { en: 'Getting Started' }, slug: 'getting-started' },
			],
		}),
		svelte(),
		// Don't inject Tailwind preflight globally: it is unlayered and overrides Starlight's
		// `@layer starlight.core` styles (e.g. both mobile menu icons showing). Custom pages
		// get preflight via src/styles/global.css instead.
		tailwind({ applyBaseStyles: false }),
	],
});
