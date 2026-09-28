// 1. Agregamos el servicio del bot al inicio del archivo
const jwt = require('jsonwebtoken');
require('dotenv').config();
const chatBotService = require('../services/chatBotService');

// Tope de tamaño para que un cliente no pueda meter texto ilimitado en la BD.
const MAX_MESSAGE_LENGTH = 4000;

// El cliente puede enviar el JWT en el handshake por cualquiera de estas vías.
const tokenDelHandshake = (socket) => {
  const candidatos = [
    socket.handshake?.auth?.token,
    socket.handshake?.query?.token,
    socket.handshake?.headers?.authorization,
  ];
  for (const bruto of candidatos) {
    if (typeof bruto !== 'string') continue;
    const token = bruto.trim();
    if (!token) continue;
    return token.replace(/^Bearer\s+/i, '');
  }
  return null;
};

const nombreCompletoDe = (user) => {
  if (!user) return null;
  const partes = [user.nombre, user.apellidopat, user.apellidomat].filter(Boolean);
  return partes.length ? partes.join(' ') : null;
};

// Una sala privada solo es válida si el roomId es exactamente "private_<a>_<b>"
// con dos ids distintos. Devuelve null cuando el formato no es confiable.
const idsDeSalaPrivada = (roomId) => {
  const partes = String(roomId ?? '').split('_');
  if (partes[0] !== 'private' || partes.length !== 3) return null;
  const a = Number(partes[1]);
  const b = Number(partes[2]);
  if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
  if (a <= 0 || b <= 0 || a === b) return null;
  return [a, b];
};

const esMiembroDeSalaPrivada = (roomId, userId) => {
  const ids = idsDeSalaPrivada(roomId);
  if (!ids) return false;
  return ids.includes(Number(userId));
};

const esSalaPrivada = (roomId) => idsDeSalaPrivada(roomId) !== null;

const esRoomDeEventoValido = (eventoId) => {
  const clave = String(eventoId ?? '').trim();
  return clave === 'general' || /^\d+$/.test(clave);
};

// Única fuente de verdad para el acceso a un chat de evento. Se usa tanto al
// unirse como al enviar, para que nadie pueda saltarse el control escribiendo
// en una sala en la que nunca entró.
const puedeAccederAEvento = async (eventoId, userId) => {
  const id = parseInt(eventoId, 10);
  if (Number.isNaN(id)) return false;

  const { getModels } = require('../models');
  const { Comite, Evento } = getModels();

  const [esMiembroComite, evento] = await Promise.all([
    Comite.findOne({ where: { idevento: id, idusuario: userId } }),
    Evento.findOne({ where: { idevento: id }, attributes: ['nombreevento', 'idacademico'] }),
  ]);

  if (esMiembroComite) return true;
  return !!evento && parseInt(evento.idacademico, 10) === Number(userId);
};

// Trae los últimos `limite` mensajes en orden cronológico. Con un LIMIT en SQL
// hay que ordenar DESC y revertir: pedir ASC con límite devuelve siempre los
// mensajes más antiguos y los nuevos nunca llegan al historial.
const cargarHistorial = async (where, limite) => {
  const { getModels } = require('../models');
  const { ChatMensaje } = getModels();

  const filas = await ChatMensaje.findAll({
    where,
    order: [['createdAt', 'DESC']],
    limit: limite,
  });

  return filas.reverse().map(m => ({
    userId: m.idusuario,
    userName: m.username,
    role: m.role,
    message: m.message,
    esBot: m.role === 'bot',
    timestamp: m.createdAt,
  }));
};

/**
 * Cuenta y marca como leídas las notificaciones de chat privado pendientes de
 * una conversación. Es el puente entre la tabla `notificacion` (que se
 * escribía cuando el destinatario no tenía socket) y la lista de la UI: sin
 * esto el mensaje se guardaba pero no dejaba rastro de que estuviera sin leer.
 *
 * Se llama al abrir la conversación, no al recibir: así el contador refleja
 * "lo que había sin ver", que es justo lo que el usuario necesita distinguir.
 */
const marcarNotificacionesPrivadasLeidas = async ({ roomId, userId, otroId }) => {
  try {
    const { getModels } = require('../models');
    const { sequelize } = getModels();
    const ahora = new Date().toISOString();

    const [{ count }] = await sequelize.query(
      `SELECT COUNT(*)::int AS count FROM notificacion
       WHERE idusuario = :userId
         AND id_relacionado = :otroId
         AND tipo = 'chat_privado'
         AND estado != 'leido'`,
      { replacements: { userId, otroId }, type: sequelize.QueryTypes.SELECT }
    );

    if (!count) return 0;

    await sequelize.query(
      `UPDATE notificacion
       SET estado = 'leido', updated_at = :ahora
       WHERE idusuario = :userId
         AND id_relacionado = :otroId
         AND tipo = 'chat_privado'
         AND estado != 'leido'`,
      { replacements: { userId, otroId, ahora }, type: sequelize.QueryTypes.UPDATE }
    );

    console.log(`✅ [PRIVADO] ${count} notificación(es) marcada(s) como leída(s) en ${roomId}`);
    return count;
  } catch (e) {
    console.warn('⚠️ [PRIVADO] Error al marcar notificaciones como leídas:', e.message);
    return 0;
  }
};

/** Resumen de pendientes por conversación, para hidratar los contadores. */
const contarNotificacionesPrivadasPendientes = async ({ userId, otroId }) => {
  try {
    const { getModels } = require('../models');
    const { sequelize } = getModels();

    const [{ count }] = await sequelize.query(
      `SELECT COUNT(*)::int AS count FROM notificacion
       WHERE idusuario = :userId
         AND id_relacionado = :otroId
         AND tipo = 'chat_privado'
         AND estado != 'leido'`,
      { replacements: { userId, otroId }, type: sequelize.QueryTypes.SELECT }
    );

    return count || 0;
  } catch (e) {
    return 0;
  }
};

/**
 * Pendientes de todas las conversaciones privadas del usuario,indexadas por
 * roomId. Se usa en `personal_channel` para que el contador de la lista exista
 * desde el primer render y no solo después del primer polling.
 */
const pendientesPorConversacion = async (userId) => {
  try {
    const { getModels } = require('../models');
    const { sequelize } = getModels();

    const filas = await sequelize.query(
      `SELECT id_relacionado, COUNT(*)::int AS count
       FROM notificacion
       WHERE idusuario = :userId AND tipo = 'chat_privado' AND estado != 'leido'
       GROUP BY id_relacionado`,
      { replacements: { userId }, type: sequelize.QueryTypes.SELECT }
    );

    const yo = Number(userId);
    const resultado = {};
    filas.forEach((f) => {
      const otro = Number(f.id_relacionado);
      if (!Number.isInteger(otro) || otro === yo) return;
      const roomId = 'private_' + [yo, otro].sort((a, b) => a - b).join('_');
      resultado[roomId] = resultado[roomId] || 0;
      resultado[roomId] += f.count;
    });
    return resultado;
  } catch (e) {
    console.warn('⚠️ [PRIVADO] Error al leer pendientes:', e.message);
    return {};
  }
};

// Los listeners de notificación (ChatAlertas / ChatEmbed admin) solo se
// suscriben al canal personal `usuario_<id>`, así que las salas de sala no les
// llegan. Para el chat general hay que además difusión por canal personal.
const emitirEnCanalesPersonales = (io, senderId, payload, connectedUsers) => {
  connectedUsers.forEach((sockets, id) => {
    if (Number(id) === Number(senderId)) return;
    io.to('usuario_' + String(id)).emit('chat_notification', payload);
  });
};

const notificarSala = async (io, { roomId, userId, userName, role, message, timestamp, connectedUsers }) => {
  try {
    const senderId = parseInt(userId);
    if (isNaN(senderId)) return; // Sin userId válido no notificamos

    if (String(roomId) === 'general') {
      const payload = {
        type: 'general',
        roomId: String(roomId),
        roomName: 'Chat General',
        userId: senderId,
        userName: userName || 'Usuario',
        role,
        message,
        timestamp: timestamp || new Date().toISOString()
      };
      io.to('evento_general').emit('chat_notification', payload);
      emitirEnCanalesPersonales(io, senderId, payload, connectedUsers);
      return;
    }

    const destinatarios = [];
    let roomName = null;

    const { getModels } = require('../models');
    const { Comite, Evento, User } = getModels();

    if (String(roomId).startsWith('private_')) {
      const ids = idsDeSalaPrivada(roomId);
      if (!ids) return;
      const otroId = ids.find(n => n !== senderId);
      if (otroId == null) return;

      const otro = await User.findOne({
        where: { idusuario: otroId },
        attributes: ['nombre', 'apellidopat']
      });
      roomName = otro ? `${otro.nombre || ''} ${otro.apellidopat || ''}`.trim() || null : null;
      destinatarios.push('usuario_' + String(otroId));
    } else {
      const id = parseInt(roomId);
      if (isNaN(id)) return;

      const evento = await Evento.findOne({
        where: { idevento: id },
        attributes: ['nombreevento', 'idacademico']
      });
      roomName = evento?.nombreevento || null;

      const comite = await Comite.findAll({ where: { idevento: id }, attributes: ['idusuario'] });
      comite.forEach(c => destinatarios.push('usuario_' + String(c.idusuario)));

      if (evento && parseInt(evento.idacademico)) {
        destinatarios.push('usuario_' + String(evento.idacademico));
      }
    }

    const unicos = [...new Set(destinatarios)].filter(u => u !== 'usuario_' + String(senderId));

    const payload = {
      type: String(roomId).startsWith('private_') ? 'private' : 'evento',
      roomId: String(roomId),
      roomName,
      userId: senderId,
      userName: userName || 'Usuario',
      role,
      message,
      timestamp: timestamp || new Date().toISOString()
    };

    unicos.forEach(canal => io.to(canal).emit('chat_notification', payload));

    // Los chats de evento tampoco tienen push. connectedUsers se pasaba aquí
    // pero nunca se miraba, así que el mensaje se perdía en silencio para
    // cualquiera que no tuviera el socket abierto en ese instante.
    if (!esSalaPrivada(roomId)) {
      const { enviarPushAUsuario } = require('../services/webPushService');
      const esGeneral = String(roomId) === 'general';
      const titulo = esGeneral
        ? 'Nuevo mensaje en el Chat General'
        : `Nuevo mensaje en ${roomName || 'un evento'}`;
      const cuerpo = String(message || '').slice(0, 120);

      for (const canal of unicos) {
        const idDestino = Number(String(canal).replace('usuario_', ''));
        if (!Number.isInteger(idDestino)) continue;
        enviarPushAUsuario({
          idusuario: idDestino,
          titulo,
          cuerpo,
          data: {
            type: esGeneral ? 'general' : 'evento',
            roomId: String(roomId),
            roomName,
            idRelacionado: senderId,
            emisor: userName || null,
          },
        }).catch(() => {});
      }
    }
  } catch (e) {
    console.warn('❌ [NOTIF] Error al notificar:', e.message);
  }
};

const persistirNotificacionPrivada = async ({ roomId, senderId, senderName, message }, privateRooms) => {
  try {
    const ids = idsDeSalaPrivada(roomId);
    if (!ids) return;
    const otroId = ids.find(n => n !== senderId);
    if (otroId == null) return;

    if (privateRooms.has(roomId) && privateRooms.get(roomId).has(String(otroId))) return;

    const { getModels } = require('../models');
    const { sequelize } = getModels();

    const titulo = `${senderName || 'Usuario'} te envió un mensaje`;
    const mensaje = String(message || '').slice(0, 120);
    const ahora = new Date().toISOString();

    const existente = await sequelize.query(
      `SELECT idnotificacion FROM notificacion
       WHERE idusuario = :otroId AND id_relacionado = :senderId
         AND tipo = 'chat_privado' AND estado = 'pendiente'
       LIMIT 1`,
      { replacements: { otroId, senderId }, type: sequelize.QueryTypes.SELECT }
    );

    if (existente && existente.length > 0) {
      await sequelize.query(
        `UPDATE notificacion
         SET titulo = :titulo, mensaje = :mensaje, created_at = :ahora, updated_at = :ahora
         WHERE idnotificacion = :id`,
        { replacements: { titulo, mensaje, ahora, id: existente[0].idnotificacion }, type: sequelize.QueryTypes.UPDATE }
      );
    } else {
      await sequelize.query(
        `INSERT INTO notificacion (idusuario, titulo, mensaje, tipo, estado, id_relacionado, created_at, updated_at)
         VALUES (:otroId, :titulo, :mensaje, 'chat_privado', 'pendiente', :senderId, :ahora, :ahora)`,
        { replacements: { otroId, titulo, mensaje, senderId, ahora }, type: sequelize.QueryTypes.INSERT }
      );
    }

    console.log(`✅ [PRIVADO] Notificación persistida para usuario ${otroId} (sala ${roomId})`);

    // La fila en `notificacion` solo servía para que el mensaje apareciera al
    // abrir el chat: nunca llegaba al dispositivo. Ahora se envía también como
    // push del navegador, que es lo que cubre al usuario con la app cerrada.
    const { enviarPushAUsuario } = require('../services/webPushService');
    await enviarPushAUsuario({
      idusuario: otroId,
      titulo,
      cuerpo: mensaje,
      data: {
        type: 'private',
        roomId: String(roomId),
        idRelacionado: senderId,
        emisor: senderName || null,
      },
    });
  } catch (e) {
    console.warn('❌ [PRIVADO] Error al persistir notificación:', e.message);
  }
};

module.exports = (io) => {
  const eventUsers = new Map();
  const privateRooms = new Map(); // Track private room members
  const connectedUsers = new Map(); // idusuario -> Set<socketId>

  // ---------------------------------------------------------------------
  // Autenticación: sin esto cualquier cliente puede declarar el userId que
  // quiera y unirse a canales o salas privadas ajenas. La identidad sale del
  // JWT y del usuario en BD, nunca del payload del cliente.
  // ---------------------------------------------------------------------
  io.use(async (socket, next) => {
    try {
      const token = tokenDelHandshake(socket);
      if (!token) return next(new Error('No autenticado'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const idusuario = parseInt(decoded?.idusuario, 10);
      if (!Number.isInteger(idusuario)) return next(new Error('Token inválido'));

      const { getModels } = require('../models');
      const { User } = getModels();
      const user = await User.findByPk(idusuario, {
        attributes: ['idusuario', 'nombre', 'apellidopat', 'apellidomat', 'role', 'habilitado'],
      });
      if (!user) return next(new Error('Usuario no encontrado'));

      const habilitado = user.habilitado === true || user.habilitado === 1 ||
        user.habilitado === '1' || user.habilitado === 'true';
      if (!habilitado) return next(new Error('Usuario deshabilitado'));

      socket.data.userId = user.idusuario;
      socket.data.role = user.role;
      socket.data.userName = nombreCompletoDe(user) || String(user.idusuario);
      next();
    } catch (e) {
      if (e && e.name === 'JsonWebTokenError') return next(new Error('Token inválido'));
      if (e && e.name === 'TokenExpiredError') return next(new Error('Token expirado'));
      console.error('❌ [SOCKET] Error de autenticación:', e.message);
      next(new Error('No autenticado'));
    }
  });

  io.on('connection', (socket) => {
    const userIdAuth = socket.data.userId;
    const userNameAuth = socket.data.userName;
    const roleAuth = socket.data.role;

    console.log('🔌 Usuario conectado:', socket.id, userIdAuth);

    // El canal personal se une al autenticar; así las notificaciones no
    // dependen de que el cliente emita register_user a tiempo.
    socket.join('usuario_' + String(userIdAuth));
    // Se envía la identidad de sesión para que el cliente no tenga que deducirla
    // de parámetros de navegación (que no son confiables).
    socket.emit('personal_channel', {
      channel: 'usuario_' + String(userIdAuth),
      userId: userIdAuth,
      role: roleAuth,
      userName: userNameAuth,
    });

    // Pendientes por conversación desde el momento de conectar, para que los
    // contadores de la lista existan sin esperar al primer polling de 20 s.
    pendientesPorConversacion(userIdAuth).then((pendientes) => {
      socket.emit('pending_private', { pendientes });
    }).catch(() => {});

    if (!connectedUsers.has(userIdAuth)) connectedUsers.set(userIdAuth, new Set());
    connectedUsers.get(userIdAuth).add(socket.id);

    // Se mantiene por compatibilidad con clientes viejos, pero el id se toma
    // de la sesión: ignorar lo que mande el cliente.
    socket.on('register_user', () => {
      socket.join('usuario_' + String(userIdAuth));
      console.log(`🎯 [NOTIF] usuario ${userIdAuth} en canal usuario_${userIdAuth}`);
    });

    socket.on('join_private', async ({ roomId } = {}) => {
      if (!esMiembroDeSalaPrivada(roomId, userIdAuth)) {
        console.warn('⚠️ [PRIVADO] Intento de acceso a sala ajena:', { roomId, userId: userIdAuth });
        socket.emit('error', { message: 'No tienes acceso a esta conversación' });
        return;
      }

      const roomIdValido = String(roomId);
      console.log('🔒 [PRIVADO] Unirse a sala:', { roomId: roomIdValido, userId: userIdAuth });

      socket.join(roomIdValido);
      socket.data.roomId = roomIdValido;
      socket.data.isPrivate = true;

      if (!privateRooms.has(roomIdValido)) {
        privateRooms.set(roomIdValido, new Set());
      }
      privateRooms.get(roomIdValido).add(String(userIdAuth));

      // Al abrir la conversación se salda lo pendiente. Se emite antes que el
      // historial para que el cliente pueda limpiar su contador al recibirlo.
      const ids = idsDeSalaPrivada(roomIdValido) || [];
      const otroId = ids.find(n => n !== Number(userIdAuth));
      let marcados = 0;
      if (otroId != null) {
        marcados = await marcarNotificacionesPrivadasLeidas({
          roomId: roomIdValido,
          userId: userIdAuth,
          otroId,
        });
      }
      socket.emit('private_read', { roomId: roomIdValido, marcados });

      try {
        const historial = await cargarHistorial({ idevento: null, room_id: roomIdValido }, 100);
        socket.emit('history', historial);
        console.log(`✅ [PRIVADO] ${userNameAuth} unido a ${roomIdValido}, historial: ${historial.length}`);
      } catch (e) {
        console.error('❌ [PRIVADO] Error cargando historial:', e.message);
        socket.emit('history', []);
      }
    });

    socket.on('send_private', async ({ roomId, message } = {}) => {
      const texto = String(message ?? '').trim().slice(0, MAX_MESSAGE_LENGTH);
      if (!texto) return;

      if (!esMiembroDeSalaPrivada(roomId, userIdAuth)) {
        console.warn('⚠️ [PRIVADO] Intento de envío a sala ajena:', { roomId, userId: userIdAuth });
        socket.emit('error', { message: 'No tienes acceso a esta conversación' });
        return;
      }

      const roomIdValido = String(roomId);
      console.log('📩 [PRIVADO] Enviando mensaje:', { roomId: roomIdValido, userId: userIdAuth, message: texto });

      io.to(roomIdValido).emit('private_message', {
        userId: userIdAuth,
        userName: userNameAuth,
        role: roleAuth,
        message: texto,
        timestamp: new Date().toISOString()
      });

      notificarSala(io, {
        roomId: roomIdValido, userId: userIdAuth, userName: userNameAuth,
        role: roleAuth, message: texto, connectedUsers
      });

      try {
        const { getModels } = require('../models');
        const { ChatMensaje } = getModels();

        await ChatMensaje.create({
          idevento: null,
          idusuario: userIdAuth,
          username: userNameAuth || null,
          role: roleAuth,
          message: texto,
          room_id: roomIdValido,
        });

        console.log(`✅ [PRIVADO] Mensaje emitido y guardado en sala ${roomIdValido}`);
      } catch (e) {
        console.error('❌ [PRIVADO] No se pudo guardar el mensaje:', e.message);
      }

      await persistirNotificacionPrivada({
        roomId: roomIdValido,
        senderId: userIdAuth,
        senderName: userNameAuth,
        message: texto,
      }, privateRooms);
    });

    socket.on('leave_private', ({ roomId } = {}) => {
      if (!esMiembroDeSalaPrivada(roomId, userIdAuth)) return;
      const roomIdValido = String(roomId);

      console.log('🚪 [PRIVADO] Usuario sale:', roomIdValido);
      socket.leave(roomIdValido);

      if (privateRooms.has(roomIdValido)) {
        privateRooms.get(roomIdValido).delete(String(userIdAuth));
        if (privateRooms.get(roomIdValido).size === 0) {
          privateRooms.delete(roomIdValido);
        }
      }
    });

    socket.on('join_event', async ({ eventoId } = {}) => {
      if (!esRoomDeEventoValido(eventoId)) {
        socket.emit('error', { message: 'Chat no válido' });
        return;
      }

      const eventoKey = String(eventoId).trim();
      const room = `evento_${eventoKey}`;
      console.log('👥 [EVENTO] Usuario se une:', { eventoId: eventoKey, userId: userIdAuth, room });

      try {
        if (eventoKey !== 'general' && !(await puedeAccederAEvento(eventoKey, userIdAuth))) {
          console.warn('⚠️ [EVENTO] Usuario sin acceso:', { userId: userIdAuth, eventoId: eventoKey });
          socket.emit('error', { message: 'No tienes acceso a este chat' });
          return;
        }

        // Si el mismo socket estaba en otra sala, sale de ella: si no se
        // queda recibiendo mensajes de un chat que ya no está viendo.
        const salaPrevia = socket.data.eventoId;
        if (salaPrevia != null && String(salaPrevia) !== eventoKey) {
          socket.leave(`evento_${salaPrevia}`);
          socket.data.eventoId = null;
        }

        socket.join(room);
        socket.data.eventoId = eventoKey;
        socket.data.isPrivate = false;

        if (!eventUsers.has(eventoKey)) {
          eventUsers.set(eventoKey, new Map());
        }
        eventUsers.get(eventoKey).set(String(userIdAuth), {
          userId: String(userIdAuth),
          userName: userNameAuth,
          role: roleAuth,
          socketId: socket.id
        });

        const userList = Array.from(eventUsers.get(eventoKey).values());
        io.to(room).emit('user_list', userList);

        const whereHistorial = eventoKey === 'general'
          ? { idevento: null, room_id: 'general' }
          : { idevento: parseInt(eventoKey, 10) };

        const historial = await cargarHistorial(whereHistorial, 50);
        socket.emit('history', historial);

        socket.to(room).emit('user_joined', { userId: userIdAuth, userName: userNameAuth, role: roleAuth });
        console.log(`✅ [EVENTO] ${userNameAuth} (${roleAuth}) → sala ${room}`);

      } catch (e) {
        console.warn('⚠️ [EVENTO] Error en join_event:', e.message);
        socket.emit('history', []);
      }
    });

    socket.on('send_message', async ({ eventoId, message } = {}) => {
      if (!esRoomDeEventoValido(eventoId)) {
        socket.emit('error', { message: 'Chat no válido' });
        return;
      }

      const eventoKey = String(eventoId).trim();
      const room = `evento_${eventoKey}`;
      const texto = String(message ?? '').trim().slice(0, MAX_MESSAGE_LENGTH);
      if (!texto) return;

      console.log('📩 [EVENTO] Mensaje:', { eventoId: eventoKey, userId: userIdAuth, message: texto });

      // Mismo control de acceso que al unirse: sin esto, enviar a una sala
      // en la que nunca se entró esquivaba la validación del comité.
      if (eventoKey !== 'general' && !(await puedeAccederAEvento(eventoKey, userIdAuth))) {
        console.warn('⚠️ [EVENTO] Envío sin acceso:', { userId: userIdAuth, eventoId: eventoKey });
        socket.emit('error', { message: 'No tienes acceso a este chat' });
        return;
      }

      const textoLower = texto.toLowerCase();

      // ==========================================
      // 1. PRIORIDAD: DETECTAR RECORDATORIOS
      // ==========================================
      if (textoLower.includes('recuérdame') || textoLower.includes('avísame')) {
        console.log('⏰ [RECORDATORIO] Detectado:', texto);

        // Aquí puedes emitir un evento al frontend para que abra el modal de recordatorios,
        // o llamar directamente a tu función de crear recordatorio si la tienes a mano.
        io.to(room).emit('receive_message', {
          userId: 0,
          userName: '🤖 Asistente IA',
          role: 'bot',
          message: '⏳ Para programar un recordatorio, por favor usa la sección de "Recordatorios" en la app o escribe: "Vincular mi Telegram [tu_chat_id]" para recibir alertas.',
          esBot: true,
          timestamp: new Date().toISOString()
        });

        notificarSala(io, {
          roomId: eventoKey,
          userId: 0,
          userName: 'Asistente IA',
          role: 'bot',
          message: '⏳ Para programar un recordatorio, por favor usa la sección de "Recordatorios" en la app o escribe: "Vincular mi Telegram [tu_chat_id]" para recibir alertas.',
          timestamp: new Date().toISOString(),
          connectedUsers
        });

        // Opcional: Si tienes la función a mano, la llamas aquí:
        // await crearRecordatorio(userIdAuth, texto, eventoKey);
      }

      // ==========================================
      // 2. DETECCIÓN DE PREGUNTAS PARA LA IA
      // ==========================================
      const esPregunta =
        textoLower.includes('¿') || textoLower.includes('?') ||
        textoLower.startsWith('/pregunta') || textoLower.startsWith('/bot') ||
        textoLower.startsWith('/ia') || textoLower.includes('@bot') ||
        textoLower.includes('hora') || textoLower.includes('cuando') ||
        textoLower.includes('donde') || textoLower.includes('lugar') ||
        textoLower.includes('fecha') || textoLower.includes('certificado') ||
        textoLower.includes('requisitos') || textoLower.includes('costo') ||
        textoLower.includes('recordatorio') || textoLower.includes('inscripc');

      if (esPregunta) {
        console.log('🤖 [BOT] Procesando pregunta para IA...');

        try {
          const pregunta = chatBotService.extraerPregunta(texto);

          io.to(room).emit('bot_typing', { eventoId: eventoKey });

          // ✨ AJUSTE DE ORO: Pasamos el eventoId para que la IA tenga contexto real de la BD
          const respuesta = await chatBotService.generarRespuesta(pregunta, eventoKey);

          console.log('✅ [BOT] Respuesta generada con confianza:', respuesta.confianza);

          io.to(room).emit('receive_message', {
            userId: 0,
            userName: '🤖 Asistente IA',
            role: 'bot',
            message: respuesta.respuesta,
            esBot: true,
            timestamp: new Date().toISOString()
          });

          notificarSala(io, {
            roomId: eventoKey,
            userId: 0,
            userName: 'Asistente IA',
            role: 'bot',
            message: respuesta.respuesta,
            timestamp: new Date().toISOString(),
            connectedUsers
          });

          const { getModels } = require('../models');
          const { ChatMensaje } = getModels();

          ChatMensaje.create({
            idevento: eventoKey === 'general' ? null : parseInt(eventoKey),
            idusuario: null,
            username: 'Asistente IA',
            role: 'bot',
            message: respuesta.respuesta,
            ...(eventoKey === 'general' ? { room_id: 'general' } : {})
          }).catch(err => console.error('❌ [BOT] Error al guardar en BD:', err));

        } catch (error) {
          console.error('❌ [BOT] Error crítico:', error);
        }
      }

      // ==========================================
      // 3. EMITIR PRIMERO Y GUARDAR DESPUÉS
      // ==========================================
      // Emitir antes de persistir garantiza que el mensaje se muestre de
      // inmediato; si la BD falla, el aviso de error ya no se pierde.
      io.to(room).emit('receive_message', {
        userId: userIdAuth,
        userName: userNameAuth,
        role: roleAuth,
        message: texto,
        esBot: false,
        timestamp: new Date().toISOString()
      });

      notificarSala(io, {
        roomId: eventoKey, userId: userIdAuth, userName: userNameAuth,
        role: roleAuth, message: texto, connectedUsers
      });

      try {
        const { getModels } = require('../models');
        const { ChatMensaje } = getModels();

        await ChatMensaje.create({
          idevento: eventoKey === 'general' ? null : parseInt(eventoKey),
          idusuario: userIdAuth,
          username: userNameAuth || null,
          role: roleAuth,
          message: texto,
          ...(eventoKey === 'general' ? { room_id: 'general' } : {})
        });

        console.log(`✅ [EVENTO] Mensaje emitido y guardado en: ${room}`);
      } catch (e) {
        console.error('❌ [EVENTO] No se pudo guardar el mensaje:', e.message);
      }
    });

    socket.on('leave_event', ({ eventoId } = {}) => {
      const eventoKey = String(eventoId ?? '').trim();
      if (!eventoKey) return;
      console.log('🚪 [EVENTO] Usuario sale:', eventoKey);
      socket.leave(`evento_${eventoKey}`);
      if (String(socket.data.eventoId) === eventoKey) {
        socket.data.eventoId = null;
      }
    });

    socket.on('disconnect', () => {
      console.log('❌ Usuario desconectado:', socket.id, userIdAuth);

      const socketsDelUsuario = connectedUsers.get(userIdAuth);
      if (socketsDelUsuario) {
        socketsDelUsuario.delete(socket.id);
        if (socketsDelUsuario.size === 0) connectedUsers.delete(userIdAuth);
      }

      const { eventoId, roomId, isPrivate } = socket.data || {};

      if (isPrivate && roomId) {
        if (privateRooms.has(roomId)) {
          privateRooms.get(roomId).delete(String(userIdAuth));
          if (privateRooms.get(roomId).size === 0) {
            privateRooms.delete(roomId);
          }
        }
      }

      if (eventoId != null && eventUsers.has(eventoId)) {
        const userMap = eventUsers.get(eventoId);
        const user = userMap.get(String(userIdAuth));
        userMap.delete(String(userIdAuth));

        const room = `evento_${eventoId}`;

        if (userMap.size === 0) {
          eventUsers.delete(eventoId);
        } else {
          const userList = Array.from(userMap.values());
          io.to(room).emit('user_list', userList);
        }

        socket.to(room).emit('user_left', {
          userId: userIdAuth,
          userName: user?.userName || userNameAuth,
          role: user?.role || roleAuth
        });

        console.log(`👋 ${userNameAuth} salió de ${room}`);
      }
    });
  });

  console.log('✅ [SOCKET] Chat socket inicializado correctamente');
};
