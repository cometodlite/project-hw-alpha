import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../app.js";

function makeAgent() {
  const app = createApp({
    databasePath: ":memory:",
    sessionSecret: "test-session-secret",
    clientOrigin: true,
    adminToken: "test-admin"
  });
  return { app, agent: request.agent(app) };
}

test("auth creates isolated player state and protects routes after logout", async () => {
  const { app, agent } = makeAgent();
  const register = await agent
    .post("/auth/register")
    .send({ email: "a@example.com", password: "password123", displayName: "A" })
    .expect(201);

  assert.equal(register.body.auth.status, "authenticated");
  assert.equal(register.body.wallet.coin, 500);

  await agent.get("/auth/me").expect(200).expect((res) => {
    assert.equal(res.body.auth.email, "a@example.com");
  });

  await agent
    .put("/me/player-state")
    .send({
      wallet: { coin: 540, freeBling: 30, paidBling: 0 },
      inventory: { herb: 9 },
      housing: { slots: ["tea-set", null, null, null] }
    })
    .expect(200);

  await agent.get("/me/player-state").expect(200).expect((res) => {
    assert.equal(res.body.wallet.coin, 540);
    assert.equal(res.body.playerState.inventory.herb, 9);
    assert.equal(res.body.playerState.housing.slots[0], "tea-set");
  });

  const other = request.agent(app);
  await other
    .post("/auth/register")
    .send({ email: "b@example.com", password: "password123", displayName: "B" })
    .expect(201);
  await other.get("/me/player-state").expect(200).expect((res) => {
    assert.equal(res.body.playerState.inventory.herb, 2);
  });

  await agent.post("/auth/logout").expect(200);
  await agent.get("/me/player-state").expect(401);
});

test("currency ledger records grants and paid bling is spent before free bling", async () => {
  const { app, agent } = makeAgent();
  const register = await agent
    .post("/auth/register")
    .send({ email: "ledger@example.com", password: "password123", displayName: "Ledger" })
    .expect(201);
  const userId = register.body.auth.userId;

  await request(app)
    .post(`/admin/users/${userId}/manual-grant`)
    .set("x-admin-token", "test-admin")
    .send({ currency: "paidBling", amount: 20, reason: "test paid", idempotencyKey: "paid-20" })
    .expect(200);
  await request(app)
    .post(`/admin/users/${userId}/manual-grant`)
    .set("x-admin-token", "test-admin")
    .send({ currency: "freeBling", amount: 15, reason: "test free", idempotencyKey: "free-15" })
    .expect(200);

  await request(app)
    .post("/internal/currency/spend-bling")
    .set("x-admin-token", "test-admin")
    .send({ userId, amount: 25, idempotencyKey: "spend-25" })
    .expect(200)
    .expect((res) => {
      assert.equal(res.body.result.paidSpent, 20);
      assert.equal(res.body.result.freeSpent, 5);
    });

  await request(app)
    .get(`/admin/users/${userId}/ledger`)
    .set("x-admin-token", "test-admin")
    .expect(200)
    .expect((res) => {
      const spendRows = res.body.ledger.filter((row) => row.idempotencyKey === "spend-25");
      assert.equal(spendRows.length, 2);
      assert(spendRows.some((row) => row.currency === "paidBling" && row.delta === -20));
      assert(spendRows.some((row) => row.currency === "freeBling" && row.delta === -5));
    });
});

test("mock checkout grants once and product list supports web products", async () => {
  const { app, agent } = makeAgent();
  await agent
    .post("/auth/register")
    .send({ email: "buyer@example.com", password: "password123", displayName: "Buyer" })
    .expect(201);

  await agent.get("/products").expect(200).expect((res) => {
    assert(res.body.products.some((product) => product.productId === "bling_pack_1000_krw"));
    assert(res.body.products.some((product) => product.productId === "cozy_room_starter_pack"));
  });

  const checkout = await agent
    .post("/payments/checkout")
    .send({ productId: "bling_pack_1000_krw", idempotencyKey: "checkout-1" })
    .expect(201);

  await agent
    .post("/payments/mock/complete")
    .send({
      purchaseId: checkout.body.purchase.purchaseId,
      mockPaymentToken: checkout.body.purchase.mockPaymentToken
    })
    .expect(200)
    .expect((res) => {
      assert.equal(res.body.purchase.status, "granted");
      assert.equal(res.body.wallet.paidBling, 1000);
    });

  await agent
    .post("/payments/mock/complete")
    .send({
      purchaseId: checkout.body.purchase.purchaseId,
      mockPaymentToken: checkout.body.purchase.mockPaymentToken
    })
    .expect(200)
    .expect((res) => {
      assert.equal(res.body.purchase.status, "granted");
      assert.equal(res.body.wallet.paidBling, 1000);
    });
});
