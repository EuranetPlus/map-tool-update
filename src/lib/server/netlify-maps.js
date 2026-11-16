import { env } from '$env/dynamic/private';

const CONFIG_PATH = 'netlify.toml';
const MARKER_PATH = '.map-tool-netlify';
const BUILD_CONFIG =
	'[build]\n  command = "npm run build"\n  publish = "build"\n' +
	'[build.environment]\n  NODE_VERSION = "24"\n';

// The map reads its data and language files in the browser. Publish only the
// client bundle and static assets, leaving the editor's API on Vercel.
const SVELTE_CONFIG = `export default {
	kit: {
		adapter: {
			name: 'netlify-static-map',
			async adapt(builder) {
				builder.rimraf('build');
				builder.writeClient('build');
				await builder.generateFallback('build/index.html');
			}
		}
	}
};
`;

export function isVercelProjectLimit(response, error) {
	if (![400, 403, 409].includes(response.status)) return false;
	const code = error?.code;
	return (
		code === 'project_limit_reached' ||
		((code === 'forbidden' || code === 'bad_request') &&
			/^(?:you(?:r team)? (?:have|has) reached (?:the|your) (?:maximum number of projects|project limit|limit of \d+ projects)|(?:the )?(?:maximum number of projects|project limit) (?:has been )?reached)(?:[.!]|$)/i.test(
				error?.message ?? ''
			))
	);
}

async function netlify(path, body) {
	const token = env.NETLIFY_AUTH_TOKEN;
	const team = env.NETLIFY_ACCOUNT_SLUG;
	if (!token || !team) throw new Error('Netlify deployment is not configured');

	const response = await fetch(`https://api.netlify.com/api/v1/${path}`, {
		method: body ? 'POST' : 'GET',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		body: body ? JSON.stringify(body) : undefined
	});
	if (!body && response.status === 404) return null;
	if (!response.ok) throw new Error(`Netlify API request failed (HTTP ${response.status})`);
	return response.json();
}

function siteResult(site, owner, repo) {
	if (
		site.account_slug !== env.NETLIFY_ACCOUNT_SLUG ||
		site.build_settings?.repo_path?.toLowerCase() !== `${owner}/${repo}`.toLowerCase() ||
		site.build_settings?.repo_branch !== 'main'
	)
		throw new Error('Netlify project is not linked to the expected team and repository');

	const url = new URL(site.ssl_url || site.url);
	if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.endsWith('.netlify.app')) {
		throw new Error('Netlify did not return a valid HTTPS project URL');
	}
	url.protocol = 'https:';
	url.searchParams.set('view', 'fullscreen');
	return { provider: 'netlify', projectUrl: url.href, dashboardUrl: site.admin_url };
}

export async function isNetlifyMap(octokit, owner, repo) {
	try {
		await octokit.repos.getContent({ owner, repo, path: MARKER_PATH, ref: 'main' });
		return true;
	} catch (error) {
		if (error.status === 404) return false;
		throw error;
	}
}

export async function getNetlifyMap(octokit, owner, repo) {
	if (!(await isNetlifyMap(octokit, owner, repo))) return null;
	const site = await netlify(`sites/${repo.toLowerCase()}.netlify.app`);
	if (!site) throw new Error('The Netlify project for this map has not been created yet');
	return siteResult(site, owner, repo);
}

export async function deployNetlifyMap(octokit, repository) {
	const installationId = Number(env.NETLIFY_GITHUB_INSTALLATION_ID);
	const team = env.NETLIFY_ACCOUNT_SLUG;
	if (
		!env.NETLIFY_AUTH_TOKEN ||
		!team ||
		!Number.isSafeInteger(installationId) ||
		installationId < 1
	) {
		throw new Error('Netlify deployment is not configured. Check the token, team and installation ID.');
	}
	const {
		name: repo,
		owner: { login: owner }
	} = repository;
	const name = repo.toLowerCase();
	if (!/^map-[a-z0-9-]+$/.test(name)) {
		throw new Error('Netlify requires a map- repository name with letters, numbers and hyphens');
	}
	const existing = await netlify(`sites/${name}.netlify.app`);
	if (existing) return siteResult(existing, owner, repo);

	const scope = { owner, repo };
	const { data: ref } = await octokit.git.getRef({ ...scope, ref: 'heads/main' });
	const { data: base } = await octokit.git.getCommit({ ...scope, commit_sha: ref.object.sha });
	const { data: tree } = await octokit.git.createTree({
		...scope,
		base_tree: base.tree.sha,
		tree: Object.entries({
			[MARKER_PATH]: 'netlify\n',
			[CONFIG_PATH]: BUILD_CONFIG,
			'svelte.config.js': SVELTE_CONFIG,
			'src/routes/+page.js': 'export const ssr = false;\n'
		}).map(([path, content]) => ({ path, content, mode: '100644', type: 'blob' }))
	});
	if (tree.sha !== base.tree.sha) {
		const { data: commit } = await octokit.git.createCommit({
			...scope,
			tree: tree.sha,
			parents: [base.sha],
			message: 'Prepare static map for Netlify'
		});
		await octokit.git.updateRef({ ...scope, ref: 'heads/main', sha: commit.sha });
	}
	const site = await netlify(`${encodeURIComponent(team)}/sites`, {
		name,
		repo: {
			provider: 'github',
			repo: repository.full_name,
			repo_id: repository.id,
			installation_id: installationId,
			branch: 'main',
			private: repository.private,
			cmd: 'npm run build',
			dir: 'build'
		}
	});
	return siteResult(site, owner, repo);
}
