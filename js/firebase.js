import { state } from "./state.js";

const FIREBASE_SDK_VERSION = "12.12.0";
const FIREBASE_CONFIG_STORAGE_KEY = "project-hw-firebase-config";
const PLAYER_STATES_COLLECTION = "player_states";
const USERS_COLLECTION = "users";

let firebaseContextPromise = null;
let firebaseModulesPromise = null;
let initialAuthPromise = null;

function getFirebaseConfig() {
  const fromWindow = globalThis.HW_FIREBASE_CONFIG;
  const fromStorage = readStoredConfig();
  const config = fromStorage || fromWindow || null;
  if (!config || typeof config !== "object") return null;
  const normalized = {
    apiKey: String(config.apiKey || "").trim(),
    authDomain: String(config.authDomain || "").trim(),
    projectId: String(config.projectId || "").trim(),
    storageBucket: String(config.storageBucket || "").trim(),
    messagingSenderId: String(config.messagingSenderId || "").trim(),
    appId: String(config.appId || "").trim(),
    measurementId: String(config.measurementId || "").trim()
  };
  if (!normalized.apiKey || !normalized.authDomain || !normalized.projectId || !normalized.appId) {
    return null;
  }
  return normalized;
}

function readStoredConfig() {
  try {
    const raw = globalThis.localStorage?.getItem(FIREBASE_CONFIG_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn(error);
    return null;
  }
}

export function isFirebaseConfigured() {
  return Boolean(getFirebaseConfig());
}

async function getFirebaseModules() {
  if (!firebaseModulesPromise) {
    firebaseModulesPromise = Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-firestore.js`)
    ]).then(([app, auth, firestore]) => ({ app, auth, firestore }));
  }
  return firebaseModulesPromise;
}

async function getFirebaseContext() {
  const config = getFirebaseConfig();
  if (!config) return null;
  if (!firebaseContextPromise) {
    firebaseContextPromise = getFirebaseModules().then((modules) => {
      const firebaseApp = modules.app.getApps().length
        ? modules.app.getApps()[0]
        : modules.app.initializeApp(config);
      return {
        modules,
        auth: modules.auth.getAuth(firebaseApp),
        db: modules.firestore.getFirestore(firebaseApp)
      };
    });
  }
  return firebaseContextPromise;
}

async function getCurrentUser() {
  const context = await getFirebaseContext();
  if (!context) return null;
  if (context.auth.currentUser) return context.auth.currentUser;
  if (!initialAuthPromise) {
    initialAuthPromise = new Promise((resolve) => {
      const unsubscribe = context.modules.auth.onAuthStateChanged(
        context.auth,
        (user) => {
          unsubscribe();
          resolve(user || null);
        },
        () => {
          unsubscribe();
          resolve(null);
        }
      );
    });
  }
  await initialAuthPromise;
  return context.auth.currentUser || null;
}

function authFromFirebaseUser(user) {
  if (!user) return { status: "guest", provider: "firebase" };
  return {
    status: "authenticated",
    provider: "firebase",
    userId: user.uid,
    publicUserCode: user.uid.slice(0, 8).toUpperCase(),
    displayName: user.displayName || "",
    email: user.email || ""
  };
}

function buildSnapshotFromState() {
  const freeBling = Number(state.player.freeBling || 0);
  const paidBling = Number(state.player.paidBling || 0);
  return {
    wallet: {
      coin: Number(state.player.coin || 0),
      freeBling,
      paidBling,
      bling: freeBling + paidBling
    },
    playerState: {
      inventory: state.player.inventory || {},
      housing: state.player.housing || { slots: [null, null, null, null] },
      unlocks: state.player.unlocks || {},
      lifeSkills: state.player.lifeSkills || {},
      activityStats: state.player.activityStats || {},
      farmPlot: state.player.farmPlot || {}
    }
  };
}

function normalizeFirebaseSnapshot(data) {
  const snapshot = data || {};
  const wallet = snapshot.wallet || {};
  const playerState = snapshot.playerState || {};
  const freeBling = Number(wallet.freeBling || 0);
  const paidBling = Number(wallet.paidBling || 0);
  return {
    wallet: {
      coin: Number(wallet.coin || 0),
      freeBling,
      paidBling,
      bling: Number.isFinite(Number(wallet.bling)) ? Number(wallet.bling) : freeBling + paidBling
    },
    playerState: {
      inventory: playerState.inventory || {},
      housing: playerState.housing || { slots: [null, null, null, null] },
      unlocks: playerState.unlocks || {},
      lifeSkills: playerState.lifeSkills || {},
      activityStats: playerState.activityStats || {},
      farmPlot: playerState.farmPlot || {}
    }
  };
}

async function upsertUserProfile(user, displayName = "") {
  const context = await getFirebaseContext();
  if (!context || !user) return;
  const { firestore } = context.modules;
  await firestore.setDoc(
    firestore.doc(context.db, USERS_COLLECTION, user.uid),
    {
      email: user.email || "",
      displayName: displayName || user.displayName || "",
      updatedAt: firestore.serverTimestamp()
    },
    { merge: true }
  );
}

async function ensurePlayerState(user) {
  const context = await getFirebaseContext();
  if (!context || !user) return null;
  const { firestore } = context.modules;
  const ref = firestore.doc(context.db, PLAYER_STATES_COLLECTION, user.uid);
  const existing = await firestore.getDoc(ref);
  if (existing.exists()) {
    return normalizeFirebaseSnapshot(existing.data());
  }
  const snapshot = buildSnapshotFromState();
  await firestore.setDoc(ref, {
    ...snapshot,
    createdAt: firestore.serverTimestamp(),
    updatedAt: firestore.serverTimestamp()
  });
  return snapshot;
}

async function finishFirebaseAuth(user, displayName = "") {
  await upsertUserProfile(user, displayName);
  const snapshot = await ensurePlayerState(user);
  return {
    auth: authFromFirebaseUser(user),
    ...snapshot
  };
}

export async function getFirebaseAuthState() {
  const user = await getCurrentUser();
  return authFromFirebaseUser(user);
}

export async function registerFirebaseAccount({ email, password, displayName }) {
  const context = await getFirebaseContext();
  if (!context) throw new Error("Firebase is not configured");
  const credential = await context.modules.auth.createUserWithEmailAndPassword(
    context.auth,
    email,
    password
  );
  if (displayName) {
    await context.modules.auth.updateProfile(credential.user, { displayName });
  }
  return finishFirebaseAuth(credential.user, displayName);
}

export async function loginFirebaseAccount({ email, password }) {
  const context = await getFirebaseContext();
  if (!context) throw new Error("Firebase is not configured");
  const credential = await context.modules.auth.signInWithEmailAndPassword(
    context.auth,
    email,
    password
  );
  return finishFirebaseAuth(credential.user);
}

export async function loginFirebaseWithGoogle() {
  const context = await getFirebaseContext();
  if (!context) throw new Error("Firebase is not configured");
  const provider = new context.modules.auth.GoogleAuthProvider();
  const credential = await context.modules.auth.signInWithPopup(context.auth, provider);
  return finishFirebaseAuth(credential.user);
}

export async function logoutFirebaseAccount() {
  const context = await getFirebaseContext();
  if (!context) return { auth: { status: "guest" } };
  await context.modules.auth.signOut(context.auth);
  return { auth: { status: "guest", provider: "firebase" } };
}

export async function loadFirebasePlayerState() {
  const user = await getCurrentUser();
  if (!user) return false;
  return ensurePlayerState(user);
}

export async function saveFirebasePlayerState() {
  const context = await getFirebaseContext();
  const user = await getCurrentUser();
  if (!context || !user) return false;
  const { firestore } = context.modules;
  const snapshot = buildSnapshotFromState();
  await firestore.setDoc(
    firestore.doc(context.db, PLAYER_STATES_COLLECTION, user.uid),
    {
      ...snapshot,
      updatedAt: firestore.serverTimestamp()
    },
    { merge: true }
  );
  return snapshot;
}

export async function restoreFirebaseState() {
  return loadFirebasePlayerState();
}
