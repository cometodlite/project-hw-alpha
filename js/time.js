import { state } from "./state.js";
import { syncTrackWithTime } from "./audio.js";
import { renderAll } from "./ui.js";

function getPeriodFromSchedule(hour) {
  return state.data.bgmSchedule.find((entry) => {
    if (entry.startHour <= entry.endHour) {
      return hour >= entry.startHour && hour <= entry.endHour;
    }
    return hour >= entry.startHour || hour <= entry.endHour;
  });
}

function updateTime() {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();

  state.ui.currentTime = now.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit"
  });

  const period = getPeriodFromSchedule(hour);
  if (period) {
    state.player.currentPeriodLabel = `${period.label} 시간대입니다. ${period.description}`;
    syncTrackWithTime(period);
  }

  renderAll();
}

export function startClock() {
  updateTime();
  setInterval(updateTime, 1000 * 30);
}
