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
// EXPRESS
// ---------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());


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
// SUBJECT → MODULE → KEYWORD MAP  (NEW)
// ---------------------------------------------------------
const SUBJECT_MAP = {
  os: {
    keywords: ["os", "operating system", "deadlock", "scheduling", "paging"],
    modules: {
      1: ["system structure", "os structure", "system calls", "os services"],
      2: ["process scheduling", "threads", "multithreading"],
      3: ["synchronization", "semaphore", "deadlock", "critical section"],
      4: ["memory management", "paging", "segmentation", "thrashing"],
      5: ["file system", "directory", "disk scheduling", "protection"]
    }
  },

  dsa: {
    keywords: ["dsa", "data structures", "stack", "queue", "trees", "graphs"],
    modules: {
      1: ["arrays", "stacks", "postfix", "prefix", "polish notation"],
      2: ["queues", "circular queue", "priority queue", "recursion"],
      3: ["linked list", "dll", "sll", "circular linked", "garbage collection"],
      4: ["trees", "binary tree", "tree traversal", "bst"],
      5: ["graphs", "bfs", "dfs", "hashing", "collision", "rehashing"]
    }
  },

  ddco: {
    keywords: ["ddco", "digital logic", "logic gates", "microprocessor"],
    modules: {
      1: ["boolean algebra", "kmap", "nand", "nor", "verilog"],
      2: ["adder", "subtractor", "encoder", "decoder", "multiplexer", "flip flop"],
      3: ["processor", "instruction", "addressing modes"],
      4: ["io devices", "interrupts", "dma", "cache memory"],
      5: ["pipeline", "alu", "register transfer"]
    }
  },

  maths: {
    keywords: ["math", "mathematics", "probability", "statistics", "regression"],
    modules: {
      1: ["probability distribution", "random variable", "binomial", "poisson"],
      2: ["joint probability", "markov chain"],
      3: ["sampling", "standard error", "hypothesis testing"],
      4: ["t test", "chi square", "f distribution"],
      5: ["correlation", "regression", "least squares"]
    }
  }
};

// ---------------------------------------------------------
// SMART QUERY PARSERS  (NEW)
// ---------------------------------------------------------
function extractModule(q) {
  const m = q.match(/module\s*[-_ ]*(\d+)/i);
  return m ? parseInt(m[1]) : null;
}

function extractSem(q) {
  const s = q.match(/(\d+)\s*(st|nd|rd|th)?\s*sem/i);
  return s ? parseInt(s[1]) : null;
}

function extractSubject(q) {
  q = q.toLowerCase();
  for (const [subj, data] of Object.entries(SUBJECT_MAP)) {
    if (data.keywords.some(k => q.includes(k))) return subj;
  }
  return null;
}

// ---------------------------------------------------------
// SMART FILTER + FUZZY MATCH  (NEW)
// ---------------------------------------------------------
function smartFilterFiles(query, fileIndex) {
  const allFiles = Object.keys(fileIndex);
  let filtered = allFiles;

  const mod = extractModule(query);
  const sem = extractSem(query);
  const subj = extractSubject(query);

  if (mod) {
    filtered = filtered.filter(f =>
      f.toLowerCase().includes(`module ${mod}`) ||
      f.toLowerCase().includes(`module_${mod}`) ||
      f.toLowerCase().includes(`mod ${mod}`) ||
      f.toLowerCase().includes(`${mod}.`)
    );
  }

  if (sem) {
    filtered = filtered.filter(f =>
      f.toLowerCase().includes(`${sem}rd sem`) ||
      f.toLowerCase().includes(`${sem}th sem`) ||
      f.toLowerCase().includes(`${sem}nd sem`) ||
      f.toLowerCase().includes(`${sem}st sem`)
    );
  }

  if (subj) {
    filtered = filtered.filter(f =>
      f.toLowerCase().includes(subj)
    );
  }

  if (filtered.length === 0) return allFiles;
  return filtered;
}

function findSmartFile(query, fileIndex) {
  const filtered = smartFilterFiles(query, fileIndex);

  const result = stringSimilarity.findBestMatch(
    query.toLowerCase(),
    filtered.map(f => f.toLowerCase())
  );

  return filtered[result.bestMatchIndex];
}

// ---------------------------------------------------------
// GEMINI
// ---------------------------------------------------------
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const llm = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
const embedder = genAI.getGenerativeModel({ model: "text-embedding-004" });

// ---------------------------------------------------------
// CLASSIFIER (STRONG VERSION)
// ---------------------------------------------------------
async function classifyMessage(question) {
  const prompt = `
You are a classifier for a college academic assistant platform.

Classify the USER MESSAGE into EXACTLY one of these categories:

1) SMALL_TALK
- Greetings, emojis, chit-chat with NO intent of studying.

2) DIRECT_NOTES_REQUEST
- User is asking for:
  notes, pdf, syllabus, module notes, unit notes, IA notes, material.
- User is NOT asking for explanation.

3) NOTES_QUERY
- User is asking academic questions:
  explanations, definitions, theory, differences, problem solving.

4) OTHER
- Anything that does not belong to above categories.

Return ONLY:
SMALL_TALK
DIRECT_NOTES_REQUEST
NOTES_QUERY
OTHER

USER MESSAGE:
"${question}"
`;

  const r = await llm.generateContent(prompt);
  return r.response.text().trim().toUpperCase();
}

// ---------------------------------------------------------
// SMALL TALK LLM (STRICT)
// ---------------------------------------------------------
async function runSmallTalkLLM(question) {
  const prompt = `
You are a minimal small-talk assistant.

RULES:
- Reply short.
- If the message contains ANY academic intent, reply EXACTLY:
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

// ---------------------------------------------------------
// STRICT RAG-GROUNDED ANSWER ENGINE
// ---------------------------------------------------------
async function runLLM(question, context) {
  const prompt = `
You are a STRICT retrieval-grounded academic assistant.

You MUST answer ONLY using the information in "CONTEXT".
If ANY information is missing:
Reply EXACTLY:
Not in notes.

If context is partial:
Give the partial answer, then append EXACTLY:
Not in notes.

You may only rephrase context.
You may NOT add:
- Examples
- Explanations not in context
- Assumptions
- Outside knowledge
- Missing reasoning

------------------------------------------------------
CONTEXT:
${context}

QUESTION:
${question}

STRICT ANSWER:
`;

  const r = await llm.generateContent(prompt);
  return r.response.text().trim();
}

// ---------------------------------------------------------
// CHROMA CLIENT
// ---------------------------------------------------------
const chroma = new ChromaClient({
  path: "http://localhost:8000"
});

// ---------------------------------------------------------
// CHAT ENDPOINT
// ---------------------------------------------------------
app.post("/chat", async (req, res) => {
  try {
    const { question } = req.body;

    if (!question)
      return res.status(400).json({ error: "Question missing" });

    console.log("QUESTION:", question);

    const category = await classifyMessage(question);
    console.log("CATEGORY:", category);

    // SMALL TALK
    if (category === "SMALL_TALK") {
      const answer = await runSmallTalkLLM(question);
      return res.json({ question, answer, source_label: null, source_link: null });
    }

    // DIRECT NOTES REQUEST → SMART FILE MATCH
    if (category === "DIRECT_NOTES_REQUEST") {
      const bestFile = findSmartFile(question, fileIndex);
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

    // NOTES QUERY → ORIGINAL RAG
    if (category === "NOTES_QUERY") {
      const qEmbedding = await embedQuery(question);
      const collection = await chroma.getCollection({ name: "rag_academic_docs" });

      const results = await collection.query({
        queryEmbeddings: [qEmbedding],
        nResults: 5,
        include: ["documents", "metadatas"]
      });

      const docs = results.documents?.[0] || [];
      const metas = results.metadatas?.[0] || [];

      const context = cleanContext(docs.join("\n"));
      const answer = await runLLM(question, context);

      let sourceLabel = null;
      let sourceLink = null;

      if (metas[0]?.source) {
        const fname = metas[0].source;
        sourceLabel = fname.replace(/\.pdf$/i, "");

        const match = Object.keys(fileIndex).find(k =>
          k.toLowerCase().includes(fname.toLowerCase())
        );

        if (match) sourceLink = fileIndex[match];
      }

      return res.json({
        question,
        answer,
        source_label: sourceLabel,
        source_link: sourceLink
      });
    }

    // OTHER CATEGORY
    return res.json({
      question,
      answer: "We are on an educational platform. Ask academic questions or request notes.",
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
