import { state } from "./state.js";

function getHousingItems() {
  return state.data.items.filter((item) => item.type === "housing");
}

function getItemById(itemId) {
  return state.data.items.find((item) => item.id === itemId);
}

export function getOwnedHousingItems() {
  return getHousingItems().filter((item) => (state.player.inventory[item.id] || 0) > 0);
}

export function placeHousingItem(slotIndex, itemId) {
  if (slotIndex < 0 || slotIndex >= state.player.housing.slots.length) {
    return { ok: false, message: "잘못된 배치 위치입니다." };
  }

  if (!itemId) {
    return { ok: false, message: "배치할 가구를 선택해 주세요." };
  }

  const ownedCount = state.player.inventory[itemId] || 0;
  const alreadyPlaced = state.player.housing.slots.filter((id) => id === itemId).length;
  if (ownedCount <= alreadyPlaced) {
    const item = getItemById(itemId);
    return { ok: false, message: `${item?.name || "가구"}의 보유 수량이 부족합니다.` };
  }

  state.player.housing.slots[slotIndex] = itemId;
  const item = getItemById(itemId);
  return { ok: true, message: `${item?.name || "가구"}을(를) ${slotIndex + 1}번 칸에 배치했습니다.` };
}

export function clearHousingSlots() {
  state.player.housing.slots = [null, null, null, null];
  return { ok: true, message: "집 안 배치를 초기화했습니다." };
}

export function getHousingSummary() {
  const placed = state.player.housing.slots.filter(Boolean);
  if (placed.length === 0) {
    return "집 안이 비어 있습니다. 가구를 배치해 보세요.";
  }

  const names = placed
    .map((itemId) => getItemById(itemId)?.name || itemId)
    .join(", ");

  return `현재 배치된 가구: ${names}`;
}

export function renderHousingSlots(container) {
  if (!container) return;
  container.innerHTML = "";

  state.player.housing.slots.forEach((itemId, index) => {
    const slot = document.createElement("div");
    slot.className = "housing-slot";

    if (!itemId) {
      slot.innerHTML = `
        <strong>${index + 1}번 칸</strong>
        <div class="housing-empty">비어 있음</div>
      `;
    } else {
      const item = getItemById(itemId);
      slot.innerHTML = `
        <strong>${index + 1}번 칸</strong>
        <div>${item?.name || itemId}</div>
        <small>${item?.description || "설명 없음"}</small>
      `;
    }

    container.appendChild(slot);
  });
}

export function populateHousingItemSelect(selectEl) {
  if (!selectEl) return;
  const owned = getOwnedHousingItems();
  if (owned.length === 0) {
    selectEl.innerHTML = '<option value="">보유 중인 가구가 없습니다</option>';
    return;
  }

  selectEl.innerHTML = owned.map((item) => {
    const total = state.player.inventory[item.id] || 0;
    const placed = state.player.housing.slots.filter((id) => id === item.id).length;
    const available = Math.max(0, total - placed);
    return `<option value="${item.id}">${item.name} · 사용 가능 ${available}</option>`;
  }).join("");
}
