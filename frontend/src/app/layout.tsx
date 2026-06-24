import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/lib/providers";
import { ToastProvider } from "@/components/Toast";

export const metadata: Metadata = {
  title: "Smart Customer Support Inbox",
  description: "Support agent inbox with real-time replies and AI suggestions",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <ToastProvider>{children}</ToastProvider>
        </Providers>
      </body>
    </html>
  );
}
