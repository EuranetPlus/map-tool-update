import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
	normalizeLegacyMap,
	parseLegacyFeatures
} from '../src/lib/server/legacy-map-repositories.js';
import { buildMigrationTree, modernizeLanguage } from '../src/lib/server/migrate-legacy-map.js';
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/legacy-map.json', import.meta.url)));
const config = normalizeLegacyMap(parseLegacyFeatures(fixture.features), fixture.text, fixture.csv);
const entries = [
	{ path: 'src/routes/index.svelte', type: 'blob', mode: '100644', sha: 'old-page' },
	{ path: '.github/workflows/translate.yaml', type: 'blob', mode: '100644', sha: 'old-workflow' },
	{ path: 'static/languages/de.json', type: 'blob' },
	{ path: 'static/languages/fr.json', type: 'blob' },
	{ path: 'IFRAME.md', type: 'blob', sha: 'original-embed' },
	{ path: '.map-tool-netlify', type: 'blob', sha: 'original-host' },
	{ path: 'unrelated-file', type: 'blob', sha: 'unrelated' }
];
const runtimeFiles = {
	'src/routes/+page.svelte': '<MapPanel standalone />',
	'package.json': '{"version":"modern"}',
	'src/lib/components/MapChoropleth.svelte': 'updated renderer'
};
const readLanguage = async (lang) =>
	lang === 'en'
		? fixture.text
		: {
				heading: `Title ${lang}`,
				extraInfoText_DE: 'Details',
				extraInfoLink_DE: 'Existing link',
				tooltip1: 'Unit'
			};

test('migrates a value update atomically to the current renderer with unchanged CSV meaning', async () => {
	const edited = {
		...config,
		data: config.data.replace('Austria,AT,0.241', 'Austria,AT,0.250'),
		colourScheme: 'red',
		colourSchemeClasses: 7,
		percentRounded: false
	};
	const tree = await buildMigrationTree({
		config: edited,
		translations: { en: { title: 'Updated title', extraInfo_DE: 'New details' } },
		entries,
		runtimeFiles,
		readLanguage
	});
	const byPath = Object.fromEntries(tree.map((e) => [e.path, e]));
	const source = byPath['src/lib/stores/config-map.js'].content;
	assert.match(source, /"colourScheme": "red"/);
	assert.match(source, /"colourSchemeClasses": 7/);
	assert.match(source, /Austria,AT,0.250/);
	assert.match(source, /"value": 0.25/);
	assert.equal(byPath['src/lib/components/MapChoropleth.svelte'].content, 'updated renderer');
	assert.equal(byPath['src/routes/index.svelte'].sha, null);
	assert.equal(byPath['.map-tool-legacy/.github/workflows/translate.yaml'].sha, 'old-workflow');
	assert.equal(byPath['.github/workflows/translate.yaml'], undefined);
	assert.match(byPath['translate.js'].content, /Legacy file generation is disabled/);
	assert.equal(byPath['IFRAME.md'], undefined);
	assert.equal(byPath['.map-tool-netlify'], undefined);
	assert.equal(byPath['unrelated-file'], undefined);
	assert.equal(JSON.parse(byPath['static/languages/en.json'].content).title, 'Updated title');
	const french = JSON.parse(byPath['static/languages/fr.json'].content);
	assert.equal(french.title, 'Title fr');
	assert.equal(french.extraInfo_DE, 'Details');
	assert.equal(french.extraInfoLink_DE, 'Existing link');
});

test('layout-only migration retains every value, English text and language entry', async () => {
	const tree = await buildMigrationTree({
		config,
		translations: {},
		entries,
		runtimeFiles,
		readLanguage
	});
	const csv = tree.find((e) => e.path === 'static/data/thematic/data.csv');
	assert.equal(csv.content, fixture.csv);
	const en = JSON.parse(tree.find((e) => e.path === 'static/languages/en.json').content);
	assert.equal(en.heading, fixture.text.heading);
	assert.equal(en.title, fixture.text.heading);
	assert.equal(en.customUnitLabel, fixture.text.tooltip1);
	assert.equal(en.linkDataAccess, fixture.text.linkDataAccess);
});

test('rejects invalid language paths and malformed CSV before generating a commit', async () => {
	await assert.rejects(
		buildMigrationTree({
			config,
			translations: { '../bad': {} },
			entries,
			runtimeFiles,
			readLanguage
		}),
		/Invalid language/
	);
	await assert.rejects(
		buildMigrationTree({
			config: { ...config, data: 'invalid' },
			translations: {},
			entries,
			runtimeFiles,
			readLanguage
		}),
		/missing/
	);
});

test('preserves existing modern translations when mapping older keys', () => {
	const result = modernizeLanguage({
		heading: 'Old',
		title: 'New',
		subheading: 'Subtitle',
		textDataAccess: 'Data',
		tooltip1: 'Unit',
		extraInfoText_DE: 'Details'
	});
	assert.equal(result.title, 'New');
	assert.equal(result.subtitle, 'Subtitle');
	assert.equal(result.linkDataAccessDescription, 'Data');
	assert.equal(result.extraInfo_DE, 'Details');
});
