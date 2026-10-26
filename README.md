# 🪙 Economitin - Bot de WhatsApp para Control de Gastos Familiares

Bot inteligente de WhatsApp que procesa **mensajes de voz (audios)** y **mensajes de texto** con Inteligencia Artificial (Google Gemini), registrando automáticamente los gastos familiares con fecha, comercio, categoría, monto y responsable.

---

## 🚀 Características

- 🎙️ **Reconocimiento de notas de voz:** Decí simplemente *"Gasté 33 mil pesos en el kiosco"* o *"45 lucas de nafta en la YPF"*.
- 🧠 **IA Multimodal (Google Gemini):** Extrae automáticamente el monto exacto (convierte modismos como "lucas", "mil", "k"), comercio, descripción y categoría.
- 👥 **Multi-usuario:** Detecta quién de los dos mandó el mensaje (vos o tu mujer).
- 📊 **Resumen mensual automático:** Si preguntás *"¿Cuánto gastamos en el mes?"*, te devuelve el total acumulado y el detalle por persona.
- 📁 **Almacenamiento dual:**
  - Guarda de inmediato en un archivo local `gastos.csv` (compatible directo con Excel).
  - Sincroniza en tiempo real con **Google Sheets** si se configuran las credenciales.

---

## 📋 Requisitos Previos

- [Node.js](https://nodejs.org/) (versión 18 o superior).

---

## 🛠️ Guía Rápida de Configuración (Paso a Paso)

### 1. Obtener la API Key de Google Gemini (Gratis - 30 segundos)
1. Entrá a [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Iniciá sesión con tu cuenta de Google y hacé clic en **"Create API key"**.
3. Copiá la clave y pegala en tu archivo `.env` en la variable:
   ```env
   GEMINI_API_KEY=tu_clave_aqui
   ```

### 2. Probar el sistema localmente (sin WhatsApp todavía)
Podés verificar que la IA y el registro de gastos funcionan perfectamente ejecutando:
```bash
npm run test:local
```
Esto procesará tres ejemplos y creará tu archivo `gastos.csv`.

---

### 3. Configurar WhatsApp Cloud API en Meta for Developers

1. Entrá a [Meta for Developers](https://developers.facebook.com/) e iniciá sesión con tu cuenta de Facebook.
2. Hacé clic en **"Mis Apps"** (My Apps) > **"Crear App"** (Create App).
3. Seleccioná el tipo **"Otro"** (Other) > **"Negocio"** (Business).
4. Dale un nombre a la app (ej: *Economitin*) y completá la creación.
5. En el panel de productos, buscá **WhatsApp** y hacé clic en **"Configurar"** (Set up).
6. En el menú lateral izquierdo, andá a **WhatsApp > Configuración de la API (API Setup)**:
   - Verás un **"Número de teléfono de prueba"** asignado por Meta.
   - En la sección **"Para"** (To), agregá tu número de teléfono y el de tu mujer (te enviará un código de verificación por WhatsApp de 6 dígitos).
   - Copiá el **Token de acceso temporal** y pegalo en `.env` en `WHATSAPP_TOKEN`.
   - Copiá el **Identificador de número de teléfono** (Phone Number ID) y pegalo en `WHATSAPP_PHONE_NUMBER_ID`.

---

### 4. Iniciar el Servidor y conectar el Webhook

1. Iniciá el servidor local:
   ```bash
   npm start
   ```
2. Para que Meta pueda comunicarse con tu servidor local, exponé el puerto 3000 a internet (por ejemplo con `cloudflared` o `ngrok`):
   ```bash
   # Opción con npx (no requiere instalar nada)
   npx localtunnel --port 3000
   ```
   O usando ngrok:
   ```bash
   ngrok http 3000
   ```
   Obtendrás una URL HTTPS pública (ej: `https://tu-url.loca.lt` o `https://tu-url.ngrok-free.app`).

3. En el panel de Meta, andá a **WhatsApp > Configuración (Configuration)**:
   - En la sección **Webhook**, hacé clic en **Editar**.
   - **URL de devolución de llamada:** `https://tu-url-publica/webhook`
   - **Identificador de verificación:** El mismo que pusiste en `.env` (por defecto: `economitin_token_secreto_2026`).
   - Hacé clic en **Verificar y guardar**.
   - En los campos del webhook, suscribite a **`messages`**.

---

### 5. ¡A probar mandando audios!

1. Abrí WhatsApp en tu celular y mandale un mensaje o audio al número de prueba de Meta:
   - *"Gasté 33 mil pesos en el kiosco"*
   - O una nota de voz diciendo lo mismo.
2. El bot te responderá automáticamente confirmando el gasto y mostrándote el total del mes acumulado.
