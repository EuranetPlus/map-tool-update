import { json } from '@sveltejs/kit';
import { fetchMapConfig, getOctokit, isCandidateMapRepo } from '$lib/server/map-repositories';

export async function GET() {
	try {
		const octokit = getOctokit();
		const repos = await octokit.paginate(octokit.repos.listForAuthenticatedUser, {
			affiliation: 'owner',
			per_page: 100,
			sort: 'updated',
			direction: 'desc'
		});

		const candidates = repos.filter(isCandidateMapRepo);
		const compatibilityChecks = await Promise.allSettled(
			candidates.map(async (repo) => {
				await fetchMapConfig(octokit, repo.name);

				return {
					name: repo.name,
					fullName: repo.full_name,
					url: repo.html_url,
					defaultBranch: repo.default_branch || 'main',
					updatedAt: repo.updated_at
				};
			})
		);

		const repositories = compatibilityChecks
			.filter((result) => result.status === 'fulfilled')
			.map((result) => result.value);

		return json({ repositories });
	} catch (error) {
		console.error('Failed to list map repositories:', error);
		return json(
			{
				error: error.message || 'Failed to list map repositories'
			},
			{ status: error.status || 500 }
		);
	}
}
