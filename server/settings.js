import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { atomicWrite } from "./util/atomicWrite.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const SETTINGS_PATH =
  process.env.SETTINGS_JSON_PATH || path.join(ROOT, "config", "settings.json");

const DEFAULTS = Object.freeze({
  pollIntervalMs: 2000,
  defaultLlmPort: 8888,
  autoHideOffline: false,
  /** Hide worker-role Sparks from Overview and the tab bar. */
  hideWorkers: false,
  temperatureUnit: "celsius",
  /** Persist prompts / HTTP traces / GPU samples on decode benchmark runs. */
  benchDebugTraces: false,
  /** Layout density — compact (default) or comfortable. */
  density: "compact",
  /** Overview Fleet Energy card. Off by default. */
  showFleetEnergy: false,
  /** Overview active fleet exceptions strip. Off by default. */
  showFleetExceptions: false,
  /** Overview search + status filter row. Off by default. */
  showOverviewSearch: false,
  /**
   * Benchmark dialogs offer the share-card format. On by default: the extra
   * control is one caret next to a button that already copies, and anyone who
   * does not want it can turn it off here (see the README's settings table).
   */
  benchShareImage: true,
});

/** @type {typeof DEFAULTS} */
let _settings = { ...DEFAULTS };

function _clampSettings(settings) {
  const s = Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, settings[key]]));
  // Clamp poll interval to 1000ms minimum
  s.pollIntervalMs = Number.isFinite(s.pollIntervalMs)
    ? Math.min(2147483647, Math.max(1000, Math.trunc(s.pollIntervalMs)))
    : DEFAULTS.pollIntervalMs;
  // Clamp LLM port to 1–65535
  if (!Number.isInteger(s.defaultLlmPort) || s.defaultLlmPort < 1 || s.defaultLlmPort > 65535) {
    s.defaultLlmPort = DEFAULTS.defaultLlmPort;
  }
  // Ensure autoHideOffline is boolean
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    if (typeof fallback === "boolean" && typeof s[key] !== "boolean") s[key] = fallback;
  }
  // Ensure temperatureUnit is valid
  if (s.temperatureUnit !== "celsius" && s.temperatureUnit !== "fahrenheit") {
    s.temperatureUnit = DEFAULTS.temperatureUnit;
  }
  // Ensure density is valid
  if (s.density !== "comfortable" && s.density !== "compact") {
    s.density = DEFAULTS.density;
  }
  return s;
}

/** Load settings from disk, falling back to defaults. */
export function loadSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    _settings = _clampSettings({ ...DEFAULTS, ...parsed });
  } catch (err) {
    if (err.code === "ENOENT") {
      _settings = { ...DEFAULTS };
      saveSettings();
    } else {
      console.error("[settings] Failed to load settings.json:", err.message);
      _settings = { ...DEFAULTS };
    }
  }
  return { ..._settings };
}

/** Persist current settings to disk. */
export function saveSettings(settings = _settings) {
  // Failed replacement leaves the existing file intact.
  atomicWrite(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n", 0o644);
}

/** Get current settings (clamped). */
export function getSettings() {
  return { ..._settings };
}

/**
 * Apply a partial patch, persist, and return the new settings.
 * @param {Partial<typeof DEFAULTS>} patch
 * @returns {typeof DEFAULTS}
 */
export function updateSettings(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("设置必须是一个对象");
  }
  const merged = _clampSettings({ ..._settings, ...patch });
  // Commit in memory only after persistence succeeds.
  saveSettings(merged);
  _settings = merged;
  return { ..._settings };
}
