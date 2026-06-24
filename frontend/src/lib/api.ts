import axios, { AxiosError } from "axios";
import type {
  ConversationDetail,
  ConversationListItem,
  LockState,
  MessageItem,
  Paginated,
} from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export const TOKEN_KEY = "inbox_access_token";

export const apiClient = axios.create({
  baseURL: API_URL,
  headers: { "Content-Type": "application/json" },
});

// Attach JWT on every request (client-side only)
apiClient.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401, clear token and bounce to login
apiClient.interceptors.response.use(
  (r) => r,
  (error: AxiosError) => {
    if (error.response?.status === 401 && typeof window !== "undefined") {
      localStorage.removeItem(TOKEN_KEY);
      if (!window.location.pathname.startsWith("/login")) {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

// ── Auth ─────────────────────────────────────────────────────
export async function login(username: string, password: string): Promise<string> {
  const { data } = await apiClient.post("/api/auth/login/", { username, password });
  if (typeof window !== "undefined") {
    localStorage.setItem(TOKEN_KEY, data.access);
  }
  return data.access;
}

export function logout(): void {
  if (typeof window !== "undefined") localStorage.removeItem(TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(localStorage.getItem(TOKEN_KEY));
}

// ── Conversations ────────────────────────────────────────────
export interface ListParams {
  page?: number;
  search?: string;
  status?: string;
}

export async function fetchConversations(
  params: ListParams
): Promise<Paginated<ConversationListItem>> {
  const { data } = await apiClient.get("/api/conversations/", { params });
  return data;
}

export async function fetchConversation(id: number): Promise<ConversationDetail> {
  const { data } = await apiClient.get(`/api/conversations/${id}/`);
  return data;
}

export async function fetchMessages(
  id: number,
  after?: number
): Promise<MessageItem[]> {
  const { data } = await apiClient.get(`/api/conversations/${id}/messages/`, {
    params: after ? { after } : {},
  });
  return data;
}

export async function sendReply(id: number, message: string): Promise<MessageItem> {
  const { data } = await apiClient.post(`/api/conversations/${id}/reply/`, { message });
  return data;
}

export async function suggestReply(id: number, message: string): Promise<string> {
  const { data } = await apiClient.post(`/api/conversations/${id}/suggest-reply/`, {
    message,
  });
  return data.suggestion;
}

// ── Locking ──────────────────────────────────────────────────
export async function acquireLock(id: number): Promise<LockState> {
  const { data } = await apiClient.post(`/api/conversations/${id}/lock/`);
  return data;
}

export async function releaseLock(id: number): Promise<void> {
  await apiClient.post(`/api/conversations/${id}/unlock/`);
}

export async function lockStatus(id: number): Promise<LockState> {
  const { data } = await apiClient.get(`/api/conversations/${id}/lock/`);
  return data;
}

export function apiErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { detail?: string; locked_by?: string } | undefined;
    if (data?.detail) return data.detail;
    return err.message;
  }
  return err instanceof Error ? err.message : "Unknown error";
}
