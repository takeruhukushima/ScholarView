<script lang="ts">
	import { localizePath, useTranslations, type Lang } from '../i18n/ui';

	let { lang = 'ja' }: { lang?: Lang } = $props();
	const t = $derived(useTranslations(lang));
</script>

<footer class="border-t border-gray-200 py-8 text-center text-sm text-gray-500">
  <p>
    {t('footer.licensed')} <a
      href="https://github.com/takeruhukushima/ScholarView/blob/main/COPYING"
      class="underline hover:text-gray-700"
      target="_blank"
      rel="noopener noreferrer">AGPL-3.0</a
    >.
  </p>
  <p class="mt-2 text-gray-400">
    <a href="https://github.com/takeruhukushima/ScholarView" class="hover:text-gray-700 transition-colors">GitHub</a>
    <span class="mx-2">&middot;</span>
    <a href={localizePath('/introduction/', lang)} class="hover:text-gray-700 transition-colors">{t('footer.manual')}</a>
    <span class="mx-2">&middot;</span>
    <a href={localizePath('/blog/', lang)} class="hover:text-gray-700 transition-colors">{t('footer.blog')}</a>
    <span class="mx-2">&middot;</span>
    <a href={localizePath('/getting-started/', lang)} class="hover:text-gray-700 transition-colors">{t('footer.gettingStarted')}</a>
  </p>
</footer>
