import { afterEach, expect, it, vi } from "vitest";
import { httpApi } from "./httpApi";

afterEach(() => vi.unstubAllGlobals());

it("every request carries a timeout signal, so a dead connection can't hang sync", async () => {
  const fetchMock = vi.fn(async () => new Response("[]", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await httpApi.library();
  const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
  expect(init.signal).toBeInstanceOf(AbortSignal);
});
