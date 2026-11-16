import {createConnection} from 'mysql2/promise';
import {connectDatabase} from '../apps/api/src/database/connection.js';
import {migrate} from '../apps/api/src/database/migrate.js';
import {CommunitiesService} from '../apps/api/src/modules/communities/communities.service.js';
const admin=await createConnection({host:'127.0.0.1',port:19316,user:'root'});
try{await admin.query('CREATE DATABASE IF NOT EXISTS umeet_rebuild_local CHARACTER SET utf8mb4');}finally{await admin.end();}
const db=connectDatabase('mysql://root@127.0.0.1:19316/umeet_rebuild_local');
try{await migrate(db);await new CommunitiesService(db).seedDefaults();console.log('Local development database ready; production untouched.');}finally{await db.destroy();}
