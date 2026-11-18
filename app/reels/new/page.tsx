import { DashboardNav } from "@/app/ui/dashboard-nav";
import { ReelUploader } from "./reel-uploader";

export const instant = false;

export default function NewReelPage() {
  return (
    <div className="min-h-screen bg-zinc-50">
      <DashboardNav />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <div>
          <p className="text-sm font-medium text-indigo-600">Content</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-950">
            Upload a reel
          </h1>
          <p className="mt-2 text-zinc-600">
            Upload a video file to start creating a podcast reel.
          </p>
        </div>
        <ReelUploader />
      </main>
    </div>
  );
}
