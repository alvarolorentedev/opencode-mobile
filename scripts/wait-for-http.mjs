#!/usr/bin/env node

const url = process.argv[2];
const timeoutMs = Number.parseInt(process.argv[3] || '20000', 10);
const startedAt = Date.now();

if (!url) {
  console.error('Usage: node scripts/wait-for-http.mjs <url> [timeoutMs]');
  process.exit(1);
}

while (Date.now() - startedAt < timeoutMs) {
  try {
    const response = await fetch(url);
    if (response.ok) {
      process.exit(0);
    }
  } catch {
    // Keep retrying.
  }

  await new Promise((resolve) => setTimeout(resolve, 500));
}

console.error(`Timed out waiting for ${url}`);
process.exit(1);
