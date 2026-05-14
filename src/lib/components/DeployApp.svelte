<script>
	import { onMount } from 'svelte';
	import { mapConfig } from '$lib/stores/config-map';
	import { translations } from '$lib/stores/translations';

	let repoName = '';
	let selectedRepoName = '';
	let mapRepositories = [];
	let errorMessage = null;
	let successMessage = null;
	let isLoading = false;
	let isLoadingRepos = false;
	let isLoadingSelectedRepo = false;
	let repoUrl = null;
	let deploymentUrl = null;
	let embedUrl = null;

	const TOTAL_LANGUAGES = 24;

	const createSteps = [
		{ id: 'validate', text: 'Validating repository name', completed: false, current: false },
		{ id: 'create', text: 'Creating GitHub repository', completed: false, current: false },
		{
			id: 'translations',
			text: 'Committing language files (0%)',
			completed: false,
			current: false
		},
		{ id: 'cleanup', text: 'Cleaning up temporary files', completed: false, current: false },
		{ id: 'deploy', text: 'Deploying to Vercel', completed: false, current: false }
	];

	const updateSteps = [
		{ id: 'validate', text: 'Validating selected repository', completed: false, current: false },
		{ id: 'translations', text: 'Generating translations (0%)', completed: false, current: false },
		{ id: 'commit', text: 'Committing map update', completed: false, current: false },
		{ id: 'cleanup', text: 'Cleaning up temporary files', completed: false, current: false },
		{ id: 'deploy', text: 'Waiting for Vercel auto-deploy', completed: false, current: false }
	];

	let steps = cloneSteps(createSteps);

	onMount(() => {
		loadRepositories();
	});

	function cloneSteps(source) {
		return source.map((step) => ({ ...step }));
	}

	function toSlug(str) {
		return str
			.toLowerCase()
			.trim()
			.replace(/[^\w\s-]/g, '')
			.replace(/[\s_]+/g, '-')
			.replace(/^-+|-+$/g, '');
	}

	function getEmbedCode(mapId, deployUrl, embedUrl) {
		const slugifiedId = toSlug(mapId);
		return `<iframe title="New Map" aria-label="Map" id="${slugifiedId}" src="${deployUrl}" scrolling="no" frameborder="0" style="width: 0; min-width: 100% !important; border: none;" height="624"></iframe><script type="text/javascript">window.addEventListener("message",e=>{if("${embedUrl}"!==e.origin)return;let t=e.data;if(t.height){document.getElementById("${slugifiedId}").height=t.height+"px"}},!1)<\/script>`;
	}

	function validateData(repoName, mapConfig, translations) {
		if (!repoName) throw new Error('Repository name is required');
		if (!mapConfig) throw new Error('Map configuration is required');

		if (translations && typeof translations !== 'object') {
			throw new Error('Invalid translations format');
		}

		if (!/^[a-zA-Z0-9-_]+$/.test(repoName)) {
			throw new Error(
				'Invalid repository name. Use only letters, numbers, hyphens, and underscores.'
			);
		}
	}

	function updateSteps(currentStep, completedSteps = []) {
		steps = steps.map((step) => ({
			...step,
			completed: completedSteps.includes(step.id),
			current: step.id === currentStep
		}));
	}

	function buildSourceData(config) {
		return {
			...config.translate,
			title: config.title,
			subtitle: config.subtitle,
			textSourceDescription: config.textSourceDescription,
			textSource: config.textSource,
			textNoteDescription: config.textNoteDescription,
			textNote: config.textNote,
			linkDataAccessDescription: config.linkDataAccessDescription,
			legend1: config.legend1,
			customUnitLabel: config.customUnitLabel,
			tooltipExtraInfoLabel: config.tooltipExtraInfoLabel || 'Click here',
			...(config.parsedData || []).reduce((acc, country) => {
				if (country.text_content) {
					acc[`extraInfo_${country.id}`] = country.text_content;
				}
				return acc;
			}, {})
		};
	}

	async function loadRepositories() {
		isLoadingRepos = true;

		try {
			const response = await fetch('/api/map-repositories');
			const data = await readJsonResponse(response);
			if (!response.ok) {
				throw new Error(data.error || 'Failed to load repositories');
			}
			mapRepositories = data.repositories || [];
		} catch (error) {
			console.error('Failed to load repositories:', error);
			errorMessage = error.message;
		} finally {
			isLoadingRepos = false;
		}
	}

	async function loadSelectedRepository() {
		if (!selectedRepoName) return;

		isLoadingSelectedRepo = true;
		errorMessage = null;
		successMessage = null;
		repoUrl = null;
		deploymentUrl = null;
		embedUrl = null;

		try {
			const data = await makeRequest('/api/load-map-repository', {
				repoName: selectedRepoName
			});

			mapConfig.set(data.config);
			translations.set({});
			repoUrl = data.repoUrl;
			successMessage = `Loaded ${selectedRepoName}. You can now edit the map and update it.`;
		} catch (error) {
			console.error('Failed to load selected repository:', error);
			errorMessage = error.message;
		} finally {
			isLoadingSelectedRepo = false;
		}
	}

	async function generateTranslations() {
		const sourceData = buildSourceData($mapConfig);
		let batchIndex = 0;
		let hasMore = true;
		let allTranslations = {};
		let completedLanguages = [];

		while (hasMore) {
			const data = await makeRequest('/api/translate', {
				sourceObject: sourceData,
				batchIndex
			});

			if (!data.success) {
				throw new Error(data.error || 'Translation failed');
			}

			if (data.completedLanguages) {
				completedLanguages = [...new Set([...completedLanguages, ...data.completedLanguages])];
			}

			allTranslations = { ...allTranslations, ...data.translations };
			translations.set(allTranslations);

			const progress = Math.round((completedLanguages.length / TOTAL_LANGUAGES) * 100);
			steps = steps.map((step) => ({
				...step,
				text:
					step.id === 'translations'
						? `Generating translations (${progress}%)`
						: step.text
			}));

			hasMore = data.type === 'complete' ? false : data.hasMore;
			batchIndex++;
		}

		if (Object.keys(allTranslations).length !== TOTAL_LANGUAGES) {
			throw new Error('Translation did not produce all language files');
		}

		return allTranslations;
	}

	async function handleSubmit() {
		steps = cloneSteps(createSteps);
		isLoading = true;
		errorMessage = null;
		successMessage = null;
		repoUrl = null;
		deploymentUrl = null;
		embedUrl = null;
		const processedLanguages = new Set();

		try {
			validateData(repoName, $mapConfig, $translations);

			updateSteps('create', ['validate']);
			const initData = await makeRequest('/api/init-repository', {
				repoName,
				mapConfig: $mapConfig
			});
			repoUrl = initData.repoUrl;

			updateSteps('translations', ['validate', 'create']);
			const BATCH_SIZE = 6;
			const languages = Object.keys($translations);

			for (let i = 0; i < languages.length; i += BATCH_SIZE) {
				const batchLanguages = languages.slice(i, i + BATCH_SIZE);
				const progress = Math.round(((i + batchLanguages.length) / languages.length) * 100);

				steps = steps.map((step) => ({
					...step,
					text:
						step.id === 'translations'
							? `Committing language files (${progress}%) - Batch ${Math.floor(i / BATCH_SIZE) + 1}`
							: step.text
				}));

				const batchTranslations = {};
				batchLanguages.forEach((lang) => {
					batchTranslations[lang] = $translations[lang];
				});

				try {
					await makeRequest('/api/commit-files', {
						repoName,
						translations: batchTranslations,
						isLastBatch: i + BATCH_SIZE >= languages.length
					});

					batchLanguages.forEach((lang) => processedLanguages.add(lang));

					if (i + BATCH_SIZE < languages.length) {
						await new Promise((resolve) => setTimeout(resolve, 500));
					}
				} catch (error) {
					console.error(`Batch processing failed, falling back to single file processing:`, error);

					for (const lang of batchLanguages) {
						try {
							await makeRequest('/api/commit-files', {
								repoName,
								translations: { [lang]: $translations[lang] },
								isLastFile: lang === languages[languages.length - 1]
							});
							processedLanguages.add(lang);
						} catch (singleError) {
							console.error(`Failed to process language ${lang}:`, singleError);
						}
					}
				}

				successMessage = `Processed ${processedLanguages.size} of ${languages.length} languages...`;
			}

			const missingLanguages = languages.filter((lang) => !processedLanguages.has(lang));
			if (missingLanguages.length > 0) {
				throw new Error(
					`Failed to process ${missingLanguages.length} languages: ${missingLanguages.join(', ')}`
				);
			}

			updateSteps('cleanup', ['validate', 'create', 'translations']);
			try {
				const cleanupResponse = await makeRequest('/api/cleanup-storage', {});
				if (cleanupResponse.remainingBlobs > 0) {
					successMessage += `\nWarning: ${cleanupResponse.remainingBlobs} files remain in storage.`;
				}
			} catch (cleanupError) {
				console.error('Storage cleanup failed:', cleanupError);
				successMessage += '\nWarning: Storage cleanup failed. Some temporary files may remain.';
			}

			updateSteps('deploy', ['validate', 'create', 'translations', 'cleanup']);
			const deployData = await makeRequest('/api/deploy-vercel', { repoName });

			deploymentUrl = deployData.projectUrl;
			embedUrl = deployData.projectUrl;
			updateSteps(null, ['validate', 'create', 'translations', 'cleanup', 'deploy']);
			successMessage = 'Repository created and deployed successfully!';
			await loadRepositories();
		} catch (error) {
			console.error('Error:', error);
			errorMessage =
				processedLanguages.size > 0
					? `${error.message}. Successfully processed languages: ${Array.from(processedLanguages).join(', ')}`
					: error.message;
			steps = steps.map((step) => ({
				...step,
				completed: false,
				current: false
			}));
		} finally {
			isLoading = false;
		}
	}

	async function handleUpdateAndDeploy() {
		steps = cloneSteps(updateSteps);
		isLoading = true;
		errorMessage = null;
		successMessage = null;
		deploymentUrl = null;
		embedUrl = null;

		try {
			validateData(selectedRepoName, $mapConfig, $translations);

			updateSteps('translations', ['validate']);
			const generatedTranslations = await generateTranslations();

			updateSteps('commit', ['validate', 'translations']);
			const updateData = await makeRequest('/api/update-map-repository', {
				repoName: selectedRepoName,
				mapConfig: $mapConfig,
				translations: generatedTranslations
			});

			repoUrl = updateData.repoUrl;
			deploymentUrl = updateData.projectUrl;
			embedUrl = updateData.projectUrl;

			updateSteps('cleanup', ['validate', 'translations', 'commit']);
			try {
				await makeRequest('/api/cleanup-storage', {});
			} catch (cleanupError) {
				console.error('Storage cleanup failed:', cleanupError);
			}

			updateSteps(null, ['validate', 'translations', 'commit', 'cleanup', 'deploy']);
			successMessage = 'Map updated. Vercel will deploy the latest commit from GitHub.';
			await loadRepositories();
		} catch (error) {
			console.error('Update error:', error);
			errorMessage = error.message;
			steps = steps.map((step) => ({
				...step,
				completed: false,
				current: false
			}));
		} finally {
			isLoading = false;
		}
	}

	async function readJsonResponse(response) {
		const textData = await response.text();
		try {
			return JSON.parse(textData);
		} catch {
			if (response.status === 504) {
				throw new Error('Request timeout - will retry');
			}
			throw new Error(textData || 'Invalid response format');
		}
	}

	async function makeRequest(url, data) {
		const MAX_RETRIES = 3;
		let lastError;

		for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
			try {
				const response = await fetch(url, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify(data)
				});

				const jsonData = await readJsonResponse(response);

				if (!response.ok) {
					throw new Error(jsonData.error || 'Request failed');
				}

				return jsonData;
			} catch (error) {
				console.error(`Attempt ${attempt + 1} failed:`, error);
				lastError = error;

				if (attempt < MAX_RETRIES - 1) {
					await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
					continue;
				}
			}
		}

		throw lastError;
	}
</script>

<div class="rounded-lg bg-white p-6 text-left shadow-sm">
	<h3 class="mb-4 font-bold">Create or Update Map</h3>

	<div class="mb-6 space-y-3 border-b pb-4">
		<label for="existingRepo" class="block font-medium">Update existing map</label>
		<select
			id="existingRepo"
			bind:value={selectedRepoName}
			on:change={loadSelectedRepository}
			disabled={isLoading || isLoadingRepos}
			class="w-full rounded border p-2"
		>
			<option value="">
				{isLoadingRepos ? 'Loading map repositories...' : 'Select a compatible map repository'}
			</option>
			{#each mapRepositories as repo}
				<option value={repo.name}>{repo.name}</option>
			{/each}
		</select>
		{#if isLoadingSelectedRepo}
			<p class="text-sm text-gray-600">Loading selected map...</p>
		{/if}
	</div>

	<form on:submit|preventDefault={handleSubmit} class="space-y-4">
		<div>
			<label for="repoName" class="mb-2 block">Please enter a new repository name below:</label>
			<input
				type="text"
				id="repoName"
				bind:value={repoName}
				disabled={isLoading}
				placeholder="e.g. employment-tertiary-attainment"
				class="w-full rounded border p-2"
			/>
		</div>

		<div class="grid gap-3 md:grid-cols-2">
			<button
				type="submit"
				disabled={isLoading}
				class="min-w-[200px] rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-70"
			>
				{#if isLoading}
					<span class="spinner"></span>
				{:else}
					Create and Deploy Map
				{/if}
			</button>
			<button
				type="button"
				on:click={handleUpdateAndDeploy}
				disabled={isLoading || isLoadingSelectedRepo || !selectedRepoName}
				class="min-w-[200px] rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-70"
			>
				{#if isLoading}
					<span class="spinner"></span>
				{:else}
					Update and Deploy Map
				{/if}
			</button>
		</div>
	</form>

	{#if isLoading || steps.some((step) => step.completed)}
		<div class="mt-4 rounded bg-gray-50 p-4">
			{#each steps as step}
				<div class="step" class:completed={step.completed} class:current={step.current}>
					{#if step.completed}
						<span class="checkmark">✓</span>
					{:else if step.current}
						<span class="spinner small"></span>
					{:else}
						<span class="dot"></span>
					{/if}
					{step.text}
				</div>
			{/each}
		</div>
	{/if}

	{#if errorMessage}
		<div class="mt-4 rounded bg-red-50 p-4 text-red-700">
			<p class="font-bold">Error</p>
			<p>{errorMessage}</p>
		</div>
	{/if}

	{#if successMessage}
		<div class="mt-4 rounded bg-green-50 p-4 text-green-700">
			<p class="font-bold">Success</p>
			<p>{successMessage}</p>
			<div class="mt-2 space-y-2">
				{#if deploymentUrl}
					<p>
						Your map will soon be available at: <a
							href={deploymentUrl}
							target="_blank"
							rel="noopener noreferrer"
							class="underline">{deploymentUrl}</a
						>
					</p>
				{/if}

				{#if deploymentUrl}
					<div class="mt-4">
						<p class="mb-2 font-bold">Embed code:</p>
						<div class="relative">
							<pre class="overflow-x-auto rounded bg-gray-100 p-3 text-sm">{getEmbedCode(
									selectedRepoName || repoName,
									deploymentUrl,
									embedUrl
								)}</pre>
							<button
								class="absolute right-2 top-2 rounded bg-blue-500 px-2 py-1 text-xs text-white hover:bg-blue-600"
								on:click={() => {
									navigator.clipboard.writeText(
										getEmbedCode(selectedRepoName || repoName, deploymentUrl, embedUrl)
									);
								}}
							>
								Copy
							</button>
						</div>
					</div>
				{/if}

				{#if repoUrl}
					<p>
						<a href={repoUrl} target="_blank" rel="noopener noreferrer" class="underline"
							>View map repository</a
						>
					</p>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.spinner {
		display: inline-block;
		width: 20px;
		height: 20px;
		border: 2px solid #ffffff;
		border-radius: 50%;
		border-top-color: transparent;
		animation: spin 0.8s linear infinite;
	}

	.spinner.small {
		width: 16px;
		height: 16px;
		border-width: 2px;
		border-color: #666;
		border-top-color: transparent;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.step {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0;
		color: #666;
	}

	.step.completed {
		color: green;
	}

	.step.current {
		color: #0066cc;
		font-weight: bold;
	}

	.checkmark {
		color: green;
		font-weight: bold;
	}

	.dot {
		display: inline-block;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background-color: #ddd;
	}
</style>
