import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		// The Go backend serves this app from /admin as plain static files
		// (see backend/routes/web.go), so the build must be a static SPA that
		// references every asset through the /admin base path.
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html',
			precompress: false,
			strict: false
		}),
		paths: {
			base: '/admin',
			relative: false
		},
		appDir: '_app',
		prerender: {
			// Only the shell is prerendered; every other route is served through
			// the SPA fallback so the Go server needs just one static handler.
			crawl: false,
			entries: ['/']
		}
	}
};

export default config;
