"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const db_1 = __importDefault(require("../lib/db"));
const fs_1 = require("fs");
const path_1 = require("path");
async function migrate() {
    const sql = (0, fs_1.readFileSync)((0, path_1.join)(__dirname, '../../../src/lib/db/migrations/011_integra_contador.sql'), 'utf8');
    await db_1.default.query(sql);
    console.log('Migration 011_integra_contador: OK');
    await db_1.default.end();
}
migrate().catch((e) => { console.error(e); process.exit(1); });
//# sourceMappingURL=migrate-integra-contador.js.map