ALTER TABLE adjunto ADD COLUMN entrega varchar(20) NOT NULL DEFAULT 'upload';
ALTER TABLE adjunto ADD COLUMN mime varchar(100);
ALTER TABLE adjunto ADD CONSTRAINT ck_adjunto_entrega CHECK (entrega IN ('upload', 'authenticated'));
CREATE TABLE activo_multimedia (
  public_id varchar(255) PRIMARY KEY,
  tipo varchar(20) NOT NULL CHECK (tipo IN ('image','document')),
  entrega varchar(20) NOT NULL CHECK (entrega IN ('upload','authenticated')),
  estado varchar(20) NOT NULL DEFAULT 'pending' CHECK (estado IN ('pending','linked','deleting')),
  intentos integer NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  siguiente_intento timestamptz NOT NULL,
  fecha_creacion timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activo_multimedia_estado_siguiente_intento_idx ON activo_multimedia(estado,siguiente_intento);
