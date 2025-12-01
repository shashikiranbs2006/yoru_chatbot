import express from "express";
import fetch from "node-fetch";
import { ChromaClient } from "chromadb";

const router = express.Router();

// Chroma server
const chroma = new ChromaClient({
  host: "http://localhost",
  port: 8000
});

// Convert text -> embedding
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

// MAIN route
router.get("/", async (req, res) => {
  const question = req.query.q;

  if (!question) return res.status(400).json({ error: "Query ?q= missing" });

  try {
    const userEmbedding = await embed(question);

    const collection = await chroma.getOrCreateCollection({
      name: "rag_academic_docs"
    });

    const results = await collection.query({
      queryEmbeddings: [userEmbedding],
      nResults: 1
    });

    const bestSource = results.metadatas[0][0].source;

    res.json({
      success: true,
      file: bestSource
    });

  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: "Query failed" });
  }
});

export default router;
