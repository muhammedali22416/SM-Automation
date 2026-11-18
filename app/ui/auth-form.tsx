"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { AuthFormState } from "@/app/actions/auth";

type AuthAction = (
  previousState: AuthFormState,
  formData: FormData
) => Promise<AuthFormState>;

type AuthFormProps = {
  action: AuthAction;
  mode: "login" | "signup";
  message?: string;
};

export function AuthForm({ action, mode, message }: AuthFormProps) {
  const [state, formAction, pending] = useActionState(action, {});
  const isSignup = mode === "signup";

  return (
    <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
      <div className="mb-8">
        <p className="text-sm font-medium text-indigo-600">Reels Dashboard</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">
          {isSignup ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          {isSignup
            ? "Sign up to start managing your podcast reels."
            : "Log in to manage your podcast reels."}
        </p>
      </div>

      {message && (
        <p className="mb-5 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
          {message}
        </p>
      )}

      {state.error && (
        <p className="mb-5 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <form action={formAction} className="space-y-5">
        <div>
          <label
            className="mb-2 block text-sm font-medium text-zinc-700"
            htmlFor="email"
          >
            Email
          </label>
          <input
            className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-950 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            id="email"
            name="email"
            required
            type="email"
            autoComplete="email"
          />
        </div>

        <div>
          <label
            className="mb-2 block text-sm font-medium text-zinc-700"
            htmlFor="password"
          >
            Password
          </label>
          <input
            className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-950 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            id="password"
            name="password"
            required
            type="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
          />
        </div>

        <button
          className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? "Please wait..." : isSignup ? "Sign up" : "Log in"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-zinc-600">
        {isSignup ? "Already have an account?" : "Need an account?"}{" "}
        <Link
          className="font-medium text-indigo-600 hover:text-indigo-700"
          href={isSignup ? "/login" : "/signup"}
        >
          {isSignup ? "Log in" : "Sign up"}
        </Link>
      </p>
    </div>
  );
}
