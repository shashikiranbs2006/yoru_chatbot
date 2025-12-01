/**
 * Stage 4: Upload embeddings + metadata to ChromaDB
 * -------------------------------------------------------------
 * This script:
 * 1. Loads Stage 3 embeddings
 * 2. Connects to Chroma running in Docker
 * 3. Uploads all embeddings in batches
 * 4. Ensures full metadata (pdf_url, module) is stored
 */

import fs from "fs";
import path from "path";
import { ChromaClient } from "chromadb";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load chunk count (for validation only)
console.log("Loading chunks and embeddings...");

const chunks = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../stage2_chunks/chunks.json"))
);

// Load Gemini embeddings (with metadata)
const embeddings = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../stage3_embeddings2/embeddings.json"))
);

// Validate chunk count = embedding count
if (chunks.length !== embeddings.length) {
  console.error("Error: chunks count != embeddings count");
  process.exit(1);
}

console.log(`Loaded ${embeddings.length} items.`);

// ---------------------------------------------------------
// Connect to Chroma running in Docker
// ---------------------------------------------------------
console.log("Connecting to Chroma server...");

const client = new ChromaClient({
  path: "http://localhost:8000"   // Docker Chroma URL
});

// Collection name
const COLLECTION = "rag_academic_docs";

console.log("Creating/Loading collection:", COLLECTION);

// Ensure collection exists (no embedding function because we provide our own vectors)
const collection = await client.getOrCreateCollection({
  name: COLLECTION,
  embeddingFunction: null
});

console.log("Collection ready. Uploading...\n");

// ---------------------------------------------------------
// Upload in batches (avoid huge payload errors)
// ---------------------------------------------------------
const BATCH_SIZE = 300;

for (let i = 0; i < embeddings.length; i += BATCH_SIZE) {
  const batch = embeddings.slice(i, i + BATCH_SIZE);

  // Prepare arrays for Chroma API
  const ids = batch.map(b => b.id);
  const texts = batch.map(b => b.text);

  // IMPORTANT: Upload full metadata — no null values allowed
  const metas = batch.map(b => ({
    source: b.source,
    pdf: b.pdf,
    pdf_url: b.pdf_url,
    module: b.module ?? "" // ensure always string
  }));

  const vectors = batch.map(b => b.embedding);

  console.log(`Uploading batch ${i} → ${i + batch.length}`);

  await collection.add({
    ids,
    documents: texts,
    metadatas: metas,
    embeddings: vectors
  });
}

console.log("\nUpload complete!");
