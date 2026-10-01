<script lang="ts">
	/**
	 * 用户头像。没有头像、或头像加载失败时回退到首字母圆圈。
	 *
	 * 回退是必须的而不是锦上添花：头像是本系统里第一张**远程**图片（来自
	 * WeAvatar），而这套系统部署在校园内网，很可能有相当一部分时候连不上外网。
	 * 内网的连接失败常常是挂起而不是立即报错，所以：
	 *   - 用 onerror 兜住加载失败；
	 *   - 一旦失败就永久切回首字母，不再重试，避免每次渲染都发一次注定失败的
	 *     请求（那会在慢网络下把侧边栏拖住）。
	 */
	interface Props {
		/** 后端算好的头像地址；空串表示未设置邮箱。 */
		url?: string;
		/** 回退文字取自这里，一般是显示名或用户名。 */
		name: string;
		size?: number;
		class?: string;
	}

	let { url = '', name, size = 32, class: extra = '' }: Props = $props();

	let failed = $state(false);

	// 换账号或改了邮箱后要重新尝试：新邮箱可能是有头像的。
	$effect(() => {
		void url;
		failed = false;
	});

	const initials = $derived((name || '?').slice(0, 1).toUpperCase());
	const showImage = $derived(!!url && !failed);

	const dimension = $derived(`${size}px`);
</script>

{#if showImage}
	<img
		src={url}
		alt=""
		width={size}
		height={size}
		class="shrink-0 rounded-full object-cover {extra}"
		style="width:{dimension};height:{dimension}"
		referrerpolicy="no-referrer"
		loading="lazy"
		decoding="async"
		onerror={() => (failed = true)}
	/>
{:else}
	<span
		class="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 font-semibold text-white {extra}"
		style="width:{dimension};height:{dimension}"
		aria-hidden="true"
	>
		{initials}
	</span>
{/if}
