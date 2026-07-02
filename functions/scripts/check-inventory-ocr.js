#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

async function main() {
  const imagePath = process.argv[2];
  const expectedRows = Number(process.argv[3] || process.env.OCR_EXPECT_ROWS || 7);
  const expectedTotal = Number(process.argv[4] || process.env.OCR_EXPECT_TOTAL || 17110128);
  const key = process.env.CHATBOT_OCR_TEST_KEY;
  const projectId = process.env.FIREBASE_PROJECT_ID || "skyearth-84a78";
  const endpoint = process.env.CHATBOT_OCR_ENDPOINT
    || `https://asia-northeast3-${projectId}.cloudfunctions.net/chatbotInventoryUpload`;

  if (!imagePath) {
    throw new Error("Usage: npm run test:ocr -- <imagePath> [expectedRows] [expectedTotal]");
  }
  if (!key) {
    throw new Error("CHATBOT_OCR_TEST_KEY is required.");
  }

  const absolutePath = path.resolve(imagePath);
  const imageData = `data:image/jpeg;base64,${fs.readFileSync(absolutePath).toString("base64")}`;
  const url = `${endpoint}?key=${encodeURIComponent(key)}&mode=inventory`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "ocr", key, mode: "inventory", imageData }),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.message || `OCR request failed with ${response.status}`);
  }

  const rows = Array.isArray(data.rows) ? data.rows : [];
  const total = rows.reduce((sum, row) => sum + Number(row.totalPrice || 0), 0);
  const documentTotal = Number(data.totalCheck?.documentTotal || 0);

  console.log(`rows=${rows.length}`);
  console.log(`parsedTotal=${Math.round(total)}`);
  console.log(`documentTotal=${documentTotal || "-"}`);

  if (rows.length !== expectedRows) {
    throw new Error(`Expected ${expectedRows} rows, got ${rows.length}.`);
  }
  if (Math.abs(total - expectedTotal) > 10) {
    throw new Error(`Expected parsed total ${expectedTotal}, got ${total}.`);
  }
  if (documentTotal && Math.abs(documentTotal - expectedTotal) > 10) {
    throw new Error(`Expected document total ${expectedTotal}, got ${documentTotal}.`);
  }

  console.log("OCR fixture passed.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
