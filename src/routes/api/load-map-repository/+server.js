import { json } from '@sveltejs/kit';
import { fetchMapConfig, getOctokit, getRepoOwner, validateMapRepoName } from '$lib/server/map-repositories';

export async function POST({ request }) {
	try {
		const { repoName } = await request.json();
		validateMapRepoName(repoName);

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
