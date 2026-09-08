/**
 * One multiplexed jobs snapshot (heavy + light) for a single EventSource.
 */
import { listJobsSnapshot, onJobsChange } from './rover-heavy-jobs.mjs';
import { listLightJobsSnapshot, onLightJobsChange } from './rover-light-jobs.mjs';

let seq = 0;

export function listCombinedJobsSnapshot() {
  seq += 1;
  return {
    seq,
    generatedAt: new Date().toISOString(),
    heavy: listJobsSnapshot(),
    light: listLightJobsSnapshot(),
  };
}

export function onCombinedJobsChange(listener) {
  const send = () => {
    try {
      listener(listCombinedJobsSnapshot());
    } catch {
      /* ignore */
    }
  };
  const offHeavy = onJobsChange(send);
  const offLight = onLightJobsChange(send);
  return () => {
    offHeavy();
    offLight();
  };
}
