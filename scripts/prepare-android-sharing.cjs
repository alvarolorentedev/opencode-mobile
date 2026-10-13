// shortcut: patch Expo Sharing 57.0.22, remove when upstream handles streams and unique bounded cache copies.
const fs = require('node:fs');
const path = require('node:path');
const MARKER = '// opencode-share-receive-fix';

function replaceMethod(source, name, next, replacement) {
  const start = source.indexOf(`    private fun ${name}(`);
  const end = source.indexOf(`    private fun ${next}(`, start);
  if (start < 0 || end < 0) throw new Error(`Expo Sharing changed ${name}; review the receive patch before building.`);
  return source.slice(0, start) + replacement + '\n\n' + source.slice(end);
}

function patchSharingSource(source, resolved) {
  if (source.includes(MARKER)) return source;
  if (!source.includes('Intent.ACTION_SEND') || !source.includes('Intent.EXTRA_STREAM')) throw new Error('Unrecognized Expo Sharing receiver.');
  const item = resolved ? 'ResolvedSharePayload' : 'SharePayload';
  const file = resolved ? 'resolveUri' : 'createUriPayload';
  const text = 'extractTextPayload(intent)';
  const textHelper = resolved ? '' : `    private fun extractTextPayload(intent: Intent): List<SharePayload> {
      val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return emptyList()
      return listOf(SharePayload().apply {
        value = text
        shareType = if (android.util.Patterns.WEB_URL.matcher(text).matches()) ShareType.Url else ShareType.Text
        mimeType = "text/plain"
      })
    }\n\n`;
  source = replaceMethod(source, 'handleSendAction', 'handleSendMultipleAction', `    private fun handleSendAction(context: Context, intent: Intent, type: String): List<${item}> {
      val uri = intent.getParcelableExtraCompat<Uri>(Intent.EXTRA_STREAM)
      return ${text} + listOfNotNull(uri?.let { ${file}(context, it, type) })
    }`);
  source = replaceMethod(source, 'handleSendMultipleAction', resolved ? 'extractTextPayload' : 'createUriPayload', `    private fun handleSendMultipleAction(context: Context, intent: Intent, type: String): List<${item}> {
      val uris = intent.getParcelableArrayListExtraCompat<Uri>(Intent.EXTRA_STREAM)
      return ${text} + (uris?.take(10)?.map { ${file}(context, it, type) } ?: emptyList())
    }\n\n${textHelper}`);
  if (resolved) {
    const start = source.indexOf('      // Copy to cache dir to ensure access');
    const end = source.indexOf('      return ResolvedSharePayload().apply', start);
    if (start < 0 || end < 0 || !source.includes('contentUri = file.toURI().toString()')) throw new Error('Expo Sharing changed file resolution; review the receive patch.');
    source = source.slice(0, start) + `      val suffix = fileName.substringAfterLast('.', "bin").replace(Regex("[^A-Za-z0-9]"), "").take(16)
      val file = File.createTempFile("opencode-share-", ".$suffix", context.cacheDir)
      var readable = false
      try {
        if (fileSize != null && fileSize > 10L * 1024 * 1024) throw IllegalArgumentException("Share too large")
        val input = contentResolver.openInputStream(uri) ?: throw IllegalArgumentException("Share unavailable")
        input.use {
          FileOutputStream(file).use { output ->
            val buffer = ByteArray(8192)
            var total = 0L
            while (true) {
              val count = input.read(buffer)
              if (count < 0) break
              total += count
              if (total > 10L * 1024 * 1024) throw IllegalArgumentException("Share too large")
              output.write(buffer, 0, count)
            }
          }
        }
        readable = true
      } catch (_: Exception) {
        file.delete()
      }

` + source.slice(end);
    source = source.replace('contentUri = file.toURI().toString()', 'contentUri = if (readable) file.toURI().toString() else "unavailable:"');
    source = source.replace('contentSize = fileSize', 'contentSize = if (readable) file.length() else fileSize');
  }
  return `${MARKER}\n${source}`;
}

function prepareAndroidSharing(root) {
  const directory = path.join(root, 'node_modules/expo-sharing');
  const version = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).version;
  if (version !== '57.0.22') throw new Error(`Review Android share receive patch for expo-sharing ${version}; expected 57.0.22.`);
  const base = path.join(directory, 'android/src/main/java/expo/modules/sharing/dataParsers');
  const changes = [['SimpleShareIntentDataParser.kt', false], ['ResolvingShareIntentDataParser.kt', true]].map(([name, resolved]) => {
    const filename = path.join(base, name);
    return [filename, patchSharingSource(fs.readFileSync(filename, 'utf8'), resolved)];
  });
  for (const [filename, source] of changes) fs.writeFileSync(filename, source);
}
module.exports = { prepareAndroidSharing, patchSharingSource };
