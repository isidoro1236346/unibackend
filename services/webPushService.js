const webpush = require('web-push');

const { getModels } = require('../models');

// ── PUSH WEB (Web Push / VAPID) ────────────────────────────────────────────
// El chat ya guardaba el mensaje en `notificacion` cuando el destinatario no
// tenía socket, pero eso nunca llegaba al dispositivo: era solo una fila en BD.
// Este servicio convierte esa fila en una notificación real del navegador.
//
// Los sockets siguen siendo el canal preferente. El push es el respaldo para
// cuando el usuario cerró la pestaña o la app, que es el caso que reportaba.

let clavesConfiguradas = false;

const hayClaves = () =>
  Boolean(process.env.WEB_PUSH_PUBLIC_KEY && process.env.WEB_PUSH_PRIVATE_KEY);

const configurarVapid = () => {
  if (clavesConfiguradas) return true;
  if (!hayClaves()) {
    console.warn('⚠️ [PUSH] WEB_PUSH_PUBLIC_KEY / WEB_PUSH_PRIVATE_KEY no definidos: push desactivado');
    return false;
  }
  try {
    webpush.setVapidDetails(
      process.env.WEB_PUSH_SUBJECT || 'mailto:admin@uft.edu.bo',
      process.env.WEB_PUSH_PUBLIC_KEY,
      process.env.WEB_PUSH_PRIVATE_KEY
    );
    clavesConfiguradas = true;
    console.log('✅ [PUSH] Web Push configurado (VAPID)');
    return true;
  } catch (e) {
    console.error('❗ [PUSH] Claves VAPID inválidas:', e.message);
    return false;
  }
};

const publicKey = () => process.env.WEB_PUSH_PUBLIC_KEY || null;

/**
 * Guarda o actualiza la suscripción de un navegador.
 * Si el endpoint ya existe, se reasigna al usuario que lo reclama ahora: es el
 * caso normal cuando el mismo navegador abre sesión con otra cuenta.
 */
const registrarSuscripcion = async ({ idusuario, subscription, userAgent }) => {
  const { DispositivoPush } = getModels();

  const endpoint = subscription?.endpoint;
  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;

  if (!endpoint || !p256dh || !auth) {
    const err = new Error('Suscripción incompleta: faltan endpoint o claves');
    err.status = 400;
    throw err;
  }

  const [, creado] = await DispositivoPush.findOrCreate({
    where: { endpoint },
    defaults: {
      idusuario,
      endpoint,
      p256dh,
      auth,
      user_agent: userAgent || null,
      expiracion: subscription.expirationTime
        ? new Date(subscription.expirationTime)
        : null,
    },
  });

  // findOrCreate no actualiza los campos si la fila ya existía, así que se
  // sincroniza aparte para reflejar el cambio de cuenta o la renovación de claves.
  await DispositivoPush.update(
    {
      idusuario,
      p256dh,
      auth,
      user_agent: userAgent || null,
      expiracion: subscription.expirationTime
        ? new Date(subscription.expirationTime)
        : null,
      fallidos_consecutivos: 0,
    },
    { where: { endpoint } }
  );

  return { id: creado.iddispositivo, endpoint };
};

const eliminarSuscripcion = async ({ idusuario, endpoint }) => {
  const { DispositivoPush } = getModels();
  const [cantidad] = await DispositivoPush.destroy({
    where: { endpoint, idusuario },
  });
  return cantidad;
};

const eliminarPorUsuario = async (idusuario) => {
  const { DispositivoPush } = getModels();
  return DispositivoPush.destroy({ where: { idusuario } });
};

/**
 * Envía un push a todos los navegadores suscritos de un usuario.
 * Nunca lanza: un fallo de push no debe tumbar el envío del mensaje de chat.
 */
const enviarPushAUsuario = async ({ idusuario, titulo, cuerpo, data = {} }) => {
  if (!configurarVapid()) return { enviados: 0, fallos: 0 };

  const { DispositivoPush } = getModels();

  let suscripciones;
  try {
    suscripciones = await DispositivoPush.findAll({ where: { idusuario } });
  } catch (e) {
    console.warn('❗ [PUSH] No se pudieron leer las suscripciones:', e.message);
    return { enviados: 0, fallos: 0 };
  }

  if (!suscripciones.length) return { enviados: 0, fallos: 0 };

  const payload = JSON.stringify({
    title: titulo,
    body: cuerpo,
    data,
  });

  let enviados = 0;
  let fallos = 0;

  await Promise.all(
    suscripciones.map(async (sub) => {
      const suscripcion = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };
      try {
        await webpush.sendNotification(suscripcion, payload, {
          TTL: 60 * 60 * 24,
          urgency: 'high',
        });
        enviados += 1;
        await DispositivoPush.update(
          { ultimo_envio: new Date(), fallidos_consecutivos: 0 },
          { where: { iddispositivo: sub.iddispositivo } }
        );
      } catch (e) {
        fallos += 1;
        console.warn(`⚠️ [PUSH] Fallo al enviar a ${sub.idusuario}:`, e.message);

        // 404/410 significan que la suscripción murió: hay que borrarla o el
        // backend seguirá intentando enviarle para siempre.
        if (e.statusCode === 404 || e.statusCode === 410) {
          await DispositivoPush.destroy({
            where: { iddispositivo: sub.iddispositivo },
          });
          console.log(`🧹 [PUSH] Suscripción eliminada (${e.statusCode})`);
        } else {
          const fallosPrevios = (sub.fallidos_consecutivos || 0) + 1;
          await DispositivoPush.update(
            { fallidos_consecutivos: fallosPrevios },
            { where: { iddispositivo: sub.iddispositivo } }
          );
        }
      }
    })
  );

  console.log(`📲 [PUSH] usuario ${idusuario}: ${enviados} enviado(s), ${fallos} fallo(s)`);
  return { enviados, fallos };
};

module.exports = {
  configurarVapid,
  publicKey,
  registrarSuscripcion,
  eliminarSuscripcion,
  eliminarPorUsuario,
  enviarPushAUsuario,
};
