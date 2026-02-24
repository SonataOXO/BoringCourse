import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { encryptSession, setAuthCookie } from "@/lib/server/auth";
import { createUser } from "@/lib/server/user-store";

export const runtime = "nodejs";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  agreeToLegal: z.literal(true),
});

export async function POST(request: NextRequest) {
  try {
    const body = schema.parse(await request.json());
    const created = await createUser({
      email: body.email,
      password: body.password,
      agreedToLegal: body.agreeToLegal,
    });
    if (!created.ok) {
      return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
    }

    const token = encryptSession({
      email: body.email.trim().toLowerCase(),
      agreedToLegal: true,
      iat: Date.now(),
    });

    const response = NextResponse.json({ ok: true, email: body.email.trim().toLowerCase() });
    setAuthCookie(response, token);
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Invalid sign up payload",
      },
      { status: 400 },
    );
  }
}
