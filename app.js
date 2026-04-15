/* ═══════════════════════════════════════════════════════
   ██████╗ ██████╗ ██╗██╗   ██╗ █████╗ ████████╗███████╗
   ██╔══██╗██╔══██╗██║██║   ██║██╔══██╗╚══██╔══╝██╔════╝
   ██████╔╝██████╔╝██║██║   ██║███████║   ██║   █████╗
   ██╔═══╝ ██╔══██╗██║╚██╗ ██╔╝██╔══██║   ██║   ██╔══╝
   ██║     ██║  ██║██║ ╚████╔╝ ██║  ██║   ██║   ███████╗
   ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═══╝  ╚═╝  ╚═╝  ╚═╝   ╚══════╝
   CHAT - PrivateChat v1.0
   ═══════════════════════════════════════════════════════

   ╔══════════════════════════════════════════════════════╗
   ║  🔧 CONFIGURACIÓN DE FIREBASE                        ║
   ║                                                      ║
   ║  Reemplaza los valores de firebaseConfig con los     ║
   ║  datos de TU proyecto Firebase.                      ║
   ║  Ver instrucciones en README.md                      ║
   ╚══════════════════════════════════════════════════════╝
*/

const firebaseConfig = {
  apiKey:            "REEMPLAZA_CON_TU_API_KEY",
  authDomain:        "REEMPLAZA_CON_TU_AUTH_DOMAIN",
  databaseURL:       "REEMPLAZA_CON_TU_DATABASE_URL",
  projectId:         "REEMPLAZA_CON_TU_PROJECT_ID",
  storageBucket:     "REEMPLAZA_CON_TU_STORAGE_BUCKET",
  messagingSenderId: "REEMPLAZA_CON_TU_MESSAGING_SENDER_ID",
  appId:             "REEMPLAZA_CON_TU_APP_ID"
};

/* ─── STUN servers (servidores ICE públicos) ─── */
const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" }
  ]
};

/* ─── Sala fija (mismo para todos, cambia si quieres privacidad) ─── */
const ROOM_ID = "sala-privada-01";

/* ══════════════════════════════
   ESTADO DE LA APP
══════════════════════════════ */
let db, myId, myNickname, peerId, peerNickname;
let localStream = null;
let screenStream = null;
let peerConnection = null;
let isMuted = false;
let isSharingScreen = false;
let callState = "idle"; // idle | calling | ringing | in-call
let typingTimer = null;
let isTyping = false;

/* ══════════════════════════════
   FIREBASE REFS (se asignan al iniciar)
══════════════════════════════ */
let roomRef, usersRef, messagesRef, signalingRef, typingRef;

/* ══════════════════════════════
   ELEMENTOS DEL DOM
══════════════════════════════ */
const $ = id => document.getElementById(id);
const loginScreen   = $("login-screen");
const appScreen     = $("app-screen");
const nicknameInput = $("nickname-input");
const enterBtn      = $("enter-btn");
const sidebarAvatar = $("sidebar-avatar");
const sidebarName   = $("sidebar-name");
const peerStatusDot = $("peer-status-dot");
const peerStatusLbl = $("peer-status-label");
const callBtn       = $("call-btn");
const screenBtn     = $("screen-btn");
const callPanel     = $("call-panel");
const callStatusTxt = $("call-status-text");
const callAvatarLoc = $("call-avatar-local");
const callNameLoc   = $("call-name-local");
const callAvatarRem = $("call-avatar-remote");
const callNameRem   = $("call-name-remote");
const incomingOvly  = $("incoming-call-overlay");
const incomingAvt   = $("incoming-avatar");
const incomingNm    = $("incoming-name");
const acceptCallBtn = $("accept-call-btn");
const rejectCallBtn = $("reject-call-btn");
const muteBtn       = $("mute-btn");
const endCallBtn    = $("end-call-btn");
const shareScrnBtn  = $("share-screen-btn");
const screenArea    = $("screen-share-area");
const remoteVideo   = $("remote-screen-video");
const localPreview  = $("local-screen-preview");
const messagesList  = $("messages-list");
const typingIndic   = $("typing-indicator");
const typingNmEl    = $("typing-name");
const messageInput  = $("message-input");
const sendBtn       = $("send-btn");
const remoteAudio   = $("remote-audio");

/* ══════════════════════════════
   INICIALIZACIÓN
══════════════════════════════ */
function initFirebase() {
  if (firebaseConfig.apiKey === "REEMPLAZA_CON_TU_API_KEY") {
    alert("⚠️ Debes configurar Firebase primero.\n\nAbre app.js y reemplaza los valores de firebaseConfig.\nVer instrucciones en README.md");
    return false;
  }
  firebase.initializeApp(firebaseConfig);
  db = firebase.database();
  return true;
}

/* ══════════════════════════════
   LOGIN
══════════════════════════════ */
enterBtn.addEventListener("click", handleEnter);
nicknameInput.addEventListener("keydown", e => { if (e.key === "Enter") handleEnter(); });

function handleEnter() {
  const nick = nicknameInput.value.trim();
  if (!nick) { nicknameInput.focus(); return; }
  if (!initFirebase()) return;
  myNickname = nick;
  myId = "user_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
  loginScreen.classList.remove("active");
  appScreen.classList.add("active");
  setupApp();
}

/* ══════════════════════════════
   SETUP PRINCIPAL
══════════════════════════════ */
function setupApp() {
  sidebarName.textContent = myNickname;
  sidebarAvatar.textContent = myNickname[0].toUpperCase();
  callNameLoc.textContent = myNickname;
  callAvatarLoc.textContent = myNickname[0].toUpperCase();

  roomRef     = db.ref(`rooms/${ROOM_ID}`);
  usersRef    = db.ref(`rooms/${ROOM_ID}/users`);
  messagesRef = db.ref(`rooms/${ROOM_ID}/messages`);
  signalingRef= db.ref(`rooms/${ROOM_ID}/signaling`);
  typingRef   = db.ref(`rooms/${ROOM_ID}/typing`);

  // Registrar usuario
  const myRef = usersRef.child(myId);
  myRef.set({ nickname: myNickname, joinedAt: firebase.database.ServerValue.TIMESTAMP });
  myRef.onDisconnect().remove();

  // Escuchar usuarios
  usersRef.on("value", snap => {
    const users = snap.val() || {};
    const otherUsers = Object.entries(users).filter(([id]) => id !== myId);
    if (otherUsers.length > 0) {
      const [id, data] = otherUsers[0];
      peerId = id;
      peerNickname = data.nickname;
      peerStatusDot.classList.add("online");
      peerStatusLbl.textContent = peerNickname + " está aquí";
      callBtn.disabled = false;
      screenBtn.disabled = false;
      messageInput.disabled = false;
      sendBtn.disabled = false;
      callNameRem.textContent = peerNickname;
      callAvatarRem.textContent = peerNickname[0].toUpperCase();
      incomingNm.textContent = peerNickname;
      incomingAvt.textContent = peerNickname[0].toUpperCase();
      addSystemMessage(`${peerNickname} se ha unido al chat 👋`);
    } else {
      peerId = null;
      peerNickname = null;
      peerStatusDot.classList.remove("online");
      peerStatusLbl.textContent = "Esperando al otro usuario...";
      callBtn.disabled = true;
      screenBtn.disabled = true;
      messageInput.disabled = true;
      sendBtn.disabled = true;
    }
  });

  // Escuchar mensajes
  messagesRef.on("child_added", snap => {
    const msg = snap.val();
    if (msg) renderMessage(msg);
  });

  // Escuchar señalización WebRTC
  signalingRef.on("child_added", snap => {
    const signal = snap.val();
    if (!signal || signal.to !== myId) return;
    handleSignal(signal);
    snap.ref.remove();
  });

  // Escuchar typing
  typingRef.on("value", snap => {
    const data = snap.val() || {};
    const peerTyping = peerId && data[peerId];
    if (peerTyping) {
      typingNmEl.textContent = peerNickname;
      typingIndic.classList.remove("hidden");
    } else {
      typingIndic.classList.add("hidden");
    }
    scrollToBottom();
  });

  // Input listeners
  messageInput.addEventListener("keydown", e => {
    if (e.key === "Enter") sendMessage();
    handleTypingStart();
  });
  sendBtn.addEventListener("click", sendMessage);
  callBtn.addEventListener("click", startCall);
  screenBtn.addEventListener("click", toggleScreenShare);
  muteBtn.addEventListener("click", toggleMute);
  endCallBtn.addEventListener("click", endCall);
  shareScrnBtn.addEventListener("click", toggleScreenShare);
  acceptCallBtn.addEventListener("click", acceptCall);
  rejectCallBtn.addEventListener("click", rejectCall);

  // Limpiar al salir
  window.addEventListener("beforeunload", () => {
    usersRef.child(myId).remove();
    typingRef.child(myId).remove();
    endCall();
  });
}

/* ══════════════════════════════
   MENSAJES
══════════════════════════════ */
function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !peerId) return;
  const msg = {
    id: Date.now() + "_" + Math.random().toString(36).slice(2, 6),
    authorId: myId,
    author: myNickname,
    text: text,
    timestamp: firebase.database.ServerValue.TIMESTAMP
  };
  messagesRef.push(msg);
  messageInput.value = "";
  stopTyping();
}

function renderMessage(msg) {
  // Evitar duplicados
  if (document.querySelector(`[data-msgid="${msg.id}"]`)) return;

  // Quitar bienvenida si existe
  const welcome = messagesList.querySelector(".welcome-msg");
  if (welcome) welcome.remove();

  const isMe = msg.authorId === myId;
  const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) : "";

  const group = document.createElement("div");
  group.className = "message-group";
  group.dataset.msgid = msg.id;

  const header = document.createElement("div");
  header.className = "message-header";
  const authorSpan = document.createElement("span");
  authorSpan.className = "msg-author " + (isMe ? "is-me" : "is-peer");
  authorSpan.textContent = isMe ? "Tú" : msg.author;
  const timeSpan = document.createElement("span");
  timeSpan.className = "msg-time";
  timeSpan.textContent = time;
  header.appendChild(authorSpan);
  header.appendChild(timeSpan);

  const row = document.createElement("div");
  row.className = "message-row " + (isMe ? "is-me" : "is-peer");
  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  bubble.textContent = msg.text;
  row.appendChild(bubble);

  group.appendChild(header);
  group.appendChild(row);
  messagesList.appendChild(group);
  scrollToBottom();
}

function addSystemMessage(text) {
  const div = document.createElement("div");
  div.className = "system-message";
  div.textContent = text;
  messagesList.appendChild(div);
  scrollToBottom();
}

function scrollToBottom() {
  messagesList.scrollTop = messagesList.scrollHeight;
}

/* ══════════════════════════════
   TYPING INDICATOR
══════════════════════════════ */
function handleTypingStart() {
  if (!isTyping) {
    isTyping = true;
    typingRef.child(myId).set(true);
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(stopTyping, 2000);
}

function stopTyping() {
  isTyping = false;
  typingRef.child(myId).remove();
  clearTimeout(typingTimer);
}

/* ══════════════════════════════
   WEBRTC - LLAMADAS
══════════════════════════════ */
async function startCall() {
  if (!peerId || callState !== "idle") return;
  callState = "calling";
  showCallPanel();
  callStatusTxt.textContent = "Llamando a " + peerNickname + "...";

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    createPeerConnection();
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    sendSignal({ type: "offer", sdp: offer.sdp, callerName: myNickname });
    callBtn.classList.add("active");
  } catch (err) {
    console.error("Error al iniciar llamada:", err);
    addSystemMessage("❌ No se pudo acceder al micrófono.");
    endCall();
  }
}

async function acceptCall() {
  if (callState !== "ringing") return;
  callState = "in-call";
  incomingOvly.classList.add("hidden");
  callStatusTxt.textContent = "En llamada con " + peerNickname;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    sendSignal({ type: "answer", sdp: answer.sdp });
    callBtn.classList.add("active");
    addSystemMessage("📞 Llamada iniciada");
  } catch (err) {
    console.error("Error al aceptar llamada:", err);
    addSystemMessage("❌ No se pudo acceder al micrófono.");
    endCall();
  }
}

function rejectCall() {
  sendSignal({ type: "reject" });
  callState = "idle";
  incomingOvly.classList.add("hidden");
  callPanel.classList.add("hidden");
  addSystemMessage("📵 Llamada rechazada");
}

function endCall() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
  }
  if (callState === "in-call" || callState === "calling") {
    sendSignal({ type: "end" });
    if (callState === "in-call") addSystemMessage("📵 Llamada finalizada");
  }
  callState = "idle";
  isMuted = false;
  isSharingScreen = false;
  remoteAudio.srcObject = null;
  remoteVideo.srcObject = null;
  screenArea.classList.add("hidden");
  callPanel.classList.add("hidden");
  incomingOvly.classList.add("hidden");
  callBtn.classList.remove("active");
  screenBtn.classList.remove("active");
  muteBtn.textContent = "🎤";
  muteBtn.classList.remove("muted");
  shareScrnBtn.classList.remove("screen-active");
}

/* ── PeerConnection ── */
function createPeerConnection() {
  peerConnection = new RTCPeerConnection(RTC_CONFIG);

  peerConnection.onicecandidate = e => {
    if (e.candidate) {
      sendSignal({ type: "ice", candidate: e.candidate.toJSON() });
    }
  };

  peerConnection.ontrack = e => {
    const stream = e.streams[0];
    if (e.track.kind === "audio") {
      remoteAudio.srcObject = stream;
    } else if (e.track.kind === "video") {
      remoteVideo.srcObject = stream;
      screenArea.classList.remove("hidden");
    }
  };

  peerConnection.onconnectionstatechange = () => {
    const state = peerConnection.connectionState;
    if (state === "disconnected" || state === "failed" || state === "closed") {
      endCall();
    }
  };
}

/* ── Señalización ── */
function sendSignal(data) {
  if (!peerId) return;
  signalingRef.push({ ...data, from: myId, to: peerId, ts: Date.now() });
}

async function handleSignal(signal) {
  switch (signal.type) {
    case "offer":
      if (callState !== "idle") return;
      callState = "ringing";
      createPeerConnection();
      await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: signal.sdp }));
      showCallPanel();
      incomingOvly.classList.remove("hidden");
      callStatusTxt.textContent = "Llamada entrante...";
      break;

    case "answer":
      if (peerConnection && peerConnection.signalingState !== "closed") {
        await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: signal.sdp }));
        callState = "in-call";
        callStatusTxt.textContent = "En llamada con " + peerNickname;
        addSystemMessage("📞 Llamada iniciada");
      }
      break;

    case "ice":
      if (peerConnection && signal.candidate) {
        try { await peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate)); }
        catch (e) { console.warn("ICE error:", e); }
      }
      break;

    case "reject":
      addSystemMessage("📵 " + (peerNickname || "El otro usuario") + " rechazó la llamada");
      endCall();
      break;

    case "end":
      addSystemMessage("📵 Llamada finalizada por " + (peerNickname || "el otro usuario"));
      endCall();
      break;

    case "screen-start":
      callStatusTxt.textContent = peerNickname + " está compartiendo pantalla";
      break;

    case "screen-stop":
      callStatusTxt.textContent = "En llamada con " + peerNickname;
      screenArea.classList.add("hidden");
      remoteVideo.srcObject = null;
      break;
  }
}

/* ── Compartir pantalla ── */
async function toggleScreenShare() {
  if (!isSharingScreen) {
    if (callState !== "in-call") {
      addSystemMessage("⚠️ Debes estar en una llamada para compartir pantalla.");
      return;
    }
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const videoTrack = screenStream.getVideoTracks()[0];

      // Agregar track de video al peer connection
      peerConnection.addTrack(videoTrack, screenStream);

      // Mostrar preview local
      localPreview.srcObject = screenStream;
      screenArea.classList.remove("hidden");

      isSharingScreen = true;
      shareScrnBtn.classList.add("screen-active");
      screenBtn.classList.add("active");
      sendSignal({ type: "screen-start" });
      addSystemMessage("🖥️ Compartiendo pantalla");

      videoTrack.onended = () => {
        stopScreenShare();
      };
    } catch (err) {
      console.error("Error compartir pantalla:", err);
      addSystemMessage("❌ No se pudo compartir pantalla.");
    }
  } else {
    stopScreenShare();
  }
}

function stopScreenShare() {
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
  }
  localPreview.srcObject = null;
  screenArea.classList.add("hidden");
  isSharingScreen = false;
  shareScrnBtn.classList.remove("screen-active");
  screenBtn.classList.remove("active");
  sendSignal({ type: "screen-stop" });
  addSystemMessage("🖥️ Compartir pantalla detenido");
}

/* ── Mute ── */
function toggleMute() {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(track => { track.enabled = !isMuted; });
  muteBtn.textContent = isMuted ? "🔇" : "🎤";
  muteBtn.classList.toggle("muted", isMuted);
}

/* ── Mostrar panel de llamada ── */
function showCallPanel() {
  callPanel.classList.remove("hidden");
}

/* ══════════════════════════════
   FIN DEL SCRIPT
══════════════════════════════ */
console.log("PrivateChat cargado ✓ Sala:", ROOM_ID);
