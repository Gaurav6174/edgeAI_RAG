"use client";

import { useState } from "react";
import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import FileUpload from "@/components/FileUpload";
import ChatInterface from "@/components/ChatInterface";

export default function Home() {
  const [lastUploaded, setLastUploaded] = useState<string | null>(null);

  return (
    <main className="flex min-h-screen flex-col">
      <Navbar />
      <Hero />
      
      <section className="bg-canvas-soft py-section">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-[350px_1fr]">
            <div className="flex flex-col gap-6">
              <FileUpload onUploadComplete={(filename) => setLastUploaded(filename)} />
              {lastUploaded && (
                <div className="flex items-center gap-3 rounded-lg border border-semantic-success bg-surface-card p-4 text-[15px]">
                  <span className="inline-flex items-center justify-center rounded-full bg-surface-strong px-2.5 py-1 text-[12px] font-semibold tracking-wider text-ink uppercase">Success</span>
                  <p>Indexed: {lastUploaded}</p>
                </div>
              )}
            </div>
            <div className="flex">
              <ChatInterface />
            </div>
          </div>
        </div>
      </section>

      <footer className="mt-auto border-t border-hairline bg-canvas py-8">
        <div className="mx-auto max-w-[1200px] px-6">
          <p className="text-[15px] text-body">© 2026 Campus Handbook Bot. All rights reserved.</p>
        </div>
      </footer>
    </main>
  );
}
