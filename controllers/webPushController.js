const {
  registrarSuscripcion,
  eliminarSuscripcion,
  eliminarPorUsuario,
  publicKey,
} = require('../services/webPushService');

const asyncHandler = require('express-async-handler');

/** GET /notificaciones/push/public-key */
const getPublicKey = asyncHandler(async (req, res) => {
  res.json({ publicKey: publicKey() });
});

/** POST /notificaciones/push/subscription */
const subscribe = asyncHandler(async (req, res) => {
  const idusuario = req.user.idusuario;
  const { subscription } = req.body || {};

  if (!subscription) {
    return res.status(400).json({ error: 'Falta la suscripción' });
  }

  const resultado = await registrarSuscripcion({
    idusuario,
    subscription,
    userAgent: req.get('user-agent'),
  });

  res.json({ message: 'Suscripción registrada', id: resultado.id });
});

/** DELETE /notificaciones/push/subscription */
const unsubscribe = asyncHandler(async (req, res) => {
  const idusuario = req.user.idusuario;
  const endpoint = (req.body && req.body.endpoint) || req.query.endpoint;

  if (!endpoint) {
    return res.status(400).json({ error: 'Falta el endpoint' });
  }

  const eliminadas = await eliminarSuscripcion({ idusuario, endpoint });
  res.json({ message: 'Suscripción eliminada', eliminadas });
});

/** DELETE /notificaciones/push/subscriptions (todas las del usuario) */
const unsubscribeAll = asyncHandler(async (req, res) => {
  const eliminadas = await eliminarPorUsuario(req.user.idusuario);
  res.json({ message: 'Suscripciones eliminadas', eliminadas });
});

module.exports = {
  getPublicKey,
  subscribe,
  unsubscribe,
  unsubscribeAll,
};
