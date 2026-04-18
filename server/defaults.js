export const DEFAULT_PLAYER_SAVE = {
  saveVersion: 1,
  schemaVersion: "2026-04-16",
  inventory: {
    herb: 2,
    fish: 1,
    wheat: 3,
    carrot_seed: 2,
    wheat_seed: 2
  },
  housing: {
    slots: [null, null, null, null]
  },
  unlocks: {
    appleSeedUnlocked: false,
    goldenSeedUnlocked: false
  },
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
  farmPlot: {
    plantedSeedId: null,
    plantedAt: null,
    readyAt: null
  }
};

export const DEFAULT_WALLET = {
  coin: 500,
  freeBling: 30,
  paidBling: 0
};
