// ============================================================
// chat.js — Messaging, file handling (base64), admin, save chat
//
// No Firebase Storage used. Files are:
//   1. Compressed (images) or size-checked (other files)
//   2. Read as base64 data URL
//   3. Wrapped in JSON: { name, mimeType, data }
//   4. Encrypted with the room key
//   5. Stored directly in the Firestore message document
//
// Firestore document limit: 1 MiB.
// Images are compressed to stay comfortably under that.
// Non-image files are capped at MAX_FILE_BYTES.
// ============================================================

import {
	sendMessage,
	listenMessages,
	listenUsers,
	messagesCol,
	removeUser,
	deleteRoom,
} from "./firebase.js";
import { encrypt, decrypt } from "./crypto.js";
import { handleLeaveRoom } from "./room.js";
import { renderMessage, renderUserList, showToast, showModal } from "./ui.js";
import { getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Max size for non-image files after base64 encoding.
// base64 expands by ~33%, so this gives ~525 KB raw payload —
// well inside the 1 MiB Firestore document limit when encrypted.
const MAX_FILE_BYTES = 700 * 1024; // 700 KB raw

// Image compression targets
const IMG_MAX_DIM = 1024; // max width or height in px
const IMG_QUALITY = 0.78; // JPEG quality

// Rate limiting
const MSG_COOLDOWN_MS = 500;
let lastMessageTime = 0;

// ── Module state ──────────────────────────────────────────────

let _roomId = null;
let _userId = null;
let _username = null;
let _isAdmin = false;
let _key = null;
let _password = null;

let _unsubMessages = null;
let _unsubUsers = null;
let _currentUsers = [];

// ── Init / teardown ───────────────────────────────────────────

export function initChat({ roomId, userId, username, isAdmin, key, password }) {
	_roomId = roomId;
	_userId = userId;
	_username = username;
	_isAdmin = isAdmin;
	_key = key;
	_password = password;

	_unsubMessages = listenMessages(roomId, onMessagesChange);
	_unsubUsers = listenUsers(roomId, onUsersChange);
}

export function destroyChat() {
	if (_unsubMessages) { _unsubMessages(); _unsubMessages = null; }
	if (_unsubUsers) { _unsubUsers(); _unsubUsers = null; }
}

// ── Incoming messages ─────────────────────────────────────────

async function onMessagesChange(changes) {
	for (const change of changes) {
		if (change.changeType !== "added") continue;

		const plain = await decrypt(change.encryptedContent, _key);
		if (plain === null) continue; // wrong key or corruption — skip

		renderMessage({
			id: change.id,
			sender: change.sender,
			content: plain,
			contentType: change.contentType,  // "text" | "image" | "file"
			isSelf: change.sender === _username,
			timestamp: change.createdAt,
		});
	}
}

// ── Sending: text ─────────────────────────────────────────────

export async function sendTextMessage(text) {
	text = text.trim();
	if (!text) return;

	const now = Date.now();
	if (now - lastMessageTime < MSG_COOLDOWN_MS) {
		showToast("Slow down a little.", "warn");
		return;
	}
	lastMessageTime = now;

	const encrypted = await encrypt(text, _key);
	await sendMessage(_roomId, {
		sender: _username,
		encryptedContent: encrypted,
		type: "text",
	});
}

// ── Sending: files ────────────────────────────────────────────

/**
 * Route a File to the correct handler based on MIME type.
 */
export async function sendFileAuto(file) {
	const mime = file.type;
	if (mime.startsWith("image/")) return _sendImage(file);
	return _sendGenericFile(file);
}

/** Compress an image, encode as base64, encrypt, store in Firestore */
async function _sendImage(file) {
	showToast("Compressing image…", "info");
	let blob;
	try {
		blob = await compressImage(file, IMG_MAX_DIM, IMG_QUALITY);
	} catch {
		showToast("Could not process image.", "error");
		return;
	}

	if (blob.size > MAX_FILE_BYTES) {
		showToast(`Image too large even after compression (max ~700 KB).`, "error");
		return;
	}

	const dataUrl = await blobToDataUrl(blob);
	const payload = JSON.stringify({ name: file.name, mimeType: "image/jpeg", data: dataUrl });
	const encrypted = await encrypt(payload, _key);

	await sendMessage(_roomId, {
		sender: _username,
		encryptedContent: encrypted,
		type: "image",
	});
}

/** Read a non-image file as base64, check size, encrypt, store */
async function _sendGenericFile(file) {
	if (file.size > MAX_FILE_BYTES) {
		showToast(
			`File too large. Max size is ~700 KB on the free tier.`,
			"error"
		);
		return;
	}

	showToast("Sending file…", "info");
	const dataUrl = await fileToDataUrl(file);
	const payload = JSON.stringify({ name: file.name, mimeType: file.type || "application/octet-stream", data: dataUrl });
	const encrypted = await encrypt(payload, _key);

	await sendMessage(_roomId, {
		sender: _username,
		encryptedContent: encrypted,
		type: "file",
	});
}

// ── Image compression ─────────────────────────────────────────

function compressImage(file, maxDim, quality) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		const url = URL.createObjectURL(file);
		img.onload = () => {
			URL.revokeObjectURL(url);
			let { width, height } = img;
			if (width > maxDim || height > maxDim) {
				const scale = maxDim / Math.max(width, height);
				width = Math.round(width * scale);
				height = Math.round(height * scale);
			}
			const canvas = document.createElement("canvas");
			canvas.width = width;
			canvas.height = height;
			canvas.getContext("2d").drawImage(img, 0, 0, width, height);
			canvas.toBlob(
				(blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob failed"))),
				"image/jpeg",
				quality
			);
		};
		img.onerror = reject;
		img.src = url;
	});
}

function blobToDataUrl(blob) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result);
		reader.onerror = reject;
		reader.readAsDataURL(blob);
	});
}

function fileToDataUrl(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result);
		reader.onerror = reject;
		reader.readAsDataURL(file);
	});
}

// ── Users ─────────────────────────────────────────────────────

function onUsersChange(users) {
	_currentUsers = users;
	renderUserList(users, _userId, _isAdmin, kickUser);
}

// ── Admin controls ────────────────────────────────────────────

export async function kickUser(targetUserId) {
	if (!_isAdmin) return;
	const target = _currentUsers.find((u) => u.id === targetUserId);
	if (!target) return;
	showModal(
		`Kick ${target.username}?`,
		"They will be removed from this room.",
		async () => {
			await removeUser(_roomId, targetUserId);
			showToast(`${target.username} was removed.`, "info");
		}
	);
}

export async function endSession() {
	if (!_isAdmin) return;
	showModal(
		"End session?",
		"This permanently deletes the room and all messages for everyone.",
		async () => {
			await deleteRoom(_roomId);
			// watchRoomStatus in chat.html will navigate everyone away
		}
	);
}

export async function leaveRoom() {
	showModal("Leave room?", "You will exit this chat session.", async () => {
		destroyChat();
		await handleLeaveRoom(_roomId, _userId, _isAdmin);
		window.location.href = "index.html";
	});
}

// ── Save chat ─────────────────────────────────────────────────

export async function saveChat(roomName) {
	showToast("Preparing export…", "info");

	const snap = await getDocs(messagesCol(_roomId));
	const messages = [];

	for (const d of snap.docs) {
		const data = d.data();
		const plain = await decrypt(data.encryptedContent, _key);

		let entry = {
			id: d.id,
			sender: data.sender,
			type: data.type,
			timestamp: data.createdAt?.toDate?.()?.toISOString() ?? null,
		};

		if (data.type === "text") {
			entry.content = plain ?? "[decryption failed]";
		} else if (plain) {
			try {
				const parsed = JSON.parse(plain);
				entry.fileName = parsed.name;
				entry.mimeType = parsed.mimeType;
				// Omit the base64 data from the export to keep file size sane
				entry.note = "File data omitted from export. Re-download from chat if needed.";
			} catch {
				entry.content = plain;
			}
		} else {
			entry.content = "[decryption failed]";
		}

		messages.push(entry);
	}

	const payload = JSON.stringify({ roomName, exportedAt: new Date().toISOString(), messages }, null, 2);
	const blob = new Blob([payload], { type: "application/json" });
	const a = document.createElement("a");
	a.href = URL.createObjectURL(blob);
	a.download = `chat-${roomName}-${Date.now()}.json`;
	a.click();
	URL.revokeObjectURL(a.href);
	showToast("Chat exported!", "success");
}

// ── Expose internals for chat.html ────────────────────────────

export const getPassword = () => _password;
export const getRoomId = () => _roomId;