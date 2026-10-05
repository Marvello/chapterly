// "Can we reach the server?" for useSyncExternalStore: the device has a network (navigator.onLine) AND
// the last sync got an answer. A self-hosted server can be unreachable while the phone is online (server
// or tunnel down, VPN off), and then the online-only parts of the UI would just fail.
// The server renders "online" (it had to answer to serve the page); the client corrects it after hydration.
let reachable = true;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(l => l());

export const online = {
  subscribe(cb: () => void) {
    listeners.add(cb);
    if (typeof window !== "undefined") {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
    }
    return () => {
      listeners.delete(cb);
      if (typeof window !== "undefined") {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      }
    };
  },
  get: () => navigator.onLine && reachable,
  getServer: () => true,
  /** Called with each sync's outcome. */
  setReachable(v: boolean) {
    if (v === reachable) return;
    reachable = v;
    notify();
  },
};
