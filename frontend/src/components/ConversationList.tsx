"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { fetchConversations } from "@/lib/api";
import type { ConversationStatus } from "@/types";

const STATUS_STYLES: Record<string, string> = {
  open: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  closed: "bg-slate-200 text-slate-600",
};

export function ConversationList({ activeId }: { activeId?: number }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ConversationStatus | "">("");
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["conversations", { search, status, page }],
    queryFn: () =>
      fetchConversations({
        page,
        search: search || undefined,
        status: status || undefined,
      }),
  });

  const totalPages = data ? Math.ceil(data.count / 10) : 1;

  return (
    <div className="flex flex-col h-full bg-white border-r border-slate-200">
      {/* Header / filters */}
      <div className="p-4 border-b border-slate-200">
        <h2 className="text-lg font-bold text-slate-900 mb-3">Conversations</h2>
        <input
          aria-label="Search conversations"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search by customer name..."
          className="w-full mb-2 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <div className="flex gap-1">
          {(["", "open", "pending", "closed"] as const).map((s) => (
            <button
              key={s || "all"}
              onClick={() => {
                setStatus(s);
                setPage(1);
              }}
              className={`flex-1 rounded-md px-2 py-1 text-xs font-medium capitalize transition-colors ${
                status === s
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {s || "All"}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="p-8 text-center text-sm text-slate-400">Loading conversations…</div>
        )}
        {isError && (
          <div className="p-8 text-center">
            <p className="text-sm text-red-500 mb-2">Failed to load conversations.</p>
            <button onClick={() => refetch()} className="text-sm text-indigo-600 hover:underline">
              Retry
            </button>
          </div>
        )}
        {data && data.results.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-400">No conversations found.</div>
        )}
        {data?.results.map((c) => (
          <button
            key={c.id}
            onClick={() => router.push(`/conversations/${c.id}`)}
            className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 transition-colors ${
              activeId === c.id ? "bg-indigo-50" : ""
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-sm text-slate-900">{c.customer_name}</span>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full capitalize ${STATUS_STYLES[c.status]}`}>
                {c.status}
              </span>
            </div>
            <p className="text-xs text-slate-500 truncate">{c.last_message || "No messages yet"}</p>
          </button>
        ))}
      </div>

      {/* Pagination */}
      {data && totalPages > 1 && (
        <div className="flex items-center justify-between p-3 border-t border-slate-200 text-sm">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-3 py-1 rounded-md bg-slate-100 disabled:opacity-40 hover:bg-slate-200"
          >
            Prev
          </button>
          <span className="text-slate-500">
            Page {page} of {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1 rounded-md bg-slate-100 disabled:opacity-40 hover:bg-slate-200"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
