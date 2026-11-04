import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import mariadb from 'mariadb';
import multer from 'multer';
import {parse} from 'csv-parse/sync';
const app=express();app.use(cors());app.use(express.json({limit:'1mb'}));
// MariaDB devuelve BIGINT como bigint nativo (por ejemplo id y affectedRows).
// JSON.stringify no admite bigint: números seguros se convierten a Number;
// enteros fuera del rango seguro se serializan como String sin perder precisión.
app.set('json replacer', (_key, value) => {
 if (typeof value !== 'bigint') return value;
 return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
  ? Number(value) : value.toString();
});
const pool=mariadb.createPool({host:process.env.DB_HOST||'db',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'outreach',password:process.env.DB_PASSWORD,database:process.env.DB_NAME||'outreach',connectionLimit:5,connectTimeout:10000,acquireTimeout:20000,initializationTimeout:30000});
const secret=process.env.JWT_SECRET;if(!secret||secret.length<32||secret==='replace-with-long-random-secret'){console.error('Configure JWT_SECRET');process.exit(1)}
const auth=(req,res,next)=>{try{const t=(req.headers.authorization||'').replace(/^Bearer /,'');jwt.verify(t,secret);next()}catch{res.status(401).json({error:'No autorizado'})}};
const query=async(sql,params=[])=>{let c;try{c=await pool.getConnection();return await c.query(sql,params)}finally{if(c)c.release()}};
app.post('/api/login',(req,res)=>{if(req.body.username===process.env.ADMIN_USER&&req.body.password===process.env.ADMIN_PASSWORD&&req.body.password){return res.json({token:jwt.sign({role:'admin'},secret,{expiresIn:'8h'})})}res.status(401).json({error:'Credenciales incorrectas'})});
app.get('/api/contacts',auth,async(req,res)=>{try{res.json(await query('SELECT * FROM contacts ORDER BY id DESC'))}catch(e){res.status(500).json({error:e.message})}});
app.post('/api/contacts',auth,async(req,res)=>{try{const {name,email,linkedin_url,notes}=req.body;if(!name?.trim())return res.status(400).json({error:'Nombre requerido'});const r=await query('INSERT INTO contacts (name,email,linkedin_url,notes) VALUES (?,?,?,?)',[name.trim(),email||null,linkedin_url||null,notes||null]);res.json({id:Number(r.insertId)})}catch(e){res.status(500).json({error:e.message})}});
app.put('/api/contacts/:id',auth,async(req,res)=>{try{const {name,email,linkedin_url,notes,status}=req.body;const allowed=['pending','prepared','sent','failed','cancelled'];if(!name?.trim()||!allowed.includes(status))return res.status(400).json({error:'Datos inválidos'});await query('UPDATE contacts SET name=?,email=?,linkedin_url=?,notes=?,status=?,sent_at=CASE WHEN ?="sent" THEN COALESCE(sent_at,NOW()) ELSE NULL END WHERE id=?',[name.trim(),email||null,linkedin_url||null,notes||null,status,status,req.params.id]);res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});
app.delete('/api/contacts/:id',auth,async(req,res)=>{try{await query('DELETE FROM contacts WHERE id=?',[req.params.id]);res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});
// Importación directa de Invitations.csv exportado por LinkedIn.
const clean = v => String(v ?? '').trim();
const profile = v => { const value=clean(v); if(!value)return ''; try { const u=new URL(value); if(!['linkedin.com','www.linkedin.com'].includes(u.hostname.toLowerCase()) || !u.pathname.startsWith('/in/'))return ''; return `${u.origin}${u.pathname.replace(/\/$/,'')}`; } catch {return '';} };
app.post('/api/import',auth,multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024}}).single('file'),async(req,res)=>{
 try {
  if(!req.file)return res.status(400).json({error:'Adjunta Invitations.csv'});
  const records=parse(req.file.buffer.toString('utf8').replace(/^\uFEFF/,''),{columns:true,bom:true,skip_empty_lines:true,relax_column_count:true,trim:true});
  if(!records.length)return res.status(400).json({error:'El archivo CSV está vacío'});
  const cols=Object.keys(records[0]);const invitations=['From','To','Direction','inviterProfileUrl','inviteeProfileUrl'].every(k=>cols.includes(k));
  const connections=['First Name','Last Name'].every(k=>cols.includes(k));
  if(!invitations&&!connections)return res.status(400).json({error:'Formato no reconocido. Se espera Invitations.csv (From,To,Direction,inviterProfileUrl,inviteeProfileUrl) o Connections.csv.'});
  const result={imported:0,updated:0,duplicates:0,invalid:0,total:records.length,format:invitations?'Invitations.csv':'Connections.csv',withoutEmail:0};
  const seen=new Set();
  for(const r of records){
   const dir=clean(r.Direction).toUpperCase();
   if(invitations&&!['OUTGOING','INCOMING'].includes(dir)){result.invalid++;continue;}
   const name=invitations?clean(dir==='OUTGOING'?r.To:r.From):clean([r['First Name'],r['Last Name']].filter(Boolean).join(' '));
   const url=profile(invitations?(dir==='OUTGOING'?r.inviteeProfileUrl:r.inviterProfileUrl):(r.URL||r.linkedin_url));
   const email=clean(r['Email Address']||r.email)||null;
   if(!name||!url){result.invalid++;continue;}
   const key=url.toLowerCase();if(seen.has(key)){result.duplicates++;continue;}seen.add(key);
   const existing=await query('SELECT id,email FROM contacts WHERE LOWER(TRIM(TRAILING \'/\' FROM linkedin_url))=? LIMIT 1',[key]);
   if(existing.length){
    if(email&&!existing[0].email){await query('UPDATE contacts SET email=? WHERE id=?',[email,existing[0].id]);result.updated++;}
    else result.duplicates++;
   } else {await query('INSERT INTO contacts (name,email,linkedin_url,notes) VALUES (?,?,?,?)',[name,email,url,invitations?`Invitación ${dir}; fecha original: ${clean(r['Sent At'])}`:'Importado desde Connections.csv']);result.imported++;}
   if(!email)result.withoutEmail++;
  }
  res.json(result);
 }catch(e){console.error('Import CSV:',e);res.status(400).json({error:e.message});}
});
// Cola persistente: MariaDB conserva los mensajes aun si el contenedor reinicia.
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const allowedJobs=['queued','retry','sending','sent','failed','expired','cancelled'];
const mailTemplate=(name)=>`👋 ¡Hola, ${name.split(' ')[0]}! ¿Cómo estás?\n\nQuería compartir contigo que actualmente estoy disponible para nuevos desafíos y oportunidades laborales en el área de tecnología. 🚀\n\n💼 Cuento con amplia experiencia en el sector financiero y bancario, arquitectura de software, análisis de sistemas, integración de plataformas y dirección de proyectos tecnológicos.\n\n🎯 Estoy interesado en oportunidades como:\n• Jefe de Proyecto\n• Arquitecto de Software\n• Analista de Sistemas\n• Especialista en TI\n• Director de TI\n\n🤝 Si conoces alguna oportunidad o puedes recomendarme con alguien de tu red, te agradecería muchísimo el apoyo.\n\n🔗 https://www.lnkn.cl\n\n¡Muchas gracias por tu tiempo y por cualquier dato o contacto que puedas compartir!\n\n¡Un abrazo!`;
async function migrate(){
 await query(`CREATE TABLE IF NOT EXISTS email_jobs (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, contact_id INT NULL, recipient_name VARCHAR(255) NOT NULL,
 recipient_email VARCHAR(255) NOT NULL, subject VARCHAR(255) NOT NULL, body TEXT NOT NULL,
 status ENUM('queued','retry','sending','sent','failed','expired','cancelled') NOT NULL DEFAULT 'queued',
 attempts INT NOT NULL DEFAULT 0, next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 expires_at DATETIME NOT NULL, sent_at DATETIME NULL, brevo_message_id VARCHAR(255) NULL,
 last_error TEXT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX idx_queue(status,next_attempt_at), INDEX idx_contact(contact_id)
 )`);
 // Los jobs existentes se mantienen al actualizar; el proceso reanuda estados interrumpidos.
 await query("UPDATE email_jobs SET status='retry', next_attempt_at=NOW(), last_error='Reanudado después de reinicio' WHERE status='sending' AND expires_at>NOW()");
 await query("UPDATE email_jobs SET status='expired', last_error='Plazo de 24 horas vencido' WHERE status IN ('queued','retry','sending') AND expires_at<=NOW()");
}
app.post('/api/email-jobs',auth,async(req,res)=>{try{
 const ids=Array.isArray(req.body.contact_ids)?[...new Set(req.body.contact_ids.map(Number))]:[];
 if(!ids.length||ids.length>500||ids.some(x=>!Number.isSafeInteger(x)||x<1))return res.status(400).json({error:'Selecciona entre 1 y 500 contactos'});
 const subject=String(req.body.subject||'Disponible para nuevos desafíos profesionales').trim().slice(0,255);
 if(!subject)return res.status(400).json({error:'Asunto requerido'});
 const placeholders=ids.map(()=>'?').join(',');
 const contacts=await query(`SELECT id,name,email FROM contacts WHERE id IN (${placeholders})`,ids);
 let created=0,skipped=[];
 for(const c of contacts){
  if(!c.email||!emailPattern.test(c.email)){skipped.push(c.name);continue}
  const body=String(req.body.body||mailTemplate(c.name)).replaceAll('{nombre}',c.name.split(' ')[0]);
  if(body.length>20000)return res.status(400).json({error:'Mensaje demasiado largo'});
  await query("INSERT INTO email_jobs (contact_id,recipient_name,recipient_email,subject,body,expires_at) VALUES (?,?,?,?,?,DATE_ADD(NOW(),INTERVAL 24 HOUR))",[c.id,c.name,c.email,subject,body]);created++;
 }
 res.json({created,skipped,expires_in_hours:24});
}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/email-jobs',auth,async(req,res)=>{try{res.json(await query('SELECT id,contact_id,recipient_name,recipient_email,subject,status,attempts,created_at,next_attempt_at,expires_at,sent_at,last_error FROM email_jobs ORDER BY id DESC LIMIT 500'))}catch(e){res.status(500).json({error:e.message})}});
app.post('/api/email-jobs/:id/cancel',auth,async(req,res)=>{try{await query("UPDATE email_jobs SET status='cancelled' WHERE id=? AND status IN ('queued','retry')",[req.params.id]);res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});
const backoffMinutes=n=>Math.min(120,Math.pow(2,Math.min(n,7)));
let workerBusy=false;
async function sendBrevo(job){
 const apiKey=process.env.BREVO_API_KEY;
 const senderEmail=process.env.BREVO_SENDER_EMAIL;
 if(!apiKey||!senderEmail)throw new Error('Configura BREVO_API_KEY y BREVO_SENDER_EMAIL');
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),20000);
 try{
  const response=await fetch('https://api.brevo.com/v3/smtp/email',{
   method:'POST',signal:controller.signal,
   headers:{'api-key':apiKey,'Content-Type':'application/json','accept':'application/json'},
   body:JSON.stringify({sender:{name:process.env.BREVO_SENDER_NAME||'Contacto profesional',email:senderEmail},to:[{email:job.recipient_email,name:job.recipient_name}],subject:job.subject,textContent:job.body})
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok){const e=new Error(`Brevo HTTP ${response.status}: ${result.message||'Error de envío'}`);e.permanent=[400,401,403,404,422].includes(response.status);throw e}
  return result.messageId||null;
 }finally{clearTimeout(timeout)}
}
async function processEmailQueue(){
 if(workerBusy)return;workerBusy=true;
 try{
  await query("UPDATE email_jobs SET status='expired',last_error='Plazo de 24 horas vencido' WHERE status IN ('queued','retry') AND expires_at<=NOW()");
  if(!process.env.BREVO_API_KEY||!process.env.BREVO_SENDER_EMAIL)return;
  const jobs=await query("SELECT * FROM email_jobs WHERE status IN ('queued','retry') AND next_attempt_at<=NOW() AND expires_at>NOW() ORDER BY id LIMIT 10");
  for(const job of jobs){
   const claim=await query("UPDATE email_jobs SET status='sending',attempts=attempts+1 WHERE id=? AND status IN ('queued','retry') AND expires_at>NOW()",[job.id]);
   if(!claim.affectedRows)continue;
   try{
    const messageId=await sendBrevo(job);
    await query("UPDATE email_jobs SET status='sent',sent_at=NOW(),brevo_message_id=?,last_error=NULL WHERE id=?",[messageId,job.id]);
    console.log(`Brevo accepted email job ${job.id}`);
   }catch(e){
    const permanent=Boolean(e.permanent);const delay=backoffMinutes(job.attempts+1);
    await query("UPDATE email_jobs SET status=CASE WHEN ? THEN 'failed' WHEN DATE_ADD(NOW(),INTERVAL ? MINUTE)>=expires_at THEN 'expired' ELSE 'retry' END,next_attempt_at=DATE_ADD(NOW(),INTERVAL ? MINUTE),last_error=? WHERE id=?",[permanent,delay,delay,String(e.message).slice(0,2000),job.id]);
    console.error(`Email job ${job.id}: ${e.message}`);
   }
  }
 }catch(e){console.error('Error worker Brevo:',e.message)}finally{workerBusy=false}
}
app.get('/api/health',async(req,res)=>{try{await query('SELECT 1 AS ok');res.json({ok:true,database:'connected'})}catch(e){res.status(503).json({ok:false,database:'disconnected',error:e.message})}});
// Las rutas API desconocidas y errores de Express responden siempre JSON.
app.use('/api',(_req,res)=>res.status(404).json({error:'Ruta API no encontrada'}));
app.use((err,_req,res,_next)=>{console.error('Error API:',err);res.status(err.status||500).json({error:err.status&&err.status<500?err.message:'Error interno de la API'})});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function start(){
  let i=0;
  while(true){
    i++;
    try{
      await query('SELECT 1');
      console.log('MariaDB conectada correctamente');
      await migrate();
      setInterval(processEmailQueue,15000);
      processEmailQueue();
      app.listen(3001,'0.0.0.0',()=>console.log('API on 3001'));
      return;
    }catch(e){
      console.error(`MariaDB no disponible (intento ${i}, reintentando): ${e.message}`);
      await sleep(Math.min(15000,3000+i*500));
    }
  }
}
start();
