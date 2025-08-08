const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const bodyParser = require('body-parser');
const forge = require('node-forge');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());

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

function getPrivateKeyBuffer() {
  const privateKeyPem = process.env.APPLE_PAYMENT_PROCESSING_KEY;
  if (!privateKeyPem) throw new Error('APPLE_PAYMENT_PROCESSING_KEY is not set');

  return getPrivateKeyBufferFromPem(privateKeyPem);
}

function getPrivateKeyBufferFromPkcs8Pem() {
  const privateKeyPem = process.env.APPLE_PAYMENT_PROCESSING_KEY;
  if (!privateKeyPem) throw new Error('APPLE_PAYMENT_PROCESSING_KEY is not set');

  // Створюємо KeyObject із PKCS#8 PEM
  const keyObject = crypto.createPrivateKey({
    key: privateKeyPem,
    format: 'pem',
    type: 'pkcs8',
  });

  // Експортуємо приватний ключ у DER SEC1 формат (чистий EC ключ)
  // Саме цей формат очікує crypto.ECDH.setPrivateKey
  const privateKeySec1Der = keyObject.export({
    format: 'der',
    type: 'sec1',
  });

  return privateKeySec1Der;
}

// HKDF на sha256
function hkdf(secret, salt, info, length) {
  return crypto.hkdfSync('sha256', secret, salt, info, length);
}

function decryptApplePayToken(paymentData) {
  const privateKeyBuffer = getPrivateKeyBufferFromPkcs8Pem();

  const ephemeralPublicKeyBytes = Buffer.from(paymentData.header.ephemeralPublicKey, 'base64');

  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(privateKeyBuffer);

  const sharedSecret = ecdh.computeSecret(ephemeralPublicKeyBytes);

  const symmetricKey = hkdf(
    sharedSecret,
    Buffer.from(paymentData.header.publicKeyHash, 'base64'),
    Buffer.from('Apple', 'utf8'),
    32
  );

  const dataBuffer = Buffer.from(paymentData.data, 'base64');
  const iv = dataBuffer.slice(0, 16);
  const cipherText = dataBuffer.slice(16, dataBuffer.length - 16);
  const authTag = dataBuffer.slice(dataBuffer.length - 16);

  const decipher = crypto.createDecipheriv('aes-256-gcm', symmetricKey, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(cipherText), decipher.final()]);

  return JSON.parse(decrypted.toString('utf8'));
}


app.post('/authorize', (req, res) => {
  try {
    const { token } = req.body;
    if (!token || !token.paymentData) {
      return res.status(400).json({ error: 'Missing paymentData in token' });
    }

    const decrypted = decryptApplePayToken(token.paymentData);
    console.log('Decrypted Apple Pay data:', decrypted);

    res.json({ message: 'Token decrypted', decrypted });
  } catch (err) {
    console.error('Error decrypting token:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
