"use client";
export default function NovelView({ novelId }: { novelId: number; rev: number }) {
  return <main className="p-4 text-tprimary">Novel {novelId}</main>;
}
