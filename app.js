/* ═══════════════════════════════════════════════════
   NexusChat v2.0
   Firebase Auth + Realtime DB + Storage + WebRTC
   ═══════════════════════════════════════════════════

   ╔═══════════════════════════════════════════════╗
   ║  🔧 CONFIGURA FIREBASE AQUÍ                   ║
   ╚═══════════════════════════════════════════════╝
*/
const firebaseConfig = {
  apiKey:            "AIzaSyDbrBrDwP_WLGTiAd86Mdm4RuBrXHUW4wQ",
  authDomain:        "chat-privado-298e4.firebaseapp.com",
  databaseURL:       "https://chat-privado-298e4-default-rtdb.firebaseio.com/",
  projectId:         "chat-privado-298e4",
  storageBucket:     "chat-privado-298e4.firebasestorage.app",
  messagingSenderId: "219822400254",
  appId:             "1:219822400254:web:59eb817e601abba2053baf"
};

const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

/* ══════════════════════════════
   GLOBALS
══════════════════════════════ */
let auth, db, storage;
let currentUser = null;       // Firebase Auth user
let myProfile   = null;       // { uid, nickname, photoURL, status }
let currentRoom = null;       // { id, name, type, members }
let allUsers    = {};         // uid -> profile
let inviteList  = [];         // UIDs selected for new room
let ctxMsgId    = null;       // message id for context menu
let typingTimer = null;
let isTyping    = false;
// WebRTC
let localStream   = null;
let screenStream  = null;
let peerConn      = null;
let callState     = "idle";
let callPeerId    = null;
// Listeners (to detach on room change)
let msgListener   = null;
let typingListener= null;
let sigListener   = null;
let membersListener = null;

/* ══════════════════════════════
   DOM HELPERS
══════════════════════════════ */
const $ = id => document.getElementById(id);
const hide = el => el.classList.add("hidden");
const show = el => el.classList.remove("hidden");

/* ══════════════════════════════
   INIT
══════════════════════════════ */
window.addEventListener("DOMContentLoaded", () => {
  if (firebaseConfig.apiKey === "REEMPLAZA_CON_TU_API_KEY") {
    document.body.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#111;color:#f2f3f5;flex-direction:column;gap:1rem;text-align:center;padding:2rem">
      <div style="font-size:3rem">⬡</div>
      <h2>Configura Firebase</h2>
      <p style="color:#80848e;max-width:360px">Abre <code style="background:#222;padding:2px 6px;border-radius:4px">app.js</code> y reemplaza los valores de <code style="background:#222;padding:2px 6px;border-radius:4px">firebaseConfig</code> con los datos de tu proyecto.<br><br>Consulta el <strong>README.md</strong> para instrucciones paso a paso.</p>
    </div>`;
    return;
  }

  firebase.initializeApp(firebaseConfig);
  auth    = firebase.auth();
  db      = firebase.database();
  storage = firebase.storage();

  // Sesión persistente (cookies automáticas con Firebase)
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

  auth.onAuthStateChanged(user => {
    if (user) {
      currentUser = user;
      loadMyProfile().then(startApp);
    } else {
      currentUser = null;
      showAuthScreen();
    }
  });

  // Global users listener
  db.ref("users").on("value", snap => {
    allUsers = snap.val() || {};
    renderSidebarMembers();
    updateMpList();
  });

  setupInputListeners();
  setupFileInput();
  setupContextMenu();
  requestNotifPermission();
});

/* ══════════════════════════════
   AUTH
══════════════════════════════ */
function showAuthScreen() {
  hide($("app-screen"));
  show($("auth-screen"));
  $("auth-screen").classList.add("active");
  $("app-screen").classList.remove("active");
}

function showAppScreen() {
  hide($("auth-screen"));
  $("auth-screen").classList.remove("active");
  $("app-screen").classList.add("active");
}

$("go-register").onclick = () => {
  hide($("login-panel"));
  show($("register-panel"));
  $("register-panel").classList.add("active");
};
$("go-login").onclick = () => {
  hide($("register-panel"));
  $("register-panel").classList.remove("active");
  show($("login-panel"));
  $("login-panel").classList.add("active");
};

$("login-btn").onclick = async () => {
  const email = $("login-email").value.trim();
  const pass  = $("login-password").value;
  const errEl = $("login-error");
  hide(errEl);
  if (!email || !pass) { showErr(errEl, "Completa todos los campos."); return; }
  try {
    $("login-btn").textContent = "Cargando...";
    await auth.signInWithEmailAndPassword(email, pass);
  } catch(e) {
    showErr(errEl, authErrMsg(e.code));
    $("login-btn").textContent = "Iniciar sesión";
  }
};

$("register-btn").onclick = async () => {
  const nick  = $("reg-nick").value.trim();
  const email = $("reg-email").value.trim();
  const pass  = $("reg-password").value;
  const errEl = $("reg-error");
  hide(errEl);
  if (!nick || !email || !pass) { showErr(errEl, "Completa todos los campos."); return; }
  if (pass.length < 6) { showErr(errEl, "La contraseña debe tener al menos 6 caracteres."); return; }
  try {
    $("register-btn").textContent = "Creando...";
    const cred = await auth.createUserWithEmailAndPassword(email, pass);
    await db.ref(`users/${cred.user.uid}`).set({
      uid: cred.user.uid,
      nickname: nick,
      photoURL: "",
      status: "online",
      createdAt: firebase.database.ServerValue.TIMESTAMP
    });
  } catch(e) {
    showErr(errEl, authErrMsg(e.code));
    $("register-btn").textContent = "Crear cuenta";
  }
};

function authErrMsg(code) {
  const msgs = {
    "auth/user-not-found": "Usuario no encontrado.",
    "auth/wrong-password": "Contraseña incorrecta.",
    "auth/email-already-in-use": "El correo ya está registrado.",
    "auth/invalid-email": "Correo inválido.",
    "auth/too-many-requests": "Demasiados intentos. Espera un momento."
  };
  return msgs[code] || "Error: " + code;
}

function showErr(el, msg) {
  el.textContent = msg;
  show(el);
}

/* ══════════════════════════════
   PROFILE
══════════════════════════════ */
async function loadMyProfile() {
  const snap = await db.ref(`users/${currentUser.uid}`).get();
  myProfile = snap.val() || { uid: currentUser.uid, nickname: "Usuario", photoURL: "", status: "online" };
  // Set online status
  db.ref(`users/${currentUser.uid}/status`).set("online");
  db.ref(`users/${currentUser.uid}/status`).onDisconnect().set("offline");
}

function startApp() {
  showAppScreen();
  updateSidebarAvatar();
  loadMyRooms();
}

function updateSidebarAvatar() {
  const btn = $("sl-profile-btn");
  const txt = $("sl-avatar-text");
  const img = $("sl-avatar-img");
  if (myProfile.photoURL) {
    img.src = myProfile.photoURL;
    img.style.display = "block";
    txt.style.display = "none";
  } else {
    txt.textContent = (myProfile.nickname || "U")[0].toUpperCase();
    txt.style.display = "";
    img.style.display = "none";
  }
}

function openProfile() {
  $("prof-nick-input").value = myProfile.nickname || "";
  $("prof-status-select").value = myProfile.status || "online";
  // Preview avatar
  const prev = $("prof-av-preview");
  prev.innerHTML = "";
  if (myProfile.photoURL) {
    const img = document.createElement("img");
    img.src = myProfile.photoURL;
    prev.appendChild(img);
  } else {
    prev.textContent = (myProfile.nickname || "U")[0].toUpperCase();
  }
  openModal("modal-profile");
}

$("prof-avatar-file").onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    toast("⏳ Subiendo foto...");
    const ref = storage.ref(`avatars/${currentUser.uid}`);
    await ref.put(file);
    const url = await ref.getDownloadURL();
    myProfile.photoURL = url;
    const prev = $("prof-av-preview");
    prev.innerHTML = "";
    const img = document.createElement("img"); img.src = url;
    prev.appendChild(img);
    toast("✅ Foto actualizada");
  } catch(e) { toast("❌ Error subiendo foto"); }
};

async function saveProfile() {
  const nick = $("prof-nick-input").value.trim();
  const status = $("prof-status-select").value;
  if (!nick) { showErr($("prof-error"), "El nickname no puede estar vacío."); return; }
  hide($("prof-error"));
  await db.ref(`users/${currentUser.uid}`).update({
    nickname: nick,
    photoURL: myProfile.photoURL || "",
    status: status
  });
  myProfile.nickname = nick;
  myProfile.status = status;
  updateSidebarAvatar();
  closeModal("modal-profile");
  toast("✅ Perfil guardado");
}

async function signOut() {
  await db.ref(`users/${currentUser.uid}/status`).set("offline");
  await auth.signOut();
  currentRoom = null;
  closeModal("modal-profile");
}

/* ══════════════════════════════
   ROOMS
══════════════════════════════ */
function loadMyRooms() {
  db.ref("rooms").on("value", snap => {
    const rooms = snap.val() || {};
    const myRooms = Object.entries(rooms).filter(([id, r]) => {
      return r.type === "public" || (r.members && r.members[currentUser.uid]);
    });
    renderRoomsList(myRooms);
  });
}

function renderRoomsList(rooms) {
  const list = $("sl-rooms-list");
  list.innerHTML = "";
  rooms.forEach(([id, room]) => {
    const btn = document.createElement("button");
    btn.className = "sl-btn sl-room-btn" + (currentRoom?.id === id ? " active" : "");
    btn.title = room.name;
    btn.textContent = room.name[0].toUpperCase();
    btn.onclick = () => joinRoom(id, room);
    list.appendChild(btn);
  });
}

function openCreateRoom() {
  inviteList = [];
  $("room-name-input").value = "";
  $("room-desc-input").value = "";
  $("room-type-select").value = "private";
  $("invite-search").value = "";
  $("invite-results").innerHTML = "";
  $("invited-chips").innerHTML = "";
  openModal("modal-create-room");
}

async function createRoom() {
  const name = $("room-name-input").value.trim();
  const desc = $("room-desc-input").value.trim();
  const type = $("room-type-select").value;
  if (!name) { toast("⚠️ Escribe un nombre para la sala"); return; }

  const members = { [currentUser.uid]: true };
  inviteList.forEach(uid => { members[uid] = true; });

  const ref = db.ref("rooms").push();
  await ref.set({
    id: ref.key,
    name,
    desc,
    type,
    createdBy: currentUser.uid,
    createdAt: firebase.database.ServerValue.TIMESTAMP,
    members
  });
  closeModal("modal-create-room");
  toast("✅ Sala creada");
}

async function joinRoom(id, room) {
  if (currentRoom?.id === id) return;
  // Detach previous listeners
  if (msgListener) { db.ref(`messages/${currentRoom?.id}`).off("child_added", msgListener); }
  if (typingListener) { db.ref(`typing/${currentRoom?.id}`).off("value", typingListener); }
  if (sigListener) { db.ref(`signaling/${currentRoom?.id}`).off("child_added", sigListener); }

  currentRoom = { id, ...room };
  showView("chat");
  $("sc-room-name").textContent = room.name;
  $("ch-name").textContent = "general";
  $("cw-name").textContent = `# ${room.name}`;
  $("msg-input").disabled = false;
  $("send-btn").disabled = false;

  // Clear messages
  const list = $("messages-list");
  list.innerHTML = `<div class="chan-welcome" id="chan-welcome">
    <div class="cw-icon">#</div>
    <h3 id="cw-name"># ${room.name}</h3>
    <p>Este es el comienzo del canal. ¡Di hola!</p>
  </div>`;

  // Highlight active room
  document.querySelectorAll(".sl-room-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".sl-room-btn").forEach(b => {
    if (b.title === room.name) b.classList.add("active");
  });
  $("sl-home-btn").classList.remove("active");

  // Add self as member if public
  if (room.type === "public") {
    await db.ref(`rooms/${id}/members/${currentUser.uid}`).set(true);
  }

  renderSidebarMembers();
  updateMpList();

  // Messages listener
  msgListener = db.ref(`messages/${id}`).orderByChild("timestamp").limitToLast(100).on("child_added", snap => {
    const msg = snap.val();
    if (msg) renderMessage(msg);
  });

  // Also listen for changes (edits/deletes)
  db.ref(`messages/${id}`).on("child_changed", snap => {
    const msg = snap.val();
    if (msg) updateMessageInDOM(msg);
  });

  // Typing
  typingListener = db.ref(`typing/${id}`).on("value", snap => {
    const data = snap.val() || {};
    const typers = Object.entries(data)
      .filter(([uid, v]) => uid !== currentUser.uid && v)
      .map(([uid]) => allUsers[uid]?.nickname || "Alguien");
    const bar = $("typing-bar");
    if (typers.length > 0) {
      bar.textContent = typers.join(", ") + (typers.length === 1 ? " está escribiendo..." : " están escribiendo...");
    } else {
      bar.textContent = "";
    }
  });

  // Signaling
  sigListener = db.ref(`signaling/${id}`).on("child_added", snap => {
    const sig = snap.val();
    if (!sig || sig.to !== currentUser.uid) return;
    handleSignal(sig);
    snap.ref.remove();
  });

  // Update online indicator
  updateOnlineIndicator();

  // Close mobile sidebar
  $("sidebar-channel").classList.remove("mob-open");
}

function renderSidebarMembers() {
  if (!currentRoom) return;
  const members = currentRoom.members || {};
  const container = $("sc-members");
  container.innerHTML = "";
  Object.keys(members).forEach(uid => {
    const u = allUsers[uid];
    if (!u) return;
    const div = document.createElement("div");
    div.className = "sc-member";
    div.innerHTML = `
      <div class="sc-member-av" style="background:${uidColor(uid)}">
        ${u.photoURL ? `<img src="${u.photoURL}" alt="">` : `<span>${(u.nickname||"?")[0].toUpperCase()}</span>`}
        <span class="status-dot ${u.status || 'offline'}"></span>
      </div>
      <div class="sc-member-info">
        <div class="sc-member-name">${esc(u.nickname)}</div>
        <div class="sc-member-status">${statusLabel(u.status)}</div>
      </div>`;
    container.appendChild(div);
  });
}

function updateMpList() {
  if (!currentRoom) return;
  const members = currentRoom.members || {};
  const list = $("mp-list");
  list.innerHTML = "";
  Object.keys(members).forEach(uid => {
    const u = allUsers[uid];
    if (!u) return;
    const div = document.createElement("div");
    div.className = "mp-member";
    div.innerHTML = `
      <div class="mp-av" style="background:${uidColor(uid)}">
        ${u.photoURL ? `<img src="${u.photoURL}" alt="">` : (u.nickname||"?")[0].toUpperCase()}
        <span class="status-dot ${u.status||'offline'}"></span>
      </div>
      <div>
        <div class="mp-name">${esc(u.nickname)}</div>
        <div class="mp-status-txt">${statusLabel(u.status)}</div>
      </div>`;
    list.appendChild(div);
  });
}

function updateOnlineIndicator() {
  if (!currentRoom) return;
  const members = currentRoom.members || {};
  const onlineCount = Object.keys(members).filter(uid => {
    return uid !== currentUser.uid && allUsers[uid]?.status === "online";
  }).length;
  const dot = $("online-dot");
  const lbl = $("online-label");
  if (onlineCount > 0) {
    dot.classList.add("has-online");
    lbl.textContent = onlineCount + " en línea";
  } else {
    dot.classList.remove("has-online");
    lbl.textContent = "Sin otros miembros";
  }
  $("call-btn").disabled = onlineCount === 0;
}

/* ── Room Settings ── */
function openRoomSettings() {
  if (!currentRoom) return;
  if (currentRoom.createdBy !== currentUser.uid) {
    toast("⚠️ Solo el creador puede editar la sala");
    return;
  }
  $("rs-name-input").value = currentRoom.name || "";
  $("rs-desc-input").value = currentRoom.desc || "";
  renderRsMembers();
  switchRsTab("general");
  openModal("modal-room-settings");
}

async function saveRoomSettings() {
  const name = $("rs-name-input").value.trim();
  const desc = $("rs-desc-input").value.trim();
  if (!name) return;
  await db.ref(`rooms/${currentRoom.id}`).update({ name, desc });
  currentRoom.name = name;
  $("sc-room-name").textContent = name;
  $("ch-name").textContent = "general";
  closeModal("modal-room-settings");
  toast("✅ Sala actualizada");
}

async function deleteRoom() {
  if (!confirm(`¿Eliminar "${currentRoom.name}"? Esta acción no se puede deshacer.`)) return;
  await db.ref(`rooms/${currentRoom.id}`).remove();
  await db.ref(`messages/${currentRoom.id}`).remove();
  currentRoom = null;
  showView("home");
  closeModal("modal-room-settings");
  toast("🗑️ Sala eliminada");
}

function switchRsTab(tab) {
  document.querySelectorAll(".rs-tab").forEach((b, i) => {
    b.classList.toggle("active", (i === 0 && tab === "general") || (i === 1 && tab === "members"));
  });
  $("rs-tab-general").classList.toggle("active", tab === "general");
  $("rs-tab-members").classList.toggle("active", tab === "members");
  if (tab === "members") renderRsMembers();
}

function renderRsMembers() {
  const list = $("rs-members-list");
  list.innerHTML = "";
  const members = currentRoom?.members || {};
  Object.keys(members).forEach(uid => {
    const u = allUsers[uid];
    if (!u) return;
    const row = document.createElement("div");
    row.className = "rs-member-row";
    row.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px">
        <div class="invite-av" style="background:${uidColor(uid)}">
          ${u.photoURL ? `<img src="${u.photoURL}" alt="">` : (u.nickname||"?")[0].toUpperCase()}
        </div>
        <span>${esc(u.nickname)}</span>
      </div>
      ${uid !== currentUser.uid ? `<button class="rs-remove-btn" onclick="removeMember('${uid}')">Expulsar</button>` : '<span style="font-size:.7rem;color:var(--text-3)">Tú</span>'}`;
    list.appendChild(row);
  });
}

async function removeMember(uid) {
  if (!currentRoom) return;
  await db.ref(`rooms/${currentRoom.id}/members/${uid}`).remove();
  toast("✅ Miembro removido");
  renderRsMembers();
}

/* ── User search for invites ── */
function setupUserSearch(inputId, resultsId, onSelect) {
  const input = $(inputId);
  const results = $(resultsId);
  if (!input) return;
  input.oninput = () => {
    const q = input.value.trim().toLowerCase();
    results.innerHTML = "";
    if (!q) return;
    Object.entries(allUsers)
      .filter(([uid, u]) => uid !== currentUser.uid && u.nickname.toLowerCase().includes(q))
      .slice(0, 6)
      .forEach(([uid, u]) => {
        const item = document.createElement("div");
        item.className = "invite-result-item";
        item.innerHTML = `
          <div class="invite-av" style="background:${uidColor(uid)}">
            ${u.photoURL ? `<img src="${u.photoURL}" alt="">` : (u.nickname||"?")[0].toUpperCase()}
          </div>
          <span>${esc(u.nickname)}</span>`;
        item.onclick = () => onSelect(uid, u.nickname);
        results.appendChild(item);
      });
  };
}

setupUserSearch("invite-search", "invite-results", (uid, nick) => {
  if (inviteList.includes(uid)) return;
  inviteList.push(uid);
  const chip = document.createElement("div");
  chip.className = "invited-chip";
  chip.dataset.uid = uid;
  chip.innerHTML = `<span>${esc(nick)}</span><button onclick="removeInvite('${uid}')">✕</button>`;
  $("invited-chips").appendChild(chip);
  $("invite-search").value = "";
  $("invite-results").innerHTML = "";
});

function removeInvite(uid) {
  inviteList = inviteList.filter(u => u !== uid);
  const chip = document.querySelector(`.invited-chip[data-uid="${uid}"]`);
  if (chip) chip.remove();
}

setupUserSearch("rs-invite-search", "rs-invite-results", async (uid) => {
  if (!currentRoom) return;
  await db.ref(`rooms/${currentRoom.id}/members/${uid}`).set(true);
  toast("✅ Usuario invitado");
  $("rs-invite-search").value = "";
  $("rs-invite-results").innerHTML = "";
  renderRsMembers();
});

/* ══════════════════════════════
   MESSAGES
══════════════════════════════ */
function setupInputListeners() {
  $("msg-input").addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    handleTypingStart();
  });
}

async function sendMessage(text = null, fileData = null) {
  if (!currentRoom) return;
  const input = $("msg-input");
  const content = text || input.value.trim();
  if (!content && !fileData) return;

  const msg = {
    id: db.ref(`messages/${currentRoom.id}`).push().key,
    authorId: currentUser.uid,
    author: myProfile.nickname,
    authorPhoto: myProfile.photoURL || "",
    text: content || "",
    fileURL: fileData?.url || "",
    fileName: fileData?.name || "",
    fileType: fileData?.type || "",
    timestamp: firebase.database.ServerValue.TIMESTAMP,
    edited: false,
    deleted: false
  };
  await db.ref(`messages/${currentRoom.id}/${msg.id}`).set(msg);
  input.value = "";
  stopTyping();
  scrollBottom();
}

function renderMessage(msg) {
  if (document.querySelector(`[data-msgid="${msg.id}"]`)) {
    updateMessageInDOM(msg);
    return;
  }
  const welcome = document.querySelector(".chan-welcome");
  if (welcome) welcome.remove();

  const isMe = msg.authorId === currentUser.uid;
  const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) : "";

  const group = document.createElement("div");
  group.className = "msg-group";
  group.dataset.msgid = msg.id;

  // Header
  const header = document.createElement("div");
  header.className = "msg-header";
  const u = allUsers[msg.authorId];
  header.innerHTML = `<span class="msg-author ${isMe ? "is-me" : "is-peer"}">${esc(msg.author)}</span><span class="msg-time">${time}</span>`;

  // Row
  const row = document.createElement("div");
  row.className = `msg-row ${isMe ? "is-me" : "is-peer"}`;
  row.dataset.msgid = msg.id;

  // Bubble content
  const bubble = document.createElement("div");
  bubble.className = "msg-bubble" + (msg.edited ? " is-edited" : "") + (msg.deleted ? " is-deleted" : "");

  if (msg.deleted) {
    bubble.textContent = "🚫 Mensaje eliminado";
  } else if (msg.fileURL) {
    if (msg.fileType && msg.fileType.startsWith("image/")) {
      const img = document.createElement("img");
      img.src = msg.fileURL; img.className = "msg-img";
      img.onclick = () => window.open(msg.fileURL, "_blank");
      bubble.appendChild(img);
    } else {
      const a = document.createElement("a");
      a.href = msg.fileURL; a.target = "_blank"; a.className = "msg-file";
      a.innerHTML = `📎 <span>${esc(msg.fileName || "Archivo")}</span>`;
      bubble.appendChild(a);
    }
    if (msg.text) {
      const t = document.createElement("div");
      t.style.marginTop = "4px"; t.textContent = msg.text;
      bubble.appendChild(t);
    }
  } else {
    bubble.textContent = msg.text;
  }

  // Actions (edit/delete for own messages)
  if (isMe && !msg.deleted) {
    const actions = document.createElement("div");
    actions.className = "msg-actions";
    actions.innerHTML = `
      <button class="msg-action-btn" title="Editar" onclick="startEdit('${msg.id}')">✏️</button>
      <button class="msg-action-btn" title="Eliminar" onclick="deleteMsg('${msg.id}')">🗑️</button>`;
    row.appendChild(actions);
  }

  row.appendChild(bubble);
  group.appendChild(header);
  group.appendChild(row);
  $("messages-list").appendChild(group);
  scrollBottom();

  // Notification for incoming messages
  if (!isMe && document.hidden) {
    sendNotification(msg.author, msg.deleted ? "" : (msg.text || "📎 Archivo"), currentRoom?.name);
  }
}

function updateMessageInDOM(msg) {
  const group = document.querySelector(`[data-msgid="${msg.id}"]`);
  if (!group) return;
  const bubble = group.querySelector(".msg-bubble");
  if (!bubble) return;
  if (msg.deleted) {
    bubble.className = "msg-bubble is-deleted";
    bubble.innerHTML = "🚫 Mensaje eliminado";
    const actions = group.querySelector(".msg-actions");
    if (actions) actions.remove();
  } else {
    bubble.className = "msg-bubble" + (msg.edited ? " is-edited" : "");
    if (!msg.fileURL) bubble.textContent = msg.text;
  }
}

function startEdit(msgId) {
  const group = document.querySelector(`[data-msgid="${msgId}"]`);
  if (!group) return;
  const bubble = group.querySelector(".msg-bubble");
  const currentText = bubble.textContent.replace(" (editado)", "");
  const input = document.createElement("input");
  input.type = "text"; input.className = "msg-edit-input";
  input.value = currentText;
  bubble.replaceWith(input);
  input.focus();
  input.onkeydown = async e => {
    if (e.key === "Enter") {
      const newText = input.value.trim();
      if (newText && newText !== currentText) {
        await db.ref(`messages/${currentRoom.id}/${msgId}`).update({ text: newText, edited: true });
      } else {
        const restored = document.createElement("div");
        restored.className = "msg-bubble" + (bubble.classList.contains("is-edited") ? " is-edited" : "");
        restored.textContent = currentText;
        input.replaceWith(restored);
      }
    }
    if (e.key === "Escape") {
      bubble.textContent = currentText;
      input.replaceWith(bubble);
    }
  };
}

async function deleteMsg(msgId) {
  if (!currentRoom) return;
  await db.ref(`messages/${currentRoom.id}/${msgId}`).update({ deleted: true, text: "" });
}

/* ── Typing ── */
function handleTypingStart() {
  if (!currentRoom || !isTyping) {
    isTyping = true;
    db.ref(`typing/${currentRoom?.id}/${currentUser.uid}`).set(true);
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(stopTyping, 2500);
}
function stopTyping() {
  isTyping = false;
  if (currentRoom) db.ref(`typing/${currentRoom.id}/${currentUser.uid}`).remove();
}

/* ── File upload ── */
function setupFileInput() {
  $("file-input").onchange = async e => {
    const file = e.target.files[0];
    if (!file || !currentRoom) return;
    if (file.size > 10 * 1024 * 1024) { toast("⚠️ El archivo no puede superar 10 MB"); return; }
    toast("⏳ Subiendo archivo...");
    try {
      const path = `files/${currentRoom.id}/${Date.now()}_${file.name}`;
      const ref = storage.ref(path);
      await ref.put(file);
      const url = await ref.getDownloadURL();
      await sendMessage("", { url, name: file.name, type: file.type });
      toast("✅ Archivo enviado");
    } catch(err) {
      toast("❌ Error subiendo archivo");
    }
    e.target.value = "";
  };
}

/* ══════════════════════════════
   WEBRTC CALLS
══════════════════════════════ */
async function startCall() {
  if (!currentRoom || callState !== "idle") return;
  const members = currentRoom.members || {};
  const peerUids = Object.keys(members).filter(u => u !== currentUser.uid && allUsers[u]?.status === "online");
  if (peerUids.length === 0) { toast("⚠️ No hay otros miembros en línea"); return; }
  callPeerId = peerUids[0]; // call first online member
  callState = "calling";
  showCallPanel();
  updateCallUI();

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    createPeerConn();
    localStream.getTracks().forEach(t => peerConn.addTrack(t, localStream));
    const offer = await peerConn.createOffer();
    await peerConn.setLocalDescription(offer);
    sendSig({ type: "offer", sdp: offer.sdp, callerName: myProfile.nickname, callerPhoto: myProfile.photoURL || "" });
  } catch(e) {
    toast("❌ No se pudo acceder al micrófono"); endCall();
  }
}

async function acceptCall() {
  if (callState !== "ringing") return;
  callState = "in-call";
  hide($("incoming-overlay"));
  updateCallUI();
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localStream.getTracks().forEach(t => peerConn.addTrack(t, localStream));
    const answer = await peerConn.createAnswer();
    await peerConn.setLocalDescription(answer);
    sendSig({ type: "answer", sdp: answer.sdp });
    addSysMsg("📞 Llamada en curso");
  } catch(e) { toast("❌ Micrófono no disponible"); endCall(); }
}

function rejectCall() {
  sendSig({ type: "reject" });
  callState = "idle";
  hide($("incoming-overlay"));
  hide($("call-panel"));
  addSysMsg("📵 Llamada rechazada");
}

function endCall() {
  if (peerConn) { peerConn.close(); peerConn = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }
  if ((callState === "in-call" || callState === "calling") && callPeerId) {
    sendSig({ type: "end" });
    if (callState === "in-call") addSysMsg("📵 Llamada finalizada");
  }
  callState = "idle"; callPeerId = null;
  $("remote-audio").srcObject = null;
  $("remote-screen-video").srcObject = null;
  hide($("screen-area"));
  hide($("call-panel"));
  hide($("incoming-overlay"));
  $("call-btn").classList.remove("active");
  $("mute-btn").textContent = "🎤"; $("mute-btn").classList.remove("active-ctrl");
  $("share-btn").classList.remove("active-ctrl");
}

function createPeerConn() {
  peerConn = new RTCPeerConnection(RTC_CONFIG);
  peerConn.onicecandidate = e => { if (e.candidate) sendSig({ type: "ice", candidate: e.candidate.toJSON() }); };
  peerConn.ontrack = e => {
    const stream = e.streams[0];
    if (e.track.kind === "audio") $("remote-audio").srcObject = stream;
    else { $("remote-screen-video").srcObject = stream; show($("screen-area")); }
  };
  peerConn.onconnectionstatechange = () => {
    if (["disconnected","failed","closed"].includes(peerConn.connectionState)) endCall();
  };
}

function sendSig(data) {
  if (!callPeerId || !currentRoom) return;
  db.ref(`signaling/${currentRoom.id}`).push({ ...data, from: currentUser.uid, to: callPeerId, ts: Date.now() });
}

async function handleSignal(sig) {
  switch(sig.type) {
    case "offer":
      if (callState !== "idle") return;
      callState = "ringing";
      callPeerId = sig.from;
      createPeerConn();
      await peerConn.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: sig.sdp }));
      showCallPanel();
      // Setup incoming UI
      const inAv = $("incoming-av");
      inAv.innerHTML = "";
      if (sig.callerPhoto) { const img = document.createElement("img"); img.src = sig.callerPhoto; inAv.appendChild(img); }
      else inAv.textContent = (sig.callerName||"?")[0].toUpperCase();
      $("incoming-name-txt").textContent = sig.callerName || "Usuario";
      show($("incoming-overlay"));
      updateCallUI();
      break;
    case "answer":
      if (!peerConn || peerConn.signalingState === "closed") return;
      await peerConn.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: sig.sdp }));
      callState = "in-call"; updateCallUI(); addSysMsg("📞 Llamada en curso");
      break;
    case "ice":
      if (peerConn && sig.candidate) try { await peerConn.addIceCandidate(new RTCIceCandidate(sig.candidate)); } catch(e) {}
      break;
    case "reject":
      addSysMsg("📵 Llamada rechazada"); endCall(); break;
    case "end":
      addSysMsg("📵 Llamada finalizada"); endCall(); break;
    case "screen-stop":
      hide($("screen-area")); break;
  }
}

function showCallPanel() {
  show($("call-panel"));
  // Populate call card names
  const localAv = $("call-av-local");
  localAv.innerHTML = "";
  if (myProfile.photoURL) { const img = document.createElement("img"); img.src = myProfile.photoURL; localAv.appendChild(img); }
  else localAv.textContent = (myProfile.nickname||"?")[0].toUpperCase();
  $("call-name-local").textContent = myProfile.nickname;
  const peer = allUsers[callPeerId];
  const remAv = $("call-av-remote");
  remAv.innerHTML = "";
  if (peer?.photoURL) { const img = document.createElement("img"); img.src = peer.photoURL; remAv.appendChild(img); }
  else remAv.textContent = (peer?.nickname||"?")[0].toUpperCase();
  $("call-name-remote").textContent = peer?.nickname || "Usuario";
}

function updateCallUI() {
  const txt = $("call-status-txt");
  const wave = $("call-wave");
  if (callState === "calling") { txt.textContent = "Llamando..."; wave.style.display = ""; }
  else if (callState === "ringing") { txt.textContent = "Llamada entrante"; wave.style.display = ""; }
  else if (callState === "in-call") { txt.textContent = "En llamada"; wave.style.display = "none"; }
}

function toggleMute() {
  if (!localStream) return;
  const muted = !localStream.getAudioTracks()[0]?.enabled;
  localStream.getAudioTracks().forEach(t => t.enabled = muted);
  const btn = $("mute-btn");
  btn.textContent = muted ? "🎤" : "🔇";
  btn.classList.toggle("active-ctrl", !muted);
}

async function toggleScreenShare() {
  if (callState !== "in-call") { toast("⚠️ Debes estar en llamada para compartir pantalla"); return; }
  if (!screenStream) {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = screenStream.getVideoTracks()[0];
      peerConn.addTrack(track, screenStream);
      $("local-screen-preview").srcObject = screenStream;
      show($("screen-area"));
      $("share-btn").classList.add("active-ctrl");
      addSysMsg("🖥️ Compartiendo pantalla");
      track.onended = () => stopScreenShare();
    } catch(e) { toast("❌ No se pudo compartir pantalla"); }
  } else { stopScreenShare(); }
}

function stopScreenShare() {
  if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }
  $("local-screen-preview").srcObject = null;
  hide($("screen-area"));
  $("share-btn").classList.remove("active-ctrl");
  sendSig({ type: "screen-stop" });
  addSysMsg("🖥️ Pantalla detenida");
}

/* ══════════════════════════════
   NOTIFICATIONS
══════════════════════════════ */
function requestNotifPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function sendNotification(title, body, room) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  new Notification(`${title} — ${room || "NexusChat"}`, { body, icon: "" });
}

/* ══════════════════════════════
   CONTEXT MENU
══════════════════════════════ */
function setupContextMenu() {
  document.addEventListener("contextmenu", e => {
    const row = e.target.closest(".msg-row.is-me");
    if (!row) return;
    e.preventDefault();
    ctxMsgId = row.dataset.msgid;
    const menu = $("ctx-menu");
    menu.style.left = e.clientX + "px";
    menu.style.top  = e.clientY + "px";
    show(menu);
  });
  document.addEventListener("click", () => hide($("ctx-menu")));
}

function ctxEdit()   { if (ctxMsgId) startEdit(ctxMsgId); }
function ctxDelete() { if (ctxMsgId) deleteMsg(ctxMsgId); }

/* ══════════════════════════════
   VIEWS / UI HELPERS
══════════════════════════════ */
function showView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  $(`view-${name}`)?.classList.add("active");
}

function toggleMembersPanel() {
  $("members-panel").classList.toggle("hidden");
}

function toggleMobileSidebar() {
  $("sidebar-channel").classList.toggle("mob-open");
}

function openModal(id) { show($(id)); }
function closeModal(id) { hide($(id)); }

// Close modals on backdrop click
document.addEventListener("click", e => {
  if (e.target.classList.contains("modal-overlay")) closeModal(e.target.id);
});

function scrollBottom() {
  const list = $("messages-list");
  list.scrollTop = list.scrollHeight;
}

function addSysMsg(text) {
  const div = document.createElement("div");
  div.className = "system-msg";
  div.textContent = text;
  $("messages-list").appendChild(div);
  scrollBottom();
}

function toast(msg, duration = 3000) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  $("toast-container").appendChild(el);
  setTimeout(() => el.remove(), duration);
}

/* ── Color helpers ── */
function uidColor(uid) {
  const colors = ["#5865f2","#ed9b3f","#23a55a","#e91e8c","#3ba5b5","#9b59b6","#e74c3c","#1abc9c"];
  let hash = 0;
  for (let i = 0; i < uid.length; i++) hash = uid.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function statusLabel(s) {
  return { online: "En línea", away: "Ausente", busy: "No molestar", offline: "Desconectado" }[s] || "Desconectado";
}

function esc(str) {
  return String(str || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

/* Expose global functions called from HTML */
window.openCreateRoom   = openCreateRoom;
window.openProfile      = openProfile;
window.openRoomSettings = openRoomSettings;
window.saveRoomSettings = saveRoomSettings;
window.deleteRoom       = deleteRoom;
window.saveProfile      = saveProfile;
window.signOut          = signOut;
window.createRoom       = createRoom;
window.removeInvite     = removeInvite;
window.removeMember     = removeMember;
window.switchRsTab      = switchRsTab;
window.closeModal       = closeModal;
window.showView         = showView;
window.toggleMembersPanel = toggleMembersPanel;
window.toggleMobileSidebar = toggleMobileSidebar;
window.startCall        = startCall;
window.acceptCall       = acceptCall;
window.rejectCall       = rejectCall;
window.endCall          = endCall;
window.toggleMute       = toggleMute;
window.toggleScreenShare= toggleScreenShare;
window.sendMessage      = sendMessage;
window.startEdit        = startEdit;
window.deleteMsg        = deleteMsg;
window.ctxEdit          = ctxEdit;
window.ctxDelete        = ctxDelete;

console.log("NexusChat v2.0 cargado ✓");
