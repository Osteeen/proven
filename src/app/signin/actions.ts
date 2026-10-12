"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { createDemoSession, type DemoRole } from "@/server/auth/demo-login";
import { sessionCookieName } from "@/server/auth/paypal-login";

export async function demoSignIn(formData: FormData) {
  const role = formData.get("role");
  if (role !== "charity" && role !== "reviewer") throw new Error("Unknown demo role");
  const { token, expires } = await createDemoSession(role as DemoRole);
  (await cookies()).set(sessionCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: sessionCookieName().startsWith("__Secure-"),
    path: "/",
    expires,
  });
  redirect(role === "reviewer" ? "/review" : "/dashboard");
}

export async function signOutAction() {
  await signOut({ redirectTo: "/signin" });
}
