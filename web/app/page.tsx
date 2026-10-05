import { Suspense } from "react";
import ReaderApp from "./_reader/ReaderApp";

// The library and the reader are one client-rendered page (views switch by ?novel=&chapter=), so the
// service worker can serve it offline from the phone's cached data.
export default function HomePage() {
  return <Suspense><ReaderApp /></Suspense>;
}
