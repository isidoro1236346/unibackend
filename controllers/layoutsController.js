const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getModels } = require('../models/index.js');
const asyncHandler = require('express-async-handler');
const fs = require('fs');
const path = require('path');

const crearLayout = asyncHandler(async (req, res) => {
  try {
    const { nombre } = req.body;
    const imagen = req.file;

    if (!nombre?.trim()) {
      return res.status(400).json({ 
        success: false, 
        message: 'El nombre del layout es requerido' 
      });
    }

    if (!imagen) {
      return res.status(400).json({ 
        success: false, 
        message: 'La imagen del layout es requerida' 
      });
    }

    const models = getModels();
    const { Layout } = models;

    const nuevoLayout = await Layout.create({
      nombre: nombre.trim(),
      url_imagen: `layouts/${imagen.filename}` // guarda: "layouts/imagen-123.jpg"
    });

    res.status(201).json({ 
      success: true, 
      message: 'Layout creado exitosamente',
      layout: {
        id: nuevoLayout.idlayout,
        nombre: nuevoLayout.nombre,
        url_imagen: nuevoLayout.url_imagen,
        imagenUrl: `${req.protocol}://${req.get('host')}/uploads/${nuevoLayout.url_imagen}`
      }
    });

  } catch (error) {
    console.error('Error al crear layout:', error);
    
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        success: false, 
        message: 'El archivo es demasiado grande (máximo 10MB)' 
      });
    }

    if (error.message?.includes('Solo se permiten imágenes')) {
      return res.status(400).json({ 
        success: false, 
        message: 'Solo se permiten archivos de imagen (jpg, png, gif, webp)' 
      });
    }

    res.status(500).json({ 
      success: false, 
      message: 'Error interno del servidor al crear el layout' 
    });
  }
});

const obtenerLayouts = asyncHandler(async (req, res) => {
  const models = getModels();
  const { Layout } = models;

  const layouts = await Layout.findAll({
    attributes: ['idlayout', 'nombre', 'url_imagen'],
    order: [['created_at', 'DESC']]
  });

  const layoutsConUrlCompleta = layouts.map(layout => {
    // url_imagen ya es "layouts/imagen-123.jpg", no necesita limpieza
    const imagenUrl = `${req.protocol}://${req.get('host')}/uploads/${layout.url_imagen}`;

    return {
      idlayout: layout.idlayout,
      nombre: layout.nombre,
      url_imagen: layout.url_imagen,
      imagenUrl: imagenUrl
    };
  });

  res.json(layoutsConUrlCompleta);
});

const generarLayoutIA = asyncHandler(async (req, res) => {
  try {
    const { prompt, recursos } = req.body;

    if (!prompt?.trim()) {
      return res.status(400).json({ 
        success: false, 
        message: 'El prompt es requerido' 
      });
    }

    const recursosNorm = Array.isArray(recursos) ? recursos.filter(r => r).map(r => ({
      nombre_recurso: String(r.nombre_recurso || r.nombre || '').trim(),
      recurso_tipo: String(r.recurso_tipo || '').trim(),
      cantidad: parseInt(r.cantidad) > 0 ? parseInt(r.cantidad) : 1,
    })) : [];

    const svgCode = generarSVGLayout(prompt.trim(), recursosNorm);

    if (!svgCode || !svgCode.startsWith('<svg')) {
      return res.status(500).json({ 
        success: false, 
        message: 'No se pudo generar el layout SVG' 
      });
    }

    const layoutsDir = path.join(__dirname, '..', 'uploads', 'layouts');
    if (!fs.existsSync(layoutsDir)) fs.mkdirSync(layoutsDir, { recursive: true });

    const filename = `layout.svg`;
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    const filePath = path.join(layoutsDir, `${uniqueSuffix}-${filename}`);
    
    // Escribir archivo y capturar errores
    try {
      const svgContent = `<?xml version="1.0" encoding="UTF-8"?>${svgCode}`;
      fs.writeFileSync(filePath, svgContent);
      console.log('✅ Archivo guardado en:', filePath);
    } catch (writeError) {
      console.error('❌ Error escribiendo archivo:', writeError);
      return res.status(500).json({ 
        success: false, 
        message: 'Error guardando archivo físico: ' + writeError.message 
      });
    }

    const models = getModels();
    const { Layout } = models;

    const dbFileName = `${uniqueSuffix}-${filename}`;
    const urlImagen = `/uploads/layouts/${dbFileName}`;
    const nuevoLayout = await Layout.create({
      nombre: `Layout IA - ${prompt.substring(0, 30).trim()}`,
      url_imagen: `layouts/${dbFileName}`
    });

    res.status(201).json({ 
      success: true, 
      message: 'Layout generado exitosamente',
      layout: {
        id: nuevoLayout.idlayout,
        nombre: nuevoLayout.nombre,
        url_imagen: nuevoLayout.url_imagen,
        imagenUrl: `${req.protocol}://${req.get('host')}${urlImagen}`
      }
    });

  } catch (error) {
    console.error('❌ Error al generar layout:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error interno al generar layout: ' + error.message 
    });
  }
});

function generarSVGLayout(prompt, recursos = []) {
    const lower = prompt.toLowerCase();
    const personCount = lower.includes('50') ? 50 : 
                       lower.includes('40') ? 40 : 
                       lower.includes('30') ? 30 : 
                       parseInt(prompt.match(/(\d+)/)?.[1] || 30);

    let svg;
    if (/aula|clase|salon|salón|escuela|colegio|conferencia|auditorio|catedra|cátedra/.test(lower)) {
        svg = generarLayoutAula(personCount);
    }
    else if (/patio|exterior|aire libre|jardin|jardín|terraza|courtyard|plaza/.test(lower)) {
        svg = generarLayoutPatio(personCount);
    }
    else {
        svg = generarLayoutCircular(personCount);
    }

    if (Array.isArray(recursos) && recursos.length > 0) {
        svg = dibujarRecursosEnSVG(svg, recursos);
    }

    return svg;
}

function escapeXml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

// Clasifica un recurso del inventario en una categoría de dibujo.
// 1º intenta reconocerlo por su nombre (más preciso: permite elegir el
//    ícono exacto - pantalla, parlante, mesa, silla, vajilla).
// 2º si el nombre no calza con ningún patrón conocido, usa el
//    `recurso_tipo` que ya viene del inventario (tecnologico / mobiliario /
//    vajilla) para al menos dibujar un ícono genérico de esa categoría,
//    en vez de que el recurso desaparezca del plano y solo quede en texto.
function clasificarRecurso(r) {
    const nombre = (r.nombre_recurso || '').toLowerCase();
    const tipo = (r.recurso_tipo || '').toLowerCase();

    if (/pantalla|proyector|proyec|televisor|tv|plasma|lcd|led/.test(nombre)) return 'pantalla';
    if (/sonido|parlante|bafle|altavoz|amplif|ac[uú]stic|tweeter|subwoofer|micr[oó]fono/.test(nombre)) return 'sonido';
    if (/mesa|tabla|banquete|comedor/.test(nombre) && !/mantel/.test(nombre)) return 'mesa';
    if (/silla|butaca|asiento|pupitre|banco/.test(nombre)) return 'silla';
    if (/vajilla|plato|vaso|copa|taza|cubierto|servilleta|mantel/.test(nombre)) return 'vajilla';

    if (tipo === 'tecnologico') return 'tecnologico';
    if (tipo === 'mobiliario') return 'mobiliario';
    if (tipo === 'vajilla') return 'vajilla';

    return 'otro';
}

function dibujarRecursosEnSVG(svg, recursos) {
    const buckets = { pantalla: [], sonido: [], mesa: [], silla: [], vajilla: [], tecnologico: [], mobiliario: [], otro: [] };
    recursos.forEach(r => buckets[clasificarRecurso(r)].push(r));

    const pantallas = buckets.pantalla;
    const sonido = buckets.sonido;
    const mesas = buckets.mesa;
    const sillas = buckets.silla;
    const vajilla = buckets.vajilla;
    const tecnologicoGenerico = buckets.tecnologico;
    const mobiliarioGenerico = buckets.mobiliario;
    const otro = buckets.otro;

    let extra = '';

    // ── Pantallas / proyectores (frente del salón) ───────────────────────
    if (pantallas.length > 0) {
        extra += '<g id="rec-pantalla">';
        extra += '<rect x="196" y="52" width="108" height="62" rx="3" fill="#1e293b"/>';
        extra += '<rect x="200" y="56" width="100" height="56" rx="2" fill="#60a5fa"/>';
        extra += '<circle cx="250" cy="84" r="15" fill="none" stroke="#bfdbfe" stroke-width="2"/>';
        extra += '<text x="250" y="120" text-anchor="middle" font-family="sans-serif" font-size="9" fill="#475569">Pantalla</text>';
        extra += '</g>';
    }

    // ── Sonido / parlantes (esquinas traseras) ───────────────────────────
    const nSonido = Math.min(Math.max(sonido.reduce((acc, r) => acc + (parseInt(r.cantidad) || 1), 0), 0), 4);
    if (nSonido > 0) {
        extra += '<g id="rec-sonido">';
        for (let i = 0; i < nSonido; i++) {
            const y = i < 2 ? 250 : 320;
            extra += `<rect x="${i % 2 === 0 ? 30 : 456}" y="${y}" width="14" height="46" rx="3" fill="#312e81"/>`;
            extra += `<circle cx="${i % 2 === 0 ? 37 : 463}" cy="${y + 16}" r="6" fill="#6366f1"/>`;
            extra += `<circle cx="${i % 2 === 0 ? 37 : 463}" cy="${y + 34}" r="4" fill="#818cf8"/>`;
        }
        extra += '</g>';
    }

    // ── Mesas (distribuidas en la zona central/despejada) ─────────────────
    let mesasDraw = '';
    let mesaIdx = 0;
    for (const m of mesas) {
        const n = Math.min(parseInt(m.cantidad) || 1, 12);
        for (let i = 0; i < n; i++) {
            if (mesaIdx >= 12) break;
            const col = mesaIdx % 4;
            const row = Math.floor(mesaIdx / 4);
            const x = 130 + col * 80;
            const y = 170 + row * 70;
            mesasDraw += `<circle cx="${x}" cy="${y}" r="26" fill="#ffffff" stroke="#94a3b8" stroke-width="2"/>`;
            mesasDraw += `<circle cx="${x}" cy="${y}" r="14" fill="#e2e8f0" stroke="#cbd5e1"/>`;
            mesasDraw += `<text x="${x}" y="${y + 3}" text-anchor="middle" font-family="sans-serif" font-size="8" fill="#64748b">M${mesaIdx + 1}</text>`;
            mesaIdx++;
        }
    }
    if (mesasDraw) {
        extra += `<g id="rec-mesas">${mesasDraw}</g>`;
    }

    // ── Sillas / butacas (acompañan a las mesas) ─────────────────────────
    const nSillas = Math.min(sillas.reduce((acc, r) => acc + (parseInt(r.cantidad) || 1), 0), 40);
    if (nSillas > 0) {
        let sillasDraw = '';
        for (let i = 0; i < nSillas; i++) {
            const col = i % 10;
            const row = Math.floor(i / 10);
            const x = 196 + col * 13;
            const y = 300 + row * 12;
            sillasDraw += `<rect x="${x}" y="${y}" width="9" height="8" rx="1.5" fill="#c2410c" opacity="0.85"/>`;
        }
        extra += `<g id="rec-sillas">${sillasDraw}</g>`;
    }

    // ── Vajilla (decoración sobre mesas) ──────────────────────────────────
    if (vajilla.length > 0 && mesaIdx > 0) {
        const nVajillas = vajilla.reduce((acc, r) => acc + (parseInt(r.cantidad) || 1), 0);
        let vajillaDraw = '';
        for (let i = 0; i < Math.min(nVajillas, 24); i++) {
            const mesaX = 130 + (i % 4) * 80;
            const mesaY = 170 + Math.floor(i / 4) * 70;
            const offsetX = (i % 3 - 1) * 6;
            const offsetY = (Math.floor(i / 3) % 3 - 1) * 6;
            vajillaDraw += `<circle cx="${mesaX + offsetX}" cy="${mesaY + offsetY}" r="3" fill="#f59e0b" stroke="#b45309"/>`;
        }
        extra += `<g id="rec-vajilla">${vajillaDraw}</g>`;
    }

    // ── Tecnológico sin ícono específico (ej: router, extensión, cables):
    //    franja de íconos genéricos arriba a la derecha, para que no
    //    desaparezcan del plano solo porque el nombre no calzó con ningún
    //    patrón conocido. ───────────────────────────────────────────────
    if (tecnologicoGenerico.length > 0) {
        let draw = '';
        tecnologicoGenerico.slice(0, 6).forEach((r, i) => {
            const x = 372 + (i % 3) * 24;
            const y = 40 + Math.floor(i / 3) * 20;
            draw += `<rect x="${x}" y="${y}" width="16" height="12" rx="2" fill="#0891b2"/>`;
            draw += `<circle cx="${x + 8}" cy="${y + 6}" r="3" fill="#a5f3fc"/>`;
        });
        extra += `<g id="rec-tecnologico">${draw}</g>`;
    }

    // ── Mobiliario sin ícono específico (ej: biombos, atriles, tarimas):
    //    franja de íconos genéricos abajo a la izquierda. ────────────────
    if (mobiliarioGenerico.length > 0) {
        let draw = '';
        mobiliarioGenerico.slice(0, 6).forEach((r, i) => {
            const x = 14 + (i % 3) * 24;
            const y = 356 + Math.floor(i / 3) * 18;
            draw += `<rect x="${x}" y="${y}" width="16" height="12" rx="2" fill="#78350f"/>`;
            draw += `<rect x="${x + 2}" y="${y + 2}" width="12" height="8" rx="1" fill="#d97706"/>`;
        });
        extra += `<g id="rec-mobiliario">${draw}</g>`;
    }

    // ── Leyenda de recursos en la parte inferior (incluye TODOS los
    //    recursos seleccionados, tengan o no ícono propio en el plano) ───
    const todos = [...pantallas, ...sonido, ...mesas, ...sillas, ...vajilla, ...tecnologicoGenerico, ...mobiliarioGenerico, ...otro];
    let leyenda = '';
    if (todos.length > 0) {
        let lx = 14;
        leyenda += '<g id="rec-leyenda">';
        todos.forEach(r => {
            const label = `${r.nombre_recurso} ×${r.cantidad}`;
            leyenda += `<text x="${lx}" y="392" font-family="sans-serif" font-size="8" fill="#64748b">${escapeXml(label)}</text>`;
            lx += label.length * 5 + 6;
        });
        leyenda += '</g>';
    }

    return svg.replace('</svg>', `${extra}${leyenda}</svg>`);
}

function generarLayoutCircular(personCount) {
    const centerX = 250, centerY = 200;
    const radius = 180;
    const chairWidth = 8, chairDepth = 10;
    const tableDiameter = 60;

    let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="400">';
    svg += '<rect width="500" height="400" fill="#fafafa"/>';
    svg += '<text x="14" y="20" font-family="sans-serif" font-size="11" fill="#9ca3af">CIRCULAR · ' + personCount + ' personas</text>';
    svg += '<g stroke="#e5e7eb" stroke-width="2">';
    svg += '<line x1="250" y1="50" x2="250" y2="350" />';
    svg += '<line x1="50" y1="200" x2="450" y2="200" />';
    svg += '</g>';

    const angularStep = (2 * Math.PI) / personCount;
    const innerRadius = radius - 40;

    for (let i = 0; i < personCount; i++) {
        const angle = i * angularStep - Math.PI / 2;
        const tableX = centerX + (innerRadius / 2) * Math.cos(angle);
        const tableY = centerY + (innerRadius / 2) * Math.sin(angle);
        svg += `<circle cx="${tableX}" cy="${tableY}" r="${tableDiameter/2}" fill="#1f2937"/>`;

        const chairAngle = angle + Math.PI / personCount;
        const cX = centerX + (radius - 15) * Math.cos(chairAngle);
        const cY = centerY + (radius - 15) * Math.sin(chairAngle);
        svg += `<rect x="${cX - chairWidth/2}" y="${cY - chairDepth/2}" width="${chairWidth}" height="${chairDepth}" fill="#6b7280"/>`;
    }

    svg += '</svg>';
    return svg;
}

function generarLayoutAula(personCount) {
    const chairsPerRow = 10;
    const rows = Math.ceil(personCount / chairsPerRow);

    let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="400">';
    svg += '<rect width="500" height="400" fill="#fafafa"/>';
    svg += '<text x="14" y="20" font-family="sans-serif" font-size="11" fill="#9ca3af">AULA · ' + personCount + ' personas</text>';

    svg += '<rect x="150" y="28" width="200" height="10" rx="2" fill="#374151"/>';
    svg += '<rect x="233" y="42" width="34" height="14" rx="2" fill="#1f2937"/>';

    const deskW = 28, deskH = 16, chairW = 16, chairH = 10;
    const pitchX = 40, pitchY = 42;
    const startXLeft = 45, startXRight = 265, startY = 76;
    const colsHalf = chairsPerRow / 2;

    for (let i = 0; i < personCount; i++) {
        const row = Math.floor(i / chairsPerRow);
        const posInRow = i % chairsPerRow;
        const side = posInRow < colsHalf ? 0 : 1;
        const colInSide = posInRow % colsHalf;
        const x = (side === 0 ? startXLeft : startXRight) + colInSide * pitchX;
        const y = startY + row * pitchY;
        svg += `<rect x="${x}" y="${y}" width="${deskW}" height="${deskH}" rx="2" fill="#1f2937"/>`;
        svg += `<rect x="${x + (deskW - chairW) / 2}" y="${y + deskH + 3}" width="${chairW}" height="${chairH}" rx="2" fill="#6b7280"/>`;
    }

    svg += '<line x1="250" y1="76" x2="250" y2="330" stroke="#e5e7eb" stroke-width="2"/>';
    svg += '<rect x="238" y="340" width="24" height="40" fill="#ffffff" stroke="#9ca3af"/>';
    svg += '<line x1="238" y1="340" x2="238" y2="380" stroke="#9ca3af"/>';
    svg += '</svg>';
    return svg;
}

function generarLayoutPatio(personCount) {
    const p = Math.min(Math.max(personCount, 8), 120);

    let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="400">';
    svg += '<rect width="500" height="400" fill="#e8f0df"/>';

    // Caminos de piedra
    svg += '<rect x="246" y="56" width="8" height="288" fill="#e7dcc0"/>';
    svg += '<rect x="46" y="196" width="408" height="8" fill="#e7dcc0"/>';

    // Muros perimetrales
    svg += '<rect x="46" y="44" width="408" height="12" rx="2" fill="#a16207"/>';
    svg += '<rect x="46" y="344" width="408" height="12" rx="2" fill="#a16207"/>';
    svg += '<rect x="44" y="56" width="12" height="288" rx="2" fill="#a16207"/>';
    svg += '<rect x="444" y="56" width="12" height="288" rx="2" fill="#a16207"/>';

    // Bancas laterales
    svg += '<rect x="62" y="118" width="10" height="72" rx="3" fill="#b45309"/>';
    svg += '<rect x="64" y="120" width="6" height="8" fill="#92400e"/>';
    svg += '<rect x="428" y="118" width="10" height="72" rx="3" fill="#b45309"/>';
    svg += '<rect x="430" y="120" width="6" height="8" fill="#92400e"/>';

    // Macetas en las esquinas
    const esquinas = [[70, 68], [418, 68], [70, 322], [418, 322]];
    esquinas.forEach(([x, y]) => {
        svg += `<circle cx="${x}" cy="${y}" r="10" fill="#4d7c0f"/>`;
        svg += `<circle cx="${x - 6}" cy="${y + 3}" r="7" fill="#65a30d"/>`;
        svg += `<circle cx="${x + 5}" cy="${y + 4}" r="8" fill="#4d7c0f"/>`;
        svg += `<rect x="${x - 7}" y="${y + 8}" width="14" height="12" rx="2" fill="#c2410c"/>`;
    });

    // Fuente central
    svg += '<circle cx="250" cy="200" r="34" fill="#bae6fd" stroke="#7dd3fc" stroke-width="2"/>';
    svg += '<circle cx="250" cy="200" r="14" fill="#38bdf8" stroke="#0ea5e9" stroke-width="2"/>';
    svg += '<circle cx="250" cy="188" r="5" fill="#7dd3fc"/>';

    // Mesas redondas con sillas a su alrededor
    const mesas = [[135, 105], [250, 84], [365, 105], [88, 220], [412, 220], [135, 300], [250, 308], [365, 300]];
    const sillasMesas = new Array(mesas.length).fill(0);
    for (let i = 0; i < p; i++) sillasMesas[i % mesas.length]++;

    mesas.forEach(([tx, ty], idx) => {
        const sillas = sillasMesas[idx];
        svg += `<circle cx="${tx}" cy="${ty}" r="20" fill="#ffffff" stroke="#94a3b8" stroke-width="2"/>`;
        svg += `<circle cx="${tx}" cy="${ty}" r="10" fill="#e2e8f0"/>`;
        const step = (2 * Math.PI) / sillas;
        for (let j = 0; j < sillas; j++) {
            const a = step * j - Math.PI / 2;
            const cx = (tx + 27 * Math.cos(a)).toFixed(1);
            const cy = (ty + 27 * Math.sin(a)).toFixed(1);
            svg += `<rect x="${cx - 5}" y="${cy - 4}" width="10" height="8" rx="1.5" fill="#6b7280"/>`;
        }
        // Parasol en mesas alternas
        if (idx % 3 === 0) {
            svg += `<circle cx="${tx}" cy="${ty}" r="13" fill="#fb923c" opacity="0.85"/>`;
            svg += `<circle cx="${tx}" cy="${ty}" r="4" fill="#fff7ed"/>`;
        }
    });

    svg += '<text x="14" y="20" font-family="sans-serif" font-size="11" fill="#4b5563">PATIO · ' + p + ' personas</text>';
    svg += '</svg>';
    return svg;
}

const eliminarLayout = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const models = getModels();
    const { Layout } = models;

    const layout = await Layout.findByPk(id);

    if (!layout) {
      return res.status(404).json({ success: false, message: 'Layout no encontrado' });
    }

    const filePath = path.join(__dirname, '..', 'uploads', layout.url_imagen);
    fs.unlink(filePath, (err) => {
      if (err) console.warn('⚠️ No se pudo borrar el archivo físico:', err.message);
    });

    await layout.destroy();

    res.json({ success: true, message: 'Layout eliminado correctamente' });
  } catch (error) {
    console.error('❌ Error al eliminar layout:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor al eliminar el layout' });
  }
});
module.exports = {
  crearLayout,
  obtenerLayouts,
  eliminarLayout,
  generarLayoutIA,
  generarSVGLayout
};