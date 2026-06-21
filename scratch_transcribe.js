const fs = require('fs');
const OpenAI = require('openai');
require('dotenv').config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function main() {
  const filePath = 'd:\\Códigos\\Tzolkin\\Portifolio\\Haylander\\haylanderform\\WhatsApp Ptt 2026-06-17 at 14.35.54.ogg';
  const file = fs.createReadStream(filePath);
  const response = await openai.audio.transcriptions.create({
    file: file,
    model: 'whisper-1',
  });
  console.log(response.text);
}
main().catch(console.error);
