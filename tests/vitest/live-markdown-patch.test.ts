import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('live-markdown install-time patch', () => {
  it('passes the React Native 0.88 measureText context through', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.dependencies['@expensify/react-native-live-markdown']).toBe('0.1.371');
    expect(readFileSync('patches/@expensify+react-native-live-markdown+0.1.371.patch', 'utf8')).toContain(
      'ReactTypefaceUtils.getFontWeightAdjustment(mReactApplicationContext),\n+      mReactApplicationContext,',
    );
    const source = readFileSync(
      'node_modules/@expensify/react-native-live-markdown/android/src/reactNativeVersionPatch/CustomMountingManager/latest/com/expensify/livemarkdown/CustomFabricUIManager.java',
      'utf8',
    );
    expect(source).toContain('getFontWeightAdjustment(mReactApplicationContext),\n      mReactApplicationContext,');
  });
});
