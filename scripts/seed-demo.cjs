// Manual only. Local demo database by default; --heroku uses the deployed app DATABASE_URL. No dotenv loading.
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const bcrypt = require('bcrypt');
const heroku = process.argv.includes('--heroku');
let url;
try { url = new URL((heroku ? process.env.DATABASE_URL : process.env.DEMO_DATABASE_URL) || 'http://invalid'); }
catch { throw new Error('Invalid seed database configuration.'); }
if (!['postgres:','postgresql:'].includes(url.protocol) || url.hash) throw new Error('A PostgreSQL database URL is required.');
if (heroku) {
  if (!/^run\./.test(process.env.DYNO || '') || process.env.DEMO_SEED_CONFIRM !== 'heroku-demo') throw new Error('Heroku seed requires an explicit one-off dyno and DEMO_SEED_CONFIRM=heroku-demo.');
  if (process.env.DEMO_DATABASE_URL) throw new Error('Remove DEMO_DATABASE_URL in Heroku mode; only the app DATABASE_URL is used.');
} else if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname) || !/\/(?:[a-z0-9_]+_)?(?:demo|test)$/.test(url.pathname) || url.search || process.env.DEMO_SEED_CONFIRM !== 'local-demo') {
  throw new Error('Local mode requires an authorized *_demo or *_test database and DEMO_SEED_CONFIRM=local-demo.');
}
const password = process.env.DEMO_PASSWORD;
if (!password || password.length < 12 || password.length > 72 || Buffer.byteLength(password,'utf8') > 72 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) throw new Error('Set DEMO_PASSWORD (12+ characters, at most 72 bytes, uppercase, lowercase and digit).');
if (process.argv.includes('--check')) {
  console.log('Seed configuration valid. No database connection or writes performed.');
  process.exit(0);
}
// Match the existing PrismaService TLS configuration on Heroku.
const prisma = new PrismaClient({adapter:new PrismaPg({connectionString:url.href,...(heroku ? {ssl:{rejectUnauthorized:false}} : {})})});
const marker = 'ASTRA_DEMO_V1';
async function main() {
  const hash = await bcrypt.hash(password,12);
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(718291)::text`;
    const users=[];
    for(const [i,nombre] of ['Ana','Bruno','Carla','Diego','Elena'].entries()) {
      const correo=`astra.demo.${i+1}@example.test`;
      let user=await tx.usuario.findUnique({where:{correo}});
      if(user && user.biografia!==marker) throw new Error('Reserved demo email belongs to another account; no changes applied.');
      if(!user) user=await tx.usuario.create({data:{correo,nombre,apellido:'Demostración',biografia:marker,contrasena_hash:hash,rol:i===4?'administrador':'usuario',carrera:'Ingeniería',universidad:'Universidad de demostración'}});
      users.push(user);
    }
    const categories=[],groups=[];
    for(const [i,name] of ['Cálculo','Programación','Bases de datos'].entries()) {
      const category=await tx.categoria.upsert({where:{nombre:`Demo · ${name}`},create:{nombre:`Demo · ${name}`,descripcion:'Material académico ficticio'},update:{}});
      categories.push(category);
      let group=await tx.grupoEstudio.findFirst({where:{nombre:`ASTRA Demo · ${name}`,id_creador:users[i].id_usuario}});
      if(!group)group=await tx.grupoEstudio.create({data:{nombre:`ASTRA Demo · ${name}`,descripcion:'Grupo de estudio para la presentación académica.',id_creador:users[i].id_usuario,id_categoria:category.id_categoria}});
      groups.push(group);
      for(const [j,user] of users.entries())if(j!==3)await tx.miembroGrupo.upsert({where:{id_grupo_id_usuario:{id_grupo:group.id_grupo,id_usuario:user.id_usuario}},create:{id_grupo:group.id_grupo,id_usuario:user.id_usuario,rol:j===i?'administrador':j===4?'moderador':'miembro'},update:{}});
    }
    const titles=['Límites y continuidad: guía de repaso','Derivadas con ejemplos cotidianos','Cómo organizar una semana de estudio','Algoritmos de búsqueda y complejidad','Consejos para depurar un programa','Plan de repaso para el parcial','Claves primarias y relaciones','Normalización paso a paso','Consultas SQL para practicar','Trabajo en equipo y revisión de código','Preparación de una exposición oral','Dudas para revisar con el equipo'];
    for(const [i,title] of titles.entries()) {
      const author=users[i%3], titleKey=`Demo ${i+1}: ${title}`;
      let post=await tx.publicacion.findFirst({where:{id_autor:author.id_usuario,titulo:titleKey}});
      if(!post)post=await tx.publicacion.create({data:{id_autor:author.id_usuario,id_categoria:categories[i%3].id_categoria,id_grupo:i%2?groups[i%3].id_grupo:null,titulo:titleKey,contenido:`<p>${title}. Propongo revisar los conceptos principales, resolver tres ejercicios y comparar las soluciones en equipo. ¿Qué dudas encontraron durante la práctica?</p>`,estado:i===11?'retenido':'visible'}});
      if(i===11)continue;
      const commenter=users[(i+1)%3];
      let comment=await tx.comentario.findFirst({where:{id_publicacion:post.id_publicacion,id_autor:commenter.id_usuario,contenido:'Me ayudó resolver primero un ejemplo sencillo. ¿Podemos comparar los pasos?'}});
      if(!comment)comment=await tx.comentario.create({data:{id_publicacion:post.id_publicacion,id_autor:commenter.id_usuario,contenido:'Me ayudó resolver primero un ejemplo sencillo. ¿Podemos comparar los pasos?'}});
      if(!await tx.comentario.findFirst({where:{id_comentario_padre:comment.id_comentario,id_autor:author.id_usuario}}))await tx.comentario.create({data:{id_publicacion:post.id_publicacion,id_autor:author.id_usuario,id_comentario_padre:comment.id_comentario,contenido:'Sí, revisemos el procedimiento y anotemos las dudas para la próxima sesión.'}});
      if(!await tx.notificacion.findFirst({where:{id_destinatario:author.id_usuario,id_comentario:comment.id_comentario,tipo:'comentario'}}))await tx.notificacion.create({data:{id_destinatario:author.id_usuario,id_comentario:comment.id_comentario,tipo:'comentario',mensaje:'There is a new comment on your post.'}});
    }
  },{timeout:60000});
  console.log('Demo ready: 5 accounts astra.demo.1@example.test through astra.demo.5@example.test; 3 groups; 12 posts. Existing passwords/data unchanged.');
}
main().catch(()=>{console.error('Demo seed failed; transaction rolled back. Check local schema and configuration.');process.exitCode=1;}).finally(()=>prisma.$disconnect());
