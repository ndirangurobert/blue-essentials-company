const json = (data, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders
    }
  });

const COOKIE_NAME = "blue_essentials_session";
const SESSION_SECONDS = 60 * 60 * 24;

const bytesToBase64 = (bytes) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const base64ToBytes = (value) =>
  Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

const randomToken = (length = 32) => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const sha256 = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64(new Uint8Array(digest));
};

const hashPassword = async (password) => {
  const iterations = 210000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256
  );
  return `pbkdf2$${iterations}$${bytesToBase64(salt)}$${bytesToBase64(new Uint8Array(bits))}`;
};

const verifyPassword = async (password, stored) => {
  try {
    const [algorithm, iterationsText, saltText, expectedText] = stored.split("$");
    if (algorithm !== "pbkdf2") return false;
    const iterations = Number(iterationsText);
    if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 1000000) return false;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: base64ToBytes(saltText), iterations },
      key,
      256
    );
    const actual = new Uint8Array(bits);
    const expected = base64ToBytes(expectedText);
    if (actual.length !== expected.length) return false;
    let difference = 0;
    for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ expected[i];
    return difference === 0;
  } catch {
    return false;
  }
};

const getCookie = (request, name) => {
  const header = request.headers.get("Cookie") || "";
  const item = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(name + "="));
  return item ? item.slice(name.length + 1) : null;
};

const sessionCookie = (token, maxAge = SESSION_SECONDS) =>
  `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

const clearSessionCookie = () =>
  `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

const readJson = async (request) => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

const getCurrentUser = async (request, env) => {
  const token = getCookie(request, COOKIE_NAME);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.full_name, u.email, u.role, u.active
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP AND u.active = 1`
  ).bind(tokenHash).first();
  return row || null;
};

const requireMethod = (request, method) =>
  request.method === method
    ? null
    : json({ error: "Method not allowed." }, 405, { Allow: method });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        app: "Blue Essentials Company",
        status: "online",
        database: env.DB ? "configured" : "not-configured"
      });
    }

    if (url.pathname === "/api/auth/setup-status") {
      if (!env.DB) return json({ error: "Database is not configured." }, 503);
      const row = await env.DB.prepare(
        "SELECT COUNT(*) AS total FROM users WHERE role = 'admin'"
      ).first();
      return json({ needsAdminSetup: Number(row?.total || 0) === 0 });
    }

    if (url.pathname === "/api/auth/setup-admin") {
      const methodError = requireMethod(request, "POST");
      if (methodError) return methodError;
      if (!env.DB || !env.SETUP_SECRET) {
        return json({ error: "Administrator setup is not configured. Add the SETUP_SECRET Worker secret first." }, 503);
      }
      const body = await readJson(request);
      if (!body || body.setupSecret !== env.SETUP_SECRET) {
        return json({ error: "Invalid setup authorization." }, 403);
      }
      const fullName = String(body.fullName || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      if (fullName.length < 2 || fullName.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json({ error: "Enter a valid name and email address." }, 400);
      }
      if (password.length < 12 || password.length > 128) {
        return json({ error: "Use a password between 12 and 128 characters." }, 400);
      }
      const existing = await env.DB.prepare(
        "SELECT COUNT(*) AS total FROM users WHERE role = 'admin'"
      ).first();
      if (Number(existing?.total || 0) > 0) {
        return json({ error: "Administrator setup has already been completed." }, 409);
      }
      const passwordHash = await hashPassword(password);
      try {
        await env.DB.prepare(
          "INSERT INTO users (full_name, email, password_hash, role, active) VALUES (?, ?, ?, 'admin', 1)"
        ).bind(fullName, email, passwordHash).run();
      } catch {
        return json({ error: "Could not create administrator. Check whether the email is already registered." }, 409);
      }
      await env.DB.prepare(
        "INSERT INTO audit_logs (user_id, action, entity_type, details) VALUES (last_insert_rowid(), 'admin_setup', 'users', 'Initial administrator account created')"
      ).run();
      return json({ success: true, message: "Administrator account created. You can now sign in." }, 201);
    }

    if (url.pathname === "/api/auth/login") {
      const methodError = requireMethod(request, "POST");
      if (methodError) return methodError;
      if (!env.DB) return json({ error: "Database is not configured." }, 503);
      const body = await readJson(request);
      const email = String(body?.email || "").trim().toLowerCase();
      const password = String(body?.password || "");
      if (!email || !password) return json({ error: "Enter your email and password." }, 400);
      const user = await env.DB.prepare(
        "SELECT id, full_name, email, password_hash, role, active FROM users WHERE email = ?"
      ).bind(email).first();
      if (!user || Number(user.active) !== 1 || !(await verifyPassword(password, user.password_hash))) {
        return json({ error: "Email or password is incorrect." }, 401);
      }
      const token = randomToken();
      const tokenHash = await sha256(token);
      const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
      await env.DB.prepare(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)"
      ).bind(tokenHash, user.id, expiresAt).run();
      await env.DB.prepare(
        "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES (?, 'login', 'users', ?, 'Successful sign-in')"
      ).bind(user.id, user.id).run();
      return json({
        success: true,
        user: { id: user.id, fullName: user.full_name, email: user.email, role: user.role }
      }, 200, { "Set-Cookie": sessionCookie(token) });
    }

    if (url.pathname === "/api/auth/me") {
      if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
      const user = await getCurrentUser(request, env);
      if (!user) return json({ authenticated: false }, 401);
      return json({
        authenticated: true,
        user: { id: user.id, fullName: user.full_name, email: user.email, role: user.role }
      });
    }

    if (url.pathname === "/api/auth/logout") {
      const methodError = requireMethod(request, "POST");
      if (methodError) return methodError;
      const token = getCookie(request, COOKIE_NAME);
      if (token && env.DB) {
        await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
      }
      return json({ success: true }, 200, { "Set-Cookie": clearSessionCookie() });
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "This API endpoint is not available yet." }, 404);
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Blue Essentials Company — frontend assets are not configured.", { status: 503 });
  }
};
