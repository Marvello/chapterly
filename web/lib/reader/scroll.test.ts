import { expect, it } from "vitest";
import { positionFromScroll } from "./scroll";

const blocks = [
  { chapterId: 1, idx: 1, top: 0, height: 1000 },
  { chapterId: 2, idx: 2, top: 1000, height: 500 },
];

it("finds the chapter at the top of the viewport and how far through it is", () => {
  expect(positionFromScroll(blocks, 250)).toEqual({ chapterId: 1, idx: 1, fraction: 0.25 });
  expect(positionFromScroll(blocks, 1200)).toEqual({ chapterId: 2, idx: 2, fraction: 0.4 });
  expect(positionFromScroll(blocks, 5000)).toEqual({ chapterId: 2, idx: 2, fraction: 1 });
  expect(positionFromScroll([], 0)).toBeNull();
  expect(positionFromScroll([{ chapterId: 3, idx: 3, top: 0, height: 0 }], 10)).toEqual({ chapterId: 3, idx: 3, fraction: 0 });
});
