-- REPARACIÓN DE SECUENCIAS FALTANTES
-- Detecta tablas cuyo PK es integer, el modelo usa autoIncrement,
-- pero la columna no tiene secuencia ni DEFAULT nextval.
-- Idempotente: se puede ejecutar varias veces sin errores.
--
-- En cada tabla:  1) crea la secuencia (si no existe)
--                 2) asigna nextval como DEFAULT de la columna PK
--                 3) sincroniza la secuencia con el MAX(id) actual
--                    (así los próximos INSERT no chocan con IDs existentes)

BEGIN;

-- 1. carrera.idcarrera
CREATE SEQUENCE IF NOT EXISTS carrera_idcarrera_seq;
ALTER TABLE carrera ALTER COLUMN idcarrera SET DEFAULT nextval('carrera_idcarrera_seq'::regclass);
SELECT setval('carrera_idcarrera_seq', COALESCE((SELECT MAX(idcarrera) FROM carrera), 0));

-- 2. clasificacion_estrategica.idclasificacion
CREATE SEQUENCE IF NOT EXISTS clasificacion_estrategica_idclasificacion_seq;
ALTER TABLE clasificacion_estrategica ALTER COLUMN idclasificacion SET DEFAULT nextval('clasificacion_estrategica_idclasificacion_seq'::regclass);
SELECT setval('clasificacion_estrategica_idclasificacion_seq', COALESCE((SELECT MAX(idclasificacion) FROM clasificacion_estrategica), 0));

-- 3. facultad.facultad_id
CREATE SEQUENCE IF NOT EXISTS facultad_facultad_id_seq;
ALTER TABLE facultad ALTER COLUMN facultad_id SET DEFAULT nextval('facultad_facultad_id_seq'::regclass);
SELECT setval('facultad_facultad_id_seq', COALESCE((SELECT MAX(facultad_id) FROM facultad), 0));

-- 4. fase.idfase
CREATE SEQUENCE IF NOT EXISTS fase_idfase_seq;
ALTER TABLE fase ALTER COLUMN idfase SET DEFAULT nextval('fase_idfase_seq'::regclass);
SELECT setval('fase_idfase_seq', COALESCE((SELECT MAX(idfase) FROM fase), 0));

-- 5. segmento.idsegmento
CREATE SEQUENCE IF NOT EXISTS segmento_idsegmento_seq;
ALTER TABLE segmento ALTER COLUMN idsegmento SET DEFAULT nextval('segmento_idsegmento_seq'::regclass);
SELECT setval('segmento_idsegmento_seq', COALESCE((SELECT MAX(idsegmento) FROM segmento), 0));

-- 6. subcategoria.idsubcategoria
CREATE SEQUENCE IF NOT EXISTS subcategoria_idsubcategoria_seq;
ALTER TABLE subcategoria ALTER COLUMN idsubcategoria SET DEFAULT nextval('subcategoria_idsubcategoria_seq'::regclass);
SELECT setval('subcategoria_idsubcategoria_seq', COALESCE((SELECT MAX(idsubcategoria) FROM subcategoria), 0));

-- 7. tipos_de_evento.idtipoevento
CREATE SEQUENCE IF NOT EXISTS tipos_de_evento_idtipoevento_seq;
ALTER TABLE tipos_de_evento ALTER COLUMN idtipoevento SET DEFAULT nextval('tipos_de_evento_idtipoevento_seq'::regclass);
SELECT setval('tipos_de_evento_idtipoevento_seq', COALESCE((SELECT MAX(idtipoevento) FROM tipos_de_evento), 0));

-- 8. VINCULAR cadena secuencia -> columna (OWNED BY)
-- Sin esto, pg_get_serial_sequence() devuelve NULL y los gestores
-- (DBeaver, pgAdmin) muestran la secuencia como "null" aunque el
-- autoincremento funcione. Es idempotente; se puede ejecutar repetidas veces.
ALTER SEQUENCE IF EXISTS evento_idevento_seq OWNED BY evento.idevento;
ALTER SEQUENCE IF EXISTS evento_pdi_idevento_pdi_seq OWNED BY evento_pdi.idevento_pdi;
ALTER SEQUENCE IF EXISTS argumentacion_idargumentacion_seq OWNED BY argumentacion.idargumentacion;
ALTER SEQUENCE IF EXISTS objetivos_idobjetivo_seq OWNED BY objetivos.idobjetivo;
ALTER SEQUENCE IF EXISTS resultado_idresultados_esperados_seq OWNED BY resultado.idresultados_esperados;
ALTER SEQUENCE IF EXISTS presupuesto_idpresupuesto_seq OWNED BY presupuesto.idpresupuesto;
ALTER SEQUENCE IF EXISTS ingreso_idingreso_seq OWNED BY ingreso.idingreso;
ALTER SEQUENCE IF EXISTS egreso_idegreso_seq OWNED BY egreso.idegreso;
ALTER SEQUENCE IF EXISTS eventoinscripcion_ideventoinscripcion_seq OWNED BY evento_inscripciones.idevento_inscripcion;
ALTER SEQUENCE IF EXISTS recurso_idrecurso_seq OWNED BY recurso.idrecurso;
ALTER SEQUENCE IF EXISTS recursos_id_recursos_seq OWNED BY recursos.id_recursos;
ALTER SEQUENCE IF EXISTS servicio_idservicio_seq OWNED BY servicio.idservicio;
ALTER SEQUENCE IF EXISTS comite_idcomite_seq OWNED BY comite.idcomite;
ALTER SEQUENCE IF EXISTS comite_mensajes_idmensaje_seq OWNED BY comite_mensajes.idmensaje;
ALTER SEQUENCE IF EXISTS comite_notificacion_id_seq OWNED BY comite_notificacion.id;
ALTER SEQUENCE IF EXISTS comite_usuarios_id_seq OWNED BY comite_usuarios.id;
ALTER SEQUENCE IF EXISTS notificacion_idnotificacion_seq OWNED BY notificacion.idnotificacion;
ALTER SEQUENCE IF EXISTS mensajes_idmensaje_seq OWNED BY mensajes.idmensaje;
ALTER SEQUENCE IF EXISTS chatmensaje_id_seq OWNED BY chatmensaje.id;
ALTER SEQUENCE IF EXISTS informe_evento_idinforme_seq OWNED BY informe_evento.idinforme;
ALTER SEQUENCE IF EXISTS layouts_idlayout_seq OWNED BY layouts.idlayout;
ALTER SEQUENCE IF EXISTS academico_idacademico_seq OWNED BY academico.idacademico;
ALTER SEQUENCE IF EXISTS estudiante_idestudiante_seq OWNED BY estudiante.idestudiante;
ALTER SEQUENCE IF EXISTS usuarios_idusuario_seq OWNED BY usuario.idusuario;
ALTER SEQUENCE IF EXISTS actividad_idactividad_seq OWNED BY actividades.idactividad;
ALTER SEQUENCE IF EXISTS carrera_idcarrera_seq OWNED BY carrera.idcarrera;
ALTER SEQUENCE IF EXISTS clasificacion_estrategica_idclasificacion_seq OWNED BY clasificacion_estrategica.idclasificacion;
ALTER SEQUENCE IF EXISTS facultad_facultad_id_seq OWNED BY facultad.facultad_id;
ALTER SEQUENCE IF EXISTS fase_idfase_seq OWNED BY fase.idfase;
ALTER SEQUENCE IF EXISTS segmento_idsegmento_seq OWNED BY segmento.idsegmento;
ALTER SEQUENCE IF EXISTS subcategoria_idsubcategoria_seq OWNED BY subcategoria.idsubcategoria;
ALTER SEQUENCE IF EXISTS tipos_de_evento_idtipoevento_seq OWNED BY tipos_de_evento.idtipoevento;

COMMIT;