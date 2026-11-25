import { Octokit } from '@octokit/rest';
import { env } from '$env/dynamic/private';
import {
	LEGACY_FEATURES_PATH,
	LEGACY_TEXT_PATH,
	LEGACY_DATA_PATH,
	parseLegacyFeatures,
	normalizeLegacyMap
} from './legacy-map-repositories';

const CONFIG_PATH = 'src/lib/stores/config-map.js';
const EXCLUDED_REPOS = new Set(['map-tool', 'map-tool-update']);

export function getOctokit() {
	if (!env.GITHUB_TOKEN) {
		throw new Error('GitHub token not configured');
	}

	return new Octokit({ auth: env.GITHUB_TOKEN });
}

export function getRepoOwner() {
	if (!env.GITHUB_USERNAME) {
		throw new Error('GitHub username not configured');
	}

	return env.GITHUB_USERNAME;
}

export function isCandidateMapRepo(repo) {
	return repo?.owner?.login === getRepoOwner() && !EXCLUDED_REPOS.has(repo.name) && !repo.archived;
}

export function validateMapRepoName(repoName) {
	if (
		typeof repoName !== 'string' ||
		!/^[a-zA-Z0-9_.-]+$/.test(repoName) ||
		repoName === '.' ||
		repoName === '..' ||
		EXCLUDED_REPOS.has(repoName.toLowerCase())
	) {
		throw new Error('A valid map repository name is required');
	}
}

export function decodeGitHubContent(file) {
	if (!file?.content) {
		throw new Error('GitHub response did not include file content');
	}

	return Buffer.from(file.content, file.encoding === 'base64' ? 'base64' : 'utf-8').toString(
		'utf-8'
	);
}

export function parseMapConfigFile(content) {
	const startMarker = 'writable(';
	const start = content.indexOf(startMarker);
	if (start === -1) {
		throw new Error('Map config does not contain writable(...)');
	}

	const expressionStart = start + startMarker.length;
	const expressionEnd = content.lastIndexOf(');');
	if (expressionEnd === -1 || expressionEnd <= expressionStart) {
		throw new Error('Map config writable(...) expression is incomplete');
	}

	const expression = content.slice(expressionStart, expressionEnd).trim();
	const config = Function(`"use strict"; return (${expression});`)();

	if (!config || typeof config !== 'object' || Array.isArray(config)) {
		throw new Error('Map config did not evaluate to an object');
	}

	return config;
}

export function serializeMapConfig(config) {
	return `import { writable } from 'svelte/store';\n\nexport const mapConfig = writable(${JSON.stringify(
		config,
		null,
		2
	)});\n`;
}

export async function fetchMapConfig(octokit, repoName) {
	const owner = getRepoOwner();
	let data;
	try {
		({ data } = await octokit.repos.getContent({
			owner,
			repo: repoName,
			path: CONFIG_PATH,
			ref: 'main'
		}));
	} catch (error) {
		if (error.status !== 404) throw error;
		const read = async (path) => {
			const result = await octokit.repos.getContent({ owner, repo: repoName, path, ref: 'main' });
			return decodeGitHubContent(result.data);
		};
		const features = parseLegacyFeatures(await read(LEGACY_FEATURES_PATH));
		const [textContent, csv] = await Promise.all([read(LEGACY_TEXT_PATH), read(LEGACY_DATA_PATH)]);
		const text = JSON.parse(textContent);
		return {
			config: normalizeLegacyMap(features, text, csv),
			format: 'legacy',
			legacy: { features, text }
		};
	}

	if (Array.isArray(data)) {
		throw new Error('Map config path points to a directory');
	}

	const content = decodeGitHubContent(data);
	const config = parseMapConfigFile(content);

	return {
		config,
		format: 'current',
		content,
		sha: data.sha
	};
}

export { CONFIG_PATH };
