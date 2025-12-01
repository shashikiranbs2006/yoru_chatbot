/**
 * Stage 3: Generate embeddings using Gemini (text-embedding-004)
 * -------------------------------------------------------------
 * This script:
 * 1. Loads chunks generated in Stage 2
 * 2. Uses Gemini to embed every chunk
 * 3. Attaches metadata (pdf_url, module, etc.)
 * 4. Saves final embeddings.json for Stage 4 upload
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { fileURLToPath } from "url";

dotenv.config();

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embedder = genAI.getGenerativeModel({ model: "text-embedding-004" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Input from Stage 2
const chunksPath = path.join(__dirname, "../stage2_chunks/chunks.json");

// Output file for embeddings
const outputPath = path.join(__dirname, "embeddings.json");

// Load chunks
console.log("Loading chunks...");
const chunks = JSON.parse(fs.readFileSync(chunksPath, "utf8"));
console.log(`Loaded ${chunks.length} chunks.`);
console.log("Generating embeddings with Gemini...\n");

// Final output list
let finalData = [];

for (let i = 0; i < chunks.length; i++) {
  const c = chunks[i];

  // Generate 768-d DIM embedding from Gemini
  const result = await embedder.embedContent(c.content);
  const vector = result.embedding.values;

  // IMPORTANT: Provide SAFE metadata (no null values allowed by Chroma)
  finalData.push({
    id: `${c.source}_${c.chunk_id}`,      // unique id per chunk
    text: c.content,                      // chunk text
    source: c.source,                     // filename
    pdf: c.source,                        // pdf name for clarity
    pdf_url: `/pdf/${c.source}`,          // link for frontend
    module: c.module ? String(c.module) : "",  // must always be string
    embedding: vector                     // Gemini embedding array
  });

  if (i % 50 === 0) console.log(`Progress: ${i}/${chunks.length}`);
}

// Save embeddings
fs.writeFileSync(outputPath, JSON.stringify(finalData, null, 2));
console.log("\nStage 3 complete. Saved to embeddings.json.");
