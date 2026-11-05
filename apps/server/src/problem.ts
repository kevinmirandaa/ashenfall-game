/** Error de aplicación que se serializa como RFC 9457 Problem Details. */
export class ProblemError extends Error {
  override readonly name = 'ProblemError';

  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    readonly headers: Readonly<Record<string, string>> = {},
  ) {
    super(title);
  }
}

export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly instance: string;
  readonly errors?: readonly unknown[];
}

export function problemBody(
  status: number,
  code: string,
  title: string,
  instance: string,
  errors?: readonly unknown[],
): ProblemDetails {
  return {
    type: `https://ashenfall.invalid/problems/${code.toLowerCase().replaceAll('_', '-')}`,
    title,
    status,
    code,
    instance,
    ...(errors === undefined ? {} : { errors }),
  };
}
