// Copy of worker/src/sanitize.js (common-tech "copy, don't depend"); keep both on DOMPurify defaults.
// Used by the reader API to clean chapters stored before the worker sanitized them.
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";

const purify = createDOMPurify(new JSDOM("").window as unknown as Window & typeof globalThis);

export const sanitize = (html: string): string => purify.sanitize(html);
