const axios = require('axios');

const WHATSAPP_API_VERSION = 'v21.0';

/**
 * Descarga el archivo de audio enviado por WhatsApp a través de la API de Meta.
 * @param {string} mediaId ID del archivo multimedia en WhatsApp
 * @returns {Promise<{buffer: Buffer, mimeType: string}>}
 */
async function downloadWhatsAppMedia(mediaId) {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) {
    throw new Error('WHATSAPP_TOKEN no está configurado en .env');
  }

  // 1. Obtener la URL temporal del medio
  const mediaInfoUrl = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${mediaId}`;
  const mediaInfoResponse = await axios.get(mediaInfoUrl, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const downloadUrl = mediaInfoResponse.data.url;
  const mimeType = mediaInfoResponse.data.mime_type || 'audio/ogg';

  // 2. Descargar el archivo binario
  // Nota: Meta requiere enviar el header User-Agent y el Authorization Bearer
  const downloadResponse = await axios.get(downloadUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'Economitin-Expense-Bot/1.0'
    },
    responseType: 'arraybuffer'
  });

  return {
    buffer: Buffer.from(downloadResponse.data),
    mimeType: mimeType.split(';')[0] // 'audio/ogg'
  };
}

/**
 * Envía un mensaje de texto de respuesta a un número de WhatsApp.
 * @param {string} to Número de teléfono destinatario en formato internacional (ej: '54911xxxxxxxx')
 * @param {string} text Contenido del mensaje de texto
 */
async function sendWhatsAppMessage(to, text) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    console.warn('⚠️ No se pudo enviar WhatsApp: WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID no configurados.');
    return null;
  }

  const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to,
    type: 'text',
    text: {
      preview_url: false,
      body: text
    }
  };

  try {
    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error al enviar mensaje por WhatsApp:', error.response?.data || error.message);
    throw error;
  }
}

module.exports = {
  downloadWhatsAppMedia,
  sendWhatsAppMessage
};
