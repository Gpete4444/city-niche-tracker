import { candidateIdFromResearchFile } from '../ops/lib/candidates.mjs';

function assertEqual(got, want, label) {
  if (got !== want) {
    console.error(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    process.exit(1);
  }
}

assertEqual(
  candidateIdFromResearchFile('cary-drywall-repair-images-plan.json'),
  'cary-drywall-repair',
  'images-plan sidecar',
);
assertEqual(
  candidateIdFromResearchFile('cary-drywall-repair-ba-variants.json'),
  'cary-drywall-repair',
  'ba-variants sidecar',
);
assertEqual(
  candidateIdFromResearchFile('cary-drywall-repair-photo-group.json'),
  'cary-drywall-repair',
  'photo-group sidecar',
);
assertEqual(
  candidateIdFromResearchFile('cary-drywall-repair-openai-prompts.json'),
  'cary-drywall-repair',
  'openai-prompts sidecar',
);
assertEqual(
  candidateIdFromResearchFile('cary-drywall-repair.json'),
  'cary-drywall-repair',
  'research json',
);
assertEqual(
  candidateIdFromResearchFile('cary-drywall-repair.meta.json'),
  'cary-drywall-repair',
  'meta json',
);
assertEqual(
  candidateIdFromResearchFile('cary-drywall-repair.config.json'),
  'cary-drywall-repair',
  'config json',
);
assertEqual(
  candidateIdFromResearchFile('cary-drywall-repair-images-plan.meta.json'),
  'cary-drywall-repair-images-plan',
  'phantom meta still strips .meta.json only',
);

console.log('test-sidecar-candidate-ids: ok');
