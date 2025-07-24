const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  const start = Date.now();

  const originalSend = res.send;

  res.send = function (body) {
    const duration = Date.now() - start;
    console.log(` ${req.method} ${req.originalUrl}`);
    console.log(` Status: ${res.statusCode} (${duration}ms)`);
    console.log(` Response Body:`, typeof body === 'string' ? body : JSON.stringify(body, null, 2));
    return originalSend.call(this, body);
  };

  next();
});


app.use(express.static(path.join(__dirname, 'public')));

const P12_PATH = path.join(__dirname, 'merchant_cert.p12');

function writeCertFromEnv() {
  const base64 = process.env.APPLE_MERCHANT_CERT_P12_BASE64;
  if (!base64) {
    console.error('APPLE_MERCHANT_CERT_P12_BASE64 is not set');
    process.exit(1);
  }
  const buffer = Buffer.from(base64, 'base64');
  fs.writeFileSync(P12_PATH, buffer);
  console.log('.p12 certificate written to disk');
}

writeCertFromEnv();

app.post('/validate-merchant', async (req, res) => {
  const { validationUrl } = req.body;

  if (!validationUrl) {
    return res.status(400).json({ error: 'Missing validationUrl' });
  }

  try {
    const sessionResponse = await fetch(validationUrl, {
      method: 'POST',
      body: JSON.stringify({
        merchantIdentifier: 'merchant.com.applemerchantvalidatortest',
        displayName: 'My Test Store',
        initiative: 'web',
        initiativeContext: 'applemerchantvalidatortest.onrender.com',
      }),
      agent: new https.Agent({
        pfx: fs.readFileSync(P12_PATH),
        passphrase: '1234', 
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const sessionJSON = await sessionResponse.json();
    return res.status(200).json(sessionJSON);
  } catch (err) {
    console.error('Error validating merchant:', err);
    return res.status(500).json({ error: 'Merchant validation failed' });
  }
});

app.use(express.json());

app.post('/authorize', (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'Missing token' });
  }

  console.log('Received Apple Pay token:');
  console.dir(token, { depth: null });


  const paymentData = token.paymentData;

  if (!paymentData) {
    return res.status(400).json({ error: 'Missing paymentData' });
  }

  const jsonString = JSON.stringify(paymentData);
  const base64Encoded = Buffer.from(jsonString).toString('base64');

  console.log('Base64 Payload to Send:', base64Encoded);

  return res.status(200).json({ message: 'Token processed and logged', payload: base64Encoded });
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
