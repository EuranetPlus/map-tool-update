import { parseLegacyData } from './legacy-map-repositories.js';

export function modernizeLanguage(text) {
	const mapped = { ...text };
	for (const [legacy, modern] of Object.entries({
		heading: 'title',
		subheading: 'subtitle',
		textDataAccess: 'linkDataAccessDescription',
		tooltip1: 'customUnitLabel',
		textCountryClick: 'tooltipExtraInfoLabel'
	})) {
		if (!Object.hasOwn(mapped, modern) && Object.hasOwn(text, legacy))
			mapped[modern] = text[legacy];
	}
	for (const [key, value] of Object.entries(text)) {
		if (/^extraInfoText_[A-Z]{2}$/.test(key))
			mapped[key.replace('extraInfoText_', 'extraInfo_')] = value;
	}
	return mapped;
}

// Return one atomic tree: dependencies, renderer, data, translations and obsolete entry points.
// The repository identity and hosting project are never recreated or renamed.
export async function buildMigrationTree({
	config,
	translations,
	entries,
	runtimeFiles,
	readLanguage
}) {
	const blob = (path, content) => ({ path, content, mode: '100644', type: 'blob' });
	const json = (value) => JSON.stringify(value, null, 2) + '\n';
	const migratedConfig = { ...config, parsedData: parseLegacyData(config.data) };
	const languages = new Set(['en', ...Object.keys(translations)]);
	for (const entry of entries) {
		const match = entry.path.match(/^static\/languages\/([a-z]{2})\.json$/);
		if (match) languages.add(match[1]);
	}
	const normalized = {};
	for (const lang of languages) {
		if (!/^[a-z]{2}$/.test(lang)) throw new Error(`Invalid language code: ${lang}`);
		const previous = modernizeLanguage(await readLanguage(lang));
		const incoming = modernizeLanguage(translations[lang] ?? {});
		normalized[lang] = { ...previous, ...incoming };
	}
	migratedConfig.translate = { ...modernizeLanguage(config.translate ?? {}), ...normalized.en };
	const tree = Object.entries(runtimeFiles).map(([path, content]) => blob(path, content));
	tree.push(
		blob(
			'src/lib/stores/config-map.js',
			`import { writable } from 'svelte/store';\nexport const mapConfig = writable(${JSON.stringify(migratedConfig, null, 2)});\n`
		)
	);
	for (const [lang, text] of Object.entries(normalized))
		tree.push(blob(`static/languages/${lang}.json`, json(text)));
	// Keep the original CSV and legacy configuration as a record; the new renderer uses config-map.js.
	tree.push(blob('static/data/thematic/data.csv', config.data));
	tree.push(
		blob(
			'.map-tool-runtime',
			json({ version: 1, format: 'sveltekit-map', migratedFrom: 'split-config' })
		)
	);
	const obsolete = new Set([
		'src/routes/index.svelte',
		'src/routes/__layout.svelte',
		'postcss.config.cjs',
		'tailwind.config.cjs',
		'yarn.lock'
	]);
	for (const entry of entries) {
		if (entry.type !== 'blob') continue;
		const oldWorkflow = /^\.github\/workflows\/(?:translate|create-embed)\.ya?ml$/.test(entry.path);
		if (oldWorkflow)
			tree.push({
				path: '.map-tool-legacy/' + entry.path,
				sha: entry.sha,
				type: 'blob',
				mode: entry.mode
			});
		if (obsolete.has(entry.path))
			tree.push({ path: entry.path, sha: null, type: 'blob', mode: entry.mode });
	}
	for (const path of ['translate.js', 'create-embed.js']) {
		const previous = entries.find((entry) => entry.path === path && entry.type === 'blob');
		if (previous)
			tree.push({
				path: '.map-tool-legacy/' + path,
				sha: previous.sha,
				mode: previous.mode,
				type: 'blob'
			});
		tree.push(
			blob(
				path,
				"console.log('This map is managed by map-tool-update. Legacy file generation is disabled.');\n"
			)
		);
	}
	return tree;
}
