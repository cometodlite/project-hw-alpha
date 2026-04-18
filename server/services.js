import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { DEFAULT_PLAYER_SAVE, DEFAULT_WALLET } from "./defaults.js";
import { decodeJson, encodeJson, nowIso } from "./db.js";

const PRODUCTS_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/products/sample-products.json");

export function makeId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

export function makePublicUserCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "HW-";
  for (let i = 0; i < 8; i += 1) {
    if (i === 4) code += "-";
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

export function createDefaultAccountRows(db, userId) {
  const now = nowIso();
  db.prepare(`
    INSERT INTO player_state (
      user_id, save_version, schema_version, inventory_json, housing_json, unlocks_json,
      life_skills_json, activity_stats_json, farm_plot_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    DEFAULT_PLAYER_SAVE.saveVersion,
    DEFAULT_PLAYER_SAVE.schemaVersion,
    encodeJson(DEFAULT_PLAYER_SAVE.inventory),
    encodeJson(DEFAULT_PLAYER_SAVE.housing),
    encodeJson(DEFAULT_PLAYER_SAVE.unlocks),
    encodeJson(DEFAULT_PLAYER_SAVE.lifeSkills),
    encodeJson(DEFAULT_PLAYER_SAVE.activityStats),
    encodeJson(DEFAULT_PLAYER_SAVE.farmPlot),
    now
  );
  db.prepare("INSERT INTO wallets (user_id, coin, free_bling, paid_bling, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(userId, DEFAULT_WALLET.coin, DEFAULT_WALLET.freeBling, DEFAULT_WALLET.paidBling, now);
}

export function getWallet(db, userId) {
  const row = db.prepare("SELECT * FROM wallets WHERE user_id = ?").get(userId);
  if (!row) return null;
  return {
    coin: row.coin,
    freeBling: row.free_bling,
    paidBling: row.paid_bling,
    bling: row.free_bling + row.paid_bling,
    updatedAt: row.updated_at
  };
}

export function getPlayerState(db, userId) {
  const row = db.prepare("SELECT * FROM player_state WHERE user_id = ?").get(userId);
  if (!row) return null;
  return {
    userId,
    saveVersion: row.save_version,
    schemaVersion: row.schema_version,
    inventory: decodeJson(row.inventory_json, {}),
    housing: decodeJson(row.housing_json, { slots: [null, null, null, null] }),
    unlocks: decodeJson(row.unlocks_json, {}),
    lifeSkills: decodeJson(row.life_skills_json, {}),
    activityStats: decodeJson(row.activity_stats_json, {}),
    farmPlot: decodeJson(row.farm_plot_json, {}),
    updatedAt: row.updated_at
  };
}

export function getPlayerSnapshot(db, userId) {
  return {
    playerState: getPlayerState(db, userId),
    wallet: getWallet(db, userId)
  };
}

export function updatePlayerState(db, userId, payload) {
  const run = db.transaction(() => {
    const current = getPlayerState(db, userId);
    if (!current) return null;
    const next = {
      inventory: payload.inventory ?? current.inventory,
      housing: payload.housing ?? current.housing,
      unlocks: payload.unlocks ?? current.unlocks,
      lifeSkills: payload.lifeSkills ?? current.lifeSkills,
      activityStats: payload.activityStats ?? current.activityStats,
      farmPlot: payload.farmPlot ?? current.farmPlot
    };
    const now = nowIso();
    db.prepare(`
      UPDATE player_state
      SET save_version = save_version + 1,
          inventory_json = ?,
          housing_json = ?,
          unlocks_json = ?,
          life_skills_json = ?,
          activity_stats_json = ?,
          farm_plot_json = ?,
          updated_at = ?
      WHERE user_id = ?
    `).run(
      encodeJson(next.inventory),
      encodeJson(next.housing),
      encodeJson(next.unlocks),
      encodeJson(next.lifeSkills),
      encodeJson(next.activityStats),
      encodeJson(next.farmPlot),
      now,
      userId
    );
    if (payload.wallet) {
      syncWalletFromClientSave(db, userId, payload.wallet, now);
    }
    return getPlayerSnapshot(db, userId);
  });
  return run();
}

function syncWalletFromClientSave(db, userId, walletPayload, timestamp) {
  const current = getWallet(db, userId);
  if (!current) throw new Error("Wallet not found");
  const syncId = makeId("save");
  const desired = {
    coin: Number(walletPayload.coin ?? current.coin),
    freeBling: Number(walletPayload.freeBling ?? current.freeBling),
    paidBling: Number(walletPayload.paidBling ?? current.paidBling)
  };
  for (const [currency, nextValue] of Object.entries(desired)) {
    if (!Number.isInteger(nextValue) || nextValue < 0) throw new Error(`Invalid wallet value: ${currency}`);
    const delta = nextValue - current[currency];
    if (delta === 0) continue;
    applyCurrencyChange(db, {
      userId,
      currency,
      delta,
      reason: "game_sync",
      sourceType: "game",
      sourceId: "client-save",
      idempotencyKey: `${syncId}:${timestamp}:${currency}`
    });
  }
}

function walletColumn(currency) {
  if (currency === "coin") return "coin";
  if (currency === "freeBling") return "free_bling";
  if (currency === "paidBling") return "paid_bling";
  throw new Error(`Unsupported currency: ${currency}`);
}

export function applyCurrencyChange(db, input) {
  const run = db.transaction(() => {
    const currency = input.currency;
    const column = walletColumn(currency);
    const existing = db.prepare(`
      SELECT * FROM currency_ledger
      WHERE user_id = ? AND currency = ? AND idempotency_key = ?
    `).get(input.userId, currency, input.idempotencyKey);
    if (existing) {
      return { idempotent: true, balanceAfter: existing.balance_after };
    }

    const wallet = db.prepare("SELECT * FROM wallets WHERE user_id = ?").get(input.userId);
    if (!wallet) throw new Error("Wallet not found");
    const current = wallet[column];
    const next = current + input.delta;
    if (next < 0) throw new Error("Insufficient currency balance");

    const now = nowIso();
    db.prepare(`UPDATE wallets SET ${column} = ?, updated_at = ? WHERE user_id = ?`).run(next, now, input.userId);
    db.prepare(`
      INSERT INTO currency_ledger (
        ledger_id, user_id, currency, delta, balance_after, reason,
        source_type, source_id, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      makeId("ledger"),
      input.userId,
      currency,
      input.delta,
      next,
      input.reason,
      input.sourceType,
      input.sourceId ?? null,
      input.idempotencyKey,
      now
    );
    return { idempotent: false, balanceAfter: next };
  });
  return run();
}

export function spendBling(db, input) {
  const amount = Number(input.amount || 0);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("Invalid bling amount");

  const run = db.transaction(() => {
    const wallet = db.prepare("SELECT * FROM wallets WHERE user_id = ?").get(input.userId);
    if (!wallet) throw new Error("Wallet not found");
    if (wallet.paid_bling + wallet.free_bling < amount) throw new Error("Insufficient bling balance");

    const existingPaid = db.prepare(`
      SELECT * FROM currency_ledger
      WHERE user_id = ? AND currency = 'paidBling' AND idempotency_key = ?
    `).get(input.userId, input.idempotencyKey);
    const existingFree = db.prepare(`
      SELECT * FROM currency_ledger
      WHERE user_id = ? AND currency = 'freeBling' AND idempotency_key = ?
    `).get(input.userId, input.idempotencyKey);
    if (existingPaid || existingFree) {
      return { idempotent: true, paidSpent: Math.abs(existingPaid?.delta || 0), freeSpent: Math.abs(existingFree?.delta || 0) };
    }

    const paidSpent = Math.min(wallet.paid_bling, amount);
    const freeSpent = amount - paidSpent;
    const paidAfter = wallet.paid_bling - paidSpent;
    const freeAfter = wallet.free_bling - freeSpent;
    const now = nowIso();
    db.prepare("UPDATE wallets SET paid_bling = ?, free_bling = ?, updated_at = ? WHERE user_id = ?")
      .run(paidAfter, freeAfter, now, input.userId);

    if (paidSpent > 0) {
      insertLedger(db, input, "paidBling", -paidSpent, paidAfter, now);
    }
    if (freeSpent > 0) {
      insertLedger(db, input, "freeBling", -freeSpent, freeAfter, now);
    }
    return { idempotent: false, paidSpent, freeSpent };
  });
  return run();
}

function insertLedger(db, input, currency, delta, balanceAfter, createdAt) {
  db.prepare(`
    INSERT INTO currency_ledger (
      ledger_id, user_id, currency, delta, balance_after, reason,
      source_type, source_id, idempotency_key, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    makeId("ledger"),
    input.userId,
    currency,
    delta,
    balanceAfter,
    input.reason,
    input.sourceType,
    input.sourceId ?? null,
    input.idempotencyKey,
    createdAt
  );
}

export function loadProducts() {
  return JSON.parse(fs.readFileSync(PRODUCTS_PATH, "utf8"));
}

export function isProductActive(product, now = new Date()) {
  if (!product.isActive) return false;
  if (product.saleStartAt && new Date(product.saleStartAt) > now) return false;
  if (product.saleEndAt && new Date(product.saleEndAt) < now) return false;
  return true;
}

export function listProducts({ includeInactive = false } = {}) {
  const products = loadProducts();
  return includeInactive ? products : products.filter((product) => isProductActive(product));
}

export function findProduct(productId, options = {}) {
  return listProducts(options).find((product) => product.productId === productId) || null;
}

export function createCheckout(db, userId, { productId, idempotencyKey }) {
  const product = findProduct(productId);
  if (!product) throw new Error("Product not available");
  const existing = db.prepare("SELECT * FROM purchases WHERE user_id = ? AND idempotency_key = ?").get(userId, idempotencyKey);
  if (existing) return purchaseResponse(existing);

  const now = nowIso();
  const purchaseId = makeId("purchase");
  const token = makeId("mock");
  db.prepare(`
    INSERT INTO purchases (
      purchase_id, user_id, product_id, provider, mock_payment_token, status,
      price, currency, idempotency_key, created_at, updated_at
    ) VALUES (?, ?, ?, 'mock_pg', ?, 'created', ?, ?, ?, ?, ?)
  `).run(purchaseId, userId, product.productId, token, product.price, product.currency, idempotencyKey, now, now);

  return purchaseResponse(db.prepare("SELECT * FROM purchases WHERE purchase_id = ?").get(purchaseId));
}

export function completeMockPayment(db, userId, { purchaseId, mockPaymentToken }) {
  const run = db.transaction(() => {
    const purchase = db.prepare("SELECT * FROM purchases WHERE purchase_id = ? AND user_id = ?").get(purchaseId, userId);
    if (!purchase) throw new Error("Purchase not found");
    if (purchase.mock_payment_token !== mockPaymentToken) throw new Error("Invalid mock payment token");
    if (purchase.status === "granted") return purchaseResponse(purchase);
    if (!["created", "paid", "granting", "grant_failed"].includes(purchase.status)) {
      throw new Error(`Cannot complete purchase in status ${purchase.status}`);
    }

    const now = nowIso();
    if (purchase.status === "created") {
      db.prepare(`
        UPDATE purchases
        SET status = 'paid', provider_transaction_id = ?, paid_at = ?, updated_at = ?
        WHERE purchase_id = ?
      `).run(makeId("mock_tx"), now, now, purchaseId);
    }
    db.prepare("UPDATE purchases SET status = 'granting', updated_at = ? WHERE purchase_id = ?").run(nowIso(), purchaseId);
    grantPurchase(db, purchaseId);
    return purchaseResponse(db.prepare("SELECT * FROM purchases WHERE purchase_id = ?").get(purchaseId));
  });
  return run();
}

export function grantPurchase(db, purchaseId) {
  const purchase = db.prepare("SELECT * FROM purchases WHERE purchase_id = ?").get(purchaseId);
  if (!purchase) throw new Error("Purchase not found");
  const product = findProduct(purchase.product_id, { includeInactive: true });
  if (!product) throw new Error("Product not found");

  const idempotencyKey = `grant:${purchase.purchase_id}:${purchase.product_id}`;
  const existing = db.prepare("SELECT * FROM grant_records WHERE idempotency_key = ?").get(idempotencyKey);
  if (existing?.status === "granted") {
    db.prepare("UPDATE purchases SET status = 'granted', granted_at = COALESCE(granted_at, ?), updated_at = ? WHERE purchase_id = ?")
      .run(nowIso(), nowIso(), purchaseId);
    return { idempotent: true };
  }

  const now = nowIso();
  const grantId = existing?.grant_id || makeId("grant");
  if (!existing) {
    db.prepare(`
      INSERT INTO grant_records (
        grant_id, user_id, purchase_id, product_id, reward_data_json,
        status, idempotency_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(grantId, purchase.user_id, purchase.purchase_id, product.productId, encodeJson(product.rewardData), idempotencyKey, now, now);
  }

  try {
    applyRewardData(db, purchase.user_id, purchase.purchase_id, product);
    db.prepare("UPDATE grant_records SET status = 'granted', updated_at = ? WHERE grant_id = ?").run(nowIso(), grantId);
    db.prepare("UPDATE purchases SET status = 'granted', granted_at = ?, updated_at = ? WHERE purchase_id = ?")
      .run(nowIso(), nowIso(), purchaseId);
    return { idempotent: false };
  } catch (error) {
    db.prepare("UPDATE grant_records SET status = 'failed', updated_at = ? WHERE grant_id = ?").run(nowIso(), grantId);
    db.prepare("UPDATE purchases SET status = 'grant_failed', updated_at = ? WHERE purchase_id = ?").run(nowIso(), purchaseId);
    throw error;
  }
}

function applyRewardData(db, userId, purchaseId, product) {
  const reward = product.rewardData || {};
  if (reward.coin) {
    applyCurrencyChange(db, {
      userId,
      currency: "coin",
      delta: reward.coin,
      reason: "purchase_grant",
      sourceType: "purchase",
      sourceId: purchaseId,
      idempotencyKey: `grant:${purchaseId}:coin`
    });
  }
  if (reward.freeBling) {
    applyCurrencyChange(db, {
      userId,
      currency: "freeBling",
      delta: reward.freeBling,
      reason: "purchase_grant",
      sourceType: "purchase",
      sourceId: purchaseId,
      idempotencyKey: `grant:${purchaseId}:freeBling`
    });
  }
  if (reward.paidBling) {
    applyCurrencyChange(db, {
      userId,
      currency: "paidBling",
      delta: reward.paidBling,
      reason: "purchase_grant",
      sourceType: "purchase",
      sourceId: purchaseId,
      idempotencyKey: `grant:${purchaseId}:paidBling`
    });
  }
  if (Array.isArray(reward.items) && reward.items.length) {
    const state = getPlayerState(db, userId);
    const inventory = { ...state.inventory };
    for (const item of reward.items) {
      inventory[item.itemId] = (inventory[item.itemId] || 0) + item.amount;
    }
    updatePlayerState(db, userId, { inventory });
  }
  if (Array.isArray(reward.entitlements)) {
    for (const entitlement of reward.entitlements) {
      db.prepare(`
        INSERT INTO entitlements (
          entitlement_id, user_id, product_id, entitlement_type, entitlement_key,
          status, purchase_id, granted_at
        ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
        ON CONFLICT(user_id, entitlement_type, entitlement_key)
        DO UPDATE SET status = 'active', revoked_at = NULL
      `).run(
        makeId("entitlement"),
        userId,
        product.productId,
        entitlement.entitlementType,
        entitlement.entitlementKey,
        purchaseId,
        nowIso()
      );
    }
  }
}

export function purchaseResponse(row) {
  return {
    purchaseId: row.purchase_id,
    productId: row.product_id,
    provider: row.provider,
    providerTransactionId: row.provider_transaction_id,
    mockPaymentToken: row.mock_payment_token,
    status: row.status,
    price: row.price,
    currency: row.currency,
    checkoutUrl: `/mock-checkout?purchaseId=${row.purchase_id}&token=${row.mock_payment_token}`,
    paidAt: row.paid_at,
    grantedAt: row.granted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listEntitlements(db, userId) {
  return db.prepare("SELECT * FROM entitlements WHERE user_id = ? AND status = 'active' ORDER BY granted_at DESC").all(userId).map((row) => ({
    entitlementId: row.entitlement_id,
    productId: row.product_id,
    entitlementType: row.entitlement_type,
    entitlementKey: row.entitlement_key,
    status: row.status,
    purchaseId: row.purchase_id,
    grantedAt: row.granted_at
  }));
}

export function createRestoreEvent(db, userId) {
  const purchases = db.prepare("SELECT COUNT(*) AS count FROM purchases WHERE user_id = ?").get(userId).count;
  const entitlements = db.prepare("SELECT COUNT(*) AS count FROM entitlements WHERE user_id = ? AND status = 'active'").get(userId).count;
  db.prepare(`
    INSERT INTO restore_events (
      restore_event_id, user_id, status, restored_purchase_count,
      restored_entitlement_count, synced_wallet, created_at
    ) VALUES (?, ?, 'completed', ?, ?, 1, ?)
  `).run(makeId("restore"), userId, purchases, entitlements, nowIso());
}
