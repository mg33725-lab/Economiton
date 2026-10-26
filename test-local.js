require('dotenv').config();
const { parseExpenseFromText } = require('./src/services/gemini');
const { recordExpense, getMonthlyStatsFromCsv } = require('./src/services/sheets');

const ejemplos = [
  { persona: 'Juan', frase: 'gasté 33 mil pesos en el kiosco comprando alfajores' },
  { persona: 'Belén', frase: 'pagué 45 lucas de nafta en la YPF' },
  { persona: 'Juan', frase: 'compré remedios en farmacity por 12500' }
];

async function runLocalTest() {
  const isMock = process.argv.includes('--mock');
  console.log(`🧪 Iniciando prueba de procesamiento local ${isMock ? '(Modo Simulación MOCK)' : ''}...\n`);

  if (!isMock && !process.env.GEMINI_API_KEY) {
    console.error('❌ Falta configurar GEMINI_API_KEY en el archivo .env');
    console.log('👉 Conseguila gratis en: https://aistudio.google.com/app/apikey');
    console.log('💡 Tip: Podés probar el flujo sin API key ejecutando: node test-local.js --mock');
    process.exit(1);
  }

  for (const ej of ejemplos) {
    console.log(`--------------------------------------------------`);
    console.log(`👤 Remitente: ${ej.persona}`);
    console.log(`💬 Frase: "${ej.frase}"`);

    try {
      let parsed;
      if (isMock) {
        console.log('🧠 [Mock] Simulando extracción de IA...');
        if (ej.frase.includes('33 mil')) {
          parsed = { es_gasto: true, monto: 33000, comercio: 'Kiosco', detalle: 'Alfajores', categoria: 'Kiosco/Snacks' };
        } else if (ej.frase.includes('45 lucas')) {
          parsed = { es_gasto: true, monto: 45000, comercio: 'YPF', detalle: 'Carga de nafta', categoria: 'Transporte/Combustible' };
        } else {
          parsed = { es_gasto: true, monto: 12500, comercio: 'Farmacity', detalle: 'Remedios', categoria: 'Salud/Farmacia' };
        }
      } else {
        console.log('🧠 Analizando con Gemini...');
        parsed = await parseExpenseFromText(ej.frase);
      }
      console.log('📦 Resultado IA:', JSON.stringify(parsed, null, 2));

      if (parsed.es_gasto) {
        const { expenseData, stats, savedToSheets } = await recordExpense({
          persona: ej.persona,
          monto: parsed.monto,
          comercio: parsed.comercio,
          detalle: parsed.detalle,
          categoria: parsed.categoria,
          mensajeOriginal: ej.frase
        });

        console.log(`✅ Guardado con éxito: $${expenseData.monto} [${expenseData.categoria}]`);
        console.log(`📊 Total acumulado del mes: $${stats.totalMes}`);
        console.log(`   Desglose:`, stats.porPersona);
        console.log(`   ¿Sincronizado a Google Sheets?: ${savedToSheets ? 'Sí' : 'No (Guardado en CSV local)'}`);
      }
    } catch (err) {
      console.error('❌ Error al procesar:', err.message);
    }
  }

  console.log(`\n==================================================`);
  console.log('🎉 Prueba finalizada. Podés revisar el archivo gastos.csv en la raíz del proyecto.');
}

runLocalTest();
