import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { encryptSession, setAuthCookie } from "@/lib/server/auth";
import { verifyUserCredentials } from "@/lib/server/user-store";

export const runtime = "nodejs";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  rememberMe: z.boolean().optional().default(false),
});

export async function POST(request: NextRequest) {
  try {
    const body = schema.parse(await request.json());
    const verified = await verifyUserCredentials({
      email: body.email,
      password: body.password,
    });
    if (!verified.ok) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    const token = encryptSession({
      email: verified.email,
      agreedToLegal: true,
      iat: Date.now(),
    });

    const response = NextResponse.json({ ok: true, email: verified.email });
    setAuthCookie(response, token, { rememberMe: body.rememberMe });
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Invalid login payload",
      },
      { status: 400 },
    );
  }
}
