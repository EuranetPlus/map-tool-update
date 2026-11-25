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
