import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { Octokit } from '@octokit/rest';
import { deployNetlifyMap, isVercelProjectLimit, isNetlifyMap } from '$lib/server/netlify-maps';

// Constants
const REPO_CHECK_MAX_ATTEMPTS = 5;
const REPO_CHECK_DELAY = 2000;

// Helper to get Vercel token
function getVercelToken() {
	const token = env.DEPLOY_VERCEL_TOKEN || env.VERCEL_TOKEN;
	if (!token) {
		throw new Error('No Vercel token found');
	}
	return token;
}

// Helper function to wait for repo to be available
async function waitForRepo(octokit, owner, repo) {
	for (let i = 0; i < REPO_CHECK_MAX_ATTEMPTS; i++) {
		try {
			console.log(`Attempt ${i + 1} to fetch repo...`);
			const { data } = await octokit.repos.get({
				owner,
				repo
			});
			console.log('Repository found:', data.full_name);
			return data;
		} catch (error) {
			console.log(`Attempt ${i + 1} failed:`, error.message);
			if (i === REPO_CHECK_MAX_ATTEMPTS - 1) {
				throw new Error(`Failed to find repository after ${REPO_CHECK_MAX_ATTEMPTS} attempts`);
			}
			await new Promise((resolve) => setTimeout(resolve, REPO_CHECK_DELAY));
		}
	}
}

export async function POST({ request }) {
	try {
		if (!env.GITHUB_TOKEN || !env.GITHUB_USERNAME) {
			throw new Error('Missing required environment variables');
		}

		// Get repository name from request
		const { repoName } = await request.json();
		if (typeof repoName !== 'string' || !/^[a-z0-9_-]+$/i.test(repoName)) {
			return json({ error: 'A valid map repository name is required' }, { status: 400 });
		}

		console.log('Starting Vercel deployment process...');

		// Initialize Octokit and wait for repo
		const octokit = new Octokit({ auth: env.GITHUB_TOKEN });
		const repo = await waitForRepo(octokit, env.GITHUB_USERNAME, repoName);
		// Only the one explicitly configured map in a Vercel Preview can skip Vercel.
		if (
			env.VERCEL_ENV === 'preview' &&
			/^map-[a-z0-9-]+$/.test(repoName) &&
			repoName === env.NETLIFY_PREVIEW_TEST_REPO
		) {
			return json(await deployNetlifyMap(octokit, repo));
		}
		if (
			env.NETLIFY_FALLBACK_ENABLED === 'true' &&
			(await isNetlifyMap(octokit, env.GITHUB_USERNAME, repoName))
		) {
			return json(await deployNetlifyMap(octokit, repo));
		}

		// Create Vercel project
		const token = getVercelToken();
		const simulateProjectLimit =
			env.VERCEL_ENV === 'preview' &&
			env.VERCEL_GIT_COMMIT_REF === 'test/netlify-preview' &&
			repoName === 'map-netlify-quota-qa-20261117';
		const projectResponse = simulateProjectLimit
			? Response.json({ error: { code: 'project_limit_reached', message: 'Project limit reached.' } }, { status: 403 })
			: await fetch('https://api.vercel.com/v9/projects', {
					method: 'POST',
					headers: {
						Authorization: `Bearer ${token}`,
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({
						name: repoName,
						framework: 'svelte',
						gitRepository: {
							type: 'github',
							repo: `${env.GITHUB_USERNAME}/${repoName}`,
							repoId: repo.id.toString()
						},
						buildCommand: 'npm run build',
						devCommand: 'npm run dev',
						outputDirectory: '.svelte-kit',
						environmentVariables: [
							{
								key: 'GITHUB_TOKEN',
								value: env.GITHUB_TOKEN,
								type: 'encrypted',
								target: ['production', 'preview', 'development']
							},
							{
								key: 'GITHUB_USERNAME',
								value: env.GITHUB_USERNAME,
								type: 'plain',
								target: ['production', 'preview', 'development']
							}
						]
					})
				});

		const projectData = await projectResponse.json();
		if (
			env.NETLIFY_FALLBACK_ENABLED === 'true' &&
			isVercelProjectLimit(projectResponse, projectData.error)
		) {
			if (simulateProjectLimit) console.info('Preview QA: simulated Vercel project limit triggered Netlify fallback');
			return json(await deployNetlifyMap(octokit, repo));
		}
		if (!projectResponse.ok || !projectData.id) {
			throw new Error(projectData.error?.message || 'Failed to create Vercel project');
		}

		// Create deployment
		const deployResponse = await fetch('https://api.vercel.com/v13/deployments', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				name: repoName,
				project: projectData.id,
				gitSource: {
					type: 'github',
					repo: `${env.GITHUB_USERNAME}/${repoName}`,
					ref: 'main',
					repoId: repo.id.toString()
				}
			})
		});

		const deployData = await deployResponse.json();
		if (!deployResponse.ok || !deployData) {
			throw new Error(deployData?.error?.message || 'Failed to create deployment');
		}

		return json({
			provider: 'vercel',
			message: 'Project created and deployment initiated',
			deploymentUrl: deployData.url,
			projectUrl: `https://${repoName}.vercel.app/?view=fullscreen` // Single source of URL construction
		});
	} catch (error) {
		console.error('Deployment error:', error);
		return json(
			{
				error: error.message || 'Failed to deploy'
			},
			{ status: error.status || 500 }
		);
	}
}
