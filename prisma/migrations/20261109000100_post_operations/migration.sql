BEGIN;
-- Durable receipts: no HTML, passwords, cookies or JWTs. Do not prune receipts
-- without a replacement tombstone: an old retry must never become a new write.
CREATE TABLE operacion_publicacion (
  id_usuario BIGINT NOT NULL,
  clave UUID NOT NULL,
  metodo VARCHAR(6) NOT NULL,
  huella CHAR(64) NOT NULL,
  id_publicacion BIGINT NOT NULL,
  version INTEGER NOT NULL,
  fecha_creacion TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_operacion_publicacion PRIMARY KEY (id_usuario, clave),
  CONSTRAINT fk_operacion_usuario FOREIGN KEY (id_usuario) REFERENCES usuario(id_usuario) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT fk_operacion_publicacion FOREIGN KEY (id_publicacion) REFERENCES publicacion(id_publicacion) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT ck_operacion_metodo CHECK (metodo IN ('POST', 'PATCH', 'DELETE')),
  CONSTRAINT ck_operacion_version CHECK (version >= 1),
  CONSTRAINT ck_operacion_huella CHECK (huella ~ '^[0-9a-f]{64}$')
);
COMMIT;
