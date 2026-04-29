// Downloads and caches the MiniLM model so the first pillar-analysis run
// after a deploy doesn't pay the ~25MB download.
import { pipeline } from '@xenova/transformers';

async function prewarm() {
  console.log('Pre-warming Xenova/all-MiniLM-L6-v2...');
  const start = Date.now();
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  // Run one inference to fully load weights
  await extractor('warmup', { pooling: 'mean', normalize: true });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Pre-warm complete in ${elapsed}s`);
}

prewarm().catch((err) => {
  console.error('Pre-warm failed (continuing anyway):', err);
  process.exit(0); // non-fatal — pre-warm is an optimization
});
