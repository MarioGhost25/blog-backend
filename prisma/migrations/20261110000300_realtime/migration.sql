CREATE TABLE presencia_sala (
  conexion uuid NOT NULL,
  sala varchar(80) NOT NULL,
  id_usuario bigint NOT NULL REFERENCES usuario(id_usuario) ON DELETE CASCADE,
  vence timestamptz NOT NULL,
  PRIMARY KEY(conexion,sala)
);
CREATE INDEX presencia_sala_sala_vence_idx ON presencia_sala(sala,vence);
-- PostgreSQL delivers NOTIFY only after commit, to every listening instance.
-- Only identifiers/invalidation signals cross the channel; REST supplies content.
CREATE FUNCTION notificar_cambio_blog() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r jsonb; e jsonb; p bigint;
BEGIN
  r := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  CASE TG_TABLE_NAME
    WHEN 'publicacion' THEN
      IF TG_OP = 'INSERT' AND NEW.estado <> 'visible' THEN RETURN NULL; END IF;
      e := jsonb_build_object('event',CASE WHEN TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.estado = 'retenido' AND NEW.estado = 'visible') THEN 'publicacion:nueva' ELSE 'publicacion:actualizada' END,'postId',r->>'id_publicacion','groupId',r->>'id_grupo');
    WHEN 'comentario' THEN
      IF TG_OP = 'INSERT' AND NEW.estado <> 'visible' THEN RETURN NULL; END IF;
      SELECT id_grupo INTO p FROM publicacion WHERE id_publicacion = (r->>'id_publicacion')::bigint;
      e := jsonb_build_object('event',CASE WHEN TG_OP <> 'DELETE' AND NEW.estado = 'visible' THEN 'comentario:nuevo' ELSE 'comentario:retirado' END,'postId',r->>'id_publicacion','groupId',p::text);
    WHEN 'adjunto' THEN
      SELECT id_grupo INTO p FROM publicacion WHERE id_publicacion = (r->>'id_publicacion')::bigint;
      e := jsonb_build_object('event','publicacion:actualizada','postId',r->>'id_publicacion','groupId',p::text);
    WHEN 'miembro_grupo' THEN e := jsonb_build_object('event','acceso:actualizado','groupId',r->>'id_grupo','userId',r->>'id_usuario');
    WHEN 'usuario' THEN e := jsonb_build_object('event','acceso:cuenta','userId',r->>'id_usuario');
    WHEN 'notificacion' THEN e := jsonb_build_object('event',CASE WHEN TG_OP = 'INSERT' THEN 'notificacion:nueva' ELSE 'notificacion:contador' END,'userId',r->>'id_destinatario');
    WHEN 'presencia_sala' THEN e := jsonb_build_object('event','presencia:actualizada','room',r->>'sala');
    ELSE RETURN NULL;
  END CASE;
  PERFORM pg_notify('blog_events',e::text);
  RETURN NULL;
END;
$$;
CREATE TRIGGER evento_publicacion AFTER INSERT OR UPDATE OR DELETE ON publicacion FOR EACH ROW EXECUTE FUNCTION notificar_cambio_blog();
CREATE TRIGGER evento_comentario AFTER INSERT OR UPDATE OR DELETE ON comentario FOR EACH ROW EXECUTE FUNCTION notificar_cambio_blog();
CREATE TRIGGER evento_adjunto AFTER INSERT OR UPDATE OR DELETE ON adjunto FOR EACH ROW EXECUTE FUNCTION notificar_cambio_blog();
CREATE TRIGGER evento_membresia AFTER INSERT OR UPDATE OR DELETE ON miembro_grupo FOR EACH ROW EXECUTE FUNCTION notificar_cambio_blog();
CREATE TRIGGER evento_cuenta AFTER UPDATE OF estado,rol ON usuario FOR EACH ROW EXECUTE FUNCTION notificar_cambio_blog();
CREATE TRIGGER evento_notificacion AFTER INSERT OR UPDATE OR DELETE ON notificacion FOR EACH ROW EXECUTE FUNCTION notificar_cambio_blog();
CREATE TRIGGER evento_presencia AFTER INSERT OR DELETE ON presencia_sala FOR EACH ROW EXECUTE FUNCTION notificar_cambio_blog();
