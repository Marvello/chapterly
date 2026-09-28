// One JSON line per security event (common-tech security.md #18). Never pass passwords or tokens.
"use strict";
const logSecurity = (event, fields = {}) =>
    console.log(JSON.stringify({ type: "security", event, ...fields, at: new Date().toISOString() }));
module.exports = { logSecurity };
