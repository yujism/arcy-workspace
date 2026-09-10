import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Arcy Workspace",
  description: "Your personal workspace for tasks, knowledge, and calendar.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
