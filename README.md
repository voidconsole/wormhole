# Wormhole
## Disclaimer - This project was made with agentic development via LLMs

**Anonymous · Encrypted · Ephemeral chat rooms**
End-to-end encrypted chat using AES-256-GCM. Firebase stores only ciphertext. Keys never leave the client.

---

## File Structure

```
/
  index.html          Landing page (create / join room)
  chat.html           Chat interface
  firestore.rules     Firestore security rules
  css/
    styles.css        Void cosmos + glassmorphism design
  js/
    firebase.js       Firebase init, Firestore & Storage helpers
    crypto.js         AES-GCM encryption via Web Crypto API
    room.js           Room lifecycle: create, join, leave, invite
    chat.js           Messaging, file upload, admin controls, save
    ui.js             DOM rendering: messages, user list, toasts
```

---

## Setup (15 minutes)

### 1. Firebase Project

1. Go to https://console.firebase.google.com
2. Create a new project
3. Enable **Firestore Database** (start in production mode)
4. Enable **Firebase Storage**
5. Go to Project Settings → General → Your Apps → Web App
6. Copy the `firebaseConfig` object

### 2. Plug in your config

Open `js/firebase.js` and replace the placeholder config:

```js
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};
```

### 3. Deploy Firestore rules

Install Firebase CLI if you haven't:
```bash
npm install -g firebase-tools
firebase login
firebase init firestore   # point to your project
```

Then deploy:
```bash
firebase deploy --only firestore:rules
```

Or paste the contents of `firestore.rules` directly into the Firebase Console → Firestore → Rules tab.

### 4. Storage rules

In Firebase Console → Storage → Rules, set:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /rooms/{roomId}/{allPaths=**} {
      allow read, write: if true;
    }
  }
}
```

(For production, tighten this further with auth.)

### 5. Host / Serve

**Local dev (no build step required):**
```bash
npx serve .
# or
python3 -m http.server 8080
```

**Firebase Hosting:**
```bash
firebase init hosting   # set public dir to "."
firebase deploy --only hosting
```

> ⚠️ Must be served over HTTPS (or localhost) for the Web Crypto API to work.

---

## Security Architecture

```
Password ──PBKDF2(310k iters)──► AES-256-GCM Key
                                         │
Plaintext ──────────────────────────────►│──► Encrypted Blob ──► Firebase
                                         │
Firebase ──► Encrypted Blob ────────────►│──► Plaintext (client only)
```

- **PBKDF2** with 310,000 iterations (NIST 2023 minimum)
- **AES-256-GCM** with a random 12-byte IV per message
- **SHA-256** password hash stored in room document (for membership verification only — NOT the encryption key)
- Invite links carry the derived raw key (base64) in the URL — share only over secure channels

---

## Known Limitations & Edge Cases

| Issue | Mitigation |
|-------|-----------|
| Page reload loses session | Redirect to index (password can't be re-derived without it) |
| Admin abrupt disconnect | Next join attempt triggers admin reassignment |
| Race condition on username | Double-check before write in `room.js` |
| Storage rules are permissive | Tighten with Firebase Auth for production |
| No message editing/deletion | By design — immutable log |

---

## Extending

- **Message reactions**: Store a `reactions` map on each message doc
- **Read receipts**: Add a `readBy: []` array to messages
- **Auth layer**: Add Firebase Anonymous Auth for tighter rules
- **Push notifications**: Use Firebase Cloud Messaging
- **Expiry**: Add a Cloud Function that deletes inactive rooms after N hours
