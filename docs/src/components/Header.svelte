<script>
	let menuOpen = $state(false);

	function handleKeydown(event) {
		if (event.key === 'Escape' && menuOpen) {
			menuOpen = false;
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<header class="sticky top-0 z-50 w-full border-b border-slate-200/60 bg-white/80 backdrop-blur-md transition-all">
	<div class="mx-auto flex max-w-5xl items-center px-4 py-3.5">
		<!-- Logo -->
		<a href="/" class="group flex items-center gap-2.5 outline-none">
			<div class="relative flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 shadow-md shadow-indigo-200 transition-transform group-hover:scale-110">
				<svg
					width="20"
					height="20"
					viewBox="0 0 32 32"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
					aria-hidden="true"
				>
					<rect x="6" y="6" width="20" height="20" rx="4" stroke="white" stroke-width="2.5" />
					<circle cx="10" cy="10" r="2" fill="white" />
					<circle cx="22" cy="10" r="2" fill="white" />
					<circle cx="22" cy="22" r="2" fill="white" />
					<circle cx="10" cy="22" r="2" fill="white" />
				</svg>
			</div>
			<span class="text-xl font-extrabold tracking-tight text-slate-900 group-hover:text-indigo-600 transition-colors">ScholarView</span>
		</a>

		<!-- Desktop Nav -->
		<nav class="ml-10 hidden items-center gap-8 md:flex">
			<a href="/introduction/" class="text-sm font-medium text-slate-600 hover:text-indigo-600 transition-colors">Manual</a>
			<a href="/blog/" class="text-sm font-medium text-slate-600 hover:text-indigo-600 transition-colors">Blog</a>
			<a
				href="https://github.com/takeruhukushima/ScholarView"
				target="_blank"
				rel="noopener noreferrer"
				class="text-sm font-medium text-slate-600 hover:text-indigo-600 transition-colors"
			>
				GitHub
			</a>
		</nav>

		<!-- Right side -->
		<div class="ml-auto hidden items-center gap-4 md:flex">
			<a
				href="https://github.com/takeruhukushima/ScholarView/discussions"
				target="_blank"
				rel="noopener noreferrer"
				class="rounded-full bg-slate-900 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-slate-800 hover:shadow-lg active:scale-95"
			>
				Community &rarr;
			</a>
		</div>

		<!-- Mobile hamburger -->
		<button
			class="ml-auto flex h-10 w-10 items-center justify-center rounded-full hover:bg-slate-100 md:hidden transition-colors"
			onclick={() => (menuOpen = !menuOpen)}
			aria-label="Toggle menu"
			aria-expanded={menuOpen}
		>
			{#if menuOpen}
				<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
				</svg>
			{:else}
				<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
				</svg>
			{/if}
		</button>
	</div>

	<!-- Mobile dropdown -->
	{#if menuOpen}
		<nav class="border-t border-slate-100 bg-white/95 px-4 py-4 md:hidden backdrop-blur-md">
			<div class="flex flex-col gap-2">
				<a href="/introduction/" class="rounded-xl px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 transition-all" onclick={() => (menuOpen = false)}>Manual</a>
				<a href="/blog/" class="rounded-xl px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 transition-all" onclick={() => (menuOpen = false)}>Blog</a>
				<a href="https://github.com/takeruhukushima/ScholarView" target="_blank" class="rounded-xl px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 transition-all" onclick={() => (menuOpen = false)}>GitHub</a>
			</div>
		</nav>
	{/if}
</header>
