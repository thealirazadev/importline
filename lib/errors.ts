import { NextResponse } from "next/server";

/** The only place API response envelopes are constructed. See docs/api-contracts.md. */

export const API_ERROR_STATUS = {
  validation_failed: 400,
  not_found: 404,
  state_conflict: 409,
  catalog_locked: 409,
  file_too_large: 413,
  unsupported_media_type: 415,
  server_error: 500,
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_STATUS;

export type ErrorDetails = Record<string, string | number | boolean | string[]>;

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly details?: ErrorDetails;

  constructor(code: ApiErrorCode, message: string, details?: ErrorDetails) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }
}

export function errorResponse(error: ApiError): NextResponse {
  const body = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    },
  };
  return NextResponse.json(body, { status: API_ERROR_STATUS[error.code] });
}

/** Fallback for anything unexpected: the caller sees a safe message, logs keep the detail. */
export function serverErrorResponse(): NextResponse {
  return errorResponse(
    new ApiError("server_error", "Something went wrong. Check the server logs for details."),
  );
}

export function dataResponse<T>(data: T, init?: { status?: number }): NextResponse {
  return NextResponse.json({ data }, { status: init?.status ?? 200 });
}

export function listResponse<T>(
  data: T[],
  meta: { page: number; per_page: number; total: number },
): NextResponse {
  return NextResponse.json({ data, meta });
}
