export type FullFilePatchInput = {
  path: string;
  expectedContent: string;
  content: string;
};

function lines(value: string) {
  return value ? value.replace(/\n$/, '').split('\n') : [];
}

export function createFullFilePatch({ path, expectedContent, content }: FullFilePatchInput) {
  if (!path || path.startsWith('/') || path.split('/').includes('..') || /[\r\n\t]/.test(path)) {
    throw new Error('Patch path must be a safe relative path.');
  }
  if (expectedContent.includes('\0') || content.includes('\0')) {
    throw new Error('Full-file patches do not support binary content.');
  }
  if (expectedContent === content) return '';

  const oldLines = lines(expectedContent);
  const newLines = lines(content);
  const oldRange = oldLines.length ? `1,${oldLines.length}` : '0,0';
  const newRange = newLines.length ? `1,${newLines.length}` : '0,0';
  const patch = [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${oldRange} +${newRange} @@`,
    ...oldLines.map((line) => `-${line}`),
    ...(oldLines.length && !expectedContent.endsWith('\n') ? ['\\ No newline at end of file'] : []),
    ...newLines.map((line) => `+${line}`),
    ...(newLines.length && !content.endsWith('\n') ? ['\\ No newline at end of file'] : []),
  ];
  return `${patch.join('\n')}\n`;
}
