import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { encryptSession, setAuthCookie } from "@/lib/server/auth";

export const runtime = "nodejs";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  agreeToLegal: z.literal(true),
});

export async function POST(request: NextRequest) {
  try {
    const body = schema.parse(await request.json());

    const token = encryptSession({
      email: body.email,
      agreedToLegal: true,
      iat: Date.now(),
    });

    const response = NextResponse.json({ ok: true, email: body.email });
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
