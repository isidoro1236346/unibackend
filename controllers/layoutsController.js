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
    if (/auditorio|escenario|escena|teatro|teatral|conferencista/.test(lower)) {
        svg = generarLayoutAuditorio(personCount);
    }
    else if (/feria|stand|stands|expo|expositor|exposici[oó]n/.test(lower)) {
        svg = generarLayoutFeria(personCount);
    }
    else if (/comedor|banquete|rectangulares|cena|alimentos|food/.test(lower)) {
        svg = generarLayoutComedor(personCount);
    }
    else if (/patio|exterior|aire libre|jardin|jardín|terraza|courtyard|plaza/.test(lower)) {
        svg = generarLayoutPatio(personCount);
    }
    else if (/aula|clase|sal[oó]n|escuela|colegio|conferencia|c[aá]tedra|seminario/.test(lower)) {
        svg = generarLayoutAula(personCount);
    }
    else if (/circular|redonda|ronda|mesa redonda/.test(lower)) {
        svg = generarLayoutCircular(personCount);
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

    if (/proyector|proyec/.test(nombre)) return 'proyector';
    if (/pantalla|televisor|tv|plasma|lcd|led/.test(nombre)) return 'pantalla';
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
    const buckets = { pantalla: [], proyector: [], sonido: [], mesa: [], silla: [], vajilla: [], tecnologico: [], mobiliario: [], otro: [] };
    recursos.forEach(r => buckets[clasificarRecurso(r)].push(r));

    const pantallas = buckets.pantalla;
    const proyector = buckets.proyector;
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

    // ── Proyector (colgado arriba a la izquierda, con haz al frente) ──────
    if (proyector.length > 0) {
        extra += '<g id="rec-proyector">';
        const nProy = Math.min(Math.max(proyector.reduce((acc, r) => acc + (parseInt(r.cantidad) || 1), 0), 0), 3);
        for (let i = 0; i < nProy; i++) {
            const px = 56 + i * 34;
            extra += `<rect x="${px}" y="28" width="26" height="13" rx="2" fill="#0f172a"/>`;
            extra += `<circle cx="${px + 24}" cy="34" r="4" fill="#f59e0b"/>`;
            extra += `<polygon points="${px + 8},41 ${px + 24},41 ${px + 70},116 ${px - 30},116" fill="#fef3c7" opacity="0.4"/>`;
            extra += `<text x="${px + 2}" y="126" font-family="sans-serif" font-size="8" fill="#475569">Proyector</text>`;
        }
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

    // ── Otros recursos sin ícono específico (ej: adornos, toldos, marcos):
    //    cajitas pequeñas abajo a la derecha, para que todo recurso
    //    agregado también sea visible en el plano y no solo en la leyenda. ─
    if (otro.length > 0) {
        let draw = '';
        otro.slice(0, 8).forEach((r, i) => {
            const x = 430 - (i % 4) * 26;
            const y = 350 + Math.floor(i / 4) * 18;
            draw += `<rect x="${x}" y="${y}" width="16" height="12" rx="2" fill="#6d28d9"/>`;
            draw += `<circle cx="${x + 8}" cy="${y + 6}" r="3" fill="#ddd6fe"/>`;
        });
        extra += `<g id="rec-otro">${draw}</g>`;
    }

    // ── Leyenda de recursos en la parte inferior (incluye TODOS los
    //    recursos seleccionados, tengan o no ícono propio en el plano) ───
    const todos = [...pantallas, ...proyector, ...sonido, ...mesas, ...sillas, ...vajilla, ...tecnologicoGenerico, ...mobiliarioGenerico, ...otro];
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
    const p = Math.min(Math.max(personCount, 8), 120);

    let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="400">';
    svg += '<rect width="500" height="400" fill="#f9f7f2"/>';

    // Muros perimetrales
    svg += '<rect x="46" y="44" width="408" height="12" rx="2" fill="#a16207"/>';
    svg += '<rect x="46" y="344" width="408" height="12" rx="2" fill="#a16207"/>';
    svg += '<rect x="44" y="56" width="12" height="288" rx="2" fill="#a16207"/>';
    svg += '<rect x="444" y="56" width="12" height="288" rx="2" fill="#a16207"/>';

    // Pista/centro decorativo
    svg += '<circle cx="250" cy="200" r="52" fill="#f3ece1" stroke="#d6c5a8" stroke-width="2"/>';
    svg += '<circle cx="250" cy="200" r="14" fill="#e8dcc8"/>';
    svg += '<circle cx="244" cy="192" r="8" fill="#c9a86a"/>';
    svg += '<circle cx="260" cy="202" r="9" fill="#c9a86a"/>';
    svg += '<circle cx="250" cy="213" r="8" fill="#c9a86a"/>';

    // Buffets en las esquinas
    const buffets = [[70, 70], [424, 70], [70, 320], [424, 320]];
    buffets.forEach(([bx, by]) => {
        svg += `<rect x="${bx}" y="${by}" width="44" height="20" rx="4" fill="#e7e5e4" stroke="#a8a29e"/>`;
        svg += `<rect x="${bx + 4}" y="${by + 3}" width="8" height="6" rx="2" fill="#f59e0b"/>`;
        svg += `<rect x="${bx + 15}" y="${by + 3}" width="8" height="6" rx="2" fill="#ef4444"/>`;
        svg += `<rect x="${bx + 26}" y="${by + 3}" width="8" height="6" rx="2" fill="#10b981"/>`;
    });

    // Mesas circulares alrededor del centro con sillas a su alrededor
    const tables = [[370, 200], [335, 285], [250, 312], [165, 285], [130, 200], [165, 115], [250, 88], [335, 115]];
    const seatsPerTable = new Array(tables.length).fill(0);
    for (let i = 0; i < p; i++) seatsPerTable[i % tables.length]++;

    tables.forEach(([tx, ty], idx) => {
        const seats = seatsPerTable[idx];
        svg += `<circle cx="${tx}" cy="${ty}" r="20" fill="#ffffff" stroke="#94a3b8" stroke-width="2"/>`;
        svg += `<circle cx="${tx}" cy="${ty}" r="10" fill="#e2e8f0"/>`;
        const step = (2 * Math.PI) / seats;
        for (let j = 0; j < seats; j++) {
            const ang = step * j - Math.PI / 2;
            const cx = (tx + 28 * Math.cos(ang)).toFixed(1);
            const cy = (ty + 28 * Math.sin(ang)).toFixed(1);
            svg += `<rect x="${cx - 5}" y="${cy - 4}" width="10" height="8" rx="1.5" fill="#6b7280"/>`;
        }
        // Florero sobre la mesa
        if (idx % 2 === 0) {
            svg += `<circle cx="${tx}" cy="${ty}" r="4" fill="#fbcfe8"/>`;
            svg += `<circle cx="${tx}" cy="${ty - 2}" r="2.5" fill="#ec4899"/>`;
        }
    });

    svg += '<text x="14" y="20" font-family="sans-serif" font-size="11" fill="#4b5563">BANQUETE CIRCULAR · ' + p + ' personas</text>';
    svg += '</svg>';
    return svg;
}

function generarLayoutAula(personCount) {
    const p = Math.min(Math.max(personCount, 8), 60);
    const chairsPerRow = 8;
    const rows = Math.ceil(p / chairsPerRow);

    let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="400">';
    svg += '<rect width="500" height="400" fill="#f7f3ea"/>';

    // Paredes
    svg += '<rect x="46" y="44" width="408" height="12" rx="2" fill="#57534e"/>';
    svg += '<rect x="46" y="344" width="408" height="12" rx="2" fill="#57534e"/>';
    svg += '<rect x="44" y="56" width="12" height="288" rx="2" fill="#57534e"/>';
    svg += '<rect x="444" y="56" width="12" height="288" rx="2" fill="#57534e"/>';

    // Ventanas laterales
    svg += '<rect x="56" y="120" width="8" height="120" rx="2" fill="#bae6fd"/>';
    svg += '<rect x="56" y="128" width="8" height="38" fill="#e0f2fe"/>';
    svg += '<rect x="56" y="174" width="8" height="38" fill="#e0f2fe"/>';
    svg += '<rect x="436" y="120" width="8" height="120" rx="2" fill="#bae6fd"/>';
    svg += '<rect x="436" y="128" width="8" height="38" fill="#e0f2fe"/>';
    svg += '<rect x="436" y="174" width="8" height="38" fill="#e0f2fe"/>';

    // Pizarra y escritorio del docente
    svg += '<rect x="130" y="58" width="240" height="14" rx="2" fill="#334155"/>';
    svg += '<rect x="228" y="78" width="44" height="16" rx="2" fill="#1f2937"/>';
    svg += '<rect x="240" y="96" width="20" height="10" rx="2" fill="#6b7280"/>';

    // Pupitres: 2 bloques con pasillo central
    const deskW = 30, deskH = 16, chairW = 16, chairH = 10;
    const pitchX = 42, pitchY = 32;
    const startXLeft = 70, startXRight = 256, startY = 118;

    for (let i = 0; i < p; i++) {
        const row = Math.floor(i / chairsPerRow);
        const posInRow = i % chairsPerRow;
        const side = posInRow < chairsPerRow / 2 ? 0 : 1;
        const colInSide = posInRow % (chairsPerRow / 2);
        const x = (side === 0 ? startXLeft : startXRight) + colInSide * pitchX;
        const y = startY + row * pitchY;
        svg += `<rect x="${x}" y="${y}" width="${deskW}" height="${deskH}" rx="2" fill="#1f2937"/>`;
        svg += `<rect x="${x + (deskW - chairW) / 2}" y="${y + deskH + 3}" width="${chairW}" height="${chairH}" rx="2" fill="#6b7280"/>`;
    }

    // Pasillo central y puerta de salida (arriba a la derecha)
    svg += '<line x1="250" y1="118" x2="250" y2="330" stroke="#d6d3d1" stroke-width="3"/>';
    svg += '<rect x="330" y="330" width="44" height="14" fill="#ffffff" stroke="#9ca3af"/>';
    svg += '<rect x="344" y="344" width="30" height="40" fill="#ffffff" stroke="#9ca3af"/>';
    svg += '<circle cx="366" cy="337" r="2.5" fill="#9ca3af"/>';

    svg += '<text x="14" y="20" font-family="sans-serif" font-size="11" fill="#4b5563">AULA · ' + p + ' personas</text>';
    svg += '</svg>';
    return svg;
}

function generarLayoutAuditorio(personCount) {
    const p = Math.min(Math.max(personCount, 8), 80);
    const seatsPerRow = 10;
    const rows = Math.ceil(p / seatsPerRow);

    let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="400">';
    svg += '<rect width="500" height="400" fill="#eef2f7"/>';

    // Paredes
    svg += '<rect x="46" y="44" width="408" height="12" rx="2" fill="#475569"/>';
    svg += '<rect x="46" y="344" width="408" height="12" rx="2" fill="#475569"/>';
    svg += '<rect x="44" y="56" width="12" height="288" rx="2" fill="#475569"/>';
    svg += '<rect x="444" y="56" width="12" height="288" rx="2" fill="#475569"/>';

    // Escenario
    svg += '<rect x="80" y="50" width="340" height="52" rx="4" fill="#4b5563"/>';
    svg += '<rect x="88" y="58" width="324" height="36" rx="3" fill="#64748b"/>';
    svg += '<rect x="226" y="60" width="48" height="24" rx="2" fill="#1e293b"/>';
    svg += '<circle cx="250" cy="72" r="6" fill="#60a5fa"/>';
    svg += '<text x="250" y="114" text-anchor="middle" font-family="sans-serif" font-size="9" fill="#475569">ESCENARIO</text>';

    // Butacas: 2 bloques con pasillo central
    const chairW = 14, chairH = 12;
    const pitchX = 17, pitchY = 30;
    const colsHalf = seatsPerRow / 2;
    const startXLeft = 92, startXRight = 276, startY = 130;

    for (let i = 0; i < p; i++) {
        const row = Math.floor(i / seatsPerRow);
        const posInRow = i % seatsPerRow;
        const side = posInRow < colsHalf ? 0 : 1;
        const colInSide = posInRow % colsHalf;
        const x = (side === 0 ? startXLeft : startXRight) + colInSide * pitchX;
        const y = startY + row * pitchY;
        svg += `<rect x="${x}" y="${y}" width="${chairW}" height="${chairH}" rx="2" fill="#1d4ed8"/>`;
    }

    // Pasillo central
    svg += '<line x1="250" y1="130" x2="250" y2="330" stroke="#cbd5e1" stroke-width="3"/>';

    // Puertas de salida traseras
    svg += '<rect x="96" y="336" width="26" height="10" fill="#ffffff" stroke="#94a3b8"/>';
    svg += '<rect x="378" y="336" width="26" height="10" fill="#ffffff" stroke="#94a3b8"/>';
    svg += '<circle cx="118" cy="341" r="2" fill="#94a3b8"/>';
    svg += '<circle cx="400" cy="341" r="2" fill="#94a3b8"/>';

    svg += '<text x="14" y="20" font-family="sans-serif" font-size="11" fill="#4b5563">AUDITORIO · ' + p + ' personas</text>';
    svg += '</svg>';
    return svg;
}

function generarLayoutFeria(personCount) {
    const p = Math.min(Math.max(personCount, 8), 120);

    let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="400">';
    svg += '<rect width="500" height="400" fill="#fff8ec"/>';

    // Muros
    svg += '<rect x="46" y="44" width="408" height="12" rx="2" fill="#8d6e63"/>';
    svg += '<rect x="46" y="344" width="408" height="12" rx="2" fill="#8d6e63"/>';
    svg += '<rect x="44" y="56" width="12" height="288" rx="2" fill="#8d6e63"/>';
    svg += '<rect x="444" y="56" width="12" height="288" rx="2" fill="#8d6e63"/>';

    // Pasillos
    svg += '<rect x="245" y="56" width="10" height="288" fill="#fce3c8"/>';
    svg += '<rect x="46" y="196" width="408" height="10" fill="#fce3c8"/>';

    // Stands perimetrales (arriba y abajo)
    const coloresStands = ['#f9a8d4', '#a5f3fc', '#fde047', '#86efac', '#fdba74', '#c4b5fd'];
    for (let i = 0; i < 6; i++) {
        const x = 58 + i * 64;
        const color = coloresStands[i % coloresStands.length];
        svg += `<rect x="${x}" y="66" width="56" height="34" rx="3" fill="#ffffff" stroke="#cbd5e1"/>`;
        svg += `<rect x="${x}" y="66" width="56" height="9" rx="3" fill="${color}"/>`;
        svg += `<line x1="${x + 15}" y1="84" x2="${x + 15}" y2="96" stroke="#cbd5e1"/>`;
        svg += `<circle cx="${x + 10}" cy="94" r="2.5" fill="#cbd5e1"/>`;
        svg += `<circle cx="${x + 22}" cy="94" r="2.5" fill="#cbd5e1"/>`;
        svg += `<circle cx="${x + 34}" cy="94" r="2.5" fill="#cbd5e1"/>`;
        svg += `<rect x="${x}" y="300" width="56" height="34" rx="3" fill="#ffffff" stroke="#cbd5e1"/>`;
        svg += `<rect x="${x}" y="300" width="56" height="9" rx="3" fill="${color}"/>`;
        svg += `<line x1="${x + 15}" y1="318" x2="${x + 15}" y2="330" stroke="#cbd5e1"/>`;
        svg += `<circle cx="${x + 10}" cy="328" r="2.5" fill="#cbd5e1"/>`;
        svg += `<circle cx="${x + 22}" cy="328" r="2.5" fill="#cbd5e1"/>`;
        svg += `<circle cx="${x + 34}" cy="328" r="2.5" fill="#cbd5e1"/>`;
    }

    // Stands laterales
    for (let i = 0; i < 2; i++) {
        const y = 116 + i * 76;
        const color = coloresStands[(i + 2) % coloresStands.length];
        svg += `<rect x="58" y="${y}" width="34" height="60" rx="3" fill="#ffffff" stroke="#cbd5e1"/>`;
        svg += `<rect x="58" y="${y}" width="9" height="60" rx="3" fill="${color}"/>`;
        svg += `<line x1="76" y1="${y + 14}" x2="88" y2="${y + 14}" stroke="#cbd5e1"/>`;
        svg += `<rect x="408" y="${y}" width="34" height="60" rx="3" fill="#ffffff" stroke="#cbd5e1"/>`;
        svg += `<rect x="433" y="${y}" width="9" height="60" rx="3" fill="${color}"/>`;
        svg += `<line x1="416" y1="${y + 14}" x2="428" y2="${y + 14}" stroke="#cbd5e1"/>`;
    }

    // Zona central de descanso: mesas pequeñas con sillas
    const mesitasDescanso = [[130, 150], [185, 150], [130, 252], [185, 252], [315, 150], [370, 150], [315, 252], [370, 252]];
    const sillasMesitas = new Array(mesitasDescanso.length).fill(0);
    for (let i = 0; i < p; i++) sillasMesitas[i % mesitasDescanso.length]++;

    mesitasDescanso.forEach(([tx, ty], idx) => {
        const sillas = sillasMesitas[idx];
        svg += `<circle cx="${tx}" cy="${ty}" r="12" fill="#ffffff" stroke="#94a3b8" stroke-width="1.5"/>`;
        svg += `<circle cx="${tx}" cy="${ty}" r="6" fill="#e2e8f0"/>`;
        const step = (2 * Math.PI) / sillas;
        for (let j = 0; j < sillas; j++) {
            const ang = step * j - Math.PI / 2;
            const cx = (tx + 19 * Math.cos(ang)).toFixed(1);
            const cy = (ty + 19 * Math.sin(ang)).toFixed(1);
            svg += `<rect x="${cx - 4}" y="${cy - 3.5}" width="8" height="7" rx="1.5" fill="#6b7280"/>`;
        }
        // Sombrilla de colores en mesas alternas
        if (idx % 2 === 0) {
            svg += `<circle cx="${tx}" cy="${ty}" r="8" fill="${coloresStands[(idx / 2) % coloresStands.length]}" opacity="0.9"/>`;
            svg += `<circle cx="${tx}" cy="${ty}" r="2.5" fill="#ffffff"/>`;
        }
    });

    svg += '<text x="14" y="20" font-family="sans-serif" font-size="11" fill="#4b5563">FERIA · ' + p + ' personas</text>';
    svg += '</svg>';
    return svg;
}

function generarLayoutComedor(personCount) {
    const p = Math.min(Math.max(personCount, 8), 120);

    let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="400">';
    svg += '<rect width="500" height="400" fill="#fdf6ee"/>';

    // Muros
    svg += '<rect x="46" y="44" width="408" height="12" rx="2" fill="#a16207"/>';
    svg += '<rect x="46" y="344" width="408" height="12" rx="2" fill="#a16207"/>';
    svg += '<rect x="44" y="56" width="12" height="288" rx="2" fill="#a16207"/>';
    svg += '<rect x="444" y="56" width="12" height="288" rx="2" fill="#a16207"/>';

    // Mesa buffet al frente
    svg += '<rect x="196" y="58" width="108" height="16" rx="3" fill="#d6c9b3"/>';
    svg += '<rect x="200" y="60" width="100" height="12" rx="2" fill="#e7dfd2"/>';
    svg += '<circle cx="216" cy="66" r="3" fill="#f59e0b"/>';
    svg += '<circle cx="232" cy="66" r="3" fill="#ef4444"/>';
    svg += '<circle cx="248" cy="66" r="3" fill="#10b981"/>';
    svg += '<circle cx="264" cy="66" r="3" fill="#3b82f6"/>';
    svg += '<circle cx="280" cy="66" r="3" fill="#8b5cf6"/>';

    // Dos mesas largas rectangulares
    const tableY = [128, 268];
    const tableX = 70, tableW = 360, tableH = 48;
    tableY.forEach((ty, ti) => {
        svg += `<rect x="${tableX}" y="${ty}" width="${tableW}" height="${tableH}" rx="4" fill="#ffffff" stroke="#d6c5a8" stroke-width="2"/>`;
        for (let i = 0; i < 6; i++) {
            const vx = 80 + i * 62;
            svg += `<circle cx="${vx}" cy="${ty + tableH / 2}" r="4" fill="#fbcfe8"/>`;
            svg += `<circle cx="${vx}" cy="${ty + tableH / 2 - 2}" r="2" fill="#ec4899"/>`;
        }
    });

    // Sillas a ambos lados de cada mesa larga
    for (let i = 0; i < p; i++) {
        const ti = i % 2;                  // mesa (arriba / abajo)
        const local = Math.floor(i / 2);    // asiento dentro de la mesa
        const lado = local % 2;             // 0 arriba, 1 abajo
        const slot = Math.floor(local / 2);
        const ty = tableY[ti];
        const yChair = lado === 0 ? ty - 14 : ty + tableH + 4;
        const x = 86 + slot * 27;
        if (x + 12 > 444) continue;
        svg += `<rect x="${x}" y="${yChair}" width="12" height="8" rx="2" fill="#b45309"/>`;
    }

    svg += '<text x="14" y="20" font-family="sans-serif" font-size="11" fill="#4b5563">COMEDOR · ' + p + ' personas</text>';
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