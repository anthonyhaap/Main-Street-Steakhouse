"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters")
  .max(30, "Username must be at most 30 characters")
  .regex(/^[a-zA-Z0-9_]+$/, "Username may only contain letters, numbers, and underscores");

const signupSchema = z.object({
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  username: usernameSchema,
  fullName: z.string().trim().max(80).optional(),
});

export type ActionResult = { error: string } | undefined;

/**
 * Commissioner-facing signup. Creates an auth user + profile and signs them in.
 * Email is the login identity; the password is chosen here and never emailed.
 */
export async function signUp(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = signupSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    username: formData.get("username"),
    fullName: formData.get("fullName") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0].message };
  }
  const { email, password, username, fullName } = parsed.data;

  const admin = createAdminClient();

  // Reserve the username up front for a clear error message.
  const { data: taken } = await admin
    .from("profiles")
    .select("id")
    .ilike("username", username)
    .maybeSingle();
  if (taken) {
    return { error: "That username is already taken" };
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !created.user) {
    const msg = createErr?.message ?? "Could not create account";
    return {
      error: /registered|exists/i.test(msg)
        ? "An account with that email already exists. Try logging in."
        : msg,
    };
  }

  const { error: profileErr } = await admin.from("profiles").insert({
    id: created.user.id,
    username,
    full_name: fullName ?? null,
  });
  if (profileErr) {
    // Roll back the orphaned auth user so the email can be reused.
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: "Could not create profile. Please try again." };
  }

  const supabase = createClient();
  const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signInErr) {
    return { error: "Account created, but sign-in failed. Please log in." };
  }

  redirect("/dashboard");
}

const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});

export async function login(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0].message };
  }

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return { error: "Invalid email or password" };
  }

  const redirectTo = (formData.get("redirect") as string) || "/dashboard";
  redirect(redirectTo.startsWith("/") ? redirectTo : "/dashboard");
}

export async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
