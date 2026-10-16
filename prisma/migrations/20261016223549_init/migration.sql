-- CreateEnum
CREATE TYPE "rol_global" AS ENUM ('usuario', 'administrador');

-- CreateEnum
CREATE TYPE "estado_usuario" AS ENUM ('activo', 'suspendido');

-- CreateEnum
CREATE TYPE "rol_grupo" AS ENUM ('miembro', 'moderador', 'administrador');

-- CreateEnum
CREATE TYPE "estado_contenido" AS ENUM ('visible', 'retenido', 'eliminado');

-- CreateEnum
CREATE TYPE "tipo_adjunto" AS ENUM ('imagen', 'documento', 'enlace');

-- CreateEnum
CREATE TYPE "estado_reporte" AS ENUM ('pendiente', 'desestimado', 'contenido_retirado', 'usuario_suspendido');

-- CreateEnum
CREATE TYPE "tipo_notificacion" AS ENUM ('comentario', 'respuesta', 'publicacion_grupo', 'resultado_reporte', 'contenido_retirado', 'nuevo_reporte');

-- CreateTable
CREATE TABLE "usuario" (
    "id_usuario" BIGSERIAL NOT NULL,
    "nombre" VARCHAR(80) NOT NULL,
    "apellido" VARCHAR(80) NOT NULL,
    "correo" VARCHAR(254) NOT NULL,
    "contrasena_hash" VARCHAR(255) NOT NULL,
    "carrera" VARCHAR(100),
    "universidad" VARCHAR(120),
    "biografia" VARCHAR(500),
    "foto_url" VARCHAR(1024),
    "foto_public_id" VARCHAR(255),
    "rol" "rol_global" NOT NULL DEFAULT 'usuario',
    "estado" "estado_usuario" NOT NULL DEFAULT 'activo',
    "suspendido_hasta" TIMESTAMPTZ(6),
    "motivo_suspension" VARCHAR(500),
    "suspendido_por" BIGINT,
    "fecha_registro" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_usuario" PRIMARY KEY ("id_usuario")
);

-- CreateTable
CREATE TABLE "token_recuperacion" (
    "id_token" BIGSERIAL NOT NULL,
    "id_usuario" BIGINT NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "fecha_expiracion" TIMESTAMPTZ(6) NOT NULL,
    "fecha_uso" TIMESTAMPTZ(6),

    CONSTRAINT "pk_token_recuperacion" PRIMARY KEY ("id_token")
);

-- CreateTable
CREATE TABLE "categoria" (
    "id_categoria" BIGSERIAL NOT NULL,
    "nombre" VARCHAR(80) NOT NULL,
    "descripcion" VARCHAR(255),

    CONSTRAINT "pk_categoria" PRIMARY KEY ("id_categoria")
);

-- CreateTable
CREATE TABLE "publicacion" (
    "id_publicacion" BIGSERIAL NOT NULL,
    "id_autor" BIGINT NOT NULL,
    "id_categoria" BIGINT NOT NULL,
    "id_grupo" BIGINT,
    "titulo" VARCHAR(150) NOT NULL,
    "contenido" TEXT NOT NULL,
    "estado" "estado_contenido" NOT NULL DEFAULT 'visible',
    "version" INTEGER NOT NULL DEFAULT 1,
    "fecha_creacion" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_edicion" TIMESTAMPTZ(6),
    "busqueda" tsvector,

    CONSTRAINT "pk_publicacion" PRIMARY KEY ("id_publicacion")
);

-- CreateTable
CREATE TABLE "adjunto" (
    "id_adjunto" BIGSERIAL NOT NULL,
    "id_publicacion" BIGINT NOT NULL,
    "tipo" "tipo_adjunto" NOT NULL,
    "titulo" VARCHAR(150) NOT NULL,
    "url" VARCHAR(1024) NOT NULL,
    "cloudinary_public_id" VARCHAR(255),
    "orden" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pk_adjunto" PRIMARY KEY ("id_adjunto")
);

-- CreateTable
CREATE TABLE "comentario" (
    "id_comentario" BIGSERIAL NOT NULL,
    "id_publicacion" BIGINT NOT NULL,
    "id_autor" BIGINT NOT NULL,
    "id_comentario_padre" BIGINT,
    "contenido" VARCHAR(2000) NOT NULL,
    "estado" "estado_contenido" NOT NULL DEFAULT 'visible',
    "fecha_creacion" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_comentario" PRIMARY KEY ("id_comentario")
);

-- CreateTable
CREATE TABLE "grupo_estudio" (
    "id_grupo" BIGSERIAL NOT NULL,
    "id_categoria" BIGINT NOT NULL,
    "id_creador" BIGINT NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "descripcion" VARCHAR(1000),
    "fecha_creacion" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_grupo_estudio" PRIMARY KEY ("id_grupo")
);

-- CreateTable
CREATE TABLE "miembro_grupo" (
    "id_grupo" BIGINT NOT NULL,
    "id_usuario" BIGINT NOT NULL,
    "rol" "rol_grupo" NOT NULL DEFAULT 'miembro',
    "fecha_union" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_miembro_grupo" PRIMARY KEY ("id_grupo","id_usuario")
);

-- CreateTable
CREATE TABLE "reporte" (
    "id_reporte" BIGSERIAL NOT NULL,
    "id_reportante" BIGINT NOT NULL,
    "id_publicacion" BIGINT,
    "id_comentario" BIGINT,
    "motivo" VARCHAR(500) NOT NULL,
    "estado" "estado_reporte" NOT NULL DEFAULT 'pendiente',
    "id_moderador" BIGINT,
    "observacion" VARCHAR(1000),
    "fecha_creacion" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_resolucion" TIMESTAMPTZ(6),

    CONSTRAINT "pk_reporte" PRIMARY KEY ("id_reporte")
);

-- CreateTable
CREATE TABLE "notificacion" (
    "id_notificacion" BIGSERIAL NOT NULL,
    "id_destinatario" BIGINT NOT NULL,
    "tipo" "tipo_notificacion" NOT NULL,
    "mensaje" VARCHAR(255) NOT NULL,
    "id_publicacion" BIGINT,
    "id_comentario" BIGINT,
    "id_reporte" BIGINT,
    "fecha_creacion" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_lectura" TIMESTAMPTZ(6),

    CONSTRAINT "pk_notificacion" PRIMARY KEY ("id_notificacion")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_usuario_correo" ON "usuario"("correo");

-- CreateIndex
CREATE INDEX "ix_usuario_suspension" ON "usuario"("estado", "suspendido_hasta");

-- CreateIndex
CREATE UNIQUE INDEX "uq_token_hash" ON "token_recuperacion"("token_hash");

-- CreateIndex
CREATE INDEX "ix_token_usuario" ON "token_recuperacion"("id_usuario");

-- CreateIndex
CREATE UNIQUE INDEX "uq_categoria_nombre" ON "categoria"("nombre");

-- CreateIndex
CREATE INDEX "ix_publicacion_categoria" ON "publicacion"("id_categoria", "estado", "fecha_creacion");

-- CreateIndex
CREATE INDEX "ix_publicacion_grupo" ON "publicacion"("id_grupo", "estado", "fecha_creacion");

-- CreateIndex
CREATE INDEX "ix_publicacion_autor" ON "publicacion"("id_autor", "fecha_creacion");

-- CreateIndex
CREATE UNIQUE INDEX "uq_adjunto_orden" ON "adjunto"("id_publicacion", "orden");

-- CreateIndex
CREATE INDEX "ix_comentario_publicacion" ON "comentario"("id_publicacion", "fecha_creacion");

-- CreateIndex
CREATE INDEX "ix_comentario_padre" ON "comentario"("id_comentario_padre");

-- CreateIndex
CREATE INDEX "ix_comentario_autor" ON "comentario"("id_autor");

-- CreateIndex
CREATE UNIQUE INDEX "uq_comentario_publicacion" ON "comentario"("id_comentario", "id_publicacion");

-- CreateIndex
CREATE INDEX "ix_grupo_categoria" ON "grupo_estudio"("id_categoria");

-- CreateIndex
CREATE INDEX "ix_grupo_creador" ON "grupo_estudio"("id_creador");

-- CreateIndex
CREATE INDEX "ix_miembro_usuario" ON "miembro_grupo"("id_usuario");

-- CreateIndex
CREATE INDEX "ix_reporte_estado" ON "reporte"("estado", "fecha_creacion");

-- CreateIndex
CREATE INDEX "ix_reporte_publicacion" ON "reporte"("id_publicacion");

-- CreateIndex
CREATE INDEX "ix_reporte_comentario" ON "reporte"("id_comentario");

-- CreateIndex
CREATE INDEX "ix_reporte_moderador" ON "reporte"("id_moderador");

-- CreateIndex
CREATE UNIQUE INDEX "uq_reporte_publicacion" ON "reporte"("id_reportante", "id_publicacion");

-- CreateIndex
CREATE UNIQUE INDEX "uq_reporte_comentario" ON "reporte"("id_reportante", "id_comentario");

-- CreateIndex
CREATE INDEX "ix_notificacion_bandeja" ON "notificacion"("id_destinatario", "fecha_lectura", "fecha_creacion");

-- CreateIndex
CREATE INDEX "ix_notificacion_publicacion" ON "notificacion"("id_publicacion");

-- CreateIndex
CREATE INDEX "ix_notificacion_comentario" ON "notificacion"("id_comentario");

-- CreateIndex
CREATE INDEX "ix_notificacion_reporte" ON "notificacion"("id_reporte");

-- AddForeignKey
ALTER TABLE "usuario" ADD CONSTRAINT "fk_usuario_suspendido_por" FOREIGN KEY ("suspendido_por") REFERENCES "usuario"("id_usuario") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "token_recuperacion" ADD CONSTRAINT "fk_token_recuperacion_usuario" FOREIGN KEY ("id_usuario") REFERENCES "usuario"("id_usuario") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "publicacion" ADD CONSTRAINT "fk_publicacion_autor" FOREIGN KEY ("id_autor") REFERENCES "usuario"("id_usuario") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "publicacion" ADD CONSTRAINT "fk_publicacion_categoria" FOREIGN KEY ("id_categoria") REFERENCES "categoria"("id_categoria") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "publicacion" ADD CONSTRAINT "fk_publicacion_grupo" FOREIGN KEY ("id_grupo") REFERENCES "grupo_estudio"("id_grupo") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "adjunto" ADD CONSTRAINT "fk_adjunto_publicacion" FOREIGN KEY ("id_publicacion") REFERENCES "publicacion"("id_publicacion") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "comentario" ADD CONSTRAINT "fk_comentario_publicacion" FOREIGN KEY ("id_publicacion") REFERENCES "publicacion"("id_publicacion") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "comentario" ADD CONSTRAINT "fk_comentario_autor" FOREIGN KEY ("id_autor") REFERENCES "usuario"("id_usuario") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "comentario" ADD CONSTRAINT "fk_comentario_comentario_padre_publicacion" FOREIGN KEY ("id_comentario_padre", "id_publicacion") REFERENCES "comentario"("id_comentario", "id_publicacion") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "grupo_estudio" ADD CONSTRAINT "fk_grupo_estudio_categoria" FOREIGN KEY ("id_categoria") REFERENCES "categoria"("id_categoria") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "grupo_estudio" ADD CONSTRAINT "fk_grupo_estudio_creador" FOREIGN KEY ("id_creador") REFERENCES "usuario"("id_usuario") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "miembro_grupo" ADD CONSTRAINT "fk_miembro_grupo_grupo" FOREIGN KEY ("id_grupo") REFERENCES "grupo_estudio"("id_grupo") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "miembro_grupo" ADD CONSTRAINT "fk_miembro_grupo_usuario" FOREIGN KEY ("id_usuario") REFERENCES "usuario"("id_usuario") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reporte" ADD CONSTRAINT "fk_reporte_reportante" FOREIGN KEY ("id_reportante") REFERENCES "usuario"("id_usuario") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reporte" ADD CONSTRAINT "fk_reporte_moderador" FOREIGN KEY ("id_moderador") REFERENCES "usuario"("id_usuario") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reporte" ADD CONSTRAINT "fk_reporte_publicacion" FOREIGN KEY ("id_publicacion") REFERENCES "publicacion"("id_publicacion") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reporte" ADD CONSTRAINT "fk_reporte_comentario" FOREIGN KEY ("id_comentario") REFERENCES "comentario"("id_comentario") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notificacion" ADD CONSTRAINT "fk_notificacion_destinatario" FOREIGN KEY ("id_destinatario") REFERENCES "usuario"("id_usuario") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notificacion" ADD CONSTRAINT "fk_notificacion_publicacion" FOREIGN KEY ("id_publicacion") REFERENCES "publicacion"("id_publicacion") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notificacion" ADD CONSTRAINT "fk_notificacion_comentario" FOREIGN KEY ("id_comentario") REFERENCES "comentario"("id_comentario") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notificacion" ADD CONSTRAINT "fk_notificacion_reporte" FOREIGN KEY ("id_reporte") REFERENCES "reporte"("id_reporte") ON DELETE CASCADE ON UPDATE NO ACTION;
