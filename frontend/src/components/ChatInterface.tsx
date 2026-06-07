"use client";

import { useState, useRef, useEffect } from "react";

interface Citation {
  text: string;
  source: string;
  page?: number;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
}

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { role: "user", content: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    // Mock Demo Logic
    setTimeout(async () => {
      const demoCitations: Citation[] = [
        { text: "The campus library is open 24/7 during finals week.", source: "Campus_Handbook.pdf", page: 12 },
        { text: "Students must maintain a 2.0 GPA to remain in good standing.", source: "Academic_Policies.pdf", page: 45 }
      ];

      const assistantMessage: Message = { 
        role: "assistant", 
        content: "", 
        citations: demoCitations 
      };
      
      setMessages((prev) => [...prev, assistantMessage]);

      const fullResponse = "This is a demo response in Dark Mode with Tailwind v4. The interface uses a deep ink canvas and soft elevated surfaces to maintain a quiet, editorial atmosphere.";
      let currentContent = "";
      const words = fullResponse.split(" ");

      for (let i = 0; i < words.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 50));
        currentContent += (i === 0 ? "" : " ") + words[i];
        setMessages((prev) => {
          const newMessages = [...prev];
          newMessages[newMessages.length - 1].content = currentContent;
          return newMessages;
        });
      }
      setIsLoading(false);
    }, 1000);
  };

  return (
    <div className="mx-auto flex h-[600px] w-full max-w-[800px] flex-col overflow-hidden rounded-xl border border-hairline bg-surface-card">
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center text-center text-muted">
            <p className="display-sm">Ask anything about the handbook.</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex w-full ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-lg p-4 ${
              m.role === 'user' 
                ? 'rounded-br-none bg-surface-strong text-ink' 
                : 'rounded-bl-none border border-hairline-soft bg-canvas-soft text-body'
            }`}>
              <p className="body-md">{m.content}</p>
              {m.citations && m.citations.length > 0 && (
                <div className="mt-5 border-t border-hairline-soft pt-3">
                  <p className="caption-uppercase">Sources</p>
                  <div className="mt-2 flex flex-col gap-2">
                    {m.citations.map((c, j) => (
                      <div key={j} className="text-sm italic">
                        <p className="body-sm">"{c.text}"</p>
                        <span className="mt-0.5 block text-xs font-normal not-italic text-muted">
                          — {c.source} {c.page ? `(p. ${c.page})` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="flex gap-3 border-t border-hairline bg-surface-card p-6">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your question..."
          className="input-field"
          disabled={isLoading}
        />
        <button type="submit" className="btn-primary" disabled={isLoading}>
          {isLoading ? "Thinking..." : "Send"}
        </button>
      </form>
    </div>
  );
}
