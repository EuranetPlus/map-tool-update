import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
	parseLegacyFeatures,
	normalizeLegacyMap,
	parseLegacyData
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
