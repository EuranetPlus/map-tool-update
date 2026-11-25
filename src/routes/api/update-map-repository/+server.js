import { json } from '@sveltejs/kit';
import {
	CONFIG_PATH,
	decodeGitHubContent,
	fetchMapConfig,
	getOctokit,
	getRepoOwner,
	serializeMapConfig,
	validateMapRepoName
} from '$lib/server/map-repositories';
import mapPanelSource from '$lib/components/MapPanel.svelte?raw';
import mapChoroplethSource from '$lib/components/MapChoropleth.svelte?raw';
import { buildLegacyTree } from '$lib/server/legacy-map-repositories';
import { getNetlifyMap } from '$lib/server/netlify-maps';

const MAP_PANEL_PATH = 'src/lib/components/MapPanel.svelte';

function validatePayload(mapConfig, translations) {
	if (!mapConfig || typeof mapConfig !== 'object' || Array.isArray(mapConfig)) {
		throw new Error('Map configuration is required');
	}

	if (!translations || typeof translations !== 'object' || Array.isArray(translations)) {
		throw new Error('Translations are required');
	}
}

function buildTreeElements(mapConfig, translations) {
	const tree = [
		{
			path: CONFIG_PATH,
			mode: '100644',
			type: 'blob',
			content: serializeMapConfig(mapConfig)
		},
		{
			path: MAP_PANEL_PATH,
			mode: '100644',
			type: 'blob',
			content: mapPanelSource
		},
		{
			path: 'src/lib/components/MapChoropleth.svelte',
			mode: '100644',
			type: 'blob',
			content: mapChoroplethSource
		}
	];

	for (const [lang, content] of Object.entries(translations)) {
		if (!/^[a-z]{2}$/.test(lang)) {
			throw new Error(`Invalid language code: ${lang}`);
		}

		tree.push({
			path: `static/languages/${lang}.json`,
			mode: '100644',
			type: 'blob',
			content: `${JSON.stringify(content, null, 2)}\n`
		});
	}

	return tree;
}

export async function POST({ request }) {
	try {
		const { repoName, mapConfig, translations } = await request.json();
		validateMapRepoName(repoName);
		validatePayload(mapConfig, translations);

		const octokit = getOctokit();
		const owner = getRepoOwner();
		const repo = repoName;
		const branch = 'main';
		const loaded = await fetchMapConfig(octokit, repoName);
		const treeElements =
			loaded.format === 'legacy'
				? await buildLegacyTree(mapConfig, translations, loaded.legacy, async (lang) => {
						try {
							const { data } = await octokit.repos.getContent({
								owner,
								repo,
								path: `static/languages/${lang}.json`,
								ref: branch
							});
							return JSON.parse(decodeGitHubContent(data));
						} catch (error) {
							if (error.status !== 404) throw error;
							return {};
						}
					})
				: buildTreeElements(mapConfig, translations);
		const deployment = (await getNetlifyMap(octokit, owner, repo)) ?? {
			provider: 'vercel',
			projectUrl: `https://${repoName}.vercel.app/?view=fullscreen`
		};

		const { data: ref } = await octokit.git.getRef({
			owner,
			repo,
			ref: `heads/${branch}`
		});

		const baseSha = ref.object.sha;
		const { data: baseCommit } = await octokit.git.getCommit({
			owner,
			repo,
			commit_sha: baseSha
		});

		const { data: tree } = await octokit.git.createTree({
			owner,
			repo,
			base_tree: baseCommit.tree.sha,
			tree: treeElements
		});

		const { data: commit } = await octokit.git.createCommit({
			owner,
			repo,
			message: 'Update map configuration and translations',
			tree: tree.sha,
			parents: [baseSha]
		});

		await octokit.git.updateRef({
			owner,
			repo,
			ref: `heads/${branch}`,
			sha: commit.sha
		});

		return json({
			status: 'success',
			message: 'Map repository updated successfully',
			commitSha: commit.sha,
			repoUrl: `https://github.com/${owner}/${repoName}`,
			...deployment
		});
	} catch (error) {
		console.error('Failed to update map repository:', error);
		return json(
			{
				error: error.message || 'Failed to update map repository',
				details: error.response?.data || error.stack
			},
			{ status: error.status || 500 }
		);
	}
}
