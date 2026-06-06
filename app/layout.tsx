import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./tailwind.css";

const geistSans = Geist({
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Question Mapper",
  description: "Map school form questions to a standardized question library.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.className} bg-[#f3f6fa] text-[#14213d] antialiased`}>
        {children}
      </body>
    </html>
  );
}
