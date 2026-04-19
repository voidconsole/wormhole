# Wormhole - Hyperspeed Encrypted Communication Tunnel
## Disclaimer - This project was made with agentic development via LLMs

**Anonymous · Encrypted · Ephemeral chat rooms**
End-to-end encrypted chat using AES-256-GCM. Firebase stores only ciphertext. Keys never leave the client.

---
## The what
A supafast fuss-less no-login encrypted chat server which uses firebase’s firestore and auth as backend.
Has ability to create many rooms, allows frictionless entry of users, QR code shareability, file and media sharing, encrypted for both text and media, and a super cool dusk/dusk design system shift.

## The why
I've always wanted a communication protocol that doesn't require personal information like phone numbers or emails, and is not cubersome to sign up.
In finding a solution to that, I've built a sleek frictionless encrypted communication tunnel as a chat server, where one can both join and make rooms in seconds, without worrying about security.



## Usage 
Open [https://voidconsole.github.io/wormhole/](https://voidconsole.github.io/wormhole/) and enjoy!


## Features
- Sick theme switcher
- End to End Encrypted texts and media
- Media and file support
- No sign in required, just username, and the room creds you wish to join.
- Creating rooms is as easy as joining one
- Messages cleared after admin terminates session
- Username management at server level
- Admin controls for regulation
- Responsive for all devices
- High storage limit
- Unlimited users
- Unlimited session time

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
