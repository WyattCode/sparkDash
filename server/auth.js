import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import os from "node:os";

export function configuredToken() {
  const token = process.env.SPARKDASH_TOKEN || process.env.DASHBOARD_TOKEN || "";
  return token.trim();
}

export function isLoopbackBind(host) {
  return host === "localhost" || host === "::1" || /^127\./.test(host);
}

export function requireRemoteAuth(bindHost) {
  return !isLoopbackBind(bindHost);
}

/** Unset/empty/"1" allow a tokenless remote bind. Set "0" to fail closed. */
export function allowOpenRemote() {
  const v = process.env.SPARKDASH_ALLOW_OPEN_REMOTE;
  if (v == null || v === "") return true;
  return v === "1";
}

export function authMode(bindHost, token = Boolean(configuredToken()), openRemote = allowOpenRemote()) {
  return token ? 'bearer' : requireRemoteAuth(bindHost) ? (openRemote ? 'remote-open' : 'required-missing') : 'loopback-open';
}

/** This machine's own name, without the `.local` macOS appends to it. */
const SELF_NAME = os.hostname().toLowerCase().replace(/\.local$/, "");

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Names that only reach this machine: neither a DNS-rebinding page nor another site can use them. */
function isOwnName(name) {
  if (name === "localhost" || name.endsWith(".localhost") || name === "[::1]") return true;
  if (isIP(name) === 4 && name.startsWith("127.")) return true;
  if (name === SELF_NAME || name === `${SELF_NAME}.local`) return true;
  const extra = (process.env.SPARKDASH_ALLOWED_HOSTS || "").split(",");
  return extra.some((h) => parseUrl(`http://${h.trim()}`)?.hostname === name);
}

/** A rebinding page has to use the attacker's own name, so any IP literal is a safe Host too. */
function isAllowedHost(name) {
  return isOwnName(name) || isIP(name.replace(/^\[(.*)\]$/, "$1")) !== 0;
}

/**
 * On a loopback bind, the name a browser request is refused for, or "" to let it through.
 * Origin must match the request's own Host (same-origin) or be one of our own names, for a
 * proxy that rewrites Host to 127.0.0.1. A request without Host or Origin is not a browser's.
 */
function refusedName(req) {
  if (requireRemoteAuth(process.env.BIND_HOST || "127.0.0.1")) return "";
  // Neither a rebinding page nor another site can know the token.
  if (configuredToken() && authenticate(req).ok) return "";
  const { host, origin } = req.headers || {};
  const hostUrl = host ? parseUrl(`http://${host}`) : null;
  if (host && !(hostUrl && isAllowedHost(hostUrl.hostname))) return hostUrl?.hostname || String(host).slice(0, 100);
  if (!origin) return "";
  const originUrl = parseUrl(origin);
  if (originUrl && (originUrl.host === hostUrl?.host || isOwnName(originUrl.hostname))) return "";
  return originUrl?.hostname || String(origin).slice(0, 100);
}

const refusedLoggedAt = new Map();

/** Name the refused host at most once an hour, so the operator sees exactly what to allow. */
function logRefused(name) {
  const now = Date.now();
  if (now - (refusedLoggedAt.get(name) ?? -Infinity) < 60 * 60 * 1000) return;
  if (refusedLoggedAt.size >= 100) refusedLoggedAt.clear();
  refusedLoggedAt.set(name, now);
  console.warn(
    `[sparkDash] refused a request for ${JSON.stringify(name)} on a loopback bind. If that is how you reach this dashboard, add it to SPARKDASH_ALLOWED_HOSTS.`
  );
}

function refuse(req, res, name) {
  logRefused(name);
  if (req.method === "GET" && /text\/html/.test(req.headers?.accept || "")) {
    const shown = name.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    return res
      .status(403)
      .type("html")
      .send(
        `<!doctype html><meta charset="utf-8"><title>SparkDash：访问来源未获许可</title><p>当前访问来源 <b>${shown}</b> 未获许可。</p>` +
          `<p>如通过自定义域名或反向代理访问，请将可信域名加入 <code>SPARKDASH_ALLOWED_HOSTS</code>（多个域名用逗号分隔），然后重启面板。</p>`
      );
  }
  return res.status(403).json({ error: `访问来源 ${name} 未获许可；如为可信面板域名，请配置 SPARKDASH_ALLOWED_HOSTS` });
}

function tokensEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function extractBearer(req) {
  const header = req.headers?.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (match) return match[1].trim();
  // WebSocket upgrades are raw IncomingMessage objects, without Express query.
  let query = req.query?.token;
  if (query === undefined && typeof req.url === "string") {
    try { query = new URL(req.url, "http://localhost").searchParams.get("token"); }
    catch { /* Malformed URLs must not crash the upgrade handler. */ }
  }
  return typeof query === "string" ? query.trim() : "";
}

export function authenticate(req) {
  const expected = configuredToken();
  if (!expected) {
    const mode = authMode(process.env.BIND_HOST || '127.0.0.1');
    if (mode === 'required-missing') return {ok:false,status:403,error:'Remote access requires SPARKDASH_TOKEN'};
    return { ok: true, mode };
  }
  const provided = extractBearer(req);
  if (!provided || !tokensEqual(provided, expected)) {
    return { ok: false, status: 401, error: "Authentication required" };
  }
  return { ok: true, mode: "bearer" };
}

export function createAuthMiddleware() {
  return function authMiddleware(req, res, next) {
    const refused = refusedName(req);
    if (refused) return refuse(req, res, refused);
    const method = (req.method || "GET").toUpperCase();
    const mutating = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
    const remote = requireRemoteAuth(process.env.BIND_HOST || "127.0.0.1");
    if (!mutating && !remote && !configuredToken()) return next();
    if (!mutating && !remote) return next();
    if (!mutating && remote && !configuredToken()) {
      if (allowOpenRemote()) return next();
      return res.status(403).json({ error: "Remote access requires SPARKDASH_TOKEN" });
    }
    const result = authenticate(req);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    next();
  };
}

export function authorizeUpgrade(req) {
  const refused = refusedName(req);
  if (refused) {
    logRefused(refused);
    return false;
  }
  const remote = requireRemoteAuth(process.env.BIND_HOST || "127.0.0.1");
  if (!remote && !configuredToken()) return true;
  return authenticate(req).ok;
}
