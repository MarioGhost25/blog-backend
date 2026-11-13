CREATE TABLE revision_contenido (
  id_revision bigserial PRIMARY KEY,
  tipo varchar(20) NOT NULL CHECK (tipo IN ('post','comment')),
  id_contenido bigint NOT NULL,
  id_actor bigint NOT NULL REFERENCES usuario(id_usuario) ON DELETE RESTRICT,
  decision varchar(30) NOT NULL CHECK (decision IN ('publish','remove')),
  observacion varchar(1000),
  fecha_creacion timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX revision_contenido_tipo_id_contenido_idx ON revision_contenido(tipo,id_contenido);
