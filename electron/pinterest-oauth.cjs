const http = require("node:http");
const crypto = require("node:crypto");

const REDIRECT_URI = "http://localhost:53682/pinterest/callback";
const SCOPES = ["boards:read", "boards:write", "pins:read", "pins:write", "user_accounts:read"];

function html(message, ok) {
  const title = ok ? "ALIVO OS · Pinterest connected" : "ALIVO OS · Pinterest connection failed";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:Segoe UI,Arial,sans-serif;background:#9c1c31;color:#fffaf7;display:grid;place-items:center;min-height:100vh;margin:0}.card{max-width:620px;padding:32px;border:1px solid rgba(255,255,255,.25);border-radius:18px;background:rgba(76,8,24,.6)}h1{margin-top:0}p{line-height:1.5}</style></head><body><div class="card"><h1>${ok ? "Pinterest connected" : "Connection not completed"}</h1><p>${message}</p><p>You can close this browser tab and return to ALIVO OS.</p></div></body></html>`;
}

function startPinterestOAuth({ appId, appSecret, openExternal, complete, timeoutMs = 180000 }) {
  return new Promise((resolve) => {
    const state = crypto.randomBytes(32).toString("hex");
    let settled = false;
    const finish = (result, server) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (server) server.close();
      resolve(result);
    };

    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url || "/", REDIRECT_URI);
        if (url.pathname !== "/pinterest/callback") {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Not found");
          return;
        }
        const returnedState = url.searchParams.get("state") || "";
        const code = url.searchParams.get("code") || "";
        const error = url.searchParams.get("error") || url.searchParams.get("error_description") || "";
        if (returnedState !== state) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(html("The OAuth state did not match. No credential was stored.", false));
          finish({ state: "Security Validation Failed", message: "Pinterest OAuth state validation failed." }, server);
          return;
        }
        if (error || !code) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(html("Pinterest authorization was cancelled or did not return an authorization code.", false));
          finish({ state: "Authorization Cancelled", message: "Pinterest authorization did not return a code." }, server);
          return;
        }
        const result = await complete({ appId, appSecret, code, redirectUri: REDIRECT_URI });
        const ok = result?.state === "Connected";
        res.writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html(ok ? "Authorization succeeded and refreshable credentials were stored securely." : (result?.message || "Pinterest OAuth exchange failed."), ok));
        finish(result, server);
      } catch {
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html("ALIVO OS could not complete the local OAuth callback.", false));
        finish({ state: "Unavailable", message: "Pinterest OAuth callback failed." }, server);
      }
    });

    server.on("error", () => finish({ state: "Unavailable", message: `ALIVO OS could not open the local OAuth callback at ${REDIRECT_URI}.` }, server));
    server.listen(53682, "localhost", async () => {
      const url = new URL("https://www.pinterest.com/oauth/");
      url.searchParams.set("client_id", appId);
      url.searchParams.set("redirect_uri", REDIRECT_URI);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", SCOPES.join(","));
      url.searchParams.set("state", state);
      try {
        await openExternal(url.toString());
      } catch {
        finish({ state: "Unavailable", message: "The Pinterest authorization page could not be opened." }, server);
      }
    });

    const timer = setTimeout(() => finish({ state: "Timed Out", message: "Pinterest authorization timed out before the callback was received." }, server), timeoutMs);
  });
}

module.exports = { startPinterestOAuth, REDIRECT_URI, SCOPES };
