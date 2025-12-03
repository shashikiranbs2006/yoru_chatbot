import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { ChromaClient } from "chromadb";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

// ---------------------------------------------------------
// PATHS + FILE INDEX
// ---------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let fileIndex = {};
try {
  fileIndex = JSON.parse(
    fs.readFileSync(path.join(__dirname, "file_index.json"), "utf8")
  );
  console.log("file_index.json loaded.");
} catch {
  console.log("file_index.json not found.");
}

// ---------------------------------------------------------
// EXPRESS
// ---------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());

// ---------------------------------------------------------
// CHROMA v2 CLIENT
// ---------------------------------------------------------
const chroma = new ChromaClient({
  path: "http://localhost:8000"
});

const COLLECTION = "rag_academic_docs";

// ---------------------------------------------------------
// GEMINI
// ---------------------------------------------------------
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const llm = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
const embedder = genAI.getGenerativeModel({ model: "text-embedding-004" });

async function embedQuery(text) {
  const r = await embedder.embedContent(text);
  return r.embedding.values;
}

function cleanContext(text) {
  return text
    .replace(/[^\x20-\x7E\n]/g, "")
    .replace(/\n+/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

async function runLLM(question, context) {
  const prompt = `
Use ONLY this context to answer.  
If answer not present, respond: "Not in notes."

CONTEXT:
${context}

QUESTION:
${question}

ANSWER:
`;

  const r = await llm.generateContent(prompt);
  return r.response.text();
}

// ---------------------------------------------------------
// CHAT ENDPOINT (v2 QUERY)
// ---------------------------------------------------------
app.post("/chat", async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) {
      return res.status(400).json({ error: "Question missing" });
    }

    console.log("QUESTION:", question);

    // Embed query
    const qEmbedding = await embedQuery(question);

    // Load collection (v2)
    const collection = await chroma.getCollection({ name: COLLECTION });

    // Query
    const results = await collection.query({
      queryEmbeddings: [qEmbedding],
      nResults: 5,
      include: ["documents", "metadatas"]
    });

    const docs = results.documents?.[0] || [];
    const metas = results.metadatas?.[0] || [];

    const context = cleanContext(docs.join("\n"));
    const answer = await runLLM(question, context);

    // File source
    let sourceLabel = null;
    let sourceLink = null;

    if (metas[0]?.source) {
      const fname = metas[0].source;

      sourceLabel = fname.replace(/\.pdf$/i, "");

      const match = Object.keys(fileIndex).find(k =>
        k.toLowerCase().includes(fname.toLowerCase())
      );

      if (match) {
        sourceLink = fileIndex[match];
      }
    }

    return res.json({
      question,
      answer,
      source_label: sourceLabel,
      source_link: sourceLink
    });

  } catch (err) {
    console.error("CHAT ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
app.listen(4000, () => {
  console.log("Chatbot running at http://localhost:4000");
});
