// Stage 2: Chunking raw text into smaller RAG chunks

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// INPUT → stage1 output
const rawDocsPath = path.join(__dirname, "../stage1_text/raw_docs_new.json");

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
  chunkSize: 1200,       // adjust later if needed
  chunkOverlap: 200,
});

// ------------------------------------------------------
// Generate chunks with filename + text normalization
// ------------------------------------------------------
let allChunks = [];

for (const doc of docs) {

  // --------------------------------------------
  // FIX 1: Normalize filename
  // --------------------------------------------
  const rawName =
    doc.name ||          // old dataset
    doc.filename ||      // new dataset
    doc.file ||          // fallback
    "unknown";

  // Remove folder paths, keep clean filename only
  const cleanName = rawName.toString().split(/[\\/]/).pop();

  // --------------------------------------------
  // FIX 2: Normalize text
  // --------------------------------------------
  const cleanText = typeof doc.text === "string" ? doc.text : "";

  if (cleanText.trim().length === 0) continue;

  // --------------------------------------------
  // Split into chunks
  // --------------------------------------------
  const chunks = await splitter.splitText(cleanText);

  chunks.forEach((c, idx) => {
    allChunks.push({
      source: cleanName,   // consistent filename for future stages
      chunk_id: idx,
      content: c
    });
  });
}

console.log(`Created ${allChunks.length} chunks.`);

// ------------------------------------------------------
// Save chunks.json
// ------------------------------------------------------
fs.writeFileSync(outputPath, JSON.stringify(allChunks, null, 2));

console.log("Chunking complete. Saved to chunks.json.");
