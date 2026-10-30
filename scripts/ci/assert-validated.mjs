#!/usr/bin/env node
// Release tags must point at a commit whose full validation already passed on
// main. A tag adds no source changes, so re-running the same E2E suite is
// duplicate work; the check below is deliberately fail-closed.
const repository = process.env.GITHUB_REPOSITORY;
const sha = process.env.TARGET_SHA || process.env.GITHUB_SHA;
const token = process.env.GITHUB_TOKEN;

if (!repository || !sha || !token) {
  console.error('GITHUB_REPOSITORY, TARGET_SHA/GITHUB_SHA and GITHUB_TOKEN are required.');
  process.exit(1);
}

async function api(path) {
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

const runs = await api(`/actions/runs?head_sha=${sha}&per_page=100`);
const candidates = (runs.workflow_runs || []).filter((run) => (
  run.path === '.github/workflows/build.yml'
  && run.name === 'Build'
  && run.event === 'push'
  && run.head_branch === 'main'
  && run.conclusion === 'success'
));

if (candidates.length === 0) {
  console.error(`No successful Build validation exists for ${sha} on main.`);
  console.error('Push the release commit to main, wait for Validate to pass, then tag it.');
  console.error('Use the force_validate dispatch input only for an emergency full re-validation.');
  process.exit(1);
}

for (const run of candidates) {
  const jobs = await api(`/actions/runs/${run.id}/jobs?per_page=100`);
  const byName = new Map((jobs.jobs || []).map((job) => [job.name, job.conclusion]));
  const staticResult = byName.get('validate / static');
  const e2eResult = byName.get('validate / e2e');
  if (staticResult === 'success' && e2eResult === 'success') {
    console.log(`Validated ${sha} by Build run ${run.id} (${run.html_url}).`);
    process.exit(0);
  }
}

console.error(`Build run(s) for ${sha} did not include a successful full validation.`);
for (const run of candidates) {
  const jobs = await api(`/actions/runs/${run.id}/jobs?per_page=100`);
  const relevant = (jobs.jobs || [])
    .filter((job) => job.name === 'validate / static' || job.name === 'validate / e2e')
    .map((job) => `${job.name}=${job.conclusion}`)
    .join(', ');
  console.error(`- ${run.id}: ${relevant || 'validation jobs missing'}`);
}
console.error('Docs-only or partial validations cannot be reused for a release tag. Run the full gate.');
process.exit(1);
