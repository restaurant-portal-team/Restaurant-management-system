import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Accept caller-supplied IDs only if they are short and safe to log (prevents log injection). */
const SAFE_REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

export function resolveRequestId(incoming: unknown): string {
  return typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
}

export function getRequestId(request: Request): string | undefined {
  const value = request.res?.getHeader(REQUEST_ID_HEADER);
  return typeof value === 'string' ? value : undefined;
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const requestId = resolveRequestId(request.headers[REQUEST_ID_HEADER]);
    response.setHeader(REQUEST_ID_HEADER, requestId);
    next();
  }
}
