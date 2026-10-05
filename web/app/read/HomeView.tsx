"use client";
export default function HomeView({ notice }: { rev: number; notice: string | null }) {
  return <main className="p-4 text-tprimary">Reader home {notice}</main>;
}
