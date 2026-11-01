import { base64urlnopad } from '@scure/base';
import * as Crypto from 'expo-crypto';

// Authorization Code + PKCE (RFC 7636). The verifier stays in this process; only
// its SHA-256 challenge reaches the browser. 32 random bytes encode to the
// 43-character minimum verifier length, which every compliant provider accepts.
const VERIFIER_BYTES = 32;

export type PkcePair = { verifier: string; challenge: string };

export async function sha256Base64Url(value: string) {
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new TextEncoder().encode(value));
  return base64urlnopad.encode(new Uint8Array(digest));
}

export async function createPkcePair(): Promise<PkcePair> {
  const verifier = base64urlnopad.encode(await Crypto.getRandomBytesAsync(VERIFIER_BYTES));
  return { verifier, challenge: await sha256Base64Url(verifier) };
}

export async function createOidcState() {
  return base64urlnopad.encode(await Crypto.getRandomBytesAsync(16));
}
