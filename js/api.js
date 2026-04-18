import { state } from "./state.js";

const API_BASE_KEY = "project-hw-api-base";

function inferLocalApiBase() {
  const host = globalThis.location?.hostname;
  if (host === "127.0.0.1" || host === "localhost") {
    return "http://127.0.0.1:3000";
  }
  return "";
}

export function getApiBase() {
  const fromWindow = globalThis.HW_API_BASE;
  const fromStorage = globalThis.localStorage?.getItem(API_BASE_KEY);
  return String(fromWindow || fromStorage || inferLocalApiBase()).replace(/\/$/, "");
}

export function setApiBase(apiBase) {
  const value = String(apiBase || "").trim().replace(/\/$/, "");
  if (value) {
    globalThis.localStorage?.setItem(API_BASE_KEY, value);
  } else {
    globalThis.localStorage?.removeItem(API_BASE_KEY);
  }
  return getApiBase();
}

export function isApiEnabled() {
  return Boolean(getApiBase());
}

async function apiFetch(path, options = {}) {
  const base = getApiBase();
  if (!base) throw new Error("HW API is not configured");
  const response = await fetch(`${base}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || data.error || `API request failed: ${path}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function getAuthState() {
  if (!isApiEnabled()) return { status: "guest" };
  const data = await apiFetch("/auth/me");
  return data.auth || { status: "guest" };
}

export async function registerAccount({ email, password, displayName }) {
  return apiFetch("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, displayName })
  });
}

export async function loginAccount({ email, password }) {
  return apiFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

export async function logoutAccount() {
  return apiFetch("/auth/logout", {
    method: "POST",
    body: "{}"
  });
}

export function applyServerSnapshot(snapshot) {
  if (!snapshot?.playerState || !snapshot?.wallet) return false;
  const { playerState, wallet } = snapshot;
  state.player = {
    ...state.player,
    coin: wallet.coin,
    bling: wallet.bling,
    freeBling: wallet.freeBling,
    paidBling: wallet.paidBling,
    inventory: playerState.inventory || {},
    housing: playerState.housing || { slots: [null, null, null, null] },
    unlocks: playerState.unlocks || {},
    lifeSkills: playerState.lifeSkills || {},
    activityStats: playerState.activityStats || {},
    farmPlot: playerState.farmPlot || {}
  };
  return true;
}

export function buildServerSavePayload() {
  return {
    wallet: {
      coin: Number(state.player.coin || 0),
      freeBling: Number(state.player.freeBling || 0),
      paidBling: Number(state.player.paidBling || 0)
    },
    inventory: state.player.inventory,
    housing: state.player.housing,
    unlocks: state.player.unlocks,
    lifeSkills: state.player.lifeSkills,
    activityStats: state.player.activityStats,
    farmPlot: state.player.farmPlot
  };
}

export async function loadServerPlayerState() {
  if (!isApiEnabled()) return false;
  const auth = await getAuthState();
  if (auth.status !== "authenticated") return false;
  const snapshot = await apiFetch("/me/player-state");
  return applyServerSnapshot(snapshot);
}

export async function saveServerPlayerState() {
  if (!isApiEnabled()) return false;
  const auth = await getAuthState();
  if (auth.status !== "authenticated") return false;
  const snapshot = await apiFetch("/me/player-state", {
    method: "PUT",
    body: JSON.stringify(buildServerSavePayload())
  });
  return applyServerSnapshot(snapshot);
}

export async function restoreServerState() {
  if (!isApiEnabled()) return false;
  const snapshot = await apiFetch("/me/restore", { method: "POST", body: "{}" });
  return applyServerSnapshot(snapshot);
}

export async function listServerProducts() {
  if (!isApiEnabled()) return [];
  const data = await apiFetch("/products");
  return data.products || [];
}

export async function checkoutServerProduct(productId) {
  const idempotencyKey = globalThis.crypto?.randomUUID?.() || `checkout-${Date.now()}-${Math.random()}`;
  const data = await apiFetch("/payments/checkout", {
    method: "POST",
    body: JSON.stringify({ productId, idempotencyKey })
  });
  return data.purchase;
}

export async function completeMockPurchase(purchase) {
  const data = await apiFetch("/payments/mock/complete", {
    method: "POST",
    body: JSON.stringify({
      purchaseId: purchase.purchaseId,
      mockPaymentToken: purchase.mockPaymentToken
    })
  });
  applyServerSnapshot(data);
  return data.purchase;
}
