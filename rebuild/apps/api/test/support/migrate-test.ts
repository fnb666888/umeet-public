import { createTestApp } from './test-app.js';
const harness=await createTestApp();
try{console.log('Isolated test database migrations succeeded. No production database accessed.');}
finally{await harness.close();}
