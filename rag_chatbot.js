import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { ChromaClient } from "chromadb";
import { GoogleGenerativeAI } from "@google/generative-ai";

// NEW IMPORT
import stringSimilarity from "string-similarity";

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

// ---------------------------------------------------------
// HELPER: FUZZY MATCH FILES  (NEW)
// ---------------------------------------------------------
function findBestFileForQuery(query, fileIndex) {
  const fileList = Object.keys(fileIndex);
  const result = stringSimilarity.findBestMatch(
    query.toLowerCase(),
    fileList.map(f => f.toLowerCase())
  );
  return fileList[result.bestMatchIndex];
}

// ---------------------------------------------------------
// MESSAGE CLASSIFIER (LLM)  — UPDATED WITH NEW CATEGORY
// ---------------------------------------------------------
async function classifyMessage(question) {
  const prompt = `
You are a classifier for a college notes chatbot.

Classify the USER MESSAGE into exactly one of these categories:

1) SMALL_TALK
- Greetings, emojis, casual chat.

2) DIRECT_NOTES_REQUEST
- User is requesting notes, pdf, module notes, unit notes, IA notes, syllabus, etc.
- User is NOT asking for explanation.
Examples:
"give module 5 notes"
"send pdf module 1"
"dsa unit 3 notes"
"os module 2 pdf"
"dbms notes"

3) NOTES_QUERY
- Requests that ask for definitions, explanations, concepts, formulas, answers, content details.

4) OTHER
- Anything else.

Return ONLY one label: SMALL_TALK, DIRECT_NOTES_REQUEST, NOTES_QUERY, or OTHER.

USER MESSAGE:
"${question}"
  `;

  const r = await llm.generateContent(prompt);
  const raw = r.response.text().trim().toUpperCase();

  if (raw.includes("SMALL_TALK")) return "SMALL_TALK";
  if (raw.includes("DIRECT_NOTES_REQUEST")) return "DIRECT_NOTES_REQUEST";
  if (raw.includes("NOTES_QUERY")) return "NOTES_QUERY";
  return "OTHER";
}

// ---------------------------------------------------------
// SMALL TALK LLM (NO KNOWLEDGE)
// ---------------------------------------------------------
async function runSmallTalkLLM(question) {
  const prompt = `
You are a very simple casual conversation assistant.

Rules:
- Keep replies a bit formal.
- DO NOT answer any technical, academic, or knowledge-based questions.
- If the user asks anything requiring academic content (definitions, notes, explanations, concepts), reply exactly:
Not in notes.

User: ${question}

Reply:
`;
  const r = await llm.generateContent(prompt);
  return r.response.text().trim();
}

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
You are a retrieval-grounded academic assistant.

You must answer strictly and only using the text provided in “Context.” 
Do not use prior knowledge.

If information requested is not explicitly present, output:
Not in notes.

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

    // -----------------------------------------------------
    // CLASSIFY MESSAGE FIRST
    // -----------------------------------------------------
    const category = await classifyMessage(question);
    console.log("CATEGORY:", category);

    // -----------------------------------------------------
    // SMALL TALK PATH (NO RAG, NO SOURCE)
    // -----------------------------------------------------
    if (category === "SMALL_TALK") {
      const answer = await runSmallTalkLLM(question);
      return res.json({
        question,
        answer,
        source_label: null,
        source_link: null
      });
    }

    // -----------------------------------------------------
    // DIRECT NOTES REQUEST → PURE FILE RETRIEVAL (NEW)
    // -----------------------------------------------------
    if (category === "DIRECT_NOTES_REQUEST") {
      const bestFile = findBestFileForQuery(question, fileIndex);
      const link = fileIndex[bestFile];

      if (!link) {
        return res.json({
          question,
          answer: "Not in notes.",
          source_label: null,
          source_link: null
        });
      }

      return res.json({
        question,
        answer: "Here are the notes.",
        source_label: bestFile,
        source_link: link
      });
    }

    // -----------------------------------------------------
    // NOTES QUERY → NORMAL RAG PIPELINE (UNCHANGED)
    // -----------------------------------------------------
    if (category === "NOTES_QUERY") {
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
    }

    // -----------------------------------------------------
    // OTHER CATEGORY
    // -----------------------------------------------------
    return res.json({
      question,
      answer: "Not in notes.",
      source_label: null,
      source_link: null
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
