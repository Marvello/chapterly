import { expect, it } from "vitest";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, settingsStore } from "./settings";

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };

it("round-trips settings and falls back to defaults on missing, broken or throwing storage", () => {
  const s = memory();
  expect(loadSettings(s)).toEqual(DEFAULT_SETTINGS);
  saveSettings({ ...DEFAULT_SETTINGS, fontSize: 22 }, s);
  expect(loadSettings(s).fontSize).toBe(22);
  s.setItem("chapterly-reader-settings", "{");
  expect(loadSettings(s)).toEqual(DEFAULT_SETTINGS);
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  expect(loadSettings(broken)).toEqual(DEFAULT_SETTINGS);
  expect(() => saveSettings(DEFAULT_SETTINGS, broken)).not.toThrow();
});

it("settingsStore: server snapshot is the defaults; set() updates the client snapshot and notifies", () => {
  expect(settingsStore.getServer()).toEqual(DEFAULT_SETTINGS);
  let calls = 0;
  const off = settingsStore.subscribe(() => { calls++; });
  const next = { ...DEFAULT_SETTINGS, theme: "sepia" as const };
  settingsStore.set(next);
  expect(settingsStore.get()).toBe(next);
  expect(settingsStore.get()).toBe(settingsStore.get());   // stable snapshot between changes
  expect(calls).toBe(1);
  off();
});
