import { getDb } from "@/lib/db";

export default function Home() {
  return <p className="p-4">{getDb().listNovels().length} novels</p>;
}
