export interface CookieOptions {
  maxAge?: number;
  expires?: Date;
  path?: string;
  domain?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

const SECURE_DEFAULTS: Required<
  Pick<CookieOptions, "httpOnly" | "secure" | "sameSite" | "path">
> = {
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
  path: "/",
};

export function parseCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;

  const pairs = header.split(";");
  for (const pair of pairs) {
    const eqIndex = pair.indexOf("=");
    if (eqIndex === -1) continue;
    const name = pair.slice(0, eqIndex).trim();
    const value = pair.slice(eqIndex + 1).trim();
    if (name.length > 0) {
      cookies.set(name, decodeURIComponent(value));
    }
  }

  return cookies;
}

export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions = {},
): string {
  validateCookieName(name);

  const merged = { ...SECURE_DEFAULTS, ...options };
  const parts: string[] = [`${name}=${encodeURIComponent(value)}`];

  if (merged.maxAge !== undefined) {
    parts.push(`Max-Age=${merged.maxAge}`);
  }

  if (merged.expires) {
    parts.push(`Expires=${merged.expires.toUTCString()}`);
  }

  if (merged.path) {
    parts.push(`Path=${merged.path}`);
  }

  if (merged.domain) {
    parts.push(`Domain=${merged.domain}`);
  }

  if (merged.secure) {
    parts.push("Secure");
  }

  if (merged.httpOnly) {
    parts.push("HttpOnly");
  }

  if (merged.sameSite) {
    if (merged.sameSite === "None" && !merged.secure) {
      throw new Error(
        "[Rain] Cookie with SameSite=None must also set " +
          "Secure=true. Browsers will reject cookies with " +
          "SameSite=None that are not Secure.",
      );
    }
    parts.push(`SameSite=${merged.sameSite}`);
  }

  return parts.join("; ");
}

const INVALID_NAME_CHARS = /[\s"(),/:;<=>?@[\\\]{}]/;

function validateCookieName(name: string): void {
  if (name.length === 0) {
    throw new Error("[Rain] Cookie name must not be empty.");
  }
  if (INVALID_NAME_CHARS.test(name)) {
    throw new Error(
      `[Rain] Cookie name "${name}" contains invalid ` +
        "characters. Cookie names must not contain " +
        "whitespace or special characters: " +
        '"(),/:;<=>?@[\\]{}',
    );
  }
}
