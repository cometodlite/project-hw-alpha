import { state, setDataFilesLoaded } from "./js/state.js";
import { initUI, bindUIEvents, renderAll } from "./js/ui.js";
import { loadGame } from "./js/save.js";
import { startClock } from "./js/time.js";
import { initAudio } from "./js/audio.js";
import { initInventory } from "./js/inventory.js";
import { initShop, syncServerProducts } from "./js/shop.js";

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`데이터를 불러오지 못했습니다: ${path}`);
  }
  return response.json();
}

async function bootstrap() {
  try {
    const [items, shop, bgmSchedule, lifeTables] = await Promise.all([
      loadJson("./data/items.json?v=20260419h"),
      loadJson("./data/shop.json?v=20260419h"),
      loadJson("./data/bgmSchedule.json?v=20260419h"),
      loadJson("./data/lifeTables.json?v=20260419h")
    ]);

    state.data.items = items;
    state.data.shop = shop;
    state.data.bgmSchedule = bgmSchedule;
    state.data.lifeTables = lifeTables;
    setDataFilesLoaded(true);

    await loadGame();
    await syncServerProducts();
    initUI();
    initInventory();
    initShop();
    initAudio();
    bindUIEvents();
    startClock();
    renderAll();
  } catch (error) {
    console.error(error);
    document.body.innerHTML = `
      <main style="padding:24px;font-family:sans-serif;">
        <h1>PROJECT: HW</h1>
        <p>초기화 중 오류가 발생했습니다.</p>
        <pre>${error.message}</pre>
      </main>
    `;
  }
}

bootstrap();
