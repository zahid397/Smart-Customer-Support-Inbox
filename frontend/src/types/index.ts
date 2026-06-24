export type ConversationStatus = "open" | "pending" | "closed";
export type Sentiment = "Positive" | "Neutral" | "Negative" | "Unknown";
export type Sender = "customer" | "agent";

export interface ConversationListItem {
  id: number;
  customer_name: string;
  last_message: string;
  status: ConversationStatus;
  created_at: string;
}

export interface MessageItem {
  id: number;
  sender: Sender;
  message: string;
  created_at: string;
}

export interface ConversationDetail {
  id: number;
  customer_name: string;
  status: ConversationStatus;
  sentiment: Sentiment;
  created_at: string;
  updated_at: string;
  messages: MessageItem[];
}

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface LockState {
  locked: boolean;
  owned_by_me: boolean;
  holder_id: number | null;
  holder_name: string | null;
}

// Local UI message that may be optimistic (not yet server-confirmed)
export interface UIMessage extends MessageItem {
  optimistic?: boolean;
  failed?: boolean;
}
