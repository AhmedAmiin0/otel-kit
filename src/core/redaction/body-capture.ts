import type { ServerResponse } from 'node:http';


interface CaptureState {
  body: string;
}

const capturedBodies = new WeakMap<ServerResponse, CaptureState>();
export const storeCapturedBody = (res: ServerResponse, body: string): void => {
  capturedBodies.set(res, { body });
};
export const readCapturedBody = (
  res: ServerResponse | undefined,
): string | undefined => (res ? capturedBodies.get(res)?.body : undefined);
