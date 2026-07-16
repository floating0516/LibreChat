import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto';

const FLOW_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type LihePkce = {
  flowId: string;
  verifier: string;
  challenge: string;
};

export function createLihePkce(): LihePkce {
  const verifier = randomBytes(48).toString('base64url');
  return {
    flowId: randomUUID(),
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
  };
}

export function signLiheState(flowId: string, secret: string): string {
  const signature = createHmac('sha256', secret).update(flowId).digest('base64url');
  return `${flowId}.${signature}`;
}

export function verifyLiheState(state: string, secret: string): string | null {
  if (state.length > 256) {
    return null;
  }
  const separator = state.indexOf('.');
  if (separator < 1 || separator !== state.lastIndexOf('.')) {
    return null;
  }
  const flowId = state.slice(0, separator);
  const signature = state.slice(separator + 1);
  if (!FLOW_ID_PATTERN.test(flowId) || !signature) {
    return null;
  }
  const expected = createHmac('sha256', secret).update(flowId).digest('base64url');
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) {
    return null;
  }
  return timingSafeEqual(actualBuffer, expectedBuffer) ? flowId : null;
}
