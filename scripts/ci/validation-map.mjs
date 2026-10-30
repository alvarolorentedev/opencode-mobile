// Pure change-to-validation mapping. Kept separate from the CLI so the policy
// can be unit-tested without running git or GitHub Actions.
export const SPECS = {
  'app-updates': 'tests/e2e/app-updates.spec.mjs',
  'auto-model': 'tests/e2e/auto-model.spec.mjs',
  chat: 'tests/e2e/chat.spec.mjs',
  compat: 'tests/e2e/compat.spec.mjs',
  connect: 'tests/e2e/connect.spec.mjs',
  diffs: 'tests/e2e/diffs.spec.mjs',
  extensions: 'tests/e2e/extensions.spec.mjs',
  interactions: 'tests/e2e/interactions.spec.mjs',
  'manual-connection': 'tests/e2e/manual-connection.spec.mjs',
  'multi-server': 'tests/e2e/multi-server.spec.mjs',
  'network-resilience': 'tests/e2e/network-resilience.spec.mjs',
  onboarding: 'tests/e2e/onboarding.spec.mjs',
  projects: 'tests/e2e/projects.spec.mjs',
  realtime: 'tests/e2e/realtime.spec.mjs',
  sessions: 'tests/e2e/sessions.spec.mjs',
  settings: 'tests/e2e/settings.spec.mjs',
  share: 'tests/e2e/share.spec.mjs',
  terminal: 'tests/e2e/terminal.spec.mjs',
  v2: 'tests/e2e/v2.spec.mjs',
};

const FULL_PATTERNS = [
  /^providers\//,
  /^lib\/opencode\//,
  /^providers\/services\//,
  /^tests\/fake-opencode\//,
  /^tests\/e2e\//,
  /^package(?:-lock)?\.json$/,
  /^app\.config\.(?:ts|js)$/,
  /^(?:app|eas)\.json$/,
  /^(?:babel|metro|playwright|vitest|eslint)\.config\./,
  /^tsconfig[^/]*\.json$/,
  /^\.github\/workflows\//,
  /^scripts\/(?:build-web|e2e-|serve-web)/,
  /^app\/.*_layout\./,
  /^app\/\+native-intent\./,
  /^app\/share\./,
];

const TEST_ONLY_PATTERNS = [
  /^tests\/vitest\//,
  /^tests\/helpers\//,
  /^tests\/native\//,
  /^tests\/foss-prepare\.test\.mjs$/,
];

const STORYBOOK_PATTERNS = [
  /^\.storybook\//,
  /^components\//,
  /^constants\//,
];

const AREA_SPECS = [
  [/^components\/chat\//, ['chat', 'interactions', 'diffs']],
  [/^components\/settings\//, ['settings']],
  [/^components\/connect\//, ['connect', 'manual-connection', 'onboarding']],
  [/^components\/onboarding\//, ['onboarding']],
  [/^components\/projects\//, ['projects', 'sessions']],
  [/^components\/sessions\//, ['sessions']],
  [/^components\/terminal\//, ['terminal']],
  [/^components\/extensions\//, ['extensions']],
  [/^components\/share\//, ['share']],
  [/^components\/app-updates\//, ['app-updates']],
  [/^components\/diffs\//, ['diffs']],
  [/^components\/interactions\//, ['interactions']],
  [/^components\/realtime\//, ['realtime', 'network-resilience']],
  [/^components\/auto-model\//, ['auto-model']],
  [/^components\//, []],
  [/^app\/\(tabs\)\/index/, ['chat']],
  [/^app\/\(tabs\)\/projects/, ['projects']],
  [/^app\/\(tabs\)\/settings/, ['settings']],
  [/^app\/\(tabs\)\/terminal/, ['terminal']],
  [/^app\/pair/, ['connect']],
  [/^app\/onboarding/, ['onboarding']],
  [/^app\//, []],
  [/^lib\/attach/, ['chat']],
  [/^lib\/share\//, ['share']],
  [/^lib\/voice\//, ['chat', 'onboarding']],
  [/^lib\/notifications/, ['chat']],
  [/^lib\//, []],
  [/^assets\//, ['chat']],
  [/^constants\//, []],
  [/^hooks\//, []],
  [/^widgets\//, ['share']],
  [/^scripts\//, []],
];

function normalized(file) {
  return file.replace(/^\.\//, '');
}

function isDocumentation(file) {
  return file.startsWith('docs/')
    || file.endsWith('.md')
    || file === 'AGENTS.md'
    || file.startsWith('.github/ISSUE_TEMPLATE/')
    || file.startsWith('fastlane/metadata/');
}

function isTestOnly(file) {
  return TEST_ONLY_PATTERNS.some((pattern) => pattern.test(file));
}

function isStorybookRelevant(file) {
  return STORYBOOK_PATTERNS.some((pattern) => pattern.test(file));
}

export function classifyValidation(files, options = {}) {
  const event = options.event || 'pull_request';
  const changed = [...new Set(files.map(normalized).filter(Boolean))];

  if (event === 'workflow_dispatch' || event === 'tag') {
    return { mode: 'full', specs: [], storybook: true, reason: `${event} always validates fully` };
  }
  if (changed.length === 0) {
    return { mode: 'full', specs: [], storybook: true, reason: 'no changed-file information; use the full gate' };
  }
  if (changed.every(isDocumentation)) {
    return { mode: 'none', specs: [], storybook: false, reason: 'documentation-only change' };
  }
  if (changed.every((file) => isDocumentation(file) || isTestOnly(file))) {
    return { mode: 'none', specs: [], storybook: false, reason: 'test- or documentation-only change' };
  }

  const storybook = changed.some(isStorybookRelevant);
  const specs = new Set();
  const areas = new Set();
  const codeFiles = changed.filter((file) => !isDocumentation(file) && !isTestOnly(file));
  if (codeFiles.length > 20) {
    return { mode: 'full', specs: [], storybook, reason: `${codeFiles.length} code files changed; run the full gate` };
  }
  let needsSmoke = false;
  let matched = false;
  const reasons = [];

  for (const file of changed) {
    if (isDocumentation(file) || isTestOnly(file)) continue;
    if (FULL_PATTERNS.some((pattern) => pattern.test(file))) {
      return {
        mode: 'full',
        specs: [],
        storybook,
        reason: `shared contract or infrastructure changed: ${file}`,
      };
    }
    if (file.startsWith('.storybook/')) continue;

    const areaIndex = AREA_SPECS.findIndex(([pattern]) => pattern.test(file));
    if (areaIndex === -1) {
      return { mode: 'full', specs: [], storybook: true, reason: `unmapped path: ${file}` };
    }
    areas.add(areaIndex);
    if (areas.size > 2) {
      return { mode: 'full', specs: [], storybook, reason: 'change spans more than two domains' };
    }
    const mapping = AREA_SPECS[areaIndex];
    matched = true;
    if (mapping[1].length === 0) {
      needsSmoke = true;
      reasons.push(file);
    } else {
      for (const spec of mapping[1]) specs.add(SPECS[spec]);
    }
  }

  if (!matched) {
    return { mode: 'none', specs: [], storybook, reason: 'only Storybook assets changed' };
  }
  if (specs.size > 0) {
    return {
      mode: 'affected',
      specs: [...specs].sort(),
      storybook,
      reason: `affected areas: ${[...new Set(reasons.concat(changed.filter((file) => !isDocumentation(file) && !isTestOnly(file))))].slice(0, 6).join(', ')}`,
    };
  }
  if (needsSmoke) {
    return { mode: 'smoke', specs: [], storybook, reason: 'UI or low-risk code change; run the critical smoke set' };
  }
  return { mode: 'none', specs: [], storybook, reason: 'no E2E-relevant code changed' };
}
