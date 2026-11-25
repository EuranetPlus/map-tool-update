import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
	parseLegacyFeatures,
	normalizeLegacyMap,
	parseLegacyData,
	buildLegacyTree
} from '../src/lib/server/legacy-map-repositories.js';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/legacy-map.json', import.meta.url)));
const features = parseLegacyFeatures(fixture.features);
const config = normalizeLegacyMap(features, fixture.text, fixture.csv);

test('loads the split configuration, texts and all 27 farmer-age CSV records', () => {
	assert.equal(config.title, fixture.text.heading);
	assert.equal(config.colourScheme, 'green-blue');
	assert.equal(config.parsedData.length, 27);
	assert.equal(config.parsedData.find((x) => x.id === 'AT').value, 0.241);
	assert.equal(config.parsedData.find((x) => x.id === 'AT').extraInfo, false);
	assert.equal(config.data, fixture.csv);
	assert.equal(config.customUnitLabel, fixture.text.tooltip1);
	assert.equal(config.percentRounded, true);
});

test('preserves quoted CSV text, nulls, zero and multimedia fields', () => {
	const rows = parseLegacyData(
		'country,id,value,extraInfo,text_content,video_url\nGermany,DE,0,TRUE,"Text, with comma",https://video.example\nFrance,FR,null,FALSE,"Line one\nLine two",'
	);
	assert.equal(rows[0].value, 0);
	assert.equal(rows[0].extraInfo, true);
	assert.equal(rows[0].text_content, 'Text, with comma');
	assert.equal(rows[0].video_url, 'https://video.example');
	assert.equal(rows[1].value, null);
	assert.equal(rows[1].text_content, 'Line one\nLine two');
});

test('writes updated values and old language keys without replacing the legacy frontend', async () => {
	const edited = {
		...config,
		title: 'Edited title',
		linkDataAccess: 'https://example.org/new-data',
		data: fixture.csv.replace('Austria,AT,0.241', 'Austria,AT,0.250')
	};
	const tree = await buildLegacyTree(
		edited,
		{
			en: {
				title: 'Edited title',
				subtitle: 'Edited subtitle',
				extraInfo_DE: 'Edited country text'
			},
			de: { title: 'Deutscher Titel' }
		},
		{ features, text: fixture.text },
		async () => ({
			...fixture.text,
			extraInfoLink_DE: 'Keep this link',
			legend2: 'Keep extra legend'
		})
	);
	const byPath = Object.fromEntries(tree.map((x) => [x.path, x.content]));
	assert.match(byPath['static/data/thematic/data.csv'], /Austria,AT,0.250/);
	const english = JSON.parse(byPath['static/languages/en.json']);
	assert.equal(english.heading, 'Edited title');
	assert.equal(english.subheading, 'Edited subtitle');
	assert.equal(english.extraInfoText_DE, 'Edited country text');
	assert.equal(english.extraInfoLink_DE, 'Keep this link');
	assert.equal(english.legend2, 'Keep extra legend');
	assert.equal(english.linkDataAccess, 'https://example.org/new-data');
	assert.equal(JSON.parse(byPath['src/lib/stores/config-text.json']).heading, 'Edited title');
	const savedFeatures = parseLegacyFeatures(byPath['src/lib/stores/config-features.js']);
	assert.equal(savedFeatures.vercelURL, features.vercelURL);
	assert.equal(savedFeatures.mapTitle, features.mapTitle);
	assert.ok(
		!tree.some(
			(x) =>
				x.path.includes('.svelte') ||
				x.path.includes('config-map.js') ||
				x.path.includes('package.json') ||
				x.path.startsWith('.github/')
		)
	);
});

test('rejects unsupported display options and invalid paths before writing', async () => {
	await assert.rejects(
		buildLegacyTree(
			{ ...config, colourScheme: 'red' },
			{},
			{ features, text: fixture.text },
			async () => ({})
		),
		/older map supports/
	);
	await assert.rejects(
		buildLegacyTree(config, { '../bad': {} }, { features, text: fixture.text }, async () => ({})),
		/Invalid language/
	);
	assert.throws(
		() => parseLegacyData('country,id,value,extraInfo\nGermany,DE,wrong,false'),
		/Invalid CSV value/
	);
	assert.throws(() =>
		parseLegacyFeatures('export const config = (()=>{throw new Error("executed")})();')
	);
	assert.throws(() => parseLegacyFeatures('export const config = {}'));
});
