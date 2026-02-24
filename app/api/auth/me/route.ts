import { NextResponse } from "next/server";

import { getSessionFromCookie } from "@/lib/server/auth";

export async function GET() {
  const session = await getSessionFromCookie();

  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      email: session.email,
      agreedToLegal: session.agreedToLegal,
    },
  });
}
