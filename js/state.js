export const DEFAULT_PLAYER_STATE = {
  coin: 500,
  bling: 30,
  freeBling: 30,
  paidBling: 0,
  inventory: {
    herb: 2,
    fish: 1,
    wheat: 3,
    carrot_seed: 2,
    wheat_seed: 2
  },
  housingNote: "",
  settings: {
    bgmEnabled: true
  },
  radioEnabled: false,
  radioTrackTitle: "",
  lifeSkills: {
    gathering: 1,
    fishing: 1,
    farming: 1
  },
  activityStats: {
    gatheringCount: 0,
    fishingCount: 0,
    farmingCount: 0
  },
  unlocks: {
    appleSeedUnlocked: false,
    goldenSeedUnlocked: false
  },
  housing: {
    slots: [null, null, null, null]
  },
  farmPlot: {
    plantedSeedId: null,
    plantedAt: null,
    readyAt: null
  },
  log: [
    {
      text: "PROJECT: HW에 오신 것을 환영합니다.",
      time: new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
    }
  ],
  currentPeriodLabel: "",
  currentTrackTitle: ""
};

export const state = {
  player: structuredClone(DEFAULT_PLAYER_STATE),
  ui: {
    currentTime: "",
    currentTrack: null,
    auth: {
      status: "checking",
      userId: null,
      publicUserCode: null,
      displayName: null,
      email: null
    },
    server: {
      apiBase: "",
      mode: "local",
      message: "로컬 저장"
    }
  },
  data: {
    items: [],
    shop: [],
    products: [],
    bgmSchedule: [],
    lifeTables: {}
  },
  meta: {
    dataFilesLoaded: false
  }
};

export function setDataFilesLoaded(value) {
  state.meta.dataFilesLoaded = value;
}

export function addLog(text) {
  state.player.log.unshift({
    text,
    time: new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
  });
  state.player.log = state.player.log.slice(0, 30);
}

export function updateCurrency({ coin = 0, bling = 0 }) {
  state.player.coin += coin;
  state.player.freeBling = (state.player.freeBling || 0) + bling;
  state.player.bling = (state.player.freeBling || 0) + (state.player.paidBling || 0);
}

export function setHousingNote(note) {
  state.player.housingNote = note;
}

export function setBgmEnabled(enabled) {
  state.player.settings.bgmEnabled = enabled;
}

export function increaseSkill(skillKey, amount = 1) {
  state.player.lifeSkills[skillKey] = (state.player.lifeSkills[skillKey] || 1) + amount;
}

export function increaseActivityCount(activityKey, amount = 1) {
  state.player.activityStats[activityKey] = (state.player.activityStats[activityKey] || 0) + amount;
}

export function syncUnlocks() {
  state.player.unlocks.appleSeedUnlocked = state.player.lifeSkills.farming >= 5;
  state.player.unlocks.goldenSeedUnlocked = state.player.lifeSkills.farming >= 10;
}
