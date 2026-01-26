import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    if (String(body?.confirm ?? "") !== "DELETE") {
      return NextResponse.json({ error: 'Missing confirmation. Type "DELETE".' }, { status: 400 });
    }

    // Read the user's access token from Authorization header if you pass it,
    // BUT in this implementation we’ll use the cookie-based session via Supabase Auth on the client,
    // and just require the user to be logged in. Easiest approach:
    // Send the access token from client (recommended for reliability).
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7) : "";

    if (!token) {
      return NextResponse.json(
        { error: "Missing Authorization token. See step below to pass it from the client." },
        { status: 401 }
      );
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY! // IMPORTANT: server-only env var
    );

    // Validate token to get user id
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return NextResponse.json({ error: "Invalid session." }, { status: 401 });
    }

    const userId = userData.user.id;

    // Optional: delete/clean app data first (profiles row, etc)
    // You may want to cascade delete meetings/followups authored by them etc.
    await supabaseAdmin.from("profiles").delete().eq("id", userId);

    // Delete auth user
    const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}