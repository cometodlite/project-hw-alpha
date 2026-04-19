import { state, addLog } from "./state.js";
import { renderAll } from "./ui.js";
import {
  checkoutServerProduct,
  completeMockPurchase,
  getAuthState,
  isNodeApiEnabled,
  listServerProducts,
  restoreServerState,
  saveServerPlayerState
} from "./api.js";

function isVisibleInShop(item) {
  if (item.id === "apple_seed") return state.player.unlocks.appleSeedUnlocked;
  if (item.id === "golden_seed") return state.player.unlocks.goldenSeedUnlocked;
  return true;
}

export function initShop() {}

export async function syncServerProducts() {
  try {
    state.data.products = await listServerProducts();
  } catch (error) {
    console.warn(error);
    state.data.products = [];
  }
}

export function renderShop(container) {
  container.innerHTML = "";

  for (const item of state.data.shop.filter(isVisibleInShop)) {
    const row = document.createElement("div");
    row.className = "shop-item";
    row.innerHTML = `
      <div>
        <strong>${item.name}</strong>
        <div>${item.description}</div>
        <small>${item.currency === "coin" ? "코인" : "블링"} ${item.price}</small>
      </div>
      <button data-buy-id="${item.id}">구매</button>
    `;
    container.appendChild(row);
  }

  if (state.data.products?.length) {
    const authenticated = state.ui.auth.status === "authenticated";
    const canCheckout = authenticated && isNodeApiEnabled();
    const header = document.createElement("div");
    header.className = "mini-note";
    header.textContent = canCheckout ? "웹 결제 상품" : "웹 결제 상품 · 결제 서버 준비 중";
    container.appendChild(header);

    for (const product of state.data.products) {
      const row = document.createElement("div");
      row.className = "shop-item";
      row.innerHTML = `
        <div>
          <strong>${product.name}</strong>
          <div>${product.description}</div>
          <small>${product.currency} ${product.price.toLocaleString("ko-KR")} · ${product.type}</small>
        </div>
        <button data-product-id="${product.productId}" ${canCheckout ? "" : "disabled"}>${canCheckout ? "Mock 결제" : "결제 준비중"}</button>
      `;
      container.appendChild(row);
    }
  }

  container.querySelectorAll("[data-buy-id]").forEach((button) => {
    button.addEventListener("click", () => {
      buyItem(button.dataset.buyId);
    });
  });

  container.querySelectorAll("[data-product-id]").forEach((button) => {
    button.addEventListener("click", () => {
      buyServerProduct(button.dataset.productId);
    });
  });
}

export function buyItem(itemId) {
  const item = state.data.shop.find((entry) => entry.id === itemId);
  if (!item) return;

  const balanceKey = item.currency === "bling" ? "bling" : "coin";
  if (state.player[balanceKey] < item.price) {
    addLog(`${item.name} 구매에 필요한 ${item.currency === "bling" ? "블링" : "코인"}이 부족합니다.`);
    return;
  }

  if (item.currency === "bling") {
    spendLocalBling(item.price);
  } else {
    state.player.coin -= item.price;
  }
  state.player.inventory[item.id] = (state.player.inventory[item.id] || 0) + 1;
  addLog(`${item.name}을(를) 구매했습니다.`);
  renderAll();
}

function spendLocalBling(amount) {
  const paidSpend = Math.min(state.player.paidBling || 0, amount);
  const freeSpend = amount - paidSpend;
  state.player.paidBling = Math.max(0, (state.player.paidBling || 0) - paidSpend);
  state.player.freeBling = Math.max(0, (state.player.freeBling || 0) - freeSpend);
  state.player.bling = state.player.freeBling + state.player.paidBling;
}

export async function buyServerProduct(productId) {
  try {
    const auth = await getAuthState();
    if (auth.status !== "authenticated") {
      addLog("로그인 후 웹 상품을 구매할 수 있습니다.");
      renderAll();
      return;
    }
    addLog("Mock 결제를 처리하는 중입니다.");
    renderAll();
    await saveServerPlayerState();
    const checkout = await checkoutServerProduct(productId);
    const purchase = await completeMockPurchase(checkout);
    await restoreServerState();
    addLog(`웹 상품 지급 완료: ${purchase.productId}`);
    renderAll();
  } catch (error) {
    console.warn(error);
    addLog(error.status === 401 ? "로그인 후 웹 상품을 구매할 수 있습니다." : "웹 상품 구매를 완료하지 못했습니다. 서버 연결을 확인해 주세요.");
    renderAll();
  }
}
