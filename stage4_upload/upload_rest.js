import fs from "fs";
import path from "path";
import { ChromaClient } from "chromadb";

const client = new ChromaClient({
  path: "http://localhost:8000"   // API v2 endpoint
});

async function main() {
  console.log("Loading chunks.json + embeddings.json...");

  const chunksPath = path.join("stage2_chunks", "chunks.json");
  const embeddingsPath = path.join("stage3_embeddings2", "embeddings.json");

  const chunks = JSON.parse(fs.readFileSync(chunksPath, "utf8"));
  const embeddingsRaw = JSON.parse(fs.readFileSync(embeddingsPath, "utf8"));

  if (chunks.length !== embeddingsRaw.length) {
    console.error("ERROR: chunks and embeddings length mismatch");
    console.error("chunks:", chunks.length, "embeddings:", embeddingsRaw.length);
    return;
  }

  // Convert:
  // { id:"...", embedding:[..] } → [..]
  const embeddings = embeddingsRaw.map(e => e.embedding);

  console.log("Loaded", chunks.length, "items.");

  console.log("Connecting to Chroma (API v2)...");
  const collection = await client.getOrCreateCollection({
    name: "rag_academic_docs",
    metadata: { description: "Academic notes RAG" }
  });

  console.log("Uploading in batches...");

  const BATCH_SIZE = 300;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batchChunks = chunks.slice(i, i + BATCH_SIZE);
    const batchEmbeddings = embeddings.slice(i, i + BATCH_SIZE);

    const ids = batchChunks.map((c, idx) => `doc_${i + idx}`);
    const docs = batchChunks.map(c => c.content || "");
    const metas = batchChunks.map(c => ({
      source: c.source,
      chunk_id: c.chunk_id,
      doc_index: c.doc_index
    }));

    await collection.add({
      ids,
      embeddings: batchEmbeddings,
      documents: docs,
      metadatas: metas
    });

    console.log(`Uploaded ${i + batchChunks.length} / ${chunks.length}`);
  }

  console.log("UPLOAD COMPLETE (V2 FORMAT).");
}

main().catch(err => {
  console.error("Upload error:", err);
});
