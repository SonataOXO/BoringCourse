import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { encryptSession, setAuthCookie } from "@/lib/server/auth";

export const runtime = "nodejs";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  rememberMe: z.boolean().optional().default(false),
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
