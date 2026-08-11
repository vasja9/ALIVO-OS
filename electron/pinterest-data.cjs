const API_ROOT = "https://api.pinterest.com/v5";

function classify(status) {
  if (status === 401) return "Authentication Required";
  if (status === 403) return "Permission Denied";
  if (status === 429) return "Rate Limited";
  return status >= 500 ? "Unavailable" : "Provider Error";
}

async function timedFetch(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function apiGet(path, accessToken) {
  const response = await timedFetch(`${API_ROOT}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  let payload;
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) {
    const error = new Error(`Pinterest API returned HTTP ${response.status}.`);
    error.state = classify(response.status);
    error.statusCode = response.status;
    throw error;
  }
  return {
    payload,
    rateLimit: {
      limit: response.headers.get("x-ratelimit-limit") || undefined,
      remaining: response.headers.get("x-ratelimit-remaining") || undefined,
      reset: response.headers.get("x-ratelimit-reset") || undefined,
    },
  };
}

async function listPage(path, accessToken, pageSize = 50) {
  const separator = path.includes("?") ? "&" : "?";
  return apiGet(`${path}${separator}page_size=${pageSize}`, accessToken);
}

function safeBoard(board = {}) {
  return {
    id: board.id,
    name: board.name,
    description: board.description || "",
    privacy: board.privacy,
    pinCount: board.pin_count,
    followerCount: board.follower_count,
    createdAt: board.created_at,
  };
}

function safePin(pin = {}) {
  return {
    id: pin.id,
    title: pin.title || "",
    description: pin.description || "",
    boardId: pin.board_id,
    createdAt: pin.created_at,
    link: pin.link || "",
    dominantColor: pin.dominant_color,
    altText: pin.alt_text || "",
  };
}

function safeAccount(account = {}) {
  return {
    username: account.username,
    businessName: account.business_name,
    accountType: account.account_type,
    profileImage: account.profile_image,
    websiteUrl: account.website_url,
    followerCount: account.follower_count,
    followingCount: account.following_count,
    monthlyViews: account.monthly_views,
  };
}

function createPinterestDataCollector(getAccessToken) {
  async function snapshot() {
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        return { state: "Authentication Required", message: "Pinterest does not have a usable access token." };
      }

      const [accountResult, boardsResult, pinsResult] = await Promise.all([
        apiGet("/user_account", accessToken),
        listPage("/boards", accessToken),
        listPage("/pins", accessToken),
      ]);

      const boards = Array.isArray(boardsResult.payload?.items) ? boardsResult.payload.items.map(safeBoard) : [];
      const pins = Array.isArray(pinsResult.payload?.items) ? pinsResult.payload.items.map(safePin) : [];

      return {
        state: "Connected",
        collectedAt: new Date().toISOString(),
        account: safeAccount(accountResult.payload),
        boards,
        pins,
        counts: { boards: boards.length, pins: pins.length },
        partial: Boolean(boardsResult.payload?.bookmark || pinsResult.payload?.bookmark),
        rateLimit: pinsResult.rateLimit || boardsResult.rateLimit || accountResult.rateLimit,
      };
    } catch (error) {
      return {
        state: error?.state || "Unavailable",
        statusCode: error?.statusCode,
        message: error?.name === "AbortError" ? "Pinterest data request timed out." : (error?.message || "Pinterest data could not be collected."),
      };
    }
  }

  return Object.freeze({ snapshot });
}

module.exports = { createPinterestDataCollector };
