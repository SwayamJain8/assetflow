export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

const TOKEN_KEY = "assetflow.token";

export const tokenStore = {
  get: () => (typeof window === "undefined" ? null : localStorage.getItem(TOKEN_KEY)),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

/** The exact shape the backend's error handler produces, for every failure. */
export type FieldError = { field: string; message: string };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /**
   * The 422 field errors, keyed by field name — exactly what <FormField> needs to
   * render "That doesn't look like a valid email address." under the right input.
   */
  get fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};

    return Object.fromEntries(
      (this.details as FieldError[])
        .filter((detail) => detail?.field)
        .map((detail) => [detail.field, detail.message]),
    );
  }
}

type Options = Omit<RequestInit, "body"> & { body?: unknown };

/**
 * The one place that talks to the backend.
 *
 * Everything goes through here so that the JWT, the error envelope, and the 401
 * handling exist exactly once. A component never sees a raw Response.
 */
export async function api<T = unknown>(path: string, options: Options = {}): Promise<T> {
  const token = tokenStore.get();
  const isFormData = options.body instanceof FormData;

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(!isFormData && options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    body: isFormData ? (options.body as FormData) : options.body ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const error = payload?.error ?? {};

    // An expired or revoked token: drop it and send the user back to the login
    // screen rather than letting every subsequent query fail with a red toast.
    if (response.status === 401 && typeof window !== "undefined") {
      tokenStore.clear();
      if (!window.location.pathname.startsWith("/login")) {
        window.location.href = "/login";
      }
    }

    throw new ApiError(
      response.status,
      error.code ?? "UNKNOWN",
      error.message ?? "Something went wrong. Please try again.",
      error.details,
    );
  }

  return payload as T;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: "POST", body });
export const patch = <T>(path: string, body?: unknown) => api<T>(path, { method: "PATCH", body });
export const del = <T>(path: string) => api<T>(path, { method: "DELETE" });

export const upload = <T>(path: string, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return api<T>(path, { method: "POST", body: form });
};

/** Uploads are served by the API, not by Next, so they need the API origin. */
export const fileUrl = (name: string | null | undefined) =>
  name ? `${API_URL}/files/${name}` : null;
