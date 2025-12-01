import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 4000;

// the folder where original files are stored
const filesPath = path.join(__dirname, "downloaded_files");

// GET /getfile?name=<filename>
app.get("/getfile", (req, res) => {
  const fileName = req.query.name;

  if (!fileName) {
    return res.status(400).json({ error: "Missing ?name=" });
  }

  const filePath = path.join(filesPath, fileName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  return res.json({
    file_url: `http://localhost:3000/files/${fileName}`
  });
});

app.listen(PORT, () => {
  console.log(`Retriever API running at http://localhost:${PORT}`);
});
