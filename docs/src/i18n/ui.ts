export const languages = {
	ja: '日本語',
	en: 'English',
} as const;

export type Lang = keyof typeof languages;

export const defaultLang: Lang = 'ja';

export const ui = {
	ja: {
		'meta.title': 'ScholarView - AT Protocol 上の 100% Open Source DeSci プラットフォーム',
		'meta.description': 'AT Protocol を活用した、新しい学術コミュニケーションの形を。',
		'nav.manual': 'マニュアル',
		'nav.blog': 'ブログ',
		'nav.community': 'コミュニティ',
		'nav.toggleMenu': 'メニューを開閉',
		'nav.language': '言語',
		'hero.badge': '100% Open Source & Free',
		'hero.titleBefore': 'AT Protocol で',
		'hero.titleAfter': 'を加速させる。',
		'hero.lead1': 'ScholarView は、AT Protocol を基盤とした 100% オープンソースの分散型学術出版プラットフォームです。',
		'hero.lead2': '学術の対話をより自由に、よりオープンに。',
		'hero.readDocs': 'ドキュメントを読む',
		'hero.viewGithub': 'GitHub で見る',
		'feature.atproto.title': 'AT Protocol 連携',
		'feature.atproto.body': '分散型プロトコルによる論文公開とピアレビュー。研究の透明性と永続性を保証します。',
		'feature.oss.title': '100% Open Source',
		'feature.oss.body': 'AGPLv3 ライセンスで公開。すべての研究者が自由に検証し、拡張できる学術基盤を提供します。',
		'feature.desci.title': 'DeSci / Open Access',
		'feature.desci.body': '中央集権的なプラットフォームに依存しない、真のオープンアクセスと知識の民主化を目指します。',
		'feature.editor.title': '直感的なエディタ',
		'feature.editor.body': 'Markdown、LaTeX、自動引用。研究者のための洗練された執筆・出版体験を提供します。',
		'blog.metaDescription': 'ScholarView の開発ブログ。AT Protocol や DeSci に関する最新情報を発信します。',
		'blog.title': 'ブログ',
		'blog.lead': 'ScholarView の開発状況や、DeSci に関する考察を発信します。',
		'blog.readMore': '記事を読む',
		'blog.back': '記事一覧に戻る',
		'blog.empty': 'まだ記事はありません。',
		'footer.licensed': 'ScholarView. Licensed under',
		'footer.manual': 'マニュアル',
		'footer.blog': 'ブログ',
		'footer.gettingStarted': 'はじめかた',
	},
	en: {
		'meta.title': 'ScholarView - A 100% Open Source DeSci Platform on AT Protocol',
		'meta.description': 'A new form of scholarly communication, built on AT Protocol.',
		'nav.manual': 'Manual',
		'nav.blog': 'Blog',
		'nav.community': 'Community',
		'nav.toggleMenu': 'Toggle menu',
		'nav.language': 'Language',
		'hero.badge': '100% Open Source & Free',
		'hero.titleBefore': 'Accelerating',
		'hero.titleAfter': 'with AT Protocol.',
		'hero.lead1': 'ScholarView is a 100% open source, decentralized academic publishing platform built on AT Protocol.',
		'hero.lead2': 'Making scholarly dialogue freer and more open.',
		'hero.readDocs': 'Read the docs',
		'hero.viewGithub': 'View on GitHub',
		'feature.atproto.title': 'AT Protocol Integration',
		'feature.atproto.body': 'Publish papers and run peer review over a decentralized protocol, ensuring research stays transparent and durable.',
		'feature.oss.title': '100% Open Source',
		'feature.oss.body': 'Released under AGPLv3 — an academic foundation every researcher can freely inspect and extend.',
		'feature.desci.title': 'DeSci / Open Access',
		'feature.desci.body': 'True open access and the democratization of knowledge, without depending on centralized platforms.',
		'feature.editor.title': 'Intuitive Editor',
		'feature.editor.body': 'Markdown, LaTeX, and automatic citations — a refined writing and publishing experience for researchers.',
		'blog.metaDescription': 'The ScholarView development blog: news on AT Protocol and DeSci.',
		'blog.title': 'Blog',
		'blog.lead': 'Updates on ScholarView development and thoughts on DeSci.',
		'blog.readMore': 'Read article',
		'blog.back': 'Back to all posts',
		'blog.empty': 'No posts yet.',
		'footer.licensed': 'ScholarView. Licensed under',
		'footer.manual': 'Manual',
		'footer.blog': 'Blog',
		'footer.gettingStarted': 'Getting Started',
	},
} as const;

export type UIKey = keyof (typeof ui)[typeof defaultLang];

export function useTranslations(lang: Lang) {
	return (key: UIKey) => ui[lang][key] ?? ui[defaultLang][key];
}

/** Prefix a root-relative path with the locale segment (ja is the root locale). */
export function localizePath(path: string, lang: Lang): string {
	return lang === defaultLang ? path : `/${lang}${path}`;
}

/** Map the current URL path to the same page in another locale. */
export function switchLangPath(pathname: string, to: Lang): string {
	const stripped = pathname.replace(/^\/en(?=\/|$)/, '') || '/';
	return localizePath(stripped, to);
}

export const dateLocales: Record<Lang, string> = { ja: 'ja-JP', en: 'en-US' };

/** Blog entries: Japanese at the collection root, English under `en/`. */
export function blogEntryLang(id: string): Lang {
	return id.startsWith('en/') ? 'en' : 'ja';
}

export function blogSlug(id: string): string {
	return id.replace(/^en\//, '');
}
