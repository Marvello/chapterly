-- Hostnames (no www.) that have a dedicated WebToEpub parser. Written by the worker at startup,
-- read by the web form to reject unsupported URLs before they are added.
CREATE TABLE supported_sites (
    host TEXT PRIMARY KEY
);
