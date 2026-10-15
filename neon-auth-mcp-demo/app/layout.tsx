import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Providers } from "./providers";
import "@neondatabase/auth-ui/css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Neon Auth MCP Demo",
  description: "Login + consent host for the Neon Auth MCP/OAuth flow",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
