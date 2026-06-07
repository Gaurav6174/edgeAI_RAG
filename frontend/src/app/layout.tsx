import { ebGaramond, inter } from './fonts';
import './globals.css';

export const metadata = {
  title: 'Campus Handbook Bot',
  description: 'AI-powered RAG for Campus Handbook',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${ebGaramond.variable}`}>
      <body className={inter.className}>{children}</body>
    </html>
  );
}
