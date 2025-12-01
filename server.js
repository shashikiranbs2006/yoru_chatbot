import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

// Setup correct paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize app
const app = express();
const PORT = 3000;

// Middlewares
app.use(cors());
app.use(express.json());

// ABSOLUTE PATH to files
const filesPath = path.join(__dirname, "downloaded_files");

console.log("Serving files from:", filesPath);

// Serve files statically
app.use("/files", express.static(filesPath));

// Root endpoint
app.get("/", (req, res) => {
  res.send("File server running");
});

// Start server
app.listen(PORT, () => {
  console.log(`File server running at http://localhost:${PORT}`);
});
