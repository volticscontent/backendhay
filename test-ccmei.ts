import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '.env') });

import { consultarServico } from './src/lib/serpro';

const CNPJ = '45175209000124';

async function test() {
    try {
        const result = await consultarServico('CCMEI_DADOS', CNPJ);
        console.log(JSON.stringify(result, null, 2));
    } catch (e) {
        console.error(e);
    }
}

test();
