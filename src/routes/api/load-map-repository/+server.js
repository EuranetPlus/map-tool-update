import { json } from '@sveltejs/kit';
import { fetchMapConfig, getOctokit, getRepoOwner } from '$lib/server/map-repositories';

function validateRepoName(repoName) {
	if (!repoName || !/^map-[a-zA-Z0-9-_]+$/.test(repoName)) {
		throw new Error('A valid map repository name is required');
	}
}

export async function POST({ request }) {
	try {
		const { repoName } = await request.json();
		validateRepoName(repoName);

		const octokit = getOctokit();
		const { config } = await fetchMapConfig(octokit, repoName);

		return json({
			repoName,
			repoUrl: `https://github.com/${getRepoOwner()}/${repoName}`,
			config
		});
	} catch (error) {
		console.error('Failed to load map repository:', error);
		return json(
			{
				error: error.message || 'Failed to load map repository'
			},
			{ status: error.status || 500 }
		);
	}
}
