import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { ChromaClient } from "chromadb";
import OpenAI from "openai";
import fetch from "node-fetch";
import { GoogleGenerativeAI } from "@google/generative-ai";
import stringSimilarity from "string-similarity";
import session from "express-session";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import cookieParser from "cookie-parser";

dotenv.config();
const app = express();

// ─────────────────────────────────────────────────────────
// SESSION & PASSPORT SETUP
// ─────────────────────────────────────────────────────────
const SESSION_SECRET =
  process.env.SESSION_SECRET || "your-secret-key-change-me";

app.use(cookieParser());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // Set to true if using HTTPS
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  }),
);

app.use(passport.initialize());
app.use(passport.session());

// Passport serialization
passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

// Google OAuth Strategy
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || "http://localhost:4000/auth/google/callback",
      },
      (accessToken, refreshToken, profile, done) => {
        const user = {
          id: profile.id,
          displayName: profile.displayName,
          email: profile.emails?.[0]?.value || null,
          photo: profile.photos?.[0]?.value || null,
        };
        return done(null, user);
      },
    ),
  );
} else {
  console.warn(
    "⚠️  Google OAuth credentials not found. Login with Google will not work.",
  );
}

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like file:// or same-origin)
      if (!origin) return callback(null, true);
      // Allow common dev origins
      const allowedOrigins = [
        "http://localhost:3000",
        "http://localhost:4000",
        "http://localhost:5500",
        "http://localhost:5501",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:4000",
        "http://127.0.0.1:5500",
        "http://127.0.0.1:5501",
        process.env.APP_URL,
      ].filter(Boolean);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, true); // Allow all origins in development
    },
    credentials: true,
  }),
);
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve frontend static files from /public (fallback to /rag_project_frontend)
const publicDir = fs.existsSync(path.join(__dirname, "public"))
  ? path.join(__dirname, "public")
  : path.join(__dirname, "rag_project_frontend");
app.use(express.static(publicDir));
// Serve downloaded files for source PDF links
app.use("/files", express.static(path.join(__dirname, "downloaded_files")));
// ---------------------------------------------------------
// ENV CHECK
// ---------------------------------------------------------
if (!process.env.GROQ_API_KEY) {
  console.warn("⚠️  GROQ_API_KEY is missing in environment variables.");
}
if (!process.env.GEMINI_API_KEY) {
  console.warn("⚠️  GEMINI_API_KEY is missing in environment variables.");
}
// ChromaDB: use remote URL or local path
const CHROMA_PATH =
  process.env.CHROMA_URL || process.env.CHROMA_PATH || "http://localhost:8000";

// Init Gemini for embeddings
const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;
// ---------------------------------------------------------
// FILE INDEX
// ---------------------------------------------------------
let fileIndex = {};
try {
  fileIndex = JSON.parse(
    fs.readFileSync(path.join(__dirname, "file_index.json"), "utf8"),
  );
  console.log("file_index.json loaded.");
} catch {
  console.log("file_index.json not found.");
}

// ---------------------------------------------------------
// CHUNKS DATA (Fallback Search)
// ---------------------------------------------------------
let chunksData = [];
try {
  const chunksPath = path.join(__dirname, "stage2_chunks", "chunks.json");
  if (fs.existsSync(chunksPath)) {
    chunksData = JSON.parse(fs.readFileSync(chunksPath, "utf8"));
    console.log(`Loaded ${chunksData.length} chunks for search fallback.`);
  }
} catch (e) {
  console.warn("chunks.json not loaded:", e.message);
}

function keywordSearchFallback(query, topK = 5) {
  if (!chunksData || chunksData.length === 0) return { documents: [], metadatas: [] };
  const stopWords = new Set(["what", "is", "the", "a", "an", "and", "or", "in", "of", "to", "for", "with", "on", "at", "by", "from", "how", "why", "can", "explain", "describe", "give", "notes", "tell", "me", "about"]);
  const terms = query
    .toLowerCase()
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  if (terms.length === 0) return { documents: [], metadatas: [] };

  const scored = [];
  for (const chunk of chunksData) {
    const textLower = (chunk.content || "").toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (textLower.includes(term)) {
        const matches = textLower.split(term).length - 1;
        score += matches;
      }
    }
    if (score > 0) {
      scored.push({
        document: chunk.content,
        metadata: {
          source: chunk.source || "",
          source_page: chunk.source || "",
          pdf: chunk.source || "",
          id: chunk.id || "",
        },
        score,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, topK);
  return {
    documents: top.map((t) => t.document),
    metadatas: top.map((t) => t.metadata),
  };
}
// ---------------------------------------------------------
// SUBJECT MAP
// ---------------------------------------------------------
const SUBJECT_MAP = {
  os: {
    keywords: ["os", "operating system", "deadlock", "scheduling", "paging"],
    youtubeKeywords: {
      general: "operating systems tutorial",
      deadlock: "deadlock in operating systems",
      scheduling: "CPU scheduling algorithms",
      paging: "paging in OS memory management",
      synchronization: "process synchronization",
    },
    modules: {
      1: ["system structure", "os structure", "system calls", "os services"],
      2: ["process scheduling", "threads", "multithreading"],
      3: ["synchronization", "semaphore", "deadlock", "critical section"],
      4: ["memory management", "paging", "segmentation", "thrashing"],
      5: ["file system", "directory", "disk scheduling", "protection"],
    },
  },

  dsa: {
    keywords: ["dsa", "data structures", "stack", "queue", "trees", "graphs"],
    youtubeKeywords: {
      general: "data structures and algorithms",
      stack: "stack data structure tutorial",
      queue: "queue data structure",
      trees: "binary tree tutorial",
      graphs: "graph algorithms tutorial",
      "linked list": "linked list implementation",
    },
    modules: {
      1: ["arrays", "stacks", "postfix", "prefix", "polish notation"],
      2: ["queues", "circular queue", "priority queue", "recursion"],
      3: ["linked list", "dll", "sll", "circular linked", "garbage collection"],
      4: ["trees", "binary tree", "tree traversal", "bst"],
      5: ["graphs", "bfs", "dfs", "hashing", "collision", "rehashing"],
    },
  },

  ddco: {
    keywords: ["ddco", "digital logic", "logic gates", "microprocessor"],
    youtubeKeywords: {
      general: "digital design and computer organization",
      "logic gates": "logic gates tutorial",
      "boolean algebra": "boolean algebra simplification",
      "flip flop": "flip flops in digital electronics",
      microprocessor: "8086 microprocessor tutorial",
    },
    modules: {
      1: ["boolean algebra", "kmap", "nand", "nor", "verilog"],
      2: [
        "adder",
        "subtractor",
        "encoder",
        "decoder",
        "multiplexer",
        "flip flop",
      ],
      3: ["processor", "instruction", "addressing modes"],
      4: ["io devices", "interrupts", "dma", "cache memory"],
      5: ["pipeline", "alu", "register transfer"],
    },
  },

  maths: {
    keywords: [
      "math",
      "mathematics",
      "probability",
      "statistics",
      "regression",
    ],
    youtubeKeywords: {
      general: "probability and statistics",
      probability: "probability distribution tutorial",
      regression: "linear regression explained",
      "hypothesis testing": "hypothesis testing statistics",
      "chi square": "chi square test tutorial",
    },
    modules: {
      1: ["probability distribution", "random variable", "binomial", "poisson"],
      2: ["joint probability", "markov chain"],
      3: ["sampling", "standard error", "hypothesis testing"],
      4: ["t test", "chi square", "f distribution"],
      5: ["correlation", "regression", "least squares"],
    },
  },
};

// ---------------------------------------------------------
// SMART QUERY PARSERS
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
    if (data.keywords.some((k) => q.includes(k))) return subj;
  }
  return null;
}

function extractTopic(query, subject) {
  if (!subject) return null;

  const q = query.toLowerCase();
  const subjectData = SUBJECT_MAP[subject];

  for (const topic of Object.keys(subjectData.youtubeKeywords)) {
    if (topic !== "general" && q.includes(topic.toLowerCase())) return topic;
  }

  for (const moduleTopics of Object.values(subjectData.modules)) {
    for (const topic of moduleTopics) {
      if (q.includes(topic.toLowerCase())) return topic;
    }
  }

  return null;
}

// ---------------------------------------------------------
// YOUTUBE LINKS
// ---------------------------------------------------------
function generateYouTubeSearchQuery(query, subject, topic) {
  if (!subject) {
    return (
      query.replace(/give|show|explain|what is|notes on/gi, "").trim() +
      " tutorial"
    );
  }

  const subjectData = SUBJECT_MAP[subject];

  if (topic && subjectData.youtubeKeywords[topic]) {
    return subjectData.youtubeKeywords[topic];
  }

  let base = subjectData.youtubeKeywords.general || query;
  if (topic) base += ` ${topic}`;
  return base;
}

function generateYouTubeLinks(query, subject, topic, count = 3) {
  const searchQuery = generateYouTubeSearchQuery(query, subject, topic);
  const encodedQuery = encodeURIComponent(searchQuery);

  const links = [
    {
      type: "search",
      url: `https://www.youtube.com/results?search_query=${encodedQuery}`,
      description: `Search: ${searchQuery}`,
    },
  ];

  const channelRecommendations = {
    os: [
      { name: "Neso Academy", query: encodedQuery + "+neso+academy" },
      { name: "Gate Smashers", query: encodedQuery + "+gate+smashers" },
    ],
    dsa: [
      { name: "Abdul Bari", query: encodedQuery + "+abdul+bari" },
      { name: "Apna College", query: encodedQuery + "+apna+college" },
    ],
    ddco: [
      { name: "Neso Academy", query: encodedQuery + "+neso+academy" },
      { name: "Tutorials Point", query: encodedQuery + "+tutorials+point" },
    ],
    maths: [
      { name: "Khan Academy", query: encodedQuery + "+khan+academy" },
      { name: "StatQuest", query: encodedQuery + "+statquest" },
    ],
  };

  if (subject && channelRecommendations[subject]) {
    channelRecommendations[subject].forEach((channel) => {
      links.push({
        type: "channel",
        url: `https://www.youtube.com/results?search_query=${channel.query}`,
        description: `${channel.name}: ${searchQuery}`,
      });
    });
  }

  return links.slice(0, count);
}

// ---------------------------------------------------------
// FILE MATCH
// ---------------------------------------------------------
function smartFilterFiles(query, fileIndex) {
  const allFiles = Object.keys(fileIndex);
  let filtered = allFiles;

  const mod = extractModule(query);
  const sem = extractSem(query);
  const subj = extractSubject(query);

  if (mod) {
    filtered = filtered.filter(
      (f) =>
        f.toLowerCase().includes(`module ${mod}`) ||
        f.toLowerCase().includes(`module_${mod}`) ||
        f.toLowerCase().includes(`mod ${mod}`) ||
        f.toLowerCase().includes(`${mod}.`),
    );
  }

  if (sem) {
    filtered = filtered.filter(
      (f) =>
        f.toLowerCase().includes(`${sem}rd sem`) ||
        f.toLowerCase().includes(`${sem}th sem`) ||
        f.toLowerCase().includes(`${sem}nd sem`) ||
        f.toLowerCase().includes(`${sem}st sem`),
    );
  }

  if (subj) {
    filtered = filtered.filter((f) => f.toLowerCase().includes(subj));
  }

  if (filtered.length === 0) return allFiles;
  return filtered;
}

function findSmartFile(query, fileIndex) {
  const filtered = smartFilterFiles(query, fileIndex);

  const result = stringSimilarity.findBestMatch(
    query.toLowerCase(),
    filtered.map((f) => f.toLowerCase()),
  );

  return filtered[result.bestMatchIndex];
}

// ---------------------------------------------------------
// GROQ CLIENT
// ---------------------------------------------------------
const groq = process.env.GROQ_API_KEY
  ? new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1",
    })
  : null;

const LLM_MODEL = process.env.GROQ_MODEL || "qwen/qwen3.8-27b";

// ---------------------------------------------------------
// GEMINI EMBEDDINGS (replaces Ollama nomic-embed-text)
// ---------------------------------------------------------
async function embedQuery(text) {
  if (!genAI) {
    throw new Error("GEMINI_API_KEY is not configured on the server.");
  }
  const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
  const result = await model.embedContent(text);
  const embedding = result.embedding.values;
  if (!embedding || embedding.length === 0) {
    throw new Error("Gemini embedding failed: empty result");
  }
  return embedding;
}

function cleanContext(text) {
  return text
    .replace(/[^\x20-\x7E\n]/g, "")
    .replace(/\n+/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------
// QUERY EXPANSION
// ---------------------------------------------------------
async function expandQuery(question) {
  const prompt = `
Given this question, generate 2 alternative phrasings that mean the same thing.
Return ONLY the alternatives, one per line, no numbering.

Question: ${question}

Alternatives:
`;

  const r = await groq.chat.completions.create({
    model: LLM_MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 120,
  });

  const alternatives = r.choices[0].message.content
    .trim()
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 2);

  return [question, ...alternatives];
}

// ---------------------------------------------------------
// CLASSIFIER
// ---------------------------------------------------------
async function classifyMessage(question) {
  const prompt = `Classify user message into EXACTLY one category:
- SMALL_TALK: greetings, polite chat, non-academic banter (e.g. hi, hello, how are you, who made you, thanks)
- DIRECT_NOTES_REQUEST: asking to download, send, get, or view notes/PDF files (e.g. send me math notes, give me module 1 notes, share os notes)
- QUESTION_BANK_REQUEST: asking for question banks, list of questions, or previous exam questions
- NOTES_QUERY: any academic question, definition, concept, explanation, difference, or topic inquiry (e.g. what is stack, what is bandwidth, explain paging, difference between process and thread)

Return ONLY the category name.

USER MESSAGE:
"${question}"
`;

  const r = await groq.chat.completions.create({
    model: LLM_MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 30,
  });

  const cat = r.choices[0].message.content.trim().toUpperCase();
  if (cat.includes("DIRECT_NOTES")) return "DIRECT_NOTES_REQUEST";
  if (cat.includes("QUESTION_BANK")) return "QUESTION_BANK_REQUEST";
  if (cat.includes("SMALL_TALK")) return "SMALL_TALK";
  return "NOTES_QUERY";
}

// ---------------------------------------------------------
// SMALL TALK
// ---------------------------------------------------------
async function runSmallTalkLLM(question) {
  const prompt = `
Reply short and friendly.
If message contains ANY academic intent, reply EXACTLY:
Not in notes.

User: ${question}
Reply:
`;

  const r = await groq.chat.completions.create({
    model: LLM_MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
    max_tokens: 80,
  });

  return r.choices[0].message.content.trim();
}

// ---------------------------------------------------------
// CHROMA CLIENT
// ---------------------------------------------------------
function getChromaConfig(urlStr) {
  try {
    const url = new URL(urlStr);
    return {
      host: url.hostname,
      port: url.port ? parseInt(url.port) : (url.protocol === "https:" ? 443 : 80),
      ssl: url.protocol === "https:",
    };
  } catch {
    return { path: urlStr };
  }
}

const chroma = new ChromaClient(getChromaConfig(CHROMA_PATH));

// ---------------------------------------------------------
// RETRIEVAL + DEDUPE
// ---------------------------------------------------------
async function retrieveWithReranking(question, topK = 10, finalK = 5) {
  let collection;
  try {
    collection = await chroma.getCollection({ name: "rag_academic_docs" });
  } catch (err) {
    console.error("Chroma retrieval error:", err.message);
    return {
      documents: [],
      metadatas: [],
      chromaError: err.message,
    };
  }

  let queries = [question];
  try {
    queries = await expandQuery(question);
  } catch (e) {
    console.warn("Query expansion skipped:", e.message);
  }

  const allResults = [];

  for (const q of queries) {
    try {
      const qEmbedding = await embedQuery(q);

      const results = await collection.query({
        queryEmbeddings: [qEmbedding],
        nResults: Math.ceil(topK / queries.length),
        include: ["documents", "metadatas", "distances"],
      });

      const docs = results.documents?.[0] || [];
      const metas = results.metadatas?.[0] || [];
      const distances = results.distances?.[0] || [];

      for (let i = 0; i < docs.length; i++) {
        allResults.push({
          document: docs[i],
          metadata: metas[i],
          distance: distances[i],
        });
      }
    } catch (e) {
      console.warn("Chroma query step failed for query:", q, e.message);
    }
  }

  const uniqueResults = [];
  const seen = new Set();

  for (const r of allResults) {
    const hash = (r.document || "").substring(0, 140);
    if (!seen.has(hash)) {
      seen.add(hash);
      uniqueResults.push(r);
    }
  }

  uniqueResults.sort((a, b) => a.distance - b.distance);

  const topResults = uniqueResults.slice(0, finalK);

  if (topResults.length === 0) {
    console.log(`Vector retrieval returned 0 results for "${question}". Running keyword fallback...`);
    return keywordSearchFallback(question, finalK);
  }

  return {
    documents: topResults.map((r) => r.document),
    metadatas: topResults.map((r) => r.metadata),
  };
}

// ---------------------------------------------------------
// STRICT STRUCTURED ANSWER (NO EXAMPLE HEADING IF NOT PRESENT)
// ---------------------------------------------------------
async function runLLM(question, context) {
  const prompt = `
You are a STRICT retrieval-grounded academic assistant.

RULES:
1) Use ONLY CONTEXT.
2) If not found, reply EXACTLY: Not in notes.
3) Keep it exam-ready.
4) Output MUST be clean markdown.

FORMAT:
DEFINITION:
- (1 to 3 lines)

KEY POINTS:
- Point 1
- Point 2
- Point 3

OPTIONAL EXAMPLE:
- Only include this section if the context contains a real example.
- If there is no example in context, DO NOT show the heading.

CONTEXT USED:
- Copy 1-2 exact lines from the context.

CONTEXT:
${context}

QUESTION:
${question}

ANSWER:
`;

  const r = await groq.chat.completions.create({
    model: LLM_MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 600,
  });

  let answer = r.choices?.[0]?.message?.content || "Not in notes.";

  // Clean formatting
  answer = answer.replace(/\n{3,}/g, "\n\n").trim();

  // If model accidentally wrote EXAMPLE: Not in notes, remove it
  answer = answer.replace(/OPTIONAL EXAMPLE:\s*-?\s*Not in notes\.?/gi, "");
  answer = answer.replace(/EXAMPLE:\s*-?\s*Not in notes\.?/gi, "");

  // Extra cleanup
  answer = answer.replace(/\n{3,}/g, "\n\n").trim();

  return answer;
}

// ---------------------------------------------------------
// AUTHENTICATION ROUTES
// ---------------------------------------------------------

// Google OAuth login
app.get("/auth/google", (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    if (req.session) req.session.guest = true;
    return res.redirect((process.env.APP_URL || "") + "/?guest=true");
  }
  passport.authenticate("google", {
    scope: ["profile", "email"],
  })(req, res, next);
});

// Google OAuth callback
app.get(
  "/auth/google/callback",
  (req, res, next) => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      if (req.session) req.session.guest = true;
      return res.redirect((process.env.APP_URL || "") + "/?guest=true");
    }
    passport.authenticate("google", {
      failureRedirect: (process.env.APP_URL || "") + "/#/login",
    })(req, res, next);
  },
  (req, res) => {
    res.redirect(process.env.APP_URL || "/");
  },
);

// Check authentication status and get user info
app.get("/auth/user", (req, res) => {
  if (req.isAuthenticated && req.user) {
    return res.json({
      authenticated: true,
      user: req.user,
    });
  }
  if (req.session?.guest) {
    return res.json({
      authenticated: true,
      user: {
        id: "guest",
        displayName: "Guest Student",
        email: "guest@bmsit.in",
        photo: null,
      },
    });
  }
  res.json({
    authenticated: false,
    user: null,
  });
});

// Logout
app.get("/auth/logout", (req, res) => {
  req.logout((err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Logged out successfully" });
  });
});

// ---------------------------------------------------------
// HEALTH
// ---------------------------------------------------------
app.get("/health", async (req, res) => {
  try {
    res.json({
      status: "ok",
      chroma_path: CHROMA_PATH,
      embedding_provider: "gemini text-embedding-004",
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ status: "bad", error: e.message });
  }
});

// ---------------------------------------------------------
// CHAT HISTORY & UPLOAD (Frontend support)
// ---------------------------------------------------------
const sessionHistories = new Map();

app.get("/chatHistory", (req, res) => {
  const sessionId = req.query.sessionId || req.sessionID || "default";
  const messages = sessionHistories.get(sessionId) || [];
  res.json({ messages });
});

app.post("/saveChat", (req, res) => {
  const { question, answer, sourceLabel, sourceFrom, sessionId } = req.body;
  const sid = sessionId || req.sessionID || "default";
  if (!sessionHistories.has(sid)) {
    sessionHistories.set(sid, []);
  }
  sessionHistories.get(sid).push({
    question,
    answer,
    sourceLabel,
    sourceFrom,
    createdAt: new Date().toISOString(),
  });
  res.json({ success: true });
});

app.delete("/chatHistory", (req, res) => {
  const sid = req.query.sessionId || req.sessionID || "default";
  sessionHistories.delete(sid);
  res.json({ success: true, message: "History cleared" });
});

app.post("/upload", (req, res) => {
  res.status(501).json({
    error: "Custom document upload is disabled in serverless deployment. All core BMSIT notes are already indexed in the system.",
  });
});

// ---------------------------------------------------------
// QUESTION BANK ENGINE
// ---------------------------------------------------------

function extractPageNumber(source) {
  if (!source) return 0;
  const match = source.match(/__page_(\d+)/i);
  return match ? parseInt(match[1]) : 0;
}

async function getQuestionBank(subject, moduleNumber) {
  if (!subject || !moduleNumber) {
    return { questions: [], error: "Subject or module missing" };
  }

  const subjectKeywords = SUBJECT_MAP[subject]?.keywords || [];

  let collection;
  try {
    collection = await chroma.getCollection({ name: "rag_academic_docs" });
  } catch (err) {
    console.error("Chroma question bank retrieval error:", err.message);
    return {
      questions: [],
      error: `ChromaDB vector store is unreachable (${err.message}). Ensure ChromaDB is running.`,
    };
  }

  let results;
  try {
    results = await collection.get({
      limit: 10000,
      include: ["documents", "metadatas"],
    });
  } catch (err) {
    return {
      questions: [],
      error: `Failed to retrieve question bank from ChromaDB: ${err.message}`,
    };
  }

  const docs = results.documents || [];
  const metas = results.metadatas || [];

  let allChunks = [];

  for (let i = 0; i < docs.length; i++) {
    const metaSource =
      metas[i]?.source_file?.toLowerCase() ||
      metas[i]?.source_page?.toLowerCase() ||
      "";

    const isQuestionBank = metaSource.includes("question_bank");

    const matchesSubject = subjectKeywords.some((keyword) =>
      metaSource.includes(keyword.toLowerCase().replace(/ /g, "_")),
    );

    if (isQuestionBank && matchesSubject) {
      allChunks.push({
        document: docs[i],
        metadata: metas[i],
      });
    }
  }

  if (allChunks.length === 0) {
    return { questions: [], error: "No chunks found" };
  }

  // ✅ Correct page sorting (use source_file or source_page)
  allChunks.sort((a, b) => {
    const pageA = extractPageNumber(
      a.metadata?.source_file || a.metadata?.source_page,
    );
    const pageB = extractPageNumber(
      b.metadata?.source_file || b.metadata?.source_page,
    );
    return pageA - pageB;
  });

  let fullText = allChunks.map((c) => c.document).join("\n");

  const moduleRegex = new RegExp(`module\\s*[- ]?\\s*${moduleNumber}`, "i");
  const nextModuleRegex = new RegExp(
    `module\\s*[- ]?\\s*${moduleNumber + 1}`,
    "i",
  );

  const startMatch = fullText.match(moduleRegex);

  if (!startMatch) {
    return { questions: [], error: "Module not found in question bank" };
  }

  const startIndex = startMatch.index;
  const remainingText = fullText.slice(startIndex);

  const nextMatch = remainingText.match(nextModuleRegex);

  let moduleText;
  if (nextMatch) {
    moduleText = remainingText.slice(0, nextMatch.index);
  } else {
    moduleText = remainingText;
  }

  // Remove answers
  moduleText = moduleText.replace(/answer\s*:\s*[A-D]/gi, "");

  // Remove MCQ options
  moduleText = moduleText.replace(/(^|\n)\s*[A-D]\.\s.*?/g, "");
  moduleText = moduleText.replace(/(^|\n)\s*\([a-d]\)\s.*?/gi, "");

  // Remove noisy numeric postfix fragments (PDF artifact cleanup)
  moduleText = moduleText.replace(
    /\b\d+(\s+\d+){3,}.*?(?=ii\.|iii\.|iv\.|$)/gi,
    "",
  );

  // Split questions
  let questions = moduleText.split(/\b\d{1,3}\.\s+/g);

  questions = questions
    .map((q) => q.replace(/\n/g, " ").replace(/\s+/g, " ").trim())
    .filter(
      (q) =>
        q.length > 25 &&
        !q.toLowerCase().startsWith("module") &&
        !q.toLowerCase().includes("question bank"),
    );

  // ✅ Intelligent duplicate removal (better than Set)
  const uniqueQuestions = [];

  for (let q of questions) {
    const isDuplicate = uniqueQuestions.some((existing) => {
      const similarity = stringSimilarity.compareTwoStrings(q, existing);
      return similarity > 0.85;
    });

    if (!isDuplicate) {
      uniqueQuestions.push(q);
    }
  }

  return { questions: uniqueQuestions };
}

app.get("/test-qb", async (req, res) => {
  try {
    const subject = "dsa"; // must match SUBJECT_MAP key
    const module = 1;

    const data = await getQuestionBank(subject, module);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//temprovary
app.get("/debug-all", async (req, res) => {
  try {
    const collection = await chroma.getCollection({
      name: "rag_academic_docs",
    });

    const results = await collection.get({
      limit: 20,
      include: ["documents", "metadatas"],
    });

    res.json({
      documentCount: results.documents?.length || 0,
      metadataSample: results.metadatas?.slice(0, 5),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// CHAT ENDPOINT
// ---------------------------------------------------------
app.post("/chat", async (req, res) => {
  try {
    const { question } = req.body;

    if (!question) return res.status(400).json({ error: "Question missing" });

    console.log("\nQUESTION:", question);

    const category = await classifyMessage(question);
    console.log("CATEGORY:", category);

    const subject = extractSubject(question);
    const topic = extractTopic(question, subject);
    const youtubeLinks = generateYouTubeLinks(question, subject, topic);

    // SMALL TALK
    if (category === "SMALL_TALK") {
      const answer = await runSmallTalkLLM(question);
      return res.json({
        question,
        answer,
        source_label: null,
        source_link: null,
        youtube_links: [],
      });
    }

    // DIRECT NOTES REQUEST
    if (category === "DIRECT_NOTES_REQUEST") {
      const bestFile = findSmartFile(question, fileIndex);
      const link = fileIndex[bestFile];

      if (!link) {
        return res.json({
          question,
          answer: "Not in notes.",
          source_label: null,
          source_link: null,
          youtube_links: youtubeLinks,
        });
      }

      return res.json({
        question,
        answer: "Here are the notes.",
        source_label: bestFile,
        source_link: link,
        youtube_links: youtubeLinks,
      });
    }

    // ---------------------------------------------------------
    // QUESTION BANK REQUEST
    // ---------------------------------------------------------
    if (category === "QUESTION_BANK_REQUEST") {
      const module = extractModule(question);

      if (!subject || !module) {
        return res.json({
          question,
          answer: "Please specify subject and module number.",
          source_label: null,
          source_link: null,
          youtube_links: [],
        });
      }

      const data = await getQuestionBank(subject, module);

      if (data.error) {
        return res.json({
          question,
          answer: data.error,
          source_label: null,
          source_link: null,
          youtube_links: [],
        });
      }

      return res.json({
        question,
        answer: "Here are the questions:",
        questions: data.questions,
        source_label: null,
        source_link: null,
        youtube_links: [],
      });
    }

    // NOTES QUERY
    if (category === "NOTES_QUERY") {
      const retrievalResult = await retrieveWithReranking(question);
      const docs = retrievalResult.documents;
      const metas = retrievalResult.metadatas;

      if (retrievalResult.chromaError) {
        const bestFile = findSmartFile(question, fileIndex);
        const link = bestFile ? fileIndex[bestFile] : null;
        return res.json({
          question,
          answer: `⚠️ ChromaDB vector store is currently unreachable (${retrievalResult.chromaError}). If deployed on Vercel, ensure the CHROMA_URL environment variable points to your hosted ChromaDB service. If running locally, start Chroma with Docker: \`docker compose up -d\`.\n\nHere are the most relevant notes from our library:`,
          source_label: bestFile || null,
          source_link: link || null,
          sources: bestFile ? [{ label: bestFile, drive_link: link }] : [],
          youtube_links: youtubeLinks,
        });
      }

      const context = cleanContext(docs.join("\n\n"));
      const answer = await runLLM(question, context);

      // Collect ALL unique sources from retrieved documents
      const sources = [];
      const seenSources = new Set();

      for (const meta of metas) {
        const pageSource =
          meta.source || meta.pdf || meta.source_page || meta.source_file || "";

        if (pageSource && !seenSources.has(pageSource)) {
          seenSources.add(pageSource);

          let driveLink = null;
          if (Object.keys(fileIndex).length > 0) {
            const bestPdfKey = findSmartFile(pageSource, fileIndex);
            if (bestPdfKey) {
              driveLink = fileIndex[bestPdfKey] || null;
            }
          }

          sources.push({
            label: pageSource,
            drive_link: driveLink,
          });
        }
      }

      // Keep backward compatibility - use first source as primary
      let sourceLabel = sources[0]?.label || null;
      let sourceLink = sources[0]?.drive_link || null;

      return res.json({
        question,
        answer,
        source_label: sourceLabel,
        source_link: sourceLink,
        sources: sources, // NEW: Array of all sources with drive links
        youtube_links: youtubeLinks,
      });
    }

    // OTHER
    return res.json({
      question,
      answer: "Ask academic questions or request notes.",
      source_label: null,
      source_link: null,
      youtube_links: youtubeLinks,
    });
  } catch (err) {
    console.error("CHAT ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
});

// Catch-all: serve frontend index.html for any unmatched GET route
// Express 5.x requires named wildcards - use '{*path}' instead of '*'
app.get("/{*path}", (req, res) => {
  const indexPath = path.join(publicDir, "index.html");
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  res.status(404).send("Frontend index.html not found");
});

// ---------------------------------------------------------
const PORT = process.env.PORT || 4000;
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`✅ RAG Chatbot running at http://localhost:${PORT}`);
    console.log(`📂 Frontend served at http://localhost:${PORT}/`);
    console.log("Groq model:", LLM_MODEL);
    console.log("Chroma path:", CHROMA_PATH);
    console.log("Embeddings: Gemini text-embedding-004");
  });
}

export default app;
