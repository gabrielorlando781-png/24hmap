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
  requestNotificationPermission();
  
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
  
  const selectedAvatarOpt = document.querySelector('.avatar-option.selected');
  const avatarSeed = selectedAvatarOpt ? selectedAvatarOpt.dataset.seed : 'cool-fox';
  const avatarUrl = `https://api.dicebear.com/7.x/bottts/svg?seed=${avatarSeed}`;
  
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
          <button class="place-delete-btn" data-id="${p.id}">✕</button>
        </div>
      `).join('');

  list.querySelectorAll('.place-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetch(`${API_URL}/api/places/${btn.dataset.id}`, { method: 'DELETE' });
      fetchPlaces();
    });
  });
}

async function saveCurrentLocationAsPlace(name, icon) {
  if (!state.lastPosition) {
    alert('Aguardando GPS. Tente novamente em instantes.');
    return;
  }
  const { latitude: lat, longitude: lng } = state.lastPosition.coords;
  await fetch(`${API_URL}/api/places`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: state.user.id, name, icon, lat, lng })
  });
  fetchPlaces();
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

// Re-requisitar lock se o app voltar de minimizado
document.addEventListener('visibilitychange', () => {
  if (state.wakeLock !== null && document.visibilityState === 'visible') {
    requestWakeLock();
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
  if ('Notification' in window) {
    Notification.requestPermission().then(permission => {
      console.log('Permissão de Notificação:', permission);
    });
  }
}
