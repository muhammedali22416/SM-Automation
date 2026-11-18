"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CalendarRefresh() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshStatus() {
    setRefreshing(true);
    setError(null);
    try {
      const response = await fetch("/api/reels/refresh-status", { method: "POST" });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to refresh statuses.");
      }
      router.refresh();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to refresh statuses.");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        className="rounded-lg border border-indigo-200 px-4 py-2.5 text-sm font-medium text-indigo-700 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={refreshing}
        onClick={refreshStatus}
        type="button"
      >
        {refreshing ? "Refreshing..." : "Refresh status"}
      </button>
      {error && <p className="text-xs text-red-700" role="alert">{error}</p>}
    </div>
  );
}
