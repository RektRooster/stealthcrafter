// CUSTOMER SESSIONS — deliberately separate from the admin gate.
//
// Two different doors into the same building. `sc_session` is the founder-access
// password gate in middleware and covers the whole of /admin/*; it is unchanged
// and untouched by any of this. `sc_customer` is a shopper being signed in to
// their own account INSIDE that gate. Breaking admin access to add customer
// accounts would be a poor trade, so nothing here goes near the middleware.
//
// Why not @supabase/ssr: it wants to refresh tokens inside middleware, and the
// middleware here already owns a redirect for every unauthenticated request. The
// two interact badly and the failure mode is losing admin access. Supabase Auth
// is still the credential store — it holds the password hashes and does the
// verification — but the browser session is our own signed cookie, minted after
// Supabase has confirmed the password. Fewer moving parts around the one thing
// that must not break.

import { createHmac, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { supabaseAdmin } from "./supabase";

export const CUSTOMER_COOKIE = "sc_customer";
export const GUEST_COOKIE = "sc_guest";
const MAX_AGE_DAYS = 30;

function secret(): string {
  return process.env.SESSION_SECRET || "unset";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

export function mintCustomerToken(customerId: string): string {
  const exp = Date.now() + MAX_AGE_DAYS * 86_400_000;
  const payload = `${customerId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

/** Returns the customer id, or null for any malformed, expired or forged token. */
export function readCustomerToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [id, expRaw, mac] = parts;
  const payload = `${id}.${expRaw}`;
  const expected = sign(payload);
  // Constant-time-ish: compare full strings of equal length only.
  if (mac.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Date.now()) return null;
  return id;
}

export function newGuestKey(): string {
  return randomBytes(16).toString("hex");
}

export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE_DAYS * 86_400,
};

/* ---------------- reading identity in a server component ---------------- */

export type CustomerRow = {
  id: string;
  email: string;
  name: string | null;
  profile_id: string | null;
  market: string | null;
  created_at: string;
};

/** The signed-in customer for this request, or null. Never throws. */
export async function currentCustomer(): Promise<CustomerRow | null> {
  try {
    const jar = await cookies();
    const id = readCustomerToken(jar.get(CUSTOMER_COOKIE)?.value);
    if (!id) return null;
    const sb = supabaseAdmin();
    if (!sb) return null;
    const { data } = await sb
      .from("customers")
      .select("id,email,name,profile_id,market,created_at")
      .eq("id", id)
      .maybeSingle();
    return (data as CustomerRow) ?? null;
  } catch {
    return null;
  }
}

/** The guest basket key for this request, if one has been issued. */
export async function currentGuestKey(): Promise<string | null> {
  try {
    const jar = await cookies();
    return jar.get(GUEST_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

/* ---------------- reading identity inside an API route ---------------- */

function cookieFromHeader(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie") || "";
  const m = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export function customerIdFromRequest(req: Request): string | null {
  return readCustomerToken(cookieFromHeader(req, CUSTOMER_COOKIE));
}

export function guestKeyFromRequest(req: Request): string | null {
  return cookieFromHeader(req, GUEST_COOKIE);
}

/* ---------------- Supabase Auth operations ---------------- */

/* Flat, not a discriminated union. `strict: false` in this project turns off
   strictNullChecks, and without it TypeScript will not narrow `{ok:true}|{ok:false}`
   at a call site — every read of `.error` fails to compile. Same reason the
   ingest spine and the payment layer use flat results. */
export type AuthOutcome = { ok: boolean; customerId: string; error: string };

/** Plain-language failures. A customer never sees a raw provider error. */
function friendly(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("already registered") || m.includes("already been registered"))
    return "There is already an account with that email address. Try signing in instead.";
  if (m.includes("invalid login")) return "That email and password do not match an account.";
  if (m.includes("password")) return "That password is not strong enough — use at least eight characters.";
  if (m.includes("email")) return "That does not look like a valid email address.";
  return "We could not complete that just now. Please try again.";
}

export async function signUpCustomer(input: {
  email: string;
  password: string;
  name?: string;
  household?: Record<string, any>;
}): Promise<AuthOutcome> {
  const sb = supabaseAdmin();
  if (!sb) return { ok: false, customerId: "", error: "The site is not connected to its database right now." };

  const email = input.email.trim().toLowerCase();
  const { data, error } = await (sb as any).auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true, // demo: no transactional email exists to confirm through
    user_metadata: { name: input.name || null, demo: true },
  });
  if (error) return { ok: false, customerId: "", error: friendly(String(error.message || error)) };
  const authUserId = data?.user?.id ?? null;

  // ONE HOUSEHOLD MODEL. Jimmy already has jimmy_profiles and owned_equipment
  // keys on it, so a customer's household IS a Jimmy profile. Building a second
  // profile table here would have split "my kit" across two systems on day one.
  let profileId: string | null = null;
  try {
    const { data: prof } = await sb
      .from("jimmy_profiles")
      .insert({
        name: input.name?.trim() || email.split("@")[0],
        is_test: true, // demo environment: every profile is fictional
        household: input.household ?? {},
        equipment: {},
        notes: "Created by customer sign-up (commerce demo).",
      })
      .select("id")
      .single();
    profileId = (prof as any)?.id ?? null;
  } catch {
    profileId = null; // a missing profile must not block the sign-up
  }

  const { data: cust, error: cErr } = await sb
    .from("customers")
    .insert({ auth_user_id: authUserId, email, name: input.name?.trim() || null, profile_id: profileId })
    .select("id")
    .single();
  if (cErr) return { ok: false, customerId: "", error: friendly(String(cErr.message || cErr)) };
  return { ok: true, customerId: (cust as any).id, error: "" };
}

export async function signInCustomer(email: string, password: string): Promise<AuthOutcome> {
  const sb = supabaseAdmin();
  if (!sb) return { ok: false, customerId: "", error: "The site is not connected to its database right now." };
  const { data, error } = await (sb as any).auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error || !data?.user) return { ok: false, customerId: "", error: friendly(String(error?.message || "invalid login")) };

  const { data: cust } = await sb
    .from("customers")
    .select("id")
    .eq("auth_user_id", data.user.id)
    .maybeSingle();
  if (cust) return { ok: true, customerId: (cust as any).id, error: "" };

  // Auth user with no customer row — repair it rather than dead-ending.
  const { data: made, error: mErr } = await sb
    .from("customers")
    .insert({ auth_user_id: data.user.id, email: data.user.email, name: data.user.user_metadata?.name ?? null })
    .select("id")
    .single();
  if (mErr) return { ok: false, customerId: "", error: friendly(String(mErr.message || mErr)) };
  return { ok: true, customerId: (made as any).id, error: "" };
}

/** DEMO PASSWORD RESET.
 *  There is no transactional email, so there is no link to send. Rather than
 *  ship a reset flow that silently does nothing, this sets the password
 *  directly — and the page says so in plain words. It is safe only because the
 *  whole site sits behind the founder password gate and holds fictional data.
 *  REPLACE THIS with resetPasswordForEmail the moment email exists. */
export async function demoResetPassword(email: string, newPassword: string): Promise<AuthOutcome> {
  const sb = supabaseAdmin();
  if (!sb) return { ok: false, customerId: "", error: "The site is not connected to its database right now." };
  const { data: cust } = await sb
    .from("customers")
    .select("id,auth_user_id")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();
  if (!cust?.auth_user_id) return { ok: false, customerId: "", error: "No account found with that email address." };
  const { error } = await (sb as any).auth.admin.updateUserById(cust.auth_user_id, {
    password: newPassword,
  });
  if (error) return { ok: false, customerId: "", error: friendly(String(error.message || error)) };
  return { ok: true, customerId: (cust as any).id, error: "" };
}
