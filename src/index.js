const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });

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

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "The application API is not configured yet." }, 503);
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Blue Essentials Company — frontend assets are not configured.", { status: 503 });
  }
};
