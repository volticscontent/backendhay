require('dotenv').config();
const { getUser } = require('./dist/ai/server-tools');

async function check() {
    const userData = await getUser('553182354127');
    console.log('getUser returned:', userData);
    console.log('parsed user:', JSON.parse(userData));
}

check();
