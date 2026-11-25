import supportFiles from './map-runtime-files.json';
import pageSource from './map-runtime/+page.svelte.txt?raw';
import svelteConfig from './map-runtime/svelte.config.js.txt?raw';

// Bundle only the public map renderer; no editor APIs, credentials or example data.
const renderer = import.meta.glob(
	[
		'../components/MapPanel.svelte',
		'../components/MapChoropleth.svelte',
		'../components/MapSimple.svelte',
		'../components/Legend.svelte',
		'../components/Scale.svelte',
		'../components/CountryInfo.svelte',
		'../components/CountryMediaComponent.svelte',
		'../stores/shared.js',
		'../stores/countries.js',
		'../stores/languages.js',
		'../stores/translations.js',
		'../stores/update-map.js',
		'../utils/formatNumbers.js',
		'../utils/customColorPalettes.js'
	],
	{ query: '?raw', import: 'default', eager: true }
);

export const mapRuntimeFiles = {
	...supportFiles,
	...Object.fromEntries(
		Object.entries(renderer).map(([path, content]) => ['src/lib/' + path.slice(3), content])
	),
	'src/routes/+page.svelte': pageSource,
	'src/routes/+page.js': 'export const ssr = false;\n',
	'svelte.config.js': svelteConfig,
	'vercel.json':
		JSON.stringify(
			{
				framework: null,
				installCommand: 'npm ci',
				buildCommand: 'npm run build',
				outputDirectory: 'build'
			},
			null,
			2
		) + '\n',
	'netlify.toml':
		'[build]\n  command = "npm run build"\n  publish = "build"\n[build.environment]\n  NODE_VERSION = "24"\n'
};
