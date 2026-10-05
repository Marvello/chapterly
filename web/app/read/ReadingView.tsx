"use client";
export default function ReadingView({ novelId, chapterId }: { novelId: number; chapterId: number }) {
  return <main className="p-4 text-tprimary">Reading {novelId}/{chapterId}</main>;
}
