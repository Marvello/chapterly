import { expect, it } from "vitest";
import { createViewPref } from "./viewPref";

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };

it("library layout is remembered per device, defaults to overview, ignores junk", () => {
  const storage = memory();
  const pref = createViewPref(storage);
  expect(pref.get()).toBe("overview");
  expect(pref.getServer()).toBe("overview");
  let calls = 0;
  const off = pref.subscribe(() => { calls++; });
  pref.set("posters");
  expect([pref.get(), calls]).toEqual(["posters", 1]);
  expect(createViewPref(storage).get()).toBe("posters");          // survives a reload
  storage.setItem("chapterly-library-view", "bogus");
  expect(createViewPref(storage).get()).toBe("overview");
  off();
});

it("defaults to posters on a phone until a layout is chosen; the server still renders overview", () => {
  const storage = memory();
  const pref = createViewPref(storage, () => true);
  expect([pref.get(), pref.getServer()]).toEqual(["posters", "overview"]);
  pref.set("table");
  expect(createViewPref(storage, () => true).get()).toBe("table");
  expect(createViewPref(memory(), () => false).get()).toBe("overview");
});
