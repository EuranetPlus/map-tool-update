import { json } from '@sveltejs/kit';
import {
	CONFIG_PATH,
	getOctokit,
	getRepoOwner,
	serializeMapConfig
} from '$lib/server/map-repositories';

function validateRepoName(repoName) {
	if (!repoName || !/^map-[a-zA-Z0-9-_]+$/.test(repoName)) {
		throw new Error('A valid map repository name is required');
	}
}

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
		validateRepoName(repoName);
		validatePayload(mapConfig, translations);

		const octokit = getOctokit();
		const owner = getRepoOwner();
		const repo = repoName;
		const branch = 'main';

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
			tree: buildTreeElements(mapConfig, translations)
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
			projectUrl: `https://${repoName}.vercel.app/?view=fullscreen`
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
