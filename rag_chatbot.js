import express from "express";
import cors from "cors";
import { ChromaClient } from "chromadb";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const chroma = new ChromaClient({ host: "localhost", port: 8000 });
const COLLECTION_NAME = "rag_academic_docs";

// ---------------------------------------------------------
// GEMINI SETUP
// ---------------------------------------------------------
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const llm = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
const embedder = genAI.getGenerativeModel({ model: "text-embedding-004" });

// ---------------------------------------------------------
// CLEAN CONTEXT
// ---------------------------------------------------------
function cleanContext(text) {
  return text
    .replace(/[^\x20-\x7E\n]/g, "")
    .replace(/\b\w{1,2}\b/g, "")
    .replace(/\n+/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------
// EMBEDDING USING GEMINI
// ---------------------------------------------------------
async function embedQuery(query) {
  const result = await embedder.embedContent(query);
  return result.embedding.values;
}

// ---------------------------------------------------------
// LLM GENERATION USING GEMINI FLASH
// ---------------------------------------------------------
async function callLLM(question, context) {
  const prompt = `
Use ONLY the context below to answer the question.

RULES:
1. Do not use any outside knowledge.
2. If the context contains the answer, explain it simply and clearly.
3. If context contains only part of the answer, state only that part.
4. If the context contains nothing relevant, reply exactly:
   "Not in notes."
5. No invented details. No assumptions. No examples unless present in notes.
6. Keep the answer clean and student-friendly.

CONTEXT:
${context}

QUESTION:
${question}

ANSWER:
`;

  const result = await llm.generateContent(prompt);
  return result.response.text();
}

// ---------------------------------------------------------
// CHAT ENDPOINT
// ---------------------------------------------------------
app.post("/chat", async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: "Question missing" });

    // 1. Embed the question
    const queryEmbedding = await embedQuery(question);

    // 2. Load collection
    const collection = await chroma.getOrCreateCollection({
      name: COLLECTION_NAME
    });

    // 3. Retrieve docs WITH METADATA
    const results = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: 5,
      include: ["documents", "metadatas"]
    });

    // 4. Extract metadata
    let sourcePDF = "No source found";

    if (
      results.metadatas &&
      results.metadatas[0] &&
      results.metadatas[0][0] &&
      results.metadatas[0][0].pdf_url
    ) {
      sourcePDF = results.metadatas[0][0].pdf_url;
    }

    // DEBUG
    console.log("METADATA RETURNED:", results.metadatas);

    // 5. Build context
    const raw = (results.documents?.[0] || []).join("\n");
    const context = cleanContext(raw);

    // 6. Generate answer
    const answer = await callLLM(question, context);

    // 7. Send final response
    res.json({
      question,
      answer,
      source: sourcePDF
    });

  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: err.message });
  }
});



// ---------------------------------------------------------
app.listen(4000, () => {
  console.log("RAG Chatbot running at http://localhost:4000");
});
