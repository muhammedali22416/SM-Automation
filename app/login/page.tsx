import { login } from "@/app/actions/auth";
import { AuthForm } from "@/app/ui/auth-form";

export const instant = false;

type LoginPageProps = {
  searchParams: Promise<{ message?: string }>;
};

export default async function LoginPage({
  searchParams,
}: LoginPageProps) {
  const { message } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 py-12">
      <AuthForm action={login} mode="login" message={message} />
    </main>
  );
}
