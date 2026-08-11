const API_ROOT = "https://api-sandbox.pinterest.com/v5";

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

async function api(accessToken, path, options = {}) {
  const response = await timedFetch(`${API_ROOT}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", ...(options.headers || {}) },
  });
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) return { error: { state: classify(response.status), statusCode: response.status, message: payload?.message || `Pinterest Sandbox returned HTTP ${response.status}.` } };
  return { payload };
}

function validate(input = {}) {
  const boardName = String(input.boardName || "").trim();
  const title = String(input.title || "").trim();
  const description = String(input.description || "").trim();
  const link = String(input.link || "").trim();
  const imageUrl = String(input.imageUrl || "").trim();
  const altText = String(input.altText || "").trim();
  if (!boardName) return { error: "A Pinterest board name is required for Sandbox publishing." };
  if (!title || title.length > 100) return { error: "Pin title is required and must be at most 100 characters." };
  if (description.length > 800) return { error: "Pin description must be at most 800 characters." };
  if (altText.length > 500) return { error: "Pin alt text must be at most 500 characters." };
  try { const u = new URL(imageUrl); if (u.protocol !== "https:") throw new Error(); } catch { return { error: "A public HTTPS image URL is required." }; }
  if (link) { try { const u = new URL(link); if (!["https:","http:"].includes(u.protocol)) throw new Error(); } catch { return { error: "Pin destination link is invalid." }; } }
  return { value: { boardName, title, description, link, imageUrl, altText } };
}

async function ensureSandboxBoard(accessToken, boardName) {
  let bookmark;
  do {
    const params = new URLSearchParams({ page_size: "100" });
    if (bookmark) params.set("bookmark", bookmark);
    const listed = await api(accessToken, `/boards?${params}`);
    if (listed.error) return listed;
    const match = (listed.payload?.items || []).find(board => String(board.name || "").trim().toLowerCase() === boardName.toLowerCase());
    if (match?.id) return { board: match, created: false };
    bookmark = listed.payload?.bookmark || undefined;
  } while (bookmark);

  const created = await api(accessToken, "/boards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: boardName, privacy: "PUBLIC" }),
  });
  if (created.error) return created;
  return { board: created.payload, created: true };
}

function createPinterestPublisher(getSandboxAccessToken) {
  async function create(input = {}) {
    const checked = validate(input);
    if (checked.error) return { state: "Configuration Invalid", message: checked.error };
    const accessToken = await getSandboxAccessToken();
    if (!accessToken) return { state: "Authentication Required", message: "Pinterest Sandbox token is not configured. Add it in Pinterest Authentication first." };
    const v = checked.value;
    try {
      const boardResult = await ensureSandboxBoard(accessToken, v.boardName);
      if (boardResult.error) return boardResult.error;
      const boardId = boardResult.board?.id;
      if (!boardId) return { state: "Provider Error", message: "Pinterest Sandbox did not return a Board ID." };
      const body = {
        board_id: boardId,
        title: v.title,
        description: v.description || undefined,
        link: v.link || undefined,
        alt_text: v.altText || undefined,
        media_source: { source_type: "image_url", url: v.imageUrl, is_standard: true },
      };
      const created = await api(accessToken, "/pins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (created.error) return created.error;
      const payload = created.payload;
      return {
        state: "Published",
        environment: "Sandbox",
        pinId: payload?.id,
        boardId: payload?.board_id || boardId,
        boardName: v.boardName,
        sandboxBoardCreated: boardResult.created,
        title: payload?.title || v.title,
        createdAt: payload?.created_at || new Date().toISOString(),
        link: payload?.link || v.link,
        message: "Pinterest Sandbox confirmed Pin creation.",
      };
    } catch (error) {
      return { state: "Unavailable", message: error?.name === "AbortError" ? "Pinterest Sandbox Pin creation timed out." : "Pinterest Sandbox Pin could not be created." };
    }
  }
  return Object.freeze({ create });
}

module.exports = { createPinterestPublisher };
