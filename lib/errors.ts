export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppError";
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError || (error instanceof Error && error.name === "AppError");
}

export function errorMessage(error: unknown, fallback = "Something went wrong. Try again.") {
  return isAppError(error) ? error.message : fallback;
}
