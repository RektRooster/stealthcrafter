// Edge- and Node-compatible session token using Web Crypto HMAC.
const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const SESSION_COOKIE = "sc_session";

export async function sessionToken(secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret || "unset"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("sc-admin-session-v1"));
  return toHex(sig);
}

// Verify the session cookie on an incoming API request (API routes are not
// covered by middleware, so write endpoints call this themselves).
export async function requestIsAuthed(req: Request): Promise<boolean> {
  const cookie = req.headers.get("cookie") || "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  const token = m ? m[1] : null;
  if (!token) return false;
  const expected = await sessionToken(process.env.SESSION_SECRET || "");
  return token === expected;
}
