// ============================================================
// ui.js — DOM rendering helpers
// Files are rendered from decrypted base64 data URLs,
// no Firebase Storage URLs involved.
// ============================================================

// ── Toast ─────────────────────────────────────────────────────

export function showToast(message, type = "info") {
	let container = document.getElementById("toast-container");
	if (!container) {
		container = document.createElement("div");
		container.id = "toast-container";
		document.body.appendChild(container);
	}

	const toast = document.createElement("div");
	toast.className = `toast toast--${type}`;
	toast.textContent = message;
	container.appendChild(toast);

	requestAnimationFrame(() => toast.classList.add("toast--visible"));
	setTimeout(() => {
		toast.classList.remove("toast--visible");
		toast.addEventListener("transitionend", () => toast.remove(), { once: true });
	}, 3000);
}

// ── Modal ─────────────────────────────────────────────────────

export function showModal(title, body, onConfirm) {
	const overlay = document.createElement("div");
	overlay.className = "modal-overlay";
	overlay.innerHTML = `
    <div class="modal-card">
      <h3 class="modal-title">${escapeHtml(title)}</h3>
      <p class="modal-body">${escapeHtml(body)}</p>
      <div class="modal-actions">
        <button class="btn btn--ghost"  id="modal-cancel">Cancel</button>
        <button class="btn btn--danger" id="modal-confirm">Confirm</button>
      </div>
    </div>`;
	document.body.appendChild(overlay);
	requestAnimationFrame(() => overlay.classList.add("modal-overlay--visible"));

	const close = () => {
		overlay.classList.remove("modal-overlay--visible");
		overlay.addEventListener("transitionend", () => overlay.remove(), { once: true });
	};

	overlay.querySelector("#modal-cancel").addEventListener("click", close);
	overlay.querySelector("#modal-confirm").addEventListener("click", async () => {
		close();
		await onConfirm();
	});
}

// ── Messages ──────────────────────────────────────────────────

const _renderedIds = new Set();

/**
 * Append a decrypted message bubble.
 *
 * @param {object} msg
 * @param {string}  msg.id
 * @param {string}  msg.sender
 * @param {string}  msg.content      - Decrypted string (plaintext OR JSON for files)
 * @param {string}  msg.contentType  - "text" | "image" | "file"
 * @param {boolean} msg.isSelf
 * @param {object}  msg.timestamp    - Firestore Timestamp
 */
export function renderMessage(msg) {
	if (_renderedIds.has(msg.id)) return;
	_renderedIds.add(msg.id);

	const container = document.getElementById("messages");
	if (!container) return;

	const wrap = document.createElement("div");
	wrap.className = `msg ${msg.isSelf ? "msg--self" : "msg--other"}`;
	wrap.dataset.id = msg.id;

	const bubble = document.createElement("div");
	bubble.className = "msg__bubble";

	if (!msg.isSelf) {
		const sender = document.createElement("span");
		sender.className = "msg__sender";
		sender.textContent = msg.sender;
		bubble.appendChild(sender);
	}

	bubble.appendChild(buildContent(msg));

	const time = document.createElement("span");
	time.className = "msg__time";
	time.textContent = formatTime(msg.timestamp);
	bubble.appendChild(time);

	wrap.appendChild(bubble);
	container.appendChild(wrap);
	container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
}

function buildContent({ contentType, content }) {
	// For image and file messages, content is a JSON string:
	//   { name, mimeType, data: "data:image/jpeg;base64,..." }
	switch (contentType) {
		case "image": {
			const meta = tryParseJSON(content);
			if (!meta?.data) return makeText("[image unavailable]");

			const img = document.createElement("img");
			img.className = "msg__image";
			img.src = meta.data;        // data URL — no Storage needed
			img.alt = meta.name ?? "image";
			img.loading = "lazy";

			// Click to open full size in new tab
			img.onclick = () => {
				const w = window.open();
				w.document.write(`<img src="${meta.data}" style="max-width:100%">`);
			};
			return img;
		}

		case "file": {
			const meta = tryParseJSON(content);
			if (!meta?.data) return makeText("[file unavailable]");

			const a = document.createElement("a");
			a.className = "msg__file";
			a.href = meta.data;          // data URL — browser handles download
			a.download = meta.name ?? "file";
			a.innerHTML = `<i class="fa-solid fa-paperclip msg__file-icon"></i> <span>${escapeHtml(meta.name ?? "file")}</span>`;
			return a;
		}

		default:
			return makeText(content);
	}
}

function makeText(content) {
	const p = document.createElement("p");
	p.className = "msg__text";
	p.innerHTML = escapeHtml(content).replace(/\n/g, "<br>");
	return p;
}

function tryParseJSON(str) {
	try { return JSON.parse(str); } catch { return null; }
}

function formatTime(ts) {
	if (!ts) return "";
	const d = ts.toDate ? ts.toDate() : new Date(ts);
	return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ── User list ─────────────────────────────────────────────────

export function renderUserList(users, selfId, isAdmin, onKick) {
	const list = document.getElementById("user-list");
	if (!list) return;
	list.innerHTML = "";

	const countEl = document.getElementById("user-count");
	if (countEl) countEl.textContent = users.length;

	for (const user of users) {
		const li = document.createElement("li");
		li.className = "user-item";
		li.dataset.id = user.id;
		li.innerHTML = `
      <span class="user-avatar">${user.username[0].toUpperCase()}</span>
      <span class="user-name">
        ${escapeHtml(user.username)}
        ${user.isAdmin ? '<span class="user-crown" title="Admin"><i class="fa-solid fa-crown"></i></span>' : ""}
        ${user.id === selfId ? '<span class="user-you">(you)</span>' : ""}
      </span>`;

		if (isAdmin && user.id !== selfId && !user.isAdmin) {
			const kick = document.createElement("button");
			kick.className = "btn btn--kick";
			kick.title = "Remove user";
			kick.innerHTML = '<i class="fa-solid fa-xmark"></i>';
			kick.addEventListener("click", () => onKick(user.id));
			li.appendChild(kick);
		}

		list.appendChild(li);
	}
}

// ── Loading ───────────────────────────────────────────────────

export function showLoading(message = "Loading…") {
	const overlay = document.getElementById("loading-overlay");
	if (!overlay) return;
	overlay.querySelector(".loading-text").textContent = message;
	overlay.style.display = "flex";
}

export function hideLoading() {
	const el = document.getElementById("loading-overlay");
	if (el) el.style.display = "none";
}

// ── Form helpers ──────────────────────────────────────────────

export function setError(inputEl, message) {
	const err = inputEl.parentElement?.querySelector(".field-error");
	if (err) {
		err.textContent = message;
		err.style.display = message ? "block" : "none";
	}
	inputEl.classList.toggle("input--error", !!message);
}

export function clearErrors(form) {
	form.querySelectorAll(".field-error").forEach((el) => (el.style.display = "none"));
	form.querySelectorAll(".input--error").forEach((el) => el.classList.remove("input--error"));
}

// ── Util ──────────────────────────────────────────────────────

function escapeHtml(str) {
	return String(str)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}