import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageComposer } from "@/components/MessageComposer";
import { ToastProvider } from "@/components/Toast";
import * as api from "@/lib/api";

jest.mock("@/lib/api");
const mockedApi = api as jest.Mocked<typeof api>;

function setup(canReply = true) {
  const onOptimistic = jest.fn().mockReturnValue(-123); // temp id
  const onConfirm = jest.fn();
  const onRollback = jest.fn();

  render(
    <ToastProvider>
      <MessageComposer
        conversationId={1}
        canReply={canReply}
        onOptimistic={onOptimistic}
        onConfirm={onConfirm}
        onRollback={onRollback}
      />
    </ToastProvider>
  );

  return { onOptimistic, onConfirm, onRollback };
}

describe("MessageComposer", () => {
  afterEach(() => jest.clearAllMocks());

  it("optimistically inserts a message then confirms on success", async () => {
    const user = userEvent.setup();
    mockedApi.sendReply.mockResolvedValue({
      id: 99,
      sender: "agent",
      message: "Hello there",
      created_at: "2026-01-01T00:00:00Z",
    });

    const { onOptimistic, onConfirm, onRollback } = setup(true);

    await user.type(screen.getByLabelText("Message"), "Hello there");
    await user.click(screen.getByRole("button", { name: /send/i }));

    // Optimistic insert happened immediately with sender agent
    expect(onOptimistic).toHaveBeenCalledTimes(1);
    expect(onOptimistic.mock.calls[0][0]).toMatchObject({
      sender: "agent",
      message: "Hello there",
      optimistic: true,
    });

    // After the server resolves, it confirms with the real id and does NOT roll back
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm.mock.calls[0][0]).toBe(-123); // temp id
    expect(onConfirm.mock.calls[0][1]).toMatchObject({ id: 99, optimistic: false });
    expect(onRollback).not.toHaveBeenCalled();
  });

  it("rolls back the optimistic message when the API fails", async () => {
    const user = userEvent.setup();
    mockedApi.sendReply.mockRejectedValue(new Error("500 server error"));
    mockedApi.apiErrorMessage.mockReturnValue("500 server error");

    const { onOptimistic, onConfirm, onRollback } = setup(true);

    await user.type(screen.getByLabelText("Message"), "This will fail");
    await user.click(screen.getByRole("button", { name: /send/i }));

    // Optimistic insert happened
    expect(onOptimistic).toHaveBeenCalledTimes(1);

    // On failure: rollback called with the temp id, confirm never called
    await waitFor(() => expect(onRollback).toHaveBeenCalledWith(-123));
    expect(onConfirm).not.toHaveBeenCalled();

    // Error toast is shown
    await waitFor(() => {
      expect(screen.getByText("500 server error")).toBeInTheDocument();
    });
  });

  it("disables replying when the conversation is locked by another agent", () => {
    setup(false);
    expect(screen.getByText(/locked by another agent/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send/i })).not.toBeInTheDocument();
  });
});
