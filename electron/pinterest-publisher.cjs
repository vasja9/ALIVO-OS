const API_ROOTS = Object.freeze({
  sandbox: "https://api-sandbox.pinterest.com/v5",
  production: "https://api.pinterest.com/v5",
});

function classify(status) {
  if (status === 401) return "Authentication Required";
  if (status === 403) return "Permission Denied";
  if (status === 429) return "Rate Limited";
  return status >= 500 ? "Unavailable" : "Provider Error";
}

async function timedFetch(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timeout); }
}

async function api(environment, accessToken, path, options = {}) {
  const root = API_ROOTS[environment];
  if (!root) return { error: { state: "Configuration Invalid", message: "Unknown Pinterest publishing environment." } };
  const response = await timedFetch(`${root}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", ...(options.headers || {}) },
  });
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) return { error: { state: classify(response.status), statusCode: response.status, message: payload?.message || `Pinterest ${environment} returned HTTP ${response.status}.` } };
  return { payload };
}

function validate(input = {}, environment = "sandbox") {
  const boardName = String(input.boardName || "").trim();
  const title = String(input.title || "").trim();
  const description = String(input.description || "").trim();
  const link = String(input.link || "").trim();
  const imageUrl = String(input.imageUrl || "").trim();
  const altText = String(input.altText || "").trim();
  if (!boardName) return { error: `A Pinterest board name is required for ${environment} publishing.` };
  if (!title || title.length > 100) return { error: "Pin title is required and must be at most 100 characters." };
  if (description.length > 800) return { error: "Pin description must be at most 800 characters." };
  if (altText.length > 500) return { error: "Pin alt text must be at most 500 characters." };
  try { const u = new URL(imageUrl); if (u.protocol !== "https:") throw new Error(); } catch { return { error: "A public HTTPS image URL is required." }; }
  if (link) { try { const u = new URL(link); if (!["https:","http:"].includes(u.protocol)) throw new Error(); } catch { return { error: "Pin destination link is invalid." }; } }
  return { value: { boardName, title, description, link, imageUrl, altText } };
}

async function ensureBoard(environment, accessToken, boardName) {
  let bookmark;
  do {
    const params = new URLSearchParams({ page_size: "100" });
    if (bookmark) params.set("bookmark", bookmark);
    const listed = await api(environment, accessToken, `/boards?${params}`);
    if (listed.error) return listed;
    const match = (listed.payload?.items || []).find(board => String(board.name || "").trim().toLowerCase() === boardName.toLowerCase());
    if (match?.id) return { board: match, created: false };
    bookmark = listed.payload?.bookmark || undefined;
  } while (bookmark);

  const created = await api(environment, accessToken, "/boards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: boardName, privacy: "PUBLIC" }),
  });
  if (created.error) return created;
  return { board: created.payload, created: true };
}

function createPublicationCapture() {
  try {
    const electron = require("electron");
    const app = electron?.app;
    if (!app || typeof app.getPath !== "function") return null;
    const { createPinterestPublicationResults } = require("./pinterest-publication-results.cjs");
    return createPinterestPublicationResults(app);
  } catch { return null; }
}

function createPinterestPublisher({ getSandboxAccessToken, getProductionAccessToken, productionWriteEnabled = false } = {}) {
  const publicationResults = createPublicationCapture();
  async function create(input = {}, requestedEnvironment = "sandbox") {
    const environment = String(requestedEnvironment || "sandbox").toLowerCase();
    if (!API_ROOTS[environment]) return { state: "Configuration Invalid", message: "Pinterest publishing environment must be sandbox or production." };
    if (environment === "production" && productionWriteEnabled !== true) {
      return { state: "Production Locked", environment: "Production", message: "Pinterest Production WRITE is hard-locked until Standard access is approved and ALIVO OS production publishing is explicitly enabled." };
    }
    const checked = validate(input, environment);
    if (checked.error) return { state: "Configuration Invalid", message: checked.error };
    const getToken = environment === "production" ? getProductionAccessToken : getSandboxAccessToken;
    const accessToken = typeof getToken === "function" ? await getToken() : undefined;
    if (!accessToken) return { state: "Authentication Required", message: `Pinterest ${environment} token is not configured.` };
    const v = checked.value;
    try {
      const boardResult = await ensureBoard(environment, accessToken, v.boardName);
      if (boardResult.error) return boardResult.error;
      const boardId = boardResult.board?.id;
      if (!boardId) return { state: "Provider Error", message: `Pinterest ${environment} did not return a Board ID.` };
      const body = {
        board_id: boardId,
        title: v.title,
        description: v.description || undefined,
        link: v.link || undefined,
        alt_text: v.altText || undefined,
        media_source: { source_type: "image_url", url: v.imageUrl, is_standard: true },
      };
      const created = await api(environment, accessToken, "/pins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (created.error) return created.error;
      const payload = created.payload;
      const result = {
        state: "Published",
        environment: environment === "production" ? "Production" : "Sandbox",
        pinId: payload?.id,
        boardId: payload?.board_id || boardId,
        boardName: v.boardName,
        boardCreated: boardResult.created,
        sandboxBoardCreated: environment === "sandbox" ? boardResult.created : false,
        title: payload?.title || v.title,
        createdAt: payload?.created_at || new Date().toISOString(),
        link: payload?.link || v.link,
        message: `Pinterest ${environment === "production" ? "Production" : "Sandbox"} confirmed Pin creation.`,
      };
      if (publicationResults) await publicationResults.capture(result, input, environment === "sandbox" ? "sandbox-publisher" : "production-publisher");
      return result;
    } catch (error) {
      return { state: "Unavailable", message: error?.name === "AbortError" ? `Pinterest ${environment} Pin creation timed out.` : `Pinterest ${environment} Pin could not be created.` };
    }
  }

  return Object.freeze({
    create,
    capabilities: () => Object.freeze({ sandboxWrite: true, productionWrite: productionWriteEnabled === true, productionLocked: productionWriteEnabled !== true }),
  });
}

module.exports = { createPinterestPublisher, API_ROOTS };