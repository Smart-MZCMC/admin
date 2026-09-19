<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { auth } from '$lib/stores/auth.svelte';

	let done = $state(false);

	onMount(() => {
		void auth.restore();
	});

	// Send the visitor to the admin home, or to login when there is no session.
	$effect(() => {
		if (auth.loading || done) return;
		done = true;
		void goto(auth.user ? '/users' : '/login', { replaceState: true });
	});
</script>

<div class="flex min-h-screen items-center justify-center text-sm text-gray-500">正在跳转...</div>
