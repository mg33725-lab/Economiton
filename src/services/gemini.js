require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

function getGenAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY no está configurada en .env');
  }
  return new GoogleGenAI({ apiKey });
}

const CANDIDATE_MODELS = ['gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.1-flash-lite'];

const SYSTEM_PROMPT = `
Eres un asistente contable y financiero personal inteligente especializado en Argentina/Latinoamérica.
Tu objetivo es analizar un mensaje (que puede ser una transcripción de voz o texto escrito) y extraer los datos de un gasto para anotarlo en un presupuesto familiar.

Ten en cuenta modismos y expresiones comunes:
- "33 mil", "33 lucas", "33k" -> monto: 33000
- "cien pesos" -> monto: 100
- "dos mil quinientos" -> monto: 2500
- "medio palo" -> monto: 500000

Debes responder ÚNICAMENTE con un objeto JSON válido con la siguiente estructura:
{
  "es_gasto": true | false,
  "monto": number (ej: 33000, sin puntos ni signos, solo número entero o decimal si corresponde),
  "comercio": string (ej: "Kiosco", "Coto", "Farmacity", "YPF", o "Desconocido" si no se menciona),
  "detalle": string (descripción breve del gasto, ej: "Alfajor y gaseosa", "Carga de combustible", "Remedio"),
  "categoria": string (una de las siguientes categorías estándar: "Comida/Supermercado", "Kiosco/Snacks", "Transporte/Combustible", "Servicios/Impuestos", "Salud/Farmacia", "Salidas/Ocio", "Ropa/Calzado", "Hogar/Mantenimiento", "Otros"),
  "observacion": string (si falta algún dato clave o si no parece un gasto)
}

Si el usuario dice algo que NO es un gasto (ej: "Hola bot", "¿Cuánto gastamos?", "Buenas tardes"), responde con "es_gasto": false y en observacion explica brevemente.
NO agregues texto fuera del JSON.
`;

function cleanJsonText(rawText) {
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json/, '').replace(/```$/, '').trim();
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```/, '').replace(/```$/, '').trim();
  }
  return cleaned;
}

async function generateWithFallback(contents) {
  const ai = getGenAI();
  let lastError = null;

  for (const model of CANDIDATE_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          responseMimeType: 'application/json'
        }
      });
      return response.text;
    } catch (err) {
      console.warn(`⚠️ Modelo ${model} falló (${err.status || err.message}). Probando alternativo...`);
      lastError = err;
    }
  }

  throw lastError || new Error('No se pudo generar respuesta con ningún modelo de Gemini.');
}

/**
 * Analiza un mensaje de texto para extraer los datos del gasto.
 */
async function parseExpenseFromText(text) {
  const prompt = `${SYSTEM_PROMPT}\n\nMensaje a analizar: "${text}"`;
  const rawResponse = await generateWithFallback(prompt);
  const jsonText = cleanJsonText(rawResponse);
  
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    console.error('Error al parsear respuesta JSON de Gemini:', jsonText);
    throw new Error('Respuesta no válida del modelo de IA');
  }
}

/**
 * Analiza un audio (nota de voz de WhatsApp) para extraer los datos del gasto.
 */
async function parseExpenseFromAudio(audioBuffer, mimeType = 'audio/ogg') {
  const contents = [
    {
      inlineData: {
        data: audioBuffer.toString('base64'),
        mimeType: mimeType || 'audio/ogg'
      }
    },
    `${SYSTEM_PROMPT}\n\nEscucha atentamente este audio de WhatsApp y extrae los datos del gasto según las instrucciones.`
  ];

  const rawResponse = await generateWithFallback(contents);
  const jsonText = cleanJsonText(rawResponse);

  try {
    return JSON.parse(jsonText);
  } catch (error) {
    console.error('Error al parsear respuesta JSON de Gemini para audio:', jsonText);
    throw new Error('Respuesta no válida del modelo de IA para el audio');
  }
}

module.exports = {
  parseExpenseFromText,
  parseExpenseFromAudio
};
