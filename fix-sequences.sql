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

COMMIT;