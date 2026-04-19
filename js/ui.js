import { state, addLog, updateCurrency, setBgmEnabled, syncUnlocks } from "./state.js";
import {
  renderInventory,
  gatherReward,
  fishReward,
  getSeedItems,
  getFarmStatus,
  plantSeed,
  harvestFarm,
  sellForagedItems
} from "./inventory.js";
import { renderShop, buyItem, buyServerProduct, syncServerProducts } from "./shop.js";
import { saveGame, loadGame, resetGame } from "./save.js";
import { playRadio, stopRadio, getRadioState } from "./audio.js";
import {
  applyServerSnapshot,
  getBackendLabel,
  getBackendMode,
  getApiBase,
  getAuthState,
  isApiEnabled,
  loginAccount,
  loginWithGoogleAccount,
  logoutAccount,
  registerAccount
} from "./api.js";
import {
  renderHousingSlots,
  populateHousingItemSelect,
  placeHousingItem,
  clearHousingSlots,
  getHousingSummary
} from "./housing.js";

const el = {};
let currentScene = "town";
let currentSideTab = "inventory";
let activePanel = "status";
let activeBagTab = "inventory";
let authBusy = false;

const MOBILE_PANELS = new Set(["status", "action", "bag", "shop", "log"]);
const MOBILE_BAG_TABS = new Set(["inventory", "housing"]);
const MOBILE_AUTH_QUERY = "(max-width: 760px), (min-width: 761px) and (max-width: 1024px) and (orientation: portrait) and (pointer: coarse)";

let authPanelOpen = false;

const SCENE_META = {
  town: {
    title: "마을 광장",
    description: "사람들이 천천히 오가는 평온한 마을 광장입니다."
  },
  farm: {
    title: "조용한 밭",
    description: "씨앗을 심고 수확을 기다리는 작은 밭입니다."
  },
  home: {
    title: "아늑한 집",
    description: "가구를 배치하고 쉬어갈 수 있는 개인 공간입니다."
  }
};

function getTimeMood() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour <= 8) {
    return {
      key: "dawn",
      label: "아침",
      banner: "부드러운 아침빛이 천천히 공간을 감싸고 있습니다."
    };
  }
  if (hour >= 9 && hour <= 16) {
    return {
      key: "day",
      label: "낮",
      banner: "따뜻한 낮 햇살이 공간 전체를 환하게 비추고 있습니다."
    };
  }
  if (hour >= 17 && hour <= 20) {
    return {
      key: "evening",
      label: "저녁",
      banner: "노을빛이 스며들며 하루가 차분하게 마무리되고 있습니다."
    };
  }
  return {
    key: "night",
    label: "밤",
    banner: "고요한 밤공기가 주변을 조용히 채우고 있습니다."
  };
}

function getPlacedHousingNames() {
  const ids = state.player.housing?.slots?.filter(Boolean) || [];
  return ids.map((id) => state.data.items.find((item) => item.id === id)?.name || id);
}

function getSceneDetailText(sceneKey = currentScene) {
  if (sceneKey === "town") {
    return "생활 활동을 시작하거나, 상점과 인벤토리를 둘러보기에 좋은 중심 공간입니다. 시간대가 바뀌면 광장의 하늘빛과 전체 배경 톤도 함께 달라집니다.";
  }
  if (sceneKey === "farm") {
    return `밭 풍경 · ${getFarmStatus().text} 시간대에 따라 밭의 색감도 달라집니다.`;
  }
  const placedNames = getPlacedHousingNames();
  return placedNames.length
    ? `현재 집 안에는 ${placedNames.join(", ")}이(가) 배치되어 있습니다.`
    : "아직 집 안이 비어 있습니다. 가구를 배치하면 시간대에 따라 더 다른 집 분위기를 느낄 수 있습니다.";
}

function getLifeSummaryText() {
  const life = state.player.lifeSkills;
  return `생활 숙련도 · 채집 ${life.gathering} / 낚시 ${life.fishing} / 농사 ${life.farming}`;
}

function getHomeSummaryText() {
  const placedNames = getPlacedHousingNames();
  return placedNames.length
    ? `현재 집 분위기: ${placedNames.join(", ")}`
    : "현재 집 분위기: 배치된 가구가 없습니다.";
}

function getBgmLabelText() {
  return state.player.settings.bgmEnabled ? (state.player.currentTrackTitle || "없음") : "사용 안 함";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function findItemById(itemId) {
  return state.data.items.find((item) => item.id === itemId);
}

function getInventoryEntries() {
  return Object.entries(state.player.inventory || {}).map(([itemId, count]) => ({
    itemId,
    count,
    item: findItemById(itemId)
  }));
}

function getInventoryTotals(entries = getInventoryEntries()) {
  return entries.reduce((totals, entry) => {
    totals.count += entry.count;
    totals.value += (entry.item?.sellPrice || 0) * entry.count;
    return totals;
  }, { count: 0, value: 0 });
}

function getPlacedHousingCount() {
  return (state.player.housing?.slots || []).filter(Boolean).length;
}

function getFarmStateLabel() {
  const farm = getFarmStatus();
  if (farm.state === "ready") return "수확 가능";
  if (farm.state === "growing") return "성장 중";
  return "비어 있음";
}

function getItemTypeLabel(item) {
  const labels = {
    gather: "채집",
    fish: "낚시",
    farm: "작물",
    seed: "씨앗",
    housing: "가구"
  };
  return labels[item?.type] || "아이템";
}

function getInventoryMeta(entry) {
  const item = entry.item;
  if (!item) return `수량 ${entry.count}`;
  if (item.type === "seed") {
    return `수량 ${entry.count} · 성장 ${item.growthSeconds || 0}초`;
  }
  if (item.type === "housing") {
    const placed = (state.player.housing?.slots || []).filter((id) => id === entry.itemId).length;
    return `보유 ${entry.count} · 배치 ${placed}`;
  }
  return `수량 ${entry.count} · 판매 ${item.sellPrice || 0} 코인`;
}

function getLogKind(text = "") {
  if (text.includes("구매")) return "구매";
  if (text.includes("판매")) return "판매";
  if (text.includes("수확") || text.includes("심었습니다") || text.includes("밭")) return "농사";
  if (text.includes("채집")) return "채집";
  if (text.includes("낚시")) return "낚시";
  if (text.includes("배경음") || text.includes("BGM") || text.includes("라디오")) return "음악";
  if (text.includes("저장") || text.includes("불러오기") || text.includes("초기화")) return "시스템";
  return "알림";
}

function normalizeMobilePanel(panel) {
  return MOBILE_PANELS.has(panel) ? panel : "status";
}

function normalizeMobileBagTab(tab) {
  return MOBILE_BAG_TABS.has(tab) ? tab : "inventory";
}

function applyMobilePanel() {
  document.querySelectorAll(".mobile-panel").forEach((node) => {
    const active = node.dataset.mobilePanel === activePanel;
    node.classList.toggle("active", active);
    node.style.display = active ? "block" : "none";
  });
  document.querySelectorAll(".mobile-5panel-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.m5Panel === activePanel);
  });
}

function setActivePanel(panel) {
  activePanel = normalizeMobilePanel(panel);
  applyMobilePanel();
}

function applyMobileBagTab() {
  document.querySelectorAll(".mobile-subtab").forEach((button) => {
    button.classList.toggle("active", button.dataset.mobileBagTab === activeBagTab);
  });
  document.querySelectorAll(".mobile-bag-view").forEach((node) => {
    const active = node.dataset.mobileBagView === activeBagTab;
    node.classList.toggle("active", active);
    node.style.display = active ? "grid" : "none";
  });
}

function setActiveBagTab(tab) {
  activeBagTab = normalizeMobileBagTab(tab);
  applyMobileBagTab();
}


function renderM5Status() {
  const entries = getInventoryEntries();
  const totals = getInventoryTotals(entries);
  if (el.m5StatusSceneTitle) el.m5StatusSceneTitle.textContent = SCENE_META[currentScene]?.title || "마을 광장";
  if (el.m5StatusSceneDetail) el.m5StatusSceneDetail.textContent = getSceneDetailText(currentScene);
  if (el.m5StatusLife) el.m5StatusLife.textContent = getLifeSummaryText();
  if (el.m5StatusHome) el.m5StatusHome.textContent = getHomeSummaryText();
  if (el.m5StatusBgm) el.m5StatusBgm.textContent = getBgmLabelText();
  if (el.m5StatusCurrency) el.m5StatusCurrency.textContent = `코인 ${state.player.coin} · 블링 ${state.player.bling}`;
  if (el.m5StatusFarm) el.m5StatusFarm.textContent = getFarmStateLabel();
  if (el.m5StatusBag) el.m5StatusBag.textContent = `${entries.length}종 · ${totals.count}개`;
}


function renderM5Action() {
  if (!el.m5SeedSelect) return;
  const seeds = getSeedItems();
  const life = state.player.lifeSkills;
  if (el.m5ActionScene) el.m5ActionScene.textContent = SCENE_META[currentScene]?.title || "마을 광장";
  if (el.m5ActionSkill) el.m5ActionSkill.textContent = `채집 ${life.gathering} · 낚시 ${life.fishing} · 농사 ${life.farming}`;
  el.m5SeedSelect.innerHTML = seeds.length
    ? seeds.map((seed) => `<option value="${escapeHtml(seed.id)}">${escapeHtml(seed.name)} · 성장 ${seed.growthSeconds}초</option>`).join("")
    : '<option value="">사용 가능한 씨앗이 없습니다</option>';
  if (el.m5FarmStatus) el.m5FarmStatus.textContent = getFarmStatus().text;
}

function renderM5Bag() {
  const entries = getInventoryEntries();
  const totals = getInventoryTotals(entries);
  const placedHousingCount = getPlacedHousingCount();

  if (el.m5BagSummary) {
    el.m5BagSummary.textContent = entries.length
      ? `${entries.length}종 · ${totals.count}개 보유 · 예상 판매가 ${totals.value} 코인`
      : "보유 중인 아이템이 없습니다.";
  }
  if (el.m5BagInventoryCount) el.m5BagInventoryCount.textContent = `${entries.length}종`;
  if (el.m5BagHousingCount) el.m5BagHousingCount.textContent = `${placedHousingCount}/4`;

  if (el.m5BagInventoryList) {
    el.m5BagInventoryList.innerHTML = entries.length
      ? entries.map((entry) => {
          const name = entry.item?.name || entry.itemId;
          const description = entry.item?.description || "설명 없음";
          return `
            <div class="mobile-bag-item">
              <div class="mobile-item-head">
                <strong>${escapeHtml(name)}</strong>
                <span class="mobile-pill">${escapeHtml(getItemTypeLabel(entry.item))}</span>
              </div>
              <div>${escapeHtml(description)}</div>
              <small>${escapeHtml(getInventoryMeta(entry))}</small>
            </div>
          `;
        }).join("")
      : '<div class="mobile-bag-item">보유 중인 아이템이 없습니다.</div>';
  }

  renderHousingSlots(el.m5HousingSlots);
  populateHousingItemSelect(el.m5HousingItemSelect);
  if (el.m5HousingSummary) el.m5HousingSummary.textContent = getHousingSummary();
  applyMobileBagTab();
}

function renderM5Shop() {
  if (!el.m5ShopList) return;
  const visible = state.data.shop.filter((item) => {
    if (item.id === "apple_seed") return state.player.unlocks.appleSeedUnlocked;
    if (item.id === "golden_seed") return state.player.unlocks.goldenSeedUnlocked;
    return true;
  });
  const webProducts = state.data.products || [];
  const authenticated = state.ui.auth.status === "authenticated";
  if (el.m5ShopSummary) {
    el.m5ShopSummary.textContent = `${visible.length}개 게임 상품 · 웹 상품 ${webProducts.length}개 · 코인 ${state.player.coin} · 블링 ${state.player.bling}`;
  }

  const gameItemsHtml = visible.length
    ? visible.map((item) => {
      const balanceKey = item.currency === "bling" ? "bling" : "coin";
      const canBuy = state.player[balanceKey] >= item.price;
      const owned = state.player.inventory[item.id] || 0;
      const itemData = findItemById(item.id);
      return `
      <div class="mobile-shop-item">
        <div class="mobile-shop-copy">
          <div class="mobile-item-head">
            <strong>${escapeHtml(item.name)}</strong>
            <span class="mobile-pill">${escapeHtml(getItemTypeLabel(itemData))}</span>
          </div>
          <div>${escapeHtml(item.description)}</div>
          <small>${item.currency === "coin" ? "코인" : "블링"} ${item.price} · 보유 ${owned}</small>
        </div>
        <button data-m5-buy-id="${escapeHtml(item.id)}" ${canBuy ? "" : "disabled"}>${canBuy ? "구매" : "부족"}</button>
      </div>
    `;
    }).join("")
    : '<div class="mobile-shop-item"><div>구매 가능한 아이템이 없습니다.</div></div>';

  const webItemsHtml = webProducts.length
    ? `
      <div class="mobile-panel-summary">웹 결제 상품</div>
      ${webProducts.map((product) => `
        <div class="mobile-shop-item">
          <div class="mobile-shop-copy">
            <div class="mobile-item-head">
              <strong>${escapeHtml(product.name)}</strong>
              <span class="mobile-pill">${escapeHtml(product.type)}</span>
            </div>
            <div>${escapeHtml(product.description)}</div>
            <small>${escapeHtml(product.currency)} ${Number(product.price).toLocaleString("ko-KR")}</small>
          </div>
          <button data-m5-product-id="${escapeHtml(product.productId)}" ${authenticated ? "" : "disabled"}>${authenticated ? "Mock 결제" : "로그인 필요"}</button>
        </div>
      `).join("")}
    `
    : "";

  el.m5ShopList.innerHTML = gameItemsHtml + webItemsHtml;

}

function renderM5Log() {
  if (!el.m5LogList) return;
  const rows = (state.player.log || []).slice(0, 12);
  if (el.m5LogSummary) {
    el.m5LogSummary.textContent = rows.length
      ? `최근 ${rows.length}개 기록 · 가장 최근 ${rows[0].time}`
      : "최근 기록이 없습니다.";
  }
  el.m5LogList.innerHTML = rows.length
    ? rows.map((row) => `
      <div class="mobile-log-item">
        <span class="mobile-log-kind">${escapeHtml(getLogKind(row.text))}</span>
        <div>
          <strong>${escapeHtml(row.text)}</strong>
          <small>${escapeHtml(row.time)}</small>
        </div>
      </div>
    `).join("")
    : '<div class="mobile-log-item">최근 알림이 없습니다.</div>';
}

function renderAllM5Panels() {
  renderM5Status();
  renderM5Action();
  renderM5Bag();
  renderM5Shop();
  renderM5Log();
  applyMobilePanel();
  applyMobileBagTab();
}

export function initUI() {
  el.currentTime = document.getElementById("current-time");
  el.coinValue = document.getElementById("coin-value");
  el.blingValue = document.getElementById("bling-value");
  el.bgmTitle = document.getElementById("bgm-title");
  el.authPanel = document.getElementById("auth-panel");
  el.desktopAuthSlot = document.getElementById("desktop-auth-slot");
  el.mobileAuthSlot = document.getElementById("mobile-auth-slot");
  el.authToggleButton = document.getElementById("btn-auth-toggle");
  el.authToggleLabel = document.getElementById("auth-toggle-label");
  el.authToggleDetail = document.getElementById("auth-toggle-detail");
  el.authCloseButton = document.getElementById("btn-auth-close");
  el.m5AuthToggleButton = document.getElementById("m5-auth-toggle");
  el.m5AuthTitle = document.getElementById("m5-auth-title");
  el.m5AuthDetail = document.getElementById("m5-auth-detail");
  el.authStateText = document.getElementById("auth-state-text");
  el.authServerText = document.getElementById("auth-server-text");
  el.authForm = document.getElementById("auth-form");
  el.authEmail = document.getElementById("auth-email");
  el.authPassword = document.getElementById("auth-password");
  el.authDisplayName = document.getElementById("auth-display-name");
  el.authRegisterButton = document.getElementById("btn-auth-register");
  el.authLoginButton = document.getElementById("btn-auth-login");
  el.authGoogleButton = document.getElementById("btn-auth-google");
  el.authLogoutButton = document.getElementById("btn-auth-logout");
  el.authLoadServerButton = document.getElementById("btn-auth-load-server");
  el.timePeriodText = document.getElementById("time-period-text");
  el.inventoryList = document.getElementById("inventory-list");
  el.shopList = document.getElementById("shop-list");
  el.logList = document.getElementById("log-list");
  el.bgmEnabled = document.getElementById("bgm-enabled");
  el.radioTrackTitle = document.getElementById("radio-track-title");
  el.lifeSummary = document.getElementById("life-summary");
  el.activityList = document.getElementById("activity-list");
  el.farmSeedSelect = document.getElementById("farm-seed-select");
  el.farmStatus = document.getElementById("farm-status");
  el.housingSlots = document.getElementById("housing-slots");
  el.housingItemSelect = document.getElementById("housing-item-select");
  el.housingSummary = document.getElementById("housing-summary");
  el.sceneTitle = document.getElementById("scene-title");
  el.sceneDescription = document.getElementById("scene-description");
  el.sceneDetail = document.getElementById("scene-detail");
  el.sceneMoodBanner = document.getElementById("scene-mood-banner");
  el.farmVisualStatus = document.getElementById("farm-visual-status");
  el.homeVisualStatus = document.getElementById("home-visual-status");
  el.homeItemChips = document.getElementById("home-item-chips");
  el.sceneBackgroundLayer = document.getElementById("scene-background-layer");
  el.timeVisualBadge = document.getElementById("time-visual-badge");
  el.sceneSpotlightText = document.getElementById("scene-spotlight-text");
  el.logPanel = document.getElementById("log-panel");
  el.m5StatusSceneTitle = document.getElementById("m5-status-scene-title");
  el.m5StatusSceneDetail = document.getElementById("m5-status-scene-detail");
  el.m5StatusLife = document.getElementById("m5-status-life");
  el.m5StatusHome = document.getElementById("m5-status-home");
  el.m5StatusBgm = document.getElementById("m5-status-bgm");
  el.m5StatusCurrency = document.getElementById("m5-status-currency");
  el.m5StatusFarm = document.getElementById("m5-status-farm");
  el.m5StatusBag = document.getElementById("m5-status-bag");
  el.m5ActionScene = document.getElementById("m5-action-scene");
  el.m5ActionSkill = document.getElementById("m5-action-skill");
  el.m5SeedSelect = document.getElementById("m5-seed-select");
  el.m5FarmStatus = document.getElementById("m5-farm-status");
  el.m5BagSummary = document.getElementById("m5-bag-summary");
  el.m5BagInventoryCount = document.getElementById("m5-bag-inventory-count");
  el.m5BagHousingCount = document.getElementById("m5-bag-housing-count");
  el.m5BagInventoryList = document.getElementById("m5-bag-inventory-list");
  el.m5HousingSlots = document.getElementById("m5-housing-slots");
  el.m5HousingItemSelect = document.getElementById("m5-housing-item-select");
  el.m5HousingSummary = document.getElementById("m5-housing-summary");
  el.m5ShopSummary = document.getElementById("m5-shop-summary");
  el.m5ShopList = document.getElementById("m5-shop-list");
  el.m5LogSummary = document.getElementById("m5-log-summary");
  el.m5LogList = document.getElementById("m5-log-list");

  populateSeedSelect();
  populateHousingItemSelect(el.housingItemSelect);
  syncSceneButtons();
  syncSideTabs();
  if (el.logPanel) el.logPanel.open = false;
  activePanel = "status";
  activeBagTab = "inventory";
  syncAuthPanelPlacement();
  renderAllM5Panels();
  applyMobilePanel();
  applyMobileBagTab();
  renderAuthPanel();
}

function populateSeedSelect() {
  if (!el.farmSeedSelect) return;
  const seeds = getSeedItems();
  el.farmSeedSelect.innerHTML = seeds.length
    ? seeds.map((seed) => `<option value="${seed.id}">${seed.name} · 성장 ${seed.growthSeconds}초</option>`).join("")
    : '<option value="">사용 가능한 씨앗이 없습니다</option>';
}

function refreshHousingUI() {
  renderHousingSlots(el.housingSlots);
  populateHousingItemSelect(el.housingItemSelect);
  if (el.housingSummary) el.housingSummary.textContent = getHousingSummary();
}

function handleGatherAction() {
  currentScene = "town";
  const reward = gatherReward();
  addLog(`채집 성공: ${reward.label} ${reward.amount}개 (${reward.rarity === "rare" ? "희귀" : "일반"})`);
  populateSeedSelect();
  syncSceneButtons();
  renderAll();
}

function handleFishAction() {
  currentScene = "town";
  const reward = fishReward();
  addLog(`낚시 성공: ${reward.label} ${reward.amount}개 (${reward.rarity === "rare" ? "희귀" : "일반"})`);
  syncSceneButtons();
  renderAll();
}

function handleSellAllAction() {
  const result = sellForagedItems();
  if (result.earned <= 0) addLog("판매할 생활 수집품이 없습니다.");
  else addLog(`수집품 판매 완료: ${result.sold.join(", ")} · 총 ${result.earned} 코인`);
  renderAll();
}

function handlePlantSeedAction(seedId = el.farmSeedSelect?.value) {
  currentScene = "farm";
  if (el.farmSeedSelect) el.farmSeedSelect.value = seedId || "";
  const result = plantSeed(seedId);
  addLog(result.message);
  populateSeedSelect();
  syncSceneButtons();
  renderAll();
}

function handleHarvestAction() {
  currentScene = "farm";
  const result = harvestFarm();
  addLog(result.message);
  populateSeedSelect();
  syncSceneButtons();
  renderAll();
}

function handleClearHousingAction() {
  currentScene = "home";
  currentSideTab = "housing";
  const result = clearHousingSlots();
  addLog(result.message);
  syncSceneButtons();
  syncSideTabs();
  renderAll();
}

function handlePlaceHousingAction(slotIndex, itemId = el.housingItemSelect?.value) {
  if (el.housingItemSelect) el.housingItemSelect.value = itemId || "";
  const result = placeHousingItem(slotIndex, itemId);
  addLog(result.message);
  currentScene = "home";
  currentSideTab = "housing";
  syncSceneButtons();
  syncSideTabs();
  renderAll();
}

function bindHousingPlacementButton(buttonId, slotIndex) {
  const button = document.getElementById(buttonId);
  if (!button) return;
  button.addEventListener("click", () => handlePlaceHousingAction(slotIndex));
}

function syncSceneButtons() {
  document.querySelectorAll("[data-desktop-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.desktopView === currentScene);
  });
  document.querySelectorAll("[data-m5-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.m5View === currentScene);
  });
  document.body.classList.remove("scene-town", "scene-farm", "scene-home");
  document.body.classList.add(`scene-${currentScene}`);
}

function syncSideTabs() {
  document.querySelectorAll(".side-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.sideTab === currentSideTab);
  });
  document.querySelectorAll(".side-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.sidePanel === currentSideTab);
  });
}

function setAuthState(auth) {
  state.ui.auth = {
    status: auth?.status || "guest",
    userId: auth?.userId || null,
    publicUserCode: auth?.publicUserCode || null,
    displayName: auth?.displayName || null,
    email: auth?.email || null
  };
}

function setServerMode(mode, message) {
  state.ui.server = {
    apiBase: getApiBase(),
    backendMode: getBackendMode(),
    backendLabel: getBackendLabel(),
    mode,
    message
  };
}

function getAuthFormValues() {
  return {
    email: el.authEmail?.value.trim() || "",
    password: el.authPassword?.value || "",
    displayName: el.authDisplayName?.value.trim() || ""
  };
}

function isMobileAuthLayout() {
  return Boolean(globalThis.matchMedia?.(MOBILE_AUTH_QUERY).matches);
}

function syncAuthPanelPlacement() {
  if (!el.authPanel) return;
  const target = isMobileAuthLayout() ? el.mobileAuthSlot : el.desktopAuthSlot;
  if (target && el.authPanel.parentElement !== target) {
    target.appendChild(el.authPanel);
  }
}

function setAuthPanelOpen(open) {
  authPanelOpen = Boolean(open);
  syncAuthPanelPlacement();
  renderAuthPanel();
}

function renderAuthPanel() {
  if (!el.authStateText || !el.authServerText) return;
  const auth = state.ui.auth;
  const server = state.ui.server;
  const authenticated = auth.status === "authenticated";
  const backendMode = getBackendMode();
  const backendLabel = getBackendLabel();
  const apiBase = server.apiBase || getApiBase();
  const apiMissing = backendMode === "local";
  const apiOffline = backendMode !== "local" && server.mode === "offline" && !authenticated;

  el.authStateText.textContent = authenticated
    ? `${auth.displayName || auth.email || "로그인됨"}`
    : "게스트";
  el.authServerText.textContent = authenticated
    ? `${backendLabel} 저장 사용 중${backendMode === "api" ? ` · ${apiBase}` : ""}`
    : (apiMissing ? "로컬 저장으로 플레이 중" : (server.message || `${backendLabel} 로그인 가능`));

  el.authPanel?.classList.toggle("auth-local-only", apiMissing);
  el.authPanel?.classList.toggle("auth-offline", apiOffline);
  el.authPanel?.classList.toggle("auth-full", backendMode !== "local" && !apiOffline);
  el.authPanel?.classList.toggle("auth-firebase", backendMode === "firebase");
  el.authPanel?.classList.toggle("auth-collapsed", !authPanelOpen);
  el.authPanel?.classList.toggle("auth-open", authPanelOpen);
  el.authForm?.classList.toggle("is-authenticated", authenticated);
  if (el.authToggleButton) el.authToggleButton.setAttribute("aria-expanded", String(authPanelOpen));
  if (el.m5AuthToggleButton) el.m5AuthToggleButton.setAttribute("aria-expanded", String(authPanelOpen));
  const buttonLabel = authenticated ? "로그인됨" : (backendMode === "local" ? "로컬 저장" : "계정");
  const buttonDetail = authenticated
    ? `${backendLabel} 저장 사용 중`
    : (apiOffline ? "연결 실패 · 로컬 저장" : (apiMissing ? "로컬 저장으로 플레이 중" : `${backendLabel} 로그인 가능`));
  if (el.authToggleLabel) el.authToggleLabel.textContent = buttonLabel;
  if (el.authToggleDetail) el.authToggleDetail.textContent = buttonDetail;
  if (el.m5AuthTitle) el.m5AuthTitle.textContent = buttonLabel;
  if (el.m5AuthDetail) el.m5AuthDetail.textContent = buttonDetail;
  if (el.m5AuthToggleButton) el.m5AuthToggleButton.textContent = authPanelOpen ? "닫기" : (authenticated ? "계정 보기" : "계정 연결");
  const canUseAuth = backendMode !== "local" && !apiOffline && !authBusy;
  [el.authEmail, el.authPassword, el.authDisplayName].forEach((input) => {
    if (input) input.disabled = authBusy;
  });
  if (el.authRegisterButton) el.authRegisterButton.disabled = !canUseAuth || authenticated;
  if (el.authLoginButton) el.authLoginButton.disabled = !canUseAuth || authenticated;
  if (el.authGoogleButton) el.authGoogleButton.disabled = backendMode !== "firebase" || !canUseAuth || authenticated;
  if (el.authLogoutButton) el.authLogoutButton.disabled = !canUseAuth || !authenticated;
  if (el.authLoadServerButton) el.authLoadServerButton.disabled = !canUseAuth || !authenticated;
}

export async function refreshAuthState() {
  setServerMode(isApiEnabled() ? "checking" : "local", isApiEnabled() ? `${getBackendLabel()} 확인 중` : "로컬 저장");
  renderAuthPanel();
  if (!isApiEnabled()) {
    setAuthState({ status: "guest" });
    setServerMode("local", "로컬 저장");
    renderAuthPanel();
    return;
  }
  try {
    const auth = await getAuthState();
    setAuthState(auth);
    setServerMode(auth.status === "authenticated" ? "server" : "guest", auth.status === "authenticated" ? `${getBackendLabel()} 저장 사용 중` : `${getBackendLabel()} 로그인 가능`);
  } catch (error) {
    console.warn(error);
    setAuthState({ status: "guest" });
    setServerMode("offline", "API 연결 실패 · 로컬 저장");
  }
  renderAuthPanel();
}

async function finishAuth(data, message) {
  setAuthState(data.auth);
  setServerMode("server", `${getBackendLabel()} 저장 사용 중`);
  applyServerSnapshot(data);
  syncUnlocks();
  await syncServerProducts();
  populateSeedSelect();
  refreshHousingUI();
  addLog(message);
  renderAll();
}

async function submitAuth(mode) {
  if (authBusy) return;
  const values = getAuthFormValues();
  if (!values.email || !values.password) {
    addLog("이메일과 비밀번호를 입력해 주세요.");
    renderAll();
    return;
  }
  if (mode === "register" && !values.displayName) {
    addLog("회원가입에는 닉네임이 필요합니다.");
    renderAll();
    return;
  }

  authBusy = true;
  renderAuthPanel();
  try {
    let data;
    if (mode === "register") {
      try {
        data = await registerAccount(values);
      } catch (error) {
        if (error.status !== 409 && error.code !== "auth/email-already-in-use") throw error;
        data = await loginAccount(values);
      }
      await finishAuth(data, "계정 연결이 완료되었습니다.");
    } else {
      data = await loginAccount(values);
      await finishAuth(data, "로그인했습니다.");
    }
  } catch (error) {
    console.warn(error);
    const credentialError = error.status === 401 || ["auth/invalid-credential", "auth/user-not-found", "auth/wrong-password"].includes(error.code);
    addLog(credentialError ? "이메일 또는 비밀번호를 확인해 주세요." : "계정 연결에 실패했습니다. Firebase 설정 또는 서버 상태를 확인해 주세요.");
    renderAll();
  } finally {
    authBusy = false;
    await refreshAuthState();
  }
}

async function handleGoogleLogin() {
  if (authBusy) return;
  authBusy = true;
  renderAuthPanel();
  try {
    const data = await loginWithGoogleAccount();
    await finishAuth(data, "Google 로그인했습니다.");
  } catch (error) {
    console.warn(error);
    addLog("Google 로그인에 실패했습니다. Firebase 설정과 팝업 허용 상태를 확인해 주세요.");
    renderAll();
  } finally {
    authBusy = false;
    await refreshAuthState();
  }
}

async function handleLogout() {
  if (authBusy) return;
  authBusy = true;
  renderAuthPanel();
  try {
    await logoutAccount();
    setAuthState({ status: "guest" });
    setServerMode("guest", `${getBackendLabel()} 로그인 가능`);
    addLog("로그아웃했습니다. 현재 화면은 로컬 상태로 유지됩니다.");
    renderAll();
  } catch (error) {
    console.warn(error);
    addLog("로그아웃에 실패했습니다. 서버 상태를 확인해 주세요.");
    renderAll();
  } finally {
    authBusy = false;
    await refreshAuthState();
  }
}

async function handleLoadServerState() {
  if (authBusy) return;
  if (state.ui.auth.status !== "authenticated") {
    addLog(`로그인 후 ${getBackendLabel()} 저장 데이터를 불러올 수 있습니다.`);
    renderAll();
    return;
  }
  authBusy = true;
  renderAuthPanel();
  try {
    await loadGame();
    await syncServerProducts();
    populateSeedSelect();
    refreshHousingUI();
    addLog(`${getBackendLabel()} 저장 데이터를 다시 동기화했습니다.`);
    renderAll();
  } catch (error) {
    console.warn(error);
    addLog(`${getBackendLabel()} 저장 데이터를 불러오지 못했습니다.`);
    renderAll();
  } finally {
    authBusy = false;
    await refreshAuthState();
  }
}

export function bindUIEvents() {
  el.authForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitAuth("login");
  });
  el.authRegisterButton?.addEventListener("click", () => submitAuth("register"));
  el.authLoginButton?.addEventListener("click", () => submitAuth("login"));
  el.authGoogleButton?.addEventListener("click", handleGoogleLogin);
  el.authLogoutButton?.addEventListener("click", handleLogout);
  el.authLoadServerButton?.addEventListener("click", handleLoadServerState);
  el.authToggleButton?.addEventListener("click", () => setAuthPanelOpen(!authPanelOpen));
  el.m5AuthToggleButton?.addEventListener("click", () => setAuthPanelOpen(!authPanelOpen));
  el.authCloseButton?.addEventListener("click", () => setAuthPanelOpen(false));
  globalThis.addEventListener?.("resize", () => {
    syncAuthPanelPlacement();
    renderAuthPanel();
  });
  document.addEventListener("click", (event) => {
    if (!authPanelOpen) return;
    const target = event.target;
    if (el.authPanel?.contains(target)) return;
    if (el.authToggleButton?.contains(target)) return;
    if (el.m5AuthToggleButton?.contains(target)) return;
    setAuthPanelOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setAuthPanelOpen(false);
  });
  refreshAuthState();

  document.querySelectorAll(".mobile-5panel-button").forEach((button) => {
    button.addEventListener("click", () => {
      setActivePanel(button.dataset.m5Panel);
      renderAllM5Panels();
    });
  });

  document.querySelectorAll(".mobile-subtab").forEach((button) => {
    button.addEventListener("click", () => {
      setActiveBagTab(button.dataset.mobileBagTab);
    });
  });

  document.getElementById("m5-btn-gather")?.addEventListener("click", handleGatherAction);
  document.getElementById("m5-btn-fish")?.addEventListener("click", handleFishAction);
  document.getElementById("m5-btn-sell")?.addEventListener("click", handleSellAllAction);
  document.getElementById("m5-btn-plant")?.addEventListener("click", () => {
    handlePlantSeedAction(el.m5SeedSelect?.value);
  });
  document.getElementById("m5-btn-harvest")?.addEventListener("click", handleHarvestAction);

  document.querySelectorAll("[data-m5-place-slot]").forEach((button) => {
    button.addEventListener("click", () => {
      handlePlaceHousingAction(Number(button.dataset.m5PlaceSlot) - 1, el.m5HousingItemSelect?.value);
    });
  });

  document.getElementById("m5-btn-clear-housing")?.addEventListener("click", handleClearHousingAction);

  el.m5ShopList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-m5-buy-id]");
    if (button) {
      buyItem(button.dataset.m5BuyId);
      return;
    }
    const productButton = event.target.closest("[data-m5-product-id]");
    if (productButton) {
      buyServerProduct(productButton.dataset.m5ProductId);
    }
  });

  document.querySelectorAll("[data-desktop-view]").forEach((button) => {
    button.addEventListener("click", () => {
      currentScene = button.dataset.desktopView;
      if (currentScene === "farm") currentSideTab = "life";
      if (currentScene === "home") currentSideTab = "housing";
      if (currentScene === "town") currentSideTab = currentSideTab === "housing" ? "inventory" : currentSideTab;
      syncSceneButtons();
      syncSideTabs();
      renderAll();
    });
  });

  document.querySelectorAll("[data-m5-view]").forEach((button) => {
    button.addEventListener("click", () => {
      currentScene = button.dataset.m5View;
      syncSceneButtons();
      renderAll();
    });
  });

  document.querySelectorAll(".side-tab").forEach((button) => {
    button.addEventListener("click", () => {
      currentSideTab = button.dataset.sideTab;
      syncSideTabs();
      renderAll();
    });
  });

  document.getElementById("btn-save")?.addEventListener("click", async () => { await saveGame(); renderAll(); });
  document.getElementById("btn-load")?.addEventListener("click", async () => { await loadGame(); populateSeedSelect(); refreshHousingUI(); renderAll(); });
  document.getElementById("btn-reset")?.addEventListener("click", () => {
    const confirmed = window.confirm("정말 새 게임 상태로 초기화하시겠습니까?");
    if (!confirmed) return;
    resetGame();
    populateSeedSelect();
    refreshHousingUI();
    renderAll();
  });

  document.getElementById("btn-open-inventory")?.addEventListener("click", () => {
    currentSideTab = "inventory";
    syncSideTabs();
    addLog("인벤토리를 확인했습니다.");
    renderAll();
  });

  document.getElementById("btn-add-coin")?.addEventListener("click", () => { updateCurrency({ coin: 100 }); addLog("코인 100을 획득했습니다."); renderAll(); });
  document.getElementById("btn-add-bling")?.addEventListener("click", () => { updateCurrency({ bling: 10 }); addLog("블링 10을 획득했습니다."); renderAll(); });

  document.getElementById("btn-gather")?.addEventListener("click", handleGatherAction);
  document.getElementById("btn-fish")?.addEventListener("click", handleFishAction);
  document.getElementById("btn-sell-all")?.addEventListener("click", handleSellAllAction);
  document.getElementById("btn-plant-seed")?.addEventListener("click", () => handlePlantSeedAction());
  document.getElementById("btn-farm-harvest")?.addEventListener("click", handleHarvestAction);
  document.getElementById("btn-clear-housing")?.addEventListener("click", handleClearHousingAction);

  bindHousingPlacementButton("btn-place-slot-1", 0);
  bindHousingPlacementButton("btn-place-slot-2", 1);
  bindHousingPlacementButton("btn-place-slot-3", 2);
  bindHousingPlacementButton("btn-place-slot-4", 3);

  el.bgmEnabled?.addEventListener("change", (event) => {
    setBgmEnabled(event.target.checked);
    addLog(`시간대별 BGM 시스템을 ${event.target.checked ? "활성화" : "비활성화"}했습니다.`);
    renderAll();
  });

  document.getElementById("btn-radio-play")?.addEventListener("click", () => { playRadio(); renderAll(); });
  document.getElementById("btn-radio-stop")?.addEventListener("click", () => { stopRadio(); renderAll(); });
}


function getSceneBackgroundStyle(sceneKey, timeKey) {
  const map = {
    town: {
      dawn: "radial-gradient(circle at 16% 18%, rgba(255,220,148,0.95) 0%, rgba(255,220,148,0.65) 12%, transparent 24%), linear-gradient(180deg, #ffe9cb 0%, #f7d8bb 55%, #eadcc9 100%)",
      day: "radial-gradient(circle at 18% 16%, rgba(255,244,150,0.98) 0%, rgba(255,244,150,0.72) 12%, transparent 24%), linear-gradient(180deg, #bfe3ff 0%, #d7f0ff 38%, #f2eadc 100%)",
      evening: "radial-gradient(circle at 82% 18%, rgba(255,151,88,0.98) 0%, rgba(255,151,88,0.70) 12%, transparent 24%), linear-gradient(180deg, #ffbe8a 0%, #ffccb3 42%, #ead8ca 100%)",
      night: "radial-gradient(circle at 82% 18%, rgba(219,227,255,0.36) 0%, rgba(219,227,255,0.20) 10%, transparent 22%), linear-gradient(180deg, #24324f 0%, #3a4d70 45%, #59657d 100%)"
    },
    farm: {
      dawn: "radial-gradient(circle at 16% 18%, rgba(255,220,148,0.92) 0%, rgba(255,220,148,0.60) 12%, transparent 24%), linear-gradient(180deg, #e9f3c9 0%, #d8e8b8 48%, #c6d4a8 100%)",
      day: "radial-gradient(circle at 18% 16%, rgba(255,244,150,0.96) 0%, rgba(255,244,150,0.70) 12%, transparent 24%), linear-gradient(180deg, #bfe7b8 0%, #d9f1c9 38%, #c8dfb9 100%)",
      evening: "radial-gradient(circle at 82% 18%, rgba(255,151,88,0.94) 0%, rgba(255,151,88,0.66) 12%, transparent 24%), linear-gradient(180deg, #efc182 0%, #e2d09f 42%, #cfc2a3 100%)",
      night: "radial-gradient(circle at 82% 18%, rgba(219,227,255,0.24) 0%, rgba(219,227,255,0.12) 10%, transparent 22%), linear-gradient(180deg, #2d3f42 0%, #40584f 45%, #5a665d 100%)"
    },
    home: {
      dawn: "radial-gradient(circle at 16% 18%, rgba(255,220,148,0.90) 0%, rgba(255,220,148,0.58) 12%, transparent 24%), linear-gradient(180deg, #f8e3d2 0%, #eed4c2 52%, #e2cbbd 100%)",
      day: "radial-gradient(circle at 18% 16%, rgba(255,244,150,0.94) 0%, rgba(255,244,150,0.66) 12%, transparent 24%), linear-gradient(180deg, #f7eadb 0%, #f2e1d3 38%, #ead7c9 100%)",
      evening: "radial-gradient(circle at 82% 18%, rgba(255,151,88,0.92) 0%, rgba(255,151,88,0.64) 12%, transparent 24%), linear-gradient(180deg, #efc4a9 0%, #e6c6b7 42%, #dcc4bc 100%)",
      night: "radial-gradient(circle at 82% 18%, rgba(219,227,255,0.22) 0%, rgba(219,227,255,0.10) 10%, transparent 22%), linear-gradient(180deg, #4a4054 0%, #63556a 45%, #7b6f72 100%)"
    }
  };
  return map[sceneKey]?.[timeKey] || map.town.day;
}

function applySceneBackground(sceneKey, timeKey) {
  if (!el.sceneBackgroundLayer) return;
  const background = getSceneBackgroundStyle(sceneKey, timeKey);
  el.sceneBackgroundLayer.style.background = background;
  el.sceneBackgroundLayer.className = `scene-background-layer time-${timeKey}`;
  el.sceneBackgroundLayer.setAttribute("data-scene", sceneKey);
  el.sceneBackgroundLayer.setAttribute("data-time", timeKey);
}

function renderActivityStats() {
  if (!el.activityList) return;
  const stats = state.player.activityStats;
  const skills = state.player.lifeSkills;
  const unlocks = state.player.unlocks;
  el.activityList.innerHTML = `
    <div class="stat-row"><strong>채집 숙련도</strong><span>${skills.gathering}</span></div>
    <div class="stat-row"><strong>낚시 숙련도</strong><span>${skills.fishing}</span></div>
    <div class="stat-row"><strong>농사 숙련도</strong><span>${skills.farming}</span></div>
    <div class="stat-row"><strong>채집 횟수</strong><span>${stats.gatheringCount}</span></div>
    <div class="stat-row"><strong>낚시 횟수</strong><span>${stats.fishingCount}</span></div>
    <div class="stat-row"><strong>수확 횟수</strong><span>${stats.farmingCount}</span></div>
    <div class="stat-row"><strong>사과 묘목 해금</strong><span>${unlocks.appleSeedUnlocked ? "완료" : "농사 5 필요"}</span></div>
    <div class="stat-row"><strong>황금 씨앗 해금</strong><span>${unlocks.goldenSeedUnlocked ? "완료" : "농사 10 필요"}</span></div>
  `;
}

function renderScene() {
  const scene = SCENE_META[currentScene] || SCENE_META.town;
  if (el.sceneTitle) el.sceneTitle.textContent = scene.title;
  if (el.sceneDescription) el.sceneDescription.textContent = scene.description;

  const mood = getTimeMood();
  document.body.classList.remove("time-dawn", "time-day", "time-evening", "time-night");
  document.body.classList.add(`time-${mood.key}`);

  if (el.sceneMoodBanner) el.sceneMoodBanner.textContent = mood.banner;
  if (el.timeVisualBadge) {
    el.timeVisualBadge.textContent = `${mood.label} 분위기 · ${scene.title}`;
    el.timeVisualBadge.className = `time-visual-badge time-${mood.key}`;
  }
  applySceneBackground(currentScene, mood.key);

  if (el.sceneDetail) {
    if (currentScene === "town") {
      el.sceneDetail.textContent = getSceneDetailText("town");
    } else if (currentScene === "farm") {
      el.sceneDetail.textContent = getSceneDetailText("farm");
    } else {
      const placedNames = getPlacedHousingNames();
      el.sceneDetail.textContent = placedNames.length
        ? `현재 집 안에는 ${placedNames.join(", ")}이(가) 배치되어 있습니다.`
        : "아직 집 안이 비어 있습니다. 가구를 배치하면 시간대에 따라 더 다른 집 분위기를 느낄 수 있습니다.";
    }
  }

  if (el.farmVisualStatus) {
    const farmStatus = getFarmStatus();
    el.farmVisualStatus.textContent = currentScene === "farm"
      ? `밭 시각화 · ${farmStatus.text}`
      : `밭 요약 · ${farmStatus.text}`;
  }

  if (el.homeVisualStatus) {
    const placedNames = getPlacedHousingNames();
    el.homeVisualStatus.textContent = getHomeSummaryText();
  }

  if (el.sceneSpotlightText) {
    if (currentScene === "town") {
      el.sceneSpotlightText.textContent = mood.key === "evening"
        ? "노을빛이 천천히 마을에 내려앉고 있습니다. 광장 전체가 따뜻한 주황빛으로 물들고 있습니다."
        : mood.key === "night"
          ? "고요한 밤공기가 마을을 감싸며 차분한 푸른빛이 광장에 번지고 있습니다."
          : mood.key === "dawn"
            ? "아침 햇살이 광장 가장자리를 부드럽게 밝히며 하루를 깨우고 있습니다."
            : "햇살이 넓게 퍼지며 광장 전체를 맑고 환하게 비추고 있습니다.";
    } else if (currentScene === "farm") {
      el.sceneSpotlightText.textContent = mood.key === "evening"
        ? "밭 주변이 노을빛으로 물들며 오늘의 수확을 정리하기 좋은 시간입니다."
        : mood.key === "night"
          ? "밭은 조용한 밤공기 아래 잠시 쉬어가고 있습니다."
          : mood.key === "dawn"
            ? "서늘한 아침 공기와 함께 밭이 천천히 빛을 받기 시작합니다."
            : "작물이 햇빛을 받으며 자라기 좋은 밝은 시간입니다.";
    } else {
      el.sceneSpotlightText.textContent = mood.key === "evening"
        ? "실내가 포근한 주황빛으로 물들며 쉬어가기 좋은 분위기가 만들어지고 있습니다."
        : mood.key === "night"
          ? "집 안이 차분하고 고요한 밤 분위기로 바뀌며 휴식에 더 잘 어울립니다."
          : mood.key === "dawn"
            ? "은은한 아침빛이 집 안을 부드럽게 비추기 시작합니다."
            : "실내가 따뜻하고 환한 낮 분위기로 유지되고 있습니다.";
    }
  }

  if (el.homeItemChips) {
    const placedNames = getPlacedHousingNames();
    el.homeItemChips.innerHTML = placedNames.length
      ? placedNames.map((name) => `<span class="mini-chip">${name}</span>`).join("")
      : '<span class="mini-chip">비어 있음</span>';
  }
}

export function renderStatus() {
  el.currentTime.textContent = state.ui.currentTime || "--:--";
  el.coinValue.textContent = `${state.player.coin}`;
  el.blingValue.textContent = `${state.player.bling}`;
  el.bgmTitle.textContent = getBgmLabelText();
  renderAuthPanel();
  el.timePeriodText.textContent = state.player.currentPeriodLabel || "시간대를 계산하는 중입니다.";
  el.bgmEnabled.checked = Boolean(state.player.settings.bgmEnabled);

  const life = state.player.lifeSkills;
  if (el.lifeSummary) el.lifeSummary.textContent = getLifeSummaryText();
  if (el.farmStatus) el.farmStatus.textContent = getFarmStatus().text;

  if (el.radioTrackTitle) {
    const radio = getRadioState();
    el.radioTrackTitle.textContent = radio.isRadioPlaying ? `현재 라디오: ${radio.title}` : "현재 라디오: 꺼짐";
  }

  renderScene();
  refreshHousingUI();
  renderAllM5Panels();
  applyMobilePanel();
  applyMobileBagTab();
  syncSceneButtons();
  syncSideTabs();
}

export function renderLog() {
  el.logList.innerHTML = "";
  for (const row of state.player.log) {
    const item = document.createElement("div");
    item.className = "log-item";
    item.innerHTML = `<small>${row.time}</small><div>${row.text}</div>`;
    el.logList.appendChild(item);
  }
}

export function renderAll() {
  renderStatus();
  renderInventory(el.inventoryList);
  renderShop(el.shopList);
  renderActivityStats();
  renderLog();
}
