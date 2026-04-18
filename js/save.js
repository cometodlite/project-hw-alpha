import { state, DEFAULT_PLAYER_STATE, addLog, syncUnlocks } from "./state.js";
import { loadServerPlayerState, saveServerPlayerState } from "./api.js";

const SAVE_KEY = "project-hw-save-v4";

export async function saveGame() {
  localStorage.setItem(SAVE_KEY, JSON.stringify(state.player));
  try {
    const savedToServer = await saveServerPlayerState();
    addLog(savedToServer ? "서버 저장이 완료되었습니다." : "저장이 완료되었습니다.");
  } catch (error) {
    console.warn(error);
    addLog("서버 저장에 실패해 로컬에 저장했습니다.");
  }
}

export async function loadGame() {
  try {
    const loadedFromServer = await loadServerPlayerState();
    if (loadedFromServer) {
      syncUnlocks();
      addLog("서버 저장 데이터를 불러왔습니다.");
      return;
    }
  } catch (error) {
    console.warn(error);
  }

  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) {
    syncUnlocks();
    addLog("저장된 데이터가 없어 기본 상태로 시작합니다.");
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    state.player = {
      ...structuredClone(DEFAULT_PLAYER_STATE),
      ...parsed,
      settings: {
        ...DEFAULT_PLAYER_STATE.settings,
        ...(parsed.settings || {})
      },
      inventory: {
        ...DEFAULT_PLAYER_STATE.inventory,
        ...(parsed.inventory || {})
      },
      lifeSkills: {
        ...DEFAULT_PLAYER_STATE.lifeSkills,
        ...(parsed.lifeSkills || {})
      },
      activityStats: {
        ...DEFAULT_PLAYER_STATE.activityStats,
        ...(parsed.activityStats || {})
      },
      unlocks: {
        ...DEFAULT_PLAYER_STATE.unlocks,
        ...(parsed.unlocks || {})
      },
      housing: {
        ...DEFAULT_PLAYER_STATE.housing,
        ...(parsed.housing || {}),
        slots: Array.isArray(parsed?.housing?.slots)
          ? parsed.housing.slots.slice(0, 4).concat(Array(Math.max(0, 4 - parsed.housing.slots.length)).fill(null))
          : structuredClone(DEFAULT_PLAYER_STATE.housing.slots)
      },
      farmPlot: {
        ...DEFAULT_PLAYER_STATE.farmPlot,
        ...(parsed.farmPlot || {})
      }
    };
    if (parsed.freeBling == null && Number.isFinite(parsed.bling)) {
      state.player.freeBling = parsed.bling;
    }
    state.player.freeBling = Number(state.player.freeBling || 0);
    state.player.paidBling = Number(state.player.paidBling || 0);
    state.player.bling = state.player.freeBling + state.player.paidBling;
    syncUnlocks();
    addLog("저장 데이터를 불러왔습니다.");
  } catch (error) {
    console.error(error);
    syncUnlocks();
    addLog("저장 데이터를 불러오지 못해 기본 상태를 유지합니다.");
  }
}

export function resetGame() {
  localStorage.removeItem(SAVE_KEY);
  state.player = structuredClone(DEFAULT_PLAYER_STATE);
  syncUnlocks();
  addLog("새 게임 상태로 초기화했습니다.");
}
