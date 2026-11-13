BEGIN;
-- DOCX, apéndice A. Fail atomically on incompatible existing data.
-- No rows are deleted or repaired automatically.
ALTER TABLE usuario ADD CONSTRAINT ck_suspension_coherente CHECK ((estado = 'activo' AND suspendido_hasta IS NULL AND motivo_suspension IS NULL AND suspendido_por IS NULL) OR (estado = 'suspendido' AND suspendido_hasta IS NOT NULL AND motivo_suspension IS NOT NULL AND suspendido_por IS NOT NULL));
ALTER TABLE usuario ADD CONSTRAINT ck_foto_completa CHECK ((foto_url IS NULL) = (foto_public_id IS NULL));
ALTER TABLE usuario ADD CONSTRAINT ck_no_autosuspension CHECK (suspendido_por IS NULL OR suspendido_por <> id_usuario);
ALTER TABLE usuario ADD CONSTRAINT ck_correo_minusculas CHECK (correo = lower(correo));
ALTER TABLE publicacion ADD CONSTRAINT ck_publicacion_titulo CHECK (char_length(titulo) BETWEEN 3 AND 150);
ALTER TABLE publicacion ADD CONSTRAINT ck_publicacion_version CHECK (version >= 1);
ALTER TABLE adjunto ADD CONSTRAINT ck_archivo_en_cloudinary CHECK (tipo = 'enlace' OR cloudinary_public_id IS NOT NULL);
ALTER TABLE adjunto ADD CONSTRAINT ck_adjunto_orden CHECK (orden >= 1);
ALTER TABLE comentario ADD CONSTRAINT ck_no_autorespuesta CHECK (id_comentario_padre IS NULL OR id_comentario_padre <> id_comentario);
ALTER TABLE reporte ADD CONSTRAINT ck_reporte_un_objetivo CHECK ((id_publicacion IS NULL) <> (id_comentario IS NULL));
ALTER TABLE reporte ADD CONSTRAINT ck_reporte_resuelto CHECK ((estado = 'pendiente' AND id_moderador IS NULL AND fecha_resolucion IS NULL) OR (estado <> 'pendiente' AND id_moderador IS NOT NULL AND fecha_resolucion IS NOT NULL));
ALTER TABLE notificacion ADD CONSTRAINT ck_notificacion_una_referencia CHECK (num_nonnulls(id_publicacion, id_comentario, id_reporte) = 1);
ALTER TABLE notificacion ADD CONSTRAINT ck_notificacion_tipo CHECK ((tipo IN ('comentario','respuesta') AND id_comentario IS NOT NULL) OR (tipo = 'publicacion_grupo' AND id_publicacion IS NOT NULL) OR (tipo IN ('resultado_reporte','nuevo_reporte') AND id_reporte IS NOT NULL) OR (tipo = 'contenido_retirado' AND id_reporte IS NULL));
COMMIT;
