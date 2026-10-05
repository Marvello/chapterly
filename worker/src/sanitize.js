// Chapter HTML is shown in the reader as stored, so it's cleaned before it reaches the DB.
// web/lib/sanitize.ts is the web app's copy (common-tech "copy, don't depend"); keep both on DOMPurify defaults.
"use strict";
const createDOMPurify = require("dompurify");
const { JSDOM } = require("jsdom");

const purify = createDOMPurify(new JSDOM("").window);
const sanitize = html => purify.sanitize(html);

module.exports = { sanitize };
