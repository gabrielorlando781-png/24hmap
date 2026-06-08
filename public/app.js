// Estado do Aplicativo
let state = {
  user: null,
  partner: null,
  partnerOnline: false,
  socket: null,
  map: null,
  markers: {},
  placeMarkers: {},
  routeLines: {},
  watchId: null,
  wakeLock: null,
  lastPosition: null,
  lastPositionTime: null,
  currentStatusEmoji: '📍',
  currentStatusText: 'Ativo',
  battery: { level: null, charging: false }
};

// Configurações
const API_URL = window.location.origin;

// Elementos da UI
const ui = {
  registerModal: document.getElementById('register-modal'),
  usernameInput: document.getElementById('username-input'),
  avatarOptions: document.querySelectorAll('.avatar-option'),
  saveProfileBtn: document.getElementById('save-profile-btn'),
  
  selfName: document.getElementById('self-name'),
  selfAvatar: document.getElementById('self-avatar'),
  selfStatusMsg: document.getElementById('self-status-msg'),
  selfBattery: document.getElementById('self-battery'),
  selfSpeed: document.getElementById('self-speed'),
  
  unpairedView: document.getElementById('unpaired-view'),
  pairedView: document.getElementById('paired-view'),
  partnerName: document.getElementById('partner-name'),
  partnerAvatar: document.getElementById('partner-avatar'),
  partnerStatusMsg: document.getElementById('partner-status-msg'),
  partnerBattery: document.getElementById('partner-battery'),
  partnerSpeed: document.getElementById('partner-speed'),
  partnerOnlineIndicator: document.getElementById('partner-online-indicator'),
  
  myPairingCode: document.getElementById('my-pairing-code'),
  copyCodeBtn: document.getElementById('copy-code-btn'),
  partnerCodeInput: document.getElementById('partner-code-input'),
  pairBtn: document.getElementById('pair-btn'),
  disconnectView: document.getElementById('disconnect-view'),
  unpairBtn: document.getElementById('unpair-btn'),
  inputPairingContainer: document.getElementById('input-pairing-container'),
  
  statusBtns: document.querySelectorAll('.status-btn'),
  sosTriggerBtn: document.getElementById('sos-trigger-btn'),
  sosBanner: document.getElementById('sos-banner'),
  sosTitle: document.getElementById('sos-title'),
  sosMessage: document.getElementById('sos-message'),
  closeSosBtn: document.getElementById('close-sos-btn'),
  
  wakeLockToggle: document.getElementById('wake-lock-toggle'),
  bottomSheet: document.getElementById('bottom-sheet'),
  dragHandleTrigger: document.getElementById('drag-handle-trigger'),
  
  helpBtn: document.getElementById('help-btn'),
  helpModal: document.getElementById('help-modal'),
  closeHelpBtn: document.getElementById('close-help-btn'),
  pwaInstallBtn: document.getElementById('pwa-install-btn')
};

// Inicialização Principal
window.addEventListener('DOMContentLoaded', async () => {
  initBottomSheet();
  initMap();
  setupEventListeners();
  setupPWA();
  initPlaceModal();
  initPhotoUpload();
  requestNotificationPermission();
  initDrawingBoard();
  
  const savedUserId = localStorage.getItem('userId');
  if (savedUserId) {
    await loginUser(savedUserId);
  } else {
    showRegisterModal();
  }
});

// --- AUTENTICAÇÃO E SESSÃO ---
function showRegisterModal() {
  ui.registerModal.classList.remove('hidden');
  
  // Seleção de Avatar
  ui.avatarOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      ui.avatarOptions.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
    });
  });
}

async function loginUser(userId) {
  try {
    const response = await fetch(`${API_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: userId })
    });
    
    if (!response.ok) {
      localStorage.removeItem('userId');
      showRegisterModal();
      return;
    }
    
    const user = await response.json();
    state.user = user;
    localStorage.setItem('cached_user', JSON.stringify(user));
    
    updateSelfUI();
    initSocket();
    startLocationTracking();
    await fetchCircleDetails();
    await fetchPlaces();
  } catch (err) {
    console.error('Erro ao fazer login:', err);
    // Tenta offline fallback se já tiver dados salvos localmente
    const cachedUser = localStorage.getItem('cached_user');
    if (cachedUser) {
      state.user = JSON.parse(cachedUser);
      updateSelfUI();
      
      const cachedPartner = localStorage.getItem('cached_partner');
      if (cachedPartner) {
        state.partner = JSON.parse(cachedPartner);
        state.partnerOnline = false;
        updatePartnerUI();
      }
      
      startLocationTracking();
      alert('Conectado em modo offline. As atualizações em tempo real iniciarão quando a internet retornar.');
    }
  }
}

// Registrar Novo Usuário
ui.saveProfileBtn.addEventListener('click', async () => {
  const username = ui.usernameInput.value.trim();
  if (!username) {
    alert('Por favor, insira seu nome');
    return;
  }
  
  const photoPreview = document.getElementById('photo-preview');
  const uploadedPhoto = photoPreview?.dataset.base64;
  const selectedAvatarOpt = document.querySelector('.avatar-option.selected');
  const avatarSeed = selectedAvatarOpt ? selectedAvatarOpt.dataset.seed : 'cool-fox';
  const avatarUrl = uploadedPhoto || `https://api.dicebear.com/7.x/bottts/svg?seed=${avatarSeed}`;
  
  try {
    const response = await fetch(`${API_URL}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, avatar: avatarUrl })
    });
    
    if (!response.ok) throw new Error('Falha no registro');
    
    const user = await response.json();
    state.user = user;
    localStorage.setItem('userId', user.id);
    localStorage.setItem('cached_user', JSON.stringify(user));
    
    ui.registerModal.classList.add('hidden');
    updateSelfUI();
    initSocket();
    startLocationTracking();
  } catch (err) {
    console.error(err);
    alert('Erro ao criar perfil. Tente novamente.');
  }
});

// --- MEUS LOCAIS ---
async function fetchPlaces() {
  if (!state.user) return;
  try {
    const res = await fetch(`${API_URL}/api/places/${state.user.id}`);
    const places = await res.json();
    renderPlacesOnMap(places);
    renderPlacesList(places);
  } catch (err) {
    console.error('Erro ao buscar lugares:', err);
  }
}

function renderPlacesOnMap(places) {
  // Remove marcadores antigos
  Object.values(state.placeMarkers).forEach(m => state.map.removeLayer(m));
  state.placeMarkers = {};

  places.forEach(place => {
    const icon = L.divIcon({
      html: `<div class="place-marker-pin">${place.icon}</div>`,
      className: 'place-div-icon',
      iconSize: [36, 36],
      iconAnchor: [18, 36],
      popupAnchor: [0, -38]
    });
    const marker = L.marker([place.lat, place.lng], { icon }).addTo(state.map);
    marker.bindPopup(`<strong style="color:#c084fc">${place.icon} ${place.name}</strong>`);
    state.placeMarkers[place.id] = marker;
  });
}

function renderPlacesList(places) {
  const list = document.getElementById('places-list');
  if (!list) return;
  list.innerHTML = places.length === 0
    ? '<p class="places-empty">Nenhum local salvo ainda.</p>'
    : places.map(p => `
        <div class="place-item">
          <span class="place-icon">${p.icon}</span>
          <span class="place-name">${p.name}</span>
          <div class="place-actions">
            <button class="place-edit-btn" data-id="${p.id}" data-name="${p.name}" data-icon="${p.icon}" data-lat="${p.lat}" data-lng="${p.lng}" title="Editar">✏️</button>
            <button class="place-delete-btn" data-id="${p.id}" title="Remover">✕</button>
          </div>
        </div>
      `).join('');

  list.querySelectorAll('.place-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetch(`${API_URL}/api/places/${btn.dataset.id}`, { method: 'DELETE' });
      fetchPlaces();
    });
  });

  list.querySelectorAll('.place-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      openPlaceModal({
        id: btn.dataset.id,
        name: btn.dataset.name,
        icon: btn.dataset.icon,
        lat: parseFloat(btn.dataset.lat),
        lng: parseFloat(btn.dataset.lng)
      });
    });
  });
}

// --- MODAL DE LUGAR ---
let placeModalState = { id: null, lat: null, lng: null, pickingOnMap: false };

function openPlaceModal(existing = null) {
  placeModalState = { id: null, lat: null, lng: null, pickingOnMap: false };

  const modal = document.getElementById('place-modal');
  const title = document.getElementById('place-modal-title');
  const nameInput = document.getElementById('place-name-input');
  const locStatus = document.getElementById('place-location-status');

  document.querySelectorAll('.emoji-btn').forEach(b => b.classList.remove('selected'));
  document.querySelector('.emoji-btn[data-emoji="📍"]').classList.add('selected');

  if (existing) {
    placeModalState.id = existing.id;
    placeModalState.lat = existing.lat;
    placeModalState.lng = existing.lng;
    title.textContent = 'Editar Local';
    nameInput.value = existing.name;
    locStatus.textContent = `📌 Local salvo (${existing.lat.toFixed(4)}, ${existing.lng.toFixed(4)})`;
    locStatus.className = 'place-location-status set';
    const emojiBtn = document.querySelector(`.emoji-btn[data-emoji="${existing.icon}"]`);
    if (emojiBtn) {
      document.querySelectorAll('.emoji-btn').forEach(b => b.classList.remove('selected'));
      emojiBtn.classList.add('selected');
    }
  } else {
    title.textContent = 'Adicionar Local';
    nameInput.value = '';
    locStatus.textContent = 'Nenhuma localização selecionada';
    locStatus.className = 'place-location-status';
  }

  modal.classList.remove('hidden');
}

function initPlaceModal() {
  const modal = document.getElementById('place-modal');

  document.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.emoji-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  document.getElementById('use-current-loc-btn').addEventListener('click', () => {
    if (!state.lastPosition) {
      alert('Aguardando GPS. Tente novamente em instantes.');
      return;
    }
    placeModalState.lat = state.lastPosition.coords.latitude;
    placeModalState.lng = state.lastPosition.coords.longitude;
    const status = document.getElementById('place-location-status');
    status.textContent = `✅ Localização atual capturada`;
    status.className = 'place-location-status set';
  });

  document.getElementById('pick-on-map-btn').addEventListener('click', () => {
    modal.classList.add('hidden');
    placeModalState.pickingOnMap = true;
    const banner = document.createElement('div');
    banner.id = 'map-pick-banner';
    banner.className = 'map-pick-banner';
    banner.textContent = '📍 Toque no mapa para marcar o local';
    document.getElementById('map-container').appendChild(banner);
    state.map.once('click', (e) => {
      placeModalState.lat = e.latlng.lat;
      placeModalState.lng = e.latlng.lng;
      placeModalState.pickingOnMap = false;
      banner.remove();
      const status = document.getElementById('place-location-status');
      status.textContent = `✅ Local marcado no mapa`;
      status.className = 'place-location-status set';
      modal.classList.remove('hidden');
    });
  });

  document.getElementById('cancel-place-btn').addEventListener('click', () => {
    modal.classList.add('hidden');
    document.getElementById('map-pick-banner')?.remove();
  });

  document.getElementById('save-place-btn').addEventListener('click', async () => {
    const name = document.getElementById('place-name-input').value.trim();
    const icon = document.querySelector('.emoji-btn.selected')?.dataset.emoji || '📍';

    if (!name) { alert('Dê um nome ao local.'); return; }
    if (placeModalState.lat === null) { alert('Selecione uma localização.'); return; }

    const btn = document.getElementById('save-place-btn');
    btn.textContent = 'Salvando...';
    btn.disabled = true;

    try {
      if (placeModalState.id) {
        await fetch(`${API_URL}/api/places/${placeModalState.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, icon })
        });
      } else {
        await fetch(`${API_URL}/api/places`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: state.user.id, name, icon, lat: placeModalState.lat, lng: placeModalState.lng })
        });
      }
      modal.classList.add('hidden');
      fetchPlaces();
    } catch (err) {
      alert('Erro ao salvar local.');
    } finally {
      btn.textContent = 'Salvar Local';
      btn.disabled = false;
    }
  });

  // Botões rápidos de lugar
  document.querySelectorAll('.quick-place-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      openPlaceModal(null);
      document.getElementById('place-name-input').value = btn.dataset.name;
      const emojiBtn = document.querySelector(`.emoji-btn[data-emoji="${btn.dataset.icon}"]`);
      if (emojiBtn) {
        document.querySelectorAll('.emoji-btn').forEach(b => b.classList.remove('selected'));
        emojiBtn.classList.add('selected');
      }
    });
  });

  document.getElementById('place-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('place-modal')) {
      document.getElementById('place-modal').classList.add('hidden');
    }
  });
}

// --- FOTO DE PERFIL ---
function resizeImageToBase64(file, maxSize = 256) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ratio = Math.min(maxSize / img.width, maxSize / img.height);
        canvas.width = img.width * ratio;
        canvas.height = img.height * ratio;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function initPhotoUpload() {
  // No modal de registro
  const uploadArea = document.getElementById('photo-upload-area');
  const photoInput = document.getElementById('profile-photo-input');
  const photoPreview = document.getElementById('photo-preview');

  uploadArea?.addEventListener('click', () => photoInput.click());

  photoInput?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const base64 = await resizeImageToBase64(file);
    photoPreview.innerHTML = `<img src="${base64}" class="photo-preview-img" alt="Foto">`;
    photoPreview.dataset.base64 = base64;
    // Deselecionar avatares ao escolher foto
    document.querySelectorAll('.avatar-option').forEach(o => o.classList.remove('selected'));
  });

  // No card de perfil (editar foto existente)
  const editAvatarBtn = document.getElementById('edit-avatar-btn');
  const editPhotoInput = document.getElementById('edit-photo-input');

  editAvatarBtn?.addEventListener('click', () => editPhotoInput.click());

  editPhotoInput?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || !state.user) return;
    const base64 = await resizeImageToBase64(file);
    try {
      await fetch(`${API_URL}/api/users/${state.user.id}/avatar`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar: base64 })
      });
      state.user.avatar = base64;
      localStorage.setItem('cached_user', JSON.stringify(state.user));
      updateSelfUI();
      if (state.markers['self']) updateMapMarker('self',
        state.markers['self'].getLatLng(),
        base64, state.user.username
      );
    } catch (err) {
      alert('Erro ao atualizar foto.');
    }
  });
}

// Buscar informações do círculo de pareamento
async function fetchCircleDetails() {
  if (!state.user) return;
  try {
    const response = await fetch(`${API_URL}/api/users/${state.user.id}`);
    const data = await response.json();

    state.user = data.user;
    state.partner = data.partner;

    localStorage.setItem('cached_user', JSON.stringify(data.user));
    if (data.partner) {
      localStorage.setItem('cached_partner', JSON.stringify(data.partner));
    } else {
      localStorage.removeItem('cached_partner');
    }

    updateSelfUI();
    updatePartnerUI();
    
    if (state.partner) {
      // Carregar histórico de rotas do parceiro
      fetchHistory(state.partner.id, 'partner');
      // Carregar seu próprio histórico
      fetchHistory(state.user.id, 'self');
      // Verificar se há desenhos novos do parceiro
      checkPartnerDrawings();
    }
  } catch (err) {
    console.error('Erro ao carregar círculo:', err);
  }
}

// --- CONTROLE DA INTERFACE ---
function updateSelfUI() {
  if (!state.user) return;
  ui.selfName.textContent = state.user.username + ' (Você)';
  ui.selfAvatar.src = state.user.avatar;
  ui.myPairingCode.textContent = state.user.pairing_code;
  
  if (state.user.paired_user_id) {
    ui.disconnectView.classList.remove('hidden');
    ui.inputPairingContainer.classList.add('hidden');
  } else {
    ui.disconnectView.classList.add('hidden');
    ui.inputPairingContainer.classList.remove('hidden');
  }
}

function updatePartnerUI() {
  if (state.partner) {
    ui.unpairedView.classList.add('hidden');
    ui.pairedView.classList.remove('hidden');
    ui.partnerName.textContent = state.partner.username;
    ui.partnerAvatar.src = state.partner.avatar;
    
    // Status Online
    if (state.partnerOnline) {
      ui.partnerOnlineIndicator.className = 'status-indicator online';
    } else {
      ui.partnerOnlineIndicator.className = 'status-indicator offline';
    }
  } else {
    ui.unpairedView.classList.remove('hidden');
    ui.pairedView.classList.add('hidden');
    removeMarker('partner');
    if (state.routeLines['partner']) {
      state.map.removeLayer(state.routeLines['partner']);
      delete state.routeLines['partner'];
    }
  }
}

// --- WEBSOCKETS (TEMPO REAL) ---
function initSocket() {
  if (!state.user) return;
  
  state.socket = io(API_URL);
  
  state.socket.on('connect', () => {
    console.log('Conectado ao servidor WebSocket');
    state.socket.emit('register-socket', state.user.id);
    
    // Envia localização atual imediata após conectar
    if (state.lastPosition) {
      sendLocationUpdate(state.lastPosition);
    }
  });
  
  // Recebe localização do parceiro
  state.socket.on('location-changed', (data) => {
    if (!state.partner || data.userId !== state.partner.id) return;
    
    state.partnerOnline = true;
    updatePartnerUI();
    
    // Atualizar dados de interface
    if (data.battery_level != null) {
      ui.partnerBattery.textContent = `🔋 ${Math.round(data.battery_level)}%${data.charging ? ' ⚡' : ''}`;
    } else {
      ui.partnerBattery.textContent = `🔋 N/A`;
    }

    const speedKmh = data.speed != null ? Math.round(data.speed * 3.6) : 0;
    ui.partnerSpeed.textContent = `🚗 ${speedKmh} km/h`;
    
    if (data.status_msg) {
      ui.partnerStatusMsg.textContent = data.status_msg;
    }
    
    // Atualizar marcador no mapa
    updateMapMarker('partner', [data.latitude, data.longitude], state.partner.avatar, state.partner.username, data);
    
    // Adicionar ponto ao histórico da rota em tempo real
    addPointToRoute('partner', [data.latitude, data.longitude]);
  });

  // Recebe alteração de status online/offline do parceiro
  state.socket.on('partner-status-change', (data) => {
    if (!state.partner || data.userId !== state.partner.id) return;
    state.partnerOnline = data.online;
    updatePartnerUI();
  });

  // Recebe SOS
  state.socket.on('receive-sos', (data) => {
    showSOSAlert(data.senderName, data.message);
  });

  // Recebe Desenho em Tempo Real
  state.socket.on('receive-drawing', (data) => {
    showDrawingNotification(data.senderName, data.imageData, data.timestamp);
  });
  
  // Recebe despareamento
  state.socket.on('unpaired', () => {
    alert('Seu pareamento foi encerrado pelo outro usuário.');
    state.partner = null;
    state.partnerOnline = false;
    updatePartnerUI();
  });
}

// --- MAPA LEAFLET ---
function initMap() {
  // Inicializa mapa padrão centrado no Brasil
  state.map = L.map('map', {
    zoomControl: true,
    attributionControl: false
  }).setView([-23.55052, -46.633308], 13); // São Paulo
  
  // Leaflet Tile Layer (Dark visual via CSS filter)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(state.map);
  
  // Ajusta tamanho do mapa
  setTimeout(() => {
    state.map.invalidateSize();
  }, 500);
}

// Atualizar ou criar marcador no mapa
function updateMapMarker(key, latlng, avatar, username, meta = {}) {
  if (!state.map) return;
  
  const isSelf = key === 'self';
  
  // Criar elemento HTML customizado para o marcador
  const customIconHtml = `
    <div class="custom-map-marker ${isSelf ? 'self' : 'partner'}">
      <img src="${avatar}" class="marker-avatar" alt="${username}">
      <div class="marker-pin"></div>
    </div>
  `;
  
  const customIcon = L.divIcon({
    html: customIconHtml,
    className: 'custom-div-icon',
    iconSize: [44, 52],
    iconAnchor: [22, 52],
    popupAnchor: [0, -55]
  });
  
  const speedKmh = meta.speed ? Math.round(meta.speed * 3.6) : 0;
  const batteryInfo = meta.battery_level !== undefined ? `<br>🔋 Bateria: ${Math.round(meta.battery_level)}%` : '';
  const statusInfo = meta.status_msg ? `<br>💬 Status: ${meta.status_msg}` : '';
  const accuracyInfo = meta.accuracy ? `<br>🎯 Precisão: ±${Math.round(meta.accuracy)}m` : '';
  
  const popupContent = `
    <div style="color: #fff; font-family: sans-serif; font-size: 12px; padding: 4px;">
      <strong style="color: ${isSelf ? '#8b5cf6' : '#10b981'}; font-size: 14px;">${username}</strong>
      ${statusInfo}
      <br>🚗 Velocidade: ${speedKmh} km/h
      ${batteryInfo}
      ${accuracyInfo}
    </div>
  `;
  
  if (state.markers[key]) {
    // Mover marcador existente com animação
    state.markers[key].setLatLng(latlng);
    state.markers[key].getPopup().setContent(popupContent);
  } else {
    // Criar novo marcador
    state.markers[key] = L.marker(latlng, { icon: customIcon }).addTo(state.map);
    state.markers[key].bindPopup(popupContent);
    
    // Na primeira carga de qualquer marcador, ajusta o zoom
    fitMapBounds();
  }
}

function removeMarker(key) {
  if (state.markers[key]) {
    state.map.removeLayer(state.markers[key]);
    delete state.markers[key];
  }
}

function fitMapBounds() {
  const activeMarkers = Object.values(state.markers);
  if (activeMarkers.length === 0) return;
  
  if (activeMarkers.length === 1) {
    state.map.setView(activeMarkers[0].getLatLng(), 15);
  } else {
    const group = new L.featureGroup(activeMarkers);
    state.map.fitBounds(group.getBounds().pad(0.3));
  }
}

// Histórico de Rotas - Desenhar no Mapa
async function fetchHistory(userId, key) {
  try {
    const response = await fetch(`${API_URL}/api/history/${userId}`);
    const history = await response.json();
    
    if (!history || history.length === 0) return;
    
    const latlngs = history.map(loc => [loc.latitude, loc.longitude]);
    
    // Atualizar marcador de localização mais recente do histórico caso o socket ainda não tenha enviado
    const latest = history[history.length - 1];
    const avatar = key === 'self' ? state.user.avatar : state.partner.avatar;
    const name = key === 'self' ? state.user.username : state.partner.username;
    
    updateMapMarker(key, [latest.latitude, latest.longitude], avatar, name, latest);
    
    // Desenhar polilinhas
    drawRouteLine(key, latlngs);
  } catch (err) {
    console.error('Erro ao buscar histórico:', err);
  }
}

function drawRouteLine(key, latlngs) {
  if (!state.map) return;
  
  const color = key === 'self' ? '#8b5cf6' : '#10b981';
  
  if (state.routeLines[key]) {
    state.map.removeLayer(state.routeLines[key]);
  }
  
  state.routeLines[key] = L.polyline(latlngs, {
    color: color,
    weight: 4,
    opacity: 0.6,
    dashArray: '5, 8'
  }).addTo(state.map);
}

function addPointToRoute(key, latlng) {
  if (!state.routeLines[key]) {
    drawRouteLine(key, [latlng]);
    return;
  }
  const currentPath = state.routeLines[key].getLatLngs();
  currentPath.push(latlng);
  state.routeLines[key].setLatLngs(currentPath);
}

// --- GEOLOCALIZAÇÃO ---
function startLocationTracking() {
  if (!navigator.geolocation) {
    alert('Seu dispositivo não suporta Geolocalização.');
    return;
  }

  setupBatteryMonitoring();

  const tryWatch = (highAccuracy) => {
    state.watchId = navigator.geolocation.watchPosition(
      onLocationSuccess,
      (err) => {
        if (highAccuracy && err.code === err.TIMEOUT) {
          // Fallback para baixa precisão se alta precisão der timeout
          tryWatch(false);
        } else {
          onLocationError(err);
        }
      },
      { enableHighAccuracy: highAccuracy, timeout: 15000, maximumAge: 5000 }
    );
  };

  tryWatch(true);
}

function calcSpeedFromPositions(prevPos, prevTime, currCoords, currTime) {
  if (!prevPos) return null;
  const R = 6371000;
  const lat1 = prevPos.coords.latitude * Math.PI / 180;
  const lat2 = currCoords.latitude * Math.PI / 180;
  const dLat = (currCoords.latitude - prevPos.coords.latitude) * Math.PI / 180;
  const dLng = (currCoords.longitude - prevPos.coords.longitude) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
  const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const secs = (currTime - prevTime) / 1000;
  return secs > 0 ? dist / secs : null;
}

function onLocationSuccess(position) {
  const now = Date.now();
  const { latitude, longitude, speed: gpsSpeed, accuracy } = position.coords;

  // Calcula velocidade manualmente se o GPS não fornecer
  const calculatedSpeed = calcSpeedFromPositions(state.lastPosition, state.lastPositionTime, position.coords, now);
  const speed = (gpsSpeed != null && gpsSpeed >= 0) ? gpsSpeed : calculatedSpeed;

  state.lastPosition = position;
  state.lastPositionTime = now;

  // Atualizar UI de velocidade
  const speedKmh = speed != null ? Math.round(speed * 3.6) : 0;
  ui.selfSpeed.textContent = `🚗 ${speedKmh} km/h`;

  // Bateria vem do estado global (atualizado por setupBatteryMonitoring)
  const { level: batteryLevel, charging } = state.battery;
  if (batteryLevel != null) {
    ui.selfBattery.textContent = `🔋 ${Math.round(batteryLevel)}%${charging ? ' ⚡' : ''}`;
  }

  const updateData = {
    userId: state.user.id,
    latitude,
    longitude,
    battery_level: batteryLevel,
    charging,
    speed,
    accuracy,
    status_msg: `${state.currentStatusEmoji} ${state.currentStatusText}`
  };

  ui.selfStatusMsg.textContent = updateData.status_msg;
  updateMapMarker('self', [latitude, longitude], state.user.avatar, state.user.username, updateData);
  addPointToRoute('self', [latitude, longitude]);

  if (state.socket?.connected) {
    state.socket.emit('update-location', updateData);
  }
}

function onLocationError(err) {
  console.warn('Erro de Geolocalização:', err.code, err.message);
  const badge = document.getElementById('gps-status-badge');

  const msgs = {
    1: 'Permissão negada',
    2: 'GPS indisponível',
    3: 'Timeout GPS'
  };

  badge.textContent = msgs[err.code] || 'Erro GPS';
  badge.className = 'status-badge';
  badge.style.cssText = 'background:rgba(239,68,68,0.1);color:var(--red);border:1px solid rgba(239,68,68,0.2)';

  if (err.code === 1) {
    alert('Permissão de localização negada. Acesse as configurações do navegador e permita o acesso ao GPS.');
  }
}

async function setupBatteryMonitoring() {
  if (!navigator.getBattery) return;
  try {
    const battery = await navigator.getBattery();

    const updateBattery = () => {
      state.battery.level = battery.level * 100;
      state.battery.charging = battery.charging;
      if (state.battery.level != null) {
        ui.selfBattery.textContent = `🔋 ${Math.round(state.battery.level)}%${state.battery.charging ? ' ⚡' : ''}`;
      }
    };

    updateBattery();
    battery.addEventListener('levelchange', updateBattery);
    battery.addEventListener('chargingchange', updateBattery);
  } catch (err) {
    console.warn('Battery API indisponível:', err.message);
  }
}

// --- SOS ALERTS COM AUDIO SYNTHESIZER ---
function showSOSAlert(senderName, message) {
  ui.sosTitle.textContent = `SOS: ${senderName.toUpperCase()}`;
  ui.sosMessage.textContent = message;
  ui.sosBanner.classList.remove('hidden');
  
  // Toca o alerta sonoro em loop por 5 segundos
  let beeps = 0;
  const beepInterval = setInterval(() => {
    playEmergencyBeep();
    beeps++;
    if (beeps >= 8) clearInterval(beepInterval);
  }, 600);

  // Dispara notificação nativa do sistema se houver permissão
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(`🚨 ALERTA SOS: ${senderName}`, {
      body: message,
      icon: 'https://cdn-icons-png.flaticon.com/512/854/854878.png',
      tag: 'sos-alert'
    });
  }
}

function playEmergencyBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(950, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(450, ctx.currentTime + 0.45);
    
    gain.gain.setValueAtTime(0.6, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.45);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch (e) {
    console.warn('Falha ao tocar som SOS:', e);
  }
}

ui.closeSosBtn.addEventListener('click', () => {
  ui.sosBanner.classList.add('hidden');
});

// --- WAKE LOCK API ---
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      state.wakeLock = await navigator.wakeLock.request('screen');
      console.log('Wake Lock ativo: Tela não desligará');
    }
  } catch (err) {
    console.warn('Falha no Wake Lock:', err.message);
  }
}

function releaseWakeLock() {
  if (state.wakeLock) {
    state.wakeLock.release().then(() => {
      state.wakeLock = null;
      console.log('Wake Lock liberado');
    });
  }
}

ui.wakeLockToggle.addEventListener('change', (e) => {
  if (e.target.checked) {
    requestWakeLock();
  } else {
    releaseWakeLock();
  }
});

// Re-requisitar lock e buscar desenhos se o app voltar de minimizado
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (state.wakeLock !== null) {
      requestWakeLock();
    }
    if (state.user && state.partner) {
      checkPartnerDrawings();
    }
  }
});

// --- BOTTOM SHEET INTERATIVO (MOBILE GESTURES) ---
function initBottomSheet() {
  let startY = 0;
  let currentY = 0;
  let isDragging = false;
  
  const toggleSheet = () => {
    if (ui.bottomSheet.classList.contains('collapsed')) {
      ui.bottomSheet.classList.remove('collapsed');
      ui.bottomSheet.classList.add('expanded');
    } else {
      ui.bottomSheet.classList.remove('expanded');
      ui.bottomSheet.classList.add('collapsed');
    }
  };
  
  // Trigger por clique
  ui.dragHandleTrigger.addEventListener('click', toggleSheet);
  
  // Touch Gestures para arrasto fluído
  ui.dragHandleTrigger.addEventListener('touchstart', (e) => {
    startY = e.touches[0].clientY;
    isDragging = true;
  });
  
  document.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    currentY = e.touches[0].clientY;
    const diff = startY - currentY;
    
    // Se arrastar bastante para cima, expande. Se para baixo, colapsa.
    if (diff > 50) {
      ui.bottomSheet.classList.remove('collapsed');
      ui.bottomSheet.classList.add('expanded');
      isDragging = false;
    } else if (diff < -50) {
      ui.bottomSheet.classList.remove('expanded');
      ui.bottomSheet.classList.add('collapsed');
      isDragging = false;
    }
  });
  
  document.addEventListener('touchend', () => {
    isDragging = false;
  });
}

// --- EVENT LISTENERS GERAIS ---
function setupEventListeners() {
  // Auto-uppercase no input do código
  ui.partnerCodeInput.addEventListener('input', (e) => {
    const pos = e.target.selectionStart;
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    e.target.setSelectionRange(pos, pos);
  });

  // Copiar código de compartilhamento
  ui.copyCodeBtn.addEventListener('click', () => {
    const code = ui.myPairingCode.textContent;
    if (code && code !== '------') {
      navigator.clipboard.writeText(code).then(() => {
        alert('Código copiado: ' + code);
      }).catch(err => {
        console.error('Falha ao copiar:', err);
      });
    }
  });
  
  // Conectar com outro usuário
  ui.pairBtn.addEventListener('click', async () => {
    const code = ui.partnerCodeInput.value.trim().toUpperCase();
    if (!code || code.length !== 6) {
      alert('Por favor, insira um código válido de 6 caracteres');
      return;
    }

    ui.pairBtn.textContent = 'Conectando...';
    ui.pairBtn.disabled = true;

    try {
      const response = await fetch(`${API_URL}/api/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: state.user.id, code })
      });

      const result = await response.json();
      if (!response.ok) {
        alert(result.error || 'Erro ao parear');
        return;
      }

      ui.partnerCodeInput.value = '';
      await fetchCircleDetails();
    } catch (err) {
      console.error(err);
      alert('Erro ao realizar pareamento');
    } finally {
      ui.pairBtn.textContent = 'Conectar';
      ui.pairBtn.disabled = false;
    }
  });
  
  // Desconectar do parceiro
  ui.unpairBtn.addEventListener('click', async () => {
    if (!confirm('Deseja realmente desconectar deste parceiro? O compartilhamento mútuo parará imediatamente.')) {
      return;
    }
    
    try {
      const response = await fetch(`${API_URL}/api/unpair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: state.user.id })
      });
      
      if (response.ok) {
        state.partner = null;
        state.partnerOnline = false;
        updateSelfUI();
        updatePartnerUI();
      }
    } catch (err) {
      console.error(err);
    }
  });
  
  // Botões de Status Rápido
  ui.statusBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      ui.statusBtns.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      
      state.currentStatusEmoji = btn.dataset.emoji;
      state.currentStatusText = btn.dataset.text;
      
      // Forçar atualização de localização imediata
      if (state.lastPosition) {
        onLocationSuccess(state.lastPosition);
      }
    });
  });
  
  // Disparar SOS
  ui.sosTriggerBtn.addEventListener('click', () => {
    if (!state.partner) {
      alert('Você precisa parear com um parceiro primeiro para enviar alertas de SOS!');
      return;
    }
    if (confirm('Deseja enviar um Alerta Emergencial SOS para seu parceiro agora?')) {
      if (state.socket && state.socket.connected) {
        state.socket.emit('send-sos', {
          userId: state.user.id,
          message: '🚨 ATENÇÃO! Seu parceiro enviou um alerta de ajuda!'
        });
        alert('Alerta SOS disparado com sucesso!');
      } else {
        alert('Sem conexão ativa no momento. Tente novamente em instantes.');
      }
    }
  });
  
  // Abrir e Fechar Modal de Ajuda
  ui.helpBtn.addEventListener('click', () => ui.helpModal.classList.remove('hidden'));
  ui.closeHelpBtn.addEventListener('click', () => ui.helpModal.classList.add('hidden'));
  
  // Salvar local rápido com a posição atual
  document.querySelectorAll('.quick-place-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!state.user) return;
      const icon = btn.dataset.icon;
      const name = btn.dataset.name;
      btn.disabled = true;
      btn.textContent = 'Salvando...';
      await saveCurrentLocationAsPlace(name, icon);
      btn.disabled = false;
      btn.textContent = `${icon} ${name}`;
    });
  });

  // Abrir Modal de Pareamento diretamente pelo card vazio
  document.getElementById('open-pair-modal-btn').addEventListener('click', () => {
    ui.bottomSheet.classList.remove('collapsed');
    ui.bottomSheet.classList.add('expanded');
    ui.partnerCodeInput.focus();
  });
}

// --- INSTALAÇÃO PWA ---
function setupPWA() {
  // Registrar Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('Service Worker registrado com sucesso:', reg.scope))
      .catch(err => console.error('Erro ao registrar Service Worker:', err));
  }
  
  // Capturar evento de instalação
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    ui.pwaInstallBtn.classList.remove('hidden');
  });
  
  ui.pwaInstallBtn.addEventListener('click', () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((choiceResult) => {
      if (choiceResult.outcome === 'accepted') {
        console.log('Usuário aceitou a instalação do PWA');
        ui.pwaInstallBtn.classList.add('hidden');
      }
      deferredPrompt = null;
    });
  });
}

function requestNotificationPermission() {
  if (!('Notification' in window)) return;

  const showBlockOverlay = () => {
    if (document.getElementById('notification-blocker')) return;

    const blocker = document.createElement('div');
    blocker.id = 'notification-blocker';
    blocker.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(9, 9, 11, 0.96);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      z-index: 99999;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      padding: 30px;
      text-align: center;
      color: #fff;
    `;

    blocker.innerHTML = `
      <div style="font-size: 4.5rem; margin-bottom: 24px; animation: pulse-red 2s infinite;">🔔</div>
      <h2 style="font-size: 1.6rem; font-weight: 700; margin-bottom: 12px; font-family: 'Outfit', sans-serif;">Notificações Necessárias</h2>
      <p style="font-size: 0.95rem; color: #a1a1aa; max-width: 320px; line-height: 1.6; margin-bottom: 28px; font-family: 'Plus Jakarta Sans', sans-serif;">
        O 24hApp exige permissão de notificação para alertar você em caso de SOS e atualizações de segurança do seu parceiro.
      </p>
      <button id="retry-notification-btn" class="btn btn-primary btn-lg" style="box-shadow: 0 0 20px rgba(139, 92, 246, 0.4); padding: 14px 28px;">
        Ativar Notificações
      </button>
      <p style="font-size: 0.78rem; color: #71717a; margin-top: 20px; max-width: 280px; line-height: 1.4; font-family: 'Plus Jakarta Sans', sans-serif;">
        Caso já tenha bloqueado nas configurações do navegador, clique no ícone de cadeado ao lado da URL na barra de endereços para liberar o acesso.
      </p>
    `;

    document.body.appendChild(blocker);

    document.getElementById('retry-notification-btn').addEventListener('click', () => {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          blocker.remove();
        } else if (permission === 'denied') {
          alert('A permissão continua bloqueada. Por favor, libere no ícone de cadeado do seu navegador para usar o app.');
        }
      });
    });
  };

  if (Notification.permission === 'denied') {
    showBlockOverlay();
  } else if (Notification.permission === 'default') {
    Notification.requestPermission().then(permission => {
      if (permission === 'denied') {
        showBlockOverlay();
      }
    });
  }
}

// --- LOUSA DO CASAL (DESENHO E NOTIFICAÇÕES) ---
let currentNotificationTimestamp = null;

function initDrawingBoard() {
  const canvas = document.getElementById('drawing-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let isDrawing = false;
  let currentColor = '#8b5cf6'; // Violeta padrão
  let lastX = 0;
  let lastY = 0;

  // Configurar traçado suave e sombra neon
  const setupContext = () => {
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = currentColor;
    ctx.shadowBlur = 10;
  };
  setupContext();

  // Mapear coordenadas considerando escala responsiva do Canvas
  function getCoords(e) {
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;
    
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    
    return {
      x: ((clientX - rect.left) / rect.width) * canvas.width,
      y: ((clientY - rect.top) / rect.height) * canvas.height
    };
  }

  // Eventos Mouse
  canvas.addEventListener('mousedown', (e) => {
    isDrawing = true;
    const { x, y } = getCoords(e);
    lastX = x;
    lastY = y;
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;
    const { x, y } = getCoords(e);
    
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    
    lastX = x;
    lastY = y;
  });

  canvas.addEventListener('mouseup', () => isDrawing = false);
  canvas.addEventListener('mouseleave', () => isDrawing = false);

  // Eventos Toque (Celular)
  canvas.addEventListener('touchstart', (e) => {
    isDrawing = true;
    const { x, y } = getCoords(e);
    lastX = x;
    lastY = y;
  });

  canvas.addEventListener('touchmove', (e) => {
    if (!isDrawing) return;
    const { x, y } = getCoords(e);
    
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    
    lastX = x;
    lastY = y;
  });

  canvas.addEventListener('touchend', () => isDrawing = false);

  // Seletores de Cores
  const colorBtns = document.querySelectorAll('.color-btn');
  colorBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      colorBtns.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      currentColor = btn.dataset.color;
      setupContext();
    });
  });

  // Limpar Canvas
  const clearBtn = document.getElementById('clear-canvas-btn');
  clearBtn?.addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  });

  // Botão Enviar Desenho
  const sendBtn = document.getElementById('send-drawing-btn');
  sendBtn?.addEventListener('click', () => {
    if (!state.partner) {
      alert('Você precisa parear com seu parceiro primeiro para enviar um desenho!');
      return;
    }

    // Verificar se o canvas está vazio
    const buffer = new Uint32Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data.buffer);
    const hasDrawing = buffer.some(color => color !== 0);
    if (!hasDrawing) {
      alert('Desenhe algo na lousa antes de enviar!');
      return;
    }

    if (state.socket && state.socket.connected) {
      const imageData = canvas.toDataURL('image/png');
      state.socket.emit('send-drawing', {
        userId: state.user.id,
        imageData
      });
      alert('Desenho enviado para seu parceiro com sucesso! 🎨');
    } else {
      alert('Erro de conexão. Verifique sua rede e tente novamente.');
    }
  });

  // Bind para fechar modal de notificação
  const closeDrawingModalBtn = document.getElementById('close-drawing-modal-btn');
  closeDrawingModalBtn?.addEventListener('click', () => {
    const modal = document.getElementById('drawing-notification-modal');
    modal.classList.add('hidden');
    if (currentNotificationTimestamp) {
      localStorage.setItem('last_viewed_drawing_timestamp', currentNotificationTimestamp);
    }
  });
}

function showDrawingNotification(senderName, imageData, timestamp) {
  const modal = document.getElementById('drawing-notification-modal');
  const senderNameEl = document.getElementById('drawing-sender-name');
  const imgEl = document.getElementById('received-drawing-img');

  if (!modal || !senderNameEl || !imgEl) return;

  currentNotificationTimestamp = timestamp;
  senderNameEl.textContent = senderName;
  imgEl.src = imageData;
  modal.classList.remove('hidden');

  // Som de sino romântico
  playRomanticAlertSound();
}

async function checkPartnerDrawings() {
  if (!state.user || !state.partner) return;
  try {
    const response = await fetch(`${API_URL}/api/drawings/${state.user.id}`);
    if (!response.ok) return;
    const drawing = await response.json();
    if (drawing) {
      const lastViewed = localStorage.getItem('last_viewed_drawing_timestamp');
      if (!lastViewed || Number(drawing.timestamp) > Number(lastViewed)) {
        showDrawingNotification(state.partner.username, drawing.image_data, drawing.timestamp);
      }
    }
  } catch (err) {
    console.error('Erro ao verificar desenhos pendentes:', err);
  }
}

function playRomanticAlertSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const playTone = (freq, startTime, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);
      
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.3, startTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start(startTime);
      osc.stop(startTime + duration);
    };

    const now = ctx.currentTime;
    playTone(523.25, now, 0.8);      // C5
    playTone(659.25, now + 0.15, 0.8); // E5
    playTone(783.99, now + 0.30, 0.8); // G5
    playTone(1046.50, now + 0.45, 1.2); // C6
  } catch (e) {
    console.warn('Falha ao tocar som romântico:', e);
  }
}
