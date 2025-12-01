import { google } from "googleapis";
import fs from "fs";
import path from "path";

const KEYFILEPATH = "./ragmodel.json";
const ROOT_FOLDER_ID = "1ltT9QF1vpJh1UbyA-V4gRb40yP5aryLM";

const auth = new google.auth.GoogleAuth({
  keyFile: KEYFILEPATH,
  scopes: ["https://www.googleapis.com/auth/drive.readonly"],
});
const drive = google.drive({ version: "v3", auth });

// Make sure downloads folder exists
const downloadDir = "./downloads";
if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir);

async function listFilesInFolder(folderId) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents`,
    fields: "files(id, name, mimeType)",
  });
  return res.data.files || [];
}

async function downloadFile(file) {
  const filePath = path.join(downloadDir, file.name.replace(/[\\/:"*?<>|]+/g, "_"));

  try {
    if (file.mimeType === "application/vnd.google-apps.folder") {
      console.log(`📁 Entering folder: ${file.name}`);
      const subFiles = await listFilesInFolder(file.id);
      for (const subFile of subFiles) {
        await downloadFile(subFile);
      }
      return;
    }

    let response;
    if (file.mimeType === "application/vnd.google-apps.document") {
      // Export Google Docs as text
      response = await drive.files.export(
        { fileId: file.id, mimeType: "text/plain" },
        { responseType: "stream" }
      );
    } else {
      // Download binary files (pdf, docx, etc.)
      response = await drive.files.get(
        { fileId: file.id, alt: "media" },
        { responseType: "stream" }
      );
    }

    await new Promise((resolve, reject) => {
      const dest = fs.createWriteStream(filePath);
      response.data
        .on("end", () => {
          console.log(`✅ Downloaded: ${file.name}`);
          resolve();
        })
        .on("error", reject)
        .pipe(dest);
    });
  } catch (error) {
    console.error(`❌ Error downloading ${file.name}:`, error.message);
  }
}

async function main() {
  console.log("🚀 Fetching files recursively from Drive...");
  const rootFiles = await listFilesInFolder(ROOT_FOLDER_ID);
  for (const file of rootFiles) {
    await downloadFile(file);
  }
  console.log("🎉 All files processed and saved in /downloads folder.");
}

main().catch(console.error);
