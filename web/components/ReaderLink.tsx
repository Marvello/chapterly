"use client";

import { go } from "@/lib/reader/client";

/** A link into the reader (`/?novel=…`) that switches views without a server round trip, so it works offline.
 * Modified clicks (new tab etc.) keep the browser's default. */
export default function ReaderLink({ href, ...rest }: React.ComponentProps<"a"> & { href: string }) {
  return (
    <a href={href} {...rest} onClick={e => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      go(href);
    }} />
  );
}
