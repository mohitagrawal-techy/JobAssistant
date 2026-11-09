export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function errorMessage(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  // FastAPI validation errors arrive as a list of {loc, msg}.
  if (Array.isArray(detail) && detail[0]?.msg) {
    return String(detail[0].msg).replace(/^Value error, /, "");
  }
  return fallback;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { credentials: "include", ...init });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(response.status, errorMessage(body?.detail, response.statusText));
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  return api<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
