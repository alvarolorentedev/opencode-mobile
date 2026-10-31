// Pinned on-device classifier pack. The GGUF is downloaded only after an
// explicit user action; it is never bundled into the app binary.
export const AUTO_MODEL_PACK = {
  id: 'qwen2.5-0.5b-instruct-q4-k-m',
  label: 'Qwen2.5 0.5B Instruct',
  fileName: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
  url: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/6dd44a1fb35d11b5d1b28902876ce3cc9e882d0e/qwen2.5-0.5b-instruct-q4_k_m.gguf',
  bytes: 491_400_032,
  sha256: '74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db',
  // Native File.md5 avoids loading the 491 MB pack into JS memory. The pinned
  // HTTPS URL and SHA-256 above remain the supply-chain reference.
  md5: 'a24e22d4ea0d9a6b3efd57936ecb127b',
  license: 'Apache-2.0',
  licenseUrl: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/blob/main/LICENSE',
} as const;
