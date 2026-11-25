<script>
 import { onMount } from 'svelte';
 import MapPanel from '$lib/components/MapPanel.svelte';
 let container;
 onMount(() => {
  let lastHeight = 0;
  const reportHeight = () => {
   const height = Math.ceil(container.scrollHeight);
   if (height > 0 && height !== lastHeight) {
    lastHeight = height;
    window.parent.postMessage({height}, '*');
   }
  };
  const observer = new ResizeObserver(reportHeight);
  observer.observe(container);
  window.addEventListener('resize', reportHeight);
  document.fonts?.ready.then(reportHeight);
  reportHeight();
  return () => { observer.disconnect(); window.removeEventListener('resize', reportHeight); };
 });
</script>
<div bind:this={container} class="min-h-screen w-full">
 <MapPanel standalone />
</div>
