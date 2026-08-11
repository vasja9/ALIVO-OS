const API_ROOT = "https://api.pinterest.com/v5";

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

function validate(input = {}) {
  const boardId = String(input.boardId || "").trim();
  const title = String(input.title || "").trim();
  const description = String(input.description || "").trim();
  const link = String(input.link || "").trim();
  const imageUrl = String(input.imageUrl || "").trim();
  const altText = String(input.altText || "").trim();
  if (!/^\d+$/.test(boardId)) return { error: "A valid Pinterest Board ID is required." };
  if (!title || title.length > 100) return { error: "Pin title is required and must be at most 100 characters." };
  if (description.length > 800) return { error: "Pin description must be at most 800 characters." };
  if (altText.length > 500) return { error: "Pin alt text must be at most 500 characters." };
  try { const u = new URL(imageUrl); if (u.protocol !== "https:") throw new Error(); } catch { return { error: "A public HTTPS image URL is required." }; }
  if (link) { try { const u = new URL(link); if (!['https:','http:'].includes(u.protocol)) throw new Error(); } catch { return { error: "Pin destination link is invalid." }; } }
  return { value: { boardId, title, description, link, imageUrl, altText } };
}

function createPinterestPublisher(getAccessToken) {
  async function create(input = {}) {
    const checked = validate(input);
    if (checked.error) return { state: "Configuration Invalid", message: checked.error };
    const accessToken = await getAccessToken();
    if (!accessToken) return { state: "Authentication Required", message: "Pinterest does not have a usable access token." };
    const v = checked.value;
    const body = {
      board_id: v.boardId,
      title: v.title,
      description: v.description || undefined,
      link: v.link || undefined,
      alt_text: v.altText || undefined,
      media_source: { source_type: "image_url", url: v.imageUrl, is_standard: true },
    };
    try {
      const response = await timedFetch(`${API_ROOT}/pins`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      let payload = {};
      try { payload = await response.json(); } catch {}
      if (!response.ok) return { state: classify(response.status), statusCode: response.status, message: payload?.message || `Pinterest create Pin returned HTTP ${response.status}.` };
      return {
        state: "Published",
        pinId: payload?.id,
        boardId: payload?.board_id || v.boardId,
        title: payload?.title || v.title,
        createdAt: payload?.created_at || new Date().toISOString(),
        link: payload?.link || v.link,
        message: "Pinterest confirmed Pin creation.",
      };
    } catch (error) {
      return { state: "Unavailable", message: error?.name === "AbortError" ? "Pinterest Pin creation timed out." : "Pinterest Pin could not be created." };
    }
  }
  return Object.freeze({ create });
}

module.exports = { createPinterestPublisher };
