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

    if ((url.pathname === "/" || url.pathname === "/index.html") && request.method === "GET") {
      const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Blue Essentials | Account Access</title><style>
      *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f1f5fb;font:15px system-ui;color:#17243b;padding:20px}.card{width:min(100%,440px);background:white;border:1px solid #e1e8f2;border-radius:18px;padding:30px;box-shadow:0 12px 40px #102b5c12}.brand{font-weight:800;color:#102b5c;letter-spacing:.5px}.muted{color:#718096;font-size:13px;line-height:1.5}h1{font-size:23px;margin:22px 0 8px}label{display:block;font-size:12px;font-weight:650;margin:14px 0 6px}input{width:100%;padding:12px;border:1px solid #d8e1ed;border-radius:9px;font:inherit}button{width:100%;margin-top:20px;padding:13px;border:0;border-radius:9px;background:#1767b2;color:white;font-weight:700;cursor:pointer}button:disabled{opacity:.6}.message{margin-top:14px;font-size:13px;color:#a33;line-height:1.5}.hint{font-size:11px;color:#718096;margin-top:12px}</style></head><body><main class="card"><div class="brand">BLUE ESSENTIALS COMPANY</div><div id="app"><p class="muted">Checking account setup…</p></div></main><script>
      const app=document.getElementById('app');
      const field=(label,name,type='text',extra='')=>'<label>'+label+'</label><input name="'+name+'" type="'+type+'" '+extra+' required>';
      function showSetup(){app.innerHTML='<h1>Create administrator</h1><p class="muted">Set up the first administrator account for your store.</p><form id="setup">'+field('Full name','fullName')+field('Email address','email','email')+field('Password (at least 12 characters)','password','password','minlength="12"')+field('Setup authorization secret','setupSecret','password')+'<button>Create administrator</button><div class="hint">Enter the setup secret you created in Cloudflare. Do not share it with anyone.</div><div class="message" id="msg"></div></form>';document.getElementById('setup').onsubmit=async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.target));const btn=e.target.querySelector('button');btn.disabled=true;try{const r=await fetch('/api/auth/setup-admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const d=await r.json();if(!r.ok)throw Error(d.error||'Setup failed');showLogin('Administrator created. Sign in below.')}catch(err){document.getElementById('msg').textContent=err.message;btn.disabled=false}}}
      function showLogin(note=''){app.innerHTML='<h1>Sign in</h1><p class="muted">Access your Blue Essentials store workspace.</p><form id="login">'+field('Email address','email','email')+field('Password','password','password')+'<button>Sign in</button><div class="message" id="msg">'+note+'</div></form>';document.getElementById('login').onsubmit=async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.target));const btn=e.target.querySelector('button');btn.disabled=true;try{const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const d=await r.json();if(!r.ok)throw Error(d.error||'Sign in failed');location.reload()}catch(err){document.getElementById('msg').textContent=err.message;btn.disabled=false}}}
      fetch('/api/auth/setup-status',{cache:'no-store'}).then(r=>r.json()).then(d=>{if(d.needsAdminSetup)showSetup();else showLogin()}).catch(()=>{app.innerHTML='<p class="message">Could not check account setup. Refresh this page.</p>'});
      </script></body></html>`;
      return new Response(page, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }

    if (url.pathname === "/api/health") {
      return json({
        app: "Blue Essentials Company",
        status: "online",
        database: env.DB ? "configured" : "not-configured",
        release: "github-auth-routes-2026-11-14"
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
      const createdAdmin = await env.DB.prepare(
        "SELECT id FROM users WHERE email = ?"
      ).bind(email).first();
      if (createdAdmin?.id) {
        await env.DB.prepare(
          "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES (?, 'admin_setup', 'users', ?, 'Initial administrator account created')"
        ).bind(createdAdmin.id, createdAdmin.id).run();
      }
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
