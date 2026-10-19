import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LiveKanban",
  description: "Free, no-signup kanban boards with live cursors. Share a link and plan together.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

/** The system font (SF Pro on Apple devices) is set in globals.css; no web font to download. */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
