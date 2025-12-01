// DOCUMENT RETRIEVAL SYSTEM
// Input question → Embed → Search Chroma → Find source file → Return exact file

import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import { ChromaClient } from "chromadb";

// ---- CONFIG ----
const CHROMA_URL = "http://localhost:8000";
const COLLECTION = "rag_academic_docs";
const ORIGINAL_DIR = "./downloaded_files";

// ---- 1. Generate embedding for query ----
async function embed(text) {
  const res = await fetch("http://localhost:11434/api/embed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "nomic-embed-text",
      input: text
    })
  });

  const data = await res.json();
  return data.embeddings[0];
}

// ---- 2. Query chroma → get top match ----
async function findMatchingFile(query) {
  const client = new ChromaClient({ path: CHROMA_URL });
  const collection = await client.getCollection({ name: COLLECTION });

  const queryEmb = await embed(query);

  const result = await collection.query({
    queryEmbeddings: [queryEmb],
    nResults: 1
  });

  const metadata = result.metadatas[0][0];
  return metadata.source; // filename stored in metadata
}

// ---- 3. Return original file ----
function returnFile(filename) {
  const filePath = path.join(ORIGINAL_DIR, filename);

  if (!fs.existsSync(filePath)) {
    console.log("ERROR: File not found:", filePath);
    return;
  }

  const outputPath = "./RETURNED_" + filename;
  fs.copyFileSync(filePath, outputPath);

  console.log("\nDocument retrieved successfully!");
  console.log("Saved as:", outputPath);
}

// ---- MAIN ----
async function run() {
  const query = process.argv.slice(2).join(" ");
  if (!query) {
    console.log("Usage: node retrieve_document.js \"sfh module 2 notes\"");
    return;
  }

  console.log("Searching for best matching document...");
  const file = await findMatchingFile(query);

  console.log("Best match:", file);
  returnFile(file);
}

run();
