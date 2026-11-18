import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

const publicPaths = new Set(["/login", "/signup"]);

function redirectWithSessionCookies(
  request: NextRequest,
  response: Response,
  path: string
) {
  const redirectResponse = NextResponse.redirect(new URL(path, request.url));

  if (response instanceof NextResponse) {
    response.cookies
      .getAll()
      .forEach((cookie) => redirectResponse.cookies.set(cookie));
  }

  return redirectResponse;
}

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });
  const { response: sessionResponse, user } = await updateSession(
    request,
    response
  );
  const isPublicPath = publicPaths.has(request.nextUrl.pathname);

  if (!user && !isPublicPath) {
    return redirectWithSessionCookies(request, sessionResponse, "/login");
  }

  if (user && isPublicPath) {
    return redirectWithSessionCookies(request, sessionResponse, "/");
  }

  return sessionResponse;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
