import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import os from 'os';

const { Pool } = pg;
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

// Inicialização do Pool do PostgreSQL (Supabase / Neon)
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ ERRO CRÍTICO: A variável de ambiente DATABASE_URL não foi definida.');
  console.log('----------------------------------------------------------------------');
  console.log('Para testar localmente conectando ao Supabase, execute no terminal:');
  console.log('PowerShell: $env:DATABASE_URL="sua-url-de-conexao-do-supabase"');
  console.log('CMD/Windows: set DATABASE_URL="sua-url-de-conexao-do-supabase"');
  console.log('Linux/macOS: export DATABASE_URL="sua-url-de-conexao-do-supabase"');
  console.log('----------------------------------------------------------------------');
}

const pool = new Pool({
  connectionString: connectionString,
  ssl: connectionString ? { rejectUnauthorized: false } : false
});

// Criar tabelas se não existirem no PostgreSQL
async function initDatabase() {
  if (!connectionString) return;
  try {
    await pool.query(`
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
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS locations (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        battery_level REAL,
        charging INTEGER,
        speed REAL,
        accuracy REAL,
        status_msg TEXT,
        timestamp BIGINT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
    console.log('✅ Banco de dados PostgreSQL (Supabase) inicializado com sucesso.');
  } catch (err) {
    console.error('❌ Erro ao inicializar tabelas no banco de dados:', err);
  }
}
initDatabase();

// Helper para gerar código de pareamento único de 6 caracteres (ex: A8F9X2)
async function generatePairingCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  
  while (true) {
    code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    // Verifica se já existe no banco
    const res = await pool.query('SELECT 1 FROM users WHERE pairing_code = $1', [code]);
    if (res.rowCount === 0) break;
  }
  return code;
}

// REST APIs
// Registrar um novo usuário
app.post('/api/register', async (req, res) => {
  try {
    const { username, avatar } = req.body;
    if (!username) {
      return res.status(400).json({ error: 'Username é obrigatório' });
    }

    const id = crypto.randomUUID();
    const pairingCode = await generatePairingCode();
    
    await pool.query(
      'INSERT INTO users (id, username, avatar, pairing_code, paired_user_id) VALUES ($1, $2, $3, $4, NULL)',
      [id, username, avatar || 'avatar1', pairingCode]
    );

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
app.post('/api/login', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ error: 'ID é obrigatório' });
    }

    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    const user = result.rows[0];

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
app.post('/api/pair', async (req, res) => {
  try {
    const { userId, code } = req.body;
    if (!userId || !code) {
      return res.status(400).json({ error: 'userId e code são obrigatórios' });
    }

    // Buscar o usuário que possui o código
    const partnerRes = await pool.query('SELECT * FROM users WHERE pairing_code = $1', [code.toUpperCase().trim()]);
    const partner = partnerRes.rows[0];

    if (!partner) {
      return res.status(404).json({ error: 'Código de pareamento inválido' });
    }

    if (partner.id === userId) {
      return res.status(400).json({ error: 'Você não pode se parear consigo mesmo' });
    }

    // Verificar se o parceiro ou o usuário já estão pareados
    const currentUserRes = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    const currentUser = currentUserRes.rows[0];

    if (!currentUser) {
      return res.status(404).json({ error: 'Usuário atual não encontrado' });
    }

    if (currentUser.paired_user_id || partner.paired_user_id) {
      return res.status(400).json({ error: 'Um dos usuários já está pareado com outra pessoa' });
    }

    // Atualizar no banco os IDs de pareamento mútuo (usando transação simples)
    await pool.query('BEGIN');
    await pool.query('UPDATE users SET paired_user_id = $1 WHERE id = $2', [partner.id, userId]);
    await pool.query('UPDATE users SET paired_user_id = $1 WHERE id = $2', [userId, partner.id]);
    await pool.query('COMMIT');

    res.json({
      message: 'Pareamento realizado com sucesso!',
      partner: {
        id: partner.id,
        username: partner.username,
        avatar: partner.avatar
      }
    });
  } catch (error) {
    await pool.query('ROLLBACK').catch(() => {});
    console.error('Erro no pareamento:', error);
    res.status(500).json({ error: 'Erro ao realizar pareamento' });
  }
});

// Desparear
app.post('/api/unpair', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId é obrigatório' });
    }

    const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    const user = userRes.rows[0];

    if (user && user.paired_user_id) {
      const partnerId = user.paired_user_id;
      
      await pool.query('BEGIN');
      await pool.query('UPDATE users SET paired_user_id = NULL WHERE id = $1', [userId]);
      await pool.query('UPDATE users SET paired_user_id = NULL WHERE id = $1', [partnerId]);
      await pool.query('COMMIT');
      
      // Notificar através de WebSocket que foram despareados
      io.to(userId).emit('unpaired');
      io.to(partnerId).emit('unpaired');
    }

    res.json({ message: 'Despareamento realizado' });
  } catch (error) {
    await pool.query('ROLLBACK').catch(() => {});
    console.error('Erro ao desparear:', error);
    res.status(500).json({ error: 'Erro ao processar despareamento' });
  }
});

// Obter detalhes de pareamento e parceiro
app.get('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    const user = userRes.rows[0];

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    let partner = null;
    if (user.paired_user_id) {
      const partnerRes = await pool.query('SELECT * FROM users WHERE id = $1', [user.paired_user_id]);
      partner = partnerRes.rows[0];
    }

    res.json({ user, partner });
  } catch (error) {
    console.error('Erro ao buscar usuário:', error);
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// --- LUGARES SALVOS ---
app.get('/api/places/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query('SELECT * FROM places WHERE user_id = $1', [userId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar lugares' });
  }
});

app.post('/api/places', async (req, res) => {
  try {
    const { userId, name, icon, lat, lng } = req.body;
    if (!userId || !name || lat === undefined || lng === undefined) {
      return res.status(400).json({ error: 'userId, name, lat e lng são obrigatórios' });
    }
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO places (id, user_id, name, icon, lat, lng) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, userId, name, icon || '📍', lat, lng]
    );
    res.status(201).json({ id, userId, name, icon: icon || '📍', lat, lng });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao salvar lugar' });
  }
});

app.delete('/api/places/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM places WHERE id = $1', [req.params.id]);
    res.json({ message: 'Lugar removido' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao remover lugar' });
  }
});

// Obter histórico de localização recente (últimas 50 posições)
app.get('/api/history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query(`
      SELECT latitude, longitude, battery_level, charging, speed, accuracy, status_msg, timestamp
      FROM locations
      WHERE user_id = $1
      ORDER BY timestamp DESC
      LIMIT 50
    `, [userId]);
    res.json(result.rows.reverse()); // Retorna em ordem cronológica
  } catch (error) {
    console.error('Erro ao buscar histórico:', error);
    res.status(500).json({ error: 'Erro ao buscar histórico' });
  }
});

// Rastreamento de conexões ativas por usuário (userId -> Set de socket.ids)
const activeConnections = new Map();

async function notifyPartnerStatus(userId, isOnline) {
  try {
    const res = await pool.query('SELECT paired_user_id FROM users WHERE id = $1', [userId]);
    const user = res.rows[0];
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
  socket.on('update-location', async (data) => {
    const { userId, latitude, longitude, battery_level, charging, speed, accuracy, status_msg } = data;
    
    if (!userId || latitude === undefined || longitude === undefined) return;

    try {
      const now = Date.now();
      
      // Salvar no banco
      await pool.query(`
        INSERT INTO locations (user_id, latitude, longitude, battery_level, charging, speed, accuracy, status_msg, timestamp)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        userId, 
        latitude, 
        longitude, 
        battery_level ?? null, 
        charging ? 1 : 0, 
        speed ?? null, 
        accuracy ?? null, 
        status_msg ?? null, 
        now
      ]);

      // Buscar se o usuário possui parceiro
      const userRes = await pool.query('SELECT paired_user_id FROM users WHERE id = $1', [userId]);
      const user = userRes.rows[0];

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
  socket.on('send-sos', async (data) => {
    const { userId, message } = data;
    if (!userId) return;

    try {
      const userRes = await pool.query('SELECT paired_user_id, username FROM users WHERE id = $1', [userId]);
      const user = userRes.rows[0];

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
setInterval(async () => {
  if (!connectionString) return;
  try {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const res = await pool.query('DELETE FROM locations WHERE timestamp < $1', [cutoff]);
    if (res.rowCount > 0) {
      console.log(`[Cleanup] ${res.rowCount} localizações antigas removidas do PostgreSQL.`);
    }
  } catch (err) {
    console.error('[Cleanup] Erro ao limpar localizações antigas:', err);
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
