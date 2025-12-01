// Stage 2: Chunking raw text into smaller RAG chunks

import fs from "fs";
import path from "path";
import crypto from "crypto";   // REQUIRED
import { fileURLToPath } from "url";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// INPUT → stage1 output
const rawDocsPath = path.join(__dirname, "../stage1_text/raw_docs.json");

// OUTPUT → stage2 output
const outputPath = path.join(__dirname, "chunks.json");

console.log("Loading raw_docs.json...");

// ------------------------------------------------------
// Load raw documents
// ------------------------------------------------------
const raw = fs.readFileSync(rawDocsPath, "utf8");
const docs = JSON.parse(raw);

console.log(`Loaded ${docs.length} raw documents.`);

// ------------------------------------------------------
// Chunking Setup
// ------------------------------------------------------
const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1200,
  chunkOverlap: 200,
});

// ------------------------------------------------------
// Generate chunks with CLEAN filename and UNIQUE chunk id
// ------------------------------------------------------
let allChunks = [];

for (const doc of docs) {

  // 1. Normalize filename
  const rawName =
    doc.name ||
    doc.filename ||
    doc.file ||
    "unknown";

  const cleanName = rawName.toString().split(/[\\/]/).pop();

  // 2. Normalize text
  const cleanText = typeof doc.text === "string" ? doc.text : "";
  if (!cleanText.trim()) continue;

  // 3. Split text
  const chunks = await splitter.splitText(cleanText);

  // 4. Push chunks with UNIQUE ID using SHA-1 hash
  chunks.forEach((c, idx) => {
    const uniqueID = crypto
      .createHash("sha1")
      .update(cleanName + idx + c.slice(0, 40))
      .digest("hex");

    allChunks.push({
      id: uniqueID,        // SUPER UNIQUE
      source: cleanName,   // correct filename
      chunk_id: idx,
      content: c,
    });
  });
}

console.log(`Created ${allChunks.length} chunks.`);

// ------------------------------------------------------
// Save chunks.json
// ------------------------------------------------------
fs.writeFileSync(outputPath, JSON.stringify(allChunks, null, 2));

console.log("Chunking complete. Saved to chunks.json.");
