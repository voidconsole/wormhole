// ============================================================
// crypto.js — Client-side AES-GCM encryption via Web Crypto API
//
// Flow:
//   password ──PBKDF2──► CryptoKey ──AES-GCM──► encrypted blob
//   encrypted blob ──AES-GCM──► plaintext
//
// Firebase stores ONLY encrypted blobs. No plaintext ever leaves
// the client.
// ============================================================

const PBKDF2_ITERATIONS = 310_000; // NIST recommended minimum (2023)
const KEY_LENGTH = 256; // AES-256
const SALT_BYTES = 16;
const IV_BYTES = 12; // AES-GCM recommended

// ── Key derivation ─────────────────────────────────────────────

/**
 * Derive a deterministic AES-GCM CryptoKey from a room password.
 * The salt is derived from the roomId so that clients sharing the
 * same roomId + password will always arrive at the same key.
 *
 * @param {string} password  - Room password entered by user
 * @param {string} roomId    - Room identifier (used as salt source)
 * @returns {CryptoKey}
 */
export async function deriveKey(password, roomId) {
  const enc = new TextEncoder();

  // Import the raw password as key material
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  // Use SHA-256 of the roomId as the salt (deterministic, 32 bytes)
  const saltSource = enc.encode(`voidchat:${roomId}`);
  const saltHash = await crypto.subtle.digest("SHA-256", saltSource);

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltHash,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: KEY_LENGTH },
    false, // not extractable
    ["encrypt", "decrypt"]
  );
}

/**
 * Export a CryptoKey as a base64 raw key string.
 * Used for embedding in invite links (one-time export allowed
 * only when the key is created as extractable = true).
 */
export async function exportKeyBase64(key) {
  const raw = await crypto.subtle.exportKey("raw", key);
  return bufToBase64(raw);
}

/**
 * Import a base64 raw key string back into a CryptoKey.
 * Used when joining via an invite link that carries the raw key.
 */
export async function importKeyBase64(b64) {
  const raw = base64ToBuf(b64);
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM", length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Derive an EXTRACTABLE key from a password (for invite links).
 * Same algorithm as deriveKey but marked extractable = true.
 */
export async function deriveExtractableKey(password, roomId) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const saltSource = enc.encode(`voidchat:${roomId}`);
  const saltHash = await crypto.subtle.digest("SHA-256", saltSource);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltHash,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: KEY_LENGTH },
    true, // extractable for invite link embedding
    ["encrypt", "decrypt"]
  );
}

// ── Encryption ────────────────────────────────────────────────

/**
 * Encrypt a plaintext string using AES-GCM.
 * Returns a base64-encoded string of: [IV (12 bytes) | ciphertext]
 *
 * @param {string}     plaintext
 * @param {CryptoKey}  key
 * @returns {string}   base64 encoded IV+ciphertext
 */
export async function encrypt(plaintext, key) {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));

  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plaintext)
  );

  // Prepend IV so the receiver can extract it
  const combined = new Uint8Array(iv.byteLength + cipherBuf.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuf), iv.byteLength);

  return bufToBase64(combined.buffer);
}

/**
 * Decrypt a base64-encoded AES-GCM ciphertext.
 *
 * @param {string}    cipherB64  - base64 encoded IV+ciphertext
 * @param {CryptoKey} key
 * @returns {string}  plaintext string, or null on failure
 */
export async function decrypt(cipherB64, key) {
  try {
    const combined = base64ToBuf(cipherB64);
    const iv = combined.slice(0, IV_BYTES);
    const data = combined.slice(IV_BYTES);

    const plainBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      data
    );

    return new TextDecoder().decode(plainBuf);
  } catch (e) {
    console.error("[crypto] Decryption failed:", e.message);
    return null; // Wrong key or corrupted data
  }
}

// ── Password hashing (for server-side verification only) ──────

/**
 * SHA-256 hash a password for storage in the room document.
 * This is NOT the encryption key — it's just used to verify
 * room membership before joining.
 *
 * @param {string} password
 * @returns {string} hex-encoded hash
 */
export async function hashPassword(password) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(password));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Utilities ─────────────────────────────────────────────────

function bufToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuf(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
