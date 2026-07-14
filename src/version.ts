// Single source of truth for the package version within the codebase.
// Keep this in sync with `version` in package.json.
// Imported by the server handshake and the User-Agent header so they can't drift.
export const VERSION = "0.1.0";
