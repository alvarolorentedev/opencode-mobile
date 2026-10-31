
export type PairingFailure = 'invalid' | 'expired' | 'unreachable' | 'loopback';

export class LocalPairingError extends Error {
  constructor(public reason: PairingFailure) { super(reason); }
}
