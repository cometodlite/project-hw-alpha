import bcrypt from "bcryptjs";
import cors from "cors";
import express from "express";
import session from "express-session";
import { createDb, decodeJson, nowIso } from "./db.js";
import {
  applyCurrencyChange,
  completeMockPayment,
  createCheckout,
  createDefaultAccountRows,
  createRestoreEvent,
  getPlayerSnapshot,
  listEntitlements,
  listProducts,
  makeId,
  makePublicUserCode,
  purchaseResponse,
  spendBling,
  updatePlayerState
} from "./services.js";

function toAuthState(user) {
  if (!user) {
    return {
      status: "guest",
      userId: null,
      publicUserCode: null,
      displayName: null,
      email: null,
      sessionExpiresAt: null
    };
  }
  return {
    status: "authenticated",
    userId: user.user_id,
    publicUserCode: user.public_user_code,
    displayName: user.display_name,
    email: user.email,
    sessionExpiresAt: null
  };
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    res.status(401).json({ error: "AUTH_REQUIRED" });
    return;
  }
  next();
}

function requireAdmin(req, res, next) {
  const expected = req.app.locals.adminToken;
  if (!expected || req.get("x-admin-token") !== expected) {
    res.status(401).json({ error: "ADMIN_AUTH_REQUIRED" });
    return;
  }
  next();
}

function getSessionUser(db, req) {
  if (!req.session.userId) return null;
  return db.prepare("SELECT * FROM users WHERE user_id = ? AND status = 'active'").get(req.session.userId) || null;
}

export function createApp(options = {}) {
  const app = express();
  const db = options.db || createDb(options.databasePath);
  const sessionSecret = options.sessionSecret || process.env.SESSION_SECRET || "dev-session-secret";
  const clientOrigin = options.clientOrigin ?? process.env.CLIENT_ORIGIN ?? true;

  app.locals.db = db;
  app.locals.adminToken = options.adminToken || process.env.ADMIN_TOKEN || "dev-admin-token";

  app.use(cors({
    origin: clientOrigin === "*" ? true : clientOrigin,
    credentials: true
  }));
  app.use(express.json({ limit: "512kb" }));
  app.use(session({
    name: "hw.sid",
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false
    }
  }));

  app.get("/health", (req, res) => {
    res.json({ ok: true });
  });

  app.post("/auth/register", async (req, res, next) => {
    try {
      const email = String(req.body.email || "").trim().toLowerCase();
      const password = String(req.body.password || "");
      const displayName = String(req.body.displayName || "").trim();
      if (!email || !email.includes("@")) {
        res.status(400).json({ error: "INVALID_EMAIL" });
        return;
      }
      if (password.length < 8) {
        res.status(400).json({ error: "PASSWORD_TOO_SHORT" });
        return;
      }
      if (!displayName) {
        res.status(400).json({ error: "DISPLAY_NAME_REQUIRED" });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const userId = makeId("user");
      const publicUserCode = makePublicUserCode();
      const now = nowIso();

      const run = db.transaction(() => {
        db.prepare(`
          INSERT INTO users (
            user_id, public_user_code, email, password_hash, display_name,
            status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
        `).run(userId, publicUserCode, email, passwordHash, displayName, now, now);
        createDefaultAccountRows(db, userId);
      });
      run();
      req.session.userId = userId;
      const user = db.prepare("SELECT * FROM users WHERE user_id = ?").get(userId);
      res.status(201).json({ auth: toAuthState(user), ...getPlayerSnapshot(db, userId) });
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) {
        res.status(409).json({ error: "EMAIL_ALREADY_REGISTERED" });
        return;
      }
      next(error);
    }
  });

  app.post("/auth/login", async (req, res, next) => {
    try {
      const email = String(req.body.email || "").trim().toLowerCase();
      const password = String(req.body.password || "");
      const user = db.prepare("SELECT * FROM users WHERE email = ? AND status = 'active'").get(email);
      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        res.status(401).json({ error: "INVALID_CREDENTIALS" });
        return;
      }
      const now = nowIso();
      db.prepare("UPDATE users SET last_login_at = ?, updated_at = ? WHERE user_id = ?").run(now, now, user.user_id);
      req.session.userId = user.user_id;
      res.json({ auth: toAuthState(user), ...getPlayerSnapshot(db, user.user_id) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/auth/logout", (req, res, next) => {
    req.session.destroy((error) => {
      if (error) {
        next(error);
        return;
      }
      res.clearCookie("hw.sid");
      res.json({ ok: true });
    });
  });

  app.get("/auth/me", (req, res) => {
    const user = getSessionUser(db, req);
    if (!user) {
      res.json({ auth: toAuthState(null) });
      return;
    }
    res.json({ auth: toAuthState(user) });
  });

  app.get("/me/player-state", requireAuth, (req, res) => {
    res.json(getPlayerSnapshot(db, req.session.userId));
  });

  app.put("/me/player-state", requireAuth, (req, res) => {
    const snapshot = updatePlayerState(db, req.session.userId, req.body || {});
    res.json(snapshot);
  });

  app.post("/me/restore", requireAuth, (req, res) => {
    createRestoreEvent(db, req.session.userId);
    res.json({
      ...getPlayerSnapshot(db, req.session.userId),
      entitlements: listEntitlements(db, req.session.userId),
      restoredAt: nowIso()
    });
  });

  app.get("/products", (req, res) => {
    res.json({ products: listProducts() });
  });

  app.get("/products/:productId", (req, res) => {
    const product = listProducts().find((entry) => entry.productId === req.params.productId);
    if (!product) {
      res.status(404).json({ error: "PRODUCT_NOT_FOUND" });
      return;
    }
    res.json({ product });
  });

  app.post("/payments/checkout", requireAuth, (req, res, next) => {
    try {
      const productId = String(req.body.productId || "");
      const idempotencyKey = String(req.body.idempotencyKey || "");
      if (!productId || !idempotencyKey) {
        res.status(400).json({ error: "PRODUCT_AND_IDEMPOTENCY_REQUIRED" });
        return;
      }
      const purchase = createCheckout(db, req.session.userId, { productId, idempotencyKey });
      res.status(201).json({ purchase });
    } catch (error) {
      next(error);
    }
  });

  app.post("/payments/mock/complete", requireAuth, (req, res, next) => {
    try {
      const purchase = completeMockPayment(db, req.session.userId, {
        purchaseId: String(req.body.purchaseId || ""),
        mockPaymentToken: String(req.body.mockPaymentToken || "")
      });
      res.json({ purchase, ...getPlayerSnapshot(db, req.session.userId) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/payments/:purchaseId", requireAuth, (req, res) => {
    const row = db.prepare("SELECT * FROM purchases WHERE purchase_id = ? AND user_id = ?")
      .get(req.params.purchaseId, req.session.userId);
    if (!row) {
      res.status(404).json({ error: "PURCHASE_NOT_FOUND" });
      return;
    }
    res.json({ purchase: purchaseResponse(row) });
  });

  app.post("/payments/:purchaseId/sync", requireAuth, (req, res) => {
    const row = db.prepare("SELECT * FROM purchases WHERE purchase_id = ? AND user_id = ?")
      .get(req.params.purchaseId, req.session.userId);
    if (!row) {
      res.status(404).json({ error: "PURCHASE_NOT_FOUND" });
      return;
    }
    res.json({ purchase: purchaseResponse(row), ...getPlayerSnapshot(db, req.session.userId) });
  });

  app.get("/admin/users/:userId/purchases", requireAdmin, (req, res) => {
    const rows = db.prepare("SELECT * FROM purchases WHERE user_id = ? ORDER BY created_at DESC").all(req.params.userId);
    res.json({ purchases: rows.map(purchaseResponse) });
  });

  app.get("/admin/users/:userId/grants", requireAdmin, (req, res) => {
    const rows = db.prepare("SELECT * FROM grant_records WHERE user_id = ? ORDER BY created_at DESC").all(req.params.userId);
    res.json({
      grants: rows.map((row) => ({
        grantId: row.grant_id,
        purchaseId: row.purchase_id,
        productId: row.product_id,
        rewardData: decodeJson(row.reward_data_json, {}),
        status: row.status,
        idempotencyKey: row.idempotency_key,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    });
  });

  app.get("/admin/users/:userId/ledger", requireAdmin, (req, res) => {
    const rows = db.prepare("SELECT * FROM currency_ledger WHERE user_id = ? ORDER BY created_at DESC").all(req.params.userId);
    res.json({
      ledger: rows.map((row) => ({
        ledgerId: row.ledger_id,
        currency: row.currency,
        delta: row.delta,
        balanceAfter: row.balance_after,
        reason: row.reason,
        sourceType: row.source_type,
        sourceId: row.source_id,
        idempotencyKey: row.idempotency_key,
        createdAt: row.created_at
      }))
    });
  });

  app.post("/admin/users/:userId/manual-grant", requireAdmin, (req, res, next) => {
    try {
      const body = req.body || {};
      const result = applyManualInventoryOrCurrency(db, req.params.userId, body, "manual_grant", 1);
      insertAdminAudit(db, "manual_grant", req.params.userId, result.targetId, body.reason || "manual grant");
      res.json({ ok: true, result, ...getPlayerSnapshot(db, req.params.userId) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/admin/users/:userId/manual-revoke", requireAdmin, (req, res, next) => {
    try {
      const body = req.body || {};
      const result = applyManualInventoryOrCurrency(db, req.params.userId, body, "manual_revoke", -1);
      insertAdminAudit(db, "manual_revoke", req.params.userId, result.targetId, body.reason || "manual revoke");
      res.json({ ok: true, result, ...getPlayerSnapshot(db, req.params.userId) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/internal/currency/spend-bling", requireAdmin, (req, res, next) => {
    try {
      const result = spendBling(db, {
        userId: req.body.userId,
        amount: req.body.amount,
        reason: "bling_spend",
        sourceType: req.body.sourceType || "admin",
        sourceId: req.body.sourceId || null,
        idempotencyKey: req.body.idempotencyKey
      });
      res.json({ ok: true, result, wallet: getPlayerSnapshot(db, req.body.userId).wallet });
    } catch (error) {
      next(error);
    }
  });

  app.use((error, req, res, next) => {
    console.error(error);
    const message = error.message || "Server error";
    if (message.includes("Insufficient")) {
      res.status(400).json({ error: "INSUFFICIENT_BALANCE", message });
      return;
    }
    if (message.includes("not found") || message.includes("not available")) {
      res.status(404).json({ error: "NOT_FOUND", message });
      return;
    }
    if (message.includes("Invalid")) {
      res.status(400).json({ error: "INVALID_REQUEST", message });
      return;
    }
    res.status(500).json({ error: "SERVER_ERROR", message });
  });

  return app;
}

function applyManualInventoryOrCurrency(db, userId, body, reason, direction) {
  const amount = Math.abs(Number(body.amount || 0));
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("Invalid manual amount");
  const idempotencyKey = String(body.idempotencyKey || `${reason}:${makeId("admin")}`);
  if (body.currency) {
    const currency = String(body.currency);
    applyCurrencyChange(db, {
      userId,
      currency,
      delta: direction * amount,
      reason,
      sourceType: "admin",
      sourceId: body.sourceId || null,
      idempotencyKey
    });
    return { type: "currency", targetId: currency, amount: direction * amount };
  }
  if (body.itemId) {
    const snapshot = getPlayerSnapshot(db, userId);
    const inventory = { ...snapshot.playerState.inventory };
    const next = Math.max(0, (inventory[body.itemId] || 0) + direction * amount);
    if (next === 0) delete inventory[body.itemId];
    else inventory[body.itemId] = next;
    updatePlayerState(db, userId, { inventory });
    return { type: "item", targetId: body.itemId, amount: direction * amount };
  }
  throw new Error("Manual action requires currency or itemId");
}

function insertAdminAudit(db, action, targetUserId, targetId, reason) {
  db.prepare(`
    INSERT INTO admin_audit_logs (
      audit_id, admin_token_label, action, target_user_id, target_id, reason, created_at
    ) VALUES (?, 'v1-admin-token', ?, ?, ?, ?, ?)
  `).run(makeId("audit"), action, targetUserId, targetId || null, reason, nowIso());
}
