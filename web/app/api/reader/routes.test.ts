// Guards against a route file silently missing from the repo: a too-broad .gitignore pattern (`library/`) once
// kept app/api/reader/library out of git, so local builds worked and the CI-built image returned 404.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

it("every reader API route file is present in the checkout", () => {
  for (const r of ["library", "novels/[id]/toc", "novels/[id]/chapters", "progress"]) {
    expect(existsSync(here(`./${r}/route.ts`)), r).toBe(true);
  }
});
