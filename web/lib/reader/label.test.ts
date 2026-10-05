import { expect, it } from "vitest";
import { chapterLabel } from "./label";

it("uses the title, else the 1-based chapter number (also for empty titles)", () => {
  expect(chapterLabel({ title: "The Duel", idx: 4 })).toBe("The Duel");
  expect(chapterLabel({ title: "", idx: 0 })).toBe("Chapter 1");
  expect(chapterLabel({ title: null, idx: 9 })).toBe("Chapter 10");
  expect(chapterLabel({ idx: 2 })).toBe("Chapter 3");
});
