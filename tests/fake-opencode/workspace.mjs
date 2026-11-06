import { resolveProject } from './state.mjs';

export function filesForDirectory(state, directory) {
  if (!directory || !resolveProject(state, directory)) return undefined;
  if (directory === (state.project.canonical || state.project.worktree)) return state.files;
  state.filesByDirectory[directory] ||= {
    ...state.files,
    'README.md': `# ${directory.split('/').pop()}\n\nFiles in ${directory}.\n`,
    'src/demo.ts': `export const workspace = "${directory}";\n`,
  };
  return state.filesByDirectory[directory];
}

// Browse listings must not boot a project. Absolute paths are resolved here
// without touching the project catalog, matching the V2 fs.list contract.
export function filesForBrowsing(state, directory) {
  if (!directory || (directory !== state.rootPath && !directory.startsWith(`${state.rootPath}/`))) return undefined;
  if (directory === state.rootPath) {
    const names = new Set();
    const add = (value) => {
      if (value?.startsWith(`${state.rootPath}/`)) names.add(value.slice(state.rootPath.length + 1).split('/')[0]);
    };
    add(state.project.canonical || state.project.worktree);
    for (const project of state.projects) add(project.canonical || project.worktree);
    for (const worktree of state.worktrees) add(worktree.directory);
    for (const path of Object.keys(state.filesByDirectory)) add(path);
    const files = {};
    for (const name of names) files[`${name}/README.md`] = `# ${name}\n`;
    return files;
  }
  if (directory === (state.project.canonical || state.project.worktree)) return state.files;
  state.filesByDirectory[directory] ||= {
    ...state.files,
    'README.md': `# ${directory.split('/').pop()}\n\nFiles in ${directory}.\n`,
    'src/demo.ts': `export const workspace = "${directory}";\n`,
  };
  return state.filesByDirectory[directory];
}

export function fileNodes(files, directory, requestedPath = '', emptyDirectories = []) {
  const prefix = requestedPath ? `${requestedPath}/` : '';
  const nodes = new Map();
  for (const path of [...Object.keys(files), ...[...emptyDirectories].map((path) => `${path}/`)].sort()) {
    if (!path.startsWith(prefix)) continue;
    const remainder = path.slice(prefix.length), name = remainder.split('/')[0];
    if (!name) continue;
    const nodePath = `${prefix}${name}`;
    nodes.set(nodePath, { name, path: nodePath, absolute: `${directory}/${nodePath}`, type: remainder.includes('/') ? 'directory' : 'file', ignored: false });
  }
  return [...nodes.values()];
}

export function addWorktree(state, projectID, requestedName) {
  const name = requestedName?.trim() || `sandbox-${state.nextWorktreeId++}`;
  const project = state.projects.find((entry) => entry.id === projectID);
  if (!project || !/^[a-zA-Z0-9._-]+$/.test(name) || state.worktrees.some((entry) => entry.name === name)) throw new Error('Worktree name is invalid or already exists');
  const entry = { name, branch: `worktree/${name}`, directory: `/worktrees/${name}`, projectID };
  state.worktrees.push(entry);
  state.filesByDirectory[entry.directory] = { ...filesForDirectory(state, (project.canonical || project.worktree)), 'README.md': `# Worktree ${name}\n` };
  return entry;
}
