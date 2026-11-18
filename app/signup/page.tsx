import { signup } from "@/app/actions/auth";
import { AuthForm } from "@/app/ui/auth-form";

export default function SignupPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 py-12">
      <AuthForm action={signup} mode="signup" />
    </main>
  );
}
