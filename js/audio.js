import { state, addLog } from "./state.js";

let currentTrackId = null;
let loadedBgmTrackId = null;
let bgmAudio = null;
let radioAudio = null;
let isRadioPlaying = false;

function createAudio(src, loop = true, volume = 0.7) {
  const audio = new Audio(src);
  audio.loop = loop;
  audio.volume = volume;
  return audio;
}

function fadeAudio(audio, targetVolume, duration = 800) {
  if (!audio) return;
  const startVolume = Number(audio.volume || 0);
  const stepTime = 50;
  const steps = Math.max(1, Math.floor(duration / stepTime));
  let currentStep = 0;

  const timer = setInterval(() => {
    currentStep += 1;
    const nextVolume = startVolume + ((targetVolume - startVolume) * currentStep / steps);
    audio.volume = Math.max(0, Math.min(1, nextVolume));
    if (currentStep >= steps) clearInterval(timer);
  }, stepTime);
}

export function initAudio() {
  radioAudio = createAudio("./assets/audio/radio/dive-divers.mp3", true, 0.85);
}

function ensureBgmAudio(period) {
  const trackPath = period.file || null;
  if (!trackPath) return null;

  if (!bgmAudio || loadedBgmTrackId !== period.id) {
    if (bgmAudio) {
      bgmAudio.pause();
      bgmAudio.currentTime = 0;
    }
    bgmAudio = createAudio(trackPath, true, 0.45);
    loadedBgmTrackId = period.id;
  }

  return bgmAudio;
}

export function syncTrackWithTime(period) {
  if (!state.player.settings.bgmEnabled) {
    state.player.currentTrackTitle = "";
    currentTrackId = null;
    if (bgmAudio) {
      bgmAudio.pause();
      bgmAudio.currentTime = 0;
    }
    return;
  }

  if (currentTrackId !== period.id) {
    currentTrackId = period.id;
    state.player.currentTrackTitle = period.title;
    addLog(`배경음이 "${period.title}"(으)로 변경되었습니다.`);
  }

  const audio = ensureBgmAudio(period);
  if (!audio || isRadioPlaying) return;

  if (audio.paused) {
    audio.volume = 0.45;
    audio.play().catch(() => {});
  }
}

export function playRadio() {
  if (!radioAudio) return;

  isRadioPlaying = true;
  state.player.radioTrackTitle = "DIVE DIVERS";
  state.player.radioEnabled = true;

  if (bgmAudio && !bgmAudio.paused) {
    fadeAudio(bgmAudio, 0.08, 700);
  }

  radioAudio.currentTime = 0;
  radioAudio.volume = 0.0;
  radioAudio.play().catch(() => {});
  fadeAudio(radioAudio, 0.85, 900);
  addLog('라디오에서 "DIVE DIVERS"가 재생됩니다.');
}

export function stopRadio() {
  if (!radioAudio) return;

  isRadioPlaying = false;
  state.player.radioTrackTitle = "";
  state.player.radioEnabled = false;

  if (!radioAudio.paused) {
    fadeAudio(radioAudio, 0.0, 500);
    window.setTimeout(() => {
      radioAudio.pause();
      radioAudio.currentTime = 0;
    }, 550);
  }

  if (bgmAudio && state.player.settings.bgmEnabled) {
    bgmAudio.volume = 0.0;
    bgmAudio.play().catch(() => {});
    fadeAudio(bgmAudio, 0.45, 700);
  }

  addLog("라디오를 정지했습니다.");
}

export function getRadioState() {
  return {
    isRadioPlaying,
    title: state.player.radioTrackTitle || ""
  };
}
