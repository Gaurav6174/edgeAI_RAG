import Link from "next/link";

export default function Navbar() {
  return (
    <nav className="sticky top-0 z-[100] flex h-16 items-center border-b border-hairline bg-canvas">
      <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between px-6">
        <div className="font-serif text-2xl font-normal text-ink">
          <Link href="/">Campus Handbook</Link>
        </div>
        <div className="flex gap-8">
          <Link href="/docs" className="text-[15px] font-medium text-ink transition-opacity hover:opacity-70">Docs</Link>
          <Link href="/about" className="text-[15px] font-medium text-ink transition-opacity hover:opacity-70">About</Link>
        </div>
        <div className="flex gap-3">
          <button className="btn-outline">Sign In</button>
          <button className="btn-primary">Try free</button>
        </div>
      </div>
    </nav>
  );
}
