import { Suspense } from "react";
import ReaderApp from "./ReaderApp";

export const metadata = { title: "Chapterly Reader" };

export default function ReadPage() {
  return <Suspense><ReaderApp /></Suspense>;
}
