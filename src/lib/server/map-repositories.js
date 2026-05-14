import { Octokit } from '@octokit/rest';
import { GITHUB_TOKEN, GITHUB_USERNAME } from '$env/static/private';

const CONFIG_PATH = 'src/lib/stores/config-map.js';
const EXCLUDED_REPOS = new Set(['map-tool', 'map-tool-update']);

export function getOctokit() {
	if (!GITHUB_TOKEN) {
		throw new Error('GitHub token not configured');
	}

	return new Octokit({ auth: GITHUB_TOKEN });
}

export function getRepoOwner() {
	if (!GITHUB_USERNAME) {
		throw new Error('GitHub username not configured');
	}

	return GITHUB_USERNAME;
}

export function isCandidateMapRepo(repo) {
	return (
		repo?.owner?.login === getRepoOwner() &&
		repo.name.startsWith('map-') &&
		!EXCLUDED_REPOS.has(repo.name) &&
		!repo.archived
	);
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
	const { data } = await octokit.repos.getContent({
		owner,
		repo: repoName,
		path: CONFIG_PATH,
		ref: 'main'
	});

	if (Array.isArray(data)) {
		throw new Error('Map config path points to a directory');
	}

	const content = decodeGitHubContent(data);
	const config = parseMapConfigFile(content);

	return {
		config,
		content,
		sha: data.sha
	};
}

export { CONFIG_PATH };
