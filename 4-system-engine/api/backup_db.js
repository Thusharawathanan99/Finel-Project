// Local private snapshot before additive migration. Contains sensitive records;
// never upload or commit the output. It contains no connection credentials.
import pool from './db.js';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const directory=resolve(dirname(fileURLToPath(import.meta.url)),'../../.local-backups');
const id=value=>{if(!/^[A-Za-z0-9_]+$/.test(value))throw Error('Unsupported table identifier');return '`'+value+'`';};
try {
  await mkdir(directory,{recursive:true});
  const c=await pool.getConnection();
  try {
    await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await c.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
    const [tables]=await c.query('SHOW TABLES');const data={createdAt:new Date().toISOString(),tables:{}};
    for(const row of tables){const name=Object.values(row)[0];const [ddl]=await c.query('SHOW CREATE TABLE '+id(name));const [records]=await c.query('SELECT * FROM '+id(name));data.tables[name]={ddl:ddl[0]['Create Table'],rows:records};}
    const file=resolve(directory,'careconnect-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
    await writeFile(file,JSON.stringify(data),{flag:'wx',mode:0o600});await c.commit();
    console.log(JSON.stringify({backup:file,tables:Object.keys(data.tables).length,records:Object.values(data.tables).reduce((n,t)=>n+t.rows.length,0)}));
  }catch(error){await c.rollback().catch(()=>{});throw error;}finally{c.release();}
}catch(error){console.error('Backup failed:',error.code||error.message);process.exitCode=1;}finally{await pool.end();}
