import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { requireEnv } from "@/lib/server/env";

const AUTH_COOKIE_NAME = "bc_auth";
const ALGO = "aes-256-gcm";

type SessionPayload = {
  email: string;
  agreedToLegal: true;
  iat: number;
};

function getEncryptionKey(): Buffer {
  const raw = requireEnv("AUTH_ENCRYPTION_KEY").trim();

  const asBase64 = tryDecodeBase64(raw);
  if (asBase64 && asBase64.length === 32) {
    return asBase64;
  }

  if (raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw)) {
    const asHex = Buffer.from(raw, "hex");
    if (asHex.length === 32) {
      return asHex;
    }
  }

  if (raw.length === 32) {
    return Buffer.from(raw, "utf8");
  }

  throw new Error("AUTH_ENCRYPTION_KEY must be 32 bytes (plain), 64-char hex, or base64 for 32 bytes.");
}

function tryDecodeBase64(value: string): Buffer | null {
  try {
    const decoded = Buffer.from(value, "base64");
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

export function encryptSession(payload: SessionPayload): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);

  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString("base64url")}.${encrypted.toString("base64url")}.${tag.toString("base64url")}`;
}

export function decryptSession(token: string): SessionPayload | null {
  try {
    const key = getEncryptionKey();
    const [ivPart, encryptedPart, tagPart] = token.split(".");
    if (!ivPart || !encryptedPart || !tagPart) {
      return null;
    }

    const iv = Buffer.from(ivPart, "base64url");
    const encrypted = Buffer.from(encryptedPart, "base64url");
    const tag = Buffer.from(tagPart, "base64url");

    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const parsed = JSON.parse(decrypted.toString("utf8")) as SessionPayload;

    if (!parsed.email || parsed.agreedToLegal !== true) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

type SetAuthCookieOptions = {
  rememberMe?: boolean;
};

export function setAuthCookie(response: NextResponse, token: string, options?: SetAuthCookieOptions) {
  const rememberMe = options?.rememberMe ?? true;

  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: rememberMe ? 60 * 60 * 24 * 30 : undefined,
  });
}

export function clearAuthCookie(response: NextResponse) {
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function getSessionFromCookie() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }

  return decryptSession(token);
}

export { AUTH_COOKIE_NAME };
export type { SessionPayload };
