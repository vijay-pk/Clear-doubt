export class AppError extends Error {
  status: number;
  code: string;
  expose: boolean;
  constructor(status: number, code: string, message: string, expose = true) {
    super(message);
    this.status = status;
    this.code = code;
    this.expose = expose;
  }
}

export const badRequest = (msg: string, code = "bad_request") => new AppError(400, code, msg);
export const unauthorized = (msg = "Authentication required", code = "unauthorized") =>
  new AppError(401, code, msg);
export const forbidden = (msg = "Not allowed", code = "forbidden") => new AppError(403, code, msg);
export const notFound = (msg = "Not found", code = "not_found") => new AppError(404, code, msg);
export const conflict = (msg: string, code = "conflict") => new AppError(409, code, msg);
export const tooMany = (msg = "Too many requests", code = "rate_limited") =>
  new AppError(429, code, msg);
export const serverError = (msg = "Internal error", code = "server_error") =>
  new AppError(500, code, msg, false);
