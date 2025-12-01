// Stage 3: Generate embeddings using Gemini

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { fileURLToPath } from "url";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embedder = genAI.getGenerativeModel({ model: "text-embedding-004" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const chunksPath = path.join(__dirname, "../stage2_chunks/chunks.json");
const outputPath = path.join(__dirname, "embeddings.json");

console.log("Loading chunks...");
const chunks = JSON.parse(fs.readFileSync(chunksPath, "utf8"));
console.log(`Loaded ${chunks.length} chunks.`);
console.log("Generating embeddings with Gemini...");

// Retry wrapper
async function generateEmbeddingWithRetry(text, retries = 5) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await embedder.embedContent(text);
      return result.embedding.values;
    } catch (err) {
      console.log(`Embedding failed (Attempt ${attempt}/5): ${err.statusText}`);

      if (attempt === retries) throw err;

      // wait 2 seconds before retry
      await new Promise(res => setTimeout(res, 2000));
    }
  }
}

let finalData = [];

for (let i = 0; i < chunks.length; i++) {
  const c = chunks[i];

  // Generate with retry
  const vector = await generateEmbeddingWithRetry(c.content);

  finalData.push({
    id: c.id,
    text: c.content,
    source: c.source,
    pdf: c.source,
    pdf_url: `/pdf/${c.source}`,
    module: "",
    embedding: vector
  });

  if (i % 50 === 0) {
    console.log(`Progress: ${i}/${chunks.length}`);
  }
}

fs.writeFileSync(outputPath, JSON.stringify(finalData, null, 2));
console.log("Stage 3 complete. Saved to embeddings.json.");
