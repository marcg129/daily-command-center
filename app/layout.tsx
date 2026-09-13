import type { Metadata } from "next";
import "./globals.css";
import "./workspace-accessibility.css";
import "./task-menu-viewport.css";
import "./task-planning-filters.css";
import "./navigation-overflow.css";

export const metadata: Metadata = {
  title: "Marc's Daily Command Center",
  description: "Personal focus and Indelitech operations in one daily workspace.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("control-center-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
