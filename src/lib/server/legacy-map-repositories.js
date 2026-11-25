import { csvParse } from 'd3-dsv';

export const LEGACY_FEATURES_PATH = 'src/lib/stores/config-features.js';
export const LEGACY_TEXT_PATH = 'src/lib/stores/config-text.json';
export const LEGACY_DATA_PATH = 'static/data/thematic/data.csv';
const TEXT_FIELDS = {
	title: 'heading',
	subtitle: 'subheading',
	legend1: 'legend1',
	textSourceDescription: 'textSourceDescription',
	textSource: 'textSource',
	textNoteDescription: 'textNoteDescription',
	textNote: 'textNote',
	linkDataAccessDescription: 'textDataAccess',
	linkDataAccess: 'linkDataAccess',
	customUnitLabel: 'tooltip1',
	tooltipExtraInfoLabel: 'textCountryClick'
};

export function parseLegacyFeatures(content) {
	const match = content.match(/export\s+const\s+config\s*=\s*([\s\S]*?)\s*;?\s*$/);
	if (!match) throw new Error('Legacy map settings are not compatible');
	// Preserve quoted strings while removing comments; never execute repository code.
	const expression = match[1]
		.replace(/;\s*$/, '')
		.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (token) =>
			token.startsWith('"') ? token : ''
		);
	const config = JSON.parse(expression);
	if (
		!config ||
		typeof config !== 'object' ||
		Array.isArray(config) ||
		!['values', 'binary'].includes(config.datasetType) ||
		typeof config.colourScheme !== 'string'
	) {
		throw new Error('Legacy map settings are not compatible');
	}
	return config;
}

export function parseLegacyData(data) {
	const rows = csvParse(data);
	for (const field of ['country', 'id', 'value', 'extraInfo']) {
		if (!rows.columns.includes(field)) throw new Error(`Map CSV is missing ${field}`);
	}
	const ids = new Set();
	return rows.map((row) => {
		const value = row.value.trim();
		if (!row.id || ids.has(row.id))
			throw new Error('Map CSV contains missing or duplicate country IDs');
		ids.add(row.id);
		if (value !== '' && value !== 'null' && !Number.isFinite(Number(value))) {
			throw new Error(`Invalid CSV value for ${row.id}`);
		}
		if (!['', 'true', 'false'].includes(row.extraInfo.trim().toLowerCase())) {
			throw new Error(`Invalid CSV extraInfo for ${row.id}`);
		}
		return {
			...row,
			value: value === '' || value === 'null' ? null : Number(value),
			extraInfo: row.extraInfo.trim().toLowerCase() === 'true'
		};
	});
}

export function normalizeLegacyMap(features, text, data) {
	if (!text || typeof text !== 'object' || typeof text.heading !== 'string') {
		throw new Error('Legacy map text is not compatible');
	}
	const config = {
		...features,
		colourSchemeType: 'sequential',
		colourSchemeClasses: 5,
		colourSchemeReverse: false,
		percentRounded: true,
		overrideScaleValues: false,
		customUnitLabelAvailable: Boolean(text.tooltip1),
		data,
		parsedData: parseLegacyData(data)
	};
	for (const [current, legacy] of Object.entries(TEXT_FIELDS)) config[current] = text[legacy] ?? '';
	config.translate = {
		...text,
		...Object.fromEntries(Object.keys(TEXT_FIELDS).map((key) => [key, config[key]]))
	};
	return config;
}

export function toLegacyText(current, existing = {}) {
	const result = { ...existing };
	for (const [modern, legacy] of Object.entries(TEXT_FIELDS)) {
		if (Object.hasOwn(current, modern)) result[legacy] = current[modern] ?? '';
	}
	for (const [key, value] of Object.entries(current)) {
		// Older maps use the extraInfoText_XX convention.
		if (/^extraInfo_[A-Z]{2}$/.test(key))
			result[key.replace('extraInfo_', 'extraInfoText_')] = value;
		if (/^extraInfo(?:Text|Link)_[A-Z]{2}$/.test(key)) result[key] = value;
	}
	return result;
}

export async function buildLegacyTree(config, translations, legacy, readLanguage) {
	if (
		config.colourSchemeType !== 'sequential' ||
		config.colourSchemeClasses !== 5 ||
		config.colourSchemeReverse ||
		config.overrideScaleValues ||
		!['blue', 'purple-blue', 'green-blue', 'orange-red'].includes(config.colourScheme) ||
		(config.datasetUnit === 'percent' && !config.percentRounded)
	) {
		throw new Error(
			'This older map supports five classes, the original four sequential palettes and rounded percentages. Keep these settings, or migrate its frontend before using newer display options.'
		);
	}
	parseLegacyData(config.data);
	const features = { ...legacy.features };
	for (const key of [
		'datasetType',
		'datasetUnit',
		'colourScheme',
		'headlineAvailable',
		'subheadlineAvailable',
		'tooltipAvailable',
		'scaleBarAvailable',
		'legendAvailable',
		'textSourceAvailable',
		'textNoteAvailable',
		'textDataAccessAvailable',
		'legend1Color'
	]) {
		if (Object.hasOwn(config, key)) features[key] = config[key];
	}
	const blob = (path, content) => ({ path, mode: '100644', type: 'blob', content });
	const json = (data) => `${JSON.stringify(data, null, 2)}\n`;
	const tree = [
		blob(LEGACY_FEATURES_PATH, `export const config = ${JSON.stringify(features, null, 2)};\n`),
		blob(
			LEGACY_TEXT_PATH,
			json(
				toLegacyText(
					{ ...config, ...translations.en, linkDataAccess: config.linkDataAccess },
					legacy.text
				)
			)
		),
		blob(LEGACY_DATA_PATH, config.data)
	];
	for (const [lang, content] of Object.entries(translations)) {
		if (!/^[a-z]{2}$/.test(lang)) throw new Error(`Invalid language code: ${lang}`);
		const existing = await readLanguage(lang);
		tree.push(
			blob(
				`static/languages/${lang}.json`,
				json(toLegacyText({ ...content, linkDataAccess: config.linkDataAccess }, existing))
			)
		);
	}
	return tree;
}
