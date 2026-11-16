import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { getRequestId } from './request-id.middleware.js';

export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  requestId: string | null;
  timestamp: string;
}

const SECURITY_RELEVANT_STATUSES = new Set<number>([
  HttpStatus.UNAUTHORIZED,
  HttpStatus.FORBIDDEN,
  HttpStatus.TOO_MANY_REQUESTS,
]);

function reasonPhrase(status: number): string {
  // Reverse enum lookup may be undefined for non-standard status codes.
  const name: string | undefined = HttpStatus[status];
  if (!name) return 'Error';
  return name
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Centralised error handling.
 * - 4xx: returns the HttpException's client-safe message (e.g. validation errors).
 * - 5xx and unknown errors: generic message only; details go to the server log with the request ID.
 * - Never returns stack traces, SQL, file paths or configuration values.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const requestId = getRequestId(request) ?? null;
    // Log the route path only (no query string, which may later carry tokens).
    const route = `${request.method} ${request.path}`;

    let message: string | string[] = 'Internal server error';
    if (exception instanceof HttpException && status < 500) {
      message = extractClientMessage(exception) ?? reasonPhrase(status);
    } else if (exception instanceof HttpException) {
      message = reasonPhrase(status);
    }

    if (status >= 500) {
      const name = exception instanceof Error ? exception.name : typeof exception;
      this.logger.error(`${route} -> ${status} [${requestId ?? '-'}] ${name}`);
      if (exception instanceof Error && exception.stack) {
        this.logger.debug(exception.stack);
      }
    } else if (SECURITY_RELEVANT_STATUSES.has(status)) {
      this.logger.warn(`${route} -> ${status} [${requestId ?? '-'}]`);
    }

    const body: ApiErrorBody = {
      statusCode: status,
      error: reasonPhrase(status),
      message,
      requestId,
      timestamp: new Date().toISOString(),
    };

    response.status(status).json(body);
  }
}

function extractClientMessage(exception: HttpException): string | string[] | null {
  const payload = exception.getResponse();
  if (typeof payload === 'string') return payload;
  if (typeof payload === 'object' && 'message' in payload) {
    const { message } = payload;
    if (typeof message === 'string') return message;
    if (Array.isArray(message) && message.every((m) => typeof m === 'string')) {
      return message;
    }
  }
  return null;
}
