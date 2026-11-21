// Inline <head> script: on the first visit, send the reader to the locale that
// matches their browser language. After that, the locale of whatever page they
// open (e.g. via the language switcher) becomes their stored preference, so we
// never fight an explicit choice.
//
// - Japanese (ja*) browser → Japanese (root). English or anything else → /en/.
// - Pages without a translation opt out with <meta name="sv-lang-redirect" content="off">
//   placed before this script.
// - Crawlers are never redirected, and if localStorage is unavailable we do
//   nothing (otherwise every page load would re-redirect and trap the reader).
export const autoLangScript = `(function () {
	try {
		if (/bot|crawl|spider|slurp|lighthouse/i.test(navigator.userAgent)) return;
		var KEY = 'scholarview-lang';
		var path = location.pathname;
		var current = /^\\/en(\\/|$)/.test(path) ? 'en' : 'ja';
		var optOut = !!document.querySelector('meta[name="sv-lang-redirect"][content="off"]');
		var stored = localStorage.getItem(KEY);
		if (stored === 'ja' || stored === 'en') {
			if (stored !== current && !optOut) localStorage.setItem(KEY, current);
			return;
		}
		var langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
		var pref = 'en';
		for (var i = 0; i < langs.length; i++) {
			var l = String(langs[i]).toLowerCase();
			if (l.indexOf('ja') === 0) { pref = 'ja'; break; }
			if (l.indexOf('en') === 0) { pref = 'en'; break; }
		}
		localStorage.setItem(KEY, pref);
		if (pref === current || optOut) return;
		var base = path.replace(/^\\/en(?=\\/|$)/, '') || '/';
		location.replace((pref === 'ja' ? base : '/en' + base) + location.search + location.hash);
	} catch (e) {}
})();`;
