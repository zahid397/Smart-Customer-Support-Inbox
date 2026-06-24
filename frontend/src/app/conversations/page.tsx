"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ConversationList } from "@/components/ConversationList";
import { isAuthenticated, logout } from "@/lib/api";

export default function ConversationsPage() {
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated()) router.replace("/login");
  }, [router]);

  return (
    <div className="h-screen flex">
      <div className="w-80 shrink-0">
        <ConversationList />
      </div>
      <div className="flex-1 flex flex-col">
        <Header onLogout={() => { logout(); router.replace("/login"); }} />
        <div className="flex-1 flex items-center justify-center text-slate-400">
          <div className="text-center">
            <div className="text-5xl mb-3">💬</div>
            <p className="text-sm">Select a conversation to view the thread</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Header({ onLogout }: { onLogout: () => void }) {
  return (
    <header className="h-14 shrink-0 border-b border-slate-200 bg-white flex items-center justify-between px-6">
      <span className="font-semibold text-slate-900">Smart Support Inbox</span>
      <button onClick={onLogout} className="text-sm text-slate-500 hover:text-slate-900">
        Sign out
      </button>
    </header>
  );
}
