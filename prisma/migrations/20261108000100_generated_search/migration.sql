BEGIN;
-- Only the derived vector is replaced; titles, bodies and identifiers survive.
-- PostgreSQL calculates vectors for existing rows as part of ADD COLUMN.
ALTER TABLE "publicacion" DROP COLUMN "busqueda";
ALTER TABLE "publicacion" ADD COLUMN "busqueda" tsvector
GENERATED ALWAYS AS (
  setweight(to_tsvector('spanish'::regconfig, coalesce("titulo", '')), 'A') ||
  setweight(to_tsvector('spanish'::regconfig, coalesce("contenido", '')), 'B')
) STORED;
CREATE INDEX "ix_publicacion_busqueda" ON "publicacion" USING GIN ("busqueda");
COMMIT;
