const express = require('express');
const { getModels } = require('../models/index.js');
const { createRecurso,
    getRecursos,
    getRecursoImagen,
    updateRecurso,
    deleteRecurso } = require ('../controllers/recursoController.js');
const { protect, authorize } =require('../middleware/authMiddleware.js'); 

const router = express.Router();

// Todo el módulo de recursos requiere sesión; las escrituras solo admin/daf.
router.get('/', protect, getRecursos);
router.get('/:id/imagen', protect, getRecursoImagen);
router.post('/', protect, authorize(['admin', 'daf']), createRecurso);
router.put('/:id', protect, authorize(['admin', 'daf']), updateRecurso);
router.delete('/:id', protect, authorize(['admin', 'daf']), deleteRecurso);

module.exports = router;