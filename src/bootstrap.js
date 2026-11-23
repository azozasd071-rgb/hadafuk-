import { restoreFromHub } from './hf-sync.js';

try {
  await restoreFromHub();
} catch (err) {
  console.error('HF restore:', err.message);
}
