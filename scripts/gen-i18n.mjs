#!/usr/bin/env node
// Generates shared/i18n/resources.ts from shared/i18n/locales/*/*.json.
//
//   node scripts/gen-i18n.mjs           write the registry
//   node scripts/gen-i18n.mjs --check   fail when the registry is out of date
//
// Adding a language therefore means adding a locales/<code> folder and a
// SUPPORTED_LANGUAGES entry; the registry is generated and CI-verified, so it
// can never drift from the committed translation files.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const localesDir = path.join(root, 'shared', 'i18n', 'locales');
const outputPath = path.join(root, 'shared', 'i18n', 'resources.ts');

function pascal(value) {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function importName(language, namespace) {
  return `${language.replace(/[^a-zA-Z0-9]/g, '')}${pascal(namespace)}`;
}

async function readLocales() {
  const languages = (await readdir(localesDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (!languages.includes('en')) {
    throw new Error('shared/i18n/locales/en must exist as the source locale.');
  }

  const namespaces = (await readdir(path.join(localesDir, 'en')))
    .filter((file) => !file.startsWith('._') && file.endsWith('.json'))
    .map((file) => file.replace(/\.json$/, ''))
    .sort();

  if (namespaces.length === 0) {
    throw new Error('shared/i18n/locales/en must define at least one namespace.');
  }

  for (const language of languages) {
    const files = new Set(
      (await readdir(path.join(localesDir, language))).filter((file) => !file.startsWith('._') && file.endsWith('.json')),
    );
    for (const namespace of namespaces) {
      if (!files.has(`${namespace}.json`)) {
        throw new Error(`shared/i18n/locales/${language}/${namespace}.json is missing.`);
      }
    }
    for (const file of files) {
      const namespace = file.replace(/\.json$/, '');
      if (!namespaces.includes(namespace)) {
        throw new Error(`shared/i18n/locales/${language}/${file} has no English counterpart.`);
      }
    }
  }

  // English first (it backs TRANSLATION_NAMESPACES), then the rest alphabetically.
  return { languages: ['en', ...languages.filter((language) => language !== 'en')], namespaces };
}

export async function buildResourcesSource() {
  const { languages, namespaces } = await readLocales();

  const imports = [];
  for (const language of languages) {
    for (const namespace of namespaces) {
      imports.push(
        `import ${importName(language, namespace)} from '@/shared/i18n/locales/${language}/${namespace}.json';`,
      );
    }
  }

  const blocks = languages.map((language) => {
    const entries = namespaces
      .map((namespace) => `    ${namespace}: ${importName(language, namespace)},`)
      .join('\n');
    return `  ${language}: {\n${entries}\n  },`;
  });

  return [
    '// GENERATED FILE - DO NOT EDIT BY HAND.',
    '//',
    '// Regenerate with `npm run gen:i18n`. `npm run test:i18n` fails when this',
    '// file is out of date with shared/i18n/locales/*/*.json.',
    '//',
    '// Translation files are committed JSON and bundled at build time. There is no',
    '// runtime or network loading, so switching languages never depends on I/O.',
    '',
    ...imports,
    '',
    'export const resources = {',
    ...blocks,
    '};',
    '',
    'export const TRANSLATION_NAMESPACES = Object.keys(resources.en);',
    '',
  ].join('\n');
}

async function main() {
  const check = process.argv.includes('--check');
  const source = await buildResourcesSource();
  const current = await readFile(outputPath, 'utf8').catch(() => undefined);

  if (check) {
    if (current !== source) {
      console.error('shared/i18n/resources.ts is out of date. Run `npm run gen:i18n`.');
      process.exitCode = 1;
    }
    return;
  }

  if (current === source) {
    return;
  }

  await writeFile(outputPath, source);
  console.log('Wrote shared/i18n/resources.ts');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
