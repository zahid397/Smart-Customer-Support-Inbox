import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConversationList } from "@/components/ConversationList";
import * as api from "@/lib/api";

// Mock the router
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

// Mock the API module
jest.mock("@/lib/api");
const mockedApi = api as jest.Mocked<typeof api>;

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("ConversationList", () => {
  afterEach(() => jest.clearAllMocks());

  it("shows a loading state initially", () => {
    mockedApi.fetchConversations.mockReturnValue(new Promise(() => {})); // never resolves
    renderWithClient(<ConversationList />);
    expect(screen.getByText(/loading conversations/i)).toBeInTheDocument();
  });

  it("renders conversations returned by the API", async () => {
    mockedApi.fetchConversations.mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [
        {
          id: 1,
          customer_name: "John Doe",
          last_message: "Need help with my order",
          status: "open",
          created_at: "2026-01-01T12:00:00Z",
        },
      ],
    });

    renderWithClient(<ConversationList />);

    await waitFor(() => {
      expect(screen.getByText("John Doe")).toBeInTheDocument();
    });
    expect(screen.getByText("Need help with my order")).toBeInTheDocument();
  });

  it("shows an empty state when there are no conversations", async () => {
    mockedApi.fetchConversations.mockResolvedValue({
      count: 0,
      next: null,
      previous: null,
      results: [],
    });

    renderWithClient(<ConversationList />);

    await waitFor(() => {
      expect(screen.getByText(/no conversations found/i)).toBeInTheDocument();
    });
  });

  it("shows an error state and a retry button on failure", async () => {
    mockedApi.fetchConversations.mockRejectedValue(new Error("network"));

    renderWithClient(<ConversationList />);

    await waitFor(() => {
      expect(screen.getByText(/failed to load conversations/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/retry/i)).toBeInTheDocument();
  });
});
