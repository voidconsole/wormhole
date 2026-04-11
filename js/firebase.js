// ============================================================
// firebase.js — Firebase initialization & helper exports
// Storage-free: files are stored as encrypted base64 in Firestore.
// Replace firebaseConfig with your own from console.firebase.google.com
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
	getFirestore,
	collection,
	doc,
	getDoc,
	getDocs,
	setDoc,
	addDoc,
	updateDoc,
	deleteDoc,
	onSnapshot,
	query,
	where,
	orderBy,
	serverTimestamp,
	writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";


const firebaseConfig = {
	apiKey: "__FIREBASE_API_KEY__",
	authDomain: "__FIREBASE_AUTH_DOMAIN__",
	projectId: "__FIREBASE_PROJECT_ID__",
	storageBucket: "",
	messagingSenderId: "__FIREBASE_MESSAGING_SENDER_ID__",
	appId: "__FIREBASE_APP_ID__",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// ── Refs ──────────────────────────────────────────────────────

export const roomRef = (roomId) => doc(db, "rooms", roomId);
export const usersCol = (roomId) => collection(db, "rooms", roomId, "users");
export const messagesCol = (roomId) => collection(db, "rooms", roomId, "messages");
export const userRef = (roomId, userId) => doc(db, "rooms", roomId, "users", userId);

// ── Room CRUD ─────────────────────────────────────────────────

export async function createRoom(roomId, data) {
	await setDoc(roomRef(roomId), {
		roomName: data.roomName,
		passwordHash: data.passwordHash,
		createdAt: serverTimestamp(),
		adminId: data.adminId,
		isActive: true,
	});
}

export async function getRoom(roomId) {
	const snap = await getDoc(roomRef(roomId));
	return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function findRoomByName(roomName) {
	const q = query(
		collection(db, "rooms"),
		where("roomName", "==", roomName),
		where("isActive", "==", true)
	);
	const snap = await getDocs(q);
	if (snap.empty) return null;
	const d = snap.docs[0];
	return { id: d.id, ...d.data() };
}

// ── User CRUD ─────────────────────────────────────────────────

export async function addUser(roomId, userId, data) {
	await setDoc(userRef(roomId, userId), {
		username: data.username,
		joinedAt: serverTimestamp(),
		isAdmin: data.isAdmin || false,
	});
}

export async function removeUser(roomId, userId) {
	await deleteDoc(userRef(roomId, userId));
}

export async function isUsernameTaken(roomId, username) {
	const q = query(usersCol(roomId), where("username", "==", username));
	const snap = await getDocs(q);
	return !snap.empty;
}

export async function getUsers(roomId) {
	const snap = await getDocs(usersCol(roomId));
	return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function promoteNewAdmin(roomId) {
	const q = query(usersCol(roomId), orderBy("joinedAt", "asc"));
	const snap = await getDocs(q);
	if (snap.empty) return null;
	const newAdmin = snap.docs[0];
	await updateDoc(userRef(roomId, newAdmin.id), { isAdmin: true });
	await updateDoc(roomRef(roomId), { adminId: newAdmin.id });
	return newAdmin.id;
}

// ── Message CRUD ──────────────────────────────────────────────

/**
 * Store an encrypted message.
 *
 * For type "text":
 *   encryptedContent = encrypt(plaintext string)
 *
 * For type "image" or "file":
 *   encryptedContent = encrypt(JSON.stringify({
 *     name: string,
 *     mimeType: string,
 *     data: base64DataUrl   // the file bytes
 *   }))
 *
 * Firestore doc limit is 1 MiB. Images must be compressed before
 * calling this. Text files should be < 700 KB.
 */
export async function sendMessage(roomId, data) {
	return addDoc(messagesCol(roomId), {
		sender: data.sender,
		encryptedContent: data.encryptedContent,
		type: data.type || "text",
		createdAt: serverTimestamp(),
	});
}

/**
 * Real-time listener for new messages.
 * Calls callback with an array of change objects:
 *   { changeType, id, sender, encryptedContent, contentType, createdAt }
 */
export function listenMessages(roomId, callback) {
	const q = query(messagesCol(roomId), orderBy("createdAt", "asc"));
	return onSnapshot(q, (snap) => {
		const changes = snap.docChanges().map((change) => ({
			changeType: change.type,                    // "added" | "modified" | "removed"
			id: change.doc.id,
			sender: change.doc.data().sender,
			encryptedContent: change.doc.data().encryptedContent,
			contentType: change.doc.data().type,         // "text" | "image" | "file"
			createdAt: change.doc.data().createdAt,
		}));
		callback(changes);
	});
}

/** Real-time listener for users in a room */
export function listenUsers(roomId, callback) {
	return onSnapshot(usersCol(roomId), (snap) => {
		callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
	});
}

// ── Deletion ──────────────────────────────────────────────────

/** Delete messages → users → room doc */
export async function deleteRoom(roomId) {
	await deleteSubcollection(`rooms/${roomId}/messages`);
	await deleteSubcollection(`rooms/${roomId}/users`);
	await deleteDoc(roomRef(roomId));
}

async function deleteSubcollection(path) {
	const snap = await getDocs(collection(db, path));
	if (snap.empty) return;
	// Batch in chunks of 499 (Firestore limit is 500 ops per batch)
	for (let i = 0; i < snap.docs.length; i += 499) {
		const batch = writeBatch(db);
		snap.docs.slice(i, i + 499).forEach((d) => batch.delete(d.ref));
		await batch.commit();
	}
}