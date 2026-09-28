const express = require('express');
const router = express.Router();
const {
  getUserNotifications,
  markAsRead,
  markAllAsRead,
  getUnreadCount,
  diagnosticarNotificaciones,
} = require('../controllers/notificationController');
const {
  getPublicKey,
  subscribe,
  unsubscribe,
  unsubscribeAll,
} = require('../controllers/webPushController');
const {enviarNotificacionCompletaTelegram} = require('../controllers/botController');

const { protect } = require('../middleware/authMiddleware');

// Ruta de diagnóstico (SIN autenticación para probar)
router.get('/diagnostico', diagnosticarNotificaciones);

// Rutas protegidas
router.get('/', protect, getUserNotifications);

// Push del navegador. La clave pública no lleva datos sensibles y se necesita
// antes de tener sesión para poder pintar el botón de campana.
router.get('/push/public-key', getPublicKey);
router.post('/push/subscription', protect, subscribe);
router.delete('/push/subscription', protect, unsubscribe);
router.delete('/push/subscriptions', protect, unsubscribeAll);
router.patch('/:id/read', protect, markAsRead);
router.patch('/mark-all-read', protect, markAllAsRead);
router.get('/unread-count', protect, getUnreadCount);
router.post('/enviar-resumen-telegram', protect, enviarNotificacionCompletaTelegram);


module.exports = router;