import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/release.yml', 'utf8');

describe('Google Play release priority', () => {
  it('accepts an optional 0-5 priority that defaults to 0', () => {
    expect(workflow).toMatch(/update_priority:[\s\S]*?default: '0'/);
    expect(workflow).toContain("grep -Eq '^[0-5]$'");
  });
  it('passes the validated priority to the existing Play upload', () => {
    expect(workflow).toContain('inAppUpdatePriority: ${{ steps.priority.outputs.value }}');
    expect(workflow).toContain('id: priority');
  });
});
