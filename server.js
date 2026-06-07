import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Inicialização do Banco de Dados SQLite (Nativo do Node.js)
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'database.db');
const db = new DatabaseSync(dbPath);

// Criar tabelas se não existirem
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    avatar TEXT,
    pairing_code TEXT UNIQUE NOT NULL,
    paired_user_id TEXT
  );
  
  CREATE TABLE IF NOT EXISTS places (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '📍',
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    battery_level REAL,
    charging INTEGER,
    speed REAL,
    accuracy REAL,
    status_msg TEXT,
    timestamp INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

// Helper para gerar código de pareamento único de 6 caracteres (ex: A8F9X2)
function generatePairingCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Evita caracteres confusos como O, 0, I, 1
  let code = '';
  const selectQuery = db.prepare('SELECT 1 FROM users WHERE pairing_code = ?');
  
  while (true) {
    code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    // Verifica se já existe no banco
    const exists = selectQuery.get(code);
    if (!exists) break;
  }
  return code;
}

// REST APIs
// Registrar um novo usuário
app.post('/api/register', (req, res) => {
  try {
    const { username, avatar } = req.body;
    if (!username) {
      return res.status(400).json({ error: 'Username é obrigatório' });
    }

    const id = crypto.randomUUID();
    const pairingCode = generatePairingCode();
    
    const insertUser = db.prepare(
      'INSERT INTO users (id, username, avatar, pairing_code, paired_user_id) VALUES (?, ?, ?, ?, NULL)'
    );
    insertUser.run(id, username, avatar || 'avatar1', pairingCode);

    res.status(201).json({
      id,
      username,
      avatar: avatar || 'avatar1',
      pairing_code: pairingCode,
      paired_user_id: null
    });
  } catch (error) {
    console.error('Erro no registro:', error);
    res.status(500).json({ error: 'Erro ao registrar usuário' });
  }
});

// Login (Obter dados do usuário pelo ID)
app.post('/api/login', (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ error: 'ID é obrigatório' });
    }

    const getUser = db.prepare('SELECT * FROM users WHERE id = ?');
    const user = getUser.get(id);

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    res.json(user);
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro ao fazer login' });
  }
});

// Conectar/Parear dois usuários pelo código
app.post('/api/pair', (req, res) => {
  try {
    const { userId, code } = req.body;
    if (!userId || !code) {
      return res.status(400).json({ error: 'userId e code são obrigatórios' });
    }

    // Buscar o usuário que possui o código
    const getUserByCode = db.prepare('SELECT * FROM users WHERE pairing_code = ?');
    const partner = getUserByCode.get(code.toUpperCase().trim());

    if (!partner) {
      return res.status(404).json({ error: 'Código de pareamento inválido' });
    }

    if (partner.id === userId) {
      return res.status(400).json({ error: 'Você não pode se parear consigo mesmo' });
    }

    // Verificar se o parceiro ou o usuário já estão pareados
    const getUser = db.prepare('SELECT * FROM users WHERE id = ?');
    const currentUser = getUser.get(userId);

    if (!currentUser) {
      return res.status(404).json({ error: 'Usuário atual não encontrado' });
    }

    if (currentUser.paired_user_id || partner.paired_user_id) {
      return res.status(400).json({ error: 'Um dos usuários já está pareado com outra pessoa' });
    }

    // Atualizar no banco os IDs de pareamento mútuo
    const updatePairing = db.prepare('UPDATE users SET paired_user_id = ? WHERE id = ?');
    updatePairing.run(partner.id, userId);
    updatePairing.run(userId, partner.id);

    res.json({
      message: 'Pareamento realizado com sucesso!',
      partner: {
        id: partner.id,
        username: partner.username,
        avatar: partner.avatar
      }
    });
  } catch (error) {
    console.error('Erro no pareamento:', error);
    res.status(500).json({ error: 'Erro ao realizar pareamento' });
  }
});

// Desparear
app.post('/api/unpair', (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId é obrigatório' });
    }

    const getUser = db.prepare('SELECT * FROM users WHERE id = ?');
    const user = getUser.get(userId);

    if (user && user.paired_user_id) {
      const partnerId = user.paired_user_id;
      const clearPairing = db.prepare('UPDATE users SET paired_user_id = NULL WHERE id = ?');
      clearPairing.run(userId);
      clearPairing.run(partnerId);
      
      // Notificar através de WebSocket que foram despareados
      io.to(userId).emit('unpaired');
      io.to(partnerId).emit('unpaired');
    }

    res.json({ message: 'Despareamento realizado' });
  } catch (error) {
    console.error('Erro ao desparear:', error);
    res.status(500).json({ error: 'Erro ao processar despareamento' });
  }
});

// Obter detalhes de pareamento e parceiro
app.get('/api/users/:id', (req, res) => {
  try {
    const { id } = req.params;
    const getUser = db.prepare('SELECT * FROM users WHERE id = ?');
    const user = getUser.get(id);

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    let partner = null;
    if (user.paired_user_id) {
      partner = getUser.get(user.paired_user_id);
    }

    res.json({ user, partner });
  } catch (error) {
    console.error('Erro ao buscar usuário:', error);
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// --- LUGARES SALVOS ---
app.get('/api/places/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    const getPlaces = db.prepare('SELECT * FROM places WHERE user_id = ?');
    res.json(getPlaces.all(userId));
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar lugares' });
  }
});

app.post('/api/places', (req, res) => {
  try {
    const { userId, name, icon, lat, lng } = req.body;
    if (!userId || !name || lat === undefined || lng === undefined) {
      return res.status(400).json({ error: 'userId, name, lat e lng são obrigatórios' });
    }
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO places (id, user_id, name, icon, lat, lng) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, userId, name, icon || '📍', lat, lng);
    res.status(201).json({ id, userId, name, icon: icon || '📍', lat, lng });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao salvar lugar' });
  }
});

app.delete('/api/places/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM places WHERE id = ?').run(req.params.id);
    res.json({ message: 'Lugar removido' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao remover lugar' });
  }
});

// Obter histórico de localização recente (últimas 50 posições)
app.get('/api/history/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    const getHistory = db.prepare(`
      SELECT latitude, longitude, battery_level, charging, speed, accuracy, status_msg, timestamp
      FROM locations
      WHERE user_id = ?
      ORDER BY timestamp DESC
      LIMIT 50
    `);
    const history = getHistory.all(userId);
    res.json(history.reverse()); // Retorna em ordem cronológica
  } catch (error) {
    console.error('Erro ao buscar histórico:', error);
    res.status(500).json({ error: 'Erro ao buscar histórico' });
  }
});

// Rastreamento de conexões ativas por usuário (userId -> Set de socket.ids)
const activeConnections = new Map();

function notifyPartnerStatus(userId, isOnline) {
  try {
    const getUser = db.prepare('SELECT paired_user_id FROM users WHERE id = ?');
    const user = getUser.get(userId);
    if (user && user.paired_user_id) {
      io.to(user.paired_user_id).emit('partner-status-change', {
        userId,
        online: isOnline
      });
    }
  } catch (err) {
    console.error('Erro ao notificar status do parceiro:', err);
  }
}

// Socket.io Real-Time
io.on('connection', (socket) => {
  console.log(`Dispositivo conectado: ${socket.id}`);
  
  let currentUserId = null;

  // Registrar ID do usuário conectado para entrar no seu próprio room
  socket.on('register-socket', (userId) => {
    currentUserId = userId;
    socket.join(userId);
    console.log(`Usuário ${userId} entrou na sala WebSocket correspondente.`);
    
    // Rastrear conexões ativas
    if (!activeConnections.has(userId)) {
      activeConnections.set(userId, new Set());
    }
    activeConnections.get(userId).add(socket.id);
    
    // Notificar parceiro que está online
    notifyPartnerStatus(userId, true);
  });

  // Atualização de localização recebida
  socket.on('update-location', (data) => {
    const { userId, latitude, longitude, battery_level, charging, speed, accuracy, status_msg } = data;
    
    if (!userId || latitude === undefined || longitude === undefined) return;

    try {
      const now = Date.now();
      
      // Salvar no banco
      const insertLoc = db.prepare(`
        INSERT INTO locations (user_id, latitude, longitude, battery_level, charging, speed, accuracy, status_msg, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertLoc.run(
        userId, 
        latitude, 
        longitude, 
        battery_level ?? null, 
        charging ? 1 : 0, 
        speed ?? null, 
        accuracy ?? null, 
        status_msg ?? null, 
        now
      );

      // Buscar se o usuário possui parceiro
      const getUser = db.prepare('SELECT paired_user_id FROM users WHERE id = ?');
      const user = getUser.get(userId);

      if (user && user.paired_user_id) {
        // Enviar atualização direta para o parceiro
        io.to(user.paired_user_id).emit('location-changed', {
          userId,
          latitude,
          longitude,
          battery_level,
          charging,
          speed,
          accuracy,
          status_msg,
          timestamp: now
        });
      }
    } catch (err) {
      console.error('Erro ao salvar/transmitir geolocalização:', err);
    }
  });

  // Enviar SOS/Alerta
  socket.on('send-sos', (data) => {
    const { userId, message } = data;
    if (!userId) return;

    try {
      const getUser = db.prepare('SELECT paired_user_id, username FROM users WHERE id = ?');
      const user = getUser.get(userId);

      if (user && user.paired_user_id) {
        io.to(user.paired_user_id).emit('receive-sos', {
          senderId: userId,
          senderName: user.username,
          message: message || 'Precisa de atenção imediata!'
        });
      }
    } catch (err) {
      console.error('Erro ao processar SOS:', err);
    }
  });

  socket.on('disconnect', () => {
    console.log(`Dispositivo desconectado: ${socket.id}`);
    
    if (currentUserId && activeConnections.has(currentUserId)) {
      const sockets = activeConnections.get(currentUserId);
      sockets.delete(socket.id);
      
      // Se não houver mais conexões ativas para este usuário, ele está realmente offline
      if (sockets.size === 0) {
        activeConnections.delete(currentUserId);
        notifyPartnerStatus(currentUserId, false);
      }
    }
  });
});

// Limpeza automática de localizações com mais de 7 dias
const cleanOldLocations = db.prepare(
  'DELETE FROM locations WHERE timestamp < ?'
);
setInterval(() => {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const result = cleanOldLocations.run(cutoff);
  if (result.changes > 0) {
    console.log(`[Cleanup] ${result.changes} localizações antigas removidas.`);
  }
}, 60 * 60 * 1000); // Roda a cada 1 hora

// Porta
const PORT = process.env.PORT || 3333;
httpServer.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  let localIP = 'localhost';
  for (const iface of Object.values(nets)) {
    for (const net of iface) {
      if (net.family === 'IPv4' && !net.internal) {
        localIP = net.address;
        break;
      }
    }
  }
  console.log(`--------------------------------------------------`);
  console.log(`✅  Local:   http://localhost:${PORT}`);
  console.log(`📱  Celular: http://${localIP}:${PORT}`);
  console.log(`--------------------------------------------------`);
});
