// ============================================================
// room.js — Room lifecycle: create, join, leave, validate
// ============================================================

import {
  createRoom,
  findRoomByName,
  getRoom,
  addUser,
  removeUser,
  isUsernameTaken,
  getUsers,
  promoteNewAdmin,
  deleteRoom,
  roomRef,
} from "./firebase.js";
import {
  hashPassword,
  deriveKey,
  deriveExtractableKey,
  exportKeyBase64,
  importKeyBase64,
} from "./crypto.js";
import { onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── UUID helper ───────────────────────────────────────────────

export function generateId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });
}

// ── Session storage keys ──────────────────────────────────────

const SESSION_KEYS = {
  ROOM_ID: "vc_roomId",
  USER_ID: "vc_userId",
  USERNAME: "vc_username",
  IS_ADMIN: "vc_isAdmin",
};

export function saveSession(roomId, userId, username, isAdmin) {
  sessionStorage.setItem(SESSION_KEYS.ROOM_ID, roomId);
  sessionStorage.setItem(SESSION_KEYS.USER_ID, userId);
  sessionStorage.setItem(SESSION_KEYS.USERNAME, username);
  sessionStorage.setItem(SESSION_KEYS.IS_ADMIN, isAdmin ? "1" : "0");
}

export function loadSession() {
  return {
    roomId: sessionStorage.getItem(SESSION_KEYS.ROOM_ID),
    userId: sessionStorage.getItem(SESSION_KEYS.USER_ID),
    username: sessionStorage.getItem(SESSION_KEYS.USERNAME),
    isAdmin: sessionStorage.getItem(SESSION_KEYS.IS_ADMIN) === "1",
  };
}

export function clearSession() {
  Object.values(SESSION_KEYS).forEach((k) => sessionStorage.removeItem(k));
}

// ── Create Room ───────────────────────────────────────────────

/**
 * Create a new room and add the creator as admin.
 *
 * @param {string} roomName
 * @param {string} password
 * @param {string} username
 * @returns {{ roomId, userId, key }}  key is the derived CryptoKey
 */
export async function handleCreateRoom(roomName, password, username) {
  // Check name availability (optional — rooms are identified by ID,
  // but we enforce name uniqueness for UX)
  const existing = await findRoomByName(roomName);
  if (existing) throw new Error("A room with this name already exists.");

  const roomId = generateId();
  const userId = generateId();
  const passwordHash = await hashPassword(password);

  // Derive encryption key (non-extractable for normal use)
  const key = await deriveKey(password, roomId);

  // Persist room document
  await createRoom(roomId, {
    roomName,
    passwordHash,
    adminId: userId,
  });

  // Add creator as admin user
  await addUser(roomId, userId, { username, isAdmin: true });

  saveSession(roomId, userId, username, true);

  return { roomId, userId, key };
}

// ── Join Room ─────────────────────────────────────────────────

/**
 * Join an existing room by name + password.
 * Validates: room existence, password, username uniqueness.
 *
 * @param {string} roomName
 * @param {string} password
 * @param {string} username
 * @returns {{ roomId, userId, key }}
 */
export async function handleJoinRoom(roomName, password, username) {
  const room = await findRoomByName(roomName);
  if (!room) throw new Error("Room not found. Check the name and try again.");

  // Verify password
  const passwordHash = await hashPassword(password);
  if (room.passwordHash !== passwordHash)
    throw new Error("Wrong password. Try again.");

  // Enforce username uniqueness (race condition guard below)
  const taken = await isUsernameTaken(room.id, username);
  if (taken)
    throw new Error("Username already taken in this room. Choose another.");

  const userId = generateId();
  const key = await deriveKey(password, room.id);

  // Add user (double-check uniqueness just before writing)
  const takenAgain = await isUsernameTaken(room.id, username);
  if (takenAgain)
    throw new Error("Username was just taken. Choose another one.");

  await addUser(room.id, userId, { username, isAdmin: false });

  saveSession(room.id, userId, username, false);

  return { roomId: room.id, userId, key };
}

/**
 * Join a room via invite link (roomId + raw key already known).
 *
 * @param {string} roomId
 * @param {string} keyB64   - base64-encoded raw AES key
 * @param {string} username
 * @returns {{ roomId, userId, key }}
 */
export async function handleJoinViaLink(roomId, keyB64, username) {
  const room = await getRoom(roomId);
  if (!room || !room.isActive)
    throw new Error("This invite link is invalid or the room has ended.");

  const taken = await isUsernameTaken(roomId, username);
  if (taken) throw new Error("Username already taken. Choose another.");

  const userId = generateId();
  const key = await importKeyBase64(keyB64);

  await addUser(roomId, userId, { username, isAdmin: false });
  saveSession(roomId, userId, username, false);

  return { roomId, userId, key };
}

// ── Leave Room ────────────────────────────────────────────────

/**
 * A user leaves the room.
 * If they were admin, promote another user.
 * If they were the last user, delete the whole room.
 */
export async function handleLeaveRoom(roomId, userId, isAdmin) {
  const users = await getUsers(roomId);

  if (users.length <= 1) {
    // Last person out — delete everything
    await deleteRoom(roomId);
  } else if (isAdmin) {
    // Remove admin, promote someone else
    await removeUser(roomId, userId);
    await promoteNewAdmin(roomId);
  } else {
    await removeUser(roomId, userId);
  }

  clearSession();
}

// ── Generate Invite Link ──────────────────────────────────────

/**
 * Build a shareable invite URL that carries the roomId and
 * encrypted key so recipients only need to enter a username.
 *
 * @param {string} password  - Original room password
 * @param {string} roomId
 * @returns {string}  Full invite URL
 */
export async function generateInviteLink(password, roomId) {
  const extractableKey = await deriveExtractableKey(password, roomId);
  const keyB64 = await exportKeyBase64(extractableKey);

  // URL-safe base64
  const encodedKey = encodeURIComponent(keyB64);
  const baseUrl = window.location.origin + "/chat.html";
  return `${baseUrl}?roomId=${roomId}&key=${encodedKey}`;
}

/**
 * Parse invite link params from the current URL.
 * Returns { roomId, keyB64 } or null.
 */
export function parseInviteLink() {
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get("roomId");
  const key = params.get("key");
  if (roomId && key) return { roomId, keyB64: decodeURIComponent(key) };
  return null;
}

// ── Watch for room deletion ───────────────────────────────────

/**
 * Watch the room document for deletion or deactivation.
 * Calls onEnded() if the room disappears or isActive becomes false.
 */
export function watchRoomStatus(roomId, onEnded) {
  return onSnapshot(roomRef(roomId), (snap) => {
    if (!snap.exists() || snap.data()?.isActive === false) {
      onEnded();
    }
  });
}
