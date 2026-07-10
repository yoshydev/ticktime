<script lang="ts">
	import { formatHMS } from '$lib/duration';

	/** 計測開始時刻（epoch ms）。DB が真実で、経過は now - startedAt で算出する。 */
	let { startedAt }: { startedAt: number } = $props();

	let now = $state(Date.now());

	$effect(() => {
		// startedAt が変わっても 1 秒間隔で now を更新し続ける
		const id = setInterval(() => {
			now = Date.now();
		}, 1000);
		return () => clearInterval(id);
	});

	const elapsed = $derived(Math.max(0, Math.floor((now - startedAt) / 1000)));
</script>

<span class="timer">{formatHMS(elapsed)}</span>

<style>
	.timer {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}
</style>
